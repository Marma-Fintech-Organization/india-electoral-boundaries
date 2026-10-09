/**
 * Validate data/.
 *
 * Always (errors):
 *   JSON Schema for every file, file name matches acNo, ids, duplicates,
 *   constituency count vs state.json, closed rings, coordinates inside India,
 *   constituency bbox inside the state outline bbox, file size caps,
 *   no personal-data keys in ward files.
 *
 * With --geometry (slower):
 *   self-intersections and overlaps between neighbouring constituencies.
 *   With --base <git-ref>, only constituencies changed since that ref are
 *   checked and problems are errors (used in CI). Without --base, every
 *   constituency is checked and problems are reported as warnings, because
 *   the imported data already has known issues.
 *
 * Usage:
 *   npm run validate
 *   npm run validate:geometry -- [--states tn,ka] [--base origin/main]
 */
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import Ajv from "ajv";
import * as turf from "@turf/turf";
import {
  deriveDistricts,
  indiaOutlineHash,
  listStateCodes,
  listWardCities,
  loadIndiaOutline,
  loadMeta,
  loadState,
  readJson,
  stateContentHash,
} from "./lib/data.mjs";
import { formatJson } from "./lib/format.mjs";
import { bboxContains, bboxesIntersect, computeBbox, positions } from "./lib/geo.mjs";
import { FORBIDDEN_WARD_KEY_PATTERN, constituencyId } from "./lib/legacy.mjs";
import { ROOT, SCHEMA_DIR } from "./lib/paths.mjs";

const LIMITS = {
  constituencyBytes: 2 * 1024 * 1024,
  outlineBytes: 4 * 1024 * 1024,
  wardsBytes: 15 * 1024 * 1024,
};
/** Degrees a constituency may extend past its state outline's bbox. */
const OUTLINE_BBOX_TOLERANCE = 0.1;
const INDIA_BOUNDS = [60, 0, 100, 40];
/** An overlap counts if it is bigger than both of these. */
const OVERLAP_MIN_M2 = 20_000;
const OVERLAP_MIN_FRACTION = 0.01;

const args = process.argv.slice(2);
const GEOMETRY = args.includes("--geometry");
const argValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const BASE_REF = argValue("--base");
const STATE_FILTER = argValue("--states")
  ?.split(",")
  .map((code) => code.trim().toUpperCase())
  .filter(Boolean);

const errors = [];
const warnings = [];
const knownIssues = new Set();
const matchedKnownIssues = new Set();
const rel = (file) => path.relative(ROOT, file);
const error = (file, message) => {
  const key = `${rel(file)}: ${message}`;
  if (knownIssues.has(key)) {
    matchedKnownIssues.add(key);
    warnings.push(`${key} (known issue, see data/known-issues.json)`);
    return;
  }
  errors.push(key);
};
const warn = (file, message) => warnings.push(`${rel(file)}: ${message}`);

async function loadKnownIssues() {
  try {
    const { issues } = await readJson(path.join(ROOT, "data/known-issues.json"));
    for (const issue of issues) {
      knownIssues.add(`${issue.file}: ${issue.message}`);
    }
  } catch {
    // no baseline
  }
}

async function loadValidators() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const schema = async (name) => readJson(path.join(SCHEMA_DIR, name));
  ajv.addSchema(await schema("geometry.schema.json"));
  return {
    constituency: ajv.compile(await schema("constituency.schema.json")),
    state: ajv.compile(await schema("state.schema.json")),
    ward: ajv.compile(await schema("ward.schema.json")),
    ulb: ajv.compile(await schema("ulb.schema.json")),
    meta: ajv.compile(await schema("meta.schema.json")),
  };
}

function schemaCheck(validate, file, value) {
  if (validate(value)) {
    return true;
  }
  for (const issue of validate.errors.slice(0, 5)) {
    error(file, `schema: ${issue.instancePath || "/"} ${issue.message}`);
  }
  return false;
}

function checkRingsAndRange(file, geometry) {
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        error(file, "ring is not closed (first and last positions differ)");
        return;
      }
    }
  }
  for (const [lng, lat] of positions(geometry)) {
    if (
      lng < INDIA_BOUNDS[0] ||
      lat < INDIA_BOUNDS[1] ||
      lng > INDIA_BOUNDS[2] ||
      lat > INDIA_BOUNDS[3]
    ) {
      error(file, `coordinate [${lng}, ${lat}] is outside India (is it [longitude, latitude]?)`);
      return;
    }
  }
}

async function checkSize(file, limit) {
  const { size } = await stat(file);
  if (size > limit) {
    error(file, `file is ${(size / 1024 / 1024).toFixed(1)} MB (limit ${limit / 1024 / 1024} MB); simplify the geometry`);
  }
}

function changedFilesSince(ref) {
  const output = execFileSync("git", ["diff", "--name-only", `${ref}...HEAD`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const uncommitted = execFileSync("git", ["diff", "--name-only", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return new Set(
    `${output}\n${uncommitted}`
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => path.join(ROOT, line)),
  );
}

function overlapArea(a, b) {
  try {
    const intersection = turf.intersect(turf.featureCollection([a, b]));
    return intersection ? turf.area(intersection) : 0;
  } catch {
    return 0;
  }
}

function checkGeometry(loaded, changedFiles) {
  const report = changedFiles ? error : warn;
  const items = loaded.constituencies.map((item) => ({
    ...item,
    bbox: computeBbox(item.feature.geometry),
  }));
  const targets = changedFiles
    ? items.filter((item) => changedFiles.has(item.file))
    : items;
  if (!targets.length) {
    return;
  }

  for (const item of targets) {
    try {
      const kinks = turf.kinks(item.feature).features.length;
      if (kinks) {
        report(item.file, `geometry has ${kinks} self-intersection(s)`);
      }
    } catch {
      report(item.file, "geometry could not be checked for self-intersections");
    }
  }

  const checked = new Set();
  for (const item of targets) {
    const area = turf.area(item.feature);
    for (const other of items) {
      if (other === item || !bboxesIntersect(item.bbox, other.bbox)) {
        continue;
      }
      const key = [item.file, other.file].sort().join("|");
      if (checked.has(key)) {
        continue;
      }
      checked.add(key);
      const overlap = overlapArea(item.feature, other.feature);
      const smaller = Math.min(area, turf.area(other.feature));
      if (overlap > OVERLAP_MIN_M2 && overlap > smaller * OVERLAP_MIN_FRACTION) {
        report(
          item.file,
          `overlaps ${other.name} by ${(overlap / 1e6).toFixed(2)} km² (${((overlap / smaller) * 100).toFixed(1)}%)`,
        );
      }
    }
  }
}

async function validateState(code, validators, changedFiles) {
  const loaded = await loadState(code);
  const stateFile = path.join(loaded.dir, "state.json");
  if (!loaded.state) {
    error(stateFile, "missing state.json");
    return;
  }
  schemaCheck(validators.state, stateFile, loaded.state);
  if (loaded.state.regionCode !== code) {
    error(stateFile, `regionCode ${loaded.state.regionCode} doesn't match folder ${code.toLowerCase()}`);
  }

  if (loaded.constituencies.length !== loaded.state.acCount) {
    error(
      stateFile,
      `found ${loaded.constituencies.length} constituency files but acCount is ${loaded.state.acCount}. If a constituency was added or removed on purpose, update acCount.`,
    );
  }

  const outlineFile = path.join(loaded.dir, "outline.geojson");
  let outlineBbox = null;
  if (loaded.outline) {
    await checkSize(outlineFile, LIMITS.outlineBytes);
    outlineBbox = computeBbox(loaded.outline.geometry);
  } else {
    warn(outlineFile, "state has no outline.geojson");
  }

  const seen = new Map();
  for (const { file, name, feature } of loaded.constituencies) {
    await checkSize(file, LIMITS.constituencyBytes);
    if (!schemaCheck(validators.constituency, file, feature)) {
      continue;
    }
    const { acNo, stateCode } = feature.properties;
    if (name !== `${acNo}.geojson`) {
      error(file, `file name must be ${acNo}.geojson (acNo is ${acNo})`);
    }
    if (stateCode !== code) {
      error(file, `stateCode ${stateCode} doesn't match folder ${code.toLowerCase()}`);
    }
    if (feature.id !== constituencyId(code, acNo)) {
      error(file, `id must be ${constituencyId(code, acNo)}`);
    }
    if (seen.has(acNo)) {
      error(file, `duplicate acNo ${acNo} (also in ${seen.get(acNo)})`);
    }
    seen.set(acNo, name);
    checkRingsAndRange(file, feature.geometry);
    if (outlineBbox && !bboxContains(outlineBbox, computeBbox(feature.geometry), OUTLINE_BBOX_TOLERANCE)) {
      error(file, "constituency extends outside the state outline");
    }
  }

  const districtsFile = path.join(loaded.dir, "districts.json");
  try {
    const expected = formatJson(
      deriveDistricts(code, loaded.constituencies.map(({ feature }) => feature)),
    );
    if ((await readFile(districtsFile, "utf8")) !== expected) {
      warn(districtsFile, "out of date; run `npm run build` to regenerate (or leave it, CI regenerates on publish)");
    }
  } catch {
    warn(districtsFile, "missing; run `npm run build`");
  }

  if (stateContentHash(loaded) !== loaded.state.contentHash) {
    console.log(`  ${code}: content changed (versions are bumped on publish)`);
  }

  if (GEOMETRY) {
    checkGeometry(loaded, changedFiles);
  }
}

function findForbiddenKeys(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) findForbiddenKeys(item, found);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_WARD_KEY_PATTERN.test(key)) found.add(key);
      if (key !== "coordinates") findForbiddenKeys(item, found);
    }
  }
  return found;
}

async function validateWards(validators) {
  for (const city of await listWardCities()) {
    let ulb;
    let wards;
    try {
      ulb = await readJson(city.ulbFile);
      wards = await readJson(city.wardsFile);
    } catch (cause) {
      error(city.dir, `needs ulb.json and wards.geojson (${cause.message})`);
      continue;
    }
    schemaCheck(validators.ulb, city.ulbFile, ulb);
    await checkSize(city.wardsFile, LIMITS.wardsBytes);

    for (const [file, value] of [[city.ulbFile, ulb], [city.wardsFile, wards]]) {
      const forbidden = findForbiddenKeys(value);
      if (forbidden.size) {
        error(file, `personal data is not allowed: ${[...forbidden].join(", ")}`);
      }
    }

    if (!schemaCheck(validators.ward, city.wardsFile, wards)) {
      continue;
    }
    if (wards.features.length !== ulb.wardCount) {
      error(city.ulbFile, `wardCount is ${ulb.wardCount} but wards.geojson has ${wards.features.length} wards`);
    }
    const numbers = new Set();
    for (const feature of wards.features) {
      const number = feature.properties.wardNumber;
      if (numbers.has(number)) {
        error(city.wardsFile, `duplicate wardNumber ${number}`);
      }
      numbers.add(number);
      checkRingsAndRange(city.wardsFile, feature.geometry);
    }
  }
}

async function main() {
  const validators = await loadValidators();
  await loadKnownIssues();
  const changedFiles = GEOMETRY && BASE_REF ? changedFilesSince(BASE_REF) : null;

  const meta = await loadMeta();
  schemaCheck(validators.meta, path.join(ROOT, "data/meta.json"), meta);
  const indiaOutline = await loadIndiaOutline();
  if (indiaOutlineHash(indiaOutline) !== meta.indiaOutline.contentHash) {
    console.log("  india-outline: content changed (version is bumped on publish)");
  }

  const codes = (await listStateCodes()).filter(
    (code) => !STATE_FILTER || STATE_FILTER.includes(code),
  );
  for (const code of codes) {
    await validateState(code, validators, changedFiles);
  }
  await validateWards(validators);

  if (!STATE_FILTER) {
    for (const key of knownIssues) {
      if (!matchedKnownIssues.has(key)) {
        warnings.push(`${key}: fixed? Remove it from data/known-issues.json`);
      }
    }
  }

  for (const message of warnings.slice(0, 50)) {
    console.warn(`warning: ${message}`);
  }
  if (warnings.length > 50) {
    console.warn(`... ${warnings.length - 50} more warnings`);
  }
  for (const message of errors) {
    console.error(`error: ${message}`);
  }
  console.log(
    `\nChecked ${codes.length} states/UTs${GEOMETRY ? " (with geometry checks)" : ""}: ${errors.length} error(s), ${warnings.length} warning(s)`,
  );
  if (errors.length) {
    process.exit(1);
  }
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});

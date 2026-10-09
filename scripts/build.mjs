/**
 * Build app-ready outputs from data/.
 *
 * Output:
 *   dist/cdn/geo/v2/           CDN layout the frontend reads (legacy property names)
 *     manifest.json, india-outline.geojson,
 *     {code}/index.json, {code}/outline.geojson, {code}/ac/{n}.geojson,
 *     {code}/collection.geojson (states with <= 3 constituencies)
 *   dist/backend/constituencies/{code}.geojson   backend point-lookup files
 *   dist/backend/wards/{file}.wards.geojson      backend ward files
 *
 * Also regenerates data/states/{code}/districts.json.
 *
 * Usage:
 *   npm run build          # report states whose content changed
 *   npm run build:bump     # also bump versions + content hashes in data/ (CI on publish)
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
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
import { compactJson, formatJson } from "./lib/format.mjs";
import { computeBbox, mergeBboxes } from "./lib/geo.mjs";
import { constituencyToLegacy, wardPropertiesToLegacy } from "./lib/legacy.mjs";
import {
  DIST_BACKEND_DIR,
  DIST_CDN_DIR,
  DIST_DIR,
  META_FILE,
} from "./lib/paths.mjs";

/** States with this many (or fewer) constituencies also get collection.geojson. */
const SMALL_REGION_MAX_ACS = 3;

const BUMP = process.argv.includes("--bump");

async function writeIfChanged(file, content) {
  try {
    if ((await readFile(file, "utf8")) === content) {
      return false;
    }
  } catch {
    // new file
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
  return true;
}

async function buildState(code) {
  const loaded = await loadState(code);
  if (!loaded.state) {
    throw new Error(`${code}: missing state.json`);
  }
  const { state } = loaded;

  const hash = stateContentHash(loaded);
  let changed = hash !== state.contentHash;
  if (changed && BUMP) {
    state.indexVersion += 1;
    state.manifestVersion += 1;
    state.contentHash = hash;
    await writeFile(path.join(loaded.dir, "state.json"), formatJson(state), "utf8");
  }

  const features = loaded.constituencies.map(({ feature }) => feature);
  await writeIfChanged(
    path.join(loaded.dir, "districts.json"),
    formatJson(deriveDistricts(code, features)),
  );

  const regionDir = path.join(DIST_CDN_DIR, code.toLowerCase());
  const constituencies = [];
  const bboxes = [];
  const legacyFeatures = [];

  for (const feature of features) {
    const bbox = computeBbox(feature.geometry);
    const legacy = constituencyToLegacy(feature);
    legacyFeatures.push(legacy);
    bboxes.push(bbox);
    constituencies.push({
      acNo: feature.properties.acNo,
      acName: feature.properties.acName,
      bbox,
    });
    await writeIfChanged(
      path.join(regionDir, "ac", `${feature.properties.acNo}.geojson`),
      compactJson(legacy),
    );
  }

  const bounds = mergeBboxes(bboxes);
  await writeIfChanged(
    path.join(regionDir, "index.json"),
    compactJson({
      regionCode: code,
      version: state.indexVersion,
      bounds,
      constituencies,
    }),
  );

  if (loaded.outline) {
    await writeIfChanged(path.join(regionDir, "outline.geojson"), compactJson(loaded.outline));
  }
  if (legacyFeatures.length <= SMALL_REGION_MAX_ACS) {
    await writeIfChanged(
      path.join(regionDir, "collection.geojson"),
      compactJson({ type: "FeatureCollection", features: legacyFeatures }),
    );
  }

  await writeIfChanged(
    path.join(DIST_BACKEND_DIR, "constituencies", `${code.toLowerCase()}.geojson`),
    compactJson({ type: "FeatureCollection", features: legacyFeatures }),
  );

  return {
    changed,
    region: {
      regionCode: code,
      bounds,
      constituencyCount: legacyFeatures.length,
      version: state.manifestVersion,
      hasOutline: Boolean(loaded.outline),
    },
  };
}

async function buildWards() {
  const cities = await listWardCities();
  for (const city of cities) {
    const ulb = await readJson(city.ulbFile);
    const wards = await readJson(city.wardsFile);
    const out = {
      type: "FeatureCollection",
      name: `${ulb.cityCode.toLowerCase()}_wards`,
      features: wards.features.map((feature) => ({
        type: "Feature",
        properties: wardPropertiesToLegacy(feature.properties),
        geometry: feature.geometry,
      })),
    };
    await writeIfChanged(
      path.join(DIST_BACKEND_DIR, "wards", ulb.backendFile),
      compactJson(out),
    );
  }
  return cities.length;
}

async function main() {
  await rm(DIST_DIR, { recursive: true, force: true });

  const meta = await loadMeta();
  const codes = await listStateCodes();
  const regions = [];
  const changedStates = [];

  for (const code of codes) {
    const { changed, region } = await buildState(code);
    regions.push(region);
    if (changed) {
      changedStates.push(code);
    }
  }

  const indiaOutline = await loadIndiaOutline();
  const indiaChanged = indiaOutlineHash(indiaOutline) !== meta.indiaOutline.contentHash;
  const anyChange = changedStates.length > 0 || indiaChanged;
  if (BUMP && anyChange) {
    meta.manifestVersion += 1;
    meta.generatedAt = new Date().toISOString();
    if (indiaChanged) {
      meta.indiaOutline.version += 1;
      meta.indiaOutline.contentHash = indiaOutlineHash(indiaOutline);
    }
    await writeFile(META_FILE, formatJson(meta), "utf8");
  }

  await writeIfChanged(path.join(DIST_CDN_DIR, "india-outline.geojson"), compactJson(indiaOutline));
  await writeIfChanged(
    path.join(DIST_CDN_DIR, "manifest.json"),
    `${JSON.stringify(
      {
        version: meta.manifestVersion,
        generatedAt: meta.generatedAt,
        indiaOutline: {
          version: meta.indiaOutline.version,
          bounds: computeBbox(indiaOutline.geometry),
        },
        regions,
      },
      null,
      2,
    )}\n`,
  );

  const wardCities = await buildWards();

  console.log(
    `Built ${regions.length} states/UTs, ${regions.reduce((sum, r) => sum + r.constituencyCount, 0)} constituencies, ${wardCities} ward cities -> dist/`,
  );
  if (anyChange) {
    const list = [...changedStates, ...(indiaChanged ? ["india-outline"] : [])].join(", ");
    console.log(
      BUMP
        ? `Bumped versions for: ${list} (manifest v${meta.manifestVersion})`
        : `Changed since last publish: ${list} (versions are bumped on publish)`,
    );
  } else {
    console.log("No content changes since last publish.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

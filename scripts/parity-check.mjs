/**
 * Compare dist/ (from `npm run build`) with what the backend serves today.
 *
 *   dist/cdn/geo/v2               vs {backend}/src/constituencies/data/regions/
 *   dist/backend/constituencies   vs {backend}/src/constituencies/data/{code}.geojson
 *   dist/backend/wards            vs {backend}/src/wards/data/*.wards.geojson
 *
 * Exits 1 on unexpected differences. Recomputed bboxes/bounds that differ
 * from stale values, and monolith features dropped by deduplication, are
 * reported but expected.
 *
 * Usage: npm run parity -- [--backend ../whistlingcitizen-BE]
 */
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readJson } from "./lib/data.mjs";
import { computeBbox, roundGeometry } from "./lib/geo.mjs";
import { backendNormalizeWard } from "./lib/legacy.mjs";
import { DIST_BACKEND_DIR, DIST_CDN_DIR, ROOT } from "./lib/paths.mjs";

const argIndex = process.argv.indexOf("--backend");
const BACKEND = path.resolve(
  ROOT,
  argIndex >= 0 ? process.argv[argIndex + 1] : "../whistlingcitizen-BE",
);
const REGIONS = path.join(BACKEND, "src/constituencies/data/regions");
const MONOLITHS = path.join(BACKEND, "src/constituencies/data");
const WARDS = path.join(BACKEND, "src/wards/data");

const unexpected = [];
const expected = [];
const stats = { identicalFiles: 0, comparedFiles: 0, droppedBbox: 0 };

const round5 = (values) => values.map((value) => Math.round(value * 1e5) / 1e5);

/** Legacy properties, treating "" and missing as the same. */
function cleanProps(properties = {}) {
  const out = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === "" || value == null) continue;
    out[key] = typeof value === "string" ? value.trim() : value;
  }
  return out;
}

function compareAcFeature(label, original, built) {
  stats.comparedFiles += 1;
  let same = true;
  if (!isDeepStrictEqual(cleanProps(original.properties), cleanProps(built.properties))) {
    unexpected.push(`${label}: properties differ`);
    same = false;
  }
  if (!isDeepStrictEqual(original.geometry, built.geometry)) {
    unexpected.push(`${label}: geometry differs`);
    same = false;
  }
  // Builds omit the optional feature `bbox` member; turf.bbox() recomputes it.
  if (original.bbox) stats.droppedBbox += 1;
  if (same) stats.identicalFiles += 1;
}

async function compareCdn() {
  const manifestA = await readJson(path.join(REGIONS, "manifest.json"));
  const manifestB = await readJson(path.join(DIST_CDN_DIR, "manifest.json"));
  if (manifestA.version !== manifestB.version) {
    unexpected.push(`manifest: version ${manifestA.version} vs ${manifestB.version}`);
  }
  if (!isDeepStrictEqual(manifestA.indiaOutline, manifestB.indiaOutline)) {
    unexpected.push("manifest: indiaOutline differs");
  }
  const regionsB = new Map(manifestB.regions.map((r) => [r.regionCode, r]));
  for (const regionA of manifestA.regions) {
    const regionB = regionsB.get(regionA.regionCode);
    if (!regionB) {
      unexpected.push(`manifest: ${regionA.regionCode} missing`);
      continue;
    }
    for (const key of ["constituencyCount", "version", "hasOutline"]) {
      if (regionA[key] !== regionB[key]) {
        unexpected.push(`manifest ${regionA.regionCode}: ${key} ${regionA[key]} vs ${regionB[key]}`);
      }
    }
    if (!isDeepStrictEqual(round5(regionA.bounds), round5(regionB.bounds))) {
      expected.push(`manifest ${regionA.regionCode}: bounds recomputed from geometry`);
    }
  }
  if (manifestA.regions.length !== manifestB.regions.length) {
    unexpected.push(`manifest: ${manifestA.regions.length} vs ${manifestB.regions.length} regions`);
  }

  const indiaA = await readJson(path.join(REGIONS, "india-outline.geojson"));
  const indiaB = await readJson(path.join(DIST_CDN_DIR, "india-outline.geojson"));
  if (!isDeepStrictEqual(indiaA, indiaB)) unexpected.push("india-outline differs");

  const codes = (await readdir(REGIONS, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^[a-z]{2}$/.test(entry.name))
    .map((entry) => entry.name);

  for (const code of codes) {
    const dirA = path.join(REGIONS, code);
    const dirB = path.join(DIST_CDN_DIR, code);

    const indexA = await readJson(path.join(dirA, "index.json"));
    const indexB = await readJson(path.join(dirB, "index.json"));
    if (indexA.regionCode !== indexB.regionCode || indexA.version !== indexB.version) {
      unexpected.push(`${code}/index.json: regionCode/version differ`);
    }
    if (!isDeepStrictEqual(round5(indexA.bounds), round5(indexB.bounds))) {
      expected.push(`${code}/index.json: bounds recomputed from geometry`);
    }
    const listB = new Map(indexB.constituencies.map((c) => [c.acNo, c]));
    for (const entryA of indexA.constituencies) {
      const entryB = listB.get(entryA.acNo);
      if (!entryB || entryA.acName !== entryB.acName) {
        unexpected.push(`${code}/index.json: AC ${entryA.acNo} missing or renamed`);
      } else if (!isDeepStrictEqual(round5(entryA.bbox), round5(entryB.bbox))) {
        expected.push(`${code}/index.json: AC ${entryA.acNo} bbox recomputed from geometry`);
      }
    }
    if (indexA.constituencies.length !== indexB.constituencies.length) {
      unexpected.push(`${code}/index.json: constituency count differs`);
    }

    for (const file of ["outline.geojson"]) {
      const a = path.join(dirA, file);
      const b = path.join(dirB, file);
      if (existsSync(a) !== existsSync(b)) {
        unexpected.push(`${code}/${file}: present in only one side`);
      } else if (existsSync(a) && !isDeepStrictEqual(await readJson(a), await readJson(b))) {
        unexpected.push(`${code}/${file}: differs`);
      }
    }

    const collectionA = path.join(dirA, "collection.geojson");
    const collectionB = path.join(dirB, "collection.geojson");
    if (existsSync(collectionA) !== existsSync(collectionB)) {
      unexpected.push(`${code}/collection.geojson: present in only one side`);
    } else if (existsSync(collectionA)) {
      const a = await readJson(collectionA);
      const b = await readJson(collectionB);
      a.features.forEach((feature, i) =>
        compareAcFeature(`${code}/collection.geojson[${i}]`, feature, b.features[i] || {}),
      );
    }

    const acA = (await readdir(path.join(dirA, "ac"))).filter((n) => n.endsWith(".geojson"));
    const acB = new Set((await readdir(path.join(dirB, "ac"))).filter((n) => n.endsWith(".geojson")));
    for (const name of acA) {
      if (!acB.has(name)) {
        unexpected.push(`${code}/ac/${name}: missing from build`);
        continue;
      }
      acB.delete(name);
      compareAcFeature(
        `${code}/ac/${name}`,
        await readJson(path.join(dirA, "ac", name)),
        await readJson(path.join(dirB, "ac", name)),
      );
    }
    for (const name of acB) unexpected.push(`${code}/ac/${name}: only in build`);
  }
}

async function compareMonoliths() {
  const dir = path.join(DIST_BACKEND_DIR, "constituencies");
  for (const name of (await readdir(dir)).sort()) {
    const sourcePath = path.join(MONOLITHS, name);
    if (!existsSync(sourcePath)) {
      expected.push(`backend ${name}: new file (backend has no monolith for it)`);
      continue;
    }
    const mono = await readJson(sourcePath);
    const built = await readJson(path.join(dir, name));
    const builtByAc = new Map(built.features.map((f) => [f.properties.AC_NO, f]));

    const monoByAc = new Map();
    for (const feature of mono.features) {
      const props = feature.properties || {};
      const acNo = Math.trunc(Number(props.AC_NO ?? props.ac_no));
      if (!monoByAc.has(acNo)) monoByAc.set(acNo, []);
      monoByAc.get(acNo).push(feature);
    }

    let extraFeatures = 0;
    let geometryChanged = 0;
    let renamed = 0;
    for (const [acNo, features] of monoByAc) {
      const builtFeature = builtByAc.get(acNo);
      if (!builtFeature) {
        extraFeatures += features.length;
        continue;
      }
      extraFeatures += features.length - 1;
      const sameGeometry = features.some((feature) =>
        isDeepStrictEqual(roundGeometry(feature.geometry), builtFeature.geometry),
      );
      if (!sameGeometry) geometryChanged += 1;
      const names = features.map((f) => String(f.properties.AC_NAME ?? f.properties.ac_name ?? "").trim());
      if (!names.includes(builtFeature.properties.AC_NAME)) renamed += 1;
    }
    const missing = [...builtByAc.keys()].filter((acNo) => !monoByAc.has(acNo));

    const parts = [];
    if (extraFeatures) parts.push(`${extraFeatures} duplicate/invalid features dropped`);
    if (geometryChanged) parts.push(`${geometryChanged} constituencies have edited geometry in regions/`);
    if (renamed) parts.push(`${renamed} names differ from monolith`);
    if (missing.length) parts.push(`${missing.length} constituencies not in monolith`);
    if (parts.length) {
      expected.push(`backend ${name}: ${parts.join("; ")} (lookups will now match the map)`);
    }
  }
}

async function compareWards() {
  const dir = path.join(DIST_BACKEND_DIR, "wards");
  for (const name of (await readdir(dir)).sort()) {
    const original = await readJson(path.join(WARDS, name));
    const built = await readJson(path.join(dir, name));
    if (original.features.length !== built.features.length) {
      unexpected.push(`wards ${name}: ${original.features.length} vs ${built.features.length} features`);
      continue;
    }
    let differences = 0;
    original.features.forEach((feature, i) => {
      const other = built.features[i];
      if (
        !isDeepStrictEqual(backendNormalizeWard(feature.properties || {}), backendNormalizeWard(other.properties)) ||
        !isDeepStrictEqual(feature.geometry, other.geometry)
      ) {
        differences += 1;
      }
    });
    if (differences) {
      unexpected.push(`wards ${name}: ${differences} wards differ as the backend reads them`);
    }
  }
}

async function main() {
  if (!existsSync(path.join(DIST_CDN_DIR, "manifest.json"))) {
    throw new Error("Run `npm run build` first.");
  }
  await compareCdn();
  await compareMonoliths();
  await compareWards();

  console.log(`Constituency features compared: ${stats.comparedFiles}, identical: ${stats.identicalFiles}`);
  if (stats.droppedBbox) {
    console.log(`Optional feature bbox member omitted in ${stats.droppedBbox} files (recomputed by turf).`);
  }
  if (expected.length) {
    console.log(`\nExpected differences (${expected.length}):`);
    for (const line of expected) console.log(`  ${line}`);
  }
  if (unexpected.length) {
    console.log(`\nUNEXPECTED differences (${unexpected.length}):`);
    for (const line of unexpected.slice(0, 100)) console.log(`  ${line}`);
    process.exit(1);
  }
  console.log(
    "\nParity OK: CDN output matches regions/, ward files match as the backend reads them. Backend lookup files will follow the map data (see expected differences).",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

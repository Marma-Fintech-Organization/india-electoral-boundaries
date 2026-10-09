/**
 * One-time import from the Whistling Citizen backend into data/.
 *
 * Reads:
 *   {backend}/src/constituencies/data/regions/   (what the app serves today)
 *   {backend}/src/wards/data/*.wards.geojson
 *
 * Writes the normalized source tree under data/. Ward personal data
 * (councillor phones, emails, addresses, ...) is dropped.
 *
 * Usage:
 *   npm run import:backend -- [--backend ../whistlingcitizen-BE] [--force]
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  deriveDistricts,
  indiaOutlineHash,
  loadState,
  readJson,
  stateContentHash,
} from "./lib/data.mjs";
import { formatJson } from "./lib/format.mjs";
import { constituencyFromLegacy, wardPropertiesFromRaw } from "./lib/legacy.mjs";
import {
  DATA_DIR,
  INDIA_OUTLINE_FILE,
  META_FILE,
  ROOT,
  STATES_DIR,
  WARDS_DIR,
  stateDir,
} from "./lib/paths.mjs";
import { STATE_NAMES } from "./lib/states.mjs";

const DEFAULTS = { quality: "unverified", sources: ["TBD"] };

const WARD_CITIES = [
  {
    cityCode: "CHENNAI",
    stateCode: "TN",
    folder: "tn/chennai",
    name: "Chennai",
    corporation: "Greater Chennai Corporation",
    backendFile: "chennai.wards.geojson",
  },
  {
    cityCode: "COIMBATORE",
    stateCode: "TN",
    folder: "tn/coimbatore",
    name: "Coimbatore",
    corporation: "Coimbatore City Municipal Corporation",
    backendFile: "coimbatore.wards.geojson",
  },
  {
    cityCode: "BBMP",
    stateCode: "KA",
    folder: "ka/bengaluru",
    name: "Bengaluru",
    corporation: "Bruhat Bengaluru Mahanagara Palike (BBMP)",
    backendFile: "ka.wards.geojson",
    delimitation: "369 wards across 5 corporations",
  },
];

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function importStates(regionsDir) {
  const manifest = await readJson(path.join(regionsDir, "manifest.json"));
  const manifestRegions = new Map(
    manifest.regions.map((region) => [region.regionCode.toUpperCase(), region]),
  );

  const codes = (await readdir(regionsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^[a-z]{2}$/.test(entry.name))
    .map((entry) => entry.name.toUpperCase())
    .sort();

  let total = 0;
  for (const code of codes) {
    const srcDir = path.join(regionsDir, code.toLowerCase());
    const index = await readJson(path.join(srcDir, "index.json"));
    const manifestRegion = manifestRegions.get(code);
    if (!manifestRegion) {
      throw new Error(`${code}: missing from manifest.json`);
    }

    const outDir = stateDir(code);
    const acOut = path.join(outDir, "ac");
    await mkdir(acOut, { recursive: true });

    const acNames = (await readdir(path.join(srcDir, "ac"))).filter((name) =>
      name.endsWith(".geojson"),
    );
    for (const name of acNames) {
      const legacy = await readJson(path.join(srcDir, "ac", name));
      const feature = constituencyFromLegacy(legacy, code, DEFAULTS);
      if (`${feature.properties.acNo}.geojson` !== name) {
        throw new Error(`${code}/${name}: AC_NO ${feature.properties.acNo} doesn't match file name`);
      }
      await writeFile(path.join(acOut, name), formatJson(feature), "utf8");
    }

    const outlinePath = path.join(srcDir, "outline.geojson");
    if (existsSync(outlinePath)) {
      await writeFile(
        path.join(outDir, "outline.geojson"),
        formatJson(await readJson(outlinePath)),
        "utf8",
      );
    }

    const loaded = await loadState(code);
    const state = {
      regionCode: code,
      name: STATE_NAMES[code] || code,
      acCount: acNames.length,
      indexVersion: index.version,
      manifestVersion: manifestRegion.version,
      contentHash: stateContentHash(loaded),
    };
    await writeFile(path.join(outDir, "state.json"), formatJson(state), "utf8");
    await writeFile(
      path.join(outDir, "districts.json"),
      formatJson(
        deriveDistricts(
          code,
          loaded.constituencies.map(({ feature }) => feature),
        ),
      ),
      "utf8",
    );

    total += acNames.length;
    console.log(`${code}: ${acNames.length} constituencies`);
  }

  const indiaOutline = await readJson(path.join(regionsDir, "india-outline.geojson"));
  await writeFile(INDIA_OUTLINE_FILE, formatJson(indiaOutline), "utf8");
  await writeFile(
    META_FILE,
    formatJson({
      manifestVersion: manifest.version,
      generatedAt: manifest.generatedAt ?? new Date().toISOString(),
      indiaOutline: {
        version: manifest.indiaOutline?.version ?? 1,
        contentHash: indiaOutlineHash(await readJson(INDIA_OUTLINE_FILE)),
      },
    }),
    "utf8",
  );

  console.log(`\nImported ${codes.length} states/UTs, ${total} constituencies`);
}

async function importWards(wardsDataDir) {
  for (const city of WARD_CITIES) {
    const source = await readJson(path.join(wardsDataDir, city.backendFile));
    const features = source.features.map((feature) => ({
      type: "Feature",
      properties: wardPropertiesFromRaw(feature.properties || {}),
      geometry: feature.geometry,
    }));
    const missingNumber = features.filter((f) => f.properties.wardNumber == null);
    if (missingNumber.length) {
      throw new Error(`${city.cityCode}: ${missingNumber.length} wards without a ward number`);
    }

    const outDir = path.join(WARDS_DIR, city.folder);
    await mkdir(outDir, { recursive: true });
    const ulb = {
      cityCode: city.cityCode,
      name: city.name,
      corporation: city.corporation,
      stateCode: city.stateCode,
      backendFile: city.backendFile,
      wardCount: features.length,
      ...(city.delimitation ? { delimitation: city.delimitation } : {}),
      sources: [...DEFAULTS.sources],
    };
    await writeFile(path.join(outDir, "ulb.json"), formatJson(ulb), "utf8");
    await writeFile(
      path.join(outDir, "wards.geojson"),
      formatJson({ type: "FeatureCollection", features }),
      "utf8",
    );
    console.log(`${city.cityCode}: ${features.length} wards -> data/wards/${city.folder}/`);
  }
}

async function main() {
  const backend = path.resolve(ROOT, argValue("--backend", "../whistlingcitizen-BE"));
  const regionsDir = path.join(backend, "src/constituencies/data/regions");
  const wardsDataDir = path.join(backend, "src/wards/data");
  if (!existsSync(path.join(regionsDir, "manifest.json"))) {
    throw new Error(`Backend regions not found at ${regionsDir}`);
  }

  if (existsSync(STATES_DIR) || existsSync(WARDS_DIR)) {
    if (!process.argv.includes("--force")) {
      throw new Error("data/ already has states or wards. Re-run with --force to overwrite.");
    }
    await rm(STATES_DIR, { recursive: true, force: true });
    await rm(WARDS_DIR, { recursive: true, force: true });
  }
  await mkdir(DATA_DIR, { recursive: true });

  await importStates(regionsDir);
  await importWards(wardsDataDir);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

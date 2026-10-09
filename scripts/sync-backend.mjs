/**
 * Copy build output into a whistlingcitizen-BE checkout:
 *   dist/backend/constituencies/*.geojson -> src/constituencies/data/
 *   dist/backend/wards/*                  -> src/wards/data/
 *   dist/cdn/geo/v2/**                    -> src/constituencies/data/regions/
 *
 * Only changed files are written; nothing in the backend is deleted.
 *
 * Usage:
 *   npm run build
 *   npm run sync:backend -- [--backend ../whistlingcitizen-BE] [--dry-run]
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { DIST_BACKEND_DIR, DIST_CDN_DIR, ROOT } from "./lib/paths.mjs";

dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const backendArg = args.indexOf("--backend");
const BACKEND_DIR = path.resolve(
  ROOT,
  backendArg >= 0
    ? args[backendArg + 1]
    : process.env.BACKEND_REPO_DIR || "../whistlingcitizen-BE",
);

const TARGETS = [
  {
    from: path.join(DIST_BACKEND_DIR, "constituencies"),
    to: path.join(BACKEND_DIR, "src/constituencies/data"),
  },
  {
    from: path.join(DIST_BACKEND_DIR, "wards"),
    to: path.join(BACKEND_DIR, "src/wards/data"),
  },
  {
    from: DIST_CDN_DIR,
    to: path.join(BACKEND_DIR, "src/constituencies/data/regions"),
  },
];

async function walkFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkFiles(full)));
    else if (entry.name !== ".DS_Store") out.push(full);
  }
  return out;
}

async function main() {
  if (!existsSync(path.join(BACKEND_DIR, "package.json"))) {
    throw new Error(
      `Backend repo not found at ${BACKEND_DIR}. Pass --backend <dir> or set BACKEND_REPO_DIR.`,
    );
  }
  for (const { from } of TARGETS) {
    if (!existsSync(from)) {
      throw new Error(`${path.relative(ROOT, from)} not found. Run \`npm run build\` first.`);
    }
  }

  let written = 0;
  let unchanged = 0;
  for (const { from, to } of TARGETS) {
    for (const file of await walkFiles(from)) {
      const dest = path.join(to, path.relative(from, file));
      const body = await readFile(file);
      if (existsSync(dest) && body.equals(await readFile(dest))) {
        unchanged += 1;
        continue;
      }
      console.log(
        `${existsSync(dest) ? "update" : "new   "} ${path.relative(BACKEND_DIR, dest)}`,
      );
      if (!DRY_RUN) {
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, body);
      }
      written += 1;
    }
  }

  console.log(
    `\n${DRY_RUN ? "[dry-run] Would write" : "Wrote"} ${written} files into ${BACKEND_DIR} (${unchanged} unchanged).`,
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

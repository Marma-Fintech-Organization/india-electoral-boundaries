import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, "../..");
export const DATA_DIR = path.join(ROOT, "data");
export const STATES_DIR = path.join(DATA_DIR, "states");
export const WARDS_DIR = path.join(DATA_DIR, "wards");
export const SCHEMA_DIR = path.join(ROOT, "schema");
export const DIST_DIR = path.join(ROOT, "dist");
export const DIST_CDN_DIR = path.join(DIST_DIR, "cdn", "geo", "v2");
export const DIST_BACKEND_DIR = path.join(DIST_DIR, "backend");
export const META_FILE = path.join(DATA_DIR, "meta.json");
export const INDIA_OUTLINE_FILE = path.join(DATA_DIR, "india-outline.geojson");

export function stateDir(code) {
  return path.join(STATES_DIR, code.toLowerCase());
}

export function acFile(code, acNo) {
  return path.join(stateDir(code), "ac", `${acNo}.geojson`);
}

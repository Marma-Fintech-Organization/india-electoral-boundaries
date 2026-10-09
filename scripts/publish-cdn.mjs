/**
 * Upload dist/cdn/geo/v2 to Cloudflare R2, skipping files whose MD5 already
 * matches the object's ETag. manifest.json is uploaded last so clients never
 * see a new version before its files exist.
 *
 * Usage:
 *   npm run build:bump
 *   npm run publish:cdn:dry   # show what would change
 *   npm run publish:cdn
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import { DIST_CDN_DIR, ROOT } from "./lib/paths.mjs";

dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

const DRY_RUN = process.argv.includes("--dry-run");
const KEY_PREFIX = (process.env.GEO_R2_PREFIX || "geo/v2").replace(/\/$/, "");
const CONCURRENCY = Number(process.env.GEO_UPLOAD_CONCURRENCY || 16);
const CACHE_CONTROL = "public, max-age=300, must-revalidate";
// The app never requests collection.geojson; only the backend reads it.
const SKIP_FILES = new Set(["collection.geojson", ".DS_Store"]);

const env = {
  accountId: process.env.R2_ACCOUNT_ID,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.GEO_R2_BUCKET_NAME,
};
const publicUrl = (process.env.GEO_R2_PUBLIC_URL || "")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

async function walkFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(full)));
    } else if (
      !SKIP_FILES.has(entry.name) &&
      /\.(json|geojson)$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

async function mapPool(items, concurrency, worker) {
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      await worker(items[current]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, run),
  );
}

async function listRemoteEtags(client) {
  const etags = new Map();
  let ContinuationToken;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: env.bucket,
        Prefix: `${KEY_PREFIX}/`,
        ContinuationToken,
      }),
    );
    for (const object of page.Contents ?? []) {
      etags.set(object.Key, (object.ETag ?? "").replaceAll('"', ""));
    }
    ContinuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
  } while (ContinuationToken);
  return etags;
}

async function main() {
  if (!existsSync(DIST_CDN_DIR)) {
    throw new Error("dist/cdn/geo/v2 not found. Run `npm run build` first.");
  }

  const files = (await walkFiles(DIST_CDN_DIR)).sort();
  const items = await Promise.all(
    files.map(async (file) => {
      const body = await readFile(file);
      const rel = path.relative(DIST_CDN_DIR, file).split(path.sep).join("/");
      return {
        key: `${KEY_PREFIX}/${rel}`,
        body,
        md5: createHash("md5").update(body).digest("hex"),
        contentType: file.endsWith(".geojson")
          ? "application/geo+json"
          : "application/json",
      };
    }),
  );

  const missing = Object.entries(env)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) {
    if (!DRY_RUN) {
      throw new Error(
        `Missing R2 settings: ${missing.join(", ")}. See .env.example.`,
      );
    }
    console.log(
      `[dry-run] No R2 credentials (${missing.join(", ")}); cannot compare with the bucket.`,
    );
    console.log(`[dry-run] ${items.length} files would be uploaded under ${KEY_PREFIX}/`);
    return;
  }

  const client = new S3Client({
    region: process.env.R2_REGION || "auto",
    endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  try {
    const remote = await listRemoteEtags(client);
    const changed = items.filter((item) => remote.get(item.key) !== item.md5);
    const localKeys = new Set(items.map((item) => item.key));
    const stale = [...remote.keys()].filter(
      (key) => !localKeys.has(key) && !key.endsWith("/collection.geojson"),
    );

    console.log(
      `${DRY_RUN ? "[dry-run] " : ""}${items.length} files, ${changed.length} changed, ${items.length - changed.length} unchanged.`,
    );
    for (const item of changed.slice(0, 50)) {
      console.log(`  ${remote.has(item.key) ? "update" : "new   "} ${item.key}`);
    }
    if (changed.length > 50) {
      console.log(`  ... and ${changed.length - 50} more`);
    }
    if (stale.length) {
      console.log(
        `\n${stale.length} objects in the bucket are no longer built (not deleted):`,
      );
      for (const key of stale.slice(0, 20)) console.log(`  ${key}`);
    }
    if (DRY_RUN || !changed.length) {
      return;
    }

    const manifestKey = `${KEY_PREFIX}/manifest.json`;
    const put = (item) =>
      client.send(
        new PutObjectCommand({
          Bucket: env.bucket,
          Key: item.key,
          Body: item.body,
          ContentType: item.contentType,
          CacheControl: CACHE_CONTROL,
        }),
      );

    let uploaded = 0;
    const failed = [];
    await mapPool(
      changed.filter((item) => item.key !== manifestKey),
      CONCURRENCY,
      async (item) => {
        try {
          await put(item);
          uploaded += 1;
          if (uploaded % 100 === 0) console.log(`Uploaded ${uploaded}/${changed.length}`);
        } catch (error) {
          failed.push(item.key);
          console.error(`Failed ${item.key}: ${error?.message || error}`);
        }
      },
    );

    if (failed.length) {
      throw new Error(
        `${failed.length} uploads failed; manifest.json was not updated. Re-run to retry.`,
      );
    }

    const manifest = changed.find((item) => item.key === manifestKey);
    if (manifest) {
      await put(manifest);
      uploaded += 1;
    }

    console.log(`\nDone. Uploaded ${uploaded} files.`);
    if (publicUrl) console.log(`Public base: https://${publicUrl}/${KEY_PREFIX}/`);
  } finally {
    client.destroy();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

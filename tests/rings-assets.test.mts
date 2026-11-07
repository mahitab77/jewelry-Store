import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

type Asset = { id: string; production_path: string; width: number; height: number; has_transparency: boolean; source_bytes: number; webp_bytes: number; source_file_sha256: string; production_sha256: string; category: string; source_requires_product_verification: boolean };
const root = fileURLToPath(new URL("../", import.meta.url));

test("all twenty supplied Rings derivatives retain their manifest bytes, dimensions and transparency without duplicates", async () => {
  const manifest = JSON.parse(await readFile(resolve(root, "rings-production-kit/rings-assets-manifest.json"), "utf8")) as { source_count: number; origin_archive: string; assets: Asset[] };
  assert.equal(manifest.origin_archive, "rings1.zip"); assert.equal(manifest.source_count, 20); assert.equal(manifest.assets.length, 20);
  assert.deepEqual(manifest.assets.map(asset => asset.id).sort(), Array.from({ length: 20 }, (_, index) => `R${String(index + 1).padStart(2, "0")}`));
  assert.equal(manifest.assets.filter(asset => asset.category === "editorial").length, 13); assert.equal(manifest.assets.filter(asset => asset.category === "sets").length, 7);
  const verified = await Promise.all(manifest.assets.map(async asset => {
    const path = resolve(root, asset.production_path);
    assert.ok(path.startsWith(resolve(root, "public/images/rings") + sep), `${asset.id} must remain inside its supplied asset directory.`);
    const bytes = await readFile(path), metadata = await sharp(bytes).metadata();
    const digest = createHash("sha256").update(bytes).digest("hex");
    assert.equal(digest, asset.production_sha256, `${asset.id} must be the supplied production image.`);
    assert.equal(bytes.byteLength, asset.webp_bytes, `${asset.id} bytes`); assert.ok(asset.webp_bytes < asset.source_bytes);
    assert.equal(metadata.format, "webp"); assert.equal(metadata.width, asset.width); assert.equal(metadata.height, asset.height); assert.equal(Boolean(metadata.hasAlpha), asset.has_transparency, `${asset.id} transparency`);
    assert.equal(asset.source_requires_product_verification, true);
    return { path: asset.production_path.replaceAll("\\", "/"), digest };
  }));
  assert.equal(new Set(verified.map(asset => asset.digest)).size, 20, "Production images must not be duplicate copies.");
  assert.equal(new Set(manifest.assets.map(asset => asset.source_file_sha256)).size, 20);
  const disk = (await readdir(resolve(root, "public/images/rings"), { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).map(entry => {
    const parent = entry.parentPath;
    return resolve(parent, entry.name).slice(resolve(root).length + 1).replaceAll("\\", "/");
  }).sort();
  assert.deepEqual(disk, verified.map(asset => asset.path).sort(), "All supplied derivatives must be present once, without unlisted copies.");
});

test("Rings uses the existing category route without a separate rings page", async () => {
  const paths = (await readdir(resolve(root, "src/app"), { recursive: true })).map(path => path.replaceAll("\\", "/").split("/").filter(part => !/^\([^/]+\)$/.test(part)).join("/"));
  assert.ok(paths.includes("collections/[category]/page.tsx"));
  assert.equal(paths.some(path => /^(?:new\/)?rings\/(?:page|route)\.[cm]?[jt]sx?$/.test(path)), false);
});

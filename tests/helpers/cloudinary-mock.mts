import { createHash } from "node:crypto";
import sharp from "sharp";
import type { CloudinaryConfiguration, ProviderAsset } from "../../src/lib/media/cloudinary.ts";

export const mockCloudinaryConfiguration: CloudinaryConfiguration = { cloudName: "lapalme-fixture", apiKey: "123456789012345", apiSecret: "fixture-only-cloudinary-secret-no-live-account" };
function expectedDelivery(asset: ProviderAsset) {
  // Independent provider expectation, checked against retained official-SDK vectors.
  const source = asset.publicId + "." + asset.format;
  const digest = createHash("sha256").update(source + mockCloudinaryConfiguration.apiSecret).digest("base64").slice(0, 8).replace(/\//g, "_").replace(/\+/g, "-");
  return `https://res.cloudinary.com/${mockCloudinaryConfiguration.cloudName}/image/authenticated/s--${digest}--/v${asset.version}/${source}`;
}
export function cloudinaryMock() {
  const assets = new Map<string, { asset: ProviderAsset; bytes: Uint8Array }>();
  const calls: { operation: string; publicId: string }[] = [];
  const failures = { upload: false, afterUpload: false, destroy: false, forged: false };
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "res.cloudinary.com") {
      const asset = [...assets.values()].find((entry) => expectedDelivery(entry.asset) === url.href);
      return asset ? new Response(new Uint8Array(asset.bytes), { headers: { "Content-Type": asset.asset.format === "jpg" ? "image/jpeg" : `image/${asset.asset.format}` } }) : new Response(null, { status: 404 });
    }
    const apiPath = `/v1_1/${mockCloudinaryConfiguration.cloudName}/image/`;
    if (url.hostname !== "api.cloudinary.com" || url.search || ![apiPath + "upload", apiPath + "destroy"].includes(url.pathname)) throw new Error("Only the upload and deletion API endpoints are permitted in this mock.");
    const request = new Request(url, init);
    if (request.method !== "POST") throw new Error("Provider mutations must use POST.");
    const authorization = "Basic " + Buffer.from(`${mockCloudinaryConfiguration.apiKey}:${mockCloudinaryConfiguration.apiSecret}`).toString("base64");
    if (request.headers.get("Authorization") !== authorization) return new Response(null, { status: 401 });
    if (url.pathname.endsWith("/destroy")) {
      const form = await request.formData(), publicId = String(form.get("public_id"));
      if ([...form.keys()].some((key) => !["public_id", "type", "invalidate"].includes(key)) ||
        ["public_id", "type", "invalidate"].some((key) => form.getAll(key).length !== 1) ||
        form.get("type") !== "authenticated" || form.get("invalidate") !== "true") throw new Error("Deletion must target authenticated assets and invalidate cached copies.");
      calls.push({ operation: "destroy", publicId });
      if (failures.destroy) return new Response(null, { status: 503 });
      const found = assets.delete(publicId);
      return Response.json({ result: found ? "ok" : "not found" });
    }
    const form = await request.formData(), file = form.get("file");
    if ([...form.keys()].some((key) => !["file", "public_id", "overwrite", "unique_filename", "asset_folder", "type"].includes(key)) ||
      ["file", "public_id", "overwrite", "unique_filename", "asset_folder", "type"].some((key) => form.getAll(key).length !== 1) ||
      form.get("type") !== "authenticated" ||
      form.get("asset_folder") !== "la-palme/catalogue" ||
      !/^la-palme\/catalogue\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(String(form.get("public_id"))) ||
      form.get("overwrite") !== "false" || form.get("unique_filename") !== "false") throw new Error("Uploads must use the exact asset folder and preserve the server-owned identifier without overwriting assets.");
    calls.push({ operation: "upload", publicId: "pending" });
    if (failures.upload) return new Response(null, { status: 503 });
    if (!(file instanceof File)) throw new Error("Expected server-supplied bytes, not a remote URL.");
    const bytes = new Uint8Array(await file.arrayBuffer()), metadata = await sharp(bytes).metadata(), publicId = String(form.get("public_id"));
    const format = metadata.format === "jpeg" ? "jpg" : metadata.format as "png" | "webp";
    const asset: ProviderAsset = { publicId, assetId: createHash("sha256").update(publicId).digest("hex"), version: "1", format, width: metadata.width!, height: metadata.height!, bytes: bytes.byteLength };
    assets.set(publicId, { asset, bytes }); calls[calls.length - 1].publicId = publicId;
    if (failures.afterUpload) throw new Error("Simulated lost provider response after upload.");
    return Response.json({ public_id: publicId, asset_id: asset.assetId, version: 1, format, width: asset.width, height: asset.height, bytes: bytes.byteLength,
      resource_type: "image", type: "authenticated", asset_folder: String(form.get("asset_folder")), signature: failures.forged ? "0".repeat(40) : createHash("sha1").update(`public_id=${publicId}&version=1${mockCloudinaryConfiguration.apiSecret}`).digest("hex") });
  };
  return { assets, calls, failures, fakeFetch };
}

// Test-only preload, never imported by application code and never environment
// selectable through a public endpoint. Used by local HTTPS browser fixtures.
if (process.env.CATALOGUE_BROWSER_PRELOAD === "1") {
  const mock = cloudinaryMock(), original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return ["api.cloudinary.com", "res.cloudinary.com"].includes(url.hostname) ? mock.fakeFetch(input, init) : original(input, init);
  };
}

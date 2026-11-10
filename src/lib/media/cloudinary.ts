import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import { CatalogueAdminError } from "../admin/catalogue/validation.ts";

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const mediaNamespace = "la-palme/catalogue";
export interface Photo { bytes: Uint8Array; format: "jpg" | "png" | "webp"; width: number; height: number }
export interface ProviderAsset { publicId: string; assetId: string; version: string; format: Photo["format"]; width: number; height: number; bytes: number }
export interface MediaProvider {
  upload(publicId: string, photo: Photo): Promise<ProviderAsset>;
  destroy(publicId: string): Promise<void>;
  read(asset: ProviderAsset): Promise<{ bytes: Uint8Array; contentType: string }>;
}
export interface CloudinaryConfiguration { cloudName: string; apiKey: string; apiSecret: string }
export function cloudinaryConfiguration(env = process.env): CloudinaryConfiguration {
  const cloudName = env.CLOUDINARY_CLOUD_NAME ?? "", apiKey = env.CLOUDINARY_API_KEY ?? "", apiSecret = env.CLOUDINARY_API_SECRET ?? "";
  if (!/^[a-z0-9][a-z0-9_-]{1,60}$/.test(cloudName) || !/^[0-9]{6,30}$/.test(apiKey) || apiSecret.length < 20 || apiSecret.length > 128 || /YOUR|PLACEHOLDER/.test(apiSecret)) {
    throw new CatalogueAdminError("Cloudinary photography uploads are not configured. Existing product records remain available.", 503);
  }
  return { cloudName, apiKey, apiSecret };
}
export function cloudinaryConfigured() { try { cloudinaryConfiguration(); return true; } catch { return false; } }
export function validPublicId(value: string) {
  return /^la-palme\/catalogue\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(value);
}
export async function preparePhoto(bytes: Uint8Array, mime: string): Promise<Photo> {
  if (!bytes.byteLength || bytes.byteLength > MAX_PHOTO_BYTES || !["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new CatalogueAdminError("Use a JPEG, PNG or WebP photograph no larger than 5 MiB.");
  try {
    const image = sharp(bytes, { limitInputPixels: 20000000, failOn: "warning" });
    const metadata = await image.metadata();
    const format = metadata.format === "jpeg" ? "jpg" : metadata.format;
    if (!["jpg", "png", "webp"].includes(format ?? "") || (metadata.pages ?? 1) !== 1 ||
      mime !== { jpg: "image/jpeg", png: "image/png", webp: "image/webp" }[format as Photo["format"]]) throw new Error();
    // Decode completely, correct orientation, and omit EXIF/GPS metadata.
    const output = await image.rotate().toBuffer({ resolveWithObject: true });
    if (output.info.width < 200 || output.info.height < 200 || output.info.width > 6000 || output.info.height > 6000 || output.data.byteLength > MAX_PHOTO_BYTES) throw new Error();
    return { bytes: new Uint8Array(output.data), format: format as Photo["format"], width: output.info.width, height: output.info.height };
  } catch { throw new CatalogueAdminError("The photograph is invalid, animated, or outside the 200–6000 pixel / 20 megapixel limit."); }
}
export function deliveryUrl(config: CloudinaryConfiguration, asset: ProviderAsset) {
  if (!validPublicId(asset.publicId) || !/^[1-9][0-9]{0,15}$/.test(asset.version) || !["jpg", "png", "webp"].includes(asset.format)) throw new CatalogueAdminError("Invalid stored image metadata.", 503);
  const source = `${asset.publicId}.${asset.format}`;
  // Cloudinary signs the source; the URL's version is added separately.
  const signature = createHash("sha256").update(source + config.apiSecret).digest("base64url").slice(0, 8);
  return `https://res.cloudinary.com/${config.cloudName}/image/authenticated/s--${signature}--/v${asset.version}/${source}`;
}
export function cloudinaryProvider(config = cloudinaryConfiguration(), fetcher: typeof fetch = fetch): MediaProvider {
  const api = `https://api.cloudinary.com/v1_1/${config.cloudName}/image`;
  const authorization = "Basic " + Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString("base64");
  async function call(endpoint: string, form: FormData | URLSearchParams) {
    try {
      const response = await fetcher(`${api}/${endpoint}`, { method: "POST", headers: { Authorization: authorization }, body: form, redirect: "error", signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error();
      return await response.json() as Record<string, unknown>;
    } catch { throw new CatalogueAdminError("Cloudinary did not complete the operation. A private cleanup record has been retained where needed.", 502); }
  }
  return {
    async upload(publicId, photo) {
      if (!validPublicId(publicId)) throw new CatalogueAdminError("Invalid upload namespace.");
      const form = new FormData();
      form.set("file", new Blob([new Uint8Array(photo.bytes)], { type: photo.format === "jpg" ? "image/jpeg" : `image/${photo.format}` }), `photograph.${photo.format}`);
      form.set("public_id", publicId); form.set("overwrite", "false"); form.set("unique_filename", "false");
      form.set("asset_folder", mediaNamespace);
      // Upload is the API action; authenticated is the delivery type.
      form.set("type", "authenticated");
      const result = await call("upload", form);
      const version = String(result.version ?? "");
      const expected = createHash("sha1").update(`public_id=${publicId}&version=${version}${config.apiSecret}`).digest("hex");
      const signature = typeof result.signature === "string" ? result.signature : "";
      if (result.public_id !== publicId || result.type !== "authenticated" || result.resource_type !== "image" || !/^[1-9][0-9]{0,15}$/.test(version) ||
        typeof result.asset_id !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(result.asset_id) || result.format !== photo.format ||
        result.width !== photo.width || result.height !== photo.height || result.bytes !== photo.bytes.byteLength ||
        signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new CatalogueAdminError("The provider upload response could not be verified. The image was not associated.", 502);
      return { publicId, assetId: result.asset_id, version, format: photo.format, width: photo.width, height: photo.height, bytes: photo.bytes.byteLength };
    },
    async destroy(publicId) {
      if (!validPublicId(publicId)) throw new CatalogueAdminError("Invalid deletion namespace.");
      const result = await call("destroy", new URLSearchParams({ public_id: publicId, type: "authenticated", invalidate: "true" }));
      if (result.result !== "ok" && result.result !== "not found") throw new CatalogueAdminError("Cloudinary deletion is pending retry.", 502);
    },
    async read(asset) {
      try {
        const response = await fetcher(deliveryUrl(config, asset), { redirect: "error", signal: AbortSignal.timeout(15000), cache: "no-store" });
        const contentType = asset.format === "jpg" ? "image/jpeg" : `image/${asset.format}`;
        if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== contentType) throw new Error();
        const data = new Uint8Array(await response.arrayBuffer());
        if (!data.byteLength || data.byteLength > MAX_PHOTO_BYTES) throw new Error();
        return { bytes: data, contentType };
      } catch { throw new CatalogueAdminError("Photography is temporarily unavailable.", 503); }
    },
  };
}

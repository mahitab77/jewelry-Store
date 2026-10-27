import "server-only";
import { queryRows } from "../db/client.ts";
import { requirePermission } from "../admin/authorization.ts";
import { getAdminRuntime, type AdminRuntime } from "../admin/runtime.ts";
import { uuid } from "../admin/catalogue/validation.ts";
import { cloudinaryProvider, type MediaProvider, type ProviderAsset } from "./cloudinary.ts";

interface AssetRow { publicId: string; assetId: string; version: string; format: ProviderAsset["format"]; width: number; height: number; bytes: number }
const columns = `m.cloudinary_public_id AS "publicId",m.cloudinary_asset_id AS "assetId",m.cloudinary_version::TEXT AS version,
  m.image_format AS format,m.width,m.height,m.byte_size AS bytes`;
async function imageResponse(asset: AssetRow | undefined, provider?: MediaProvider) {
  if (!asset) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    const image = await (provider ?? cloudinaryProvider()).read(asset);
    return new Response(new Uint8Array(image.bytes), { headers: { "Content-Type": image.contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
export async function publicPhotograph(id: string, provider?: MediaProvider) {
  try {
    uuid(id);
    const rows = await queryRows<AssetRow>(`SELECT ${columns} FROM product_media m JOIN products p ON p.id=m.product_id
      WHERE m.id=$1 AND m.cloudinary_public_id IS NOT NULL AND p.status='PUBLISHED' AND p.published_at<=CURRENT_TIMESTAMP`, [id]);
    return imageResponse(rows[0], provider);
  } catch { return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } }); }
}
export async function adminPhotograph(headers: Headers, productId: string, id: string, runtime: AdminRuntime = getAdminRuntime(), provider?: MediaProvider) {
  await requirePermission("catalogue:manage", headers, runtime); uuid(productId); uuid(id);
  const rows = await runtime.pool.query<AssetRow>(`SELECT ${columns} FROM product_media m WHERE m.id=$1 AND m.product_id=$2 AND m.cloudinary_public_id IS NOT NULL`, [id, productId]);
  return imageResponse(rows.rows[0], provider);
}

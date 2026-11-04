import { cleanupMediaBatch } from "../../media/cleanup.ts";
import "server-only";
import { randomUUID } from "node:crypto";
import { requirePermission } from "../authorization.ts";
import { getAdminRuntime, type AdminRuntime } from "../runtime.ts";
import { catalogueAudit, catalogueTransaction, lockProduct, touchProduct } from "./transaction.ts";
import { fail, object, text, uuid } from "./validation.ts";
import { cloudinaryProvider, mediaNamespace, preparePhoto, type MediaProvider } from "../../media/cloudinary.ts";
import { publicImageSource } from "../../catalogue/presentation.ts";

export async function uploadPhoto(headers: Headers, productId: string, bytes: Uint8Array, mime: string, alt: string, runtime: AdminRuntime = getAdminRuntime(), suppliedProvider?: MediaProvider) {
  await requirePermission("catalogue:manage", headers, runtime); uuid(productId);
  const altText = text(alt, "Photograph alt text", 250, true);
  if (altText.length < 5) fail("Describe the photograph in at least five characters.");
  const provider = suppliedProvider ?? cloudinaryProvider();
  const photo = await preparePhoto(bytes, mime);
  const jobId = randomUUID(), publicId = `${mediaNamespace}/${productId}/${jobId}`;
  await catalogueTransaction(headers, async (client) => {
    await lockProduct(client, productId);
    const count = (await client.query("SELECT count(*)::INTEGER AS count FROM product_media WHERE product_id=$1", [productId])).rows[0].count;
    if (count >= 12) fail("A product may have at most twelve photographs.");
    await client.query(`INSERT INTO catalogue_media_jobs(id,product_id,public_id,state,available_at)
      VALUES($1,$2,$3,'UPLOAD_PENDING',clock_timestamp()+INTERVAL '5 minutes')`, [jobId, productId, publicId]);
  }, runtime);
  try {
    const asset = await provider.upload(publicId, photo);
    const mediaId = randomUUID();
    await catalogueTransaction(headers, async (client, adminId) => {
      await lockProduct(client, productId);
      const job = (await client.query("SELECT state FROM catalogue_media_jobs WHERE id=$1 FOR UPDATE", [jobId])).rows[0];
      if (job?.state !== "UPLOAD_PENDING") fail("This upload is no longer eligible for association.", 409);
      const rows = (await client.query("SELECT id,is_primary,display_order FROM product_media WHERE product_id=$1 FOR UPDATE", [productId])).rows;
      if (rows.length >= 12) fail("The product reached its photograph limit while this upload was running.", 409);
      await client.query(`INSERT INTO product_media(id,product_id,external_media_reference,media_type,alt_text,display_order,is_primary,
        cloudinary_asset_id,cloudinary_public_id,cloudinary_version,image_format,width,height,byte_size)
        VALUES($1,$2,$3,'IMAGE',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [mediaId, productId, `/catalogue-images/${mediaId}`, altText, rows.reduce((n, r) => Math.max(n, r.display_order + 1), 0), !rows.some((r) => r.is_primary), asset.assetId, asset.publicId, asset.version, asset.format, asset.width, asset.height, asset.bytes]);
      await client.query("UPDATE catalogue_media_jobs SET state='ATTACHED',updated_at=clock_timestamp() WHERE id=$1", [jobId]);
      await touchProduct(client, productId);
      await catalogueAudit(client, adminId, productId, "CATALOGUE_MEDIA_ADDED", { mediaId });
    }, runtime);
    return mediaId;
  } catch (error) {
    // Keep the durable intent even if the process/connection dies mid-upload.
    // A timed-out upload may still finish remotely, so cleanup waits five minutes.
    await runtime.pool.query("UPDATE catalogue_media_jobs SET state='DELETE_PENDING',updated_at=clock_timestamp() WHERE id=$1 AND state='UPLOAD_PENDING'", [jobId]);
    throw error;
  }
}

export async function arrangePhotos(headers: Headers, productId: string, input: unknown, runtime: AdminRuntime = getAdminRuntime()) {
  return catalogueTransaction(headers, async (client, adminId) => {
    uuid(productId); const product = await lockProduct(client, productId);
    const body = object(input, ["revision", "images"]);
    if (body.revision !== product.revision) fail("Photographs changed after this editor opened. Reload before saving.", 409);
    if (!Array.isArray(body.images) || body.images.length > 12) fail("Invalid photograph list.");
    const images = body.images.map((value) => {
      const row = object(value, ["id", "altText", "primary"]);
      if (typeof row.primary !== "boolean") fail("Choose the primary photograph.");
      const altText = text(row.altText, "Photograph alt text", 250, true);
      if (altText.length < 5) fail("Every photograph needs meaningful alt text of at least five characters.");
      return { id: uuid(row.id), altText, primary: row.primary as boolean };
    });
    if (new Set(images.map((i) => i.id)).size !== images.length || images.filter((i) => i.primary).length !== (images.length ? 1 : 0)) fail("Choose exactly one primary photograph.");
    const old = (await client.query(`SELECT id,external_media_reference AS reference,media_type AS type,alt_text AS "altText",is_primary AS "isPrimary"
      FROM product_media WHERE product_id=$1 AND media_type='IMAGE' FOR UPDATE`, [productId])).rows;
    if (old.length !== images.length || old.some((r) => !images.some((i) => i.id === r.id))) fail("Only this product's current images can be arranged.", 409);
    if (product.status === "PUBLISHED" && !publicImageSource(old.find((image) => image.id === images.find((chosen) => chosen.primary)?.id))) {
      fail("A published product needs a supported primary photograph. Choose another image or unpublish first.", 409);
    }
    await client.query("UPDATE product_media SET is_primary=false WHERE product_id=$1", [productId]);
    for (const [index, image] of images.entries()) await client.query("UPDATE product_media SET display_order=$3,alt_text=$4,is_primary=$5 WHERE id=$1 AND product_id=$2", [image.id, productId, index, image.altText, image.primary]);
    await touchProduct(client, productId);
    await catalogueAudit(client, adminId, productId, "CATALOGUE_MEDIA_ARRANGED", { count: images.length });
  }, runtime);
}

export async function removePhoto(headers: Headers, productId: string, mediaId: string, runtime: AdminRuntime = getAdminRuntime()) {
  return catalogueTransaction(headers, async (client, adminId) => {
    uuid(productId); uuid(mediaId); const product = await lockProduct(client, productId);
    const image = (await client.query("SELECT * FROM product_media WHERE id=$1 AND product_id=$2 FOR UPDATE", [mediaId, productId])).rows[0];
    if (!image) fail("Photograph not found for this product.", 404);
    const others = (await client.query(`SELECT id,external_media_reference AS reference,media_type AS type,alt_text AS "altText",is_primary AS "isPrimary"
      FROM product_media WHERE product_id=$1 AND id<>$2 AND media_type='IMAGE' ORDER BY display_order,id FOR UPDATE`, [productId, mediaId])).rows;
    if (product.status === "PUBLISHED" && !others.length) fail("Unpublish the product before removing its last photograph.", 409);
    if (product.status === "PUBLISHED" && !publicImageSource(image.is_primary ? others[0] : others.find((other) => other.isPrimary))) {
      fail("Removing this photograph would leave an unsupported primary image. Choose another primary photograph or unpublish first.", 409);
    }
    await client.query("DELETE FROM product_media WHERE id=$1", [mediaId]);
    if (image.is_primary && others.length) await client.query("UPDATE product_media SET is_primary=true WHERE id=$1", [others[0].id]);
    if (image.cloudinary_public_id) await client.query(`UPDATE catalogue_media_jobs SET state='DELETE_PENDING',available_at=clock_timestamp(),updated_at=clock_timestamp()
      ,product_id=$2 WHERE public_id=$1 AND state IN ('ATTACHED','DELETE_PENDING')`, [image.cloudinary_public_id, productId]);
    await touchProduct(client, productId);
    await catalogueAudit(client, adminId, productId, "CATALOGUE_MEDIA_REMOVED", { mediaId, providerCleanup: Boolean(image.cloudinary_public_id) });
  }, runtime);
}

export async function retryPhotoCleanup(headers: Headers, productId: string, runtime: AdminRuntime = getAdminRuntime(), suppliedProvider?: MediaProvider) {
  await requirePermission("catalogue:manage", headers, runtime); uuid(productId);
  return cleanupMediaBatch((operation) => catalogueTransaction(headers, operation, runtime), suppliedProvider ?? cloudinaryProvider(), productId, 5);
}

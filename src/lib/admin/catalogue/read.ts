import "server-only";
import { requirePermission } from "../authorization.ts";
import { getAdminRuntime, type AdminRuntime } from "../runtime.ts";
import { catalogueTransaction, revisionColumn } from "./transaction.ts";
import { fail, integer, minorToEgp, uuid } from "./validation.ts";
import type { CatalogueChoices, EditorProduct, EditorVariant, ProductListRow, StoneInput } from "./types.ts";

export async function catalogueChoices(headers: Headers, runtime: AdminRuntime = getAdminRuntime()): Promise<CatalogueChoices> {
  await requirePermission("catalogue:manage", headers, runtime);
  const [categories, collections] = await Promise.all([
    runtime.pool.query(`WITH RECURSIVE visible AS (
      SELECT id FROM categories WHERE parent_id IS NULL AND is_visible
      UNION ALL SELECT c.id FROM categories c JOIN visible v ON c.parent_id=v.id WHERE c.is_visible)
      SELECT c.id,c.name,v.id IS NOT NULL AS visible FROM categories c LEFT JOIN visible v ON v.id=c.id ORDER BY c.display_order,c.name,c.id`),
    runtime.pool.query("SELECT id,name,status FROM collections ORDER BY display_order,name,id"),
  ]);
  return { categories: categories.rows, collections: collections.rows };
}

export async function readEditor(headers: Headers, id: string, runtime: AdminRuntime = getAdminRuntime()): Promise<EditorProduct | null> {
  return catalogueTransaction(headers, async (client) => {
    uuid(id);
    const product = (await client.query(`SELECT id,name,slug,description,product_type AS "productType",sales_mode AS "salesMode",status,
      published_at IS NOT NULL AS "slugLocked",${revisionColumn} AS revision FROM products WHERE id=$1 FOR SHARE`, [id])).rows[0];
    if (!product) return null;
    // pg operations on a transaction's single connection must be sequential.
    const categories = await client.query("SELECT category_id AS id FROM product_categories WHERE product_id=$1", [id]);
    const collections = await client.query("SELECT collection_id AS id FROM product_collections WHERE product_id=$1", [id]);
    const variants = await client.query(`SELECT v.id,v.sku,COALESCE(v.size_label,'') AS size,COALESCE(v.configuration_label,'') AS configuration,
        COALESCE(v.metal_type,'') AS "metalType",COALESCE(v.metal_purity,'') AS "metalPurity",COALESCE(v.metal_color,'') AS "metalColor",
        COALESCE(v.metal_weight_grams::TEXT,'') AS "metalWeightGrams",COALESCE(v.metal_weight_basis,'') AS "metalWeightBasis",
        v.is_active AS active,v.display_order AS "displayOrder",p.amount_minor::TEXT AS "amountMinor",
        i.on_hand AS "onHand",COALESCE(i.reserved,0) AS reserved,COALESCE(i.on_hand-i.reserved,0) AS available,
        i.updated_at::TEXT AS "stockUpdatedAt" FROM product_variants v
        LEFT JOIN product_prices p ON p.variant_id=v.id AND p.currency='EGP' AND p.is_active
        LEFT JOIN inventory i ON i.variant_id=v.id WHERE v.product_id=$1 ORDER BY v.display_order,v.id`, [id]);
    const stones = await client.query<StoneInput & { variantId: string }>(`SELECT pg.variant_id AS "variantId",pg.id AS "associationId",g.specification_kind AS kind,
        g.stone_type AS type,COALESCE(g.variety,'') AS variety,g.shape,g.color,COALESCE(g.carat_weight::TEXT,'') AS "caratWeight",
        COALESCE(g.origin,'') AS origin,COALESCE(g.treatment_information,'') AS treatment,COALESCE(g.laboratory,'') AS laboratory,
        COALESCE(g.report_reference,'') AS "reportReference",pg.gemstone_role AS role,pg.quantity,
        COALESCE(pg.total_carat_weight::TEXT,'') AS "totalCaratWeight",pg.display_order AS "displayOrder"
        FROM product_gemstones pg JOIN gemstones g ON g.id=pg.gemstone_id JOIN product_variants v ON v.id=pg.variant_id
        WHERE v.product_id=$1 ORDER BY pg.display_order,pg.id`, [id]);
    const media = await client.query(`SELECT id,external_media_reference AS reference,COALESCE(alt_text,'') AS "altText",is_primary AS primary,
        display_order AS "displayOrder",cloudinary_public_id IS NOT NULL AS provider FROM product_media
        WHERE product_id=$1 AND media_type='IMAGE' ORDER BY display_order,id`, [id]);
    const stonesByVariant = new Map<string, StoneInput[]>();
    for (const { variantId, ...stone } of stones.rows) { const group = stonesByVariant.get(variantId) ?? []; group.push(stone); stonesByVariant.set(variantId, group); }
    return { ...product, description: product.description ?? "", categoryIds: categories.rows.map((r) => r.id), collectionIds: collections.rows.map((r) => r.id),
      variants: variants.rows.map((v) => ({ ...v, priceEGP: minorToEgp(v.amountMinor),
        gemstones: stonesByVariant.get(v.id) ?? [] })) as EditorVariant[], media: media.rows } as EditorProduct;
  }, runtime);
}

export async function listAdminProducts(headers: Headers, query: Record<string, unknown>, runtime: AdminRuntime = getAdminRuntime()) {
  await requirePermission("catalogue:manage", headers, runtime);
  const search = typeof query.q === "string" ? query.q.trim() : "";
  if (search.length > 160) fail("Search is too long.");
  const status = query.status || null, type = query.type || null;
  if (status && !["DRAFT", "PUBLISHED", "ARCHIVED"].includes(status as string)) fail("Invalid status filter.");
  if (type && !["ONE_OF_A_KIND", "REPEATABLE", "BESPOKE"].includes(type as string)) fail("Invalid type filter.");
  const page = query.page === undefined ? 1 : typeof query.page === "string" && /^[1-9][0-9]{0,2}$/.test(query.page) ? Number(query.page) : fail("Invalid page.");
  integer(page, "Page", 1, 500);
  const rows = await runtime.pool.query<ProductListRow>(`SELECT p.id,p.name,p.slug,p.product_type AS "productType",p.status,p.sales_mode AS "salesMode",to_char(p.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') AS "updatedAt",
    m.id AS "imageId",m.external_media_reference AS "imageReference",m.cloudinary_public_id IS NOT NULL AS "imageProvider",
    ARRAY(SELECT c.name FROM categories c JOIN product_categories pc ON pc.category_id=c.id WHERE pc.product_id=p.id ORDER BY c.name) AS categories,
    ARRAY(SELECT v.sku FROM product_variants v WHERE v.product_id=p.id ORDER BY v.display_order,v.id) AS skus,
    CASE WHEN p.sales_mode='ENQUIRY_ONLY' THEN NULL ELSE (SELECT min(price.amount_minor)::TEXT FROM product_prices price
      JOIN product_variants v ON v.id=price.variant_id WHERE v.product_id=p.id AND v.is_active AND price.is_active AND price.currency='EGP') END AS "priceMinor",
    COALESCE((SELECT sum(i.on_hand-i.reserved) FROM inventory i JOIN product_variants v ON v.id=i.variant_id WHERE v.product_id=p.id AND v.is_active),0)::TEXT AS available
    FROM products p LEFT JOIN product_media m ON m.product_id=p.id AND m.is_primary
    WHERE ($1::TEXT IS NULL OR p.status=$1) AND ($2::TEXT IS NULL OR p.product_type=$2)
      AND ($3='' OR p.name ILIKE $4 OR p.slug ILIKE $4 OR EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.sku ILIKE $4))
    ORDER BY p.updated_at DESC,p.id ASC LIMIT 21 OFFSET $5`, [status, type, search, `%${search.replace(/[\\%_]/g, "\\$&")}%`, (page - 1) * 20]);
  return { items: rows.rows.slice(0, 20).map((row) => ({ ...row, available: Number(row.available) })), hasMore: rows.rows.length > 20, page, search, status, type };
}

export async function productAuditHistory(headers: Headers, id: string, runtime: AdminRuntime = getAdminRuntime()) {
  await requirePermission("catalogue:manage", headers, runtime); uuid(id);
  const rows = await runtime.pool.query(`SELECT a.id,a.action,a.metadata,a.created_at::TEXT AS "createdAt",u.display_name AS actor
    FROM audit_events a LEFT JOIN admin_users u ON u.id=a.actor_admin_id WHERE a.target_table='products' AND a.target_id=$1
    AND a.action LIKE 'CATALOGUE_%' ORDER BY a.created_at DESC,a.id DESC LIMIT 50`, [id]);
  return rows.rows as { id: string; action: string; metadata: Record<string, unknown>; createdAt: string; actor: string | null }[];
}

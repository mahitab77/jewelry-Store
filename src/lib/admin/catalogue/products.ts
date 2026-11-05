import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getAdminRuntime, type AdminRuntime } from "../runtime.ts";
import { catalogueTransaction, catalogueAudit, lockProduct, touchProduct } from "./transaction.ts";
import { CatalogueAdminError, fail, integer, object, parseSubmission, text, uuid, egpToMinor } from "./validation.ts";
import type { ProductInput, StoneInput } from "./types.ts";
import { publicImageSource } from "../../catalogue/presentation.ts";
import { automaticSku, automaticSlug, lockAutomaticValues } from "./automatic-values.ts";
import { quotationOnly } from "../../commerce-policy.ts";

const stoneColumns = ["specification_kind", "stone_type", "variety", "shape", "color", "carat_weight", "origin", "treatment_information", "laboratory", "report_reference"];
function stoneValues(s: StoneInput) { return [s.kind, s.type, s.variety || null, s.shape, s.color, s.caratWeight || null, s.origin || null, s.treatment || null, s.laboratory || null, s.reportReference || null]; }
function assertIndividualStock(onHand: number, hasIndividual: boolean) {
  if (hasIndividual && onHand > 1) fail("A variant with an individual gemstone can hold at most one unit.", 409);
}

async function saveStones(client: PoolClient, adminId: string, productId: string, variantId: string, stones: StoneInput[]) {
  const old = (await client.query(`SELECT pg.id,pg.gemstone_id,pg.quantity,pg.gemstone_role,pg.total_carat_weight::TEXT,pg.display_order,
    g.specification_kind,g.stone_type,g.variety,g.shape,g.color,g.carat_weight::TEXT,g.origin,g.treatment_information,g.laboratory,g.report_reference
    FROM product_gemstones pg JOIN gemstones g ON g.id=pg.gemstone_id WHERE pg.variant_id=$1 FOR UPDATE OF pg`, [variantId])).rows;
  const kept: string[] = [];
  let changed = false;
  for (const s of stones) {
    if (s.associationId && kept.includes(s.associationId)) fail("A gemstone association was repeated.");
    const previous = s.associationId ? old.find((r) => r.id === s.associationId) : undefined;
    if (s.associationId && !previous) fail("That gemstone association does not belong to this variant.", 409);
    const values = stoneValues(s);
    let stoneId: string;
    if (previous && stoneColumns.every((column, i) => (previous[column] ?? null) === values[i])) stoneId = previous.gemstone_id;
    else {
      // Copy on write: never edit a shared gemstone or its verification history.
      stoneId = randomUUID(); changed = true;
      await client.query(`INSERT INTO gemstones(id,specification_kind,stone_type,variety,shape,color,carat_weight,origin,treatment_information,laboratory,report_reference,provenance_status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [stoneId, ...values, s.origin ? "DECLARED" : "UNKNOWN"]);
    }
    if (!previous || previous.gemstone_id !== stoneId || previous.quantity !== s.quantity || previous.gemstone_role !== s.role ||
      (previous.total_carat_weight ?? "") !== s.totalCaratWeight || previous.display_order !== s.displayOrder) changed = true;
    const association = previous?.id ?? randomUUID(); kept.push(association);
    await client.query(`INSERT INTO product_gemstones(id,variant_id,gemstone_id,specification_kind,quantity,gemstone_role,total_carat_weight,display_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET gemstone_id=EXCLUDED.gemstone_id,specification_kind=EXCLUDED.specification_kind,
      quantity=EXCLUDED.quantity,gemstone_role=EXCLUDED.gemstone_role,total_carat_weight=EXCLUDED.total_carat_weight,display_order=EXCLUDED.display_order`,
    [association, variantId, stoneId, s.kind, s.quantity, s.role, s.totalCaratWeight || null, s.displayOrder]);
  }
  if (old.some((r) => !kept.includes(r.id))) changed = true;
  await client.query("DELETE FROM product_gemstones WHERE variant_id=$1 AND NOT(id=ANY($2::UUID[]))", [variantId, kept]);
  if (changed) await catalogueAudit(client, adminId, productId, "CATALOGUE_GEMSTONES_CHANGED", { variantId, count: stones.length });
}

async function saveAssignments(client: PoolClient, id: string, p: ProductInput) {
  for (const [table, column, ids, source] of [
    ["product_categories", "category_id", p.categoryIds, "categories"], ["product_collections", "collection_id", p.collectionIds, "collections"],
  ] as const) {
    const found = await client.query(`SELECT id FROM ${source} WHERE id=ANY($1::UUID[])`, [ids]);
    if (found.rowCount !== ids.length) fail("A selected category or collection no longer exists.", 409);
    await client.query(`DELETE FROM ${table} WHERE product_id=$1 AND NOT(${column}=ANY($2::UUID[]))`, [id, ids]);
    for (const selected of ids) await client.query(`INSERT INTO ${table}(product_id,${column}) VALUES ($1,$2) ON CONFLICT(product_id,${column}) DO NOTHING`, [id, selected]);
  }
}

async function assertPublishable(client: PoolClient, id: string, p: ProductInput) {
  if (p.description.length < 20 || !/\p{L}/u.test(p.description)) throw new CatalogueAdminError("Add a meaningful description of at least 20 characters before publication.", 400, "product.description");
  const visible = await client.query(`WITH RECURSIVE visible AS (
    SELECT id FROM categories WHERE parent_id IS NULL AND is_visible
    UNION ALL SELECT c.id FROM categories c JOIN visible v ON c.parent_id=v.id WHERE c.is_visible)
    SELECT id FROM visible WHERE id=ANY($1::UUID[])`, [p.categoryIds]);
  if (!visible.rowCount) throw new CatalogueAdminError("Publication needs at least one publicly visible category.", 400, "product.categoryIds");
  const variants = p.variants.filter((v) => v.active);
  if (!variants.length) throw new CatalogueAdminError("Publication needs at least one active variant.", 400, "product.variants");
  const missingPrice = p.variants.findIndex((v) => v.active && !v.priceEGP);
  if (!quotationOnly() && p.salesMode !== "ENQUIRY_ONLY" && missingPrice >= 0) throw new CatalogueAdminError("Every active direct-purchase variant needs an EGP selling price.", 400, `product.variants.${missingPrice}.priceEGP`);
  const media = (await client.query("SELECT id,external_media_reference AS reference,media_type AS type,alt_text AS \"altText\",is_primary AS \"isPrimary\" FROM product_media WHERE product_id=$1 AND media_type='IMAGE'", [id])).rows;
  if (!media.some((m) => m.isPrimary && publicImageSource(m)) || media.some((m) => !m.altText?.trim() || m.altText.trim().length < 5)) fail("Publication needs a primary photograph and meaningful alt text of at least five characters for every image.");
  // Lock current inventory without accepting reserved values from an editor.
  const stocks = await client.query(`SELECT i.*,EXISTS(SELECT 1 FROM product_gemstones pg
    WHERE pg.variant_id=i.variant_id AND pg.specification_kind='INDIVIDUAL') AS has_individual
    FROM inventory i JOIN product_variants v ON v.id=i.variant_id WHERE v.product_id=$1 FOR UPDATE OF i`, [id]);
  if (variants.some((v) => !stocks.rows.some((i) => i.variant_id === v.id)) || stocks.rows.some((i) => i.on_hand < i.reserved || i.reserved < 0)) fail("Review the inventory configuration before publication.");
  for (const stock of stocks.rows) assertIndividualStock(stock.on_hand, stock.has_individual);
}

export async function saveProduct(headers: Headers, id: string | null, input: unknown, runtime: AdminRuntime = getAdminRuntime()): Promise<string> {
  return catalogueTransaction(headers, async (client, adminId) => {
    const submission = parseSubmission(input);
    const p = submission.product;
    const productId = id ? uuid(id) : randomUUID();
    await lockAutomaticValues(client);
    const old = id ? await lockProduct(client, productId) : null;
    if (!old && submission.action !== "save") fail("Create a draft before publishing or adding photographs.");
    if (old && old.revision !== submission.revision) fail("This product changed after the editor opened. Reload before saving.", 409);
    if (!p.slug) p.slug = old?.slug ?? await automaticSlug(client, "products", p.name);
    if (old?.published_at && p.slug !== old.slug) fail("This URL is locked after first publication. Keep the existing slug.", 409);
    const existingVariants = old ? (await client.query<{ id: string; sku: string; metalWeightGrams: string | null; metalWeightBasis: "ACTUAL" | "ESTIMATED" | null }>(`SELECT id,sku,metal_weight_grams::TEXT AS "metalWeightGrams",metal_weight_basis AS "metalWeightBasis" FROM product_variants WHERE product_id=$1 FOR UPDATE`, [productId])).rows : [];
    const existing = existingVariants.map((v) => v.id);
    if (old && existing.length && old.product_type !== p.productType) fail("Product type is locked once variants exist.", 409);
    if (existing.some((variantId) => !p.variants.some((v) => v.id === variantId))) fail("Keep existing variants and deactivate them instead of removing them.");
    if (p.variants.some((v) => v.id && !existing.includes(v.id))) fail("A variant does not belong to this product.", 409);
    for (const v of p.variants) {
      const previous = v.id ? existingVariants.find((oldVariant) => oldVariant.id === v.id)! : undefined;
      if (!v.sku) v.sku = previous?.sku ?? await automaticSku(client);
      // Older callers do not know these additive fields. Omission keeps an
      // existing measurement; an explicit empty pair records unknown values.
      if (v.metalWeightGrams === undefined && v.metalWeightBasis === undefined) {
        v.metalWeightGrams = previous?.metalWeightGrams ?? "";
        v.metalWeightBasis = previous?.metalWeightBasis ?? "";
      }
    }
    if (old) await client.query("UPDATE products SET name=$2,slug=$3,description=$4,product_type=$5,sales_mode=$6 WHERE id=$1", [productId, p.name, p.slug, p.description || null, p.productType, p.salesMode]);
    else await client.query("INSERT INTO products(id,name,slug,description,product_type,sales_mode) VALUES($1,$2,$3,$4,$5,$6)", [productId, p.name, p.slug, p.description || null, p.productType, p.salesMode]);
    await saveAssignments(client, productId, p);
    for (const v of p.variants) {
      const variantId = v.id ?? randomUUID();
      await client.query(`INSERT INTO product_variants(id,product_id,product_type,sku,size_label,configuration_label,metal_type,metal_purity,metal_color,is_active,display_order,metal_weight_grams,metal_weight_basis)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(id) DO UPDATE SET sku=EXCLUDED.sku,size_label=EXCLUDED.size_label,
        configuration_label=EXCLUDED.configuration_label,metal_type=EXCLUDED.metal_type,metal_purity=EXCLUDED.metal_purity,
        metal_color=EXCLUDED.metal_color,is_active=EXCLUDED.is_active,display_order=EXCLUDED.display_order,
        metal_weight_grams=EXCLUDED.metal_weight_grams,metal_weight_basis=EXCLUDED.metal_weight_basis,updated_at=clock_timestamp()`,
      [variantId, productId, p.productType, v.sku, v.size || null, v.configuration || null, v.metalType || null, v.metalPurity || null, v.metalColor || null, v.active, v.displayOrder, v.metalWeightGrams || null, v.metalWeightBasis || null]);
      await catalogueAudit(client, adminId, productId, "CATALOGUE_VARIANT_SAVED", { variantId, created: !v.id });
      const previousPrice = (await client.query("SELECT id,amount_minor::TEXT AS amount FROM product_prices WHERE variant_id=$1 AND currency='EGP' AND is_active FOR UPDATE", [variantId])).rows[0];
      const price = egpToMinor(v.priceEGP);
      if ((previousPrice?.amount ?? null) !== price) {
        await client.query("UPDATE product_prices SET is_active=false,updated_at=clock_timestamp() WHERE variant_id=$1 AND currency='EGP' AND is_active", [variantId]);
        if (price !== null) await client.query("INSERT INTO product_prices(variant_id,currency,amount_minor) VALUES($1,'EGP',$2)", [variantId, price]);
        await catalogueAudit(client, adminId, productId, "CATALOGUE_PRICE_CHANGED", { variantId, beforeMinor: previousPrice?.amount ?? null, afterMinor: price, currency: "EGP" });
      }
      if (!v.id) {
        await client.query("INSERT INTO inventory(variant_id,product_type,on_hand) VALUES($1,$2,$3)", [variantId, p.productType, v.initialStock ?? 0]);
        await catalogueAudit(client, adminId, productId, "CATALOGUE_INVENTORY_INITIALISED", { variantId, before: 0, after: v.initialStock ?? 0, reserved: 0, reason: v.stockReason || "Initial zero stock" });
      }
      if (v.gemstones.some((stone) => stone.kind === "INDIVIDUAL")) {
        const stock = (await client.query("SELECT on_hand FROM inventory WHERE variant_id=$1 FOR UPDATE", [variantId])).rows[0];
        assertIndividualStock(stock?.on_hand ?? 0, true);
      }
      await saveStones(client, adminId, productId, variantId, v.gemstones);
    }
    const status = submission.action === "publish" ? "PUBLISHED" : submission.action === "unpublish" ? "DRAFT" : submission.action === "archive" ? "ARCHIVED" : old?.status ?? "DRAFT";
    if (status === "PUBLISHED") {
      // Persisted IDs are needed for the publication inventory check.
      const stored = (await client.query("SELECT id,sku FROM product_variants WHERE product_id=$1", [productId])).rows;
      await assertPublishable(client, productId, { ...p, variants: p.variants.map((v) => ({ ...v, id: stored.find((r) => r.sku === v.sku)?.id })) });
    }
    await client.query(`UPDATE products SET status=$2,published_at=CASE WHEN $2='PUBLISHED'
      THEN CASE WHEN $3='publish' THEN clock_timestamp() ELSE COALESCE(published_at,clock_timestamp()) END
      ELSE published_at END,updated_at=clock_timestamp() WHERE id=$1`, [productId, status, submission.action]);
    await catalogueAudit(client, adminId, productId, old ? "CATALOGUE_PRODUCT_EDITED" : "CATALOGUE_PRODUCT_CREATED");
    if (old && old.status !== status) await catalogueAudit(client, adminId, productId, { PUBLISHED: "CATALOGUE_PUBLISHED", DRAFT: "CATALOGUE_UNPUBLISHED", ARCHIVED: "CATALOGUE_ARCHIVED" }[status as "PUBLISHED" | "DRAFT" | "ARCHIVED"]);
    return productId;
  }, runtime);
}

export async function adjustInventory(headers: Headers, productId: string, variantId: string, input: unknown, runtime: AdminRuntime = getAdminRuntime()) {
  return catalogueTransaction(headers, async (client, adminId) => {
    uuid(productId); uuid(variantId); const product = await lockProduct(client, productId);
    const body = object(input, ["delta", "reason", "revision", "expectedOnHand", "expectedReserved"]), delta = integer(body.delta, "Stock adjustment", -1000000, 1000000), reason = text(body.reason, "Adjustment reason", 240, true);
    const revision = body.revision === undefined ? undefined : text(body.revision, "Editor version", 40, true);
    if (revision !== undefined && revision !== product.revision) fail("This product changed. Reload before adjusting available pieces.", 409);
    const expectedOnHand = body.expectedOnHand === null ? null : body.expectedOnHand === undefined ? undefined : integer(body.expectedOnHand, "Previous stock", 0, 1000000);
    const expectedReserved = body.expectedReserved === undefined ? undefined : integer(body.expectedReserved, "Previous reserved stock", 0, 1000000);
    if (!delta) fail("An adjustment must change the stock quantity.");
    const variant = (await client.query("SELECT product_type FROM product_variants WHERE id=$1 AND product_id=$2", [variantId, productId])).rows[0];
    if (!variant) fail("Variant not found for this product.", 404);
    const initialized = await client.query("INSERT INTO inventory(variant_id,product_type) VALUES($1,$2) ON CONFLICT(variant_id) DO NOTHING RETURNING variant_id", [variantId, variant.product_type]);
    // null is an explicit missing-row snapshot, not permission to ignore stock.
    // The unique insert also waits for a concurrent initializer, whose committed
    // row must reject that snapshot instead of receiving an outdated adjustment.
    if (expectedOnHand === null && initialized.rowCount !== 1) fail("Available pieces changed after this editor loaded. Reload before adjusting them.", 409);
    const stock = (await client.query(`SELECT i.*,EXISTS(SELECT 1 FROM product_gemstones pg
      WHERE pg.variant_id=i.variant_id AND pg.specification_kind='INDIVIDUAL') AS has_individual
      FROM inventory i WHERE variant_id=$1 FOR UPDATE OF i`, [variantId])).rows[0];
    if ((expectedOnHand !== undefined && expectedOnHand !== null && expectedOnHand !== stock.on_hand) || (expectedReserved !== undefined && expectedReserved !== stock.reserved)) fail("Available pieces changed after this editor loaded. Reload before adjusting them.", 409);
    const next = stock.on_hand + delta;
    assertIndividualStock(next, stock.has_individual);
    if (next < stock.reserved || next < 0 || next > 1000000 || (variant.product_type === "ONE_OF_A_KIND" && next > 1) || variant.product_type === "BESPOKE") fail("The adjustment would conflict with reserved units or the product's stock limits.", 409);
    await client.query("UPDATE inventory SET on_hand=$2,updated_at=clock_timestamp() WHERE variant_id=$1", [variantId, next]);
    await touchProduct(client, productId);
    await catalogueAudit(client, adminId, productId, "CATALOGUE_INVENTORY_ADJUSTED", { variantId, before: stock.on_hand, after: next, reserved: stock.reserved, delta, reason });
    return { onHand: next, reserved: stock.reserved, available: next - stock.reserved };
  }, runtime);
}

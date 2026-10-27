import "server-only";
import { queryRows, withTransaction } from "../db/client.ts";
import type {
  ProductListOptions, ProductPage, PublicCategory, PublicCollection, PublicGemstone,
  PublicMedia, PublicProduct, PublicProductDetail, PublicVariant,
} from "./types.ts";

export class CatalogueInputError extends Error {
  constructor(message: string) { super(message); this.name = "CatalogueInputError"; }
}

function validateSlug(value: string): string {
  if (typeof value !== "string" || value.length > 160 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) {
    throw new CatalogueInputError("Invalid catalogue slug.");
  }
  return value;
}

const sorts = { newest: "p.published_at DESC, p.id ASC", name_asc: 'p.name COLLATE "C" ASC, p.id ASC' } as const;
function listOptions(options: ProductListOptions) {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new CatalogueInputError("Invalid catalogue options.");
  const { limit = 20, offset = 0, sort = "newest", categorySlug, collectionSlug } = options;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0 || offset > 10000) {
    throw new CatalogueInputError("Limit must be 1–50 and offset must be 0–10000 integers.");
  }
  if (typeof sort !== "string" || !Object.hasOwn(sorts, sort)) throw new CatalogueInputError("Invalid catalogue sort.");
  return { limit, offset, sort, categorySlug: categorySlug === undefined ? null : validateSlug(categorySlug),
    collectionSlug: collectionSlug === undefined ? null : validateSlug(collectionSlug) };
}

// A hidden parent hides its descendants too. Cycles/unrooted categories are not public.
const visibleCategories = `WITH RECURSIVE visible_categories AS (
  SELECT c.id, c.parent_id, c.slug, c.name, c.description, c.display_order
  FROM public.categories c WHERE c.parent_id IS NULL AND c.is_visible
  UNION ALL
  SELECT c.id, c.parent_id, c.slug, c.name, c.description, c.display_order
  FROM public.categories c JOIN visible_categories parent ON parent.id = c.parent_id WHERE c.is_visible
)`;
const publicProduct = "p.status = 'PUBLISHED' AND p.published_at <= CURRENT_TIMESTAMP";
const publicCollection = "c.status = 'PUBLISHED' AND c.published_at <= CURRENT_TIMESTAMP";
const categoryColumns = 'c.id, c.parent_id AS "parentId", c.slug, c.name, c.description';
const collectionColumns = "c.id, c.slug, c.name, c.description";

// Only allowlisted public fields. Money is cast to text before JSON aggregation.
const productColumns = `p.id, p.slug, p.name, p.description,
  p.product_type AS "productType", p.sales_mode AS "salesMode",
  (SELECT jsonb_build_object('id', m.id, 'reference', m.external_media_reference,
      'type', m.media_type, 'altText', m.alt_text, 'isPrimary', m.is_primary)
   FROM public.product_media m WHERE m.product_id = p.id AND m.is_primary AND m.media_type = 'IMAGE') AS "primaryImage",
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', v.id, 'sku', v.sku, 'size', v.size_label, 'configuration', v.configuration_label,
      'metalType', v.metal_type, 'metalPurity', v.metal_purity, 'metalColor', v.metal_color,
      'price', CASE WHEN p.product_type <> 'BESPOKE' AND p.sales_mode <> 'ENQUIRY_ONLY' AND price.id IS NOT NULL
          THEN jsonb_build_object('currency', price.currency, 'amountMinor', price.amount_minor::TEXT) ELSE NULL END,
      'availability', CASE WHEN p.product_type = 'BESPOKE' OR p.sales_mode = 'ENQUIRY_ONLY' THEN 'ENQUIRY_ONLY'
          WHEN stock.id IS NULL THEN 'NOT_TRACKED' WHEN stock.on_hand > stock.reserved THEN 'IN_STOCK' ELSE 'OUT_OF_STOCK' END,
      'canPurchase', COALESCE(p.product_type <> 'BESPOKE' AND p.sales_mode <> 'ENQUIRY_ONLY'
          AND price.id IS NOT NULL AND stock.on_hand > stock.reserved, false)
    ) ORDER BY v.display_order, v.id)
    FROM public.product_variants v
    LEFT JOIN public.product_prices price ON price.variant_id = v.id AND price.is_active AND price.currency = 'EGP'
    LEFT JOIN public.inventory stock ON stock.variant_id = v.id
    WHERE v.product_id = p.id AND v.is_active), '[]'::JSONB) AS variants`;

interface ProductRow extends PublicProduct { variants: PublicVariant[] }
function summary(row: ProductRow): PublicProduct {
  const prices = row.variants.flatMap((v) => v.price ? [v.price] : []);
  const fromPrice = prices.reduce<(typeof prices)[number] | null>((lowest, price) =>
    !lowest || BigInt(price.amountMinor) < BigInt(lowest.amountMinor) ? price : lowest, null);
  return { id: row.id, slug: row.slug, name: row.name, description: row.description,
    productType: row.productType, salesMode: row.salesMode, primaryImage: row.primaryImage,
    fromPrice, pricingMode: row.salesMode === "ENQUIRY_ONLY" || row.productType === "BESPOKE"
      ? "ENQUIRY_ONLY" : fromPrice ? "PRICED" : "PRICE_ON_REQUEST",
    canPurchase: row.variants.some((v) => v.canPurchase === true),
    canEnquire: row.salesMode !== "DIRECT_PURCHASE" || row.productType === "BESPOKE" };
}

export async function getPublishedCategories(): Promise<PublicCategory[]> {
  return queryRows<PublicCategory>(`${visibleCategories} SELECT ${categoryColumns} FROM visible_categories c ORDER BY c.display_order, c.id`);
}

export async function getPublishedCollections(): Promise<PublicCollection[]> {
  return queryRows<PublicCollection>(`SELECT ${collectionColumns} FROM public.collections c WHERE ${publicCollection} ORDER BY c.display_order, c.id`);
}

export async function getPublishedProducts(options: ProductListOptions = {}): Promise<ProductPage> {
  const validated = listOptions(options);
  const rows = await queryRows<ProductRow>(`${visibleCategories} SELECT ${productColumns} FROM public.products p
    WHERE ${publicProduct}
      AND ($1::TEXT IS NULL OR EXISTS (SELECT 1 FROM public.product_categories pc
        JOIN visible_categories c ON c.id = pc.category_id WHERE pc.product_id = p.id AND c.slug = $1))
      AND ($2::TEXT IS NULL OR EXISTS (SELECT 1 FROM public.product_collections pc
        JOIN public.collections c ON c.id = pc.collection_id WHERE pc.product_id = p.id AND c.slug = $2 AND ${publicCollection}))
    ORDER BY ${sorts[validated.sort]} LIMIT $3 OFFSET $4`,
  [validated.categorySlug, validated.collectionSlug, validated.limit + 1, validated.offset]);
  return { items: rows.slice(0, validated.limit).map(summary), limit: validated.limit,
    offset: validated.offset, hasMore: rows.length > validated.limit };
}

export async function getProductsByCategorySlug(slug: string, options: Omit<ProductListOptions, "categorySlug"> = {}): Promise<ProductPage> {
  return getPublishedProducts({ ...options, categorySlug: validateSlug(slug) });
}

export async function getProductsByCollectionSlug(slug: string, options: Omit<ProductListOptions, "collectionSlug"> = {}): Promise<ProductPage> {
  return getPublishedProducts({ ...options, collectionSlug: validateSlug(slug) });
}

export async function getPublishedProductBySlug(slug: string): Promise<PublicProductDetail | null> {
  validateSlug(slug);
  // Five bounded queries per detail, one repeatable-read snapshot, no per-variant loop.
  return withTransaction(async (client) => {
    const row = (await client.query<ProductRow>(`SELECT ${productColumns} FROM public.products p WHERE ${publicProduct} AND p.slug = $1`, [slug])).rows[0];
    if (!row) return null;
    const values = [row.id];
    const media = (await client.query<PublicMedia>(`SELECT id, external_media_reference AS reference,
      media_type AS type, alt_text AS "altText", is_primary AS "isPrimary"
      FROM public.product_media WHERE product_id = $1 ORDER BY display_order, id`, values)).rows;
    const categories = (await client.query<PublicCategory>(`${visibleCategories} SELECT ${categoryColumns} FROM visible_categories c
      JOIN public.product_categories pc ON pc.category_id = c.id WHERE pc.product_id = $1 ORDER BY c.display_order, c.id`, values)).rows;
    const collections = (await client.query<PublicCollection>(`SELECT ${collectionColumns} FROM public.collections c
      JOIN public.product_collections pc ON pc.collection_id = c.id WHERE pc.product_id = $1 AND ${publicCollection}
      ORDER BY pc.display_order NULLS LAST, c.display_order, c.id`, values)).rows;
    const gemstones = (await client.query<PublicGemstone & { variantId: string }>(`SELECT pg.variant_id AS "variantId",
      g.stone_type AS type, g.variety, g.shape, g.color, g.carat_weight::TEXT AS "caratWeight",
      pg.total_carat_weight::TEXT AS "totalCaratWeight", g.treatment_information AS "treatmentInformation",
      pg.quantity, pg.gemstone_role AS role FROM public.product_gemstones pg
      JOIN public.gemstones g ON g.id = pg.gemstone_id
      JOIN public.product_variants v ON v.id = pg.variant_id WHERE v.product_id = $1 AND v.is_active
      ORDER BY pg.display_order, pg.id`, values)).rows;
    return { ...summary(row), media, categories, collections, variants: row.variants.map((v) => ({
      ...v, canPurchase: v.canPurchase === true,
      gemstones: gemstones.filter((g) => g.variantId === v.id).map((g) => ({
        type: g.type, variety: g.variety, shape: g.shape, color: g.color,
        caratWeight: g.caratWeight, totalCaratWeight: g.totalCaratWeight,
        treatmentInformation: g.treatmentInformation, quantity: g.quantity, role: g.role,
      })),
    })) };
  }, true);
}

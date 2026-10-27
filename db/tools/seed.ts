import "server-only";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { PoolClient } from "pg";
import { localDatabaseConfig, LocalDatabaseError } from "./local.ts";

export function developmentId(n: number): string {
  return `02000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export async function seedDevelopment(url: string | undefined, development = false): Promise<void> {
  if (!development) throw new LocalDatabaseError();
  const config = localDatabaseConfig(url);
  const images = ["ring-emerald-no-bg.png", "ruby-earring-no-bg.png", "earrings-emerald-no-bg.png", "soft-necklace-no-bg.png"];
  for (const image of images) await access(fileURLToPath(new URL(`../../public/images/${image}`, import.meta.url)));
  const pool = new pg.Pool(config);
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [1279348813, 3]);
    for (const [i, slug, name] of [[1, "rings", "Rings"], [2, "earrings", "Earrings"],
      [3, "necklaces-pendants", "Necklaces & Pendants"], [4, "bracelets", "Bracelets"]] as const) {
      await client.query(`INSERT INTO public.categories(id, slug, name, display_order, is_visible)
        VALUES ($1, $2, $3, $4, true) ON CONFLICT (id) DO NOTHING`,
      [developmentId(i), `dev-${slug}`, `[DEVELOPMENT] ${name}`, i]);
    }
    await client.query(`INSERT INTO public.collections(id, slug, name, status, published_at)
      VALUES ($1, 'dev-selections', '[DEVELOPMENT] Selections', 'PUBLISHED', '2020-01-01T00:00:00Z'),
             ($2, 'dev-unpublished', '[DEVELOPMENT] Unpublished collection', 'DRAFT', NULL)
      ON CONFLICT (id) DO NOTHING`, [developmentId(11), developmentId(12)]);
    const products = [
      [101, "dev-unique-ring", "ONE_OF_A_KIND", "BOTH", "PUBLISHED", 1],
      [102, "dev-repeatable-earrings", "REPEATABLE", "DIRECT_PURCHASE", "PUBLISHED", 2],
      [103, "dev-enquiry-pendant", "REPEATABLE", "ENQUIRY_ONLY", "PUBLISHED", 3],
      [104, "dev-bespoke-bracelet", "BESPOKE", "ENQUIRY_ONLY", "PUBLISHED", 4],
      [105, "dev-draft-ring", "REPEATABLE", "DIRECT_PURCHASE", "DRAFT", 1],
      [106, "dev-archived-ring", "REPEATABLE", "DIRECT_PURCHASE", "ARCHIVED", 1],
    ] as const;
    for (const [id, slug, type, mode, status, category] of products) {
      await client.query(`INSERT INTO public.products(id, slug, name, description, product_type, sales_mode, status, published_at)
        VALUES ($1, $2, $3, 'Development fixture only; not an offer or a verified client catalogue entry.', $4, $5, $6, $7)
        ON CONFLICT (id) DO NOTHING`, [developmentId(id), slug, `[DEVELOPMENT] ${slug.slice(4)}`, type, mode, status,
        status === "PUBLISHED" ? "2020-01-01T00:00:00Z" : null]);
      await client.query(`INSERT INTO public.product_categories(id, product_id, category_id) VALUES ($1, $2, $3)
        ON CONFLICT (id) DO NOTHING`, [developmentId(id + 500), developmentId(id), developmentId(category)]);
      await client.query(`INSERT INTO public.product_collections(id, product_id, collection_id, display_order) VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO NOTHING`, [developmentId(id + 600), developmentId(id), developmentId(11), id]);
      await client.query(`INSERT INTO public.product_variants(id, product_id, product_type, sku, is_active, metal_type)
        VALUES ($1, $2, $3, $4, true, 'Development example') ON CONFLICT (id) DO NOTHING`,
      [developmentId(id + 100), developmentId(id), type, `DEV-${id}`]);
    }
    await client.query(`INSERT INTO public.product_variants(id, product_id, product_type, sku, size_label, is_active, display_order)
      VALUES ($1, $2, 'REPEATABLE', 'DEV-207', 'Development alternate', true, 1) ON CONFLICT (id) DO NOTHING`,
    [developmentId(207), developmentId(102)]);
    for (const [variant, amount, quantity] of [[201, "1599000", 1], [202, "245000", 5], [207, "265000", 0],
      [205, "12300", 3], [206, "12300", 3]] as const) {
      await client.query(`INSERT INTO public.product_prices(id, variant_id, amount_minor) VALUES ($1, $2, $3)
        ON CONFLICT (id) DO NOTHING`, [developmentId(variant + 100), developmentId(variant), amount]);
      await client.query(`INSERT INTO public.inventory(id, variant_id, product_type, on_hand) VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO NOTHING`, [developmentId(variant + 1000), developmentId(variant),
        variant === 201 ? "ONE_OF_A_KIND" : "REPEATABLE", quantity]);
    }
    for (const [i, product, image, order, primary] of [[401, 101, images[0], 0, true], [402, 101, images[2], 1, false],
      [403, 102, images[1], 0, true], [404, 103, images[3], 0, true]] as const) {
      await client.query(`INSERT INTO public.product_media(id, product_id, external_media_reference, media_type, alt_text, display_order, is_primary)
        VALUES ($1, $2, $3, 'IMAGE', 'Development fixture image', $4, $5) ON CONFLICT (id) DO NOTHING`,
      [developmentId(i), developmentId(product), `/images/${image}`, order, primary]);
    }
    await client.query(`INSERT INTO public.gemstones(id, specification_kind, stone_type, shape, color, carat_weight)
      VALUES ($1, 'INDIVIDUAL', 'Emerald (development example)', 'Oval', 'Green', 1.2500) ON CONFLICT (id) DO NOTHING`, [developmentId(501)]);
    await client.query(`INSERT INTO public.product_gemstones(id, variant_id, gemstone_id, specification_kind, quantity, gemstone_role)
      VALUES ($1, $2, $3, 'INDIVIDUAL', 1, 'CENTER') ON CONFLICT (id) DO NOTHING`,
    [developmentId(502), developmentId(201), developmentId(501)]);
    await client.query("COMMIT");
  } catch {
    if (client) await client.query("ROLLBACK");
    throw new Error("Development seed failed; its transaction was rolled back.");
  } finally {
    client?.release();
    await pool.end();
  }
}

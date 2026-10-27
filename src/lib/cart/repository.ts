import "server-only";
import type { PoolClient } from "pg";
import { withDatabaseClient, withTransaction } from "../db/client.ts";
import { publicImageSource } from "../catalogue/presentation.ts";
import { CART_LIFETIME, CartError, newToken, tokenHash } from "./session.ts";
import { emptyCart, MAX_CART_LINES, MAX_QUANTITY, type Cart, type CartItem } from "./types.ts";

const MAX_MONEY = BigInt("9223372036854775807");
const revisionSql = `to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const selectionFrom = `FROM product_variants v JOIN products p ON p.id=v.product_id
  LEFT JOIN product_prices price ON price.variant_id=v.id AND price.currency='EGP' AND price.is_active
  LEFT JOIN inventory stock ON stock.variant_id=v.id`;
const eligible = `p.status='PUBLISHED' AND p.published_at<=statement_timestamp() AND v.is_active
  AND p.product_type<>'BESPOKE' AND p.sales_mode IN ('DIRECT_PURCHASE','BOTH') AND price.id IS NOT NULL
  AND stock.on_hand-stock.reserved >= $2 AND (p.product_type<>'ONE_OF_A_KIND' OR $2<=1)
  AND price.amount_minor::NUMERIC*$2<=9223372036854775807`;
type CartRow = { id: string; revision: string; expires_at: Date; active: boolean };
type SelectionRow = {
  id: string; variantId: string; quantity: number; observed: string | null; published: boolean; active: boolean;
  name: string; slug: string; type: string; mode: string; size: string | null; configuration: string | null;
  metal: string | null; purity: string | null; color: string | null; price: string | null; available: number;
  mediaId: string | null; reference: string | null; alt: string | null;
};
const rejected = (message: string, status = 409) => ({ error: { message, status } });

async function consume(client: PoolClient, key: string, max: number) {
  const hash = tokenHash("la-palme-guest-limit:" + key);
  const row = (await client.query(`INSERT INTO cart_rate_limits(key_hash,count,expires_at)
    VALUES($1,1,statement_timestamp()+INTERVAL '1 minute') ON CONFLICT(key_hash) DO UPDATE SET
    count=CASE WHEN cart_rate_limits.expires_at<=statement_timestamp() THEN 1 ELSE LEAST(cart_rate_limits.count+1,$2+1) END,
    expires_at=CASE WHEN cart_rate_limits.expires_at<=statement_timestamp() THEN statement_timestamp()+INTERVAL '1 minute' ELSE cart_rate_limits.expires_at END
    RETURNING count<=$2 AS allowed`, [hash, max])).rows[0];
  return row.allowed as boolean;
}
export async function throttleCart(read = false) {
  const allowed = await withDatabaseClient(async (client) => {
    await client.query(`DELETE FROM cart_rate_limits WHERE key_hash IN (SELECT key_hash FROM cart_rate_limits
      WHERE expires_at<=statement_timestamp() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED)`);
    return consume(client, read ? "read-global" : "mutation-global", read ? 600 : 300);
  }, "cart");
  if (!allowed) throw new CartError("Please wait a minute before updating your shopping bag again.", 429);
}
async function findCart(client: PoolClient, hash: string, lock = false): Promise<CartRow | undefined> {
  return (await client.query<CartRow>(`SELECT id,${revisionSql} AS revision,expires_at,
    (status='ACTIVE' AND expires_at>clock_timestamp() AND customer_profile_id IS NULL AND currency='EGP') AS active
    FROM carts WHERE session_token_hash=$1 ${lock ? "FOR UPDATE" : ""}`, [hash])).rows[0];
}
function selection(row: SelectionRow): CartItem {
  const visible = row.published;
  const direct = visible && row.active && row.type !== "BESPOKE" && row.mode !== "ENQUIRY_ONLY";
  const amount = direct && row.price !== null ? BigInt(row.price) : null;
  const total = amount === null ? null : amount * BigInt(row.quantity);
  const priceBound = amount !== null && amount > BigInt(0) && MAX_MONEY / amount < BigInt(MAX_QUANTITY) ? Number(MAX_MONEY / amount) : MAX_QUANTITY;
  const maxQuantity = direct && amount !== null ? Math.max(0, Math.min(MAX_QUANTITY, row.available, priceBound, row.type === "ONE_OF_A_KIND" ? 1 : MAX_QUANTITY)) : 0;
  const notice = !visible || !row.active ? "This selection is no longer available. You can remove it from your bag."
    : !direct ? "This piece is now available by enquiry only."
    : amount === null ? "A current selling price is unavailable. Please review this selection."
    : total! > MAX_MONEY ? "This selection exceeds the shopping bag amount limit. Please reduce the quantity."
    : !maxQuantity ? "This selection is currently out of stock."
    : row.quantity > maxQuantity ? `Only ${maxQuantity} available. Please reduce the quantity.` : null;
  const source = visible && row.mediaId && row.reference ? publicImageSource({ id: row.mediaId, reference: row.reference, type: "IMAGE", altText: row.alt, isPrimary: true }) : null;
  return { id: row.id, variantId: row.variantId, name: visible ? row.name : "Jewelry no longer available",
    href: visible ? `/jewels/${row.slug}` : null,
    configuration: visible && row.active ? [row.size, row.configuration, row.metal, row.purity, row.color].filter(Boolean).join(" · ") : "",
    image: source ? { source, alt: row.alt || row.name } : null,
    quantity: row.quantity, maxQuantity, unitPriceMinor: amount?.toString() ?? null,
    lineTotalMinor: total !== null && total <= MAX_MONEY ? total.toString() : null,
    eligible: !notice, notice, priceChanged: amount !== null && row.observed !== null && BigInt(row.observed) !== amount };
}
async function snapshot(client: PoolClient, row: CartRow): Promise<Cart> {
  const rows = (await client.query<SelectionRow>(`SELECT ci.id,ci.variant_id AS "variantId",ci.quantity,ci.observed_unit_price_minor::TEXT AS observed,
    p.status='PUBLISHED' AND p.published_at<=statement_timestamp() AS published,v.is_active AS active,
    p.name,p.slug,p.product_type AS type,p.sales_mode AS mode,v.size_label AS size,v.configuration_label AS configuration,
    v.metal_type AS metal,v.metal_purity AS purity,v.metal_color AS color,price.amount_minor::TEXT AS price,
    COALESCE(stock.on_hand-stock.reserved,0) AS available,m.id AS "mediaId",m.external_media_reference AS reference,m.alt_text AS alt
    FROM cart_items ci JOIN product_variants v ON v.id=ci.variant_id JOIN products p ON p.id=v.product_id
    LEFT JOIN product_prices price ON price.variant_id=v.id AND price.currency='EGP' AND price.is_active
    LEFT JOIN inventory stock ON stock.variant_id=v.id
    LEFT JOIN product_media m ON m.product_id=p.id AND m.is_primary AND m.media_type='IMAGE'
    WHERE ci.cart_id=$1 ORDER BY ci.created_at,ci.id LIMIT 51`, [row.id])).rows;
  if (rows.length > MAX_CART_LINES) throw new Error("Cart line bound exceeded.");
  const items = rows.map(selection), sum = items.reduce((total, item) => total + BigInt(item.lineTotalMinor ?? "0"), BigInt(0));
  const subtotalMinor = items.some((item) => item.lineTotalMinor === null) || sum > MAX_MONEY ? null : sum.toString();
  return { items, count: items.reduce((count, item) => count + item.quantity, 0), currency: "EGP", subtotalMinor,
    revision: row.revision, expiresAt: row.expires_at.toISOString(), eligible: items.length > 0 && items.every((item) => item.eligible) && subtotalMinor !== null, expired: false };
}
export async function readCart(token: string | null) {
  if (!token) return { cart: emptyCart(), clear: false };
  await throttleCart(true);
  return withTransaction(async (client) => {
    const row = await findCart(client, tokenHash(token));
    if (!row?.active) return { cart: { ...emptyCart(), expired: Boolean(row) }, clear: true };
    return { cart: await snapshot(client, row), clear: false };
  }, true, "cart");
}
// Checkout borrows the same transaction and authoritative snapshot; no second
// catalogue, owner lookup or monetary calculation is introduced.
export async function readOwnedCart(client: PoolClient, token: string, lock = false) {
  const row = await findCart(client, tokenHash(token), lock);
  return row?.active ? { id: row.id, cart: await snapshot(client, row) } : null;
}
type Mutation = { kind: "add"; variantId: string; quantity: number } | { kind: "update"; itemId: string; quantity: number; revision: string } | { kind: "remove"; itemId: string; revision: string };
export async function mutateCart(token: string | null, mutation: Mutation) {
  const result = await withTransaction(async (client) => {
    // Logical expiry always applies, even if this opportunistic maintenance has not run.
    await client.query(`UPDATE carts SET status='EXPIRED',updated_at=clock_timestamp() WHERE id IN
      (SELECT id FROM carts WHERE status='ACTIVE' AND customer_profile_id IS NULL AND expires_at<=statement_timestamp()
       ORDER BY expires_at LIMIT 50 FOR UPDATE SKIP LOCKED)`);
    const hash = token ? tokenHash(token) : null, row = hash ? await findCart(client, hash, true) : undefined;
    if (!row?.active) {
      if (mutation.kind !== "add") return rejected("Your shopping bag session is no longer active. Reload to start again.", 401);
      if (!(await consume(client, "creation-global", 30))) return rejected("Please wait a minute before starting a new shopping bag.", 429);
      const freshToken = newToken();
      // No cart row is inserted unless the selection is eligible in this statement.
      const created = (await client.query<CartRow>(`WITH chosen AS (
        SELECT v.id,price.amount_minor ${selectionFrom} WHERE v.id=$1 AND ${eligible}),
        made AS (INSERT INTO carts(session_token_hash,currency,expires_at)
          SELECT $3,'EGP',clock_timestamp()+$4*INTERVAL '1 second' FROM chosen
          RETURNING id,expires_at,${revisionSql} AS revision),
        added AS (INSERT INTO cart_items(cart_id,variant_id,quantity,observed_unit_price_minor)
          SELECT made.id,chosen.id,$2,chosen.amount_minor FROM made CROSS JOIN chosen RETURNING id)
        SELECT made.* FROM made CROSS JOIN added`, [mutation.variantId, mutation.quantity, tokenHash(freshToken), CART_LIFETIME])).rows[0];
      if (!created) return rejected("This selection cannot be added in that quantity. Its price or availability may have changed.");
      return { cart: await snapshot(client, created), token: freshToken };
    }
    if (!(await consume(client, "session:" + hash, 120))) return rejected("Please wait before changing your shopping bag again.", 429);
    const before = await snapshot(client, row);
    if (mutation.kind !== "add" && mutation.revision !== row.revision) return { ...rejected("Your shopping bag changed. Review it before trying again."), cart: before };
    if (mutation.kind === "remove") {
      const removed = await client.query("DELETE FROM cart_items WHERE cart_id=$1 AND id=$2 RETURNING id", [row.id, mutation.itemId]);
      if (!removed.rowCount) return { ...rejected("This selection was not found in your shopping bag.", 404), cart: before };
    } else {
      const previous = mutation.kind === "add" ? before.items.find((item) => item.variantId === mutation.variantId) : before.items.find((item) => item.id === mutation.itemId);
      if (mutation.kind === "update" && !previous) return { ...rejected("This selection was not found in your shopping bag.", 404), cart: before };
      if (!previous && before.items.length >= MAX_CART_LINES) return { ...rejected("A shopping bag can hold at most fifty different selections."), cart: before };
      const variantId = mutation.kind === "add" ? mutation.variantId : previous!.variantId;
      const next = mutation.quantity + (mutation.kind === "add" ? previous?.quantity ?? 0 : 0);
      if (next > MAX_QUANTITY) return { ...rejected("A selection can contain at most 99 units."), cart: before };
      const changed = await client.query(`INSERT INTO cart_items(cart_id,variant_id,quantity,observed_unit_price_minor)
        SELECT $3,v.id,$2,price.amount_minor ${selectionFrom} WHERE v.id=$1 AND ${eligible}
        AND price.amount_minor::NUMERIC*$2+(SELECT COALESCE(sum(other.quantity::NUMERIC*other_price.amount_minor),0)
          FROM cart_items other JOIN product_variants other_variant ON other_variant.id=other.variant_id
          JOIN products other_product ON other_product.id=other_variant.product_id
          JOIN product_prices other_price ON other_price.variant_id=other.variant_id AND other_price.currency='EGP' AND other_price.is_active
          WHERE other.cart_id=$3 AND other.variant_id<>$1 AND other_variant.is_active AND other_product.product_type<>'BESPOKE'
            AND other_product.sales_mode<>'ENQUIRY_ONLY' AND other_product.status='PUBLISHED' AND other_product.published_at<=statement_timestamp())<=9223372036854775807
        ON CONFLICT(cart_id,variant_id) DO UPDATE SET quantity=EXCLUDED.quantity,
          updated_at=clock_timestamp() RETURNING id`, [variantId, next, row.id]);
      if (!changed.rowCount) return { ...rejected("This quantity is no longer available. Review the selection before trying again."), cart: await snapshot(client, row) };
    }
    const updated = (await client.query<CartRow>(`UPDATE carts SET updated_at=clock_timestamp() WHERE id=$1 RETURNING id,expires_at,${revisionSql} AS revision`, [row.id])).rows[0];
    return { cart: await snapshot(client, updated), token: null };
  }, false, "cart");
  if ("error" in result) return { ...result, token: null };
  return result;
}

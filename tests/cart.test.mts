// Exercise retained direct-sales behavior; quotation-only denial has its own suites.
process.env.COMMERCE_MODE = "DIRECT_SALES";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { cartFixture } from "./helpers/cart-fixture.mts";
import { developmentId as id } from "../db/tools/seed.ts";
import { cartHttp } from "../src/lib/cart/http.ts";
import { cookieName, tokenHash, cartOrigin } from "../src/lib/cart/session.ts";
import { databaseConfig } from "../src/lib/db/config.ts";
import { closeDatabase } from "../src/lib/db/client.ts";
import type { Cart } from "../src/lib/cart/types.ts";

let f: Awaited<ReturnType<typeof cartFixture>>, role: pg.Pool;
const old = { url: process.env.CART_DATABASE_URL, origin: process.env.CART_ORIGIN };
const origin = "https://cart.boutique.test";
let originals: { products: Record<string, unknown>[]; prices: Record<string, unknown>[]; stock: Record<string, unknown>[] };
before(async () => {
  f = await cartFixture(origin); process.env.CART_DATABASE_URL = f.cartUrl; process.env.CART_ORIGIN = origin;
  role = new pg.Pool(databaseConfig(f.cartUrl));
  originals = { products: (await f.data.query("SELECT id,status,sales_mode,published_at,name FROM products")).rows,
    prices: (await f.data.query("SELECT id,amount_minor::TEXT,is_active FROM product_prices")).rows,
    stock: (await f.data.query("SELECT variant_id,on_hand,reserved FROM inventory")).rows };
}, { timeout: 60000 });
beforeEach(async () => {
  await f.data.query("DELETE FROM cart_rate_limits");
  for (const row of originals.products) await f.data.query("UPDATE products SET status=$2,sales_mode=$3,published_at=$4,name=$5 WHERE id=$1", [row.id, row.status, row.sales_mode, row.published_at, row.name]);
  for (const row of originals.prices) await f.data.query("UPDATE product_prices SET amount_minor=$2,is_active=$3 WHERE id=$1", [row.id, row.amount_minor, row.is_active]);
  for (const row of originals.stock) await f.data.query("UPDATE inventory SET on_hand=$2,reserved=$3 WHERE variant_id=$1", [row.variant_id, row.on_hand, row.reserved]);
  await f.data.query("UPDATE product_variants SET is_active=true");
});
after(async () => { if (role) await role.end(); if (f) await f.close();
  for (const [key, value] of [["CART_DATABASE_URL", old.url], ["CART_ORIGIN", old.origin]]) { if (value === undefined) delete process.env[key!]; else process.env[key!] = value; }
});
async function request(method = "GET", path = "", body?: unknown, cookie?: string, headers: Record<string, string> = {}) {
  const response = await cartHttp(new Request(origin + "/api/cart" + (path ? "/" + path : ""), {
    method, headers: { ...(method !== "GET" ? { Origin: origin, "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), path ? path.split("/") : []);
  return { response, body: await response.json() as { cart: Cart; message?: string } };
}
const cookie = (response: Response) => response.headers.getSetCookie()[0]?.split(";")[0];
async function add(variant = id(202), quantity = 1, session?: string) { return request("POST", "items", { variantId: variant, quantity }, session); }
async function started(variant = id(202), quantity = 1) { const result = await add(variant, quantity); assert.equal(result.response.status, 200, "The disposable purchasable variant must be added."); return { session: cookie(result.response)!, cart: result.body.cart }; }

test("ordinary visitors and an empty bag do not create sessions or require database configuration", async () => {
  const count = (await f.data.query("SELECT count(*) FROM carts")).rows[0].count;
  const url = process.env.CART_DATABASE_URL; delete process.env.CART_DATABASE_URL;
  try { const result = await request(); assert.equal(result.response.status, 200); assert.equal(result.body.cart.count, 0); assert.equal(cookie(result.response), undefined); }
  finally { process.env.CART_DATABASE_URL = url; }
  assert.equal((await f.data.query("SELECT count(*) FROM carts")).rows[0].count, count);
});
test("first valid selection creates an opaque HttpOnly session, stores only its hash and omits credentials from JSON", async () => {
  const result = await add(), secret = cookie(result.response)!.split("=")[1], header = result.response.headers.getSetCookie()[0];
  assert.equal(result.response.status, 200); assert.ok(/^[A-Za-z0-9_-]{43}$/.test(secret));
  for (const attribute of ["HttpOnly", "SameSite=Lax", "Secure", "Path=/", "Max-Age=2592000", "Expires="]) assert.ok(header.includes(attribute));
  assert.ok(!header.includes("Domain="));
  const row = (await f.data.query("SELECT session_token_hash,customer_profile_id,currency FROM carts WHERE session_token_hash=$1", [tokenHash(secret)])).rows[0];
  assert.ok(row.session_token_hash === tokenHash(secret)); assert.equal(row.customer_profile_id, null); assert.equal(row.currency, "EGP");
  const output = JSON.stringify(result.body); assert.ok(!output.includes(secret) && !output.includes(row.session_token_hash) && !output.includes(f.cartUrl));
  assert.equal(result.response.headers.get("cache-control"), "private, no-store, max-age=0"); assert.equal(result.response.headers.get("vary"), "Cookie");
});
test("a guest selection survives new requests and a closed/recreated application database pool", async () => {
  const { session, cart } = await started(); await closeDatabase();
  const next = await request("GET", "", undefined, session); assert.equal(next.response.status, 200); assert.deepEqual(next.body.cart, cart);
});
test("guests cannot read, change or remove each other's lines using item IDs or claimed cart ownership", async () => {
  const a = await started(), b = await started();
  assert.notEqual(a.cart.items[0].id, b.cart.items[0].id);
  for (const method of ["PATCH", "DELETE"]) {
    const result = await request(method, "items/" + a.cart.items[0].id, { revision: b.cart.revision, ...(method === "PATCH" ? { quantity: 2 } : {}) }, b.session);
    assert.equal(result.response.status, 404);
  }
  assert.equal((await request("GET", "", undefined, a.session)).body.cart.count, 1);
  assert.equal((await request("POST", "items", { variantId: id(202), quantity: 1, cartId: randomUUID(), customer_id: randomUUID() }, b.session)).response.status, 400);
});
test("tampered, duplicated and unknown cookies cannot fixate a newly generated session", async () => {
  for (const session of [`${cookieName()}=broken`, `${cookieName()}=${"A".repeat(43)}`, `${cookieName()}=bad; ${cookieName()}=again`]) {
    const read = await request("GET", "", undefined, session); assert.equal(read.body.cart.count, 0); assert.ok(read.response.headers.getSetCookie()[0].includes("Max-Age=0"));
    const result = await add(id(202), 1, session); assert.equal(result.response.status, 200); assert.ok(cookie(result.response) !== session);
  }
});
test("expired and inactive sessions cannot mutate old selections and rotate only on a new valid add", async () => {
  const a = await started();
  await f.data.query("UPDATE carts SET created_at=now()-INTERVAL '2 days',expires_at=now()-INTERVAL '1 day' WHERE session_token_hash=$1", [tokenHash(a.session.split("=")[1])]);
  const read = await request("GET", "", undefined, a.session); assert.equal(read.body.cart.expired, true); assert.equal(read.body.cart.count, 0);
  assert.equal((await request("PATCH", "items/" + a.cart.items[0].id, { revision: a.cart.revision, quantity: 2 }, a.session)).response.status, 401);
  const next = await add(id(202), 1, a.session); assert.equal(next.response.status, 200); assert.ok(cookie(next.response) !== a.session);
  assert.equal((await f.data.query("SELECT status FROM carts WHERE session_token_hash=$1", [tokenHash(a.session.split("=")[1])])).rows[0].status, "EXPIRED");
  assert.equal((await f.data.query("SELECT quantity FROM cart_items WHERE id=$1", [a.cart.items[0].id])).rows[0].quantity, 1);
});
test("duplicate adds merge, and concurrent adds serialize without losing increments or creating lines", async () => {
  const a = await started();
  const results = await Promise.all(Array.from({ length: 4 }, () => add(id(202), 1, a.session)));
  assert.ok(results.every((result) => result.response.status === 200));
  const current = (await request("GET", "", undefined, a.session)).body.cart;
  assert.equal(current.count, 5); assert.equal(current.items.length, 1); assert.equal((await add(id(202), 1, a.session)).response.status, 409);
});
test("simultaneous absolute quantity updates reject stale revisions instead of overwriting another edit", async () => {
  const a = await started(), path = "items/" + a.cart.items[0].id;
  const results = await Promise.all([2, 3].map((quantity) => request("PATCH", path, { quantity, revision: a.cart.revision }, a.session)));
  assert.deepEqual(results.map((result) => result.response.status).sort(), [200, 409]);
  const current = (await request("GET", "", undefined, a.session)).body.cart;
  assert.ok(current.count === 2 || current.count === 3); assert.equal(current.items.length, 1);
});
test("quantities must be positive bounded integers and client prices or sale claims are rejected", async () => {
  for (const quantity of [0, -1, 1.1, "2", 100, null]) assert.equal((await request("POST", "items", { variantId: id(202), quantity })).response.status, 400);
  for (const field of ["price", "sku", "stock", "salesMode", "productId", "subtotal", "role"]) assert.equal((await request("POST", "items", { variantId: id(202), quantity: 1, [field]: "forged" })).response.status, 400);
});
test("one-of-a-kind jewelry allows exactly one line and one unit across repeated adds and patches", async () => {
  assert.equal((await add(id(201), 2)).response.status, 409);
  const a = await started(id(201)); assert.equal(a.cart.items[0].maxQuantity, 1);
  assert.equal((await add(id(201), 1, a.session)).response.status, 409);
  assert.equal((await request("PATCH", "items/" + a.cart.items[0].id, { revision: a.cart.revision, quantity: 2 }, a.session)).response.status, 409);
});
test("repeatable variant choices retain their own prices, configuration and stock limits", async () => {
  await f.data.query("UPDATE inventory SET on_hand=3 WHERE variant_id=$1", [id(207)]);
  const a = await started(); const b = await add(id(207), 2, a.session);
  assert.equal(b.response.status, 200); assert.equal(b.body.cart.items.length, 2); assert.equal(b.body.cart.subtotalMinor, "775000");
  assert.equal(b.body.cart.items.find((item) => item.variantId === id(207))!.configuration, "Development alternate");
});
test("enquiry-only, bespoke, draft, archived, future, inactive and missing-price selections cannot be added", async () => {
  const before = (await f.data.query("SELECT count(*) FROM carts")).rows[0].count;
  for (const variant of [203, 204, 205, 206, 207]) assert.equal((await add(id(variant))).response.status, 409);
  assert.equal((await add(randomUUID())).response.status, 409);
  await f.data.query("UPDATE products SET published_at=now()+INTERVAL '1 day' WHERE id=$1", [id(102)]); assert.equal((await add()).response.status, 409);
  await f.data.query("UPDATE products SET published_at='2020-01-01' WHERE id=$1", [id(102)]);
  await f.data.query("UPDATE product_variants SET is_active=false WHERE id=$1", [id(202)]); assert.equal((await add()).response.status, 409);
  await f.data.query("UPDATE product_variants SET is_active=true WHERE id=$1", [id(202)]);
  await f.data.query("UPDATE product_prices SET is_active=false WHERE variant_id=$1", [id(202)]); assert.equal((await add()).response.status, 409);
  assert.equal((await f.data.query("SELECT count(*) FROM carts")).rows[0].count, before);
});
test("stock uses current available units, never overwrites reservations and retains reduced-stock selections", async () => {
  const a = await started(id(202), 4);
  await f.data.query("UPDATE inventory SET reserved=3 WHERE variant_id=$1", [id(202)]);
  const read = (await request("GET", "", undefined, a.session)).body.cart;
  assert.equal(read.items[0].quantity, 4); assert.equal(read.items[0].maxQuantity, 2); assert.equal(read.eligible, false); assert.match(read.items[0].notice!, /reduce/);
  assert.equal((await add(id(202), 1, a.session)).response.status, 409);
  const updated = await request("PATCH", "items/" + read.items[0].id, { revision: read.revision, quantity: 2 }, a.session);
  assert.equal(updated.response.status, 200); assert.equal(updated.body.cart.eligible, true);
  assert.equal((await f.data.query("SELECT reserved FROM inventory WHERE variant_id=$1", [id(202)])).rows[0].reserved, 3);
});
test("price observations show genuine changes while current prices determine exact line totals and subtotal", async () => {
  const a = await started(id(202), 2);
  await f.data.query("UPDATE product_prices SET amount_minor=12345 WHERE variant_id=$1", [id(202)]);
  const current = (await request("GET", "", undefined, a.session)).body.cart;
  assert.equal(current.items[0].priceChanged, true); assert.equal(current.items[0].unitPriceMinor, "12345"); assert.equal(current.subtotalMinor, "24690");
  const changed = await request("PATCH", "items/" + current.items[0].id, { revision: current.revision, quantity: 1 }, a.session);
  assert.equal(changed.response.status, 200); assert.equal(changed.body.cart.items[0].priceChanged, true);
  await f.data.query("UPDATE product_prices SET is_active=false WHERE variant_id=$1", [id(202)]);
  const unpriced = (await request("GET", "", undefined, a.session)).body.cart;
  assert.equal(unpriced.items.length, 1); assert.equal(unpriced.subtotalMinor, null); assert.equal(unpriced.eligible, false);
});
test("BIGINT prices remain exact and overflowing quantities or subtotals never become rounded money", async () => {
  await f.data.query("UPDATE product_prices SET amount_minor=9007199254740993 WHERE variant_id=$1", [id(202)]);
  const a = await started(id(202), 2); assert.equal(a.cart.subtotalMinor, "18014398509481986");
  await f.data.query("UPDATE product_prices SET amount_minor=9223372036854775807 WHERE variant_id=$1", [id(202)]);
  assert.equal((await add(id(202), 2)).response.status, 409);
  const current = (await request("GET", "", undefined, a.session)).body.cart; assert.equal(current.subtotalMinor, null); assert.equal(current.eligible, false);
  const bounded = await started(); assert.equal((await add(id(201), 1, bounded.session)).response.status, 409);
  assert.equal((await request("GET", "", undefined, bounded.session)).body.cart.count, 1);
});
test("unpublished selections remain removable without exposing newly private catalogue fields", async () => {
  const a = await started(); await f.data.query("UPDATE products SET status='DRAFT',name='PRIVATE_CART_SENTINEL' WHERE id=$1", [id(102)]);
  const current = (await request("GET", "", undefined, a.session)).body.cart;
  assert.equal(current.items.length, 1); assert.equal(current.items[0].href, null); assert.equal(current.items[0].image, null);
  assert.ok(!JSON.stringify(current).includes("PRIVATE_CART_SENTINEL"));
  const removed = await request("DELETE", "items/" + current.items[0].id, { revision: current.revision }, a.session);
  assert.equal(removed.response.status, 200); assert.equal(removed.body.cart.count, 0); assert.equal(removed.body.cart.subtotalMinor, "0");
  assert.equal((await request("GET", "", undefined, a.session)).body.cart.items.length, 0);
});
test("every cart operation leaves physical inventory, reservations, orders and payments untouched", async () => {
  const before = (await f.data.query("SELECT * FROM inventory ORDER BY id")).rows;
  const a = await started(), b = await add(id(201), 1, a.session);
  await request("PATCH", "items/" + a.cart.items[0].id, { revision: b.body.cart.revision, quantity: 2 }, a.session);
  const current = (await request("GET", "", undefined, a.session)).body.cart;
  await request("DELETE", "items/" + current.items[0].id, { revision: current.revision }, a.session);
  assert.deepEqual((await f.data.query("SELECT * FROM inventory ORDER BY id")).rows, before);
  for (const table of ["inventory_reservations", "orders", "payments"]) assert.equal((await f.data.query(`SELECT count(*) FROM ${table}`)).rows[0].count, "0");
  for (const sql of ["UPDATE inventory SET on_hand=0", "INSERT INTO inventory_reservations DEFAULT VALUES", "SELECT * FROM admin_users", "UPDATE admin_auth_rate_limits SET count=1", "DELETE FROM products"]) await assert.rejects(role.query(sql), { code: "42501" });
});
test("origin, fetch metadata, JSON size, UUID and unknown-field validation fail safely", async () => {
  for (const source of ["https://hostile.test", "null", ""]) assert.equal((await request("POST", "items", { variantId: id(202), quantity: 1 }, undefined, { Origin: source })).response.status, 403);
  assert.equal((await request("POST", "items", {}, undefined, { "Sec-Fetch-Site": "cross-site" })).response.status, 403);
  assert.equal((await request("POST", "items", { variantId: "not-a-uuid", quantity: 1 })).response.status, 400);
  assert.equal((await request("POST", "items", { variantId: id(202), quantity: 1, large: "x".repeat(3000) })).response.status, 413);
  assert.equal((await request("POST", "items", [], undefined)).response.status, 400);
  const malformed = await cartHttp(new Request(origin + "/api/cart/items", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{" }), ["items"]);
  assert.equal(malformed.status, 400);
  assert.equal((await request("POST", "items", {}, undefined, { "Content-Type": "text/plain" })).response.status, 415);
  assert.equal((await request("PUT")).response.status, 405);
  assert.equal((await request("GET", "items")).response.status, 405);
  assert.throws(() => cartOrigin("https://host.test/path"));
});
test("shared database abuse counters enforce creation limits without storing IPs or raw tokens", async () => {
  await f.data.query("INSERT INTO cart_rate_limits(key_hash,count,expires_at) VALUES($1,30,now()+INTERVAL '1 minute')", [tokenHash("la-palme-guest-limit:creation-global")]);
  const result = await add(); assert.equal(result.response.status, 429);
  const counters = (await f.data.query("SELECT key_hash,count,expires_at FROM cart_rate_limits")).rows;
  assert.ok(counters.every((row) => /^[0-9a-f]{64}$/.test(row.key_hash)));
});

test("converted and abandoned carts stay inaccessible without rolling their original expiry", async () => {
  for (const status of ["CONVERTED", "ABANDONED"]) {
    const a = await started(), expires = a.cart.expiresAt;
    const updated = await add(id(202), 1, a.session); assert.equal(updated.body.cart.expiresAt, expires);
    await f.data.query("UPDATE carts SET status=$2 WHERE session_token_hash=$1", [tokenHash(a.session.split("=")[1]), status]);
    const read = await request("GET", "", undefined, a.session); assert.equal(read.body.cart.count, 0); assert.equal(read.body.cart.expired, true);
    assert.equal((await request("DELETE", "items/" + a.cart.items[0].id, { revision: a.cart.revision }, a.session)).response.status, 401);
  }
});

test("the fifty-line and ninety-nine-unit application limits reject excess without corrupting the bag", async () => {
  await f.data.query("UPDATE inventory SET on_hand=100 WHERE variant_id=$1", [id(202)]);
  const a = await started(id(202), 99); assert.equal(a.cart.items[0].maxQuantity, 99);
  assert.equal((await add(id(202), 1, a.session)).response.status, 409);
  const b = await started();
  const cart = (await f.data.query("SELECT id FROM carts WHERE session_token_hash=$1", [tokenHash(b.session.split("=")[1])])).rows[0].id;
  await f.data.query(`INSERT INTO product_variants(id,product_id,product_type,sku,is_active)
    SELECT gen_random_uuid(),$1,'REPEATABLE','CART-CAP-' || n,true FROM generate_series(1,50) n`, [id(102)]);
  await f.data.query(`INSERT INTO cart_items(cart_id,variant_id,quantity)
    SELECT $1,id,1 FROM product_variants WHERE sku LIKE 'CART-CAP-%' ORDER BY sku LIMIT 49`, [cart]);
  const next = await add(id(201), 1, b.session); assert.equal(next.response.status, 409); assert.equal(next.body.cart.items.length, 50);
});

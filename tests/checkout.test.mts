import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import pg from "pg";
import { cartFixture } from "./helpers/cart-fixture.mts";
import { checkoutContact, deliveryDetails, testLocation } from "./helpers/checkout-data.mts";
import { developmentId as id } from "../db/tools/seed.ts";
import { cartHttp } from "../src/lib/cart/http.ts";
import { checkoutHttp } from "../src/lib/checkout/http.ts";
import { egyptianMobile, governorates } from "../src/lib/checkout/egypt.ts";
import { purgeCheckoutDrafts, prepareCheckout } from "../src/lib/checkout/repository.ts";
import { tokenHash, cookieName } from "../src/lib/cart/session.ts";
import { emptyDetails, type CheckoutView, type CheckoutDetails } from "../src/lib/checkout/types.ts";
import { databaseConfig } from "../src/lib/db/config.ts";

const origin = "https://checkout.boutique.test";
const old = { url: process.env.CART_DATABASE_URL, origin: process.env.CART_ORIGIN };
let f: Awaited<ReturnType<typeof cartFixture>>, reader: pg.Pool;
before(async () => { f = await cartFixture(origin); process.env.CART_DATABASE_URL = f.cartUrl; process.env.CART_ORIGIN = origin; reader = new pg.Pool(databaseConfig(f.readerUrl)); }, { timeout: 60000 });
beforeEach(async () => {
  await f.data.query("DELETE FROM cart_rate_limits");
  await f.data.query("UPDATE products SET status='PUBLISHED',published_at='2020-01-01' WHERE id=ANY($1::UUID[])", [[id(101), id(102)]]);
  await f.data.query("UPDATE product_prices SET amount_minor=CASE variant_id WHEN $1 THEN 245000 ELSE 1599000 END,is_active=true WHERE variant_id=ANY($2::UUID[])", [id(202), [id(201), id(202)]]);
  await f.data.query("UPDATE inventory SET on_hand=CASE variant_id WHEN $1 THEN 5 ELSE 1 END,reserved=0 WHERE variant_id=ANY($2::UUID[])", [id(202), [id(201), id(202)]]);
  await f.data.query("UPDATE boutique_locations SET is_active=false");
});
after(async () => { if (reader) await reader.end(); if (f) await f.close();
  for (const [key, value] of [["CART_DATABASE_URL", old.url], ["CART_ORIGIN", old.origin]]) { if (value === undefined) delete process.env[key!]; else process.env[key!] = value; }
});
type Body = { checkout: CheckoutView; message?: string; errors?: Record<string, string> };
async function request(session?: string, method = "GET", path = "", body?: unknown, headers: Record<string, string> = {}) {
  const response = await checkoutHttp(new Request(origin + "/api/checkout" + (path ? "/" + path : ""), { method,
    headers: { ...(session ? { Cookie: session } : {}), ...(method !== "GET" ? { Origin: origin, "Content-Type": "application/json" } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), path ? path.split("/") : []);
  return { response, body: await response.json() as Body };
}
async function start(variant = id(202)) {
  const response = await cartHttp(new Request(origin + "/api/cart/items", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ variantId: variant, quantity: 1 }) }), ["items"]);
  assert.equal(response.status, 200); const session = response.headers.getSetCookie()[0].split(";")[0];
  return { session, view: (await request(session)).body.checkout };
}
async function submit(session: string, details: CheckoutDetails, action = "draft", previous?: CheckoutView) {
  const view = previous ?? (await request(session)).body.checkout;
  return request(session, "POST", action, { details, fingerprint: view.fingerprint, draftRevision: view.draft?.revision ?? null });
}
async function location(active = true) {
  return (await f.data.query(`INSERT INTO boutique_locations(name,governorate,city_area,street_address,is_active)
    VALUES($1,$2,$3,$4,$5) RETURNING id`, [testLocation.name, testLocation.governorate, testLocation.city, testLocation.street, active])).rows[0].id as string;
}

test("empty and anonymous checkout loads safely without a session, database configuration or draft writes", async () => {
  const before = (await f.data.query("SELECT count(*) FROM checkout_drafts")).rows[0].count;
  const url = process.env.CART_DATABASE_URL; delete process.env.CART_DATABASE_URL;
  try { const result = await request(); assert.equal(result.response.status, 200); assert.equal(result.body.checkout.state, "CART_REVIEW"); assert.equal(result.body.checkout.cart.count, 0); }
  finally { process.env.CART_DATABASE_URL = url; }
  assert.equal((await f.data.query("SELECT count(*) FROM checkout_drafts")).rows[0].count, before);
});
test("eligible carts reuse the guest cookie and current authoritative selection without creating an order or a second session", async () => {
  const a = await start(); assert.equal(a.view.state, "CUSTOMER_DETAILS"); assert.equal(a.view.cart.subtotalMinor, "245000");
  const result = await request(a.session); assert.equal(result.response.headers.get("cache-control"), "private, no-store, max-age=0"); assert.equal(result.response.headers.getSetCookie().length, 0);
  assert.ok(!JSON.stringify(result.body).includes(a.session.split("=")[1])); assert.ok(!JSON.stringify(result.body).includes(f.cartUrl));
});
test("full private delivery validates, normalizes, saves and restores a review-ready draft", async () => {
  const a = await start(), details = { ...deliveryDetails(), phone: "010 0000-0001", email: " CHECKOUT-FIXTURE@BOUTIQUE.TEST " };
  const saved = await submit(a.session, details); assert.equal(saved.response.status, 200); assert.equal(saved.body.checkout.state, "REVIEW_READY");
  assert.ok(saved.body.checkout.details.phone === checkoutContact.phone && saved.body.checkout.details.email === checkoutContact.email);
  const restored = (await request(a.session)).body.checkout; assert.ok(JSON.stringify(restored.details) === JSON.stringify(saved.body.checkout.details)); assert.equal(restored.state, "REVIEW_READY");
});
test("review without saving validates a complete form while storing no personal draft", async () => {
  const a = await start(), before = (await f.data.query("SELECT count(*) FROM checkout_drafts")).rows[0].count;
  const result = await submit(a.session, deliveryDetails(), "review"); assert.equal(result.response.status, 200); assert.equal(result.body.checkout.state, "REVIEW_READY");
  assert.equal((await f.data.query("SELECT count(*) FROM checkout_drafts")).rows[0].count, before); assert.ok((await request(a.session)).body.checkout.details.fullName === "");
});
test("incomplete drafts restore their explicit preparation stage without claiming review readiness", async () => {
  const a = await start(); const partial = await submit(a.session, { ...emptyDetails(), fullName: checkoutContact.fullName });
  assert.equal(partial.response.status, 200); assert.equal(partial.body.checkout.state, "CUSTOMER_DETAILS");
  const contact = await submit(a.session, { ...emptyDetails(), ...checkoutContact }); assert.equal(contact.body.checkout.state, "FULFILLMENT");
  assert.equal((await submit(a.session, { ...emptyDetails(), ...checkoutContact }, "review")).response.status, 422);
});
test("Egyptian mobile formats normalize domestically, internationally and from Arabic digits without claiming verification", () => {
  for (const prefix of ["010", "011", "012", "015"]) { const domestic = prefix + "00000001"; assert.ok(egyptianMobile(domestic) === "+20" + domestic.slice(1)); }
  for (const value of ["010 0000-0001", "+20 (10) 0000-0001", "00201000000001", "٠١٠٠٠٠٠٠٠٠١"]) assert.ok(egyptianMobile(value) === checkoutContact.phone);
  for (const value of ["+20212345678", "+201999999999", "+212612345678", "01000", "01000000001x9", "1e10"]) assert.equal(egyptianMobile(value), null);
});
test("server contact validation rejects missing, malformed, oversized and injected values without echoing them", async () => {
  const a = await start();
  for (const [field, value] of [["fullName", ""], ["fullName", "1234"], ["fullName", "<script>alert(1)</script>"], ["email", "bad..name@boutique.test"], ["email", "missing-at"], ["phone", "+201999999999"]]) {
    const result = await submit(a.session, { ...deliveryDetails(), [field]: value }, "review"); assert.equal(result.response.status, 422); assert.ok(result.body.errors?.[field]); assert.ok(!JSON.stringify(result.body).includes("<script>"));
  }
});
test("governorates and Egypt-only address fields are controlled and delivery requirements are enforced", async () => {
  const a = await start(); assert.equal(governorates.length, 27);
  for (const [field, value] of [["governorate", "Helwan"], ["governorate", "Foreign province"], ["city", ""], ["street", "abc"], ["instructions", "x".repeat(501)]]) {
    const result = await submit(a.session, { ...deliveryDetails(), [field]: value }, "review"); assert.equal(result.response.status, 422); assert.ok(result.body.errors?.[field]);
  }
  const result = await submit(a.session, { ...deliveryDetails(), countryCode: "US" } as unknown as CheckoutDetails); assert.equal(result.response.status, 400);
});
test("collection offers only actual active database locations and rejects inactive or nonexistent choices", async () => {
  const a = await start(), active = await location(), inactive = await location(false);
  const view = (await request(a.session)).body.checkout; assert.deepEqual(view.locations.map((item) => item.id), [active]);
  const details = { ...emptyDetails(), ...checkoutContact, method: "BOUTIQUE_COLLECTION" as const, locationId: active };
  assert.equal((await submit(a.session, details, "review")).body.checkout.state, "REVIEW_READY");
  for (const locationId of [inactive, randomUUID(), "bad-identifier"]) assert.equal((await submit(a.session, { ...details, locationId }, "review")).response.status, 422);
});
test("no configured collection locations remains a truthful unavailable state", async () => {
  const a = await start(); assert.deepEqual(a.view.locations, []);
  const result = await submit(a.session, { ...emptyDetails(), ...checkoutContact, method: "BOUTIQUE_COLLECTION" }, "review"); assert.equal(result.response.status, 422); assert.ok(result.body.errors?.locationId);
});
test("switching fulfillment removes irrelevant personal fields from the persisted draft", async () => {
  const a = await start(); await submit(a.session, deliveryDetails()); const chosen = await location();
  const switched = await submit(a.session, { ...deliveryDetails(), method: "BOUTIQUE_COLLECTION", locationId: chosen }); assert.equal(switched.response.status, 200);
  for (const field of ["street", "building", "city", "governorate", "floorUnit", "instructions"] as const) assert.ok(switched.body.checkout.details[field] === "");
  const back = await submit(a.session, { ...deliveryDetails(), locationId: chosen }); assert.equal(back.response.status, 200); assert.ok(back.body.checkout.details.locationId === "");
});
test("draft access is isolated by cookie, and browser cart/draft/customer identities are never accepted", async () => {
  const a = await start(), b = await start(); await submit(a.session, deliveryDetails());
  const isolated = await request(b.session); assert.ok(!JSON.stringify(isolated.body).includes(checkoutContact.email)); assert.equal(isolated.body.checkout.draft, null);
  assert.equal((await request(b.session, "POST", "draft", { details: deliveryDetails(), fingerprint: b.view.fingerprint, draftRevision: null, cartId: randomUUID() })).response.status, 400);
  assert.equal((await request(undefined, "POST", "draft", {})).response.status, 401);
  const tampered = await request(`${cookieName()}=${"A".repeat(43)}`); assert.equal(tampered.body.checkout.draft, null);
});
test("expired guest sessions cannot expose old personal details and their drafts are physically purged", async () => {
  const a = await start(); await submit(a.session, deliveryDetails());
  await f.data.query("UPDATE carts SET created_at=now()-INTERVAL '2 days',expires_at=now()-INTERVAL '1 day' WHERE session_token_hash=$1", [tokenHash(a.session.split("=")[1])]);
  const result = await request(a.session); assert.equal(result.body.checkout.draft, null); assert.ok(!JSON.stringify(result.body).includes(checkoutContact.email));
  assert.equal((await f.data.query("SELECT count(*) FROM checkout_drafts d JOIN carts c ON c.id=d.cart_id WHERE c.session_token_hash=$1", [tokenHash(a.session.split("=")[1])])).rows[0].count, "0");
});
test("draft expiry is fixed at at most 24 hours, never slides, and erases expired personal rows", async () => {
  const a = await start(), saved = await submit(a.session, deliveryDetails()), expires = saved.body.checkout.draft!.expiresAt;
  const updated = await submit(a.session, { ...deliveryDetails(), building: "Another test building" }); assert.equal(updated.body.checkout.draft!.expiresAt, expires);
  await f.data.query("UPDATE checkout_drafts SET created_at=now()-INTERVAL '25 hours',expires_at=now()-INTERVAL '1 hour' WHERE cart_id=(SELECT id FROM carts WHERE session_token_hash=$1)", [tokenHash(a.session.split("=")[1])]);
  const result = await request(a.session); assert.equal(result.body.checkout.draft, null); assert.ok(result.body.checkout.details.email === "");
});
test("cart edits and changed prices invalidate the prepared context until explicitly reviewed again", async () => {
  const a = await start(); await submit(a.session, deliveryDetails()); const previous = (await request(a.session)).body.checkout;
  await f.data.query("UPDATE product_prices SET amount_minor=12345 WHERE variant_id=$1", [id(202)]);
  const stale = await submit(a.session, deliveryDetails(), "review", previous); assert.equal(stale.response.status, 409); assert.equal(stale.body.checkout.state, "CART_REVIEW");
  const fresh = (await request(a.session)).body.checkout; assert.equal(fresh.cart.subtotalMinor, "12345"); assert.equal(fresh.changed, true);
  const reviewed = await submit(a.session, deliveryDetails(), "review", fresh); assert.equal(reviewed.response.status, 200); assert.equal(reviewed.body.checkout.state, "REVIEW_READY");
  await f.data.query("UPDATE cart_items SET quantity=2 WHERE cart_id=(SELECT id FROM carts WHERE session_token_hash=$1)", [tokenHash(a.session.split("=")[1])]);
  assert.equal((await submit(a.session, deliveryDetails(), "review", fresh)).response.status, 409);
});
test("unpublished, stock-reduced and sold unique selections cannot become review-ready", async () => {
  for (const variant of [201, 202]) {
    const a = await start(id(variant)); await f.data.query("UPDATE inventory SET on_hand=0 WHERE variant_id=$1", [id(variant)]);
    const result = await submit(a.session, deliveryDetails(), "review"); assert.equal(result.response.status, 422); assert.equal(result.body.checkout.cart.eligible, false);
  }
  await f.data.query("UPDATE inventory SET on_hand=5 WHERE variant_id=$1", [id(202)]); const a = await start();
  await f.data.query("UPDATE products SET status='DRAFT' WHERE id=$1", [id(102)]); assert.equal((await submit(a.session, deliveryDetails(), "review")).response.status, 422);
});
test("collection configuration changes invalidate a previously reviewed destination", async () => {
  const a = await start(), chosen = await location();
  const details = { ...emptyDetails(), ...checkoutContact, method: "BOUTIQUE_COLLECTION" as const, locationId: chosen };
  const saved = await submit(a.session, details); assert.equal(saved.body.checkout.state, "REVIEW_READY");
  await f.data.query("UPDATE boutique_locations SET is_active=false WHERE id=$1", [chosen]);
  const loaded = (await request(a.session)).body.checkout; assert.equal(loaded.state, "CART_REVIEW"); assert.deepEqual(loaded.locations, []);
  assert.equal((await submit(a.session, details, "review")).response.status, 422);
});
test("draft versions prevent stale concurrent personal-detail overwrites and allow explicit deletion", async () => {
  const a = await start(), original = (await submit(a.session, deliveryDetails())).body.checkout;
  const results = await Promise.all(["First fixture", "Second fixture"].map((fullName) => submit(a.session, { ...deliveryDetails(), fullName }, "draft", original)));
  assert.deepEqual(results.map((item) => item.response.status).sort(), [200, 409]);
  const current = (await request(a.session)).body.checkout;
  const cleared = await request(a.session, "DELETE", "draft", { draftRevision: current.draft!.revision }); assert.equal(cleared.response.status, 200); assert.equal(cleared.body.checkout.draft, null);
});
test("monetary calculations reuse exact EGP cart amounts above JavaScript's safe integer range", async () => {
  await f.data.query("UPDATE product_prices SET amount_minor=9007199254740993 WHERE variant_id=$1", [id(202)]);
  const a = await start(); assert.equal(a.view.cart.subtotalMinor, "9007199254740993");
  const reviewed = await submit(a.session, deliveryDetails(), "review"); assert.equal(reviewed.body.checkout.cart.items[0].lineTotalMinor, "9007199254740993");
});
test("origin, bounded JSON, unknown fields, monetary claims and unsupported methods fail without personal writes", async () => {
  const a = await start();
  for (const value of ["https://hostile.test", "null", ""]) assert.equal((await request(a.session, "POST", "draft", {}, { Origin: value })).response.status, 403);
  assert.equal((await request(a.session, "POST", "draft", {}, { "Sec-Fetch-Site": "cross-site" })).response.status, 403);
  assert.equal((await request(a.session, "POST", "draft", { ...deliveryDetails(), amount: 1 })).response.status, 400);
  assert.equal((await request(a.session, "POST", "draft", { junk: "x".repeat(9000) })).response.status, 413);
  const malformed = await checkoutHttp(new Request(origin + "/api/checkout/draft", { method: "POST", headers: { Origin: origin, Cookie: a.session, "Content-Type": "application/json" }, body: "{" }), ["draft"]); assert.equal(malformed.status, 400);
  assert.equal((await request(a.session, "PUT")).response.status, 405);
  const output = await request(a.session); assert.ok(!JSON.stringify(output.body).includes(checkoutContact.email));
});
test("preparation leaves inventory and all customer/order/payment/fulfillment history untouched and public readers cannot read draft PII", async () => {
  const before = (await f.data.query("SELECT * FROM inventory ORDER BY id")).rows;
  const a = await start(); await submit(a.session, deliveryDetails()); await submit(a.session, deliveryDetails(), "review");
  assert.deepEqual((await f.data.query("SELECT * FROM inventory ORDER BY id")).rows, before);
  for (const table of ["orders", "order_items", "order_addresses", "payments", "inventory_reservations", "fulfillment_arrangements", "customer_profiles", "customer_addresses"]) assert.equal((await f.data.query(`SELECT count(*) FROM ${table}`)).rows[0].count, "0");
  await assert.rejects(reader.query("SELECT * FROM checkout_drafts"), { code: "42501" });
});
test("the bounded retention command physically removes abandoned personal drafts without logging their values", async () => {
  const a = await start(); await submit(a.session, deliveryDetails());
  await f.data.query("UPDATE carts SET status='ABANDONED' WHERE session_token_hash=$1", [tokenHash(a.session.split("=")[1])]);
  const output = await new Promise<{ code: number | null; text: string }>((done, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--conditions=react-server", resolve("scripts/purge-checkout.mts")], { env: { ...process.env, CART_DATABASE_URL: f.cartUrl }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let text = ""; child.stdout.on("data", (chunk: Buffer) => { text += chunk.toString(); }); child.stderr.on("data", (chunk: Buffer) => { text += chunk.toString(); }); child.on("error", reject); child.on("close", (code) => done({ code, text }));
  });
  assert.equal(output.code, 0); assert.match(output.text, /draft\(s\) deleted/);
  for (const privateValue of [checkoutContact.email, checkoutContact.phone, checkoutContact.fullName, deliveryDetails().street, f.cartUrl, a.session.split("=")[1]]) assert.ok(!output.text.includes(privateValue));
  assert.equal((await f.data.query("SELECT count(*) FROM checkout_drafts d JOIN carts c ON c.id=d.cart_id WHERE c.session_token_hash=$1", [tokenHash(a.session.split("=")[1])])).rows[0].count, "0");
  assert.equal(await purgeCheckoutDrafts(1), 0);
});

test("production refuses persistent PII until retention is acknowledged while unsaved review remains operational", async () => {
  const a = await start(), previousEnvironment = process.env.NODE_ENV, previousReady = process.env.CHECKOUT_DRAFT_RETENTION_READY;
  const count = (await f.data.query("SELECT count(*) FROM checkout_drafts")).rows[0].count;
  try {
    Reflect.set(process.env, "NODE_ENV", "production"); delete process.env.CHECKOUT_DRAFT_RETENTION_READY;
    const token = a.session.split("=")[1], base = { details: deliveryDetails(), fingerprint: a.view.fingerprint, revision: null };
    assert.equal((await prepareCheckout(token, { ...base, action: "save" })).status, 503);
    assert.equal((await prepareCheckout(token, { ...base, action: "review" })).status, 200);
    assert.equal((await f.data.query("SELECT count(*) FROM checkout_drafts")).rows[0].count, count);
  } finally {
    if (previousEnvironment === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Reflect.set(process.env, "NODE_ENV", previousEnvironment);
    if (previousReady === undefined) delete process.env.CHECKOUT_DRAFT_RETENTION_READY; else process.env.CHECKOUT_DRAFT_RETENTION_READY = previousReady;
  }
});

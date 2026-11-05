import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { paymentFixture } from "./helpers/payment-fixture.mts";
import { product, variant, editable } from "./helpers/catalogue-fixture.mts";
import { cloudinaryMock, mockCloudinaryConfiguration } from "./helpers/cloudinary-mock.mts";
import { paymentEnvironment, paymobMock, signedTransaction, transactionFixture } from "./helpers/paymob-mock.mts";
import { deliveryDetails } from "./helpers/checkout-data.mts";
import { developmentId } from "../db/tools/seed.ts";
import { quotationOnly } from "../src/lib/commerce-policy.ts";
import { saveProduct } from "../src/lib/admin/catalogue/products.ts";
import { readEditor } from "../src/lib/admin/catalogue/read.ts";
import { metalGrams, parseSubmission, CatalogueAdminError } from "../src/lib/admin/catalogue/validation.ts";
import { uploadPhoto } from "../src/lib/admin/catalogue/media.ts";
import { cloudinaryProvider } from "../src/lib/media/cloudinary.ts";
import { getPublishedProductBySlug, getPublishedProducts } from "../src/lib/catalogue/repository.ts";
import { cartHttp } from "../src/lib/cart/http.ts";
import { mutateCart, readCart } from "../src/lib/cart/repository.ts";
import { checkoutHttp } from "../src/lib/checkout/http.ts";
import { prepareCheckout } from "../src/lib/checkout/repository.ts";
import { paymentHttp, orderHttp } from "../src/lib/payments/http.ts";
import { initiateLocal, readOrder, retryLocal } from "../src/lib/payments/orders.ts";
import { initiatePayment, reconcilePayments, retryPayment } from "../src/lib/payments/service.ts";
import { paymentsAvailable } from "../src/lib/payments/config.ts";
import type { EditorProduct, ProductInput } from "../src/lib/admin/catalogue/types.ts";
import type { Cart } from "../src/lib/cart/types.ts";
import type { CheckoutView } from "../src/lib/checkout/types.ts";

// These fixtures enforce an explicit disposable loopback PostgreSQL cluster.
// Provider adapters below are synthetic; no real merchant or media is accessed.
const origin = "https://quotation.boutique.test";
const envNames = [...Object.keys(paymentEnvironment), "COMMERCE_MODE", "DATABASE_URL", "CART_DATABASE_URL", "CART_ORIGIN", "PAYMENT_DATABASE_URL", "CHECKOUT_DRAFT_RETENTION_READY"];
const old = new Map(envNames.map((key) => [key, process.env[key]])), originalFetch = globalThis.fetch;
let f: Awaited<ReturnType<typeof paymentFixture>>, headers: Headers, mock: ReturnType<typeof paymobMock>, photograph: Uint8Array;
before(async () => {
  f = await paymentFixture(origin); headers = await f.headers("CATALOGUE_MANAGER");
  mock = paymobMock();
  Object.assign(process.env, paymentEnvironment, { DATABASE_URL: f.readerUrl, CART_DATABASE_URL: f.cartUrl, CART_ORIGIN: origin, PAYMENT_DATABASE_URL: f.paymentUrl, CHECKOUT_DRAFT_RETENTION_READY: "true" });
  photograph = new Uint8Array(await sharp({ create: { width: 300, height: 300, channels: 3, background: "#526941" } }).png().toBuffer());
}, { timeout: 60000 });
beforeEach(async () => { delete process.env.COMMERCE_MODE; globalThis.fetch = mock.fakeFetch; await f.data.query("DELETE FROM admin_auth_rate_limits"); await f.data.query("DELETE FROM cart_rate_limits"); });
after(async () => { globalThis.fetch = originalFetch; if (f) await f.close(); for (const [key, value] of old) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

async function editor(id: string) { const current = await readEditor(headers, id, f.runtime); assert.ok(current); return current; }
async function create(extra: Partial<ProductInput> = {}) {
  return saveProduct(headers, null, { product: product("Local quotation " + randomUUID(), { slug: "", salesMode: "BOTH", variants: [variant("")], ...extra }), action: "save" }, f.runtime);
}
function input(current: EditorProduct): ProductInput {
  const value = editable(current);
  return { ...value, variants: value.variants.map((variant, index) => ({ ...variant, metalWeightGrams: current.variants[index].metalWeightGrams ?? "", metalWeightBasis: current.variants[index].metalWeightBasis ?? "" })) };
}
async function save(id: string, change: (value: ProductInput) => void = () => {}, action = "save") {
  const current = await editor(id), value = input(current); change(value);
  return saveProduct(headers, id, { product: value, revision: current.revision, action }, f.runtime);
}
async function publish(extra: Partial<ProductInput> = {}) {
  const id = await create({ categoryIds: [developmentId(1)], ...extra });
  const media = cloudinaryMock(); await uploadPhoto(headers, id, photograph, "image/png", "Local quotation fixture photograph", f.runtime, cloudinaryProvider(mockCloudinaryConfiguration, media.fakeFetch));
  await save(id, () => {}, "publish"); return editor(id);
}
async function cart(session?: string, method = "GET", path: string[] = [], value?: unknown) {
  const response = await cartHttp(new Request(origin + "/api/cart" + (path.length ? "/" + path.join("/") : ""), { method, headers: { ...(session ? { Cookie: session } : {}), Origin: origin, "Content-Type": "application/json" }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) }), path);
  return { response, body: await response.json() as { cart: Cart; message?: string } };
}
async function guest() {
  process.env.COMMERCE_MODE = "DIRECT_SALES";
  const added = await cart(undefined, "POST", ["items"], { variantId: developmentId(202), quantity: 1 }); assert.equal(added.response.status, 200);
  const session = added.response.headers.getSetCookie()[0].split(";")[0], token = session.split("=")[1];
  const loaded = await checkoutHttp(new Request(origin + "/api/checkout", { headers: { Cookie: session } })), initial = (await loaded.json()).checkout as CheckoutView;
  const details = deliveryDetails();
  const saved = await checkoutHttp(new Request(origin + "/api/checkout/draft", { method: "POST", headers: { Cookie: session, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ details, fingerprint: initial.fingerprint, draftRevision: null }) }), ["draft"]);
  assert.equal(saved.status, 200); const view = (await saved.json()).checkout as CheckoutView;
  return { session, token, cart: added.body.cart, view, details };
}
async function counts() {
  return (await f.data.query("SELECT (SELECT count(*) FROM carts)::int AS carts,(SELECT count(*) FROM cart_items)::int AS items,(SELECT count(*) FROM checkout_drafts)::int AS drafts,(SELECT count(*) FROM orders)::int AS orders,(SELECT count(*) FROM order_items)::int AS lines,(SELECT count(*) FROM payments)::int AS payments,(SELECT count(*) FROM inventory_reservations)::int AS holds")).rows[0];
}
async function financial(order: string) {
  return { orders: (await f.data.query("SELECT total_minor,payment_status,order_status FROM orders WHERE id=$1", [order])).rows,
    lines: (await f.data.query("SELECT sku_snapshot,product_name_snapshot,configuration_snapshot,quantity,unit_price_minor,line_total_minor FROM order_items WHERE order_id=$1 ORDER BY id", [order])).rows };
}

test("quotation-only is fail-closed and only the private exact reviewed mode opts into direct sales", () => {
  for (const mode of [undefined, "", "QUOTATION_ONLY", "direct_sales", "unknown", "true"]) {
    if (mode === undefined) delete process.env.COMMERCE_MODE; else process.env.COMMERCE_MODE = mode;
    assert.equal(quotationOnly(), true); assert.equal(paymentsAvailable(), false);
  }
  const previousPublicMode = process.env.NEXT_PUBLIC_COMMERCE_MODE; process.env.NEXT_PUBLIC_COMMERCE_MODE = "DIRECT_SALES";
  try { delete process.env.COMMERCE_MODE; assert.equal(quotationOnly(), true); }
  finally { if (previousPublicMode === undefined) delete process.env.NEXT_PUBLIC_COMMERCE_MODE; else process.env.NEXT_PUBLIC_COMMERCE_MODE = previousPublicMode; }
  process.env.COMMERCE_MODE = "DIRECT_SALES"; assert.equal(quotationOnly(), false); assert.equal(paymentsAvailable(), true);
});

test("quotation publication accepts no price while preserving every other publication gate", async () => {
  const published = await publish(); assert.equal(published.status, "PUBLISHED"); assert.equal(published.salesMode, "BOTH"); assert.equal(published.variants[0].priceEGP, "");
  const publicProduct = await getPublishedProductBySlug(published.slug); assert.ok(publicProduct); assert.equal(publicProduct.fromPrice, null); assert.equal(publicProduct.canPurchase, false); assert.equal(publicProduct.canEnquire, true);
  process.env.COMMERCE_MODE = "DIRECT_SALES";
  const future = await getPublishedProductBySlug(published.slug); assert.ok(future); assert.equal(future.canPurchase, false); assert.equal(future.variants[0].price, null);
  await assert.rejects(save(published.id), (error: unknown) => error instanceof CatalogueAdminError && error.fieldPath === "product.variants.0.priceEGP");
  delete process.env.COMMERCE_MODE;
  for (const [change, field] of [
    [(value: ProductInput) => { value.description = ""; }, "product.description"],
    [(value: ProductInput) => { value.categoryIds = []; }, "product.categoryIds"],
    [(value: ProductInput) => { value.variants[0].active = false; }, "product.variants"],
  ] as const) await assert.rejects(save(published.id, change), (error: unknown) => error instanceof CatalogueAdminError && error.fieldPath === field);
  const noPhoto = await create({ categoryIds: [developmentId(1)] }); await assert.rejects(save(noPhoto, () => {}, "publish"), /photograph/i);
});

test("ordinary quotation-only edits preserve direct, both and enquiry-mode active prices and their history", async () => {
  for (const salesMode of ["DIRECT_PURCHASE", "BOTH", "ENQUIRY_ONLY"] as const) {
    const id = await create({ salesMode, variants: [variant("", { priceEGP: "90071992547409.93" })] });
    const before = await f.data.query("SELECT id,amount_minor::text,is_active,updated_at FROM product_prices WHERE variant_id=$1 ORDER BY id", [(await editor(id)).variants[0].id]);
    assert.equal((await editor(id)).variants[0].priceEGP, "90071992547409.93");
    await save(id, (value) => { value.name += " edited"; value.description = "Local ordinary metadata edit preserving a private exact price."; });
    assert.equal((await editor(id)).salesMode, salesMode); assert.equal((await editor(id)).variants[0].priceEGP, "90071992547409.93");
    assert.deepEqual((await f.data.query("SELECT id,amount_minor::text,is_active,updated_at FROM product_prices WHERE variant_id=$1 ORDER BY id", [(await editor(id)).variants[0].id])).rows, before.rows);
  }
});

test("public quotation projections redact all configured prices without changing persisted sales modes or price rows", async () => {
  const published = await publish({ salesMode: "DIRECT_PURCHASE", variants: [variant("", { priceEGP: "918273.64", initialStock: 1, stockReason: "One disposable quotation fixture" })] });
  const detail = await getPublishedProductBySlug(published.slug); assert.ok(detail);
  assert.equal(detail.salesMode, "ENQUIRY_ONLY"); assert.equal(detail.fromPrice, null); assert.equal(detail.canPurchase, false); assert.equal(detail.canEnquire, true);
  for (const variant of detail.variants) { assert.equal(variant.price, null); assert.equal(variant.canPurchase, false); assert.equal(variant.availability, "ENQUIRY_ONLY"); }
  assert.equal(JSON.stringify(detail).includes("91827364"), false);
  const listing = await getPublishedProducts(); assert.ok(listing.items.every((item) => item.fromPrice === null && !item.canPurchase && item.canEnquire));
  const privateProduct = await editor(published.id); assert.equal(privateProduct.salesMode, "DIRECT_PURCHASE"); assert.equal(privateProduct.variants[0].priceEGP, "918273.64");
});

test("new cart adds and stale-cart quantity updates are denied at HTTP and repository boundaries, while removal works", async () => {
  const a = await guest(); delete process.env.COMMERCE_MODE;
  const before = await counts(), stock = (await f.data.query("SELECT on_hand,reserved FROM inventory WHERE variant_id=$1", [developmentId(202)])).rows;
  assert.equal((await cart(undefined, "POST", ["items"], { variantId: developmentId(202), quantity: 1 })).response.status, 409);
  assert.equal((await cart(a.session, "PATCH", ["items", a.cart.items[0].id], { quantity: 2, revision: a.cart.revision })).response.status, 409);
  assert.ok("error" in await mutateCart(null, { kind: "add", variantId: developmentId(202), quantity: 1 }));
  assert.ok("error" in await mutateCart(a.token, { kind: "update", itemId: a.cart.items[0].id, quantity: 2, revision: a.cart.revision! }));
  const stale = await readCart(a.token); assert.equal(stale.cart.items.length, 1); assert.equal(stale.cart.eligible, false); assert.equal(stale.cart.subtotalMinor, null);
  assert.equal(stale.cart.items[0].unitPriceMinor, null); assert.equal(stale.cart.items[0].lineTotalMinor, null); assert.equal(stale.cart.items[0].maxQuantity, 0);
  assert.deepEqual(await counts(), before); assert.deepEqual((await f.data.query("SELECT on_hand,reserved FROM inventory WHERE variant_id=$1", [developmentId(202)])).rows, stock);
  const removed = await cart(a.session, "DELETE", ["items", a.cart.items[0].id], { revision: stale.cart.revision }); assert.equal(removed.response.status, 200); assert.equal(removed.body.cart.items.length, 0);
});

test("stale checkout GET, save and review cannot advance purchases or expose old details, and owned deletion remains available", async () => {
  const a = await guest(); delete process.env.COMMERCE_MODE; const before = await counts();
  const loaded = await checkoutHttp(new Request(origin + "/api/checkout", { headers: { Cookie: a.session } })), body = await loaded.json();
  assert.equal(loaded.status, 200); assert.equal(loaded.headers.get("set-cookie"), null); assert.equal(body.paymentsAvailable, false); assert.equal(body.checkout.cart.items.length, 0); assert.equal(body.checkout.details.fullName, ""); assert.equal(body.checkout.savingAvailable, false);
  for (const action of ["draft", "review"]) {
    const response = await checkoutHttp(new Request(origin + "/api/checkout/" + action, { method: "POST", headers: { Cookie: a.session, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ details: a.details, fingerprint: a.view.fingerprint, draftRevision: a.view.draft!.revision }) }), [action]); assert.equal(response.status, 409);
  }
  for (const action of ["save", "review"] as const) assert.equal((await prepareCheckout(a.token, { action, details: a.details, fingerprint: a.view.fingerprint, revision: a.view.draft!.revision })).status, 409);
  assert.deepEqual(await counts(), before);
  const removed = await checkoutHttp(new Request(origin + "/api/checkout/draft", { method: "DELETE", headers: { Cookie: a.session, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ draftRevision: a.view.draft!.revision }) }), ["draft"]); assert.equal(removed.status, 200);
  assert.equal((await counts()).drafts, before.drafts - 1);
});

test("all-enabled provider flags cannot bypass quotation-only order creation or service initiation", async () => {
  const a = await guest(); delete process.env.COMMERCE_MODE; const before = await counts();
  await assert.rejects(initiateLocal(a.token, a.view.fingerprint, a.view.draft!.revision), { status: 409 });
  await assert.rejects(initiatePayment(a.token, a.view.fingerprint, a.view.draft!.revision, mock.fakeFetch), { status: 409 });
  const response = await paymentHttp(new Request(origin + "/api/payments/initiate", { method: "POST", headers: { Cookie: a.session, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ fingerprint: a.view.fingerprint, draftRevision: a.view.draft!.revision }) }), ["initiate"]);
  assert.equal(response.status, 409); assert.deepEqual(await counts(), before); assert.equal(mock.calls.length, 0);
});

test("quotation-only blocks pending LOCAL_READY and READY attempt resume without changing orders, holds or provider state", async () => {
  for (const dispatched of [false, true]) {
    const a = await guest();
    const result = dispatched ? await initiatePayment(a.token, a.view.fingerprint, a.view.draft!.revision, mock.fakeFetch) : await initiateLocal(a.token, a.view.fingerprint, a.view.draft!.revision);
    const reference = "orderReference" in result ? result.orderReference : "order" in result ? result.order.id : ""; assert.ok(reference);
    const attempt = (await f.data.query("SELECT local_reference FROM payments WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1", [reference])).rows[0].local_reference;
    delete process.env.COMMERCE_MODE; const before = await counts(), snapshot = await financial(reference), calls = mock.calls.length;
    await assert.rejects(retryLocal(a.token, reference, attempt), { status: 409 }); await assert.rejects(retryPayment(a.token, reference, attempt, mock.fakeFetch), { status: 409 });
    await assert.rejects(initiatePayment(a.token, a.view.fingerprint, a.view.draft!.revision, mock.fakeFetch), { status: 409 });
    const response = await orderHttp(new Request(origin + `/api/orders/${reference}/payment`, { method: "POST", headers: { Cookie: a.session, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ attemptReference: attempt }) }), [reference, "payment"]);
    assert.equal(response.status, 409); assert.deepEqual(await counts(), before); assert.deepEqual(await financial(reference), snapshot); assert.equal(mock.calls.length, calls);
  }
});

test("verified historical callbacks still finalize exactly once under quotation-only policy and immutable snapshots remain visible", async () => {
  const a = await guest(), initiated = await initiatePayment(a.token, a.view.fingerprint, a.view.draft!.revision, mock.fakeFetch), reference = initiated.orderReference;
  const payment = (await f.data.query("SELECT * FROM payments WHERE order_id=$1", [reference])).rows[0], snapshots = await financial(reference);
  delete process.env.COMMERCE_MODE;
  const signed = signedTransaction(transactionFixture(payment.provider_order_reference, Number(payment.amount_minor), { id: 292036465 }));
  const callback = () => paymentHttp(new Request(origin + "/api/payments/paymob/callback?hmac=" + signed.signature, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signed.body) }), ["paymob", "callback"]);
  assert.ok((await Promise.all([callback(), callback()])).every((response) => response.status === 200));
  const historical = await readOrder(a.token, reference); assert.ok(historical); assert.equal(historical.paymentStatus, "PAID"); assert.equal(historical.amountMinor, snapshots.orders[0].total_minor); assert.equal(historical.items[0].unitPriceMinor, snapshots.lines[0].unit_price_minor);
  assert.equal((await financial(reference)).lines[0].unit_price_minor, snapshots.lines[0].unit_price_minor);
  assert.equal((await f.data.query("SELECT count(*)::int AS count FROM inventory_reservations WHERE order_id=$1 AND status='CONSUMED'", [reference])).rows[0].count, 1);
  assert.equal((await f.data.query("SELECT count(*)::int AS count FROM order_status_history WHERE order_id=$1 AND state_domain='PAYMENT' AND to_status='PAID'", [reference])).rows[0].count, 1);
});

test("authenticated reconciliation remains available when quotation-only policy has disabled new payment initiation", async () => {
  const a = await guest(), initiated = await initiatePayment(a.token, a.view.fingerprint, a.view.draft!.revision, mock.fakeFetch), reference = initiated.orderReference;
  const payment = (await f.data.query("SELECT * FROM payments WHERE order_id=$1", [reference])).rows[0], remote = mock.intentions.get(payment.local_reference); assert.ok(remote);
  mock.observations.set(payment.local_reference, transactionFixture(remote.orderId, remote.amount, { id: 392036465, order: { id: Number(remote.orderId), merchant_order_id: payment.local_reference } }));
  await f.data.query("UPDATE payments SET next_reconcile_at=now()-INTERVAL '1 minute',reconcile_lease_until=NULL WHERE id=$1", [payment.id]); delete process.env.COMMERCE_MODE;
  await reconcilePayments(50, mock.fakeFetch); assert.equal((await readOrder(a.token, reference))?.paymentStatus, "PAID"); assert.equal(paymentsAvailable(), false);
});

test("metal grams use exact positive three-place decimals and require a paired measurement basis", () => {
  assert.equal(metalGrams("1.2"), "1.200"); assert.equal(metalGrams("0.001"), "0.001"); assert.equal(metalGrams("9999999.999"), "9999999.999"); assert.equal(metalGrams(""), "");
  for (const invalid of ["0", "0.000", "-1", "01", "1e3", "NaN", "Infinity", "1.2345", "10000000", "1,234", " 0 "]) assert.throws(() => metalGrams(invalid), CatalogueAdminError);
  for (const details of [{ metalWeightGrams: "1.250" }, { metalWeightBasis: "ACTUAL" }, { metalWeightGrams: "1", metalWeightBasis: "GUESSED" }]) assert.throws(() => parseSubmission({ product: { ...product("Local invalid grams"), variants: [{ ...variant(""), ...details }] }, action: "save" }), CatalogueAdminError);
});

test("metal measurements round-trip, survive legacy omitted-field edits, and only explicit empty pairs clear them", async () => {
  const id = await create({ variants: [variant("", { metalType: "", metalPurity: "18K", metalWeightGrams: "12.345", metalWeightBasis: "ACTUAL" })] });
  let current = await editor(id); assert.equal(current.variants[0].metalWeightGrams, "12.345"); assert.equal(current.variants[0].metalWeightBasis, "ACTUAL");
  const legacy = editable(current); legacy.description = "Local legacy metadata save preserving a known exact metal measurement.";
  delete legacy.variants[0].metalWeightGrams; delete legacy.variants[0].metalWeightBasis;
  await saveProduct(headers, id, { product: legacy, revision: current.revision, action: "save" }, f.runtime);
  current = await editor(id); assert.equal(current.variants[0].metalWeightGrams, "12.345"); assert.equal(current.variants[0].metalWeightBasis, "ACTUAL"); assert.equal(current.variants[0].metalPurity, "18K");
  await save(id, (value) => { value.variants[0].metalWeightGrams = "0.001"; value.variants[0].metalWeightBasis = "ESTIMATED"; });
  current = await editor(id); assert.equal(current.variants[0].metalWeightGrams, "0.001"); assert.equal(current.variants[0].metalWeightBasis, "ESTIMATED");
  await save(id, (value) => { value.variants[0].metalWeightGrams = ""; value.variants[0].metalWeightBasis = ""; });
  const stored = (await f.data.query("SELECT metal_weight_grams,metal_weight_basis FROM product_variants WHERE id=$1", [current.variants[0].id])).rows[0]; assert.deepEqual(stored, { metal_weight_grams: null, metal_weight_basis: null });
});

test("quotation public detail retains exact known grams, basis and purity without inventing a metal type", async () => {
  const published = await publish({ variants: [variant("", { metalPurity: "18K", metalWeightGrams: "9.001", metalWeightBasis: "ESTIMATED" })] });
  const detail = await getPublishedProductBySlug(published.slug); assert.ok(detail); assert.equal(detail.variants[0].metalType, null); assert.equal(detail.variants[0].metalPurity, "18K"); assert.equal(detail.variants[0].metalWeightGrams, "9.001"); assert.equal(detail.variants[0].metalWeightBasis, "ESTIMATED"); assert.equal(detail.variants[0].price, null);
});

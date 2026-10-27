import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { adminBrowserHarness } from "./helpers/admin-browser.mts";
import { checkoutContact, deliveryDetails, testLocation } from "./helpers/checkout-data.mts";
import { developmentId as id } from "../db/tools/seed.ts";
import { tokenHash } from "../src/lib/cart/session.ts";

const harness = adminBrowserHarness(false, true), { origin, screenshot } = harness;
let browser: ReturnType<typeof harness.current>["browser"], f: ReturnType<typeof harness.current>["fixture"];
beforeEach(async () => {
  ({ browser, fixture: f } = harness.current());
  await f.data.query("UPDATE boutique_locations SET is_active=false");
  await f.data.query("UPDATE products SET status='PUBLISHED',published_at='2020-01-01' WHERE id=ANY($1::UUID[])", [[id(101), id(102)]]);
  await f.data.query("UPDATE inventory SET on_hand=CASE variant_id WHEN $1 THEN 5 ELSE 1 END,reserved=0 WHERE variant_id=ANY($2::UUID[])", [id(202), [id(201), id(202)]]);
  await f.data.query("UPDATE product_prices SET amount_minor=245000 WHERE variant_id=$1 AND is_active", [id(202)]);
  for (const value of [checkoutContact.fullName, checkoutContact.email, checkoutContact.phone, deliveryDetails().street, deliveryDetails().instructions]) harness.trackSecret(value);
});
type Page = Awaited<ReturnType<typeof browser.newPage>>;
type Context = Awaited<ReturnType<typeof browser.newContext>>;
async function start(context: Context, variant = id(202)) {
  const response = await context.request.post(origin + "/api/cart/items", { headers: { Origin: origin }, data: { variantId: variant, quantity: 1 } }); assert.equal(response.status(), 200);
  const cookie = (await context.cookies()).find((item: { name: string }) => item.name === "__Host-la-palme-bag"); assert.ok(cookie); harness.trackSecret(cookie.value);
  return tokenHash(cookie.value);
}
async function operation(page: Page, label: string, path: string, status = 200, method = "POST") {
  const result = page.waitForResponse((r: { url(): string; request(): { method(): string } }) => r.url() === origin + "/api/checkout/" + path && r.request().method() === method);
  await page.getByRole("button", { name: label, exact: true }).click(); assert.equal((await result).status(), status);
  await page.locator("main").getByRole("alert").waitFor();
}
async function refresh(page: Page) {
  await page.bringToFront(); const result = page.waitForResponse((r: { url(): string }) => r.url() === origin + "/api/checkout");
  await page.evaluate(() => window.dispatchEvent(new Event("focus"))); assert.equal((await result).status(), 200);
}
async function contact(page: Page) {
  await page.getByLabel("Full name", { exact: true }).fill(checkoutContact.fullName);
  await page.getByLabel("Email address", { exact: true }).fill(checkoutContact.email);
  await page.getByLabel("Egyptian mobile number", { exact: true }).fill("010 0000-0001");
}
async function address(page: Page) {
  const data = deliveryDetails(); await page.getByRole("radio", { name: "Private Delivery", exact: true }).check();
  await page.getByLabel("Governorate", { exact: true }).selectOption("Cairo");
  await page.getByLabel("City or area", { exact: true }).fill(data.city); await page.getByLabel("Street address", { exact: true }).fill(data.street);
  await page.getByLabel("Building or villa (if applicable)", { exact: true }).fill(data.building);
  await page.getByLabel("Floor or apartment (optional)", { exact: true }).fill(data.floorUnit);
  await page.getByLabel("Delivery instructions (optional)", { exact: true }).fill(data.instructions);
}
async function healthy(page: Page) {
  assert.match(await page.title(), /Checkout Preparation/); assert.equal(await page.locator("h1").count(), 1);
  assert.equal(await page.locator("nextjs-portal").count(), 0); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.equal(await page.getByRole("button", { name: /place order|pay now/i }).count(), 0);
}

test("desktop private delivery enters from the bag, saves, restores and reviews without ordering", async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  try {
    await start(context); const page = await context.newPage(), errors: string[] = [];
    page.on("pageerror", () => errors.push("Runtime error")); page.on("console", (message: { type(): string }) => { if (["error", "warning"].includes(message.type())) errors.push("Console error/warning"); });
    await page.goto(origin + "/cart", { waitUntil: "networkidle" }); await page.getByRole("link", { name: "Continue to checkout", exact: true }).click();
    await page.waitForURL(origin + "/checkout"); await page.getByLabel("Full name", { exact: true }).waitFor();
    assert.equal(await page.getByRole("radio", { name: "Boutique Collection", exact: true }).isDisabled(), true);
    await contact(page); await address(page); await operation(page, "Save draft", "draft");
    await page.getByRole("region", { name: "Review-ready checkout", exact: true }).waitFor();
    await page.reload({ waitUntil: "networkidle" }); assert.ok(await page.getByLabel("Email address", { exact: true }).inputValue() === checkoutContact.email);
    await operation(page, "Review details", "review"); await page.getByRole("region", { name: "Review-ready checkout", exact: true }).waitFor();
    assert.match(await page.locator("[data-checkout-subtotal]").innerText(), /2,450\.00/); await healthy(page);
    await page.evaluate(() => { window.scrollTo(0, 0); return document.fonts.ready; }); await screenshot(page, "checkout-desktop");
    await page.getByRole("region", { name: "Review-ready checkout", exact: true }).scrollIntoViewIfNeeded(); await screenshot(page, "checkout-review-desktop");
    for (const table of ["orders", "payments", "inventory_reservations", "fulfillment_arrangements"]) assert.equal((await f.data.query(`SELECT count(*) FROM ${table}`)).rows[0].count, "0");
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test("collection uses a configured disposable test row and switching methods removes the previous address", async () => {
  // This clearly labelled location exists only in this disposable database.
  const location = (await f.data.query("INSERT INTO boutique_locations(name,governorate,city_area,street_address,is_active) VALUES($1,$2,$3,$4,true) RETURNING id", [testLocation.name, testLocation.governorate, testLocation.city, testLocation.street])).rows[0].id;
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const hash = await start(context), page = await context.newPage(); await page.goto(origin + "/checkout", { waitUntil: "networkidle" });
    await contact(page); await address(page); await operation(page, "Save draft", "draft");
    await page.getByRole("radio", { name: "Boutique Collection", exact: true }).check(); await page.getByLabel("Collection location", { exact: true }).selectOption(location);
    assert.equal(await page.getByLabel("Street address", { exact: true }).count(), 0);
    await operation(page, "Save draft", "draft");
    const row = (await f.data.query("SELECT d.street_address,d.building,d.boutique_location_id FROM checkout_drafts d JOIN carts c ON c.id=d.cart_id WHERE c.session_token_hash=$1", [hash])).rows[0];
    assert.ok(row.street_address === "" && row.building === ""); assert.equal(row.boutique_location_id, location);
    await page.getByRole("region", { name: "Review-ready checkout", exact: true }).waitFor(); await screenshot(page, "checkout-collection");
    await f.data.query("UPDATE boutique_locations SET is_active=false WHERE id=$1", [location]); await refresh(page);
    await page.getByRole("region", { name: "Review-ready checkout", exact: true }).waitFor({ state: "hidden" });
    await page.getByText("Boutique Collection is currently unavailable. No active collection location is configured.", { exact: true }).waitFor();
    await address(page); await operation(page, "Save draft", "draft");
    assert.equal((await f.data.query("SELECT d.boutique_location_id FROM checkout_drafts d JOIN carts c ON c.id=d.cart_id WHERE c.session_token_hash=$1", [hash])).rows[0].boutique_location_id, null);
  } finally { await context.close(); }
});

test("unsaved review survives refresh while price and cart edits invalidate readiness and preserve input", async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const hash = await start(context), page = await context.newPage(); await page.goto(origin + "/checkout", { waitUntil: "networkidle" }); await contact(page); await address(page);
    await operation(page, "Review details", "review"); await page.getByRole("region", { name: "Review-ready checkout", exact: true }).waitFor();
    await refresh(page); assert.ok(await page.getByLabel("Full name", { exact: true }).inputValue() === checkoutContact.fullName);
    await page.getByRole("region", { name: "Review-ready checkout", exact: true }).waitFor();
    assert.equal((await f.data.query("SELECT count(*) FROM checkout_drafts d JOIN carts c ON c.id=d.cart_id WHERE c.session_token_hash=$1", [hash])).rows[0].count, "0");
    await f.data.query("UPDATE product_prices SET amount_minor=12345 WHERE variant_id=$1 AND is_active", [id(202)]); await refresh(page);
    await page.getByRole("region", { name: "Review-ready checkout", exact: true }).waitFor({ state: "hidden" }); assert.match(await page.locator("[data-checkout-subtotal]").innerText(), /123\.45/);
    const cart = await context.newPage(); await cart.goto(origin + "/cart", { waitUntil: "networkidle" });
    const changed = cart.waitForResponse((response: { url(): string; request(): { method(): string } }) => response.url().includes("/api/cart/items/") && response.request().method() === "PATCH");
    await cart.getByRole("button", { name: "Increase quantity for [DEVELOPMENT] repeatable-earrings", exact: true }).click(); assert.equal((await changed).status(), 200);
    await refresh(page); await page.waitForFunction(() => document.querySelector("[data-checkout-subtotal]")?.textContent?.includes("246.90"));
    assert.match(await page.locator("[data-checkout-subtotal]").innerText(), /246\.90/);
    await operation(page, "Review details", "review"); await page.getByRole("region", { name: "Review-ready checkout", exact: true }).waitFor();
    await f.data.query("UPDATE inventory SET on_hand=0 WHERE variant_id=$1", [id(202)]); await refresh(page);
    await page.getByRole("region", { name: "Review-ready checkout", exact: true }).waitFor({ state: "hidden" }); assert.equal(await page.getByRole("button", { name: "Review details", exact: true }).isDisabled(), true);
    await page.getByRole("link", { name: "Review your shopping bag", exact: true }).waitFor();
  } finally { await context.close(); }
});

test("expired drafts clear personal input and a separate guest never restores another guest's details", async () => {
  const a = await browser.newContext({ ignoreHTTPSErrors: true }), b = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const hash = await start(a), page = await a.newPage(); await page.goto(origin + "/checkout", { waitUntil: "networkidle" }); await contact(page); await address(page); await operation(page, "Save draft", "draft");
    await start(b); const other = await b.newPage(); await other.goto(origin + "/checkout", { waitUntil: "networkidle" }); assert.ok(await other.getByLabel("Email address", { exact: true }).inputValue() === "");
    const denied = await b.request.post(origin + "/api/checkout/draft", { headers: { Origin: origin }, data: { cartId: hash, details: deliveryDetails() } }); assert.equal(denied.status(), 400);
    await f.data.query("UPDATE checkout_drafts SET created_at=now()-INTERVAL '25 hours',expires_at=now()-INTERVAL '1 hour' WHERE cart_id=(SELECT id FROM carts WHERE session_token_hash=$1)", [hash]); await refresh(page);
    await page.getByText("Your saved checkout details expired or were cleared. They have been removed from this page.", { exact: true }).waitFor(); assert.ok(await page.getByLabel("Email address", { exact: true }).inputValue() === "");
    assert.equal((await f.data.query("SELECT count(*) FROM checkout_drafts d JOIN carts c ON c.id=d.cart_id WHERE c.session_token_hash=$1", [hash])).rows[0].count, "0");
  } finally { await a.close(); await b.close(); }
});

test("mobile keyboard validation and private delivery remain accessible without a collection location", async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  try {
    await start(context); const page = await context.newPage(), errors: string[] = []; page.on("pageerror", () => errors.push("Runtime error"));
    await page.goto(origin + "/checkout", { waitUntil: "networkidle" });
    await operation(page, "Review details", "review", 422);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role")), "alert"); await page.keyboard.press("Tab");
    assert.equal(await page.getByLabel("Full name", { exact: true }).evaluate((input: HTMLElement) => input === document.activeElement), true);
    await contact(page); await address(page); await operation(page, "Save draft", "draft");
    await page.getByRole("region", { name: "Review-ready checkout", exact: true }).waitFor(); await healthy(page);
    assert.equal(await page.getByRole("radio", { name: "Boutique Collection", exact: true }).isDisabled(), true);
    await page.evaluate(() => { window.scrollTo(0, 0); return document.fonts.ready; }); await screenshot(page, "checkout-mobile");
    await page.getByRole("region", { name: "Review-ready checkout", exact: true }).scrollIntoViewIfNeeded(); await screenshot(page, "checkout-review-mobile");
    await operation(page, "Clear saved details", "draft", 200, "DELETE");
    await page.getByRole("region", { name: "Review-ready checkout", exact: true }).waitFor({ state: "hidden" }); assert.ok(await page.getByLabel("Full name", { exact: true }).inputValue() === "");
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test("empty checkout and a sold one-of-a-kind piece never present a valid checkout action", async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const page = await context.newPage(); await page.goto(origin + "/checkout", { waitUntil: "networkidle" }); await page.getByRole("heading", { name: "Begin with your shopping bag", exact: true }).waitFor();
    await start(context, id(201)); await f.data.query("UPDATE inventory SET on_hand=0 WHERE variant_id=$1", [id(201)]);
    await page.reload({ waitUntil: "networkidle" }); assert.equal(await page.getByRole("button", { name: "Review details", exact: true }).isDisabled(), true);
    await page.goto(origin + "/cart", { waitUntil: "networkidle" }); assert.equal(await page.getByRole("link", { name: "Continue to checkout", exact: true }).count(), 0);
  } finally { await context.close(); }
});

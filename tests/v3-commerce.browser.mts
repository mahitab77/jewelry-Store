import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { adminBrowserHarness } from "./helpers/admin-browser.mts";
import { checkoutContact, deliveryDetails, testLocation } from "./helpers/checkout-data.mts";
import { developmentId as id } from "../db/tools/seed.ts";

// All writes below belong to the existing disposable PostgreSQL/TLS harness.
const harness = adminBrowserHarness(false, true), { origin } = harness;
let browser: ReturnType<typeof harness.current>["browser"], f: ReturnType<typeof harness.current>["fixture"];
type Page = Awaited<ReturnType<typeof browser.newPage>>;
type Context = Awaited<ReturnType<typeof browser.newContext>>;
beforeEach(async () => {
  ({ browser, fixture: f } = harness.current());
  await f.data.query("UPDATE boutique_locations SET is_active=false");
  await f.data.query("UPDATE products SET status='PUBLISHED',published_at='2020-01-01' WHERE id=ANY($1::UUID[])", [[id(101), id(102)]]);
  await f.data.query("UPDATE inventory SET on_hand=CASE variant_id WHEN $1 THEN 20 ELSE 1 END,reserved=0 WHERE variant_id=ANY($2::UUID[])", [id(202), [id(201), id(202)]]);
  await f.data.query("UPDATE product_prices SET amount_minor=245000 WHERE variant_id=$1 AND is_active", [id(202)]);
  for (const value of [checkoutContact.fullName, checkoutContact.email, checkoutContact.phone, deliveryDetails().street]) harness.trackSecret(value);
});
async function start(context: Context, variantId = id(202)) {
  const response = await context.request.post(origin + "/api/cart/items", { headers: { Origin: origin }, data: { variantId, quantity: 1 } });
  assert.equal(response.status(), 200);
  const cookie = (await context.cookies()).find((item: { name: string }) => item.name === "__Host-la-palme-bag");
  assert.ok(cookie); harness.trackSecret(cookie.value);
  return (await response.json()).cart;
}
const quantity = (page: Page, name = "[DEVELOPMENT] repeatable-earrings") => page.getByRole("spinbutton", { name: `Quantity for ${name}`, exact: true });
async function cartUpdate(page: Page, action: () => Promise<unknown>, status = 200) {
  const response = page.waitForResponse((item: { url(): string; request(): { method(): string } }) => item.url().startsWith(origin + "/api/cart/items/") && item.request().method() === "PATCH");
  await action(); assert.equal((await response).status(), status);
  await page.waitForFunction(() => !document.querySelector('main [aria-busy="true"]'));
}
async function review(page: Page, status = 422) {
  const response = page.waitForResponse((item: { url(): string; request(): { method(): string } }) => item.url() === origin + "/api/checkout/review" && item.request().method() === "POST");
  await page.getByRole("button", { name: "Review details", exact: true }).click();
  assert.equal((await response).status(), status);
  await page.locator("main").getByRole("alert").waitFor();
}
async function contact(page: Page) {
  await page.getByLabel("Full name", { exact: true }).fill(checkoutContact.fullName);
  await page.getByLabel("Email address", { exact: true }).fill(checkoutContact.email);
  await page.getByLabel("Egyptian mobile number", { exact: true }).fill(checkoutContact.phone);
}
async function focused(page: Page, id: string) { await page.waitForFunction((value: string) => document.activeElement?.id === value, id); }
async function step(page: Page, label: string) { assert.match(await page.getByRole("list", { name: "Checkout preparation" }).locator('[aria-current="step"]').innerText(), new RegExp(label, "i")); }

test("quantity drafts accept rapid multi-digit typing and commit once on Enter, blur or native controls", async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
  let release: () => void = () => undefined;
  try {
    await start(context); const page = await context.newPage();
    await page.goto(origin + "/cart", { waitUntil: "networkidle" });
    let patches = 0, captured: () => void = () => undefined;
    const requested = new Promise<void>((done) => { captured = done; }), hold = new Promise<void>((done) => { release = done; });
    await page.route("**/api/cart/items/*", async (route: { request(): { method(): string }; continue(): Promise<void> }) => {
      if (route.request().method() === "PATCH") { patches++; captured(); await hold; }
      await route.continue();
    });
    await quantity(page).fill(""); await quantity(page).pressSequentially("12", { delay: 20 });
    assert.equal(await quantity(page).inputValue(), "12"); assert.equal(patches, 0);
    const response = page.waitForResponse((item: { url(): string; request(): { method(): string } }) => item.url().includes("/api/cart/items/") && item.request().method() === "PATCH");
    await quantity(page).press("Enter"); await requested;
    assert.equal(await quantity(page).isDisabled(), true);
    await page.keyboard.press("Tab"); assert.equal(patches, 1);
    release(); assert.equal((await response).status(), 200);
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>('input[aria-label^="Quantity for"]')?.value === "12" && !document.querySelector<HTMLInputElement>('input[aria-label^="Quantity for"]')?.disabled);
    await page.unroute("**/api/cart/items/*");
    await cartUpdate(page, async () => { await quantity(page).fill("13"); await page.getByRole("heading", { name: "Your shopping bag", exact: true }).click(); });
    await cartUpdate(page, () => page.getByRole("button", { name: "Decrease quantity for [DEVELOPMENT] repeatable-earrings", exact: true }).click());
    await cartUpdate(page, () => page.getByRole("button", { name: "Increase quantity for [DEVELOPMENT] repeatable-earrings", exact: true }).click());
    assert.equal(await quantity(page).inputValue(), "13");
    assert.match(await page.locator("[data-cart-subtotal]").innerText(), /31,850\.00/);
    assert.equal((await f.data.query("SELECT reserved FROM inventory WHERE variant_id=$1", [id(202)])).rows[0].reserved, 0);
    assert.equal((await f.data.query("SELECT count(*) FROM inventory_reservations")).rows[0].count, "0");
  } finally { release(); await context.close(); }
});

test("invalid drafts make no request and stock rejection retains the authoritative selection", async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    await start(context); const page = await context.newPage(); await page.goto(origin + "/cart", { waitUntil: "networkidle" });
    let requests = 0;
    page.on("request", (request: { url(): string; method(): string }) => { if (request.method() === "PATCH" && request.url().includes("/api/cart/items/")) requests++; });
    for (const invalid of ["", "0", "-1", "1.5", "21"]) {
      await quantity(page).fill(invalid); await quantity(page).press("Enter");
      assert.equal(await quantity(page).getAttribute("aria-invalid"), "true");
      await page.locator("main").getByRole("alert").filter({ hasText: "Enter a whole number from 1 to 20." }).waitFor();
      assert.equal(requests, 0);
    }
    await quantity(page).fill("12"); await f.data.query("UPDATE inventory SET on_hand=2 WHERE variant_id=$1", [id(202)]);
    await cartUpdate(page, () => quantity(page).press("Enter"), 409);
    await page.getByRole("button", { name: "Increase quantity for [DEVELOPMENT] repeatable-earrings", exact: true }).waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>('input[aria-label^="Quantity for"]')?.value === "1" && !document.querySelector<HTMLInputElement>('input[aria-label^="Quantity for"]')?.disabled);
    assert.equal(requests, 1);
    assert.match(await page.locator("[data-cart-subtotal]").innerText(), /2,450\.00/);
    const cart = (await (await context.request.get(origin + "/api/cart")).json()).cart;
    assert.equal(cart.items[0].quantity, 1); assert.equal(cart.items[0].maxQuantity, 2);
    assert.deepEqual((await f.data.query("SELECT on_hand,reserved FROM inventory WHERE variant_id=$1", [id(202)])).rows[0], { on_hand: 2, reserved: 0 });
  } finally { await context.close(); }
});

test("quantity pointer actions use the draft once, removal skips draft saves and keyboard controls stay native", async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    await start(context); const page = await context.newPage(); await page.goto(origin + "/cart", { waitUntil: "networkidle" });
    const requests: { method: string; quantity?: number }[] = [];
    page.on("request", (request: { url(): string; method(): string; postDataJSON(): { quantity?: number } }) => {
      if (request.url().includes("/api/cart/items/") && ["PATCH", "DELETE"].includes(request.method())) requests.push({ method: request.method(), ...(request.method() === "PATCH" ? { quantity: request.postDataJSON().quantity } : {}) });
    });
    const increase = page.getByRole("button", { name: "Increase quantity for [DEVELOPMENT] repeatable-earrings", exact: true });
    const decrease = page.getByRole("button", { name: "Decrease quantity for [DEVELOPMENT] repeatable-earrings", exact: true });
    await quantity(page).fill("12"); await cartUpdate(page, () => increase.click());
    assert.equal(await quantity(page).inputValue(), "13"); assert.deepEqual(requests, [{ method: "PATCH", quantity: 13 }]);
    await quantity(page).fill("12"); await cartUpdate(page, () => decrease.click());
    assert.equal(await quantity(page).inputValue(), "11"); assert.deepEqual(requests.at(-1), { method: "PATCH", quantity: 11 });
    await quantity(page).fill("10"); await cartUpdate(page, () => quantity(page).press("Tab"));
    assert.equal(await quantity(page).inputValue(), "10"); assert.equal(requests.length, 3);
    await quantity(page).focus(); await quantity(page).press("Tab");
    assert.equal(await increase.evaluate((button: HTMLElement) => document.activeElement === button), true);
    await cartUpdate(page, () => page.keyboard.press("Space")); assert.equal(await quantity(page).inputValue(), "11"); assert.equal(requests.length, 4);
    await quantity(page).fill("1"); assert.equal(await decrease.isDisabled(), true);
    await quantity(page).fill("20"); assert.equal(await increase.isDisabled(), true);
    await quantity(page).fill("0"); assert.equal(await increase.isDisabled(), true); assert.equal(await decrease.isDisabled(), true);
    await quantity(page).fill("14");
    const removed = page.waitForResponse((response: { url(): string; request(): { method(): string } }) => response.url().includes("/api/cart/items/") && response.request().method() === "DELETE");
    await page.getByRole("button", { name: "Remove [DEVELOPMENT] repeatable-earrings", exact: true }).click(); assert.equal((await removed).status(), 200);
    await page.getByRole("heading", { name: "Your bag is waiting", exact: true }).waitFor();
    assert.deepEqual(requests, [{ method: "PATCH", quantity: 13 }, { method: "PATCH", quantity: 11 }, { method: "PATCH", quantity: 10 }, { method: "PATCH", quantity: 11 }, { method: "DELETE" }]);
  } finally { await context.close(); }
});

test("stale revision and one-of-a-kind restrictions cannot replace authoritative quantities", async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true }), unique = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const original = await start(context), page = await context.newPage(); await page.goto(origin + "/cart", { waitUntil: "networkidle" });
    const other = await context.request.patch(origin + "/api/cart/items/" + original.items[0].id, { headers: { Origin: origin }, data: { quantity: 2, revision: original.revision } }); assert.equal(other.status(), 200);
    await quantity(page).fill("3"); await cartUpdate(page, () => quantity(page).press("Enter"), 409);
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>('input[aria-label^="Quantity for"]')?.value === "2" && !document.querySelector<HTMLInputElement>('input[aria-label^="Quantity for"]')?.disabled);
    assert.match(await page.locator("[data-cart-subtotal]").innerText(), /4,900\.00/);
    await start(unique, id(201)); const one = await unique.newPage(); await one.goto(origin + "/cart", { waitUntil: "networkidle" });
    const control = quantity(one, "[DEVELOPMENT] unique-ring"); await control.fill("2"); await control.press("Enter");
    assert.equal(await control.getAttribute("aria-invalid"), "true");
    await one.getByText("This piece is limited to one. Enter 1.", { exact: true }).waitFor();
    assert.equal(await one.getByRole("button", { name: "Increase quantity for [DEVELOPMENT] unique-ring", exact: true }).isDisabled(), true);
    assert.equal((await (await unique.request.get(origin + "/api/cart")).json()).cart.items[0].quantity, 1);
  } finally { await context.close(); await unique.close(); }
});

test("checkout progress and focus follow server contact and fulfillment validation", async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 320, height: 900 } });
  try {
    await start(context); const page = await context.newPage(); await page.goto(origin + "/checkout", { waitUntil: "networkidle" });
    await page.getByLabel("Full name", { exact: true }).fill("1"); await page.getByLabel("Email address", { exact: true }).fill("invalid"); await page.getByLabel("Egyptian mobile number", { exact: true }).fill("bad");
    await step(page, "Contact details"); await review(page); await step(page, "Contact details"); await focused(page, "checkout-fullName");
    assert.equal(await page.getByLabel("Full name", { exact: true }).getAttribute("required"), "");
    await contact(page); await step(page, "Contact details"); await review(page); await step(page, "Personal fulfillment"); await focused(page, "checkout-method");
    const group = page.getByRole("radiogroup", { name: "Fulfillment method", exact: true });
    assert.equal(await group.getAttribute("aria-invalid"), "true"); assert.equal(await group.getAttribute("aria-describedby"), "error-method");
    for (const radio of await group.getByRole("radio").all()) assert.equal(await radio.getAttribute("aria-describedby"), "error-method");
    await page.getByRole("radio", { name: "Private Delivery", exact: true }).check();
    await page.getByLabel("Governorate", { exact: true }).selectOption("Cairo"); await page.getByLabel("City or area", { exact: true }).fill("x"); await page.getByLabel("Street address", { exact: true }).fill("x");
    await review(page); await step(page, "Personal fulfillment"); await focused(page, "checkout-city");
    const data = deliveryDetails(); await page.getByLabel("City or area", { exact: true }).fill(data.city); await page.getByLabel("Street address", { exact: true }).fill(data.street);
    assert.equal(await page.getByLabel("Building or villa (if applicable)", { exact: true }).getAttribute("required"), null);
    await review(page, 200); await step(page, "Ready for review"); await page.getByRole("region", { name: "Review-ready checkout", exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await page.getByRole("button", { name: /place order|pay now/i }).count(), 0);
    for (const table of ["checkout_drafts", "orders", "payments", "inventory_reservations"]) assert.equal((await f.data.query(`SELECT count(*) FROM ${table}`)).rows[0].count, "0");
  } finally { await context.close(); }
});

test("collection validation is linked and both fulfillment methods remain available", async () => {
  const location = (await f.data.query("INSERT INTO boutique_locations(name,governorate,city_area,street_address,is_active) VALUES($1,$2,$3,$4,true) RETURNING id", [testLocation.name, testLocation.governorate, testLocation.city, testLocation.street])).rows[0].id;
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    await start(context); const page = await context.newPage(); await page.goto(origin + "/checkout", { waitUntil: "networkidle" }); await contact(page);
    await page.getByRole("radio", { name: "Boutique Collection", exact: true }).check(); await review(page); await focused(page, "checkout-locationId"); await step(page, "Personal fulfillment");
    const control = page.getByLabel("Collection location", { exact: true }); assert.equal(await control.getAttribute("aria-describedby"), "error-locationId");
    await control.selectOption(location); await review(page, 200); await step(page, "Ready for review");
    await page.getByRole("radio", { name: "Private Delivery", exact: true }).check(); await review(page); await focused(page, "checkout-governorate"); await step(page, "Personal fulfillment");
    assert.equal(await control.count(), 0); assert.equal(await page.getByLabel("Street address", { exact: true }).inputValue(), "");
  } finally { await context.close(); }
});

test("cart and checkout loading reserve space and stay usable at all four reviewed widths", { timeout: 90000 }, async () => {
  for (const width of [320, 768, 1024, 1440]) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    try {
      await start(context); const page = await context.newPage(); const errors: string[] = []; page.on("pageerror", () => errors.push("Application runtime error"));
      for (const path of ["cart", "checkout"]) {
        let release: () => void = () => undefined;
        const hold = new Promise<void>((done) => { release = done; });
        await page.route(`**/api/${path}`, async (route: { continue(): Promise<void> }) => { await hold; await route.continue(); });
        await page.goto(origin + "/" + path, { waitUntil: "domcontentloaded" });
        await page.locator("main").getByRole("status").filter({ hasText: path === "cart" ? "Opening your shopping bag" : "Opening checkout preparation" }).waitFor();
        await page.evaluate(() => document.fonts.ready);
        const geometry = () => page.evaluate(() => {
          const content = document.querySelector<HTMLElement>('main [aria-busy]')!, footer = document.querySelector("footer")!;
          return { footerTop: footer.getBoundingClientRect().top + scrollY, contentHeight: content.getBoundingClientRect().height, minimumHeight: getComputedStyle(content).minHeight, bodyHeight: content.firstElementChild?.getBoundingClientRect().height };
        });
        const before = await geometry();
        release();
        if (path === "cart") await quantity(page).waitFor(); else await page.getByLabel("Full name", { exact: true }).waitFor();
        await page.waitForLoadState("networkidle");
        const after = await geometry();
        assert.ok(Math.abs(after.footerTop - before.footerTop) <= 16, `${path} loading moved the footer ${Math.abs(after.footerTop - before.footerTop)}px at ${width}px: ${JSON.stringify({ before, after })}`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.equal(await page.locator("nextjs-portal").count(), 0);
        await page.unroute(`**/api/${path}`);
      }
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

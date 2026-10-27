import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { adminBrowserHarness } from "./helpers/admin-browser.mts";
import { developmentId as id } from "../db/tools/seed.ts";

// Reuse the existing process/TLS harness; the app's administrator auth is unset.
const harness = adminBrowserHarness(false, true), { origin, screenshot } = harness;
let browser: ReturnType<typeof harness.current>["browser"], f: ReturnType<typeof harness.current>["fixture"];
beforeEach(() => { ({ browser, fixture: f } = harness.current()); });
type Page = Awaited<ReturnType<typeof browser.newPage>>;
async function operation(page: Page, action: () => Promise<unknown>, method = "POST", status = 200) {
  const response = page.waitForResponse((r: { url(): string; request(): { method(): string } }) => r.url().startsWith(origin + "/api/cart/items") && r.request().method() === method);
  await action(); assert.equal((await response).status(), status);
}
async function refreshed(page: Page) {
  await page.bringToFront();
  const response = page.waitForResponse((r: { url(): string }) => r.url() === origin + "/api/cart");
  await page.evaluate(() => window.dispatchEvent(new Event("focus"))); assert.equal((await response).status(), 200);
}
async function count(page: Page, value: number) { await page.getByRole("link", { name: `Shopping bag, ${value} ${value === 1 ? "item" : "items"}`, exact: true }).waitFor(); }
async function healthy(page: Page) { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.equal(await page.locator("nextjs-portal").count(), 0); assert.equal(await page.locator("h1").count(), 1); }

test("desktop guest flow preserves variant choice, price, count, browser state, quantities and removal", { timeout: 90000 }, async () => {
  await f.data.query("UPDATE inventory SET on_hand=3 WHERE variant_id=$1", [id(207)]);
  let context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  try {
    let page = await context.newPage(); const errors: string[] = [];
    page.on("pageerror", () => errors.push("Application runtime error"));
    page.on("console", (message: { type(): string }) => { if (["error", "warning"].includes(message.type())) errors.push("Console error/warning"); });
    const before = (await f.data.query("SELECT count(*) FROM carts")).rows[0].count;
    await page.goto(origin, { waitUntil: "networkidle" }); await count(page, 0);
    await page.getByRole("link", { name: "Shopping bag, 0 items", exact: true }).click(); await page.waitForURL(origin + "/cart");
    await page.getByRole("heading", { name: "Your bag is waiting", exact: true }).waitFor();
    assert.equal((await f.data.query("SELECT count(*) FROM carts")).rows[0].count, before);
    await page.goto(origin + "/jewels/dev-repeatable-earrings", { waitUntil: "networkidle" });
    await page.getByRole("radio", { name: /Development alternate/ }).check();
    await operation(page, () => page.getByRole("button", { name: "Add to bag", exact: true }).click());
    await page.locator("main").getByRole("status").filter({ hasText: "Added to your shopping bag." }).waitFor(); await count(page, 1);
    const session = (await context.cookies()).find((cookie: { name: string }) => cookie.name === "__Host-la-palme-bag");
    assert.ok(session && session.httpOnly && session.secure && session.sameSite === "Lax" && session.expires > Date.now() / 1000);
    harness.trackSecret(session.value);
    await page.getByRole("link", { name: "View your bag", exact: true }).click(); await page.waitForURL(origin + "/cart");
    await page.getByText("Development alternate", { exact: true }).waitFor(); assert.match(await page.locator("[data-cart-subtotal]").innerText(), /2,650\.00/);
    const state = await context.storageState(); await context.close();
    context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, storageState: state, reducedMotion: "reduce" });
    page = await context.newPage(); await page.goto(origin + "/cart", { waitUntil: "networkidle" }); await count(page, 1);
    const other = await context.newPage(); await other.goto(origin, { waitUntil: "networkidle" }); await count(other, 1);
    await page.bringToFront();
    await operation(page, () => page.getByRole("button", { name: "Increase quantity for [DEVELOPMENT] repeatable-earrings", exact: true }).click(), "PATCH");
    await count(page, 2); await count(other, 2); assert.match(await page.locator("[data-cart-subtotal]").innerText(), /5,300\.00/);
    await healthy(page); await screenshot(page, "cart-desktop");
    await operation(page, () => page.getByRole("button", { name: "Decrease quantity for [DEVELOPMENT] repeatable-earrings", exact: true }).click(), "PATCH"); await count(page, 1);
    await operation(page, () => page.getByRole("button", { name: "Remove [DEVELOPMENT] repeatable-earrings", exact: true }).click(), "DELETE");
    await page.getByRole("heading", { name: "Your bag is waiting", exact: true }).waitFor(); await count(page, 0);
    await page.reload({ waitUntil: "networkidle" }); await page.getByRole("heading", { name: "Your bag is waiting", exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await context.close(); await f.data.query("UPDATE inventory SET on_hand=0 WHERE variant_id=$1", [id(207)]); }
});

test("one-of-a-kind limits and stock refresh keep an unavailable selection removable", async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage(); await page.goto(origin + "/jewels/dev-unique-ring", { waitUntil: "networkidle" });
    await operation(page, () => page.getByRole("button", { name: "Add to bag", exact: true }).click());
    await count(page, 1);
    await operation(page, () => page.getByRole("button", { name: "Add to bag", exact: true }).click(), "POST", 409);
    await page.locator("main").getByRole("alert").waitFor();
    await page.goto(origin + "/cart", { waitUntil: "networkidle" });
    assert.equal(await page.getByRole("button", { name: "Increase quantity for [DEVELOPMENT] unique-ring", exact: true }).isDisabled(), true);
    await f.data.query("UPDATE inventory SET on_hand=0 WHERE variant_id=$1", [id(201)]); await refreshed(page);
    await page.getByText("This selection is currently out of stock.", { exact: true }).waitFor(); await count(page, 1);
    await screenshot(page, "cart-stock-notice");
    await operation(page, () => page.getByRole("button", { name: "Remove [DEVELOPMENT] unique-ring", exact: true }).click(), "DELETE"); await count(page, 0);
  } finally { await context.close(); await f.data.query("UPDATE inventory SET on_hand=1 WHERE variant_id=$1", [id(201)]); }
});

test("current price changes and unpublication are reflected without leaking draft details", async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const page = await context.newPage(); await page.goto(origin + "/jewels/dev-repeatable-earrings", { waitUntil: "networkidle" });
    await operation(page, () => page.getByRole("button", { name: "Add to bag", exact: true }).click());
    await page.goto(origin + "/cart", { waitUntil: "networkidle" });
    await f.data.query("UPDATE product_prices SET amount_minor=12345 WHERE variant_id=$1 AND is_active", [id(202)]); await refreshed(page);
    await page.getByText("The price has changed since this piece was added to your bag.", { exact: true }).waitFor();
    assert.match(await page.locator("[data-cart-subtotal]").innerText(), /123\.45/);
    await f.data.query("UPDATE products SET status='DRAFT',name='PRIVATE_BROWSER_CART_SENTINEL' WHERE id=$1", [id(102)]); await refreshed(page);
    await page.getByRole("heading", { name: "Jewelry no longer available", exact: true }).waitFor(); assert.ok(!(await page.content()).includes("PRIVATE_BROWSER_CART_SENTINEL"));
    await operation(page, () => page.getByRole("button", { name: "Remove Jewelry no longer available", exact: true }).click(), "DELETE"); await count(page, 0);
  } finally { await context.close(); await f.data.query("UPDATE products SET status='PUBLISHED',name='[DEVELOPMENT] repeatable-earrings' WHERE id=$1", [id(102)]); await f.data.query("UPDATE product_prices SET amount_minor=245000 WHERE variant_id=$1 AND is_active", [id(202)]); }
});

test("foreign item access, enquiry/bespoke adds, forged fields and missing setup fail closed over HTTPS", async () => {
  const a = await browser.newContext({ ignoreHTTPSErrors: true }), b = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    async function add(context: typeof a, variantId = id(202)) { return context.request.post(origin + "/api/cart/items", { headers: { Origin: origin }, data: { variantId, quantity: 1 } }); }
    const first = await (await add(a)).json(), second = await (await add(b)).json();
    const denied = await b.request.patch(origin + "/api/cart/items/" + first.cart.items[0].id, { headers: { Origin: origin }, data: { quantity: 2, revision: second.cart.revision } }); assert.equal(denied.status(), 404);
    for (const variant of [203, 204]) assert.equal((await add(b, id(variant))).status(), 409);
    assert.equal((await b.request.post(origin + "/api/cart/items", { headers: { Origin: "https://hostile.test" }, data: { variantId: id(202), quantity: 1 } })).status(), 403);
    assert.equal((await b.request.post(origin + "/api/cart/items", { headers: { Origin: origin }, data: { variantId: id(202), quantity: 1, price: 1 } })).status(), 400);
    const missing = await b.request.post("http://127.0.0.1:3121/api/cart/items", { headers: { Origin: origin }, data: { variantId: id(202), quantity: 1 } }); assert.equal(missing.status(), 503);
    assert.equal((await f.data.query("SELECT count(*) FROM inventory_reservations")).rows[0].count, "0");
  } finally { await a.close(); await b.close(); }
});

test("mobile homepage bag, navigation, purchase control and cart quantities remain native and unclipped", async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  try {
    const page = await context.newPage(), errors: string[] = []; page.on("pageerror", () => errors.push("Runtime error"));
    await page.goto(origin, { waitUntil: "networkidle" }); await count(page, 0); await healthy(page); await screenshot(page, "cart-homepage-mobile");
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await page.getByRole("link", { name: "Shopping bag, 0 items", exact: true }).click(); await page.waitForURL(origin + "/cart");
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");
    await page.goto(origin + "/jewels/dev-repeatable-earrings", { waitUntil: "networkidle" }); await healthy(page);
    await operation(page, () => page.getByRole("button", { name: "Add to bag", exact: true }).click());
    await page.goto(origin + "/cart", { waitUntil: "networkidle" }); await count(page, 1);
    await operation(page, () => page.getByRole("spinbutton", { name: "Quantity for [DEVELOPMENT] repeatable-earrings", exact: true }).fill("3"), "PATCH");
    await count(page, 3); assert.match(await page.locator("[data-cart-subtotal]").innerText(), /7,350\.00/);
    await healthy(page); await page.evaluate(() => { window.scrollTo(0, 0); return document.fonts.ready; }); await screenshot(page, "cart-mobile");
    await page.reload({ waitUntil: "networkidle" }); await count(page, 3);
    assert.equal(await page.getByRole("link", { name: "Continue to checkout", exact: true }).getAttribute("href"), "/checkout");
    await operation(page, () => page.getByRole("button", { name: "Remove [DEVELOPMENT] repeatable-earrings", exact: true }).click(), "DELETE"); await count(page, 0);
    for (const width of [320, 1024, 1280]) for (const path of ["/", "/collections"]) {
      await page.setViewportSize({ width, height: 900 }); await page.goto(origin + path, { waitUntil: "networkidle" }); await healthy(page);
      const overlaps = await page.evaluate(() => {
        const bag = document.querySelector("[data-cart-bag]")!, b = bag.getBoundingClientRect();
        return [...document.querySelectorAll('header nav[aria-label="Primary navigation"] a,header nav[aria-label="Primary navigation"] button')]
          .filter((control) => control !== bag && control.getClientRects().length)
          .filter((control) => { const r = control.getBoundingClientRect(); return r.width && r.height && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top; })
          .map((control) => control.getAttribute("aria-label") || control.textContent?.trim());
      });
      assert.deepEqual(overlaps, [], `Shopping bag overlaps a header control at ${width}px on ${path}.`);
      if (width === 1024 && path === "/") await screenshot(page, "cart-header-narrow-desktop");
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";
import sharp from "sharp";
import { adminBrowserHarness } from "./helpers/admin-browser.mts";
import { mockCloudinaryConfiguration } from "./helpers/cloudinary-mock.mts";

const harness = adminBrowserHarness(true), { origin, screenshot, signIn } = harness;
let browser: ReturnType<typeof harness.current>["browser"], fixture: ReturnType<typeof harness.current>["fixture"];
let photo: Buffer;
type Page = Awaited<ReturnType<typeof browser.newPage>>;
before(async () => {
  photo = await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 35, g: 100, b: 70 } } }).png().toBuffer();
});
beforeEach(() => { ({ browser, fixture } = harness.current()); });
async function operation(page: Page, button: string, suffix: string) {
  const waiting = page.waitForResponse((response: { url(): string; request(): { method(): string } }) => response.url().endsWith(suffix) && response.request().method() === "POST");
  await page.getByRole("button", { name: button, exact: true }).click();
  const result = await waiting;
  assert.equal(result.status(), 200, `Operation ${button} should succeed.`);
  await page.getByRole("status").filter({ hasText: /saved|uploaded|removed|completed/i }).first().waitFor();
}
async function upload(page: Page, alt: string) {
  await page.getByLabel("Photograph", { exact: true }).setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer: photo });
  await page.getByLabel("Photograph description (alt text)", { exact: true }).fill(alt);
  await operation(page, "Upload photograph", "/photos");
}

test("anonymous catalogue routes and mutation attempts are denied without writes", async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const page = await context.newPage();
    for (const path of ["/admin/products", "/admin/products/new"]) { await page.goto(origin + path); await page.waitForURL(origin + "/admin/login"); }
    const count = (await fixture.data.query("SELECT count(*) FROM products")).rows[0].count;
    const response = await context.request.post(origin + "/api/admin/catalogue/products", { headers: { Origin: origin }, data: { role: "OWNER" } });
    assert.equal(response.status(), 401); assert.equal((await fixture.data.query("SELECT count(*) FROM products")).rows[0].count, count);
  } finally { await context.close(); }
});

test("desktop catalogue flow creates, edits, uploads, orders, publishes, adjusts and archives actual records", { timeout: 90000 }, async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  try {
    const page = await context.newPage(), errors: string[] = [];
    page.on("pageerror", () => errors.push("Page runtime error"));
    page.on("console", (message: { type(): string; text(): string }) => {
      if (!["error", "warning"].includes(message.type())) return;
      let safe = message.text();
      for (const secret of [fixture.password, fixture.authConfig.secret, mockCloudinaryConfiguration.apiKey, mockCloudinaryConfiguration.apiSecret]) safe = safe.split(secret).join("[redacted]");
      safe = safe.replace(/https?:\/\/[^\s]+/g, (url) => { try { return new URL(url).pathname; } catch { return "[resource]"; } });
      errors.push(`${message.type()}: ${safe.slice(0, 400)}`);
    });
    page.on("dialog", (dialog: { accept(): Promise<void> }) => dialog.accept());
    await signIn(page);
    await page.getByRole("link", { name: "Manage catalogue", exact: true }).click(); await page.waitForURL(origin + "/admin/products");
    assert.equal(await page.locator("table").count(), 1);
    await page.evaluate(() => document.fonts.ready); await screenshot(page, "catalogue-list-desktop");
    await page.getByRole("link", { name: "Create product", exact: true }).click(); await page.waitForURL(origin + "/admin/products/new");
    await page.getByLabel("Product name", { exact: true }).fill("Browser catalogue fixture");
    await page.getByLabel("URL slug", { exact: true }).fill("browser-catalogue-fixture");
    await page.getByLabel("Product type", { exact: true }).selectOption("REPEATABLE");
    await page.getByLabel("Sales mode", { exact: true }).selectOption("BOTH");
    await page.getByLabel("[DEVELOPMENT] Rings", { exact: true }).check();
    await page.getByLabel("[DEVELOPMENT] Selections (published)", { exact: true }).check();
    await page.getByRole("button", { name: "Add variant", exact: true }).click();
    const variant = page.getByRole("group", { name: "Variant 1", exact: true });
    await variant.getByLabel("SKU", { exact: true }).fill("BROWSER-MANAGED-1");
    await variant.getByLabel("Configuration", { exact: true }).fill("Standard");
    await variant.getByLabel("Selling price (EGP)", { exact: true }).fill("1234.56");
    await variant.getByLabel("Initial stock", { exact: true }).fill("2");
    await variant.getByLabel("Initial stock reason", { exact: true }).fill("Two disposable browser fixture units");
    await variant.getByRole("button", { name: "Add gemstone", exact: true }).click();
    await variant.getByLabel("Stone type", { exact: true }).fill("Sapphire");
    await variant.getByLabel("Shape / cut", { exact: true }).fill("Round");
    await variant.getByLabel("Colour", { exact: true }).fill("Blue");
    await variant.getByLabel("Carat weight", { exact: true }).fill("1.2345");
    await page.getByRole("button", { name: "Create draft", exact: true }).click();
    await page.waitForURL(/\/admin\/products\/[0-9a-f-]{36}\/edit$/);
    await page.getByRole("heading", { name: "Edit product", exact: true }).waitFor();
    const id = page.url().split("/").at(-2)!;
    assert.equal((await fixture.data.query("SELECT status FROM products WHERE id=$1", [id])).rows[0].status, "DRAFT");
    await upload(page, "Fixture ring front view"); await upload(page, "Fixture ring side view");
    await page.getByRole("button", { name: "Move photograph 2 up", exact: true }).click();
    await page.getByLabel("Primary photograph 1", { exact: true }).check();
    await operation(page, "Save photograph order", "/arrange");
    await operation(page, "Publish", "/save");
    assert.equal((await fixture.data.query("SELECT status FROM products WHERE id=$1", [id])).rows[0].status, "PUBLISHED");
    const publicPage = await context.newPage();
    assert.equal((await publicPage.goto(origin + "/jewels/browser-catalogue-fixture", { waitUntil: "networkidle" })).status(), 200);
    assert.match(await publicPage.locator("main").innerText(), /1,234\.56/);
    assert.ok(await publicPage.locator('img[alt="Fixture ring side view"]').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0));
    await page.getByLabel("Selling price (EGP)", { exact: true }).fill("1500.07");
    await operation(page, "Save changes", "/save");
    await page.getByLabel("Adjustment (+/− units)", { exact: true }).fill("-1");
    await page.getByLabel("Adjustment reason", { exact: true }).fill("Browser fixture inventory adjustment");
    const stockResponse = page.waitForResponse((r: { url(): string; request(): { method(): string } }) => r.url().includes("/inventory/") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Apply stock adjustment for BROWSER-MANAGED-1", exact: true }).click(); assert.equal((await stockResponse).status(), 200);
    await publicPage.reload({ waitUntil: "networkidle" }); assert.match(await publicPage.locator("main").innerText(), /1,500\.07/);
    await page.getByRole("heading", { name: "Product photographs", exact: true }).scrollIntoViewIfNeeded(); await screenshot(page, "catalogue-media-desktop");
    await operation(page, "Unpublish", "/save");
    assert.equal((await publicPage.goto(origin + "/jewels/browser-catalogue-fixture")).status(), 404);
    await operation(page, "Archive", "/save");
    const html = await page.content();
    assert.ok(!html.includes(fixture.authConfig.secret) && !html.includes(mockCloudinaryConfiguration.apiKey) && !html.includes(mockCloudinaryConfiguration.apiSecret));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.equal(await page.locator("nextjs-portal").count(), 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test("mobile creation, stock state and error feedback remain accessible and unclipped", async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  try {
    const page = await context.newPage(); page.on("dialog", (dialog: { accept(): Promise<void> }) => dialog.accept());
    await signIn(page); await page.goto(origin + "/admin/products/new", { waitUntil: "networkidle" });
    await page.getByLabel("Product name", { exact: true }).fill("Mobile catalogue fixture");
    await page.getByLabel("URL slug", { exact: true }).fill("INVALID SLUG");
    await page.getByRole("button", { name: "Create draft", exact: true }).click();
    await page.locator("main").getByRole("alert").waitFor(); assert.match(await page.locator("main").getByRole("alert").innerText(), /slug/i);
    await page.getByLabel("URL slug", { exact: true }).fill("mobile-catalogue-fixture");
    await page.getByLabel("Product type", { exact: true }).selectOption("BESPOKE");
    await page.getByRole("button", { name: "Add variant", exact: true }).click();
    await page.getByLabel("SKU", { exact: true }).fill("MOBILE-BESPOKE-1");
    await page.getByRole("button", { name: "Create draft", exact: true }).click(); await page.waitForURL(/\/admin\/products\/[0-9a-f-]{36}\/edit$/);
    await page.getByRole("heading", { name: "Edit product", exact: true }).waitFor();
    await page.evaluate(() => { window.scrollTo(0, 0); return document.fonts.ready; }); await screenshot(page, "catalogue-editor-mobile");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.getByRole("button", { name: "Apply stock adjustment for MOBILE-BESPOKE-1", exact: true }).isDisabled());
    await page.getByRole("heading", { name: "Product photographs", exact: true }).scrollIntoViewIfNeeded(); await screenshot(page, "catalogue-media-mobile");
    await page.getByRole("link", { name: "Product catalogue", exact: false }).click(); await page.waitForURL(origin + "/admin/products");
    await page.getByLabel("Search name, SKU or slug", { exact: true }).fill("MOBILE-BESPOKE-1");
    await page.getByRole("button", { name: "Filter products", exact: true }).click(); await page.waitForURL(/q=MOBILE-BESPOKE-1/);
    assert.equal(await page.locator("tbody tr").count(), 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await screenshot(page, "catalogue-list-mobile");
  } finally { await context.close(); }
});

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { adminBrowserHarness } from "./helpers/admin-browser.mts";
import { product, variant } from "./helpers/catalogue-fixture.mts";
import type { EditorProduct } from "../src/lib/admin/catalogue/types.ts";

const previousMode = process.env.COMMERCE_MODE; process.env.COMMERCE_MODE = "QUOTATION_ONLY";
const h = adminBrowserHarness(true, false, false, false, { seedCatalogue: false }), { origin, signIn, screenshot } = h;
let browser: ReturnType<typeof h.current>["browser"], fixture: ReturnType<typeof h.current>["fixture"], photograph: Buffer;
type Page = Awaited<ReturnType<typeof browser.newPage>>;
type Context = Awaited<ReturnType<typeof browser.newContext>>;
before(async () => { photograph = await sharp("public/images/ring-emerald.png").resize(500, 500, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer(); });
beforeEach(() => { ({ browser, fixture } = h.current()); });
after(() => { if (previousMode === undefined) delete process.env.COMMERCE_MODE; else process.env.COMMERCE_MODE = previousMode; });
async function context() { return browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" }); }
async function pageFor(c: Context) { const page = await c.newPage(); page.setDefaultTimeout(15000); page.on("dialog", (dialog: { accept(): Promise<void> }) => dialog.accept()); await signIn(page, "CATALOGUE_MANAGER"); return page; }
async function open(page: Page, title: string) { const details = page.locator("summary").filter({ hasText: new RegExp("^" + title + "$") }).locator(".."); if (!await details.evaluate((element: HTMLDetailsElement) => element.open)) await details.locator("summary").first().click(); return details; }
async function post(page: Page, path: string, label: string, status = 200) { const waiting = page.waitForResponse((response: { url(): string; request(): { method(): string } }) => response.url() === origin + path && response.request().method() === "POST"); await page.getByRole("button", { name: label, exact: true }).click(); const response = await waiting; assert.equal(response.status(), status); return response; }
async function settled(page: Page) { await page.waitForFunction(() => [...document.querySelectorAll("form[aria-busy]")].every((form) => form.getAttribute("aria-busy") !== "true")); }
async function read(c: Context, id: string): Promise<EditorProduct> { const response = await c.request.get(origin + `/api/admin/catalogue/products/${id}`); assert.equal(response.status(), 200); return (await response.json()).product; }

test("quotation entry omits ordinary prices and publishes exact estimated metal grams with purity alone", { timeout: 120000 }, async () => {
  const c = await context();
  try {
    const page = await pageFor(c), category = await c.request.post(origin + "/api/admin/catalogue/taxonomy", { headers: { Origin: origin }, data: { kind: "category", name: "LOCAL ONLY quotation type " + randomUUID() } }); assert.equal(category.status(), 200);
    const categoryId = (await category.json()).id as string;
    await page.goto(origin + "/admin/products/new"); assert.equal(await page.getByLabel("Price (EGP)", { exact: true }).count(), 0);
    await page.getByLabel("Jewelry Name", { exact: true }).fill("LOCAL ONLY quotation metal piece " + randomUUID()); await page.getByLabel("Jewelry Category", { exact: true }).selectOption(categoryId);
    await page.getByLabel("Description", { exact: true }).fill("LOCAL TEST ONLY. A quotation catalogue fixture for exact material measurement verification.");
    for (const width of [320, 768, 1024, 1440]) { await page.setViewportSize({ width, height: 1000 }); assert.ok(await page.getByLabel("Description", { exact: true }).isVisible()); assert.equal(await page.getByLabel("Price (EGP)", { exact: true }).count(), 0); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await screenshot(page, `quotation-product-${width}`); }
    await open(page, "Materials and gemstones"); await page.getByLabel("Metal purity", { exact: true }).fill("18K"); await page.getByLabel("Metal weight (grams)", { exact: true }).fill("3.250"); await page.getByLabel("Metal weight basis", { exact: true }).selectOption("ESTIMATED");
    await page.getByLabel("Add Photographs", { exact: true }).setInputFiles({ name: "local-only-metal-reference.png", mimeType: "image/png", buffer: photograph });
    const created = await (await post(page, "/api/admin/catalogue/products", "Save Draft")).json(); await page.waitForURL(origin + `/admin/products/${created.id}/edit`); await settled(page); await page.reload();
    await open(page, "Materials and gemstones"); assert.equal(await page.getByLabel("Metal", { exact: true }).inputValue(), ""); assert.equal(await page.getByLabel("Metal purity", { exact: true }).inputValue(), "18K"); assert.equal(await page.getByLabel("Metal weight (grams)", { exact: true }).inputValue(), "3.250"); assert.equal(await page.getByLabel("Metal weight basis", { exact: true }).inputValue(), "ESTIMATED");
    await post(page, `/api/admin/catalogue/products/${created.id}/save`, "Publish"); await settled(page);
    const saved = await read(c, created.id); assert.equal(saved.status, "PUBLISHED"); assert.equal(saved.salesMode, "DIRECT_PURCHASE"); assert.equal(saved.variants[0].priceEGP, "");
    const publicPage = await c.newPage(); assert.equal((await publicPage.goto(origin + `/jewels/${saved.slug}`))!.status(), 200);
    assert.ok(await publicPage.getByText("Price on Request", { exact: true }).isVisible()); assert.ok(await publicPage.getByText("3.25 g (estimated)", { exact: true }).isVisible()); assert.ok(await publicPage.getByText("18K", { exact: true }).isVisible());
    assert.equal(await publicPage.getByRole("button", { name: /Add.*bag|Add.*cart/i }).count(), 0); assert.ok(await publicPage.getByRole("link", { name: "Request a Quotation", exact: true }).isVisible());
    assert.deepEqual((await fixture.data.query("SELECT (SELECT count(*) FROM orders)::int AS orders,(SELECT count(*) FROM payments)::int AS payments,(SELECT count(*) FROM inventory_reservations)::int AS holds")).rows[0], { orders: 0, payments: 0, holds: 0 });
  } finally { await c.close(); }
});

test("collapsed private prices and actual metal measurements survive ordinary quotation-only edits", async () => {
  const c = await context();
  try {
    const page = await pageFor(c), response = await c.request.post(origin + "/api/admin/catalogue/products", { headers: { Origin: origin }, data: { product: product("LOCAL ONLY private priced enquiry " + randomUUID(), { slug: "", salesMode: "ENQUIRY_ONLY", variants: [variant("", { priceEGP: "12345.67", metalPurity: "18K", metalWeightGrams: "0.125", metalWeightBasis: "ACTUAL" })] }), action: "save" } }); assert.equal(response.status(), 200);
    const saved = (await response.json()).product as EditorProduct, before = (await fixture.data.query("SELECT id,amount_minor::text,is_active,updated_at FROM product_prices WHERE variant_id=$1", [saved.variants[0].id])).rows;
    await page.goto(origin + `/admin/products/${saved.id}/edit`); assert.equal(await page.getByLabel("Price (EGP)", { exact: true }).count(), 0); assert.equal(await page.getByLabel("Selling price (EGP)", { exact: true }).isVisible(), false);
    await page.getByLabel("Jewelry Name", { exact: true }).fill(saved.name + " edited"); await page.getByLabel("Description", { exact: true }).fill("LOCAL TEST ONLY. Ordinary quotation-only copy edit preserves all hidden financial and material fields.");
    await post(page, `/api/admin/catalogue/products/${saved.id}/save`, "Save Draft"); await settled(page); await page.reload();
    const after = await read(c, saved.id); assert.equal(after.salesMode, "ENQUIRY_ONLY"); assert.equal(after.variants[0].priceEGP, "12345.67"); assert.equal(after.variants[0].metalWeightGrams, "0.125"); assert.equal(after.variants[0].metalWeightBasis, "ACTUAL");
    assert.deepEqual((await fixture.data.query("SELECT id,amount_minor::text,is_active,updated_at FROM product_prices WHERE variant_id=$1", [saved.variants[0].id])).rows, before);
    await open(page, "Sizes and variants"); assert.equal(await page.getByLabel("Selling price (EGP)", { exact: true }).inputValue(), "12345.67");
    await open(page, "Materials and gemstones"); assert.equal(await page.getByLabel("Metal weight (grams)", { exact: true }).inputValue(), "0.125"); assert.equal(await page.getByLabel("Metal weight basis", { exact: true }).inputValue(), "ACTUAL");
  } finally { await c.close(); }
});

test("collapsed invalid grams and missing measurement basis reveal their exact field and preserve input", async () => {
  const c = await context();
  try {
    const page = await pageFor(c); await page.goto(origin + "/admin/products/new"); await page.getByLabel("Jewelry Name", { exact: true }).fill("LOCAL ONLY invalid material input " + randomUUID());
    const materials = await open(page, "Materials and gemstones"); await page.getByLabel("Metal weight (grams)", { exact: true }).fill("1.2345"); await page.getByLabel("Metal weight basis", { exact: true }).selectOption("ACTUAL"); await materials.locator("summary").first().click();
    await post(page, "/api/admin/catalogue/products", "Save Draft", 400); await page.waitForFunction(() => document.activeElement?.getAttribute("data-field-path") === "product.variants.0.metalWeightGrams");
    assert.equal(await page.getByLabel("Metal weight (grams)", { exact: true }).inputValue(), "1.2345"); assert.equal(await page.getByLabel("Metal weight (grams)", { exact: true }).getAttribute("aria-invalid"), "true");
    await page.getByLabel("Metal weight (grams)", { exact: true }).fill("1.234"); await page.getByLabel("Metal weight basis", { exact: true }).selectOption(""); await materials.locator("summary").first().click();
    await post(page, "/api/admin/catalogue/products", "Save Draft", 400); await page.waitForFunction(() => document.activeElement?.getAttribute("data-field-path") === "product.variants.0.metalWeightBasis"); assert.ok(await page.getByLabel("Metal weight basis", { exact: true }).getAttribute("aria-describedby"));
    await page.getByLabel("Metal weight basis", { exact: true }).selectOption("ESTIMATED"); const saved = await (await post(page, "/api/admin/catalogue/products", "Save Draft")).json(); await page.waitForURL(origin + `/admin/products/${saved.id}/edit`); await settled(page);
    assert.equal((await read(c, saved.id)).variants[0].metalWeightGrams, "1.234");
  } finally { await c.close(); }
});

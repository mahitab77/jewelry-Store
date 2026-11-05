// Exercise retained direct-sales behavior; quotation-only denial has its own suites.
process.env.COMMERCE_MODE = "DIRECT_SALES";
import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { adminBrowserHarness } from "./helpers/admin-browser.mts";
import { product, variant } from "./helpers/catalogue-fixture.mts";
import type { EditorProduct, ProductInput, StoneInput } from "../src/lib/admin/catalogue/types.ts";

// Every mutation is confined by the existing harness to a newly created,
// loopback-only PostgreSQL database and an authenticated mock media provider.
const h = adminBrowserHarness(true, false, false, false, { seedCatalogue: false });
const { origin, signIn, screenshot } = h;
let browser: ReturnType<typeof h.current>["browser"], fixture: ReturnType<typeof h.current>["fixture"], photograph: Buffer;
type Page = Awaited<ReturnType<typeof browser.newPage>>;
type Context = Awaited<ReturnType<typeof browser.newContext>>;
interface RoutedResponse { status(): number }
interface Route {
  request(): { method(): string };
  fetch(): Promise<RoutedResponse>;
  fulfill(value: Record<string, unknown>): Promise<void>;
  continue(): Promise<void>;
}
before(async () => { photograph = await sharp("public/images/ring-emerald.png").resize(500, 500, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer(); });
beforeEach(() => { ({ browser, fixture } = h.current()); });
const token = () => randomUUID().slice(0, 8);
const notice = (page: Page) => page.locator("main").getByRole("alert");
const photoFile = (name: string) => ({ name: `local-only-${name}.png`, mimeType: "image/png", buffer: photograph });
async function context(width = 1440) { return browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 1000 }, reducedMotion: "reduce" }); }
async function pageFor(c: Context) {
  const page = await c.newPage(); page.setDefaultTimeout(15000);
  page.on("dialog", (dialog: { accept(): Promise<void> }) => dialog.accept());
  await signIn(page, "CATALOGUE_MANAGER"); return page;
}
async function post(page: Page, path: string, label: string, status = 200) {
  const waiting = page.waitForResponse((response: { url(): string; request(): { method(): string } }) => response.url() === origin + path && response.request().method() === "POST");
  await page.getByRole("button", { name: label, exact: true }).click();
  const response = await waiting; assert.equal(response.status(), status, `${label}: expected HTTP ${status}`); return response;
}
async function settled(page: Page) {
  await page.waitForFunction(() => [...document.querySelectorAll("form[aria-busy]")].every((form) => form.getAttribute("aria-busy") !== "true"));
}
async function read(c: Context, id: string): Promise<EditorProduct> {
  const response = await c.request.get(origin + `/api/admin/catalogue/products/${id}`); assert.equal(response.status(), 200); return (await response.json()).product;
}
async function create(c: Context, name: string, extra: Partial<ProductInput> = {}): Promise<EditorProduct> {
  const response = await c.request.post(origin + "/api/admin/catalogue/products", { headers: { Origin: origin }, data: { product: product(name, { slug: "", variants: [variant("")], ...extra }), action: "save" } });
  assert.equal(response.status(), 200); return (await response.json()).product;
}
async function category(c: Context, name: string) {
  const response = await c.request.post(origin + "/api/admin/catalogue/taxonomy", { headers: { Origin: origin }, data: { kind: "category", name } });
  assert.equal(response.status(), 200); return (await response.json()).id as string;
}
async function open(page: Page, title: string) {
  const disclosure = page.locator("summary").filter({ hasText: new RegExp("^" + title + "$") }).locator("..");
  if (!await disclosure.evaluate((element: HTMLDetailsElement) => element.open)) await disclosure.locator("summary").first().click();
  return disclosure;
}

test("six-input category-to-jewelry journey saves queued device photographs only after the product exists", { timeout: 150000 }, async () => {
  const c = await context(), name = "LOCAL ONLY basic jewelry " + token();
  try {
    const page = await pageFor(c); await page.goto(origin + "/admin/taxonomy");
    const group = page.getByRole("group", { name: "Create category", exact: true });
    await group.getByLabel("Name", { exact: true }).fill("LOCAL ONLY entry rings " + token());
    assert.equal(await group.getByLabel("URL slug", { exact: true }).isVisible(), false);
    const taxonomy = await (await post(page, "/api/admin/catalogue/taxonomy", "Create category")).json();
    const categoryId = taxonomy.id as string; await settled(page);
    assert.equal(taxonomy.categories.find((item: { id: string }) => item.id === categoryId).visible, true);
    const savedCategory = await fixture.data.query("SELECT slug,display_order,is_visible FROM categories WHERE id=$1", [categoryId]);
    assert.match(savedCategory.rows[0].slug, /^local-only-entry-rings-/); assert.equal(savedCategory.rows[0].display_order, 0);

    await page.goto(origin + "/admin/products/new"); let uploads = 0, creates = 0;
    page.on("request", (request: { url(): string; method(): string }) => { if (request.method() !== "POST") return; if (/\/products\/[^/]+\/photos$/.test(request.url())) uploads++; if (request.url() === origin + "/api/admin/catalogue/products") creates++; });
    await page.getByLabel("Jewelry Name", { exact: true }).fill(name);
    await page.getByLabel("Jewelry Category", { exact: true }).selectOption(categoryId);
    const description = "LOCAL TEST ONLY. An editorial jewelry description with two separate lines.\nNo material, authenticity or provenance claim is made.";
    await page.getByLabel("Description", { exact: true }).fill(description);
    await page.getByLabel("Price (EGP)", { exact: true }).fill("1234.50");
    await page.getByLabel("Available Pieces", { exact: true }).fill("12");
    await page.getByLabel("Add Photographs", { exact: true }).setInputFiles([photoFile("front"), photoFile("side")]);
    assert.equal(await page.getByRole("img", { name: /^Selected photograph/ }).count(), 2); assert.equal(uploads, 0); assert.equal(creates, 0);
    await page.locator("details").filter({ hasText: "Photograph description (optional)" }).first().locator("summary").click();
    await page.getByLabel("Description for selected photograph 1", { exact: true }).fill("Local-only fixture front photograph");
    const creating = await post(page, "/api/admin/catalogue/products", "Save Draft"); const id = (await creating.json()).id as string;
    await page.waitForURL(origin + `/admin/products/${id}/edit`); await settled(page);
    assert.equal(creates, 1); assert.equal(uploads, 2);
    let saved = await read(c, id);
    assert.equal(saved.productType, "REPEATABLE"); assert.equal(saved.salesMode, "DIRECT_PURCHASE"); assert.equal(saved.variants.length, 1);
    assert.equal(saved.variants[0].onHand, 12); assert.equal(saved.variants[0].reserved, 0); assert.equal(saved.variants[0].available, 12);
    assert.equal(saved.variants[0].priceEGP, "1234.50"); assert.match(saved.variants[0].sku, /^LPD-[A-F0-9]+$/);
    assert.match(saved.slug, /^local-only-basic-jewelry-/); assert.equal(saved.description, description); assert.equal(saved.media.length, 2);
    assert.equal(saved.media[0].altText, "Local-only fixture front photograph"); assert.equal(saved.media[1].altText, `${name} — photograph 2`);
    assert.equal(saved.media[0].primary, true); const originalSlug = saved.slug, originalSku = saved.variants[0].sku;
    await page.reload(); assert.equal(await page.getByLabel("Description", { exact: true }).inputValue(), description);
    const edited = "LOCAL TEST ONLY. Updated editorial description retained across save, publication and reload.";
    await page.getByLabel("Jewelry Name", { exact: true }).fill(name + " edited"); await page.getByLabel("Description", { exact: true }).fill(edited);
    await post(page, `/api/admin/catalogue/products/${id}/save`, "Save Draft"); await settled(page); await page.reload();
    saved = await read(c, id); assert.equal(saved.slug, originalSlug); assert.equal(saved.variants[0].sku, originalSku); assert.equal(saved.description, edited);
    await page.getByRole("button", { name: "Move photograph 2 up", exact: true }).click(); await page.getByLabel("Primary photograph 1", { exact: true }).check();
    await post(page, `/api/admin/catalogue/products/${id}/arrange`, "Save photograph order"); await settled(page);
    await post(page, `/api/admin/catalogue/products/${id}/save`, "Publish"); await settled(page);
    const publicPage = await c.newPage(); assert.equal((await publicPage.goto(origin + `/jewels/${originalSlug}`))!.status(), 200);
    assert.ok((await publicPage.locator("main").innerText()).includes(edited)); assert.ok((await publicPage.locator("main").innerText()).includes("1,234.50"));
    assert.equal((await read(c, id)).variants[0].reserved, 0);
    await post(page, `/api/admin/catalogue/products/${id}/save`, "Unpublish"); await settled(page);
    assert.equal((await publicPage.goto(origin + `/jewels/${originalSlug}`))!.status(), 404); assert.equal((await read(c, id)).status, "DRAFT");
  } finally { await c.close(); }
});

test("basic entry has six business fields plus optional Collection at 320, 768, 1024 and 1440 pixels", async () => {
  const c = await context();
  try {
    const page = await pageFor(c); await page.goto(origin + "/admin/products/new");
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const label of ["Jewelry Name", "Jewelry Category", "Description", "Price (EGP)", "Available Pieces", "Add Photographs", "Collection (optional)"]) assert.ok(await page.getByLabel(label, { exact: true }).isVisible(), `${label} is available at ${width}px`);
      for (const label of ["URL slug", "SKU", "Product type", "Sales mode", "Size", "Configuration", "Metal"]) assert.equal(await page.getByLabel(label, { exact: true }).isVisible(), false, `${label} is disclosed only when needed`);
      assert.equal(await page.getByLabel("Available Pieces", { exact: true }).inputValue(), "");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${width}px`);
      const visibleControls = await page.locator("main input:visible,main select:visible,main textarea:visible,main button:visible").evaluateAll((elements: Element[]) => elements.every((element) => { const bounds = element.getBoundingClientRect(); return bounds.left >= -1 && bounds.right <= innerWidth + 1; }));
      assert.equal(visibleControls, true, `Controls stay within ${width}px`);
      await screenshot(page, `simplified-product-${width}`);
    }
    await page.getByLabel("Jewelry Name", { exact: true }).focus(); await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Jewelry Category");
    await page.keyboard.press("Tab"); assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Description");
    assert.ok(Number(await page.getByLabel("Description", { exact: true }).getAttribute("rows")) >= 6);
  } finally { await c.close(); }
});

test("one-of-a-kind limits one piece while enquiry and bespoke drafts do not require prices", async () => {
  const c = await context();
  try {
    const page = await pageFor(c); await page.goto(origin + "/admin/products/new");
    await page.getByLabel("Jewelry Name", { exact: true }).fill("LOCAL ONLY unique piece " + token()); await open(page, "Sizes and variants");
    await page.getByLabel("Product type", { exact: true }).selectOption("ONE_OF_A_KIND");
    assert.equal(await page.getByLabel("Available Pieces", { exact: true }).getAttribute("max"), "1");
    await page.getByLabel("Available Pieces", { exact: true }).fill("2"); await post(page, "/api/admin/catalogue/products", "Save Draft", 400);
    await notice(page).waitFor(); assert.match(await notice(page).innerText(), /one-of-a-kind|cannot exceed one/i);
    await page.getByLabel("Available Pieces", { exact: true }).fill("1"); const unique = await (await post(page, "/api/admin/catalogue/products", "Save Draft")).json();
    await page.waitForURL(origin + `/admin/products/${unique.id}/edit`); assert.equal((await read(c, unique.id)).variants[0].onHand, 1);
    await page.goto(origin + "/admin/products/new"); await page.getByLabel("Jewelry Name", { exact: true }).fill("LOCAL ONLY enquiry piece " + token()); await open(page, "Sizes and variants");
    await page.getByLabel("Sales mode", { exact: true }).selectOption("ENQUIRY_ONLY"); assert.equal(await page.getByLabel("Price (EGP)", { exact: true }).count(), 0);
    const enquiry = await (await post(page, "/api/admin/catalogue/products", "Save Draft")).json(); await page.waitForURL(origin + `/admin/products/${enquiry.id}/edit`);
    assert.equal((await read(c, enquiry.id)).variants[0].priceEGP, "");
    await page.goto(origin + "/admin/products/new"); await page.getByLabel("Jewelry Name", { exact: true }).fill("LOCAL ONLY bespoke piece " + token()); await open(page, "Sizes and variants");
    await page.getByLabel("Product type", { exact: true }).selectOption("BESPOKE"); assert.equal(await page.getByLabel("Sales mode", { exact: true }).inputValue(), "ENQUIRY_ONLY");
    assert.equal(await page.getByLabel("Available Pieces", { exact: true }).count(), 0); assert.equal(await page.getByLabel("Price (EGP)", { exact: true }).count(), 0);
    const bespoke = await (await post(page, "/api/admin/catalogue/products", "Save Draft")).json(); await page.waitForURL(origin + `/admin/products/${bespoke.id}/edit`);
    const saved = await read(c, bespoke.id); assert.equal(saved.productType, "BESPOKE"); assert.equal(saved.salesMode, "ENQUIRY_ONLY"); assert.equal(saved.variants[0].priceEGP, ""); assert.equal(saved.variants[0].available, 0);
  } finally { await c.close(); }
});

test("editing basic copy preserves existing multiple variants, stones, categories, stock and technical identities", async () => {
  const c = await context();
  try {
    const page = await pageFor(c), first = await category(c, "LOCAL ONLY complex type A " + token()), second = await category(c, "LOCAL ONLY complex type B " + token());
    const stone: StoneInput = { kind: "GROUP", type: "Local synthetic specification", variety: "Local test variety", shape: "Round", color: "Blue", caratWeight: "0.1256", origin: "LOCAL TEST: provenance not established", treatment: "LOCAL TEST: no treatment claim", laboratory: "LOCAL TEST ONLY", reportReference: "LOCAL-NOT-A-CERTIFICATE", role: "ACCENT", quantity: 2, totalCaratWeight: "0.2512", displayOrder: 4 };
    const saved = await create(c, "LOCAL ONLY complex piece " + token(), { salesMode: "BOTH", categoryIds: [first, second], variants: [variant("", { size: "54", configuration: "Local small configuration", metalType: "Local fixture metal", metalPurity: "Local fixture purity", metalColor: "Local fixture colour", priceEGP: "75.03", initialStock: 3, stockReason: "Three disposable local pieces", gemstones: [stone] }), variant("", { size: "56", configuration: "Local large configuration", active: false, priceEGP: "90.07", initialStock: 2, stockReason: "Two disposable local pieces", displayOrder: 3 })] });
    await page.goto(origin + `/admin/products/${saved.id}/edit`);
    assert.equal(await page.getByLabel("Price (EGP)", { exact: true }).count(), 0); assert.equal(await page.getByLabel("Available Pieces", { exact: true }).count(), 0);
    await page.getByLabel("Jewelry Name", { exact: true }).fill(saved.name + " edited"); await page.getByLabel("Description", { exact: true }).fill("LOCAL TEST ONLY. Basic description updated without losing advanced specifications.");
    await post(page, `/api/admin/catalogue/products/${saved.id}/save`, "Save Draft"); await settled(page); await page.reload();
    const after = await read(c, saved.id); assert.deepEqual(after.variants, saved.variants); assert.deepEqual(after.categoryIds, saved.categoryIds); assert.equal(after.slug, saved.slug);
    await open(page, "Materials and gemstones"); assert.equal(await page.getByLabel("Treatment disclosure", { exact: true }).inputValue(), stone.treatment); assert.equal(await page.getByLabel("Report reference", { exact: true }).inputValue(), stone.reportReference);
    await open(page, "Technical details"); assert.equal(await page.getByLabel("SKU", { exact: true }).first().inputValue(), saved.variants[0].sku);
  } finally { await c.close(); }
});

test("an invalid collapsed technical field is revealed and receives focus without losing the draft", async () => {
  const c = await context();
  try {
    const page = await pageFor(c); await page.goto(origin + "/admin/products/new"); await page.getByLabel("Jewelry Name", { exact: true }).fill("LOCAL ONLY invalid hidden SKU " + token());
    const details = await open(page, "Technical details"); await page.getByLabel("SKU", { exact: true }).fill("invalid lowercase"); await details.locator("summary").first().click();
    assert.equal(await page.getByLabel("SKU", { exact: true }).isVisible(), false);
    await post(page, "/api/admin/catalogue/products", "Save Draft", 400); await notice(page).waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-field-path") === "product.variants.0.sku");
    assert.ok(await details.evaluate((element: HTMLDetailsElement) => element.open)); assert.equal(await page.getByLabel("SKU", { exact: true }).inputValue(), "invalid lowercase");
    assert.equal(await page.getByLabel("SKU", { exact: true }).getAttribute("aria-invalid"), "true");
    await page.getByLabel("SKU", { exact: true }).fill(""); const saved = await (await post(page, "/api/admin/catalogue/products", "Save Draft")).json();
    await page.waitForURL(origin + `/admin/products/${saved.id}/edit`); assert.match((await read(c, saved.id)).variants[0].sku, /^LPD-[A-F0-9]+$/);
  } finally { await c.close(); }
});

test("a concurrent reservation rejects the stale available-piece target and reloads protected stock counters", async () => {
  const c = await context();
  try {
    const page = await pageFor(c), saved = await create(c, "LOCAL ONLY reservation-race piece " + token(), { variants: [variant("", { initialStock: 5, stockReason: "Five disposable local pieces" })] });
    await page.goto(origin + `/admin/products/${saved.id}/edit`); assert.equal(await page.getByLabel("Available Pieces", { exact: true }).inputValue(), "5");
    // This synthetic local counter change models the independent reservation
    // transaction; no order, payment or real stock reservation is created.
    await fixture.data.query("UPDATE inventory SET reserved=1 WHERE variant_id=$1", [saved.variants[0].id]);
    await page.getByLabel("Available Pieces", { exact: true }).fill("4"); await post(page, `/api/admin/catalogue/products/${saved.id}/inventory/${saved.variants[0].id}`, "Update available pieces", 409);
    await notice(page).filter({ hasText: "Current saved stock has been loaded" }).waitFor(); await settled(page);
    let current = await read(c, saved.id); assert.equal(current.variants[0].onHand, 5); assert.equal(current.variants[0].reserved, 1); assert.equal(current.variants[0].available, 4);
    assert.equal(await page.getByLabel("Available Pieces", { exact: true }).inputValue(), "4");
    await page.getByLabel("Available Pieces", { exact: true }).fill("3"); await post(page, `/api/admin/catalogue/products/${saved.id}/inventory/${saved.variants[0].id}`, "Update available pieces"); await settled(page);
    current = await read(c, saved.id); assert.equal(current.variants[0].onHand, 4); assert.equal(current.variants[0].reserved, 1); assert.equal(current.variants[0].available, 3);
    const audits = await fixture.data.query("SELECT metadata FROM audit_events WHERE target_id=$1 AND action='CATALOGUE_INVENTORY_ADJUSTED'", [saved.id]); assert.equal(audits.rows.length, 1); assert.equal(audits.rows[0].metadata.reserved, 1);
  } finally { await c.close(); }
});

test("an uncertain automatically named create is never retried and its recovery search remains pinned to the submitted name", async () => {
  const c = await context(), name = "LOCAL ONLY uncertain automatic draft " + token(); let attempts = 0;
  try {
    const page = await pageFor(c); await page.goto(origin + "/admin/products/new"); await page.getByLabel("Jewelry Name", { exact: true }).fill(name);
    await page.route(origin + "/api/admin/catalogue/products", async (route: Route) => {
      if (route.request().method() !== "POST") { await route.continue(); return; }
      attempts++; const committed = await route.fetch(); assert.equal(committed.status(), 200);
      await route.fulfill({ status: 503, json: { message: "Local simulated lost response after commit." } });
    });
    await post(page, "/api/admin/catalogue/products", "Save Draft", 503); await notice(page).filter({ hasText: "outcome is uncertain" }).waitFor();
    assert.equal(attempts, 1); assert.ok(await page.getByRole("button", { name: "Save Draft", exact: true }).isDisabled());
    await page.getByLabel("Jewelry Name", { exact: true }).fill("LOCAL ONLY later unsent edits " + token());
    const recovery = page.getByRole("link", { name: "Check product catalogue before creating another draft", exact: true });
    assert.equal(await recovery.getAttribute("href"), `/admin/products?q=${encodeURIComponent(name)}`);
    assert.equal((await fixture.data.query("SELECT count(*)::int AS count FROM products WHERE name=$1", [name])).rows[0].count, 1);
    assert.equal(attempts, 1);
  } finally { await c.close(); }
});

test("a rejected second photograph preserves its local selection and resumes without creating another product", async () => {
  const c = await context(), name = "LOCAL ONLY partial photo draft " + token(); let uploads = 0, creates = 0;
  try {
    const page = await pageFor(c); await page.goto(origin + "/admin/products/new"); await page.getByLabel("Jewelry Name", { exact: true }).fill(name);
    page.on("request", (request: { url(): string; method(): string }) => { if (request.url() === origin + "/api/admin/catalogue/products" && request.method() === "POST") creates++; });
    await page.getByLabel("Add Photographs", { exact: true }).setInputFiles([photoFile("accepted"), photoFile("reject-once")]);
    const pattern = "**/api/admin/catalogue/products/*/photos";
    await page.route(pattern, async (route: Route) => {
      uploads++;
      if (uploads === 2) { await route.fulfill({ status: 400, json: { message: "Local simulated photograph rejection before upload." } }); return; }
      const response = await route.fetch(); await route.fulfill({ response });
    });
    const saved = await (await post(page, "/api/admin/catalogue/products", "Save Draft")).json();
    await notice(page).filter({ hasText: "The product is saved, but a selected photograph was not uploaded" }).waitFor(); await settled(page);
    assert.equal(page.url(), origin + `/admin/products/${saved.id}/edit`, "A confirmed saved product keeps its durable URL even when a later upload fails");
    assert.equal(creates, 1); assert.equal(uploads, 2); assert.equal((await read(c, saved.id)).media.length, 1);
    assert.equal(await page.getByRole("img", { name: /^Selected photograph/ }).count(), 1);
    await page.unroute(pattern); await post(page, `/api/admin/catalogue/products/${saved.id}/photos`, "Upload selected photographs"); await settled(page);
    assert.equal((await read(c, saved.id)).media.length, 2); assert.equal(await page.getByRole("img", { name: /^Selected photograph/ }).count(), 0); assert.equal(creates, 1);
    assert.equal((await fixture.data.query("SELECT count(*)::int AS count FROM products WHERE name=$1", [name])).rows[0].count, 1);
    await page.reload(); assert.equal(await page.getByLabel("Jewelry Name", { exact: true }).inputValue(), name);
  } finally { await c.close(); }
});

test("publication focuses missing description and category while incomplete drafts remain editable", async () => {
  const c = await context();
  try {
    const page = await pageFor(c), saved = await create(c, "LOCAL ONLY incomplete editorial draft " + token(), { description: "", salesMode: "DIRECT_PURCHASE", variants: [variant("", { priceEGP: "123.45" })] });
    await page.goto(origin + `/admin/products/${saved.id}/edit`);
    await post(page, `/api/admin/catalogue/products/${saved.id}/save`, "Publish", 400); await notice(page).waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-field-path") === "product.description");
    assert.equal((await read(c, saved.id)).status, "DRAFT");
    await page.getByLabel("Description", { exact: true }).fill("LOCAL TEST ONLY. A complete editorial description, with no unsupported jewelry claims.");
    await post(page, `/api/admin/catalogue/products/${saved.id}/save`, "Publish", 400); await notice(page).waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-field-path") === "product.categoryIds");
    assert.equal((await read(c, saved.id)).description, ""); // Publication rejection rolls back the whole save.
    await post(page, `/api/admin/catalogue/products/${saved.id}/save`, "Save Draft"); await settled(page);
    assert.match((await read(c, saved.id)).description, /complete editorial/); assert.equal((await read(c, saved.id)).status, "DRAFT");
  } finally { await c.close(); }
});

test("the simplified catalogue workflow retains anonymous, CSRF and order-administration denials", async () => {
  const c = await context(), anonymous = await context();
  try {
    const page = await pageFor(c);
    assert.equal((await anonymous.request.post(origin + "/api/admin/catalogue/products", { headers: { Origin: origin }, data: { product: product("LOCAL ONLY forbidden automatic draft", { slug: "", entryMode: "basic" }), action: "save" } })).status(), 401);
    assert.equal((await c.request.post(origin + "/api/admin/catalogue/products", { headers: { Origin: "https://wrong.example.test" }, data: { product: product("LOCAL ONLY rejected origin", { slug: "", entryMode: "basic" }), action: "save" } })).status(), 403);
    assert.equal((await c.request.post(origin + "/api/admin/orders/search", { headers: { Origin: origin }, data: {} })).status(), 403);
    await page.goto(origin + "/admin"); assert.equal(await page.getByRole("link", { name: "Manage orders", exact: true }).count(), 0);
    assert.equal((await fixture.data.query("SELECT count(*)::int AS count FROM products WHERE name IN('LOCAL ONLY forbidden automatic draft','LOCAL ONLY rejected origin')")).rows[0].count, 0);
  } finally { await c.close(); await anonymous.close(); }
});

test("publication with only inactive configurations opens Sizes and variants and focuses its active control", async () => {
  const c = await context();
  try {
    const page = await pageFor(c), categoryId = await category(c, "LOCAL ONLY inactive type " + token());
    const saved = await create(c, "LOCAL ONLY inactive configuration " + token(), { categoryIds: [categoryId], variants: [variant("", { active: false })] });
    await page.goto(origin + `/admin/products/${saved.id}/edit`); assert.equal(await page.getByLabel("Active variant", { exact: true }).isVisible(), false);
    await post(page, `/api/admin/catalogue/products/${saved.id}/save`, "Publish", 400); await notice(page).waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-field-path") === "product.variants.0.active");
    assert.equal(await page.getByLabel("Active variant", { exact: true }).isVisible(), true); assert.equal(await page.getByLabel("Active variant", { exact: true }).getAttribute("aria-invalid"), "true");
    assert.equal((await read(c, saved.id)).status, "DRAFT");
  } finally { await c.close(); }
});

test("invalid basic quantity stays local, identifies its input and focuses again on a repeated rejection", async () => {
  const c = await context(); let mutations = 0;
  try {
    const page = await pageFor(c), saved = await create(c, "LOCAL ONLY invalid basic quantity " + token(), { productType: "ONE_OF_A_KIND", variants: [variant("", { initialStock: 1, stockReason: "One disposable unique piece" })] });
    await page.goto(origin + `/admin/products/${saved.id}/edit`);
    page.on("request", (request: { url(): string; method(): string }) => { if (/\/inventory\//.test(request.url()) && request.method() === "POST") mutations++; });
    const quantity = page.getByLabel("Available Pieces", { exact: true }); await quantity.fill("2");
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByRole("button", { name: "Update available pieces", exact: true }).click(); await notice(page).waitFor();
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-field-path") === "inventory.availablePieces");
      assert.equal(await quantity.getAttribute("aria-invalid"), "true"); assert.ok(await quantity.getAttribute("aria-describedby"));
      await page.getByLabel("Jewelry Name", { exact: true }).focus();
    }
    assert.equal(mutations, 0); assert.equal((await read(c, saved.id)).variants[0].onHand, 1);
  } finally { await c.close(); }
});

test("both quantity controls initialize a legacy missing inventory row from its actual null snapshot without retries", async () => {
  const c = await context(); let mutations = 0;
  try {
    const page = await pageFor(c);
    const basic = await create(c, "LOCAL ONLY legacy missing basic inventory " + token());
    const detailed = await create(c, "LOCAL ONLY legacy missing detailed inventory " + token());
    await fixture.data.query("DELETE FROM inventory WHERE variant_id=ANY($1::uuid[])", [[basic.variants[0].id, detailed.variants[0].id]]);
    page.on("request", (request: { url(): string; method(): string }) => { if (/\/inventory\//.test(request.url()) && request.method() === "POST") mutations++; });

    await page.goto(origin + `/admin/products/${basic.id}/edit`);
    const missingBasic = await read(c, basic.id); assert.equal(missingBasic.variants[0].onHand, null); assert.equal(missingBasic.variants[0].reserved, 0);
    assert.equal(await page.getByLabel("Available Pieces", { exact: true }).inputValue(), "0");
    await page.getByLabel("Available Pieces", { exact: true }).fill("2");
    const basicResult = await post(page, `/api/admin/catalogue/products/${basic.id}/inventory/${basic.variants[0].id}`, "Update available pieces"); await settled(page);
    const basicCommand = basicResult.request().postDataJSON();
    assert.equal(basicCommand.expectedOnHand, null); assert.equal(basicCommand.expectedReserved, 0); assert.equal(basicCommand.revision, missingBasic.revision);
    const savedBasic = await read(c, basic.id); assert.equal(savedBasic.variants[0].onHand, 2); assert.equal(savedBasic.variants[0].reserved, 0); assert.equal(savedBasic.variants[0].available, 2);
    assert.equal(mutations, 1);

    await page.goto(origin + `/admin/products/${detailed.id}/edit`);
    const missingDetailed = await read(c, detailed.id); assert.equal(missingDetailed.variants[0].onHand, null);
    const stock = await open(page, "Detailed stock adjustments");
    await stock.getByLabel("Adjustment (+/− units)", { exact: true }).fill("3");
    await stock.getByLabel("Adjustment reason", { exact: true }).fill("Initialize three disposable legacy fixture pieces");
    const detailedResult = await post(page, `/api/admin/catalogue/products/${detailed.id}/inventory/${detailed.variants[0].id}`, `Apply stock adjustment for ${detailed.variants[0].sku}`); await settled(page);
    const detailedCommand = detailedResult.request().postDataJSON();
    assert.equal(detailedCommand.expectedOnHand, null); assert.equal(detailedCommand.expectedReserved, 0); assert.equal(detailedCommand.revision, missingDetailed.revision);
    const savedDetailed = await read(c, detailed.id); assert.equal(savedDetailed.variants[0].onHand, 3); assert.equal(savedDetailed.variants[0].reserved, 0); assert.equal(savedDetailed.variants[0].available, 3);
    assert.equal(mutations, 2, "Each explicit quantity action sends exactly one mutation");
    const audits = await fixture.data.query("SELECT target_id,metadata FROM audit_events WHERE target_id=ANY($1::uuid[]) AND action='CATALOGUE_INVENTORY_ADJUSTED' ORDER BY metadata->>'after'", [[basic.id, detailed.id]]);
    assert.equal(audits.rows.length, 2);
    for (const event of audits.rows) { assert.equal(event.metadata.before, 0); assert.equal(event.metadata.reserved, 0); }
    assert.deepEqual(audits.rows.map((event) => event.metadata.after), [2, 3]);
  } finally { await c.close(); }
});

import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { adminBrowserHarness } from "./helpers/admin-browser.mts";
import { editable, product, variant } from "./helpers/catalogue-fixture.mts";
import type { EditorProduct } from "../src/lib/admin/catalogue/types.ts";

// This suite owns an empty disposable catalogue. All catalogue mutations go
// through the rendered editor or its real HTTP API; SQL below is read-only.
const harness = adminBrowserHarness(true, false, false, false, { seedCatalogue: false });
const { origin, signIn, screenshot } = harness;
let browser: ReturnType<typeof harness.current>["browser"], fixture: ReturnType<typeof harness.current>["fixture"], photo: Buffer;
type Page = Awaited<ReturnType<typeof browser.newPage>>;
type Locator = ReturnType<Page["locator"]>;
before(async () => { photo = await sharp("public/images/ring-emerald.png").resize(600, 600, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer(); });
beforeEach(() => { ({ browser, fixture } = harness.current()); });

const names = { category: "Local audit rings", otherCategory: "Local audit small rings", collection: "Local audit selection", otherCollection: "Local audit second selection" };
const slugs = { category: "local-audit-rings", otherCategory: "local-audit-small-rings", collection: "local-audit-selection", otherCollection: "local-audit-second-selection", product: "local-complete-editor-fixture" };
const stoneLabels = { type: "Stone type", variety: "Variety", shape: "Shape / cut", color: "Colour", caratWeight: "Carat weight", origin: "Known origin", treatment: "Treatment disclosure", laboratory: "Laboratory name", reportReference: "Report reference", totalCaratWeight: "Total carat weight" } as const;
const variantLabels = { sku: "SKU", size: "Size", configuration: "Configuration", metalType: "Metal", metalPurity: "Metal purity", metalColor: "Metal colour", priceEGP: "Selling price (EGP)", displayOrder: "Variant display order" } as const;
const stones = [
  { type: "Local sapphire fixture", variety: "Local simulated variety", shape: "Round", color: "Blue", caratWeight: "1.25", origin: "LOCAL TEST: provenance not established", treatment: "LOCAL TEST ONLY: no treatment claim", laboratory: "LOCAL TEST ONLY", reportReference: "LOCAL-TEST-NOT-A-CERTIFICATE", totalCaratWeight: "2.5", kind: "GROUP", role: "CENTER", quantity: "2", displayOrder: "1" },
  { type: "Local spinel fixture", variety: "", shape: "Oval", color: "Grey", caratWeight: "0.1256", origin: "", treatment: "Local test disclosure", laboratory: "", reportReference: "", totalCaratWeight: "0.2512", kind: "GROUP", role: "ACCENT", quantity: "2", displayOrder: "3" },
];
const variants = [
  { sku: "LOCAL-MGMT-ONE", size: "54", configuration: "Local small configuration", metalType: "Local gold fixture", metalPurity: "18K fixture", metalColor: "Yellow fixture", priceEGP: "1234.5", displayOrder: "0", active: true, initialStock: "3", stockReason: "Three disposable local units" },
  { sku: "LOCAL-MGMT-TWO", size: "56", configuration: "Local large configuration", metalType: "Local silver fixture", metalPurity: "925 fixture", metalColor: "White fixture", priceEGP: "2345.67", displayOrder: "5", active: false, initialStock: "0", stockReason: "Local zero-stock fixture" },
];
const stoneGroup = (parent: Locator, index: number) => parent.getByRole("heading", { name: `Gemstone ${index}`, exact: true }).locator("..");
const variantGroup = (page: Page, index: number) => page.getByRole("group", { name: `Variant ${index}`, exact: true });
async function operation(page: Page, label: string, suffix: string, expectedStatus = 200) {
  const response = page.waitForResponse((r: { url(): string; request(): { method(): string } }) => r.url() === origin + "/api/admin/catalogue/" + suffix && r.request().method() === "POST");
  await page.getByRole("button", { name: label, exact: true }).click();
  const result = await response;
  assert.equal(result.status(), expectedStatus, `${label} HTTP result`);
  if (expectedStatus === 200 && suffix !== "products") await page.getByRole("status").filter({ hasText: /saved|uploaded|removed|completed/i }).first().waitFor();
  else if (expectedStatus !== 200) await page.locator("main").getByRole("alert").waitFor();
  return result;
}
async function fillStone(group: Locator, value: typeof stones[number]) {
  for (const [key, label] of Object.entries(stoneLabels)) await group.getByLabel(label, { exact: true }).fill(value[key as keyof typeof stoneLabels]);
  await group.getByLabel("Specification kind", { exact: true }).selectOption(value.kind);
  await group.getByLabel("Gemstone role", { exact: true }).selectOption(value.role);
  await group.getByLabel("Gemstone quantity", { exact: true }).fill(value.quantity);
  await group.getByLabel("Gemstone display order", { exact: true }).fill(value.displayOrder);
}
async function compareStone(group: Locator, value: typeof stones[number]) {
  for (const [key, label] of Object.entries(stoneLabels)) {
    const expected = key === "caratWeight" || key === "totalCaratWeight" ? value[key as keyof typeof stoneLabels] && Number(value[key as keyof typeof stoneLabels]).toFixed(4) : value[key as keyof typeof stoneLabels];
    assert.equal(await group.getByLabel(label, { exact: true }).inputValue(), expected, `Reload ${label}`);
  }
  for (const [label, expected] of [["Specification kind", value.kind], ["Gemstone role", value.role], ["Gemstone quantity", value.quantity], ["Gemstone display order", value.displayOrder]]) assert.equal(await group.getByLabel(label, { exact: true }).inputValue(), expected);
}
async function fillVariant(group: Locator, value: typeof variants[number]) {
  for (const [key, label] of Object.entries(variantLabels)) await group.getByLabel(label, { exact: true }).fill(value[key as keyof typeof variantLabels]);
  await group.getByLabel("Active variant", { exact: true }).setChecked(value.active);
  await group.getByLabel("Initial stock", { exact: true }).fill(value.initialStock);
  await group.getByLabel("Initial stock reason", { exact: true }).fill(value.stockReason);
}
async function compareVariant(group: Locator, value: typeof variants[number]) {
  for (const [key, label] of Object.entries(variantLabels)) assert.equal(await group.getByLabel(label, { exact: true }).inputValue(), key === "priceEGP" ? Number(value.priceEGP).toFixed(2) : value[key as keyof typeof variantLabels], `Reload ${label}`);
  assert.equal(await group.getByLabel("Active variant", { exact: true }).isChecked(), value.active);
}
async function createGrouping(page: Page, kind: "category" | "collection", name: string, slug: string, order: string, parent?: string) {
  await page.getByLabel(kind === "category" ? "Choose category" : "Choose collection", { exact: true }).selectOption("");
  const group = page.getByRole("group", { name: `Create ${kind}`, exact: true });
  await group.getByLabel("Name", { exact: true }).fill(name); await group.getByLabel("URL slug", { exact: true }).fill(slug);
  await group.getByLabel("Description", { exact: true }).fill("Disposable local taxonomy fixture."); await group.getByLabel("Display order", { exact: true }).fill(order);
  if (kind === "category") { await group.getByLabel("Visible category", { exact: true }).check(); if (parent) await group.getByLabel("Parent category", { exact: true }).selectOption({ label: parent }); }
  else await group.getByLabel("Collection status", { exact: true }).selectOption("DRAFT");
  await operation(page, `Create ${kind}`, "taxonomy");
  const saved = page.getByRole("group", { name: `Edit ${kind}`, exact: true });
  assert.equal(await saved.getByLabel("Name", { exact: true }).inputValue(), name); assert.equal(await saved.getByLabel("URL slug", { exact: true }).inputValue(), slug);
  assert.equal(await saved.getByLabel("Description", { exact: true }).inputValue(), "Disposable local taxonomy fixture."); assert.equal(await saved.getByLabel("Display order", { exact: true }).inputValue(), order);
  if (kind === "collection") { await saved.getByLabel("Collection status", { exact: true }).selectOption("PUBLISHED"); await operation(page, "Save collection", "taxonomy"); }
}
async function upload(page: Page, id: string, alt: string) {
  await page.getByLabel("Photograph", { exact: true }).setInputFiles({ name: "approved-local-ring.png", mimeType: "image/png", buffer: photo });
  await page.getByLabel("Photograph description (alt text)", { exact: true }).fill(alt);
  await operation(page, "Upload photograph", `products/${id}/photos`);
  assert.equal(await page.getByLabel("Photograph", { exact: true }).inputValue(), "");
}
async function editorJson(context: Awaited<ReturnType<typeof browser.newContext>>, id: string): Promise<EditorProduct> {
  const response = await context.request.get(origin + `/api/admin/catalogue/products/${id}`); assert.equal(response.status(), 200); return (await response.json()).product;
}
async function persistedCounts() {
  return (await fixture.data.query("SELECT (SELECT count(*) FROM products)::int AS products,(SELECT count(*) FROM product_variants)::int AS variants,(SELECT count(*) FROM product_prices)::int AS prices,(SELECT count(*) FROM inventory)::int AS inventory,(SELECT count(*) FROM gemstones)::int AS gemstones,(SELECT count(*) FROM product_gemstones)::int AS associations,(SELECT count(*) FROM audit_events)::int AS audits")).rows[0];
}

test("empty catalogue manager creates taxonomy and round-trips every editor field through publication and archive", { timeout: 240000 }, async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  try {
    assert.deepEqual((await fixture.data.query("SELECT (SELECT count(*) FROM categories)::int AS categories,(SELECT count(*) FROM collections)::int AS collections,(SELECT count(*) FROM products)::int AS products")).rows[0], { categories: 0, collections: 0, products: 0 });
    const page = await context.newPage(), pageErrors: string[] = []; page.setDefaultTimeout(15000); page.on("pageerror", () => pageErrors.push("Page runtime error")); page.on("dialog", (dialog: { accept(): Promise<void> }) => dialog.accept());
    await signIn(page, "CATALOGUE_MANAGER"); await page.goto(origin + "/admin/products/new"); assert.ok(await page.getByText("No categories are configured.", { exact: false }).isVisible());
    await page.goto(origin + "/admin/taxonomy"); await page.getByRole("heading", { name: "Categories and collections", exact: true }).waitFor();
    await createGrouping(page, "category", names.category, slugs.category, "2"); await createGrouping(page, "category", names.otherCategory, slugs.otherCategory, "3", names.category);
    await createGrouping(page, "collection", names.collection, slugs.collection, "4"); await createGrouping(page, "collection", names.otherCollection, slugs.otherCollection, "5");
    await page.reload(); assert.equal(await page.getByLabel("Choose category", { exact: true }).locator("option").count(), 3); assert.equal(await page.getByLabel("Choose collection", { exact: true }).locator("option").count(), 3);
    await page.getByLabel("Choose category", { exact: true }).selectOption({ label: names.otherCategory });
    const categoryForm = page.getByRole("group", { name: "Edit category", exact: true });
    assert.equal(await categoryForm.getByLabel("Parent category", { exact: true }).locator("option:checked").innerText(), names.category);
    assert.ok(await categoryForm.getByLabel("Visible category", { exact: true }).isChecked());
    await categoryForm.getByLabel("Description", { exact: true }).fill("Updated disposable category description.");
    await operation(page, "Save category", "taxonomy"); await page.reload();
    await page.getByLabel("Choose category", { exact: true }).selectOption({ label: names.otherCategory });
    assert.equal(await page.getByRole("group", { name: "Edit category", exact: true }).getByLabel("Description", { exact: true }).inputValue(), "Updated disposable category description.");
    await page.getByLabel("Choose collection", { exact: true }).selectOption({ label: names.collection + " (published)" });
    assert.equal(await page.getByRole("group", { name: "Edit collection", exact: true }).getByLabel("Collection status", { exact: true }).inputValue(), "PUBLISHED");
    await screenshot(page, "product-taxonomy-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await screenshot(page, "product-taxonomy-mobile");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(origin + "/admin/products/new");
    await page.getByLabel("Product name", { exact: true }).fill("Local complete editor fixture"); await page.getByLabel("URL slug", { exact: true }).fill(slugs.product);
    const description = "Disposable local jewellery fixture only. Not a real product.\nAll specifications below are synthetic test data.";
    await page.getByLabel("Description", { exact: true }).fill(description); await page.getByLabel("Product type", { exact: true }).selectOption("REPEATABLE"); await page.getByLabel("Sales mode", { exact: true }).selectOption("BOTH");
    await page.getByLabel(names.category, { exact: true }).check(); await page.getByLabel(`${names.collection} (published)`, { exact: true }).check();
    await page.getByRole("button", { name: "Add variant", exact: true }).click(); await fillVariant(variantGroup(page, 1), variants[0]);
    for (const [index, stone] of stones.entries()) { await variantGroup(page, 1).getByRole("button", { name: "Add gemstone", exact: true }).click(); await fillStone(stoneGroup(variantGroup(page, 1), index + 1), stone); }
    await page.getByRole("button", { name: "Add variant", exact: true }).click(); await fillVariant(variantGroup(page, 2), variants[1]);
    await operation(page, "Create draft", "products"); await page.waitForURL(/\/admin\/products\/[0-9a-f-]{36}\/edit$/); const id = page.url().split("/").at(-2)!;
    await page.reload(); await page.getByRole("heading", { name: "Edit product", exact: true }).waitFor();
    assert.equal(await page.getByLabel("Product name", { exact: true }).inputValue(), "Local complete editor fixture"); assert.equal(await page.getByLabel("URL slug", { exact: true }).inputValue(), slugs.product);
    assert.equal(await page.getByLabel("Description", { exact: true }).inputValue(), description); assert.equal(await page.getByLabel("Product type", { exact: true }).inputValue(), "REPEATABLE"); assert.ok(await page.getByLabel("Product type", { exact: true }).isDisabled()); assert.equal(await page.getByLabel("Sales mode", { exact: true }).inputValue(), "BOTH");
    assert.ok(await page.getByLabel(names.category, { exact: true }).isChecked()); assert.ok(await page.getByLabel(`${names.collection} (published)`, { exact: true }).isChecked());
    for (const [index, value] of variants.entries()) await compareVariant(variantGroup(page, index + 1), value);
    for (const [index, value] of stones.entries()) await compareStone(stoneGroup(variantGroup(page, 1), index + 1), value);
    const persisted = await editorJson(context, id); assert.deepEqual(persisted.variants.map(v => [v.onHand, v.reserved, v.available]), [[3, 0, 3], [0, 0, 0]]);
    const initialAudits = (await fixture.data.query("SELECT metadata FROM audit_events WHERE target_id=$1 AND action='CATALOGUE_INVENTORY_INITIALISED'", [id])).rows;
    assert.deepEqual(initialAudits.map(r => r.metadata.reason).sort(), variants.map(v => v.stockReason).sort());
    const publicPage = await context.newPage(); assert.equal((await publicPage.goto(origin + `/jewels/${slugs.product}`))!.status(), 404);
    await operation(page, "Publish", `products/${id}/save`, 400); assert.match(await page.locator("main").getByRole("alert").innerText(), /photograph/i); assert.equal((await editorJson(context, id)).status, "DRAFT");
    await upload(page, id, "Local fixture front reference"); await upload(page, id, "Local fixture detail reference");
    const mediaBefore = (await editorJson(context, id)).media;
    await page.getByLabel("Alt text for photograph 1", { exact: true }).fill("Local approved front reference"); await page.getByLabel("Alt text for photograph 2", { exact: true }).fill("Local approved detail reference"); await page.getByLabel("Primary photograph 2", { exact: true }).check();
    await operation(page, "Save photograph order", `products/${id}/arrange`); await page.reload();
    const mediaAfter = (await editorJson(context, id)).media; assert.deepEqual(mediaAfter.map(m => m.id), mediaBefore.map(m => m.id)); assert.deepEqual(mediaAfter.map(m => m.displayOrder), [0, 1]); assert.equal(mediaAfter[1].primary, true);
    assert.equal(await page.getByLabel("Alt text for photograph 1", { exact: true }).inputValue(), "Local approved front reference"); assert.equal(await page.getByLabel("Alt text for photograph 2", { exact: true }).inputValue(), "Local approved detail reference"); assert.ok(await page.getByLabel("Primary photograph 2", { exact: true }).isChecked());
    await variantGroup(page, 2).getByLabel("Active variant", { exact: true }).check(); await operation(page, "Save draft", `products/${id}/save`);
    await operation(page, "Publish", `products/${id}/save`); assert.equal((await publicPage.goto(origin + `/jewels/${slugs.product}`))!.status(), 200);
    await publicPage.getByRole("heading", { name: "Local complete editor fixture", exact: true }).waitFor(); assert.match(await publicPage.title(), /Local complete editor fixture/);
    await publicPage.waitForFunction((alt: string) => [...document.images].some(image => image.alt === alt && image.complete && image.naturalWidth > 0), "Local approved detail reference");
    assert.ok(await publicPage.getByRole("button", { name: "Show photograph 2", exact: true }).getAttribute("aria-pressed") === "true");
    assert.match(await publicPage.locator("main").innerText(), /1,234\.50/); assert.ok(!(await publicPage.locator("main").innerText()).includes("LOCAL-TEST-NOT-A-CERTIFICATE")); assert.ok(!(await publicPage.locator("main").innerText()).includes("provenance not established"));
    await publicPage.getByRole("radio", { name: /56/ }).check(); assert.match(await publicPage.locator("main").innerText(), /2,345\.67/); assert.ok(await publicPage.getByText("Currently unavailable", { exact: true }).isVisible()); assert.equal(await publicPage.getByRole("button", { name: /Add.*bag/i }).count(), 0);
    await publicPage.getByRole("radio", { name: /54/ }).check(); assert.ok(await publicPage.getByRole("button", { name: /Add.*bag/i }).isVisible());
    const canonicalNode = publicPage.locator('link[rel="canonical"]'); const canonical = await canonicalNode.count() ? await canonicalNode.getAttribute("href") : null; if (canonical) assert.equal(new URL(canonical).pathname, `/jewels/${slugs.product}`);
    await screenshot(publicPage, "product-detail-roundtrip-desktop");
    const editedStone = { ...stones[0], variety: "Local edited variety", caratWeight: "1.5001", treatment: "Local edited disclosure", laboratory: "LOCAL EDIT TEST ONLY", reportReference: "LOCAL-EDIT-NOT-A-CERTIFICATE", totalCaratWeight: "3.0002" };
    await page.getByLabel("Product name", { exact: true }).fill("Local edited editor fixture"); await page.getByLabel("Description", { exact: true }).fill("Edited disposable product description.");
    await page.getByLabel(names.category, { exact: true }).uncheck(); await page.getByLabel(names.otherCategory, { exact: true }).check(); await page.getByLabel(`${names.collection} (published)`, { exact: true }).uncheck(); await page.getByLabel(`${names.otherCollection} (published)`, { exact: true }).check();
    const editedVariant = { ...variants[0], size: "55", configuration: "Local edited configuration", metalType: "Local edited metal", metalPurity: "Edited purity", metalColor: "Edited colour", priceEGP: "1400.07" };
    for (const [key, label] of Object.entries(variantLabels)) await variantGroup(page, 1).getByLabel(label, { exact: true }).fill(editedVariant[key as keyof typeof variantLabels]);
    await fillStone(stoneGroup(variantGroup(page, 1), 1), editedStone); await operation(page, "Save changes", `products/${id}/save`); await page.reload();
    assert.equal(await page.getByLabel("Product name", { exact: true }).inputValue(), "Local edited editor fixture"); assert.equal(await page.getByLabel("Description", { exact: true }).inputValue(), "Edited disposable product description."); assert.equal(await page.getByLabel("URL slug", { exact: true }).inputValue(), slugs.product); assert.equal(await page.getByLabel("URL slug", { exact: true }).isEditable(), false);
    assert.equal(await page.getByLabel(names.category, { exact: true }).isChecked(), false); assert.ok(await page.getByLabel(names.otherCategory, { exact: true }).isChecked()); assert.equal(await page.getByLabel(`${names.collection} (published)`, { exact: true }).isChecked(), false); assert.ok(await page.getByLabel(`${names.otherCollection} (published)`, { exact: true }).isChecked());
    await compareVariant(variantGroup(page, 1), editedVariant); await compareStone(stoneGroup(variantGroup(page, 1), 1), editedStone);
    const inventoryForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Apply stock adjustment for LOCAL-MGMT-ONE", exact: true }) });
    await inventoryForm.getByLabel("Adjustment (+/− units)", { exact: true }).fill("-1"); await inventoryForm.getByLabel("Adjustment reason", { exact: true }).fill("Local audited stock correction"); await operation(page, "Apply stock adjustment for LOCAL-MGMT-ONE", `products/${id}/inventory/${persisted.variants[0].id}`);
    assert.equal((await editorJson(context, id)).variants[0].onHand, 2); assert.equal(await inventoryForm.getByLabel("Adjustment reason", { exact: true }).inputValue(), "");
    assert.equal((await fixture.data.query("SELECT metadata->>'reason' AS reason FROM audit_events WHERE target_id=$1 AND action='CATALOGUE_INVENTORY_ADJUSTED' ORDER BY created_at DESC LIMIT 1", [id])).rows[0].reason, "Local audited stock correction");
    await page.getByRole("button", { name: "Move photograph 2 up", exact: true }).click(); await operation(page, "Save photograph order", `products/${id}/arrange`); assert.equal((await editorJson(context, id)).media[0].id, mediaBefore[1].id);
    await publicPage.goto(origin + `/collections/${slugs.category}`); assert.equal(await publicPage.locator(`a[href="/jewels/${slugs.product}"]`).count(), 0);
    await publicPage.goto(origin + `/collections/${slugs.otherCategory}`); assert.ok(await publicPage.locator(`a[href="/jewels/${slugs.product}"]`).count() > 0);
    await publicPage.goto(origin + `/collections/edit/${slugs.otherCollection}`); assert.ok(await publicPage.locator(`a[href="/jewels/${slugs.product}"]`).count() > 0);
    await publicPage.goto(origin + `/jewels/${slugs.product}`); assert.match(await publicPage.locator("main").innerText(), /1,400\.07/);
    await operation(page, "Unpublish", `products/${id}/save`); assert.equal((await publicPage.goto(origin + `/jewels/${slugs.product}`))!.status(), 404); assert.equal((await context.request.get(origin + `/catalogue-images/${mediaBefore[1].id}`)).status(), 404);
    await page.getByRole("button", { name: "Remove photograph 2", exact: true }).click(); await page.getByRole("status").filter({ hasText: /removed/i }).waitFor(); assert.equal((await editorJson(context, id)).media.length, 1);
    await variantGroup(page, 1).getByRole("button", { name: "Detach gemstone 2", exact: true }).click(); await operation(page, "Save draft", `products/${id}/save`); assert.equal((await editorJson(context, id)).variants[0].gemstones.length, 1);
    await operation(page, "Archive", `products/${id}/save`); assert.equal((await editorJson(context, id)).status, "ARCHIVED"); assert.equal((await fixture.data.query("SELECT count(*)::int AS n FROM product_variants WHERE product_id=$1", [id])).rows[0].n, 2);
    assert.equal((await fixture.data.query("SELECT count(*)::int AS n FROM product_prices WHERE variant_id=$1", [persisted.variants[0].id])).rows[0].n, 2);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.equal(await page.locator("nextjs-portal").count(), 0); assert.deepEqual(pageErrors, []); await page.evaluate(() => window.scrollTo(0, 0)); await screenshot(page, "product-editor-roundtrip-desktop");
  } finally { await context.close(); }
});

test("invalid editor/API operations and unauthorized access cannot partially persist products", { timeout: 90000 }, async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(15000); await signIn(page, "CATALOGUE_MANAGER");
    const categoryResponse = await context.request.post(origin + "/api/admin/catalogue/taxonomy", { headers: { Origin: origin }, data: { kind: "category", name: "Local rollback category", slug: "local-rollback-category", description: "Disposable security fixture.", displayOrder: 10, parentId: null, visible: true } }); assert.equal(categoryResponse.status(), 200); const category = (await categoryResponse.json()).id as string;
    const existingResponse = await context.request.post(origin + "/api/admin/catalogue/products", { headers: { Origin: origin }, data: { product: product("Local existing collision fixture", { categoryIds: [category], variants: [variant("LOCAL-ROLLBACK-EXISTING")] }), action: "save" } }); assert.equal(existingResponse.status(), 200); const existingId = (await existingResponse.json()).id as string;
    await page.goto(origin + "/admin/products/new");
    await page.getByLabel("Product name", { exact: true }).fill("Local invalid editor fixture"); await page.getByLabel("URL slug", { exact: true }).fill("INVALID SLUG");
    const before = await persistedCounts(); await page.getByRole("button", { name: "Create draft", exact: true }).click();
    await page.waitForFunction(() => Boolean(document.querySelector('main [role="alert"]') || document.querySelector("input:invalid")));
    assert.deepEqual(await persistedCounts(), before);
    const input = product("Local atomic API collision", { categoryIds: [category], salesMode: "DIRECT_PURCHASE", variants: [variant("LOCAL-ATOMIC-FIRST", { priceEGP: "10.01", initialStock: 1, stockReason: "Disposable rollback unit" }), variant("LOCAL-ROLLBACK-EXISTING", { configuration: "Unique input but colliding stored SKU", priceEGP: "20.02" })] });
    const atomicBefore = await persistedCounts(); const collision = await context.request.post(origin + "/api/admin/catalogue/products", { headers: { Origin: origin }, data: { product: input, action: "save" } }); assert.equal(collision.status(), 409); assert.deepEqual(await persistedCounts(), atomicBefore);
    assert.equal((await fixture.data.query("SELECT count(*)::int AS n FROM products WHERE slug=$1", [input.slug])).rows[0].n, 0);
    const invalidPrice = await context.request.post(origin + "/api/admin/catalogue/products", { headers: { Origin: origin }, data: { product: { ...input, slug: "local-bad-precision", variants: [variant("LOCAL-BAD-PRECISION", { priceEGP: "1.001" })] }, action: "save" } }); assert.equal(invalidPrice.status(), 400); assert.deepEqual(await persistedCounts(), atomicBefore);
    const foreignAssignment = await context.request.post(origin + "/api/admin/catalogue/products", { headers: { Origin: origin }, data: { product: product("Local missing category", { categoryIds: [randomUUID()] }), action: "save" } }); assert.equal(foreignAssignment.status(), 409); assert.deepEqual(await persistedCounts(), atomicBefore);
    const crossOrigin = await context.request.post(origin + "/api/admin/catalogue/products", { headers: { Origin: "https://untrusted.invalid" }, data: { product: product("Local cross-origin denied"), action: "save" } }); assert.equal(crossOrigin.status(), 403); assert.deepEqual(await persistedCounts(), atomicBefore);
    const existing = await editorJson(context, existingId);
    const forged = await context.request.post(origin + `/api/admin/catalogue/products/${existingId}/save`, { headers: { Origin: origin }, data: { product: { ...editable(existing), role: "OWNER" }, action: "save", revision: existing.revision } }); assert.equal(forged.status(), 400); assert.deepEqual(await persistedCounts(), atomicBefore);
    const anonymous = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const denied = await anonymous.request.post(origin + "/api/admin/catalogue/products", { headers: { Origin: origin }, data: { product: product("Local anonymous denied"), action: "save" } }); assert.equal(denied.status(), 401);
      const deniedTaxonomy = await anonymous.request.post(origin + "/api/admin/catalogue/taxonomy", { headers: { Origin: origin }, data: { kind: "category", name: "Denied", slug: "denied", description: "", displayOrder: 0, parentId: null, visible: true } }); assert.equal(deniedTaxonomy.status(), 401); assert.deepEqual(await persistedCounts(), atomicBefore);
      const visitor = await anonymous.newPage(); await visitor.goto(origin + "/admin/products"); await visitor.waitForURL(origin + "/admin/login");
    } finally { await anonymous.close(); }
  } finally { await context.close(); }
});

test("mobile editor preserves individual one-of-a-kind fields and stock limits without overflow", { timeout: 120000 }, async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("dialog", (dialog: { accept(): Promise<void> }) => dialog.accept()); await signIn(page, "CATALOGUE_MANAGER");
    const categoryResponse = await context.request.post(origin + "/api/admin/catalogue/taxonomy", { headers: { Origin: origin }, data: { kind: "category", name: "Local mobile category", slug: "local-mobile-category", description: "Disposable mobile fixture.", displayOrder: 11, parentId: null, visible: true } }); assert.equal(categoryResponse.status(), 200);
    await page.goto(origin + "/admin/products/new");
    await page.getByLabel("Product name", { exact: true }).fill("Local mobile unique fixture"); await page.getByLabel("URL slug", { exact: true }).fill("local-mobile-unique-fixture"); await page.getByLabel("Description", { exact: true }).fill("Local disposable one-of-a-kind fixture only."); await page.getByLabel("Sales mode", { exact: true }).selectOption("BOTH"); await page.getByLabel("Local mobile category", { exact: true }).check();
    await page.getByRole("button", { name: "Add variant", exact: true }).click(); const group = variantGroup(page, 1);
    await fillVariant(group, { ...variants[0], sku: "LOCAL-MOBILE-UNIQUE", priceEGP: "90071992547409.93", initialStock: "1", stockReason: "One disposable unique unit" });
    await group.getByRole("button", { name: "Add gemstone", exact: true }).click(); const individual = { ...stones[0], kind: "INDIVIDUAL", quantity: "1", totalCaratWeight: "1.25" }; await fillStone(stoneGroup(group, 1), individual);
    await operation(page, "Create draft", "products"); await page.waitForURL(/\/admin\/products\/[0-9a-f-]{36}\/edit$/); const id = page.url().split("/").at(-2)!; await page.reload();
    assert.equal(await variantGroup(page, 1).getByLabel("Selling price (EGP)", { exact: true }).inputValue(), "90071992547409.93"); await compareStone(stoneGroup(variantGroup(page, 1), 1), individual); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await screenshot(page, "product-editor-roundtrip-mobile");
    const record = await editorJson(context, id); const before = await persistedCounts(); const stock = await context.request.post(origin + `/api/admin/catalogue/products/${id}/inventory/${record.variants[0].id}`, { headers: { Origin: origin }, data: { delta: 1, reason: "Invalid additional unique fixture unit" } }); assert.equal(stock.status(), 409); assert.equal((await editorJson(context, id)).variants[0].onHand, 1); assert.deepEqual(await persistedCounts(), before);
    await upload(page, id, "Local mobile approved ring reference"); await page.getByRole("heading", { name: "Product photographs", exact: true }).scrollIntoViewIfNeeded(); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await screenshot(page, "product-media-roundtrip-mobile");
    await operation(page, "Publish", `products/${id}/save`); const visitor = await context.newPage(); assert.equal((await visitor.goto(origin + "/jewels/local-mobile-unique-fixture"))!.status(), 200); assert.match(await visitor.locator("main").innerText(), /90,071,992,547,409\.93/); assert.ok(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await operation(page, "Unpublish", `products/${id}/save`); await operation(page, "Archive", `products/${id}/save`); assert.equal((await editorJson(context, id)).status, "ARCHIVED");
  } finally { await context.close(); }
});


test("repeatable variants with an individual stone cannot save or adjust more than one unit", { timeout: 90000 }, async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("dialog", (dialog: { accept(): Promise<void> }) => dialog.accept());
    await signIn(page, "CATALOGUE_MANAGER"); await page.goto(origin + "/admin/products/new");
    await page.getByLabel("Product name", { exact: true }).fill("Local individual stock policy fixture");
    await page.getByLabel("URL slug", { exact: true }).fill("local-individual-stock-policy-fixture");
    await page.getByLabel("Product type", { exact: true }).selectOption("REPEATABLE");
    await page.getByRole("button", { name: "Add variant", exact: true }).click();
    const group = variantGroup(page, 1);
    await fillVariant(group, { ...variants[0], sku: "LOCAL-INDIVIDUAL-LIMIT", priceEGP: "", initialStock: "2", stockReason: "Invalid duplicate physical-stone fixture units" });
    await group.getByRole("button", { name: "Add gemstone", exact: true }).click();
    await fillStone(stoneGroup(group, 1), { ...stones[0], kind: "INDIVIDUAL", quantity: "1", totalCaratWeight: "1.25" });
    const before = await persistedCounts();
    await operation(page, "Create draft", "products", 409);
    assert.deepEqual(await persistedCounts(), before);
    await group.getByLabel("Initial stock", { exact: true }).fill("1");
    await group.getByLabel("Initial stock reason", { exact: true }).fill("One local physical-stone fixture unit");
    await operation(page, "Create draft", "products"); await page.waitForURL(/\/admin\/products\/[0-9a-f-]{36}\/edit$/);
    const id = page.url().split("/").at(-2)!; const record = await editorJson(context, id);
    assert.equal(record.productType, "REPEATABLE"); assert.equal(record.variants[0].onHand, 1);
    const inventoryForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Apply stock adjustment for LOCAL-INDIVIDUAL-LIMIT", exact: true }) });
    await inventoryForm.getByLabel("Adjustment (+/− units)", { exact: true }).fill("1");
    await inventoryForm.getByLabel("Adjustment reason", { exact: true }).fill("Invalid duplicate individual-stone fixture unit");
    const afterCreation = await persistedCounts();
    await operation(page, "Apply stock adjustment for LOCAL-INDIVIDUAL-LIMIT", "products/" + id + "/inventory/" + record.variants[0].id, 409);
    assert.equal((await editorJson(context, id)).variants[0].onHand, 1); assert.deepEqual(await persistedCounts(), afterCreation);
  } finally { await context.close(); }
});


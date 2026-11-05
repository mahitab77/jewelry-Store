// Exercise retained direct-sales behavior; quotation-only denial has its own suites.
process.env.COMMERCE_MODE = "DIRECT_SALES";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import sharp from "sharp";
import { catalogueFixture, editable, product, variant } from "./helpers/catalogue-fixture.mts";
import { cloudinaryMock, mockCloudinaryConfiguration } from "./helpers/cloudinary-mock.mts";
import { cloudinaryProvider } from "../src/lib/media/cloudinary.ts";
import { saveProduct, adjustInventory } from "../src/lib/admin/catalogue/products.ts";
import { readEditor, productAuditHistory } from "../src/lib/admin/catalogue/read.ts";
import { saveTaxonomy, readTaxonomy } from "../src/lib/admin/catalogue/taxonomy.ts";
import { arrangePhotos, uploadPhoto } from "../src/lib/admin/catalogue/media.ts";
import { slugFromName } from "../src/lib/admin/catalogue/automatic-values.ts";
import { CatalogueAdminError, parseSubmission } from "../src/lib/admin/catalogue/validation.ts";
import { getPublishedProductBySlug } from "../src/lib/catalogue/repository.ts";
import { AdminAccessError } from "../src/lib/admin/authorization.ts";
import type { ProductInput, StoneInput } from "../src/lib/admin/catalogue/types.ts";

let f: Awaited<ReturnType<typeof catalogueFixture>>, headers: Headers;
const previousUrl = process.env.DATABASE_URL;
before(async () => { f = await catalogueFixture(undefined, false); headers = await f.headers("CATALOGUE_MANAGER"); process.env.DATABASE_URL = f.ownerUrl; }, { timeout: 60000 });
beforeEach(async () => { await f.data.query("DELETE FROM admin_auth_rate_limits"); });
after(async () => { if (f) await f.close(); if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl; });
async function editor(id: string) { const p = await readEditor(headers, id, f.runtime); assert.ok(p); return p; }
async function create(name: string, extra: Partial<ProductInput> = {}) {
  return saveProduct(headers, null, { product: product(name, { slug: "", entryMode: "basic", ...extra }), action: "save" }, f.runtime);
}
async function save(id: string, change: (input: ProductInput) => void = () => {}, action = "save") {
  const current = await editor(id), input = editable(current); change(input);
  return saveProduct(headers, id, { product: input, action, revision: current.revision }, f.runtime);
}
const fieldError = (path: string) => (error: unknown) => error instanceof CatalogueAdminError && error.status === 400 && error.fieldPath === path;

test("basic incomplete draft receives only technical defaults and one stock-owning variant", async () => {
  const id = await create("Local minimal draft", { description: "" });
  const current = await editor(id), v = current.variants[0];
  assert.equal(current.status, "DRAFT"); assert.equal(current.slug, "local-minimal-draft"); assert.equal(current.description, "");
  assert.deepEqual(current.categoryIds, []); assert.deepEqual(current.collectionIds, []); assert.equal(current.variants.length, 1);
  assert.match(v.sku, /^LPD-[A-F0-9]{24}$/); assert.equal(v.active, true); assert.equal(v.displayOrder, 0);
  assert.equal(v.priceEGP, ""); assert.equal(v.onHand, 0); assert.equal(v.reserved, 0); assert.deepEqual(v.gemstones, []);
  assert.equal((await f.data.query("SELECT id FROM product_prices WHERE variant_id=$1", [v.id])).rowCount, 0);
  assert.equal((await productAuditHistory(headers, id, f.runtime)).filter((event) => event.action === "CATALOGUE_PRODUCT_CREATED").length, 1);
});

test("automatic slug normalization handles punctuation, diacritics, non-Latin names and length", () => {
  assert.equal(slugFromName("  Éclat & Gold's / Ring!  ", "jewelry"), "eclat-gold-s-ring");
  assert.equal(slugFromName("خاتم", "jewelry"), "jewelry");
  assert.match(slugFromName("É ".repeat(200), "jewelry"), /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(slugFromName("É ".repeat(200), "jewelry").length <= 150);
});

test("concurrent automatic product slugs and SKUs are unique without retrying writes", async () => {
  const ids = await Promise.all([1, 2, 3].map(() => create("Local collision ring")));
  const products = await Promise.all(ids.map(editor));
  assert.deepEqual(products.map((p) => p.slug).sort(), ["local-collision-ring", "local-collision-ring-2", "local-collision-ring-3"]);
  assert.equal(new Set(products.map((p) => p.variants[0].sku)).size, 3);
  for (const p of products) assert.ok(!p.variants[0].sku.toLowerCase().includes(p.id.replaceAll("-", "")));
});

test("manual overrides retain validation and database uniqueness; failed collision leaves no partial draft", async () => {
  const id = await create("Local manual reference", { slug: "local-approved-url", variants: [variant("LOCAL-APPROVED-SKU")] });
  assert.equal((await editor(id)).variants[0].sku, "LOCAL-APPROVED-SKU");
  const count = (await f.data.query("SELECT count(*)::INT AS n FROM products")).rows[0].n;
  await assert.rejects(create("Local duplicate manual URL", { slug: "local-approved-url" }), { status: 409 });
  await assert.rejects(create("Local duplicate manual SKU", { variants: [variant("LOCAL-APPROVED-SKU")] }), { status: 409 });
  assert.equal((await f.data.query("SELECT count(*)::INT AS n FROM products")).rows[0].n, count);
  assert.throws(() => parseSubmission({ product: product("Local invalid URL", { slug: "Bad URL" }), action: "save" }), fieldError("product.slug"));
  assert.throws(() => parseSubmission({ product: product("Local invalid SKU", { variants: [variant("invalid sku")] }), action: "save" }), fieldError("product.variants.0.sku"));
});

test("renaming keeps automatically allocated URLs and SKUs and honors eligible advanced overrides", async () => {
  const id = await create("Local stable references"), original = await editor(id);
  await save(id, (p) => { p.name = "A different display name"; p.slug = ""; p.variants[0].sku = ""; });
  const renamed = await editor(id);
  assert.equal(renamed.slug, original.slug); assert.equal(renamed.variants[0].sku, original.variants[0].sku);
  await save(id, (p) => { p.slug = "local-deliberate-url"; p.variants[0].sku = "LOCAL-DELIBERATE-SKU"; });
  assert.equal((await editor(id)).slug, "local-deliberate-url"); assert.equal((await editor(id)).variants[0].sku, "LOCAL-DELIBERATE-SKU");
});

test("name-only taxonomy defaults produce a visible category and an unpublished collection", async () => {
  const category = await saveTaxonomy(headers, { kind: "category", name: "Local Name-only Category" }, f.runtime);
  const collection = await saveTaxonomy(headers, { kind: "collection", name: "Local Name-only Collection" }, f.runtime);
  const state = await readTaxonomy(headers, f.runtime), c = state.categories.find((entry) => entry.id === category)!, group = state.collections.find((entry) => entry.id === collection)!;
  assert.deepEqual({ slug: c.slug, visible: c.visible, description: c.description, parent: c.parentId, order: c.displayOrder }, { slug: "local-name-only-category", visible: true, description: "", parent: null, order: 0 });
  assert.equal(group.slug, "local-name-only-collection"); assert.equal(group.status, "DRAFT"); assert.equal(group.publishedAt, null); assert.equal(group.publiclyVisible, false);
});

test("taxonomy automatic collisions are serialized and existing name edits preserve URLs and advanced fields", async () => {
  for (const kind of ["category", "collection"] as const) {
    const ids = await Promise.all([1, 2].map(() => saveTaxonomy(headers, { kind, name: "Local Taxonomy Collision" }, f.runtime)));
    const state = await readTaxonomy(headers, f.runtime);
    const records = (kind === "category" ? state.categories : state.collections).filter((entry) => ids.includes(entry.id));
    assert.deepEqual(records.map((entry) => entry.slug).sort(), ["local-taxonomy-collision", "local-taxonomy-collision-2"]);
    const old = records[0];
    const input = { kind, id: old.id, revision: old.revision, name: "Local updated name", slug: "", description: "Local advanced description", displayOrder: 8,
      ...(kind === "category" ? { visible: false, parentId: null } : { status: "DRAFT" }) };
    await saveTaxonomy(headers, input, f.runtime);
    const next = await readTaxonomy(headers, f.runtime), actual = (kind === "category" ? next.categories : next.collections).find((entry) => entry.id === old.id)!;
    assert.equal(actual.slug, old.slug); assert.equal(actual.name, input.name); assert.equal(actual.description, input.description); assert.equal(actual.displayOrder, 8);
    await assert.rejects(saveTaxonomy(headers, { ...input, name: "Stale taxonomy update" }, f.runtime), { status: 409 });
  }
});

test("blank and meaningless descriptions cannot publish and every rejected write rolls back", async () => {
  const id = await create("Local editorial description", { description: "" });
  for (const description of ["", "Short text", "12345678901234567890", "...................."]) {
    const before = await editor(id), input = editable(before); input.description = description; input.name = "This must roll back";
    await assert.rejects(saveProduct(headers, id, { product: input, action: "publish", revision: before.revision }, f.runtime), fieldError("product.description"));
    assert.deepEqual(await editor(id), before);
  }
});

test("complex multi-variant edits retain every advanced specification and cannot collapse stored variants", async () => {
  const stone: StoneInput = { kind: "GROUP", type: "Local test stone", variety: "Local variety", shape: "Round", color: "Blue", caratWeight: "1.1250", origin: "", treatment: "Not established", laboratory: "", reportReference: "", role: "ACCENT", quantity: 2, totalCaratWeight: "2.2500", displayOrder: 4 };
  const id = await create("Local complex jewelry", { entryMode: undefined, salesMode: "BOTH", variants: [
    variant("LOCAL-COMPLEX-ONE", { size: "6", configuration: "Local first configuration", metalType: "Gold", metalPurity: "18k", metalColor: "Yellow", displayOrder: 3, priceEGP: "90071992547409.93", initialStock: 3, stockReason: "Disposable local stock", gemstones: [stone] }),
    variant("LOCAL-COMPLEX-TWO", { size: "7", configuration: "Local second configuration", active: false, displayOrder: 7, priceEGP: "12.01", initialStock: 2, stockReason: "Disposable local stock" }),
  ] });
  const before = await editor(id);
  await save(id, (p) => { p.name = "Local basic name edit"; p.description = "Updated editorial description without changing advanced values."; });
  const after = await editor(id); assert.deepEqual(after.variants, before.variants);
  const collapsed = editable(after); collapsed.entryMode = "basic"; collapsed.variants = [];
  await assert.rejects(saveProduct(headers, id, { product: collapsed, action: "save", revision: after.revision }, f.runtime));
  assert.deepEqual((await editor(id)).variants, before.variants);
});

test("available-piece updates reject stale revisions and counter snapshots, preserve reservations and audit exactly once", async () => {
  const id = await create("Local guarded available pieces", { variants: [variant("", { initialStock: 5, stockReason: "Five local fixture units" })] });
  const before = await editor(id), v = before.variants[0];
  await f.data.query("UPDATE inventory SET reserved=1 WHERE variant_id=$1", [v.id]);
  await assert.rejects(adjustInventory(headers, id, v.id, { delta: -1, reason: "Stale available target", revision: before.revision, expectedOnHand: v.onHand, expectedReserved: v.reserved }, f.runtime), { status: 409 });
  assert.equal((await editor(id)).variants[0].onHand, 5);
  const reserved = await editor(id), stock = reserved.variants[0];
  await adjustInventory(headers, id, stock.id, { delta: -1, reason: "One local unit removed", revision: reserved.revision, expectedOnHand: stock.onHand, expectedReserved: stock.reserved }, f.runtime);
  const after = await editor(id); assert.equal(after.variants[0].onHand, 4); assert.equal(after.variants[0].reserved, 1); assert.equal(after.variants[0].available, 3);
  await assert.rejects(adjustInventory(headers, id, stock.id, { delta: -1, reason: "Old revision retry", revision: reserved.revision, expectedOnHand: 4, expectedReserved: 1 }, f.runtime), { status: 409 });
  const events = (await productAuditHistory(headers, id, f.runtime)).filter((event) => event.action === "CATALOGUE_INVENTORY_ADJUSTED");
  assert.equal(events.length, 1); assert.equal(events[0].metadata.reserved, 1);
  await adjustInventory(headers, id, stock.id, { delta: -1, reason: "Existing legacy adjustment contract" }, f.runtime);
  assert.equal((await editor(id)).variants[0].reserved, 1);
});

test("an on-hand-only concurrent change also rejects the loaded available-piece target", async () => {
  const id = await create("Local counter race", { variants: [variant("", { initialStock: 3, stockReason: "Disposable stock fixture" })] });
  const before = await editor(id), v = before.variants[0];
  await f.data.query("UPDATE inventory SET on_hand=4 WHERE variant_id=$1", [v.id]);
  await assert.rejects(adjustInventory(headers, id, v.id, { delta: 1, reason: "Outdated counter target", revision: before.revision, expectedOnHand: v.onHand, expectedReserved: v.reserved }, f.runtime), { status: 409 });
  assert.equal((await editor(id)).variants[0].onHand, 4);
});

test("missing-inventory snapshots initialize stock once and reject stale null without extra writes or audits", async () => {
  const id = await create("Local missing inventory"), initial = await editor(id), variantId = initial.variants[0].id;
  await f.data.query("DELETE FROM inventory WHERE variant_id=$1", [variantId]);
  const missing = await editor(id); assert.equal(missing.variants[0].onHand, null);
  const input = { revision: missing.revision, expectedOnHand: null, expectedReserved: 0, reason: "Initialize legacy local stock" };
  await assert.rejects(adjustInventory(headers, id, variantId, { ...input, delta: -1 }, f.runtime), { status: 409 });
  assert.equal((await editor(id)).variants[0].onHand, null, "A rejected adjustment must roll back its temporary inventory initialization.");
  await adjustInventory(headers, id, variantId, { ...input, delta: 2 }, f.runtime);
  const initialized = await editor(id); assert.equal(initialized.variants[0].onHand, 2); assert.equal(initialized.variants[0].reserved, 0);
  await assert.rejects(adjustInventory(headers, id, variantId, { ...input, revision: initialized.revision, delta: 1 }, f.runtime), { status: 409 });
  assert.deepEqual(await editor(id), initialized);
  const audits = (await productAuditHistory(headers, id, f.runtime)).filter((event) => event.action === "CATALOGUE_INVENTORY_ADJUSTED");
  assert.equal(audits.length, 1); assert.equal(audits[0].metadata.before, 0); assert.equal(audits[0].metadata.after, 2);

  const concurrentId = await create("Local concurrently initialized inventory"), original = await editor(concurrentId), concurrentVariant = original.variants[0].id;
  await f.data.query("DELETE FROM inventory WHERE variant_id=$1", [concurrentVariant]);
  const absent = await editor(concurrentId); assert.equal(absent.variants[0].onHand, null);
  // A separate writer creates stock without advancing the product revision.
  await f.data.query("INSERT INTO inventory(variant_id,product_type,on_hand) VALUES($1,'REPEATABLE',3)", [concurrentVariant]);
  const concurrent = await editor(concurrentId); assert.equal(concurrent.revision, absent.revision);
  await assert.rejects(adjustInventory(headers, concurrentId, concurrentVariant, { revision: absent.revision, expectedOnHand: null, expectedReserved: 0, delta: 1, reason: "Stale missing-row snapshot" }, f.runtime), { status: 409 });
  assert.deepEqual(await editor(concurrentId), concurrent);
  assert.equal((await productAuditHistory(headers, concurrentId, f.runtime)).filter((event) => event.action === "CATALOGUE_INVENTORY_ADJUSTED").length, 0);
});

test("single-piece and individual-stone defaults keep the one-unit inventory limit", async () => {
  await assert.rejects(create("Local unique overstock", { productType: "ONE_OF_A_KIND", variants: [variant("", { initialStock: 2, stockReason: "Invalid fixture stock" })] }), fieldError("product.variants.0.initialStock"));
  const stone: StoneInput = { kind: "INDIVIDUAL", type: "Local test stone", variety: "", shape: "Round", color: "Blue", caratWeight: "", origin: "", treatment: "", laboratory: "", reportReference: "", role: "CENTER", quantity: 1, totalCaratWeight: "", displayOrder: 0 };
  await assert.rejects(create("Local individual overstock", { variants: [variant("", { initialStock: 2, stockReason: "Invalid fixture stock", gemstones: [stone] })] }), { status: 409 });
  const id = await create("Local unique piece", { productType: "ONE_OF_A_KIND", variants: [variant("", { initialStock: 1, stockReason: "One fixture piece" })] });
  await assert.rejects(adjustInventory(headers, id, (await editor(id)).variants[0].id, { delta: 1, reason: "Invalid second piece" }, f.runtime), { status: 409 });
});

test("name-only category to draft, reload, edit, mock photographs, publish and unpublish is complete", async () => {
  const category = await saveTaxonomy(headers, { kind: "category", name: "Local journey category" }, f.runtime);
  const id = await create("Local full jewelry journey", { description: "", salesMode: "DIRECT_PURCHASE", categoryIds: [category], variants: [variant("", { priceEGP: "123.45", initialStock: 2, stockReason: "Two disposable fixture pieces" })] });
  const description = "A clearly labelled local demonstration item for editorial and photograph verification.";
  await save(id, (p) => { p.description = description; });
  assert.equal((await editor(id)).description, description);
  const mock = cloudinaryMock(), provider = cloudinaryProvider(mockCloudinaryConfiguration, mock.fakeFetch);
  const bytes = new Uint8Array(await sharp({ create: { width: 300, height: 300, channels: 3, background: "#526941" } }).png().toBuffer());
  const first = await uploadPhoto(headers, id, bytes, "image/png", "Local fixture photograph front", f.runtime, provider);
  const second = await uploadPhoto(headers, id, bytes, "image/png", "Local fixture photograph side", f.runtime, provider);
  const photographed = await editor(id);
  await arrangePhotos(headers, id, { revision: photographed.revision, images: [
    { id: second, altText: "Local fixture photograph side", primary: true },
    { id: first, altText: "Local fixture photograph front", primary: false },
  ] }, f.runtime);
  const arranged = await editor(id); assert.deepEqual(arranged.media.map((image) => image.id), [second, first]); assert.equal(arranged.media[0].primary, true);
  await save(id, () => {}, "publish");
  const published = await editor(id), publicProduct = await getPublishedProductBySlug(published.slug);
  assert.ok(publicProduct); assert.equal(publicProduct.description, description); assert.equal(publicProduct.canPurchase, true);
  assert.equal(publicProduct.variants[0].price!.amountMinor, "12345");
  assert.equal(published.variants[0].reserved, 0);
  await assert.rejects(save(id, (p) => { p.slug = "local-forbidden-published-change"; }), { status: 409 });
  await save(id, () => {}, "unpublish"); assert.equal(await getPublishedProductBySlug(published.slug), null);
  const unpublished = await editor(id); assert.equal(unpublished.slugLocked, true); assert.equal(unpublished.variants.length, 1); assert.equal(unpublished.media.length, 2);
});

test("automatic defaults stay behind catalogue authorization and do not add role or schema privileges", async () => {
  await assert.rejects(saveProduct(new Headers(), null, { product: product("Local unauthorized defaults", { slug: "", entryMode: "basic" }), action: "save" }, f.runtime), AdminAccessError);
  await assert.rejects(saveTaxonomy(new Headers(), { kind: "category", name: "Local unauthorized category" }, f.runtime), AdminAccessError);
  const privileges = (await f.runtime.pool.query("SELECT rolsuper,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user")).rows[0];
  assert.deepEqual(privileges, { rolsuper: false, rolcreaterole: false, rolcreatedb: false });
});

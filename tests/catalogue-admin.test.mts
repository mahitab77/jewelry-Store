import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { catalogueFixture, editable, product, variant } from "./helpers/catalogue-fixture.mts";
import { cloudinaryMock, mockCloudinaryConfiguration } from "./helpers/cloudinary-mock.mts";
import { cloudinaryProvider, preparePhoto, MAX_PHOTO_BYTES } from "../src/lib/media/cloudinary.ts";
import { adminPhotograph, publicPhotograph } from "../src/lib/media/delivery.ts";
import { saveProduct, adjustInventory } from "../src/lib/admin/catalogue/products.ts";
import { readEditor, listAdminProducts, productAuditHistory } from "../src/lib/admin/catalogue/read.ts";
import { arrangePhotos, removePhoto, retryPhotoCleanup, uploadPhoto } from "../src/lib/admin/catalogue/media.ts";
import { catalogueHttp } from "../src/lib/admin/catalogue/http.ts";
import { CatalogueAdminError, egpToMinor } from "../src/lib/admin/catalogue/validation.ts";
import { AdminAccessError } from "../src/lib/admin/authorization.ts";
import { getPublishedProductBySlug } from "../src/lib/catalogue/repository.ts";
import { developmentId } from "../db/tools/seed.ts";
import type { ProductInput } from "../src/lib/admin/catalogue/types.ts";

let f: Awaited<ReturnType<typeof catalogueFixture>>, owner: Headers;
let bytes: Uint8Array;
const previousUrl = process.env.DATABASE_URL;
before(async () => {
  f = await catalogueFixture(); owner = await f.headers();
  process.env.DATABASE_URL = f.ownerUrl;
  bytes = new Uint8Array(await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 40, g: 100, b: 80 } } }).png().toBuffer());
}, { timeout: 60000 });
beforeEach(async () => { await f.data.query("DELETE FROM admin_auth_rate_limits"); });
after(async () => { if (f) await f.close(); if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl; });
async function create(name: string, extra: Partial<ProductInput> = {}) { return saveProduct(owner, null, { product: product(name, extra), action: "save" }, f.runtime); }
async function editor(id: string) { const result = await readEditor(owner, id, f.runtime); assert.ok(result); return result; }
async function save(id: string, change: (p: ProductInput) => void = () => {}, action = "save") { const record = await editor(id), input = editable(record); change(input); return saveProduct(owner, id, { product: input, action, revision: record.revision }, f.runtime); }
const mock = () => { const m = cloudinaryMock(); return { ...m, provider: cloudinaryProvider(mockCloudinaryConfiguration, m.fakeFetch) }; };

test("all mutation entry points reject unauthenticated requests without data changes", async () => {
  const id = await create("Unauthorised fixture", { variants: [variant("DENIED-1")] });
  const record = await editor(id), empty = new Headers();
  await assert.rejects(saveProduct(empty, null, { product: product("Denied"), action: "save" }, f.runtime), AdminAccessError);
  await assert.rejects(saveProduct(empty, id, { product: editable(record), action: "save", revision: record.revision }, f.runtime), AdminAccessError);
  await assert.rejects(adjustInventory(empty, id, record.variants[0].id, { delta: 1, reason: "denied" }, f.runtime), AdminAccessError);
  await assert.rejects(uploadPhoto(empty, id, bytes, "image/png", "Denied photograph", f.runtime, mock().provider), AdminAccessError);
  await assert.rejects(arrangePhotos(empty, id, { images: [], revision: record.revision }, f.runtime), AdminAccessError);
  await assert.rejects(removePhoto(empty, id, randomUUID(), f.runtime), AdminAccessError);
  await assert.rejects(retryPhotoCleanup(empty, id, f.runtime, mock().provider), AdminAccessError);
  assert.equal((await editor(id)).name, record.name);
});

test("all three permitted roles manage catalogue; disabled sessions and claimed roles are rejected", async () => {
  for (const role of ["OWNER", "ADMIN", "CATALOGUE_MANAGER"] as const) {
    const headers = await f.headers(role);
    await saveProduct(headers, null, { product: product(`Role ${role.toLowerCase().replaceAll("_", "-")}`), action: "save" }, f.runtime);
  }
  const headers = await f.headers("ADMIN");
  await f.data.query("UPDATE admin_users SET is_active=false WHERE id=$1", [f.users.ADMIN.id]);
  try { await assert.rejects(saveProduct(headers, null, { product: product("Disabled fixture"), action: "save" }, f.runtime), AdminAccessError); }
  finally { await f.data.query("UPDATE admin_users SET is_active=true WHERE id=$1", [f.users.ADMIN.id]); }
  await assert.rejects(saveProduct(owner, null, { product: { ...product("Claimed fixture"), role: "OWNER" }, action: "save" }, f.runtime), CatalogueAdminError);
});

test("creation defaults to draft and assignments use existing category and collection records", async () => {
  const id = await create("Draft fixture", { categoryIds: [developmentId(1)], collectionIds: [developmentId(11)], variants: [variant("DRAFT-1")] });
  const result = await editor(id);
  assert.equal(result.status, "DRAFT"); assert.deepEqual(result.categoryIds, [developmentId(1)]); assert.deepEqual(result.collectionIds, [developmentId(11)]);
  assert.equal(await getPublishedProductBySlug(result.slug), null);
  assert.equal((await listAdminProducts(owner, { q: "DRAFT-1" }, f.runtime)).items[0].id, id);
});

test("bad values, duplicate SKUs and nonexistent assignments roll back every write", async () => {
  for (const input of [product("Bad slug", { slug: "BAD SLUG" }), product("Bad bespoke", { productType: "BESPOKE", salesMode: "DIRECT_PURCHASE" }), product("Bad unique", { productType: "ONE_OF_A_KIND", variants: [variant("U-1"), variant("U-2")] }), product("Bad assignment", { categoryIds: [randomUUID()] })]) {
    await assert.rejects(saveProduct(owner, null, { product: input, action: "save" }, f.runtime), CatalogueAdminError);
    assert.equal((await f.data.query("SELECT id FROM products WHERE name=$1", [input.name])).rowCount, 0);
  }
  await create("SKU original", { variants: [variant("UNIQUE-SKU")] });
  await assert.rejects(create("SKU collision", { variants: [variant("UNIQUE-SKU")] }), { status: 409 });
  assert.equal((await f.data.query("SELECT id FROM products WHERE slug='sku-collision'")).rowCount, 0);
});

test("variant updates preserve IDs and historical prices; removal is rejected in favour of deactivation", async () => {
  const id = await create("Variant fixture", { salesMode: "BOTH", variants: [variant("VARIANT-1", { priceEGP: "123.45", initialStock: 1, stockReason: "Fixture stock" })] });
  const old = await editor(id);
  await save(id, (p) => { p.variants[0].size = "54"; p.variants[0].priceEGP = "200.10"; p.variants[0].active = false; });
  const next = await editor(id); assert.equal(next.variants[0].id, old.variants[0].id); assert.equal(next.variants[0].priceEGP, "200.10");
  const prices = (await f.data.query("SELECT amount_minor::TEXT,is_active FROM product_prices WHERE variant_id=$1 ORDER BY created_at", [old.variants[0].id])).rows;
  assert.deepEqual(prices.map((r) => [r.amount_minor, r.is_active]), [["12345", false], ["20010", true]]);
  await assert.rejects(save(id, (p) => { p.variants = []; }), CatalogueAdminError);
});

test("decimal EGP prices stay exact through BIGINT limits; excess precision is rejected", async () => {
  assert.equal(egpToMinor("90071992547409.93"), "9007199254740993");
  const id = await create("Exact price", { salesMode: "DIRECT_PURCHASE", variants: [variant("EXACT-1", { priceEGP: "90071992547409.93" })] });
  assert.equal((await editor(id)).variants[0].priceEGP, "90071992547409.93");
  for (const price of ["1.001", "1e2", "-1", "NaN", "9,000.00", "92233720368547758.08"]) assert.throws(() => egpToMinor(price), CatalogueAdminError);
});

test("enquiry-only and bespoke records cannot invent prices or stock", async () => {
  await assert.rejects(create("Enquiry price", { variants: [variant("ENQ-PRICE", { priceEGP: "100.00" })] }), CatalogueAdminError);
  await assert.rejects(create("Bespoke stock", { productType: "BESPOKE", variants: [variant("BESPOKE-STOCK", { initialStock: 1, stockReason: "Invalid fixture" })] }), CatalogueAdminError);
  const id = await create("Bespoke valid", { productType: "BESPOKE", variants: [variant("BESPOKE-VALID")] });
  await assert.rejects(adjustInventory(owner, id, (await editor(id)).variants[0].id, { delta: 1, reason: "Invalid fixture" }, f.runtime), CatalogueAdminError);
});

test("shared gemstones use copy-on-write; exact weights and verification on the old record survive", async () => {
  const stone = { kind: "GROUP" as const, type: "Sapphire", variety: "", shape: "Round", color: "Blue", caratWeight: "1.2345", origin: "", treatment: "Not established", laboratory: "", reportReference: "", role: "ACCENT" as const, quantity: 2, totalCaratWeight: "2.4690", displayOrder: 0 };
  const a = await create("Stone first", { variants: [variant("STONE-A", { gemstones: [stone] })] });
  const b = await create("Stone second", { variants: [variant("STONE-B")] });
  const first = await editor(a), second = await editor(b);
  const original = (await f.data.query("SELECT gemstone_id FROM product_gemstones WHERE variant_id=$1", [first.variants[0].id])).rows[0].gemstone_id;
  await f.data.query("INSERT INTO product_gemstones(variant_id,gemstone_id,specification_kind,quantity,gemstone_role) VALUES($1,$2,'GROUP',2,'ACCENT')", [second.variants[0].id, original]);
  await save(a, (p) => { p.variants[0].gemstones[0].color = "Light blue"; });
  const rows = (await f.data.query("SELECT pg.variant_id,g.id,g.color,g.carat_weight::TEXT,g.report_verification_status FROM product_gemstones pg JOIN gemstones g ON g.id=pg.gemstone_id WHERE pg.variant_id=ANY($1::UUID[])", [[first.variants[0].id, second.variants[0].id]])).rows;
  assert.equal(rows.find((r) => r.variant_id === second.variants[0].id).id, original);
  assert.equal(rows.find((r) => r.variant_id === second.variants[0].id).color, "Blue");
  assert.equal(rows.find((r) => r.variant_id === first.variants[0].id).carat_weight, "1.2345");
  assert.ok(rows.every((r) => r.report_verification_status === "UNVERIFIED"));
});

test("stale saves and foreign variant identifiers cannot overwrite other edits or products", async () => {
  const id = await create("Stale fixture", { variants: [variant("STALE-1")] }), old = await editor(id);
  await save(id, (p) => { p.name = "Fresh name"; });
  await assert.rejects(saveProduct(owner, id, { product: editable(old), action: "save", revision: old.revision }, f.runtime), { status: 409 });
  const other = await create("Foreign fixture", { variants: [variant("FOREIGN-1")] });
  await assert.rejects(save(other, (p) => { p.variants[0].id = old.variants[0].id; }), CatalogueAdminError);
  assert.equal((await editor(id)).name, "Fresh name");
});

test("publication validates imagery, category, active variants and direct selling prices atomically", async () => {
  const id = await create("Publish fixture", { salesMode: "DIRECT_PURCHASE", variants: [variant("PUB-1")] });
  await assert.rejects(save(id, () => {}, "publish"), CatalogueAdminError);
  await save(id, (p) => { p.categoryIds = [developmentId(1)]; p.variants[0].priceEGP = "450.01"; });
  await assert.rejects(save(id, () => {}, "publish"), CatalogueAdminError);
  const m = mock(), photo = await uploadPhoto(owner, id, bytes, "image/png", "Fixture ring front view", f.runtime, m.provider);
  assert.equal((await publicPhotograph(photo, m.provider)).status, 404);
  assert.equal((await adminPhotograph(owner, id, photo, f.runtime, m.provider)).status, 200);
  await save(id, () => {}, "publish");
  const current = await editor(id), published = await getPublishedProductBySlug(current.slug);
  assert.ok(published); assert.equal(published.variants[0].price?.amountMinor, "45001"); assert.equal(published.canPurchase, false);
  assert.equal((await publicPhotograph(photo, m.provider)).status, 200);
  await adjustInventory(owner, id, current.variants[0].id, { delta: 1, reason: "Fixture became available" }, f.runtime);
  assert.ok((await getPublishedProductBySlug(current.slug))?.canPurchase);
  await assert.rejects(save(id, (p) => { p.slug = "changed-live-url"; }), CatalogueAdminError);
  await save(id, () => {}, "unpublish"); assert.equal(await getPublishedProductBySlug(current.slug), null);
  assert.equal((await publicPhotograph(photo, m.provider)).status, 404);
  // A deliberate Publish is immediate even if a legacy record has a future timestamp.
  await f.data.query("UPDATE products SET published_at=now()+INTERVAL '1 day' WHERE id=$1", [id]);
  await save(id, () => {}, "publish"); assert.ok(await getPublishedProductBySlug(current.slug));
  await save(id, () => {}, "unpublish");
  await save(id, () => {}, "archive"); assert.equal((await editor(id)).status, "ARCHIVED");
  assert.equal((await f.data.query("SELECT id FROM product_variants WHERE product_id=$1", [id])).rowCount, 1);
});

test("reserved stock is never overwritten and concurrent reductions cannot oversell", async () => {
  const id = await create("Stock race", { salesMode: "BOTH", variants: [variant("RACE-1", { priceEGP: "10", initialStock: 2, stockReason: "Fixture units" })] });
  const v = (await editor(id)).variants[0];
  await f.data.query("UPDATE inventory SET reserved=1 WHERE variant_id=$1", [v.id]);
  const results = await Promise.allSettled([1, 2].map(() => adjustInventory(owner, id, v.id, { delta: -1, reason: "Concurrent fixture removal" }, f.runtime)));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const stock = (await editor(id)).variants[0]; assert.equal(stock.onHand, 1); assert.equal(stock.reserved, 1); assert.equal(stock.available, 0);
  await assert.rejects(adjustInventory(owner, id, v.id, { delta: 1, reason: "Attempted stale overwrite", reserved: 0 }, f.runtime), CatalogueAdminError);
  const events = await productAuditHistory(owner, id, f.runtime);
  const adjustment = events.find((event) => event.action === "CATALOGUE_INVENTORY_ADJUSTED");
  assert.equal(adjustment?.metadata.reserved, 1); assert.equal(adjustment?.metadata.before, 2); assert.equal(adjustment?.metadata.after, 1);
});

test("unique jewels retain their one-unit bound and type/variant history", async () => {
  const id = await create("Unique fixture", { productType: "ONE_OF_A_KIND", salesMode: "BOTH", variants: [variant("ONE-1", { priceEGP: "12.34", initialStock: 1, stockReason: "One physical fixture" })] });
  const v = (await editor(id)).variants[0];
  await assert.rejects(adjustInventory(owner, id, v.id, { delta: 1, reason: "Invalid extra unit" }, f.runtime), CatalogueAdminError);
  await adjustInventory(owner, id, v.id, { delta: -1, reason: "Fixture sold" }, f.runtime);
  assert.equal((await editor(id)).variants[0].available, 0);
  await assert.rejects(save(id, (p) => { p.productType = "REPEATABLE"; }), CatalogueAdminError);
});

test("MIME spoofing, oversized, animated, corrupt and undersized media are rejected", async () => {
  for (const [input, mime] of [[bytes, "image/svg+xml"], [bytes, "image/jpeg"], [new Uint8Array(MAX_PHOTO_BYTES + 1), "image/png"], [new Uint8Array([1, 2, 3]), "image/png"]] as const) await assert.rejects(preparePhoto(input, mime), CatalogueAdminError);
  const tiny = await sharp({ create: { width: 10, height: 10, channels: 3, background: "red" } }).png().toBuffer();
  await assert.rejects(preparePhoto(tiny, "image/png"), CatalogueAdminError);
  const frames = Buffer.alloc(300 * 600 * 3, 80); frames.fill(160, 300 * 300 * 3);
  const animated = await sharp(frames, { raw: { width: 300, height: 600, channels: 3, pageHeight: 300 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  assert.equal((await sharp(animated).metadata()).pages, 2);
  await assert.rejects(preparePhoto(animated, "image/webp"), CatalogueAdminError);
});

test("photographs are oriented and stripped of embedded EXIF before any provider upload", async () => {
  const input = await sharp({ create: { width: 320, height: 240, channels: 3, background: "gold" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  assert.ok((await sharp(input).metadata()).exif);
  const result = await preparePhoto(input, "image/jpeg"), metadata = await sharp(result.bytes).metadata();
  assert.deepEqual([result.width, result.height], [240, 320]);
  assert.equal(metadata.exif, undefined); assert.equal(metadata.orientation, undefined);
});

test("verified server uploads are private, controlled and ordered with one primary photograph", async () => {
  const id = await create("Photos fixture"), m = mock();
  const first = await uploadPhoto(owner, id, bytes, "image/png", "Fixture front photograph", f.runtime, m.provider);
  const second = await uploadPhoto(owner, id, bytes, "image/png", "Fixture side photograph", f.runtime, m.provider);
  const current = await editor(id); assert.equal(current.media.filter((p) => p.primary).length, 1);
  assert.ok([...m.assets.keys()].every((key) => key.startsWith(`la-palme/catalogue/${id}/`)));
  await arrangePhotos(owner, id, { revision: current.revision, images: [{ id: second, altText: "Fixture side first", primary: true }, { id: first, altText: "Fixture front second", primary: false }] }, f.runtime);
  const next = await editor(id); assert.equal(next.media[0].id, second); assert.ok(next.media[0].primary);
  await assert.rejects(arrangePhotos(owner, id, { revision: next.revision, images: [{ id: randomUUID(), altText: "Foreign image", primary: true }] }, f.runtime), CatalogueAdminError);
});

test("lost upload responses leave private retryable intents without corrupting products", async () => {
  const id = await create("Lost upload"), m = mock(); m.failures.afterUpload = true;
  await assert.rejects(uploadPhoto(owner, id, bytes, "image/png", "Fixture lost response", f.runtime, m.provider));
  assert.equal((await editor(id)).media.length, 0); assert.equal(m.assets.size, 1);
  assert.equal((await f.data.query("SELECT state FROM catalogue_media_jobs WHERE product_id=$1", [id])).rows[0].state, "DELETE_PENDING");
  await f.data.query("UPDATE catalogue_media_jobs SET available_at=now()-INTERVAL '1 second' WHERE product_id=$1", [id]);
  m.failures.afterUpload = false;
  const result = await retryPhotoCleanup(owner, id, f.runtime, m.provider); assert.equal(result.completed, 1); assert.equal(m.assets.size, 0);
});

test("forged provider responses and browser confirmations never associate a photograph", async () => {
  const id = await create("Forged upload"), m = mock(); m.failures.forged = true;
  await assert.rejects(uploadPhoto(owner, id, bytes, "image/png", "Fixture forged response", f.runtime, m.provider), CatalogueAdminError);
  assert.equal((await editor(id)).media.length, 0);
  const request = new Request(f.authConfig.baseURL + "/api/admin/catalogue/products", { method: "POST", headers: { Cookie: owner.get("Cookie")!, Origin: f.authConfig.baseURL, "Content-Type": "application/json" }, body: JSON.stringify({ public_id: "forged", secure_url: "https://hostile.example/asset.png" }) });
  assert.equal((await catalogueHttp(request, ["products", id, "photos"], f.runtime, m.provider)).status, 415);
});

test("removal preserves replacement and shared assets; provider deletion failure can retry", async () => {
  const a = await create("Shared photo first"), b = await create("Shared photo second"), m = mock();
  const first = await uploadPhoto(owner, a, bytes, "image/png", "Fixture shared photograph", f.runtime, m.provider);
  const replacement = await uploadPhoto(owner, a, bytes, "image/png", "Fixture replacement photograph", f.runtime, m.provider);
  const copyId = randomUUID();
  await f.data.query(`INSERT INTO product_media(id,product_id,external_media_reference,media_type,alt_text,is_primary,cloudinary_asset_id,cloudinary_public_id,cloudinary_version,image_format,width,height,byte_size)
    SELECT $1::UUID,$2,'/catalogue-images/' || $1::TEXT,media_type,alt_text,true,cloudinary_asset_id,cloudinary_public_id,cloudinary_version,image_format,width,height,byte_size FROM product_media WHERE id=$3`, [copyId, b, first]);
  await removePhoto(owner, a, first, f.runtime);
  assert.equal((await editor(a)).media[0].id, replacement); assert.ok((await editor(a)).media[0].primary);
  await retryPhotoCleanup(owner, a, f.runtime, m.provider); assert.equal(m.calls.filter((call) => call.operation === "destroy").length, 0);
  await removePhoto(owner, b, copyId, f.runtime); m.failures.destroy = true;
  assert.equal((await retryPhotoCleanup(owner, b, f.runtime, m.provider)).pending, 1);
  await f.data.query("UPDATE catalogue_media_jobs SET available_at=now()-INTERVAL '1 second' WHERE product_id=$1", [b]);
  m.failures.destroy = false; assert.equal((await retryPhotoCleanup(owner, b, f.runtime, m.provider)).completed, 1);
  assert.equal(m.assets.size, 1);
});

test("audit failure rolls back catalogue writes and private uploads remain unassociated", async () => {
  const id = await create("Audit failure"), before = await editor(id), m = mock();
  await f.data.query(`REVOKE INSERT ON audit_events FROM "${f.role}"`);
  try {
    await assert.rejects(saveProduct(owner, id, { product: { ...editable(before), name: "Must roll back" }, revision: before.revision, action: "save" }, f.runtime), CatalogueAdminError);
    assert.equal((await editor(id)).name, before.name);
    await assert.rejects(uploadPhoto(owner, id, bytes, "image/png", "Fixture audit failure photograph", f.runtime, m.provider));
    assert.equal((await editor(id)).media.length, 0);
  } finally { await f.data.query(`GRANT INSERT ON audit_events TO "${f.role}"`); }
});

test("HTTP mutations reject cross-site requests and server-controlled identity fields", async () => {
  for (const origin of ["https://hostile.example", "null"]) {
    const response = await catalogueHttp(new Request(f.authConfig.baseURL + "/api/admin/catalogue/products", { method: "POST", headers: { Cookie: owner.get("Cookie")!, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ product: product("Cross site"), action: "save" }) }), ["products"], f.runtime);
    assert.equal(response.status, 403);
  }
  const events = await f.data.query("SELECT metadata FROM audit_events WHERE action LIKE 'CATALOGUE_%'");
  const output = JSON.stringify(events.rows); assert.ok(!output.includes(f.password) && !output.includes(f.authConfig.secret) && !output.includes(mockCloudinaryConfiguration.apiSecret));
  await assert.rejects(f.runtime.pool.query("DELETE FROM products"), { code: "42501" });
  await assert.rejects(f.runtime.pool.query("UPDATE audit_events SET action='tampered'"), { code: "42501" });
});

test("management pagination is stable and bounded; filters and literal wildcard search stay on the server", async () => {
  await f.data.query(`INSERT INTO products(name,slug,product_type,sales_mode)
    SELECT 'Paged marker ' || n, 'phase06-paged-' || n, 'REPEATABLE', 'ENQUIRY_ONLY' FROM generate_series(1,25) n`);
  const first = await listAdminProducts(owner, { q: "Paged marker" }, f.runtime), second = await listAdminProducts(owner, { q: "Paged marker", page: "2" }, f.runtime);
  assert.equal(first.items.length, 20); assert.equal(first.hasMore, true); assert.equal(second.items.length, 5); assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.items, ...second.items].map((p) => p.id)).size, 25);
  assert.deepEqual((await listAdminProducts(owner, { q: "Paged marker" }, f.runtime)).items.map((p) => p.id), first.items.map((p) => p.id));
  assert.equal((await listAdminProducts(owner, { q: "Paged marker", status: "PUBLISHED" }, f.runtime)).items.length, 0);
  assert.equal((await listAdminProducts(owner, { q: "Paged marker", type: "BESPOKE" }, f.runtime)).items.length, 0);
  const literal = await create("Literal 100%_name", { slug: "literal-percent" });
  assert.deepEqual((await listAdminProducts(owner, { q: "100%_" }, f.runtime)).items.map((p) => p.id), [literal]);
  assert.equal((await listAdminProducts(owner, { q: "%' OR 1=1 --" }, f.runtime)).items.length, 0);
  await assert.rejects(listAdminProducts(owner, { page: "501" }, f.runtime), CatalogueAdminError);
  await assert.rejects(listAdminProducts(owner, { status: "invented" }, f.runtime), CatalogueAdminError);
});

test("media commands reject array bodies and never serialize provider or authentication secrets", async () => {
  const id = await create("Transport privacy"), m = mock();
  for (const operation of ["cleanup", "remove-photo/" + randomUUID()]) {
    const response = await catalogueHttp(new Request(f.authConfig.baseURL + "/api/admin/catalogue/products/" + id + "/" + operation, {
      method: "POST", headers: { Cookie: owner.get("Cookie")!, Origin: f.authConfig.baseURL, "Content-Type": "application/json" }, body: "[]",
    }), ["products", id, ...operation.split("/")], f.runtime, m.provider);
    assert.equal(response.status, 400);
  }
  const response = await catalogueHttp(new Request(f.authConfig.baseURL + "/api/admin/catalogue/products/" + id, { headers: owner }), ["products", id], f.runtime, m.provider);
  assert.equal(response.status, 200); const payload = await response.text();
  for (const secret of [f.password, f.authConfig.secret, f.authConfig.databaseUrl, mockCloudinaryConfiguration.apiKey, mockCloudinaryConfiguration.apiSecret]) assert.ok(!payload.includes(secret));
});

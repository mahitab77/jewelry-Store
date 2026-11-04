import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { catalogueFixture, editable, product, variant } from "./helpers/catalogue-fixture.mts";
import { developmentId } from "../db/tools/seed.ts";
import { saveProduct, adjustInventory } from "../src/lib/admin/catalogue/products.ts";
import { readEditor } from "../src/lib/admin/catalogue/read.ts";
import type { StoneInput } from "../src/lib/admin/catalogue/types.ts";

let f: Awaited<ReturnType<typeof catalogueFixture>>, headers: Headers;
const individual = (): StoneInput => ({ kind: "INDIVIDUAL", type: "Local individual fixture", variety: "", shape: "Round", color: "Blue", caratWeight: "1.0000", origin: "", treatment: "Local test only", laboratory: "", reportReference: "", role: "CENTER", quantity: 1, totalCaratWeight: "1.0000", displayOrder: 0 });
const group = (): StoneInput => ({ ...individual(), kind: "GROUP", type: "Local group fixture", quantity: 3, totalCaratWeight: "3.0000" });
const conflict = { status: 409, message: "A variant with an individual gemstone can hold at most one unit." };
before(async () => { f = await catalogueFixture(); headers = await f.headers("CATALOGUE_MANAGER"); }, { timeout: 60000 });
beforeEach(async () => { await f.data.query("DELETE FROM admin_auth_rate_limits"); });
after(async () => { if (f) await f.close(); });
async function editor(id: string) { const value = await readEditor(headers, id, f.runtime); assert.ok(value); return value; }
async function create(name: string, sku: string, stock: number, stones: StoneInput[], active = true) {
  return saveProduct(headers, null, { product: product(name, { salesMode: "BOTH", categoryIds: [developmentId(1)], variants: [variant(sku, { priceEGP: "100.01", initialStock: stock, stockReason: "Disposable local stock fixture", gemstones: stones, active })] }), action: "save" }, f.runtime);
}
async function counts() {
  return (await f.data.query("SELECT (SELECT count(*) FROM products)::int AS products,(SELECT count(*) FROM product_variants)::int AS variants,(SELECT count(*) FROM inventory)::int AS inventory,(SELECT count(*) FROM product_prices)::int AS prices,(SELECT count(*) FROM gemstones)::int AS stones,(SELECT count(*) FROM product_gemstones)::int AS associations,(SELECT count(*) FROM audit_events)::int AS audits")).rows[0];
}
async function photo(id: string) {
  // Owner-only fixture setup supplies an existing approved local image so the
  // legacy publication test reaches stock validation without provider calls.
  await f.data.query("INSERT INTO product_media(product_id,external_media_reference,media_type,alt_text,is_primary) VALUES($1,'/images/ring-emerald.png','IMAGE','Local individual-stone fixture photograph',true)", [id]);
}

test("new active and inactive variants with an individual stone reject multiple stock atomically", async () => {
  for (const active of [true, false]) {
    const before = await counts();
    await assert.rejects(create(`Local invalid individual ${active ? "active" : "inactive"}`, `IND-INITIAL-${active ? "ACTIVE" : "INACTIVE"}`, 2, [individual()], active), conflict);
    assert.deepEqual(await counts(), before, "Product, inventory, gemstone and audit writes must all roll back.");
  }
});

test("attaching an individual stone to existing multiple stock rolls back all edits and audit writes", async () => {
  const id = await create("Local stocked group before individual", "IND-ATTACH-STOCKED", 2, [group()]);
  const before = await editor(id), input = editable(before), beforeCounts = await counts();
  input.name = "This name must roll back"; input.variants[0].priceEGP = "200.02";
  input.variants[0].gemstones = [individual()];
  await assert.rejects(saveProduct(headers, id, { product: input, revision: before.revision, action: "save" }, f.runtime), conflict);
  assert.deepEqual(await editor(id), before); assert.deepEqual(await counts(), beforeCounts);
});

test("an individual stone with one stock unit can save, reload and publish without changing product type", async () => {
  const id = await create("Local valid individual one", "IND-VALID-ONE", 1, [individual()]);
  const record = await editor(id); assert.equal(record.productType, "REPEATABLE"); assert.equal(record.variants[0].onHand, 1);
  assert.equal(record.variants[0].gemstones[0].kind, "INDIVIDUAL"); assert.equal(record.variants[0].gemstones[0].quantity, 1);
  await photo(id);
  const current = await editor(id);
  await saveProduct(headers, id, { product: editable(current), revision: current.revision, action: "publish" }, f.runtime);
  assert.equal((await editor(id)).status, "PUBLISHED");
  const before = await editor(id), beforeCounts = await counts();
  await assert.rejects(adjustInventory(headers, id, before.variants[0].id, { delta: 1, reason: "Invalid extra individual unit" }, f.runtime), conflict);
  assert.deepEqual(await editor(id), before); assert.deepEqual(await counts(), beforeCounts);
});

test("group specifications retain ordinary repeatable multi-unit inventory", async () => {
  const id = await create("Local repeatable group stock", "IND-GROUP-MULTIPLE", 4, [group()]);
  const record = await editor(id);
  await adjustInventory(headers, id, record.variants[0].id, { delta: 2, reason: "Two additional local group units" }, f.runtime);
  const current = await editor(id); assert.equal(current.variants[0].onHand, 6); assert.equal(current.variants[0].gemstones[0].kind, "GROUP"); assert.equal(current.variants[0].gemstones[0].quantity, 3);
});

test("publication rejects legacy multiple-stock individual data without silently repairing it", async () => {
  const id = await create("Local legacy individual stock", "IND-LEGACY-PUBLISH", 1, [individual()]);
  await photo(id); const initial = await editor(id);
  // Simulate an existing owner-written mismatch that the historical schema
  // permits; application operations must reject it rather than rewrite history.
  await f.data.query("UPDATE inventory SET on_hand=2 WHERE variant_id=$1", [initial.variants[0].id]);
  const before = await editor(id), beforeCounts = await counts();
  await assert.rejects(saveProduct(headers, id, { product: editable(before), revision: before.revision, action: "publish" }, f.runtime), conflict);
  assert.deepEqual(await editor(id), before); assert.deepEqual(await counts(), beforeCounts);
  assert.equal((await editor(id)).variants[0].onHand, 2); assert.equal((await editor(id)).status, "DRAFT");
});

test("concurrent increases and reserved units cannot bypass the individual-stock cap", async () => {
  const id = await create("Local individual concurrent stock", "IND-CONCURRENT-STOCK", 0, [individual()]);
  const record = await editor(id), variantId = record.variants[0].id;
  const attempts = await Promise.allSettled([1, 2].map(() => adjustInventory(headers, id, variantId, { delta: 1, reason: "Concurrent local individual unit" }, f.runtime)));
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
  assert.equal((await editor(id)).variants[0].onHand, 1);
  await f.data.query("UPDATE inventory SET reserved=1 WHERE variant_id=$1", [variantId]);
  const before = await editor(id), beforeCounts = await counts();
  await assert.rejects(adjustInventory(headers, id, variantId, { delta: -1, reason: "Cannot consume a held fixture" }, f.runtime), { status: 409 });
  await assert.rejects(adjustInventory(headers, id, variantId, { delta: 1, reason: "Cannot duplicate a held individual" }, f.runtime), conflict);
  assert.deepEqual(await editor(id), before); assert.deepEqual(await counts(), beforeCounts);
});

test("a concurrent specification change and stock increase preserve the individual invariant", async () => {
  const id = await create("Local individual assignment race", "IND-ASSIGNMENT-RACE", 1, [group()]);
  const before = await editor(id), input = editable(before), variantId = before.variants[0].id;
  input.variants[0].gemstones = [individual()];
  const attempts = await Promise.allSettled([
    saveProduct(headers, id, { product: input, revision: before.revision, action: "save" }, f.runtime),
    adjustInventory(headers, id, variantId, { delta: 1, reason: "Competing local group stock" }, f.runtime),
  ]);
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
  const current = await editor(id), variant = current.variants[0];
  assert.ok(!variant.gemstones.some(stone => stone.kind === "INDIVIDUAL") || variant.onHand! <= 1);
  assert.ok(variant.onHand === 1 || variant.onHand === 2);
});

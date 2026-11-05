// Exercise retained direct-sales behavior; quotation-only denial has its own suites.
process.env.COMMERCE_MODE = "DIRECT_SALES";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { developmentId } from "../db/tools/seed.ts";
import { arrangePhotos, removePhoto } from "../src/lib/admin/catalogue/media.ts";
import { saveProduct } from "../src/lib/admin/catalogue/products.ts";
import { readEditor } from "../src/lib/admin/catalogue/read.ts";
import { catalogueFixture, editable, product, variant } from "./helpers/catalogue-fixture.mts";

let fixture: Awaited<ReturnType<typeof catalogueFixture>>, headers: Headers;
before(async () => {
  fixture = await catalogueFixture();
  headers = await fixture.headers("CATALOGUE_MANAGER");
}, { timeout: 60000 });
after(async () => { if (fixture) await fixture.close(); });

async function published(name: string, secondary = "https://example.invalid/unsupported-legacy-photo.jpg") {
  const id = await saveProduct(headers, null, { action: "save", product: product(name, {
    categoryIds: [developmentId(1)], variants: [variant("MEDIA-" + randomUUID().slice(0, 8).toUpperCase())],
  }) }, fixture.runtime);
  const primaryId = randomUUID(), secondaryId = randomUUID();
  // A legacy external reference is permitted by the existing schema, but cannot
  // be delivered by the application's allowlisted public image path.
  await fixture.data.query("INSERT INTO product_media(id,product_id,external_media_reference,media_type,alt_text,display_order,is_primary) " +
    "VALUES($1,$2,'/images/blue-sapphire-earring.png','IMAGE','Fixture primary photograph',0,true)," +
    "($3,$2,$4,'IMAGE','Fixture secondary photograph',1,false)", [primaryId, id, secondaryId, secondary]);
  const draft = await readEditor(headers, id, fixture.runtime); assert.ok(draft);
  await saveProduct(headers, id, { action: "publish", product: editable(draft), revision: draft.revision }, fixture.runtime);
  return { id, primaryId, secondaryId };
}
async function editor(id: string) { const value = await readEditor(headers, id, fixture.runtime); assert.ok(value); return value; }
async function audits(id: string) { return (await fixture.data.query("SELECT count(*)::int AS count FROM audit_events WHERE target_table='products' AND target_id=$1", [id])).rows[0].count; }

test("published photo arrangement rejects unsupported legacy primary and rolls back every media change", async () => {
  const p = await published("Media primary eligibility"), before = await editor(p.id), auditCount = await audits(p.id);
  await assert.rejects(arrangePhotos(headers, p.id, { revision: before.revision, images: before.media.map((image) => ({
    id: image.id, altText: "Attempted changed description", primary: image.id === p.secondaryId,
  })).reverse() }, fixture.runtime), { status: 409 });
  assert.deepEqual(await editor(p.id), before);
  assert.equal(await audits(p.id), auditCount);
  assert.equal(before.status, "PUBLISHED");
});

test("published photo removal rejects unsupported replacement and preserves media, revision and audit history", async () => {
  const p = await published("Media replacement eligibility"), before = await editor(p.id), auditCount = await audits(p.id);
  await assert.rejects(removePhoto(headers, p.id, p.primaryId, fixture.runtime), { status: 409 });
  assert.deepEqual(await editor(p.id), before);
  assert.equal(await audits(p.id), auditCount);
  assert.equal(before.status, "PUBLISHED");
});

test("published photo arrangement and removal still work when the primary remains deliverable", async () => {
  const p = await published("Media valid replacement", "/images/blue-sapphire-set.png"), before = await editor(p.id);
  await arrangePhotos(headers, p.id, { revision: before.revision, images: before.media.map((image) => ({
    id: image.id, altText: image.altText, primary: image.id === p.secondaryId,
  })) }, fixture.runtime);
  const arranged = await editor(p.id);
  assert.equal(arranged.media.find((image) => image.primary)?.id, p.secondaryId);
  assert.equal(arranged.media[0].id, p.primaryId, "Choosing the primary must preserve independent photograph ordering.");
  await removePhoto(headers, p.id, p.secondaryId, fixture.runtime);
  const remaining = await editor(p.id);
  assert.equal(remaining.status, "PUBLISHED");
  assert.equal(remaining.media.length, 1);
  assert.equal(remaining.media[0].id, p.primaryId);
  assert.ok(remaining.media[0].primary);
});


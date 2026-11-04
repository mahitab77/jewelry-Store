import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { catalogueFixture, product } from "./helpers/catalogue-fixture.mts";
import { readTaxonomy, saveTaxonomy } from "../src/lib/admin/catalogue/taxonomy.ts";
import { taxonomyHttp } from "../src/lib/admin/catalogue/taxonomy-http.ts";
import { saveProduct } from "../src/lib/admin/catalogue/products.ts";
import { AdminAccessError } from "../src/lib/admin/authorization.ts";
import { getPublishedCategories, getPublishedCollections } from "../src/lib/catalogue/repository.ts";
import type { CategoryRecord, CollectionRecord, TaxonomyInput } from "../src/lib/admin/catalogue/taxonomy-types.ts";

let f: Awaited<ReturnType<typeof catalogueFixture>>, manager: Headers;
const previousUrl = process.env.DATABASE_URL;
before(async () => { f = await catalogueFixture(undefined, false); manager = await f.headers("CATALOGUE_MANAGER"); process.env.DATABASE_URL = f.ownerUrl; }, { timeout: 60000 });
beforeEach(async () => { await f.data.query("DELETE FROM admin_auth_rate_limits"); });
after(async () => { if (f) await f.close(); if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl; });
const category = (name: string, extra: Partial<TaxonomyInput> = {}) => ({ kind: "category" as const, name, slug: name.toLowerCase().replaceAll(" ", "-"), description: "Local category fixture.", displayOrder: 0, parentId: null, visible: false, ...extra });
const collection = (name: string, extra: Partial<TaxonomyInput> = {}) => ({ kind: "collection" as const, name, slug: name.toLowerCase().replaceAll(" ", "-"), description: "Local collection fixture.", displayOrder: 0, status: "DRAFT", ...extra });
async function savedCategory(id: string) { return (await readTaxonomy(manager, f.runtime)).categories.find((entry) => entry.id === id)!; }
async function savedCollection(id: string) { return (await readTaxonomy(manager, f.runtime)).collections.find((entry) => entry.id === id)!; }
const editCategory = (record: CategoryRecord) => ({ ...category(record.name), ...record, kind: "category" as const });
const editCollection = (record: CollectionRecord) => ({ kind: "collection" as const, id: record.id, revision: record.revision, name: record.name, slug: record.slug, description: record.description, displayOrder: record.displayOrder, status: record.status });
function request(input: unknown, headers = manager, method = "POST") {
  const supplied = new Headers(headers); supplied.set("Origin", f.authConfig.baseURL); supplied.set("Content-Type", "application/json");
  return new Request(f.authConfig.baseURL + "/api/admin/catalogue/taxonomy", { method, headers: supplied, body: method === "GET" ? undefined : JSON.stringify(input) });
}

test("empty catalogue has a manager-accessible category and collection creation path", async () => {
  assert.deepEqual(await readTaxonomy(manager, f.runtime), { categories: [], collections: [] });
  const response = await taxonomyHttp(request(category("First category", { visible: true, displayOrder: 7 })), f.runtime);
  assert.equal(response.status, 200); assert.match(response.headers.get("Cache-Control")!, /no-store/);
  const body = await response.json(); const record = body.categories.find((entry: CategoryRecord) => entry.id === body.id);
  assert.deepEqual({ name: record.name, slug: record.slug, description: record.description, parentId: record.parentId, displayOrder: record.displayOrder, visible: record.visible }, { name: "First category", slug: "first-category", description: "Local category fixture.", parentId: null, displayOrder: 7, visible: true });
  assert.equal((await getPublishedCategories()).some((entry) => entry.id === record.id), true);
  const group = await saveTaxonomy(manager, collection("First collection"), f.runtime);
  assert.equal((await savedCollection(group)).status, "DRAFT");
  assert.equal((await getPublishedCollections()).some((entry) => entry.id === group), false);
});

test("category names, descriptions, parents, ordering and visibility survive update and reload", async () => {
  const parent = await saveTaxonomy(manager, category("Parent category", { visible: true }), f.runtime);
  const child = await saveTaxonomy(manager, category("Child category", { parentId: parent, visible: true }), f.runtime);
  const original = await savedCategory(child);
  await saveTaxonomy(manager, { ...editCategory(original), name: "Changed child", description: "Changed description.", displayOrder: 13, visible: false }, f.runtime);
  const actual = await savedCategory(child);
  assert.deepEqual({ name: actual.name, description: actual.description, parentId: actual.parentId, displayOrder: actual.displayOrder, visible: actual.visible }, { name: "Changed child", description: "Changed description.", parentId: parent, displayOrder: 13, visible: false });
  await assert.rejects(saveTaxonomy(manager, { ...editCategory(actual), slug: "changed-public-url" }, f.runtime), { status: 409 });
  await assert.rejects(saveTaxonomy(manager, { ...editCategory(original), name: "Stale overwrite" }, f.runtime), { status: 409 });
  assert.equal((await savedCategory(child)).name, "Changed child");
});

test("category hierarchy rejects missing parents, cycles and visible children of hidden ancestors", async () => {
  await assert.rejects(saveTaxonomy(manager, category("Missing parent", { parentId: randomUUID() }), f.runtime), { status: 400 });
  const hidden = await saveTaxonomy(manager, category("Hidden parent"), f.runtime);
  await assert.rejects(saveTaxonomy(manager, category("Invalid visible child", { parentId: hidden, visible: true }), f.runtime), { status: 400 });
  const child = await saveTaxonomy(manager, category("Hidden child", { parentId: hidden }), f.runtime);
  await assert.rejects(saveTaxonomy(manager, { ...editCategory(await savedCategory(hidden)), parentId: child }, f.runtime), { status: 400 });
  await assert.rejects(saveTaxonomy(manager, { ...editCategory(await savedCategory(child)), parentId: child }, f.runtime), { status: 400 });
  const a = await saveTaxonomy(manager, category("Concurrent category a"), f.runtime), b = await saveTaxonomy(manager, category("Concurrent category b"), f.runtime);
  const [ar, br] = await Promise.all([savedCategory(a), savedCategory(b)]);
  const results = await Promise.allSettled([saveTaxonomy(manager, { ...editCategory(ar), parentId: b }, f.runtime), saveTaxonomy(manager, { ...editCategory(br), parentId: a }, f.runtime)]);
  assert.equal(results.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(results.filter((entry) => entry.status === "rejected").length, 1);
});

test("collection publication, draft and archive preserve associations and first-publication URL", async () => {
  const categoryId = await saveTaxonomy(manager, category("Assigned category", { visible: true }), f.runtime);
  const collectionId = await saveTaxonomy(manager, collection("Managed collection"), f.runtime);
  const id = await saveProduct(manager, null, { product: product("Taxonomy assigned product", { categoryIds: [categoryId], collectionIds: [collectionId] }), action: "save" }, f.runtime);
  let entry = await savedCollection(collectionId);
  await saveTaxonomy(manager, { ...editCollection(entry), name: "Renamed collection", slug: "managed-collection-renamed", description: "Edited collection description.", displayOrder: 9, status: "PUBLISHED" }, f.runtime);
  entry = await savedCollection(collectionId); assert.equal(entry.slugLocked, true); assert.equal(entry.description, "Edited collection description."); assert.equal(entry.displayOrder, 9);
  const published = (await f.data.query("SELECT published_at::TEXT FROM collections WHERE id=$1", [collectionId])).rows[0].published_at;
  assert.ok(published); assert.equal((await getPublishedCollections()).some((record) => record.id === collectionId), true);
  await assert.rejects(saveTaxonomy(manager, { ...editCollection(entry), slug: "changed-after-publication" }, f.runtime), { status: 409 });
  await saveTaxonomy(manager, { ...editCollection(entry), status: "DRAFT" }, f.runtime);
  entry = await savedCollection(collectionId); assert.equal(entry.slugLocked, true);
  await saveTaxonomy(manager, { ...editCollection(entry), status: "ARCHIVED" }, f.runtime);
  assert.equal((await getPublishedCollections()).some((record) => record.id === collectionId), false);
  assert.equal((await f.data.query("SELECT published_at::TEXT FROM collections WHERE id=$1", [collectionId])).rows[0].published_at, published);
  assert.equal((await f.data.query("SELECT count(*) FROM product_collections WHERE product_id=$1 AND collection_id=$2", [id, collectionId])).rows[0].count, "1");
});

test("invalid data and audit insertion failure roll back taxonomy writes", async () => {
  for (const bad of [{ ...category("Bad category"), slug: "INVALID SLUG" }, { ...category("Extra field"), owner: true }, { ...collection("Bad state"), status: "UNKNOWN" }, { ...category("Bad order"), displayOrder: -1 }]) {
    await assert.rejects(saveTaxonomy(manager, bad, f.runtime));
    assert.equal((await f.data.query("SELECT id FROM categories WHERE name=$1 UNION ALL SELECT id FROM collections WHERE name=$1", [bad.name])).rowCount, 0);
  }
  await assert.rejects(saveTaxonomy(manager, category("Duplicate category", { slug: "first-category" }), f.runtime), { status: 409 });
  await f.data.query(`REVOKE INSERT ON audit_events FROM "${f.role}"`);
  try { await assert.rejects(saveTaxonomy(manager, category("Atomic category"), f.runtime), { status: 503 }); }
  finally { await f.data.query(`GRANT INSERT ON audit_events TO "${f.role}"`); }
  assert.equal((await f.data.query("SELECT id FROM categories WHERE slug='atomic-category'")).rowCount, 0);
});

test("existing future collection schedules survive ordinary edits and explicit republication publishes now", async () => {
  const id = await saveTaxonomy(manager, collection("Future collection fixture", { status: "PUBLISHED" }), f.runtime);
  await f.data.query("UPDATE collections SET published_at=clock_timestamp()+INTERVAL '1 day' WHERE id=$1", [id]);
  let entry = await savedCollection(id);
  const scheduled = entry.publishedAt;
  assert.ok(scheduled); assert.equal(entry.publiclyVisible, false); assert.equal(entry.slugLocked, true);
  await saveTaxonomy(manager, { ...editCollection(entry), description: "Edited without rescheduling." }, f.runtime);
  entry = await savedCollection(id);
  assert.equal(entry.publishedAt, scheduled); assert.equal(entry.publiclyVisible, false);
  assert.equal((await getPublishedCollections()).some((record) => record.id === id), false);
  await saveTaxonomy(manager, { ...editCollection(entry), status: "DRAFT" }, f.runtime);
  entry = await savedCollection(id);
  assert.equal(entry.publishedAt, scheduled); assert.equal(entry.publiclyVisible, false); assert.equal(entry.slugLocked, true);
  await saveTaxonomy(manager, { ...editCollection(entry), status: "PUBLISHED" }, f.runtime);
  entry = await savedCollection(id);
  assert.notEqual(entry.publishedAt, scheduled); assert.equal(entry.publiclyVisible, true); assert.equal(entry.slugLocked, true);
  assert.equal((await getPublishedCollections()).some((record) => record.id === id), true);
  const republished = entry.publishedAt;
  await saveTaxonomy(manager, { ...editCollection(entry), status: "ARCHIVED" }, f.runtime);
  entry = await savedCollection(id);
  assert.equal(entry.publishedAt, republished); assert.equal(entry.publiclyVisible, false); assert.equal(entry.slugLocked, true);
});

test("taxonomy HTTP preserves authorization, Origin, method and bounded JSON protections", async () => {
  await assert.rejects(readTaxonomy(new Headers(), f.runtime), AdminAccessError);
  assert.equal((await taxonomyHttp(request(category("Unauthorized category"), new Headers()), f.runtime)).status, 401);
  const cross = request(category("Cross origin category")); cross.headers.set("Origin", "https://untrusted.example.test");
  assert.equal((await taxonomyHttp(cross, f.runtime)).status, 403);
  const crossSite = request(category("Cross site category")); crossSite.headers.set("sec-fetch-site", "cross-site");
  assert.equal((await taxonomyHttp(crossSite, f.runtime)).status, 403);
  assert.equal((await taxonomyHttp(request({}, manager, "DELETE"), f.runtime)).status, 405);
  const oversized = request({ ...category("Large category"), description: "a".repeat(262144) });
  assert.equal((await taxonomyHttp(oversized, f.runtime)).status, 413);
  const invalidJson = request(category("Wrong content type")); invalidJson.headers.set("Content-Type", "text/plain");
  assert.equal((await taxonomyHttp(invalidJson, f.runtime)).status, 415);
  await f.data.query("UPDATE admin_users SET is_active=false WHERE id=$1", [f.users.CATALOGUE_MANAGER.id]);
  try { assert.equal((await taxonomyHttp(request(category("Disabled category")), f.runtime)).status, 401); }
  finally { await f.data.query("UPDATE admin_users SET is_active=true WHERE id=$1", [f.users.CATALOGUE_MANAGER.id]); }
});

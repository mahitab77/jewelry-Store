// Exercise retained direct-sales behavior; quotation-only denial has its own suites.
process.env.COMMERCE_MODE = "DIRECT_SALES";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import pg from "pg";
import { databaseConfig, DatabaseError, isLoopback } from "../src/lib/db/config.ts";
import { closeDatabase, queryRows, withDatabaseClient, withTransaction } from "../src/lib/db/client.ts";
import { runMigrations, MIGRATION_LOCK } from "../db/tools/migrate.ts";
import { seedDevelopment, developmentId as id } from "../db/tools/seed.ts";
import { localDatabaseConfig, LocalDatabaseError } from "../db/tools/local.ts";
import { CatalogueInputError, getPublishedCategories, getPublishedCollections, getPublishedProducts,
  getPublishedProductBySlug, getProductsByCategorySlug, getProductsByCollectionSlug } from "../src/lib/catalogue/repository.ts";

const previousUrl = process.env.DATABASE_URL;
const owned = new Set<string>();
const suffix = randomUUID().replaceAll("-", "");
const database = `lapalme_test_${suffix}`;
const legacyDatabase = `lapalme_test_legacy_${suffix}`;
const role = `lapalme_reader_${suffix}`;
let root = "";
let admin: pg.Pool;
let data: pg.Pool;
let ownerUrl = "";
let legacyUrl = "";
let readerUrl = "";
let baseUrl: URL;
let roleCreated = false;

function dbUrl(name: string): string {
  const result = new URL(baseUrl);
  result.pathname = `/${name}`;
  return result.toString();
}
async function createDatabase(name: string): Promise<void> {
  assert.match(name, /^lapalme_test_[a-z0-9_]+$/);
  await admin.query(`CREATE DATABASE "${name}"`);
  owned.add(name);
}
async function migrationCopy(name: string): Promise<string> {
  const directory = join(root, name);
  await mkdir(directory);
  await cp(resolve("db/migrations"), directory, { recursive: true });
  return directory;
}

before(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Set TEST_DATABASE_URL to an explicitly disposable local PostgreSQL cluster.");
  const config = databaseConfig(process.env.TEST_DATABASE_URL);
  if (!isLoopback(config.host ?? "") || process.env.NODE_ENV === "production") throw new LocalDatabaseError();
  baseUrl = new URL(process.env.TEST_DATABASE_URL);
  root = await mkdtemp(join(tmpdir(), "la-palme-phase02-tests-"));
  admin = new pg.Pool({ ...config, max: 1 });
  await createDatabase(database);
  await createDatabase(legacyDatabase);
  ownerUrl = dbUrl(database);
  legacyUrl = dbUrl(legacyDatabase);
  data = new pg.Pool(databaseConfig(ownerUrl));
  delete process.env.DATABASE_URL;
});

after(async () => {
  await closeDatabase();
  if (data) await data.end();
  if (admin) {
    try {
      for (const name of owned) {
        assert.match(name, /^lapalme_test_[a-z0-9_]+$/);
        await admin.query(`DROP DATABASE "${name}"`);
      }
      if (roleCreated) await admin.query(`DROP ROLE "${role}"`);
    } finally { await admin.end(); }
  }
  if (root) {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    assert.ok(root.includes("la-palme-phase02-tests-"));
    await rm(root, { recursive: true, force: true });
  }
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
});

test("fresh migrations apply and verified replay is a no-op", async () => {
  assert.equal((await runMigrations(ownerUrl)).length, 13);
  assert.deepEqual(await runMigrations(ownerUrl), []);
  const ledger = (await data.query("SELECT version, checksum_sha256 FROM schema_migrations ORDER BY version")).rows;
  assert.equal(ledger.length, 13);
  assert.ok(ledger.every((row) => /^[a-f0-9]{64}$/.test(row.checksum_sha256)));
});

test("a held session advisory lock rejects another migration runner", async () => {
  const client = await data.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [...MIGRATION_LOCK]);
    await assert.rejects(runMigrations(ownerUrl), /holds the database lock/);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1, $2)", [...MIGRATION_LOCK]);
    client.release();
  }
  assert.deepEqual(await runMigrations(ownerUrl), []);
});

test("changed, missing, reordered files and inconsistent ledger are rejected", async () => {
  const changed = await migrationCopy("changed");
  await writeFile(join(changed, "0006_migration_checksums.sql"),
    (await readFile(join(changed, "0006_migration_checksums.sql"), "utf8")).replace("SET LOCAL", "-- changed\nSET LOCAL"));
  await assert.rejects(runMigrations(ownerUrl, { directory: changed }), /checksum/);
  const missing = await migrationCopy("missing");
  await rm(join(missing, "0013_quotation_requests_specifications.sql"));
  await assert.rejects(runMigrations(ownerUrl, { directory: missing }), /missing/);
  const reordered = await migrationCopy("reordered");
  await rename(join(reordered, "0002_customers_admin_carts.sql"), join(reordered, "0008_customers_admin_carts.sql"));
  await assert.rejects(runMigrations(ownerUrl, { directory: reordered }), /contiguous/);
  await data.query("UPDATE schema_migrations SET filename = '0002_wrong.sql' WHERE version = '0002'");
  try { await assert.rejects(runMigrations(ownerUrl), /inconsistent/); }
  finally { await data.query("UPDATE schema_migrations SET filename = '0002_customers_admin_carts.sql' WHERE version = '0002'"); }
});

test("failed migration DDL and ledger insertion both roll back", async () => {
  const directory = await migrationCopy("failed");
  await writeFile(join(directory, "0014_failure_fixture.sql"), `BEGIN;
CREATE TABLE public.phase02_rollback_fixture(id UUID PRIMARY KEY);
INSERT INTO public.schema_migrations(version, filename) VALUES ('0014', '0014_failure_fixture.sql');
SELECT public.phase02_nonexistent_function();
COMMIT;\n`);
  await assert.rejects(runMigrations(ownerUrl, { directory }), /0014 failed and was rolled back/);
  assert.equal((await data.query("SELECT to_regclass('public.phase02_rollback_fixture') AS relation")).rows[0].relation, null);
  assert.equal((await data.query("SELECT count(*) FROM schema_migrations")).rows[0].count, "13");
});

test("original Phase 01 schema test passes; legacy adoption is explicit and additive", async () => {
  const legacy = new pg.Client(databaseConfig(legacyUrl));
  await legacy.connect();
  try {
    for (const filename of ["0001_catalogue.sql", "0002_customers_admin_carts.sql", "0003_orders_payments.sql", "0004_inventory.sql", "0005_fulfillment_requests_audit.sql"]) {
      await legacy.query(await readFile(join("db/migrations", filename), "utf8"));
    }
    const verification = (await readFile("db/tests/schema-verification.sql", "utf8")).replace(/^\\set[^\n]*\n/m, "");
    await legacy.query(verification);
    await assert.rejects(runMigrations(legacyUrl), /explicit --adopt-existing/);
    assert.deepEqual(await runMigrations(legacyUrl, { adoptExisting: true }), ["0006_migration_checksums.sql", "0007_admin_authentication.sql", "0008_catalogue_media.sql", "0009_guest_cart.sql", "0010_checkout_drafts.sql", "0011_test_payment_lifecycle.sql", "0012_order_fulfillment_administration.sql", "0013_quotation_requests_specifications.sql"]);
    assert.deepEqual(await runMigrations(legacyUrl), []);
  } finally { await legacy.end(); }
});

test("development seed is deterministic, idempotent and excludes personal/financial data", async () => {
  await assert.rejects(seedDevelopment(ownerUrl), LocalDatabaseError);
  assert.throws(() => localDatabaseConfig("postgresql://example:placeholder@remote.invalid/lapalme_dev_catalogue"), LocalDatabaseError);
  await seedDevelopment(ownerUrl, true);
  const before = (await data.query("SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) AS rows FROM products p")).rows[0].rows;
  await seedDevelopment(ownerUrl, true);
  assert.deepEqual((await data.query("SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) AS rows FROM products p")).rows[0].rows, before);
  assert.equal((await data.query("SELECT count(*) FROM products")).rows[0].count, "6");
  for (const table of ["customer_profiles", "customer_addresses", "carts", "cart_items", "orders", "payments", "payment_events", "admin_users", "inventory_reservations"]) {
    assert.equal((await data.query(`SELECT count(*) FROM public.${table}`)).rows[0].count, "0");
  }
  // Runtime catalogue reads require only selected catalogue-table SELECT privileges.
  await admin.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
  roleCreated = true;
  await data.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
  await data.query(`GRANT SELECT ON categories, collections, products, product_categories, product_collections,
    product_variants, product_prices, product_media, gemstones, product_gemstones, inventory TO "${role}"`);
  const runtime = new URL(ownerUrl);
  runtime.username = role;
  runtime.password = "";
  readerUrl = runtime.toString();
  process.env.DATABASE_URL = readerUrl;
});

test("only currently published products, visible categories and published collections are public", async () => {
  const page = await getPublishedProducts();
  assert.equal(page.items.length, 4);
  assert.ok(page.items.every((p) => !/draft|archived/.test(p.slug)));
  assert.equal(await getPublishedProductBySlug("dev-draft-ring"), null);
  assert.equal(await getPublishedProductBySlug("dev-archived-ring"), null);
  assert.equal((await getPublishedCategories()).length, 4);
  assert.deepEqual((await getPublishedCollections()).map((c) => c.slug), ["dev-selections"]);
  await data.query("UPDATE products SET published_at = '2099-01-01' WHERE id = $1", [id(101)]);
  try { assert.equal(await getPublishedProductBySlug("dev-unique-ring"), null); }
  finally { await data.query("UPDATE products SET published_at = '2020-01-01' WHERE id = $1", [id(101)]); }
});

test("category/collection filters combine without exposing hidden associations", async () => {
  assert.deepEqual((await getProductsByCategorySlug("dev-rings")).items.map((p) => p.slug), ["dev-unique-ring"]);
  assert.equal((await getProductsByCollectionSlug("dev-selections")).items.length, 4);
  assert.equal((await getPublishedProducts({ categorySlug: "dev-earrings", collectionSlug: "dev-selections" })).items.length, 1);
  assert.equal((await getProductsByCollectionSlug("dev-unpublished")).items.length, 0);
  assert.equal((await getProductsByCategorySlug("nonexistent")).items.length, 0);
  await data.query("UPDATE categories SET is_visible = false WHERE id = $1", [id(1)]);
  try {
    assert.equal((await getProductsByCategorySlug("dev-rings")).items.length, 0);
    assert.equal((await getPublishedProductBySlug("dev-unique-ring"))?.categories.length, 0);
  } finally { await data.query("UPDATE categories SET is_visible = true WHERE id = $1", [id(1)]); }
});

test("detail lookup has ordered media, variants, gemstones, and optional primary image", async () => {
  const detail = await getPublishedProductBySlug("dev-unique-ring");
  assert.ok(detail);
  assert.equal(detail.variants.length, 1);
  assert.equal(detail.productType, "ONE_OF_A_KIND");
  assert.equal(detail.media.length, 2);
  assert.equal(detail.media[0].id, detail.primaryImage?.id);
  assert.equal(detail.variants[0].gemstones[0].caratWeight, "1.2500");
  assert.equal(detail.variants[0].gemstones[0].quantity, 1);
  assert.equal((await getPublishedProductBySlug("dev-repeatable-earrings"))?.variants.length, 2);
  assert.equal((await getPublishedProductBySlug("dev-bespoke-bracelet"))?.primaryImage, null);
  assert.equal(await getPublishedProductBySlug("nonexistent-product"), null);
});

test("slugs, pagination, sorting and malicious-looking input are validated", async () => {
  for (const slug of ["", "UPPER", "../orders", "a".repeat(161), "x' OR 1=1--", "x;DROP TABLE products;"]) {
    await assert.rejects(getPublishedProductBySlug(slug), CatalogueInputError);
    await assert.rejects(getProductsByCategorySlug(slug), CatalogueInputError);
    await assert.rejects(getProductsByCollectionSlug(slug), CatalogueInputError);
  }
  for (const limit of [0, -1, 51, 1.2, NaN, Infinity]) await assert.rejects(getPublishedProducts({ limit }), CatalogueInputError);
  for (const offset of [-1, 10001, 0.5]) await assert.rejects(getPublishedProducts({ offset }), CatalogueInputError);
  await assert.rejects(getPublishedProducts({ sort: "name; DROP TABLE products" as "newest" }), CatalogueInputError);
  await assert.rejects(getPublishedProducts({ sort: {} as "newest" }), CatalogueInputError);
  await assert.rejects(getPublishedProducts(null as unknown as Parameters<typeof getPublishedProducts>[0]), CatalogueInputError);
  const first = await getPublishedProducts({ limit: 2 });
  const next = await getPublishedProducts({ limit: 2, offset: 2 });
  assert.equal(first.hasMore, true);
  assert.equal(next.hasMore, false);
  assert.deepEqual((await getPublishedProducts({ limit: 2 })).items, first.items);
  assert.equal(new Set([...first.items, ...next.items].map((p) => p.id)).size, 4);
  const names = (await getPublishedProducts({ sort: "name_asc" })).items.map((p) => p.name);
  assert.deepEqual(names, [...names].sort());
  assert.equal((await getPublishedProducts({ offset: 10000 })).items.length, 0);
  assert.equal((await data.query("SELECT count(*) FROM products")).rows[0].count, "6");
});

test("EGP prices preserve minor units, including values above Number.MAX_SAFE_INTEGER", async () => {
  assert.deepEqual((await getPublishedProductBySlug("dev-unique-ring"))?.fromPrice, { currency: "EGP", amountMinor: "1599000" });
  await data.query("UPDATE product_prices SET amount_minor = $1 WHERE variant_id = $2", ["9007199254740993", id(201)]);
  try { assert.equal((await getPublishedProductBySlug("dev-unique-ring"))?.fromPrice?.amountMinor, "9007199254740993"); }
  finally { await data.query("UPDATE product_prices SET amount_minor = 1599000 WHERE variant_id = $1", [id(201)]); }
  assert.equal((await getPublishedProductBySlug("dev-repeatable-earrings"))?.fromPrice?.amountMinor, "245000");
});

test("enquiry-only/bespoke prices are suppressed, unpriced direct variants cannot purchase", async () => {
  await data.query("INSERT INTO product_prices(variant_id, amount_minor) VALUES ($1, 777777)", [id(203)]);
  try {
    const enquiry = await getPublishedProductBySlug("dev-enquiry-pendant");
    assert.equal(enquiry?.fromPrice, null);
    assert.equal(enquiry?.variants[0].price, null);
    assert.equal(enquiry?.canPurchase, false);
    assert.equal(enquiry?.canEnquire, true);
    const bespoke = await getPublishedProductBySlug("dev-bespoke-bracelet");
    assert.equal(bespoke?.pricingMode, "ENQUIRY_ONLY");
    assert.equal(bespoke?.canPurchase, false);
  } finally { await data.query("DELETE FROM product_prices WHERE variant_id = $1", [id(203)]); }
  await data.query("UPDATE product_prices SET is_active = false WHERE variant_id IN ($1, $2)", [id(202), id(207)]);
  try {
    const unpriced = await getPublishedProductBySlug("dev-repeatable-earrings");
    assert.equal(unpriced?.fromPrice, null);
    assert.equal(unpriced?.pricingMode, "PRICE_ON_REQUEST");
    assert.equal(unpriced?.canPurchase, false);
  } finally { await data.query("UPDATE product_prices SET is_active = true WHERE variant_id IN ($1, $2)", [id(202), id(207)]); }
});

test("availability uses on_hand minus reserved, excludes inactive variants, and never holds stock", async () => {
  await data.query("UPDATE inventory SET reserved = on_hand WHERE variant_id = $1", [id(202)]);
  try {
    const soldOut = await getPublishedProductBySlug("dev-repeatable-earrings");
    assert.equal(soldOut?.canPurchase, false);
    assert.ok(soldOut?.variants.every((v) => v.availability === "OUT_OF_STOCK"));
  } finally { await data.query("UPDATE inventory SET reserved = 0 WHERE variant_id = $1", [id(202)]); }
  await data.query("UPDATE product_variants SET is_active = false WHERE id = $1", [id(201)]);
  try { assert.equal((await getPublishedProductBySlug("dev-unique-ring"))?.variants.length, 0); }
  finally { await data.query("UPDATE product_variants SET is_active = true WHERE id = $1", [id(201)]); }
  assert.equal((await getPublishedProductBySlug("dev-unique-ring"))?.canPurchase, true);
  assert.equal((await data.query("SELECT count(*) FROM inventory_reservations")).rows[0].count, "0");
});

test("public types exclude certificates/provenance, raw stock and private-domain data", async () => {
  await data.query("UPDATE gemstones SET report_reference = 'private-report', laboratory = 'private-lab', origin = 'private-origin' WHERE id = $1", [id(501)]);
  const detail = await getPublishedProductBySlug("dev-unique-ring");
  assert.ok(detail);
  assert.doesNotMatch(JSON.stringify(detail), /private-report|private-lab|private-origin|report_reference|provenance|on_hand|reserved|customer|payment|actor/);
  await assert.rejects(queryRows("SELECT * FROM public.customer_profiles"), (error: unknown) => error instanceof DatabaseError && error.code === "DATABASE_UNAVAILABLE");
  assert.equal((await getPublishedProducts()).items.length, 4);
});

test("pool reuse, transaction cleanup, missing configuration and sanitized failures", async () => {
  const first = await withDatabaseClient(async (client) => (await client.query("SELECT pg_backend_pid() AS id")).rows[0].id);
  const second = await withDatabaseClient(async (client) => (await client.query("SELECT pg_backend_pid() AS id")).rows[0].id);
  assert.equal(first, second);
  await assert.rejects(withTransaction(async (client) => { await client.query("SELECT phase02_no_such_function()"); }), DatabaseError);
  assert.equal((await getPublishedProducts()).items.length, 4);
  await closeDatabase();
  delete process.env.DATABASE_URL;
  await assert.rejects(getPublishedProducts(), (e: unknown) => e instanceof DatabaseError && e.code === "DATABASE_NOT_CONFIGURED");
  assert.throws(() => databaseConfig("not-a-url-containing-password"), (e: unknown) => e instanceof DatabaseError && !e.message.includes("password"));
  assert.throws(() => databaseConfig("postgresql://user:secret@remote.invalid/db?sslmode=disable"), DatabaseError);
  assert.throws(() => databaseConfig("postgresql://user:secret@remote.invalid/db?sslmode=no-verify"), DatabaseError);
  assert.deepEqual(databaseConfig("postgresql://user:placeholder@remote.invalid/db?sslmode=require").ssl, { rejectUnauthorized: true });
  process.env.DATABASE_URL = "postgresql://error-marker:secret-marker@127.0.0.1:1/lapalme_test_unreachable";
  await assert.rejects(getPublishedProducts(), (e: unknown) => e instanceof DatabaseError && e.code === "DATABASE_UNAVAILABLE" && !/marker|127\.0|SELECT/.test(e.message));
  await closeDatabase();
  process.env.DATABASE_URL = readerUrl;
  assert.equal((await getPublishedProducts()).items.length, 4);
});

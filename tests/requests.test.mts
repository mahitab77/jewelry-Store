import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import pg from "pg";
import { after, before, beforeEach, test } from "node:test";
import { requestFixture } from "./helpers/request-fixture.mts";
import { catalogueFixture } from "./helpers/catalogue-fixture.mts";
import { developmentId } from "../db/tools/seed.ts";
import { runMigrations } from "../db/tools/migrate.ts";
import { submitRequest } from "../src/lib/requests/repository.ts";
import { requestsHttp } from "../src/lib/requests/http.ts";
import { parseRequest, RequestError } from "../src/lib/requests/validation.ts";
import { cairoFields, cairoInstant } from "../src/lib/requests/cairo.ts";
import { listRequests, readRequest, changeRequest } from "../src/lib/admin/requests/repository.ts";
import { adminRequestsHttp } from "../src/lib/admin/requests/http.ts";
import { AdminAccessError } from "../src/lib/admin/authorization.ts";
import type { PublicRequestInput, RequestKind } from "../src/lib/requests/types.ts";
import { databaseConfig } from "../src/lib/db/config.ts";

let f: Awaited<ReturnType<typeof requestFixture>>, owner: Headers, manager: Headers;
const oldMode = process.env.COMMERCE_MODE;
before(async () => { delete process.env.COMMERCE_MODE; f = await requestFixture(); owner = await f.headers("OWNER"); manager = await f.headers("CATALOGUE_MANAGER"); }, { timeout: 60000 });
beforeEach(async () => { await f.data.query("DELETE FROM admin_auth_rate_limits"); await f.data.query("DELETE FROM cart_rate_limits"); });
after(async () => { if (f) await f.close(); if (oldMode === undefined) delete process.env.COMMERCE_MODE; else process.env.COMMERCE_MODE = oldMode; });
function input(extra: Partial<PublicRequestInput> = {}): PublicRequestInput {
  const id = randomUUID(); return { submissionId: id, kind: "QUOTATION", productId: developmentId(101), variantId: developmentId(201), name: "Local request fixture", email: `local-${id}@boutique.test`, message: "Clearly labelled local request fixture only.", ...extra };
}
function request(value: unknown, extra: Record<string, string> = {}, method = "POST") {
  return new Request(f.authConfig.baseURL + "/api/requests", { method, headers: { Origin: f.authConfig.baseURL, "Content-Type": "application/json", ...extra }, ...(method === "GET" ? {} : { body: JSON.stringify(value) }) });
}
async function counts() { return (await f.data.query("SELECT (SELECT count(*)::INT FROM product_enquiries) AS enquiries,(SELECT count(*)::INT FROM bespoke_requests) AS bespoke,(SELECT count(*)::INT FROM appointment_requests) AS appointments,(SELECT count(*)::INT FROM audit_events WHERE action='REQUEST_RECEIVED') AS audits")).rows[0]; }
async function detail(kind: RequestKind, id: string) { const result = await readRequest(owner, kind, id, f.runtime); assert.ok(result); return result; }
async function update(kind: RequestKind, id: string, extra: Record<string, unknown>) { const current = await detail(kind, id); return changeRequest(owner, kind, id, { revision: current.request.revision, status: current.request.status, ...extra }, f.runtime); }

test("Cairo wall times use the named zone and reject invalid dates, DST gaps and ambiguous repeated times", () => {
  assert.equal(cairoInstant("2030-01-10", "12:30"), "2030-01-10T10:30:00.000Z");
  assert.equal(cairoInstant("2030-07-10", "12:30"), "2030-07-10T09:30:00.000Z");
  assert.deepEqual(cairoFields("2030-07-10T09:30:00.000Z"), { date: "2030-07-10", time: "12:30" });
  for (const [date, time] of [["2030-02-30", "12:00"], ["2030-01-10", "24:00"], ["2027-04-30", "00:30"], ["2027-10-28", "23:30"]]) assert.throws(() => cairoInstant(date, time));
});

test("all five guest journeys persist exactly one existing business row and one sanitized audit each", async () => {
  const before = await counts();
  const journeys = [input(), input({ kind: "MODIFICATION" }), input({ kind: "BESPOKE", productId: undefined, variantId: undefined }),
    input({ kind: "CONSULTATION", channel: "ZOOM", preferredDate: "2030-01-10", preferredTime: "12:30" }),
    input({ kind: "CONSULTATION", channel: "BOUTIQUE", productId: undefined, variantId: undefined, email: undefined, phone: "01012345678" })];
  for (const value of journeys) {
    const response = await requestsHttp(request(value), f.runtime); assert.equal(response.status, 200);
    const body = await response.json(); assert.deepEqual(Object.keys(body).sort(), ["message", "reference"]); assert.equal(body.reference, value.submissionId);
    assert.match(body.message, /subject to confirmation/); assert.match(response.headers.get("Cache-Control")!, /private.*no-store/);
    const record = (await detail(value.kind, value.submissionId)).request;
    assert.equal(record.status, "NEW"); assert.equal(record.message, value.message); assert.equal(record.name, value.name);
    assert.equal(record.productId, value.productId ?? null); assert.equal(record.variantId, value.variantId ?? null);
    assert.equal(record.productContext === null, !value.productId);
    if (value.kind === "CONSULTATION") assert.equal(record.channel, value.channel);
    const audit = (await f.data.query("SELECT metadata FROM audit_events WHERE action='REQUEST_RECEIVED' AND target_id=$1", [value.submissionId])).rows;
    assert.equal(audit.length, 1); const serialized = JSON.stringify(audit); assert.ok(!serialized.includes(value.message)); assert.ok(!serialized.includes(value.name)); assert.ok(!serialized.includes(value.email ?? "NEVER-MATCH"));
  }
  const after = await counts(); assert.equal(after.enquiries - before.enquiries, 1); assert.equal(after.bespoke - before.bespoke, 2); assert.equal(after.appointments - before.appointments, 2); assert.equal(after.audits - before.audits, 5);
});

test("contact and strict request validation reject forged fields and keep consultation semantics separate", () => {
  for (const value of [input({ email: "bad@", phone: undefined }), input({ email: undefined, phone: undefined }), input({ kind: "CONSULTATION", channel: "ZOOM", email: undefined, phone: "+201012345678" }),
    input({ productId: undefined }), input({ variantId: developmentId(201), productId: undefined }), input({ kind: "BESPOKE" }), input({ channel: "ZOOM" }), input({ kind: "CONSULTATION", channel: "BOUTIQUE", preferredDate: "2030-01-10" }), { ...input(), status: "CONFIRMED" }, { ...input(), product_context: { name: "Forged" } }]) assert.throws(() => parseRequest(value), RequestError);
  assert.equal(parseRequest(input({ email: undefined, phone: "+44 20 7946 0123" })).phone, "+442079460123");
});

test("published configuration context is validated server-side while out-of-stock enquiries remain allowed", async () => {
  const good = input({ productId: developmentId(102), variantId: developmentId(207) }); await submitRequest(good, f.runtime);
  const snapshot = (await detail(good.kind, good.submissionId)).request.productContext!;
  assert.equal(snapshot.sku, "DEV-207"); assert.equal(snapshot.size, "Development alternate");
  for (const value of [input({ productId: developmentId(105), variantId: developmentId(205) }), input({ productId: developmentId(106), variantId: developmentId(206) }), input({ productId: developmentId(102), variantId: developmentId(201) }), input({ productId: randomUUID(), variantId: undefined })]) await assert.rejects(submitRequest(value, f.runtime), { status: 409 });
  await f.data.query("UPDATE product_variants SET is_active=false WHERE id=$1", [developmentId(207)]);
  try { await assert.rejects(submitRequest(input({ productId: developmentId(102), variantId: developmentId(207) }), f.runtime), { status: 409 }); }
  finally { await f.data.query("UPDATE product_variants SET is_active=true WHERE id=$1", [developmentId(207)]); }
});

test("concurrent duplicate submissions return one receipt with one row and one audit", async () => {
  const value = input(), before = await counts();
  const receipts = await Promise.all([1, 2, 3].map(() => submitRequest(value, f.runtime)));
  assert.ok(receipts.every((receipt) => receipt.reference === value.submissionId));
  const after = await counts(); assert.equal(after.enquiries - before.enquiries, 1); assert.equal(after.audits - before.audits, 1);
  await assert.rejects(submitRequest({ ...value, message: "Changed payload with the same reference" }, f.runtime), { status: 409 });
  await assert.rejects(submitRequest({ ...value, kind: "MODIFICATION", email: `other-${randomUUID()}@boutique.test` }, f.runtime), { status: 409 });
});

test("uncertain receipt recovery survives later catalogue edits and retains the original public-only snapshot", async () => {
  const value = input(); await submitRequest(value, f.runtime);
  const saved = (await detail(value.kind, value.submissionId)).request.productContext!;
  assert.equal(saved.stones[0].caratWeight, "1.2500");
  for (const forbidden of ["price", "amountMinor", "origin", "laboratory", "reportReference", "treatment", "image", "photo"]) assert.ok(!JSON.stringify(saved).includes(`"${forbidden}"`));
  await f.data.query("UPDATE products SET status='DRAFT',name='Local changed fixture name' WHERE id=$1", [value.productId]);
  try { assert.equal((await submitRequest(value, f.runtime)).reference, value.submissionId); assert.deepEqual((await detail(value.kind, value.submissionId)).request.productContext, saved); }
  finally { await f.data.query("UPDATE products SET status='PUBLISHED',name='[DEVELOPMENT] unique-ring' WHERE id=$1", [value.productId]); }
});

test("public transport rejects cross-origin, cross-site, oversized and anonymous lookup requests without PII", async () => {
  const value = input(), before = await counts();
  assert.equal((await requestsHttp(request(value, { Origin: "https://untrusted.test" }), f.runtime)).status, 403);
  assert.equal((await requestsHttp(request(value, { "sec-fetch-site": "cross-site" }), f.runtime)).status, 403);
  assert.equal((await requestsHttp(request({ ...value, message: "x".repeat(40000) }), f.runtime)).status, 413);
  assert.equal((await requestsHttp(request(value, {}, "GET"), f.runtime)).status, 405);
  assert.deepEqual(await counts(), before);
});

test("catalogue managers and anonymous callers cannot read private request records or perform staff mutations", async () => {
  const value = input(); await submitRequest(value, f.runtime);
  await assert.rejects(listRequests(manager, {}, f.runtime), AdminAccessError);
  await assert.rejects(readRequest(new Headers(), value.kind, value.submissionId, f.runtime), AdminAccessError);
  const denied = await adminRequestsHttp(new Request(f.authConfig.baseURL + `/api/admin/requests/${value.kind}/${value.submissionId}`, { headers: manager }), [value.kind, value.submissionId], f.runtime);
  assert.equal(denied.status, 403); assert.ok(!(await denied.text()).includes(value.email!));
});

test("staff filters, assignments, domain transitions and stale revisions are enforced atomically", async () => {
  const value = input(); await submitRequest(value, f.runtime);
  const original = await detail(value.kind, value.submissionId);
  await assert.rejects(update(value.kind, value.submissionId, { status: "IN_DESIGN" }), { status: 409 });
  await assert.rejects(update(value.kind, value.submissionId, { assignedAdminId: f.users.CATALOGUE_MANAGER.id }), { status: 400 });
  await changeRequest(owner, value.kind, value.submissionId, { revision: original.request.revision, status: "CONTACTED", assignedAdminId: f.users.ADMIN.id }, f.runtime);
  await assert.rejects(changeRequest(owner, value.kind, value.submissionId, { revision: original.request.revision, status: "CLOSED" }, f.runtime), { status: 409 });
  const filtered = await listRequests(owner, { kind: "QUOTATION", status: "CONTACTED" }, f.runtime);
  assert.ok(filtered.items.some((entry) => entry.id === value.submissionId)); assert.ok(filtered.items.every((entry) => entry.kind === "QUOTATION" && entry.status === "CONTACTED"));
  assert.ok(filtered.staff.every((entry) => entry.id !== f.users.CATALOGUE_MANAGER.id));
  await update(value.kind, value.submissionId, { status: "RESOLVED" }); await update(value.kind, value.submissionId, { status: "CLOSED" });
  await assert.rejects(update(value.kind, value.submissionId, { status: "NEW" }), { status: 409 });
});

test("Zoom confirmation requires agreed arrangements and cannot change immutable customer data", async () => {
  const value = input({ kind: "CONSULTATION", channel: "ZOOM", preferredDate: "2030-01-09", preferredTime: "11:00" }); await submitRequest(value, f.runtime);
  await assert.rejects(update(value.kind, value.submissionId, { status: "CONFIRMED", confirmedDate: "2030-01-10", confirmedTime: "12:30" }), { status: 400 });
  await assert.rejects(update(value.kind, value.submissionId, { status: "CONFIRMED", agreed: true, confirmedDate: "2027-04-30", confirmedTime: "00:30" }), { status: 400 });
  const confirmed = await update(value.kind, value.submissionId, { status: "CONFIRMED", agreed: true, confirmedDate: "2030-01-10", confirmedTime: "12:30" });
  assert.equal(confirmed.request.confirmedStart, "2030-01-10T10:30:00.000Z");
  const rescheduled = await update(value.kind, value.submissionId, { status: "CONFIRMED", agreed: true, confirmedDate: "2030-01-11", confirmedTime: "13:00", assignedAdminId: f.users.ADMIN.id });
  assert.equal(rescheduled.request.preferredStart, "2030-01-09T09:00:00.000Z");
  const changed = (await f.data.query("SELECT metadata FROM audit_events WHERE target_id=$1 AND action='REQUEST_UPDATED' ORDER BY created_at DESC,id DESC LIMIT 1", [value.submissionId])).rows[0].metadata;
  assert.deepEqual(changed.before, { assignedAdminId: null, confirmedStart: "2030-01-10T10:30:00.000Z", boutiqueLocationId: null });
  assert.deepEqual(changed.after, { assignedAdminId: f.users.ADMIN.id, confirmedStart: "2030-01-11T11:00:00.000Z", boutiqueLocationId: null });
  await assert.rejects(update(value.kind, value.submissionId, { name: "Forged customer edit" }), { status: 400 });
  await update(value.kind, value.submissionId, { status: "CANCELLED" });
  await assert.rejects(update(value.kind, value.submissionId, { status: "CONFIRMED", agreed: true }), { status: 409 });
});

test("Boutique confirmation requires an active verified destination and records no duplicate enquiry", async () => {
  const value = input({ kind: "CONSULTATION", channel: "BOUTIQUE" }); await submitRequest(value, f.runtime);
  const location = randomUUID(); await f.data.query("INSERT INTO boutique_locations(id,name,governorate,city_area,street_address) VALUES($1,'Local boutique fixture','Cairo','Local area','Local fixture street')", [location]);
  const fields = { status: "CONFIRMED", agreed: true, confirmedDate: "2030-02-10", confirmedTime: "14:00", boutiqueLocationId: location };
  await assert.rejects(update(value.kind, value.submissionId, fields), { status: 400 });
  await f.data.query("UPDATE boutique_locations SET is_active=true WHERE id=$1", [location]);
  const confirmed = await update(value.kind, value.submissionId, fields); assert.equal(confirmed.request.boutiqueLocationId, location);
  const nextLocation = randomUUID(); await f.data.query("INSERT INTO boutique_locations(id,name,governorate,city_area,street_address,is_active) VALUES($1,'Local alternate boutique','Cairo','Local area','Local alternate fixture street',true)", [nextLocation]);
  await update(value.kind, value.submissionId, { ...fields, boutiqueLocationId: nextLocation, confirmedDate: "2030-02-11" });
  const locationAudit = (await f.data.query("SELECT metadata FROM audit_events WHERE target_id=$1 AND action='REQUEST_UPDATED' ORDER BY created_at DESC,id DESC LIMIT 1", [value.submissionId])).rows[0].metadata;
  assert.equal(locationAudit.before.boutiqueLocationId, location); assert.equal(locationAudit.after.boutiqueLocationId, nextLocation);
  await assert.rejects(update(value.kind, value.submissionId, { status: "COMPLETED", boutiqueLocationId: randomUUID() }), { status: 400 });
  await update(value.kind, value.submissionId, { status: "COMPLETED" });
  assert.equal((await f.data.query("SELECT id FROM product_enquiries WHERE id=$1", [value.submissionId])).rowCount, 0);
});

test("request insertion rolls back when audit fails while distributed rejection counters remain consumed", async () => {
  const value = input(), before = await counts();
  await f.data.query(`REVOKE INSERT ON audit_events FROM "${f.role}"`);
  try { const response = await requestsHttp(request(value), f.runtime); assert.equal(response.status, 503); assert.ok(!(await response.text()).includes(value.email!)); }
  finally { await f.data.query(`GRANT INSERT ON audit_events TO "${f.role}"`); }
  assert.deepEqual(await counts(), before);
  assert.ok((await f.data.query("SELECT count(*)::INT AS n FROM cart_rate_limits")).rows[0].n >= 2);
  await submitRequest(value, f.runtime); assert.equal((await detail(value.kind, value.submissionId)).request.status, "NEW");
});

test("staff updates roll back on audit failure and restricted SQL cannot alter submitted customer data", async () => {
  const value = input(); await submitRequest(value, f.runtime); const before = await detail(value.kind, value.submissionId);
  await f.data.query(`REVOKE INSERT ON audit_events FROM "${f.role}"`);
  try { await assert.rejects(update(value.kind, value.submissionId, { status: "CONTACTED" }), { status: 503 }); }
  finally { await f.data.query(`GRANT INSERT ON audit_events TO "${f.role}"`); }
  assert.deepEqual(await detail(value.kind, value.submissionId), before);
  await assert.rejects(f.runtime.pool.query("UPDATE product_enquiries SET contact_name='Forbidden' WHERE id=$1", [value.submissionId]), { code: "42501" });
  await assert.rejects(f.runtime.pool.query("DELETE FROM product_enquiries WHERE id=$1", [value.submissionId]), { code: "42501" });
});

test("distributed contact throttling limits submissions across independent request calls", async () => {
  const email = `limit-${randomUUID()}@boutique.test`;
  for (let i = 0; i < 5; i++) await submitRequest(input({ email }), f.runtime);
  await assert.rejects(submitRequest(input({ email }), f.runtime), { status: 429 });
  assert.equal((await f.data.query("SELECT count(*)::INT AS n FROM product_enquiries WHERE contact_email=$1", [email])).rows[0].n, 5);
});

test("database constraints reject mismatched selected variants, invalid channels and oversized snapshots", async () => {
  const value = input(); await submitRequest(value, f.runtime);
  for (const sql of ["UPDATE product_enquiries SET product_id=NULL WHERE id=$1", "UPDATE product_enquiries SET variant_id='02000000-0000-4000-8000-000000000202' WHERE id=$1", "UPDATE product_enquiries SET product_context='[]'::JSONB WHERE id=$1", "UPDATE product_enquiries SET product_context=jsonb_build_object('x',repeat('x',65536)) WHERE id=$1"]) await assert.rejects(f.data.query(sql, [value.submissionId]), (error: unknown) => ["23503", "23514"].includes((error as { code: string }).code));
});

test("reviewed request grants refuse remote-target mismatch and pass only the explicit isolated local rehearsal", async () => {
  const url = new URL(f.ownerUrl), role = "lapalme_staging_app", artifact = "infra/neon/staging-request-grants.review.sql", password = randomBytes(32).toString("base64url");
  assert.equal((await f.data.query("SELECT rolname FROM pg_roles WHERE rolname=$1", [role])).rowCount, 0, "Never alter a pre-existing application role in this rehearsal.");
  await f.data.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
  let application: pg.Pool | undefined;
  const env = { ...process.env, PGHOST: "127.0.0.1", PGPORT: url.port || "5432", PGDATABASE: url.pathname.slice(1), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: "disable", PGCHANNELBINDING: "prefer" };
  const bin = process.env.PG_BIN ?? (process.platform === "win32" ? "C:/Program Files/PostgreSQL/18/bin" : "/usr/lib/postgresql/18/bin");
  const run = (local: boolean) => spawnSync(join(bin, process.platform === "win32" ? "psql.exe" : "psql"), ["-X", "--no-password", "--set=ON_ERROR_STOP=1", ...(local ? ["--set=local_rehearsal=true"] : []), "--file", artifact], { env, encoding: "utf8", windowsHide: true, timeout: 30000 });
  try {
    await f.data.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    assert.notEqual(run(false).status, 0, "The hosted execution path must reject a loopback database.");
    assert.equal((await f.data.query("SELECT has_table_privilege($1,'product_enquiries','SELECT') AS allowed", [role])).rows[0].allowed, false);
    const executed = run(true); assert.equal(executed.status, 0, executed.stderr);
    assert.notEqual(run(true).status, 0, "Already-applied grants must stop rather than silently replay.");
    const appUrl = new URL(f.ownerUrl); appUrl.username = role; appUrl.password = password;
    application = new pg.Pool(databaseConfig(appUrl.toString()));
    await application.query("SELECT id FROM product_enquiries LIMIT 1");
    const id = randomUUID();
    await application.query("INSERT INTO product_enquiries(id,contact_name,contact_email,message) VALUES($1,'Local grant fixture','local-grant@boutique.test','Local grant fixture only')", [id]);
    await application.query("UPDATE product_enquiries SET status='CONTACTED',updated_at=clock_timestamp() WHERE id=$1", [id]);
    for (const sql of ["SELECT * FROM schema_migrations", "UPDATE product_enquiries SET contact_name='Forbidden'", "UPDATE product_enquiries SET product_context='{}'::JSONB", "DELETE FROM product_enquiries", "CREATE TABLE forbidden_request_fixture(id INT)"])
      await assert.rejects(application.query(sql), { code: "42501" });
    const attributes = (await application.query("SELECT rolsuper,rolcreaterole,rolcreatedb,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
    assert.deepEqual(attributes, { rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false });
  } finally { if (application) await application.end(); await f.data.query(`DROP OWNED BY ${role}`); await f.data.query(`DROP ROLE ${role}`); }
});

test("0012 to 0013 preserves legacy enquiries, bespoke requests, confirmed appointments and seeded variant data", { timeout: 60000 }, async () => {
  const legacy = await catalogueFixture(undefined, true, 12);
  try {
    const bespoke = randomUUID(), appointment = randomUUID(), enquiry = randomUUID();
    await legacy.data.query(`INSERT INTO bespoke_requests(id,product_id,contact_name,contact_email,message,status,assigned_admin_id)
      VALUES($1,$2,'Local legacy design fixture','legacy-design@boutique.test','Local pre-0013 design details.','IN_DESIGN',$3)`, [bespoke, developmentId(101), legacy.users.ADMIN.id]);
    await legacy.data.query(`INSERT INTO appointment_requests(id,product_id,bespoke_request_id,contact_name,contact_phone,message,preferred_start_at,confirmed_start_at,status,assigned_admin_id)
      VALUES($1,$2,$3,'Local legacy appointment fixture','+201012345678','Local pre-0013 confirmed meeting.','2030-01-10T10:00:00Z','2030-01-11T11:00:00Z','CONFIRMED',$4)`, [appointment, developmentId(101), bespoke, legacy.users.ADMIN.id]);
    await legacy.data.query(`INSERT INTO product_enquiries(id,product_id,contact_name,contact_email,message,status,assigned_admin_id)
      VALUES($1,$2,'Local legacy enquiry fixture','legacy-enquiry@boutique.test','Local pre-0013 product question.','CONTACTED',$3)`, [enquiry, developmentId(102), legacy.users.ADMIN.id]);
    await legacy.data.query(`INSERT INTO audit_events(actor_kind,actor_admin_id,action,target_table,target_id,metadata)
      VALUES('ADMIN',$1,'LEGACY_REQUEST_FIXTURE','bespoke_requests',$2,'{"fixture":true}'::JSONB)`, [legacy.users.ADMIN.id, bespoke]);
    const ledger = (await legacy.data.query("SELECT * FROM schema_migrations ORDER BY version")).rows;
    assert.equal(ledger.length, 12); assert.ok(ledger.every((row) => /^[a-f0-9]{64}$/.test(row.checksum_sha256)));
    const tables = ["product_enquiries", "bespoke_requests", "appointment_requests", "product_variants", "audit_events"] as const;
    const before = new Map<string, unknown[]>();
    for (const table of tables) before.set(table, (await legacy.data.query(`SELECT to_jsonb(t) AS original FROM ${table} t ORDER BY id`)).rows);
    assert.deepEqual(await runMigrations(legacy.ownerUrl), ["0013_quotation_requests_specifications.sql"]);
    assert.deepEqual((await legacy.data.query("SELECT * FROM schema_migrations WHERE version<='0012' ORDER BY version")).rows, ledger, "All twelve established ledger rows and checksums stay byte-for-byte equivalent.");
    for (const table of tables) {
      const additions = table === "product_variants" ? ["metal_weight_grams", "metal_weight_basis"] : table === "audit_events" ? [] : ["variant_id", "product_context", ...(table === "appointment_requests" ? ["consultation_channel"] : [])];
      assert.deepEqual((await legacy.data.query(`SELECT to_jsonb(t)-$1::TEXT[] AS original FROM ${table} t ORDER BY id`, [additions])).rows, before.get(table), `Existing ${table} values and relationships must not be rewritten.`);
    }
    for (const table of ["product_enquiries", "bespoke_requests", "appointment_requests"]) {
      assert.equal((await legacy.data.query(`SELECT bool_and(variant_id IS NULL AND product_context IS NULL${table === "appointment_requests" ? " AND consultation_channel IS NULL" : ""}) AS preserved FROM ${table}`)).rows[0].preserved, true);
    }
    const confirmed = (await legacy.data.query("SELECT status,consultation_channel,bespoke_request_id,confirmed_start_at::TEXT FROM appointment_requests WHERE id=$1", [appointment])).rows[0];
    assert.equal(confirmed.status, "CONFIRMED"); assert.equal(confirmed.consultation_channel, null); assert.equal(confirmed.bespoke_request_id, bespoke); assert.ok(confirmed.confirmed_start_at);
    assert.equal((await legacy.data.query("SELECT bool_and(metal_weight_grams IS NULL AND metal_weight_basis IS NULL) AS unknown FROM product_variants")).rows[0].unknown, true);
    const constraints = ["product_variants_metal_weight", ...["product_enquiries", "bespoke_requests", "appointment_requests"].flatMap((table) => [table + "_variant_product", table + "_variant_fk", table + "_context"]), "appointment_requests_channel_destination", "appointment_requests_consultation_channel_check"];
    const installed = (await legacy.data.query("SELECT conname,convalidated FROM pg_constraint WHERE conname=ANY($1::TEXT[])", [constraints])).rows;
    assert.equal(installed.length, constraints.length); assert.ok(installed.every((row) => row.convalidated));
    const indexes = (await legacy.data.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND indexname=ANY($1::TEXT[])", [["product_enquiries_variant_idx", "bespoke_requests_variant_idx", "appointment_requests_variant_idx"]])).rows;
    assert.equal(indexes.length, 3); assert.ok(indexes.every((row) => /WHERE \(variant_id IS NOT NULL\)/.test(row.indexdef)));
    assert.deepEqual(await runMigrations(legacy.ownerUrl), [], "Verified replay must not change the upgraded database.");
  } finally { await legacy.close(); }
});

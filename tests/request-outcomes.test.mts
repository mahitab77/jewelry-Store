import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { AdminRuntime } from "../src/lib/admin/runtime.ts";
import { requestsHttp } from "../src/lib/requests/http.ts";
import { RequestError } from "../src/lib/requests/validation.ts";

const origin = "https://local-request-outcomes.test";
const value = () => ({ submissionId: randomUUID(), kind: "BESPOKE", name: "Local outcome fixture", email: "local-outcome@boutique.test", message: "Local failure-boundary fixture only." });
type Row = Record<string, unknown>;
function fixture(intercept: (sql: string, values?: unknown[]) => Row[] | undefined = () => undefined) {
  const statements: string[] = [];
  const runtime = { config: { baseURL: origin, secret: "local-outcome-fixture-only" }, pool: { async connect() {
    return { async query(sql: string, values?: unknown[]) {
      statements.push(sql);
      const rows = intercept(sql, values) ?? (sql.startsWith("INSERT INTO cart_rate_limits") ? [{ allowed: true }] : []);
      return { rows, rowCount: rows.length };
    }, release() {} };
  } } } as unknown as AdminRuntime;
  async function send(input: unknown) {
    const response = await requestsHttp(new Request(origin + "/api/requests", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(input) }), runtime);
    return { response, body: await response.json() };
  }
  return { statements, send };
}

test("NOT_CREATED requires UUID lock, cross-table absence, validation before writes and a successful rollback", async () => {
  const f = fixture(), input = { ...value(), message: "" }, { response, body } = await f.send(input);
  assert.equal(response.status, 400); assert.equal(body.outcome, "NOT_CREATED"); assert.equal(body.submissionId, input.submissionId); assert.ok(body.fieldErrors.message);
  const lock = f.statements.findIndex((sql) => sql.includes("pg_advisory_xact_lock")), absence = f.statements.findIndex((sql) => sql.startsWith("SELECT * FROM ("));
  assert.ok(lock >= 0 && absence > lock);
  for (const table of ["product_enquiries", "bespoke_requests", "appointment_requests"]) assert.ok(f.statements[absence].includes(table));
  assert.equal(f.statements.at(-1), "ROLLBACK");
  assert.equal(f.statements.filter((sql) => sql.startsWith("INSERT INTO cart_rate_limits")).length, 1, "Invalid fields still consume the global limit before proving absence.");
  assert.ok(!f.statements.some((sql) => /^INSERT INTO (?:product_enquiries|bespoke_requests|appointment_requests|audit_events)\b/.test(sql)));
});

test("invalid-field submissions cannot bypass the global limit to open absence transactions", async () => {
  let globalCount = 0;
  const f = fixture((sql, values) => {
    if (!sql.startsWith("INSERT INTO cart_rate_limits")) return undefined;
    assert.equal(values?.[1], 120, "Invalid inputs consume the global counter without charging unnormalized contact fields.");
    return [{ allowed: ++globalCount <= 120 }];
  });
  for (let i = 0; i < 120; i++) {
    const rejected = await f.send({ ...value(), message: "" });
    assert.equal(rejected.response.status, 400); assert.equal(rejected.body.outcome, "NOT_CREATED");
  }
  const limited = await f.send({ ...value(), message: "" });
  assert.equal(limited.response.status, 429); assert.equal(limited.body.outcome, "UNKNOWN"); assert.equal(limited.body.submissionId, undefined);
  assert.equal(globalCount, 121); assert.equal(f.statements.filter((sql) => sql === "BEGIN").length, 120, "The rate-limited attempt must not open another proof transaction.");
  assert.ok(!f.statements.some((sql) => /^INSERT INTO (?:product_enquiries|bespoke_requests|appointment_requests|audit_events)\b/.test(sql)));
});

test("a normalized submission consumes one global allowance and the existing contact allowance", async () => {
  const limits: unknown[] = [];
  const f = fixture((sql, values) => { if (sql.startsWith("INSERT INTO cart_rate_limits")) limits.push(values?.[1]); return undefined; });
  const { response } = await f.send(value());
  assert.equal(response.status, 200); assert.deepEqual(limits, [120, 5]);
});

test("an existing key with invalid changed data is CONFLICT even before field validation can succeed", async () => {
  const f = fixture((sql) => sql.startsWith("SELECT * FROM (") ? [{ kind: "QUOTATION" }] : undefined), { response, body } = await f.send({ ...value(), message: "" });
  assert.equal(response.status, 409); assert.equal(body.outcome, "CONFLICT"); assert.equal(body.submissionId, undefined);
});

test("a malformed UUID or throttled submission provides no absence proof", async () => {
  const malformed = fixture(), invalid = await malformed.send({ ...value(), submissionId: "invalid" });
  assert.equal(invalid.response.status, 400); assert.equal(invalid.body.outcome, "UNKNOWN"); assert.equal(invalid.body.submissionId, undefined); assert.deepEqual(malformed.statements, []);
  const throttled = fixture((sql) => sql.startsWith("INSERT INTO cart_rate_limits") ? [{ allowed: false }] : undefined), limited = await throttled.send(value());
  assert.equal(limited.response.status, 429); assert.equal(limited.body.outcome, "UNKNOWN"); assert.ok(!throttled.statements.some((sql) => sql.includes("pg_advisory_xact_lock")));
});

test("failed lock or absence reads and failed rollback remain UNKNOWN", async () => {
  for (const phase of ["pg_advisory_xact_lock", "SELECT * FROM (", "ROLLBACK"]) {
    const f = fixture((sql) => { if (sql.includes(phase)) throw new Error("Simulated local transport failure"); return undefined; });
    const { response, body } = await f.send({ ...value(), message: "" });
    assert.equal(response.status, 503, phase); assert.equal(body.outcome, "UNKNOWN", phase); assert.equal(body.submissionId, undefined, phase);
  }
});

test("business-write and COMMIT failures cannot turn an ambiguous 400 into NOT_CREATED", async () => {
  for (const phase of ["INSERT INTO bespoke_requests", "COMMIT"]) {
    const f = fixture((sql) => { if (sql.startsWith(phase)) throw new RequestError("Simulated local database failure", 400); return undefined; });
    const { response, body } = await f.send(value());
    assert.equal(response.status, 400, phase); assert.equal(body.outcome, "UNKNOWN", phase); assert.equal(body.submissionId, undefined, phase);
  }
});

test("a lost COMMIT response returns UNKNOWN and keeps the success receipt shape unchanged", async () => {
  const broken = fixture((sql) => { if (sql === "COMMIT") throw new Error("Simulated lost COMMIT response"); return undefined; }), unknown = await broken.send(value());
  assert.equal(unknown.response.status, 503); assert.equal(unknown.body.outcome, "UNKNOWN"); assert.equal(unknown.body.submissionId, undefined);
  const input = value(), good = await fixture().send(input);
  assert.equal(good.response.status, 200); assert.deepEqual(Object.keys(good.body).sort(), ["message", "reference"]); assert.equal(good.body.reference, input.submissionId);
});

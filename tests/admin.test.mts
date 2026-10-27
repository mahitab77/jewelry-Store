import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { verifyPassword } from "better-auth/crypto";
import { adminFixture, sessionCookie } from "./helpers/admin-fixture.mts";
import { handleAdminAuth } from "../src/lib/admin/http.ts";
import { getCurrentAdmin, requireAdmin, requirePermission, AdminAccessError } from "../src/lib/admin/authorization.ts";
import { adminConfiguration, AdminConfigurationError } from "../src/lib/admin/config.ts";
import { provisionAdmin, AdminProvisioningError } from "../db/tools/provision-admin.ts";
import { createLoginThrottle } from "../src/lib/admin/rate-limit.ts";
import type { AdminRole } from "../src/lib/admin/policy.ts";

let fixture: Awaited<ReturnType<typeof adminFixture>>;
const legacyId = randomUUID();
const auditId = randomUUID();
before(async () => {
  fixture = await adminFixture(undefined, async (pool) => {
    await pool.query("INSERT INTO admin_users(id, display_name, role) VALUES ($1, 'Legacy fixture', 'MANAGER')", [legacyId]);
    await pool.query("INSERT INTO audit_events(id, actor_kind, actor_admin_id, action, target_table, target_id) VALUES ($1, 'ADMIN', $2, 'LEGACY_FIXTURE', 'admin_users', $2)", [auditId, legacyId]);
  });
}, { timeout: 60000 });
beforeEach(async () => { await fixture.data.query("DELETE FROM admin_auth_rate_limits"); });
after(async () => { if (fixture) await fixture.close(); });

function request(path: string, body: unknown = {}, cookie = "", origin: string | null = fixture.authConfig.baseURL) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin !== null) headers.set("Origin", origin);
  if (cookie) headers.set("Cookie", cookie);
  return new Request(fixture.authConfig.baseURL + path, { method: "POST", headers, body: JSON.stringify(body) });
}
async function login(role: AdminRole = "OWNER", password = fixture.password) {
  return handleAdminAuth(request("/api/admin-auth/sign-in/email", { email: fixture.users[role].email, password }), fixture.runtime);
}
async function signedIn(role: AdminRole = "OWNER") {
  const response = await login(role);
  assert.equal(response.status, 200, "A provisioned enabled administrator should sign in.");
  const cookie = sessionCookie(response);
  assert.ok(cookie, "The library should set a session cookie.");
  return new Headers({ Cookie: cookie });
}

test("migration preserves legacy identities and audit records; all applied checksums are recorded", async () => {
  const row = (await fixture.data.query("SELECT display_name, role, is_active, auth_provider, email FROM admin_users WHERE id=$1", [legacyId])).rows[0];
  assert.deepEqual(row, { display_name: "Legacy fixture", role: "MANAGER", is_active: false, auth_provider: null, email: null });
  assert.equal((await fixture.data.query("SELECT id FROM audit_events WHERE id=$1", [auditId])).rowCount, 1);
  await assert.rejects(fixture.data.query("DELETE FROM admin_users WHERE id=$1", [legacyId]), { code: "23503" });
  const ledger = (await fixture.data.query("SELECT checksum_sha256 FROM schema_migrations")).rows;
  assert.equal(ledger.length, 10); assert.ok(ledger.every((row) => /^[a-f0-9]{64}$/.test(row.checksum_sha256)));
});

test("enabled admin login creates a fresh eight-hour database session and secure library cookie", async () => {
  const response = await login();
  assert.equal(response.status, 200);
  const payload = await response.text();
  assert.ok(payload === '{"ok":true}', "Public response must contain no token, hash, identity or secret.");
  const cookie = response.headers.getSetCookie().find((value) => value.includes(".session_token=")) ?? "";
  assert.ok(/HttpOnly/i.test(cookie) && /Secure/i.test(cookie) && /SameSite=Strict/i.test(cookie));
  const rows = (await fixture.data.query("SELECT token, expires_at, created_at, ip_address, user_agent FROM admin_auth_sessions WHERE user_id=$1 ORDER BY created_at DESC", [fixture.users.OWNER.id])).rows;
  assert.ok(rows[0].token.length >= 32 && !payload.includes(rows[0].token));
  assert.ok(Math.abs((rows[0].expires_at - rows[0].created_at) / 1000 - 28800) < 3);
  assert.equal(rows[0].ip_address, null); assert.equal(rows[0].user_agent, null);
  assert.equal((await getCurrentAdmin(new Headers({ Cookie: sessionCookie(response) }), fixture.runtime))?.role, "OWNER");
});

test("passwords use library scrypt hashes and verification without plaintext storage", async () => {
  const rows = (await fixture.data.query("SELECT password FROM admin_auth_accounts WHERE user_id=$1", [fixture.users.OWNER.id])).rows;
  const hash = rows[0].password;
  assert.ok(hash !== fixture.password && !hash.includes(fixture.password));
  assert.ok(await verifyPassword({ hash, password: fixture.password }));
  assert.ok(!await verifyPassword({ hash, password: "an incorrect fixture password" }));
});

test("wrong passwords, unknown identities and disabled accounts produce the same generic failure", async () => {
  const wrong = await login("OWNER", "incorrect fixture password");
  const unknown = await handleAdminAuth(request("/api/admin-auth/sign-in/email", { email: "missing@boutique.test", password: fixture.password }), fixture.runtime);
  await fixture.data.query("UPDATE admin_users SET is_active=false WHERE id=$1", [fixture.users.ADMIN.id]);
  try {
    const disabled = await login("ADMIN");
    assert.equal(wrong.status, 401); assert.equal(unknown.status, 401); assert.equal(disabled.status, 401);
    assert.equal(await wrong.text(), await unknown.text());
    assert.ok(!disabled.headers.has("set-cookie"));
    assert.ok((await disabled.text()).includes("Sign-in was unsuccessful"));
    assert.equal((await fixture.data.query("SELECT id FROM admin_auth_sessions WHERE user_id=$1", [fixture.users.ADMIN.id])).rowCount, 0);
  } finally { await fixture.data.query("UPDATE admin_users SET is_active=true WHERE id=$1", [fixture.users.ADMIN.id]); }
});

test("invalid input, missing passwords and oversized bodies fail before creating sessions", async () => {
  for (const body of [{ email: "invalid", password: fixture.password }, { email: fixture.users.OWNER.email }, { email: fixture.users.OWNER.email, password: "" }, { email: fixture.users.OWNER.email, password: "x".repeat(5000) }, []]) {
    const response = await handleAdminAuth(request("/api/admin-auth/sign-in/email", body), fixture.runtime);
    assert.equal(response.status, 400); assert.ok(!response.headers.has("set-cookie"));
  }
});

test("logout deletes the database session, clears cookies, and rejects replay", async () => {
  const headers = await signedIn();
  const cookie = headers.get("cookie")!;
  const response = await handleAdminAuth(request("/admin/logout", {}, cookie), fixture.runtime, "logout");
  assert.equal(response.status, 200);
  assert.ok(response.headers.getSetCookie().some((value) => value.includes(".session_token=") && /Max-Age=0/i.test(value)));
  assert.equal(await getCurrentAdmin(headers, fixture.runtime), null);
  await assert.rejects(requireAdmin(headers, fixture.runtime), AdminAccessError);
});

test("expired sessions, direct revocation, absent cookies and tampered cookies fail closed", async () => {
  assert.equal(await getCurrentAdmin(new Headers(), fixture.runtime), null);
  const headers = await signedIn();
  const cookie = headers.get("cookie")!;
  assert.equal(await getCurrentAdmin(new Headers({ Cookie: cookie.slice(0, -3) + "bad" }), fixture.runtime), null);
  await fixture.data.query("UPDATE admin_auth_sessions SET expires_at = now() - INTERVAL '1 second' WHERE user_id=$1", [fixture.users.OWNER.id]);
  assert.equal(await getCurrentAdmin(headers, fixture.runtime), null);
  const revoked = await signedIn();
  await fixture.data.query("DELETE FROM admin_auth_sessions WHERE user_id=$1", [fixture.users.OWNER.id]);
  assert.equal(await getCurrentAdmin(revoked, fixture.runtime), null);
});

test("disabling a previously signed-in user denies their existing session immediately", async () => {
  const headers = await signedIn("ADMIN");
  await fixture.data.query("UPDATE admin_users SET is_active=false WHERE id=$1", [fixture.users.ADMIN.id]);
  try { assert.equal(await getCurrentAdmin(headers, fixture.runtime), null); }
  finally { await fixture.data.query("UPDATE admin_users SET is_active=true WHERE id=$1", [fixture.users.ADMIN.id]); }
});

test("server permissions distinguish owner, administrator and catalogue manager", async () => {
  const owner = await signedIn("OWNER");
  const admin = await signedIn("ADMIN");
  const catalogue = await signedIn("CATALOGUE_MANAGER");
  assert.equal((await requirePermission("administrators:manage", owner, fixture.runtime)).role, "OWNER");
  assert.equal((await requirePermission("operations:manage", admin, fixture.runtime)).role, "ADMIN");
  assert.equal((await requirePermission("catalogue:manage", catalogue, fixture.runtime)).role, "CATALOGUE_MANAGER");
  await assert.rejects(requirePermission("administrators:manage", admin, fixture.runtime), { status: 403 });
  await assert.rejects(requirePermission("operations:manage", catalogue, fixture.runtime), { status: 403 });
  await fixture.data.query("UPDATE admin_users SET role='CATALOGUE_MANAGER' WHERE id=$1", [fixture.users.ADMIN.id]);
  try { await assert.rejects(requirePermission("operations:manage", admin, fixture.runtime), { status: 403 }); }
  finally { await fixture.data.query("UPDATE admin_users SET role='ADMIN' WHERE id=$1", [fixture.users.ADMIN.id]); }
});

test("client role claims and every unimplemented authentication endpoint are rejected", async () => {
  for (const field of ["role", "is_active", "userId", "callbackURL", "auth_provider"]) {
    const response = await handleAdminAuth(request("/api/admin-auth/sign-in/email", { email: fixture.users.CATALOGUE_MANAGER.email, password: fixture.password, [field]: "OWNER" }), fixture.runtime);
    assert.equal(response.status, 400);
  }
  for (const path of ["/sign-up/email", "/update-user", "/change-password", "/request-password-reset", "/delete-user", "/admin/set-role", "/get-session", "/list-sessions"]) {
    assert.equal((await handleAdminAuth(request("/api/admin-auth" + path), fixture.runtime)).status, 404);
  }
  assert.equal((await fixture.data.query("SELECT role FROM admin_users WHERE id=$1", [fixture.users.CATALOGUE_MANAGER.id])).rows[0].role, "CATALOGUE_MANAGER");
});

test("origin and CSRF checks protect login and logout, including first login and missing Origin", async () => {
  for (const origin of [null, "null", "https://hostile.example.test"]) {
    const response = await handleAdminAuth(request("/api/admin-auth/sign-in/email", { email: fixture.users.OWNER.email, password: fixture.password }, "", origin), fixture.runtime);
    assert.equal(response.status, 403);
  }
  const crossSite = request("/api/admin-auth/sign-in/email", { email: fixture.users.OWNER.email, password: fixture.password });
  crossSite.headers.set("Sec-Fetch-Site", "cross-site");
  assert.equal((await handleAdminAuth(crossSite, fixture.runtime)).status, 403);
  // Verify Better Auth's protections remain enabled independently of our stricter transport.
  const library = await fixture.runtime.auth.handler(request("/api/admin-auth/sign-in/email", { email: fixture.users.OWNER.email, password: fixture.password }, "", "https://hostile.example.test"));
  assert.equal(library.status, 403);
  const headers = await signedIn();
  assert.equal((await handleAdminAuth(request("/api/admin-auth/sign-out", {}, headers.get("cookie")!, "https://hostile.example.test"), fixture.runtime)).status, 403);
  assert.ok(await getCurrentAdmin(headers, fixture.runtime));
});

test("concurrent successful sign-ins produce independent fresh database sessions", async () => {
  const responses = await Promise.all(Array.from({ length: 3 }, () => login("CATALOGUE_MANAGER")));
  assert.ok(responses.every((response) => response.status === 200));
  const cookies = responses.map(sessionCookie);
  assert.equal(new Set(cookies).size, 3);
  for (const cookie of cookies) assert.ok(await getCurrentAdmin(new Headers({ Cookie: cookie }), fixture.runtime));
});

test("signing in as another administrator cannot fixate or promote the incoming session", async () => {
  const existing = await signedIn("CATALOGUE_MANAGER");
  const oldCookie = existing.get("cookie")!;
  const response = await handleAdminAuth(request("/api/admin-auth/sign-in/email", { email: fixture.users.OWNER.email, password: fixture.password }, oldCookie), fixture.runtime);
  assert.equal(response.status, 200);
  const freshCookie = sessionCookie(response);
  assert.ok(freshCookie && freshCookie !== oldCookie, "Sign-in must create a new session identifier.");
  assert.equal((await getCurrentAdmin(new Headers({ Cookie: freshCookie }), fixture.runtime))?.role, "OWNER");
  assert.equal((await getCurrentAdmin(existing, fixture.runtime))?.role, "CATALOGUE_MANAGER");
  await assert.rejects(requirePermission("administrators:manage", existing, fixture.runtime), { status: 403 });
});

test("concurrent duplicate provisioning creates exactly one identity and credential", async () => {
  const email = `duplicate-${randomUUID()}@boutique.test`;
  const input = { email, displayName: "Concurrent fixture", password: fixture.password, role: "ADMIN" as const };
  const results = await Promise.allSettled([provisionAdmin(fixture.data, input), provisionAdmin(fixture.data, input)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason instanceof AdminProvisioningError).length, 1);
  assert.equal((await fixture.data.query("SELECT a.id FROM admin_users u JOIN admin_auth_accounts a ON a.user_id=u.id WHERE u.email=$1", [email])).rowCount, 1);
});

test("provisioning CLI requires explicit arguments and never prints its protected password", async () => {
  async function run(args: string[]) {
    return new Promise<{ code: number | null; output: string }>((done, reject) => {
      const child = spawn(process.execPath, ["--experimental-strip-types", "--conditions=react-server", resolve("scripts/provision-admin.mts"), ...args], {
        windowsHide: true, env: { ...process.env, ADMIN_DATABASE_URL: fixture.ownerUrl, ADMIN_PROVISION_PASSWORD: fixture.password }, stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { output += chunk; });
      child.on("error", () => reject(new Error("Disposable provisioning CLI could not start.")));
      child.on("close", (code) => done({ code, output }));
    });
  }
  const missing = await run([]);
  assert.equal(missing.code, 1); assert.ok(!missing.output.includes(fixture.password));
  const email = `cli-${randomUUID()}@boutique.test`;
  const created = await run(["--email", email, "--name", "CLI fixture", "--role", "CATALOGUE_MANAGER", "--confirm-admin-create"]);
  assert.equal(created.code, 0); assert.ok(!created.output.includes(fixture.password));
  assert.equal((await fixture.data.query("SELECT id FROM admin_users WHERE email=$1", [email])).rowCount, 1);
  const attemptedPasswordArgument = await run(["--password", "not-an-accepted-argument"]);
  assert.equal(attemptedPasswordArgument.code, 1);
});

test("fixed-window throttling is atomic across separate runtimes and has bounded expiry", async () => {
  const peer = fixture.peer();
  const consume = createLoginThrottle(fixture.runtime.pool, fixture.authConfig.secret);
  const consumePeer = createLoginThrottle(peer.pool, fixture.authConfig.secret);
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? consumePeer : consume)("concurrent-fixture", { window: 900, max: 5 })));
  assert.equal(results.filter((result) => result.allowed).length, 5);
  assert.ok(results.filter((result) => !result.allowed).every((result) => result.retryAfter! > 0 && result.retryAfter! <= 900));
  const before = (await fixture.data.query("SELECT expires_at FROM admin_auth_rate_limits")).rows[0].expires_at.getTime();
  await consume("concurrent-fixture", { window: 900, max: 5 });
  assert.equal((await fixture.data.query("SELECT expires_at FROM admin_auth_rate_limits")).rows[0].expires_at.getTime(), before);
  await fixture.data.query("UPDATE admin_auth_rate_limits SET expires_at=now()-INTERVAL '1 second'");
  assert.ok((await consume("concurrent-fixture", { window: 900, max: 5 })).allowed);
});

function childAttempts(email: string): Promise<number[]> {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--conditions=react-server", resolve("tests/helpers/admin-attempt.mts")], {
      windowsHide: true, env: { ...process.env, ADMIN_DATABASE_URL: fixture.authConfig.databaseUrl, BETTER_AUTH_URL: fixture.authConfig.baseURL, BETTER_AUTH_SECRET: fixture.authConfig.secret },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.resume();
    child.on("error", () => reject(new Error("Disposable auth worker could not start.")));
    child.on("close", (code) => {
      if (code !== 0) reject(new Error("Disposable auth worker failed."));
      else { try { done(JSON.parse(output)); } catch { reject(new Error("Invalid auth worker result.")); } }
    });
    child.stdin.end(JSON.stringify({ email, password: "an incorrect fixture password" }));
  });
}

test("account brute-force protection is shared by independent OS processes", { timeout: 60000 }, async () => {
  const statuses = (await Promise.all([childAttempts(fixture.users.OWNER.email), childAttempts(fixture.users.OWNER.email)])).flat();
  assert.equal(statuses.filter((status) => status === 401).length, 5);
  assert.equal(statuses.filter((status) => status === 429).length, 3);
});

test("spoofed source headers cannot bypass the default shared-source limit", async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 31; i++) {
    const attempt = request("/api/admin-auth/sign-in/email", { email: `unknown-${i}@boutique.test`, password: "an incorrect fixture password" });
    attempt.headers.set("x-forwarded-for", `198.51.100.${i}`);
    attempt.headers.set("x-lapalme-client-ip", `198.51.100.${i}`);
    statuses.push((await handleAdminAuth(attempt, fixture.runtime)).status);
  }
  assert.equal(statuses.filter((status) => status === 401).length, 30);
  assert.equal(statuses[30], 429);
});

test("provisioning is deliberate, duplicate-safe, strength checked and preserves a linked legacy ID", async () => {
  const input = { email: fixture.users.OWNER.email, displayName: "Duplicate fixture", password: fixture.password, role: "OWNER" as const };
  await assert.rejects(provisionAdmin(fixture.data, input), AdminProvisioningError);
  for (const password of ["short", "a".repeat(20), "password123456789012345"]) await assert.rejects(provisionAdmin(fixture.data, { ...input, email: "weak@boutique.test", password }), AdminProvisioningError);
  assert.equal(await provisionAdmin(fixture.data, { ...input, email: "legacy@boutique.test", existingAdminId: legacyId, role: "CATALOGUE_MANAGER" }), legacyId);
  assert.equal((await fixture.data.query("SELECT id FROM audit_events WHERE id=$1", [auditId])).rowCount, 1);
  await assert.rejects(fixture.runtime.pool.query("INSERT INTO admin_users(display_name, role) VALUES ('Forbidden fixture', 'OWNER')"), { code: "42501" });
});

test("security audit events are append-only to the runtime and exclude sensitive values", async () => {
  await signedIn();
  const events = (await fixture.data.query("SELECT action, metadata FROM audit_events WHERE action <> 'LEGACY_FIXTURE'")).rows;
  for (const action of ["ADMIN_PROVISIONED", "ADMIN_LOGIN_SUCCEEDED", "ADMIN_LOGIN_FAILED", "ADMIN_LOGOUT", "ADMIN_ACCESS_DENIED", "ADMIN_LOGIN_THROTTLED", "ADMIN_ORIGIN_REJECTED"]) assert.ok(events.some((row) => row.action === action), action);
  const metadata = JSON.stringify(events);
  const tokens = (await fixture.data.query("SELECT token FROM admin_auth_sessions")).rows;
  assert.ok(!metadata.includes(fixture.password) && !metadata.includes(fixture.users.OWNER.email) && !tokens.some((row) => metadata.includes(row.token)));
  assert.ok(events.every((event) => Object.keys(event.metadata).every((key) => ["role", "linkedExisting"].includes(key))));
  await assert.rejects(fixture.runtime.pool.query("UPDATE audit_events SET action='FORBIDDEN'"), { code: "42501" });
  await assert.rejects(fixture.runtime.pool.query("DELETE FROM audit_events"), { code: "42501" });
  await assert.rejects(fixture.runtime.pool.query("SELECT * FROM orders"), { code: "42501" });
});

test("login fails closed if its audit event cannot be persisted", async () => {
  await fixture.data.query(`REVOKE INSERT ON audit_events FROM "${fixture.role}"`);
  const count = (await fixture.data.query("SELECT count(*) FROM admin_auth_sessions")).rows[0].count;
  try {
    const response = await login();
    assert.equal(response.status, 503); assert.ok(!response.headers.has("set-cookie"));
    assert.equal((await fixture.data.query("SELECT count(*) FROM admin_auth_sessions")).rows[0].count, count);
  } finally { await fixture.data.query(`GRANT INSERT ON audit_events TO "${fixture.role}"`); }
});

test("logout never claims success if database revocation fails", async () => {
  const headers = await signedIn();
  await fixture.data.query(`REVOKE DELETE ON admin_auth_sessions FROM "${fixture.role}"`);
  try {
    const response = await handleAdminAuth(request("/api/admin-auth/sign-out", {}, headers.get("cookie")!), fixture.runtime);
    assert.equal(response.status, 503); assert.ok(!response.headers.has("set-cookie"));
    assert.ok(await getCurrentAdmin(headers, fixture.runtime));
  } finally { await fixture.data.query(`GRANT DELETE ON admin_auth_sessions TO "${fixture.role}"`); }
});

test("configuration rejects missing secrets, placeholders, unsafe origins and production HTTP", () => {
  const valid = { ADMIN_DATABASE_URL: fixture.authConfig.databaseUrl, BETTER_AUTH_URL: fixture.authConfig.baseURL, BETTER_AUTH_SECRET: randomBytes(32).toString("base64url"), NODE_ENV: "production" as const };
  assert.equal(adminConfiguration(valid).baseURL, fixture.authConfig.baseURL);
  for (const settings of [{ BETTER_AUTH_SECRET: "" }, { BETTER_AUTH_SECRET: "YOUR_RANDOM_SECRET" }, { BETTER_AUTH_URL: "http://127.0.0.1:3109" }, { BETTER_AUTH_URL: "https://example.test/path" }, { ADMIN_DATABASE_URL: "" }, { ADMIN_TRUSTED_IP_HEADER: "x-forwarded-for" }]) {
    assert.throws(() => adminConfiguration({ ...valid, ...settings }), AdminConfigurationError);
  }
});

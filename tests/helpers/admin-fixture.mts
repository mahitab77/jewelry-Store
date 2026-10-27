import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import pg from "pg";
import { databaseConfig, isLoopback } from "../../src/lib/db/config.ts";
import { runMigrations } from "../../db/tools/migrate.ts";
import { createAdminRuntime } from "../../src/lib/admin/runtime.ts";
import { provisionAdmin } from "../../db/tools/provision-admin.ts";
import type { AdminRole } from "../../src/lib/admin/policy.ts";

export async function adminFixture(baseURL = "https://admin.example.test", beforeAuthenticationMigration?: (pool: pg.Pool) => Promise<void>) {
  const config = databaseConfig(process.env.TEST_DATABASE_URL);
  assert.ok(process.env.TEST_DATABASE_URL && isLoopback(config.host ?? "") && process.env.NODE_ENV !== "production", "Use an explicit disposable loopback test cluster.");
  const token = randomUUID().replaceAll("-", "");
  const database = `lapalme_test_admin_${token}`;
  const role = `lapalme_auth_${token}`;
  const maintenance = new pg.Pool({ ...config, max: 1 });
  let data: pg.Pool | undefined;
  let created = false;
  let roleCreated = false;
  const runtimes: ReturnType<typeof createAdminRuntime>[] = [];
  async function close() {
    for (const runtime of runtimes) await runtime.pool.end();
    if (data) await data.end();
    try {
      assert.match(database, /^lapalme_test_admin_[a-f0-9]+$/);
      assert.match(role, /^lapalme_auth_[a-f0-9]+$/);
      if (created) await maintenance.query(`DROP DATABASE "${database}"`);
      if (roleCreated) await maintenance.query(`DROP ROLE "${role}"`);
    } finally { await maintenance.end(); }
  }
  try {
    await maintenance.query(`CREATE DATABASE "${database}"`); created = true;
    const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${database}`;
    const ownerUrl = url.toString();
    data = new pg.Pool(databaseConfig(ownerUrl));
    if (beforeAuthenticationMigration) {
      const directory = await mkdtemp(join(tmpdir(), "la-palme-phase05-migrations-"));
      try {
        await mkdir(directory, { recursive: true });
        for (const filename of (await readdir("db/migrations")).filter((name) => /^000[1-6]_/.test(name))) {
          await copyFile(join("db/migrations", filename), join(directory, filename));
        }
        await runMigrations(ownerUrl, { directory });
        await beforeAuthenticationMigration(data);
      } finally {
        assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep) && directory.includes("la-palme-phase05-migrations-"));
        await rm(directory, { recursive: true, force: true });
      }
    }
    await runMigrations(ownerUrl);
    await maintenance.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`); roleCreated = true;
    await data.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await data.query(`GRANT SELECT ON admin_users, admin_auth_accounts, admin_auth_sessions, admin_auth_verifications TO "${role}"`);
    await data.query(`GRANT INSERT, DELETE ON admin_auth_sessions TO "${role}"`);
    await data.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON admin_auth_rate_limits TO "${role}"`);
    await data.query(`GRANT INSERT ON audit_events TO "${role}"`);
    url.username = role; url.password = "";
    const authConfig = { databaseUrl: url.toString(), baseURL, secret: randomBytes(32).toString("base64url") };
    const runtime = createAdminRuntime(authConfig); runtimes.push(runtime);
    const password = randomBytes(24).toString("base64url") + "aB3!";
    const users = {} as Record<AdminRole, { id: string; email: string }>;
    for (const adminRole of ["OWNER", "ADMIN", "CATALOGUE_MANAGER"] as const) {
      const email = `${adminRole.toLowerCase()}-${token}@boutique.test`;
      const id = await provisionAdmin(data, { email, displayName: `Fixture ${adminRole}`, role: adminRole, password });
      users[adminRole] = { id, email };
    }
    return { data, runtime, users, password, authConfig, ownerUrl, role, close,
      peer() { const peer = createAdminRuntime(authConfig); runtimes.push(peer); return peer; } };
  } catch (error) { await close(); throw error; }
}

export function sessionCookie(response: Response): string {
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).filter((cookie) => cookie.includes(".session_token=")).join("; ");
}

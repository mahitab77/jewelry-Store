import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createCustomerRuntime } from "../../src/lib/customer/runtime.ts";
import { customerAuthHttp } from "../../src/lib/customer/http.ts";
import { sessionCookie } from "./admin-fixture.mts";
import type pg from "pg";

export async function attachCustomerFixture(f: { data: pg.Pool; ownerUrl: string; authConfig: { baseURL: string }; close: () => Promise<void> }) {
  assert.equal((await f.data.query("SHOW server_version_num")).rows[0].server_version_num, "180006", "Customer fixtures require disposable PostgreSQL 18.6.");
  const customerRole = `lapalme_customer_${randomUUID().replaceAll("-", "")}`;
  await f.data.query(`CREATE ROLE "${customerRole}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
  const artifact = (await import("node:fs/promises")).readFile;
  const grants = (await artifact("infra/neon/customer-runtime-grants.review.sql", "utf8")).replaceAll("lapalme_customer_runtime", `"${customerRole}"`).replace("ROLLBACK;", "COMMIT;");
  await f.data.query(grants);
  const url = new URL(f.ownerUrl); url.username = customerRole; url.password = "";
  const customerConfig = { databaseUrl: url.toString(), baseURL: f.authConfig.baseURL, secret: randomBytes(32).toString("base64url") };
  const emails: { email: string; otp: string }[] = [];
  const delivery = { fails: false };
  const customerRuntime = createCustomerRuntime(customerConfig, async message => { if (delivery.fails) throw Error("Local simulated delivery failure"); emails.push(message); });
  const auth = (operation: string, body: unknown = {}, cookie = "") => customerAuthHttp(new Request(customerConfig.baseURL + "/api/customer-auth/" + operation,
    { method: "POST", headers: { Origin: customerConfig.baseURL, "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) }), customerRuntime);
  async function signIn(email = `customer-${randomUUID()}@boutique.test`, name = "Local customer fixture") {
    assert.equal((await auth("send-code", { email })).status, 200);
    const code = emails.filter(m => m.email === email.toLowerCase()).at(-1)!.otp;
    const response = await auth("verify-code", { email, name, code });
    assert.equal(response.status, 200, "A disposable verified customer should sign in.");
    return { headers: new Headers({ Cookie: sessionCookie(response) }), email };
  }
  try {
    const initial = await signIn();
    return { customerRole, customerConfig, customerRuntime, emails, delivery, customerAuth: auth, customerSignIn: signIn, customerEmail: initial.email, customerHeaders: initial.headers,
      async closeCustomer() { await customerRuntime.pool.end(); await f.data.query(`DROP OWNED BY "${customerRole}"`); await f.data.query(`DROP ROLE "${customerRole}"`); } };
  } catch (error) { await customerRuntime.pool.end(); await f.data.query(`DROP OWNED BY "${customerRole}"`); await f.data.query(`DROP ROLE "${customerRole}"`); throw error; }
}

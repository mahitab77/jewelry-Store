import "server-only";
import type { PoolClient } from "pg";
import { getCustomerRuntime, type CustomerRuntime } from "./runtime.ts";
import { CustomerError } from "./config.ts";
export const customerProvider = "better-auth-customer";
export interface CurrentCustomer { id: string; profileId: string; sessionId: string; name: string; email: string; phone: string; expiresAt: string }
export async function requireCustomer(headers: Headers, runtime: CustomerRuntime = getCustomerRuntime()): Promise<CurrentCustomer> {
  const session = await runtime.auth.api.getSession({ headers, query: { disableCookieCache: true } });
  if (!session) throw new CustomerError("Sign in to continue with your request.", 401);
  const row = (await runtime.pool.query(`SELECT u.id,p.id AS "profileId",p.full_name AS name,u.email,COALESCE(p.phone,'') AS phone
    FROM customer_auth_users u JOIN customer_profiles p ON p.auth_provider=$2 AND p.auth_subject=u.id::TEXT
    WHERE u.id=$1 AND u.email_verified`, [session.user.id, customerProvider])).rows[0];
  if (!row) throw new CustomerError("Sign in again to verify your customer account.", 401);
  return { ...row, sessionId: session.session.id, expiresAt: session.session.expiresAt.toISOString() };
}
export async function lockCustomer(client: PoolClient, customer: CurrentCustomer) {
  if (!(await client.query(`SELECT s.id FROM customer_auth_sessions s JOIN customer_auth_users u ON u.id=s.user_id
    WHERE s.id=$1 AND u.id=$2 AND u.email_verified AND s.expires_at>statement_timestamp() FOR SHARE OF s,u`, [customer.sessionId, customer.id])).rowCount) throw new CustomerError("Sign in again to continue.", 401);
}

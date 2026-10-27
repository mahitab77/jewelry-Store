import "server-only";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { hashPassword } from "better-auth/crypto";
import { isAdminRole, type AdminRole } from "../../src/lib/admin/policy.ts";

export class AdminProvisioningError extends Error {
  constructor(message = "Administrator provisioning failed; no credentials were displayed.") { super(message); this.name = "AdminProvisioningError"; }
}
export interface ProvisionAdminInput { email: string; displayName: string; password: string; role: AdminRole; existingAdminId?: string }

export function validateProvisioning(input: ProvisionAdminInput) {
  const email = input.email.trim().toLowerCase();
  const local = email.split("@")[0];
  if (email.length > 254 || !/^[a-z0-9][a-z0-9._+-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(email) ||
    email.includes("..") || local.endsWith(".") || !isAdminRole(input.role) ||
    input.displayName.trim().length < 1 || input.displayName.trim().length > 120 || /[\x00-\x1f\x7f]/.test(input.displayName) ||
    (input.existingAdminId && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(input.existingAdminId))) {
    throw new AdminProvisioningError("Provide a valid email, display name and explicit supported role.");
  }
  if (input.password.length < 16 || input.password.length > 128 || new Set(input.password).size < 8 ||
    /[\x00-\x1f\x7f]/.test(input.password) || /^(password|administrator|letmein|qwerty|123456)/i.test(input.password) ||
    (local.length >= 4 && input.password.toLowerCase().includes(local))) {
    throw new AdminProvisioningError("Use a unique password of 16–128 characters with sufficient variety, unrelated to the email address.");
  }
  return { email, displayName: input.displayName.trim() };
}

export async function provisionAdmin(pool: Pool, input: ProvisionAdminInput): Promise<string> {
  const { email, displayName } = validateProvisioning(input);
  // Library hashing happens outside the transaction; no database lock during KDF.
  const passwordHash = await hashPassword(input.password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [1279348813, 5]);
    if ((await client.query("SELECT id FROM admin_users WHERE email = $1", [email])).rowCount) {
      throw new AdminProvisioningError("This identity is already provisioned; it was not changed.");
    }
    const id = input.existingAdminId ?? randomUUID();
    if (input.existingAdminId) {
      const result = await client.query(`UPDATE admin_users SET email = $1, display_name = $2, role = $3,
        auth_provider = 'better-auth', auth_subject = id::TEXT, is_active = true, updated_at = now()
        WHERE id = $4 AND auth_provider IS NULL AND auth_subject IS NULL AND email IS NULL RETURNING id`,
      [email, displayName, input.role, id]);
      if (result.rowCount !== 1) throw new AdminProvisioningError("The existing administrator cannot be linked automatically; no identity was replaced.");
    } else {
      await client.query(`INSERT INTO admin_users(id, email, display_name, role, auth_provider, auth_subject, is_active)
        VALUES ($1::UUID, $2, $3, $4, 'better-auth', $1::TEXT, true)`, [id, email, displayName, input.role]);
    }
    await client.query(`INSERT INTO admin_auth_accounts(account_id, provider_id, user_id, password)
      VALUES ($1, 'credential', $2, $3)`, [id, id, passwordHash]);
    await client.query(`INSERT INTO audit_events(actor_kind, action, target_table, target_id, metadata)
      VALUES ('SYSTEM', 'ADMIN_PROVISIONED', 'admin_users', $1, $2::JSONB)`,
    [id, JSON.stringify({ role: input.role, linkedExisting: Boolean(input.existingAdminId) })]);
    await client.query("COMMIT");
    return id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error instanceof AdminProvisioningError ? error : new AdminProvisioningError();
  } finally { client.release(); }
}

import "server-only";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export type AdminAuditAction = "ADMIN_LOGIN_SUCCEEDED" | "ADMIN_LOGIN_FAILED" | "ADMIN_LOGOUT" | "ADMIN_ACCESS_DENIED" | "ADMIN_LOGIN_THROTTLED" | "ADMIN_ORIGIN_REJECTED";

export async function recordAdminAudit(pool: Pool | PoolClient, action: AdminAuditAction, adminId?: string) {
  // Fixed event names only; no submitted identity, IP, password or cookie.
  await pool.query(`INSERT INTO audit_events(actor_kind, actor_admin_id, action, target_table, target_id)
    VALUES ($1, $2, $3, 'admin_users', $4)`,
  [adminId ? "ADMIN" : "SYSTEM", adminId ?? null, action, adminId ?? randomUUID()]);
}

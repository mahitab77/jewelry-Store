import "server-only";
import type { Pool } from "pg";
import { isAdminRole, type AdminRole } from "./policy.ts";

export interface CurrentAdmin { id: string; displayName: string; role: AdminRole }

export async function loadEnabledAdmin(pool: Pool, id: string): Promise<CurrentAdmin | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const result = await pool.query<{ id: string; display_name: string; role: string }>(`
    SELECT id, display_name, role FROM admin_users
    WHERE id = $1 AND is_active = true AND auth_provider = 'better-auth'
      AND auth_subject = id::TEXT AND email IS NOT NULL`, [id]);
  const row = result.rows[0];
  return row && isAdminRole(row.role) ? { id: row.id, displayName: row.display_name, role: row.role } : null;
}

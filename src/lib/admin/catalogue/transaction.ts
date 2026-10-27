import "server-only";
import type { PoolClient } from "pg";
import { requirePermission, AdminAccessError } from "../authorization.ts";
import { getAdminRuntime, type AdminRuntime } from "../runtime.ts";
import { hasPermission, isAdminRole } from "../policy.ts";
import { CatalogueAdminError } from "./validation.ts";

export async function catalogueTransaction<T>(headers: Headers, operation: (client: PoolClient, adminId: string) => Promise<T>, runtime: AdminRuntime = getAdminRuntime()): Promise<T> {
  const admin = await requirePermission("catalogue:manage", headers, runtime);
  const client = await runtime.pool.connect();
  try {
    await client.query("BEGIN");
    const row = (await client.query(`SELECT role FROM admin_users WHERE id=$1 AND is_active
      AND auth_provider='better-auth' AND auth_subject=id::TEXT`, [admin.id])).rows[0];
    if (!row || !isAdminRole(row.role) || !hasPermission(row.role, "catalogue:manage")) throw new AdminAccessError(403);
    const result = await operation(client, admin.id);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof CatalogueAdminError || error instanceof AdminAccessError) throw error;
    const code = (error as { code?: string }).code;
    if (code === "23505") throw new CatalogueAdminError("That slug, SKU or assignment is already in use. Choose a unique value.", 409);
    if (["23503", "23514", "22P02"].includes(code ?? "")) throw new CatalogueAdminError("A referenced record or configuration is no longer valid. Reload and review the fields.", 409);
    throw new CatalogueAdminError("The catalogue could not be saved. No partial changes were committed.", 503);
  } finally { client.release(); }
}

export async function catalogueAudit(client: PoolClient, adminId: string, productId: string, action: string, metadata: Record<string, unknown> = {}) {
  await client.query(`INSERT INTO audit_events(actor_kind,actor_admin_id,action,target_table,target_id,metadata)
    VALUES ('ADMIN',$1,$2,'products',$3,$4::JSONB)`, [adminId, action, productId, JSON.stringify(metadata)]);
}
export const revisionColumn = `to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
export async function lockProduct(client: PoolClient, id: string) {
  const row = (await client.query(`SELECT *, ${revisionColumn} AS revision FROM products WHERE id=$1 FOR UPDATE`, [id])).rows[0];
  if (!row) throw new CatalogueAdminError("Product not found.", 404);
  return row;
}
export async function touchProduct(client: PoolClient, id: string) {
  await client.query("UPDATE products SET updated_at=clock_timestamp() WHERE id=$1", [id]);
}

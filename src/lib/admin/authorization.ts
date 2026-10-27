import "server-only";
import { getAdminRuntime, type AdminRuntime } from "./runtime.ts";
import { loadEnabledAdmin, type CurrentAdmin } from "./identity.ts";
import { hasPermission, type AdminPermission } from "./policy.ts";
import { recordAdminAudit } from "./audit.ts";

export class AdminAccessError extends Error {
  readonly status: 401 | 403;
  constructor(status: 401 | 403) { super("Administrator access is required."); this.name = "AdminAccessError"; this.status = status; }
}

export async function getCurrentAdmin(headers: Headers, runtime: AdminRuntime = getAdminRuntime()): Promise<CurrentAdmin | null> {
  const session = await runtime.auth.api.getSession({ headers });
  if (!session) return null;
  const admin = await loadEnabledAdmin(runtime.pool, session.user.id);
  if (!admin) await recordAdminAudit(runtime.pool, "ADMIN_ACCESS_DENIED");
  return admin;
}

export async function requireAdmin(headers: Headers, runtime: AdminRuntime = getAdminRuntime()): Promise<CurrentAdmin> {
  const admin = await getCurrentAdmin(headers, runtime);
  if (!admin) throw new AdminAccessError(401);
  return admin;
}

export async function requirePermission(permission: AdminPermission, headers: Headers, runtime: AdminRuntime = getAdminRuntime()): Promise<CurrentAdmin> {
  const admin = await requireAdmin(headers, runtime);
  if (!hasPermission(admin.role, permission)) {
    await recordAdminAudit(runtime.pool, "ADMIN_ACCESS_DENIED", admin.id);
    throw new AdminAccessError(403);
  }
  return admin;
}

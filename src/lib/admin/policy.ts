export const adminRoles = ["OWNER", "ADMIN", "CATALOGUE_MANAGER"] as const;
export type AdminRole = typeof adminRoles[number];
export type AdminPermission = "admin:enter" | "catalogue:manage" | "operations:manage" | "administrators:manage" | "orders:read" | "orders:manage_fulfillment" | "orders:view_payment_exceptions";

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && adminRoles.some((role) => role === value);
}

export function hasPermission(role: AdminRole, permission: AdminPermission): boolean {
  const allowed: Record<AdminRole, readonly AdminPermission[]> = {
    OWNER: ["admin:enter", "catalogue:manage", "operations:manage", "administrators:manage", "orders:read", "orders:manage_fulfillment", "orders:view_payment_exceptions"],
    ADMIN: ["admin:enter", "catalogue:manage", "operations:manage", "orders:read", "orders:manage_fulfillment", "orders:view_payment_exceptions"],
    CATALOGUE_MANAGER: ["admin:enter", "catalogue:manage"],
  };
  return allowed[role]?.includes(permission) ?? false;
}

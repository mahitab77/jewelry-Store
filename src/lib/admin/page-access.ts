import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requirePermission } from "./authorization.ts";

export async function requireAdminPage() {
  // Checks belong here and in each future data/action boundary. A layout alone
  // is insufficient because Next.js can reuse it during client navigation.
  let admin;
  try { admin = await requirePermission("admin:enter", new Headers(await headers())); }
  catch { redirect("/admin/login"); }
  return admin;
}

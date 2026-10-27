import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "./lib/admin/authorization.ts";
import { adminConfiguration } from "./lib/admin/config.ts";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/admin/login" || path === "/admin/logout") return NextResponse.next();
  let origin = request.url;
  try { origin = adminConfiguration().baseURL; } catch { /* Missing configuration denies access below. */ }
  try { await requirePermission("admin:enter", new Headers(request.headers)); }
  catch {
    const denied = NextResponse.redirect(new URL("/admin/login", origin));
    denied.headers.set("Cache-Control", "no-store");
    return denied;
  }
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = { matcher: ["/admin/:path*"] };

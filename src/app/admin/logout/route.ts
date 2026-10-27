import { handleAdminAuth } from "../../../lib/admin/http.ts";

export const runtime = "nodejs";
export function POST(request: Request) { return handleAdminAuth(request, undefined, "logout"); }

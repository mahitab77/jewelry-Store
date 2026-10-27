import { handleAdminAuth } from "../../../../lib/admin/http.ts";

export const runtime = "nodejs";
export function GET(request: Request) { return handleAdminAuth(request); }
export function POST(request: Request) { return handleAdminAuth(request); }

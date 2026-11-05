import { adminRequestsHttp } from "../../../../../lib/admin/requests/http.ts";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) { return adminRequestsHttp(request, (await params).path); }
export async function POST(request: Request, { params }: { params: Promise<{ path: string[] }> }) { return adminRequestsHttp(request, (await params).path); }

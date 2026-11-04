import { taxonomyHttp } from "../../../../../lib/admin/catalogue/taxonomy-http.ts";
export const runtime = "nodejs";
export async function GET(request: Request) { return taxonomyHttp(request); }
export async function POST(request: Request) { return taxonomyHttp(request); }

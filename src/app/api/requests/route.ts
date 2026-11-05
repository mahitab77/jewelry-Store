import { requestsHttp } from "../../../lib/requests/http.ts";
export const runtime = "nodejs";
export async function POST(request: Request) { return requestsHttp(request); }
export async function GET(request: Request) { return requestsHttp(request); }

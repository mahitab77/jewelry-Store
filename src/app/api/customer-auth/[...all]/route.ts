import { customerAuthHttp } from "../../../../lib/customer/http.ts";
export const runtime = "nodejs";
export function GET(request: Request) { return customerAuthHttp(request); }
export function POST(request: Request) { return customerAuthHttp(request); }

import { checkoutHttp } from "../../../../lib/checkout/http.ts";
export const runtime = "nodejs";
type Context = { params: Promise<{ path?: string[] }> };
async function handle(request: Request, context: Context) { return checkoutHttp(request, (await context.params).path ?? []); }
export const GET = handle;
export const POST = handle;
export const DELETE = handle;

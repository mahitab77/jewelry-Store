import "server-only";
import { cartOrigin, CartError, clearCartCookie, object, readToken } from "../cart/session.ts";
import { readCartJson } from "../cart/http.ts";
import { throttleCart } from "../cart/repository.ts";
import { loadCheckout, prepareCheckout } from "./repository.ts";
import { parseDetails } from "./validation.ts";
import { paymentsAvailable } from "../payments/config.ts";
import { pendingOrderLink } from "../payments/orders.ts";

const json = (body: unknown, status = 200, clear = false) => Response.json(body, { status, headers: {
  "Cache-Control": "private, no-store, max-age=0", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", ...(clear ? { "Set-Cookie": clearCartCookie() } : {}),
} });
export async function checkoutHttp(request: Request, path: string[] = []): Promise<Response> {
  try {
    if (new URL(request.url).search) throw new CartError("Checkout query parameters are not accepted.");
    if (request.headers.get("sec-fetch-site") === "cross-site") throw new CartError("This checkout request could not be verified.", 403);
    const session = readToken(request.headers);
    if (request.method === "GET" && !path.length) {
      if (session.token) await throttleCart(true);
      const checkout = await loadCheckout(session.token);
      return json({ checkout, paymentsAvailable: paymentsAvailable(), pendingOrderUrl: await pendingOrderLink(session.token) }, 200, session.present && !checkout.cart.revision);
    }
    const action = request.method === "POST" && path.length === 1 && path[0] === "draft" ? "save"
      : request.method === "POST" && path.length === 1 && path[0] === "review" ? "review"
      : request.method === "DELETE" && path.length === 1 && path[0] === "draft" ? "delete" : null;
    if (!action) return json({ message: "This checkout operation is not supported." }, 405);
    if (request.headers.get("origin") !== cartOrigin().origin) throw new CartError("This checkout request could not be verified.", 403);
    if (!session.token) return json({ message: "Open your shopping bag to begin checkout preparation." }, 401);
    await throttleCart();
    const body = object(await readCartJson(request, 8192), action === "delete" ? ["draftRevision"] : ["details", "fingerprint", "draftRevision"]);
    if (body.draftRevision !== null && (typeof body.draftRevision !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(body.draftRevision))) throw new CartError("Reload saved checkout details before continuing.", 409);
    if (action !== "delete" && (typeof body.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(body.fingerprint))) throw new CartError("Reload your shopping bag before reviewing checkout.", 409);
    const command: Parameters<typeof prepareCheckout>[1] = action === "delete" ? { action, revision: body.draftRevision as string | null }
      : { action, revision: body.draftRevision as string | null, fingerprint: body.fingerprint as string, details: parseDetails(body.details) };
    const result = await prepareCheckout(session.token, command);
    return json(result, result.status, result.status === 401);
  } catch (error) {
    if (error instanceof CartError) return json({ message: error.message }, error.status);
    return json({ message: "Checkout preparation is temporarily unavailable. Please refresh before trying again." }, 503);
  }
}

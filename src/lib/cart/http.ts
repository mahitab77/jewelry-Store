import "server-only";
import { CartError, cartOrigin, clearCartCookie, object, quantity, readToken, revision, setCartCookie, uuid } from "./session.ts";
import { mutateCart, readCart, throttleCart } from "./repository.ts";

const response = (body: unknown, status = 200, cookie?: string) => Response.json(body, { status, headers: {
  "Cache-Control": "private, no-store, max-age=0", "Vary": "Cookie", "X-Content-Type-Options": "nosniff",
  ...(cookie ? { "Set-Cookie": cookie } : {}),
} });
async function jsonBody(request: Request) {
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) throw new CartError("Use a JSON shopping bag request.", 415);
  const reader = request.body?.getReader(); if (!reader) throw new CartError("A request body is required.");
  const parts: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
    if (size > 2048) { await reader.cancel(); throw new CartError("This shopping bag request is too large.", 413); } parts.push(part.value); }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts))) as unknown; }
  catch { throw new CartError("Invalid JSON shopping bag request."); }
}
export async function cartHttp(request: Request, path: string[] = []): Promise<Response> {
  try {
    if (new URL(request.url).search) throw new CartError("Shopping bag query parameters are not accepted.");
    if (request.headers.get("sec-fetch-site") === "cross-site") throw new CartError("This shopping bag request could not be verified.", 403);
    const session = readToken(request.headers);
    if (request.method === "GET" && !path.length) {
      const result = await readCart(session.token);
      return response({ cart: result.cart }, 200, result.clear || session.present && !session.token ? clearCartCookie() : undefined);
    }
    const kind = request.method === "POST" && path.length === 1 && path[0] === "items" ? "add"
      : path.length === 2 && path[0] === "items" && request.method === "PATCH" ? "update"
      : path.length === 2 && path[0] === "items" && request.method === "DELETE" ? "remove" : null;
    if (!kind) return response({ message: "This shopping bag operation is not supported." }, 405);
    if (request.headers.get("origin") !== cartOrigin().origin) throw new CartError("This shopping bag request could not be verified.", 403);
    await throttleCart();
    const body = object(await jsonBody(request), kind === "add" ? ["variantId", "quantity"] : kind === "update" ? ["quantity", "revision"] : ["revision"]);
    const mutation: Parameters<typeof mutateCart>[1] = kind === "add" ? { kind, variantId: uuid(body.variantId), quantity: quantity(body.quantity) }
      : kind === "update" ? { kind, itemId: uuid(path[1]), quantity: quantity(body.quantity), revision: revision(body.revision) }
      : { kind, itemId: uuid(path[1]), revision: revision(body.revision) };
    const result = await mutateCart(session.token, mutation);
    if ("error" in result) return response({ message: result.error.message, ...("cart" in result ? { cart: result.cart } : {}) }, result.error.status);
    return response({ cart: result.cart, message: kind === "add" ? "Added to your shopping bag." : kind === "remove" ? "Selection removed." : "Shopping bag updated." }, 200,
      result.token ? setCartCookie(result.token, result.cart.expiresAt!) : undefined);
  } catch (error) {
    if (error instanceof CartError) return response({ message: error.message }, error.status);
    return response({ message: "Your shopping bag is temporarily unavailable. Refresh to check it before trying again." }, 503);
  }
}

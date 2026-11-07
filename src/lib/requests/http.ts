import "server-only";
import { readCartJson } from "../cart/http.ts";
import { CartError } from "../cart/session.ts";
import { getAdminRuntime, type AdminRuntime } from "../admin/runtime.ts";
import { submitRequest } from "./repository.ts";
import { RequestError } from "./validation.ts";

export const requestJson = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
export async function readRequestJson(request: Request) {
  try { return await readCartJson(request, 32768); }
  catch (error) { if (error instanceof CartError) throw new RequestError(error.status === 413 ? "This request is too large." : "Use a valid JSON request body.", error.status); throw error; }
}
export async function requestsHttp(request: Request, supplied?: AdminRuntime): Promise<Response> {
  try {
    if (request.method !== "POST") return requestJson({ message: "Use POST to submit a request. Public request lookup is unavailable.", outcome: "UNKNOWN" }, 405);
    const runtime = supplied ?? getAdminRuntime();
    if (new URL(request.url).search || request.headers.get("origin") !== runtime.config.baseURL || request.headers.get("sec-fetch-site") === "cross-site") throw new RequestError("This request could not be verified.", 403);
    return requestJson(await submitRequest(await readRequestJson(request), runtime));
  } catch (error) {
    if (error instanceof RequestError) return requestJson({ message: error.message, outcome: error.outcome, ...(error.submissionId ? { submissionId: error.submissionId } : {}), ...(error.field ? { fieldErrors: { [error.field]: error.message } } : {}) }, error.status);
    return requestJson({ message: "The request outcome could not be confirmed. Keep this form and its submission reference; recover with the same unchanged submission rather than creating another.", outcome: "UNKNOWN" }, 503);
  }
}

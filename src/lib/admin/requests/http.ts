import "server-only";
import { AdminAccessError, requirePermission } from "../authorization.ts";
import { getAdminRuntime, type AdminRuntime } from "../runtime.ts";
import { createLoginThrottle } from "../rate-limit.ts";
import { requestJson, readRequestJson } from "../../requests/http.ts";
import { RequestError } from "../../requests/validation.ts";
import { changeRequest, listRequests, readRequest } from "./repository.ts";

export async function adminRequestsHttp(request: Request, path: string[], supplied?: AdminRuntime): Promise<Response> {
  try {
    const runtime = supplied ?? getAdminRuntime(), actor = await requirePermission("operations:manage", request.headers, runtime);
    if (new URL(request.url).search) throw new RequestError("Query parameters are not accepted.");
    if (request.method === "GET" && path.length === 2) {
      const result = await readRequest(request.headers, path[0], path[1], runtime);
      return result ? requestJson(result) : requestJson({ message: "Request not found." }, 404);
    }
    if (request.method !== "POST") return requestJson({ message: "Use POST for request search and changes." }, 405);
    if (request.headers.get("origin") !== runtime.config.baseURL || request.headers.get("sec-fetch-site") === "cross-site") throw new RequestError("This request could not be verified.", 403);
    if (!(await createLoginThrottle(runtime.pool, runtime.config.secret)(`requests:admin:${actor.id}`, { window: 60, max: 100 })).allowed) throw new RequestError("Please wait before making more requests.", 429);
    const value = await readRequestJson(request);
    if (path.length === 1 && path[0] === "search") return requestJson(await listRequests(request.headers, value, runtime));
    if (path.length === 2) return requestJson({ ...await changeRequest(request.headers, path[0], path[1], value, runtime), message: "Request updated. No customer notification was sent." });
    return requestJson({ message: "Not found." }, 404);
  } catch (error) {
    if (error instanceof AdminAccessError) return requestJson({ message: "Operations-authorized administrator access is required." }, error.status);
    if (error instanceof RequestError) return requestJson({ message: error.message, ...(error.field ? { fieldErrors: { [error.field]: error.message } } : {}) }, error.status);
    return requestJson({ message: "Requests are temporarily unavailable. Refresh to inspect saved state before retrying." }, 503);
  }
}

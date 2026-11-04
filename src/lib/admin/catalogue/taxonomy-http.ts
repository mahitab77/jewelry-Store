import "server-only";
import { AdminAccessError, requirePermission } from "../authorization.ts";
import { getAdminRuntime, type AdminRuntime } from "../runtime.ts";
import { createLoginThrottle } from "../rate-limit.ts";
import { CatalogueAdminError, fail } from "./validation.ts";
import { jsonBody } from "./http.ts";
import { readTaxonomy, saveTaxonomy } from "./taxonomy.ts";

function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }); }
export async function taxonomyHttp(request: Request, supplied?: AdminRuntime): Promise<Response> {
  try {
    const runtime = supplied ?? getAdminRuntime();
    const admin = await requirePermission("catalogue:manage", request.headers, runtime);
    if (new URL(request.url).search) fail("Query parameters are not accepted here.");
    if (request.method === "GET") return json(await readTaxonomy(request.headers, runtime));
    if (request.method !== "POST") return json({ message: "Use POST for changes." }, 405);
    if (request.headers.get("origin") !== runtime.config.baseURL || request.headers.get("sec-fetch-site") === "cross-site") fail("This request could not be verified.", 403);
    const throttle = await createLoginThrottle(runtime.pool, runtime.config.secret)(`catalogue:${admin.id}`, { window: 60, max: 60 });
    if (!throttle.allowed) return json({ message: "Please wait before making more changes." }, 429);
    const id = await saveTaxonomy(request.headers, await jsonBody(request), runtime);
    return json({ id, message: "Catalogue grouping saved.", ...await readTaxonomy(request.headers, runtime) });
  } catch (error) {
    if (error instanceof AdminAccessError) return json({ message: "Administrator catalogue access is required." }, error.status);
    if (error instanceof CatalogueAdminError) return json({ message: error.message }, error.status);
    return json({ message: "Catalogue groupings are temporarily unavailable. Reload before retrying." }, 503);
  }
}

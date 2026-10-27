import "server-only";
import { AdminAccessError, requirePermission } from "../authorization.ts";
import { getAdminRuntime, type AdminRuntime } from "../runtime.ts";
import { CatalogueAdminError, fail, object } from "./validation.ts";
import { readEditor, productAuditHistory } from "./read.ts";
import { adjustInventory, saveProduct } from "./products.ts";
import { arrangePhotos, removePhoto, retryPhotoCleanup, uploadPhoto } from "./media.ts";
import { adminPhotograph } from "../../media/delivery.ts";
import { MAX_PHOTO_BYTES, type MediaProvider } from "../../media/cloudinary.ts";
import { createLoginThrottle } from "../rate-limit.ts";

function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }); }
async function bodyBytes(request: Request, limit: number) {
  const reader = request.body?.getReader(); if (!reader) fail("Request body is missing.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
      if (size > limit) { await reader.cancel(); fail("This request is too large.", 413); } chunks.push(part.value); }
  } finally { reader.releaseLock(); }
  return new Uint8Array(Buffer.concat(chunks));
}
async function jsonBody(request: Request) {
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) fail("Use a JSON request.", 415);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await bodyBytes(request, 262144))) as unknown; }
  catch (error) { if (error instanceof CatalogueAdminError) throw error; return fail("Invalid JSON request."); }
}
export async function catalogueHttp(request: Request, path: string[], suppliedRuntime?: AdminRuntime, provider?: MediaProvider): Promise<Response> {
  try {
    const runtime = suppliedRuntime ?? getAdminRuntime();
    const admin = await requirePermission("catalogue:manage", request.headers, runtime);
    if (new URL(request.url).search) fail("Query parameters are not accepted here.");
    const [area, id, operation, child] = path;
    if (area !== "products" || path.length > 4) return json({ message: "Not found." }, 404);
    if (request.method === "GET") {
      if (id && operation === "photos" && child) return adminPhotograph(request.headers, id, child, runtime, provider);
      if (id && !operation) return json({ product: await readEditor(request.headers, id, runtime), history: await productAuditHistory(request.headers, id, runtime) });
      return json({ message: "Not found." }, 404);
    }
    if (request.method !== "POST") return json({ message: "Use POST for changes." }, 405);
    if (request.headers.get("origin") !== runtime.config.baseURL || request.headers.get("sec-fetch-site") === "cross-site") fail("This request could not be verified.", 403);
    const throttle = await createLoginThrottle(runtime.pool, runtime.config.secret)(`catalogue:${admin.id}`, { window: 60, max: 60 });
    if (!throttle.allowed) return json({ message: "Please wait before making more changes." }, 429);
    let productId = id;
    let feedback = "Changes saved.";
    if (!id) productId = await saveProduct(request.headers, null, await jsonBody(request), runtime);
    else if (operation === "save" && !child) await saveProduct(request.headers, id, await jsonBody(request), runtime);
    else if (operation === "inventory" && child) await adjustInventory(request.headers, id, child, await jsonBody(request), runtime);
    else if (operation === "photos" && !child) {
      if (!/^multipart\/form-data;/.test(request.headers.get("content-type") ?? "")) fail("Choose a product photograph.", 415);
      const bytes = await bodyBytes(request, MAX_PHOTO_BYTES + 65536);
      const form = await new Request(request.url, { method: "POST", headers: { "Content-Type": request.headers.get("content-type")! }, body: bytes }).formData();
      if ([...form.keys()].some((key) => !["file", "altText"].includes(key)) || form.getAll("file").length !== 1 || form.getAll("altText").length !== 1) fail("Unexpected upload fields. Provider confirmations cannot be submitted by clients.");
      const file = form.get("file"), altText = form.get("altText");
      if (!(file instanceof File) || typeof altText !== "string") fail("Choose a JPEG, PNG or WebP photograph and describe it.");
      await uploadPhoto(request.headers, id, new Uint8Array(await file.arrayBuffer()), file.type, altText, runtime, provider);
      feedback = "Photograph uploaded and associated.";
    } else if (operation === "arrange" && !child) await arrangePhotos(request.headers, id, await jsonBody(request), runtime);
    else if (operation === "remove-photo" && child) {
      object(await jsonBody(request), []);
      await removePhoto(request.headers, id, child, runtime);
      feedback = "Photograph removed. Provider cleanup may be pending; use Retry cleanup if needed.";
    } else if (operation === "cleanup" && !child) {
      object(await jsonBody(request), []);
      const result = await retryPhotoCleanup(request.headers, id, runtime, provider);
      feedback = `${result.completed} provider cleanup task(s) completed; ${result.pending} require a later retry. Tasks still in their upload lease remain private.`;
    } else return json({ message: "Not found." }, 404);
    return json({ id: productId, message: feedback, product: await readEditor(request.headers, productId, runtime), history: await productAuditHistory(request.headers, productId, runtime) });
  } catch (error) {
    if (error instanceof AdminAccessError) return json({ message: "Administrator catalogue access is required." }, error.status);
    if (error instanceof CatalogueAdminError) return json({ message: error.message }, error.status);
    return json({ message: "The catalogue is temporarily unavailable. Reload to check the current state before retrying." }, 503);
  }
}

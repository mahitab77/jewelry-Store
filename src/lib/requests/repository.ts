import "server-only";
import { createHmac } from "node:crypto";
import type { PoolClient } from "pg";
import { getAdminRuntime, type AdminRuntime } from "../admin/runtime.ts";
import { consume } from "../cart/repository.ts";
import { fail, parseRequest, RequestError, submissionReference, type NormalizedRequest } from "./validation.ts";
import type { ProductContext, RequestReceipt } from "./types.ts";

export const requestTables = { QUOTATION: "product_enquiries", MODIFICATION: "bespoke_requests", BESPOKE: "bespoke_requests", CONSULTATION: "appointment_requests" } as const;
const common = `r.id,r.contact_name AS name,r.contact_email AS email,r.contact_phone AS phone,r.message,r.status,
  r.product_id AS "productId",r.variant_id AS "variantId",r.product_context AS "productContext",r.assigned_admin_id AS "assignedAdminId",
  to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
  to_char(r.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS revision`;
export const requestUnion = `SELECT ${common},'QUOTATION'::TEXT AS kind,NULL::TEXT AS channel,NULL::TEXT AS "preferredStart",NULL::TEXT AS "confirmedStart",NULL::UUID AS "boutiqueLocationId" FROM product_enquiries r
  UNION ALL SELECT ${common},CASE WHEN r.product_id IS NULL THEN 'BESPOKE' ELSE 'MODIFICATION' END AS kind,NULL::TEXT AS channel,NULL::TEXT AS "preferredStart",NULL::TEXT AS "confirmedStart",NULL::UUID AS "boutiqueLocationId" FROM bespoke_requests r
  UNION ALL SELECT ${common},'CONSULTATION'::TEXT AS kind,r.consultation_channel AS channel,
  to_char(r.preferred_start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "preferredStart",
  to_char(r.confirmed_start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "confirmedStart",r.boutique_location_id AS "boutiqueLocationId" FROM appointment_requests r`;
const receipt = (reference: string): RequestReceipt => ({ reference, message: "Your request has been received. Our team will contact you to discuss the details. Pricing and appointments are subject to confirmation." });

async function throttle(input: NormalizedRequest | null, runtime: AdminRuntime) {
  const client = await runtime.pool.connect();
  try {
    // Deliberately outside the request transaction: rejected submissions still
    // consume distributed limits. No raw contact enters counter keys or logs.
    await client.query(`DELETE FROM cart_rate_limits WHERE key_hash IN (SELECT key_hash FROM cart_rate_limits WHERE expires_at<=statement_timestamp() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED)`);
    if (!await consume(client, "requests:global", 120)) fail("Please wait a minute before sending another request.", 429);
    for (const [kind, contact] of [["email", input?.email], ["phone", input?.phone]] as const) {
      if (!contact) continue;
      const hash = createHmac("sha256", runtime.config.secret).update(`la-palme-requests:${kind}:${contact}`).digest("hex");
      if (!await consume(client, `requests:contact:${hash}`, 5)) fail("Please wait a minute before sending another request.", 429);
    }
  } finally { client.release(); }
}

async function productContext(client: PoolClient, input: NormalizedRequest): Promise<ProductContext | null> {
  if (!input.productId) return null;
  const p = (await client.query(`SELECT name,slug FROM products WHERE id=$1 AND status='PUBLISHED' AND published_at<=statement_timestamp() FOR SHARE`, [input.productId])).rows[0];
  if (!p) fail("That piece is no longer available for a request. Choose a published piece.", 409, "productId");
  let v: Record<string, string | null> | undefined;
  if (input.variantId) {
    v = (await client.query(`SELECT sku,size_label AS size,configuration_label AS configuration,metal_type AS "metalType",metal_purity AS "metalPurity",metal_color AS "metalColor",
      metal_weight_grams::TEXT AS "metalWeightGrams",metal_weight_basis AS "metalWeightBasis" FROM product_variants WHERE id=$1 AND product_id=$2 AND is_active FOR SHARE`, [input.variantId, input.productId])).rows[0];
    if (!v) fail("That configuration is no longer available for a request. Choose an active configuration.", 409, "variantId");
  }
  const stones = input.variantId ? (await client.query(`SELECT g.stone_type AS type,g.variety,g.shape,g.color,g.carat_weight::TEXT AS "caratWeight",pg.total_carat_weight::TEXT AS "totalCaratWeight",pg.quantity,pg.gemstone_role AS role
    FROM product_gemstones pg JOIN gemstones g ON g.id=pg.gemstone_id WHERE pg.variant_id=$1 ORDER BY pg.display_order,pg.id`, [input.variantId])).rows : [];
  const snapshot: ProductContext = { name: p.name, slug: p.slug, sku: v?.sku ?? null, size: v?.size ?? null, configuration: v?.configuration ?? null,
    metalType: v?.metalType ?? null, metalPurity: v?.metalPurity ?? null, metalColor: v?.metalColor ?? null, metalWeightGrams: v?.metalWeightGrams ?? null,
    metalWeightBasis: (v?.metalWeightBasis as ProductContext["metalWeightBasis"]) ?? null, stones };
  if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > 64000) fail("This piece needs staff review before a request can be recorded.", 409);
  return snapshot;
}

export async function submitRequest(value: unknown, runtime: AdminRuntime = getAdminRuntime()): Promise<RequestReceipt> {
  const submissionId = submissionReference(value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>).submissionId : undefined);
  let input: NormalizedRequest | null = null, validationError: RequestError | null = null;
  try { input = parseRequest(value); }
  catch (error) { if (!(error instanceof RequestError)) throw error; validationError = error; }
  await throttle(input, runtime);
  const client = await runtime.pool.connect();
  let absent = false, businessWriteStarted = false, commitAttempted = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1313))", [submissionId]);
    const previous = (await client.query(`SELECT * FROM (${requestUnion}) q WHERE id=$1`, [submissionId])).rows;
    if (previous.length) {
      const old = previous[0];
      if (!input || previous.length !== 1 || old.kind !== input.kind || old.productId !== input.productId || old.variantId !== input.variantId || old.name !== input.name || old.email !== input.email || old.phone !== input.phone || old.message !== input.message || old.channel !== input.channel || old.preferredStart !== input.preferredStart) throw new RequestError("This submission reference has already been used. Keep the original request unchanged when recovering its receipt.", 409, undefined, { outcome: "CONFLICT" });
      // Compare the immutable submitted data BEFORE checking today's catalogue,
      // preferred time or snapshot: a committed receipt survives later edits.
      commitAttempted = true; await client.query("COMMIT"); return receipt(submissionId);
    }
    absent = true;
    if (validationError) throw validationError;
    if (!input) throw new Error("Request validation did not produce a submission.");
    if (input.preferredStart && Date.parse(input.preferredStart) <= Date.now()) fail("Choose a future preferred time in Africa/Cairo.", 400, "preferredTime");
    const snapshot = await productContext(client, input), table = requestTables[input.kind];
    const values: unknown[] = [input.submissionId, input.productId, input.variantId, input.name, input.email, input.phone, input.message, snapshot ? JSON.stringify(snapshot) : null];
    businessWriteStarted = true;
    await client.query(`INSERT INTO ${table}(id,product_id,variant_id,contact_name,contact_email,contact_phone,message,product_context${input.kind === "CONSULTATION" ? ",consultation_channel,preferred_start_at" : ""})
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::JSONB${input.kind === "CONSULTATION" ? ",$9,$10" : ""})`, input.kind === "CONSULTATION" ? [...values, input.channel, input.preferredStart] : values);
    await client.query(`INSERT INTO audit_events(actor_kind,action,target_table,target_id,metadata) VALUES('SYSTEM','REQUEST_RECEIVED',$1,$2,$3::JSONB)`, [table, input.submissionId, JSON.stringify({ kind: input.kind, productLinked: Boolean(input.productId), channel: input.channel })]);
    commitAttempted = true; await client.query("COMMIT"); return receipt(submissionId);
  } catch (error) {
    await client.query("ROLLBACK");
    // This proves absence only while holding this UUID's lock. A delayed
    // original may still arrive, so corrections must reuse the same UUID.
    if (absent && !businessWriteStarted && !commitAttempted && error instanceof RequestError && [400, 409].includes(error.status)) {
      throw new RequestError(error.message, error.status, error.field, { outcome: "NOT_CREATED", submissionId });
    }
    throw error;
  }
  finally { client.release(); }
}

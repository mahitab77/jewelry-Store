import "server-only";
import type { PoolClient } from "pg";
import { requirePermission, AdminAccessError } from "../authorization.ts";
import { hasPermission, isAdminRole } from "../policy.ts";
import { getAdminRuntime, type AdminRuntime } from "../runtime.ts";
import { requestTables, requestUnion } from "../../requests/repository.ts";
import { fail, object, requestKind, RequestError, text, uuid } from "../../requests/validation.ts";
import { cairoInstant } from "../../requests/cairo.ts";
import { nextStatuses, requestStatuses, type AdminRequest, type RequestChoices, type RequestDetail, type RequestList } from "../../requests/types.ts";

async function transaction<T>(headers: Headers, work: (client: PoolClient, actor: string) => Promise<T>, runtime: AdminRuntime): Promise<T> {
  const admin = await requirePermission("operations:manage", headers, runtime), client = await runtime.pool.connect();
  try {
    await client.query("BEGIN");
    const row = (await client.query("SELECT role FROM admin_users WHERE id=$1 AND is_active AND auth_provider='better-auth' AND auth_subject=id::TEXT FOR SHARE", [admin.id])).rows[0];
    if (!row || !isAdminRole(row.role) || !hasPermission(row.role, "operations:manage")) throw new AdminAccessError(403);
    const result = await work(client, admin.id); await client.query("COMMIT"); return result;
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof RequestError || error instanceof AdminAccessError) throw error;
    if (["23505", "23503", "23514", "40001", "40P01"].includes((error as { code?: string }).code ?? "")) fail("The request or referenced record changed. Refresh before continuing.", 409);
    fail("The request operation could not be completed. Refresh to inspect its saved state.", 503);
  } finally { client.release(); }
}
async function choices(client: PoolClient): Promise<RequestChoices> {
  const staff = await client.query(`SELECT id,display_name AS name FROM admin_users WHERE is_active AND role IN ('OWNER','ADMIN') AND auth_provider='better-auth' AND auth_subject=id::TEXT ORDER BY display_name,id`);
  const locations = await client.query(`SELECT id,name,governorate,city_area AS city,street_address AS street FROM boutique_locations WHERE is_active AND country_code='EG' ORDER BY name,id LIMIT 100`);
  return { staff: staff.rows, locations: locations.rows };
}
async function detail(client: PoolClient, kind: string, id: string): Promise<AdminRequest | null> {
  return (await client.query<AdminRequest>(`SELECT q.*,a.display_name AS "assignedName",
    CASE WHEN b.id IS NOT NULL THEN jsonb_build_object('id',b.id,'name',b.name,'governorate',b.governorate,'city',b.city_area,'street',b.street_address,'isActive',b.is_active) ELSE NULL END AS "boutiqueLocation"
    FROM (${requestUnion}) q LEFT JOIN admin_users a ON a.id=q."assignedAdminId"
    LEFT JOIN boutique_locations b ON b.id=q."boutiqueLocationId" WHERE q.kind=$1 AND q.id=$2`, [kind, id])).rows[0] ?? null;
}
export async function listRequests(headers: Headers, value: unknown = {}, runtime: AdminRuntime = getAdminRuntime()): Promise<RequestList> {
  return transaction(headers, async (client) => {
    const q = object(value, ["kind", "status", "page"]), kind = q.kind === undefined || q.kind === "" ? null : requestKind(q.kind);
    const status = text(q.status, "status", 30) || null, page = q.page ?? 1;
    if (typeof page !== "number" || !Number.isInteger(page) || page < 1 || page > 1000) fail("Choose a valid request page.");
    if (status && !(kind ? requestStatuses[kind] : Object.values(requestStatuses).flat()).includes(status)) fail("Choose a valid request status.");
    const rows = (await client.query<AdminRequest>(`SELECT q.*,a.display_name AS "assignedName" FROM (${requestUnion}) q LEFT JOIN admin_users a ON a.id=q."assignedAdminId"
      WHERE ($1::TEXT IS NULL OR q.kind=$1) AND ($2::TEXT IS NULL OR q.status=$2) ORDER BY q."createdAt" DESC,q.id DESC,q.kind LIMIT 21 OFFSET $3`, [kind, status, (page - 1) * 20])).rows;
    const count = (await client.query(`SELECT count(*)::INT AS count FROM (${requestUnion}) q WHERE status='NEW'`)).rows[0].count;
    return { items: rows.slice(0, 20), newCount: count, page, hasMore: rows.length > 20, ...await choices(client) };
  }, runtime);
}
export async function readRequest(headers: Headers, kindValue: unknown, idValue: unknown, runtime: AdminRuntime = getAdminRuntime()): Promise<RequestDetail | null> {
  return transaction(headers, async (client) => {
    const row = await detail(client, requestKind(kindValue), uuid(idValue));
    return row ? { request: row, ...await choices(client) } : null;
  }, runtime);
}
export async function changeRequest(headers: Headers, kindValue: unknown, idValue: unknown, value: unknown, runtime: AdminRuntime = getAdminRuntime()): Promise<RequestDetail> {
  return transaction(headers, async (client, actor) => {
    const kind = requestKind(kindValue), id = uuid(idValue), table = requestTables[kind];
    const body = object(value, ["revision", "status", "assignedAdminId", "confirmedDate", "confirmedTime", "boutiqueLocationId", "agreed"]);
    await client.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
    const old = await detail(client, kind, id); if (!old) fail("Request not found.", 404);
    if (text(body.revision, "revision", 40, true) !== old.revision) fail("This request changed. Refresh before saving.", 409);
    const status = text(body.status, "status", 30, true);
    if (!requestStatuses[kind].includes(status) || !nextStatuses(kind, old.status).includes(status)) fail("That status transition is not available.", 409, "status");
    const assigned = body.assignedAdminId === undefined ? old.assignedAdminId : body.assignedAdminId === null || body.assignedAdminId === "" ? null : uuid(body.assignedAdminId, "assignedAdminId");
    if (assigned && !(await client.query(`SELECT id FROM admin_users WHERE id=$1 AND is_active AND role IN ('OWNER','ADMIN') AND auth_provider='better-auth' AND auth_subject=id::TEXT FOR SHARE`, [assigned])).rowCount) fail("Choose an enabled operations-authorized staff member.", 400, "assignedAdminId");
    let confirmed = old.confirmedStart, location = old.boutiqueLocationId;
    if (body.agreed !== undefined && typeof body.agreed !== "boolean") fail("Confirm the arrangements explicitly.", 400, "agreed");
    if (kind === "CONSULTATION") {
      const date = text(body.confirmedDate, "confirmedDate", 10), time = text(body.confirmedTime, "confirmedTime", 5);
      if (date || time) {
        try { confirmed = cairoInstant(date, time); } catch (error) { fail((error as Error).message, 400, "confirmedTime"); }
      }
      if (body.boutiqueLocationId !== undefined) location = body.boutiqueLocationId === null || body.boutiqueLocationId === "" ? null : uuid(body.boutiqueLocationId, "boutiqueLocationId");
      if (status !== "CONFIRMED" && (confirmed !== old.confirmedStart || location !== old.boutiqueLocationId)) fail("Change meeting arrangements only while explicitly confirming them.", 400, "status");
      if (status === "CONFIRMED") {
        if (body.agreed !== true || !confirmed) fail("Confirm only after the actual arrangements and time have been agreed with the customer.", 400, "agreed");
        if (!old.channel) fail("This legacy appointment needs its consultation channel reviewed before confirmation.", 409);
        if (old.channel === "ZOOM") {
          if (!old.email || location) fail("Zoom requires an email and cannot have a boutique destination.");
        } else if (!location || !(await client.query("SELECT id FROM boutique_locations WHERE id=$1 AND is_active AND country_code='EG' FOR SHARE", [location])).rowCount) fail("Choose an active, verified boutique location before confirmation.", 400, "boutiqueLocationId");
      }
      if (old.channel === "ZOOM" && location) fail("A Zoom consultation cannot have a boutique destination.");
      await client.query(`UPDATE appointment_requests SET status=$2,assigned_admin_id=$3,confirmed_start_at=$4,boutique_location_id=$5,updated_at=GREATEST(clock_timestamp(),updated_at+INTERVAL '1 microsecond') WHERE id=$1`, [id, status, assigned, confirmed, location]);
    } else {
      if (body.confirmedDate || body.confirmedTime || body.boutiqueLocationId || body.agreed) fail("Meeting confirmation belongs only to consultation requests.");
      await client.query(`UPDATE ${table} SET status=$2,assigned_admin_id=$3,updated_at=GREATEST(clock_timestamp(),updated_at+INTERVAL '1 microsecond') WHERE id=$1`, [id, status, assigned]);
    }
    await client.query(`INSERT INTO audit_events(actor_kind,actor_admin_id,action,target_table,target_id,metadata) VALUES('ADMIN',$1,'REQUEST_UPDATED',$2,$3,$4::JSONB)`, [actor, table, id, JSON.stringify({ kind, from: old.status, to: status, assignedAdminId: assigned, timeConfirmed: Boolean(confirmed),
      before: { assignedAdminId: old.assignedAdminId, confirmedStart: old.confirmedStart, boutiqueLocationId: old.boutiqueLocationId },
      after: { assignedAdminId: assigned, confirmedStart: confirmed, boutiqueLocationId: location } })]);
    return { request: (await detail(client, kind, id))!, ...await choices(client) };
  }, runtime);
}

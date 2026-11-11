import "server-only";
import { getCustomerRuntime, type CustomerRuntime } from "./runtime.ts";
import { requireCustomer, lockCustomer } from "./authorization.ts";
import { CustomerError } from "./config.ts";
import { customerJson, customerOrigin } from "./http.ts";
import { readRequestJson } from "../requests/http.ts";
import { object, text, uuid } from "../requests/validation.ts";
import { egyptianMobile } from "../checkout/egypt.ts";
import { databaseThrottle } from "../auth/rate-limit.ts";

export async function customerAccountHttp(request: Request, path: string[], supplied?: CustomerRuntime) {
  try {
    const runtime = supplied ?? getCustomerRuntime(), customer = await requireCustomer(request.headers, runtime), url = new URL(request.url);
    if (!(await databaseThrottle(runtime.pool, runtime.config.secret, "customer_auth_rate_limits")(`account:${customer.id}`, { window: 60, max: 120 })).allowed) throw new CustomerError("Please wait before refreshing again.", 429);
    if (!path.length && request.method === "GET" && !url.search) return customerJson({ profile: { name: customer.name, email: customer.email, phone: customer.phone } });
    if (path.join("/") === "details" && request.method === "POST" && !url.search) {
      customerOrigin(request, runtime);
      const body = object(await readRequestJson(request), ["name", "phone"]), name = text(body.name, "name", 100, true), phoneValue = text(body.phone, "phone", 40);
      if ((name.match(/\p{L}/gu) ?? []).length < 2) throw new CustomerError("Enter your name using at least two letters.", 400);
      const phone = phoneValue ? egyptianMobile(phoneValue) ?? (/^\+[1-9][0-9]{7,14}$/.test(phoneValue.replace(/[ ()-]/g, "")) ? phoneValue.replace(/[ ()-]/g, "") : null) : null;
      if (phoneValue && !phone) throw new CustomerError("Enter an Egyptian mobile or international telephone number.", 400);
      const client = await runtime.pool.connect();
      try {
        await client.query("BEGIN"); await lockCustomer(client, customer);
        await client.query("UPDATE customer_auth_users SET name=$2,updated_at=clock_timestamp() WHERE id=$1", [customer.id, name]);
        await client.query("UPDATE customer_profiles SET full_name=$2,phone=$3,updated_at=clock_timestamp() WHERE id=$1", [customer.profileId, name, phone]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
      return customerJson({ profile: { name, email: customer.email, phone: phone ?? "" } });
    }
    if (request.method !== "GET" || !["requests", "appointments"].includes(path[0]) || path.length > 2) return customerJson({ message: "Not found." }, 404);
    if ([...url.searchParams.keys()].some(k => k !== "page") || url.searchParams.getAll("page").length > 1) throw new CustomerError("Invalid page.", 400);
    const page = url.searchParams.get("page") ?? "1";
    if (!/^[1-9][0-9]{0,2}$/.test(page)) throw new CustomerError("Invalid page.", 400);
    const columns = `id,customer_profile_id,contact_name AS name,contact_email AS email,contact_phone AS phone,message,status,
      product_id AS "productId",variant_id AS "variantId",product_context AS "productContext",created_at AS "createdAt"`;
    const selection = path[0] === "appointments"
      ? `SELECT ${columns},'CONSULTATION'::TEXT AS kind,consultation_channel AS channel,preferred_start_at AS "preferredStart",confirmed_start_at AS "confirmedStart",boutique_location_id AS "boutiqueLocationId" FROM appointment_requests WHERE customer_profile_id=$1`
      : `SELECT ${columns},'QUOTATION'::TEXT AS kind FROM product_enquiries WHERE customer_profile_id=$1 UNION ALL SELECT ${columns},CASE WHEN product_id IS NULL THEN 'BESPOKE' ELSE 'MODIFICATION' END AS kind FROM bespoke_requests WHERE customer_profile_id=$1`;
    const values: unknown[] = [customer.profileId];
    if (path[1]) values.push(uuid(path[1])); else values.push((Number(page) - 1) * 20);
    const rows = (await runtime.pool.query(`SELECT * FROM (${selection}) owned ${path[1] ? "WHERE id=$2" : 'ORDER BY "createdAt" DESC,id LIMIT 21 OFFSET $2'}`, values)).rows;
    if (path[1] && !rows.length) return customerJson({ message: "Request not found." }, 404);
    // Never serialize internal owners, staff, assignments or audit records.
    const items = rows.slice(0, 20).map(({ customer_profile_id: _owner, ...row }) => { void _owner; return row; });
    if (path[0] === "appointments") for (const item of items) {
      const location = item.channel === "BOUTIQUE" && ["CONFIRMED", "COMPLETED"].includes(item.status) && item.boutiqueLocationId
        ? (await runtime.pool.query("SELECT name,governorate,city_area AS city,street_address AS street FROM boutique_locations WHERE id=$1 AND is_active", [item.boutiqueLocationId])).rows[0] ?? null : null;
      item.boutiqueLocation = location; delete item.boutiqueLocationId;
    }
    return customerJson({ items, page: Number(page), hasMore: rows.length > 20 });
  } catch (error) {
    const status = error instanceof CustomerError ? error.status : (error as { status?: number }).status;
    return customerJson({ message: error instanceof CustomerError || status === 400 ? (error as Error).message : "Your account could not be verified. Please refresh to try again." }, status && [400,401,403,429].includes(status) ? status : 503);
  }
}

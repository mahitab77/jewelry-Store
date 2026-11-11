import { catalogueFixture } from "./catalogue-fixture.mts";
import { attachCustomerFixture } from "./customer-fixture.mts";

export async function requestFixture(origin?: string, seeded = true) {
  const fixture = await catalogueFixture(origin, seeded);
  try {
    const role = `"${fixture.role}"`;
    await fixture.data.query(`GRANT SELECT ON product_enquiries,bespoke_requests,appointment_requests,boutique_locations,cart_rate_limits TO ${role}`);
    for (const table of ["product_enquiries", "bespoke_requests", "appointment_requests"]) {
      await fixture.data.query(`GRANT INSERT(id,product_id,variant_id,contact_name,contact_email,contact_phone,message,product_context${table === "appointment_requests" ? ",consultation_channel,preferred_start_at" : ""}) ON ${table} TO ${role}`);
      await fixture.data.query(`GRANT UPDATE(status,assigned_admin_id,updated_at${table === "appointment_requests" ? ",confirmed_start_at,boutique_location_id" : ""}) ON ${table} TO ${role}`);
    }
    await fixture.data.query(`GRANT INSERT,UPDATE,DELETE ON cart_rate_limits TO ${role}`);
    await fixture.data.query(`GRANT UPDATE(updated_at) ON admin_users,boutique_locations TO ${role}`);
    const customer = await attachCustomerFixture(fixture);
    return { ...fixture, ...customer, async close() { await customer.closeCustomer(); await fixture.close(); } };
  } catch (error) { await fixture.close(); throw error; }
}

import { randomUUID } from 'node:crypto';
import { cartFixture } from './cart-fixture.mts';
import { closeDatabase } from '../../src/lib/db/client.ts';

export async function paymentFixture(origin='https://payments.boutique.test') {
  const f=await cartFixture(origin), role='lapalme_payment_'+randomUUID().replaceAll('-','');let created=false;
  try{
    await f.data.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);created=true;
    await f.data.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await f.data.query(`GRANT SELECT ON products,product_variants,product_prices,product_media,inventory,boutique_locations,carts,cart_items,checkout_drafts,
      orders,order_items,order_addresses,payments,payment_events,inventory_reservations,order_status_history TO "${role}"`);
    // PostgreSQL requires UPDATE on at least one column for FOR SHARE locks.
    // Grant timestamps only, never catalogue prices, publication or destinations.
    await f.data.query(`GRANT UPDATE(updated_at) ON products,product_variants,product_prices,boutique_locations TO "${role}"`);
    await f.data.query(`GRANT INSERT ON carts,orders,order_items,order_addresses,payments,payment_events,inventory_reservations,order_status_history TO "${role}"`);
    await f.data.query(`GRANT UPDATE(status,session_token_hash,updated_at) ON carts TO "${role}"`);
    await f.data.query(`GRANT UPDATE(cart_id) ON cart_items TO "${role}"`);
    await f.data.query(`GRANT DELETE ON cart_items,checkout_drafts TO "${role}"`);
    await f.data.query(`GRANT UPDATE(cart_id,updated_at) ON checkout_drafts TO "${role}"`);
    await f.data.query(`GRANT UPDATE(on_hand,reserved,updated_at) ON inventory TO "${role}"`);
    await f.data.query(`GRANT UPDATE(order_status,payment_status,inventory_finalized_at,reconciliation_required,reconciliation_reason,updated_at) ON orders TO "${role}"`);
    await f.data.query(`GRANT UPDATE(provider_order_reference,provider_intention_reference,provider_transaction_reference,status,succeeded_at,initiation_state,
      checkout_client_secret,checkout_resume_until,next_reconcile_at,reconcile_lease_until,reconcile_attempts,last_error_code,updated_at) ON payments TO "${role}"`);
    await f.data.query(`GRANT UPDATE(status,ended_at,updated_at) ON inventory_reservations TO "${role}"`);
    await f.data.query(`GRANT UPDATE(payment_id,status,processing_attempts,last_error_code,processed_at) ON payment_events TO "${role}"`);
    await f.data.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON cart_rate_limits TO "${role}"`);
    const url=new URL(f.ownerUrl);url.username=role;url.password='';
    return {...f,paymentUrl:url.toString(),paymentRole:role,async close(){await closeDatabase();await f.data.query(`DROP OWNED BY "${role}"`);await f.data.query(`DROP ROLE "${role}"`);await f.close();}};
  }catch(error){if(created){await f.data.query(`DROP OWNED BY "${role}"`);await f.data.query(`DROP ROLE "${role}"`);}await f.close();throw error;}
}

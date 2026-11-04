import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { developmentId as id } from '../../db/tools/seed.ts';
import { tokenHash } from '../../src/lib/cart/session.ts';

// Disposable local test-mode snapshots. No payment, reservation, checkout
// initiation or provider request is needed to test read-only order status.
export async function orderStatusData(data:Pool,token:string,cartId?:string) {
  const hash=tokenHash(token),reference=randomUUID();
  const cart=cartId??(await data.query(`INSERT INTO carts(session_token_hash,currency,expires_at)
    VALUES($1,'EGP',clock_timestamp()+INTERVAL '1 day') RETURNING id`,[hash])).rows[0].id;
  await data.query(`INSERT INTO orders(id,order_number,source_cart_id,customer_name,customer_email,customer_phone,
    subtotal_minor,total_minor,payment_status,fulfillment_method,test_mode,guest_session_hash,guest_access_expires_at,checkout_fingerprint,checkout_draft_revision)
    VALUES($1,$2,$3,'Local status fixture','status@example.test','01000000000',490000,490000,'PENDING','PRIVATE_DELIVERY',true,$4,
      clock_timestamp()+INTERVAL '1 hour',repeat('0',64),clock_timestamp())`,[reference,'LOCAL-STATUS-'+reference,cart,hash]);
  await data.query(`INSERT INTO order_items(order_id,product_id,variant_id,sku_snapshot,product_name_snapshot,configuration_snapshot,quantity,unit_price_minor)
    VALUES($1,$2,$3,'LOCAL-STATUS-102','Local status fixture jewellery','Local yellow setting',2,245000)`,[reference,id(102),id(202)]);
  return {reference,cartId:cart};
}

import 'server-only';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { newToken, tokenHash } from '../cart/session.ts';

export interface OrderRow {
  id:string; source_cart_id:string; guest_session_hash:string; guest_access_expires_at:Date; test_mode:boolean;
  customer_name:string; customer_email:string; customer_phone:string; currency:string; total_minor:string;
  order_status:string; payment_status:string; fulfillment_method:'PRIVATE_DELIVERY'|'BOUTIQUE_COLLECTION'; fulfillment_status:string;
  checkout_fingerprint:string; checkout_draft_revision:Date; inventory_finalized_at:Date|null;
  reconciliation_required:boolean; reconciliation_reason:string|null; boutique_location_id:string|null;
  boutique_location_snapshot:{id:string;name:string;governorate:string;city:string;street:string}|null;
}
export interface PaymentRow {
  id:string; local_reference:string; order_id:string; amount_minor:string; currency:string; status:string;
  integration_id:string; owner_id:string; initiation_state:string; checkout_client_secret:string|null;
  provider_order_reference:string|null; provider_intention_reference:string|null; provider_transaction_reference:string|null;
  checkout_resume_until:Date|null; previous_payment_id:string|null; reconcile_lease_until:Date|null;
}
export interface LineRow { product_id:string;variant_id:string;sku_snapshot:string;product_name_snapshot:string;configuration_snapshot:string;quantity:number;unit_price_minor:string;source_cart_item_id:string;source_cart_item_updated_at:Date }
export async function ownerLock(client:PoolClient, hash:string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,909))',[hash]);
  return (await client.query<{id:string;expires_at:Date;status:string;customer_profile_id:string|null}>(`SELECT id,expires_at,status,customer_profile_id FROM carts WHERE session_token_hash=$1 FOR UPDATE`,[hash])).rows[0];
}
export async function lockSelections(client:PoolClient, variantIds:string[]) {
  await client.query(`SELECT p.id FROM products p JOIN product_variants v ON v.product_id=p.id WHERE v.id=ANY($1::UUID[]) ORDER BY p.id FOR SHARE OF p`,[variantIds]);
  await client.query(`SELECT id FROM product_variants WHERE id=ANY($1::UUID[]) ORDER BY id FOR SHARE`,[variantIds]);
  await client.query(`SELECT id FROM product_prices WHERE variant_id=ANY($1::UUID[]) AND is_active AND currency='EGP' ORDER BY id FOR SHARE`,[variantIds]);
  await client.query(`SELECT variant_id FROM inventory WHERE variant_id=ANY($1::UUID[]) ORDER BY variant_id FOR UPDATE`,[variantIds]);
  const inconsistent=await client.query(`SELECT i.variant_id FROM inventory i LEFT JOIN inventory_reservations r ON r.variant_id=i.variant_id AND r.status='ACTIVE'
    WHERE i.variant_id=ANY($1::UUID[]) GROUP BY i.variant_id,i.reserved HAVING i.reserved<>COALESCE(sum(r.quantity),0)`,[variantIds]);
  if(inconsistent.rowCount)throw new Error('Inventory ledger requires operator reconciliation.');
}
export async function reserve(client:PoolClient, orderId:string, cartId:string, paymentId:string, lines:{variantId:string;quantity:number}[]) {
  for(const line of [...lines].sort((a,b)=>a.variantId.localeCompare(b.variantId))) {
    const changed=await client.query(`UPDATE inventory SET reserved=reserved+$2,updated_at=clock_timestamp() WHERE variant_id=$1 AND on_hand-reserved>=$2 RETURNING id`,[line.variantId,line.quantity]);
    if(changed.rowCount!==1)throw new Error('Reservation invariant failed.');
    await client.query(`INSERT INTO inventory_reservations(variant_id,quantity,cart_id,order_id,payment_id,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+INTERVAL '15 minutes')`,[line.variantId,line.quantity,cartId,orderId,paymentId]);
  }
}
export async function history(client:PoolClient, order:OrderRow, domain:'ORDER'|'PAYMENT', target:string, reason:string) {
  const before=domain==='ORDER'?order.order_status:order.payment_status; if(before===target)return;
  await client.query(`INSERT INTO order_status_history(order_id,state_domain,from_status,to_status,actor_kind,reason) VALUES($1,$2,$3,$4,'SYSTEM',$5)`,[order.id,domain,before,target,reason]);
  if(domain==='ORDER'){await client.query('UPDATE orders SET order_status=$2,updated_at=clock_timestamp() WHERE id=$1',[order.id,target]);order.order_status=target;}
  else{await client.query('UPDATE orders SET payment_status=$2,updated_at=clock_timestamp() WHERE id=$1',[order.id,target]);order.payment_status=target;}
}
export async function flag(client:PoolClient, orderId:string, reason:string) {
  await client.query(`UPDATE orders SET reconciliation_required=true,reconciliation_reason=CASE
    WHEN reconciliation_reason IN ('PROVIDER_STATUS_REVIEW','LATE_SUCCESS','DUPLICATE_PAYMENT','INVENTORY_MISMATCH','REFERENCE_CONFLICT') AND $2 IN ('PROVIDER_OUTCOME_UNKNOWN','RESERVATION_EXPIRED_UNCERTAIN')
    THEN reconciliation_reason ELSE $2 END,updated_at=clock_timestamp() WHERE id=$1`,[orderId,reason]);
}
export async function paymentRows(client:PoolClient, orderId:string) { return (await client.query<PaymentRow>('SELECT * FROM payments WHERE order_id=$1 AND test_mode ORDER BY created_at,id FOR UPDATE',[orderId])).rows; }
export async function orderRow(client:PoolClient, id:string) { return (await client.query<OrderRow>('SELECT * FROM orders WHERE id=$1 AND test_mode FOR UPDATE',[id])).rows[0]; }
export async function orderLines(client:PoolClient, id:string) { return (await client.query<LineRow>('SELECT * FROM order_items WHERE order_id=$1 ORDER BY variant_id',[id])).rows; }
export async function newPayment(client:PoolClient, order:OrderRow, integrationId:string, ownerId:string, previous:string|null=null) {
  return (await client.query<PaymentRow>(`INSERT INTO payments(order_id,currency,amount_minor,status,test_mode,integration_id,owner_id,previous_payment_id)
    VALUES($1,'EGP',$2,'CREATED',true,$3,$4,$5) RETURNING *`,[order.id,order.total_minor,integrationId,ownerId,previous])).rows[0];
}

// Keep the existing source-cart uniqueness. A terminal order converts its source
// bag; a new ordinary cart inherits the SAME token hash/cookie and remaining
// selections. Order access is pinned separately to that verified guest hash.
export async function reconcileBag(client:PoolClient, order:OrderRow, purchased:boolean) {
  const bag=(await client.query<{id:string;expires_at:Date}>(`SELECT id,expires_at FROM carts WHERE session_token_hash=$1 AND status='ACTIVE' AND customer_profile_id IS NULL AND expires_at>clock_timestamp() FOR UPDATE`,[order.guest_session_hash])).rows[0];
  if(!bag)return;
  if(purchased)await client.query(`DELETE FROM cart_items ci USING order_items oi WHERE oi.order_id=$1 AND ci.cart_id=$2
    AND ci.id=oi.source_cart_item_id AND ci.updated_at=oi.source_cart_item_updated_at AND ci.quantity=oi.quantity`,[order.id,bag.id]);
  await client.query(`DELETE FROM checkout_drafts d USING orders o WHERE o.id=$1 AND d.cart_id=$2 AND d.updated_at=o.checkout_draft_revision`,[order.id,bag.id]);
  await client.query(`UPDATE carts SET status='CONVERTED',session_token_hash=$2,updated_at=clock_timestamp() WHERE id=$1`,[bag.id,tokenHash('retired:'+randomUUID()+newToken())]);
  const next=(await client.query<{id:string}>(`INSERT INTO carts(session_token_hash,currency,expires_at)
    SELECT $1,'EGP',$2 WHERE $2>clock_timestamp() RETURNING id`,[order.guest_session_hash,bag.expires_at])).rows[0];
  if(next){await client.query('UPDATE cart_items SET cart_id=$2 WHERE cart_id=$1',[bag.id,next.id]);await client.query('UPDATE checkout_drafts SET cart_id=$2,updated_at=clock_timestamp() WHERE cart_id=$1',[bag.id,next.id]);}
}

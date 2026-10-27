import 'server-only';
import type { PoolClient } from 'pg';
import { withTransaction } from '../db/client.ts';
import { flag,history,orderRow,ownerLock,paymentRows,reconcileBag,type OrderRow,type PaymentRow } from './persistence.ts';
import type { VerifiedTransaction } from './types.ts';

async function stockEnd(client:PoolClient,payment:PaymentRow,consume:boolean):Promise<boolean> {
  const holds=(await client.query<{id:string;variant_id:string;quantity:number}>(`SELECT id,variant_id,quantity FROM inventory_reservations WHERE payment_id=$1 AND status='ACTIVE' ORDER BY variant_id FOR UPDATE`,[payment.id])).rows;
  if(!holds.length)return false;
  const stock=(await client.query<{variant_id:string;on_hand:number;reserved:number}>(`SELECT variant_id,on_hand,reserved FROM inventory WHERE variant_id=ANY($1::UUID[]) ORDER BY variant_id FOR UPDATE`,[holds.map(h=>h.variant_id)])).rows;
  for(const h of holds){
    const s=stock.find(s=>s.variant_id===h.variant_id), active=(await client.query<{total:string}>(`SELECT COALESCE(sum(quantity),0)::TEXT AS total FROM inventory_reservations WHERE variant_id=$1 AND status='ACTIVE'`,[h.variant_id])).rows[0];
    if(!s || s.reserved!==Number(active.total) || s.reserved<h.quantity || (consume && s.on_hand<h.quantity))return false;
  }
  if(consume){
    const lines=(await client.query<{variant_id:string;quantity:number}>('SELECT variant_id,quantity FROM order_items WHERE order_id=$1 ORDER BY variant_id',[payment.order_id])).rows;
    if(lines.length!==holds.length || lines.some(l=>!holds.some(h=>h.variant_id===l.variant_id && h.quantity===l.quantity)))return false;
  }
  for(const h of holds){
    const changed=await client.query(`UPDATE inventory SET reserved=reserved-$2,on_hand=on_hand-CASE WHEN $3 THEN $2 ELSE 0 END,updated_at=clock_timestamp() WHERE variant_id=$1 AND reserved>=$2 AND on_hand>=reserved RETURNING id`,[h.variant_id,h.quantity,consume]);
    if(changed.rowCount!==1)throw new Error('Stock finalization invariant failed.');
  }
  await client.query(`UPDATE inventory_reservations SET status=$2,ended_at=clock_timestamp(),updated_at=clock_timestamp() WHERE payment_id=$1 AND status='ACTIVE'`,[payment.id,consume?'CONSUMED':'RELEASED']);
  return true;
}
async function failed(client:PoolClient, order:OrderRow,payment:PaymentRow,reason:string) {
  if(['SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED','FAILED','CANCELLED','EXPIRED'].includes(payment.status))return;
  await client.query(`UPDATE payments SET status='FAILED',checkout_client_secret=NULL,last_error_code=$2,updated_at=clock_timestamp() WHERE id=$1`,[payment.id,reason]);
  const released=await stockEnd(client,payment,false);
  if(!released)await flag(client,order.id,'INVENTORY_MISMATCH');
  const paid=await client.query(`SELECT 1 FROM payments WHERE order_id=$1 AND status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED') LIMIT 1`,[order.id]);
  if(!paid.rowCount && !order.inventory_finalized_at){
    await history(client,order,'PAYMENT','FAILED',reason);await history(client,order,'ORDER','CANCELLED',reason);
    if(released){
      await client.query(`UPDATE orders SET reconciliation_required=false,reconciliation_reason=NULL WHERE id=$1 AND reconciliation_reason IN ('PROVIDER_OUTCOME_UNKNOWN','RESERVATION_EXPIRED_UNCERTAIN')`,[order.id]);
      await reconcileBag(client,order,false);
    }
  }
}
export async function rejectProvider(paymentId:string) {
  return withTransaction(async client=>{
    const found=(await client.query<{order_id:string;guest_session_hash:string}>(`SELECT p.order_id,o.guest_session_hash FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1 AND p.test_mode`,[paymentId])).rows[0];if(!found)return;
    await ownerLock(client,found.guest_session_hash);const order=await orderRow(client,found.order_id);if(!order)return;
    const payment=(await paymentRows(client,order.id)).find(p=>p.id===paymentId);if(!payment)return;
    if(!['CREATED','PENDING'].includes(payment.status))return;
    await client.query(`UPDATE payments SET initiation_state='REJECTED' WHERE id=$1`,[payment.id]);
    await failed(client,order,payment,'PROVIDER_REQUEST_REJECTED');
  },false,'payment');
}

async function businessEvent(client:PoolClient,order:OrderRow,payment:PaymentRow,event:VerifiedTransaction) {
  if(event.outcome==='REVIEW'){
    await flag(client,order.id,'PROVIDER_STATUS_REVIEW');
    return;
  }
  if(event.outcome==='PENDING')return;
  if(event.outcome==='FAILED'){await failed(client,order,payment,'VERIFIED_PAYMENT_FAILED');return;}
  if(['SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED'].includes(payment.status)){
    if(payment.provider_transaction_reference!==event.transactionId)await flag(client,order.id,'DUPLICATE_PAYMENT');
    return;
  }
  const otherSuccess=await client.query(`SELECT 1 FROM payments WHERE order_id=$1 AND id<>$2 AND status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED') LIMIT 1`,[order.id,payment.id]);
  await client.query(`UPDATE payments SET status='SUCCEEDED',provider_transaction_reference=$2,succeeded_at=clock_timestamp(),checkout_client_secret=NULL,last_error_code=NULL,updated_at=clock_timestamp() WHERE id=$1`,[payment.id,event.transactionId]);
  await history(client,order,'PAYMENT','PAID','VERIFIED_TEST_PAYMENT');
  if(otherSuccess.rowCount || order.inventory_finalized_at){await stockEnd(client,payment,false);await flag(client,order.id,'DUPLICATE_PAYMENT');return;}
  const consumed=await stockEnd(client,payment,true);
  if(!consumed){await flag(client,order.id,'LATE_SUCCESS');return;}
  await client.query(`UPDATE orders SET inventory_finalized_at=clock_timestamp(),reconciliation_required=CASE WHEN reconciliation_reason IN ('PROVIDER_OUTCOME_UNKNOWN','RESERVATION_EXPIRED_UNCERTAIN') THEN false ELSE reconciliation_required END,
    reconciliation_reason=CASE WHEN reconciliation_reason IN ('PROVIDER_OUTCOME_UNKNOWN','RESERVATION_EXPIRED_UNCERTAIN') THEN NULL ELSE reconciliation_reason END,updated_at=clock_timestamp() WHERE id=$1`,[order.id]);
  await history(client,order,'ORDER','CONFIRMED','VERIFIED_TEST_PAYMENT');
  await reconcileBag(client,order,true);
}

// Normalized events contain no PAN, card tokens, contact, headers or raw bodies.
// Unknown signed order references are durably retained but not acknowledged as
// processed. They can be replayed once an authenticated intention/inquiry binds.
export async function processVerifiedEvent(event:VerifiedTransaction) {
  return withTransaction(async client=>{
    const candidate=(await client.query<{order_id:string;guest_session_hash:string}>(`SELECT p.order_id,o.guest_session_hash FROM payments p JOIN orders o ON o.id=p.order_id
      WHERE p.test_mode AND o.test_mode AND p.provider_order_reference=$1`,[event.providerOrderId])).rows[0];
    if(candidate)await ownerLock(client,candidate.guest_session_hash);
    const inserted=(await client.query<{id:string;status:string}>(`INSERT INTO payment_events(provider,deduplication_key,provider_transaction_reference,provider_status_code,signature_verified,status,verified_payload,verification_source)
      VALUES('PAYMOB',$1,$2,$3,$4,'RECEIVED',$5,$6) ON CONFLICT(provider,deduplication_key) DO UPDATE SET processing_attempts=payment_events.processing_attempts+1 RETURNING id,status`,
      [event.proof,event.transactionId,event.outcome,event.source==='PAYMOB_HMAC',JSON.stringify(event),event.source])).rows[0];
    if(['PROCESSED','IGNORED'].includes(inserted.status))return {status:200};
    if(!candidate){await client.query(`UPDATE payment_events SET status='FAILED',last_error_code='UNMATCHED_PROVIDER_REFERENCE' WHERE id=$1`,[inserted.id]);return {status:409};}
    const order=await orderRow(client,candidate.order_id);if(!order)throw new Error('Order correlation failed.');
    const payment=(await paymentRows(client,order.id)).find(p=>p.provider_order_reference===event.providerOrderId);if(!payment)throw new Error('Payment correlation failed.');
    if(payment.amount_minor!==event.amountMinor || order.total_minor!==event.amountMinor || payment.currency!==event.currency || order.currency!==event.currency || payment.integration_id!==event.integrationId || payment.owner_id!==event.ownerId){
      await client.query(`UPDATE payment_events SET payment_id=$2,status='FAILED',last_error_code='CORRELATION_MISMATCH' WHERE id=$1`,[inserted.id,payment.id]);await flag(client,order.id,'REFERENCE_CONFLICT');return {status:400};
    }
    const duplicateTransaction=await client.query(`SELECT id FROM payments WHERE provider='PAYMOB' AND provider_transaction_reference=$1 AND id<>$2 LIMIT 1`,[event.transactionId,payment.id]);
    if(duplicateTransaction.rowCount){await flag(client,order.id,'REFERENCE_CONFLICT');return {status:409};}
    await businessEvent(client,order,payment,event);
    await client.query(`UPDATE payment_events SET payment_id=$2,status='PROCESSED',processed_at=clock_timestamp(),last_error_code=NULL,processing_attempts=processing_attempts+1 WHERE id=$1`,[inserted.id,payment.id]);
    return {status:200};
  },false,'payment');
}

export async function replayVerifiedEvents(providerOrderId:string) {
  const events=await withTransaction(async client=>(await client.query<{verified_payload:VerifiedTransaction}>(`SELECT verified_payload FROM payment_events WHERE status IN ('RECEIVED','FAILED') AND verified_payload->>'providerOrderId'=$1 ORDER BY received_at,id LIMIT 50`,[providerOrderId])).rows,false,'payment');
  for(const row of events)await processVerifiedEvent(row.verified_payload);
}

export async function operatorCloseUnpaid(paymentId:string,evidence:string) {
  return withTransaction(async client=>{
    const candidate=(await client.query<{order_id:string;guest_session_hash:string}>(`SELECT p.order_id,o.guest_session_hash FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1 AND p.test_mode`,[paymentId])).rows[0];if(!candidate)return false;
    await ownerLock(client,candidate.guest_session_hash);const order=await orderRow(client,candidate.order_id);if(!order)return false;
    const payments=await paymentRows(client,order.id), payment=payments.find(p=>p.id===paymentId);
    if(!payment || ['SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED'].includes(payment.status) || payment.initiation_state==='DISPATCHING' || payment.reconcile_lease_until && payment.reconcile_lease_until.getTime()>Date.now())return false;
    if(['FAILED','CANCELLED','EXPIRED'].includes(payment.status)){
      const remaining=await client.query(`SELECT 1 FROM inventory_reservations WHERE payment_id=$1 AND status='ACTIVE'`,[payment.id]);
      return !remaining.rowCount || await stockEnd(client,payment,false);
    }
    await failed(client,order,payment,'OPERATOR_CONFIRMED_PROVIDER_CLOSED_UNPAID:'+evidence);
    await client.query(`UPDATE payments SET status='CANCELLED',checkout_client_secret=NULL,last_error_code='OPERATOR_CONFIRMED_CLOSED_UNPAID' WHERE id=$1`,[payment.id]);
    await client.query(`UPDATE orders SET reconciliation_required=false,reconciliation_reason=NULL WHERE id=$1 AND reconciliation_reason IN ('PROVIDER_OUTCOME_UNKNOWN','RESERVATION_EXPIRED_UNCERTAIN')`,[order.id]);
    return true;
  },false,'payment');
}

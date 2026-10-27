import 'server-only';
import { withTransaction } from '../db/client.ts';
import { createPaymobAdapter,ProviderFailure,type IntentionInput,type Intention } from './paymob.ts';
import { hostedCheckout,INTENTION_SECONDS,paymobConfig,requirePaymentInitiation } from './config.ts';
import { initiateLocal,readOrder,retryLocal,type LocalResult } from './orders.ts';
import { flag,orderRow,ownerLock,paymentRows,type PaymentRow } from './persistence.ts';
import { processVerifiedEvent,rejectProvider,replayVerifiedEvents,operatorCloseUnpaid } from './lifecycle.ts';
import { PaymentError,type VerifiedTransaction } from './types.ts';

async function attemptTransaction<T>(paymentId:string,operation:(client:import('pg').PoolClient,payment:PaymentRow,order:NonNullable<Awaited<ReturnType<typeof orderRow>>>)=>Promise<T>) {
  return withTransaction(async client=>{
    const candidate=(await client.query<{order_id:string;guest_session_hash:string}>(`SELECT p.order_id,o.guest_session_hash FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1 AND p.test_mode AND o.test_mode`,[paymentId])).rows[0];
    if(!candidate)throw new Error('Payment not found.');
    await ownerLock(client,candidate.guest_session_hash);const order=await orderRow(client,candidate.order_id);
    const payment=order?(await paymentRows(client,order.id)).find(p=>p.id===paymentId):null;if(!order || !payment)throw new Error('Payment not found.');
    return operation(client,payment,order);
  },false,'payment');
}
async function claimDispatch(paymentId:string):Promise<IntentionInput|null> {
  return attemptTransaction(paymentId,async(client,p,o)=>{
    if(p.initiation_state!=='LOCAL_READY' || p.status!=='CREATED' || o.reconciliation_required)return null;
    if(p.reconcile_lease_until && p.reconcile_lease_until.getTime()>Date.now())return null;
    const expired=await client.query(`SELECT 1 FROM inventory_reservations WHERE payment_id=$1 AND status='ACTIVE' AND expires_at<=clock_timestamp() LIMIT 1`,[p.id]);
    if(expired.rowCount){await flag(client,o.id,'RESERVATION_EXPIRED_UNCERTAIN');return null;}
    await client.query(`UPDATE payments SET initiation_state='DISPATCHING',status='PENDING',reconcile_lease_until=clock_timestamp()+INTERVAL '30 seconds',next_reconcile_at=clock_timestamp()+INTERVAL '30 seconds',updated_at=clock_timestamp() WHERE id=$1`,[p.id]);
    return {reference:p.local_reference,orderReference:o.id,amountMinor:p.amount_minor,fullName:o.customer_name,email:o.customer_email,phone:o.customer_phone};
  });
}
async function uncertain(paymentId:string) {
  return attemptTransaction(paymentId,async(client,p,o)=>{
    if(!['CREATED','PENDING'].includes(p.status))return;
    await client.query(`UPDATE payments SET initiation_state='UNCERTAIN',reconcile_lease_until=NULL,last_error_code='PROVIDER_OUTCOME_UNKNOWN',next_reconcile_at=clock_timestamp()+INTERVAL '1 minute',updated_at=clock_timestamp() WHERE id=$1`,[p.id]);
    await flag(client,o.id,'PROVIDER_OUTCOME_UNKNOWN');
  });
}
async function attachIntention(paymentId:string,intention:Intention) {
  await attemptTransaction(paymentId,async(client,p)=>{
    if(p.provider_order_reference && p.provider_order_reference!==intention.orderId)throw new Error('Conflicting provider identity.');
    await client.query(`UPDATE payments SET provider_order_reference=$2,provider_intention_reference=$3,checkout_client_secret=CASE WHEN status IN ('CREATED','PENDING') THEN $4 ELSE NULL END,
      initiation_state='READY',checkout_resume_until=clock_timestamp()+$5*INTERVAL '1 second',reconcile_lease_until=NULL,next_reconcile_at=clock_timestamp()+INTERVAL '1 minute',updated_at=clock_timestamp() WHERE id=$1`,[p.id,intention.orderId,intention.id,intention.clientSecret,INTENTION_SECONDS]);
  });
  await replayVerifiedEvents(intention.orderId);
}
async function finish(token:string, local:LocalResult,transport:typeof fetch,allowRedirect=true) {
  if('error'in local)throw new PaymentError(local.error.message,local.error.status);
  const config=requirePaymentInitiation(), claimed=allowRedirect?await claimDispatch(local.payment.id):null;
  if(claimed){
    // External HTTP begins only after the claim/stock transaction has committed.
    try {const intention=await createPaymobAdapter(config,transport).create(claimed);await attachIntention(local.payment.id,intention);}
    catch(error){if(error instanceof ProviderFailure && error.definitive)await rejectProvider(local.payment.id);else await uncertain(local.payment.id);}
  }
  const order=await readOrder(token,local.order.id);if(!order)throw new PaymentError('This order is unavailable.',404);
  const checkoutUrl=await attemptTransaction(local.payment.id,async(_client,p,o)=>allowRedirect && ['CREATED','PENDING'].includes(p.status) && p.initiation_state==='READY' && p.checkout_client_secret && p.checkout_resume_until && p.checkout_resume_until.getTime()>Date.now() && !o.reconciliation_required ? hostedCheckout(p.checkout_client_secret,config.publicKey):null);
  return {orderReference:order.reference,orderUrl:'/orders/'+order.reference,checkoutUrl};
}
export async function initiatePayment(token:string,fingerprint:string,revision:string,transport:typeof fetch=fetch) {
  const local=await initiateLocal(token,fingerprint,revision);
  return finish(token,local,transport,!('error'in local) && local.order.checkout_fingerprint===fingerprint);
}
export async function retryPayment(token:string,reference:string,attemptReference:string,transport:typeof fetch=fetch) {
  return finish(token,await retryLocal(token,reference,attemptReference),transport);
}

async function applyInquiry(paymentId:string,event:VerifiedTransaction) {
  const bound=await attemptTransaction(paymentId,async(client,p,o)=>{
    if(event.specialReference!==p.local_reference || event.amountMinor!==p.amount_minor || event.currency!==p.currency || event.integrationId!==p.integration_id || event.ownerId!==p.owner_id || p.provider_order_reference && p.provider_order_reference!==event.providerOrderId){await flag(client,o.id,'REFERENCE_CONFLICT');return false;}
    await client.query(`UPDATE payments SET provider_order_reference=COALESCE(provider_order_reference,$2),updated_at=clock_timestamp() WHERE id=$1`,[p.id,event.providerOrderId]);return true;
  });
  if(bound){const result=await processVerifiedEvent(event);await replayVerifiedEvents(event.providerOrderId);return result.status===200;}
  return false;
}
export async function reconcilePayments(limit=10,transport:typeof fetch=fetch) {
  if(!Number.isInteger(limit) || limit<1 || limit>50)throw new PaymentError('Choose a reconciliation batch between 1 and 50.',400);
  const adapter=createPaymobAdapter(paymobConfig(),transport);
  // A durable lease survives crashes and is shared across application instances.
  const jobs=await withTransaction(async client=>(await client.query<{id:string}>(`WITH jobs AS (
    SELECT id FROM payments WHERE test_mode AND status IN ('CREATED','PENDING') AND next_reconcile_at<=clock_timestamp()
      AND (reconcile_lease_until IS NULL OR reconcile_lease_until<=clock_timestamp()) ORDER BY next_reconcile_at,id LIMIT $1 FOR UPDATE SKIP LOCKED)
    UPDATE payments p SET reconcile_lease_until=clock_timestamp()+INTERVAL '45 seconds',reconcile_attempts=reconcile_attempts+1
      FROM jobs WHERE p.id=jobs.id RETURNING p.id`,[limit])).rows,false,'payment');
  let checked=0;
  for(const job of jobs){
    let candidate:PaymentRow|undefined;
    try {
      candidate=await attemptTransaction(job.id,async(client,p,o)=>{
        if(p.initiation_state==='DISPATCHING'){await client.query(`UPDATE payments SET initiation_state='UNCERTAIN',last_error_code='DISPATCH_LEASE_EXPIRED' WHERE id=$1`,[p.id]);await flag(client,o.id,'PROVIDER_OUTCOME_UNKNOWN');p.initiation_state='UNCERTAIN';}
        const expired=await client.query(`SELECT 1 FROM inventory_reservations WHERE payment_id=$1 AND status='ACTIVE' AND expires_at<=clock_timestamp() LIMIT 1`,[p.id]);
        if(expired.rowCount)await flag(client,o.id,'RESERVATION_EXPIRED_UNCERTAIN');
        return p;
      });
      // LOCAL_READY is proof that no dispatch was claimed. Nothing was sent.
      if(candidate.initiation_state==='LOCAL_READY'){
        const expired=await withTransaction(async client=>(await client.query(`SELECT 1 FROM inventory_reservations WHERE payment_id=$1 AND status='ACTIVE' AND expires_at<=clock_timestamp() LIMIT 1`,[job.id])).rowCount,false,'payment');
        if(expired)await rejectProvider(job.id);
      }else{
        const event=await adapter.inquire(candidate.local_reference);
        if(event)await applyInquiry(job.id,event);
        // A not-found inquiry is NOT proof that an intention never existed.
      }
      checked++;
    }catch{
      await attemptTransaction(job.id,async(client,p,o)=>{if(['CREATED','PENDING'].includes(p.status)){await flag(client,o.id,'PROVIDER_OUTCOME_UNKNOWN');await client.query(`UPDATE payments SET last_error_code='INQUIRY_UNCONFIRMED' WHERE id=$1`,[p.id]);}});
    }finally{
      await withTransaction(async client=>{await client.query(`UPDATE payments SET reconcile_lease_until=NULL,next_reconcile_at=clock_timestamp()+INTERVAL '1 minute',
        checkout_client_secret=CASE WHEN checkout_resume_until<=clock_timestamp() THEN NULL ELSE checkout_client_secret END WHERE id=$1`,[job.id]);},false,'payment');
    }
  }
  return {claimed:jobs.length,checked};
}
export async function listPaymentExceptions(limit=25) {
  if(!Number.isInteger(limit) || limit<1 || limit>50)throw new PaymentError('Choose a batch between 1 and 50.',400);
  return withTransaction(async client=>(await client.query(`SELECT o.id AS order_reference,p.id AS payment_reference,p.local_reference,p.provider_order_reference,p.status,p.initiation_state,o.reconciliation_reason,
    (SELECT min(expires_at) FROM inventory_reservations WHERE payment_id=p.id AND status='ACTIVE') AS reservation_expires_at
    FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.test_mode AND (o.reconciliation_required OR p.status IN ('CREATED','PENDING')) ORDER BY p.created_at,p.id LIMIT $1`,[limit])).rows,true,'payment');
}
export async function listUnmatchedPaymentEvents(limit=25) {
  if(!Number.isInteger(limit) || limit<1 || limit>50)throw new PaymentError('Choose a batch between 1 and 50.',400);
  return withTransaction(async client=>(await client.query(`SELECT id AS event_reference,provider_transaction_reference,
    verified_payload->>'providerOrderId' AS provider_order_reference,verified_payload->>'outcome' AS outcome,
    verified_payload->>'amountMinor' AS amount_minor,verified_payload->>'currency' AS currency,received_at
    FROM payment_events WHERE status IN ('RECEIVED','FAILED') AND last_error_code='UNMATCHED_PROVIDER_REFERENCE'
      AND (signature_verified OR verification_source='PAYMOB_API') ORDER BY received_at,id LIMIT $1`,[limit])).rows,true,'payment');
}
// Explicit inspection also supports cancelled attempts whose provider identity
// was unknown at closure. Late signed events remain visible until safely bound.
export async function inspectPayment(paymentId:string,transport:typeof fetch=fetch) {
  if(!/^[0-9a-f-]{36}$/.test(paymentId))throw new PaymentError('Provide a valid payment reference.',400);
  const p=await attemptTransaction(paymentId,async(_client,p)=>p),event=await createPaymobAdapter(paymobConfig(),transport).inquire(p.local_reference);
  if(!event)return false;return applyInquiry(paymentId,event);
}
export async function closeVerifiedUnpaid(paymentId:string,evidence:string,transport:typeof fetch=fetch) {
  if(!/^[0-9a-f-]{36}$/.test(paymentId) || !/^[A-Za-z0-9_.:-]{3,80}$/.test(evidence))throw new PaymentError('Provide a valid payment reference and non-personal evidence reference.',400);
  const candidate=await attemptTransaction(paymentId,async(_c,p)=>p);
  const observed=await createPaymobAdapter(paymobConfig(),transport).inquire(candidate.local_reference);
  if(observed){await applyInquiry(paymentId,observed);if(observed.outcome!=='FAILED')return false;}
  // Trusted operator attests provider closure after dashboard examination. An
  // absent transaction alone never authorizes this action or proves no charge.
  return operatorCloseUnpaid(paymentId,evidence);
}

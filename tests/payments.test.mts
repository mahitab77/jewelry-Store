import assert from 'node:assert/strict';
import { afterEach,beforeEach,test } from 'node:test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { paymentFixture } from './helpers/payment-fixture.mts';
import { paymentEnvironment,paymobMock,signedTransaction,transactionFixture } from './helpers/paymob-mock.mts';
import { deliveryDetails,checkoutContact,testLocation } from './helpers/checkout-data.mts';
import { developmentId as id } from '../db/tools/seed.ts';
import { databaseConfig } from '../src/lib/db/config.ts';
import { cartHttp } from '../src/lib/cart/http.ts';
import { checkoutHttp } from '../src/lib/checkout/http.ts';
import { paymentHttp,orderHttp } from '../src/lib/payments/http.ts';
import { transactionCanonical,verifyCallback } from '../src/lib/payments/paymob.ts';
import { paymentsAvailable } from '../src/lib/payments/config.ts';
import { initiateLocal } from '../src/lib/payments/orders.ts';
import { closeVerifiedUnpaid,inspectPayment,listPaymentExceptions,listUnmatchedPaymentEvents,reconcilePayments } from '../src/lib/payments/service.ts';
import type { CheckoutView,CheckoutDetails } from '../src/lib/checkout/types.ts';

const origin='https://payments.boutique.test',originalFetch=globalThis.fetch;
const envNames=[...Object.keys(paymentEnvironment),'CART_DATABASE_URL','CART_ORIGIN','PAYMENT_DATABASE_URL','CHECKOUT_DRAFT_RETENTION_READY'];
const old=new Map(envNames.map(key=>[key,process.env[key]]));
let f:Awaited<ReturnType<typeof paymentFixture>>,mock:ReturnType<typeof paymobMock>;
beforeEach(async()=>{
  f=await paymentFixture(origin);mock=paymobMock();
  Object.assign(process.env,paymentEnvironment,{CART_DATABASE_URL:f.cartUrl,CART_ORIGIN:origin,PAYMENT_DATABASE_URL:f.paymentUrl,CHECKOUT_DRAFT_RETENTION_READY:'true'});globalThis.fetch=mock.fakeFetch;
},{timeout:60000});
afterEach(async()=>{globalThis.fetch=originalFetch;if(f)await f.close();for(const[key,value]of old){if(value===undefined)delete process.env[key];else process.env[key]=value;}});

async function cart(session:string|undefined,method='GET',path:string[]=[],body?:unknown){
  const response=await cartHttp(new Request(origin+'/api/cart'+(path.length?'/'+path.join('/'):''),{method,headers:{...(session?{Cookie:session}:{}),Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),path);return{response,body:await response.json()};
}
async function checkout(session:string,details?:CheckoutDetails){
  const initial=await checkoutHttp(new Request(origin+'/api/checkout',{headers:{Cookie:session}}));let body=await initial.json();
  if(details){const response=await checkoutHttp(new Request(origin+'/api/checkout/draft',{method:'POST',headers:{Cookie:session,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({details,fingerprint:body.checkout.fingerprint,draftRevision:body.checkout.draft?.revision??null})}),['draft']);assert.equal(response.status,200);body=await response.json();}
  return body.checkout as CheckoutView;
}
type Guest={session:string;token:string;view:CheckoutView};
async function guest(variant=id(202),quantity=1,save=true):Promise<Guest>{
  const created=await cart(undefined,'POST',['items'],{variantId:variant,quantity});assert.equal(created.response.status,200);
  const session=created.response.headers.getSetCookie()[0].split(';')[0],token=session.split('=')[1];
  return{session,token,view:await checkout(session,save?deliveryDetails():undefined)};
}
async function initiate(a:Guest,body:unknown={fingerprint:a.view.fingerprint,draftRevision:a.view.draft?.revision??null},headers:Record<string,string>={}){
  const response=await paymentHttp(new Request(origin+'/api/payments/initiate',{method:'POST',headers:{Cookie:a.session,Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)}),['initiate']);return{response,body:await response.json()};
}
async function latest(reference:string){return(await f.data.query('SELECT * FROM payments WHERE order_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[reference])).rows[0];}
async function state(variant=id(202)){return(await f.data.query('SELECT on_hand,reserved FROM inventory WHERE variant_id=$1',[variant])).rows[0];}
async function count(table:string){assert.ok(/^(orders|payments|payment_events|order_items|order_addresses|inventory_reservations|customer_profiles|fulfillment_arrangements)$/.test(table));return Number((await f.data.query(`SELECT count(*) FROM ${table}`)).rows[0].count);}
async function event(reference:string,extra:Record<string,unknown>={}){
  const p=await latest(reference);return signedTransaction(transactionFixture(p.provider_order_reference,Number(p.amount_minor),extra));
}
async function callback(e:ReturnType<typeof signedTransaction>){return paymentHttp(new Request(origin+'/api/payments/paymob/callback?hmac='+e.signature,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(e.body)}),['paymob','callback']);}
async function status(a:Guest,reference:string){const response=await orderHttp(new Request(origin+'/api/orders/'+reference,{headers:{Cookie:a.session}}),[reference]);return{response,body:await response.json()};}
async function retry(a:Guest,reference:string,attempt?:string){const p=await latest(reference);const response=await orderHttp(new Request(origin+'/api/orders/'+reference+'/payment',{method:'POST',headers:{Cookie:a.session,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({attemptReference:attempt??p.local_reference})}),[reference,'payment']);return{response,body:await response.json()};}
async function due(reference:string,expire=false){await f.data.query(`UPDATE payments SET next_reconcile_at=now()-INTERVAL '1 minute',reconcile_lease_until=NULL WHERE order_id=$1`,[reference]);if(expire)await f.data.query(`UPDATE inventory_reservations SET created_at=now()-INTERVAL '1 hour',expires_at=now()-INTERVAL '1 minute' WHERE order_id=$1 AND status='ACTIVE'`,[reference]);}
async function observe(reference:string,extra:Record<string,unknown>={}){const p=await latest(reference),entry=mock.intentions.get(p.local_reference);assert.ok(entry);mock.observations.set(p.local_reference,transactionFixture(entry.orderId,entry.amount,{order:{id:Number(entry.orderId),merchant_order_id:p.local_reference},...extra}));}

test('the official processed-callback canonical example matches exactly; signed fields authenticate before business use',async()=>{
  const sample=transactionFixture('217503754',100000),expected='1000002024-06-13T11:33:44.592345EGPfalsefalse1920364654097558truefalsefalsefalsetruefalse217503754302852false2346MasterCardcardtrue';
  assert.equal(transactionCanonical(sample),expected);const signed=signedTransaction(sample);assert.equal(verifyCallback(signed.body,signed.signature).outcome,'SUCCEEDED');
  // Paymob publishes a redacted example secret, so its printed digest cannot be reproduced.
  assert.throws(()=>verifyCallback(signed.body,'00'.repeat(64)));signed.body.obj.amount_cents++;assert.throws(()=>verifyCallback(signed.body,signed.signature));assert.equal(await count('orders'),0);
});
test('valid checkout commits immutable snapshots and reservations before any provider HTTP begins',async()=>{
  const a=await guest();globalThis.fetch=async(input,init)=>{
    assert.equal(await count('orders'),1);assert.deepEqual(await state(),{on_hand:5,reserved:1});
    const client=await f.data.connect();try{await client.query('BEGIN');await client.query('SELECT id FROM inventory ORDER BY variant_id FOR UPDATE NOWAIT');await client.query('ROLLBACK');}finally{client.release();}
    return mock.fakeFetch(input,init);
  };
  const result=await initiate(a);assert.equal(result.response.status,200);assert.equal(new URL(result.body.checkoutUrl).origin,'https://eg.checkout.paymob.com');
  const o=(await f.data.query('SELECT * FROM orders')).rows[0];assert.ok(o.customer_name===checkoutContact.fullName);assert.equal(o.total_minor,'245000');assert.equal(o.fulfillment_status,'UNARRANGED');
  assert.equal(await count('order_items'),1);assert.equal(await count('order_addresses'),1);assert.equal(await count('customer_profiles'),0);assert.equal(await count('fulfillment_arrangements'),0);
});
test('an empty bag cannot create financial records or stock holds',async()=>{
  const a=await guest(),view=(await cart(a.session)).body.cart;
  await cart(a.session,'DELETE',['items',view.items[0].id],{revision:view.revision});assert.equal((await initiate(a)).response.status,422);assert.equal(await count('orders'),0);assert.equal(mock.calls.length,0);
});
test('missing, incomplete and expired checkout drafts are rejected without orders',async()=>{
  const a=await guest(id(202),1,false);assert.equal((await initiate(a,{fingerprint:a.view.fingerprint,draftRevision:'2026-01-01T00:00:00.000000Z'})).response.status,409);
  a.view=await checkout(a.session,{...deliveryDetails(),method:''});assert.equal((await initiate(a)).response.status,422);
  a.view=await checkout(a.session,deliveryDetails());await f.data.query(`UPDATE checkout_drafts SET created_at=now()-INTERVAL '25 hours',expires_at=now()-INTERVAL '1 hour'`);
  assert.equal((await initiate(a)).response.status,409);assert.equal(await count('orders'),0);
});
test('expired guest carts cannot initiate payment',async()=>{
  const a=await guest();await f.data.query(`UPDATE carts SET created_at=now()-INTERVAL '31 days',expires_at=now()-INTERVAL '1 hour'`);
  assert.equal((await initiate(a)).response.status,401);assert.equal(await count('orders'),0);
});
test('server validation rejects invalid saved contact fields even if a database owner inserted them',async()=>{
  const a=await guest();await f.data.query("UPDATE checkout_drafts SET full_name='',email='invalid'");assert.equal((await initiate(a)).response.status,422);assert.equal(await count('orders'),0);
});
test('collection snapshots come from active database records and never book fulfillment',async()=>{
  const l=(await f.data.query('INSERT INTO boutique_locations(name,governorate,city_area,street_address,is_active) VALUES($1,$2,$3,$4,true) RETURNING id',[testLocation.name,testLocation.governorate,testLocation.city,testLocation.street])).rows[0];
  const a=await guest();a.view=await checkout(a.session,{...deliveryDetails(),method:'BOUTIQUE_COLLECTION',locationId:l.id});const result=await initiate(a);assert.equal(result.response.status,200);
  const o=(await f.data.query('SELECT * FROM orders')).rows[0];assert.equal(o.boutique_location_id,l.id);assert.ok(o.boutique_location_snapshot.name===testLocation.name);assert.equal(await count('order_addresses'),0);assert.equal(await count('fulfillment_arrangements'),0);
});
test('inactive collection locations cannot be used from a previously saved draft',async()=>{
  const l=(await f.data.query('INSERT INTO boutique_locations(name,governorate,city_area,street_address,is_active) VALUES($1,$2,$3,$4,true) RETURNING id',[testLocation.name,testLocation.governorate,testLocation.city,testLocation.street])).rows[0];
  const a=await guest();a.view=await checkout(a.session,{...deliveryDetails(),method:'BOUTIQUE_COLLECTION',locationId:l.id});await f.data.query('UPDATE boutique_locations SET is_active=false');assert.equal((await initiate(a)).response.status,422);assert.equal(await count('orders'),0);
});
test('price and availability changes invalidate the prepared checkout rather than charging stale amounts',async()=>{
  const a=await guest();await f.data.query('UPDATE product_prices SET amount_minor=amount_minor+1 WHERE variant_id=$1 AND is_active',[id(202)]);assert.equal((await initiate(a)).response.status,409);
  a.view=await checkout(a.session,deliveryDetails());await f.data.query('UPDATE inventory SET on_hand=0 WHERE variant_id=$1',[id(202)]);assert.equal((await initiate(a)).response.status,409);assert.equal(await count('orders'),0);
});
test('unpublished and inactive variants are revalidated before order creation',async()=>{
  const a=await guest();await f.data.query("UPDATE products SET status='DRAFT' WHERE id=$1",[id(102)]);assert.equal((await initiate(a)).response.status,409);
  await f.data.query("UPDATE products SET status='PUBLISHED' WHERE id=$1",[id(102)]);a.view=await checkout(a.session,deliveryDetails());await f.data.query('UPDATE product_variants SET is_active=false WHERE id=$1',[id(202)]);assert.equal((await initiate(a)).response.status,409);assert.equal(await count('orders'),0);
});
test('simultaneous guests cannot reserve the same one-of-a-kind piece',async()=>{
  const [a,b]=await Promise.all([guest(id(201)),guest(id(201))]),results=await Promise.all([initiate(a),initiate(b)]);
  assert.deepEqual(results.map(r=>r.response.status).sort(),[200,409]);assert.deepEqual(await state(id(201)),{on_hand:1,reserved:1});assert.equal(await count('orders'),1);assert.equal(mock.calls.filter(c=>c.operation==='create').length,1);
});
test('multi-item reservations lock deterministically even when bag line orders differ',async()=>{
  const a=await guest(id(201),1,false),b=await guest(id(202),1,false);
  await cart(a.session,'POST',['items'],{variantId:id(202),quantity:1});await cart(b.session,'POST',['items'],{variantId:id(201),quantity:1});a.view=await checkout(a.session,deliveryDetails());b.view=await checkout(b.session,deliveryDetails());
  const before=(await f.data.query('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).rows[0].deadlocks;
  assert.deepEqual((await Promise.all([initiate(a),initiate(b)])).map(r=>r.response.status).sort(),[200,409]);assert.equal(await count('order_items'),2);
  assert.equal((await f.data.query('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).rows[0].deadlocks,before);
});
test('a reservation insertion failure rolls back the entire order, snapshots, payment and earlier holds',async()=>{
  const a=await guest(id(201),1,false);await cart(a.session,'POST',['items'],{variantId:id(202),quantity:1});a.view=await checkout(a.session,deliveryDetails());
  await f.data.query(`CREATE FUNCTION phase09_fail_hold() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.variant_id='${id(202)}'::UUID THEN RAISE EXCEPTION 'Fixture reservation failure'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER phase09_fail_hold BEFORE INSERT ON inventory_reservations FOR EACH ROW EXECUTE FUNCTION phase09_fail_hold()`);
  assert.equal((await initiate(a)).response.status,503);for(const table of ['orders','payments','order_items','order_addresses','inventory_reservations'])assert.equal(await count(table),0);assert.deepEqual(await state(id(201)),{on_hand:1,reserved:0});assert.equal(mock.calls.length,0);
});
test('concurrent duplicate initiations create one order, one attempt and one provider request',async()=>{
  const a=await guest(),responses=await Promise.all([initiate(a),initiate(a),initiate(a)]);assert.ok(responses.every(r=>r.response.status===200));assert.equal(new Set(responses.map(r=>r.body.orderReference)).size,1);
  assert.equal(await count('orders'),1);assert.equal(await count('payments'),1);assert.equal(mock.calls.filter(c=>c.operation==='create').length,1);assert.deepEqual(await state(),{on_hand:5,reserved:1});
});
test('provider timeouts remain uncertain and repeated customer submissions never dispatch again',async()=>{
  const a=await guest();mock.failures.timeout=true;const result=await initiate(a);assert.equal(result.response.status,200);assert.equal(result.body.checkoutUrl,null);
  assert.equal((await latest(result.body.orderReference)).initiation_state,'UNCERTAIN');assert.equal((await status(a,result.body.orderReference)).body.order.reconciliationRequired,true);assert.deepEqual(await state(),{on_hand:5,reserved:1});
  assert.equal((await initiate(a)).response.status,200);assert.equal(mock.calls.filter(c=>c.operation==='create').length,1);
  const prepared=await checkoutHttp(new Request(origin+'/api/checkout',{headers:{Cookie:a.session}}));assert.equal((await prepared.json()).pendingOrderUrl,result.body.orderUrl);
});
test('lost responses recover through authenticated inquiry and replay callbacks received before correlation',async()=>{
  const a=await guest();mock.failures.afterCreate=true;const result=await initiate(a),p=await latest(result.body.orderReference),remote=mock.intentions.get(p.local_reference)!;
  const early=signedTransaction(transactionFixture(remote.orderId,remote.amount));assert.equal((await callback(early)).status,409);
  await observe(result.body.orderReference);await due(result.body.orderReference);const reconciled=await reconcilePayments(10,mock.fakeFetch);assert.equal(reconciled.checked,1);
  assert.equal((await status(a,result.body.orderReference)).body.order.paymentStatus,'PAID');assert.deepEqual(await state(),{on_hand:4,reserved:0});assert.equal((await callback(early)).status,200);assert.deepEqual(await state(),{on_hand:4,reserved:0});
});
test('malformed or live intention responses are quarantined without a checkout redirect or stock release',async()=>{
  const a=await guest();mock.failures.malformed=true;const result=await initiate(a);assert.equal(result.body.checkoutUrl,null);assert.equal((await latest(result.body.orderReference)).initiation_state,'UNCERTAIN');assert.deepEqual(await state(),{on_hand:5,reserved:1});
});
test('a definitive provider rejection releases reservations once while preserving order history and guest selections',async()=>{
  const a=await guest();mock.failures.rejected=true;const result=await initiate(a);assert.equal((await latest(result.body.orderReference)).status,'FAILED');assert.deepEqual(await state(),{on_hand:5,reserved:0});assert.equal((await cart(a.session)).body.cart.count,1);assert.equal(await count('orders'),1);
});
test('verified success finalizes stock exactly once across simultaneous duplicate callbacks',async()=>{
  const a=await guest(),result=await initiate(a),e=await event(result.body.orderReference);
  const responses=await Promise.all(Array.from({length:12},()=>callback(e)));assert.ok(responses.every(r=>r.status===200));assert.deepEqual(await state(),{on_hand:4,reserved:0});
  const order=(await status(a,result.body.orderReference)).body.order;assert.equal(order.paymentStatus,'PAID');assert.equal(order.orderStatus,'CONFIRMED');assert.equal(order.inventoryFinalized,true);assert.equal(order.fulfillmentStatus,'UNARRANGED');
  assert.equal((await cart(a.session)).body.cart.count,0);assert.equal(await count('payment_events'),1);assert.equal(await count('fulfillment_arrangements'),0);
});
test('failed and pending callbacks cannot overwrite a previously verified success',async()=>{
  const a=await guest(),result=await initiate(a),ref=result.body.orderReference;assert.equal((await callback(await event(ref))).status,200);
  assert.equal((await callback(await event(ref,{success:false,error_occured:true}))).status,200);assert.equal((await callback(await event(ref,{pending:true}))).status,200);
  assert.equal((await status(a,ref)).body.order.paymentStatus,'PAID');assert.deepEqual(await state(),{on_hand:4,reserved:0});
});
test('signed callbacks with wrong amounts or currency never mark an order paid',async()=>{
  const a=await guest(),result=await initiate(a),ref=result.body.orderReference;
  assert.equal((await callback(await event(ref,{amount_cents:245001}))).status,400);assert.equal((await callback(await event(ref,{currency:'USD'}))).status,400);
  assert.equal((await status(a,ref)).body.order.paymentStatus,'PENDING');assert.deepEqual(await state(),{on_hand:5,reserved:1});
});
test('unknown signed provider references are not falsely acknowledged or attached using unsigned metadata',async()=>{
  const a=await guest(),result=await initiate(a),p=await latest(result.body.orderReference);
  const foreign=signedTransaction(transactionFixture('999999999',245000,{order:{id:999999999,merchant_order_id:p.local_reference}}));assert.equal((await callback(foreign)).status,409);
  assert.equal((await status(a,result.body.orderReference)).body.order.paymentStatus,'PENDING');assert.equal((await latest(result.body.orderReference)).provider_order_reference,p.provider_order_reference);
});
test('integration, owner and mode mismatches are rejected before recording a business event',async()=>{
  const a=await guest(),result=await initiate(a);for(const extra of [{integration_id:999},{owner:999},{is_live:true}])assert.equal((await callback(await event(result.body.orderReference,extra))).status,400);
  assert.equal(await count('payment_events'),0);assert.deepEqual(await state(),{on_hand:5,reserved:1});
});
test('malformed signatures and modifications to signed callback fields cannot change stock',async()=>{
  const a=await guest(),result=await initiate(a),e=await event(result.body.orderReference);e.signature='x'.repeat(128);assert.equal((await callback(e)).status,401);
  const changed=await event(result.body.orderReference);changed.body.obj.owner++;assert.equal((await callback(changed)).status,401);assert.equal(await count('payment_events'),0);assert.deepEqual(await state(),{on_hand:5,reserved:1});
});
test('processing and authorization-only responses never count as captured payment',async()=>{
  const a=await guest(),result=await initiate(a),ref=result.body.orderReference;
  assert.equal((await callback(await event(ref,{pending:true}))).status,200);assert.equal((await status(a,ref)).body.order.paymentStatus,'PENDING');
  assert.equal((await callback(await event(ref,{is_auth:true,is_standalone_payment:false}))).status,200);assert.equal((await status(a,ref)).body.order.reconciliationRequired,true);assert.deepEqual(await state(),{on_hand:5,reserved:1});
});
test('refund or void notifications require review without automatic refund requests or inventory restocking',async()=>{
  const a=await guest(),result=await initiate(a),ref=result.body.orderReference;await callback(await event(ref));await callback(await event(ref,{is_refunded:true}));
  assert.equal((await status(a,ref)).body.order.reconciliationRequired,true);assert.equal((await status(a,ref)).body.order.paymentStatus,'PAID');assert.deepEqual(await state(),{on_hand:4,reserved:0});assert.ok(mock.calls.every(c=>c.operation==='create'));
});
test('a verified failure releases reservations exactly once and retains the same guest cookie linkage',async()=>{
  const a=await guest(),result=await initiate(a),e=await event(result.body.orderReference,{success:false,error_occured:true});
  assert.ok((await Promise.all(Array.from({length:8},()=>callback(e)))).every(r=>r.status===200));assert.deepEqual(await state(),{on_hand:5,reserved:0});assert.equal((await cart(a.session)).body.cart.count,1);
  assert.equal((await status(a,result.body.orderReference)).body.order.canRetry,true);assert.equal(await count('payments'),1);
});
test('concurrent retries use one durable child attempt and re-reserve stock for the same immutable order',async()=>{
  const a=await guest(),result=await initiate(a),ref=result.body.orderReference;await callback(await event(ref,{success:false,error_occured:true}));const prior=await latest(ref);
  const results=await Promise.all([retry(a,ref,prior.local_reference),retry(a,ref,prior.local_reference),retry(a,ref,prior.local_reference)]);assert.ok(results.every(r=>r.response.status===200));assert.equal(await count('orders'),1);assert.equal(await count('payments'),2);
  assert.equal((await latest(ref)).previous_payment_id,prior.id);assert.deepEqual(await state(),{on_hand:5,reserved:1});assert.equal(mock.calls.filter(c=>c.operation==='create').length,2);
  await callback(await event(ref,{id:192036466}));assert.equal((await status(a,ref)).body.order.paymentStatus,'PAID');assert.deepEqual(await state(),{on_hand:4,reserved:0});
});
test('retry refuses changed prices, publication or unavailable stock without changing the original snapshots',async()=>{
  const a=await guest(),result=await initiate(a),ref=result.body.orderReference;await callback(await event(ref,{success:false,error_occured:true}));await f.data.query('UPDATE product_prices SET amount_minor=amount_minor+100 WHERE variant_id=$1 AND is_active',[id(202)]);
  assert.equal((await retry(a,ref)).response.status,409);assert.equal(await count('payments'),1);assert.equal((await f.data.query('SELECT unit_price_minor::TEXT AS amount FROM order_items')).rows[0].amount,'245000');assert.deepEqual(await state(),{on_hand:5,reserved:0});
});
test('active collection snapshots can be retried without changing their destination or booking an appointment',async()=>{
  const l=(await f.data.query('INSERT INTO boutique_locations(name,governorate,city_area,street_address,is_active) VALUES($1,$2,$3,$4,true) RETURNING id',[testLocation.name,testLocation.governorate,testLocation.city,testLocation.street])).rows[0];
  const a=await guest();a.view=await checkout(a.session,{...deliveryDetails(),method:'BOUTIQUE_COLLECTION',locationId:l.id});const result=await initiate(a),ref=result.body.orderReference;await callback(await event(ref,{success:false,error_occured:true}));
  assert.equal((await retry(a,ref)).response.status,200);assert.equal((await status(a,ref)).body.order.method,'BOUTIQUE_COLLECTION');assert.equal(await count('fulfillment_arrangements'),0);
});
test('expired reservations remain held while an authenticated inquiry still reports payment processing',async()=>{
  const a=await guest(),result=await initiate(a),ref=result.body.orderReference;await due(ref,true);await observe(ref,{pending:true});await reconcilePayments(10,mock.fakeFetch);
  assert.deepEqual(await state(),{on_hand:5,reserved:1});assert.equal((await status(a,ref)).body.order.reconciliationRequired,true);assert.equal((await latest(ref)).status,'PENDING');
});
test('an authenticated terminal failure resolves an expired reservation safely and idempotently',async()=>{
  const a=await guest(),result=await initiate(a),ref=result.body.orderReference;await due(ref,true);await observe(ref,{success:false,error_occured:true});await reconcilePayments(10,mock.fakeFetch);await reconcilePayments(10,mock.fakeFetch);
  assert.deepEqual(await state(),{on_hand:5,reserved:0});const o=(await status(a,ref)).body.order;assert.equal(o.paymentStatus,'FAILED');assert.equal(o.reconciliationRequired,false);assert.equal(o.canRetry,true);
});
test('not-found and interrupted provider inquiries are not proof of non-payment and do not release stock',async()=>{
  const a=await guest();mock.failures.afterCreate=true;const result=await initiate(a),ref=result.body.orderReference;await due(ref,true);await reconcilePayments(10,mock.fakeFetch);assert.deepEqual(await state(),{on_hand:5,reserved:1});
  mock.failures.inquiry=true;await due(ref);await reconcilePayments(10,mock.fakeFetch);assert.deepEqual(await state(),{on_hand:5,reserved:1});assert.equal((await status(a,ref)).body.order.reconciliationRequired,true);
  const metadata=JSON.stringify(await listPaymentExceptions());for(const value of [checkoutContact.email,checkoutContact.phone,deliveryDetails().street])assert.ok(!metadata.includes(value),'Operator listing must omit personal fields.');
});
test('an expired local attempt that was never dispatched can be released without a provider request',async()=>{
  const a=await guest(),local=await initiateLocal(a.token,a.view.fingerprint,a.view.draft!.revision);assert.ok(!('error'in local));if('error'in local)return;
  await due(local.order.id,true);await reconcilePayments(10,mock.fakeFetch);assert.equal(mock.calls.length,0);assert.deepEqual(await state(),{on_hand:5,reserved:0});
});
test('an operator-confirmed closed-unpaid intention can release an otherwise uncertain hold exactly once',async()=>{
  const a=await guest();mock.failures.afterCreate=true;const result=await initiate(a),p=await latest(result.body.orderReference);
  assert.equal(await closeVerifiedUnpaid(p.id,'fixture-dashboard-closed',mock.fakeFetch),true);assert.equal(await closeVerifiedUnpaid(p.id,'fixture-dashboard-closed',mock.fakeFetch),true);assert.deepEqual(await state(),{on_hand:5,reserved:0});
  const late=signedTransaction(transactionFixture(mock.intentions.get(p.local_reference)!.orderId,245000));assert.equal((await callback(late)).status,409);
  // Correlate the late charge through the authenticated inquiry, never unsigned metadata.
  assert.equal((await listUnmatchedPaymentEvents()).length,1);
  await observe(result.body.orderReference);assert.equal(await inspectPayment(p.id,mock.fakeFetch),true);assert.equal((await listUnmatchedPaymentEvents()).length,0);
  assert.equal((await status(a,result.body.orderReference)).body.order.reconciliationRequired,true);assert.deepEqual(await state(),{on_hand:5,reserved:0});
});
test('operator closure is refused while the provider reports processing or a dispatch lease is active',async()=>{
  const a=await guest(),result=await initiate(a),ref=result.body.orderReference,p=await latest(ref);await observe(ref,{pending:true});assert.equal(await closeVerifiedUnpaid(p.id,'fixture-closed',mock.fakeFetch),false);
  mock.observations.clear();await f.data.query("UPDATE payments SET initiation_state='DISPATCHING',reconcile_lease_until=now()+INTERVAL '1 minute' WHERE id=$1",[p.id]);assert.equal(await closeVerifiedUnpaid(p.id,'fixture-closed',mock.fakeFetch),false);assert.deepEqual(await state(),{on_hand:5,reserved:1});
});
test('late success after stock release never consumes a different guest reservation or hides the paid exception',async()=>{
  const a=await guest(id(201)),first=await initiate(a),ref=first.body.orderReference;await callback(await event(ref,{success:false,error_occured:true}));
  const b=await guest(id(201)),second=await initiate(b);assert.equal(second.response.status,200);
  await callback(await event(ref));assert.deepEqual(await state(id(201)),{on_hand:1,reserved:1});const aOrder=(await status(a,ref)).body.order;assert.equal(aOrder.paymentStatus,'PAID');assert.equal(aOrder.reconciliationRequired,true);assert.equal(aOrder.inventoryFinalized,false);
  await callback(await event(second.body.orderReference,{id:192036466}));assert.deepEqual(await state(id(201)),{on_hand:0,reserved:0});assert.equal((await status(b,second.body.orderReference)).body.order.reconciliationRequired,false);
  assert.ok((await listPaymentExceptions()).some(r=>r.order_reference===ref && r.reconciliation_reason==='LATE_SUCCESS'));
});
test('late success during a retry cannot consume that retry hold or decrement inventory twice',async()=>{
  const a=await guest(id(201)),result=await initiate(a),ref=result.body.orderReference,p=await latest(ref);await callback(await event(ref,{success:false,error_occured:true}));await retry(a,ref);
  const late=signedTransaction(transactionFixture(p.provider_order_reference,Number(p.amount_minor)));await callback(late);assert.deepEqual(await state(id(201)),{on_hand:1,reserved:1});
  await callback(await event(ref,{id:192036466}));assert.deepEqual(await state(id(201)),{on_hand:1,reserved:0});assert.equal((await status(a,ref)).body.order.reconciliationRequired,true);assert.equal((await status(a,ref)).body.order.inventoryFinalized,false);
});
test('payment success preserves newly added selections and edited purchased lines',async()=>{
  const a=await guest(),result=await initiate(a),ref=result.body.orderReference;await cart(a.session,'POST',['items'],{variantId:id(201),quantity:1});
  const current=(await cart(a.session)).body.cart,line=current.items.find((i:{variantId:string})=>i.variantId===id(202));await cart(a.session,'PATCH',['items',line.id],{quantity:2,revision:current.revision});await callback(await event(ref));
  const after=(await cart(a.session)).body.cart;assert.equal(after.count,3);assert.equal(after.items.find((i:{variantId:string})=>i.variantId===id(202)).quantity,2);assert.deepEqual(await state(),{on_hand:4,reserved:0});
});
test('only unchanged purchased selections are removed when a different piece was added during payment',async()=>{
  const a=await guest(),result=await initiate(a);await cart(a.session,'POST',['items'],{variantId:id(201),quantity:1});await callback(await event(result.body.orderReference));
  const after=(await cart(a.session)).body.cart;assert.equal(after.count,1);assert.equal(after.items[0].variantId,id(201));
});
test('a verified purchase rotates the ordinary cart internally so the same guest cookie can prepare another order',async()=>{
  const a=await guest(),first=await initiate(a);await callback(await event(first.body.orderReference));assert.equal((await cart(a.session,'POST',['items'],{variantId:id(202),quantity:1})).response.status,200);a.view=await checkout(a.session,deliveryDetails());
  const second=await initiate(a);assert.equal(second.response.status,200);assert.notEqual(second.body.orderReference,first.body.orderReference);assert.equal(await count('orders'),2);
  const sources=(await f.data.query('SELECT source_cart_id FROM orders')).rows;assert.equal(new Set(sources.map(r=>r.source_cart_id)).size,2);assert.equal((await status(a,first.body.orderReference)).response.status,200);
});
test('order status is private and requires the current unexpired guest session, not only a UUID',async()=>{
  const a=await guest(),result=await initiate(a),ref=result.body.orderReference,b=await guest();const own=await status(a,ref);assert.equal(own.response.status,200);assert.match(own.response.headers.get('Cache-Control')!,/private, no-store/);assert.equal(own.response.headers.get('Referrer-Policy'),'no-referrer');
  assert.equal((await status(b,ref)).response.status,404);assert.equal((await status(a,randomUUID())).response.status,404);assert.equal((await orderHttp(new Request(origin+'/api/orders/'+ref),[ref])).status,404);
  const encoded=JSON.stringify(own.body);for(const secret of [a.token,paymentEnvironment.PAYMOB_SECRET_KEY,paymentEnvironment.PAYMOB_HMAC_SECRET,(await latest(ref)).checkout_client_secret])assert.ok(!encoded.includes(secret),'Order JSON must omit credentials.');
  await f.data.query("UPDATE carts SET status='EXPIRED' WHERE session_token_hash=(SELECT guest_session_hash FROM orders WHERE id=$1)",[ref]);assert.equal((await status(a,ref)).response.status,404);
});
test('origin checks, bounded JSON and forged identifiers or totals prevent financial writes',async()=>{
  const a=await guest();assert.equal((await initiate(a,undefined,{Origin:'https://foreign.test'})).response.status,403);
  assert.equal((await initiate(a,{fingerprint:a.view.fingerprint,draftRevision:a.view.draft!.revision,total:1,cartId:randomUUID()})).response.status,400);
  const bad=await paymentHttp(new Request(origin+'/api/payments/initiate',{method:'POST',headers:{Cookie:a.session,Origin:origin,'Content-Type':'application/json'},body:'{'}),['initiate']);assert.equal(bad.status,400);
  const large=await paymentHttp(new Request(origin+'/api/payments/initiate',{method:'POST',headers:{Cookie:a.session,Origin:origin,'Content-Type':'application/json'},body:'x'.repeat(2049)}),['initiate']);assert.ok([400,413].includes(large.status));assert.equal(await count('orders'),0);
});
test('test credentials, explicit feature gate and reconciliation acknowledgement are mandatory',async()=>{
  const a=await guest();for(const[key,value]of [['PAYMOB_MODE','live'],['PAYMOB_SECRET_KEY','sk_live_not_allowed'],['PAYMOB_PUBLIC_KEY','egy_pk_live_not_allowed'],['PAYMENTS_TEST_ENABLED','false'],['PAYMENTS_RECONCILIATION_READY','false']] as const){const before=process.env[key];process.env[key]=value;assert.equal(paymentsAvailable(),false);assert.equal((await initiate(a)).response.status,503);process.env[key]=before;}
  assert.equal(await count('orders'),0);assert.equal(mock.calls.length,0);
});
test('production draft-retention gate cannot be bypassed by payment initiation',async()=>{
  const a=await guest(),previous=process.env.NODE_ENV;
  try{Reflect.set(process.env,'NODE_ENV','production');process.env.CHECKOUT_DRAFT_RETENTION_READY='false';const productionGuest={...a,session:'__Host-la-palme-bag='+a.token};assert.equal((await initiate(productionGuest)).response.status,503);assert.equal(await count('orders'),0);}
  finally{if(previous===undefined)Reflect.deleteProperty(process.env,'NODE_ENV');else Reflect.set(process.env,'NODE_ENV',previous);}
});
test('runtime grants protect immutable financial snapshots and deny public/cart access to payment data',async()=>{
  const a=await guest(),result=await initiate(a),ref=result.body.orderReference,payment=new pg.Pool(databaseConfig(f.paymentUrl)),reader=new pg.Pool(databaseConfig(f.readerUrl)),cartRole=new pg.Pool(databaseConfig(f.cartUrl));
  try{
    await assert.rejects(payment.query("UPDATE orders SET total_minor=1 WHERE id=$1",[ref]));await assert.rejects(payment.query("UPDATE orders SET customer_name='tamper' WHERE id=$1",[ref]));await assert.rejects(payment.query("UPDATE order_items SET quantity=1"));await assert.rejects(payment.query("UPDATE order_addresses SET street_address='tamper'"));
    await assert.rejects(reader.query('SELECT * FROM orders'));await assert.rejects(cartRole.query('SELECT * FROM payments'));await assert.rejects(payment.query("UPDATE product_prices SET amount_minor=1"));
    await f.data.query("UPDATE products SET name='Changed fixture name' WHERE id=$1",[id(102)]);assert.ok((await status(a,ref)).body.order.items[0].name!=='Changed fixture name');assert.equal(await count('customer_profiles'),0);
  }finally{await payment.end();await reader.end();await cartRole.end();}
});
test('payment events store only verified business facts and no card or personal callback fields',async()=>{
  const a=await guest(),result=await initiate(a),e=await event(result.body.orderReference);Object.assign(e.body.obj,{billing_data:{email:checkoutContact.email},card_tokens:['fixture-card-token-never-store'],data:{card_num:'fixture-not-a-card-number'}});await callback(e);
  const events=JSON.stringify((await f.data.query('SELECT * FROM payment_events')).rows);for(const value of ['card_tokens','card_num','billing_data',checkoutContact.email,checkoutContact.phone,'"pan"'])assert.ok(!events.includes(value),'Persist only minimal verified business facts.');
});
test('browser redirects discard provider claims and never establish payment success',async()=>{
  const a=await guest(),result=await initiate(a),ref=result.body.orderReference;
  const response=await paymentHttp(new Request(origin+'/api/payments/paymob/return/'+ref+'?success=true&amount_cents=1&hmac=forged'),['paymob','return',ref]);assert.equal(response.status,303);assert.equal(response.headers.get('Location'),origin+'/orders/'+ref);assert.equal((await status(a,ref)).body.order.paymentStatus,'PENDING');assert.deepEqual(await state(),{on_hand:5,reserved:1});
});
test('provider-safe EGP arithmetic remains exact and amounts above safe JSON integer range are rejected before reserving',async()=>{
  const a=await guest();await f.data.query('UPDATE product_prices SET amount_minor=$2 WHERE variant_id=$1 AND is_active',[id(202),'9007199254740992']);a.view=await checkout(a.session,deliveryDetails());assert.equal((await initiate(a)).response.status,422);assert.equal(await count('orders'),0);
  await f.data.query('UPDATE product_prices SET amount_minor=$2 WHERE variant_id=$1 AND is_active',[id(202),'9007199254740991']);a.view=await checkout(a.session,deliveryDetails());const result=await initiate(a);assert.equal(result.response.status,200);assert.equal((await latest(result.body.orderReference)).amount_minor,'9007199254740991');
});
test('quantities and generated immutable line totals agree exactly with the provider amount',async()=>{
  const a=await guest(id(202),3),result=await initiate(a);assert.equal(result.response.status,200);assert.equal((await latest(result.body.orderReference)).amount_minor,'735000');
  const line=(await f.data.query('SELECT quantity,unit_price_minor,line_total_minor FROM order_items')).rows[0];assert.equal(line.quantity,3);assert.equal(line.unit_price_minor,'245000');assert.equal(line.line_total_minor,'735000');
});
test('a stock ledger mismatch fails closed before financial writes or provider dispatch',async()=>{
  await f.data.query('UPDATE inventory SET reserved=1 WHERE variant_id=$1',[id(202)]);const a=await guest();assert.equal((await initiate(a)).response.status,503);assert.equal(await count('orders'),0);assert.equal(mock.calls.length,0);
});
test('expired but still-owned stock can be finalized when verified payment succeeds',async()=>{
  const a=await guest(),result=await initiate(a),ref=result.body.orderReference;await due(ref,true);await callback(await event(ref));assert.deepEqual(await state(),{on_hand:4,reserved:0});assert.equal((await status(a,ref)).body.order.inventoryFinalized,true);
});
test('critical paid exceptions block another order or payment until authorized reconciliation',async()=>{
  const a=await guest(),result=await initiate(a),ref=result.body.orderReference;await callback(await event(ref,{success:false,error_occured:true}));await callback(await event(ref));
  a.view=await checkout(a.session,deliveryDetails());const another=await initiate(a);assert.equal(another.body.orderReference,ref);assert.equal(another.body.checkoutUrl,null);assert.equal(await count('orders'),1);assert.equal(mock.calls.filter(c=>c.operation==='create').length,1);
});
test('a stale dispatch lease is reconciled without sending a second intention',async()=>{
  const a=await guest();mock.failures.timeout=true;const result=await initiate(a),ref=result.body.orderReference;
  await f.data.query("UPDATE payments SET initiation_state='DISPATCHING',next_reconcile_at=now()-INTERVAL '1 minute',reconcile_lease_until=now()-INTERVAL '1 second'");await reconcilePayments(10,mock.fakeFetch);
  assert.equal((await latest(ref)).initiation_state,'UNCERTAIN');assert.equal(mock.calls.filter(c=>c.operation==='create').length,1);assert.deepEqual(await state(),{on_hand:5,reserved:1});
});
test('a provider response reporting live integration data is refused even with test credentials',async()=>{
  const a=await guest();mock.failures.live=true;const result=await initiate(a);assert.equal(result.body.checkoutUrl,null);assert.equal((await latest(result.body.orderReference)).initiation_state,'UNCERTAIN');
});
test('the real reconciliation CLI lists actionable private references without contact data or credentials',async()=>{
  const a=await guest();mock.failures.timeout=true;await initiate(a);
  const output=await promisify(execFile)(process.execPath,['--experimental-strip-types','--conditions=react-server','scripts/reconcile-payments.mts','list','10'],{env:process.env,windowsHide:true});
  const body=JSON.parse(output.stdout);assert.equal(body.attempts.length,1);assert.ok(Array.isArray(body.unmatchedEvents));for(const value of [checkoutContact.email,checkoutContact.phone,paymentEnvironment.PAYMOB_SECRET_KEY])assert.ok(!(output.stdout+output.stderr).includes(value),'CLI output must omit personal fields and credentials.');
});
test('an expired undispatched attempt cannot be resumed into a provider request',async()=>{
  const a=await guest(),local=await initiateLocal(a.token,a.view.fingerprint,a.view.draft!.revision);assert.ok(!('error'in local));if('error'in local)return;
  await due(local.order.id,true);const resumed=await retry(a,local.order.id);assert.equal(resumed.response.status,200);assert.equal(resumed.body.checkoutUrl,null);assert.equal(mock.calls.length,0);
  await reconcilePayments(10,mock.fakeFetch);assert.deepEqual(await state(),{on_hand:5,reserved:0});
});
test('database constraints independently reject unverified events, orphaned payment holds and self-referential retries',async()=>{
  const a=await guest(),result=await initiate(a),p=await latest(result.body.orderReference),o=(await f.data.query('SELECT source_cart_id FROM orders WHERE id=$1',[p.order_id])).rows[0];
  await assert.rejects(f.data.query(`INSERT INTO payment_events(provider,deduplication_key,payment_id,signature_verified,status,processed_at) VALUES('PAYMOB',$1,$2,false,'PROCESSED',now())`,[randomUUID(),p.id]));
  await assert.rejects(f.data.query(`INSERT INTO inventory_reservations(variant_id,quantity,cart_id,payment_id,expires_at) VALUES($1,1,$2,$3,now()+INTERVAL '15 minutes')`,[id(202),o.source_cart_id,p.id]));
  const self=randomUUID();await assert.rejects(f.data.query(`INSERT INTO payments(id,order_id,amount_minor,previous_payment_id) VALUES($1,$2,245000,$1)`,[self,p.order_id]));
  assert.equal(await count('payment_events'),0);assert.equal(await count('inventory_reservations'),1);assert.equal(await count('payments'),1);
});

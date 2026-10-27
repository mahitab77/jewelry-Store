import { paymentFixture } from './payment-fixture.mts';
import { paymentEnvironment,paymobMock,signedTransaction,transactionFixture } from './paymob-mock.mts';
import { deliveryDetails,testLocation } from './checkout-data.mts';
import { developmentId } from '../../db/tools/seed.ts';
import { cartHttp } from '../../src/lib/cart/http.ts';
import { checkoutHttp } from '../../src/lib/checkout/http.ts';
import { orderHttp,paymentHttp } from '../../src/lib/payments/http.ts';
import assert from 'node:assert/strict';
const mocks=new WeakMap<object,ReturnType<typeof paymobMock>>();

export async function orderFixture(origin='https://orders.boutique.test'){
  const f=await paymentFixture(origin),role=`"${f.role}"`;
  try{
    await f.data.query(`GRANT SELECT(id,order_number,customer_name,customer_email,customer_phone,currency,total_minor,subtotal_minor,discount_minor,tax_minor,
      fulfillment_fee_minor,payment_status,order_status,fulfillment_method,fulfillment_status,created_at,updated_at,test_mode,boutique_location_id,boutique_location_snapshot,
      inventory_finalized_at,reconciliation_required,reconciliation_reason) ON orders TO ${role}`);
    await f.data.query(`GRANT UPDATE(fulfillment_status,order_status,updated_at) ON orders TO ${role}`);
    await f.data.query(`GRANT SELECT ON order_items,order_addresses,boutique_locations,fulfillment_arrangements,fulfillment_events,order_status_history TO ${role}`);
    await f.data.query(`GRANT UPDATE(updated_at) ON admin_users,boutique_locations TO ${role}`);
    await f.data.query(`GRANT SELECT(id,order_id,status,currency,amount_minor,refunded_minor,provider_transaction_reference,created_at,succeeded_at,initiation_state,last_error_code) ON payments TO ${role}`);
    await f.data.query(`GRANT SELECT(id,payment_id,status,signature_verified,verification_source,provider_transaction_reference,received_at,processed_at) ON payment_events TO ${role}`);
    await f.data.query(`GRANT INSERT ON fulfillment_arrangements,fulfillment_events,order_status_history TO ${role}`);
    await f.data.query(`GRANT UPDATE(status,scheduled_start_at,scheduled_end_at,assigned_admin_id,completed_at,completed_by_admin_id,updated_at) ON fulfillment_arrangements TO ${role}`);
    return f;
  }catch(error){await f.close();throw error;}
}

// Real application path against a local provider mock, including signed evidence.
// Never inserts a PAID order directly or calls a real payment service.
export async function fixtureOrder(f:Awaited<ReturnType<typeof orderFixture>>,method='PRIVATE_DELIVERY',paid=true){
  const origin=f.authConfig.baseURL,originalFetch=globalThis.fetch;
  const values={...paymentEnvironment,CART_DATABASE_URL:f.cartUrl,CART_ORIGIN:origin,PAYMENT_DATABASE_URL:f.paymentUrl,CHECKOUT_DRAFT_RETENTION_READY:'true'};
  const saved=new Map(Object.keys(values).map(k=>[k,process.env[k]]));let mock=mocks.get(f);if(!mock){mock=paymobMock();mocks.set(f,mock);}
  try{
    Object.assign(process.env,values);globalThis.fetch=mock.fakeFetch;
    await f.data.query('UPDATE inventory SET on_hand=100 WHERE variant_id=$1',[developmentId(202)]);
    const created=await cartHttp(new Request(origin+'/api/cart/items',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({variantId:developmentId(202),quantity:1})}),['items']);assert.equal(created.status,200);
    const session=created.headers.getSetCookie()[0].split(';')[0],token=session.split('=')[1];
    const initial=await checkoutHttp(new Request(origin+'/api/checkout',{headers:{Cookie:session}}));const view=(await initial.json()).checkout;
    let locationId='';if(method==='BOUTIQUE_COLLECTION')locationId=(await f.data.query(`INSERT INTO boutique_locations(name,governorate,city_area,street_address,is_active) VALUES($1,$2,$3,$4,true) RETURNING id`,[testLocation.name,testLocation.governorate,testLocation.city,testLocation.street])).rows[0].id;
    const savedDraft=await checkoutHttp(new Request(origin+'/api/checkout/draft',{method:'POST',headers:{Cookie:session,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({details:{...deliveryDetails(),method,locationId},fingerprint:view.fingerprint,draftRevision:view.draft?.revision??null})}),['draft']);
    // A newly enabled location changes the fingerprint; refresh first.
    if(savedDraft.status!==200){const fresh=(await (await checkoutHttp(new Request(origin+'/api/checkout',{headers:{Cookie:session}}))).json()).checkout;
      const retry=await checkoutHttp(new Request(origin+'/api/checkout/draft',{method:'POST',headers:{Cookie:session,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({details:{...deliveryDetails(),method,locationId},fingerprint:fresh.fingerprint,draftRevision:fresh.draft?.revision??null})}),['draft']);assert.equal(retry.status,200);}
    const checkout=(await (await checkoutHttp(new Request(origin+'/api/checkout',{headers:{Cookie:session}}))).json()).checkout;
    const response=await paymentHttp(new Request(origin+'/api/payments/initiate',{method:'POST',headers:{Cookie:session,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({fingerprint:checkout.fingerprint,draftRevision:checkout.draft.revision})}),['initiate']);assert.equal(response.status,200);const result=await response.json();
    if(paid){const p=(await f.data.query('SELECT provider_order_reference,amount_minor FROM payments WHERE order_id=$1',[result.orderReference])).rows[0];const event=signedTransaction(transactionFixture(p.provider_order_reference,Number(p.amount_minor),{id:Number(p.provider_order_reference)+1000000000}));
      const callback=await paymentHttp(new Request(origin+'/api/payments/paymob/callback?hmac='+event.signature,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event.body)}),['paymob','callback']);assert.equal(callback.status,200);}
    return {id:result.orderReference as string,session,token,locationId,calls:mock.calls.length,async customer(cookie=session){const previous=process.env.PAYMENT_DATABASE_URL;process.env.PAYMENT_DATABASE_URL=f.paymentUrl;try{const r=await orderHttp(new Request(origin+'/api/orders/'+result.orderReference,{headers:{Cookie:cookie}}),[result.orderReference]);return {status:r.status,body:await r.json()};}finally{if(previous===undefined)delete process.env.PAYMENT_DATABASE_URL;else process.env.PAYMENT_DATABASE_URL=previous;}}};
  }finally{globalThis.fetch=originalFetch;for(const[k,v]of saved){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}

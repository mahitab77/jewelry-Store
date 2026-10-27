import { createHmac } from 'node:crypto';

// Synthetic credentials; no merchant account, provider traffic or card details.
export const paymentEnvironment={PAYMENTS_TEST_ENABLED:'true',PAYMENTS_RECONCILIATION_READY:'true',PAYMOB_MODE:'test',PAYMOB_SECRET_KEY:'sk_test_phase09_fixture_not_a_real_merchant_key',PAYMOB_PUBLIC_KEY:'egy_pk_test_phase09_fixture_not_a_real_public_key',PAYMOB_API_KEY:'phase09-fixture-read-only-api-key',PAYMOB_HMAC_SECRET:'phase09-fixture-only-hmac-key-not-a-real-merchant-secret',PAYMOB_INTEGRATION_ID:'4097558',PAYMOB_OWNER_ID:'302852'};
export function transactionFixture(orderId:string,amount:number,extra:Record<string,unknown>={}) {
  return {id:192036465,pending:false,amount_cents:amount,success:true,is_auth:false,is_capture:false,is_standalone_payment:true,is_voided:false,is_refunded:false,is_3d_secure:true,integration_id:4097558,has_parent_transaction:false,
    order:{id:Number(orderId)},created_at:'2024-06-13T11:33:44.592345',currency:'EGP',source_data:{pan:'2346',type:'card',sub_type:'MasterCard'},error_occured:false,is_live:false,owner:302852,...extra};
}
// Independent fixed ordering from Paymob's published processed-callback example.
export function signedTransaction(obj:ReturnType<typeof transactionFixture>,secret=paymentEnvironment.PAYMOB_HMAC_SECRET) {
  const data=[obj.amount_cents,obj.created_at,obj.currency,obj.error_occured,obj.has_parent_transaction,obj.id,obj.integration_id,obj.is_3d_secure,obj.is_auth,obj.is_capture,obj.is_refunded,obj.is_standalone_payment,obj.is_voided,obj.order.id,obj.owner,obj.pending,obj.source_data.pan,obj.source_data.sub_type,obj.source_data.type,obj.success].join('');
  return {body:{type:'TRANSACTION',obj},signature:createHmac('sha512',secret).update(data).digest('hex'),canonical:data};
}
export function paymobMock() {
  let counter=800000000;
  const intentions=new Map<string,{orderId:string;id:string;clientSecret:string;amount:number}>(),observations=new Map<string,Record<string,unknown>>();
  const calls:{operation:string;reference:string}[]=[];
  const failures={timeout:false,afterCreate:false,malformed:false,rejected:false,inquiry:false,live:false};
  const fakeFetch:typeof fetch=async(input,init)=>{
    const url=new URL(input instanceof Request?input.url:String(input));
    if(url.origin!=='https://accept.paymob.com')throw new Error('Real provider traffic is forbidden in this fixture.');
    const request=new Request(url,init),body=await request.json();
    if(url.pathname==='/api/auth/tokens'){
      if(body.api_key!==paymentEnvironment.PAYMOB_API_KEY)throw new Error('Unexpected inquiry authentication.');
      return Response.json({token:'fixture-read-only-auth-token',profile:{id:164295}});
    }
    if(url.pathname==='/api/ecommerce/orders/transaction_inquiry'){
      calls.push({operation:'inquiry',reference:body.merchant_order_id});
      if(failures.inquiry)throw new Error('Fixture inquiry interruption.');
      const observed=observations.get(body.merchant_order_id);return observed?Response.json(observed):Response.json({detail:'No matching transaction.'},{status:404});
    }
    if(url.pathname!=='/v1/intention/' || request.headers.get('Authorization')!=='Token '+paymentEnvironment.PAYMOB_SECRET_KEY)throw new Error('Unexpected test provider request.');
    calls.push({operation:'create',reference:body.special_reference});
    if(failures.rejected)return Response.json({detail:'Fixture rejection.'},{status:400});
    if(failures.timeout)throw new DOMException('Fixture timeout.','TimeoutError');
    const entry={orderId:String(++counter),id:'pi_test_'+String(counter).padStart(32,'0'),clientSecret:'egy_csk_test_'+String(counter).padStart(32,'0'),amount:body.amount};intentions.set(body.special_reference,entry);
    if(failures.afterCreate)throw new Error('Fixture response lost after intention creation.');
    if(failures.malformed)return Response.json({id:entry.id});
    return Response.json({id:entry.id,intention_order_id:Number(entry.orderId),client_secret:entry.clientSecret,intention_detail:{amount:entry.amount,currency:'EGP'},payment_methods:[{integration_id:4097558,live:failures.live,currency:'EGP'}],special_reference:body.special_reference,object:'paymentintention'},{status:201});
  };
  return {fakeFetch,intentions,observations,calls,failures};
}
// Test-only preload. It is never imported by application code or chosen by an HTTP request.
if(process.env.PAYMENTS_BROWSER_PRELOAD==='1'){
  if(process.env.PAYMOB_SECRET_KEY!==paymentEnvironment.PAYMOB_SECRET_KEY)throw new Error('Refuse to mock a non-fixture merchant.');
  const mock=paymobMock(),original=globalThis.fetch;
  globalThis.fetch=(input,init)=>{
    const url=new URL(input instanceof Request?input.url:String(input));
    return url.hostname.endsWith('paymob.com')?mock.fakeFetch(input,init):original(input,init);
  };
}

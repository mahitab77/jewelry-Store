import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { PAYMOB_API, INTENTION_SECONDS, type paymobConfig, verificationConfig } from './config.ts';
import { PaymentError, type VerifiedTransaction } from './types.ts';

type JsonObject = Record<string, unknown>;
function record(value: unknown): JsonObject { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PaymentError('Invalid payment-provider data.',400); return value as JsonObject; }
function id(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^[1-9]\d{0,14}$/.test(value) && Number.isSafeInteger(Number(value))) return value;
  throw new PaymentError('Invalid payment-provider identifier.',400);
}
function amount(value: unknown): string { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new PaymentError('Invalid payment-provider amount.',400); return String(value); }
function text(value: unknown, max = 100): string { if (typeof value !== 'string' || !value.length || value.length>max || /[\x00-\x1f\x7f]/.test(value)) throw new PaymentError('Invalid payment-provider field.',400); return value; }
const booleans = ['error_occured','has_parent_transaction','is_3d_secure','is_auth','is_capture','is_refunded','is_standalone_payment','is_voided','pending','success'] as const;

// Official processed-callback order. Fields outside this list are NOT signed.
export function transactionCanonical(value: unknown): string {
  const o=record(value), order=record(o.order), source=record(o.source_data);
  for(const key of booleans) if(typeof o[key]!=='boolean') throw new PaymentError('Invalid payment-provider flags.',400);
  return [amount(o.amount_cents),text(o.created_at),text(o.currency,3),o.error_occured,o.has_parent_transaction,id(o.id),id(o.integration_id),o.is_3d_secure,o.is_auth,o.is_capture,o.is_refunded,o.is_standalone_payment,o.is_voided,id(order.id),id(o.owner),o.pending,text(source.pan,32),text(source.sub_type,40),text(source.type,30),o.success].join('');
}
function normalized(value: unknown, proof: string, source: VerifiedTransaction['source']): VerifiedTransaction {
  const o=record(value), order=record(o.order), config=verificationConfig();
  // is_live is supplementary; signed integration/order/owner pinning is essential.
  if(o.is_live !== false || id(o.integration_id)!==config.integrationId || id(o.owner)!==config.ownerId) throw new PaymentError('Payment-provider identity did not match.',400);
  const flags=['pending','success','error_occured','is_auth','is_capture','is_standalone_payment','is_refunded','is_voided','has_parent_transaction'];
  for(const key of flags) if(typeof o[key]!=='boolean') throw new PaymentError('Invalid payment-provider flags.',400);
  const exceptional=o.is_refunded || o.is_voided || o.is_auth || o.is_capture || o.has_parent_transaction || !o.is_standalone_payment;
  const outcome=exceptional ? 'REVIEW' : o.pending ? 'PENDING' : o.success && !o.error_occured ? 'SUCCEEDED' : !o.success ? 'FAILED' : 'REVIEW';
  return { transactionId:id(o.id),providerOrderId:id(order.id),amountMinor:amount(o.amount_cents),currency:text(o.currency,3),integrationId:id(o.integration_id),ownerId:id(o.owner),createdAt:text(o.created_at),outcome,proof,source,
    specialReference: source==='PAYMOB_API' && typeof order.merchant_order_id==='string' && /^[0-9a-f-]{36}$/.test(order.merchant_order_id) ? order.merchant_order_id : null };
}
export function verifyCallback(value: unknown, signature: string): VerifiedTransaction {
  if(!/^[a-fA-F0-9]{128}$/.test(signature)) throw new PaymentError('Payment callback could not be authenticated.',401);
  const body=record(value); if(body.type!=='TRANSACTION') throw new PaymentError('Unsupported payment callback.',400);
  const canonical=transactionCanonical(body.obj), calculated=createHmac('sha512',verificationConfig().hmac).update(canonical).digest();
  if(!timingSafeEqual(calculated,Buffer.from(signature,'hex'))) throw new PaymentError('Payment callback could not be authenticated.',401);
  return normalized(body.obj,createHash('sha256').update(canonical).digest('hex'),'PAYMOB_HMAC');
}

export interface IntentionInput { reference:string; orderReference:string; amountMinor:string; fullName:string; email:string; phone:string }
export interface Intention { id:string; orderId:string; clientSecret:string }
export class ProviderFailure extends Error { readonly definitive:boolean; constructor(definitive=false) { super('The payment-provider request could not be confirmed.'); this.definitive=definitive; } }
async function boundedJson(response: Response) {
  const reader=response.body?.getReader(); if(!reader) throw new ProviderFailure();
  const chunks:Uint8Array[]=[]; let size=0;
  try { for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>65536)throw new ProviderFailure();chunks.push(next.value);} return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  finally { await reader.cancel().catch(()=>{}); }
}
export function createPaymobAdapter(config: ReturnType<typeof paymobConfig>, transport: typeof fetch = fetch) {
  async function post(path:string, body:unknown, authorization?:string):Promise<unknown> {
    try {
      const response=await transport(PAYMOB_API+path,{method:'POST',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json',...(authorization?{Authorization:authorization}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
      // Documented validation/authentication rejections cannot initiate payment.
      if([400,401,403,404,422].includes(response.status)) { await response.body?.cancel(); throw new ProviderFailure(true); }
      if(!response.ok) { await response.body?.cancel(); throw new ProviderFailure(); }
      return await boundedJson(response);
    } catch(error) { throw error instanceof ProviderFailure ? error : new ProviderFailure(); }
  }
  return {
    async create(input:IntentionInput):Promise<Intention> {
      const parts=input.fullName.split(' '), first=parts.shift()!, last=parts.join(' '), minor=BigInt(input.amountMinor);
      if(!last || first.length>50 || last.length>50 || minor<=BigInt(0) || minor>BigInt(Number.MAX_SAFE_INTEGER)) throw new ProviderFailure(true);
      const raw=await post('/v1/intention/',{amount:Number(minor),currency:'EGP',payment_methods:[Number(config.integrationId)],billing_data:{first_name:first,last_name:last,email:input.email,phone_number:input.phone,country:'EG'},special_reference:input.reference,expiration:INTENTION_SECONDS,
        notification_url:config.origin+'/api/payments/paymob/callback',redirection_url:config.origin+'/api/payments/paymob/return/'+input.orderReference},'Token '+config.secretKey);
      try {
        const o=record(raw), detail=record(o.intention_detail), methods=o.payment_methods;
        if(!/^pi_test_[A-Za-z0-9_-]{16,200}$/.test(text(o.id,240)) || !/^egy_csk_test_[A-Za-z0-9_-]{16,200}$/.test(text(o.client_secret,240)) || o.special_reference!==input.reference || amount(detail.amount)!==input.amountMinor || detail.currency!=='EGP' || o.object!=='paymentintention' || !Array.isArray(methods) || methods.length!==1) throw new Error();
        const method=record(methods[0]); if(id(method.integration_id)!==config.integrationId || method.live!==false || method.currency!=='EGP')throw new Error();
        return {id:o.id as string,orderId:id(o.intention_order_id),clientSecret:o.client_secret as string};
      } catch { throw new ProviderFailure(); }
    },
    async inquire(reference:string):Promise<VerifiedTransaction|null> {
      const auth=record(await post('/api/auth/tokens',{api_key:config.apiKey}));
      const token=text(auth.token,8192);
      if(!/^[A-Za-z0-9_.=+/-]+$/.test(token))throw new ProviderFailure();
      try {
        const raw=await post('/api/ecommerce/orders/transaction_inquiry',{auth_token:token,merchant_order_id:reference});
        const o=record(raw), order=record(o.order);
        if(order.merchant_order_id!==reference)throw new ProviderFailure();
        const canonical=JSON.stringify([id(o.id),id(order.id),amount(o.amount_cents),o.currency,id(o.integration_id),id(o.owner),o.success,o.pending,o.error_occured,o.is_refunded,o.is_voided,o.is_auth,o.is_capture,o.has_parent_transaction,o.is_standalone_payment]);
        return normalized(raw,createHash('sha256').update('inquiry:'+canonical).digest('hex'),'PAYMOB_API');
      } catch(error) { if(error instanceof ProviderFailure && error.definitive)return null; throw new ProviderFailure(); }
    },
  };
}

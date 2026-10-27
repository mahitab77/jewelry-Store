import 'server-only';
import { randomUUID } from 'node:crypto';
import { withTransaction } from '../db/client.ts';
import { readOwnedCart } from '../cart/repository.ts';
import { tokenHash } from '../cart/session.ts';
import { checkoutFingerprint, draft, locations } from '../checkout/repository.ts';
import { parseDetails,validateDetails } from '../checkout/validation.ts';
import { requirePaymentInitiation } from './config.ts';
import { history,lockSelections,newPayment,orderLines,orderRow,ownerLock,paymentRows,reserve,type OrderRow,type PaymentRow } from './persistence.ts';
import type { OrderView } from './types.ts';

export type LocalResult={error:{status:number;message:string}}|{order:OrderRow;payment:PaymentRow};
const rejected=(message:string,status=409):LocalResult=>({error:{message,status}});
export async function initiateLocal(token:string, fingerprint:string, revision:string):Promise<LocalResult> {
  const config=requirePaymentInitiation(), hash=tokenHash(token);
  return withTransaction(async client=>{
    await ownerLock(client,hash);
    let owned=await readOwnedCart(client,token,true);if(!owned)return rejected('Your shopping bag session is no longer active.',401);
    const previous=(await client.query<OrderRow>(`SELECT * FROM orders WHERE test_mode AND guest_session_hash=$1 AND (order_status='PENDING_PAYMENT' OR reconciliation_required) ORDER BY created_at LIMIT 1 FOR UPDATE`,[hash])).rows[0];
    if(previous){const attempts=await paymentRows(client,previous.id);return {order:previous,payment:attempts[attempts.length-1]};}
    const existing=(await client.query<OrderRow>('SELECT * FROM orders WHERE source_cart_id=$1 FOR UPDATE',[owned.id])).rows[0];
    if(existing)return rejected('This bag already belongs to an order. Open that order to check its payment status.');
    const ids=owned.cart.items.map(item=>item.variantId);if(!ids.length)return rejected('Add an available piece before proceeding to payment.',422);
    await lockSelections(client,ids);
    owned=await readOwnedCart(client,token,true);if(!owned)return rejected('Your shopping bag session expired.',401);
    const stored=await draft(client,owned.id);
    if(stored?.details.method==='BOUTIQUE_COLLECTION'){
      const location=await client.query(`SELECT id FROM boutique_locations WHERE id=$1 AND is_active AND country_code='EG' FOR SHARE`,[stored.details.locationId||null]);
      if(!location.rowCount)return rejected('That collection location is no longer available.',422);
    }
    const available=await locations(client);
    const current=checkoutFingerprint(owned.cart,available);
    if(!stored || stored.revision!==revision || stored.fingerprint!==current || fingerprint!==current)return rejected('Save the current reviewed checkout details before proceeding to payment.');
    const d=parseDetails(stored.details);
    if(Object.keys(validateDetails(d,available)).length || !owned.cart.eligible)return rejected('Review your contact details, fulfillment and available selections before proceeding.',422);
    const name=d.fullName.split(' '); if(name.length<2 || name[0].length>50 || name.slice(1).join(' ').length>50)return rejected('Use your full name, including a family name, with each part at most 50 characters.',422);
    const total=owned.cart.subtotalMinor;
    if(total===null || BigInt(total)<=BigInt(0) || BigInt(total)>BigInt(Number.MAX_SAFE_INTEGER))return rejected('This amount cannot be safely submitted to the payment provider.',422);
    // Recheck immediately before writing; cart and selected catalogue rows remain locked.
    if(new Date(stored.expiresAt).getTime()<=Date.now())return rejected('Your checkout draft expired. Save the reviewed details again.');
    const chosen=available.find(item=>item.id===d.locationId);
    const order=(await client.query<OrderRow>(`INSERT INTO orders(order_number,source_cart_id,customer_name,customer_email,customer_phone,currency,subtotal_minor,total_minor,
      payment_status,fulfillment_method,test_mode,guest_session_hash,guest_access_expires_at,checkout_fingerprint,checkout_draft_revision,boutique_location_id,boutique_location_snapshot)
      VALUES($1,$2,$3,$4,$5,'EGP',$6,$6,'PENDING',$7,true,$8,$9,$10,$11,$12,$13) RETURNING *`,
      ['TEST-'+randomUUID(),owned.id,d.fullName,d.email,d.phone,total,d.method,hash,owned.cart.expiresAt,current,stored.revision,chosen?.id??null,chosen?JSON.stringify(chosen):null])).rows[0];
    await client.query(`INSERT INTO order_items(order_id,product_id,variant_id,sku_snapshot,product_name_snapshot,configuration_snapshot,quantity,unit_price_minor,source_cart_item_id,source_cart_item_updated_at)
      SELECT $1,v.product_id,v.id,v.sku,p.name,concat_ws(' · ',v.size_label,NULLIF(v.configuration_label,''),v.metal_type,v.metal_purity,v.metal_color),ci.quantity,price.amount_minor,ci.id,ci.updated_at
      FROM cart_items ci JOIN product_variants v ON v.id=ci.variant_id JOIN products p ON p.id=v.product_id
      JOIN product_prices price ON price.variant_id=v.id AND price.is_active AND price.currency='EGP' WHERE ci.cart_id=$2 ORDER BY v.id`,[order.id,owned.id]);
    if(d.method==='PRIVATE_DELIVERY')await client.query(`INSERT INTO order_addresses(order_id,recipient_name,recipient_phone,country_code,governorate,city_area,street_address,building,floor_unit,delivery_instructions)
      VALUES($1,$2,$3,'EG',$4,$5,$6,$7,$8,$9)`,[order.id,d.fullName,d.phone,d.governorate,d.city,d.street,d.building||null,d.floorUnit||null,d.instructions||null]);
    const payment=await newPayment(client,order,config.integrationId,config.ownerId);
    await reserve(client,order.id,owned.id,payment.id,owned.cart.items.map(item=>({variantId:item.variantId,quantity:item.quantity})));
    await client.query(`INSERT INTO order_status_history(order_id,state_domain,from_status,to_status,actor_kind,reason) VALUES($1,'ORDER',NULL,'PENDING_PAYMENT','SYSTEM','TEST_CHECKOUT_INITIATED'),($1,'PAYMENT',NULL,'PENDING','SYSTEM','TEST_CHECKOUT_INITIATED')`,[order.id]);
    return {order,payment};
  },false,'payment');
}

export async function retryLocal(token:string, reference:string, previousReference:string):Promise<LocalResult> {
  const config=requirePaymentInitiation(), hash=tokenHash(token);
  return withTransaction(async client=>{
    const guest=await ownerLock(client,hash);
    if(!guest || guest.status!=='ACTIVE' || guest.customer_profile_id || guest.expires_at.getTime()<=Date.now())return rejected('This order is unavailable.',404);
    const order=await orderRow(client,reference);
    if(!order || order.guest_session_hash!==hash || order.guest_access_expires_at.getTime()<=Date.now())return rejected('This order is unavailable.',404);
    const payments=await paymentRows(client,order.id), prior=payments.find(p=>p.local_reference===previousReference);
    if(!prior)return rejected('Refresh this order before trying another payment.');
    const duplicate=payments.find(p=>p.previous_payment_id===prior.id);if(duplicate)return {order,payment:duplicate};
    if(payments[payments.length-1]?.id===prior.id && ['CREATED','PENDING'].includes(prior.status))return {order,payment:prior};
    if(payments[payments.length-1]?.id!==prior.id || !['FAILED','CANCELLED','EXPIRED'].includes(prior.status) || order.payment_status==='PAID' || order.reconciliation_required || order.inventory_finalized_at)return rejected('This order cannot start another payment. Check its current status.');
    const other=await client.query(`SELECT 1 FROM orders WHERE guest_session_hash=$1 AND test_mode AND id<>$2 AND (order_status='PENDING_PAYMENT' OR reconciliation_required) LIMIT 1`,[hash,order.id]);
    if(other.rowCount)return rejected('Another payment is pending. Check that order before starting another attempt.');
    const lines=await orderLines(client,order.id);await lockSelections(client,lines.map(l=>l.variant_id));
    const current=(await client.query<{id:string;price:string;available:number;eligible:boolean;name:string;sku:string;configuration:string}>(`SELECT v.id,price.amount_minor::TEXT AS price,stock.on_hand-stock.reserved AS available,
      (p.status='PUBLISHED' AND p.published_at<=clock_timestamp() AND p.product_type<>'BESPOKE' AND p.sales_mode IN ('DIRECT_PURCHASE','BOTH') AND v.is_active) AS eligible,
      p.name,v.sku,concat_ws(' · ',v.size_label,NULLIF(v.configuration_label,''),v.metal_type,v.metal_purity,v.metal_color) AS configuration
      FROM product_variants v JOIN products p ON p.id=v.product_id JOIN product_prices price ON price.variant_id=v.id AND price.is_active AND price.currency='EGP'
      JOIN inventory stock ON stock.variant_id=v.id WHERE v.id=ANY($1::UUID[])`,[lines.map(l=>l.variant_id)])).rows;
    if(lines.some(l=>!current.some(c=>c.id===l.variant_id && c.eligible && c.available>=l.quantity && c.price===l.unit_price_minor && c.sku===l.sku_snapshot && c.name===l.product_name_snapshot && c.configuration===(l.configuration_snapshot??''))))return rejected('A selection or its price changed. Review your shopping bag to prepare a new checkout.');
    if(order.fulfillment_method==='BOUTIQUE_COLLECTION'){
      const selected=await client.query(`SELECT id FROM boutique_locations WHERE id=$1 AND is_active AND country_code='EG' FOR SHARE`,[order.boutique_location_id]);
      if(!selected.rowCount)return rejected('The collection location is unavailable. Prepare a new checkout.');
      const l=(await locations(client)).find(l=>l.id===order.boutique_location_id);
      if(!l || !order.boutique_location_snapshot || (['id','name','governorate','city','street'] as const).some(key=>l[key]!==order.boutique_location_snapshot![key]))return rejected('The collection location changed. Prepare a new checkout.');
    }
    const payment=await newPayment(client,order,config.integrationId,config.ownerId,prior.id);
    await reserve(client,order.id,order.source_cart_id,payment.id,lines.map(l=>({variantId:l.variant_id,quantity:l.quantity})));
    await history(client,order,'ORDER','PENDING_PAYMENT','TEST_PAYMENT_RETRY');await history(client,order,'PAYMENT','PENDING','TEST_PAYMENT_RETRY');
    return {order,payment};
  },false,'payment');
}

export async function readOrder(token:string|null,reference:string):Promise<OrderView|null> {
  if(!token)return null;const hash=tokenHash(token);
  return withTransaction(async client=>{
    const o=(await client.query<OrderRow>(`SELECT * FROM orders WHERE id=$1 AND test_mode AND guest_session_hash=$2 AND guest_access_expires_at>clock_timestamp()
      AND EXISTS(SELECT 1 FROM carts WHERE session_token_hash=$2 AND status='ACTIVE' AND customer_profile_id IS NULL AND expires_at>clock_timestamp())`,[reference,hash])).rows[0];if(!o)return null;
    const items=(await client.query<{name:string;sku:string;configuration:string;quantity:number;unitPriceMinor:string;lineTotalMinor:string}>(`SELECT product_name_snapshot AS name,sku_snapshot AS sku,COALESCE(configuration_snapshot,'') AS configuration,quantity,unit_price_minor::TEXT AS "unitPriceMinor",line_total_minor::TEXT AS "lineTotalMinor" FROM order_items WHERE order_id=$1 ORDER BY created_at,id`,[o.id])).rows;
    const p=(await client.query<PaymentRow>('SELECT * FROM payments WHERE order_id=$1 AND test_mode ORDER BY created_at DESC,id DESC LIMIT 1',[o.id])).rows[0];
    const address=(await client.query<{destination:string}>(`SELECT concat_ws(', ',street_address,building,floor_unit,city_area,governorate,'Egypt') AS destination FROM order_addresses WHERE order_id=$1`,[o.id])).rows[0];
    return {reference:o.id,orderStatus:o.order_status,paymentStatus:o.payment_status,fulfillmentStatus:o.fulfillment_status,reconciliationRequired:o.reconciliation_required,inventoryFinalized:Boolean(o.inventory_finalized_at),testMode:true,
      amountMinor:o.total_minor,currency:'EGP',method:o.fulfillment_method,destination:o.fulfillment_method==='PRIVATE_DELIVERY'?address?.destination??'':o.boutique_location_snapshot?[o.boutique_location_snapshot.name,o.boutique_location_snapshot.street,o.boutique_location_snapshot.city,o.boutique_location_snapshot.governorate,'Egypt'].join(', '):'',items,
      attempt:p?{reference:p.local_reference,status:p.status,initiationState:p.initiation_state}:null,canRetry:Boolean(p && ['FAILED','CANCELLED','EXPIRED'].includes(p.status) && !o.reconciliation_required && !o.inventory_finalized_at && o.payment_status!=='PAID'),
      canContinue:Boolean(p && ['CREATED','PENDING'].includes(p.status) && ['LOCAL_READY','READY'].includes(p.initiation_state) && !o.reconciliation_required && (!p.checkout_resume_until || p.checkout_resume_until.getTime()>Date.now()))};
  },true,'payment');
}

export async function pendingOrderLink(token:string|null):Promise<string|null> {
  if(!token || !process.env.PAYMENT_DATABASE_URL?.trim())return null;
  return withTransaction(async client=>{
    const row=(await client.query<{id:string}>(`SELECT id FROM orders WHERE test_mode AND guest_session_hash=$1 AND guest_access_expires_at>clock_timestamp()
      AND EXISTS(SELECT 1 FROM carts WHERE session_token_hash=$1 AND status='ACTIVE' AND customer_profile_id IS NULL AND expires_at>clock_timestamp())
      AND (order_status='PENDING_PAYMENT' OR reconciliation_required) ORDER BY created_at DESC,id DESC LIMIT 1`,[tokenHash(token)])).rows[0];
    return row?'/orders/'+row.id:null;
  },true,'payment');
}

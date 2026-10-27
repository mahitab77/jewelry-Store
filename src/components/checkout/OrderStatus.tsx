"use client";
import Link from 'next/link';
import { useCallback,useEffect,useRef,useState } from 'react';
import { formatEgp } from '../../lib/catalogue/presentation.ts';
import type { OrderView } from '../../lib/payments/types.ts';
import { paymentDestination } from './PaymentAction';
import bag from '../cart/cart.module.css';
import styles from './checkout.module.css';

const money=(amount:string)=>formatEgp({currency:'EGP',amountMinor:amount});
export function OrderStatus({reference}:{reference:string}) {
  const [order,setOrder]=useState<OrderView|null>(null),[available,setAvailable]=useState(false),[loading,setLoading]=useState(true),[message,setMessage]=useState(''),[pending,setPending]=useState(false);
  const active=useRef(false),sequence=useRef(0),busy=useRef(false),last=useRef('');
  const refresh=useCallback(async()=>{
    if(busy.current)return;const version=++sequence.current;
    try{
      const response=await fetch('/api/orders/'+reference,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)}),body=await response.json();
      if(!active.current || version!==sequence.current)return;
      if(!response.ok || !body.order){setOrder(null);setMessage(response.status===404?'This order is unavailable. Use the browser that prepared the checkout.':'Order status could not be refreshed. Try again before continuing.');return;}
      const next=body.order as OrderView;setOrder(next);setAvailable(body.paymentsAvailable===true);setMessage('');
      if(last.current!==next.paymentStatus && ['PAID','FAILED'].includes(next.paymentStatus)){
        if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('la-palme-shopping-bag');channel.postMessage('refresh');channel.close();}
      }
      last.current=next.paymentStatus;
    }catch{if(active.current && version===sequence.current){setMessage('Order status could not be refreshed. Try again before continuing.');setAvailable(false);}}
    finally{if(active.current && version===sequence.current)setLoading(false);}
  },[reference]);
  useEffect(()=>{
    active.current=true;const update=()=>{if(document.visibilityState==='visible')void refresh();};
    const initial=window.setTimeout(update,0),interval=window.setInterval(update,5000);window.addEventListener('focus',update);document.addEventListener('visibilitychange',update);
    return()=>{active.current=false;window.clearTimeout(initial);window.clearInterval(interval);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);};
  },[refresh]);
  async function payment(){
    if(!order?.attempt || busy.current || message)return;busy.current=true;sequence.current++;setPending(true);setMessage('');
    try{
      const response=await fetch('/api/orders/'+reference+'/payment',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({attemptReference:order.attempt.reference}),signal:AbortSignal.timeout(25000)});
      const destination=await paymentDestination(response);if(active.current)window.location.assign(destination);
    }catch(error){if(active.current){setMessage(error instanceof Error && error.name!=='TimeoutError'?error.message:'This payment request could not be confirmed. Refresh the order before trying again.');busy.current=false;setPending(false);}}
  }
  const heading=order?.reconciliationRequired?'Payment needs review':order?.paymentStatus==='PAID'?'Test payment received':order?.paymentStatus==='FAILED'?'Test payment unsuccessful':'Awaiting payment confirmation';
  return <section className={`maison-container ${bag.root} ${styles.root}`}><p className={bag.eyebrow}>Your personal arrangement</p><h1 className="font-display">{loading?'Opening order status':order?heading:'Order unavailable'}</h1>
    {message?<p role="alert" className={bag.feedback}>{message}</p>:null}
    <button type="button" className={`hero-cta hero-secondary-button ${bag.button}`} disabled={pending} onClick={()=>void refresh()}>Refresh order status</button>
    {order?<><p className={bag.intro}>This is a test-mode order. No real payment should be made.</p><p>Reference: <span data-order-reference>{order.reference}</span></p>
      <div role="status" aria-live="polite" className={bag.notice}>{order.reconciliationRequired?'The payment outcome or stock needs personal review. Do not start another payment; the boutique must reconcile this exception.':order.paymentStatus==='PAID'?'A server-verified test payment was received. Personal delivery or collection has not been scheduled.':order.paymentStatus==='FAILED'?'The test payment was unsuccessful. Your order history is preserved. Availability will be checked again before a retry.':'Payment has not been confirmed. A return from Paymob does not prove payment. Refresh this page for the verified result.'}</div>
      <div className={bag.layout}><section className={styles.review} aria-label="Order selection"><h2 className="font-display">Your selection</h2>{order.items.map((item,index)=><article className={`${styles.line} ${styles.orderLine}`} key={index}><div><h3>{item.name}</h3><p>{item.sku} · {item.configuration||'Standard configuration'}</p><p>Quantity: {item.quantity}</p><p>Unit price: {money(item.unitPriceMinor)}</p><p>Line total: {money(item.lineTotalMinor)}</p></div></article>)}</section>
        <aside className={bag.summary}><h2 className="font-display">Personal fulfillment</h2><p>{order.method==='PRIVATE_DELIVERY'?'Private Delivery':'Boutique Collection'}</p><address>{order.destination}</address><p className={bag.detail}>Arrangements remain pending and will be confirmed personally by the boutique. No date or appointment is promised.</p><div className={bag.subtotal}><span>Test order amount</span><strong>{money(order.amountMinor)}</strong></div></aside></div>
      {(order.canRetry||order.canContinue)&&available&&!message?<button type="button" disabled={pending} className={`hero-cta hero-primary-button ${bag.button}`} onClick={()=>void payment()}>{pending?'Opening secure payment…':order.canRetry?'Retry Test Payment':'Continue to Secure Payment'}</button>:null}
      {(order.canRetry||order.canContinue)&&!available?<p className={bag.notice}>Online test payment is currently unavailable.</p>:null}
      {order.inventoryFinalized?<p className={bag.detail}>Unchanged purchased selections were reconciled with your bag. Selections you edited or added remain for your review.</p>:null}
    </>:loading?<p role="status">Checking the authoritative order status…</p>:null}
    <p><Link href="/cart" className={`hero-cta hero-secondary-button ${bag.button}`}>Return to your bag</Link></p>
  </section>;
}

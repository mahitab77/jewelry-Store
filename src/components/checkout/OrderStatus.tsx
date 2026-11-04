"use client";
import Link from 'next/link';
import { useCallback,useEffect,useRef,useState } from 'react';
import { formatEgp } from '../../lib/catalogue/presentation.ts';
import type { OrderView } from '../../lib/payments/types.ts';
import { paymentDestination } from './PaymentAction';
import bag from '../cart/cart.module.css';
import styles from './checkout.module.css';

const money=(amount:string)=>formatEgp({currency:'EGP',amountMinor:amount});
type Phase='loading'|'ready'|'stale'|'temporary'|'denied';
type StatusView={reference:string;order:OrderView|null;phase:Phase;available:boolean;message:string};
const unavailable='This order is unavailable. Use the browser that prepared the checkout.';
const temporary='Order status is temporarily unavailable. The current payment outcome could not be confirmed. Refresh before continuing.';
const staleMessage='The details below were previously verified and may be outdated. Current payment status is unconfirmed. Refresh before continuing.';
export function OrderStatus({reference}:{reference:string}) {
  const [view,setView]=useState<StatusView>({reference,order:null,phase:'loading',available:false,message:''}),[pending,setPending]=useState(false);
  const active=useRef(false),sequence=useRef(0),busy=useRef(false),last=useRef('');
  const verified=useRef<OrderView|null>(null),request=useRef<AbortController|null>(null),lease=useRef<ReturnType<typeof setTimeout>|null>(null),retained=useRef(false);
  const clearLease=useCallback(()=>{if(lease.current!==null){clearTimeout(lease.current);lease.current=null;}retained.current=false;},[]);
  const clearProtected=useCallback((phase:Phase,message:string)=>{
    clearLease();verified.current=null;setView({reference,order:null,phase,available:false,message});
  },[reference,clearLease]);
  const refresh=useCallback(async()=>{
    if(busy.current || request.current)return;const version=++sequence.current,controller=new AbortController();request.current=controller;
    const current=()=>active.current && version===sequence.current && !controller.signal.aborted;
    async function transient(){
      if(!current())return;
      const previous=verified.current;
      clearLease();setView({reference,order:null,phase:'temporary',available:false,message:temporary});
      if(!previous)return;
      // HttpOnly cookies are intentionally unreadable here. Before retaining any
      // protected summary, ask the server to verify this exact order using the
      // current cookie. A failed proof hides the summary rather than guessing.
      try{
        const started=performance.now();
        const access=await fetch('/api/orders/'+reference+'/access',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(5000)])});
        if(!current())return;
        if([401,403,404].includes(access.status)){clearProtected('denied',unavailable);return;}
        if(!access.ok){clearProtected('temporary',temporary);return;}
        const proof=await access.json(),remaining=Number.isFinite(proof.validForMs)?Math.min(5000,proof.validForMs)-(performance.now()-started):0;
        if(!current())return;
        if(proof.verified!==true || proof.reference!==reference || remaining<=0 || previous!==verified.current){clearProtected('temporary',temporary);return;}
        retained.current=true;setView({reference,order:previous,phase:'stale',available:false,message:staleMessage});
        lease.current=setTimeout(()=>{if(active.current && retained.current)clearProtected('temporary',temporary);},remaining);
      }catch{if(current())clearProtected('temporary',temporary);}
    }
    try{
      const response=await fetch('/api/orders/'+reference,{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
      if(!current())return;
      if([401,403,404].includes(response.status)){clearProtected('denied',unavailable);return;}
      if(!response.ok){await transient();return;}
      const body=await response.json();if(!current())return;
      if(!body.order || body.order.reference!==reference){await transient();return;}
      const next=body.order as OrderView;clearLease();verified.current=next;setView({reference,order:next,phase:'ready',available:body.paymentsAvailable===true,message:''});
      if(last.current!==next.paymentStatus && ['PAID','FAILED'].includes(next.paymentStatus)){
        if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('la-palme-shopping-bag');channel.postMessage('refresh');channel.close();}
      }
      last.current=next.paymentStatus;
    }catch{await transient();}
    finally{if(request.current===controller)request.current=null;}
  },[reference,clearLease,clearProtected]);
  useEffect(()=>{
    active.current=true;verified.current=null;last.current='';
    const update=()=>{if(document.visibilityState==='visible')void refresh();};
    const invalidate=()=>{sequence.current++;request.current?.abort();request.current=null;};
    const hide=()=>{invalidate();clearProtected('loading','');};
    const visibility=()=>{if(document.visibilityState==='visible')update();else hide();};
    const initial=window.setTimeout(update,0),interval=window.setInterval(update,5000);window.addEventListener('focus',update);window.addEventListener('pagehide',hide);window.addEventListener('pageshow',update);document.addEventListener('visibilitychange',visibility);
    return()=>{active.current=false;invalidate();verified.current=null;clearLease();window.clearTimeout(initial);window.clearInterval(interval);window.removeEventListener('focus',update);window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',update);document.removeEventListener('visibilitychange',visibility);};
  },[refresh,clearLease,clearProtected]);
  const {order,phase,available,message}=view.reference===reference?view:{order:null,phase:'loading' as const,available:false,message:''},loading=phase==='loading',stale=phase==='stale';
  async function payment(){
    if(!order?.attempt || busy.current || message || phase!=='ready' || !available)return;busy.current=true;sequence.current++;request.current?.abort();request.current=null;setPending(true);
    try{
      const response=await fetch('/api/orders/'+reference+'/payment',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({attemptReference:order.attempt.reference}),signal:AbortSignal.timeout(25000)});
      const destination=await paymentDestination(response);if(active.current)window.location.assign(destination);
    }catch(error){if(active.current){setView(current=>({...current,available:false,message:error instanceof Error && error.name!=='TimeoutError'?error.message:'This payment request could not be confirmed. Refresh the order before trying again.'}));busy.current=false;setPending(false);}}
  }
  const heading=order?.reconciliationRequired?'Payment needs review':order?.paymentStatus==='PAID'?'Test payment received':order?.paymentStatus==='FAILED'?'Test payment unsuccessful':'Awaiting payment confirmation';
  const fulfillmentCopy=order?.paymentStatus==='PAID'&&order.inventoryFinalized&&!order.reconciliationRequired?({
    PREPARING:'Your jewellery is being prepared.',ARRANGING:'Your personal delivery or collection is being arranged. No appointment is confirmed yet.',
    SCHEDULED:'Your appointment has been confirmed personally by the boutique.',IN_PROGRESS:'Your jewellery is out for personal delivery.',
    READY:'Your jewellery is ready for the agreed boutique collection.',COMPLETED:order.method==='PRIVATE_DELIVERY'?'Your jewellery has been delivered and handed over.':'Your jewellery has been collected and handed over.',
    CANCELLED:'The previous arrangement was cancelled. The boutique must arrange the next step personally.',
  } as Record<string,string>)[order.fulfillmentStatus]:undefined;
  return <section className={`maison-container ${bag.root} ${styles.root}`}><div className={styles.orderContent}><p className={bag.eyebrow}>Your personal arrangement</p><h1 className="font-display">{loading?'Opening order status':stale?'Order status needs refreshing':order?heading:phase==='temporary'?'Order status temporarily unavailable':'Order unavailable'}</h1>
    {message?<p role="alert" className={bag.feedback}>{message}</p>:null}
    <button type="button" className={`hero-cta hero-secondary-button ${bag.button}`} disabled={pending} onClick={()=>void refresh()}>Refresh order status</button>
    {order?<><p className={bag.intro}>This is a test-mode order. No real payment should be made.</p><p>Reference: <span data-order-reference>{order.reference}</span></p>
      <div role="status" aria-live="polite" className={bag.notice}>{stale?'Last verified payment status: '+order.paymentStatus+'. Payment actions are unavailable until the latest status can be verified.':order.reconciliationRequired?'The payment outcome or stock needs personal review. Do not start another payment; the boutique must reconcile this exception.':order.paymentStatus==='PAID'?fulfillmentCopy||'A server-verified test payment was received. Personal delivery or collection has not been scheduled.':order.paymentStatus==='FAILED'?'The test payment was unsuccessful. Your order history is preserved. Availability will be checked again before a retry.':'Payment has not been confirmed. A return from Paymob does not prove payment. Refresh this page for the verified result.'}</div>
      <div className={bag.layout}><section className={styles.review} aria-label="Order selection"><h2 className="font-display">Your selection</h2>{order.items.map((item,index)=><article className={`${styles.line} ${styles.orderLine}`} key={index}><div><h3>{item.name}</h3><p>{item.sku} · {item.configuration||'Standard configuration'}</p><p>Quantity: {item.quantity}</p><p>Unit price: {money(item.unitPriceMinor)}</p><p>Line total: {money(item.lineTotalMinor)}</p></div></article>)}</section>
        <aside className={bag.summary}><h2 className="font-display">Personal fulfillment</h2><p>{order.method==='PRIVATE_DELIVERY'?'Private Delivery':'Boutique Collection'}</p><address>{order.destination}</address><p className={bag.detail}>{fulfillmentCopy||'Arrangements remain pending and will be confirmed personally by the boutique. No date or appointment is promised.'}</p><div className={bag.subtotal}><span>Test order amount</span><strong>{money(order.amountMinor)}</strong></div></aside></div>
      {(order.canRetry||order.canContinue)&&available&&!message&&phase==='ready'?<button type="button" disabled={pending} className={`hero-cta hero-primary-button ${bag.button}`} onClick={()=>void payment()}>{pending?'Opening secure payment…':order.canRetry?'Retry Test Payment':'Continue to Secure Payment'}</button>:null}
      {(order.canRetry||order.canContinue)&&!available?<p className={bag.notice}>{stale?'Refresh the order to verify payment availability.':'Online test payment is currently unavailable.'}</p>:null}
      {order.inventoryFinalized?<p className={bag.detail}>Unchanged purchased selections were reconciled with your bag. Selections you edited or added remain for your review.</p>:null}
    </>:loading?<p role="status" className={styles.orderLoading}>Checking the authoritative order status…</p>:null}</div>
    <p><Link href="/cart" className={`hero-cta hero-secondary-button ${bag.button}`}>Return to your bag</Link></p>
  </section>;
}

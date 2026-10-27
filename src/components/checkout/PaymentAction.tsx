"use client";
import { useEffect,useRef,useState } from 'react';
import bag from '../cart/cart.module.css';

export async function paymentDestination(response:Response):Promise<string> {
  const body=await response.json();if(!response.ok)throw new Error(typeof body.message==='string'?body.message:'The payment request could not be confirmed.');
  if(typeof body.orderUrl!=='string' || !/^\/orders\/[0-9a-f-]{36}$/.test(body.orderUrl))throw new Error('The order destination could not be verified.');
  if(!body.checkoutUrl)return body.orderUrl;
  const url=new URL(body.checkoutUrl);
  if(url.origin!=='https://eg.checkout.paymob.com' || url.pathname!=='/' || url.hash || url.username || url.password || [...url.searchParams.keys()].some(key=>!['publicKey','clientSecret'].includes(key)) || url.searchParams.getAll('publicKey').length!==1 || url.searchParams.getAll('clientSecret').length!==1 || !/^(?:egy_)?pk_test_[A-Za-z0-9_-]{16,200}$/.test(url.searchParams.get('publicKey')??'') || !/^egy_csk_test_[A-Za-z0-9_-]{16,200}$/.test(url.searchParams.get('clientSecret')??''))throw new Error('The secure checkout destination could not be verified.');
  return url.href;
}
export function PaymentAction({available,saved,fingerprint,revision,amount,pendingOrder}:{available:boolean;saved:boolean;fingerprint:string;revision:string|null;amount:string;pendingOrder:boolean}) {
  const [pending,setPending]=useState(false),[message,setMessage]=useState('');const busy=useRef(false),active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  async function proceed(){
    if(busy.current || !saved || !revision)return;busy.current=true;setPending(true);setMessage('');
    try{
      const response=await fetch('/api/payments/initiate',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({fingerprint,draftRevision:revision}),signal:AbortSignal.timeout(25000)});
      const destination=await paymentDestination(response);if(active.current)window.location.assign(destination);
    }catch(error){if(active.current){setMessage(error instanceof Error && error.name!=='TimeoutError'?error.message:'The request could not be confirmed. Refresh checkout to find any pending order before trying again.');busy.current=false;setPending(false);}}
  }
  if(pendingOrder)return <p>A payment or stock check already needs attention. Open your pending order before starting another payment.</p>;
  if(!available)return <p>Online payment is not available yet. No order has been placed, and your jewelry is not reserved.</p>;
  return <div><p>Paymob test mode only. Do not make a real payment.</p><p>Proceeding creates a pending test order and a temporary stock hold before opening Paymob.</p><p>Test payment amount: <strong>{amount}</strong>. No additional charges are configured for this test checkout. Fulfillment remains subject to personal arrangement.</p>
    {!saved?<p className={bag.notice}>Save these reviewed details before proceeding to secure payment.</p>:null}
    <button type="button" disabled={!saved || pending} className={`hero-cta hero-primary-button ${bag.button}`} onClick={()=>void proceed()}>{pending?'Opening secure payment…':'Proceed to Secure Payment'}</button>
    {message?<p role="alert" className={bag.feedback}>{message}</p>:null}</div>;
}

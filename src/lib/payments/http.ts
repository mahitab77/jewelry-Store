import 'server-only';
import { withDatabaseClient } from '../db/client.ts';
import { cartOrigin,CartError,object,readToken,uuid,revision } from '../cart/session.ts';
import { readCartJson } from '../cart/http.ts';
import { consume,throttleCart } from '../cart/repository.ts';
import { verifyCallback } from './paymob.ts';
import { processVerifiedEvent } from './lifecycle.ts';
import { initiatePayment,retryPayment } from './service.ts';
import { readOrder } from './orders.ts';
import { paymentsAvailable } from './config.ts';
import { PaymentError } from './types.ts';

const headers={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export const paymentJson=(value:unknown,status=200)=>Response.json(value,{status,headers});
export async function paymentHttp(request:Request,path:string[]=[]):Promise<Response> {
  try {
    const url=new URL(request.url);
    if(path.length===2 && path[0]==='paymob' && path[1]==='callback' && request.method==='POST'){
      if([...url.searchParams.keys()].some(key=>key!=='hmac') || url.searchParams.getAll('hmac').length!==1)throw new PaymentError('Payment callback could not be authenticated.',401);
      const signature=url.searchParams.get('hmac')!;
      if(!/^[a-fA-F0-9]{128}$/.test(signature))throw new PaymentError('Payment callback could not be authenticated.',401);
      const event=verifyCallback(await readCartJson(request,65536),signature);
      const allowed=await withDatabaseClient(client=>consume(client,'paymob-verified:'+event.integrationId,600),'payment');
      if(!allowed)return paymentJson({message:'Please retry this callback shortly.'},429);
      const result=await processVerifiedEvent(event);
      return paymentJson({received:result.status===200},result.status);
    }
    if(path.length===3 && path[0]==='paymob' && path[1]==='return' && request.method==='GET'){
      const reference=uuid(path[2]), destination=new URL('/orders/'+reference,cartOrigin().origin);
      // Discard EVERY provider query parameter. Redirects never change state.
      return new Response(null,{status:303,headers:{...headers,Location:destination.href}});
    }
    if(url.search)throw new PaymentError('Payment query parameters are not accepted.',400);
    if(request.headers.get('sec-fetch-site')==='cross-site')throw new PaymentError('This payment request could not be verified.',403);
    const token=readToken(request.headers).token;
    if(request.method!=='POST' || path.length!==1 || path[0]!=='initiate')return paymentJson({message:'Unsupported payment operation.'},405);
    if(request.headers.get('origin')!==cartOrigin().origin)throw new PaymentError('This payment request could not be verified.',403);
    if(!token)throw new PaymentError('Open your shopping bag before proceeding.',401);
    await throttleCart();
    const body=object(await readCartJson(request,2048),['fingerprint','draftRevision']);
    if(typeof body.fingerprint!=='string' || !/^[a-f0-9]{64}$/.test(body.fingerprint))throw new PaymentError('Review your current checkout before proceeding.',409);
    const result=await initiatePayment(token,body.fingerprint,revision(body.draftRevision));
    return paymentJson(result);
  }catch(error){return paymentJson({message:error instanceof PaymentError || error instanceof CartError ? error.message:'The test payment request could not be confirmed. Check your order before trying again.'},error instanceof PaymentError || error instanceof CartError?error.status:503);}
}
export async function orderHttp(request:Request,path:string[]):Promise<Response> {
  try{
    if(new URL(request.url).search)throw new PaymentError('Order query parameters are not accepted.',400);
    if(request.headers.get('sec-fetch-site')==='cross-site')throw new PaymentError('This order request could not be verified.',403);
    if(!path.length || path.length>2)return paymentJson({message:'This order is unavailable.'},404);
    let reference:string;try{reference=uuid(path[0]);}catch{return paymentJson({message:'This order is unavailable.'},404);}
    const token=readToken(request.headers).token;if(!token)return paymentJson({message:'This order is unavailable.'},404);
    if(request.method==='GET' && path.length===1){
      await throttleCart(true);const order=await readOrder(token,reference);return order?paymentJson({order,paymentsAvailable:paymentsAvailable()}):paymentJson({message:'This order is unavailable.'},404);
    }
    if(request.method!=='POST' || path.length!==2 || path[1]!=='payment')return paymentJson({message:'Unsupported order operation.'},405);
    if(request.headers.get('origin')!==cartOrigin().origin)throw new PaymentError('This payment request could not be verified.',403);
    await throttleCart();const body=object(await readCartJson(request,2048),['attemptReference']);
    const result=await retryPayment(token,reference,uuid(body.attemptReference));return paymentJson(result);
  }catch(error){return paymentJson({message:error instanceof PaymentError || error instanceof CartError?error.message:'Order status is temporarily unavailable. Refresh before continuing.'},error instanceof PaymentError || error instanceof CartError?error.status:503);}
}

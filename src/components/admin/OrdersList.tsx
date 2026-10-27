"use client";
import Link from 'next/link';
import { useRef,useState,type FormEvent } from 'react';
import { formatEgp } from '../../lib/catalogue/presentation.ts';
import { fulfillmentStatuses,label,paymentStatuses,type OrderList } from '../../lib/admin/orders/types.ts';
import styles from './catalogue.module.css';
export function OrdersList({initial}:{initial:OrderList}){
  const [listing,setListing]=useState(initial),[pending,setPending]=useState(false),[message,setMessage]=useState('');
  const filters=useRef<Record<string,unknown>>({}),busy=useRef(false);
  async function load(page:number,value=filters.current){
    if(busy.current)return;busy.current=true;setPending(true);setMessage('');
    try{const response=await fetch('/api/admin/orders/search',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({...value,page,pageSize:20}),signal:AbortSignal.timeout(15000)});const body=await response.json();if(!response.ok)throw new Error(body.message);setListing(body);filters.current=value;}
    catch(error){setMessage(error instanceof Error&&error.name!=='TimeoutError'?error.message:'Orders could not be loaded. Try again.');}finally{busy.current=false;setPending(false);}
  }
  function filter(event:FormEvent<HTMLFormElement>){event.preventDefault();void load(1,Object.fromEntries(new FormData(event.currentTarget)));}
  return <section className={styles.root}><div className={styles.toolbar}><Link href="/admin">Administration</Link><Link href="/admin/products">Catalogue</Link></div><h1 className="font-display">Orders</h1>
    <p className={styles.help}>Newest orders first, with a stable reference order for equal timestamps. Creation date filters use UTC. Search uses an exact order reference.</p>
    <form className={styles.grid} onSubmit={filter} aria-label="Order filters"><label className={styles.field}>Order reference<input name="reference" maxLength={80}/></label>
      <label className={styles.field}>Payment status<select name="paymentStatus"><option value="">All payment states</option>{paymentStatuses.map(v=><option key={v} value={v}>{label(v)}</option>)}</select></label>
      <label className={styles.field}>Fulfillment status<select name="fulfillmentStatus"><option value="">All fulfillment stages</option>{fulfillmentStatuses.map(v=><option key={v} value={v}>{label(v)}</option>)}</select></label>
      <label className={styles.field}>Fulfillment method<select name="method"><option value="">Both methods</option><option value="PRIVATE_DELIVERY">Private Delivery</option><option value="BOUTIQUE_COLLECTION">Boutique Collection</option></select></label>
      <label className={styles.field}>Created from (UTC)<input name="from" type="date"/></label><label className={styles.field}>Created through (UTC)<input name="to" type="date"/></label>
      <button className={`hero-cta hero-primary-button ${styles.button}`} disabled={pending}>Filter orders</button></form>
    <p role="status" aria-live="polite">{pending?'Loading orders…':message||`${listing.items.length} orders on this page.`}</p>
    {listing.items.length?<div className={styles.tableWrap} tabIndex={0} aria-label="Orders table; scroll horizontally on small screens"><table className={styles.table}><thead><tr>{['Reference','Created (Egypt)','Customer','Amount','Payment','Method','Fulfillment','Exception'].map(v=><th scope="col" key={v}>{v}</th>)}</tr></thead><tbody>{listing.items.map(o=><tr key={o.id}><td><Link href={'/admin/orders/'+o.id}>{o.reference}</Link></td><td>{new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',dateStyle:'medium',timeStyle:'short'}).format(new Date(o.createdAt))}</td><td>{o.customerName}</td><td>{formatEgp({currency:'EGP',amountMinor:o.amountMinor})}</td><td>{label(o.paymentStatus)}</td><td>{label(o.method)}</td><td>{label(o.fulfillmentStatus)}</td><td>{o.exception?'Review required':'—'}</td></tr>)}</tbody></table></div>:<p>No orders match the selected filters.</p>}
    <nav className={styles.actions} aria-label="Order list pages"><button className={`hero-cta hero-secondary-button ${styles.button}`} disabled={pending||listing.page===1} onClick={()=>void load(listing.page-1)}>Previous page</button><span>Page {listing.page}</span><button className={`hero-cta hero-secondary-button ${styles.button}`} disabled={pending||!listing.hasMore||listing.page>=1000} onClick={()=>void load(listing.page+1)}>Next page</button></nav>
  </section>;
}

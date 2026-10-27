"use client";
import Link from 'next/link';
import { useRef,useState,type FormEvent } from 'react';
import { formatEgp } from '../../lib/catalogue/presentation.ts';
import { followUps,label,reasons,type AdminOrder,type OrderAction } from '../../lib/admin/orders/types.ts';
import styles from './catalogue.module.css';
const date=(value:string|null)=>value?new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))+' (Egypt)':'Not set';
const money=(value:string)=>formatEgp({currency:'EGP',amountMinor:value});
const names:Record<OrderAction,string>={prepare:'Prepare jewellery',contact:'Record customer contact',propose:'Propose appointment',confirm:'Confirm agreed appointment',dispatch:'Out for personal delivery',ready:'Ready for collection',reschedule:'Reschedule appointment',failed:'Record unsuccessful attempt',complete:'Confirm jewellery handover',cancel:'Cancel this arrangement',note:'Add internal note',acknowledge:'Acknowledge payment exception',correct:'Append event correction'};
export function OrderDetail({initial}:{initial:AdminOrder}){
  const [order,setOrder]=useState(initial),[action,setAction]=useState<OrderAction>('note'),[pending,setPending]=useState(false),[stale,setStale]=useState(false),[message,setMessage]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState('');
  const busy=useRef(false),retry=useRef<{payload:string;id:string}|null>(null);
  const active=order.arrangements.find(a=>!['CANCELLED','RESCHEDULED'].includes(a.status));
  const allowed:OrderAction[]=['note','correct'];if(order.reconciliationReason)allowed.push('acknowledge');
  if(order.eligible&&order.fulfillmentStatus!=='COMPLETED'){
    if(['UNARRANGED','CANCELLED'].includes(order.fulfillmentStatus))allowed.push('prepare');
    if(order.fulfillmentStatus==='PREPARING')allowed.push('contact');
    if(order.fulfillmentStatus==='ARRANGING'){allowed.push('propose');if(active?.start)allowed.push('confirm');}
    if(order.fulfillmentStatus==='SCHEDULED')allowed.push(order.method==='PRIVATE_DELIVERY'?'dispatch':'ready');
    if(['SCHEDULED','IN_PROGRESS','READY'].includes(order.fulfillmentStatus))allowed.push('failed');
    if(['IN_PROGRESS','READY'].includes(order.fulfillmentStatus))allowed.push('complete');
    if(active&&active.status!=='COMPLETED')allowed.push('reschedule','cancel');
  }
  async function refresh(){const response=await fetch('/api/admin/orders/'+order.id,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});const body=await response.json();if(!response.ok)throw new Error(body.message);setOrder(body.order);setAction('note');setStale(false);return body.order as AdminOrder;}
  async function reload(){if(busy.current)return;busy.current=true;setPending(true);try{await refresh();setMessage('Current order loaded. Review before making changes.');}catch{setStale(true);setMessage('The order could not be refreshed. Try again before making changes.');}finally{busy.current=false;setPending(false);}}
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy.current||stale)return;const form=new FormData(event.currentTarget);
    const body:Record<string,unknown>={action,revision:order.revision,notes:String(form.get('notes')??'')};
    try{
      if(['propose','reschedule'].includes(action)){body.start=new Date(String(form.get('start'))).toISOString();body.end=new Date(String(form.get('end'))).toISOString();}
      if(['failed','complete'].includes(action))body.occurredAt=new Date(String(form.get('occurredAt'))).toISOString();
      if(action==='complete')body.recipient=String(form.get('recipient')??'');
      if(action==='confirm')body.assignedAdminId=String(form.get('assignedAdminId')??'');
      if(['failed','reschedule'].includes(action))body.reason=String(form.get('reason')??'');
      if(action==='failed')body.followUp=String(form.get('followUp')??'');
      if(action==='correct')body.correctsEventId=String(form.get('correctsEventId')??'');
    }catch{setMessage('Review the date and time fields.');return;}
    if(['confirm','complete','cancel'].includes(action)){
      const description=action==='complete'?`Record handover to ${body.recipient} at ${date(String(body.occurredAt))}? Confirm the recipient and actual handover personally.`:action==='confirm'?`Confirm this customer-agreed appointment for ${date(active?.start??null)} to ${date(active?.end??null)}? No notification will be sent.`:'Cancel this fulfillment arrangement? Payment and purchased stock stay recorded. This does not refund or cancel the financial order.';
      if(!window.confirm(description))return;body.confirmed=true;
    }
    const payload=JSON.stringify(body);if(retry.current?.payload!==payload)retry.current={payload,id:crypto.randomUUID()};body.operationId=retry.current!.id;
    busy.current=true;setPending(true);setMessage('');
    try{const response=await fetch('/api/admin/orders/'+order.id,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const result=await response.json();
      if(!response.ok){if(response.status===409)setStale(true);throw new Error(result.message);}
      await refresh();setAction('note');setMessage(result.message);
    }catch(error){setMessage(error instanceof Error&&error.name!=='TimeoutError'?error.message:'The operation could not be confirmed. Reload or retry the unchanged form to check safely.');}finally{busy.current=false;setPending(false);}
  }
  return <section className={styles.root}><div className={styles.toolbar}><Link href="/admin/orders">All orders</Link><button className={`hero-cta hero-secondary-button ${styles.button}`} disabled={pending} onClick={()=>void reload()}>Reload order</button></div>
    <h1 className="font-display">Order {order.reference}</h1>{order.testMode?<p>Test-mode order · no real payment.</p>:null}
    <section className={styles.panel} aria-label="Order overview"><h2>Order overview</h2><p>Created {date(order.createdAt)} · {label(order.orderStatus)}</p><p>Verified payment state: <strong>{label(order.paymentStatus)}</strong></p><p>Fulfillment: <strong>{label(order.fulfillmentStatus)}</strong> · {label(order.method)}</p><p>Subtotal {money(order.subtotalMinor)} · Discount {money(order.discountMinor)} · Tax {money(order.taxMinor)} · Fulfillment fee {money(order.feeMinor)}</p><p>Historical order total: <strong>{money(order.amountMinor)}</strong></p></section>
    <section className={styles.panel} aria-label="Purchased jewellery"><h2>Purchased jewellery</h2>{order.items.map(item=><article className={styles.history} key={item.id}><h3>{item.name}</h3><p>{item.sku} · {item.configuration||'Standard configuration'} · Quantity {item.quantity}</p><p>Purchased unit price {money(item.unitMinor)} · Line total {money(item.totalMinor)}</p></article>)}</section>
    <div className={styles.grid}><section className={styles.panel} aria-label="Customer contact"><h2>Customer contact</h2><p>{order.customerName}</p><p>{order.email||'Email not recorded'}</p><p>{order.phone}</p></section><section className={styles.panel} aria-label="Immutable destination"><h2>Original destination</h2><p>{order.destination}</p>{order.instructions?<p>{order.instructions}</p>:null}{!order.locationActive?<p role="alert">Original boutique location is inactive or unavailable. Confirmation, readiness and handover are blocked.</p>:null}{order.locationChanged?<p role="status">Current boutique details differ. The original checkout destination is preserved; confirm arrangements personally.</p>:null}</section></div>
    <section className={styles.panel} aria-label="Payment status and history"><h2>Payment status and history</h2><p>Financial history is read only. A browser return does not verify a payment.</p>{order.payments.map(p=><article className={styles.history} key={p.id}><p>Attempt {p.id} · {label(p.status)} · {money(p.amountMinor)}</p><p>Created {date(p.createdAt)} · Verified success {date(p.succeededAt)}</p><p>Provider transaction: {p.transaction||'Not confirmed'} · Initiation {label(p.initiationState)}</p>{p.errorCode?<p>Review code: {p.errorCode}</p>:null}{order.paymentEvents.filter(e=>e.paymentId===p.id).map(e=><p key={e.id}>Event {label(e.status)} · {e.verified?'Authenticated provider evidence':'Not verified'} · Received {date(e.receivedAt)} · Processed {date(e.processedAt)}</p>)}</article>)}</section>
    <section className={styles.panel} aria-label="Payment exceptions"><h2>Payment exceptions</h2>{order.exception?<p role="alert">Review required: {order.reconciliationReason?label(order.reconciliationReason):'Refund or payment / stock eligibility requires operator review'}. Acknowledgment records staff review and does not resolve this exception.</p>:<p>No current payment exception identified.</p>}<p>Purchased stock finalization: {order.inventoryFinalized?'Recorded':'Not recorded'}. Fulfillment eligibility: {order.eligible?'Eligible':'Blocked or already completed'}. Reconciliation remains an operator CLI task.</p></section>
    <section className={styles.panel} aria-label="Fulfillment arrangements"><h2>Fulfillment arrangements</h2><p>Appointments are agreed personally. No customer notification is sent by these controls.</p>{order.arrangements.length?order.arrangements.map(a=><article className={styles.history} key={a.id}><p>{a.id} · {label(a.status)} · Assigned {a.staffName||'Unassigned'}</p><p>{a.status==='REQUESTED'?'Proposed appointment':'Appointment'}: {date(a.start)} — {date(a.end)}</p>{a.completedAt?<p>Handover completed {date(a.completedAt)} by {a.completedBy}</p>:null}{a.supersedesId?<p>Supersedes {a.supersedesId}</p>:null}</article>):<p>Preparation has not started.</p>}</section>
    <section className={styles.panel} aria-label="Fulfillment action controls"><h2>Record an operation</h2><p>Payment and inventory states cannot be changed here. Dates entered below use this device’s local time; the Egypt preview shows the recorded appointment.</p>
      <form onSubmit={e=>void submit(e)}><fieldset disabled={pending||stale} className={styles.grid}><legend className="sr-only">Order operation</legend>
        <label className={styles.field}>Operation<select aria-label="Operation" value={action} onChange={e=>setAction(e.target.value as OrderAction)}>{allowed.map(v=><option key={v} value={v}>{names[v]}</option>)}</select></label>
        {['propose','reschedule'].includes(action)?<><label className={styles.field}>Appointment start (device local)<input type="datetime-local" name="start" required value={start} onChange={e=>setStart(e.target.value)}/></label><label className={styles.field}>Appointment end (device local)<input type="datetime-local" name="end" required value={end} onChange={e=>setEnd(e.target.value)}/></label><p className={styles.help}>Egypt preview: {start&&Number.isFinite(Date.parse(start))?date(new Date(start).toISOString()):'Choose a start'} — {end&&Number.isFinite(Date.parse(end))?date(new Date(end).toISOString()):'Choose an end'}</p></>:null}
        {action==='confirm'?<label className={styles.field}>Responsible administrator<select name="assignedAdminId" required defaultValue={active?.assignedAdminId??''}><option value="">Choose staff</option>{order.staff.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>:null}
        {['failed','complete'].includes(action)?<label className={styles.field}>Actual attempt time (device local)<input type="datetime-local" name="occurredAt" required/></label>:null}
        {action==='complete'?<label className={styles.field}>Confirmed recipient name<input name="recipient" required maxLength={100}/></label>:null}
        {['failed','reschedule'].includes(action)?<label className={styles.field}>Operational reason<select name="reason" required>{reasons.map(r=><option key={r} value={r}>{label(r)}</option>)}</select></label>:null}
        {action==='failed'?<label className={styles.field}>Follow-up<select name="followUp" required>{followUps.map(v=><option key={v} value={v}>{label(v)}</option>)}</select></label>:null}
        {action==='correct'?<label className={styles.field}>Event to correct<select name="correctsEventId" required><option value="">Choose original event</option>{order.events.map(e=><option key={e.id} value={e.id}>{label(e.type)} · {date(e.recordedAt)} · {e.id}</option>)}</select></label>:null}
        <label className={styles.field}>Internal operational note<textarea name="notes" maxLength={1000} required={['note','acknowledge','correct'].includes(action)}/></label>
        <button type="submit" className={`hero-cta hero-primary-button ${styles.button}`} disabled={!allowed.includes(action)}>{pending?'Recording…':names[action]}</button>
      </fieldset></form><p className={styles.notice} role="status" aria-live="polite">{message||'Review the order before recording an operation.'}</p>{stale?<p>Reload the order to review the current state before making another change.</p>:null}
    </section>
    <section className={styles.panel} aria-label="Internal notes and event history"><h2>Internal notes and event history</h2>{order.events.map(e=><article className={styles.history} key={e.id}><p>{label(e.type)} · {date(e.occurredAt)} · {e.actorName||'System'}</p><p>Event {e.id} · Arrangement {e.arrangementId||'Order note'} · Recorded {date(e.recordedAt)}</p>{e.recipient?<p>Handover recipient: {e.recipient} · {label(order.method)}</p>:null}{e.reason?<p>Reason: {label(e.reason)} · Follow-up: {e.followUp?label(e.followUp):'See arrangement'}</p>:null}{e.notes?<p>{e.notes}</p>:null}{e.correctsEventId?<p>Correction to {e.correctsEventId}; original record preserved.</p>:null}</article>)}</section>
    <section className={styles.panel} aria-label="Order audit history"><h2>Order audit history</h2>{order.audit.map(a=><article className={styles.history} key={a.id}><p>{label(a.action)} · {date(a.at)} · {a.actorName||'System'}</p><code>{JSON.stringify(a.metadata)}</code></article>)}{order.history.map((h,i)=><p key={i}>{label(h.domain)}: {h.from?label(h.from):'New'} → {label(h.to)} · {date(h.at)}</p>)}</section>
  </section>;
}

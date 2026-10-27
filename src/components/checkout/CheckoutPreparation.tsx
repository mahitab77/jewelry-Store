"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { emptyDetails, type CheckoutDetails, type CheckoutErrors, type CheckoutView } from "../../lib/checkout/types.ts";
import { governorates } from "../../lib/checkout/egypt.ts";
import { formatEgp } from "../../lib/catalogue/presentation.ts";
import { ProductPhoto } from "../catalogue/ProductPhoto";
import bag from "../cart/cart.module.css";
import styles from "./checkout.module.css";

const signature = (details: CheckoutDetails) => JSON.stringify(details);
const money = (amount: string | null) => amount === null ? "Unavailable" : formatEgp({ currency: "EGP", amountMinor: amount });
const steps = { CART_REVIEW: "Your bag", CUSTOMER_DETAILS: "Contact details", FULFILLMENT: "Personal fulfillment", REVIEW_READY: "Ready for review" } as const;
function Field({ label, name, value, change, errors, type = "text", autoComplete, maxLength }: { label: string; name: keyof CheckoutDetails; value: string; change: (value: string) => void; errors: CheckoutErrors; type?: string; autoComplete?: string; maxLength: number }) {
  return <label className={styles.field} htmlFor={`checkout-${name}`}>{label}<input id={`checkout-${name}`} aria-label={label} name={name} type={type} autoComplete={autoComplete} maxLength={maxLength} value={value} onChange={(event) => change(event.target.value)} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `error-${name}` : undefined} dir="auto" />{errors[name] ? <span id={`error-${name}`} className={styles.error}>{errors[name]}</span> : null}</label>;
}
export function CheckoutPreparation() {
  const [view, setView] = useState<CheckoutView | null>(null), [details, setDetails] = useState(emptyDetails);
  const [loading, setLoading] = useState(true), [pending, setPending] = useState(false), [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState(""), [errors, setErrors] = useState<CheckoutErrors>({});
  const [proof, setProof] = useState<{ fingerprint: string; details: string } | null>(null), [conflict, setConflict] = useState(false);
  const current = useRef({ details: emptyDetails(), baseline: signature(emptyDetails()), revision: null as string | null, expiresAt: null as string | null, initialized: false, busy: false });
  const sequence = useRef(0), alert = useRef<HTMLDivElement>(null), channel = useRef<BroadcastChannel | null>(null);
  const active = useRef(false);
  const apply = useCallback((next: CheckoutView, replace = false, reviewOnly = false) => {
    const local = current.current;
    const expired = local.expiresAt !== null && !next.draft;
    if (reviewOnly && next.cart.revision) {
      local.details = next.details; setDetails(next.details);
      setProof(next.state === "REVIEW_READY" ? { fingerprint: next.fingerprint, details: signature(next.details) } : null);
      if (local.revision !== (next.draft?.revision ?? null)) setConflict(true);
    } else if (!next.cart.revision || expired) {
      local.details = emptyDetails(); local.baseline = signature(local.details); local.revision = null; local.expiresAt = null;
      setDetails(local.details); setProof(null); setConflict(false);
      if (expired) setFeedback("Your saved checkout details expired or were cleared. They have been removed from this page.");
    } else if (replace || !local.initialized || signature(local.details) === local.baseline) {
      local.details = next.details; local.baseline = signature(next.details); local.revision = next.draft?.revision ?? null; local.expiresAt = next.draft?.expiresAt ?? null;
      setDetails(next.details); setConflict(false);
      setProof(next.state === "REVIEW_READY" ? { fingerprint: next.fingerprint, details: signature(next.details) } : null);
    } else if (local.revision !== (next.draft?.revision ?? null)) setConflict(true);
    local.initialized = true;
    setView(next);
    setProof((previous) => previous && previous.fingerprint !== next.fingerprint ? null : previous);
  }, []);
  const refresh = useCallback(async (replace = false) => {
    if (current.current.busy) return;
    const version = ++sequence.current;
    try {
      const response = await fetch("/api/checkout", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15000) });
      const result = await response.json(); if (!response.ok || !result.checkout) throw new Error();
      if (active.current && version === sequence.current) { apply(result.checkout, replace); setLoadError(""); }
    } catch { if (active.current && version === sequence.current) { setLoadError("Checkout details could not be refreshed. Refresh before continuing."); setProof(null); } }
    finally { if (active.current && version === sequence.current) setLoading(false); }
  }, [apply]);
  useEffect(() => {
    active.current = true;
    const update = () => { if (document.visibilityState === "visible") void refresh(); };
    const initial = window.setTimeout(update, 0); window.addEventListener("focus", update); document.addEventListener("visibilitychange", update); window.addEventListener("pageshow", update);
    const interval = window.setInterval(update, 30000);
    const channels = typeof BroadcastChannel === "undefined" ? [] : [new BroadcastChannel("la-palme-shopping-bag"), new BroadcastChannel("la-palme-checkout")];
    channels.forEach((item) => { item.onmessage = update; }); channel.current = channels[1] ?? null;
    return () => { active.current = false; window.clearTimeout(initial); window.clearInterval(interval); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); window.removeEventListener("pageshow", update); channels.forEach((item) => item.close()); channel.current = null; };
  }, [refresh]);
  function change(name: keyof CheckoutDetails, value: string) {
    let next = { ...current.current.details, [name]: value } as CheckoutDetails;
    if (name === "method") next = value === "BOUTIQUE_COLLECTION" ? { ...next, governorate: "", city: "", street: "", building: "", floorUnit: "", instructions: "" } : { ...next, locationId: "" };
    current.current.details = next; setDetails(next); setProof(null); setFeedback(""); setErrors({});
  }
  async function submit(action: "draft" | "review" | "delete") {
    if (!view || current.current.busy) return;
    current.current.busy = true; sequence.current++; setPending(true); setFeedback(""); setErrors({}); setProof(null);
    try {
      const body = { draftRevision: current.current.revision, ...(action === "delete" ? {} : { details: current.current.details, fingerprint: view.fingerprint }) };
      const response = await fetch(`/api/checkout/${action === "delete" ? "draft" : action}`, { method: action === "delete" ? "DELETE" : "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (result.checkout) apply(result.checkout, response.ok, response.ok && action === "review");
      setFeedback(result.message || "Checkout details could not be updated."); setErrors(result.errors ?? {});
      if (!response.ok) requestAnimationFrame(() => alert.current?.focus());
      if (response.ok) { setLoadError(""); channel.current?.postMessage("refresh"); }
    } catch { setFeedback("The update could not be confirmed. Refresh saved details before trying again."); setLoadError("Refresh before continuing; the previous request may have reached the server."); requestAnimationFrame(() => alert.current?.focus()); }
    finally { current.current.busy = false; setPending(false); setLoading(false); }
  }
  const ready = Boolean(view?.cart.eligible && proof && proof.fingerprint === view.fingerprint && proof.details === signature(details) && !loadError && !pending && !loading);
  const state = ready ? "REVIEW_READY" : !view?.cart.eligible || view.changed && !proof ? "CART_REVIEW" : !details.fullName || !details.email || !details.phone ? "CUSTOMER_DETAILS" : "FULFILLMENT";
  const disabled = pending || loading || Boolean(loadError), location = view?.locations.find((item) => item.id === details.locationId);
  const field = (name: keyof CheckoutDetails, label: string, maxLength: number, type = "text", autoComplete?: string) => <Field name={name} label={label} value={details[name]} errors={errors} change={(value) => change(name, value)} maxLength={maxLength} type={type} autoComplete={autoComplete} />;
  return <section className={`maison-container ${bag.root} ${styles.root}`}>
    <p className={bag.eyebrow}>A personal arrangement</p><h1 className="font-display">Prepare your checkout</h1>
    <p className={bag.intro}>Review your selection and tell us how you would like to receive it. This prepares your details; it does not place an order, take payment or reserve jewelry.</p>
    <ol className={styles.steps} aria-label="Checkout preparation">{Object.entries(steps).map(([key, label], index) => <li key={key} aria-current={state === key ? "step" : undefined}>{index + 1}. {label}</li>)}</ol>
    <div ref={alert} tabIndex={-1} role="alert" hidden={!feedback && !loadError} className={bag.feedback}>{loadError || feedback}{Object.keys(errors).length ? <ul>{Object.entries(errors).map(([key, message]) => <li key={key}>{message}</li>)}</ul> : null}</div>
    {loadError ? <button type="button" className={`hero-cta hero-secondary-button ${bag.button}`} disabled={pending} onClick={() => void refresh()}>Refresh checkout</button> : null}
    {conflict ? <p className={bag.notice}>Saved details changed in another tab. Restore the current draft before saving again.</p> : null}
    {view?.changed && !ready ? <p className={bag.notice}>Your bag or collection options changed since the draft was saved. Review the current details again.</p> : null}
    {view?.draft ? <div className={bag.notice}><p>Saved until {new Date(view.draft.expiresAt).toLocaleString("en-GB")}. Saving again does not extend this expiry.</p>
      <div className={styles.actions}><button type="button" className={`hero-cta hero-secondary-button ${bag.button}`} disabled={disabled} onClick={() => void refresh(true)}>Restore saved details</button><button type="button" className={`hero-cta hero-secondary-button ${bag.button}`} disabled={disabled} onClick={() => void submit("delete")}>Clear saved details</button></div></div> : null}
    {!view ? loading ? <p role="status">Opening checkout preparation…</p> : null : !view.cart.items.length ? <div className={bag.empty}><h2 className="font-display">Begin with your shopping bag</h2><p>Add an available piece before preparing your checkout details.</p><Link href="/collections" className={`hero-cta hero-primary-button ${bag.button}`}>Explore the collections</Link></div> : <div className={bag.layout}>
      <div>{!view.cart.eligible ? <p className={bag.notice}>Some selections are unavailable or need a quantity adjustment. <Link href="/cart">Review your shopping bag</Link> before continuing.</p> : null}
        <form method="post" noValidate onSubmit={(event) => { event.preventDefault(); void submit("review"); }}>
          <fieldset className={styles.panel} disabled={disabled || !view.cart.eligible}><legend>Contact details</legend><div className={styles.grid}>
            {field("fullName", "Full name", 100, "text", "name")}{field("email", "Email address", 254, "email", "email")}{field("phone", "Egyptian mobile number", 40, "tel", "tel")}
          </div><p className={bag.detail}>No registration is required. Contact details are not independently verified.</p></fieldset>
          <fieldset className={styles.panel} disabled={disabled || !view.cart.eligible}><legend>Personal fulfillment</legend><div className={styles.methods}>
            <label><input type="radio" name="method" value="PRIVATE_DELIVERY" checked={details.method === "PRIVATE_DELIVERY"} onChange={() => change("method", "PRIVATE_DELIVERY")} />Private Delivery</label>
            <label><input type="radio" name="method" value="BOUTIQUE_COLLECTION" disabled={!view.locations.length} checked={details.method === "BOUTIQUE_COLLECTION"} onChange={() => change("method", "BOUTIQUE_COLLECTION")} />Boutique Collection</label>
          </div>{errors.method ? <p className={styles.error}>{errors.method}</p> : null}
          {!view.locations.length ? <p className={bag.notice}>Boutique Collection is currently unavailable. No active collection location is configured.</p> : null}
          {details.method === "PRIVATE_DELIVERY" ? <><p className={bag.detail}>Egypt only. For a completed purchase, the boutique will contact you to coordinate personal delivery. Availability and timing require confirmation.</p><div className={styles.grid}>
            <label className={styles.field} htmlFor="checkout-governorate">Governorate<select id="checkout-governorate" aria-label="Governorate" value={details.governorate} onChange={(event) => change("governorate", event.target.value)} aria-invalid={Boolean(errors.governorate)} aria-describedby={errors.governorate ? "error-governorate" : undefined}><option value="">Choose a governorate</option>{governorates.map((name) => <option key={name}>{name}</option>)}</select>{errors.governorate ? <span id="error-governorate" className={styles.error}>{errors.governorate}</span> : null}</label>
            {field("city", "City or area", 100, "text", "address-level2")}{field("street", "Street address", 200, "text", "address-line1")}{field("building", "Building or villa (if applicable)", 100)}{field("floorUnit", "Floor or apartment (optional)", 80, "text", "address-line2")}
          </div><label className={styles.field} htmlFor="checkout-instructions">Delivery instructions (optional)<textarea id="checkout-instructions" maxLength={500} value={details.instructions} onChange={(event) => change("instructions", event.target.value)} aria-invalid={Boolean(errors.instructions)} /></label></> : null}
          {details.method === "BOUTIQUE_COLLECTION" ? <><p className={bag.detail}>Collection arrangements will be confirmed personally by the boutique. No appointment is booked here.</p><label className={styles.field} htmlFor="checkout-locationId">Collection location<select id="checkout-locationId" aria-label="Collection location" value={details.locationId} onChange={(event) => change("locationId", event.target.value)} aria-invalid={Boolean(errors.locationId)} aria-describedby={errors.locationId ? "error-locationId" : undefined}><option value="">Choose an available location</option>{view.locations.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.city}, {item.governorate}</option>)}</select>{errors.locationId ? <span id="error-locationId" className={styles.error}>{errors.locationId}</span> : null}</label>{location ? <p className={bag.detail}>{location.street}, {location.city}, {location.governorate}, Egypt</p> : null}</> : null}
          </fieldset>
          <p className={bag.detail}>Saving a draft is optional. Saved contact and address details expire within 24 hours or when your bag session ends. Review without saving keeps your input on this page.</p>
          {!view.savingAvailable ? <p className={bag.notice}>Saved checkout details are temporarily unavailable. You can review without saving.</p> : null}
          <div className={styles.actions}><button type="button" disabled={disabled || !view.cart.eligible || conflict || !view.savingAvailable} className={`hero-cta hero-secondary-button ${bag.button}`} onClick={() => void submit("draft")}>{pending ? "Updating details…" : "Save draft"}</button><button type="submit" disabled={disabled || !view.cart.eligible} className={`hero-cta hero-primary-button ${bag.button}`}>Review details</button></div>
        </form>
        {ready ? <section className={styles.review} aria-label="Review-ready checkout"><h2 className="font-display">Ready for review</h2><p>{details.fullName}</p><p>{details.email} · {details.phone}</p><p>{details.method === "PRIVATE_DELIVERY" ? "Private Delivery" : "Boutique Collection"}</p>
          {details.method === "PRIVATE_DELIVERY" ? <address>{details.street}, {details.building} {details.floorUnit}, {details.city}, {details.governorate}, Egypt{details.instructions ? <p>{details.instructions}</p> : null}</address> : location ? <address>{location.name}: {location.street}, {location.city}, {location.governorate}, Egypt</address> : null}
          <p>Online payment is not available yet. No order has been placed, and your jewelry is not reserved.</p></section> : null}
        <Link href="/cart" className={`hero-cta hero-secondary-button ${bag.button}`}>Return to your bag</Link>
      </div>
      <aside className={bag.summary} aria-label="Checkout selection"><h2 className="font-display">Your selection</h2>{view.cart.items.map((item) => <article key={item.id} className={styles.line}>
        <div className={styles.photo}>{item.image ? <ProductPhoto src={item.image.source} alt={item.image.alt} fill sizes="64px" className={styles.image} /> : null}</div><div><h3>{item.name}</h3><p>{item.configuration || "Standard configuration"}</p><p>Quantity: {item.quantity}</p><p>Unit price: {money(item.unitPriceMinor)}</p><p>Line total: {money(item.lineTotalMinor)}</p>{item.notice ? <p>{item.notice}</p> : null}{item.priceChanged ? <p>The price has changed since this piece was added to your bag.</p> : null}</div>
      </article>)}<div className={bag.subtotal}><span>Jewelry subtotal</span><strong data-checkout-subtotal>{money(view.cart.subtotalMinor)}</strong></div><p className={bag.detail}>EGP jewelry prices only. Fulfillment charges are not confirmed, so this is not a final payable total.</p><p className={bag.detail}>Fulfillment: {details.method === "PRIVATE_DELIVERY" ? "Private Delivery" : details.method === "BOUTIQUE_COLLECTION" ? "Boutique Collection" : "Not selected"}</p><p className={bag.detail}>Prices and availability are rechecked during preparation. Your bag does not reserve stock.</p></aside>
    </div>}
  </section>;
}

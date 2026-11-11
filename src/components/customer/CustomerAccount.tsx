"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CustomerGate, useCustomer } from "./CustomerSessionProvider";
import { cairoFields } from "../../lib/requests/cairo";
import styles from "../requests/request.module.css";
type OwnRequest = { id: string; kind: string; status: string; message: string; productContext: { name: string; sku: string | null; size: string | null; configuration: string | null } | null;
  channel?: string; preferredStart?: string; confirmedStart?: string; boutiqueLocation?: { name: string; governorate: string; city: string; street: string } | null };
const time = (value?: string) => { if (!value) return "Not confirmed"; const p = cairoFields(value); return `${p.date} at ${p.time} (Africa/Cairo)`; };
function PrivateAccount() {
  const { customer, refresh, signOut } = useCustomer();
  const [section, setSection] = useState("requests"), [items, setItems] = useState<OwnRequest[]>([]), [page, setPage] = useState(1), [more, setMore] = useState(false);
  const [name, setName] = useState(customer?.name ?? ""), [phone, setPhone] = useState(customer?.phone ?? ""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const mounted = useRef(false), saving = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; saving.current?.abort(); }; }, []);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    if (section !== "details") void (async () => {
      try {
        const response = await fetch(`/api/account/${section}?page=${page}`, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]) });
        if (!active) return;
        if ([401,403].includes(response.status)) { window.dispatchEvent(new Event("lapalme-customer-denied")); return; }
        const body = await response.json(); if (!active) return;
        if (!response.ok || !Array.isArray(body.items)) throw new Error();
        setItems(body.items); setMore(body.hasMore === true);
      } catch { if (active) { setItems([]); setMore(false); setMessage("Your private requests could not be verified. Refresh your account to try again."); } }
    })();
    return () => { active = false; controller.abort(); };
  }, [section, page]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setMessage("");
    const controller = new AbortController(); saving.current = controller;
    try {
      const response = await fetch("/api/account/details", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, phone }), signal: AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]) });
      if (!mounted.current) return;
      if ([401,403].includes(response.status)) { window.dispatchEvent(new Event("lapalme-customer-denied")); return; }
      const body = await response.json(); if (!mounted.current) return; if (!response.ok) { setMessage(body.message || "Personal details could not be saved."); return; }
      setMessage("Your personal details were saved."); await refresh(false, true);
    } catch { if (mounted.current) setMessage("The update could not be confirmed. Refresh your personal details before trying again."); } finally { if (mounted.current) setBusy(false); }
  }
  return <section className={styles.root}><h1 className="font-display">My Account</h1><p>Your private conversations with La Palme d&apos;Or.</p>
    <nav aria-label="Account sections" className={styles.actions}>{[["requests","My Requests"],["appointments","My Appointments"],["details","Personal Details"]].map(([value,label]) => <button key={value} type="button" aria-current={section === value ? "page" : undefined} className={`hero-cta hero-secondary-button ${styles.button}`} onClick={() => { setItems([]); setMore(false); setMessage(""); setPage(1); setSection(value); }}>{label}</button>)}</nav>
    {message ? <p role="alert" className={styles.notice}>{message}</p> : null}
    {section === "details" ? <form onSubmit={save} className={styles.form}><h2>Personal Details</h2><label className={styles.field}>Name<input aria-label="Name" autoComplete="name" required minLength={2} maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label><label className={styles.field}>Verified email<input aria-label="Verified email" type="email" readOnly value={customer?.email ?? ""} /></label><label className={styles.field}>Telephone (optional)<input aria-label="Telephone (optional)" autoComplete="tel" type="tel" maxLength={40} value={phone} onChange={e => setPhone(e.target.value)} /></label><button className={`hero-cta hero-primary-button ${styles.button}`} disabled={busy}>Save personal details</button><p className={styles.help}>Your verified email is your account identity. Saving personal details does not change previously submitted requests.</p></form>
      : <><h2>{section === "appointments" ? "My Appointments" : "My Requests"}</h2><div className={styles.list}>{items.map(item => <article key={item.id} className={styles.item}><h3>{item.productContext?.name || (item.kind === "CONSULTATION" ? `${item.channel === "BOUTIQUE" ? "Boutique" : "Zoom"} Consultation` : "Bespoke design")}</h3><p>{item.kind.toLowerCase()} · {item.status.toLowerCase().replaceAll("_"," ")}</p><p className={styles.reference}>Reference: {item.id}</p>{item.productContext ? <p>Original configuration: {[item.productContext.size,item.productContext.configuration,item.productContext.sku].filter(Boolean).join(" · ") || "As selected"}</p> : null}<p style={{whiteSpace:"pre-wrap"}}>{item.message}</p>{item.kind === "CONSULTATION" ? <><p>Preferred: {time(item.preferredStart)}</p><p>Confirmed: {time(item.confirmedStart)}</p>{item.boutiqueLocation ? <p>{[item.boutiqueLocation.name,item.boutiqueLocation.street,item.boutiqueLocation.city,item.boutiqueLocation.governorate].join(", ")}</p> : null}</> : null}</article>)}{!items.length ? <p>No verified requests to show. You can refresh your account to check again.</p> : null}</div><div className={styles.actions}>{page > 1 ? <button className={styles.button} onClick={() => { setItems([]); setPage(page-1); }}>Previous requests</button> : null}{more ? <button className={styles.button} onClick={() => { setItems([]); setPage(page+1); }}>Next requests</button> : null}</div></>}
    <div className={styles.actions}><button className={`hero-cta hero-secondary-button ${styles.button}`} onClick={() => void refresh(true)}>Refresh account</button><button className={`hero-cta hero-secondary-button ${styles.button}`} onClick={async () => { if (await signOut()) window.location.replace("/account/sign-in"); else setMessage("Sign-out could not be confirmed. Please retry from the account menu."); }}>Sign Out</button></div>
  </section>;
}
export function CustomerAccount() { return <CustomerGate><PrivateAccount /></CustomerGate>; }

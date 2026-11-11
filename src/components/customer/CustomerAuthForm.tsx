"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { customerReturn } from "../../lib/customer/intent";
import { CustomerUnavailable, useCustomer } from "./CustomerSessionProvider";
import styles from "../requests/request.module.css";
export function CustomerAuthForm({ destination }: { destination: string }) {
  const router = useRouter(), session = useCustomer();
  const [registration, setRegistration] = useState(false), [name, setName] = useState(""), [email, setEmail] = useState(""), [code, setCode] = useState(""), [sent, setSent] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState(""), [cooldown, setCooldown] = useState(0);
  useEffect(() => { const clear = () => setCode(""); window.addEventListener("pagehide",clear); return () => window.removeEventListener("pagehide",clear); }, []);
  if (session.checking) return <section className={styles.root}><p role="status">Checking your private account access…</p></section>;
  if (!session.available) return <CustomerUnavailable />;
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending || session.checking || !session.available) return; setPending(true); setError("");
    try {
      const response = await fetch(`/api/customer-auth/${sent ? "verify-code" : "send-code"}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sent ? { email, code, ...(registration ? { name } : {}) } : { email }), signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (!response.ok) { setError(result.message || "Sign-in could not be completed. Please try again."); return; }
      if (!sent) { setSent(true); setCooldown(Date.now() + 60000); }
      else { setCode(""); await session.refresh(true); router.replace(customerReturn(destination)); }
    } catch { setError(sent ? "Sign-in could not be confirmed. Check My Account before requesting another code." : "Delivery could not be confirmed. Please wait before requesting another code."); }
    finally { setPending(false); }
  }
  return <section className={styles.root}><h1 className="font-display">{registration ? "Create your account" : "Sign in"}</h1><p>A private space for your jewelry requests and designer consultations.</p>
    {session.customer ? <p><Link href={customerReturn(destination)}>Continue to your request</Link> · <Link href="/account">My Account</Link></p> : null}
    {error ? <p role="alert" className={styles.notice}>{error}</p> : null}
    <form className={styles.form} onSubmit={submit}><fieldset disabled={pending}>
      {registration ? <label className={styles.field}>Your name<input aria-label="Your name" autoComplete="name" required minLength={2} maxLength={100} value={name} onChange={e => setName(e.target.value)} readOnly={sent} /></label> : null}
      <label className={styles.field}>Email address<input aria-label="Email address" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} readOnly={sent} /></label>
      {sent ? <><p role="status">A code was sent. Enter it within five minutes.</p><label className={styles.field}>Verification code<input aria-label="Verification code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{8}" maxLength={8} required value={code} onChange={e => setCode(e.target.value)} /></label></> : null}
      <button className={`hero-cta hero-primary-button ${styles.button}`} type="submit">{pending ? "Please wait…" : sent ? "Verify and continue" : "Send sign-in code"}</button>
    </fieldset></form>
    <div className={styles.actions}><button className={`hero-cta hero-secondary-button ${styles.button}`} type="button" disabled={pending} onClick={() => { setSent(false); setCode(""); setError(""); setRegistration(!registration); }}>{registration ? "I already have an account" : "Create an account"}</button>
      {sent ? <button type="button" className={`hero-cta hero-secondary-button ${styles.button}`} disabled={pending} onClick={() => { if (Date.now() < cooldown) { setError("Please wait one minute before requesting another code."); return; } setSent(false); setCode(""); setError(""); }}>Change email / request a new code</button> : null}</div>
    <p className={styles.help}>Your email is verified using a one-time code. No password is required. Browsing remains open to everyone.</p>
  </section>;
}

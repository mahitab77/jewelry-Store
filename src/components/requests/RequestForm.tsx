"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { PublicProductDetail } from "../../lib/catalogue/types.ts";
import type { PublicRequestInput, RequestKind } from "../../lib/requests/types.ts";
import { variantOptionLabels } from "../../lib/catalogue/presentation.ts";
import { useCatalogueNavigationGuard } from "../admin/useCatalogueNavigationGuard";
import styles from "./request.module.css";

export type RequestProduct = Pick<PublicProductDetail, "id" | "name" | "slug" | "variants">;
type Draft = { kind: RequestKind; name: string; email: string; phone: string; message: string; channel: "ZOOM" | "BOUTIQUE"; preferredDate: string; preferredTime: string; variantId: string };
const labels: Record<RequestKind, string> = { QUOTATION: "Request a Quotation", MODIFICATION: "Request Changes", BESPOKE: "A completely bespoke design", CONSULTATION: "Consult the Designer" };
export function RequestForm({ product, initialKind = "BESPOKE", initialVariant = "", consultation = false }: { product?: RequestProduct; initialKind?: RequestKind; initialVariant?: string; consultation?: boolean }) {
  const [draft, setDraft] = useState<Draft>({ kind: consultation ? "CONSULTATION" : initialKind, name: "", email: "", phone: "", message: "", channel: "ZOOM", preferredDate: "", preferredTime: "", variantId: initialVariant || product?.variants[0]?.id || "" });
  const [pending, setPending] = useState(false), [attempt, setAttempt] = useState<PublicRequestInput | null>(null), [uncertain, setUncertain] = useState(false);
  const [reference, setReference] = useState(""), [error, setError] = useState(""), [fieldErrors, setFieldErrors] = useState<Record<string,string>>({});
  const [contextUnavailable, setContextUnavailable] = useState(false);
  const form = useRef<HTMLFormElement>(null), notice = useRef<HTMLParagraphElement>(null), busy = useRef(false), focus = useRef(false);
  useCatalogueNavigationGuard(!reference && Boolean(pending || uncertain || draft.name || draft.email || draft.phone || draft.message), uncertain ? "Receipt is uncertain. Keep this page open to retry the same request safely. Leave this page?" : "Leave this page and discard the request details you entered?");
  useEffect(() => { if (pending || !focus.current) return; focus.current = false; const key = Object.keys(fieldErrors)[0], target = key ? form.current?.elements.namedItem(key) as HTMLElement | null : null; if (target && typeof target.focus === "function") target.focus(); else notice.current?.focus(); }, [pending, error, fieldErrors]);
  const change = (value: Partial<Draft>) => setDraft((current) => ({ ...current, ...value }));
  const controlLabels: Record<keyof Draft,string> = { kind: "What would you like to do?", variantId: "Selected configuration", name: "Your name (required)", email: draft.kind === "CONSULTATION" && draft.channel === "ZOOM" ? "Email (required for Zoom)" : "Email", phone: "Telephone", message: draft.kind === "MODIFICATION" ? "Requested changes (required)" : "Your message (required)", channel: "Consultation preference", preferredDate: "Preferred date (Africa/Cairo)", preferredTime: "Preferred time (Africa/Cairo)" };
  const attributes = (name: keyof Draft) => ({ name, "aria-label": controlLabels[name], "aria-invalid": Boolean(fieldErrors[name]) || undefined, "aria-describedby": fieldErrors[name] ? `request-${name}-error` : undefined });
  const feedback = (name: keyof Draft) => fieldErrors[name] ? <span id={`request-${name}-error`} className={styles.error}>{fieldErrors[name]}</span> : null;
  async function send(retry = false) {
    if (busy.current || reference || uncertain && !retry) return;
    const input: PublicRequestInput = retry && attempt ? attempt : { submissionId: crypto.randomUUID(), kind: draft.kind, name: draft.name, email: draft.email, phone: draft.phone, message: draft.message,
      ...(product && draft.kind !== "BESPOKE" ? { productId: product.id, variantId: draft.variantId } : {}), ...(draft.kind === "CONSULTATION" ? { channel: draft.channel, preferredDate: draft.preferredDate, preferredTime: draft.preferredTime } : {}) };
    busy.current = true; setPending(true); setAttempt(input); setError(""); setFieldErrors({}); setContextUnavailable(false);
    try {
      const response = await fetch("/api/requests", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(20000) });
      const result = await response.json() as { reference?: string; message?: string; fieldErrors?: Record<string,string> };
      if (response.ok && result.reference === input.submissionId) { setReference(result.reference); setAttempt(null); setUncertain(false); setDraft((current) => ({ ...current, name: "", email: "", phone: "", message: "", preferredDate: "", preferredTime: "" })); return; }
      if (!retry && response.status === 409 && (result.fieldErrors?.productId || result.fieldErrors?.variantId)) {
        setAttempt(null); setContextUnavailable(true); setFieldErrors(result.fieldErrors); setError((result.message || "The selected piece or configuration is unavailable.") + " No request was created. Choose a currently published piece before sending a new request."); focus.current = true; return;
      }
      if (!retry && [400, 429].includes(response.status)) { setAttempt(null); setFieldErrors(result.fieldErrors ?? {}); setError(result.message || "Review your request before sending it."); focus.current = true; return; }
      throw new Error();
    } catch { setUncertain(true); setError("We could not confirm receipt. Your request may already have been received. Keep this page open and use Retry this same request to check safely; it sends the identical request reference and details. Do not start a second request."); focus.current = true; }
    finally { busy.current = false; setPending(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void send(); }
  if (reference) return <section className={styles.root} aria-labelledby="request-received"><h2 id="request-received">Your request has been received.</h2><p role="status">Our team will contact you to discuss the details. Pricing and appointments are subject to confirmation.</p><p className={styles.reference}>Request reference: <strong>{reference}</strong></p><p>No order, final quotation or appointment has been confirmed. No automatic email or meeting invitation is promised.</p><div className={styles.actions}><Link className={`hero-cta hero-secondary-button ${styles.button}`} href="/collections">Explore the collections</Link></div></section>;
  const optionLabels = product ? variantOptionLabels(product.variants) : [];
  return <section className={styles.root} aria-labelledby="request-title"><h2 id="request-title">Begin a conversation.</h2><p>Request a quotation, discuss changes, or arrange a designer consultation. You do not need an account.</p>
    {product && draft.kind !== "BESPOKE" ? <div className={styles.context}><p>Selected piece: <Link href={`/jewels/${product.slug}`}>{product.name}</Link></p><p className={styles.help}>Your selected configuration is saved with the request. Availability and pricing will be discussed personally.</p></div> : null}
    {error ? <p ref={notice} tabIndex={-1} role="alert" className={styles.notice}>{error}</p> : null}
    {contextUnavailable ? <p><Link className={`hero-cta hero-secondary-button ${styles.button}`} href="/collections">Choose a published piece</Link></p> : null}
    {uncertain && attempt ? <><p className={styles.reference}>Keep this request reference: {attempt.submissionId}</p><button type="button" className={`hero-cta hero-primary-button ${styles.button}`} disabled={pending} onClick={() => void send(true)}>{pending ? "Checking receipt…" : "Retry this same request"}</button></> : null}
    <form ref={form} className={styles.form} noValidate onSubmit={submit} aria-busy={pending}><fieldset disabled={pending || uncertain}>
      <label className={styles.field}>What would you like to do?<select {...attributes("kind")} value={draft.kind} onChange={(event) => change({ kind: event.target.value as RequestKind })}>{(Object.keys(labels) as RequestKind[]).filter((kind) => product || kind === "BESPOKE" || kind === "CONSULTATION").map((kind) => <option key={kind} value={kind}>{labels[kind]}</option>)}</select>{feedback("kind")}</label>
      {product && draft.kind !== "BESPOKE" ? <label className={styles.field}>Selected configuration<select {...attributes("variantId")} value={draft.variantId} onChange={(event) => change({ variantId: event.target.value })}>{product.variants.map((variant, index) => <option key={variant.id} value={variant.id}>{optionLabels[index].accessible}</option>)}</select>{feedback("variantId")}</label> : null}
      <label className={styles.field}>Your name (required)<input {...attributes("name")} autoComplete="name" maxLength={100} required value={draft.name} onChange={(event) => change({ name: event.target.value })} />{feedback("name")}</label>
      <div className={styles.grid}><label className={styles.field}>Email{draft.kind === "CONSULTATION" && draft.channel === "ZOOM" ? " (required for Zoom)" : ""}<input {...attributes("email")} autoComplete="email" type="email" maxLength={254} value={draft.email} onChange={(event) => change({ email: event.target.value })} />{feedback("email")}</label><label className={styles.field}>Telephone<input {...attributes("phone")} autoComplete="tel" type="tel" maxLength={30} value={draft.phone} onChange={(event) => change({ phone: event.target.value })} />{feedback("phone")}</label></div>
      <p className={styles.help}>Provide at least one valid contact method. International telephone numbers should include their country code. Zoom consultations require email.</p>
      <label className={styles.field}>{draft.kind === "MODIFICATION" ? "Requested changes (required)" : "Your message (required)"}<textarea {...attributes("message")} maxLength={5000} rows={6} required value={draft.message} onChange={(event) => change({ message: event.target.value })} />{feedback("message")}</label>
      {draft.kind === "CONSULTATION" ? <><label className={styles.field}>Consultation preference<select {...attributes("channel")} value={draft.channel} onChange={(event) => change({ channel: event.target.value as Draft["channel"] })}><option value="ZOOM">Zoom Consultation</option><option value="BOUTIQUE">Boutique Consultation</option></select>{feedback("channel")}</label><p className={styles.help}>Preferred date and time are optional and interpreted in Africa/Cairo. Enter both if you have a preference. Staff will agree the arrangements and send a Zoom invitation or verified boutique details personally.</p><div className={styles.grid}><label className={styles.field}>Preferred date (Africa/Cairo)<input {...attributes("preferredDate")} type="date" value={draft.preferredDate} onChange={(event) => change({ preferredDate: event.target.value })} />{feedback("preferredDate")}</label><label className={styles.field}>Preferred time (Africa/Cairo)<input {...attributes("preferredTime")} type="time" value={draft.preferredTime} onChange={(event) => change({ preferredTime: event.target.value })} />{feedback("preferredTime")}</label></div></> : null}
      <p className={styles.help}>Your contact details and message are stored privately for authorized boutique operations staff to handle this request. Do not include payment details, identity documents or sensitive information. This form does not accept attachments.</p>
      <button type="submit" className={`hero-cta hero-primary-button ${styles.button}`}>{pending ? "Sending…" : "Send request"}</button>
    </fieldset></form>
  </section>;
}

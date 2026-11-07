"use client";
import Link from "next/link";
import { useEffect, useRef, type FormEvent } from "react";
import type { PublicProductDetail } from "../../lib/catalogue/types.ts";
import type { PublicRequestInput, RequestKind } from "../../lib/requests/types.ts";
import { variantOptionLabels } from "../../lib/catalogue/presentation.ts";
import { useRequestDraft, useRequestNavigationGuard } from "./RequestExperienceProvider";
import styles from "./request.module.css";

export type RequestProduct = Pick<PublicProductDetail, "id" | "name" | "slug" | "variants">;
type Draft = { kind: RequestKind; name: string; email: string; phone: string; message: string; channel: "ZOOM" | "BOUTIQUE"; preferredDate: string; preferredTime: string; variantId: string };
type RequestState = { draft: Draft; pending: boolean; attempt: PublicRequestInput | null; uncertain: boolean; reference: string; error: string; fieldErrors: Record<string, string>; contextUnavailable: boolean };
const labels: Record<RequestKind, string> = { QUOTATION: "Request a Quotation", MODIFICATION: "Request Changes", BESPOKE: "A completely bespoke design", CONSULTATION: "Consult the Designer" };
export function RequestForm({ draftKey, product, initialKind = "BESPOKE", initialVariant = "", consultation = false }: { draftKey: string; product?: RequestProduct; initialKind?: RequestKind; initialVariant?: string; consultation?: boolean }) {
  const initial = (): RequestState => ({ draft: { kind: consultation ? "CONSULTATION" : initialKind, name: "", email: "", phone: "", message: "", channel: "ZOOM", preferredDate: "", preferredTime: "", variantId: initialVariant || product?.variants[0]?.id || "" }, pending: false, attempt: null, uncertain: false, reference: "", error: "", fieldErrors: {}, contextUnavailable: false });
  const [state, update, current] = useRequestDraft<RequestState>(draftKey, initial);
  const { draft, pending, attempt, uncertain, reference, error, fieldErrors, contextUnavailable } = state;
  const form = useRef<HTMLFormElement>(null), notice = useRef<HTMLParagraphElement>(null), receipt = useRef<HTMLHeadingElement>(null), title = useRef<HTMLHeadingElement>(null), focus = useRef(false);
  const dirty = !reference && Boolean(pending || uncertain || attempt || draft.name || draft.email || draft.phone || draft.message || draft.preferredDate || draft.preferredTime || draft.kind !== (consultation ? "CONSULTATION" : initialKind) || draft.channel !== "ZOOM" || draft.variantId !== (initialVariant || product?.variants[0]?.id || ""));
  useRequestNavigationGuard(dirty, uncertain || pending ? "Receipt is pending or uncertain. Keep this page open to retry the same request reference safely. Back restores these details during browsing within this site; reloading or leaving the site clears them. Leave this page?" : contextUnavailable ? "Correct this request here to keep its existing reference. Choosing another piece starts a separate request; a delayed earlier submission could still arrive and create a duplicate. Back restores these details while browsing within this site. Leave this request page?" : "Leave this request page? Back restores your entered details during browsing within this site; reloading or leaving the site clears them. Use Discard request details to clear them explicitly.");
  useEffect(() => { if (pending || !focus.current) return; focus.current = false; const key = Object.keys(fieldErrors)[0], target = key ? form.current?.elements.namedItem(key) as HTMLElement | null : null; if (target && typeof target.focus === "function") target.focus(); else notice.current?.focus(); }, [pending, error, fieldErrors]);
  useEffect(() => { if (reference) { receipt.current?.focus({ preventScroll: true }); receipt.current?.scrollIntoView({ behavior: "instant", block: "center" }); } }, [reference]);
  const change = (value: Partial<Draft>) => update((current) => ({ ...current, draft: { ...current.draft, ...value } }));
  const controlLabels: Record<keyof Draft,string> = { kind: "What would you like to do?", variantId: "Selected configuration", name: "Your name (required)", email: draft.kind === "CONSULTATION" && draft.channel === "ZOOM" ? "Email (required for Zoom)" : "Email", phone: "Telephone", message: draft.kind === "MODIFICATION" ? "Requested changes (required)" : "Your message (required)", channel: "Consultation preference", preferredDate: "Preferred date (Africa/Cairo)", preferredTime: "Preferred time (Africa/Cairo)" };
  const attributes = (name: keyof Draft) => ({ name, "aria-label": controlLabels[name], "aria-invalid": Boolean(fieldErrors[name]) || undefined, "aria-describedby": fieldErrors[name] ? `request-${name}-error` : undefined });
  const feedback = (name: keyof Draft) => fieldErrors[name] ? <span id={`request-${name}-error`} className={styles.error}>{fieldErrors[name]}</span> : null;
  async function send(retry = false) {
    if (current().pending || current().reference || current().uncertain && !retry) return;
    const input: PublicRequestInput = retry && attempt ? attempt : { submissionId: attempt?.submissionId || crypto.randomUUID(), kind: draft.kind, name: draft.name, email: draft.email, phone: draft.phone, message: draft.message,
      ...(product && draft.kind !== "BESPOKE" ? { productId: product.id, variantId: draft.variantId } : {}), ...(draft.kind === "CONSULTATION" ? { channel: draft.channel, preferredDate: draft.preferredDate, preferredTime: draft.preferredTime } : {}) };
    update((current) => ({ ...current, pending: true, attempt: input, error: "", fieldErrors: {}, contextUnavailable: false }));
    // Async responses continue updating this canonical draft while the user
    // browses. Explicit discard abandons its UUID; a late response for that old
    // attempt must never overwrite a cleared draft or a newer submission.
    const active = () => current().attempt?.submissionId === input.submissionId;
    try {
      const response = await fetch("/api/requests", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(20000) });
      const result = await response.json() as { reference?: string; message?: string; fieldErrors?: Record<string,string>; outcome?: string; submissionId?: string };
      if (!active()) return;
      if (response.ok && result.reference === input.submissionId) { update((current) => ({ ...current, reference: result.reference!, attempt: null, pending: false, uncertain: false, draft: { ...current.draft, name: "", email: "", phone: "", message: "", preferredDate: "", preferredTime: "" } })); return; }
      // A status code cannot establish whether an earlier attempt committed.
      // The server proves absence under the same UUID lock before permitting
      // correction. Retain that UUID so a delayed original cannot create a
      // second request after the corrected details are sent.
      if (!response.ok && result.outcome === "NOT_CREATED" && result.submissionId === input.submissionId) {
        const unavailable = Boolean(result.fieldErrors?.productId || result.fieldErrors?.variantId);
        update((current) => ({ ...current, uncertain: false, contextUnavailable: unavailable, fieldErrors: result.fieldErrors ?? {}, error: (result.message || "Review your request before sending it.") + " No request was created." + (unavailable ? " Change the configuration or request type here to correct this request with its existing reference. Choosing another piece begins a separate request." : " You can correct these details and send again safely.") }));
        focus.current = true; return;
      }
      throw new Error();
    } catch { if (active()) { update((current) => ({ ...current, uncertain: true, error: "We could not confirm receipt. Your request may already have been received. Keep this page open and use Retry this same request to check safely; it sends the identical request reference and details. Do not start a second request." })); focus.current = true; } }
    finally { if (active()) update((current) => ({ ...current, pending: false })); }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void send(); }
  function discard() {
    const message = uncertain || pending ? "Receipt is pending or uncertain. This request may already have been received. Discarding removes these details and the same-reference retry from this tab; it does not cancel any received request. Starting again could create a duplicate. Discard request details?" : "Discard the request details you entered? This clears the draft from this tab.";
    if (window.confirm(message)) { update(initial()); focus.current = false; title.current?.focus({ preventScroll: true }); title.current?.scrollIntoView({ behavior: "instant", block: "center" }); }
  }
  if (reference) return <section className={styles.root} aria-labelledby="request-received"><h2 ref={receipt} tabIndex={-1} id="request-received">Your request has been received.</h2><p role="status">Our team will contact you to discuss the details. Pricing and appointments are subject to confirmation.</p><p className={styles.reference}>Request reference: <strong>{reference}</strong></p><p>No order, final quotation or appointment has been confirmed. No automatic email or meeting invitation is promised.</p><div className={styles.actions}><Link className={`hero-cta hero-secondary-button ${styles.button}`} href="/collections">Explore the collections</Link></div></section>;
  const optionLabels = product ? variantOptionLabels(product.variants) : [];
  return <section className={styles.root} aria-labelledby="request-title"><h2 ref={title} tabIndex={-1} id="request-title">Begin a conversation.</h2><p>Request a quotation, discuss changes, or arrange a designer consultation. You do not need an account.</p>
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
    {dirty ? <div className={styles.actions}><button type="button" className={`hero-cta hero-secondary-button ${styles.button}`} onClick={discard}>Discard request details</button></div> : null}
  </section>;
}

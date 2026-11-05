"use client";
import Link from "next/link";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { nextStatuses, requestKinds, requestStatuses, type AdminRequest, type RequestDetail, type RequestKind, type RequestList } from "../../lib/requests/types.ts";
import { cairoFields } from "../../lib/requests/cairo.ts";
import { useCatalogueNavigationGuard } from "./useCatalogueNavigationGuard";
import styles from "../requests/request.module.css";

const kindLabel: Record<RequestKind,string> = { QUOTATION: "Quotation", MODIFICATION: "Requested changes", BESPOKE: "Bespoke design", CONSULTATION: "Consultation" };
const label = (value: string) => value.toLowerCase().replaceAll("_", " ");
const cairo = (value: string | null) => { if (!value) return "Not requested"; const parts = cairoFields(value); return `${parts.date} at ${parts.time} (Africa/Cairo)`; };
function edit(record: AdminRequest) { const confirmed = record.confirmedStart ? cairoFields(record.confirmedStart) : { date: "", time: "" }; return { status: record.status, assignedAdminId: record.assignedAdminId || "", confirmedDate: confirmed.date, confirmedTime: confirmed.time, boutiqueLocationId: record.boutiqueLocationId || "", agreed: false }; }
const emptyListing = (): RequestList => ({ items: [], newCount: 0, page: 1, hasMore: false, staff: [], locations: [] });
export function RequestsInbox() {
  const [listing, setListing] = useState(emptyListing), [kind, setKind] = useState<RequestKind | "">(""), [status, setStatus] = useState("");
  const [detail, setDetail] = useState<RequestDetail | null>(null), [draft, setDraft] = useState<ReturnType<typeof edit> | null>(null);
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [denied, setDenied] = useState(true);
  const [recoveryTarget, setRecoveryTarget] = useState<Pick<AdminRequest,"kind" | "id"> | null>(null);
  const busy = useRef(false), feedback = useRef<HTMLParagraphElement>(null);
  const sequence = useRef(0), active = useRef(false), verified = useRef(false), request = useRef<AbortController | null>(null);
  const filters = useRef<{kind: RequestKind | ""; status: string}>({kind:"",status:""});
  const dirty = Boolean(detail && draft && JSON.stringify(draft) !== JSON.stringify(edit(detail.request)));
  useCatalogueNavigationGuard(dirty || pending || uncertain, "A request update is unsaved, pending or uncertain. Leave and inspect the saved request later?");
  const invalidate = useCallback(() => { sequence.current++; request.current?.abort(); request.current = null; },[]);
  const clearProtected = useCallback((explanation: string) => {
    invalidate(); busy.current = false; verified.current = false;
    setPending(false); setListing(emptyListing()); setDetail(null); setDraft(null); setRecoveryTarget(null); setDenied(true); setUncertain(false); setMessage(""); setError(explanation);
  }, [invalidate]);
  const begin = useCallback(() => { const version = ++sequence.current, controller = new AbortController(); request.current = controller; return { version, signal: AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]) }; },[]);
  const current = useCallback((version: number) => active.current && version === sequence.current,[]);
  const finish = useCallback((version: number) => { if (!current(version)) return; request.current = null; busy.current = false; setPending(false); },[current]);
  const accessDenied = useCallback((response: Response) => { if (![401,403].includes(response.status)) return false; clearProtected("Private request access is unavailable. Sign in with an enabled operations-authorized account, then refresh requests to verify access again."); return true; },[clearProtected]);
  function apply(value: RequestDetail) { verified.current = true; setDenied(false); setDetail(value); setDraft(edit(value.request)); setRecoveryTarget(null); setUncertain(false); }
  const refresh = useCallback(async (page = 1) => {
    if (!active.current || document.visibilityState !== "visible" || busy.current) return;
    busy.current = true; setPending(true); setError(""); setMessage("");
    const operation = begin();
    try { const response = await fetch("/api/admin/requests/search", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...filters.current, page }), signal: operation.signal }); if (!current(operation.version) || accessDenied(response)) return; const result = await response.json() as RequestList; if (!current(operation.version)) return; if (!response.ok || !Array.isArray(result.items)) throw new Error(); verified.current = true; setListing(result); setDenied(false); setMessage("Inbox refreshed. Request details and local edits are kept until you choose another request or reload it."); }
    catch { if (current(operation.version)) clearProtected("The inbox could not be verified. Private request details were cleared. Refresh requests to try again. No request was changed."); }
    finally { finish(operation.version); }
  },[accessDenied,begin,clearProtected,current,finish]);
  useLayoutEffect(() => {
    active.current = true;
    const hide = () => flushSync(() => clearProtected("Private request details were hidden. Refresh requests to verify your access again before viewing or editing them."));
    const restore = () => { if (!active.current) return; hide(); if (document.visibilityState === "visible") void refresh(); };
    const visibility = () => { if (document.visibilityState !== "visible") hide(); else restore(); };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) restore(); };
    window.addEventListener("pagehide",hide); window.addEventListener("pageshow",restored); window.addEventListener("popstate",restore); window.addEventListener("focus",restore); document.addEventListener("visibilitychange",visibility);
    void refresh();
    return () => {
      active.current = false; clearProtected("");
      window.removeEventListener("pagehide",hide); window.removeEventListener("pageshow",restored); window.removeEventListener("popstate",restore); window.removeEventListener("focus",restore); document.removeEventListener("visibilitychange",visibility);
    };
  },[clearProtected,refresh]);
  async function load(record: Pick<AdminRequest,"kind" | "id">) {
    if (!active.current || document.visibilityState !== "visible" || busy.current || dirty && !window.confirm("Discard local request changes and load the saved request?")) return;
    busy.current = true; setPending(true); setError(""); setMessage("");
    const operation = begin();
    try { const response = await fetch(`/api/admin/requests/${record.kind}/${record.id}`, { credentials: "same-origin", cache: "no-store", signal: operation.signal }); if (!current(operation.version) || accessDenied(response)) return; const result = await response.json() as RequestDetail; if (!current(operation.version)) return; if (!response.ok || result.request?.id !== record.id || result.request.kind !== record.kind) throw new Error(); apply(result); setMessage("Current saved request loaded. Review it before making changes. No update was retried."); }
    catch { if (current(operation.version)) { clearProtected("The saved request could not be verified. Private request details were cleared. Reload the saved request to try again. No update was retried."); setRecoveryTarget({kind:record.kind,id:record.id}); } }
    finally { finish(operation.version); }
  }
  async function save() {
    if (!active.current || document.visibilityState !== "visible" || !verified.current || !detail || !draft || busy.current || uncertain || denied) return;
    busy.current = true; setPending(true); setError(""); setMessage("");
    const operation = begin();
    try {
      const response = await fetch(`/api/admin/requests/${detail.request.kind}/${detail.request.id}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: detail.request.revision, status: draft.status, assignedAdminId: draft.assignedAdminId || null,
        ...(detail.request.kind === "CONSULTATION" && draft.status === "CONFIRMED" ? { confirmedDate: draft.confirmedDate, confirmedTime: draft.confirmedTime, boutiqueLocationId: draft.boutiqueLocationId || null, agreed: draft.agreed } : {}) }), signal: operation.signal });
      if (!current(operation.version) || accessDenied(response)) return;
      const result = await response.json() as RequestDetail & { message?: string };
      if (!current(operation.version)) return;
      if (!response.ok && [400,409,429].includes(response.status)) { setError(result.message || "The update was rejected. Review or reload the saved request."); return; }
      if (!response.ok || result.request?.id !== detail.request.id || result.request.kind !== detail.request.kind) throw new Error();
      apply(result); setListing((current) => ({ ...current, items: current.items.map((item) => item.id === result.request.id && item.kind === result.request.kind ? result.request : item) })); setMessage("Request updated. Refresh the inbox for the latest count and filters.");
    } catch { if (current(operation.version)) { clearProtected("The update outcome is uncertain. It may have been saved. Private request details were cleared. No retry was made. Reload the saved request before sending another update."); setRecoveryTarget({kind:detail.request.kind,id:detail.request.id}); setUncertain(true); } }
    finally { finish(operation.version); requestAnimationFrame(() => feedback.current?.focus()); }
  }
  const statuses = kind ? requestStatuses[kind] : [...new Set(requestKinds.flatMap((item) => [...requestStatuses[item]]))];
  return <section className={styles.root}><div className={styles.actions}><Link href="/admin">Administration</Link><Link href="/admin/products">Product catalogue</Link></div><h1 className="font-display">Boutique requests</h1><p>Check this private inbox regularly. There are no automatic email notifications. <strong>{denied ? "Request count unavailable" : `${listing.newCount} new requests`}</strong>.</p>
    {error || message ? <p ref={feedback} tabIndex={-1} role={error ? "alert" : "status"} className={styles.notice}>{error || message}</p> : null}
    {recoveryTarget ? <div className={styles.actions}><button type="button" className={`hero-cta hero-secondary-button ${styles.button}`} disabled={pending} onClick={() => void load(recoveryTarget)}>Reload saved request</button>{uncertain ? <p className={styles.notice}>Updates stay blocked until a saved-state reload succeeds.</p> : null}</div> : null}
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void refresh(); }}><div className={styles.grid}><label className={styles.field}>Request type<select aria-label="Request type" disabled={pending} value={kind} onChange={(event) => { const value = event.target.value as RequestKind | ""; filters.current = {kind:value,status:""}; setKind(value); setStatus(""); }}><option value="">All requests</option>{requestKinds.map((item) => <option key={item} value={item}>{kindLabel[item]}</option>)}</select></label><label className={styles.field}>Request status<select aria-label="Request status" disabled={pending} value={status} onChange={(event) => { filters.current.status = event.target.value; setStatus(event.target.value); }}><option value="">All statuses</option>{statuses.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label></div><div className={styles.actions}><button className={`hero-cta hero-primary-button ${styles.button}`} disabled={pending}>Refresh requests</button></div></form>
    <div className={styles.list} aria-label="Request results">{listing.items.length ? listing.items.map((item) => <article className={styles.item} key={item.kind + item.id}><p>{kindLabel[item.kind]} · {label(item.status)} · {cairo(item.createdAt)}</p><h3>{item.name}</h3><p>{item.productContext?.name || (item.channel ? `${item.channel === "ZOOM" ? "Zoom" : "Boutique"} consultation` : "A new design conversation")}</p><button type="button" disabled={pending} className={`hero-cta hero-secondary-button ${styles.button}`} onClick={() => void load(item)}>Open request {item.id}</button></article>) : <p>{pending ? "Verifying private request access…" : denied ? "Private request records are hidden until access is verified." : "No requests match these filters."}</p>}</div>
    <div className={styles.actions}>{listing.page > 1 ? <button type="button" disabled={pending} className={`hero-cta hero-secondary-button ${styles.button}`} onClick={() => void refresh(listing.page - 1)}>Previous requests</button> : null}{listing.hasMore ? <button type="button" disabled={pending} className={`hero-cta hero-secondary-button ${styles.button}`} onClick={() => void refresh(listing.page + 1)}>Next requests</button> : null}</div>
    {detail && draft ? <section className={styles.details} aria-labelledby="request-details-title"><h2 id="request-details-title">Request details</h2><p className={styles.reference}>Reference: {detail.request.id}</p><dl><dt>Request</dt><dd>{kindLabel[detail.request.kind]} · {label(detail.request.status)}</dd><dt>Customer</dt><dd>{detail.request.name}</dd><dt>Email</dt><dd>{detail.request.email || "Not supplied"}</dd><dt>Telephone</dt><dd>{detail.request.phone || "Not supplied"}</dd><dt>Customer message</dt><dd>{detail.request.message}</dd>{detail.request.channel ? <><dt>Consultation preference</dt><dd>{detail.request.channel === "ZOOM" ? "Zoom Consultation" : "Boutique Consultation"}</dd><dt>Preferred time</dt><dd>{cairo(detail.request.preferredStart)}</dd><dt>Confirmed time</dt><dd>{cairo(detail.request.confirmedStart)}</dd></> : null}</dl>
      {detail.request.productContext ? <section aria-label="Original jewelry context"><h3>Original jewelry context</h3><p>This saved context records the selection when the customer submitted the request.</p><dl><dt>Piece</dt><dd>{detail.request.productContext.name}</dd><dt>Configuration / reference</dt><dd>{[detail.request.productContext.size,detail.request.productContext.configuration,detail.request.productContext.sku].filter(Boolean).join(" · ") || "Not supplied"}</dd><dt>Metal</dt><dd>{[detail.request.productContext.metalType,detail.request.productContext.metalPurity,detail.request.productContext.metalColor].filter(Boolean).join(" · ") || "Unknown"}</dd>{detail.request.productContext.metalWeightGrams ? <><dt>Metal weight</dt><dd>{detail.request.productContext.metalWeightGrams} g ({label(detail.request.productContext.metalWeightBasis || "unknown")})</dd></> : null}</dl>{detail.request.productContext.stones.map((stone,index) => <p key={index}>{[stone.type,stone.variety,stone.shape,stone.color,`${stone.quantity} ${stone.role.toLowerCase()} stones`,stone.caratWeight ? `${stone.caratWeight} ct per stone` : "",stone.totalCaratWeight ? `${stone.totalCaratWeight} ct total` : ""].filter(Boolean).join(" · ")}</p>)}</section> : null}
      <div className={styles.actions}><button type="button" className={`hero-cta hero-secondary-button ${styles.button}`} disabled={pending} onClick={() => void load(detail.request)}>Reload saved request</button></div>
      {uncertain ? <p className={styles.notice}>Updates stay blocked until a saved-state reload succeeds.</p> : null}
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void save(); }}><fieldset disabled={pending || uncertain}><div className={styles.grid}><label className={styles.field}>Update status<select aria-label="Update status" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value, agreed: false })}>{nextStatuses(detail.request.kind,detail.request.status).map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label><label className={styles.field}>Assigned employee<select aria-label="Assigned employee" value={draft.assignedAdminId} onChange={(event) => setDraft({ ...draft, assignedAdminId: event.target.value })}><option value="">Unassigned</option>{detail.staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label></div>
        {detail.request.kind === "CONSULTATION" && draft.status === "CONFIRMED" ? <><div className={styles.grid}><label className={styles.field}>Confirmed date (Africa/Cairo)<input aria-label="Confirmed date (Africa/Cairo)" type="date" required value={draft.confirmedDate} onChange={(event) => setDraft({ ...draft, confirmedDate: event.target.value })} /></label><label className={styles.field}>Confirmed time (Africa/Cairo)<input aria-label="Confirmed time (Africa/Cairo)" type="time" required value={draft.confirmedTime} onChange={(event) => setDraft({ ...draft, confirmedTime: event.target.value })} /></label></div>{detail.request.channel === "BOUTIQUE" ? <label className={styles.field}>Verified boutique location<select aria-label="Verified boutique location" required value={draft.boutiqueLocationId} onChange={(event) => setDraft({ ...draft, boutiqueLocationId: event.target.value })}><option value="">Choose a verified active location</option>{detail.locations.map((location) => <option key={location.id} value={location.id}>{[location.name,location.city,location.street].join(" · ")}</option>)}</select></label> : null}<label className={styles.check}><input aria-label="I have agreed these arrangements personally with the customer" type="checkbox" required checked={draft.agreed} onChange={(event) => setDraft({ ...draft, agreed: event.target.checked })} />I have agreed these arrangements personally with the customer and will provide the Zoom invitation or verified boutique details. This action does not send a message automatically.</label></> : null}
        <p className={styles.help}>Request status records follow-up. An accepted design request does not create an order, payment or final quotation.</p><button className={`hero-cta hero-primary-button ${styles.button}`}>Save request update</button>
      </fieldset></form>
    </section> : null}
  </section>;
}

"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { CatalogueChoices, EditorMedia, EditorProduct, ProductAction, ProductInput, StoneInput, VariantInput } from "../../lib/admin/catalogue/types.ts";
import { ProductPhoto } from "../catalogue/ProductPhoto";
import { useCatalogueNavigationGuard } from "./useCatalogueNavigationGuard";
import styles from "./catalogue.module.css";

type History = { id: string; action: string; metadata: Record<string, unknown>; createdAt: string; actor: string | null }[];
const blankProduct = (): ProductInput => ({ name: "", slug: "", description: "", productType: "ONE_OF_A_KIND", salesMode: "ENQUIRY_ONLY", categoryIds: [], collectionIds: [], variants: [] });
const blankVariant = (): VariantInput => ({ sku: "", size: "", configuration: "", metalType: "", metalPurity: "", metalColor: "", active: true, displayOrder: 0, priceEGP: "", initialStock: 0, stockReason: "", gemstones: [] });
const blankStone = (): StoneInput => ({ kind: "GROUP", type: "", variety: "", shape: "", color: "", caratWeight: "", origin: "", treatment: "", laboratory: "", reportReference: "", role: "CENTER", quantity: 1, totalCaratWeight: "", displayOrder: 0 });
function editorInput(p: EditorProduct): ProductInput {
  return { name: p.name, slug: p.slug, description: p.description, productType: p.productType, salesMode: p.salesMode, categoryIds: p.categoryIds, collectionIds: p.collectionIds,
    variants: p.variants.map((v) => ({ id: v.id, sku: v.sku, size: v.size, configuration: v.configuration, metalType: v.metalType, metalPurity: v.metalPurity, metalColor: v.metalColor,
      active: v.active, displayOrder: v.displayOrder, priceEGP: v.priceEGP, gemstones: v.gemstones })) };
}
function Field({ label, value, change, type = "text", readOnly = false, path, error, required, maxLength, min, max, decimal = false }: { label: string; value: string | number; change: (value: string) => void; type?: string; readOnly?: boolean; path?: string; error?: string; required?: boolean; maxLength?: number; min?: number; max?: number; decimal?: boolean }) {
  const id = useId();
  return <label className={styles.field} htmlFor={id}><span>{label}{required ? <span aria-hidden="true"> (required)</span> : null}</span><input id={id} aria-label={label} data-field-path={path} type={type} value={value} onChange={(e) => change(e.target.value)} readOnly={readOnly} required={required} maxLength={maxLength} min={min} max={max} step={type === "number" ? "1" : undefined} inputMode={decimal ? "decimal" : undefined} aria-invalid={error ? true : undefined} aria-describedby={error ? id + "-error" : undefined} />{error ? <span id={id + "-error"} className={styles.fieldError}>{error}</span> : null}</label>;
}
function fieldContext(path: string) {
  const names: Record<string, string> = { name: "Product name", slug: "URL slug", priceEGP: "Selling price (EGP)", sku: "SKU", size: "Size", configuration: "Configuration", metalType: "Metal", metalPurity: "Metal purity", metalColor: "Metal colour", displayOrder: "Display order", initialStock: "Initial stock", stockReason: "Initial stock reason", type: "Stone type", shape: "Shape / cut", color: "Colour", caratWeight: "Carat weight", totalCaratWeight: "Total carat weight", quantity: "Gemstone quantity", laboratory: "Laboratory name" };
  const variant = /^product\.variants\.(\d+)(?:\.gemstones\.(\d+))?\.(\w+)$/.exec(path);
  if (variant) return `Variant ${Number(variant[1]) + 1}${variant[2] === undefined ? "" : `, gemstone ${Number(variant[2]) + 1}`} — ${names[variant[3]] ?? variant[3]}`;
  return names[path.replace(/^product\./, "")] ?? "Product details";
}

export function ProductEditor({ product, choices, initialHistory, uploadsConfigured }: { product: EditorProduct | null; choices: CatalogueChoices; initialHistory: History; uploadsConfigured: boolean }) {
  const router = useRouter();
  const [record, setRecord] = useState(product);
  const [draft, setDraft] = useState<ProductInput>(() => product ? editorInput(product) : blankProduct());
  const [photos, setPhotos] = useState<EditorMedia[]>(product?.media ?? []);
  const [history, setHistory] = useState(initialHistory);
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [baseline, setBaseline] = useState(() => JSON.stringify(product ? editorInput(product) : blankProduct()));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({}), [uncertain, setUncertain] = useState(false), [recoverySlug, setRecoverySlug] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null), formRef = useRef<HTMLFormElement>(null), busy = useRef(false);
  const failureFocus = useRef<Record<string, string> | null>(null);
  const dirty = JSON.stringify(draft) !== baseline;
  const mediaDirty = JSON.stringify(photos) !== JSON.stringify(record?.media ?? []);
  useCatalogueNavigationGuard(dirty || mediaDirty || pending || uncertain, pending || uncertain ? "A catalogue save is pending or its outcome is uncertain. Leave this page and inspect the saved state?" : "Discard unsaved catalogue changes?");
  useEffect(() => {
    // Focus only after React has rendered the error and re-enabled the form.
    if (pending || !failureFocus.current) return;
    const errors = failureFocus.current; failureFocus.current = null;
    const input = [...formRef.current?.querySelectorAll<HTMLElement>("[data-field-path]") ?? []].find((element) => Boolean(errors[element.dataset.fieldPath ?? ""]));
    if (input) input.focus(); else errorRef.current?.focus();
  }, [pending, error, fieldErrors]);
  function apply(product: EditorProduct, nextHistory: History = []) {
    setRecord(product); setDraft(editorInput(product)); setBaseline(JSON.stringify(editorInput(product)));
    setPhotos(product.media); setHistory(nextHistory); setFieldErrors({});
  }
  function focusFailure(errors: Record<string, string> = {}) {
    failureFocus.current = errors;
  }
  async function reload() {
    if (!record || busy.current || ((dirty || mediaDirty) && !window.confirm("Discard local changes and reload the saved product?"))) return;
    busy.current = true; setPending(true);
    try {
      const response = await fetch(`/api/admin/catalogue/products/${record.id}`, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(20000) });
      const result = await response.json() as { product?: EditorProduct; history?: History };
      if (!response.ok || !result.product || result.product.id !== record.id) throw new Error();
      apply(result.product, result.history); setUncertain(false); setError(""); setMessage("Current saved product loaded. Review it before making another change.");
    } catch { setError("The saved product could not be reloaded. Local edits remain here; no mutation was retried."); focusFailure(); }
    finally { busy.current = false; setPending(false); }
  }
  function updateVariant(index: number, value: VariantInput) { setDraft((p) => ({ ...p, variants: p.variants.map((v, i) => i === index ? value : v) })); }
  async function send(path: string, body: unknown, multipart = false) {
    if (busy.current || uncertain) return false;
    const savingProduct = path === "" || /^\/[0-9a-f-]{36}\/save$/.test(path);
    let authorizationUncertain = false;
    busy.current = true; setPending(true); setError(""); setMessage(""); setFieldErrors({});
    try {
      const response = await fetch(`/api/admin/catalogue/products${path}`, { method: "POST", credentials: "same-origin",
        headers: multipart ? undefined : { "Content-Type": "application/json" }, body: multipart ? body as FormData : JSON.stringify(body), ...(savingProduct ? { signal: AbortSignal.timeout(20000) } : {}) });
      // The mutation can commit before its response projection rechecks access.
      authorizationUncertain = [401, 403, 404].includes(response.status);
      const result = await response.json() as { id?: string; product?: EditorProduct; history?: History; message?: string; fieldErrors?: Record<string, string> };
      if (!response.ok && [400, 409, 413, 415, 429].includes(response.status)) {
        const errors = result.fieldErrors ?? {}, first = Object.keys(errors)[0];
        setFieldErrors(errors); setError((first ? fieldContext(first) + ": " : "") + (result.message || "The operation was rejected. Review the fields.")); focusFailure(errors); return false;
      }
      if (!response.ok || !result.product) throw new Error(result.message || "The operation could not be completed. Reload before retrying.");
      apply(result.product, result.history); setMessage(result.message ?? "Changes saved.");
      if (!record) router.replace(`/admin/products/${result.id}/edit`);
      return true;
    } catch (cause) {
      if (savingProduct || authorizationUncertain) { setUncertain(true); if (!record) setRecoverySlug(draft.slug.trim()); setError("The save outcome is uncertain. It may have reached the server. No retry was made. " + (record ? "Reload the saved product before sending more changes." : "Check the product catalogue for this draft before creating another product.")); }
      else setError(cause instanceof Error ? cause.message : "The operation could not be completed.");
      focusFailure(); return false;
    } finally { busy.current = false; setPending(false); }
  }
  async function save(action: ProductAction) {
    if ((action === "archive" || action === "unpublish") && !window.confirm(`${action === "archive" ? "Archive" : "Unpublish"} this product? It will disappear from public browsing.`)) return;
    await send(record ? `/${record.id}/save` : "", { product: draft, revision: record?.revision, action });
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget;
    if (record && await send(`/${record.id}/photos`, new FormData(form), true)) form.reset();
  }
  const updatePhoto = (id: string, value: Partial<EditorMedia>) => setPhotos((all) => all.map((p) => p.id === id ? { ...p, ...value } : value.primary ? { ...p, primary: false } : p));
  const reorder = (index: number, offset: number) => setPhotos((all) => { const next = [...all]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next; });
  const feedbackFor = (path: string) => ({ path, error: fieldErrors[path] });
  return <div className={styles.root}>
    <div className={styles.toolbar}><Link href="/admin/products">← Product catalogue</Link><Link href="/admin/taxonomy">Manage categories and collections</Link><span>{record?.status ?? "NEW DRAFT"}</span></div>
    <h1 className="font-display">{record ? "Edit product" : "Create a product"}</h1>
    {error ? <p ref={errorRef} tabIndex={-1} role="alert" className={styles.notice}>{error}</p> : null}
    {message ? <p role="status" className={styles.notice}>{message}</p> : null}
    {uncertain || error ? <div className={styles.actions}>{record ? <button type="button" className={`hero-cta hero-secondary-button ${styles.button}`} disabled={pending} onClick={() => void reload()}>Reload saved product</button> : uncertain ? <Link href={`/admin/products?q=${encodeURIComponent(recoverySlug)}`} prefetch={false}>Check product catalogue before creating another draft</Link> : null}</div> : null}
    {uncertain ? <p className={styles.help}>Local editing remains available. Sending changes is paused until the saved state is checked.</p> : null}
    {dirty ? <p className={styles.help}>Unsaved product changes. Save before adjusting stock or photographs.</p> : null}
    {mediaDirty ? <p className={styles.help}>Save photograph ordering and descriptions before editing product fields.</p> : null}
    <p className={styles.help}>Required inputs are marked. Other descriptive fields are optional. Publication requirements are checked again by the server.</p>
    <form ref={formRef} method="post" action="/api/admin/catalogue/products" onInput={(event) => { const path = (event.target as HTMLElement).dataset.fieldPath; if (path && fieldErrors[path]) setFieldErrors((current) => { const next = { ...current }; delete next[path]; return next; }); }} onSubmit={(e) => { e.preventDefault(); void save("save"); }} aria-busy={pending}>
      <fieldset disabled={pending || mediaDirty} className={styles.panel}><legend>Product details</legend>
        <div className={styles.grid}><Field label="Product name" path="product.name" error={fieldErrors["product.name"]} required maxLength={200} value={draft.name} change={(name) => setDraft({ ...draft, name })} />
          <Field label="URL slug" path="product.slug" error={fieldErrors["product.slug"]} required maxLength={160} value={draft.slug} readOnly={record?.slugLocked} change={(slug) => setDraft({ ...draft, slug })} />
          <label className={styles.field}>Product type<select aria-label="Product type" value={draft.productType} disabled={Boolean(record?.variants.length)} onChange={(e) => setDraft({ ...draft, productType: e.target.value as ProductInput["productType"] })}>
            <option value="ONE_OF_A_KIND">One of a kind</option><option value="REPEATABLE">Repeatable</option><option value="BESPOKE">Bespoke</option></select></label>
          <label className={styles.field}>Sales mode<select aria-label="Sales mode" value={draft.salesMode} onChange={(e) => setDraft({ ...draft, salesMode: e.target.value as ProductInput["salesMode"] })}>
            <option value="ENQUIRY_ONLY">Enquiry only</option><option value="DIRECT_PURCHASE">Direct purchase</option><option value="BOTH">Purchase and enquiry</option></select></label>
        </div>
        {record?.slugLocked ? <p className={styles.help}>The slug stays fixed after first publication to preserve existing product links.</p> : null}
        <label className={styles.field}>Description<textarea aria-label="Description" data-field-path="product.description" maxLength={10000} value={draft.description} aria-invalid={Boolean(fieldErrors["product.description"])} aria-describedby={fieldErrors["product.description"] ? "product-description-error" : undefined} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />{fieldErrors["product.description"] ? <span id="product-description-error" className={styles.fieldError}>{fieldErrors["product.description"]}</span> : null}</label>
        <h3>Categories</h3><div className={styles.checks}>{choices.categories.map((c) => <label className={styles.check} key={c.id}><input type="checkbox" checked={draft.categoryIds.includes(c.id)} onChange={(e) => setDraft({ ...draft, categoryIds: e.target.checked ? [...draft.categoryIds, c.id] : draft.categoryIds.filter((id) => id !== c.id) })} />{c.name}{c.visible ? "" : " (hidden)"}</label>)}</div>
        {!choices.categories.length ? <p>No categories are configured. A visible category is required before publication.</p> : null}
        <h3>Collections</h3><div className={styles.checks}>{choices.collections.map((c) => <label className={styles.check} key={c.id}><input type="checkbox" checked={draft.collectionIds.includes(c.id)} onChange={(e) => setDraft({ ...draft, collectionIds: e.target.checked ? [...draft.collectionIds, c.id] : draft.collectionIds.filter((id) => id !== c.id) })} />{c.name} ({c.status.toLowerCase()})</label>)}</div>
      </fieldset>
      {draft.variants.map((v, index) => <fieldset disabled={pending || mediaDirty} className={styles.panel} key={v.id ?? index}><legend>Variant {index + 1}</legend>
        <div className={styles.grid}>{([ ["sku", "SKU"], ["size", "Size"], ["configuration", "Configuration"], ["metalType", "Metal"], ["metalPurity", "Metal purity"], ["metalColor", "Metal colour"] ] as const).map(([field, label]) => <Field key={field} label={label} {...feedbackFor(`product.variants.${index}.${field}`)} required={field === "sku"} maxLength={field === "sku" ? 80 : field === "size" ? 100 : field === "configuration" ? 250 : 160} value={v[field]} change={(value) => updateVariant(index, { ...v, [field]: value })} />)}
          <Field label="Selling price (EGP)" {...feedbackFor(`product.variants.${index}.priceEGP`)} decimal maxLength={24} value={v.priceEGP} change={(priceEGP) => updateVariant(index, { ...v, priceEGP })} />
          <Field label="Variant display order" {...feedbackFor(`product.variants.${index}.displayOrder`)} required min={0} max={10000} value={v.displayOrder} type="number" change={(value) => updateVariant(index, { ...v, displayOrder: Number(value) })} />
        </div>
        <p className={styles.help}>Enter decimal EGP without commas. Leave blank for price on request; enquiry-only and bespoke products must have no selling price.</p>
        <label className={styles.check}><input type="checkbox" checked={v.active} onChange={(e) => updateVariant(index, { ...v, active: e.target.checked })} />Active variant</label>
        {!v.id ? <div className={styles.grid}><Field label="Initial stock" {...feedbackFor(`product.variants.${index}.initialStock`)} required min={0} max={1000000} value={v.initialStock ?? 0} type="number" change={(value) => updateVariant(index, { ...v, initialStock: Number(value) })} />
          <Field label="Initial stock reason" {...feedbackFor(`product.variants.${index}.stockReason`)} required={Boolean(v.initialStock)} maxLength={240} value={v.stockReason ?? ""} change={(stockReason) => updateVariant(index, { ...v, stockReason })} /></div>
          : <p className={styles.help}>Stock changes use the separate adjustment section below. Deactivate a variant to preserve its history.</p>}
        <h3>Gemstones</h3><p className={styles.help}>Describe only known characteristics. Report references are text, not public certificate uploads. Editing a shared specification creates a separate record; it does not verify certification or origin. A variant with an individual stone can hold at most one unit of stock.</p>
        {v.gemstones.map((g, stoneIndex) => <div className={styles.stones} key={g.associationId ?? stoneIndex}><h3>Gemstone {stoneIndex + 1}</h3>
          <div className={styles.grid}>{([ ["type", "Stone type"], ["variety", "Variety"], ["shape", "Shape / cut"], ["color", "Colour"], ["caratWeight", "Carat weight"], ["origin", "Known origin"], ["treatment", "Treatment disclosure"], ["laboratory", "Laboratory name"], ["reportReference", "Report reference"], ["totalCaratWeight", "Total carat weight"] ] as const).map(([field, label]) => <Field key={field} label={label} {...feedbackFor(`product.variants.${index}.gemstones.${stoneIndex}.${field}`)} required={field === "type" || field === "shape" || field === "color" || (field === "laboratory" && Boolean(g.reportReference.trim()))} decimal={field === "caratWeight" || field === "totalCaratWeight"} maxLength={field === "caratWeight" || field === "totalCaratWeight" ? 20 : field === "type" || field === "shape" || field === "color" ? 100 : field === "treatment" ? 1000 : field === "reportReference" ? 250 : 160} value={g[field]} change={(value) => updateVariant(index, { ...v, gemstones: v.gemstones.map((s, i) => i === stoneIndex ? { ...g, [field]: value } : s) })} />)}
            <label className={styles.field}>Specification kind<select aria-label="Specification kind" value={g.kind} onChange={(e) => updateVariant(index, { ...v, gemstones: v.gemstones.map((s, i) => i === stoneIndex ? { ...g, kind: e.target.value as StoneInput["kind"] } : s) })}><option value="GROUP">Group specification</option><option value="INDIVIDUAL">Individual stone</option></select></label>
            <label className={styles.field}>Gemstone role<select aria-label="Gemstone role" value={g.role} onChange={(e) => updateVariant(index, { ...v, gemstones: v.gemstones.map((s, i) => i === stoneIndex ? { ...g, role: e.target.value as StoneInput["role"] } : s) })}><option value="CENTER">Center</option><option value="ACCENT">Accent</option><option value="OTHER">Other</option></select></label>
            <Field label="Gemstone quantity" {...feedbackFor(`product.variants.${index}.gemstones.${stoneIndex}.quantity`)} required min={1} max={10000} value={g.quantity} type="number" change={(value) => updateVariant(index, { ...v, gemstones: v.gemstones.map((s, i) => i === stoneIndex ? { ...g, quantity: Number(value) } : s) })} />
            <Field label="Gemstone display order" {...feedbackFor(`product.variants.${index}.gemstones.${stoneIndex}.displayOrder`)} required min={0} max={10000} value={g.displayOrder} type="number" change={(value) => updateVariant(index, { ...v, gemstones: v.gemstones.map((s, i) => i === stoneIndex ? { ...g, displayOrder: Number(value) } : s) })} />
          </div><button type="button" className={`hero-cta hero-secondary-button ${styles.button}`} onClick={() => updateVariant(index, { ...v, gemstones: v.gemstones.filter((_, i) => i !== stoneIndex) })}>Detach gemstone {stoneIndex + 1}</button>
        </div>)}
        <div className={styles.actions}><button type="button" className={`hero-cta hero-secondary-button ${styles.button}`} onClick={() => updateVariant(index, { ...v, gemstones: [...v.gemstones, blankStone()] })}>Add gemstone</button>
          {!v.id ? <button type="button" className={`hero-cta hero-secondary-button ${styles.button}`} onClick={() => setDraft({ ...draft, variants: draft.variants.filter((_, i) => i !== index) })}>Remove unsaved variant</button> : null}</div>
      </fieldset>)}
      <div className={styles.actions}><button type="button" disabled={pending || mediaDirty || draft.variants.length >= 30} className={`hero-cta hero-secondary-button ${styles.button}`} onClick={() => setDraft({ ...draft, variants: [...draft.variants, { ...blankVariant(), displayOrder: draft.variants.length }] })}>Add variant</button></div>
      <p className={styles.help}>Publication requires a visible category, an active variant, a primary photograph with descriptive alt text, and EGP prices for active direct-purchase variants. Stock may be zero to show unavailability.</p>
      <div className={styles.actions}>
        <button type="submit" disabled={pending || uncertain || mediaDirty} className={`hero-cta hero-primary-button ${styles.button}`}>{pending ? "Saving…" : !record ? "Create draft" : record.status === "DRAFT" ? "Save draft" : "Save changes"}</button>
        {record && record.status !== "PUBLISHED" ? <button type="button" disabled={pending || uncertain || mediaDirty} className={`hero-cta hero-secondary-button ${styles.button}`} onClick={() => void save("publish")}>Publish</button> : null}
        {record?.status === "PUBLISHED" ? <button type="button" disabled={pending || uncertain || mediaDirty} className={`hero-cta hero-secondary-button ${styles.button}`} onClick={() => void save("unpublish")}>Unpublish</button> : null}
        {record && record.status !== "ARCHIVED" ? <button type="button" disabled={pending || uncertain || mediaDirty} className={`hero-cta hero-secondary-button ${styles.button}`} onClick={() => void save("archive")}>Archive</button> : null}
      </div>
    </form>
    {record ? <>
      <section className={styles.panel}><h2>Inventory & availability</h2>{record.variants.length ? record.variants.map((v) => <form key={v.id} method="post" onSubmit={(event) => {
        event.preventDefault(); const form = event.currentTarget, fields = new FormData(form);
        void send(`/${record.id}/inventory/${v.id}`, { delta: Number(fields.get("delta")), reason: fields.get("reason") }).then((success) => { if (success) form.reset(); });
      }}><h3>{v.sku}</h3><p>On hand: {v.onHand ?? "Not tracked"} · Reserved: {v.reserved} · Available: {v.available}</p>
        <p>{!v.active ? "Inactive variant" : record.salesMode === "ENQUIRY_ONLY" ? "Enquiry only" : v.available > 0 && v.priceEGP ? "Stock and price eligible for direct purchase" : "Unavailable for direct purchase"}</p>
        {v.stockUpdatedAt ? <p>Last stock update: {v.stockUpdatedAt}</p> : null}
        <fieldset disabled={pending || uncertain || dirty || mediaDirty || record.productType === "BESPOKE"}><div className={styles.grid}><label className={styles.field}>Adjustment (+/− units)<input type="number" name="delta" step="1" required /></label><label className={styles.field}>Adjustment reason<input name="reason" maxLength={240} required /></label></div>
          <button type="submit" className={`hero-cta hero-secondary-button ${styles.button}`}>Apply stock adjustment for {v.sku}</button></fieldset>
      </form>) : <p>Add a variant before managing inventory.</p>}</section>
      <section className={styles.panel}><h2>Product photographs</h2><p>Product photography only; never upload certificates or private documents. JPEG, PNG or WebP, up to 5 MiB, 200–6000 pixels, at most 20 megapixels.</p>
        {!uploadsConfigured ? <p role="status">Cloudinary uploads are not configured. Product data remains editable.</p> : null}
        <form method="post" encType="multipart/form-data" onSubmit={upload}><fieldset disabled={pending || uncertain || dirty || mediaDirty || !uploadsConfigured}><div className={styles.grid}>
          <label className={styles.field}>Photograph<input type="file" name="file" accept="image/jpeg,image/png,image/webp" required /></label>
          <label className={styles.field}>Photograph description (alt text)<input name="altText" minLength={5} maxLength={250} required /></label></div>
          <button type="submit" className={`hero-cta hero-primary-button ${styles.button}`}>Upload photograph</button></fieldset></form>
        <div className={styles.photos}>{photos.map((photo, i) => <div className={styles.photoCard} key={photo.id}><div className={styles.photoStage}>
          <ProductPhoto src={photo.provider ? `/api/admin/catalogue/products/${record.id}/photos/${photo.id}` : photo.reference} alt={photo.altText} fill sizes="(max-width:767px) 90vw, 480px" className={styles.photo} />
        </div><fieldset disabled={pending || uncertain || dirty}><Field label={`Alt text for photograph ${i + 1}`} value={photo.altText} change={(altText) => updatePhoto(photo.id, { altText })} />
          <label className={styles.check}><input type="radio" name="primary-photo" checked={photo.primary} onChange={() => updatePhoto(photo.id, { primary: true })} />Primary photograph {i + 1}</label>
          <div className={styles.actions}><button type="button" disabled={i === 0} className={`hero-cta hero-secondary-button ${styles.button}`} onClick={() => reorder(i, -1)}>Move photograph {i + 1} up</button>
            <button type="button" disabled={i === photos.length - 1} className={`hero-cta hero-secondary-button ${styles.button}`} onClick={() => reorder(i, 1)}>Move photograph {i + 1} down</button>
            <button type="button" disabled={mediaDirty} className={`hero-cta hero-secondary-button ${styles.button}`} onClick={() => { if (window.confirm("Remove this photograph? Provider cleanup will be tracked for retry.")) void send(`/${record.id}/remove-photo/${photo.id}`, {}); }}>Remove photograph {i + 1}</button></div></fieldset>
        </div>)}</div>
        <div className={styles.actions}><button type="button" disabled={pending || uncertain || dirty || !mediaDirty} className={`hero-cta hero-primary-button ${styles.button}`} onClick={() => void send(`/${record.id}/arrange`, { revision: record.revision, images: photos.map(({ id, altText, primary }) => ({ id, altText, primary })) })}>Save photograph order</button>
          <button type="button" disabled={pending || uncertain || dirty || mediaDirty || !uploadsConfigured} className={`hero-cta hero-secondary-button ${styles.button}`} onClick={() => void send(`/${record.id}/cleanup`, {})}>Retry provider cleanup</button></div>
        <p className={styles.help}>Failed or unfinished uploads remain private. Cleanup can retry after a five-minute upload lease. Previously referenced assets are not deleted while another product still uses them.</p>
      </section>
      <section className={styles.panel}><h2>Change history</h2>{history.length ? history.map((event) => <article className={styles.history} key={event.id}><p>{event.action.replaceAll("CATALOGUE_", "").replaceAll("_", " ")} · {event.actor ?? "System"} · {event.createdAt}</p><code>{JSON.stringify(event.metadata)}</code></article>) : <p>No catalogue change events have been recorded for this product.</p>}</section>
    </> : <p className={styles.help}>Create the draft first, then upload photographs and review publication.</p>}
  </div>;
}

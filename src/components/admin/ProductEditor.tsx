"use client";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import type { CatalogueChoices, EditorMedia, EditorProduct, ProductAction, ProductInput, StoneInput, VariantInput } from "../../lib/admin/catalogue/types.ts";
import { ProductPhoto } from "../catalogue/ProductPhoto";
import { useCatalogueNavigationGuard } from "./useCatalogueNavigationGuard";
import styles from "./catalogue.module.css";
import entry from "./product-entry.module.css";

type History = { id: string; action: string; metadata: Record<string, unknown>; createdAt: string; actor: string | null }[];
type SelectedPhoto = { key: string; file: File; preview: string; altText: string };
const blankVariant = (): VariantInput => ({ sku: "", size: "", configuration: "", metalType: "", metalPurity: "", metalColor: "", metalWeightGrams: "", metalWeightBasis: "", active: true, displayOrder: 0, priceEGP: "", initialStock: 0, stockReason: "", gemstones: [] });
const blankProduct = (): ProductInput => ({ name: "", slug: "", description: "", productType: "REPEATABLE", salesMode: "DIRECT_PURCHASE", categoryIds: [], collectionIds: [], variants: [blankVariant()] });
const blankStone = (): StoneInput => ({ kind: "GROUP", type: "", variety: "", shape: "", color: "", caratWeight: "", origin: "", treatment: "", laboratory: "", reportReference: "", role: "CENTER", quantity: 1, totalCaratWeight: "", displayOrder: 0 });
const button = `hero-cta hero-secondary-button ${styles.button}`;
const primaryButton = `hero-cta hero-primary-button ${styles.button}`;

function editorInput(product: EditorProduct): ProductInput {
  return { name: product.name, slug: product.slug, description: product.description, productType: product.productType, salesMode: product.salesMode, categoryIds: product.categoryIds, collectionIds: product.collectionIds,
    variants: product.variants.map((variant) => ({ id: variant.id, sku: variant.sku, size: variant.size, configuration: variant.configuration, metalType: variant.metalType, metalPurity: variant.metalPurity, metalColor: variant.metalColor, metalWeightGrams: variant.metalWeightGrams ?? "", metalWeightBasis: variant.metalWeightBasis ?? "",
      active: variant.active, displayOrder: variant.displayOrder, priceEGP: variant.priceEGP, gemstones: variant.gemstones })) };
}

function Field({ label, value, change, type = "text", readOnly = false, disabled = false, path, error, required, maxLength, min, max, decimal = false, help }: { label: string; value: string | number; change: (value: string) => void; type?: string; readOnly?: boolean; disabled?: boolean; path?: string; error?: string; required?: boolean; maxLength?: number; min?: number; max?: number; decimal?: boolean; help?: string }) {
  const id = useId();
  const describedBy = [help ? `${id}-help` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return <label className={styles.field} htmlFor={id}><span>{label}{required ? <span aria-hidden="true"> (required)</span> : null}</span>
    <input id={id} aria-label={label} data-field-path={path} type={type} value={value} onChange={(event) => change(event.target.value)} readOnly={readOnly} disabled={disabled} required={required} maxLength={maxLength} min={min} max={max} step={type === "number" ? "1" : undefined} inputMode={decimal ? "decimal" : type === "number" ? "numeric" : undefined} aria-invalid={error ? true : undefined} aria-describedby={describedBy} />
    {help ? <span id={`${id}-help`} className={entry.fieldHelp}>{help}</span> : null}{error ? <span id={`${id}-error`} className={styles.fieldError}>{error}</span> : null}</label>;
}

function fieldContext(path: string) {
  if (path.startsWith("selectedPhotos.")) return "Selected photograph description";
  const names: Record<string, string> = { name: "Jewelry Name", description: "Description", categoryIds: "Jewelry Category", slug: "URL slug", priceEGP: "Price (EGP)", sku: "SKU", size: "Size", configuration: "Configuration", metalType: "Metal", metalPurity: "Metal purity", metalColor: "Metal colour", metalWeightGrams: "Metal weight (grams)", metalWeightBasis: "Metal weight basis", displayOrder: "Display order", initialStock: "Available Pieces", stockReason: "Initial stock reason", type: "Stone type", shape: "Shape / cut", color: "Colour", caratWeight: "Carat weight", totalCaratWeight: "Total carat weight", quantity: "Gemstone quantity", laboratory: "Laboratory name" };
  const variant = /^product\.variants\.(\d+)(?:\.gemstones\.(\d+))?\.(\w+)$/.exec(path);
  if (variant) return `Configuration ${Number(variant[1]) + 1}${variant[2] === undefined ? "" : `, gemstone ${Number(variant[2]) + 1}`} — ${names[variant[3]] ?? variant[3]}`;
  return names[path.replace(/^product\./, "")] ?? "Product details";
}

export function ProductEditor({ product, choices, initialHistory, uploadsConfigured, quotationOnly }: { product: EditorProduct | null; choices: CatalogueChoices; initialHistory: History; uploadsConfigured: boolean; quotationOnly: boolean }) {
  const [record, setRecord] = useState(product);
  const [draft, setDraft] = useState<ProductInput>(() => product ? editorInput(product) : blankProduct());
  const [photos, setPhotos] = useState<EditorMedia[]>(product?.media ?? []);
  const [history, setHistory] = useState(initialHistory);
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [baseline, setBaseline] = useState(() => JSON.stringify(product ? editorInput(product) : blankProduct()));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({}), [uncertain, setUncertain] = useState(false), [recoveryQuery, setRecoveryQuery] = useState("");
  const [selectedPhotos, setSelectedPhotos] = useState<SelectedPhoto[]>([]);
  const [availablePieces, setAvailablePieces] = useState(() => product?.variants.length === 1 ? String(product.variants[0].available) : "");
  const [quantityReason, setQuantityReason] = useState("");
  const [initialQuantityEntered, setInitialQuantityEntered] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null), formRef = useRef<HTMLFormElement>(null), busy = useRef(false);
  const previewURLs = useRef(new Set<string>()), mutationUncertain = useRef(false);
  const failureFocus = useRef<Record<string, string> | null>(null);
  const dirty = JSON.stringify(draft) !== baseline;
  const mediaDirty = JSON.stringify(photos) !== JSON.stringify(record?.media ?? []);
  const single = draft.variants.length === 1;
  const simpleVariant = single ? draft.variants[0] : undefined;
  const savedVariant = record?.variants.length === 1 ? record.variants[0] : undefined;
  const quantityDirty = Boolean(savedVariant && availablePieces !== String(savedVariant.available));
  const tracked = draft.productType !== "BESPOKE";
  const priced = !quotationOnly && draft.salesMode !== "ENQUIRY_ONLY" && draft.productType !== "BESPOKE";
  const maximumPieces = draft.productType === "ONE_OF_A_KIND" || simpleVariant?.gemstones.some((stone) => stone.kind === "INDIVIDUAL") ? Math.max(0, 1 - (savedVariant?.reserved ?? 0)) : 1000000;
  useCatalogueNavigationGuard(dirty || mediaDirty || quantityDirty || Boolean(selectedPhotos.length) || pending || uncertain, pending || uncertain ? "A catalogue operation is pending or its outcome is uncertain. Leave this page and inspect the saved state?" : "Discard unsaved catalogue changes and selected photographs?");

  useEffect(() => () => { for (const url of previewURLs.current) URL.revokeObjectURL(url); previewURLs.current.clear(); }, []);
  useEffect(() => {
    if (pending || !failureFocus.current) return;
    const errors = failureFocus.current; failureFocus.current = null;
    const fields = [...formRef.current?.querySelectorAll<HTMLElement>("[data-field-path]") ?? []];
    const input = fields.find((element) => Boolean(errors[element.dataset.fieldPath ?? ""]))
      ?? (errors["product.variants"] ? fields.find((element) => /^product\.variants\.\d+\.active$/.test(element.dataset.fieldPath ?? "")) : undefined);
    if (input) {
      // Native disclosures retain all values. Reveal every ancestor before focus.
      let ancestor = input.parentElement;
      while (ancestor) { if (ancestor instanceof HTMLDetailsElement) ancestor.open = true; ancestor = ancestor.parentElement; }
      input.focus();
    } else errorRef.current?.focus();
  }, [pending, error, fieldErrors]);

  function apply(saved: EditorProduct, nextHistory: History = [], preserveQuantity = false) {
    setRecord(saved); setDraft(editorInput(saved)); setBaseline(JSON.stringify(editorInput(saved)));
    setPhotos(saved.media); setHistory(nextHistory); setFieldErrors({});
    if (!preserveQuantity) { setAvailablePieces(saved.variants.length === 1 ? String(saved.variants[0].available) : ""); setQuantityReason(""); }
  }
  function focusFailure(errors: Record<string, string> = {}) { failureFocus.current = errors; }
  function updateVariant(index: number, value: VariantInput) { setDraft((current) => ({ ...current, variants: current.variants.map((variant, i) => i === index ? value : variant) })); }
  function updateStone(variantIndex: number, stoneIndex: number, patch: Partial<StoneInput>) {
    setDraft((current) => ({ ...current, variants: current.variants.map((variant, i) => i !== variantIndex ? variant : { ...variant, gemstones: variant.gemstones.map((stone, j) => j === stoneIndex ? { ...stone, ...patch } : stone) }) }));
  }
  const feedbackFor = (path: string) => ({ path, error: fieldErrors[path] });

  async function reload() {
    if (!record || busy.current || ((dirty || mediaDirty || quantityDirty) && !window.confirm("Discard local field changes and reload the saved product? Selected photographs will stay on this device."))) return;
    busy.current = true; setPending(true);
    try {
      const response = await fetch(`/api/admin/catalogue/products/${record.id}`, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(20000) });
      const result = await response.json() as { product?: EditorProduct; history?: History };
      if (!response.ok || !result.product || result.product.id !== record.id) throw new Error();
      apply(result.product, result.history); setUncertain(false); setError(""); setMessage("Current saved product loaded. Review it before making another change. No operation was retried.");
    } catch { setError("The saved product could not be reloaded. Local edits remain here; no mutation was retried."); focusFailure(); }
    finally { busy.current = false; setPending(false); }
  }

  // A sequence holds one lock from the first mutation through its verified result.
  // An uncertain response pauses every mutation until an explicit saved-state read.
  async function operate(work: () => Promise<void>) {
    if (busy.current || uncertain) return;
    busy.current = true; setPending(true); setError(""); setMessage(""); setFieldErrors({});
    try { await work(); }
    finally { busy.current = false; setPending(false); }
  }
  async function mutate(path: string, body: unknown, multipart = false, preserveQuantity = false): Promise<EditorProduct | null> {
    const creating = path === "";
    const recovery = draft.slug.trim() || draft.name.trim();
    mutationUncertain.current = false;
    try {
      const response = await fetch(`/api/admin/catalogue/products${path}`, { method: "POST", credentials: "same-origin", headers: multipart ? undefined : { "Content-Type": "application/json" }, body: multipart ? body as FormData : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      const result = await response.json() as { product?: EditorProduct; history?: History; message?: string; fieldErrors?: Record<string, string> };
      if (!response.ok && [400, 409, 413, 415, 429].includes(response.status)) {
        const errors = result.fieldErrors ?? {}, first = Object.keys(errors)[0];
        let explanation = (first ? fieldContext(first) + ": " : "") + (result.message || "The operation was rejected. Review the fields.");
        if (response.status === 409 && record && /^\/[0-9a-f-]{36}\/inventory\//.test(path)) {
          // A stock snapshot can change independently of product metadata. Read
          // current counters after a rejected command; never resend that command.
          try {
            const fresh = await fetch(`/api/admin/catalogue/products/${record.id}`, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(20000) });
            const latest = await fresh.json() as { product?: EditorProduct; history?: History };
            if (!fresh.ok || !latest.product || latest.product.id !== record.id) throw new Error();
            apply(latest.product, latest.history);
            explanation += " Current saved stock has been loaded. Review the quantity before making another adjustment. No operation was retried.";
          } catch { explanation += " Current stock could not be loaded. Reload the saved product before trying another adjustment."; }
        }
        setFieldErrors(errors); setError(explanation); focusFailure(errors); return null;
      }
      if (!response.ok || !result.product) throw new Error();
      apply(result.product, result.history, preserveQuantity);
      // The installed Next.js Native History API preserves this mounted editor
      // and its device-file queue while giving every confirmed draft a durable
      // reload URL, including when a later photograph upload fails.
      if (creating) window.history.replaceState(null, "", `/admin/products/${result.product.id}/edit`);
      setMessage(result.message ?? "Changes saved."); return result.product;
    } catch {
      mutationUncertain.current = true;
      setUncertain(true);
      if (creating) setRecoveryQuery(recovery);
      setError("The operation outcome is uncertain. It may have reached the server. No retry was made. " + (creating ? "Check the product catalogue for this draft before creating another product." : "Reload the saved product before sending more changes."));
      focusFailure(); return null;
    }
  }
  function removeSelected(key: string) {
    setSelectedPhotos((current) => current.filter((photo) => photo.key !== key));
    const selected = selectedPhotos.find((photo) => photo.key === key);
    if (selected) { URL.revokeObjectURL(selected.preview); previewURLs.current.delete(selected.preview); }
  }
  function validateSelectedPhotos(queue: SelectedPhoto[]) {
    const errors: Record<string,string> = {};
    for (const photo of queue) {
      const description = photo.altText.trim();
      if (description && (description.length < 5 || description.length > 250)) errors[`selectedPhotos.${photo.key}.altText`] = "Leave the description blank, or use 5–250 characters describing visible details.";
    }
    if (!Object.keys(errors).length) return true;
    setFieldErrors(errors); setMessage(""); setError("Review the selected photograph description before saving or uploading. Your photographs remain selected on this device."); focusFailure(errors);
    return false;
  }
  async function uploadSelection(saved: EditorProduct, queue: SelectedPhoto[]): Promise<EditorProduct | null> {
    let current = saved;
    for (const [index, photo] of queue.entries()) {
      const fields = new FormData(); fields.append("file", photo.file);
      fields.append("altText", photo.altText.trim() || `${saved.name} — photograph ${saved.media.length + index + 1}`.slice(0, 250));
      const next = await mutate(`/${saved.id}/photos`, fields, true);
      if (!next) {
        // The uploaded file may already exist after a lost response. Do not offer
        // an automatic retry of this file; the saved gallery must be inspected.
        if (mutationUncertain.current) {
          removeSelected(photo.key);
          setError("The photograph upload outcome is uncertain. The draft remains saved. This file was removed from the upload queue to avoid uploading it twice. Reload and inspect saved photographs before selecting it again. No retry was made.");
        } else setError((currentError) => "The product is saved, but a selected photograph was not uploaded. " + currentError);
        return null;
      }
      removeSelected(photo.key); current = next;
    }
    setMessage("Product and selected photographs saved. Review the gallery before publishing.");
    return current;
  }
  async function save(action: ProductAction) {
    if (busy.current || uncertain || mediaDirty) return;
    if (action === "save" && selectedPhotos.length && uploadsConfigured && !quantityDirty && !validateSelectedPhotos(selectedPhotos)) return;
    if ((action === "archive" || action === "unpublish") && !window.confirm(`${action === "archive" ? "Archive" : "Unpublish"} this product? It will disappear from public browsing.`)) return;
    await operate(async () => {
      const saved = await mutate(record ? `/${record.id}/save` : "", { product: draft, revision: record?.revision, action }, false, quantityDirty);
      if (!saved) return;
      if (selectedPhotos.length && action === "save" && uploadsConfigured && !quantityDirty && !await uploadSelection(saved, selectedPhotos)) return;
    });
  }
  async function uploadSelected() {
    if (!record || dirty || mediaDirty || quantityDirty || !uploadsConfigured || !selectedPhotos.length) return;
    if (!validateSelectedPhotos(selectedPhotos)) return;
    await operate(async () => { await uploadSelection(record, selectedPhotos); });
  }
  function selectPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = [...event.target.files ?? []], accepted: SelectedPhoto[] = [], rejected: string[] = [];
    const remaining = Math.max(0, 12 - photos.length - selectedPhotos.length);
    for (const file of files) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024 || file.size === 0) { rejected.push(file.name); continue; }
      if (accepted.length >= remaining) { rejected.push(file.name); continue; }
      const preview = URL.createObjectURL(file); previewURLs.current.add(preview);
      accepted.push({ key: crypto.randomUUID(), file, preview, altText: "" });
    }
    setSelectedPhotos((current) => [...current, ...accepted]); event.target.value = "";
    if (rejected.length) { setError("Some photographs were not selected. Choose JPEG, PNG or WebP files up to 5 MiB; a product can have at most 12 photographs. Files are checked again securely during upload."); focusFailure(); }
  }
  async function updateAvailablePieces() {
    if (!record || !savedVariant || dirty || mediaDirty || !quantityDirty || !tracked) return;
    if (!/^\d+$/.test(availablePieces) || Number(availablePieces) > maximumPieces) {
      const explanation = `Available Pieces must be a whole number from 0 to ${maximumPieces}. Reserved pieces remain protected.`;
      const errors = { "inventory.availablePieces": explanation }; setFieldErrors(errors); setError(explanation); focusFailure(errors); return;
    }
    await operate(async () => {
      await mutate(`/${record.id}/inventory/${savedVariant.id}`, { delta: Number(availablePieces) - savedVariant.available, reason: quantityReason.trim() || "Available pieces updated in product editor", revision: record.revision, expectedOnHand: savedVariant.onHand, expectedReserved: savedVariant.reserved });
    });
  }
  function changeInitialPieces(value: string) {
    if (!simpleVariant) return;
    setInitialQuantityEntered(Boolean(value));
    updateVariant(0, { ...simpleVariant, initialStock: value === "" ? 0 : Number(value), stockReason: simpleVariant.stockReason || (Number(value) > 0 ? "Initial available pieces entered in product editor" : "") });
  }
  const updatePhoto = (id: string, value: Partial<EditorMedia>) => setPhotos((all) => all.map((photo) => photo.id === id ? { ...photo, ...value } : value.primary ? { ...photo, primary: false } : photo));
  const reorder = (index: number, offset: number) => setPhotos((all) => { const next = [...all]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next; });
  const publicationRequirements = [
    { label: "Jewelry Name", ready: Boolean(draft.name.trim()) },
    { label: "A visible Jewelry Category", ready: draft.categoryIds.some((id) => choices.categories.some((category) => category.id === id && category.visible)) },
    { label: "Description: at least 20 characters, including a letter", ready: draft.description.trim().length >= 20 && /\p{L}/u.test(draft.description) },
    { label: "At least one active configuration", ready: draft.variants.some((variant) => variant.active) },
    { label: "A primary photograph with descriptive alt text", ready: photos.some((photo) => photo.primary && photo.altText.trim().length >= 5) },
    ...(priced ? [{ label: "An EGP price for every active configuration", ready: draft.variants.filter((variant) => variant.active).every((variant) => Boolean(variant.priceEGP.trim())) }] : []),
  ];

  return <div className={`${styles.root} ${entry.root}`}>
    <div className={styles.toolbar}><Link href="/admin/products">← Product catalogue</Link><Link href="/admin/taxonomy">Manage categories and collections</Link><span>{record?.status ?? "NEW DRAFT"}</span></div>
    <h1 className="font-display">{record ? "Edit product" : "Create a product"}</h1>
    <p className={styles.help}>Start with the jewelry itself. Save an incomplete draft at any time; publish only when it is ready for customers.</p>
    {quotationOnly ? <p className={styles.help}>Quotation-only catalogue: every public piece displays Price on Request. No selling price is needed to publish. Existing private prices and original sales modes are preserved for future review.</p> : null}
    {error ? <p ref={errorRef} tabIndex={-1} role="alert" className={styles.notice}>{error}</p> : null}
    {message ? <p role="status" className={styles.notice}>{message}</p> : null}
    {uncertain || error ? <div className={styles.actions}>{record ? <button type="button" className={button} disabled={pending} onClick={() => void reload()}>Reload saved product</button> : uncertain ? <Link href={`/admin/products?q=${encodeURIComponent(recoveryQuery)}`} prefetch={false}>Check product catalogue before creating another draft</Link> : null}</div> : null}
    {uncertain ? <p className={styles.help}>Local editing remains available. Sending changes is paused until the saved state is checked.</p> : null}
    {dirty ? <p className={styles.help}>Unsaved product details. Save them before updating existing stock or uploading photographs.</p> : null}
    {mediaDirty ? <p className={styles.help}>Save photograph ordering and descriptions before editing product details.</p> : null}
    <form ref={formRef} noValidate method="post" action="/api/admin/catalogue/products" onInput={(event) => { const path = (event.target as HTMLElement).dataset.fieldPath; if (path && fieldErrors[path]) setFieldErrors((current) => { const next = { ...current }; delete next[path]; return next; }); }} onSubmit={(event) => { event.preventDefault(); void save("save"); }} aria-busy={pending}>
      <fieldset disabled={pending || mediaDirty} className={styles.panel}><legend>Jewelry essentials</legend>
        <div className={styles.grid}>
          <Field label="Jewelry Name" {...feedbackFor("product.name")} required maxLength={200} value={draft.name} change={(name) => setDraft({ ...draft, name })} />
          <label className={styles.field}>Jewelry Category <span className={entry.fieldHelp}>Required to publish. What type of jewelry is this?</span>
            <select aria-label="Jewelry Category" data-field-path="product.categoryIds" value={draft.categoryIds[0] ?? ""} aria-invalid={Boolean(fieldErrors["product.categoryIds"])} onChange={(event) => setDraft({ ...draft, categoryIds: event.target.value ? [event.target.value, ...draft.categoryIds.slice(1).filter((id) => id !== event.target.value)] : [] })}>
              <option value="">Choose a category</option>{choices.categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.visible ? "" : " (hidden)"}</option>)}
            </select>{fieldErrors["product.categoryIds"] ? <span className={styles.fieldError}>{fieldErrors["product.categoryIds"]}</span> : null}
          </label>
        </div>
        {!choices.categories.length ? <p className={styles.help}>No categories are configured. <Link href="/admin/taxonomy">Create a category</Link> before publication. You can still save a draft.</p> : null}
        <label className={`${styles.field} ${entry.description}`}>Description
          <textarea aria-label="Description" data-field-path="product.description" rows={7} maxLength={10000} value={draft.description} aria-invalid={Boolean(fieldErrors["product.description"])} aria-describedby="product-description-help product-description-error" onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          <span id="product-description-help" className={entry.fieldHelp}>{draft.description.trim().length.toLocaleString()} / 10,000 characters. At least 20 characters, including a letter, are needed to publish. Describe only details you know; do not invent origin, certification or material claims.</span>
          <span id="product-description-error" className={styles.fieldError}>{fieldErrors["product.description"]}</span>
        </label>
        {single && simpleVariant ? <div className={`${styles.grid} ${entry.priceStock}`}>
          {priced ? <Field label="Price (EGP)" {...feedbackFor("product.variants.0.priceEGP")} decimal maxLength={24} value={simpleVariant.priceEGP} change={(priceEGP) => updateVariant(0, { ...simpleVariant, priceEGP })} help="Required to publish a purchasable piece. Use EGP without commas, for example 1250.50." /> : <p className={styles.help}>{quotationOnly ? "Price on Request. Private existing prices remain in Additional Details and are not changed by ordinary edits." : "Price is not required for enquiry-only or bespoke jewelry. Any existing price remains in Additional Details until you explicitly clear it."}</p>}
          {tracked ? <div className={entry.quantity}>
            <Field label="Available Pieces" {...feedbackFor(simpleVariant.id ? "inventory.availablePieces" : "product.variants.0.initialStock")} type="number" min={0} max={maximumPieces} value={simpleVariant.id ? availablePieces : initialQuantityEntered || (simpleVariant.initialStock ?? 0) > 0 ? simpleVariant.initialStock ?? 0 : ""} change={simpleVariant.id ? setAvailablePieces : changeInitialPieces} help={maximumPieces <= 1 ? "A unique piece or individual-stone configuration can hold at most one piece in total, including reservations." : quotationOnly ? "Optional operational stock count. Zero stock does not prevent enquiries, and a customer request never reserves a piece." : "Enter the number available for sale. An unfinished draft can remain at zero. Adding to a cart does not reserve stock."} />
            {simpleVariant.id ? <><p className={entry.fieldHelp}>Reserved: {savedVariant?.reserved ?? 0}. Reservations are preserved. Stock is saved separately from product details.</p><button type="button" disabled={pending || uncertain || dirty || mediaDirty || !quantityDirty} className={button} onClick={() => void updateAvailablePieces()}>Update available pieces</button></> : null}
          </div> : <p className={styles.help}>Bespoke pieces are made by enquiry; inventory is not offered for direct purchase.</p>}
        </div> : <p className={styles.help}>{draft.variants.length > 1 ? "This piece has several configurations. Their individual prices and stock stay available in Sizes and variants below." : "This saved draft has no configuration yet. Add one in Sizes and variants when you are ready."}</p>}
        <label className={`${styles.field} ${entry.collection}`}>Collection (optional)<span className={entry.fieldHelp}>Which jewelry range does this belong to?</span>
          <select aria-label="Collection (optional)" value={draft.collectionIds[0] ?? ""} onChange={(event) => setDraft({ ...draft, collectionIds: event.target.value ? [event.target.value, ...draft.collectionIds.slice(1).filter((id) => id !== event.target.value)] : [] })}><option value="">No collection</option>{choices.collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name} ({collection.status.toLowerCase()})</option>)}</select>
        </label>
      </fieldset>

      <section className={styles.panel} aria-labelledby="product-photographs-title"><h2 id="product-photographs-title">Photographs</h2>
        <p className={styles.help}>Add jewelry photographs from your computer or phone. JPEG, PNG or WebP, up to 5 MiB each, 200–6000 pixels and at most 20 megapixels. Never upload certificates or private documents.</p>
        {!uploadsConfigured ? <p role="status" className={styles.help}>Cloudinary uploads are not configured. You can preview photographs locally and save product details; photographs cannot be uploaded or published until secure media setup is complete.</p> : null}
        <fieldset disabled={pending || uncertain || mediaDirty} className={entry.photoPicker}>
          <label className={styles.field}>Add Photographs<input type="file" aria-label="Add Photographs" accept="image/jpeg,image/png,image/webp" multiple onChange={selectPhotos} /></label>
          <p className={entry.fieldHelp}>{record ? "Save changed product details before uploading." : "Selected photographs stay on this device until the draft has been safely created."} A product can have up to 12 photographs.</p>
        </fieldset>
        {selectedPhotos.length ? <><h3>Selected on this device ({selectedPhotos.length})</h3><div className={styles.photos}>{selectedPhotos.map((photo, index) => <div className={styles.photoCard} key={photo.key}>
          <div className={styles.photoStage}><Image className={entry.preview} src={photo.preview} alt={`Selected photograph ${index + 1}: ${photo.file.name}`} fill unoptimized sizes="(max-width:767px) 90vw, 480px" /></div>
          <p className={entry.filename}>{photo.file.name}</p>
          <details className={entry.photoDetails}><summary>Photograph description (optional)</summary><Field label={`Description for selected photograph ${index + 1}`} {...feedbackFor(`selectedPhotos.${photo.key}.altText`)} value={photo.altText} disabled={pending} maxLength={250} change={(altText) => setSelectedPhotos((all) => all.map((item) => item.key === photo.key ? { ...item, altText } : item))} help="Leave blank to use the jewelry name and photograph number, or enter 5–250 characters describing factual visible details." /></details>
          <button type="button" className={button} disabled={pending} onClick={() => removeSelected(photo.key)}>Remove selected photograph {index + 1}</button>
        </div>)}</div>{record ? <button type="button" className={primaryButton} disabled={pending || uncertain || dirty || mediaDirty || quantityDirty || !uploadsConfigured} onClick={() => void uploadSelected()}>Upload selected photographs</button> : <p className={styles.help}>Save Draft first. Configured uploads will follow only after the saved product is confirmed.</p>}</> : null}
        <div className={styles.photos}>{photos.map((photo, index) => <div className={styles.photoCard} key={photo.id}><div className={styles.photoStage}><ProductPhoto src={photo.provider ? `/api/admin/catalogue/products/${record?.id}/photos/${photo.id}` : photo.reference} alt={photo.altText} fill sizes="(max-width:767px) 90vw, 480px" className={styles.photo} /></div>
          <fieldset disabled={pending || uncertain || dirty || quantityDirty}>
            <Field label={`Alt text for photograph ${index + 1}`} value={photo.altText} maxLength={250} change={(altText) => updatePhoto(photo.id, { altText })} />
            <label className={styles.check}><input type="radio" name="primary-photo" checked={photo.primary} onChange={() => updatePhoto(photo.id, { primary: true })} />Primary photograph {index + 1}</label>
            <div className={styles.actions}><button type="button" disabled={index === 0} className={button} onClick={() => reorder(index, -1)}>Move photograph {index + 1} up</button><button type="button" disabled={index === photos.length - 1} className={button} onClick={() => reorder(index, 1)}>Move photograph {index + 1} down</button>
              <button type="button" disabled={mediaDirty} className={button} onClick={() => { if (record && window.confirm("Remove this photograph? Provider cleanup will be tracked for retry.")) void operate(async () => { await mutate(`/${record.id}/remove-photo/${photo.id}`, {}); }); }}>Remove photograph {index + 1}</button></div>
          </fieldset>
        </div>)}</div>
        {record ? <div className={styles.actions}><button type="button" className={primaryButton} disabled={pending || uncertain || dirty || quantityDirty || !mediaDirty} onClick={() => void operate(async () => { await mutate(`/${record.id}/arrange`, { revision: record.revision, images: photos.map(({ id, altText, primary }) => ({ id, altText, primary })) }); })}>Save photograph order</button></div> : null}
      </section>

      <h2 className={`font-display ${entry.additionalTitle}`}>Additional Details</h2><p className={styles.help}>Optional controls for unusual pieces and existing catalogue records. Closing a section keeps every value.</p>
      <details className={entry.disclosure}><summary>Materials and gemstones</summary><fieldset disabled={pending || mediaDirty} className={entry.disclosureBody}>
        <p className={styles.help}>Describe only known characteristics. Report references do not verify certification or provenance. An individual-stone configuration can hold at most one piece.</p>
        {draft.variants.map((variant, index) => <div key={variant.id ?? index} className={entry.variantSection}><h3>Configuration {index + 1}</h3>
          <div className={styles.grid}>{([ ["metalType", "Metal"], ["metalPurity", "Metal purity"], ["metalColor", "Metal colour"] ] as const).map(([field, label]) => <Field key={field} label={label} {...feedbackFor(`product.variants.${index}.${field}`)} maxLength={160} value={variant[field]} change={(value) => updateVariant(index, { ...variant, [field]: value })} />)}</div>
          <div className={styles.grid}><Field label="Metal weight (grams)" {...feedbackFor(`product.variants.${index}.metalWeightGrams`)} maxLength={20} decimal value={variant.metalWeightGrams ?? ""} change={(metalWeightGrams) => updateVariant(index, { ...variant, metalWeightGrams })} help="Optional, positive grams with up to three decimal places. Leave unknown measurements blank; never infer a weight from a photograph." />
            <label className={styles.field}>Metal weight basis<select aria-label="Metal weight basis" data-field-path={`product.variants.${index}.metalWeightBasis`} value={variant.metalWeightBasis ?? ""} aria-invalid={Boolean(fieldErrors[`product.variants.${index}.metalWeightBasis`])} aria-describedby={fieldErrors[`product.variants.${index}.metalWeightBasis`] ? `metal-weight-basis-error-${index}` : undefined} onChange={(event) => updateVariant(index, { ...variant, metalWeightBasis: event.target.value as VariantInput["metalWeightBasis"] })}><option value="">Unknown / not recorded</option><option value="ACTUAL">Actual measurement</option><option value="ESTIMATED">Estimated weight</option></select>{fieldErrors[`product.variants.${index}.metalWeightBasis`] ? <span id={`metal-weight-basis-error-${index}`} className={styles.fieldError}>{fieldErrors[`product.variants.${index}.metalWeightBasis`]}</span> : null}</label>
          </div>
          {variant.gemstones.map((stone, stoneIndex) => <div className={styles.stones} key={stone.associationId ?? stoneIndex}><h3>Gemstone {stoneIndex + 1}</h3><div className={styles.grid}>
            {([ ["type", "Stone type"], ["variety", "Variety"], ["shape", "Shape / cut"], ["color", "Colour"], ["caratWeight", "Carat weight"], ["origin", "Known origin"], ["treatment", "Treatment disclosure"], ["laboratory", "Laboratory name"], ["reportReference", "Report reference"], ["totalCaratWeight", "Total carat weight"] ] as const).map(([field, label]) => <Field key={field} label={label} {...feedbackFor(`product.variants.${index}.gemstones.${stoneIndex}.${field}`)} required={field === "type" || field === "shape" || field === "color" || field === "laboratory" && Boolean(stone.reportReference.trim())} decimal={field === "caratWeight" || field === "totalCaratWeight"} maxLength={field === "caratWeight" || field === "totalCaratWeight" ? 20 : field === "type" || field === "shape" || field === "color" ? 100 : field === "treatment" ? 1000 : field === "reportReference" ? 250 : 160} value={stone[field]} change={(value) => updateStone(index, stoneIndex, { [field]: value })} />)}
            <label className={styles.field}>Specification kind<select aria-label="Specification kind" value={stone.kind} onChange={(event) => updateStone(index, stoneIndex, { kind: event.target.value as StoneInput["kind"] })}><option value="GROUP">Group specification</option><option value="INDIVIDUAL">Individual stone</option></select></label>
            <label className={styles.field}>Gemstone role<select aria-label="Gemstone role" value={stone.role} onChange={(event) => updateStone(index, stoneIndex, { role: event.target.value as StoneInput["role"] })}><option value="CENTER">Center</option><option value="ACCENT">Accent</option><option value="OTHER">Other</option></select></label>
            <Field label="Gemstone quantity" {...feedbackFor(`product.variants.${index}.gemstones.${stoneIndex}.quantity`)} required type="number" min={1} max={stone.kind === "INDIVIDUAL" ? 1 : 10000} value={stone.quantity} change={(value) => updateStone(index, stoneIndex, { quantity: Number(value) })} />
            <Field label="Gemstone display order" {...feedbackFor(`product.variants.${index}.gemstones.${stoneIndex}.displayOrder`)} required type="number" min={0} max={10000} value={stone.displayOrder} change={(value) => updateStone(index, stoneIndex, { displayOrder: Number(value) })} />
          </div><button type="button" className={button} onClick={() => updateVariant(index, { ...variant, gemstones: variant.gemstones.filter((_, i) => i !== stoneIndex) })}>Detach gemstone {stoneIndex + 1}</button></div>)}
          <div className={styles.actions}><button type="button" className={button} onClick={() => updateVariant(index, { ...variant, gemstones: [...variant.gemstones, blankStone()] })}>Add gemstone</button></div>
        </div>)}
      </fieldset></details>

      <details className={entry.disclosure} open={draft.variants.length > 1 || undefined}><summary>Sizes and variants</summary><fieldset disabled={pending || mediaDirty} className={entry.disclosureBody}>
        {fieldErrors["product.variants"] ? <p id="product-variants-error" className={styles.fieldError}>{fieldErrors["product.variants"]}</p> : null}
        <p className={styles.help}>A normal piece already has one configuration. Add another only for a different size, metal or configuration. Existing configurations and their history are preserved.</p>
        <div className={styles.grid}>
          <label className={styles.field}>Product type<select aria-label="Product type" disabled={Boolean(record?.variants.length)} value={draft.productType} onChange={(event) => { const productType = event.target.value as ProductInput["productType"]; setDraft({ ...draft, productType, salesMode: productType === "BESPOKE" ? "ENQUIRY_ONLY" : draft.salesMode }); }}><option value="REPEATABLE">Standard jewelry (repeatable)</option><option value="ONE_OF_A_KIND">One-of-a-kind jewelry</option><option value="BESPOKE">Bespoke, made by enquiry</option></select></label>
          <label className={styles.field}>Sales mode<select aria-label="Sales mode" value={draft.salesMode} onChange={(event) => setDraft({ ...draft, salesMode: event.target.value as ProductInput["salesMode"] })}><option value="DIRECT_PURCHASE">Available to purchase</option><option value="ENQUIRY_ONLY">Enquiry only</option><option value="BOTH">Purchase and enquiry</option></select></label>
        </div><p className={styles.help}>Bespoke pieces must be enquiry-only, with no price or stock. Switching a mode never silently discards prices or specifications; clear ineligible values explicitly before saving.</p>
        {draft.variants.map((variant, index) => <fieldset className={`${styles.panel} ${entry.variantPanel}`} key={variant.id ?? index}><legend>Variant {index + 1}</legend><div className={styles.grid}>
          <Field label="Size" {...feedbackFor(`product.variants.${index}.size`)} maxLength={100} value={variant.size} change={(size) => updateVariant(index, { ...variant, size })} />
          <Field label="Configuration" {...feedbackFor(`product.variants.${index}.configuration`)} maxLength={250} value={variant.configuration} change={(configuration) => updateVariant(index, { ...variant, configuration })} />
          <Field label="Variant display order" {...feedbackFor(`product.variants.${index}.displayOrder`)} required type="number" min={0} max={10000} value={variant.displayOrder} change={(value) => updateVariant(index, { ...variant, displayOrder: Number(value) })} />
          {!single || !priced ? <Field label="Selling price (EGP)" {...feedbackFor(`product.variants.${index}.priceEGP`)} maxLength={24} decimal value={variant.priceEGP} change={(priceEGP) => updateVariant(index, { ...variant, priceEGP })} help={quotationOnly ? "Optional private price, preserved for future review. It is hidden publicly and does not enable purchasing." : "Leave blank for enquiries. Enquiry-only and bespoke pieces cannot carry a selling price."} /> : null}
          {!variant.id && (!single || !tracked) ? <Field label="Initial stock" {...feedbackFor(`product.variants.${index}.initialStock`)} required type="number" min={0} max={!tracked ? 0 : draft.productType === "ONE_OF_A_KIND" || variant.gemstones.some((stone) => stone.kind === "INDIVIDUAL") ? 1 : 1000000} value={variant.initialStock ?? 0} change={(value) => updateVariant(index, { ...variant, initialStock: Number(value), stockReason: variant.stockReason || (Number(value) > 0 ? "Initial available pieces entered in product editor" : "") })} /> : null}
        </div><label className={styles.check}><input type="checkbox" data-field-path={`product.variants.${index}.active`} checked={variant.active} aria-invalid={Boolean(fieldErrors["product.variants"])} aria-describedby={fieldErrors["product.variants"] ? "product-variants-error" : undefined} onChange={(event) => updateVariant(index, { ...variant, active: event.target.checked })} />Active variant</label>
          {!variant.id ? <div className={styles.actions}><button type="button" className={button} onClick={() => setDraft({ ...draft, variants: draft.variants.filter((_, i) => i !== index) })}>Remove unsaved variant</button></div> : <p className={styles.help}>Deactivate a saved configuration rather than deleting its history.</p>}
        </fieldset>)}
        <button type="button" data-field-path={!draft.variants.length ? "product.variants" : undefined} className={button} disabled={draft.variants.length >= 30 || draft.productType === "ONE_OF_A_KIND" && draft.variants.length >= 1} onClick={() => setDraft({ ...draft, variants: [...draft.variants, { ...blankVariant(), displayOrder: draft.variants.length }] })}>Add variant</button>
      </fieldset></details>

      <details className={entry.disclosure}><summary>Pricing and inventory</summary><fieldset disabled={pending || mediaDirty} className={entry.disclosureBody}>
        <p className={styles.help}>{quotationOnly ? "Private prices are optional and stay hidden from the public catalogue. " : "Prices use exact EGP amounts with up to two decimal places. "}Zero stock can be published. Stock changes never remove reservations.</p>
        {draft.variants.map((variant, index) => !variant.id ? <div key={index}><h3>Configuration {index + 1}</h3><Field label="Initial stock reason" {...feedbackFor(`product.variants.${index}.stockReason`)} maxLength={240} required={Boolean(variant.initialStock)} value={variant.stockReason ?? ""} change={(stockReason) => updateVariant(index, { ...variant, stockReason })} /></div> : null)}
        {savedVariant && tracked ? <Field label="Adjustment reason" maxLength={240} value={quantityReason} change={setQuantityReason} help="Optional for the basic stock-count action. If blank, its factual operation description is recorded in the audit history." /> : null}
        {record ? <p className={styles.help}>Detailed stock counters and signed adjustments are below the product form. Apply them only after saving product details and photograph arrangement.</p> : null}
      </fieldset></details>

      <details className={entry.disclosure}><summary>Publication and visibility</summary><fieldset disabled={pending || mediaDirty} className={entry.disclosureBody}>
        <h3>Category associations</h3><p className={styles.help}>The main category is shown above. Keep additional associations here when a piece belongs to more than one type.</p><div className={styles.checks}>{choices.categories.map((category) => <label key={category.id} className={styles.check}><input type="checkbox" checked={draft.categoryIds.includes(category.id)} onChange={(event) => setDraft({ ...draft, categoryIds: event.target.checked ? [...draft.categoryIds, category.id] : draft.categoryIds.filter((id) => id !== category.id) })} />{category.name}{category.visible ? "" : " (hidden)"}</label>)}</div>
        <h3>Collection associations</h3><div className={styles.checks}>{choices.collections.map((collection) => <label key={collection.id} className={styles.check}><input type="checkbox" checked={draft.collectionIds.includes(collection.id)} onChange={(event) => setDraft({ ...draft, collectionIds: event.target.checked ? [...draft.collectionIds, collection.id] : draft.collectionIds.filter((id) => id !== collection.id) })} />{collection.name} ({collection.status.toLowerCase()})</label>)}</div>
      </fieldset></details>

      <details className={entry.disclosure}><summary>Technical details</summary><fieldset disabled={pending || mediaDirty} className={entry.disclosureBody}>
        <Field label="URL slug" {...feedbackFor("product.slug")} maxLength={160} value={draft.slug} readOnly={record?.slugLocked} change={(slug) => setDraft({ ...draft, slug })} help={record?.slugLocked ? "This URL stays fixed after first publication to preserve existing links." : record ? "Changing the name keeps this URL. An eligible manual URL change must be intentional." : "Leave blank to generate a unique URL from the jewelry name when the draft is saved."} />
        {record ? <p className={entry.savedURL}>Saved product URL: /jewels/{record.slug}</p> : null}
        {draft.variants.map((variant, index) => <div key={variant.id ?? index}><h3>Configuration {index + 1}</h3><Field label="SKU" {...feedbackFor(`product.variants.${index}.sku`)} maxLength={80} value={variant.sku} change={(sku) => updateVariant(index, { ...variant, sku })} help={variant.id ? "The existing SKU is preserved when the jewelry name changes. Edit only for an intentional stock-code correction." : "Leave blank for a unique automatically generated stock code. A manual override must use uppercase letters, numbers, dots, underscores or hyphens."} /></div>)}
      </fieldset></details>

      <section className={`${styles.panel} ${entry.publishPanel}`} aria-labelledby="publication-title"><h2 id="publication-title">Ready to publish?</h2><ul className={entry.checklist}>{publicationRequirements.map((requirement) => <li key={requirement.label}><span aria-hidden="true">{requirement.ready ? "✓" : "○"}</span><span>{requirement.label} — {requirement.ready ? "ready" : "needed"}</span></li>)}</ul><p className={styles.help}>These cues help you prepare. The server verifies all publication, photo, stock and product-type rules again. Saving an existing published product keeps it published; use Unpublish to hide it.</p>
        {selectedPhotos.length ? <p className={styles.help}>Upload all selected photographs before publishing. {uploadsConfigured ? "Save Draft can save the product and then upload the selection." : "Secure Cloudinary configuration is still required."}</p> : null}
        <div className={styles.actions}>
          <button type="submit" disabled={pending || uncertain || mediaDirty} className={primaryButton}>{pending ? "Saving…" : record?.status === "PUBLISHED" ? "Save changes" : "Save Draft"}</button>
          {record && record.status !== "PUBLISHED" ? <button type="button" disabled={pending || uncertain || mediaDirty || Boolean(selectedPhotos.length) || quantityDirty} className={button} onClick={() => void save("publish")}>Publish</button> : null}
          {record?.status === "PUBLISHED" ? <button type="button" disabled={pending || uncertain || mediaDirty} className={button} onClick={() => void save("unpublish")}>Unpublish</button> : null}
          {record && record.status !== "ARCHIVED" ? <button type="button" disabled={pending || uncertain || mediaDirty} className={button} onClick={() => void save("archive")}>Archive</button> : null}
        </div>
      </section>
    </form>

    {record ? <>
      <details className={entry.disclosure}><summary>Detailed stock adjustments</summary><section className={entry.disclosureBody}><h2 className="font-display">Inventory &amp; availability</h2>
        {record.variants.length ? record.variants.map((variant) => <form key={variant.id} method="post" onSubmit={(event) => {
          event.preventDefault(); const form = event.currentTarget, fields = new FormData(form);
          void operate(async () => { if (await mutate(`/${record.id}/inventory/${variant.id}`, { delta: Number(fields.get("delta")), reason: fields.get("reason"), revision: record.revision, expectedOnHand: variant.onHand, expectedReserved: variant.reserved })) form.reset(); });
        }}><h3>{variant.sku}</h3><p className={styles.help}>On hand: {variant.onHand ?? "Not tracked"} · Reserved: {variant.reserved} · Available: {variant.available}</p><p className={styles.help}>{quotationOnly ? "Purchasing is disabled. Stock counts remain available for boutique operations." : !variant.active ? "Inactive variant" : record.salesMode === "ENQUIRY_ONLY" ? "Enquiry only" : variant.available > 0 && variant.priceEGP ? "Stock and price eligible for direct purchase" : "Unavailable for direct purchase"}</p>{variant.stockUpdatedAt ? <p className={styles.help}>Last stock update: {variant.stockUpdatedAt}</p> : null}
          <fieldset disabled={pending || uncertain || dirty || mediaDirty || quantityDirty || record.productType === "BESPOKE"}><div className={styles.grid}><label className={styles.field}>Adjustment (+/− units)<input type="number" name="delta" step="1" required /></label><label className={styles.field}>Adjustment reason<input name="reason" maxLength={240} required /></label></div><button type="submit" className={button}>Apply stock adjustment for {variant.sku}</button></fieldset>
        </form>) : <p>No configurations yet.</p>}
      </section></details>
      <details className={entry.disclosure}><summary>Media maintenance</summary><div className={entry.disclosureBody}><button type="button" disabled={pending || uncertain || dirty || mediaDirty || quantityDirty || !uploadsConfigured} className={button} onClick={() => void operate(async () => { await mutate(`/${record.id}/cleanup`, {}); })}>Retry provider cleanup</button><p className={styles.help}>Failed or unfinished uploads remain private. Cleanup can retry after a five-minute upload lease. Referenced assets are not deleted while another product still uses them.</p></div></details>
      <details className={entry.disclosure}><summary>Change history</summary><section className={entry.disclosureBody}>{history.length ? history.map((event) => <article className={styles.history} key={event.id}><p>{event.action.replaceAll("CATALOGUE_", "").replaceAll("_", " ")} · {event.actor ?? "System"} · {event.createdAt}</p><code>{JSON.stringify(event.metadata)}</code></article>) : <p>No catalogue change events have been recorded for this product.</p>}</section></details>
    </> : null}
  </div>;
}

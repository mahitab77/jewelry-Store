"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CategoryRecord, CollectionRecord, TaxonomyState } from "../../lib/admin/catalogue/taxonomy-types.ts";
import { useCatalogueNavigationGuard } from "./useCatalogueNavigationGuard";
import styles from "./catalogue.module.css";
import taxonomyStyles from "./taxonomy-entry.module.css";

type CommonDraft = { name: string; slug: string; description: string; displayOrder: string };
type CategoryDraft = CommonDraft & { parentId: string; visible: boolean };
type CollectionDraft = CommonDraft & { status: CollectionRecord["status"] };
type Kind = "category" | "collection";
type FieldName = keyof CommonDraft | "parentId" | "visible" | "status";
type FieldFailure = { kind: Kind; field: FieldName; message: string };
type Recovery = { kind: Kind; id?: string; slug: string; name: string; knownIds: string[] };
const categoryInput = (record?: CategoryRecord): CategoryDraft => ({ name: record?.name ?? "", slug: record?.slug ?? "", description: record?.description ?? "", displayOrder: String(record?.displayOrder ?? 0), parentId: record?.parentId ?? "", visible: record?.visible ?? true });
const collectionInput = (record?: CollectionRecord): CollectionDraft => ({ name: record?.name ?? "", slug: record?.slug ?? "", description: record?.description ?? "", displayOrder: String(record?.displayOrder ?? 0), status: record?.status ?? "DRAFT" });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fieldId = (kind: Kind, field: FieldName) => `taxonomy-${kind}-${field}`;
function invalidField(message: string): FieldName | undefined {
  if (/slug|URL/.test(message)) return "slug";
  if (/Description/i.test(message)) return "description";
  if (/Display order/i.test(message)) return "displayOrder";
  if (/parent|hierarchy|cycle/i.test(message)) return "parentId";
  if (/visibility/i.test(message)) return "visible";
  if (/status/i.test(message)) return "status";
  if (/Name/i.test(message)) return "name";
}
function invalidDraft(draft: CommonDraft): { field: keyof CommonDraft; message: string } | undefined {
  if (!draft.name.trim() || draft.name.trim().length > 200) return { field: "name", message: "Enter a name of up to 200 characters." };
  if (draft.slug.trim() && (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(draft.slug.trim()) || draft.slug.trim().length > 160)) return { field: "slug", message: "Use a lowercase URL name with words separated by hyphens, or leave it blank to generate one." };
  if (draft.description.trim().length > 10000) return { field: "description", message: "Keep the description within 10,000 characters." };
  if (!draft.displayOrder.trim() || !Number.isInteger(Number(draft.displayOrder)) || Number(draft.displayOrder) < 0 || Number(draft.displayOrder) > 10000) return { field: "displayOrder", message: "Display order must be a whole number from 0 to 10,000." };
}

export function TaxonomyEditor({ initial }: { initial: TaxonomyState }) {
  const [state, setState] = useState(initial);
  // Keep each loaded revision until that form saves or explicitly reloads.
  const [category, setCategory] = useState<CategoryRecord>();
  const [collection, setCollection] = useState<CollectionRecord>();
  const [categoryDraft, setCategoryDraft] = useState(() => categoryInput());
  const [collectionDraft, setCollectionDraft] = useState(() => collectionInput());
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false);
  const [feedback, setFeedback] = useState(""), [error, setError] = useState(false);
  const [details, setDetails] = useState({ category: false, collection: false });
  const [fieldFailure, setFieldFailure] = useState<FieldFailure>();
  const notice = useRef<HTMLParagraphElement>(null), busy = useRef(false);
  const failureFocus = useRef<{ kind: Kind; field?: FieldName } | null>(null);
  const categoryDirty = !same(categoryDraft, categoryInput(category)), collectionDirty = !same(collectionDraft, collectionInput(collection));
  const recovery = useRef<Recovery | null>(null);
  useCatalogueNavigationGuard(categoryDirty || collectionDirty || pending || uncertain, pending || uncertain ? "A catalogue save is pending or its outcome is uncertain. Leave this page and inspect the saved state?" : "Discard unsaved category or collection changes?");
  useEffect(() => {
    if (pending || !feedback) return;
    const target = failureFocus.current;
    failureFocus.current = null;
    if (target?.field) document.getElementById(fieldId(target.kind, target.field))?.focus();
    else notice.current?.focus();
  }, [pending, feedback, fieldFailure]);

  function reject(kind: Kind, message: string, field?: FieldName) {
    setError(true); setFeedback(message);
    setFieldFailure(field ? { kind, field, message } : undefined);
    if (field && field !== "name") setDetails((current) => ({ ...current, [kind]: true }));
    failureFocus.current = { kind, field };
  }
  function fieldAttributes(kind: Kind, field: FieldName) {
    const invalid = fieldFailure?.kind === kind && fieldFailure.field === field;
    return { id: fieldId(kind, field), "aria-invalid": invalid || undefined, "aria-describedby": invalid ? fieldId(kind, field) + "-error" : undefined };
  }
  function fieldError(kind: Kind, field: FieldName) {
    return fieldFailure?.kind === kind && fieldFailure.field === field ? <span className={styles.fieldError} id={fieldId(kind, field) + "-error"}>{fieldFailure.message}</span> : null;
  }

  function selectCategory(id: string) {
    if (categoryDirty && !window.confirm("Discard unsaved category changes?")) return;
    const next = state.categories.find((record) => record.id === id);
    setCategory(next); setCategoryDraft(categoryInput(next)); setFieldFailure(undefined);
  }
  function selectCollection(id: string) {
    if (collectionDirty && !window.confirm("Discard unsaved collection changes?")) return;
    const next = state.collections.find((record) => record.id === id);
    setCollection(next); setCollectionDraft(collectionInput(next)); setFieldFailure(undefined);
  }
  function discard(kind: "category" | "collection") {
    if (!window.confirm("Discard unsaved " + kind + " changes?")) return;
    if (kind === "category") setCategoryDraft(categoryInput(category)); else setCollectionDraft(collectionInput(collection));
    if (fieldFailure?.kind === kind) setFieldFailure(undefined);
  }
  async function reload() {
    if (busy.current || ((categoryDirty || collectionDirty) && !window.confirm("Discard local changes and reload saved categories and collections?"))) return;
    busy.current = true; setPending(true); setError(false); setFieldFailure(undefined);
    try {
      const response = await fetch("/api/admin/catalogue/taxonomy", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(20000) });
      const result = await response.json() as TaxonomyState;
      if (!response.ok || !Array.isArray(result.categories) || !Array.isArray(result.collections)) throw new Error();
      const target = recovery.current;
      // Auto-generated slugs can include a collision suffix. A new record is only
      // reconciled when this read identifies exactly one new matching record.
      const recovered = target ? (target.kind === "category" ? result.categories : result.collections).filter((record) => target.id ? record.id === target.id : target.slug ? record.slug === target.slug && !target.knownIds.includes(record.id) : record.name === target.name && !target.knownIds.includes(record.id)) : [];
      if (target && recovered.length !== 1) {
        setState(result); setError(true);
        setFeedback("Saved categories and collections were inspected, but this save could not be identified unambiguously. Your local changes remain here and saving stays blocked. Inspect the saved records before leaving this page; no save was retried.");
        return;
      }
      const nextCategory = result.categories.find((record) => record.id === (target?.kind === "category" ? recovered[0]?.id : category?.id));
      const nextCollection = result.collections.find((record) => record.id === (target?.kind === "collection" ? recovered[0]?.id : collection?.id));
      setState(result); setCategory(nextCategory); setCategoryDraft(categoryInput(nextCategory)); setCollection(nextCollection); setCollectionDraft(collectionInput(nextCollection));
      setUncertain(false); recovery.current = null;
      setFeedback("Saved categories and collections loaded. Review the current records before making another change.");
    } catch { setError(true); setFeedback("Saved groupings could not be reloaded. Your local changes remain here; no save was retried."); }
    finally { busy.current = false; setPending(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>, kind: "category" | "collection") {
    event.preventDefault();
    if (busy.current || uncertain) return;
    const record = kind === "category" ? category : collection, values = kind === "category" ? categoryDraft : collectionDraft;
    const invalid = invalidDraft(values);
    if (invalid) { reject(kind, invalid.message, invalid.field); return; }
    const input = { kind, ...(record ? { id: record.id, revision: record.revision } : {}), ...values, displayOrder: Number(values.displayOrder), ...(kind === "category" ? { parentId: categoryDraft.parentId || null } : {}) };
    const attempted: Recovery = { kind, id: record?.id, slug: values.slug.trim(), name: values.name.trim(), knownIds: (kind === "category" ? state.categories : state.collections).map((item) => item.id) };
    busy.current = true; setPending(true); setFeedback(""); setError(false); setFieldFailure(undefined);
    try {
      const response = await fetch("/api/admin/catalogue/taxonomy", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(20000) });
      const result = await response.json() as TaxonomyState & { id: string; message: string };
      // Authentication/ownership can fail while projecting a committed save.
      if (!response.ok && [400, 409, 413, 415, 429].includes(response.status)) { const message = result.message || "The grouping could not be saved."; reject(kind, message, invalidField(message)); return; }
      if (!response.ok || !Array.isArray(result.categories) || !Array.isArray(result.collections)) throw new Error();
      if (kind === "category") {
        const saved = result.categories.find((item) => item.id === result.id); if (!saved) throw new Error();
        setCategory(saved); setCategoryDraft(categoryInput(saved));
      } else {
        const saved = result.collections.find((item) => item.id === result.id); if (!saved) throw new Error();
        setCollection(saved); setCollectionDraft(collectionInput(saved));
      }
      setState({ categories: result.categories, collections: result.collections });
      setFeedback(kind === "category" ? "Category saved." : "Collection saved.");
    } catch {
      recovery.current = attempted;
      setUncertain(true); setError(true);
      setFeedback("The save outcome is uncertain. It may have reached the server. No retry was made. Reload saved groupings before saving again.");
    } finally { busy.current = false; setPending(false); }
  }
  function nameField(kind: Kind, draft: CommonDraft, change: (value: Partial<CommonDraft>) => void) {
    return <label className={styles.field}><span>{kind === "category" ? "Category name" : "Collection name"} <span aria-hidden="true">(required)</span></span><input {...fieldAttributes(kind, "name")} aria-label="Name" name="name" required maxLength={200} autoComplete="off" value={draft.name} onChange={(event) => change({ name: event.target.value })} />{fieldError(kind, "name")}</label>;
  }
  function commonDetails(kind: Kind, draft: CommonDraft, change: (value: Partial<CommonDraft>) => void, slugLocked = false) {
    return <>
      <label className={styles.field}><span>URL name {slugLocked ? "(fixed)" : "(optional override)"}</span><input {...fieldAttributes(kind, "slug")} aria-label="URL slug" name="slug" maxLength={160} readOnly={slugLocked} value={draft.slug} placeholder="Generated from the name" onChange={(event) => change({ slug: event.target.value })} />{fieldError(kind, "slug")}</label>
      <p className={styles.help}>{slugLocked ? "This URL is fixed so existing links keep working." : "Leave the URL name blank to generate it automatically. If the name is already used, a unique ending is added."}</p>
      <label className={styles.field}>Description<textarea {...fieldAttributes(kind, "description")} aria-label="Description" name="description" maxLength={10000} value={draft.description} onChange={(event) => change({ description: event.target.value })} />{fieldError(kind, "description")}</label>
      <label className={styles.field}><span>Display order</span><input {...fieldAttributes(kind, "displayOrder")} aria-label="Display order" name="displayOrder" type="number" min={0} max={10000} step={1} required value={draft.displayOrder} onChange={(event) => change({ displayOrder: event.target.value })} />{fieldError(kind, "displayOrder")}</label>
    </>;
  }
  return <section className={styles.root}>
    <div className={styles.toolbar}><Link href="/admin/products" prefetch={false}>Product catalogue</Link><Link href="/admin/products/new" prefetch={false}>Create product</Link></div>
    <h1 className="font-display">Categories and collections</h1>
    <p className={styles.help}>Start with a name. We create the URL and display order for you. Choose these groupings later in the jewelry editor.</p>
    {feedback ? <p className={styles.notice} role={error ? "alert" : "status"} tabIndex={-1} ref={notice}>{feedback}</p> : null}
    {(uncertain || error) ? <button className={"hero-cta hero-secondary-button " + styles.button} type="button" disabled={pending} onClick={() => void reload()}>Reload saved groupings</button> : null}
    <div className={taxonomyStyles.sections}>
      <section aria-labelledby="taxonomy-categories-heading" className={taxonomyStyles.section}>
        <h2 id="taxonomy-categories-heading" className={taxonomyStyles.heading}>Categories</h2>
        <p className={taxonomyStyles.question}>What type of jewelry is this?</p>
        <p className={styles.help}>Categories classify jewelry by type, such as rings, earrings or necklaces. A product needs a visible category before publication.</p>
        <label className={styles.field}>Choose category<select aria-label="Choose category" value={category?.id ?? ""} disabled={pending || uncertain} onChange={(event) => selectCategory(event.target.value)}><option value="">New category</option>{state.categories.map((record) => <option key={record.id} value={record.id}>{record.name}{record.visible ? "" : " (hidden)"}</option>)}</select></label>
        {!state.categories.length ? <p className={styles.help}>No categories exist yet. Create your first category below.</p> : null}
        <form noValidate onSubmit={(event) => void submit(event, "category")} aria-busy={pending}>
          <fieldset className={styles.panel} disabled={pending}><legend>{category ? "Edit category" : "Create category"}</legend>
            {categoryDirty ? <p className={styles.help}>Unsaved category changes.</p> : null}
            {nameField("category", categoryDraft, (value) => setCategoryDraft((current) => ({ ...current, ...value })))}
            <p className={styles.help}>{category ? `Saved URL name: ${category.slug}.` : "New categories are visible by default. This makes them available when publishing jewelry."}</p>
            <details className={taxonomyStyles.details} open={details.category} onToggle={(event) => { const open = event.currentTarget.open; setDetails((current) => current.category === open ? current : { ...current, category: open }); }}>
              <summary>Additional details</summary>
              <div className={taxonomyStyles.detailFields}>
                {commonDetails("category", categoryDraft, (value) => setCategoryDraft((current) => ({ ...current, ...value })), Boolean(category))}
                <label className={styles.field}>Parent category<select {...fieldAttributes("category", "parentId")} aria-label="Parent category" name="parentId" value={categoryDraft.parentId} onChange={(event) => setCategoryDraft({ ...categoryDraft, parentId: event.target.value })}><option value="">No parent</option>{state.categories.filter((record) => record.id !== category?.id).map((record) => <option key={record.id} value={record.id}>{record.name}{record.visible ? "" : " (hidden)"}</option>)}</select>{fieldError("category", "parentId")}</label>
                <label className={styles.check}><input {...fieldAttributes("category", "visible")} name="visible" type="checkbox" checked={categoryDraft.visible} onChange={(event) => setCategoryDraft({ ...categoryDraft, visible: event.target.checked })} />Visible category</label>{fieldError("category", "visible")}
                <p className={styles.help}>Hiding a category also hides its descendants from navigation and filters. Use Unpublish on a product to remove its public listing and detail page.</p>
              </div>
            </details>
            <div className={styles.actions}><button className={"hero-cta hero-primary-button " + styles.button} disabled={uncertain} type="submit">{pending ? "Saving…" : category ? "Save category" : "Create category"}</button>{categoryDirty ? <button type="button" className={"hero-cta hero-secondary-button " + styles.button} onClick={() => discard("category")}>Discard category changes</button> : null}</div>
          </fieldset>
        </form>
      </section>
      <section aria-labelledby="taxonomy-collections-heading" className={taxonomyStyles.section}>
        <h2 id="taxonomy-collections-heading" className={taxonomyStyles.heading}>Collections</h2>
        <p className={taxonomyStyles.question}>Which jewelry range does this belong to?</p>
        <p className={styles.help}>Collections group related pieces across categories, such as Bridal Collection or Signature Collection. They are optional.</p>
        <label className={styles.field}>Choose collection<select aria-label="Choose collection" value={collection?.id ?? ""} disabled={pending || uncertain} onChange={(event) => selectCollection(event.target.value)}><option value="">New collection</option>{state.collections.map((record) => <option key={record.id} value={record.id}>{record.name} ({record.status.toLowerCase()})</option>)}</select></label>
        {!state.collections.length ? <p className={styles.help}>No collections exist yet. Collections are optional product groupings.</p> : null}
        <form noValidate onSubmit={(event) => void submit(event, "collection")} aria-busy={pending}>
          <fieldset className={styles.panel} disabled={pending}><legend>{collection ? "Edit collection" : "Create collection"}</legend>
            {collectionDirty ? <p className={styles.help}>Unsaved collection changes.</p> : null}
            {nameField("collection", collectionDraft, (value) => setCollectionDraft((current) => ({ ...current, ...value })))}
            <p className={styles.help}>{collection ? `Saved URL name: ${collection.slug}.` : "New collections start as drafts. Creating a collection does not publish it."}</p>
            <details className={taxonomyStyles.details} open={details.collection} onToggle={(event) => { const open = event.currentTarget.open; setDetails((current) => current.collection === open ? current : { ...current, collection: open }); }}>
              <summary>Additional details</summary>
              <div className={taxonomyStyles.detailFields}>
                {commonDetails("collection", collectionDraft, (value) => setCollectionDraft((current) => ({ ...current, ...value })), collection?.slugLocked)}
                <p className={styles.help}>Collection URLs stay fixed after first publication. Draft and archived collections stay out of public navigation.</p>
                {collection ? <p className={styles.help}>
                  {collection.publiclyVisible ? "This collection is publicly visible." : collection.status === "PUBLISHED"
                    ? "This collection has a future publication time and is not yet visible. To publish it now, save it as a draft, then publish it."
                    : "This collection is not publicly visible."}
                  {collection.publishedAt ? <> Publication time (UTC): <time dateTime={collection.publishedAt}>{collection.publishedAt}</time>.</> : null}
                </p> : null}
                <label className={styles.field}>Collection status<select {...fieldAttributes("collection", "status")} aria-label="Collection status" name="status" value={collectionDraft.status} onChange={(event) => setCollectionDraft({ ...collectionDraft, status: event.target.value as CollectionRecord["status"] })}><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="ARCHIVED">Archived</option></select>{fieldError("collection", "status")}</label>
              </div>
            </details>
            <div className={styles.actions}><button className={"hero-cta hero-primary-button " + styles.button} disabled={uncertain} type="submit">{pending ? "Saving…" : collection ? "Save collection" : "Create collection"}</button>{collectionDirty ? <button type="button" className={"hero-cta hero-secondary-button " + styles.button} onClick={() => discard("collection")}>Discard collection changes</button> : null}</div>
          </fieldset>
        </form>
      </section>
    </div>
  </section>;
}

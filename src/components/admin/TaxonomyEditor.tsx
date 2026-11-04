"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import type { CategoryRecord, CollectionRecord, TaxonomyState } from "../../lib/admin/catalogue/taxonomy-types.ts";
import { useCatalogueNavigationGuard } from "./useCatalogueNavigationGuard";
import styles from "./catalogue.module.css";

type CommonDraft = { name: string; slug: string; description: string; displayOrder: string };
type CategoryDraft = CommonDraft & { parentId: string; visible: boolean };
type CollectionDraft = CommonDraft & { status: CollectionRecord["status"] };
const categoryInput = (record?: CategoryRecord): CategoryDraft => ({ name: record?.name ?? "", slug: record?.slug ?? "", description: record?.description ?? "", displayOrder: String(record?.displayOrder ?? 0), parentId: record?.parentId ?? "", visible: record?.visible ?? false });
const collectionInput = (record?: CollectionRecord): CollectionDraft => ({ name: record?.name ?? "", slug: record?.slug ?? "", description: record?.description ?? "", displayOrder: String(record?.displayOrder ?? 0), status: record?.status ?? "DRAFT" });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function TaxonomyEditor({ initial }: { initial: TaxonomyState }) {
  const [state, setState] = useState(initial);
  // Keep each loaded revision until that form saves or explicitly reloads.
  const [category, setCategory] = useState<CategoryRecord>();
  const [collection, setCollection] = useState<CollectionRecord>();
  const [categoryDraft, setCategoryDraft] = useState(() => categoryInput());
  const [collectionDraft, setCollectionDraft] = useState(() => collectionInput());
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false);
  const [feedback, setFeedback] = useState(""), [error, setError] = useState(false);
  const notice = useRef<HTMLParagraphElement>(null), busy = useRef(false);
  const categoryDirty = !same(categoryDraft, categoryInput(category)), collectionDirty = !same(collectionDraft, collectionInput(collection));
  const recovery = useRef<{ kind: "category" | "collection"; id?: string; slug: string } | null>(null);
  useCatalogueNavigationGuard(categoryDirty || collectionDirty || pending || uncertain, pending || uncertain ? "A catalogue save is pending or its outcome is uncertain. Leave this page and inspect the saved state?" : "Discard unsaved category or collection changes?");

  function selectCategory(id: string) {
    if (categoryDirty && !window.confirm("Discard unsaved category changes?")) return;
    const next = state.categories.find((record) => record.id === id);
    setCategory(next); setCategoryDraft(categoryInput(next));
  }
  function selectCollection(id: string) {
    if (collectionDirty && !window.confirm("Discard unsaved collection changes?")) return;
    const next = state.collections.find((record) => record.id === id);
    setCollection(next); setCollectionDraft(collectionInput(next));
  }
  function discard(kind: "category" | "collection") {
    if (!window.confirm("Discard unsaved " + kind + " changes?")) return;
    if (kind === "category") setCategoryDraft(categoryInput(category)); else setCollectionDraft(collectionInput(collection));
  }
  async function reload() {
    if (busy.current || ((categoryDirty || collectionDirty) && !window.confirm("Discard local changes and reload saved categories and collections?"))) return;
    busy.current = true; setPending(true); setError(false);
    try {
      const response = await fetch("/api/admin/catalogue/taxonomy", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(20000) });
      const result = await response.json() as TaxonomyState;
      if (!response.ok || !Array.isArray(result.categories) || !Array.isArray(result.collections)) throw new Error();
      const target = recovery.current;
      const nextCategory = result.categories.find((record) => target?.kind === "category" ? target.id ? record.id === target.id : record.slug === target.slug : record.id === category?.id);
      const nextCollection = result.collections.find((record) => target?.kind === "collection" ? target.id ? record.id === target.id : record.slug === target.slug : record.id === collection?.id);
      setState(result); setCategory(nextCategory); setCategoryDraft(categoryInput(nextCategory)); setCollection(nextCollection); setCollectionDraft(collectionInput(nextCollection));
      setUncertain(false); recovery.current = null;
      setFeedback("Saved categories and collections loaded. Review the current records before making another change.");
    } catch { setError(true); setFeedback("Saved groupings could not be reloaded. Your local changes remain here; no save was retried."); }
    finally { busy.current = false; setPending(false); requestAnimationFrame(() => notice.current?.focus()); }
  }
  async function submit(event: FormEvent<HTMLFormElement>, kind: "category" | "collection") {
    event.preventDefault();
    if (busy.current || uncertain) return;
    const record = kind === "category" ? category : collection, values = kind === "category" ? categoryDraft : collectionDraft;
    const input = { kind, ...(record ? { id: record.id, revision: record.revision } : {}), ...values, displayOrder: Number(values.displayOrder), ...(kind === "category" ? { parentId: categoryDraft.parentId || null } : {}) };
    busy.current = true; setPending(true); setFeedback(""); setError(false);
    try {
      const response = await fetch("/api/admin/catalogue/taxonomy", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(20000) });
      const result = await response.json() as TaxonomyState & { id: string; message: string };
      // Authentication/ownership can fail while projecting a committed save.
      if (!response.ok && [400, 409, 413, 415, 429].includes(response.status)) { setError(true); setFeedback(result.message || "The grouping could not be saved."); return; }
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
      recovery.current = { kind, id: record?.id, slug: values.slug.trim() };
      setUncertain(true); setError(true);
      setFeedback("The save outcome is uncertain. It may have reached the server. No retry was made. Reload saved groupings before saving again.");
    } finally { busy.current = false; setPending(false); requestAnimationFrame(() => notice.current?.focus()); }
  }
  function commonFields(draft: CommonDraft, change: (value: Partial<CommonDraft>) => void, slugLocked = false) {
    return <>
      <label className={styles.field}><span>Name <span aria-hidden="true">(required)</span></span><input aria-label="Name" name="name" required maxLength={200} value={draft.name} onChange={(event) => change({ name: event.target.value })} /></label>
      <label className={styles.field}><span>URL slug <span aria-hidden="true">(required)</span></span><input aria-label="URL slug" name="slug" required maxLength={160} pattern="[a-z0-9]+(-[a-z0-9]+)*" readOnly={slugLocked} value={draft.slug} onChange={(event) => change({ slug: event.target.value })} /></label>
      <label className={styles.field}>Description<textarea aria-label="Description" name="description" maxLength={10000} value={draft.description} onChange={(event) => change({ description: event.target.value })} /></label>
      <label className={styles.field}><span>Display order <span aria-hidden="true">(required)</span></span><input aria-label="Display order" name="displayOrder" type="number" min={0} max={10000} step={1} required value={draft.displayOrder} onChange={(event) => change({ displayOrder: event.target.value })} /></label>
    </>;
  }
  return <section className={styles.root}>
    <div className={styles.toolbar}><Link href="/admin/products" prefetch={false}>Product catalogue</Link><Link href="/admin/products/new" prefetch={false}>Create product</Link></div>
    <h1 className="font-display">Categories and collections</h1>
    <p className={styles.help}>Create catalogue groupings, then assign them in the product editor. Products need a publicly visible category before publication. Other unmarked descriptive fields are optional.</p>
    {feedback ? <p className={styles.notice} role={error ? "alert" : "status"} tabIndex={-1} ref={notice}>{feedback}</p> : null}
    {(uncertain || error) ? <button className={"hero-cta hero-secondary-button " + styles.button} type="button" disabled={pending} onClick={() => void reload()}>Reload saved groupings</button> : null}
    <div className={styles.grid}>
      <div>
        <label className={styles.field}>Choose category<select aria-label="Choose category" value={category?.id ?? ""} disabled={pending || uncertain} onChange={(event) => selectCategory(event.target.value)}><option value="">New category</option>{state.categories.map((record) => <option key={record.id} value={record.id}>{record.name}{record.visible ? "" : " (hidden)"}</option>)}</select></label>
        {!state.categories.length ? <p className={styles.help}>No categories exist yet. Create your first category below.</p> : null}
        <form onSubmit={(event) => void submit(event, "category")} aria-busy={pending}>
          <fieldset className={styles.panel} disabled={pending}><legend>{category ? "Edit category" : "Create category"}</legend>
            {categoryDirty ? <p className={styles.help}>Unsaved category changes.</p> : null}
            {commonFields(categoryDraft, (value) => setCategoryDraft((current) => ({ ...current, ...value })), Boolean(category))}
            <p className={styles.help}>Category URLs stay fixed after creation. Hiding a category also hides its descendants from category navigation and filters; use Unpublish on a product to remove its public listing and detail page.</p>
            <label className={styles.field}>Parent category<select aria-label="Parent category" name="parentId" value={categoryDraft.parentId} onChange={(event) => setCategoryDraft({ ...categoryDraft, parentId: event.target.value })}><option value="">No parent</option>{state.categories.filter((record) => record.id !== category?.id).map((record) => <option key={record.id} value={record.id}>{record.name}{record.visible ? "" : " (hidden)"}</option>)}</select></label>
            <label className={styles.check}><input name="visible" type="checkbox" checked={categoryDraft.visible} onChange={(event) => setCategoryDraft({ ...categoryDraft, visible: event.target.checked })} />Visible category</label>
            <div className={styles.actions}><button className={"hero-cta hero-primary-button " + styles.button} disabled={uncertain} type="submit">{pending ? "Saving…" : category ? "Save category" : "Create category"}</button>{categoryDirty ? <button type="button" className={"hero-cta hero-secondary-button " + styles.button} onClick={() => discard("category")}>Discard category changes</button> : null}</div>
          </fieldset>
        </form>
      </div>
      <div>
        <label className={styles.field}>Choose collection<select aria-label="Choose collection" value={collection?.id ?? ""} disabled={pending || uncertain} onChange={(event) => selectCollection(event.target.value)}><option value="">New collection</option>{state.collections.map((record) => <option key={record.id} value={record.id}>{record.name} ({record.status.toLowerCase()})</option>)}</select></label>
        {!state.collections.length ? <p className={styles.help}>No collections exist yet. Collections are optional product groupings.</p> : null}
        <form onSubmit={(event) => void submit(event, "collection")} aria-busy={pending}>
          <fieldset className={styles.panel} disabled={pending}><legend>{collection ? "Edit collection" : "Create collection"}</legend>
            {collectionDirty ? <p className={styles.help}>Unsaved collection changes.</p> : null}
            {commonFields(collectionDraft, (value) => setCollectionDraft((current) => ({ ...current, ...value })), collection?.slugLocked)}
            <p className={styles.help}>Collection URLs stay fixed after first publication. Draft and archived collections stay out of public collection navigation.</p>
            {collection ? <p className={styles.help}>
              {collection.publiclyVisible ? "This collection is publicly visible." : collection.status === "PUBLISHED"
                ? "This collection has a future publication time and is not yet visible. To publish it now, save it as a draft, then publish it."
                : "This collection is not publicly visible."}
              {collection.publishedAt ? <> Publication time (UTC): <time dateTime={collection.publishedAt}>{collection.publishedAt}</time>.</> : null}
            </p> : null}
            <label className={styles.field}>Collection status<select aria-label="Collection status" name="status" value={collectionDraft.status} onChange={(event) => setCollectionDraft({ ...collectionDraft, status: event.target.value as CollectionRecord["status"] })}><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="ARCHIVED">Archived</option></select></label>
            <div className={styles.actions}><button className={"hero-cta hero-primary-button " + styles.button} disabled={uncertain} type="submit">{pending ? "Saving…" : collection ? "Save collection" : "Create collection"}</button>{collectionDirty ? <button type="button" className={"hero-cta hero-secondary-button " + styles.button} onClick={() => discard("collection")}>Discard collection changes</button> : null}</div>
          </fieldset>
        </form>
      </div>
    </div>
  </section>;
}

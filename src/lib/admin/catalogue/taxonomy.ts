import "server-only";
import { randomUUID } from "node:crypto";
import { requirePermission } from "../authorization.ts";
import { getAdminRuntime, type AdminRuntime } from "../runtime.ts";
import { catalogueTransaction, revisionColumn } from "./transaction.ts";
import { fail, integer, object, text, uuid } from "./validation.ts";
import type { TaxonomyInput, TaxonomyState } from "./taxonomy-types.ts";

export async function readTaxonomy(headers: Headers, runtime: AdminRuntime = getAdminRuntime()): Promise<TaxonomyState> {
  await requirePermission("catalogue:manage", headers, runtime);
  const [categories, collections] = await Promise.all([
    runtime.pool.query(`SELECT id,name,slug,COALESCE(description,'') AS description,parent_id AS "parentId",display_order AS "displayOrder",is_visible AS visible,${revisionColumn} AS revision FROM categories ORDER BY display_order,name,id`),
    runtime.pool.query(`SELECT id,name,slug,COALESCE(description,'') AS description,display_order AS "displayOrder",status,published_at IS NOT NULL AS "slugLocked",
      to_char(published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "publishedAt",
      status='PUBLISHED' AND published_at<=CURRENT_TIMESTAMP AS "publiclyVisible",${revisionColumn} AS revision FROM collections ORDER BY display_order,name,id`),
  ]);
  return { categories: categories.rows, collections: collections.rows };
}

function submission(value: unknown): TaxonomyInput {
  const common = ["kind", "id", "revision", "name", "slug", "description", "displayOrder"];
  const base = object(value, [...common, "parentId", "visible", "status"]);
  if (base.kind !== "category" && base.kind !== "collection") fail("Choose a category or collection.");
  const input = object(value, [...common, ...(base.kind === "category" ? ["parentId", "visible"] : ["status"])]);
  const id = input.id === undefined ? undefined : uuid(input.id);
  const revision = input.revision === undefined ? undefined : text(input.revision, "Editor version", 40, true);
  if ((id && !revision) || (!id && revision) || (revision && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(revision))) fail("Reload this category or collection before saving.");
  const fields = { id, revision, name: text(input.name, "Name", 200, true), slug: text(input.slug, "URL slug", 160, true), description: text(input.description, "Description", 10000), displayOrder: integer(input.displayOrder, "Display order") };
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fields.slug)) fail("Use a lowercase, hyphenated URL slug.");
  if (base.kind === "category") {
    if (typeof input.visible !== "boolean") fail("Choose category visibility.");
    const parentId = input.parentId === null ? null : uuid(input.parentId);
    return { ...fields, kind: "category", parentId, visible: input.visible };
  }
  if (input.status !== "DRAFT" && input.status !== "PUBLISHED" && input.status !== "ARCHIVED") fail("Choose a collection status.");
  return { ...fields, kind: "collection", status: input.status };
}

export async function saveTaxonomy(headers: Headers, value: unknown, runtime: AdminRuntime = getAdminRuntime()): Promise<string> {
  return catalogueTransaction(headers, async (client, adminId) => {
    const input = submission(value), id = input.id ?? randomUUID();
    // Serialize parent edits so two concurrent reparentings cannot create a cycle.
    await client.query("SELECT pg_advisory_xact_lock(1781642321,2)");
    const table = input.kind === "category" ? "categories" : "collections";
    const old = input.id ? (await client.query(`SELECT *,${revisionColumn} AS revision FROM ${table} WHERE id=$1 FOR UPDATE`, [id])).rows[0] : null;
    if (input.id && !old) fail("Category or collection not found.", 404);
    if (old && old.revision !== input.revision) fail("This category or collection changed. Reload before saving.", 409);
    if (old && old.slug !== input.slug && (input.kind === "category" || old.published_at)) fail("This URL is locked. Keep the existing slug.", 409);
    if (input.kind === "category") {
      if (input.parentId) {
        const ancestors = (await client.query(`WITH RECURSIVE ancestors AS (
          SELECT id,parent_id,is_visible FROM categories WHERE id=$1
          UNION SELECT c.id,c.parent_id,c.is_visible FROM categories c JOIN ancestors a ON c.id=a.parent_id)
          SELECT count(*)::INT AS count,bool_or(id=$2) AS cycle,bool_or(parent_id IS NULL) AS rooted,bool_and(is_visible) AS visible FROM ancestors`, [input.parentId, id])).rows[0];
        if (!ancestors.count || ancestors.cycle || !ancestors.rooted) fail("Choose an existing parent without creating a category cycle.");
        if (input.visible && !ancestors.visible) fail("Make the parent categories visible before showing this category.");
      }
      if (old) await client.query("UPDATE categories SET name=$2,slug=$3,description=$4,parent_id=$5,display_order=$6,is_visible=$7,updated_at=clock_timestamp() WHERE id=$1", [id, input.name, input.slug, input.description || null, input.parentId, input.displayOrder, input.visible]);
      else await client.query("INSERT INTO categories(id,name,slug,description,parent_id,display_order,is_visible) VALUES($1,$2,$3,$4,$5,$6,$7)", [id, input.name, input.slug, input.description || null, input.parentId, input.displayOrder, input.visible]);
    } else {
      if (old) await client.query("UPDATE collections SET name=$2,slug=$3,description=$4,display_order=$5,status=$6,published_at=CASE WHEN $6='PUBLISHED' AND status<>'PUBLISHED' THEN clock_timestamp() WHEN $6='PUBLISHED' THEN COALESCE(published_at,clock_timestamp()) ELSE published_at END,updated_at=clock_timestamp() WHERE id=$1", [id, input.name, input.slug, input.description || null, input.displayOrder, input.status]);
      else await client.query("INSERT INTO collections(id,name,slug,description,display_order,status,published_at) VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $6='PUBLISHED' THEN clock_timestamp() ELSE NULL END)", [id, input.name, input.slug, input.description || null, input.displayOrder, input.status]);
    }
    const action = `CATALOGUE_${input.kind.toUpperCase()}_${old ? "UPDATED" : "CREATED"}`;
    const metadata = input.kind === "category" ? { visible: input.visible, parentId: input.parentId } : { status: input.status };
    await client.query("INSERT INTO audit_events(actor_kind,actor_admin_id,action,target_table,target_id,metadata) VALUES('ADMIN',$1,$2,$3,$4,$5::JSONB)", [adminId, action, table, id, JSON.stringify(metadata)]);
    return id;
  }, runtime);
}

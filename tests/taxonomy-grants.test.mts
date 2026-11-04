import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { catalogueFixture } from "./helpers/catalogue-fixture.mts";

let fixture: Awaited<ReturnType<typeof catalogueFixture>>;
let source = "";
before(async () => { fixture = await catalogueFixture(undefined, false); source = await readFile("infra/neon/staging-taxonomy-grants.review.sql", "utf8"); }, { timeout: 60000 });
after(async () => { if (fixture) await fixture.close(); });

test("the reviewed grant artifact refuses a local/non-staging target before granting anything", async () => {
  const client = await fixture.data.connect();
  try {
    await assert.rejects(client.query(source.replace(/^\\set[^\n]*\n/gm, "")), /exact approved Neon staging target/);
  } finally { await client.query("ROLLBACK"); client.release(); }
  assert.equal((await fixture.data.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname='lapalme_staging_app'")).rows[0].n, 0);
});

test("reviewed taxonomy grants permit only the necessary insert/update columns", async () => {
  const role = "lapalme_taxonomy_" + randomUUID().replaceAll("-", "");
  assert.match(role, /^lapalme_taxonomy_[a-f0-9]{32}$/);
  const quoted = '"' + role + '"';
  const grants = source.match(/^GRANT (?:INSERT|UPDATE)\([a-z_,]+\) ON public\.(?:categories|collections) TO lapalme_staging_app;$/gm)!;
  assert.equal(grants.length, 4);
  await fixture.data.query("CREATE ROLE " + quoted + " NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT");
  try {
    await fixture.data.query("GRANT USAGE ON SCHEMA public TO " + quoted);
    await fixture.data.query("GRANT SELECT ON categories,collections TO " + quoted);
    for (const statement of grants) await fixture.data.query(statement.replace("TO lapalme_staging_app;", "TO " + quoted + ";"));
    const expected = {
      categories: { INSERT: ["id","name","slug","description","parent_id","display_order","is_visible"], UPDATE: ["name","slug","description","parent_id","display_order","is_visible","updated_at"] },
      collections: { INSERT: ["id","name","slug","description","display_order","status","published_at"], UPDATE: ["name","slug","description","display_order","status","published_at","updated_at"] },
    };
    for (const [table, permissions] of Object.entries(expected)) {
      const columns = (await fixture.data.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [table])).rows.map(row => row.column_name);
      for (const privilege of ["INSERT", "UPDATE"] as const) {
        for (const column of columns) {
          const result = (await fixture.data.query("SELECT has_column_privilege($1,$2,$3,$4) AS allowed", [role, table, column, privilege])).rows[0].allowed;
          assert.equal(result, permissions[privilege].includes(column), table + "." + column + " " + privilege);
        }
      }
      assert.equal((await fixture.data.query("SELECT has_table_privilege($1,$2,'DELETE') AS allowed", [role, table])).rows[0].allowed, false);
    }
    assert.equal((await fixture.data.query("SELECT has_schema_privilege($1,'public','CREATE') AS allowed", [role])).rows[0].allowed, false);
    assert.equal((await fixture.data.query("SELECT has_table_privilege($1,'schema_migrations','SELECT') AS allowed", [role])).rows[0].allowed, false);
    const category = (await fixture.data.query("INSERT INTO categories(name,slug,is_visible) VALUES('Local grant fixture','local-grant-fixture',false) RETURNING id")).rows[0].id;
    // SET ROLE exercises the artifact's actual column permissions, not superuser rights.
    const client = await fixture.data.connect();
    try {
      await client.query("BEGIN"); await client.query("SET LOCAL ROLE " + quoted);
      await client.query("UPDATE categories SET description=$2,updated_at=clock_timestamp() WHERE id=$1", [category, "Local privilege fixture."]);
      await client.query("INSERT INTO collections(id,name,slug,description,display_order,status,published_at) VALUES($1,'Local grant collection','local-grant-collection',NULL,0,'DRAFT',NULL)", [randomUUID()]);
      await client.query("ROLLBACK");
    } finally { await client.query("ROLLBACK"); client.release(); }
  } finally { await fixture.data.query("DROP OWNED BY " + quoted); await fixture.data.query("DROP ROLE " + quoted); }
});


import "server-only";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { PoolClient } from "pg";
import { localDatabaseConfig } from "./local.ts";

export const MIGRATION_LOCK = [1279348813, 2] as const;
const defaultDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));
const legacyHashes = [
  "0026abfbc0657627c6d783970bbdbe84ad721f663311690f66e0828140ea47eb",
  "3d2baf373e7f23d981a86839d16605bc95dd3969ef240d3f7d9bae36da17a369",
  "3eaa0df9e93931b16adc4adb6669f7cf7c2b1e300bc5973cedae72a3f6183757",
  "7906ea7c14ca02b546cd39cf4ef7bd1f944c51d85cba16217fdedd2876cb894f",
  "269dd9f4b3dd8493b7dff60ff7e3813809253abd1f31e24ea3fceea2328554b6",
];
export class MigrationError extends Error {
  constructor(message: string) { super(message); this.name = "MigrationError"; }
}
interface Migration { version: string; filename: string; checksum: string; body: string }
interface Applied { version: string; filename: string; checksum_sha256: string | null }

async function migrations(directory: string): Promise<Migration[]> {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  if (names.length < 6) throw new MigrationError("Migration files are missing.");
  return Promise.all(names.map(async (filename, i) => {
    const version = String(i + 1).padStart(4, "0");
    if (!new RegExp(`^${version}_[a-z0-9_]+\\.sql$`).test(filename)) throw new MigrationError("Migration filenames must form a contiguous numeric sequence.");
    const source = await readFile(join(directory, filename), "utf8");
    const normalized = source.replace(/\r\n/g, "\n");
    const checksum = createHash("sha256").update(normalized).digest("hex");
    if (i < 5 && checksum !== legacyHashes[i]) throw new MigrationError("An immutable Phase 01 migration changed.");
    const wrapper = /^BEGIN;\s*\n([\s\S]*)\nCOMMIT;\s*$/.exec(normalized);
    if (!wrapper) throw new MigrationError("Migrations must have one BEGIN/COMMIT wrapper.");
    const body = wrapper[1];
    // Ignore comments/quoted values when rejecting additional transaction commands.
    // Dollar-quoted routines are deliberately outside this minimal DDL runner's scope.
    const scrubbed = body.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"/g, " ");
    if (/\$[a-zA-Z_0-9]*\$/.test(scrubbed) || scrubbed.split(";").some((statement) =>
      /^\s*(BEGIN|COMMIT|ROLLBACK|ABORT|END|SAVEPOINT|RELEASE|START\s+TRANSACTION|PREPARE\s+TRANSACTION)\b/i.test(statement))) {
      throw new MigrationError("Nested transaction control or dollar-quoted migration routines are unsupported.");
    }
    return { version, filename, checksum, body };
  }));
}

async function ledger(client: PoolClient): Promise<{ rows: Applied[]; checksums: boolean }> {
  const exists = (await client.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present")).rows[0].present;
  if (!exists) {
    const tables = await client.query("SELECT 1 FROM pg_tables WHERE schemaname = 'public' LIMIT 1");
    if (tables.rowCount) throw new MigrationError("A nonempty database without the migration ledger cannot be adopted.");
    return { rows: [], checksums: false };
  }
  const checksums = (await client.query(`SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'schema_migrations' AND column_name = 'checksum_sha256'`)).rowCount === 1;
  const rows = (await client.query<Applied>(checksums
    ? "SELECT version, filename, checksum_sha256 FROM public.schema_migrations ORDER BY version"
    : "SELECT version, filename, NULL::TEXT AS checksum_sha256 FROM public.schema_migrations ORDER BY version")).rows;
  if (!rows.length) throw new MigrationError("Existing migration ledger is empty and inconsistent.");
  return { rows, checksums };
}

function validateLedger(applied: Applied[], files: Migration[], checksums: boolean): void {
  for (const [i, row] of applied.entries()) {
    const file = files[i];
    if (!file || row.version !== file.version || row.filename !== file.filename) throw new MigrationError("Migration history is missing, reordered, or inconsistent.");
    if (checksums && row.checksum_sha256 !== file.checksum) throw new MigrationError("An applied migration checksum changed or is missing.");
  }
}

export async function runMigrations(url: string | undefined, options: { adoptExisting?: boolean; directory?: string } = {}): Promise<string[]> {
  const config = localDatabaseConfig(url);
  const files = await migrations(options.directory ?? defaultDirectory);
  const pool = new pg.Pool(config);
  let client: PoolClient | undefined;
  let locked = false;
  try {
    client = await pool.connect();
    locked = (await client.query("SELECT pg_try_advisory_lock($1, $2) AS locked", [...MIGRATION_LOCK])).rows[0].locked;
    if (!locked) throw new MigrationError("Another migration runner holds the database lock.");
    const before = await ledger(client);
    validateLedger(before.rows, files, before.checksums);
    if (before.rows.length && !before.checksums && (!options.adoptExisting || before.rows.length > 5)) {
      throw new MigrationError("Checksum-free Phase 01 history requires explicit --adopt-existing after verifying the approved baseline.");
    }
    const applied: string[] = [];
    for (const file of files.slice(before.rows.length)) {
      await client.query("BEGIN");
      try {
        await client.query(file.body);
        const current = await ledger(client);
        const expectedLength = Number(file.version);
        if (current.rows.length !== expectedLength) throw new MigrationError("Migration did not record exactly one expected ledger entry.");
        if (current.checksums) {
          const prior = current.rows.slice(0, -1);
          validateLedger(prior, files, true);
          await client.query("UPDATE public.schema_migrations SET checksum_sha256 = $1 WHERE version = $2 AND filename = $3",
            [file.checksum, file.version, file.filename]);
        }
        const stamped = await ledger(client);
        validateLedger(stamped.rows, files, stamped.checksums);
        await client.query("COMMIT");
        applied.push(file.filename);
      } catch (error) {
        await client.query("ROLLBACK");
        if (error instanceof MigrationError) throw error;
        throw new MigrationError(`Migration ${file.version} failed and was rolled back.`);
      }
    }
    return applied;
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    throw new MigrationError("Migration connection or history inspection failed.");
  } finally {
    try {
      if (client) {
        try { if (locked) await client.query("SELECT pg_advisory_unlock($1, $2)", [...MIGRATION_LOCK]); }
        finally { client.release(true); }
      }
    } finally { await pool.end(); }
  }
}

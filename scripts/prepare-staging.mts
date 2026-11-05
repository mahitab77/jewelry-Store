// Offline preparation only. This module has no cloud, database or process APIs.
import { createHash } from 'node:crypto';
import { open, readFile, realpath, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = join(root, 'infra/cloud-run');
const coreSecrets = ['DATABASE_URL', 'ADMIN_DATABASE_URL', 'CART_DATABASE_URL', 'BETTER_AUTH_SECRET'];
const mediaSecrets = ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
type Input = { projectId: string; projectNumber: string; region: string; service: string; runtimeServiceAccount: string; image: string; origin: string; secrets: Record<string, { name: string; version: string }>; cloudinaryCloudName?: string };
function requireValue(condition: unknown): asserts condition { if (!condition) throw new Error('Invalid staging inputs or migration integrity. Review the documented non-secret input format.'); }

export async function stagingManifest(value: unknown) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value));
  const input = value as Input;
  requireValue(Object.keys(input).every(k => ['projectId','projectNumber','region','service','runtimeServiceAccount','image','origin','secrets','cloudinaryCloudName'].includes(k)));
  requireValue(typeof input.projectId === 'string' && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(input.projectId));
  requireValue(typeof input.projectNumber === 'string' && /^[1-9][0-9]{5,19}$/.test(input.projectNumber));
  requireValue(typeof input.region === 'string' && /^[a-z]+(?:-[a-z]+)+[1-9][0-9]*$/.test(input.region));
  requireValue(typeof input.service === 'string' && /^lapalme-staging(?:-[a-z0-9]+)*$/.test(input.service) && input.service.length <= 49);
  requireValue(typeof input.runtimeServiceAccount === 'string');
  requireValue(input.runtimeServiceAccount.split('@').length === 2);
  const [account, domain] = input.runtimeServiceAccount.split('@');
  requireValue(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(account ?? '') && domain === input.projectId + '.iam.gserviceaccount.com' && !input.runtimeServiceAccount.startsWith('default@'));
  const imagePrefix = `${input.region}-docker.pkg.dev/${input.projectId}/lapalme-staging/web@sha256:`;
  requireValue(typeof input.image === 'string' && input.image.startsWith(imagePrefix) && /^[a-f0-9]{64}$/.test(input.image.slice(imagePrefix.length)));
  requireValue(typeof input.origin === 'string');
  requireValue(input.secrets && typeof input.secrets === 'object' && !Array.isArray(input.secrets));
  const secretKeys = Object.keys(input.secrets);
  const media = Boolean(input.cloudinaryCloudName);
  if (input.origin) {
    const url = new URL(input.origin);
    requireValue(url.origin === input.origin && url.protocol === 'https:' && !url.port && !url.username && !url.password && /^[a-z0-9.-]+\.run\.app$/.test(url.hostname));
    const expected = [...coreSecrets, ...(media ? mediaSecrets : [])];
    requireValue(expected.every(k => secretKeys.includes(k)) && secretKeys.length === expected.length);
    if (media) requireValue(typeof input.cloudinaryCloudName === 'string' && /^[a-z0-9][a-z0-9_-]{1,60}$/.test(input.cloudinaryCloudName));
  } else requireValue(secretKeys.length === 0 && !media);
  for (const ref of Object.values(input.secrets)) {
    requireValue(ref && typeof ref === 'object' && Object.keys(ref).length === 2 && typeof ref.name === 'string' && /^lapalme-staging-[a-z0-9-]+$/.test(ref.name) && typeof ref.version === 'string' && /^[1-9][0-9]*$/.test(ref.version));
  }
  const manifest = JSON.parse(await readFile(join(directory, 'staging.template.json'), 'utf8'));
  manifest.metadata.name = input.service;
  manifest.metadata.namespace = input.projectNumber;
  manifest.metadata.labels['cloud.googleapis.com/location'] = input.region;
  const spec = manifest.spec.template.spec;
  spec.serviceAccountName = input.runtimeServiceAccount;
  spec.containers[0].image = input.image;
  const env = spec.containers[0].env;
  for (const name of ['SITE_URL','BETTER_AUTH_URL','CART_ORIGIN']) env.push({ name, value: input.origin });
  if (media) env.push({ name: 'CLOUDINARY_CLOUD_NAME', value: input.cloudinaryCloudName });
  for (const [name, ref] of Object.entries(input.secrets)) env.push({ name, valueFrom: { secretKeyRef: { name: ref.name, key: ref.version } } });
  return manifest;
}

type Migration = { version: string; filename: string; sha256: string };
function checkedSql(expression: string, name: string) {
  // ON_ERROR_STOP exits nonzero and rolls back the current transaction. psql 17
  // does not support an exit-status argument to \quit.
  return `SELECT (${expression}) AS ${name} \\gset\n\\if :${name}\n\\else\n\\echo 'Staging migration precondition failed; stop and inspect.'\nSELECT 1 / 0;\n\\endif\n`;
}
export async function stagingMigrationReview() {
  const pinned: Migration[] = JSON.parse(await readFile(join(directory, 'migrations.sha256.json'), 'utf8'));
  const names = (await readdir(join(root, 'db/migrations'))).filter(n => n.endsWith('.sql')).sort();
  requireValue(pinned.length === 13 && names.length === 13);
  const sources: string[] = [];
  for (const [i, file] of pinned.entries()) {
    requireValue(file.version === String(i + 1).padStart(4, '0') && file.filename === names[i] && new RegExp(`^${file.version}_[a-z0-9_]+\\.sql$`).test(file.filename) && /^[a-f0-9]{64}$/.test(file.sha256));
    const source = (await readFile(join(root, 'db/migrations', file.filename), 'utf8')).replace(/\r\n/g, '\n');
    requireValue(createHash('sha256').update(source).digest('hex') === file.sha256);
    const body = /^BEGIN;\s*\n([\s\S]*)\nCOMMIT;\s*$/.exec(source)?.[1];
    requireValue(body && !/^\s*\\/m.test(body));
    sources.push(body);
  }
  let sql = '-- OFFLINE REVIEW ARTIFACT. Execute only after separate exact-target authorization.\n';
  sql += '-- Fresh, empty staging database only; no automatic adoption, reset or resume.\n';
  sql += '-- psql -X with ON_ERROR_STOP and protected libpq environment; hosted TLS verify-full.\n';
  sql += '\\set ON_ERROR_STOP on\n';
  sql += checkedSql("current_database() = :'expected_database' AND current_user = :'expected_user' AND current_setting('server_version_num')::int / 10000 IN (17,18)", 'target_ok');
  sql += checkedSql('pg_try_advisory_lock(1279348813, 2)', 'lock_ok');
  sql += checkedSql("NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('public','information_schema')) AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')", 'empty_ok');
  for (const [i, file] of pinned.entries()) {
    sql += `\n-- ${file.filename}; normalized SHA-256 ${file.sha256}\nBEGIN;\n${sources[i]}\n`;
    if (i >= 5) sql += `UPDATE public.schema_migrations SET checksum_sha256='${file.sha256}' WHERE version='${file.version}' AND filename='${file.filename}';\n`;
    const expected = pinned.slice(0, i + 1).map(f => `('${f.version}','${f.filename}'${i >= 5 ? `,'${f.sha256}'` : ''})`).join(',');
    const columns = 'version,filename' + (i >= 5 ? ',checksum_sha256' : '');
    sql += checkedSql(`(SELECT count(*) FROM public.schema_migrations) = ${i + 1} AND NOT EXISTS ((SELECT ${columns} FROM public.schema_migrations) EXCEPT (VALUES ${expected}))`, 'ledger_ok');
    sql += 'COMMIT;\n';
  }
  return sql + '\nSELECT pg_advisory_unlock(1279348813,2);\n';
}

async function main() {
  const [command, input, output, ...extra] = process.argv.slice(2);
  requireValue(!extra.length && ['service','migrations'].includes(command) && input && (command === 'service' ? output : !output));
  const destination = command === 'service' ? output : input;
  requireValue(isAbsolute(destination));
  const target = join(await realpath(dirname(destination)), destination.split(/[\\/]/).at(-1)!);
  const rel = relative(await realpath(root), target);
  requireValue(rel.startsWith('..' + sep) || isAbsolute(rel));
  const content = command === 'service' ? JSON.stringify(await stagingManifest(JSON.parse(await readFile(input, 'utf8'))), null, 2) + '\n' : await stagingMigrationReview();
  const handle = await open(target, 'wx', 0o600);
  try { await handle.writeFile(content); } finally { await handle.close(); }
  console.log('Offline staging review artifact written; nothing was deployed or connected.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch { console.error('Staging preparation refused invalid inputs, an unsafe/existing output path, or changed migration files. No cloud/database operation is supported.'); process.exitCode = 1; }
}

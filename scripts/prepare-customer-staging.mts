// Offline only: generates review SQL from the unchanged approved migration/grants.
// This module has no database, cloud, credential generation or deployment client.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
type Pin={version:string;filename:string;sha256:string};
const target='green-glitter-95493455/br-rough-term-b9hae0t4/ep-wispy-feather-b95dea30/la_palme_dor_staging';
const authTables='customer_auth_users,customer_auth_sessions,customer_auth_accounts,customer_auth_verifications,customer_auth_rate_limits';
const normalize=(source:string)=>source.replace(/\r\n/g,'\n');

function guard(pins:Pin[],action:string) {
 const values=pins.map(p=>`('${p.version}','${p.filename}','${p.sha256}')`).join(',\n');
 return `-- REVIEW ONLY. Separate exact-target operator approval required. Not executed by preparation.
-- psql -X; protected libpq environment; never put credentials in argv or this file.
\\set ON_ERROR_STOP on
\\set ECHO none
\\if :{?local_rehearsal}
\\else
\\set local_rehearsal false
\\endif
\\set configured_host ''
\\set configured_ssl ''
\\set configured_binding ''
\\set configured_hostaddr ''
\\set configured_service ''
\\set target_approval ''
\\getenv configured_host PGHOST
\\getenv configured_ssl PGSSLMODE
\\getenv configured_binding PGCHANNELBINDING
\\getenv configured_hostaddr PGHOSTADDR
\\getenv configured_service PGSERVICE
\\getenv target_approval CUSTOMER_STAGING_TARGET_APPROVED
SELECT :'configured_hostaddr'='' AND :'configured_service'='' AND CASE WHEN :'local_rehearsal'::boolean THEN :'configured_host'='127.0.0.1'
 ELSE :'configured_host'='ep-wispy-feather-b95dea30.c-7.eu-central-1.aws.neon.tech'
 AND :'configured_ssl'='verify-full' AND :'configured_binding'='require'
 AND :'target_approval'='${target}/${action}' END AS connection_ok \\gset
\\if :connection_ok
\\else
\\echo 'STOP: exact target, verified TLS/channel binding and operation approval required.'
SELECT 1/0;
\\endif
BEGIN;
SET LOCAL search_path=public,pg_catalog;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='5s';
SELECT set_config('la_palme.customer_local_rehearsal',:'local_rehearsal',true);
DO $guard$
BEGIN
 IF current_setting('server_version_num')<>'180006' THEN RAISE EXCEPTION 'STOP: PostgreSQL 18.6 required'; END IF;
 IF current_setting('la_palme.customer_local_rehearsal')::boolean THEN
  IF current_database() !~ '^lapalme_test_admin_[a-f0-9]{32}$' OR current_user<>'postgres'
   OR session_user<>'postgres' OR inet_server_addr() IS DISTINCT FROM inet '127.0.0.1'
   THEN RAISE EXCEPTION 'STOP: disposable loopback operator fixture required'; END IF;
 ELSE
  IF current_database()<>'la_palme_dor_staging' OR current_user<>'neondb_owner' OR session_user<>'neondb_owner'
   OR current_setting('neon.project_id',true) IS DISTINCT FROM 'green-glitter-95493455'
   OR current_setting('neon.branch_id',true) IS DISTINCT FROM 'br-rough-term-b9hae0t4'
   OR NOT EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
   THEN RAISE EXCEPTION 'STOP: staging project/branch/database/operator/TLS mismatch'; END IF;
 END IF;
 IF NOT pg_try_advisory_xact_lock(1279348813,2) THEN RAISE EXCEPTION 'STOP: migration lock busy'; END IF;
 IF NOT pg_try_advisory_xact_lock(1279348813,8) THEN RAISE EXCEPTION 'STOP: customer preparation lock busy'; END IF;
 IF (SELECT count(*) FROM public.schema_migrations)<>${pins.length} OR EXISTS(
  SELECT FROM (VALUES ${values}) expected(version,filename,checksum)
  LEFT JOIN public.schema_migrations actual USING(version)
  WHERE actual.filename IS DISTINCT FROM expected.filename OR actual.checksum_sha256 IS DISTINCT FROM expected.checksum)
  THEN RAISE EXCEPTION 'STOP: exact migration ledger/checksums required'; END IF;
END;
$guard$;
`;
}

export async function customerStagingReviews() {
 const pins:Pin[]=JSON.parse(await readFile(join(root,'infra/cloud-run/migrations.sha256.json'),'utf8'));
 if(pins.length!==14)throw Error('Expected approved fourteen-migration manifest.');
 const sources=await Promise.all(pins.map(async(p,i)=>{
  const source=normalize(await readFile(join(root,'db/migrations',p.filename),'utf8'));
  if(p.version!==String(i+1).padStart(4,'0')||createHash('sha256').update(source).digest('hex')!==p.sha256)throw Error('Migration integrity mismatch.');
  return source;
 }));
 if(pins[13].sha256!=='52d69366fdcebafb552611c0c146a12f859798d8b7940db37926286b7d984c07')throw Error('Unapproved migration 0014.');
 const migrationBody=/^BEGIN;\s*\n([\s\S]*)\nCOMMIT;\s*$/.exec(sources[13])?.[1];
 if(!migrationBody)throw Error('Migration wrapper mismatch.');
 const original=normalize(await readFile(join(root,'infra/neon/customer-runtime-grants.review.sql'),'utf8'));
 if(createHash('sha256').update(original).digest('hex')!=='4d8c5716c2b445d308dd57ba8b686d67af4c2f46b7c0fbfef6a4f3e7ba39721d')throw Error('Unapproved customer permission contract.');
 const grants=/\nBEGIN;\n([\s\S]*)\nROLLBACK;\s*$/.exec(original)?.[1];
 if(!grants)throw Error('Review-only grant wrapper mismatch.');
 const migration=guard(pins.slice(0,13),'migration-0014')+`-- Exact approved 0014 body, without its transaction wrapper. One transaction includes its checksum.
${migrationBody}
UPDATE public.schema_migrations SET checksum_sha256='${pins[13].sha256}' WHERE version='0014' AND filename='${pins[13].filename}';
DO $$ BEGIN IF (SELECT count(*) FROM public.schema_migrations)<>14 OR
 (SELECT checksum_sha256 FROM public.schema_migrations WHERE version='0014') IS DISTINCT FROM '${pins[13].sha256}'
 THEN RAISE EXCEPTION 'STOP: migration postcondition failed'; END IF; END $$;
COMMIT;
`;
 const role=guard(pins,'customer-role')+`DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='lapalme_staging_customer') THEN RAISE EXCEPTION 'STOP: customer role already exists; do not overwrite'; END IF;
END $$;
\\getenv customer_password CUSTOMER_STAGING_DATABASE_PASSWORD
\\if :{?customer_password}
\\else
\\echo 'STOP: protected credential input required.'
SELECT 1/0;
\\endif
SELECT :'customer_password' ~ '^[A-Za-z0-9_-]{43,128}$' AS credential_ok \\gset
\\if :credential_ok
\\else
\\echo 'STOP: approved independent random credential required.'
SELECT 1/0;
\\endif
CREATE ROLE lapalme_staging_customer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD :'customer_password';
\\unset customer_password
SELECT format('GRANT CONNECT ON DATABASE %I TO lapalme_staging_customer',current_database()) \\gexec
ALTER ROLE lapalme_staging_customer SET statement_timeout='8s';
ALTER ROLE lapalme_staging_customer SET idle_in_transaction_session_timeout='10s';
ALTER ROLE lapalme_staging_customer SET lock_timeout='5s';
${grants.replaceAll('lapalme_customer_runtime','lapalme_staging_customer')}
DO $$ BEGIN
 IF has_schema_privilege('lapalme_staging_customer','public','CREATE') OR has_database_privilege('lapalme_staging_customer',current_database(),'CREATE')
 OR EXISTS(SELECT FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='lapalme_staging_customer'))
 OR has_table_privilege('lapalme_staging_customer','admin_users','SELECT')
 OR has_table_privilege('lapalme_staging_customer','payments','UPDATE')
 OR has_table_privilege('lapalme_staging_customer','inventory','UPDATE')
 OR has_table_privilege('lapalme_staging_customer','schema_migrations','SELECT')
 THEN RAISE EXCEPTION 'STOP: customer role exceeds approved contract'; END IF;
END $$;
COMMIT;
`;
 const backup=guard(pins,'backup-grants')+`DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='lapalme_staging_backup' AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls AND NOT rolinherit)
 THEN RAISE EXCEPTION 'STOP: existing restricted backup identity required'; END IF;
END $$;
-- Only explicit new auth tables. No default privileges, role settings or credentials change.
GRANT SELECT ON ${authTables} TO lapalme_staging_backup;
COMMIT;
`;
 return {migration,role,backup};
}

-- REVIEW ONLY. Separate exact-target operator approval required. Not executed by preparation.
-- psql -X; protected libpq environment; never put credentials in argv or this file.
\set ON_ERROR_STOP on
\set ECHO none
\if :{?local_rehearsal}
\else
\set local_rehearsal false
\endif
\set configured_host ''
\set configured_ssl ''
\set configured_binding ''
\set configured_hostaddr ''
\set configured_service ''
\set target_approval ''
\getenv configured_host PGHOST
\getenv configured_ssl PGSSLMODE
\getenv configured_binding PGCHANNELBINDING
\getenv configured_hostaddr PGHOSTADDR
\getenv configured_service PGSERVICE
\getenv target_approval CUSTOMER_STAGING_TARGET_APPROVED
SELECT :'configured_hostaddr'='' AND :'configured_service'='' AND CASE WHEN :'local_rehearsal'::boolean THEN :'configured_host'='127.0.0.1'
 ELSE :'configured_host'='ep-wispy-feather-b95dea30.c-7.eu-central-1.aws.neon.tech'
 AND :'configured_ssl'='verify-full' AND :'configured_binding'='require'
 AND :'target_approval'='green-glitter-95493455/br-rough-term-b9hae0t4/ep-wispy-feather-b95dea30/la_palme_dor_staging/backup-grants' END AS connection_ok \gset
\if :connection_ok
\else
\echo 'STOP: exact target, verified TLS/channel binding and operation approval required.'
SELECT 1/0;
\endif
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
 IF (SELECT count(*) FROM public.schema_migrations)<>14 OR EXISTS(
  SELECT FROM (VALUES ('0001','0001_catalogue.sql','0026abfbc0657627c6d783970bbdbe84ad721f663311690f66e0828140ea47eb'),
('0002','0002_customers_admin_carts.sql','3d2baf373e7f23d981a86839d16605bc95dd3969ef240d3f7d9bae36da17a369'),
('0003','0003_orders_payments.sql','3eaa0df9e93931b16adc4adb6669f7cf7c2b1e300bc5973cedae72a3f6183757'),
('0004','0004_inventory.sql','7906ea7c14ca02b546cd39cf4ef7bd1f944c51d85cba16217fdedd2876cb894f'),
('0005','0005_fulfillment_requests_audit.sql','269dd9f4b3dd8493b7dff60ff7e3813809253abd1f31e24ea3fceea2328554b6'),
('0006','0006_migration_checksums.sql','898fdb94614a1ca35899dae6e28af7ea932eedf4400ae0fc3ddb139fc36beba5'),
('0007','0007_admin_authentication.sql','d425096c1607496ac6d8d2a7f8e33a80decbf77ffa77efcfb1950e294ce20bae'),
('0008','0008_catalogue_media.sql','fd1f762717f49250907a464c8432f7d83cc5b86199a515be9fb18738d6ea2204'),
('0009','0009_guest_cart.sql','187fd75b1d5bc82aeceaaec0cfcb72fa0faad51a38e878e5ec1ef297079716ae'),
('0010','0010_checkout_drafts.sql','650c0d2f1398fd1754ca443d1f6862b7c0e0c7e34dda07917ed941c860ac238a'),
('0011','0011_test_payment_lifecycle.sql','c181c82bf8162215059ec972990e97ff2eb18ec8dfc55d089bd0734832ac51f2'),
('0012','0012_order_fulfillment_administration.sql','58f305376b4fef84467fd0f409a73b0189a950af94278f1fbb46bf78d23cfda5'),
('0013','0013_quotation_requests_specifications.sql','303dc46ec1bd1e432b3f64fe8a0265e09a088a2ef3d1a1b2ffa5555c4fb90a10'),
('0014','0014_customer_authentication.sql','52d69366fdcebafb552611c0c146a12f859798d8b7940db37926286b7d984c07')) expected(version,filename,checksum)
  LEFT JOIN public.schema_migrations actual USING(version)
  WHERE actual.filename IS DISTINCT FROM expected.filename OR actual.checksum_sha256 IS DISTINCT FROM expected.checksum)
  THEN RAISE EXCEPTION 'STOP: exact migration ledger/checksums required'; END IF;
END;
$guard$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='lapalme_staging_backup' AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls AND NOT rolinherit)
 THEN RAISE EXCEPTION 'STOP: existing restricted backup identity required'; END IF;
END $$;
-- Only explicit new auth tables. No default privileges, role settings or credentials change.
GRANT SELECT ON customer_auth_users,customer_auth_sessions,customer_auth_accounts,customer_auth_verifications,customer_auth_rate_limits TO lapalme_staging_backup;
COMMIT;

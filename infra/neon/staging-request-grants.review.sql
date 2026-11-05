-- REVIEW ONLY. Separate operator approval is required after migration 0013.
-- This artifact changes grants only on the three existing request tables.
-- Never rerun role creation or old reviewed grant artifacts to apply this file.
\set ON_ERROR_STOP on
\set ECHO none
\if :{?local_rehearsal}
\else
\set local_rehearsal false
\endif
\set configured_host ''
\set configured_ssl ''
\set configured_binding ''
\getenv configured_host PGHOST
\getenv configured_ssl PGSSLMODE
\getenv configured_binding PGCHANNELBINDING
SELECT CASE WHEN :'local_rehearsal'::BOOLEAN THEN :'configured_host'='127.0.0.1'
  ELSE :'configured_host'='ep-wispy-feather-b95dea30.c-7.eu-central-1.aws.neon.tech'
    AND :'configured_ssl'='verify-full' AND :'configured_binding'='require' END AS connection_policy_ok \gset
\if :connection_policy_ok
\else
\echo 'STOP: verified direct staging endpoint, TLS and channel binding required.'
DO $$ BEGIN RAISE EXCEPTION 'Connection policy guard failed'; END $$;
\endif
BEGIN;
SET LOCAL search_path=public,pg_catalog;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='5s';
SELECT set_config('la_palme.local_rehearsal', :'local_rehearsal', true);
DO $guard$
DECLARE table_name TEXT;
BEGIN
  IF current_setting('server_version_num')<>'180006' THEN RAISE EXCEPTION 'STOP: PostgreSQL 18.6 required'; END IF;
  IF current_setting('la_palme.local_rehearsal')::BOOLEAN THEN
    IF current_database() !~ '^lapalme_test_admin_[a-f0-9]{32}$' OR current_user<>'postgres' OR session_user<>'postgres' OR inet_server_addr()<>inet '127.0.0.1' THEN
      RAISE EXCEPTION 'STOP: explicit disposable loopback rehearsal required';
    END IF;
  ELSIF current_database()<>'la_palme_dor_staging' OR current_user<>'neondb_owner' OR session_user<>'neondb_owner'
     OR current_setting('neon.project_id',true) IS DISTINCT FROM 'green-glitter-95493455'
     OR current_setting('neon.branch_id',true) IS DISTINCT FROM 'br-rough-term-b9hae0t4'
     OR NOT EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) THEN
    RAISE EXCEPTION 'STOP: exact verified staging database, branch, operator and TLS required';
  END IF;
  IF NOT pg_try_advisory_xact_lock(1279348813,7) THEN RAISE EXCEPTION 'STOP: another staging privilege operation is active'; END IF;
  IF (SELECT count(*) FROM schema_migrations)<>13 OR EXISTS (
    SELECT FROM (VALUES
      ('0001','0001_catalogue.sql','0026abfbc0657627c6d783970bbdbe84ad721f663311690f66e0828140ea47eb'),
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
      ('0013','0013_quotation_requests_specifications.sql','303dc46ec1bd1e432b3f64fe8a0265e09a088a2ef3d1a1b2ffa5555c4fb90a10')
    ) expected(version,filename,checksum)
    LEFT JOIN schema_migrations actual USING(version)
    WHERE actual.filename IS DISTINCT FROM expected.filename OR actual.checksum_sha256 IS DISTINCT FROM expected.checksum
  ) THEN RAISE EXCEPTION 'STOP: exact thirteen-migration ledger/checksums required'; END IF;
  IF NOT EXISTS(SELECT FROM pg_roles r WHERE rolname='lapalme_staging_app' AND rolcanlogin
    AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolinherit AND NOT rolreplication AND NOT rolbypassrls
    AND NOT EXISTS(SELECT FROM pg_auth_members WHERE member=r.oid))
    OR has_schema_privilege('lapalme_staging_app','public','CREATE')
    OR has_table_privilege('lapalme_staging_app','schema_migrations','SELECT') THEN
    RAISE EXCEPTION 'STOP: existing restricted application identity required';
  END IF;
  FOREACH table_name IN ARRAY ARRAY['product_enquiries','bespoke_requests','appointment_requests'] LOOP
    IF has_table_privilege('lapalme_staging_app',table_name,'SELECT')
      OR has_any_column_privilege('lapalme_staging_app',table_name,'INSERT')
      OR has_any_column_privilege('lapalme_staging_app',table_name,'UPDATE')
      OR has_table_privilege('lapalme_staging_app',table_name,'DELETE') THEN
      RAISE EXCEPTION 'STOP: unexpected prior request privileges; inspect rather than repeat';
    END IF;
  END LOOP;
END;
$guard$;

GRANT SELECT ON product_enquiries,bespoke_requests,appointment_requests TO lapalme_staging_app;
GRANT INSERT(id,product_id,variant_id,contact_name,contact_email,contact_phone,message,product_context)
  ON product_enquiries,bespoke_requests TO lapalme_staging_app;
GRANT INSERT(id,product_id,variant_id,contact_name,contact_email,contact_phone,message,product_context,consultation_channel,preferred_start_at)
  ON appointment_requests TO lapalme_staging_app;
GRANT UPDATE(status,assigned_admin_id,updated_at) ON product_enquiries,bespoke_requests TO lapalme_staging_app;
GRANT UPDATE(status,assigned_admin_id,updated_at,confirmed_start_at,boutique_location_id) ON appointment_requests TO lapalme_staging_app;

DO $verify$
DECLARE table_name TEXT; column_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['product_enquiries','bespoke_requests','appointment_requests'] LOOP
    IF NOT has_table_privilege('lapalme_staging_app',table_name,'SELECT')
      OR has_table_privilege('lapalme_staging_app',table_name,'DELETE')
      OR has_column_privilege('lapalme_staging_app',table_name,'status','INSERT')
      OR has_column_privilege('lapalme_staging_app',table_name,'customer_profile_id','INSERT') THEN
      RAISE EXCEPTION 'STOP: request grant exclusions failed';
    END IF;
    FOREACH column_name IN ARRAY ARRAY['id','product_id','variant_id','contact_name','contact_email','contact_phone','message','product_context','created_at','customer_profile_id'] LOOP
      IF has_column_privilege('lapalme_staging_app',table_name,column_name,'UPDATE') THEN RAISE EXCEPTION 'STOP: immutable submitted fields must remain protected'; END IF;
    END LOOP;
  END LOOP;
  IF has_column_privilege('lapalme_staging_app','appointment_requests','preferred_start_at','UPDATE')
    OR has_column_privilege('lapalme_staging_app','appointment_requests','consultation_channel','UPDATE')
    OR has_table_privilege('lapalme_staging_app','schema_migrations','SELECT') THEN RAISE EXCEPTION 'STOP: request immutability/history exclusions failed'; END IF;
END;
$verify$;
COMMIT;

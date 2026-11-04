-- REVIEW ONLY: separate operator approval is required before hosted execution.
-- Exact staging target; no schema/history/role creation and no data writes.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
DO $guard$
BEGIN
  IF current_database() <> 'la_palme_dor_staging'
     OR current_user <> 'neondb_owner' OR session_user <> 'neondb_owner'
     OR current_setting('server_version_num') <> '180006'
     OR current_setting('neon.project_id', true) IS DISTINCT FROM 'green-glitter-95493455'
     OR current_setting('neon.branch_id', true) IS DISTINCT FROM 'br-rough-term-b9hae0t4' THEN
    RAISE EXCEPTION 'STOP: exact approved Neon staging target/operator identity required';
  END IF;
  IF NOT pg_try_advisory_xact_lock(1279348813,7) THEN
    RAISE EXCEPTION 'STOP: another staging role operation is active';
  END IF;
  IF (SELECT count(*) FROM schema_migrations) <> 12 OR EXISTS (
    SELECT 1 FROM (VALUES
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
        ('0012','0012_order_fulfillment_administration.sql','58f305376b4fef84467fd0f409a73b0189a950af94278f1fbb46bf78d23cfda5')
    ) AS expected(version,filename,checksum)
    LEFT JOIN schema_migrations actual USING(version)
    WHERE actual.filename IS DISTINCT FROM expected.filename
       OR actual.checksum_sha256 IS DISTINCT FROM expected.checksum
  ) THEN RAISE EXCEPTION 'STOP: migration history/checksums differ'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles r WHERE rolname='lapalme_staging_app'
      AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolinherit AND NOT rolreplication AND NOT rolbypassrls
      AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)
  ) THEN RAISE EXCEPTION 'STOP: restricted existing application role required'; END IF;
  IF has_schema_privilege('lapalme_staging_app','public','CREATE')
     OR has_table_privilege('lapalme_staging_app','schema_migrations','SELECT')
     OR has_table_privilege('lapalme_staging_app','categories','DELETE')
     OR has_table_privilege('lapalme_staging_app','collections','DELETE')
     OR has_any_column_privilege('lapalme_staging_app','categories','INSERT')
     OR has_any_column_privilege('lapalme_staging_app','categories','UPDATE')
     OR has_any_column_privilege('lapalme_staging_app','collections','INSERT')
     OR has_any_column_privilege('lapalme_staging_app','collections','UPDATE') THEN
    RAISE EXCEPTION 'STOP: unexpected existing privileges; inspect rather than repeat or repair';
  END IF;
END;
$guard$;

GRANT INSERT(id,name,slug,description,parent_id,display_order,is_visible) ON public.categories TO lapalme_staging_app;
GRANT UPDATE(name,slug,description,parent_id,display_order,is_visible,updated_at) ON public.categories TO lapalme_staging_app;
GRANT INSERT(id,name,slug,description,display_order,status,published_at) ON public.collections TO lapalme_staging_app;
GRANT UPDATE(name,slug,description,display_order,status,published_at,updated_at) ON public.collections TO lapalme_staging_app;

DO $verify$
BEGIN
  IF has_table_privilege('lapalme_staging_app','categories','DELETE')
     OR has_table_privilege('lapalme_staging_app','collections','DELETE')
     OR has_column_privilege('lapalme_staging_app','categories','id','UPDATE')
     OR has_column_privilege('lapalme_staging_app','collections','id','UPDATE')
     OR has_column_privilege('lapalme_staging_app','categories','created_at','UPDATE')
     OR has_column_privilege('lapalme_staging_app','collections','created_at','UPDATE')
     OR has_column_privilege('lapalme_staging_app','categories','created_at','INSERT')
     OR has_column_privilege('lapalme_staging_app','collections','created_at','INSERT')
     OR has_table_privilege('lapalme_staging_app','schema_migrations','SELECT') THEN
    RAISE EXCEPTION 'STOP: taxonomy privilege exclusions failed';
  END IF;
END;
$verify$;
COMMIT;


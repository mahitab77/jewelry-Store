-- Phase 11F simplification REVIEW ONLY: separate operator approval is mandatory.
-- Target: green-glitter-95493455 / staging br-rough-term-b9hae0t4 /
-- ep-wispy-feather-b95dea30 / la_palme_dor_staging / PostgreSQL 18.6.
-- Creates only lapalme_staging_app. Never rerun the six-role provisioning artifact.
-- The existing six identities, their grants and encrypted credentials stay unchanged.
-- After approval use a pinned, reviewed libpq 18 launcher, trusted certificate roots,
-- PGSSLMODE=verify-full, PGCHANNELBINDING=require and the exact direct hostname.
-- Scrub inherited libpq routing overrides and verify the Console endpoint mapping.
-- Generate a separate random 32-byte base64url password in protected process memory;
-- retain and verify encrypted operator custody before execution. Set only
-- PHASE11F_APP_PASSWORD and PHASE11F_TARGET_APPROVED through that protected launcher.
-- Never put passwords/URLs in argv, files, psql echo output or shell history.
-- Execute using psql -X --no-password --set=ON_ERROR_STOP=1 --file=THIS_FILE.
-- PUBLIC CONNECT/TEMP defaults are unchanged. No ownership, memberships, grant
-- options, default privileges, backup access, or sequence grants are introduced.
\set ON_ERROR_STOP on
\set ECHO none
\set VERBOSITY terse
\set SHOW_CONTEXT never
\if :{?local_rehearsal}
\else
\set local_rehearsal false
\endif
\set approved ''
\set configured_host ''
\set configured_ssl ''
\set configured_binding ''
\getenv approved PHASE11F_TARGET_APPROVED
\getenv configured_host PGHOST
\getenv configured_ssl PGSSLMODE
\getenv configured_binding PGCHANNELBINDING
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
SET LOCAL search_path=pg_catalog,public;
SELECT CASE WHEN :'local_rehearsal'::boolean THEN
  current_database() ~ '^lapalme_test_admin_[a-f0-9]{32}$'
  AND session_user='postgres' AND inet_server_addr()=inet '127.0.0.1'
  AND :'configured_host'='127.0.0.1'
ELSE current_database()='la_palme_dor_staging' AND session_user='neondb_owner'
  AND :'configured_host'='ep-wispy-feather-b95dea30.c-7.eu-central-1.aws.neon.tech'
  AND :'configured_ssl'='verify-full' AND :'configured_binding'='require'
  AND :'approved'='green-glitter-95493455/br-rough-term-b9hae0t4/ep-wispy-feather-b95dea30/la_palme_dor_staging/lapalme_staging_app'
END AND current_setting('server_version_num')='180006'
  AND NOT pg_is_in_recovery() AND current_setting('transaction_read_only')='off'
  AS target_ok \gset
\if :target_ok
\else
\echo 'STOP: target, approval, version or connection policy guard failed.'
DO $$ BEGIN RAISE EXCEPTION 'Phase 11F simplification guard refused provisioning'; END $$;
\endif
SELECT pg_try_advisory_xact_lock(1279348813,7) AS lock_ok \gset
\if :lock_ok
\else
\echo 'STOP: another role provisioning session holds the lock.'
DO $$ BEGIN RAISE EXCEPTION 'Phase 11F simplification guard refused provisioning'; END $$;
\endif
-- Same pinned ledger as the accepted staging migration release.
WITH expected(version,filename,checksum_sha256) AS (VALUES
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
)
SELECT NOT EXISTS(
  (SELECT * FROM expected EXCEPT SELECT version,filename,checksum_sha256 FROM public.schema_migrations)
  UNION ALL
  (SELECT version,filename,checksum_sha256 FROM public.schema_migrations EXCEPT SELECT * FROM expected)
) AND (SELECT count(*)=12 FROM public.schema_migrations) AS ledger_ok \gset
\if :ledger_ok
\else
\echo 'STOP: migration ledger differs from the pinned twelve migrations.'
DO $$ BEGIN RAISE EXCEPTION 'Phase 11F simplification guard refused provisioning'; END $$;
\endif
SELECT NOT EXISTS(SELECT FROM pg_roles WHERE rolname='lapalme_staging_app')
AND (SELECT count(*)=6 FROM pg_roles WHERE rolname IN
  ('lapalme_staging_catalogue','lapalme_staging_admin','lapalme_staging_cart',
   'lapalme_staging_payment','lapalme_staging_media_cleanup','lapalme_staging_backup'))
AND NOT has_schema_privilege('public','public','CREATE')
AND NOT has_database_privilege('public',current_database(),'CREATE')
AND NOT EXISTS(
 SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
 WHERE n.nspname='public' AND a.grantee=0)
AND NOT EXISTS(
 SELECT FROM pg_attribute x JOIN pg_class c ON c.oid=x.attrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 CROSS JOIN LATERAL aclexplode(x.attacl) a
 WHERE n.nspname='public' AND a.grantee=0)
AND NOT EXISTS(
 SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public')
AND NOT EXISTS(
 SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND pg_get_userbyid(c.relowner)<>session_user)
AND (SELECT pg_get_userbyid(datdba)=session_user FROM pg_database WHERE datname=current_database())
AND (SELECT count(*)=38 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r')
AND NOT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('S','f','v','m'))
AS baseline_ok \gset
\if :baseline_ok
\else
\echo 'STOP: role names, ownership, schema or PUBLIC privileges changed; inspect without correction.'
DO $$ BEGIN RAISE EXCEPTION 'Phase 11F simplification guard refused provisioning'; END $$;
\endif
\set app_password ''
\getenv app_password PHASE11F_APP_PASSWORD
SELECT :'app_password' ~ '^[A-Za-z0-9_-]{43}$' AS password_ok \gset
\if :password_ok
\else
\echo 'STOP: an independent random 32-byte base64url application password is required.'
DO $$ BEGIN RAISE EXCEPTION 'Phase 11F simplification guard refused provisioning'; END $$;
\endif
SET LOCAL password_encryption='scram-sha-256';
CREATE ROLE lapalme_staging_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD :'app_password';
\unset app_password
GRANT CONNECT ON DATABASE :"DBNAME" TO lapalme_staging_app;
GRANT USAGE ON SCHEMA public TO lapalme_staging_app;

-- Exact union of catalogue, authentication/admin, cart/checkout and payment grants.
-- Better Auth, publication filtering, guest ownership and operation authorization
-- remain application responsibilities; this SQL identity is not a human role.
GRANT SELECT ON
  categories,collections,products,product_categories,product_collections,
  product_variants,product_prices,product_media,gemstones,product_gemstones,inventory,
  admin_users,admin_auth_accounts,admin_auth_sessions,admin_auth_verifications,
  admin_auth_rate_limits,audit_events,catalogue_media_jobs,carts,cart_items,
  cart_rate_limits,checkout_drafts,boutique_locations,orders,order_items,
  order_addresses,payments,payment_events,inventory_reservations,
  order_status_history,fulfillment_arrangements,fulfillment_events
  TO lapalme_staging_app;
GRANT INSERT ON
  admin_auth_sessions,admin_auth_rate_limits,audit_events,products,product_variants,
  product_prices,inventory,gemstones,product_categories,product_collections,
  product_gemstones,product_media,catalogue_media_jobs,fulfillment_arrangements,
  fulfillment_events,order_status_history,carts,cart_items,cart_rate_limits,
  checkout_drafts,orders,order_items,order_addresses,payments,payment_events,
  inventory_reservations
  TO lapalme_staging_app;
GRANT UPDATE ON
  admin_auth_rate_limits,products,product_variants,product_prices,inventory,
  product_categories,product_collections,product_gemstones,product_media,
  catalogue_media_jobs,carts,cart_items,cart_rate_limits,checkout_drafts
  TO lapalme_staging_app;
GRANT DELETE ON
  admin_auth_sessions,admin_auth_rate_limits,product_categories,product_collections,
  product_gemstones,product_media,cart_items,cart_rate_limits,checkout_drafts
  TO lapalme_staging_app;

-- Column restrictions that remain necessary after the union.
GRANT UPDATE(updated_at) ON admin_users,boutique_locations TO lapalme_staging_app;
GRANT UPDATE(fulfillment_status,order_status,payment_status,inventory_finalized_at,
  reconciliation_required,reconciliation_reason,updated_at)
  ON orders TO lapalme_staging_app;
GRANT UPDATE(status,scheduled_start_at,scheduled_end_at,assigned_admin_id,
  completed_at,completed_by_admin_id,updated_at)
  ON fulfillment_arrangements TO lapalme_staging_app;
GRANT UPDATE(provider_order_reference,provider_intention_reference,
  provider_transaction_reference,status,succeeded_at,initiation_state,
  checkout_client_secret,checkout_resume_until,next_reconcile_at,
  reconcile_lease_until,reconcile_attempts,last_error_code,updated_at)
  ON payments TO lapalme_staging_app;
GRANT UPDATE(payment_id,status,processing_attempts,last_error_code,processed_at)
  ON payment_events TO lapalme_staging_app;
GRANT UPDATE(status,ended_at,updated_at)
  ON inventory_reservations TO lapalme_staging_app;

-- No customer-profile/address, enquiry, appointment, bespoke or backup access.
-- Media cleanup's documented needs are already a subset of the grants above.
REVOKE ALL PRIVILEGES ON public.schema_migrations FROM lapalme_staging_app;
SELECT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
  AND NOT rolbypassrls AND NOT rolreplication AND NOT rolinherit
  AND NOT EXISTS(SELECT FROM pg_auth_members WHERE member=r.oid)
  AND NOT EXISTS(SELECT FROM pg_class WHERE relowner=r.oid)
  AND NOT EXISTS(SELECT FROM pg_namespace WHERE nspowner=r.oid)
  AND NOT EXISTS(SELECT FROM pg_database WHERE datdba=r.oid)
  AND NOT has_schema_privilege(r.oid,'public','CREATE')
  AND NOT has_database_privilege(r.oid,current_database(),'CREATE')
  AND NOT has_table_privilege(r.oid,'public.schema_migrations','SELECT')
  AND NOT has_table_privilege(r.oid,'public.schema_migrations','INSERT')
  AND NOT has_table_privilege(r.oid,'public.schema_migrations','UPDATE')
  AND NOT has_table_privilege(r.oid,'public.schema_migrations','DELETE')
  AND NOT has_table_privilege(r.oid,'public.schema_migrations','TRUNCATE')
  AS role_ok FROM pg_roles r WHERE rolname='lapalme_staging_app' \gset
\if :role_ok
\else
\echo 'STOP: unexpected consolidated role attributes or effective privileges.'
DO $$ BEGIN RAISE EXCEPTION 'Phase 11F simplification guard refused provisioning'; END $$;
\endif
COMMIT;
\echo 'Consolidated staging application identity provisioned; verify actual LOGIN before integration.'


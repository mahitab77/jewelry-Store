-- Phase 11F-A review artifact. Hosted execution REQUIRES separate operator approval.
-- Execute with psql 18 -X --no-password --set=ON_ERROR_STOP=1 --file=THIS_FILE.
-- A reviewed launcher must pin this file's SHA-256, validate the exact PGHOST,
-- use trusted roots, PGSSLMODE=verify-full and PGCHANNELBINDING=require, scrub
-- inherited libpq destination overrides, and verify the Console target mapping.
-- Never use --echo-all/--echo-queries or put passwords/URLs in argv/history.
-- Password inputs: six distinct random 32-byte base64url values in process env.
-- No password values are stored here. No default privileges or provider ACLs change.
-- PUBLIC CONNECT/TEMP remain provider defaults; they do not confer schema CREATE.
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
  AND :'approved'='green-glitter-95493455/br-rough-term-b9hae0t4/ep-wispy-feather-b95dea30/la_palme_dor_staging'
END AND current_setting('server_version_num')='180006'
  AND NOT pg_is_in_recovery() AND current_setting('transaction_read_only')='off'
  AS target_ok \gset
\if :target_ok
\else
\echo 'STOP: target, approval, version or connection policy guard failed.'
DO $$ BEGIN RAISE EXCEPTION 'Phase 11F-A guard refused provisioning'; END $$;
\endif
SELECT pg_try_advisory_xact_lock(1279348813,6) AS lock_ok \gset
\if :lock_ok
\else
\echo 'STOP: another role provisioning session holds the lock.'
DO $$ BEGIN RAISE EXCEPTION 'Phase 11F-A guard refused provisioning'; END $$;
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
DO $$ BEGIN RAISE EXCEPTION 'Phase 11F-A guard refused provisioning'; END $$;
\endif
SELECT NOT EXISTS(SELECT FROM pg_roles WHERE rolname IN
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
DO $$ BEGIN RAISE EXCEPTION 'Phase 11F-A guard refused provisioning'; END $$;
\endif
\set pw_catalogue ''
\getenv pw_catalogue PHASE11F_PASSWORD_CATALOGUE
\set pw_admin ''
\getenv pw_admin PHASE11F_PASSWORD_ADMIN
\set pw_cart ''
\getenv pw_cart PHASE11F_PASSWORD_CART
\set pw_payment ''
\getenv pw_payment PHASE11F_PASSWORD_PAYMENT
\set pw_media_cleanup ''
\getenv pw_media_cleanup PHASE11F_PASSWORD_MEDIA_CLEANUP
\set pw_backup ''
\getenv pw_backup PHASE11F_PASSWORD_BACKUP
SELECT bool_and(value ~ '^[A-Za-z0-9_-]{43}$') AND count(DISTINCT value)=6 AS passwords_ok
FROM (VALUES (:'pw_catalogue'),(:'pw_admin'),(:'pw_cart'),(:'pw_payment'),(:'pw_media_cleanup'),(:'pw_backup')) p(value) \gset
\if :passwords_ok
\else
\echo 'STOP: six separate random 32-byte base64url passwords are required.'
DO $$ BEGIN RAISE EXCEPTION 'Phase 11F-A guard refused provisioning'; END $$;
\endif
SET LOCAL password_encryption='scram-sha-256';
CREATE ROLE lapalme_staging_catalogue LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD :'pw_catalogue';
\unset pw_catalogue
CREATE ROLE lapalme_staging_admin LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD :'pw_admin';
\unset pw_admin
CREATE ROLE lapalme_staging_cart LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD :'pw_cart';
\unset pw_cart
CREATE ROLE lapalme_staging_payment LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD :'pw_payment';
\unset pw_payment
CREATE ROLE lapalme_staging_media_cleanup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD :'pw_media_cleanup';
\unset pw_media_cleanup
CREATE ROLE lapalme_staging_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD :'pw_backup';
\unset pw_backup
GRANT CONNECT ON DATABASE :"DBNAME" TO lapalme_staging_catalogue,
  lapalme_staging_admin,
  lapalme_staging_cart,
  lapalme_staging_payment,
  lapalme_staging_media_cleanup,
  lapalme_staging_backup;
GRANT USAGE ON SCHEMA public TO lapalme_staging_catalogue,
  lapalme_staging_admin,
  lapalme_staging_cart,
  lapalme_staging_payment,
  lapalme_staging_media_cleanup,
  lapalme_staging_backup;

-- Public repository publication/projection checks remain mandatory in the app.
GRANT SELECT ON categories,collections,products,product_categories,product_collections,
  product_variants,product_prices,product_media,gemstones,product_gemstones,inventory
  TO lapalme_staging_catalogue;

-- Cumulative Phase 05, 06 and 10 grants; SQL identity is not human authorization.
GRANT SELECT ON admin_users,admin_auth_accounts,admin_auth_sessions,admin_auth_verifications TO lapalme_staging_admin;
GRANT INSERT,DELETE ON admin_auth_sessions TO lapalme_staging_admin;
GRANT SELECT,INSERT,UPDATE,DELETE ON admin_auth_rate_limits TO lapalme_staging_admin;
GRANT INSERT ON audit_events TO lapalme_staging_admin;
GRANT SELECT ON categories,collections TO lapalme_staging_admin;
GRANT SELECT,INSERT,UPDATE ON products,product_variants,product_prices,inventory TO lapalme_staging_admin;
GRANT SELECT,INSERT ON gemstones TO lapalme_staging_admin;
GRANT SELECT,INSERT,UPDATE,DELETE ON product_categories,product_collections,product_gemstones,product_media TO lapalme_staging_admin;
GRANT SELECT,INSERT,UPDATE ON catalogue_media_jobs TO lapalme_staging_admin;
GRANT SELECT ON audit_events TO lapalme_staging_admin;
GRANT SELECT(id,order_number,customer_name,customer_email,customer_phone,currency,total_minor,subtotal_minor,discount_minor,tax_minor,
  fulfillment_fee_minor,payment_status,order_status,fulfillment_method,fulfillment_status,created_at,updated_at,test_mode,boutique_location_id,boutique_location_snapshot,
  inventory_finalized_at,reconciliation_required,reconciliation_reason) ON orders TO lapalme_staging_admin;
GRANT UPDATE(fulfillment_status,order_status,updated_at) ON orders TO lapalme_staging_admin;
GRANT SELECT ON order_items,order_addresses,boutique_locations,fulfillment_arrangements,fulfillment_events,order_status_history TO lapalme_staging_admin;
GRANT UPDATE(updated_at) ON admin_users,boutique_locations TO lapalme_staging_admin;
GRANT SELECT(id,order_id,status,currency,amount_minor,refunded_minor,provider_transaction_reference,created_at,succeeded_at,initiation_state,last_error_code)
  ON payments TO lapalme_staging_admin;
GRANT SELECT(id,payment_id,status,signature_verified,verification_source,provider_transaction_reference,received_at,processed_at)
  ON payment_events TO lapalme_staging_admin;
GRANT INSERT ON fulfillment_arrangements,fulfillment_events,order_status_history TO lapalme_staging_admin;
GRANT UPDATE(status,scheduled_start_at,scheduled_end_at,assigned_admin_id,completed_at,completed_by_admin_id,updated_at)
  ON fulfillment_arrangements TO lapalme_staging_admin;

-- Phase 07 and 08 cart/draft grants.
GRANT SELECT ON products,product_variants,product_prices,product_media,inventory TO lapalme_staging_cart;
GRANT SELECT,INSERT,UPDATE ON carts TO lapalme_staging_cart;
GRANT SELECT,INSERT,UPDATE,DELETE ON cart_items,cart_rate_limits,checkout_drafts TO lapalme_staging_cart;
GRANT SELECT ON boutique_locations TO lapalme_staging_cart;

-- Phase 09. Timestamp-only grants support FOR SHARE locks without price edits.
GRANT SELECT ON products,product_variants,product_prices,product_media,inventory,boutique_locations,carts,cart_items,checkout_drafts,
  orders,order_items,order_addresses,payments,payment_events,inventory_reservations,order_status_history TO lapalme_staging_payment;
GRANT UPDATE(updated_at) ON products,product_variants,product_prices,boutique_locations TO lapalme_staging_payment;
GRANT INSERT ON carts,orders,order_items,order_addresses,payments,payment_events,inventory_reservations,order_status_history TO lapalme_staging_payment;
GRANT UPDATE(status,session_token_hash,updated_at) ON carts TO lapalme_staging_payment;
GRANT UPDATE(cart_id) ON cart_items TO lapalme_staging_payment;
GRANT DELETE ON cart_items,checkout_drafts TO lapalme_staging_payment;
GRANT UPDATE(cart_id,updated_at) ON checkout_drafts TO lapalme_staging_payment;
GRANT UPDATE(on_hand,reserved,updated_at) ON inventory TO lapalme_staging_payment;
GRANT UPDATE(order_status,payment_status,inventory_finalized_at,reconciliation_required,reconciliation_reason,updated_at) ON orders TO lapalme_staging_payment;
GRANT UPDATE(provider_order_reference,provider_intention_reference,provider_transaction_reference,status,succeeded_at,initiation_state,
  checkout_client_secret,checkout_resume_until,next_reconcile_at,reconcile_lease_until,reconcile_attempts,last_error_code,updated_at)
  ON payments TO lapalme_staging_payment;
GRANT UPDATE(status,ended_at,updated_at) ON inventory_reservations TO lapalme_staging_payment;
GRANT UPDATE(payment_id,status,processing_attempts,last_error_code,processed_at) ON payment_events TO lapalme_staging_payment;
GRANT SELECT,INSERT,UPDATE,DELETE ON cart_rate_limits TO lapalme_staging_payment;

-- Phase 11 operator-only cleanup.
GRANT SELECT ON catalogue_media_jobs TO lapalme_staging_media_cleanup;
GRANT UPDATE(state,attempts,available_at,updated_at) ON catalogue_media_jobs TO lapalme_staging_media_cleanup;
GRANT SELECT(id,cloudinary_public_id) ON product_media TO lapalme_staging_media_cleanup;
GRANT INSERT ON audit_events TO lapalme_staging_media_cleanup;

-- pg_dump --no-owner --no-privileges needs reads, not pg_read_all_data membership.
-- Snapshot of current tables only: no ALTER DEFAULT PRIVILEGES / future grants.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO lapalme_staging_backup;
ALTER ROLE lapalme_staging_backup IN DATABASE :"DBNAME" SET default_transaction_read_only=on;
REVOKE ALL PRIVILEGES ON public.schema_migrations FROM lapalme_staging_catalogue,
  lapalme_staging_admin,
  lapalme_staging_cart,
  lapalme_staging_payment,
  lapalme_staging_media_cleanup,
  lapalme_staging_backup;
GRANT SELECT ON public.schema_migrations TO lapalme_staging_backup;

-- Fail before COMMIT if any new identity inherited administrative access.
SELECT count(*)=6 AND bool_and(rolcanlogin AND NOT rolsuper AND NOT rolcreatedb
  AND NOT rolcreaterole AND NOT rolbypassrls AND NOT rolreplication AND NOT rolinherit)
AND NOT EXISTS(SELECT FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.member
 WHERE r.rolname IN ('lapalme_staging_catalogue','lapalme_staging_admin','lapalme_staging_cart',
 'lapalme_staging_payment','lapalme_staging_media_cleanup','lapalme_staging_backup'))
AS roles_ok FROM pg_roles WHERE rolname IN
 ('lapalme_staging_catalogue','lapalme_staging_admin','lapalme_staging_cart',
 'lapalme_staging_payment','lapalme_staging_media_cleanup','lapalme_staging_backup') \gset
\if :roles_ok
\else
\echo 'STOP: unexpected runtime attributes or inherited membership; transaction will roll back.'
DO $$ BEGIN RAISE EXCEPTION 'Phase 11F-A guard refused provisioning'; END $$;
\endif
COMMIT;
\echo 'Six restricted identities provisioned. Verify using each actual LOGIN before integration.'


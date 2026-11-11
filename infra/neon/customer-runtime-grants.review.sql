-- REVIEW ONLY. Do not apply to hosted Neon as part of local implementation.
-- Operator must verify the target, migration 0014 checksum and role separately.
-- Use a dedicated NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT login.
-- Replace the role below only after explicit deployment authorization.
BEGIN;
GRANT USAGE ON SCHEMA public TO lapalme_customer_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON customer_auth_users,customer_auth_sessions,
 customer_auth_accounts,customer_auth_verifications,customer_auth_rate_limits TO lapalme_customer_runtime;
GRANT SELECT ON customer_profiles TO lapalme_customer_runtime;
GRANT INSERT(auth_provider,auth_subject,full_name,email) ON customer_profiles TO lapalme_customer_runtime;
GRANT UPDATE(full_name,phone,updated_at) ON customer_profiles TO lapalme_customer_runtime;
GRANT SELECT ON products,product_variants,product_gemstones,gemstones,boutique_locations TO lapalme_customer_runtime;
-- PostgreSQL requires an UPDATE privilege for existing SELECT FOR SHARE snapshot
-- locks. Only timestamp columns are granted; no business field can be changed.
GRANT UPDATE(updated_at) ON products,product_variants TO lapalme_customer_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON cart_rate_limits TO lapalme_customer_runtime;
GRANT SELECT(id,customer_profile_id,product_id,variant_id,contact_name,contact_email,contact_phone,message,status,product_context,created_at)
 ON product_enquiries,bespoke_requests TO lapalme_customer_runtime;
GRANT SELECT(id,customer_profile_id,product_id,variant_id,contact_name,contact_email,contact_phone,message,status,product_context,created_at,consultation_channel,preferred_start_at,confirmed_start_at,boutique_location_id)
 ON appointment_requests TO lapalme_customer_runtime;
GRANT INSERT(id,customer_profile_id,product_id,variant_id,contact_name,contact_email,contact_phone,message,product_context)
 ON product_enquiries,bespoke_requests TO lapalme_customer_runtime;
GRANT INSERT(id,customer_profile_id,product_id,variant_id,contact_name,contact_email,contact_phone,message,product_context,consultation_channel,preferred_start_at)
 ON appointment_requests TO lapalme_customer_runtime;
GRANT INSERT ON audit_events TO lapalme_customer_runtime;
-- No admin data, schema ledger, request UPDATE/DELETE, payments or inventory writes.
ROLLBACK;

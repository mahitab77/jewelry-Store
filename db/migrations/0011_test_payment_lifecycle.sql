BEGIN;
SET LOCAL search_path = public, pg_catalog;

-- Existing financial tables and source-cart uniqueness remain authoritative.
ALTER TABLE orders ADD COLUMN test_mode BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN guest_session_hash TEXT CHECK (guest_session_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE orders ADD COLUMN guest_access_expires_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN checkout_fingerprint TEXT CHECK (checkout_fingerprint ~ '^[0-9a-f]{64}$');
ALTER TABLE orders ADD COLUMN checkout_draft_revision TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN boutique_location_id UUID REFERENCES boutique_locations(id) ON DELETE RESTRICT;
ALTER TABLE orders ADD COLUMN boutique_location_snapshot JSONB CHECK (jsonb_typeof(boutique_location_snapshot) = 'object');
ALTER TABLE orders ADD COLUMN inventory_finalized_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN reconciliation_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN reconciliation_reason TEXT CHECK (reconciliation_reason IN
  ('PROVIDER_OUTCOME_UNKNOWN','RESERVATION_EXPIRED_UNCERTAIN','PROVIDER_STATUS_REVIEW','LATE_SUCCESS','DUPLICATE_PAYMENT','INVENTORY_MISMATCH','REFERENCE_CONFLICT'));
ALTER TABLE orders ADD CONSTRAINT orders_test_checkout CHECK (NOT test_mode OR
  (source_cart_id IS NOT NULL AND guest_session_hash IS NOT NULL AND guest_access_expires_at IS NOT NULL
   AND checkout_fingerprint IS NOT NULL AND checkout_draft_revision IS NOT NULL AND currency='EGP'
   AND (fulfillment_method <> 'BOUTIQUE_COLLECTION' OR (boutique_location_id IS NOT NULL AND boutique_location_snapshot IS NOT NULL))));
CREATE INDEX orders_guest_pending_idx ON orders(guest_session_hash,created_at) WHERE test_mode AND order_status='PENDING_PAYMENT';
CREATE INDEX orders_reconciliation_idx ON orders(created_at,id) WHERE reconciliation_required;

-- Identifiers/timestamps only: removed or edited cart lines never block history.
ALTER TABLE order_items ADD COLUMN source_cart_item_id UUID;
ALTER TABLE order_items ADD COLUMN source_cart_item_updated_at TIMESTAMPTZ;

ALTER TABLE payments ADD COLUMN test_mode BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE payments ADD COLUMN integration_id BIGINT CHECK (integration_id>0);
ALTER TABLE payments ADD COLUMN owner_id BIGINT CHECK (owner_id>0);
ALTER TABLE payments ADD COLUMN previous_payment_id UUID UNIQUE REFERENCES payments(id) ON DELETE RESTRICT;
ALTER TABLE payments ADD COLUMN initiation_state TEXT NOT NULL DEFAULT 'LOCAL_READY'
  CHECK (initiation_state IN ('LOCAL_READY','DISPATCHING','READY','UNCERTAIN','REJECTED'));
ALTER TABLE payments ADD COLUMN checkout_client_secret TEXT CHECK (char_length(checkout_client_secret) BETWEEN 20 AND 240);
-- Local link lifetime is never evidence that the provider stopped processing.
ALTER TABLE payments ADD COLUMN checkout_resume_until TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN next_reconcile_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE payments ADD COLUMN reconcile_lease_until TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN reconcile_attempts INTEGER NOT NULL DEFAULT 0 CHECK (reconcile_attempts>=0);
ALTER TABLE payments ADD COLUMN last_error_code TEXT;
ALTER TABLE payments ADD CONSTRAINT payments_test_identity CHECK (NOT test_mode OR (integration_id IS NOT NULL AND owner_id IS NOT NULL AND currency='EGP'));
ALTER TABLE payments ADD CONSTRAINT payments_id_order_key UNIQUE(id,order_id);
ALTER TABLE payments ADD CONSTRAINT payments_retry_order_fk FOREIGN KEY(previous_payment_id,order_id) REFERENCES payments(id,order_id) ON DELETE RESTRICT;
ALTER TABLE payments ADD CONSTRAINT payments_retry_not_self CHECK (previous_payment_id IS DISTINCT FROM id);
CREATE UNIQUE INDEX payments_test_provider_order_key ON payments(provider,provider_order_reference) WHERE test_mode AND provider_order_reference IS NOT NULL;
CREATE UNIQUE INDEX payments_test_provider_intention_key ON payments(provider,provider_intention_reference) WHERE test_mode AND provider_intention_reference IS NOT NULL;
CREATE INDEX payments_reconcile_idx ON payments(next_reconcile_at,id) WHERE test_mode AND status IN ('CREATED','PENDING');

ALTER TABLE inventory_reservations ADD COLUMN payment_id UUID REFERENCES payments(id) ON DELETE RESTRICT;
ALTER TABLE inventory_reservations ADD CONSTRAINT inventory_reservations_payment_order_fk FOREIGN KEY(payment_id,order_id) REFERENCES payments(id,order_id) ON DELETE RESTRICT;
ALTER TABLE inventory_reservations ADD CONSTRAINT inventory_reservations_payment_requires_order CHECK (payment_id IS NULL OR order_id IS NOT NULL);
CREATE UNIQUE INDEX inventory_reservations_payment_variant_key ON inventory_reservations(payment_id,variant_id) WHERE payment_id IS NOT NULL;
CREATE INDEX inventory_reservations_payment_idx ON inventory_reservations(payment_id);

-- Retain a whitelisted, verified business event, never raw callbacks/card data.
ALTER TABLE payment_events ADD COLUMN verified_payload JSONB CHECK (jsonb_typeof(verified_payload)='object');
ALTER TABLE payment_events ADD COLUMN verification_source TEXT CHECK (verification_source IN ('PAYMOB_HMAC','PAYMOB_API'));
ALTER TABLE payment_events DROP CONSTRAINT payment_events_verified_processing;
ALTER TABLE payment_events ADD CONSTRAINT payment_events_verified_processing CHECK
  (status<>'PROCESSED' OR (payment_id IS NOT NULL AND (signature_verified OR COALESCE(verification_source='PAYMOB_API',false))));

INSERT INTO schema_migrations(version,filename) VALUES ('0011','0011_test_payment_lifecycle.sql');
COMMIT;

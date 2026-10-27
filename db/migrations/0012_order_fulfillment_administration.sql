BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL TIME ZONE 'UTC';

-- Extend the canonical order stage; arrangement status remains its lifecycle.
ALTER TABLE orders DROP CONSTRAINT orders_fulfillment_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_fulfillment_status_check CHECK
  (fulfillment_status IN ('UNARRANGED','PREPARING','ARRANGING','SCHEDULED','IN_PROGRESS','READY','COMPLETED','CANCELLED'));
ALTER TABLE orders ADD CONSTRAINT orders_collection_ready CHECK (fulfillment_status <> 'READY' OR fulfillment_method = 'BOUTIQUE_COLLECTION');
ALTER TABLE order_status_history DROP CONSTRAINT order_status_history_values;
ALTER TABLE order_status_history ADD CONSTRAINT order_status_history_values CHECK (
  (state_domain='ORDER' AND to_status IN ('PENDING_PAYMENT','CONFIRMED','CANCELLED','COMPLETED') AND
    (from_status IS NULL OR from_status IN ('PENDING_PAYMENT','CONFIRMED','CANCELLED','COMPLETED')))
  OR (state_domain='PAYMENT' AND to_status IN ('UNPAID','PENDING','PAID','FAILED','PARTIALLY_REFUNDED','REFUNDED') AND
    (from_status IS NULL OR from_status IN ('UNPAID','PENDING','PAID','FAILED','PARTIALLY_REFUNDED','REFUNDED')))
  OR (state_domain='FULFILLMENT' AND to_status IN ('UNARRANGED','PREPARING','ARRANGING','SCHEDULED','IN_PROGRESS','READY','COMPLETED','CANCELLED') AND
    (from_status IS NULL OR from_status IN ('UNARRANGED','PREPARING','ARRANGING','SCHEDULED','IN_PROGRESS','READY','COMPLETED','CANCELLED'))));

ALTER TABLE fulfillment_events ADD COLUMN order_id UUID REFERENCES orders(id) ON DELETE RESTRICT;
UPDATE fulfillment_events e SET order_id=a.order_id FROM fulfillment_arrangements a WHERE a.id=e.arrangement_id;
ALTER TABLE fulfillment_events ALTER COLUMN order_id SET NOT NULL;
ALTER TABLE fulfillment_events ALTER COLUMN arrangement_id DROP NOT NULL;
ALTER TABLE fulfillment_events ADD CONSTRAINT fulfillment_events_order_arrangement FOREIGN KEY(arrangement_id,order_id)
  REFERENCES fulfillment_arrangements(id,order_id) ON DELETE RESTRICT;
ALTER TABLE fulfillment_events ADD COLUMN operation_id UUID UNIQUE;
ALTER TABLE fulfillment_events ADD COLUMN operation_fingerprint TEXT;
ALTER TABLE fulfillment_events ADD CONSTRAINT fulfillment_events_operation CHECK
  ((operation_id IS NULL AND operation_fingerprint IS NULL) OR
   (operation_id IS NOT NULL AND operation_fingerprint IS NOT NULL AND operation_fingerprint ~ '^[a-f0-9]{64}$'));
ALTER TABLE fulfillment_events ADD COLUMN reason_code TEXT CHECK (reason_code IN
  ('CUSTOMER_UNAVAILABLE','DELIVERY_NOT_COMPLETED','COLLECTION_MISSED','CUSTOMER_RESCHEDULE','LOCATION_UNAVAILABLE','STAFF_RESCHEDULE','OTHER'));
ALTER TABLE fulfillment_events ADD COLUMN follow_up TEXT CHECK (follow_up IN ('CONTACT_CUSTOMER','RESCHEDULE','LOCATION_REVIEW','STAFF_REVIEW'));
ALTER TABLE fulfillment_events ADD COLUMN corrects_event_id UUID;
ALTER TABLE fulfillment_events ADD CONSTRAINT fulfillment_events_id_order UNIQUE(id,order_id);
ALTER TABLE fulfillment_events ADD CONSTRAINT fulfillment_events_correction FOREIGN KEY(corrects_event_id,order_id)
  REFERENCES fulfillment_events(id,order_id) ON DELETE RESTRICT;
ALTER TABLE fulfillment_events DROP CONSTRAINT fulfillment_events_event_type_check;
ALTER TABLE fulfillment_events ADD CONSTRAINT fulfillment_events_event_type_check CHECK(event_type IN
  ('REQUESTED','PREPARING','CONTACTED','SCHEDULE_PROPOSED','CONFIRMED','RESCHEDULED','STARTED','READY','CANCELLED','ATTEMPT_FAILED','HANDOVER_COMPLETED','NOTE','EXCEPTION_ACKNOWLEDGED','CORRECTION'));
ALTER TABLE fulfillment_events ADD CONSTRAINT fulfillment_events_arrangement_required CHECK
  (arrangement_id IS NOT NULL OR event_type IN ('NOTE','EXCEPTION_ACKNOWLEDGED','CORRECTION'));
ALTER TABLE fulfillment_events ADD CONSTRAINT fulfillment_events_failed_followup CHECK
  (event_type <> 'ATTEMPT_FAILED' OR (reason_code IS NOT NULL AND follow_up IS NOT NULL));
ALTER TABLE fulfillment_events ADD CONSTRAINT fulfillment_events_corrective_reference CHECK
  ((event_type='CORRECTION') = (corrects_event_id IS NOT NULL));
CREATE UNIQUE INDEX fulfillment_events_order_handover_idx ON fulfillment_events(order_id) WHERE event_type='HANDOVER_COMPLETED';
CREATE INDEX fulfillment_events_order_time_idx ON fulfillment_events(order_id,recorded_at,id);
CREATE INDEX orders_admin_created_idx ON orders(created_at DESC,id DESC);

INSERT INTO schema_migrations(version,filename) VALUES('0012','0012_order_fulfillment_administration.sql');
COMMIT;

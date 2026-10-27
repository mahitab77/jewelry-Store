BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL TIME ZONE 'UTC';

CREATE TABLE boutique_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (btrim(name) <> ''),
    country_code TEXT NOT NULL DEFAULT 'EG' CHECK (country_code = 'EG'),
    governorate TEXT NOT NULL CHECK (btrim(governorate) <> ''),
    city_area TEXT NOT NULL CHECK (btrim(city_area) <> ''),
    street_address TEXT NOT NULL CHECK (btrim(street_address) <> ''),
    additional_details TEXT,
    is_active BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fulfillment_arrangements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL,
    method TEXT NOT NULL CHECK (method IN ('PRIVATE_DELIVERY', 'BOUTIQUE_COLLECTION')),
    supersedes_id UUID UNIQUE,
    assigned_admin_id UUID REFERENCES admin_users(id) ON DELETE RESTRICT,
    boutique_location_id UUID REFERENCES boutique_locations(id) ON DELETE RESTRICT,
    delivery_address_id UUID,
    status TEXT NOT NULL DEFAULT 'REQUESTED'
        CHECK (status IN ('REQUESTED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'RESCHEDULED')),
    scheduled_start_at TIMESTAMPTZ,
    scheduled_end_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    completed_by_admin_id UUID REFERENCES admin_users(id) ON DELETE RESTRICT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fulfillment_arrangements_order_method_fk FOREIGN KEY (order_id, method)
        REFERENCES orders(id, fulfillment_method) ON DELETE RESTRICT,
    CONSTRAINT fulfillment_arrangements_id_order_key UNIQUE (id, order_id),
    CONSTRAINT fulfillment_arrangements_previous_fk FOREIGN KEY (supersedes_id, order_id)
        REFERENCES fulfillment_arrangements(id, order_id) ON DELETE RESTRICT,
    CONSTRAINT fulfillment_arrangements_not_own_previous CHECK (supersedes_id IS DISTINCT FROM id),
    CONSTRAINT fulfillment_arrangements_address_fk FOREIGN KEY (delivery_address_id, order_id)
        REFERENCES order_addresses(id, order_id) ON DELETE RESTRICT,
    CONSTRAINT fulfillment_arrangements_destination CHECK (
        (method = 'PRIVATE_DELIVERY' AND delivery_address_id IS NOT NULL AND boutique_location_id IS NULL)
        OR (method = 'BOUTIQUE_COLLECTION' AND delivery_address_id IS NULL
            AND (status NOT IN ('CONFIRMED', 'IN_PROGRESS', 'COMPLETED') OR boutique_location_id IS NOT NULL))),
    CONSTRAINT fulfillment_arrangements_schedule CHECK (
        (scheduled_start_at IS NULL AND scheduled_end_at IS NULL)
        OR (scheduled_start_at IS NOT NULL AND scheduled_end_at IS NOT NULL AND scheduled_end_at > scheduled_start_at)),
    CONSTRAINT fulfillment_arrangements_confirmed_schedule CHECK (status NOT IN ('CONFIRMED', 'IN_PROGRESS', 'COMPLETED') OR scheduled_start_at IS NOT NULL),
    CONSTRAINT fulfillment_arrangements_completion CHECK (
        (status = 'COMPLETED' AND completed_at IS NOT NULL AND completed_by_admin_id IS NOT NULL)
        OR (status <> 'COMPLETED' AND completed_at IS NULL AND completed_by_admin_id IS NULL))
);
CREATE INDEX fulfillment_arrangements_order_idx ON fulfillment_arrangements(order_id);
CREATE INDEX fulfillment_arrangements_admin_idx ON fulfillment_arrangements(assigned_admin_id);
CREATE INDEX fulfillment_arrangements_completed_admin_idx ON fulfillment_arrangements(completed_by_admin_id);
CREATE INDEX fulfillment_arrangements_location_idx ON fulfillment_arrangements(boutique_location_id);
CREATE INDEX fulfillment_arrangements_address_idx ON fulfillment_arrangements(delivery_address_id);
CREATE INDEX fulfillment_arrangements_schedule_idx ON fulfillment_arrangements(scheduled_start_at)
    WHERE status IN ('CONFIRMED', 'IN_PROGRESS');
-- Completed arrangements also occupy the current slot: no second live handover.
CREATE UNIQUE INDEX fulfillment_arrangements_current_idx ON fulfillment_arrangements(order_id)
    WHERE status NOT IN ('CANCELLED', 'RESCHEDULED');

CREATE TABLE fulfillment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    arrangement_id UUID NOT NULL REFERENCES fulfillment_arrangements(id) ON DELETE RESTRICT,
    event_type TEXT NOT NULL CHECK (event_type IN ('REQUESTED', 'CONFIRMED', 'RESCHEDULED', 'STARTED', 'CANCELLED', 'HANDOVER_COMPLETED', 'NOTE')),
    actor_kind TEXT NOT NULL CHECK (actor_kind IN ('SYSTEM', 'ADMIN')),
    actor_admin_id UUID REFERENCES admin_users(id) ON DELETE RESTRICT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    handover_recipient_name TEXT,
    handover_evidence_reference TEXT,
    notes TEXT,
    CONSTRAINT fulfillment_events_actor CHECK ((actor_kind = 'ADMIN' AND actor_admin_id IS NOT NULL)
        OR (actor_kind = 'SYSTEM' AND actor_admin_id IS NULL)),
    CONSTRAINT fulfillment_events_handover CHECK (event_type <> 'HANDOVER_COMPLETED'
        OR (actor_kind = 'ADMIN' AND handover_recipient_name IS NOT NULL AND btrim(handover_recipient_name) <> ''))
);
CREATE INDEX fulfillment_events_arrangement_time_idx ON fulfillment_events(arrangement_id, occurred_at, id);
CREATE INDEX fulfillment_events_actor_idx ON fulfillment_events(actor_admin_id);
CREATE UNIQUE INDEX fulfillment_events_handover_idx ON fulfillment_events(arrangement_id) WHERE event_type = 'HANDOVER_COMPLETED';

CREATE TABLE bespoke_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_profile_id UUID REFERENCES customer_profiles(id) ON DELETE SET NULL,
    product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
    contact_name TEXT NOT NULL CHECK (btrim(contact_name) <> ''),
    contact_email TEXT CHECK (contact_email IS NULL OR btrim(contact_email) <> ''),
    contact_phone TEXT CHECK (contact_phone IS NULL OR btrim(contact_phone) <> ''),
    message TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 10000),
    status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'CONTACTED', 'IN_DESIGN', 'QUOTED', 'ACCEPTED', 'CLOSED', 'CANCELLED')),
    assigned_admin_id UUID REFERENCES admin_users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT bespoke_requests_contact CHECK (contact_email IS NOT NULL OR contact_phone IS NOT NULL)
);
CREATE INDEX bespoke_requests_customer_idx ON bespoke_requests(customer_profile_id);
CREATE INDEX bespoke_requests_product_idx ON bespoke_requests(product_id);
CREATE INDEX bespoke_requests_admin_idx ON bespoke_requests(assigned_admin_id);
CREATE INDEX bespoke_requests_status_time_idx ON bespoke_requests(status, created_at);

CREATE TABLE appointment_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_profile_id UUID REFERENCES customer_profiles(id) ON DELETE SET NULL,
    product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
    bespoke_request_id UUID REFERENCES bespoke_requests(id) ON DELETE RESTRICT,
    boutique_location_id UUID REFERENCES boutique_locations(id) ON DELETE RESTRICT,
    contact_name TEXT NOT NULL CHECK (btrim(contact_name) <> ''),
    contact_email TEXT CHECK (contact_email IS NULL OR btrim(contact_email) <> ''),
    contact_phone TEXT CHECK (contact_phone IS NULL OR btrim(contact_phone) <> ''),
    message TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 10000),
    preferred_start_at TIMESTAMPTZ,
    confirmed_start_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'CONTACTED', 'CONFIRMED', 'DECLINED', 'CANCELLED', 'COMPLETED')),
    assigned_admin_id UUID REFERENCES admin_users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT appointment_requests_contact CHECK (contact_email IS NOT NULL OR contact_phone IS NOT NULL),
    CONSTRAINT appointment_requests_confirmation CHECK (status NOT IN ('CONFIRMED', 'COMPLETED') OR confirmed_start_at IS NOT NULL)
);
CREATE INDEX appointment_requests_customer_idx ON appointment_requests(customer_profile_id);
CREATE INDEX appointment_requests_product_idx ON appointment_requests(product_id);
CREATE INDEX appointment_requests_bespoke_idx ON appointment_requests(bespoke_request_id);
CREATE INDEX appointment_requests_location_idx ON appointment_requests(boutique_location_id);
CREATE INDEX appointment_requests_admin_idx ON appointment_requests(assigned_admin_id);
CREATE INDEX appointment_requests_status_time_idx ON appointment_requests(status, created_at);

CREATE TABLE product_enquiries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_profile_id UUID REFERENCES customer_profiles(id) ON DELETE SET NULL,
    product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
    contact_name TEXT NOT NULL CHECK (btrim(contact_name) <> ''),
    contact_email TEXT CHECK (contact_email IS NULL OR btrim(contact_email) <> ''),
    contact_phone TEXT CHECK (contact_phone IS NULL OR btrim(contact_phone) <> ''),
    message TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 10000),
    status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'CONTACTED', 'RESOLVED', 'CLOSED')),
    assigned_admin_id UUID REFERENCES admin_users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT product_enquiries_contact CHECK (contact_email IS NOT NULL OR contact_phone IS NOT NULL)
);
CREATE INDEX product_enquiries_customer_idx ON product_enquiries(customer_profile_id);
CREATE INDEX product_enquiries_product_idx ON product_enquiries(product_id);
CREATE INDEX product_enquiries_admin_idx ON product_enquiries(assigned_admin_id);
CREATE INDEX product_enquiries_status_time_idx ON product_enquiries(status, created_at);

CREATE TABLE audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_kind TEXT NOT NULL CHECK (actor_kind IN ('SYSTEM', 'ADMIN')),
    actor_admin_id UUID REFERENCES admin_users(id) ON DELETE RESTRICT,
    action TEXT NOT NULL CHECK (btrim(action) <> ''),
    target_table TEXT NOT NULL CHECK (btrim(target_table) <> ''),
    target_id UUID NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT audit_events_actor CHECK ((actor_kind = 'ADMIN' AND actor_admin_id IS NOT NULL)
        OR (actor_kind = 'SYSTEM' AND actor_admin_id IS NULL)),
    CONSTRAINT audit_events_bounded_metadata CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::TEXT) <= 4096)
);
CREATE INDEX audit_events_actor_time_idx ON audit_events(actor_admin_id, created_at);
CREATE INDEX audit_events_target_time_idx ON audit_events(target_table, target_id, created_at);
-- Polymorphic target IDs intentionally have no FK: audit evidence outlives targets.

INSERT INTO schema_migrations(version, filename) VALUES ('0005', '0005_fulfillment_requests_audit.sql');
COMMIT;

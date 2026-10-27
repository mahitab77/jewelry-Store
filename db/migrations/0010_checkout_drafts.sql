BEGIN;
SET LOCAL search_path = public, pg_catalog;

-- Short-lived personal details; never an order, payment or stock reservation.
CREATE TABLE checkout_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id UUID NOT NULL UNIQUE REFERENCES carts(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL DEFAULT '' CHECK (char_length(full_name) <= 100),
    email TEXT NOT NULL DEFAULT '' CHECK (char_length(email) <= 254),
    phone TEXT NOT NULL DEFAULT '' CHECK (phone = '' OR phone ~ '^\+201[0125][0-9]{8}$'),
    fulfillment_method TEXT CHECK (fulfillment_method IN ('PRIVATE_DELIVERY', 'BOUTIQUE_COLLECTION')),
    country_code TEXT NOT NULL DEFAULT 'EG' CHECK (country_code = 'EG'),
    governorate TEXT NOT NULL DEFAULT '' CHECK (char_length(governorate) <= 40),
    city_area TEXT NOT NULL DEFAULT '' CHECK (char_length(city_area) <= 100),
    street_address TEXT NOT NULL DEFAULT '' CHECK (char_length(street_address) <= 200),
    building TEXT NOT NULL DEFAULT '' CHECK (char_length(building) <= 100),
    floor_unit TEXT NOT NULL DEFAULT '' CHECK (char_length(floor_unit) <= 80),
    instructions TEXT NOT NULL DEFAULT '' CHECK (char_length(instructions) <= 500),
    boutique_location_id UUID REFERENCES boutique_locations(id) ON DELETE SET NULL,
    context_fingerprint TEXT NOT NULL CHECK (context_fingerprint ~ '^[0-9a-f]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT checkout_draft_expiry CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '24 hours'),
    CONSTRAINT checkout_draft_delivery_only CHECK (COALESCE(fulfillment_method = 'PRIVATE_DELIVERY',false)
      OR (governorate = '' AND city_area = '' AND street_address = '' AND building = '' AND floor_unit = '' AND instructions = '')),
    CONSTRAINT checkout_draft_collection_only CHECK (COALESCE(fulfillment_method = 'BOUTIQUE_COLLECTION',false) OR boutique_location_id IS NULL)
);
CREATE INDEX checkout_drafts_expiry_idx ON checkout_drafts(expires_at);
CREATE INDEX checkout_drafts_location_idx ON checkout_drafts(boutique_location_id);

INSERT INTO schema_migrations(version,filename) VALUES ('0010','0010_checkout_drafts.sql');
COMMIT;

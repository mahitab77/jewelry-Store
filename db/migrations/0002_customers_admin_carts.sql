BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL TIME ZONE 'UTC';

CREATE TABLE customer_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_provider TEXT,
    auth_subject TEXT,
    full_name TEXT NOT NULL CHECK (btrim(full_name) <> ''),
    email TEXT CHECK (email IS NULL OR btrim(email) <> ''),
    phone TEXT CHECK (phone IS NULL OR btrim(phone) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT customer_profiles_contact CHECK (email IS NOT NULL OR phone IS NOT NULL),
    CONSTRAINT customer_profiles_auth_pair CHECK ((auth_provider IS NULL AND auth_subject IS NULL)
        OR (auth_provider IS NOT NULL AND auth_subject IS NOT NULL AND btrim(auth_provider) <> '' AND btrim(auth_subject) <> '')),
    CONSTRAINT customer_profiles_auth_identity_key UNIQUE (auth_provider, auth_subject)
);

CREATE TABLE customer_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_profile_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
    label TEXT,
    recipient_name TEXT NOT NULL CHECK (btrim(recipient_name) <> ''),
    recipient_phone TEXT NOT NULL CHECK (btrim(recipient_phone) <> ''),
    country_code TEXT NOT NULL DEFAULT 'EG' CHECK (country_code = 'EG'),
    governorate TEXT NOT NULL CHECK (btrim(governorate) <> ''),
    city_area TEXT NOT NULL CHECK (btrim(city_area) <> ''),
    street_address TEXT NOT NULL CHECK (btrim(street_address) <> ''),
    building TEXT,
    floor_unit TEXT,
    landmark TEXT,
    delivery_instructions TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customer_addresses_customer_idx ON customer_addresses(customer_profile_id);

-- Identity linkage only: no credentials, seeded accounts, or auth-provider dependency.
CREATE TABLE admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_provider TEXT,
    auth_subject TEXT,
    display_name TEXT NOT NULL CHECK (btrim(display_name) <> ''),
    role TEXT NOT NULL CHECK (role IN ('OWNER', 'MANAGER', 'STAFF')),
    is_active BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT admin_users_auth_pair CHECK ((auth_provider IS NULL AND auth_subject IS NULL)
        OR (auth_provider IS NOT NULL AND auth_subject IS NOT NULL AND btrim(auth_provider) <> '' AND btrim(auth_subject) <> '')),
    CONSTRAINT admin_users_active_identity CHECK (NOT is_active OR auth_subject IS NOT NULL),
    CONSTRAINT admin_users_auth_identity_key UNIQUE (auth_provider, auth_subject)
);

CREATE TABLE carts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_profile_id UUID REFERENCES customer_profiles(id) ON DELETE SET NULL,
    -- Hash a cryptographically random session token; never store the bearer secret.
    session_token_hash TEXT NOT NULL UNIQUE CHECK (session_token_hash ~ '^[0-9a-f]{64}$'),
    currency TEXT NOT NULL DEFAULT 'EGP' CHECK (currency ~ '^[A-Z]{3}$'),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CONVERTED', 'ABANDONED', 'EXPIRED')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT carts_expiry CHECK (expires_at > created_at)
);
CREATE INDEX carts_customer_idx ON carts(customer_profile_id);
CREATE INDEX carts_active_expiry_idx ON carts(expires_at) WHERE status = 'ACTIVE';

CREATE TABLE cart_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cart_items_selection_key UNIQUE (cart_id, variant_id)
);
CREATE INDEX cart_items_variant_idx ON cart_items(variant_id);
-- No trigger or stock write on cart insertion: a cart is not a reservation.

INSERT INTO schema_migrations(version, filename) VALUES ('0002', '0002_customers_admin_carts.sql');
COMMIT;

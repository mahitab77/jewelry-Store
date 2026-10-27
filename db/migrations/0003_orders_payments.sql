BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL TIME ZONE 'UTC';

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number TEXT NOT NULL UNIQUE CHECK (btrim(order_number) <> ''),
    source_cart_id UUID UNIQUE REFERENCES carts(id) ON DELETE RESTRICT,
    customer_profile_id UUID REFERENCES customer_profiles(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL CHECK (btrim(customer_name) <> ''),
    customer_email TEXT CHECK (customer_email IS NULL OR btrim(customer_email) <> ''),
    customer_phone TEXT NOT NULL CHECK (btrim(customer_phone) <> ''),
    currency TEXT NOT NULL DEFAULT 'EGP' CHECK (currency ~ '^[A-Z]{3}$'),
    subtotal_minor BIGINT NOT NULL CHECK (subtotal_minor >= 0),
    discount_minor BIGINT NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
    tax_minor BIGINT NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
    fulfillment_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (fulfillment_fee_minor >= 0),
    total_minor BIGINT NOT NULL CHECK (total_minor >= 0),
    order_status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT'
        CHECK (order_status IN ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'COMPLETED')),
    payment_status TEXT NOT NULL DEFAULT 'UNPAID'
        CHECK (payment_status IN ('UNPAID', 'PENDING', 'PAID', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED')),
    fulfillment_method TEXT NOT NULL CHECK (fulfillment_method IN ('PRIVATE_DELIVERY', 'BOUTIQUE_COLLECTION')),
    fulfillment_status TEXT NOT NULL DEFAULT 'UNARRANGED'
        CHECK (fulfillment_status IN ('UNARRANGED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT orders_discount_limit CHECK (discount_minor <= subtotal_minor),
    CONSTRAINT orders_total_equation CHECK (total_minor = subtotal_minor - discount_minor + tax_minor + fulfillment_fee_minor),
    CONSTRAINT orders_id_currency_key UNIQUE (id, currency),
    CONSTRAINT orders_id_method_key UNIQUE (id, fulfillment_method),
    CONSTRAINT orders_id_cart_key UNIQUE (id, source_cart_id)
);
CREATE INDEX orders_customer_created_idx ON orders(customer_profile_id, created_at);
CREATE INDEX orders_operational_status_idx ON orders(order_status, created_at);
CREATE INDEX orders_payment_status_idx ON orders(payment_status, created_at);
CREATE INDEX orders_fulfillment_status_idx ON orders(fulfillment_status, created_at);

-- Snapshots are independent of live names, prices, contacts, and saved addresses.
-- All financial/history foreign keys use RESTRICT, never cascading deletion.
CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
    variant_id UUID,
    sku_snapshot TEXT NOT NULL CHECK (btrim(sku_snapshot) <> ''),
    product_name_snapshot TEXT NOT NULL CHECK (btrim(product_name_snapshot) <> ''),
    configuration_snapshot TEXT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
    discount_minor BIGINT NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
    tax_minor BIGINT NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
    line_subtotal_minor BIGINT GENERATED ALWAYS AS (quantity::BIGINT * unit_price_minor) STORED,
    line_total_minor BIGINT GENERATED ALWAYS AS (quantity::BIGINT * unit_price_minor - discount_minor + tax_minor) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT order_items_variant_product_fk FOREIGN KEY (variant_id, product_id)
        REFERENCES product_variants(id, product_id) ON DELETE RESTRICT,
    CONSTRAINT order_items_variant_requires_product CHECK (variant_id IS NULL OR product_id IS NOT NULL),
    CONSTRAINT order_items_discount_limit CHECK (discount_minor <= quantity::BIGINT * unit_price_minor)
);
CREATE INDEX order_items_order_idx ON order_items(order_id);
CREATE INDEX order_items_product_idx ON order_items(product_id);
CREATE INDEX order_items_variant_idx ON order_items(variant_id);

-- One immutable delivery snapshot per order; collection orders need no address.
CREATE TABLE order_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
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
    CONSTRAINT order_addresses_id_order_key UNIQUE (id, order_id)
);

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    local_reference TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::TEXT CHECK (btrim(local_reference) <> ''),
    order_id UUID NOT NULL,
    provider TEXT NOT NULL DEFAULT 'PAYMOB' CHECK (provider = 'PAYMOB'),
    provider_order_reference TEXT CHECK (provider_order_reference IS NULL OR btrim(provider_order_reference) <> ''),
    provider_intention_reference TEXT CHECK (provider_intention_reference IS NULL OR btrim(provider_intention_reference) <> ''),
    provider_transaction_reference TEXT CHECK (provider_transaction_reference IS NULL OR btrim(provider_transaction_reference) <> ''),
    currency TEXT NOT NULL DEFAULT 'EGP' CHECK (currency ~ '^[A-Z]{3}$'),
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    refunded_minor BIGINT NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0),
    status TEXT NOT NULL DEFAULT 'CREATED'
        CHECK (status IN ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED', 'PARTIALLY_REFUNDED', 'REFUNDED')),
    succeeded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT payments_order_currency_fk FOREIGN KEY (order_id, currency) REFERENCES orders(id, currency) ON DELETE RESTRICT,
    CONSTRAINT payments_transaction_key UNIQUE (provider, provider_transaction_reference),
    CONSTRAINT payments_refund_limit CHECK (refunded_minor <= amount_minor),
    CONSTRAINT payments_refund_state CHECK (
        (status = 'REFUNDED' AND refunded_minor = amount_minor)
        OR (status = 'PARTIALLY_REFUNDED' AND refunded_minor > 0 AND refunded_minor < amount_minor)
        OR (status NOT IN ('REFUNDED', 'PARTIALLY_REFUNDED') AND refunded_minor = 0)),
    CONSTRAINT payments_success_time CHECK (
        (status IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED') AND succeeded_at IS NOT NULL)
        OR (status NOT IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED') AND succeeded_at IS NULL))
);
CREATE INDEX payments_order_created_idx ON payments(order_id, created_at);
-- Provider order/intention references may span retries; transaction IDs may not.
CREATE INDEX payments_provider_order_idx ON payments(provider, provider_order_reference);
CREATE INDEX payments_provider_intention_idx ON payments(provider, provider_intention_reference);
CREATE INDEX payments_pending_idx ON payments(created_at) WHERE status IN ('CREATED', 'PENDING');

CREATE TABLE payment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID REFERENCES payments(id) ON DELETE RESTRICT,
    provider TEXT NOT NULL DEFAULT 'PAYMOB' CHECK (provider = 'PAYMOB'),
    deduplication_key TEXT NOT NULL CHECK (btrim(deduplication_key) <> ''),
    provider_event_id TEXT CHECK (provider_event_id IS NULL OR btrim(provider_event_id) <> ''),
    provider_transaction_reference TEXT,
    provider_status_code TEXT,
    signature_verified BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED')),
    processing_attempts INTEGER NOT NULL DEFAULT 0 CHECK (processing_attempts >= 0),
    last_error_code TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    CONSTRAINT payment_events_deduplication_key UNIQUE (provider, deduplication_key),
    CONSTRAINT payment_events_provider_event_key UNIQUE (provider, provider_event_id),
    CONSTRAINT payment_events_processed_time CHECK (
        (status IN ('PROCESSED', 'IGNORED') AND processed_at IS NOT NULL)
        OR (status IN ('RECEIVED', 'FAILED') AND processed_at IS NULL)),
    CONSTRAINT payment_events_verified_processing CHECK (status <> 'PROCESSED' OR (signature_verified AND payment_id IS NOT NULL))
);
CREATE INDEX payment_events_payment_idx ON payment_events(payment_id);
CREATE INDEX payment_events_pending_idx ON payment_events(received_at) WHERE status IN ('RECEIVED', 'FAILED');
CREATE INDEX payment_events_transaction_idx ON payment_events(provider, provider_transaction_reference);

CREATE TABLE order_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    state_domain TEXT NOT NULL CHECK (state_domain IN ('ORDER', 'PAYMENT', 'FULFILLMENT')),
    from_status TEXT,
    to_status TEXT NOT NULL,
    actor_kind TEXT NOT NULL CHECK (actor_kind IN ('SYSTEM', 'ADMIN')),
    actor_admin_id UUID REFERENCES admin_users(id) ON DELETE RESTRICT,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT order_status_history_actor CHECK ((actor_kind = 'ADMIN' AND actor_admin_id IS NOT NULL)
        OR (actor_kind = 'SYSTEM' AND actor_admin_id IS NULL)),
    CONSTRAINT order_status_history_transition CHECK (from_status IS DISTINCT FROM to_status),
    CONSTRAINT order_status_history_values CHECK (
        (state_domain = 'ORDER' AND to_status IN ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'COMPLETED')
            AND (from_status IS NULL OR from_status IN ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'COMPLETED')))
        OR (state_domain = 'PAYMENT' AND to_status IN ('UNPAID', 'PENDING', 'PAID', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED')
            AND (from_status IS NULL OR from_status IN ('UNPAID', 'PENDING', 'PAID', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED')))
        OR (state_domain = 'FULFILLMENT' AND to_status IN ('UNARRANGED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')
            AND (from_status IS NULL OR from_status IN ('UNARRANGED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'))))
);
CREATE INDEX order_status_history_order_time_idx ON order_status_history(order_id, created_at, id);
CREATE INDEX order_status_history_actor_idx ON order_status_history(actor_admin_id);

INSERT INTO schema_migrations(version, filename) VALUES ('0003', '0003_orders_payments.sql');
COMMIT;

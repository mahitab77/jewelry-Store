BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL TIME ZONE 'UTC';

CREATE TABLE inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id UUID NOT NULL UNIQUE,
    product_type TEXT NOT NULL,
    on_hand INTEGER NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
    reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT inventory_variant_type_fk FOREIGN KEY (variant_id, product_type)
        REFERENCES product_variants(id, product_type) ON DELETE RESTRICT,
    CONSTRAINT inventory_reserved_limit CHECK (reserved <= on_hand),
    CONSTRAINT inventory_unique_unit CHECK (product_type <> 'ONE_OF_A_KIND' OR on_hand <= 1),
    CONSTRAINT inventory_bespoke_no_stock CHECK (product_type <> 'BESPOKE' OR (on_hand = 0 AND reserved = 0))
);
COMMENT ON COLUMN inventory.on_hand IS 'Physical units not yet deducted for completed sales, including reserved units.';
COMMENT ON COLUMN inventory.reserved IS 'Temporarily unavailable subset of on_hand; available = on_hand - reserved. Maintain atomically with active reservations.';

CREATE TABLE inventory_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_reference TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::TEXT CHECK (btrim(reservation_reference) <> ''),
    variant_id UUID NOT NULL REFERENCES inventory(variant_id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    cart_id UUID REFERENCES carts(id) ON DELETE RESTRICT,
    order_id UUID REFERENCES orders(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED')),
    expires_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT inventory_reservations_owner CHECK (cart_id IS NOT NULL OR order_id IS NOT NULL),
    -- Preserve the cart during order promotion, without allowing a different order's cart.
    CONSTRAINT inventory_reservations_order_cart_fk FOREIGN KEY (order_id, cart_id)
        REFERENCES orders(id, source_cart_id) ON DELETE RESTRICT,
    CONSTRAINT inventory_reservations_expiry CHECK (expires_at > created_at),
    CONSTRAINT inventory_reservations_end_state CHECK (
        (status = 'ACTIVE' AND ended_at IS NULL)
        OR (status <> 'ACTIVE' AND ended_at IS NOT NULL AND ended_at >= created_at))
);
CREATE INDEX inventory_reservations_variant_idx ON inventory_reservations(variant_id);
CREATE INDEX inventory_reservations_cart_idx ON inventory_reservations(cart_id);
CREATE INDEX inventory_reservations_order_idx ON inventory_reservations(order_id);
CREATE INDEX inventory_reservations_active_expiry_idx ON inventory_reservations(expires_at) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX inventory_reservations_active_order_idx ON inventory_reservations(order_id, variant_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX inventory_reservations_active_cart_idx ON inventory_reservations(cart_id, variant_id)
    WHERE status = 'ACTIVE' AND order_id IS NULL;
-- Expiry is a timestamp, not an automatic transition. Later transactions must release
-- or consume stock exactly once and reconcile reserved with ACTIVE reservation sums.

INSERT INTO schema_migrations(version, filename) VALUES ('0004', '0004_inventory.sql');
COMMIT;

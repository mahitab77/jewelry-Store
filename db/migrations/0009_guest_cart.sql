BEGIN;
SET LOCAL search_path = public, pg_catalog;

-- An observation for change notices, never an authoritative selling price.
ALTER TABLE cart_items ADD COLUMN observed_unit_price_minor BIGINT CHECK (observed_unit_price_minor >= 0);

-- Guest abuse counters must not grant access to administrator auth counters.
CREATE TABLE cart_rate_limits (
    key_hash TEXT PRIMARY KEY CHECK (key_hash ~ '^[0-9a-f]{64}$'),
    count INTEGER NOT NULL CHECK (count > 0),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX cart_rate_limits_expiry_idx ON cart_rate_limits(expires_at);

INSERT INTO schema_migrations(version, filename) VALUES ('0009', '0009_guest_cart.sql');
COMMIT;

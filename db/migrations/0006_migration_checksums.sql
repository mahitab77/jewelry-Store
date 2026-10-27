BEGIN;
SET LOCAL search_path = public, pg_catalog;

-- Additive bridge for the immutable Phase 01 ledger. These are SHA-256 hashes
-- of the approved UTF-8 migration files with CRLF normalized to LF.
-- The runner requires explicit adoption of a pre-existing checksum-free ledger.
ALTER TABLE schema_migrations ADD COLUMN checksum_sha256 TEXT
    CONSTRAINT schema_migrations_checksum_format CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$');
UPDATE schema_migrations SET checksum_sha256 = approved.checksum
FROM (VALUES
    ('0001', '0001_catalogue.sql', '0026abfbc0657627c6d783970bbdbe84ad721f663311690f66e0828140ea47eb'),
    ('0002', '0002_customers_admin_carts.sql', '3d2baf373e7f23d981a86839d16605bc95dd3969ef240d3f7d9bae36da17a369'),
    ('0003', '0003_orders_payments.sql', '3eaa0df9e93931b16adc4adb6669f7cf7c2b1e300bc5973cedae72a3f6183757'),
    ('0004', '0004_inventory.sql', '7906ea7c14ca02b546cd39cf4ef7bd1f944c51d85cba16217fdedd2876cb894f'),
    ('0005', '0005_fulfillment_requests_audit.sql', '269dd9f4b3dd8493b7dff60ff7e3813809253abd1f31e24ea3fceea2328554b6')
) AS approved(version, filename, checksum)
WHERE schema_migrations.version = approved.version AND schema_migrations.filename = approved.filename;

-- The runner stamps this file's checksum before the surrounding transaction commits.
INSERT INTO schema_migrations(version, filename) VALUES ('0006', '0006_migration_checksums.sql');
COMMIT;

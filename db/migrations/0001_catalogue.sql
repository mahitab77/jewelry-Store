BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL TIME ZONE 'UTC';

-- Apply once, in filename order. A conflicting schema must fail, not be hidden.
CREATE TABLE schema_migrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version TEXT NOT NULL UNIQUE CHECK (version ~ '^[0-9]{4}$'),
    filename TEXT NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID REFERENCES categories(id) ON DELETE RESTRICT,
    slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    name TEXT NOT NULL CHECK (btrim(name) <> ''),
    description TEXT,
    display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
    is_visible BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT categories_not_own_parent CHECK (parent_id IS DISTINCT FROM id)
);
CREATE INDEX categories_parent_order_idx ON categories(parent_id, display_order);

CREATE TABLE collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    name TEXT NOT NULL CHECK (btrim(name) <> ''),
    description TEXT,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    published_at TIMESTAMPTZ,
    display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT collections_publication_date CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL)
);
CREATE INDEX collections_status_order_idx ON collections(status, display_order);

CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    name TEXT NOT NULL CHECK (btrim(name) <> ''),
    description TEXT,
    product_type TEXT NOT NULL CHECK (product_type IN ('ONE_OF_A_KIND', 'REPEATABLE', 'BESPOKE')),
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    sales_mode TEXT NOT NULL DEFAULT 'ENQUIRY_ONLY' CHECK (sales_mode IN ('DIRECT_PURCHASE', 'ENQUIRY_ONLY', 'BOTH')),
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT products_bespoke_enquiry_only CHECK (product_type <> 'BESPOKE' OR sales_mode = 'ENQUIRY_ONLY'),
    CONSTRAINT products_publication_date CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL),
    -- Checked discriminator copies let stock limits be enforced without triggers.
    CONSTRAINT products_id_type_key UNIQUE (id, product_type)
);
CREATE INDEX products_status_type_idx ON products(status, product_type);

CREATE TABLE product_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    CONSTRAINT product_categories_assignment_key UNIQUE (product_id, category_id)
);
CREATE INDEX product_categories_category_idx ON product_categories(category_id);

CREATE TABLE product_collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    display_order INTEGER CHECK (display_order >= 0),
    CONSTRAINT product_collections_assignment_key UNIQUE (product_id, collection_id)
);
CREATE INDEX product_collections_collection_order_idx ON product_collections(collection_id, display_order);

CREATE TABLE product_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL,
    product_type TEXT NOT NULL,
    sku TEXT NOT NULL UNIQUE CHECK (sku ~ '^[A-Z0-9][A-Z0-9._-]*$'),
    size_label TEXT CHECK (size_label IS NULL OR btrim(size_label) <> ''),
    configuration_label TEXT,
    metal_type TEXT,
    metal_purity TEXT,
    metal_color TEXT,
    is_active BOOLEAN NOT NULL DEFAULT false,
    display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT product_variants_product_type_fk FOREIGN KEY (product_id, product_type)
        REFERENCES products(id, product_type) ON DELETE RESTRICT,
    CONSTRAINT product_variants_id_product_key UNIQUE (id, product_id),
    CONSTRAINT product_variants_id_type_key UNIQUE (id, product_type)
);
CREATE INDEX product_variants_product_order_idx ON product_variants(product_id, display_order);
-- A unique physical jewel has one inventory-owning SKU, not stock per ring size.
CREATE UNIQUE INDEX product_variants_one_of_a_kind_idx ON product_variants(product_id)
    WHERE product_type = 'ONE_OF_A_KIND';

CREATE TABLE product_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    currency TEXT NOT NULL DEFAULT 'EGP' CHECK (currency ~ '^[A-Z]{3}$'),
    amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX product_prices_variant_idx ON product_prices(variant_id);
CREATE UNIQUE INDEX product_prices_active_currency_idx ON product_prices(variant_id, currency) WHERE is_active;

CREATE TABLE product_media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    external_media_reference TEXT NOT NULL CHECK (btrim(external_media_reference) <> ''),
    media_type TEXT NOT NULL CHECK (media_type IN ('IMAGE', 'VIDEO')),
    alt_text TEXT,
    display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT product_media_primary_image CHECK (NOT is_primary OR media_type = 'IMAGE'),
    CONSTRAINT product_media_reference_key UNIQUE (product_id, external_media_reference)
);
CREATE INDEX product_media_product_order_idx ON product_media(product_id, display_order);
CREATE UNIQUE INDEX product_media_primary_idx ON product_media(product_id) WHERE is_primary;

CREATE TABLE gemstones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    specification_kind TEXT NOT NULL CHECK (specification_kind IN ('INDIVIDUAL', 'GROUP')),
    stone_type TEXT NOT NULL CHECK (btrim(stone_type) <> ''),
    variety TEXT,
    shape TEXT NOT NULL CHECK (btrim(shape) <> ''),
    carat_weight NUMERIC(12,4),
    color TEXT NOT NULL CHECK (btrim(color) <> ''),
    origin TEXT,
    treatment_information TEXT,
    laboratory TEXT CHECK (laboratory IS NULL OR btrim(laboratory) <> ''),
    report_reference TEXT CHECK (report_reference IS NULL OR btrim(report_reference) <> ''),
    report_verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
        CHECK (report_verification_status IN ('UNVERIFIED', 'VERIFIED')),
    provenance_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (provenance_status IN ('UNKNOWN', 'DECLARED', 'VERIFIED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT gemstones_finite_weight CHECK (carat_weight > 0 AND carat_weight < 100000000),
    CONSTRAINT gemstones_report_laboratory CHECK (report_reference IS NULL OR laboratory IS NOT NULL),
    CONSTRAINT gemstones_verified_report CHECK (report_verification_status <> 'VERIFIED' OR (laboratory IS NOT NULL AND report_reference IS NOT NULL)),
    CONSTRAINT gemstones_verified_origin CHECK (provenance_status <> 'VERIFIED' OR (origin IS NOT NULL AND btrim(origin) <> '')),
    CONSTRAINT gemstones_id_kind_key UNIQUE (id, specification_kind)
);

CREATE TABLE product_gemstones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    gemstone_id UUID NOT NULL,
    specification_kind TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    gemstone_role TEXT NOT NULL CHECK (gemstone_role IN ('CENTER', 'ACCENT', 'OTHER')),
    total_carat_weight NUMERIC(12,4),
    display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
    CONSTRAINT product_gemstones_specification_fk FOREIGN KEY (gemstone_id, specification_kind)
        REFERENCES gemstones(id, specification_kind) ON DELETE RESTRICT,
    CONSTRAINT product_gemstones_individual_quantity CHECK (specification_kind <> 'INDIVIDUAL' OR quantity = 1),
    CONSTRAINT product_gemstones_finite_total CHECK (total_carat_weight > 0 AND total_carat_weight < 100000000),
    CONSTRAINT product_gemstones_assignment_key UNIQUE (variant_id, gemstone_id)
);
CREATE INDEX product_gemstones_variant_order_idx ON product_gemstones(variant_id, display_order);
CREATE INDEX product_gemstones_gemstone_idx ON product_gemstones(gemstone_id);
CREATE UNIQUE INDEX product_gemstones_individual_idx ON product_gemstones(gemstone_id) WHERE specification_kind = 'INDIVIDUAL';

INSERT INTO schema_migrations(version, filename) VALUES ('0001', '0001_catalogue.sql');
COMMIT;

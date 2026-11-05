BEGIN;
SET LOCAL search_path = public, pg_catalog;

ALTER TABLE product_variants
    ADD COLUMN metal_weight_grams NUMERIC(10,3),
    ADD COLUMN metal_weight_basis TEXT,
    ADD CONSTRAINT product_variants_metal_weight CHECK (
      (metal_weight_grams IS NULL AND metal_weight_basis IS NULL)
      OR (metal_weight_grams IS NOT NULL AND metal_weight_grams > 0 AND metal_weight_grams < 10000000
          AND metal_weight_basis IS NOT NULL AND metal_weight_basis IN ('ACTUAL','ESTIMATED')));

ALTER TABLE product_enquiries
    ADD COLUMN variant_id UUID,
    ADD COLUMN product_context JSONB,
    ADD CONSTRAINT product_enquiries_variant_product CHECK (variant_id IS NULL OR product_id IS NOT NULL),
    ADD CONSTRAINT product_enquiries_variant_fk FOREIGN KEY (variant_id,product_id) REFERENCES product_variants(id,product_id) ON DELETE RESTRICT,
    ADD CONSTRAINT product_enquiries_context CHECK (product_context IS NULL OR (jsonb_typeof(product_context)='object' AND octet_length(product_context::TEXT)<=65536));
CREATE INDEX product_enquiries_variant_idx ON product_enquiries(variant_id) WHERE variant_id IS NOT NULL;

ALTER TABLE bespoke_requests
    ADD COLUMN variant_id UUID,
    ADD COLUMN product_context JSONB,
    ADD CONSTRAINT bespoke_requests_variant_product CHECK (variant_id IS NULL OR product_id IS NOT NULL),
    ADD CONSTRAINT bespoke_requests_variant_fk FOREIGN KEY (variant_id,product_id) REFERENCES product_variants(id,product_id) ON DELETE RESTRICT,
    ADD CONSTRAINT bespoke_requests_context CHECK (product_context IS NULL OR (jsonb_typeof(product_context)='object' AND octet_length(product_context::TEXT)<=65536));
CREATE INDEX bespoke_requests_variant_idx ON bespoke_requests(variant_id) WHERE variant_id IS NOT NULL;

ALTER TABLE appointment_requests
    ADD COLUMN variant_id UUID,
    ADD COLUMN product_context JSONB,
    ADD COLUMN consultation_channel TEXT CHECK (consultation_channel IN ('ZOOM','BOUTIQUE')),
    ADD CONSTRAINT appointment_requests_variant_product CHECK (variant_id IS NULL OR product_id IS NOT NULL),
    ADD CONSTRAINT appointment_requests_variant_fk FOREIGN KEY (variant_id,product_id) REFERENCES product_variants(id,product_id) ON DELETE RESTRICT,
    ADD CONSTRAINT appointment_requests_context CHECK (product_context IS NULL OR (jsonb_typeof(product_context)='object' AND octet_length(product_context::TEXT)<=65536)),
    ADD CONSTRAINT appointment_requests_channel_destination CHECK (
      (consultation_channel IS DISTINCT FROM 'ZOOM' OR boutique_location_id IS NULL)
      AND (consultation_channel IS DISTINCT FROM 'BOUTIQUE' OR status NOT IN ('CONFIRMED','COMPLETED') OR boutique_location_id IS NOT NULL));
CREATE INDEX appointment_requests_variant_idx ON appointment_requests(variant_id) WHERE variant_id IS NOT NULL;

INSERT INTO schema_migrations(version,filename) VALUES ('0013','0013_quotation_requests_specifications.sql');
COMMIT;

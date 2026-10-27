BEGIN;
SET LOCAL search_path = public, pg_catalog;

-- Existing local references remain valid. Provider metadata is server-owned.
ALTER TABLE product_media ADD COLUMN cloudinary_asset_id TEXT;
ALTER TABLE product_media ADD COLUMN cloudinary_public_id TEXT;
ALTER TABLE product_media ADD COLUMN cloudinary_version BIGINT;
ALTER TABLE product_media ADD COLUMN image_format TEXT;
ALTER TABLE product_media ADD COLUMN width INTEGER;
ALTER TABLE product_media ADD COLUMN height INTEGER;
ALTER TABLE product_media ADD COLUMN byte_size INTEGER;
ALTER TABLE product_media ADD CONSTRAINT product_media_cloudinary_metadata CHECK (
    (cloudinary_public_id IS NULL AND cloudinary_asset_id IS NULL AND cloudinary_version IS NULL)
    OR (media_type = 'IMAGE' AND cloudinary_asset_id IS NOT NULL AND cloudinary_public_id IS NOT NULL
      AND cloudinary_version IS NOT NULL AND image_format IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL AND byte_size IS NOT NULL
      AND cloudinary_version > 0 AND image_format IN ('jpg', 'png', 'webp')
      AND cloudinary_public_id ~ '^la-palme/catalogue/[0-9a-f-]{36}/[0-9a-f-]{36}$'
      AND external_media_reference = '/catalogue-images/' || id::TEXT
      AND width BETWEEN 200 AND 6000 AND height BETWEEN 200 AND 6000 AND width*height <= 20000000 AND byte_size BETWEEN 1 AND 5242880));
CREATE INDEX product_media_cloudinary_idx ON product_media(cloudinary_public_id) WHERE cloudinary_public_id IS NOT NULL;

-- Durable upload intents and deletion retries. No files/secrets stored here.
-- Authenticated Cloudinary delivery keeps unassociated assets private.
CREATE TABLE catalogue_media_jobs (
    id UUID PRIMARY KEY,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    public_id TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL CHECK (state IN ('UPLOAD_PENDING', 'ATTACHED', 'DELETE_PENDING', 'DELETING', 'DONE')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX catalogue_media_jobs_pending_idx ON catalogue_media_jobs(state, available_at);
CREATE INDEX catalogue_media_jobs_product_idx ON catalogue_media_jobs(product_id);

INSERT INTO schema_migrations(version, filename) VALUES ('0008', '0008_catalogue_media.sql');
COMMIT;

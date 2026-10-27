BEGIN;
SET LOCAL search_path = public, pg_catalog;

-- Keep every existing administrator ID, identity linkage, role and audit FK.
-- Legacy roles remain stored but cannot authenticate until deliberately reviewed
-- and provisioned with one of the Phase 05 roles.
ALTER TABLE admin_users DROP CONSTRAINT admin_users_role_check;
ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_check
    CHECK (role IN ('OWNER', 'ADMIN', 'CATALOGUE_MANAGER', 'MANAGER', 'STAFF'));
ALTER TABLE admin_users ADD COLUMN email TEXT UNIQUE
    CHECK (email IS NULL OR (email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 254));
ALTER TABLE admin_users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE admin_users ADD COLUMN image TEXT;
ALTER TABLE admin_users ADD CONSTRAINT admin_users_better_auth_identity
    CHECK (auth_provider IS DISTINCT FROM 'better-auth'
        OR (email IS NOT NULL AND auth_subject = id::TEXT AND role IN ('OWNER', 'ADMIN', 'CATALOGUE_MANAGER')));

-- Better Auth core models, mapped to existing snake_case conventions.
CREATE TABLE admin_auth_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id TEXT NOT NULL,
    provider_id TEXT NOT NULL CHECK (provider_id = 'credential'),
    user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
    password TEXT NOT NULL CHECK (btrim(password) <> ''),
    access_token TEXT CHECK (access_token IS NULL),
    refresh_token TEXT CHECK (refresh_token IS NULL),
    id_token TEXT CHECK (id_token IS NULL),
    access_token_expires_at TIMESTAMPTZ,
    refresh_token_expires_at TIMESTAMPTZ,
    scope TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT admin_auth_account_subject CHECK (account_id = user_id::TEXT),
    CONSTRAINT admin_auth_account_identity UNIQUE (provider_id, account_id),
    CONSTRAINT admin_auth_account_user UNIQUE (user_id)
);

CREATE TABLE admin_auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
    -- Library-managed bearer identifier. Better Auth 1.7 has no supported
    -- session-token hashing setting; never expose this value through our API.
    token TEXT NOT NULL UNIQUE CHECK (char_length(token) >= 32),
    expires_at TIMESTAMPTZ NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admin_auth_sessions_user_idx ON admin_auth_sessions(user_id);
CREATE INDEX admin_auth_sessions_expiry_idx ON admin_auth_sessions(expires_at);

-- Required core model; email verification/recovery/OAuth routes are not exposed.
CREATE TABLE admin_auth_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admin_auth_verifications_identifier_idx ON admin_auth_verifications(identifier);
CREATE INDEX admin_auth_verifications_expiry_idx ON admin_auth_verifications(expires_at);

-- Atomic bounded fixed windows, shared by all processes. No submitted email/IP.
CREATE TABLE admin_auth_rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash TEXT NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
    count INTEGER NOT NULL CHECK (count > 0),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX admin_auth_rate_limits_expiry_idx ON admin_auth_rate_limits(expires_at);

INSERT INTO schema_migrations(version, filename) VALUES ('0007', '0007_admin_authentication.sql');
COMMIT;

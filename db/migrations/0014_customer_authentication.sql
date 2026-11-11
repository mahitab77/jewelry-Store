BEGIN;
SET LOCAL search_path = public, pg_catalog;
CREATE TABLE customer_auth_users (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 100),
 email TEXT NOT NULL UNIQUE CHECK (email=lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 254),
 email_verified BOOLEAN NOT NULL DEFAULT false,
 image TEXT CHECK (image IS NULL),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE customer_auth_sessions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES customer_auth_users(id) ON DELETE CASCADE,
 token TEXT NOT NULL UNIQUE CHECK (char_length(token)>=32), expires_at TIMESTAMPTZ NOT NULL,
 ip_address TEXT, user_agent TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customer_auth_sessions_user_idx ON customer_auth_sessions(user_id);
CREATE INDEX customer_auth_sessions_expiry_idx ON customer_auth_sessions(expires_at);
-- Core model used by Better Auth's unverified-identity revocation path.
-- Password sign-up/login, linking and OAuth are not exposed.
CREATE TABLE customer_auth_accounts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES customer_auth_users(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL, provider_id TEXT NOT NULL CHECK (provider_id='credential'), password TEXT,
 access_token TEXT CHECK (access_token IS NULL), refresh_token TEXT CHECK (refresh_token IS NULL), id_token TEXT CHECK (id_token IS NULL),
 access_token_expires_at TIMESTAMPTZ, refresh_token_expires_at TIMESTAMPTZ, scope TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(provider_id,account_id), UNIQUE(user_id), CHECK (account_id=user_id::TEXT)
);
CREATE TABLE customer_auth_verifications (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), identifier TEXT NOT NULL UNIQUE, value TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customer_auth_verifications_expiry_idx ON customer_auth_verifications(expires_at);
CREATE TABLE customer_auth_rate_limits (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), key_hash TEXT NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
 count INTEGER NOT NULL CHECK (count>0), expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX customer_auth_rate_limits_expiry_idx ON customer_auth_rate_limits(expires_at);
INSERT INTO schema_migrations(version,filename) VALUES ('0014','0014_customer_authentication.sql');
COMMIT;

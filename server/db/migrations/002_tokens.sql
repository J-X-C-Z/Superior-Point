CREATE TABLE api_tokens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 token_hash text NOT NULL UNIQUE, prefix text NOT NULL, name text NOT NULL,
 scopes jsonb NOT NULL CHECK (jsonb_typeof(scopes) = 'array'),
 project_allowlist jsonb CHECK (project_allowlist IS NULL OR jsonb_typeof(project_allowlist) = 'array'),
 expires_at timestamptz NOT NULL, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz
);
CREATE INDEX api_tokens_user ON api_tokens(user_id,created_at);

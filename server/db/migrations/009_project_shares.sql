CREATE TABLE project_shares (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES users(id),
 revision bigint NOT NULL CHECK (revision>=0 AND revision<=9007199254740991),
 token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
 title text NOT NULL,
 html text NOT NULL,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX project_shares_owner ON project_shares(owner_id,project_id,created_at DESC);
CREATE TABLE project_share_access (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 share_id uuid NOT NULL REFERENCES project_shares(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX project_share_access_share ON project_share_access(share_id,created_at DESC);

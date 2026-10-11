CREATE TABLE themes (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), name text NOT NULL,
 current_version text NOT NULL, revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 source_jsonb jsonb NOT NULL, archived boolean NOT NULL DEFAULT false, deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX themes_owner_updated ON themes(owner_id,updated_at DESC);
CREATE TABLE theme_versions (
 theme_id uuid NOT NULL REFERENCES themes(id), version text NOT NULL, hash text NOT NULL,
 snapshot_jsonb jsonb NOT NULL, published_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(theme_id,version)
);
CREATE TABLE theme_favorites (theme_id uuid NOT NULL REFERENCES themes(id), user_id uuid NOT NULL REFERENCES users(id), PRIMARY KEY(theme_id,user_id));
CREATE TABLE theme_receipts (
 actor_id uuid NOT NULL REFERENCES users(id), client_mutation_id text NOT NULL, request_hash text NOT NULL,
 theme_id uuid NOT NULL REFERENCES themes(id), result_jsonb jsonb NOT NULL, PRIMARY KEY(actor_id,client_mutation_id)
);

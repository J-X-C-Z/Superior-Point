CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text NOT NULL UNIQUE CHECK (length(username) BETWEEN 3 AND 64),
 password_hash text NOT NULL, role text NOT NULL CHECK (role IN ('admin','user')),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), session_hash text NOT NULL UNIQUE,
 csrf_hash text NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE projects (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), title text NOT NULL,
 revision bigint NOT NULL CHECK (revision >= 0 AND revision <= 9007199254740991),
 document_jsonb jsonb NOT NULL CHECK (document_jsonb->>'id' = id::text AND (document_jsonb->>'revision')::bigint = revision),
 deleted_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_owner ON projects(owner_id, updated_at DESC);
CREATE TABLE project_revisions (
 project_id uuid NOT NULL REFERENCES projects(id), revision bigint NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id), source text NOT NULL CHECK (source IN ('web','mcp')),
 document_jsonb jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (project_id,revision)
);
CREATE TABLE project_locks (
 project_id uuid PRIMARY KEY REFERENCES projects(id), actor_id uuid NOT NULL REFERENCES users(id),
 holder text NOT NULL, fencing_token uuid NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE mutation_receipts (
 project_id uuid NOT NULL REFERENCES projects(id), actor_id uuid NOT NULL REFERENCES users(id),
 client_mutation_id text NOT NULL CHECK (length(client_mutation_id) BETWEEN 1 AND 128),
 request_hash text NOT NULL, result_jsonb jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (project_id,actor_id,client_mutation_id)
);
CREATE TABLE audit_logs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid REFERENCES users(id),
 action text NOT NULL, resource_type text NOT NULL, resource_id text,
 outcome text NOT NULL CHECK (outcome IN ('success','failure')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_time ON audit_logs(created_at DESC);

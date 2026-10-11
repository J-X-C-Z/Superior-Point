CREATE TABLE import_receipts (
 actor_id uuid NOT NULL REFERENCES users(id), client_mutation_id text NOT NULL,
 request_hash text NOT NULL, project_id uuid NOT NULL REFERENCES projects(id), result_jsonb jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,client_mutation_id)
);

ALTER TABLE sessions ADD COLUMN reauth_until timestamptz;
CREATE TABLE system_settings (
 key text PRIMARY KEY, value jsonb NOT NULL, updated_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE backup_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL,
 initiator_id uuid REFERENCES users(id), manifest_key text,
 completed_at timestamptz, error_code text,
 created_at timestamptz NOT NULL DEFAULT now()
);

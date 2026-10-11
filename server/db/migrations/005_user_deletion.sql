ALTER TABLE users ADD COLUMN deleted_at timestamptz;
ALTER TABLE users ADD CONSTRAINT deleted_users_disabled CHECK (deleted_at IS NULL OR status='disabled');

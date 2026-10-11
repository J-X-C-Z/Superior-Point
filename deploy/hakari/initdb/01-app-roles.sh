#!/bin/sh
set -eu

for name in "$SP_APP_DB_USER" "$SP_MIGRATOR_DB_USER" "$SP_RESTORE_DB_USER"; do
  case "$name" in
    ''|*[!a-zA-Z0-9_]*|[0-9]*) printf 'Invalid database role name\n' >&2; exit 1 ;;
  esac
done
for password in "$SP_APP_DB_PASSWORD" "$SP_MIGRATOR_DB_PASSWORD" "$SP_RESTORE_DB_PASSWORD"; do
  if [ "${#password}" -lt 64 ]; then
    printf 'Database role passwords must be at least 64 hex characters\n' >&2
    exit 1
  fi
  case "$password" in
    ''|*[!a-fA-F0-9]*) printf 'Database role passwords must be non-empty hex values\n' >&2; exit 1 ;;
  esac
done

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set ON_ERROR_STOP=1 \
  --set app_user="$SP_APP_DB_USER" --set app_password="$SP_APP_DB_PASSWORD" \
  --set migrator_user="$SP_MIGRATOR_DB_USER" --set migrator_password="$SP_MIGRATOR_DB_PASSWORD" \
  --set restore_user="$SP_RESTORE_DB_USER" --set restore_password="$SP_RESTORE_DB_PASSWORD" \
  --set database="$POSTGRES_DB" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app_user') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', :'migrator_user', :'migrator_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'migrator_user') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER CREATEDB NOCREATEROLE NOINHERIT', :'restore_user', :'restore_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'restore_user') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'database') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I, %I, %I', :'database', :'app_user', :'migrator_user', :'restore_user') \gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', :'database', :'migrator_user') \gexec
SELECT format('ALTER SCHEMA public OWNER TO %I', :'migrator_user') \gexec
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_user" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_user" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_user";
SQL

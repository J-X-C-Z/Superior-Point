# Hakari deployment package

This package prepares a single-host deployment of the Alpha service. It has not been deployed or accepted on Hakari. The current host snapshot reports 1,735 MiB total RAM, 459 MiB available, and 22 GiB free disk; port 80 is already used by Nginx for Paperclip, Docker and Caddy are absent, port 443 is free, and `sp.jxcz.top` did not resolve in the local check. Recheck these facts on the server before publishing. DNS and certificate issuance are not verified.

The app listens on port 3000 inside Compose only. PostgreSQL 18 has no published port. Caddy is an optional `https` profile that binds only 443/TCP and UDP; its ACME issuer uses TLS-ALPN and disables HTTP-01 and HTTP redirects because Nginx owns port 80. ACME TLS-ALPN still requires public traffic on port 443 and correct public DNS. Caddy's challenge behavior follows its [official TLS issuer documentation](https://caddyserver.com/docs/caddyfile/directives/tls) and [Automatic HTTPS guidance](https://caddyserver.com/docs/caddyfile/options).

The app image builds on Linux from the repository files and runs `npm ci` there, so macOS `node_modules` are never copied into the image. Its Dockerfile-specific ignore file is `deploy/hakari/Dockerfile.dockerignore`; its name matches Docker's documented per-Dockerfile ignore convention, and it excludes `.env` files and local `node_modules` from the build context ([Docker documentation](https://docs.docker.com/build/concepts/context/)). The image keeps the existing TypeScript runtime entry (`tsx`) and includes PostgreSQL 18 client tools for backup and restore.

PostgreSQL creates four distinct identities on first initialization: `sp_pg_admin` is the database-container initialization superuser, `sp_migrator` owns the application database/schema and is used only by the one-shot migration service, `sp_app` has runtime DML rights, and `sp_restore` can create isolated restore-check databases. The app never receives the PostgreSQL initialization superuser credential. The initialization script runs only when `data/postgres` is empty; it does not retrofit an existing data directory. Do not delete an existing database directory to force initialization.

Image memory caps are 384 MiB for the app and 128 MiB for PostgreSQL, with PostgreSQL tuned for a small host. These are limits, not proof the workload fits; the recorded 459 MiB available leaves little room for the OS, Docker, and Caddy. Measure actual memory pressure before treating the host as deployable.

## Prepare and start

On Hakari, copy the repository to `/opt/superior-point`, then use that directory as the working directory. Keep its `.env` private and outside source control:

```sh
cp deploy/hakari/.env.example deploy/hakari/.env
chmod 600 deploy/hakari/.env
openssl rand -hex 32
```

Run `openssl rand -hex 32` separately for `POSTGRES_PASSWORD`, `SP_APP_DB_PASSWORD`, `SP_MIGRATOR_DB_PASSWORD`, and `SP_RESTORE_DB_PASSWORD`; use a different 64-character hex value each time so URLs need no password escaping. Do not use an empty or example password. Create the persistent directories and give the non-root app user (UID 1000) write access to its two data directories. Only apply ownership changes to newly created, empty directories:

```sh
mkdir -p data/postgres data/assets data/backups data/caddy data/caddy-config
chown 1000:1000 data/assets data/backups
```

Review the host prerequisites and rendered Compose configuration:

```sh
./scripts/preflight.sh
docker compose --env-file deploy/hakari/.env -f deploy/hakari/compose.yaml build app
docker compose --env-file deploy/hakari/.env -f deploy/hakari/compose.yaml up -d db
docker compose --env-file deploy/hakari/.env -f deploy/hakari/compose.yaml --profile ops run --rm migrate
```

The database service has no host port mapping and uses a separate data directory, so this package does not bind, stop, or change the existing PostgreSQL service on port 5432. The role-init script only runs for a fresh `data/postgres` directory. Changing password variables in `.env` does not rotate roles in an existing data directory. The migration command runs as `sp_migrator`, not as the database superuser or runtime app user; it is explicit and does not run on every application restart. Before later schema upgrades, run and verify a backup.

Create the first administrator through the existing stdin-only bootstrap CLI. It rejects a password supplied as a command argument. Run this from an interactive shell and use a strong, unique password:

```sh
read -r -s -p 'Administrator password: ' SP_ADMIN_PASSWORD
printf '\n'
printf '%s\n' "$SP_ADMIN_PASSWORD" | docker compose --env-file deploy/hakari/.env -f deploy/hakari/compose.yaml run --rm -T -e SP_BOOTSTRAP_USERNAME=admin app npm run service:bootstrap
unset SP_ADMIN_PASSWORD
```

Start the app and confirm internal liveness before enabling ingress:

```sh
docker compose --env-file deploy/hakari/.env -f deploy/hakari/compose.yaml up -d app
docker compose --env-file deploy/hakari/.env -f deploy/hakari/compose.yaml ps
```

The public `sp.jxcz.top` DNS record and inbound TCP/UDP 443 must be confirmed before starting Caddy. Then review the Caddyfile and enable its profile:

```sh
docker compose --env-file deploy/hakari/.env -f deploy/hakari/compose.yaml --profile https up -d caddy
./scripts/health-check.sh
```

The Caddy profile does not take over port 80. It cannot issue or renew a certificate through TLS-ALPN until the domain resolves publicly to this host and port 443 is reachable from the internet.

## Scheduled and off-site backups

The scheduled backup command runs the existing `npm run service:backup` entry in a one-shot app container. It writes a database dump, assets, and a manifest below `data/backups`; files are mode-restricted and remain on the Hakari disk. Enable a daily run in the deployment operator's crontab (for example, 03:17 server time):

```cron
17 3 * * * cd /opt/superior-point && ./scripts/backup.sh >> /var/log/superior-point-backup.log 2>&1
```

`scripts/backup.sh` prevents overlapping runs with `flock`. It returns failure if the local backup fails. For an encrypted off-site copy, install and configure Restic on the host, initialize its remote repository, then set `RESTIC_REPOSITORY` and `RESTIC_PASSWORD_FILE` in the scheduler environment; keep the password file and any backend credentials outside this repository with root-only access. The script runs `restic backup` only when that repository is configured. Without it, the script reports that the backup is local-only. Verify the remote repository with `restic check` as a separate scheduled maintenance task and alert on either local or remote failures. This package does not choose a provider or include credentials.

## Health and operations

`/health/live` is an unauthenticated process liveness check. `/health/ready` checks PostgreSQL and requires an administrator browser session (`source: web`); a Bearer personal access token is rejected. Check readiness from an authenticated admin browser session and do not expose this endpoint publicly. A successful liveness check alone does not prove database readiness, backups, restore, or service acceptance.

PostgreSQL data, assets, backups, and Caddy state persist below `data/`. The app container runs as the Node `node` user, and the database has no host port mapping. Never publish PostgreSQL or the app port directly. Inspect `docker compose logs app db caddy` for operational diagnosis; avoid printing environment values or credentials.

`SP_RESTORE_DATABASE_URL` is optional and must use the dedicated `sp_restore` role, which has `CREATEDB` but is not a PostgreSQL superuser. Its form is `postgresql://sp_restore:<SP_RESTORE_DB_PASSWORD>@db:5432/superior_point`. Keep it empty during normal operations; set it only when enabling the isolated restore verifier, then recreate the app container and clear it after the check. Do not substitute the initialization superuser URL. The web UI does not accept a target database URL.

Before a public cutover, verify actual host RAM/PSI under the running stack, firewall and 443 reachability, DNS A/AAAA, certificate issuance, login, a database-backed request, persistent restart behavior, and a tested backup restore. Keep the current Nginx service intact while checking the separate 443 route.

The Compose app explicitly enables `SP_TRUST_PROXY_HOPS=1` to count login attempts by the client forwarded by Caddy. The current Fastify version requires a custom one-hop callback; the default remains no proxy trust. This setting is valid only while the app has no public host port and all external requests enter through Caddy, which replaces untrusted forwarded headers.

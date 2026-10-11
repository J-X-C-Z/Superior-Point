# Hakari deployment package

As of 2026-10-11, the Alpha service is running on Hakari at `https://sp.jxcz.top`. DNS-only A record `8.138.195.143` and the Let's Encrypt certificate are active. Docker 29.9 and Compose 5.6 are installed; ingress added a TCP 443 security-group rule, and the existing services retained their PIDs. Public API acceptance passed (`work/deployment/public-acceptance.log`), SDK stdio → HTTPS → PostgreSQL MCP acceptance passed (`work/deployment/public-mcp-proof.log`), and Chrome read back MCP-written cloud text. Restarting the app and database containers preserved the project fingerprints (`work/deployment/container-restart.log`). These checks do not constitute a full host reboot rehearsal or final product release acceptance.

The running source is `61c9438d460e57be874180aebedb07da967a6a5a`, packaged at `/opt/superior-point/releases/61c9438`, with image `superior-point-app:61c9438` (`sha256:681e1721fced48859d00d799e1c971eb6d1c2b6b39cb2dd96829d4dbba2e959c`). Each versioned release contains code and deployment files; its `data` and `deploy/hakari/.env` links point to shared persistent state at `/opt/superior-point/shared/data` and `/opt/superior-point/shared/.env`. PostgreSQL, assets, backups directory, and Caddy state live under shared data, so application releases can change without moving that state.

The app listens on port 3000 inside Compose only. PostgreSQL 18 has no published port. Caddy is an optional `https` profile that binds only 443/TCP and UDP; its ACME issuer uses TLS-ALPN and disables HTTP-01 and HTTP redirects because Nginx owns port 80. ACME TLS-ALPN still requires public traffic on port 443 and correct public DNS. Caddy's challenge behavior follows its [official TLS issuer documentation](https://caddyserver.com/docs/caddyfile/directives/tls) and [Automatic HTTPS guidance](https://caddyserver.com/docs/caddyfile/options).

The app image builds on Linux from the repository files and runs `npm ci` there, so macOS `node_modules` are never copied into the image. Its Dockerfile-specific ignore file is `deploy/hakari/Dockerfile.dockerignore`; its name matches Docker's documented per-Dockerfile ignore convention, and it excludes `.env` files and local `node_modules` from the build context ([Docker documentation](https://docs.docker.com/build/concepts/context/)). The image keeps the existing TypeScript runtime entry (`tsx`) and includes PostgreSQL 18 client tools for backup and restore.

PostgreSQL creates four distinct identities on first initialization: `sp_pg_admin` is the database-container initialization superuser, `sp_migrator` owns the application database/schema and is used only by the one-shot migration service, `sp_app` has runtime DML rights, and `sp_restore` can create isolated restore-check databases. The app never receives the PostgreSQL initialization superuser credential. The initialization script runs only when `data/postgres` is empty; it does not retrofit an existing data directory. Do not delete an existing database directory to force initialization.

Image memory caps are 384 MiB for the app and 128 MiB for PostgreSQL, with PostgreSQL tuned for a small host. These are limits, not proof the workload fits. A pre-deployment snapshot recorded 459 MiB available; recheck actual memory pressure before final acceptance.

## Prepare and start

Run these commands from the versioned release directory (currently `/opt/superior-point/releases/61c9438`), not the deployment root. Its `data` and `.env` links must target the shared paths described above. Preserve the existing `/opt/superior-point/shared/.env`; copy the example only when creating the shared environment file for a fresh installation:

```sh
test -e /opt/superior-point/shared/.env || cp deploy/hakari/.env.example /opt/superior-point/shared/.env
chmod 600 /opt/superior-point/shared/.env
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
docker compose -p superior-point --env-file deploy/hakari/.env -f deploy/hakari/compose.yaml build app
docker compose -p superior-point --env-file deploy/hakari/.env -f deploy/hakari/compose.yaml up -d db
docker compose -p superior-point --env-file deploy/hakari/.env -f deploy/hakari/compose.yaml --profile ops run --rm migrate
```

The database service has no host port mapping and uses a separate data directory, so this package does not bind, stop, or change the existing PostgreSQL service on port 5432. The role-init script only runs for a fresh `data/postgres` directory. Changing password variables in `.env` does not rotate roles in an existing data directory. The migration command runs as `sp_migrator`, not as the database superuser or runtime app user; it is explicit and does not run on every application restart. Production backups are deferred by user decision, so every schema migration must remain compatible with both the current and immediately preceding app release; app rollback does not undo a database migration.

Create the first administrator through the existing stdin-only bootstrap CLI. It rejects a password supplied as a command argument. Run this from an interactive shell and use a strong, unique password:

```sh
read -r -s -p 'Administrator password: ' SP_ADMIN_PASSWORD
printf '\n'
printf '%s\n' "$SP_ADMIN_PASSWORD" | docker compose -p superior-point --env-file deploy/hakari/.env -f deploy/hakari/compose.yaml run --rm -T -e SP_BOOTSTRAP_USERNAME=admin app npm run service:bootstrap
unset SP_ADMIN_PASSWORD
```

Start the app and confirm internal liveness before enabling ingress:

```sh
docker compose -p superior-point --env-file deploy/hakari/.env -f deploy/hakari/compose.yaml up -d app
docker compose -p superior-point --env-file deploy/hakari/.env -f deploy/hakari/compose.yaml ps
```

The public `sp.jxcz.top` DNS record and inbound TCP/UDP 443 must be confirmed before starting Caddy. Then review the Caddyfile and enable its profile:

```sh
docker compose -p superior-point --env-file deploy/hakari/.env -f deploy/hakari/compose.yaml --profile https up -d caddy
./scripts/health-check.sh
```

The Caddy profile does not take over port 80. It uses TLS-ALPN for certificate issuance and renewal; the current certificate has been issued successfully.

## Application rollback

Keep each release directory and its matching image tag available until the new release is accepted. To roll back application code, select a previously verified release and its matching local image, then run Compose from that release directory. First confirm the release links still point to shared state and the image ID matches the recorded digest:

```sh
PREVIOUS_RELEASE='<verified-release-id>'
PREVIOUS_IMAGE_TAG='<matching-image-tag>'
cd "/opt/superior-point/releases/$PREVIOUS_RELEASE"
test "$(readlink -f data)" = /opt/superior-point/shared/data
test "$(readlink -f deploy/hakari/.env)" = /opt/superior-point/shared/.env
docker image inspect "superior-point-app:$PREVIOUS_IMAGE_TAG" --format '{{.Id}}'
```

After confirming the printed image ID against the saved digest for that release, recreate only the app with the existing Compose project name; leave PostgreSQL, Caddy, and shared data in place:

```sh
SP_IMAGE_TAG="$PREVIOUS_IMAGE_TAG" docker compose -p superior-point --env-file deploy/hakari/.env -f deploy/hakari/compose.yaml up -d --no-deps app
docker compose -p superior-point --env-file deploy/hakari/.env -f deploy/hakari/compose.yaml ps app db caddy
curl --fail https://sp.jxcz.top/health/live
```

Do not delete, replace, or restore `/opt/superior-point/shared/data` during an application rollback. Do not roll the app back across a schema change unless that migration was designed to remain compatible with the previous release. The production backup and restore path has not been accepted, so there is no documented database rollback procedure.

## Backups deferred

Production backups are deferred by the current user decision (“先不备份”). Do not install or enable a scheduler, invoke the backup runtime, or configure Restic for this deployment. No backup or restore acceptance is claimed; revisit the backup decision before relying on production recovery or performing future data-risking operations.

## Health and operations

`/health/live` is an unauthenticated process liveness check. `/health/ready` checks PostgreSQL and requires an administrator browser session (`source: web`); a Bearer personal access token is rejected. Check readiness from an authenticated admin browser session and do not expose this endpoint publicly. A successful liveness check alone does not prove database readiness, backups, restore, or service acceptance.

PostgreSQL data, assets, backups, and Caddy state persist below `data/`. The app container runs as the Node `node` user, and the database has no host port mapping. Never publish PostgreSQL or the app port directly. Inspect `docker compose logs app db caddy` for operational diagnosis; avoid printing environment values or credentials.

`SP_RESTORE_DATABASE_URL` is optional and must use the dedicated `sp_restore` role, which has `CREATEDB` but is not a PostgreSQL superuser. Its form is `postgresql://sp_restore:<SP_RESTORE_DB_PASSWORD>@db:5432/superior_point`. Keep it empty during normal operations; set it only when enabling the isolated restore verifier, then recreate the app container and clear it after the check. Do not substitute the initialization superuser URL. The web UI does not accept a target database URL.

Before final production acceptance, verify actual host RAM/PSI under the running stack and complete a full host reboot rehearsal. A tested production backup restore remains unaccepted by user decision; the Alpha pre-release retains these unaccepted scope items. Keep the current Nginx service intact.

The Compose app explicitly enables `SP_TRUST_PROXY_HOPS=1` to count login attempts by the client forwarded by Caddy. The current Fastify version requires a custom one-hop callback; the default remains no proxy trust. This setting is valid only while the app has no public host port and all external requests enter through Caddy, which replaces untrusted forwarded headers.

The stable operator path `/opt/superior-point/current` points to the running version. The previous app image `superior-point-app:4cb41ea` is retained for an app-only rollback. The current Alpha app and previous image use the same migrations; no production schema migration or backup ran during this version cutover.

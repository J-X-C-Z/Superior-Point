#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

env_file=deploy/hakari/.env
compose_file=deploy/hakari/compose.yaml
if [ ! -r "$env_file" ]; then
  printf 'Missing %s\n' "$env_file" >&2
  exit 2
fi
if ! command -v flock >/dev/null 2>&1; then
  printf 'flock is required to prevent overlapping backup jobs.\n' >&2
  exit 2
fi

if flock -n -E 75 /tmp/superior-point-backup.lock \
  docker compose --env-file "$env_file" -f "$compose_file" --profile ops run --rm backup; then
  :
else
  status=$?
  if [ "$status" -eq 75 ]; then
    printf 'Backup skipped; another scheduled backup is running.\n'
    exit 0
  fi
  exit "$status"
fi

if [ -z "${RESTIC_REPOSITORY:-}" ]; then
  printf 'Off-site backup not configured; the completed local backup remains in data/backups.\n'
  exit 0
fi
if ! command -v restic >/dev/null 2>&1 || [ -z "${RESTIC_PASSWORD_FILE:-}" ] || [ ! -r "$RESTIC_PASSWORD_FILE" ]; then
  printf 'Off-site backup needs host-installed restic, RESTIC_REPOSITORY, and a readable RESTIC_PASSWORD_FILE.\n' >&2
  exit 2
fi

restic backup "$repo_root/data/backups" --tag superior-point

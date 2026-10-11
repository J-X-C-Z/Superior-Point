#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

url=${SP_HEALTH_URL:-https://sp.jxcz.top/health/live}
if ! command -v curl >/dev/null 2>&1; then
  printf 'curl is required for the external liveness check.\n' >&2
  exit 2
fi

printf 'Checking public liveness endpoint: %s\n' "$url"
curl --fail --silent --show-error --max-time 10 "$url"
printf '\nLiveness check passed. This does not check authenticated readiness or database-backed requests.\n'

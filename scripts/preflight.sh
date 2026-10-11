#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

printf 'Host: %s (%s)\n' "$(uname -s)" "$(uname -m)"
if [ -r /proc/meminfo ]; then
  awk '/MemTotal:|MemAvailable:/ {printf "%s: %.0f MiB\n", $1, $2 / 1024}' /proc/meminfo
fi
if [ -r /proc/pressure/memory ]; then
  printf 'Memory pressure:\n'
  cat /proc/pressure/memory
fi
df -h .

if command -v docker >/dev/null 2>&1; then
  docker --version
  if docker compose version; then
    :
  else
    printf 'Docker Compose plugin: missing or unusable\n'
  fi
  if docker info --format 'Docker daemon: {{.ServerVersion}}' 2>/dev/null; then
    :
  else
    printf 'Docker daemon: unavailable to this user\n'
  fi
else
  printf 'Docker: missing\n'
fi

if command -v ss >/dev/null 2>&1; then
  if ss -H -ltn '( sport = :443 )' | grep -q .; then
    printf 'Port 443/tcp: occupied\n'
  else
    printf 'Port 443/tcp: free\n'
  fi
  if ss -H -lun '( sport = :443 )' | grep -q .; then
    printf 'Port 443/udp: occupied\n'
  else
    printf 'Port 443/udp: free\n'
  fi
  if ss -H -ltn '( sport = :80 )' | grep -q .; then
    printf 'Port 80/tcp: occupied (this package does not publish it)\n'
  else
    printf 'Port 80/tcp: free\n'
  fi
  if ss -H -ltn '( sport = :5432 )' | grep -q .; then
    printf 'Port 5432/tcp: occupied (this package does not publish it)\n'
  else
    printf 'Port 5432/tcp: free\n'
  fi
else
  printf 'Port check: ss unavailable\n'
fi

if command -v getent >/dev/null 2>&1; then
  if getent ahosts sp.jxcz.top >/dev/null 2>&1; then
    printf 'DNS sp.jxcz.top: resolves on this host\n'
  else
    printf 'DNS sp.jxcz.top: unresolved on this host\n'
  fi
else
  printf 'DNS sp.jxcz.top: getent unavailable; not checked\n'
fi

if [ -f deploy/hakari/.env ]; then
  if docker compose --env-file deploy/hakari/.env -f deploy/hakari/compose.yaml config -q; then
    printf 'Compose config: valid\n'
  else
    printf 'Compose config: invalid\n' >&2
    exit 1
  fi
else
  printf 'Compose config: not checked (deploy/hakari/.env is absent)\n'
fi

printf 'Preflight is read-only; resolve missing prerequisites before deployment.\n'

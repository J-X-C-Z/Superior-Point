#!/usr/bin/env python3
"""Read Linux host counters and atomically publish only bounded numeric metrics."""
import argparse
import datetime
import json
import os
from pathlib import Path
import tempfile
import subprocess
import time

def cpu():
    values = list(map(int, Path('/proc/stat').read_text().splitlines()[0].split()[1:]))
    # guest counters are already included in user/nice.
    return sum(values[:8]), values[3] + values[4]

def collect():
    before = cpu()
    time.sleep(0.1)
    after = cpu()
    delta = after[0] - before[0]
    memory = {}
    for line in Path('/proc/meminfo').read_text().splitlines():
        key, value = line.split(':', 1)
        if key in ('MemTotal', 'MemAvailable'):
            memory[key] = int(value.split()[0]) * 1024
    disk = os.statvfs('/')
    return {'source': 'hakari-host', 'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'cpu': {'percent': max(0, min(100, (1 - (after[1] - before[1]) / delta) * 100)) if delta else 0},
            'memory': {'totalBytes': memory['MemTotal'], 'availableBytes': memory['MemAvailable']},
            'disk': {'totalBytes': disk.f_blocks * disk.f_frsize, 'availableBytes': disk.f_bavail * disk.f_frsize}}

CONTAINERS = ('superior-point-app-1', 'superior-point-db-1', 'superior-point-caddy-1')
STATES = ('created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead')
HEALTH = ('none', 'starting', 'healthy', 'unhealthy')
INSPECT_FORMAT = '{"state":{{json .State.Status}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"none"{{end}},"restartCount":{{.RestartCount}},"oomKilled":{{.State.OOMKilled}}}'

def collect_containers():
    rows = []
    for name in CONTAINERS:
        try:
            result = subprocess.run(['/usr/bin/docker', '--host=unix:///var/run/docker.sock', 'inspect', '--type=container', '--format', INSPECT_FORMAT, name], capture_output=True, text=True, check=True, timeout=5)
            value = json.loads(result.stdout)
            if not isinstance(value, dict):
                raise ValueError('Invalid fixed-container counters')
            if value.get('state') not in STATES or value.get('health') not in HEALTH or type(value.get('restartCount')) is not int or not 0 <= value['restartCount'] <= 9007199254740991 or type(value.get('oomKilled')) is not bool:
                raise ValueError('Invalid fixed-container counters')
            rows.append({'name': name, 'status': 'ok', 'state': value['state'], 'health': value['health'], 'restartCount': value['restartCount'], 'oomKilled': value['oomKilled']})
        except (OSError, subprocess.SubprocessError, ValueError, TypeError):
            rows.append({'name': name, 'status': 'unavailable'})
    return {'source': 'hakari-fixed-docker-inspect', 'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'rows': rows}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    parser.add_argument('--containers', action='store_true', help='Inspect only the three fixed Superior Point containers; host operator permissions required')
    args = parser.parse_args()
    data = collect()
    if args.containers:
        data['containers'] = collect_containers()
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=args.output.parent, prefix='.metrics-', delete=False) as stream:
            temporary = stream.name
            json.dump(data, stream, separators=(',', ':'))
        os.chmod(temporary, 0o644)
        os.replace(temporary, args.output)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)

if __name__ == '__main__':
    main()

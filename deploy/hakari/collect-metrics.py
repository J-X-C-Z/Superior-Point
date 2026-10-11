#!/usr/bin/env python3
"""Read Linux host counters and atomically publish only bounded numeric metrics."""
import argparse
import datetime
import json
import os
from pathlib import Path
import tempfile
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

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    data = collect()
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

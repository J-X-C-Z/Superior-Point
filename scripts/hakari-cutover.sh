#!/bin/sh
# Run from an immutable, reviewed release directory on Hakari after Linux image build and CI.
set -eu
candidate=$(pwd -P)
case "$candidate" in /opt/superior-point/releases/*) ;; *) echo 'Run from the Hakari release directory' >&2; exit 1;; esac
release=$(basename "$candidate")
case "$release" in *[!a-f0-9]*|'') echo 'Invalid release identity' >&2; exit 1;; esac
test "$(readlink -f data)" = /opt/superior-point/shared/data
test "$(readlink -f deploy/hakari/.env)" = /opt/superior-point/shared/.env
previous=$(readlink -f /opt/superior-point/current)
previous_image=$(docker inspect superior-point-app-1 --format '{{.Config.Image}}')
test "$(docker image inspect "superior-point-app:$release" --format '{{.Architecture}}')" = amd64
compose(){ SP_IMAGE_TAG="$release" docker compose -p superior-point --env-file deploy/hakari/.env -f deploy/hakari/compose.yaml "$@"; }
compose config -q
# Fail before DDL if any previously applied migration differs from the candidate source.
compose --profile ops run --rm -T --no-deps --entrypoint node migrate --input-type=module -e '
import pg from "pg";import {readFile} from "node:fs/promises";import {createHash} from "node:crypto";
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
try{for(const row of (await db.query("SELECT version,checksum FROM schema_migrations ORDER BY version")).rows){if(!/^\d+_[\w-]+\.sql$/.test(row.version))throw Error("Invalid migration identity");const sql=await readFile("server/db/migrations/"+row.version);if(createHash("sha256").update(sql).digest("hex")!==row.checksum)throw Error("Applied migration mismatch: "+row.version);}console.log("Applied migration checksums match");}finally{await db.end();}'
mkdir -p /opt/superior-point/logs
snapshot='import pg from "pg";const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();try{console.log(JSON.stringify((await db.query("SELECT id,revision,md5(document_jsonb::text) AS fingerprint FROM projects ORDER BY id")).rows));}finally{await db.end();}'
docker exec superior-point-app-1 node --input-type=module -e "$snapshot" > "/opt/superior-point/logs/$release-before.json"
# Only additive migrations are approved while production backups remain deferred.
compose --profile ops run --rm -T --no-deps migrate
rollback(){
 tag=${previous_image#superior-point-app:}
 (cd "$previous" && SP_IMAGE_TAG="$tag" docker compose -p superior-point --env-file deploy/hakari/.env -f deploy/hakari/compose.yaml up -d --no-deps app)
 python3 - "$tag" <<'PY'
import pathlib,sys
p=pathlib.Path('/opt/superior-point/shared/.env');lines=[line for line in p.read_text().splitlines() if not line.startswith('SP_IMAGE_TAG=')];lines.append('SP_IMAGE_TAG='+sys.argv[1]);p.write_text('\n'.join(lines)+'\n');p.chmod(0o600)
PY
 ln -sfn "$previous" /opt/superior-point/current
 echo 'Previous app restored; additive database tables retained' >&2
}
changed=true
on_failure(){ status=$?;trap - EXIT INT TERM;if [ "$status" -ne 0 ] && [ "$changed" = true ];then rollback || echo 'App rollback failed; manual recovery required' >&2;fi;exit "$status"; }
trap on_failure EXIT
trap 'exit 1' INT TERM
compose up -d --no-deps app
healthy=false
for attempt in $(seq 1 45);do
 if [ "$(docker inspect superior-point-app-1 --format '{{.State.Health.Status}}')" = healthy ];then healthy=true;break;fi
 sleep 1
done
if [ "$healthy" != true ];then exit 1;fi
docker exec superior-point-app-1 node --input-type=module -e "$snapshot" > "/opt/superior-point/logs/$release-after.json"
python3 - "$release" <<'PY'
import json,pathlib,sys
release=sys.argv[1];root=pathlib.Path('/opt/superior-point/logs')
before=json.loads((root/(release+'-before.json')).read_text());after={r['id']:r for r in json.loads((root/(release+'-after.json')).read_text())}
for old in before:
 new=after.get(old['id']);assert new and new['revision']>=old['revision'],'Existing project missing or revision regressed'
 if new['revision']==old['revision']:assert new['fingerprint']==old['fingerprint'],'Unchanged revision content changed'
print('Existing projects preserved:',len(before))
PY
python3 - "$release" <<'PY'
import pathlib,sys
p=pathlib.Path('/opt/superior-point/shared/.env');lines=p.read_text().splitlines();lines=[line for line in lines if not line.startswith('SP_IMAGE_TAG=')];lines.append('SP_IMAGE_TAG='+sys.argv[1]);p.write_text('\n'.join(lines)+'\n');p.chmod(0o600)
PY
ln -sfn "$candidate" /opt/superior-point/current
changed=false
trap - EXIT INT TERM
docker inspect superior-point-app-1 --format 'running={{.Config.Image}} digest={{.Image}} OOM={{.State.OOMKilled}} restarts={{.RestartCount}}'

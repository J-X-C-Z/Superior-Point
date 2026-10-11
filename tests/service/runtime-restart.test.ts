import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {createServer, type AddressInfo} from 'node:net';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {AuthService} from '../../server/auth/auth-service.js';
import {createTestDatabase, cleanupTestDatabase} from './helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  assert.notEqual(port, 3027);
  return port;
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null) {assert.equal(child.exitCode, 0); return;}
  const exited = once(child, 'exit');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  child.kill('SIGTERM');
  try {
    const [code, signal] = await exited;
    assert.equal(signal, null, 'Server must exit gracefully after SIGTERM');
    assert.equal(code, 0, 'Server graceful shutdown must exit 0');
  } finally {clearTimeout(timeout);}
}
async function start(database: string, origin: string, port: number) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/start.ts'], {
    cwd: root,
    env: {...process.env, DATABASE_URL: database, SP_DEV_HTTP: '1', SP_BIND: '127.0.0.1', SP_PORT: String(port), SP_ORIGIN: origin, SP_BACKUP_DIR: '', SP_ASSET_DIR: '', SP_RESTORE_DATABASE_URL: ''},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr!.resume();
  try {
    await new Promise<void>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(Error('Runtime readiness exceeded 15 seconds')), 15000);
      const ready = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-1024);
        if (output.includes('SP foundation API listening at ' + origin)) {clearTimeout(timer); resolve();}
      };
      child.stdout!.on('data', ready);
      child.once('error', error => {clearTimeout(timer); reject(error);});
      child.once('exit', (code, signal) => {clearTimeout(timer); reject(Error(`Runtime exited before readiness: ${code ?? signal}`));});
    });
    const health = await fetch(origin + '/health/live', {signal: AbortSignal.timeout(3000)});
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {status: 'ok'});
    return child;
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) await stop(child);
    throw error;
  }
}

test('real service SIGTERM/restart preserves old browser session, canonical document, CAS and mutation receipts', {timeout: 60000}, async () => {
  const db = await createTestDatabase();
  let child: ChildProcess | undefined;
  try {
    const schema = (await db.query('SELECT current_schema() AS name')).rows[0].name as string;
    assert.match(schema, /^sp_test_[a-f0-9]+$/);
    const database = new URL(process.env.TEST_DATABASE_URL!);
    database.searchParams.set('options', `-c search_path=${schema},public`);
    const password = 'runtime-restart-only-password!';
    const admin = await new AuthService(db).bootstrapAdmin('runtime-admin', password);
    const port = await freePort(), origin = `http://127.0.0.1:${port}`;
    child = await start(database.toString(), origin, port);
    const firstPid = child.pid;
    const login = await fetch(origin + '/api/v1/auth/login', {method: 'POST', headers: {origin, 'content-type': 'application/json'}, body: JSON.stringify({username: admin.username, password}), signal: AbortSignal.timeout(10000)});
    assert.equal(login.status, 200);
    const session = await login.json() as {user: {id: string}; csrfToken: string};
    const cookie = login.headers.get('set-cookie');
    assert.ok(cookie);
    const headers = {origin, 'content-type': 'application/json', cookie: cookie.split(';')[0], 'x-csrf-token': session.csrfToken};
    async function request(path: string, method = 'GET', body?: unknown) {
      const response = await fetch(origin + '/api/v1' + path, {method, headers, ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(10000)});
      return {status: response.status, body: await response.json()};
    }
    const created = await request('/projects', 'POST', {title: 'Runtime persistence acceptance'});
    assert.equal(created.status, 201);
    const id = created.body.id as string;
    const firstMutation = {
      expectedRevision: 0, clientMutationId: 'runtime-before-restart',
      operations: [{type: 'createSlide', slide: {id: 'persisted-slide', elements: [{id: 'persisted-text', type: 'text', x: 10, y: 10, w: 400, h: 80, text: '真实 HTTP 保存内容：重启后保持不变'}]}}],
    };
    const saved = await request(`/projects/${id}/document`, 'PATCH', firstMutation);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.revision, 1);
    await stop(child); child = undefined;
    child = await start(database.toString(), origin, port);
    assert.notEqual(child.pid, firstPid, 'Acceptance requires a new operating-system process');
    const identity = await request('/auth/me');
    assert.equal(identity.status, 200, 'Old browser cookie must remain valid across process restart');
    assert.equal(identity.body.user.id, admin.id);
    const persisted = await request(`/projects/${id}/document`);
    assert.equal(persisted.status, 200);
    assert.deepEqual(persisted.body, saved.body, 'Whole canonical document must persist unchanged');
    const receipt = await request(`/projects/${id}/document`, 'PATCH', firstMutation);
    assert.equal(receipt.status, 200);
    assert.deepEqual(receipt.body, saved.body, 'Existing mutation receipt must prevent duplicate application after restart');
    const stale = await request(`/projects/${id}/document`, 'PATCH', {...firstMutation, clientMutationId: 'runtime-stale-after-restart'});
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'REVISION_CONFLICT');
    const next = await request(`/projects/${id}/document`, 'PATCH', {expectedRevision: 1, clientMutationId: 'runtime-after-restart', operations: [{type: 'updateElement', slideId: 'persisted-slide', elementId: 'persisted-text', properties: {text: '重启后旧会话与 CSRF 可继续保存'}}]});
    assert.equal(next.status, 200);
    assert.equal(next.body.revision, 2);
    const reread = await request(`/projects/${id}/document`);
    assert.deepEqual(reread.body, next.body);
    assert.equal(reread.body.slides[0].elements[0].text, '重启后旧会话与 CSRF 可继续保存');
    assert.equal((await db.query('SELECT count(*)::int AS count FROM project_revisions WHERE project_id=$1', [id])).rows[0].count, 3);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM mutation_receipts WHERE project_id=$1', [id])).rows[0].count, 2);
  } finally {
    try {if (child) await stop(child);} finally {await cleanupTestDatabase(db);}
  }
});

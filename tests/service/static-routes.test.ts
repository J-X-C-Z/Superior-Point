import assert from 'node:assert/strict';
import test from 'node:test';
import {buildApp} from '../../server/app.js';
import {AuthService} from '../../server/auth/auth-service.js';
import {createTestDatabase, cleanupTestDatabase} from './helpers.js';

const origin = 'http://127.0.0.1:3000';
const password = 'static-http-test-password!';
async function setup() {
  const db = await createTestDatabase();
  const app = buildApp({db, origin, secureCookies: false});
  const adminUser = await new AuthService(db).bootstrapAdmin('admin', password);
  async function login(username: string) {
    const response = await app.inject({method: 'POST', url: '/api/v1/auth/login', headers: {origin}, payload: {username, password}});
    assert.equal(response.statusCode, 200, response.body);
    return {origin, cookie: String(response.headers['set-cookie']).split(';')[0], 'x-csrf-token': response.json().csrfToken as string};
  }
  const admin = await login('admin');
  const created = await app.inject({method: 'POST', url: '/api/v1/admin/users', headers: admin, payload: {username: 'ordinary', password}});
  assert.equal(created.statusCode, 201, created.body);
  const user = await login('ordinary');
  return {db, app, admin, adminUser, user, close: async () => {await app.close(); await cleanupTestDatabase(db);}};
}

test('HTTP app HTML resolves real static JS/CSS with correct MIME types after repository root normalization', async () => {
  const h = await setup();
  try {
    const page = await h.app.inject('/app');
    assert.equal(page.statusCode, 200, page.body);
    assert.match(String(page.headers['content-type']), /^text\/html/);
    assert.match(page.body, /href="\/web\/style\.css"/);
    assert.match(page.body, /src="\/web\/entry\.js"/);
    const javascript = await h.app.inject('/web/entry.js');
    assert.equal(javascript.statusCode, 200, javascript.body);
    assert.match(String(javascript.headers['content-type']), /^text\/javascript/);
    assert.match(javascript.body, /import/);
    const stylesheet = await h.app.inject('/web/style.css');
    assert.equal(stylesheet.statusCode, 200, stylesheet.body);
    assert.match(String(stylesheet.headers['content-type']), /^text\/css/);
    assert.match(stylesheet.body, /--paper:/);
    for (const url of ['/web/', '/storage/cloud-project-store.js', '/core/document-core.js', '/web/admin/app.js', '/web/admin/style.css']) {
      const asset = await h.app.inject(url);
      assert.equal(asset.statusCode, 200, `${url}: ${asset.body}`);
    }
  } finally {await h.close();}
});

test('HTTP both admin HTML entry paths enforce ordinary-user denial and unauthenticated redirect', async () => {
  const h = await setup();
  try {
    for (const url of ['/admin', '/web/admin/index.html', '/web/admin/']) {
      const anonymous = await h.app.inject(url);
      assert.equal(anonymous.statusCode, 302, url);
      assert.equal(anonymous.headers.location, '/login');
      const ordinary = await h.app.inject({url, headers: h.user});
      assert.equal(ordinary.statusCode, 403, `${url}: ${ordinary.body}`);
      const admin = await h.app.inject({url, headers: h.admin});
      assert.equal(admin.statusCode, 200, `${url}: ${admin.body}`);
      assert.match(String(admin.headers['content-type']), /^text\/html/);
      assert.match(admin.body, /data-admin-root/);
      assert.match(admin.body, /\/web\/admin\/app\.js/);
    }
    const authorization = await h.app.inject({method: 'POST', url: '/api/v1/me/tokens', headers: h.admin, payload: {name: 'admin PAT'}});
    assert.equal(authorization.statusCode, 201, authorization.body);
    const denied = await h.app.inject({url: '/admin', headers: {authorization: 'Bearer ' + authorization.json().token}});
    assert.equal(denied.statusCode, 403);
  } finally {await h.close();}
});

test('HTTP static allowlist rejects private server files and encoded path traversal', async () => {
  const h = await setup();
  try {
    for (const url of ['/server/.env', '/server/app.ts', '/.env', '/web/../server/app.ts', '/web/%2e%2e/server/.env', '/web/%2e%2e/server/app.ts', '/web/%2E%2E%2Fserver%2Fapp.ts', '/web/%2e%2e/%2e%2e/etc/passwd', '/web/%5c..%5cserver%5c.env', '/web/%00style.css']) {
      const response = await h.app.inject({url, headers: h.admin});
      assert.ok([400, 404].includes(response.statusCode), `${url}: ${response.statusCode}`);
      assert.doesNotMatch(response.body, /import Fastify|DATABASE_URL=|root:x:/);
    }
  } finally {await h.close();}
});

test('HTTP maintenance and upload policy enforce actual project requests without leaking private public config', async () => {
  const h = await setup();
  try {
    await h.db.query("INSERT INTO system_settings(key,value,updated_by) VALUES('privateDatabaseSecret','\"TEST_PRIVATE_CONFIG_VALUE\"',$1)", [h.adminUser.id]);
    const setting = await h.app.inject({method: 'PATCH', url: '/api/v1/admin/settings', headers: h.admin, payload: {siteName: 'HTTP test site', announcement: 'Maintenance notice', maintenanceMode: true, maxUploadBytes: 64}});
    assert.equal(setting.statusCode, 200, setting.body);
    const config = await h.app.inject('/api/v1/public/config');
    assert.equal(config.statusCode, 200);
    assert.deepEqual(config.json(), {siteName: 'HTTP test site', announcement: 'Maintenance notice', maintenanceMode: true});
    assert.doesNotMatch(config.body, /TEST_PRIVATE_CONFIG_VALUE|privateDatabaseSecret|maxUploadBytes|password|session|token|backup|DATABASE_URL/);
    const maintained = await h.app.inject({method: 'POST', url: '/api/v1/projects', headers: h.user, payload: {title: 'blocked'}});
    assert.equal(maintained.statusCode, 503, maintained.body);
    assert.equal(maintained.json().error.code, 'MAINTENANCE_MODE');
    const adminWrite = await h.app.inject({method: 'POST', url: '/api/v1/projects', headers: h.admin, payload: {title: 'allowed'}});
    assert.equal(adminWrite.statusCode, 201, adminWrite.body);
    const authorization = await h.app.inject({method: 'POST', url: '/api/v1/me/tokens', headers: h.admin, payload: {name: 'admin PAT'}});
    assert.equal(authorization.statusCode, 201);
    const patWrite = await h.app.inject({method: 'POST', url: '/api/v1/projects', headers: {authorization: 'Bearer ' + authorization.json().token}, payload: {title: 'blocked'}});
    assert.equal(patWrite.statusCode, 503, patWrite.body);
    const reopened = await h.app.inject({method: 'PATCH', url: '/api/v1/admin/settings', headers: h.admin, payload: {maintenanceMode: false}});
    assert.equal(reopened.statusCode, 200, reopened.body);
    const oversized = await h.app.inject({method: 'POST', url: '/api/v1/projects', headers: h.user, payload: {title: 'x'.repeat(100)}});
    assert.equal(oversized.statusCode, 413, oversized.body);
    assert.equal(oversized.json().error.code, 'PAYLOAD_TOO_LARGE');
    assert.equal((await h.db.query('SELECT count(*)::int AS count FROM projects')).rows[0].count, 1);
    const withinLimit = await h.app.inject({method: 'POST', url: '/api/v1/projects', headers: h.user, payload: {title: 'ok'}});
    assert.equal(withinLimit.statusCode, 201, withinLimit.body);
  } finally {await h.close();}
});

test('HTTP sensitive admin writes require recent password verification and stale sessions fail after revocation', async () => {
  const h = await setup();
  try {
    await h.db.query("UPDATE sessions SET reauth_until=clock_timestamp()-interval '1 second' WHERE user_id=$1", [h.adminUser.id]);
    const denied = await h.app.inject({method: 'PATCH', url: '/api/v1/admin/settings', headers: h.admin, payload: {siteName: 'needs reauth'}});
    assert.equal(denied.statusCode, 403, denied.body);
    assert.equal(denied.json().error.code, 'REAUTHENTICATION_REQUIRED');
    assert.equal((await h.app.inject({url: '/api/v1/admin/dashboard', headers: h.admin})).statusCode, 200);
    const wrong = await h.app.inject({method: 'POST', url: '/api/v1/auth/reauth', headers: h.admin, payload: {password: 'wrong'}});
    assert.equal(wrong.statusCode, 401, wrong.body);
    const correct = await h.app.inject({method: 'POST', url: '/api/v1/auth/reauth', headers: h.admin, payload: {password}});
    assert.equal(correct.statusCode, 200, correct.body);
    const accepted = await h.app.inject({method: 'PATCH', url: '/api/v1/admin/settings', headers: h.admin, payload: {siteName: 'verified'}});
    assert.equal(accepted.statusCode, 200, accepted.body);
    const logout = await h.app.inject({method: 'POST', url: '/api/v1/auth/logout', headers: h.admin});
    assert.equal(logout.statusCode, 200, logout.body);
    assert.equal((await h.app.inject({url: '/api/v1/admin/dashboard', headers: h.admin})).statusCode, 401);
  } finally {await h.close();}
});

test('HTTP rotated CSRF returns explicit safe-retry code and new CSRF succeeds', async () => {
  const h = await setup();
  try {
    const rotated = await h.app.inject({method: 'POST', url: '/api/v1/auth/csrf', headers: {cookie: h.user.cookie, origin}});
    assert.equal(rotated.statusCode, 200, rotated.body);
    const old = await h.app.inject({method: 'POST', url: '/api/v1/projects', headers: h.user, payload: {title: 'old CSRF'}});
    assert.equal(old.statusCode, 403, old.body);
    assert.equal(old.json().error.code, 'CSRF_INVALID');
    assert.equal((await h.db.query('SELECT count(*)::int AS count FROM projects')).rows[0].count, 0);
    const fresh = await h.app.inject({method: 'POST', url: '/api/v1/projects', headers: {...h.user, 'x-csrf-token': rotated.json().csrfToken}, payload: {title: 'fresh CSRF'}});
    assert.equal(fresh.statusCode, 201, fresh.body);
  } finally {await h.close();}
});

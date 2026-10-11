#!/usr/bin/env node
import {randomBytes, randomUUID} from 'node:crypto';

const origin = process.env.SP_ACCEPT_ORIGIN;
const adminUser = process.env.SP_ACCEPT_ADMIN_USER;
const adminPassword = process.env.SP_ACCEPT_ADMIN_PASSWORD;
const allowLocalHttp = process.env.SP_ACCEPT_ALLOW_HTTP_LOCALHOST === '1';
const checks = {};
let stage = 'configuration';
let revokeOutstandingPat;

function fail(message) { throw new Error(message); }
function check(condition, message) { if (!condition) fail(message); }
function codeOf(payload) { return payload?.error?.code; }
async function request(path, {method = 'GET', body, session, bearer} = {}) {
  const headers = {accept: 'application/json'};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (session) {
    headers.cookie = session.cookie;
    if (session.csrf) headers['x-csrf-token'] = session.csrf;
  }
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (body !== undefined) headers.origin = origin;
  const response = await fetch(new URL(path, origin), {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = null; }
  return {status: response.status, payload, headers: response.headers};
}
function expect(result, status, label) {
  check(result.status === status, `${label}: expected HTTP ${status}, got ${result.status}${codeOf(result.payload) ? ` (${codeOf(result.payload)})` : ''}`);
  return result.payload;
}
async function login(username, password) {
  const result = await request('/api/v1/auth/login', {method: 'POST', body: {username, password}});
  const payload = expect(result, 200, 'login');
  const setCookie = result.headers.get('set-cookie') ?? '';
  const cookie = setCookie.split(';', 1)[0];
  check(/^(?:__Host-sp-session|sp-session)=\S+$/.test(cookie), 'login did not issue a session cookie');
  if (new URL(origin).protocol === 'https:') check(/\bSecure\b/i.test(setCookie), 'HTTPS session cookie is not Secure');
  check(typeof payload?.csrfToken === 'string' && payload.csrfToken.length > 0, 'login did not issue a CSRF token');
  return {cookie, csrf: payload.csrfToken};
}
async function rotateCsrf(session) {
  const result = await request('/api/v1/auth/csrf', {method: 'POST', session, body: {}});
  const payload = expect(result, 200, 'CSRF rotation');
  check(typeof payload?.csrfToken === 'string' && payload.csrfToken.length > 0, 'CSRF rotation returned no token');
  session.csrf = payload.csrfToken;
}
function randomPassword() { return `spaccept-${randomBytes(24).toString('base64url')}`; }

async function main() {
  check(origin && adminUser && adminPassword, 'set SP_ACCEPT_ORIGIN, SP_ACCEPT_ADMIN_USER and SP_ACCEPT_ADMIN_PASSWORD');
  let parsed;
  try { parsed = new URL(origin); } catch { fail('SP_ACCEPT_ORIGIN must be a valid origin'); }
  check(parsed.origin === origin && parsed.pathname === '/' && !parsed.search && !parsed.hash && !parsed.username && !parsed.password, 'SP_ACCEPT_ORIGIN must contain only an origin');
  if (parsed.protocol === 'https:') check(!allowLocalHttp, 'do not combine HTTPS origin with SP_ACCEPT_ALLOW_HTTP_LOCALHOST');
  else check(parsed.protocol === 'http:' && allowLocalHttp && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname), 'HTTP is allowed only for localhost with SP_ACCEPT_ALLOW_HTTP_LOCALHOST=1');

  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const userA = `spaccept-a-${runId}`;
  const userB = `spaccept-b-${runId}`;
  const passwordA = randomPassword();
  const passwordB = randomPassword();
  const titleA = `spaccept-${runId}-web`;
  const titlePat = `spaccept-${runId}-pat`;
  const mutation = () => randomUUID();

  stage = 'admin-session';
  const admin = await login(adminUser, adminPassword);
  const adminMe = expect(await request('/api/v1/auth/me', {session: admin}), 200, 'admin session read');
  expect(await request('/api/v1/auth/reauth', {method: 'POST', session: admin, body: {password: adminPassword}}), 200, 'admin recent reauthentication');
  await rotateCsrf(admin);
  checks.adminLoginRecentCsrf = true;

  stage = 'create-synthetic-users';
  const createdA = expect(await request('/api/v1/admin/users', {method: 'POST', session: admin, body: {username: userA, password: passwordA, role: 'user'}}), 201, 'create synthetic user A');
  const createdB = expect(await request('/api/v1/admin/users', {method: 'POST', session: admin, body: {username: userB, password: passwordB, role: 'user'}}), 201, 'create synthetic user B');
  check(createdA.role === 'user' && createdB.role === 'user', 'synthetic account did not receive user role');
  checks.syntheticUsersCreated = 2;

  stage = 'owner-project-cas';
  const a = await login(userA, passwordA);
  const b = await login(userB, passwordB);
  expect(await request('/api/v1/auth/me', {session: a}), 200, 'user A session read');
  expect(await request('/api/v1/auth/me', {session: b}), 200, 'user B session read');
  const createdProject = expect(await request('/api/v1/projects', {method: 'POST', session: a, body: {title: titleA}}), 201, 'create synthetic project');
  const projectId = createdProject.id;
  check(typeof projectId === 'string' && createdProject.revision === 0, 'created project has unexpected shape');
  const edited = expect(await request(`/api/v1/projects/${projectId}/document`, {
    method: 'PATCH', session: a,
    body: {expectedRevision: 0, clientMutationId: mutation(), operations: [{type: 'updateProject', properties: {title: titleA, extensions: {spaccept: runId}}}]},
  }), 200, 'owner core CAS edit');
  check(edited.revision === 1 && edited.title === titleA && edited.extensions?.spaccept === runId, 'owner CAS result did not match the synthetic project marker');
  checks.ownerCoreCas = true;

  stage = 'tenant-isolation';
  expect(await request(`/api/v1/projects/${projectId}/document`, {session: b}), 404, 'other user document isolation');
  expect(await request(`/api/v1/projects/${projectId}/exports`, {method: 'POST', session: b, body: {expectedRevision: 1, format: 'editable-html'}}), 404, 'other user export isolation');
  expect(await request('/api/v1/admin/dashboard', {session: b}), 403, 'ordinary user admin denial');
  expect(await request(`/api/v1/projects/${projectId}/document`, {session: admin}), 404, 'admin private document isolation');
  expect(await request(`/api/v1/projects/${projectId}/exports`, {method: 'POST', session: admin, body: {expectedRevision: 1, format: 'editable-html'}}), 404, 'admin private export isolation');
  checks.otherUserReadExportAdminDenied = true;
  checks.adminPrivateContentDenied = true;

  stage = 'pat-http';
  const tokenInfo = expect(await request('/api/v1/me/tokens', {method: 'POST', session: a, body: {
    name: `spaccept-${runId}`, scopes: ['projects:read', 'projects:write'], projectAllowlist: [projectId],
  }}), 201, 'create scoped PAT');
  check(typeof tokenInfo.token === 'string' && typeof tokenInfo.id === 'string', 'PAT creation returned no token');
  const pat = tokenInfo.token;
  revokeOutstandingPat = async () => {
    const result = await request(`/api/v1/me/tokens/${tokenInfo.id}`, {method: 'DELETE', session: a, body: {}});
    expect(result, 200, 'best-effort PAT revocation');
  };
  const bearerRead = expect(await request(`/api/v1/projects/${projectId}/document`, {bearer: pat}), 200, 'PAT project read');
  check(bearerRead.revision === 1 && bearerRead.extensions?.spaccept === runId, 'PAT read did not resolve the owner project');
  expect(await request(`/api/v1/projects/${projectId}/exports`, {method: 'POST', bearer: pat, body: {expectedRevision: 1, format: 'editable-html'}}), 403, 'PAT export scope denial');

  const lease = expect(await request(`/api/v1/projects/${projectId}/lease`, {method: 'POST', session: a, body: {holder: `spaccept-${runId}`}}), 200, 'acquire project lease');
  const blockedWrite = await request(`/api/v1/projects/${projectId}/document`, {method: 'PATCH', bearer: pat, body: {
    expectedRevision: 1, clientMutationId: mutation(), operations: [{type: 'updateProject', properties: {title: 'should-not-commit'}}],
  }});
  expect(blockedWrite, 409, 'PAT write while owner lease is active');
  check(codeOf(blockedWrite.payload) === 'PROJECT_BUSY', 'active lease did not reject PAT write as project busy');
  expect(await request(`/api/v1/projects/${projectId}/lease`, {method: 'DELETE', session: a, body: {leaseToken: lease.leaseToken}}), 200, 'release project lease');
  const patEdited = expect(await request(`/api/v1/projects/${projectId}/document`, {method: 'PATCH', bearer: pat, body: {
    expectedRevision: 1, clientMutationId: mutation(), operations: [{type: 'updateProject', properties: {title: titlePat, extensions: {spaccept: runId, modifiedBy: 'pat'}}}],
  }}), 200, 'PAT CAS write after lease release');
  check(patEdited.revision === 2 && patEdited.title === titlePat && patEdited.extensions?.modifiedBy === 'pat', 'PAT CAS write did not commit expected revision');
  const reread = expect(await request(`/api/v1/projects/${projectId}/document`, {session: a}), 200, 'owner read after PAT write');
  check(reread.revision === 2 && reread.title === titlePat && reread.extensions?.modifiedBy === 'pat', 'owner did not read back the PAT revision');
  checks.patBearerReadWriteAndLease = true;
  checks.ownerReadBackRevision = reread.revision;

  stage = 'pat-revoke-audit';
  await revokeOutstandingPat();
  revokeOutstandingPat = undefined;
  const revokedRead = await request(`/api/v1/projects/${projectId}/document`, {bearer: pat});
  expect(revokedRead, 401, 'revoked PAT rejection');
  const audit = expect(await request('/api/v1/admin/audit?limit=100&offset=0', {session: admin}), 200, 'admin audit readback');
  const entries = Array.isArray(audit) ? audit : audit?.items;
  check(Array.isArray(entries), 'admin audit response has unexpected shape');
  const relevantUsers = new Set([adminMe.user.id, createdA.id, createdB.id]);
  const actions = new Set(entries.filter(row => row.resourceId === projectId || row.resourceId === tokenInfo.id || relevantUsers.has(row.resourceId) || relevantUsers.has(row.actorId)).map(row => row.action));
  for (const action of ['project.create', 'project.edit', 'token.create', 'token.revoke', 'user.create', 'auth.reauthenticate']) check(actions.has(action), `audit readback missing ${action}`);
  checks.patRevoked = true;
  checks.auditReadback = true;
  checks.syntheticMarker = `spaccept-${runId}`;
  return {ok: true, origin, checks, retainedSyntheticData: true};
}

main().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(async error => {
  let patRevoked = true;
  if (revokeOutstandingPat) {
    try { await revokeOutstandingPat(); } catch { patRevoked = false; }
  }
  process.stdout.write(`${JSON.stringify({ok: false, stage, error: error?.message ?? 'acceptance failed', retainedSyntheticData: true, patRevoked})}\n`);
  process.exitCode = 1;
});

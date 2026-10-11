import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {mountAdmin} from '../web/admin/app.js';
import {mountTokenSettings} from '../web/token-settings.js';
import {CloudAPI, CloudError} from '../storage/cloud-project-store.js';

const html = await readFile(new URL('../web/admin/index.html', import.meta.url), 'utf8');
const user = {id: '11111111-1111-1111-1111-111111111111', username: 'admin', role: 'admin'};
const target = {id: '22222222-2222-2222-2222-222222222222', username: '<img src=x onerror=alert(1)>', role: 'user', status: 'active', createdAt: '2026-10-11T00:00:00Z'};
const dashboard = {users: {total: 2, active: 2, admins: 1}, projects: {active: 1, trash: 0}, tokens: {active: 0}, storage: {documentBytes: 1200, databaseBytes: 1048576}, service: {status: 'ok'}};
function dom(source = html) {
 const result = new JSDOM(source, {url: 'https://sp.example/admin'});
 const proto = result.window.HTMLDialogElement.prototype;
 proto.showModal = function () {this.setAttribute('open', '');}; proto.close = function () {this.removeAttribute('open');};
 return result;
}
function fakeAPI(handler = () => undefined) {
 const calls = [], api = {user: {...user}, async restoreSession() {return this.user;}, async logout() {}, async request(path, options = {}) {calls.push({path, ...structuredClone(options)}); const result = await handler(path, options); if (result !== undefined) return structuredClone(result); if (path === '/admin/dashboard') return structuredClone(dashboard); if (path.startsWith('/admin/users')) return [structuredClone(target)]; return [];}};
 return {api, calls};
}
const click = (document, text) => {const button = [...document.querySelectorAll('button')].find(item => item.textContent === text); assert.ok(button, `Missing button ${text}`); button.click();};
async function until(predicate) {for (let index = 0; index < 100; index++) {if (predicate()) return; await new Promise(resolve => setImmediate(resolve));} assert.fail('UI update did not complete');}
function submit(window, values = {}) {
 const form = window.document.querySelector('dialog form'); assert.ok(form);
 for (const [name, value] of Object.entries(values)) {const control = form.elements.namedItem(name); assert.ok(control, name); if (control.type === 'checkbox') control.checked = value; else control.value = value;}
 form.dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true}));
}

test('admin renders safe metadata, current-page filtering and actual server pagination', async () => {
 const h = dom(); const records = Array.from({length: 25}, (_, index) => ({...target, id: String(index), username: index ? 'user-' + index : target.username}));
 const {api, calls} = fakeAPI(path => path.startsWith('/admin/users') ? records : undefined);
 const mounted = await mountAdmin({document: h.window.document, api, navigate() {assert.fail('Unexpected navigation');}});
 try {
  click(h.window.document, '用户'); await until(() => h.window.document.querySelectorAll('tbody tr').length === 25);
  assert.equal(h.window.document.querySelector('td img'), null);
  assert.match(h.window.document.querySelector('tbody').textContent, /<img src=x/);
  const filter = h.window.document.querySelector('input[type=search]'); filter.value = 'user-24'; filter.dispatchEvent(new h.window.Event('input'));
  assert.equal(h.window.document.querySelectorAll('tbody tr').length, 1);
  click(h.window.document, '下一页'); await until(() => calls.some(call => call.path.includes('offset=25')));
  assert.ok(!calls.some(call => /document|snapshot/.test(call.path)));
 } finally {mounted.destroy(); h.window.close();}
});

test('create user form gates duplicate writes and retries exactly once after password step-up', async () => {
 const h = dom(); let attempts = 0;
 const {api, calls} = fakeAPI((path, options) => {if (path === '/admin/users' && options.method === 'POST') {if (++attempts === 1) throw new CloudError('REAUTHENTICATION_REQUIRED', '重新验证', 403); return target;} if (path === '/auth/reauth') return {expiresAt: '2026-10-11T01:00:00Z'};});
 const mounted = await mountAdmin({document: h.window.document, api});
 try {
  click(h.window.document, '用户'); await until(() => h.window.document.querySelector('tbody'));
  click(h.window.document, '创建用户'); assert.equal([...h.window.document.querySelectorAll('button')].find(button => button.textContent === '创建用户').disabled, true);
  submit(h.window, {username: 'new-user', password: 'strong-password-123!'});
  await until(() => h.window.document.querySelector('dialog h2')?.textContent === '重新验证密码');
  submit(h.window, {password: 'admin-password-123!'});
  await until(() => attempts === 2 && !h.window.document.querySelector('dialog'));
  const writes = calls.filter(call => call.path === '/admin/users' && call.method === 'POST');
  assert.equal(writes.length, 2); assert.deepEqual(writes[0].body, writes[1].body);
  assert.deepEqual(writes[0].body, {username: 'new-user', password: 'strong-password-123!', role: 'user'});
  assert.equal(h.window.document.querySelector('input[type=password]'), null);
 } finally {mounted.destroy(); h.window.close();}
});

test('project admin mutations use metadata revision and unique mutation IDs without reading private content or retrying conflicts', async () => {
 const h = dom(), project = {id: target.id, title: 'Private project', ownerId: target.id, ownerUsername: 'owner', revision: 9, updatedAt: '2026-10-11T00:00:00Z'};
 const {api, calls} = fakeAPI((path, options) => {if (path.startsWith('/admin/projects?')) return [project]; if (options.method === 'POST') throw new CloudError('REVISION_CONFLICT', '已有更新，请刷新核对', 409);});
 const mounted = await mountAdmin({document: h.window.document, api});
 try {
  click(h.window.document, '项目'); await until(() => h.window.document.querySelector('tbody'));
  click(h.window.document, '移到回收站'); submit(h.window);
  await until(() => h.window.document.querySelector('#admin-status').classList.contains('error'));
  const writes = calls.filter(call => call.method === 'POST'); assert.equal(writes.length, 1);
  assert.equal(writes[0].body.expectedRevision, 9); assert.match(writes[0].body.clientMutationId, /^[a-f0-9-]{36}$/);
  assert.ok(!calls.some(call => /\/document|\/snapshot/.test(call.path)));
  assert.match(h.window.document.querySelector('#admin-status').textContent, /刷新/);
 } finally {mounted.destroy(); h.window.close();}
});

test('ordinary accounts cannot enter admin UI and unauthenticated sessions redirect to login', async () => {
 const h = dom(), {api, calls} = fakeAPI(); api.user.role = 'user';
 const mounted = await mountAdmin({document: h.window.document, api});
 assert.match(h.window.document.querySelector('#admin-status').textContent, /没有管理后台访问权限/);
 assert.equal(calls.length, 0); mounted.destroy(); h.window.close();
 const other = dom(), redirects = [];
 await mountAdmin({document: other.window.document, api: {restoreSession: async () => {throw new CloudError('UNAUTHENTICATED', '登录', 401);}}, navigate: url => redirects.push(url)});
 assert.equal(redirects[0], '/login?returnTo=%2Fadmin'); other.window.close();
});

test('backup polling is limited to active jobs and stops when leaving the backup page', async () => {
 const h = dom(), timers = [], originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
 globalThis.setTimeout = (fn, ms) => {const timer = {fn, ms, cancelled: false}; timers.push(timer); return timer;}; globalThis.clearTimeout = timer => {if (timer) timer.cancelled = true;};
 const {api} = fakeAPI(path => path === '/admin/backups' ? {configured: true, restoreConfigured: true, jobs: [{id: 'job', status: 'running'}]} : undefined);
 let mounted;
 try {
  mounted = await mountAdmin({document: h.window.document, api}); click(h.window.document, '备份与恢复验证'); await until(() => timers.length === 1);
  assert.equal(timers[0].ms, 2000);
  assert.equal([...h.window.document.querySelectorAll('button')].find(button => button.textContent === '创建备份').disabled, true);
  click(h.window.document, '平台概览'); await until(() => timers[0].cancelled); assert.equal(timers.filter(timer => !timer.cancelled).length, 0);
 } finally {mounted?.destroy(); globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; h.window.close();}
});

test('user PAT form defaults omit delete, limits projects, displays plaintext once and purges it on close', async () => {
 const h = dom('<main><section id="tokens"></section></main>'), calls = [], token = 'sp_pat_' + 'a'.repeat(43), metadata = {id: target.id, userId: user.id, name: 'bridge', prefix: 'sp_pat_aaaaaaaa', scopes: ['projects:read'], projectAllowlist: [], expiresAt: '2026-11-11T00:00:00Z', revokedAt: null};
 let created = false;
 const api = {user, async request(path, options = {}) {calls.push({path, ...structuredClone(options)}); if (options.method === 'POST') {created = true; return {...metadata, token};} return created ? [{...metadata}] : [];}};
 const mounted = await mountTokenSettings({api, container: h.window.document.querySelector('#tokens')});
 try {
  click(h.window.document, '创建授权'); submit(h.window, {name: 'bridge', projectMode: 'none'});
  await until(() => h.window.document.querySelector('textarea.token-secret'));
  const write = calls.find(call => call.method === 'POST');
  assert.deepEqual(write.body.scopes, ['projects:read', 'projects:create', 'projects:write', 'projects:export']);
  assert.deepEqual(write.body.projectAllowlist, []);
  assert.equal(h.window.document.querySelector('.token-secret').value, token);
  click(h.window.document, '我已保存'); await until(() => h.window.document.querySelector('.token-row'));
  assert.equal(h.window.document.querySelector('.token-secret'), null);
  assert.ok(!h.window.document.body.textContent.includes(token));
  assert.ok(!h.window.document.body.innerHTML.includes(token));
 } finally {mounted.destroy(); h.window.close();}
});

test('CloudAPI refreshes CSRF only after explicit rejection and never retries timeout', async () => {
 const calls = []; let writes = 0;
 const api = new CloudAPI({fetch: async (url, options) => {calls.push({url, body: options.body}); if (url.endsWith('/auth/csrf')) return {ok: true, json: async () => ({csrfToken: 'fresh'})}; if (writes++ === 0) return {ok: false, status: 403, json: async () => ({error: {code: 'CSRF_INVALID', message: 'csrf'}})}; return {ok: true, json: async () => ({success: true})};}});
 api.csrfToken = 'old'; await api.request('/admin/settings', {method: 'PATCH', body: {siteName: 'SP'}});
 assert.equal(calls.filter(call => call.url.endsWith('/admin/settings')).length, 2);
 assert.equal(calls[0].body, calls[2].body);
 let attempts = 0; const offline = new CloudAPI({fetch: async () => {attempts++; throw Error('network');}});
 await assert.rejects(offline.request('/admin/settings', {method: 'PATCH', body: {siteName: 'SP'}}), error => error.code === 'OFFLINE');
 assert.equal(attempts, 1);
});

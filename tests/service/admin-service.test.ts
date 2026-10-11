import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import {AuthService} from '../../server/auth/auth-service.js';
import {TokenService} from '../../server/auth/token-service.js';
import {AdminService} from '../../server/services/admin-service.js';
import {ProjectService} from '../../server/services/project-service.js';
import {registerAdminRoutes} from '../../server/routes/admin-routes.js';
import {ServiceError} from '../../server/contracts.js';
import {createTestDatabase, cleanupTestDatabase} from './helpers.js';

const password = 'admin-test-password-123!';
const newPassword = 'replacement-password-456!';
const code = (expected: string) => (error: unknown) => error instanceof ServiceError && error.code === expected;
async function setup() {
  const db = await createTestDatabase();
  const auth = new AuthService(db), admin = new AdminService(db), tokens = new TokenService(db), projects = new ProjectService(db);
  await auth.bootstrapAdmin('admin', password);
  const adminLogin = await auth.login('admin', password);
  const actor = await auth.authenticate(adminLogin.sessionToken);
  await auth.createUser(actor, {username: 'ordinary', password});
  const userLogin = await auth.login('ordinary', password);
  const user = await auth.authenticate(userLogin.sessionToken);
  return {db, auth, admin, tokens, projects, actor, user, adminLogin, userLogin, close: () => cleanupTestDatabase(db)};
}

test('admin aggregates, paginated metadata and audit never expose private documents or credentials', async () => {
  const h = await setup();
  try {
    const doc = await h.projects.create(h.user, {title: 'Private project'});
    await h.projects.edit(h.user, doc.id, {expectedRevision: 0, clientMutationId: 'private', operations: [{type: 'updateProject', properties: {extensions: {privateSentinel: 'SECRET_PRIVATE_BODY'}}}]});
    await h.tokens.create(h.user, {name: 'bridge'});
    const dashboard = await h.admin.dashboard(h.actor);
    assert.equal(dashboard.users.total, 2);
    assert.equal(dashboard.projects.active, 1);
    assert.equal(dashboard.tokens.active, 1);
    assert.ok(dashboard.storage.documentBytes > 0);
    const metadata = await h.admin.listProjects(h.actor, {limit: 1});
    assert.equal(metadata.length, 1);
    assert.equal(metadata[0].ownerId, h.user.id);
    assert.equal(metadata[0].revision, 1);
    assert.deepEqual(await h.admin.listProjects(h.actor, {offset: 1}), []);
    assert.deepEqual(await h.admin.listProjects(h.actor, {trash: true}), []);
    const users = await h.admin.listUsers(h.actor, {limit: 1});
    assert.equal(users.length, 1);
    const audit = await h.admin.listAudit(h.actor, {limit: 2});
    assert.equal(audit.length, 2);
    const exposed = JSON.stringify({dashboard, metadata, users, audit});
    assert.doesNotMatch(exposed, /SECRET_PRIVATE_BODY|document_jsonb|password_hash|csrf_hash|session_hash|token_hash/);
    await assert.rejects(h.admin.listUsers(h.actor, {limit: 101}), code('INVALID_REQUEST'));
    await assert.rejects(h.admin.listAudit(h.actor, {offset: -1}), code('INVALID_REQUEST'));
    await assert.rejects(h.admin.dashboard(h.user), code('FORBIDDEN'));
    const pat = await h.tokens.authenticate((await h.tokens.create(h.actor, {name: 'admin PAT'})).token);
    await assert.rejects(h.admin.dashboard(pat), code('FORBIDDEN'));
  } finally {await h.close();}
});

test('sensitive admin methods require recent bound session reauthentication; CSRF rotation only rotates CSRF', async () => {
  const h = await setup();
  try {
    await h.db.query("UPDATE sessions SET reauth_until=clock_timestamp()-interval '1 second' WHERE id=$1", [h.actor.sessionId]);
    await h.admin.dashboard(h.actor);
    await assert.rejects(h.auth.createUser(h.actor, {username: 'needs-stepup', password}), code('REAUTHENTICATION_REQUIRED'));
    await assert.rejects(h.auth.setUserRole(h.actor, h.user.id, 'admin'), code('REAUTHENTICATION_REQUIRED'));
    await assert.rejects(h.auth.setUserStatus(h.actor, h.user.id, 'disabled'), code('REAUTHENTICATION_REQUIRED'));
    await assert.rejects(h.auth.revokeUserSessions(h.actor, h.user.id), code('REAUTHENTICATION_REQUIRED'));
    await assert.rejects(h.auth.resetUserPassword(h.actor, h.user.id, newPassword), code('REAUTHENTICATION_REQUIRED'));
    await assert.rejects(h.admin.setSettings(h.actor, {announcement: 'hello'}), code('REAUTHENTICATION_REQUIRED'));
    await assert.rejects(h.auth.requireReauthentication(h.actor), code('REAUTHENTICATION_REQUIRED'));
    const before = (await h.db.query('SELECT reauth_until FROM sessions WHERE id=$1', [h.actor.sessionId])).rows[0].reauth_until;
    const rotated = await h.auth.rotateCsrf(h.actor);
    await h.auth.verifyCsrf(h.actor, rotated.csrfToken);
    await assert.rejects(h.auth.verifyCsrf(h.actor, h.adminLogin.csrfToken), code('CSRF_INVALID'));
    const after = (await h.db.query('SELECT reauth_until FROM sessions WHERE id=$1', [h.actor.sessionId])).rows[0].reauth_until;
    assert.equal(after.getTime(), before.getTime());
    await assert.rejects(h.auth.reauthenticate(h.actor, 'wrong-password'), code('INVALID_CREDENTIALS'));
    const reauth = await h.auth.reauthenticate(h.actor, password);
    assert.ok(reauth.expiresAt.getTime() > Date.now());
    await h.auth.requireReauthentication(h.actor);
    await h.auth.createUser(h.actor, {username: 'after-stepup', password});
    const failures = await h.db.query("SELECT 1 FROM audit_logs WHERE action='auth.reauthenticate' AND outcome='failure'");
    assert.equal(failures.rowCount, 1);
    await h.auth.logout(h.adminLogin.sessionToken);
    await assert.rejects(h.auth.rotateCsrf(h.actor), code('UNAUTHENTICATED'));
    await assert.rejects(h.admin.getSettings(h.actor), code('UNAUTHENTICATED'));
  } finally {await h.close();}
});

test('password reset/change revoke sessions and preserve password validation/audit transaction', async () => {
  const h = await setup();
  try {
    await assert.rejects(h.auth.resetUserPassword(h.user, h.actor.id, newPassword), code('FORBIDDEN'));
    await h.auth.resetUserPassword(h.actor, h.user.id, newPassword);
    await assert.rejects(h.auth.authenticate(h.userLogin.sessionToken), code('UNAUTHENTICATED'));
    await assert.rejects(h.auth.login('ordinary', password), code('INVALID_CREDENTIALS'));
    const login = await h.auth.login('ordinary', newPassword);
    const actor = await h.auth.authenticate(login.sessionToken);
    await assert.rejects(h.auth.changePassword(actor, {currentPassword: 'wrong', newPassword: password}), code('INVALID_CREDENTIALS'));
    await assert.rejects(h.auth.changePassword(actor, {currentPassword: newPassword, newPassword: 'short'}), code('INVALID_REQUEST'));
    await h.auth.changePassword(actor, {currentPassword: newPassword, newPassword: password});
    await assert.rejects(h.auth.authenticate(login.sessionToken), code('UNAUTHENTICATED'));
    await h.auth.login('ordinary', password);
    const actions = await h.db.query("SELECT action FROM audit_logs WHERE action IN ('user.reset_password','user.change_password') ORDER BY id");
    assert.deepEqual(actions.rows.map(row => row.action), ['user.reset_password', 'user.change_password']);
    await h.db.query("ALTER TABLE audit_logs ADD CONSTRAINT block_reset_audit CHECK(action <> 'user.reset_password') NOT VALID");
    await assert.rejects(h.auth.resetUserPassword(h.actor, h.user.id, newPassword));
    await h.auth.login('ordinary', password);
  } finally {await h.close();}
});

test('settings whitelist, safe reads, stale role and atomic multi-setting audit rollback', async () => {
  const h = await setup();
  try {
    for (const patch of [{secret: 'key'}, {publicRegistration: true}, {maxUploadBytes: 33554433}, {maxUploadBytes: 0}, {maintenanceMode: 'yes'}, {}]) await assert.rejects(h.admin.setSettings(h.actor, patch), code('INVALID_REQUEST'));
    const settings = await h.admin.setSettings(h.actor, {siteName: 'Team slides', announcement: 'News', maintenanceMode: true});
    assert.equal(settings.siteName, 'Team slides');
    await h.db.query("INSERT INTO system_settings(key,value,updated_by) VALUES('hiddenSecret','\"do-not-expose\"',$1)", [h.actor.id]);
    assert.ok(!JSON.stringify(await h.admin.getSettings(h.actor)).includes('do-not-expose'));
    await h.db.query("ALTER TABLE audit_logs ADD CONSTRAINT block_settings_audit CHECK(NOT(action='settings.update' AND resource_id='siteName')) NOT VALID");
    await assert.rejects(h.admin.setSettings(h.actor, {announcement: 'rollback', siteName: 'rollback'}));
    assert.equal((await h.admin.getSettings(h.actor)).announcement, 'News');
    assert.equal((await h.admin.getSettings(h.actor)).siteName, 'Team slides');
    await h.auth.setUserRole(h.actor, h.user.id, 'admin');
    const promoted = await h.auth.authenticate((await h.auth.login('ordinary', password)).sessionToken);
    await h.auth.setUserRole(h.actor, promoted.id, 'user');
    await assert.rejects(h.admin.listAudit(promoted), code('FORBIDDEN'));
    await assert.rejects(h.admin.listProjects(promoted), code('FORBIDDEN'));
    await h.auth.setUserStatus(h.actor, h.user.id, 'disabled');
    await assert.rejects(h.admin.dashboard(promoted), code('UNAUTHENTICATED'));
  } finally {await h.close();}
});

test('admin routes validate schemas, paginate reads and delegate content mutations to ProjectService', async () => {
  const h = await setup();
  const app = Fastify({ajv: {customOptions: {coerceTypes: false, removeAdditional: false}}});
  try {
    const calls: unknown[] = [];
    registerAdminRoutes(app, {db: h.db, auth: h.auth, tokens: h.tokens, actor: async () => h.actor, writable: async () => h.actor, projects: {
      adminTransfer: async (_actor, id, input) => {calls.push({id, input}); return {success: true};},
      setDeletedAdmin: async (_actor, id, input) => {calls.push({id, input}); return {success: true};},
    }});
    assert.equal((await app.inject('/api/v1/admin/users?limit=1')).json().length, 1);
    assert.equal((await app.inject('/api/v1/admin/projects?trash=maybe')).statusCode, 400);
    assert.equal((await app.inject('/api/v1/admin/users?unexpected=true')).statusCode, 400);
    assert.equal((await app.inject({method: 'PATCH', url: '/api/v1/admin/settings', payload: {secret: 'invalid'}})).statusCode, 400);
    const doc = await h.projects.create(h.user);
    const transfer = await app.inject({method: 'POST', url: `/api/v1/admin/projects/${doc.id}/transfer`, payload: {newOwnerId: h.actor.id, expectedRevision: 0, clientMutationId: 'transfer'}});
    assert.equal(transfer.statusCode, 200, transfer.body);
    assert.equal(calls.length, 1);
    const trash = await app.inject({method: 'POST', url: `/api/v1/admin/projects/${doc.id}/trash`, payload: {expectedRevision: 0, clientMutationId: 'trash'}});
    assert.equal(trash.statusCode, 200, trash.body);
    assert.equal(calls.length, 2);
    assert.equal((await app.inject('/api/v1/admin/dashboard')).statusCode, 200);
  } finally {await app.close(); await h.close();}
});

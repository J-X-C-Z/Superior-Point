import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import test from 'node:test';
import {AuthService} from '../../server/auth/auth-service.js';
import {TokenService, checkTokenActor} from '../../server/auth/token-service.js';
import {ServiceError, requireScope, transaction, type Actor} from '../../server/contracts.js';
import {ProjectService} from '../../server/services/project-service.js';
import {createTestDatabase, cleanupTestDatabase} from './helpers.js';

const password = 'token-test-password-long!';
const code = (expected: string) => (error: unknown) => error instanceof ServiceError && error.code === expected;
async function setup() {
  const db = await createTestDatabase();
  const auth = new AuthService(db);
  const tokens = new TokenService(db);
  await auth.bootstrapAdmin('admin', password);
  const admin = await auth.authenticate((await auth.login('admin', password)).sessionToken);
  await auth.createUser(admin, {username: 'ordinary', password});
  const login = await auth.login('ordinary', password);
  const user = await auth.authenticate(login.sessionToken);
  return {db, auth, tokens, admin, user, login, projects: new ProjectService(db), close: () => cleanupTestDatabase(db)};
}
async function checked(h: Awaited<ReturnType<typeof setup>>, actor: Actor) {
  return transaction(h.db, async client => {
    await client.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR SHARE", [actor.id]);
    await checkTokenActor(client, actor);
  });
}

test('PAT plaintext appears only at creation; defaults, metadata, audit and web-only management', async () => {
  const h = await setup();
  try {
    const created = await h.tokens.create(h.user, {name: 'Local bridge'});
    assert.match(created.token, /^sp_pat_[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(created.scopes, ['projects:read', 'projects:create', 'projects:write', 'projects:export']);
    assert.equal(created.projectAllowlist, null);
    const row = (await h.db.query('SELECT * FROM api_tokens WHERE id=$1', [created.id])).rows[0];
    assert.equal(row.token_hash, createHash('sha256').update(created.token).digest('hex'));
    assert.equal(row.prefix, created.token.slice(0, 15));
    assert.ok(!JSON.stringify(row).includes(created.token));
    const actor = await h.tokens.authenticate(created.token);
    assert.equal(actor.source, 'mcp');
    assert.equal(actor.tokenId, created.id);
    assert.equal(actor.id, h.user.id);
    assert.ok((await h.db.query('SELECT last_used_at FROM api_tokens WHERE id=$1', [created.id])).rows[0].last_used_at);
    await checked(h, actor);
    assert.throws(() => requireScope(actor, 'projects:delete'), code('FORBIDDEN'));
    for (const result of [await h.tokens.list(h.user), await h.tokens.adminList(h.admin)]) {
      assert.equal(result.length, 1);
      assert.ok(!JSON.stringify(result).includes(created.token));
      assert.ok(!JSON.stringify(result).includes('token_hash'));
      assert.ok(!Object.hasOwn(result[0], 'token'));
    }
    assert.deepEqual(await h.tokens.list(h.admin), []);
    await assert.rejects(h.tokens.create(actor, {name: 'forbidden'}), code('FORBIDDEN'));
    await assert.rejects(h.tokens.list(actor), code('FORBIDDEN'));
    await assert.rejects(h.tokens.adminList(actor), code('FORBIDDEN'));
    await assert.rejects(h.tokens.adminList(h.user), code('FORBIDDEN'));
    await assert.rejects(h.tokens.revoke(h.admin, created.id), code('NOT_FOUND'));
    const audit = await h.db.query("SELECT * FROM audit_logs WHERE resource_type='token'");
    assert.equal(audit.rowCount, 1);
    assert.ok(!JSON.stringify(audit.rows).includes(created.token));
  } finally {await h.close();}
});

test('PAT scopes, project allowlists and expiry validate; export does not grant read', async () => {
  const h = await setup();
  try {
    const own = await h.projects.create(h.user, {title: 'own'});
    const other = await h.projects.create(h.admin, {title: 'other'});
    for (const input of [
      {name: ''}, {name: 'invalid', scopes: []}, {name: 'invalid', scopes: ['admin']},
      {name: 'invalid', scopes: ['projects:read', 'projects:read']},
      {name: 'invalid', projectAllowlist: ['invalid-id']},
      {name: 'invalid', projectAllowlist: [own.id, own.id]},
      {name: 'invalid', projectAllowlist: [other.id]},
      {name: 'invalid', projectAllowlist: [randomUUID()]},
      {name: 'invalid', expiresAt: 'not-date'},
      {name: 'invalid', expiresAt: new Date(Date.now() - 1000)},
      {name: 'invalid', expiresAt: new Date(Date.now() + 366 * 86400000)},
    ]) await assert.rejects(h.tokens.create(h.user, input), code('INVALID_REQUEST'));
    const scoped = await h.tokens.authenticate((await h.tokens.create(h.user, {name: 'one project', scopes: ['projects:read'], projectAllowlist: [own.id]})).token);
    assert.deepEqual(scoped.projectAllowlist, [own.id]);
    assert.equal((await h.projects.get(scoped, own.id)).id, own.id);
    await assert.rejects(h.projects.get(scoped, other.id), code('FORBIDDEN'));
    const empty = await h.tokens.authenticate((await h.tokens.create(h.user, {name: 'no projects', scopes: ['projects:read'], projectAllowlist: []})).token);
    await assert.rejects(h.projects.get(empty, own.id), code('FORBIDDEN'));
    assert.deepEqual(await h.projects.list(empty), []);
    const exportOnly = await h.tokens.authenticate((await h.tokens.create(h.user, {name: 'export only', scopes: ['projects:export']})).token);
    assert.throws(() => requireScope(exportOnly, 'projects:read', own.id), code('FORBIDDEN'));
    await assert.rejects(h.projects.get(exportOnly, own.id), code('FORBIDDEN'));
    requireScope(exportOnly, 'projects:export', own.id);
    await assert.rejects(checked(h, {...scoped, scopes: ['projects:read', 'projects:delete']}), code('FORBIDDEN'));
    await assert.rejects(checked(h, {...scoped, projectAllowlist: null}), code('FORBIDDEN'));
  } finally {await h.close();}
});

test('PAT expiry, revoke, owner disable and fresh role are authoritative', async () => {
  const h = await setup();
  try {
    const created = await h.tokens.create(h.user, {name: 'revoked'});
    const actor = await h.tokens.authenticate(created.token);
    await h.tokens.revoke(h.user, created.id);
    await assert.rejects(h.tokens.authenticate(created.token), code('UNAUTHENTICATED'));
    await assert.rejects(checked(h, actor), code('UNAUTHENTICATED'));
    await h.tokens.revoke(h.user, created.id);
    const expiring = await h.tokens.create(h.user, {name: 'expiring'});
    const expiringActor = await h.tokens.authenticate(expiring.token);
    await h.db.query("UPDATE api_tokens SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [expiring.id]);
    await assert.rejects(h.tokens.authenticate(expiring.token), code('UNAUTHENTICATED'));
    await assert.rejects(checked(h, expiringActor), code('UNAUTHENTICATED'));
    const live = await h.tokens.create(h.user, {name: 'live'});
    await h.auth.setUserRole(h.admin, h.user.id, 'admin');
    assert.equal((await h.tokens.authenticate(live.token)).role, 'admin');
    await h.auth.setUserStatus(h.admin, h.user.id, 'disabled');
    await assert.rejects(h.tokens.authenticate(live.token), code('UNAUTHENTICATED'));
    for (const raw of ['', 'sp_pat_wrong', 'sp_pat_' + 'a'.repeat(43)]) await assert.rejects(h.tokens.authenticate(raw), code('UNAUTHENTICATED'));
  } finally {await h.close();}
});

test('token management rejects revoked sessions and stale admin role; audit failure rolls back creation/revoke', async () => {
  const h = await setup();
  try {
    const created = await h.tokens.create(h.user, {name: 'rollback target'});
    await h.auth.logout(h.login.sessionToken);
    await assert.rejects(h.tokens.create(h.user, {name: 'after logout'}), code('UNAUTHENTICATED'));
    await assert.rejects(h.tokens.list(h.user), code('UNAUTHENTICATED'));
    await assert.rejects(h.tokens.revoke(h.user, created.id), code('UNAUTHENTICATED'));
    const refreshed = await h.auth.authenticate((await h.auth.login('ordinary', password)).sessionToken);
    await h.db.query("ALTER TABLE audit_logs ADD CONSTRAINT block_token_audit CHECK(resource_type <> 'token') NOT VALID");
    await assert.rejects(h.tokens.create(refreshed, {name: 'rollback creation'}));
    assert.equal((await h.db.query('SELECT count(*)::int AS count FROM api_tokens')).rows[0].count, 1);
    await assert.rejects(h.tokens.revoke(refreshed, created.id));
    assert.equal((await h.db.query('SELECT revoked_at FROM api_tokens WHERE id=$1', [created.id])).rows[0].revoked_at, null);
    await h.db.query('ALTER TABLE audit_logs DROP CONSTRAINT block_token_audit');
    await h.tokens.adminRevoke(h.admin, created.id);
    await assert.rejects(h.tokens.authenticate(created.token), code('UNAUTHENTICATED'));
    const adminToken = await h.tokens.create(h.admin, {name: 'admin PAT'});
    const mcpAdmin = await h.tokens.authenticate(adminToken.token);
    await assert.rejects(h.tokens.adminRevoke(mcpAdmin, created.id), code('FORBIDDEN'));
    await h.auth.setUserRole(h.admin, refreshed.id, 'admin');
    const promoted = await h.auth.authenticate((await h.auth.login('ordinary', password)).sessionToken);
    await h.auth.setUserRole(h.admin, promoted.id, 'user');
    await assert.rejects(h.tokens.adminList(promoted), code('FORBIDDEN'));
  } finally {await h.close();}
});

test('transactional token SHARE lock orders a project commit before concurrent revocation', async () => {
  const h = await setup();
  try {
    const created = await h.tokens.create(h.user, {name: 'lock test'});
    const actor = await h.tokens.authenticate(created.token);
    const client = await h.db.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR SHARE", [actor.id]);
      await checkTokenActor(client, actor);
      let revoked = false;
      const revocation = h.tokens.revoke(h.user, created.id).then(() => {revoked = true;});
      // Both operations hold the user lock; the token lock must block the revocation UPDATE.
      await client.query('SELECT pg_sleep(0.05)');
      assert.equal(revoked, false);
      await client.query('COMMIT');
      await revocation;
      await assert.rejects(checked(h, actor), code('UNAUTHENTICATED'));
    } finally {await client.query('ROLLBACK'); client.release();}
  } finally {await h.close();}
});

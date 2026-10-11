import assert from 'node:assert/strict';
import test from 'node:test';
import {AuthService} from '../../server/auth/auth-service.js';
import {ServiceError} from '../../server/contracts.js';
import {createTestDatabase, cleanupTestDatabase} from './helpers.js';

const password = 'test-password-long-123!';
const code = (expected: string) => (error: unknown) => error instanceof ServiceError && error.code === expected;

test('auth stores Argon2id and only hashes of session secrets; failures are uniform and audited', async () => {
  const db = await createTestDatabase();
  try {
    const auth = new AuthService(db);
    const admin = await auth.bootstrapAdmin('first-admin', password);
    await assert.rejects(auth.bootstrapAdmin('second-admin', password), code('BOOTSTRAP_COMPLETE'));
    const login = await auth.login(admin.username, password);
    const actor = await auth.authenticate(login.sessionToken);
    assert.equal(actor.id, admin.id);
    assert.equal(actor.role, 'admin');
    assert.ok(actor.sessionId);
    const stored = (await db.query('SELECT password_hash FROM users WHERE id=$1', [admin.id])).rows[0];
    assert.match(stored.password_hash, /^\$argon2id\$/);
    const session = (await db.query('SELECT session_hash,csrf_hash FROM sessions WHERE id=$1', [actor.sessionId])).rows[0];
    assert.match(session.session_hash, /^[a-f0-9]{64}$/);
    assert.notEqual(session.session_hash, login.sessionToken);
    assert.notEqual(session.csrf_hash, login.csrfToken);
    assert.deepEqual(Object.keys(login.user).sort(), ['id','role','username']);
    await auth.verifyCsrf(actor, login.csrfToken);
    await assert.rejects(auth.verifyCsrf(actor, 'wrong'), code('FORBIDDEN'));
    const secondLogin = await auth.login(admin.username, password);
    await assert.rejects(auth.verifyCsrf(actor, secondLogin.csrfToken), code('FORBIDDEN'));
    const ordinary = await auth.createUser(actor, {username: 'ordinary', password});
    await auth.setUserStatus(actor, ordinary.id, 'disabled');
    for (const [username, attempted] of [['missing-account', password], [admin.username, 'wrong'], [ordinary.username, password]]) {
      await assert.rejects(auth.login(username, attempted), code('INVALID_CREDENTIALS'));
    }
    const failures = await db.query("SELECT actor_id,resource_id FROM audit_logs WHERE action='auth.login' AND outcome='failure'");
    assert.equal(failures.rowCount, 3);
    assert.ok(failures.rows.every(row => row.actor_id === null && row.resource_id === null));
    const exposed = JSON.stringify(await auth.listUsers(actor));
    assert.ok(!exposed.includes('password_hash') && !exposed.includes(login.sessionToken));
    await auth.logout(login.sessionToken);
    await assert.rejects(auth.authenticate(login.sessionToken), code('UNAUTHENTICATED'));
    await assert.rejects(auth.verifyCsrf(actor, login.csrfToken), code('FORBIDDEN'));
    assert.equal((await db.query("SELECT 1 FROM audit_logs WHERE action='auth.logout'")).rowCount, 1);
  } finally {await cleanupTestDatabase(db);}
});

test('RBAC, disable, session revocation and expiry recheck current persisted state', async () => {
  const db = await createTestDatabase();
  try {
    const auth = new AuthService(db);
    await auth.bootstrapAdmin('admin', password);
    const adminLogin = await auth.login('admin', password);
    const adminActor = await auth.authenticate(adminLogin.sessionToken);
    const user = await auth.createUser(adminActor, {username: 'user', password});
    const userLogin = await auth.login('user', password);
    const userActor = await auth.authenticate(userLogin.sessionToken);
    await assert.rejects(auth.createUser(userActor, {username: 'forbidden', password}), code('FORBIDDEN'));
    await assert.rejects(auth.listUsers(userActor), code('FORBIDDEN'));
    await assert.rejects(auth.setUserRole(userActor, user.id, 'admin'), code('FORBIDDEN'));
    await assert.rejects(auth.revokeUserSessions(userActor, adminActor.id), code('FORBIDDEN'));
    await assert.rejects(auth.setUserStatus(adminActor, adminActor.id, 'disabled'), code('LAST_ADMIN'));
    await assert.rejects(auth.setUserRole(adminActor, adminActor.id, 'user'), code('LAST_ADMIN'));
    await auth.setUserRole(adminActor, user.id, 'admin');
    assert.equal((await auth.authenticate(userLogin.sessionToken)).role, 'admin');
    const refreshed = await auth.authenticate(userLogin.sessionToken);
    await auth.setUserRole(adminActor, user.id, 'user');
    await assert.rejects(auth.listUsers(refreshed), code('FORBIDDEN'));
    await auth.revokeUserSessions(adminActor, user.id);
    await assert.rejects(auth.authenticate(userLogin.sessionToken), code('UNAUTHENTICATED'));
    const nextLogin = await auth.login('user', password);
    await auth.setUserStatus(adminActor, user.id, 'disabled');
    await assert.rejects(auth.authenticate(nextLogin.sessionToken), code('UNAUTHENTICATED'));
    await assert.rejects(auth.getUser(userActor), code('UNAUTHENTICATED'));
    await auth.setUserStatus(adminActor, user.id, 'active');
    await assert.rejects(auth.authenticate(nextLogin.sessionToken), code('UNAUTHENTICATED'));
    const expiring = await auth.login('user', password);
    await db.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1", [user.id]);
    await assert.rejects(auth.authenticate(expiring.sessionToken), code('UNAUTHENTICATED'));
    await assert.rejects(auth.createUser(adminActor, {username: 'weak', password: 'short'}), code('INVALID_REQUEST'));
    await assert.rejects(auth.createUser(adminActor, {username: 'user', password}), code('USERNAME_EXISTS'));
    await assert.rejects(auth.setUserRole(adminActor, 'invalid-id', 'admin'), code('INVALID_REQUEST'));
    await assert.rejects(auth.revokeUserSessions(adminActor, 'invalid-id'), code('INVALID_REQUEST'));
  } finally {await cleanupTestDatabase(db);}
});

test('concurrent bootstrap and last-admin changes serialize; audit failures roll back mutations', async () => {
  const db = await createTestDatabase();
  try {
    const auth = new AuthService(db);
    const bootstrap = await Promise.allSettled([auth.bootstrapAdmin('admin-one', password), auth.bootstrapAdmin('admin-two', password)]);
    assert.equal(bootstrap.filter(item => item.status === 'fulfilled').length, 1);
    const winner = bootstrap.find(item => item.status === 'fulfilled');
    assert.ok(winner?.status === 'fulfilled');
    const login = await auth.login(winner.value.username, password);
    const actor = await auth.authenticate(login.sessionToken);
    const second = await auth.createUser(actor, {username: 'another-admin', password, role: 'admin'});
    const secondLogin = await auth.login(second.username, password);
    const secondActor = await auth.authenticate(secondLogin.sessionToken);
    const demote = await Promise.allSettled([auth.setUserRole(actor, actor.id, 'user'), auth.setUserStatus(secondActor, second.id, 'disabled')]);
    assert.equal(demote.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal((await db.query("SELECT 1 FROM users WHERE role='admin' AND status='active'")).rowCount, 1);
    const remaining = (await db.query("SELECT username FROM users WHERE role='admin' AND status='active'")).rows[0];
    const current = await auth.authenticate((await auth.login(remaining.username, password)).sessionToken);
    await db.query("ALTER TABLE audit_logs ADD CONSTRAINT block_test_audit CHECK(action <> 'user.create') NOT VALID");
    await assert.rejects(auth.createUser(current, {username: 'rolled-back', password}));
    assert.equal((await db.query("SELECT 1 FROM users WHERE username='rolled-back'")).rowCount, 0);
  } finally {await cleanupTestDatabase(db);}
});

test('admin transactions reject captured actors after logout, revocation or session expiry', async () => {
  const db = await createTestDatabase();
  try {
    const auth = new AuthService(db);
    await auth.bootstrapAdmin('admin', password);
    const login = await auth.login('admin', password);
    const actor = await auth.authenticate(login.sessionToken);
    const user = await auth.createUser(actor, {username: 'target-user', password});
    await auth.logout(login.sessionToken);
    await assert.rejects(auth.createUser(actor, {username: 'after-logout', password}), code('UNAUTHENTICATED'));
    await assert.rejects(auth.setUserRole(actor, user.id, 'admin'), code('UNAUTHENTICATED'));
    await assert.rejects(auth.setUserStatus(actor, user.id, 'disabled'), code('UNAUTHENTICATED'));
    const nextLogin = await auth.login('admin', password);
    const revokedActor = await auth.authenticate(nextLogin.sessionToken);
    await auth.revokeUserSessions(revokedActor, revokedActor.id);
    await assert.rejects(auth.createUser(revokedActor, {username: 'after-revoke', password}), code('UNAUTHENTICATED'));
    await assert.rejects(auth.setUserRole(revokedActor, user.id, 'admin'), code('UNAUTHENTICATED'));
    await assert.rejects(auth.setUserStatus(revokedActor, user.id, 'disabled'), code('UNAUTHENTICATED'));
    const expiring = await auth.login('admin', password);
    const expiredActor = await auth.authenticate(expiring.sessionToken);
    await db.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [expiredActor.sessionId]);
    await assert.rejects(auth.listUsers(expiredActor), code('UNAUTHENTICATED'));
    assert.deepEqual((await db.query('SELECT role,status FROM users WHERE id=$1', [user.id])).rows[0], {role: 'user', status: 'active'});
    assert.equal((await db.query("SELECT 1 FROM users WHERE username IN ('after-logout','after-revoke')")).rowCount, 0);
  } finally {await cleanupTestDatabase(db);}
});

test('concurrent logout/admin mutation and mutual admin revocation avoid lock cycles', async () => {
  const db = await createTestDatabase();
  try {
    const auth = new AuthService(db);
    await auth.bootstrapAdmin('admin-one', password);
    const firstLogin = await auth.login('admin-one', password);
    const first = await auth.authenticate(firstLogin.sessionToken);
    const other = await auth.createUser(first, {username: 'admin-two', password, role: 'admin'});
    const user = await auth.createUser(first, {username: 'target-user', password});
    const logoutAndMutation = await Promise.allSettled([
      auth.setUserStatus(first, user.id, 'disabled'), auth.logout(firstLogin.sessionToken),
    ]);
    for (const result of logoutAndMutation) {
      if (result.status === 'rejected') assert.ok(code('UNAUTHENTICATED')(result.reason));
    }
    const nextFirst = await auth.authenticate((await auth.login('admin-one', password)).sessionToken);
    const second = await auth.authenticate((await auth.login(other.username, password)).sessionToken);
    const mutual = await Promise.allSettled([
      auth.revokeUserSessions(nextFirst, second.id), auth.revokeUserSessions(second, nextFirst.id),
    ]);
    assert.equal(mutual.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = mutual.find(result => result.status === 'rejected');
    assert.ok(rejected?.status === 'rejected' && code('UNAUTHENTICATED')(rejected.reason));
  } finally {await cleanupTestDatabase(db);}
});

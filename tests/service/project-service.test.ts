import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import type {Actor} from '../../server/contracts.js';
import {ProjectService} from '../../server/services/project-service.js';
import {createTestDatabase, cleanupTestDatabase} from './helpers.js';

async function fixture(fn: (db: Pool, service: ProjectService, owner: Actor, other: Actor, admin: Actor) => Promise<void>) {
  const db = await createTestDatabase();
  const actors: Actor[] = ['owner', 'other', 'admin'].map(name => ({id: randomUUID(), role: name === 'admin' ? 'admin' : 'user', source: 'web'}));
  try {
    for (const [index, actor] of actors.entries()) await db.query('INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,$3,$4)', [actor.id, ['owner', 'other', 'admin'][index], 'unused-test-hash', actor.role]);
    await fn(db, new ProjectService(db), actors[0], actors[1], actors[2]);
  } finally {await cleanupTestDatabase(db);}
}
const title = (value: string) => [{type: 'updateProject' as const, properties: {title: value}}];

test('PostgreSQL CRUD preserves unknown data, returns metadata only, and bumps trash/restore revisions', async () => fixture(async (db, service, owner) => {
  const first = await service.create(owner, {title: 'Deck', canvas: {width: 1000, height: 600}});
  assert.equal(first.revision, 0);
  const edited = await service.edit(owner, first.id, {expectedRevision: 0, clientMutationId: 'data', operations: [{type: 'updateProject', properties: {extensions: {future: {nested: ['preserved', 1]}}}}, {type: 'createSlide', slide: {id: 's', custom: {native: true}, elements: []}}]});
  assert.deepEqual((await service.get(owner, first.id)).extensions, edited.extensions);
  const renamed = await service.rename(owner, first.id, {title: 'New title', expectedRevision: 1, clientMutationId: 'rename'});
  assert.equal(renamed.revision, 2);
  const listing = await service.list(owner);
  assert.equal(listing.length, 1); assert.equal(listing[0].title, 'New title'); assert.equal(listing[0].revision, 2);
  assert.equal('document_jsonb' in listing[0], false); assert.equal('document' in listing[0], false); assert.equal('slides' in listing[0], false);
  const removed = await service.remove(owner, first.id, {expectedRevision: 2, clientMutationId: 'remove'});
  assert.equal(removed.revision, 3); assert.equal((await service.list(owner)).length, 0); assert.equal((await service.list(owner, {trash: true})).length, 1);
  await assert.rejects(service.get(owner, first.id), {code: 'NOT_FOUND'});
  const restored = await service.restore(owner, first.id, {expectedRevision: 3, clientMutationId: 'restore'});
  assert.equal(restored.revision, 4); assert.deepEqual(restored.extensions, edited.extensions); assert.deepEqual(restored.slides, edited.slides);
  assert.equal((await db.query('SELECT count(*) FROM project_revisions WHERE project_id=$1', [first.id])).rows[0].count, '5');
  assert.equal((await db.query('SELECT count(*) FROM mutation_receipts WHERE project_id=$1', [first.id])).rows[0].count, '4');
  const audits = await db.query('SELECT * FROM audit_logs WHERE resource_id=$1', [first.id]);
  assert.equal(audits.rowCount, 5); assert.ok(audits.rows.every(row => !('document_jsonb' in row)));
}));

test('owner isolation applies to every project operation, including administrators', async () => fixture(async (_db, service, owner, other, admin) => {
  const doc = await service.create(owner);
  for (const actor of [other, admin]) {
    assert.deepEqual(await service.list(actor), []);
    for (const run of [
      () => service.get(actor, doc.id),
      () => service.edit(actor, doc.id, {expectedRevision: 0, clientMutationId: 'forbidden', operations: title('stolen')}),
      () => service.rename(actor, doc.id, {expectedRevision: 0, clientMutationId: 'forbidden', title: 'stolen'}),
      () => service.remove(actor, doc.id, {expectedRevision: 0, clientMutationId: 'forbidden'}),
      () => service.restore(actor, doc.id, {expectedRevision: 0, clientMutationId: 'forbidden'}),
      () => service.acquireLease(actor, doc.id, 'claimed-owner'),
      () => service.renewLease(actor, doc.id, randomUUID()),
      () => service.releaseLease(actor, doc.id, randomUUID()),
    ]) await assert.rejects(run(), {code: 'NOT_FOUND', status: 404});
  }
  await assert.rejects(service.get(owner, 'not-a-uuid'), {code: 'NOT_FOUND'});
  assert.equal((await service.get(owner, doc.id)).revision, 0);
}));

test('concurrent CAS commits one writer; matching receipts replay original result without duplicate commits', async () => fixture(async (db, service, owner) => {
  const doc = await service.create(owner);
  const request = {expectedRevision: 0, clientMutationId: 'identical', operations: title('once')};
  const [a, b] = await Promise.all([service.edit(owner, doc.id, request), service.edit(owner, doc.id, request)]);
  assert.deepEqual(a, b); assert.equal(a.revision, 1);
  const contenders = await Promise.allSettled(['left', 'right'].map(value => service.edit(owner, doc.id, {expectedRevision: 1, clientMutationId: value, operations: title(value)})));
  assert.equal(contenders.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((contenders.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.code, 'REVISION_CONFLICT');
  assert.deepEqual(await service.edit(owner, doc.id, request), a);
  await assert.rejects(service.edit(owner, doc.id, {...request, operations: title('different')}), {code: 'MUTATION_ID_REUSED'});
  await assert.rejects(service.remove(owner, doc.id, {...request}), {code: 'MUTATION_ID_REUSED'});
  assert.equal((await service.get(owner, doc.id)).revision, 2);
  assert.equal((await db.query('SELECT count(*) FROM project_revisions WHERE project_id=$1', [doc.id])).rows[0].count, '3');
  assert.equal((await db.query('SELECT count(*) FROM mutation_receipts WHERE project_id=$1', [doc.id])).rows[0].count, '2');
}));

test('leases require actor-owned unexpired tokens, forbid takeover, and gate snapshots and regular writes', async () => fixture(async (db, service, owner) => {
  const doc = await service.create(owner);
  await assert.rejects(service.edit(owner, doc.id, {expectedRevision: 0, clientMutationId: 'no-lease', operations: [{type: 'replaceContent', document: {...doc, title: 'snapshot'}}]}), {code: 'LOCK_LOST'});
  const lease = await service.acquireLease(owner, doc.id, 'browser-a');
  assert.ok(Date.parse(lease.expiresAt) > Date.now()); assert.equal(lease.holder, 'browser-a');
  await assert.rejects(service.acquireLease(owner, doc.id, 'browser-a'), {code: 'PROJECT_BUSY'});
  await assert.rejects(service.acquireLease(owner, doc.id, 'browser-b'), {code: 'PROJECT_BUSY'});
  await assert.rejects(service.edit(owner, doc.id, {expectedRevision: 0, clientMutationId: 'busy', operations: title('cannot overwrite')}), {code: 'PROJECT_BUSY'});
  await assert.rejects(service.remove(owner, doc.id, {expectedRevision: 0, clientMutationId: 'busy-remove'}), {code: 'PROJECT_BUSY'});
  await assert.rejects(service.renewLease(owner, doc.id, randomUUID()), {code: 'LOCK_LOST'});
  await assert.rejects(service.releaseLease(owner, doc.id, randomUUID()), {code: 'LOCK_LOST'});
  const renewed = await service.renewLease(owner, doc.id, lease.leaseToken); assert.equal(renewed.leaseToken, lease.leaseToken);
  const request = {expectedRevision: 0, clientMutationId: 'snapshot', leaseToken: lease.leaseToken, operations: [{type: 'replaceContent' as const, document: {...doc, title: 'snapshot saved'}}]};
  const saved = await service.edit(owner, doc.id, request); assert.equal(saved.revision, 1);
  await db.query('UPDATE project_locks SET expires_at=clock_timestamp()-interval \'1 second\' WHERE project_id=$1', [doc.id]);
  assert.deepEqual(await service.edit(owner, doc.id, request), saved);
  await assert.rejects(service.renewLease(owner, doc.id, lease.leaseToken), {code: 'LOCK_LOST'});
  await assert.rejects(service.releaseLease(owner, doc.id, lease.leaseToken), {code: 'LOCK_LOST'});
  await assert.rejects(service.edit(owner, doc.id, {expectedRevision: 1, clientMutationId: 'stale-token', leaseToken: lease.leaseToken, operations: title('stale')}), {code: 'LOCK_LOST'});
  const replacement = await service.acquireLease(owner, doc.id, 'browser-b'); assert.notEqual(replacement.leaseToken, lease.leaseToken);
  const incremental = await service.edit(owner, doc.id, {expectedRevision: 1, clientMutationId: 'incremental', leaseToken: replacement.leaseToken, operations: title('incremental saved')}); assert.equal(incremental.revision, 2);
  assert.deepEqual(await service.releaseLease(owner, doc.id, replacement.leaseToken), {released: true});
  assert.equal((await service.edit(owner, doc.id, {expectedRevision: 2, clientMutationId: 'unlocked', operations: title('released')})).revision, 3);
}));

test('disabled users are rechecked on reads, writes, receipts, and leases; MCP scopes remain bounded', async () => fixture(async (db, service, owner) => {
  const doc = await service.create(owner);
  const request = {expectedRevision: 0, clientMutationId: 'before-disable', operations: title('saved')};
  await service.edit(owner, doc.id, request);
  const mcp: Actor = {...owner, source: 'mcp', scopes: ['projects:read'], projectAllowlist: []};
  assert.deepEqual(await service.list(mcp), []);
  await assert.rejects(service.get(mcp, doc.id), {code: 'FORBIDDEN'});
  await assert.rejects(service.edit({...mcp, projectAllowlist: null}, doc.id, request), {code: 'FORBIDDEN'});
  await db.query('UPDATE users SET status=\'disabled\' WHERE id=$1', [owner.id]);
  for (const run of [() => service.get(owner, doc.id), () => service.list(owner), () => service.create(owner), () => service.edit(owner, doc.id, request), () => service.acquireLease(owner, doc.id, 'disabled'), () => service.renewLease(owner, doc.id, randomUUID()), () => service.releaseLease(owner, doc.id, randomUUID())]) await assert.rejects(run(), {code: 'UNAUTHENTICATED'});
}));

test('invalid batches and database audit failure roll back document, revision, and mutation receipt together', async () => fixture(async (db, service, owner) => {
  const doc = await service.create(owner);
  await assert.rejects(service.edit(owner, doc.id, {expectedRevision: 0, clientMutationId: 'invalid', operations: [...title('partial'), {type: 'deleteSlide', slideId: 'missing'}]}), {code: 'INVALID_REQUEST'});
  await assert.rejects(service.edit(owner, doc.id, {expectedRevision: undefined as unknown as number, clientMutationId: 'missing-cas', operations: title('invalid')}), {code: 'INVALID_REQUEST'});
  await assert.rejects(service.edit(owner, doc.id, {expectedRevision: 0, clientMutationId: '', operations: title('invalid')}), {code: 'INVALID_REQUEST'});
  await db.query('CREATE FUNCTION fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION \'injected audit failure\'; END $$');
  await db.query('CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_audit()');
  await assert.rejects(service.edit(owner, doc.id, {expectedRevision: 0, clientMutationId: 'db-failure', operations: title('must roll back')}), /injected audit failure/);
  assert.deepEqual(await service.get(owner, doc.id), doc);
  assert.equal((await db.query('SELECT count(*) FROM project_revisions WHERE project_id=$1', [doc.id])).rows[0].count, '1');
  assert.equal((await db.query('SELECT count(*) FROM mutation_receipts WHERE project_id=$1', [doc.id])).rows[0].count, '0');
  await db.query('DROP TRIGGER fail_audit ON audit_logs');
  assert.equal((await service.edit(owner, doc.id, {expectedRevision: 0, clientMutationId: 'db-failure', operations: title('retry saved')})).revision, 1);
}));

test('rename, trash and restore honor lease tokens and bind receipts to the supplied token', async () => fixture(async (_db, service, owner) => {
  const doc = await service.create(owner);
  const lease = await service.acquireLease(owner, doc.id, 'editor');
  await assert.rejects(service.rename(owner, doc.id, {expectedRevision: 0, clientMutationId: 'rename', title: 'renamed'}), {code: 'PROJECT_BUSY'});
  const renamed = await service.rename(owner, doc.id, {expectedRevision: 0, clientMutationId: 'rename', title: 'renamed', leaseToken: lease.leaseToken});
  await assert.rejects(service.rename(owner, doc.id, {expectedRevision: 0, clientMutationId: 'rename', title: 'renamed', leaseToken: randomUUID()}), {code: 'MUTATION_ID_REUSED'});
  const request = {expectedRevision: 1, clientMutationId: 'trash', leaseToken: lease.leaseToken};
  const removed = await service.remove(owner, doc.id, request); assert.equal(removed.revision, renamed.revision + 1);
  assert.deepEqual(await service.remove(owner, doc.id, request), removed);
  await assert.rejects(service.restore(owner, doc.id, {expectedRevision: 2, clientMutationId: 'restore'}), {code: 'PROJECT_BUSY'});
  assert.equal((await service.restore(owner, doc.id, {expectedRevision: 2, clientMutationId: 'restore', leaseToken: lease.leaseToken})).revision, 3);
  await service.releaseLease(owner, doc.id, lease.leaseToken);
}));

test('service boundaries enforce title and encoded document limits without committing partial data', async () => fixture(async (db, service, owner) => {
  await assert.rejects(service.create(owner, {title: 'x'.repeat(501)}), {code: 'INVALID_REQUEST'});
  const doc = await service.create(owner);
  await assert.rejects(service.rename(owner, doc.id, {expectedRevision: 0, clientMutationId: 'long-rename', title: 'x'.repeat(501)}), {code: 'INVALID_REQUEST'});
  await assert.rejects(service.edit(owner, doc.id, {expectedRevision: 0, clientMutationId: 'long-edit', operations: title('x'.repeat(501))}), {code: 'INVALID_REQUEST'});
  await assert.rejects(service.edit(owner, doc.id, {expectedRevision: 0, clientMutationId: 'oversize', operations: [{type: 'updateProject', properties: {extensions: {large: 'x'.repeat(32 * 1024 * 1024)}}}]}), {code: 'INVALID_REQUEST'});
  assert.deepEqual(await service.get(owner, doc.id), doc);
  assert.equal((await db.query('SELECT count(*) FROM mutation_receipts WHERE project_id=$1', [doc.id])).rows[0].count, '0');
}));

test('captured actors cannot reuse revoked, expired, or differently bound sessions, including receipt replay', async () => fixture(async (db, service, owner, other) => {
  const actor = {...owner, sessionId: randomUUID()};
  await db.query('INSERT INTO sessions(id,user_id,session_hash,csrf_hash,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval \'1 hour\')', [actor.sessionId, actor.id, randomUUID(), randomUUID()]);
  const doc = await service.create(actor);
  const request = {expectedRevision: 0, clientMutationId: 'saved-before-revoke', operations: title('saved')};
  await service.edit(actor, doc.id, request);
  await db.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1', [actor.sessionId]);
  for (const run of [() => service.get(actor, doc.id), () => service.list(actor), () => service.edit(actor, doc.id, request), () => service.acquireLease(actor, doc.id, 'revoked'), () => service.renewLease(actor, doc.id, randomUUID()), () => service.releaseLease(actor, doc.id, randomUUID())]) await assert.rejects(run(), {code: 'UNAUTHENTICATED'});
  await db.query('UPDATE sessions SET revoked_at=NULL,expires_at=clock_timestamp()-interval \'1 second\' WHERE id=$1', [actor.sessionId]);
  await assert.rejects(service.get(actor, doc.id), {code: 'UNAUTHENTICATED'});
  await db.query('UPDATE sessions SET expires_at=clock_timestamp()+interval \'1 hour\' WHERE id=$1', [actor.sessionId]);
  await assert.rejects(service.get({...other, sessionId: actor.sessionId}, doc.id), {code: 'UNAUTHENTICATED'});
  assert.equal((await service.get(actor, doc.id)).revision, 1);
}));

test('an in-flight write holds its session lock until commit; waiting revocation blocks every later write', async () => fixture(async (db, service, owner) => {
  const actor = {...owner, sessionId: randomUUID()};
  await db.query('INSERT INTO sessions(id,user_id,session_hash,csrf_hash,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval \'1 hour\')', [actor.sessionId, actor.id, randomUUID(), randomUUID()]);
  const doc = await service.create(actor);
  const advisoryKey = Math.floor(Math.random() * 1000000000) + 1;
  await db.query(`CREATE FUNCTION hold_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${advisoryKey}); RETURN NEW; END $$`);
  await db.query('CREATE TRIGGER hold_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION hold_audit()');
  const blocker = await db.connect(), revoker = await db.connect();
  let writing: Promise<unknown> | undefined, revoking: Promise<unknown> | undefined;
  const waitFor = async (check: () => Promise<boolean>) => {
    for (let attempt = 0; attempt < 100; attempt++) {if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10));}
    throw Error('Expected PostgreSQL lock was not observed');
  };
  try {
    await blocker.query('SELECT pg_advisory_lock($1)', [advisoryKey]);
    writing = service.edit(actor, doc.id, {expectedRevision: 0, clientMutationId: 'in-flight', operations: title('committed before revoke')});
    await waitFor(async () => Boolean((await db.query('SELECT 1 FROM pg_locks WHERE locktype=\'advisory\' AND objid=$1 AND NOT granted', [advisoryKey])).rowCount));
    const revokerPid = (await revoker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    revoking = revoker.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1', [actor.sessionId]);
    await waitFor(async () => Boolean((await db.query('SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type=\'Lock\'', [revokerPid])).rowCount));
    await blocker.query('SELECT pg_advisory_unlock($1)', [advisoryKey]);
    await writing; await revoking;
    await assert.rejects(service.edit(actor, doc.id, {expectedRevision: 1, clientMutationId: 'after-revoke', operations: title('must not commit')}), {code: 'UNAUTHENTICATED'});
    assert.equal((await service.get(owner, doc.id)).revision, 1);
    assert.equal((await service.get(owner, doc.id)).title, 'committed before revoke');
  } finally {
    await blocker.query('SELECT pg_advisory_unlock($1)', [advisoryKey]);
    await Promise.allSettled([writing, revoking]);
    blocker.release(); revoker.release();
  }
}));

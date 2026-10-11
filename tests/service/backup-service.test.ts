import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {AuthService} from '../../server/auth/auth-service.js';
import {ProjectService} from '../../server/services/project-service.js';
import {BackupService} from '../../server/services/backup-service.js';
import {createTestDatabase,cleanupTestDatabase} from './helpers.js';

test('real pg_dump snapshot, assets, isolated pg_restore and persisted backup status',async()=>{
 const db=await createTestDatabase(),root=await realpath(await mkdtemp(path.join(tmpdir(),'sp-backup-test-')));const source=path.join(root,'source');await mkdir(source);await writeFile(path.join(source,'image.png'),Buffer.from([137,80,78,71,13,10,26,10]));
 try{
  const auth=new AuthService(db);await auth.bootstrapAdmin('backup-admin','isolated-backup-password');const login=await auth.login('backup-admin','isolated-backup-password'),actor=await auth.authenticate(login.sessionToken);
  const projects=new ProjectService(db),doc=await projects.create(actor,{title:'backup photo'});await projects.edit(actor,doc.id,{expectedRevision:0,clientMutationId:'image',operations:[{type:'updateProject',properties:{extensions:{privateData:'retained',embeddedImage:'data:image/png;base64,iVBORw0KGgo='}}}]});
  const pgBinDirectory=process.env.SP_TEST_PG_BIN;if(!pgBinDirectory)throw Error('SP_TEST_PG_BIN must contain actual pg_dump/pg_restore; no simulated backup acceptance');
  const control=new URL(process.env.TEST_DATABASE_URL!);control.pathname='/postgres';control.searchParams.delete('options');
  const backup=new BackupService(db,{directory:path.join(root,'backups'),assetDirectory:source,databaseUrl:process.env.TEST_DATABASE_URL,restoreDatabaseUrl:control.toString(),pgBinDirectory});
  const job=await backup.start(actor);await backup.waitForIdle();const list=await backup.list(actor);assert.equal(list.jobs[0].status,'verified',JSON.stringify(list));
  const manifest=JSON.parse(await readFile(path.join(root,'backups',job.id,'manifest.json'),'utf8'));assert.equal(manifest.projects.length,1);assert.equal(manifest.projects[0].revision,1);assert.equal(manifest.assets.length,1);assert.ok(manifest.restoredAt);assert.ok(!JSON.stringify(list).includes('retained'));
  const result=await backup.restoreChecks(actor);assert.equal(result.status,'verified');assert.equal(result.projectCount,1);assert.equal(result.assetCount,1);
  await writeFile(path.join(root,'backups',job.id,'assets','image.png'),'tampered');await assert.rejects(backup.restoreChecks(actor),/verification mismatch/);
  assert.equal((await backup.list(actor)).jobs[0].status,'failed');
  const audits=(await db.query("SELECT outcome FROM audit_logs WHERE action='backup.restore_check' ORDER BY created_at")).rows;assert.deepEqual(audits.map(row=>row.outcome),['success','failure']);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM pg_database WHERE datname LIKE 'sp_restore_%'")).rows[0].count,0);
  await db.query('UPDATE sessions SET reauth_until=clock_timestamp()-interval \'1 minute\' WHERE id=$1',[actor.sessionId]);await assert.rejects(backup.start(actor),{code:'REAUTHENTICATION_REQUIRED'});
 }finally{await cleanupTestDatabase(db);await rm(root,{recursive:true,force:true});}
});

test('startup preserves another backup process holding the PostgreSQL flight lock',async()=>{
 const db=await createTestDatabase();const worker=await db.connect();
 try{
  const auth=new AuthService(db);await auth.bootstrapAdmin('backup-lock-admin','isolated-backup-password');const login=await auth.login('backup-lock-admin','isolated-backup-password'),actor=await auth.authenticate(login.sessionToken);
  await worker.query("SELECT pg_advisory_lock(hashtext(current_schema()||':sp-backup-flight'))");
  const job=(await db.query("INSERT INTO backup_jobs(status) VALUES('running') RETURNING id")).rows[0].id;
  const other=new BackupService(db,{directory:'/private/tmp/not-used',databaseUrl:process.env.TEST_DATABASE_URL});
  await other.reconcileInterrupted();assert.equal((await other.list(actor)).jobs[0].status,'running');
  await assert.rejects(other.start(actor),{code:'BACKUP_BUSY'});await assert.rejects(other.startScheduled(),/already running/);
  await worker.query("SELECT pg_advisory_unlock(hashtext(current_schema()||':sp-backup-flight'))");
  await other.reconcileInterrupted();const row=(await db.query('SELECT status,error_code FROM backup_jobs WHERE id=$1',[job])).rows[0];assert.deepEqual(row,{status:'failed',error_code:'INTERRUPTED'});
 }finally{worker.release();await cleanupTestDatabase(db);}
});

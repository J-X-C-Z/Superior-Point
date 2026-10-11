import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import {AuthService} from '../../server/auth/auth-service.js';
import {TokenService} from '../../server/auth/token-service.js';
import {ProjectService} from '../../server/services/project-service.js';
import {MetricsService} from '../../server/observability/metrics-service.js';
import {registerObservabilityRoutes} from '../../server/observability/routes.js';
import {createTestDatabase,cleanupTestDatabase} from './helpers.js';
import type {Database} from '../../server/contracts.js';
test('tool metrics persist bounded metadata, filter/page server-side, and never fail committed work',async()=>{
 const db=await createTestDatabase(),metrics=new MetricsService(db),auth=new AuthService(db);
 try{
  await auth.bootstrapAdmin('metrics-admin','metrics-strong-password');const login=await auth.login('metrics-admin','metrics-strong-password'),admin=await auth.authenticate(login.sessionToken),tokens=new TokenService(db);
  const token=await tokens.create(admin,{name:'metrics'}),actor=await tokens.authenticate(token.token);
  const input={actor,tool:'sp_get_document',durationMs:12,outcome:'success' as const,transport:'streamable-http' as const};
  assert.equal(await metrics.recordToolCall({...input,...{args:{document:'NEVER_STORE_BODY'},token:'NEVER_STORE_TOKEN'}}),true);
  assert.equal(await metrics.recordToolCall({...input,tool:'sp_edit',durationMs:30,outcome:'error',errorCode:'REVISION_CONFLICT'}),true);
  assert.equal(await metrics.recordToolCall({...input,outcome:'error',errorCode:token.token}),true);
  assert.equal(await metrics.recordToolCall({...input,tool:'arbitrary_secret_tool'}),false);
  assert.equal(await metrics.recordToolCall({...input,durationMs:NaN}),false);
  await assert.rejects(metrics.tools(actor),{code:'FORBIDDEN'});
  const all=await metrics.tools(admin,{limit:1});assert.equal(all.total,3);assert.equal(all.rows.length,1);assert.equal(all.summary.errors,2);assert.equal(all.summary.errorRate,2/3);
  assert.notEqual((await metrics.tools(admin,{limit:1,offset:1})).rows[0].id,all.rows[0].id);
  const edit=await metrics.tools(admin,{tool:'sp_edit',userId:admin.id});assert.equal(edit.total,1);assert.equal(edit.rows[0].errorCode,'REVISION_CONFLICT');
  assert.equal((await metrics.tools(admin,{from:'2000-01-01T00:00:00Z',to:'2000-01-02T00:00:00Z'})).total,0);
  await assert.rejects(metrics.tools(admin,{from:'not-a-date'}),{code:'INVALID_REQUEST'});
  await assert.rejects(metrics.tools(admin,{limit:101}),{code:'INVALID_REQUEST'});
  const persisted=JSON.stringify((await db.query('SELECT * FROM mcp_tool_metrics')).rows);assert.doesNotMatch(persisted,/NEVER_STORE|sp_pat_/);
  const app=Fastify({ajv:{customOptions:{removeAdditional:false,coerceTypes:false}}});registerObservabilityRoutes(app,{metrics,actor:async()=>admin});try{assert.equal((await app.inject('/api/v1/admin/observability/tools?limit=1&tool=sp_edit')).json().total,1);assert.equal((await app.inject('/api/v1/admin/observability/tools?args=secret')).statusCode,400);}finally{await app.close();}
  const projects=new ProjectService(db),document=await projects.create(admin,{title:'committed before failed metrics'});
  const broken=new MetricsService({query:async()=>{throw Error('unavailable')}} as unknown as Database);
  assert.equal(await broken.recordToolCall(input),false);assert.equal((await projects.get(admin,document.id)).title,'committed before failed metrics');
  await db.query("UPDATE users SET role='user' WHERE id=$1",[admin.id]);
  await assert.rejects(metrics.tools(admin),{code:'FORBIDDEN'});await assert.rejects(metrics.resources(admin),{code:'FORBIDDEN'});
 }finally{await cleanupTestDatabase(db);}
});
test('resource scopes are explicit; host file is sanitized, bounded, stale-safe, and optional',async()=>{
 const db=await createTestDatabase(),directory=await mkdtemp(path.join(tmpdir(),'sp-metrics-')),auth=new AuthService(db);
 try{
  await auth.bootstrapAdmin('resource-admin','metrics-strong-password');const login=await auth.login('resource-admin','metrics-strong-password'),admin=await auth.authenticate(login.sessionToken);
  const missing=await new MetricsService(db).resources(admin);assert.equal(missing.host.status,'unavailable');assert.equal(missing.application.scope,'application-process');assert.ok(missing.application.memory.rssBytes>0);assert.ok(missing.database.connections>0);assert.ok(missing.database.probeDurationMs>=0);
  const filename=path.join(directory,'host.json'),metrics=new MetricsService(db,{hostMetricsFile:filename});
  const fixture={source:'hakari-host',generatedAt:new Date().toISOString(),cpu:{percent:12.5},memory:{totalBytes:1000,availableBytes:500},disk:{totalBytes:2000,availableBytes:1500},env:'NEVER_EXPOSE_ENV',token:'NEVER_EXPOSE_TOKEN',containers:{dockerSocket:'NEVER_EXPOSE_SOCKET'}};
  await writeFile(filename,JSON.stringify(fixture));const current=await metrics.resources(admin);assert.equal(current.host.status,'ok');assert.doesNotMatch(JSON.stringify(current),/NEVER_EXPOSE/);
  await writeFile(filename,JSON.stringify({...fixture,generatedAt:new Date(Date.now()-180000).toISOString()}));assert.equal((await metrics.resources(admin)).host.status,'unavailable');
  await writeFile(filename,JSON.stringify({...fixture,cpu:{percent:999}}));assert.equal((await metrics.resources(admin)).host.status,'unavailable');
  const link=path.join(directory,'link.json');await symlink(filename,link);assert.equal((await new MetricsService(db,{hostMetricsFile:link}).resources(admin)).host.status,'unavailable');
  await writeFile(filename,'x'.repeat(65537));assert.equal((await metrics.resources(admin)).host.status,'unavailable');
  await auth.logout(login.sessionToken);await assert.rejects(metrics.resources(admin),{code:'UNAUTHENTICATED'});
 }finally{await rm(directory,{recursive:true,force:true});await cleanupTestDatabase(db);}
});

test('locked telemetry times out, drops excess concurrency and leaves business connections available',async()=>{
 const db=await createTestDatabase(),metrics=new MetricsService(db),auth=new AuthService(db);let lock;
 try{
  await auth.bootstrapAdmin('metrics-lock-admin','metrics-strong-password');const login=await auth.login('metrics-lock-admin','metrics-strong-password'),admin=await auth.authenticate(login.sessionToken),tokens=new TokenService(db);
  const token=await tokens.create(admin,{name:'metrics-lock'}),actor=await tokens.authenticate(token.token),input={actor,tool:'sp_edit',durationMs:1,outcome:'success' as const,transport:'streamable-http' as const};
  lock=await db.connect();await lock.query('BEGIN');await lock.query('LOCK TABLE mcp_tool_metrics IN ACCESS EXCLUSIVE MODE');
  const started=performance.now(),first=metrics.recordToolCall(input),second=metrics.recordToolCall(input);
  assert.equal(await metrics.recordToolCall(input),false);
  const document=await new ProjectService(db).create(admin,{title:'business while metrics locked'});assert.equal(document.revision,0);
  assert.deepEqual(await Promise.all([first,second]),[false,false]);assert.ok(performance.now()-started<1500,'telemetry must have a bounded lock wait');assert.equal(db.waitingCount,0);
  await lock.query('ROLLBACK');lock.release();lock=undefined;
  assert.equal(await metrics.recordToolCall(input),true,'all concurrency slots and clients must be released after timeout');
  assert.equal((await metrics.tools(admin)).total,1);assert.equal((await new ProjectService(db).get(admin,document.id)).title,'business while metrics locked');
 }finally{if(lock){await lock.query('ROLLBACK');lock.release();}await cleanupTestDatabase(db);}
});

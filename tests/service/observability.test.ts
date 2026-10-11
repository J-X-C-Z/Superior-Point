import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import {execFileSync} from 'node:child_process';
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
  const containers={source:'hakari-fixed-docker-inspect',generatedAt:new Date().toISOString(),rows:['superior-point-app-1','superior-point-db-1','superior-point-caddy-1'].map(name=>({name,status:'ok',state:'running',health:'healthy',restartCount:2,oomKilled:false}))};
  await writeFile(filename,JSON.stringify({...fixture,containers}));const withContainers=(await metrics.resources(admin)).host;const entries=withContainers.containers;assert.ok(entries&&'rows' in entries);assert.equal(entries.status,'ok');assert.equal(entries.rows.length,3);assert.deepEqual(entries.rows.map(row=>row.name),containers.rows.map(row=>row.name));
  await writeFile(filename,JSON.stringify({...fixture,containers:{...containers,rows:containers.rows.slice(0,2)}}));assert.equal((await metrics.resources(admin)).host.containers?.status,'unavailable');
  for(const bad of [{name:'other-service-1'},{state:'NEVER_EXPOSE_ENV'},{health:'<script>evil</script>'},{restartCount:-1},{restartCount:9007199254740992},{oomKilled:'false'},{Env:'NEVER_EXPOSE_ENV'}]){
   await writeFile(filename,JSON.stringify({...fixture,containers:{...containers,rows:containers.rows.map((row,index)=>index===0?{...row,...bad}:row)}}));const value=await metrics.resources(admin);assert.equal(value.host.containers?.status,'unavailable');assert.doesNotMatch(JSON.stringify(value),/other-service|NEVER_EXPOSE|<script>/);
  }
  await writeFile(filename,JSON.stringify({...fixture,containers:{...containers,generatedAt:new Date(Date.now()-180000).toISOString()}}));const staleContainers=(await metrics.resources(admin)).host;assert.equal(staleContainers.status,'ok');assert.equal(staleContainers.containers?.status,'unavailable');
  await writeFile(filename,JSON.stringify({...fixture,containers:{...containers,rows:[{name:'superior-point-app-1',status:'unavailable'},...containers.rows.slice(1)]}}));assert.equal((await metrics.resources(admin)).host.containers?.status,'partial');
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

test('optional collector invokes only fixed formatted Docker inspection and publishes no extra data',()=>{
 const output=execFileSync('python3',['-c',`import importlib.util, json, types, subprocess
spec=importlib.util.spec_from_file_location('collector','deploy/hakari/collect-metrics.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
calls=[]
def inspect(args, **kwargs):
 calls.append(args)
 assert args[:4]==['/usr/bin/docker','--host=unix:///var/run/docker.sock','inspect','--type=container']
 assert args[4]=='--format' and args[-1] in m.CONTAINERS
 assert '.Config' not in args[5] and '.NetworkSettings' not in args[5] and '.Args' not in args[5]
 assert kwargs['timeout']==5 and kwargs['check'] is True
 if args[-1]=='superior-point-db-1': raise subprocess.CalledProcessError(1,args,stderr='NEVER_PRINT_SECRET')
 return types.SimpleNamespace(stdout=json.dumps({'state':'running','health':'healthy','restartCount':3,'oomKilled':False,'Env':'NEVER_EXPOSE_SECRET'}))
m.subprocess.run=inspect
data=m.collect_containers()
assert len(calls)==3 and len(data['rows'])==3
assert data['rows'][1]=={'name':'superior-point-db-1','status':'unavailable'}
assert data['rows'][0]['restartCount']==3
assert 'NEVER_' not in json.dumps(data)
print('fixed Docker fixture passed')`],{encoding:'utf8'});assert.match(output,/fixture passed/);
});
test('container dashboard identifies the host source and only fixed lifecycle rows',()=>{
 const output=execFileSync(process.execPath,['--input-type=module','-e',`import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {mountObservability} from './web/admin/observability.js';
 const dom=new JSDOM('<main></main>'),container=dom.window.document.querySelector('main');let mounted;
 const generatedAt=new Date().toISOString(),rows=['superior-point-app-1','superior-point-db-1','superior-point-caddy-1'].map(name=>({name,status:'ok',state:'running',health:'healthy',restartCount:2,oomKilled:false}));
 const data={generatedAt,application:{status:'ok',uptimeSeconds:1,cpu:{oneCorePercent:0},memory:{rssBytes:1,heapUsedBytes:1},cgroup:{status:'unavailable'},disk:{status:'unavailable'}},api:{status:'ok'},database:{status:'ok',connections:1,active:1,probeDurationMs:1},host:{status:'ok',generatedAt,cpu:{percent:1},memory:{totalBytes:2,availableBytes:1},disk:{totalBytes:2,availableBytes:1},containers:{status:'ok',source:'hakari-fixed-docker-inspect',generatedAt,rows}}};
 try{mounted=mountObservability({container,api:{async request(url){return url.includes('/resources')?data:{total:0,summary:{calls:0,errors:0,errorRate:0,averageDurationMs:0},rows:[]};}}});await new Promise(resolve=>setTimeout(resolve,0));assert.match(container.textContent,/Hakari 固定 Docker inspect 采集/);for(const row of rows)assert.ok(container.textContent.includes(row.name));assert.match(container.textContent,/重启次数/);assert.match(container.textContent,/OOM/);assert.match(container.textContent,/healthy/);assert.equal(container.querySelectorAll('table').length,4);console.log('container dashboard passed');}finally{mounted?.destroy();dom.window.close();}`],{encoding:'utf8'});assert.match(output,/dashboard passed/);
});

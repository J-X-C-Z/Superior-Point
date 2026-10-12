import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {buildApp} from '../../server/app.js';
import {AuthService} from '../../server/auth/auth-service.js';
import {TokenService} from '../../server/auth/token-service.js';
import {ProjectService} from '../../server/services/project-service.js';
import {createTestDatabase,cleanupTestDatabase} from './helpers.js';
for(const transport of ['http','stdio'])test(`SDK ${transport} revision tools preserve immutable history, receipts, scopes, CAS and browser leases`,async()=>{
 const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=(probe.address() as {port:number}).port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
 const origin='http://127.0.0.1:'+port,db=await createTestDatabase(),app=buildApp({db,origin}),clients:Client[]=[];
 try{
  const auth=new AuthService(db);await auth.bootstrapAdmin('history-mcp-admin','history-mcp-strong-password');const login=await auth.login('history-mcp-admin','history-mcp-strong-password'),owner=await auth.authenticate(login.sessionToken),tokens=new TokenService(db),projects=new ProjectService(db);
  const original=await projects.create(owner,{title:'history original'});const first=await projects.edit(owner,original.id,{expectedRevision:0,clientMutationId:'first-edit',operations:[{type:'createSlide',slide:{id:'historical-slide',notes:'preserve notes',elements:[{id:'text',type:'text',x:0,y:0,w:100,h:30,text:'first text'}]}}]});
  await projects.edit(owner,original.id,{expectedRevision:1,clientMutationId:'second-edit',operations:[{type:'updateElement',slideId:'historical-slide',elementId:'text',properties:{text:'later text'}}]});
  const writer=await tokens.create(owner,{name:'history writer',scopes:['projects:read','projects:write'],projectAllowlist:[original.id]});await app.listen({host:'127.0.0.1',port});
  const connect=async(raw:string)=>{const client=new Client({name:'history-acceptance',version:'1'});clients.push(client);await client.connect(transport==='http'?new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{authorization:'Bearer '+raw}}}):new StdioClientTransport({command:process.execPath,args:[path.resolve('mcp/bridge/server.js')],env:{SP_API_URL:origin,SP_API_TOKEN:raw,SP_BRIDGE_ALLOW_HTTP:'1'},stderr:'pipe'}));return client;};
  const client=await connect(writer.token);assert.equal((await client.listTools()).tools.length,22);
  const call=async(name:string,args:Record<string,unknown>,current=client)=>{const result=await current.callTool({name,arguments:args});return {isError:result.isError,value:JSON.parse((result.content as {text:string}[])[0].text)};};
  assert.deepEqual((await call('sp_list_revisions',{projectId:original.id})).value.map((row:{revision:number})=>row.revision),[2,1,0]);
  assert.deepEqual((await call('sp_get_revision',{projectId:original.id,revision:1})).value,first);
  const diff=(await call('sp_revision_diff',{projectId:original.id,fromRevision:1,toRevision:2})).value;assert.deepEqual(diff.slides[0].elements,[{id:'text',status:'modified'}]);
  assert.equal((await call('sp_get_revision',{projectId:original.id,revision:99})).value.error.code,'NOT_FOUND');
  const restore={projectId:original.id,revision:1,expectedRevision:2,clientMutationId:'history-sdk-restore'},browser=await projects.acquireLease(owner,original.id,'active-browser');
  assert.equal((await call('sp_restore_revision',restore)).value.error.code,'PROJECT_BUSY');await projects.releaseLease(owner,original.id,browser.leaseToken);
  assert.equal((await call('sp_restore_revision',{...restore,expectedRevision:1,clientMutationId:'stale-restore'})).value.error.code,'REVISION_CONFLICT');
  const restored=await call('sp_restore_revision',restore);assert.equal(restored.isError,undefined,JSON.stringify(restored));assert.equal(restored.value.revision,3);assert.deepEqual(restored.value.slides,first.slides);
  const resumed=await projects.acquireLease(owner,original.id,'browser-after-restore');const restarted=await connect(writer.token);assert.deepEqual((await call('sp_restore_revision',restore,restarted)).value,restored.value);await projects.releaseLease(owner,original.id,resumed.leaseToken);
  assert.equal((await call('sp_restore_revision',{...restore,revision:0})).value.error.code,'MUTATION_ID_REUSED');assert.equal((await projects.get(owner,original.id)).revision,3);assert.deepEqual(await projects.getRevision(owner,original.id,1),first);
  const readerToken=await tokens.create(owner,{name:'read-only history',scopes:['projects:read'],projectAllowlist:[original.id]}),reader=await connect(readerToken.token);assert.equal((await call('sp_get_revision',{projectId:original.id,revision:1},reader)).isError,undefined);assert.equal((await call('sp_restore_revision',{...restore,expectedRevision:3,clientMutationId:'reader-restore'},reader)).value.error.code,'FORBIDDEN');
  const outside=await projects.create(owner);assert.equal((await call('sp_list_revisions',{projectId:outside.id})).value.error.code,'FORBIDDEN');
  await auth.createUser(owner,{username:'other-history',password:'history-mcp-strong-password'});const otherLogin=await auth.login('other-history','history-mcp-strong-password'),other=await auth.authenticate(otherLogin.sessionToken),otherToken=await tokens.create(other,{name:'other history'}),otherClient=await connect(otherToken.token);assert.equal((await call('sp_get_revision',{projectId:original.id,revision:1},otherClient)).value.error.code,'NOT_FOUND');
  if(transport==='http'){const deadline=Date.now()+2000;while(!(await db.query("SELECT id FROM mcp_tool_metrics WHERE tool='sp_restore_revision' AND outcome='success' LIMIT 1")).rowCount){assert.ok(Date.now()<deadline,'revision telemetry must persist');await new Promise(resolve=>setTimeout(resolve,10));}}
  await tokens.revoke(owner,writer.id);if(transport==='http')await assert.rejects(client.listTools(),/UNAUTHENTICATED/);else assert.equal((await call('sp_list_revisions',{projectId:original.id})).value.error.code,'UNAUTHENTICATED');
 }finally{for(const client of clients)await client.close();await app.close();await cleanupTestDatabase(db);}
});

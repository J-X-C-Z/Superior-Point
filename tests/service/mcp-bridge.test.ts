import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,realpath,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {buildApp} from '../../server/app.js';
import {AuthService} from '../../server/auth/auth-service.js';
import {TokenService} from '../../server/auth/token-service.js';
import {ProjectService} from '../../server/services/project-service.js';
import {createTestDatabase,cleanupTestDatabase} from './helpers.js';

test('real SDK stdio -> HTTP -> PAT -> PostgreSQL edits, leases, import/export, revocation and scopes',async()=>{
 const db=await createTestDatabase();const root=await realpath(await mkdtemp(path.join(tmpdir(),'sp-cloud-bridge-')));
 const app=buildApp({db,origin:'http://127.0.0.1:3000',secureCookies:false});const clients:Client[]=[];
 try {
  const auth=new AuthService(db);await auth.bootstrapAdmin('bridge-admin','test-bridge-password');const login=await auth.login('bridge-admin','test-bridge-password');const actor=await auth.authenticate(login.sessionToken);
  const tokens=new TokenService(db),projects=new ProjectService(db);const token=await tokens.create(actor,{name:'bridge-test'});
  const apiUrl=await app.listen({host:'127.0.0.1',port:0});
  const connect=async(raw:string)=>{const client=new Client({name:'vertical-test',version:'1'});clients.push(client);await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('mcp/bridge/server.js'),'--root',root],env:{SP_API_URL:apiUrl,SP_API_TOKEN:raw,SP_BRIDGE_ALLOW_HTTP:'1'},stderr:'pipe'}));return client;};
  const client=await connect(token.token);
  const call=async(name:string,args:Record<string,unknown>,target=client)=>{const r=await target.callTool({name,arguments:args});const text=(r.content as {text:string}[])[0].text;return {error:r.isError,value:JSON.parse(text)};};
  assert.equal((await client.listTools()).tools.length,11);
  const created=await call('sp_create_project',{projectId:'old-local-id',title:'cloud MCP'});assert.equal(created.error,undefined,JSON.stringify(created));const id=created.value.id;assert.notEqual(id,'old-local-id');assert.match(id,/^[a-f0-9-]{36}$/);
  const edited=await call('sp_edit',{projectId:id,expectedRevision:0,clientMutationId:'sdk-edit',operations:[{type:'createSlide',slide:{id:'s1',elements:[{id:'e1',type:'text',x:10,y:20,w:400,h:60,text:'PG saved'}]}}]});assert.equal(edited.error,undefined,JSON.stringify(edited));assert.equal(edited.value.revision,1);
  assert.equal((await projects.get(actor,id)).slides[0].elements[0].text,'PG saved');
  assert.equal((await call('sp_get_slide',{projectId:id,slideId:'s1'})).value.slide.elements[0].text,'PG saved');
  assert.equal((await call('sp_validate',{projectId:id})).value.valid,true);
  assert.match((await call('sp_render_slide',{projectId:id,slideId:'s1'})).value.svg,/PG saved/);
  assert.equal((await call('sp_list_slides',{projectId:id})).value.slides.length,1);assert.equal((await call('sp_project_info',{projectId:id})).value.revision,1);assert.equal((await call('sp_list_projects',{})).value.length,1);
  const browserLease=await projects.acquireLease(actor,id,'browser');
  assert.equal((await call('sp_edit',{projectId:id,expectedRevision:1,operations:[{type:'deleteSlide',slideId:'s1'}]})).value.error.code,'PROJECT_BUSY');await projects.releaseLease(actor,id,browserLease.leaseToken);
  assert.equal((await call('sp_edit',{projectId:id,expectedRevision:0,operations:[{type:'deleteSlide',slideId:'s1'}]})).value.error.code,'REVISION_CONFLICT');
  const exported=await call('sp_save_export',{projectId:id,expectedRevision:1,filename:'cloud.html'});assert.equal(exported.error,undefined,JSON.stringify(exported));const html=await readFile(path.join(root,'cloud.html'),'utf8');assert.match(html,/PG saved/);
  await writeFile(path.join(root,'import.html'),html+'<script>throw new Error("must never execute")</script>');
  const imported=await call('sp_open_project',{filename:'import.html',clientMutationId:'sdk-import'});assert.equal(imported.error,undefined,JSON.stringify(imported));assert.notEqual(imported.value.id,id);assert.equal(imported.value.slides[0].elements[0].text,'PG saved');
  await symlink(path.join(root,'cloud.html'),path.join(root,'link.html'));assert.equal((await call('sp_open_project',{filename:'link.html'})).error,true);assert.equal((await call('sp_save_export',{projectId:id,expectedRevision:1,filename:'../bad.html'})).error,true);
  const readOnly=await tokens.create(actor,{name:'read only',scopes:['projects:read'],projectAllowlist:[id]});const reader=await connect(readOnly.token);assert.equal((await call('sp_get_document',{projectId:id,full:true},reader)).value.revision,1);assert.equal((await call('sp_save_export',{projectId:id,expectedRevision:1,filename:'denied.html'},reader)).error,true);assert.equal((await call('sp_get_document',{projectId:imported.value.id},reader)).error,true);
  await tokens.revoke(actor,token.id);const revoked=await call('sp_get_document',{projectId:id,full:true});assert.equal(revoked.error,true);assert.ok(!JSON.stringify(revoked).includes(token.token));
 }finally{for(const client of clients)await client.close();await app.close();await cleanupTestDatabase(db);await rm(root,{recursive:true,force:true});}
});

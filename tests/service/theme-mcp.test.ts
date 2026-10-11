import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {buildApp} from '../../server/app.js';
import {AuthService} from '../../server/auth/auth-service.js';
import {TokenService} from '../../server/auth/token-service.js';
import {ProjectService} from '../../server/services/project-service.js';
import {ThemeService} from '../../server/services/theme-service.js';
import {createTestDatabase,cleanupTestDatabase} from './helpers.js';
test('SDK theme tools use private ACL, immutable references, CAS receipts, scopes and live leases',async()=>{
 const db=await createTestDatabase(),app=buildApp({db,origin:'http://127.0.0.1:3000'}),clients:Client[]=[];
 try{
  const auth=new AuthService(db);await auth.bootstrapAdmin('theme-mcp-admin','theme-mcp-strong-password');const login=await auth.login('theme-mcp-admin','theme-mcp-strong-password'),owner=await auth.authenticate(login.sessionToken),tokens=new TokenService(db),projects=new ProjectService(db),themes=new ThemeService(db);
  const doc=await projects.create(owner,{title:'unchanged'});await projects.edit(owner,doc.id,{expectedRevision:0,clientMutationId:'content',operations:[{type:'createSlide',slide:{id:'s',notes:'preserved',elements:[{id:'text',type:'text',x:10,y:20,w:100,h:40,text:'body',color:'#123456'}],animations:[]}}]});
  const writer=await tokens.create(owner,{name:'theme-agent',scopes:['projects:write','themes:read','themes:write','themes:publish'],projectAllowlist:[doc.id]}),apiUrl=await app.listen({host:'127.0.0.1',port:0});
  const connect=async(raw:string)=>{const c=new Client({name:'theme-acceptance',version:'1'});clients.push(c);await c.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('mcp/bridge/server.js')],env:{SP_API_URL:apiUrl,SP_API_TOKEN:raw,SP_BRIDGE_ALLOW_HTTP:'1'},stderr:'pipe'}));return c;};const client=await connect(writer.token);
  const call=async(name:string,args:any,c=client)=>{const r=await c.callTool({name,arguments:args});return {error:r.isError,value:JSON.parse((r.content as {text:string}[])[0].text)};};
  const catalog=await call('sp_list_themes',{});assert.equal(catalog.error,undefined);assert.ok(catalog.value.length>=4);const builtin=catalog.value[0],ref=(await call('sp_get_theme',{themeId:builtin.id,version:builtin.version})).value;
  const preview=await call('sp_preview_theme',{themeId:ref.id,version:ref.version,hash:ref.hash});assert.equal(preview.error,undefined,JSON.stringify(preview));assert.equal(preview.value.slides.length,4);assert.match(preview.value.slides[0].svg,/<svg/);assert.ok(preview.value.limitations.length);
  const saved=await call('sp_save_theme',{theme:ref.snapshot,clientMutationId:'save-theme'});assert.equal(saved.error,undefined,JSON.stringify(saved));const privateRef=saved.value.ref;assert.notEqual(privateRef.id,ref.id);
  const request={projectId:doc.id,expectedRevision:1,themeId:privateRef.id,version:privateRef.version,hash:privateRef.hash,clientMutationId:'apply-theme',mode:'preserve'};
  const lease=await projects.acquireLease(owner,doc.id,'browser');const applied=await call('sp_apply_theme',request);assert.equal(applied.error,undefined,JSON.stringify(applied));assert.equal(applied.value.revision,2);assert.equal(applied.value.slides[0].elements[0].color,'#123456');assert.equal(applied.value.slides[0].notes,'preserved');assert.deepEqual(applied.value.extensions.theme.ref,privateRef);await projects.releaseLease(owner,doc.id,lease.leaseToken);
  await projects.rename(owner,doc.id,{title:'later',expectedRevision:2,clientMutationId:'later'});const replay=await call('sp_apply_theme',request);assert.deepEqual(replay.value,applied.value);assert.equal((await projects.get(owner,doc.id)).revision,3);
  assert.equal((await call('sp_apply_theme',{...request,clientMutationId:'stale'})).value.error.code,'REVISION_CONFLICT');assert.equal((await call('sp_apply_theme',{...request,expectedRevision:3,hash:'sha256:'+'0'.repeat(64),clientMutationId:'hash'})).value.error.code,'THEME_HASH_MISMATCH');
  const next={...privateRef.snapshot,version:'1.1.0'};assert.equal((await call('sp_save_theme',{theme:next,themeId:privateRef.id,expectedRevision:0,clientMutationId:'publish'})).error,undefined);assert.deepEqual((await call('sp_get_theme',{themeId:privateRef.id,version:privateRef.version})).value,privateRef);
  const noTheme=await tokens.create(owner,{name:'no-theme',scopes:['projects:write'],projectAllowlist:[doc.id]}),limited=await connect(noTheme.token);assert.equal((await call('sp_list_themes',{},limited)).value.error.code,'FORBIDDEN');assert.equal((await call('sp_apply_theme',{...request,expectedRevision:3,clientMutationId:'limited'},limited)).value.error.code,'FORBIDDEN');
  await db.query("INSERT INTO users(username,password_hash,role) VALUES('other-theme-user','unused','user')");const otherId=(await db.query("SELECT id FROM users WHERE username='other-theme-user'")).rows[0].id;await assert.rejects(themes.get({...owner,id:otherId,sessionId:undefined},privateRef.id),{code:'NOT_FOUND'});const foreign=await themes.importTheme({...owner,id:otherId,sessionId:undefined},{theme:ref.snapshot,clientMutationId:'foreign-theme'});assert.equal((await call('sp_apply_theme',{...request,expectedRevision:3,themeId:foreign.id,version:foreign.ref.version,hash:foreign.ref.hash,clientMutationId:'foreign-apply'})).value.error.code,'NOT_FOUND');const outside=await projects.create(owner);assert.equal((await call('sp_apply_theme',{...request,projectId:outside.id,expectedRevision:0,clientMutationId:'outside-project'})).value.error.code,'FORBIDDEN');
  await tokens.revoke(owner,writer.id);assert.equal((await call('sp_get_theme',{themeId:ref.id})).value.error.code,'UNAUTHENTICATED');assert.equal((await projects.get(owner,doc.id)).revision,3);
 }finally{for(const c of clients)await c.close();await app.close();await cleanupTestDatabase(db);}
});

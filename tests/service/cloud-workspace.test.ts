import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {buildApp} from '../../server/app.js';
import {AuthService} from '../../server/auth/auth-service.js';
import {createDocument,DocumentCore} from '../../core/document-core.js';
// Browser stores remain plain JS; this test exercises them through the real HTTP handlers and PostgreSQL.
// @ts-expect-error Browser module has no TypeScript declaration.
import {CloudAPI,CloudProjectStore} from '../../storage/cloud-project-store.js';
// @ts-expect-error Browser module has no TypeScript declaration.
import {CloudDraftStore} from '../../storage/cloud-drafts.js';
// @ts-expect-error Browser module has no TypeScript declaration.
import {ProjectStore} from '../../storage/project-store.js';
import {createTestDatabase,cleanupTestDatabase} from './helpers.js';

test('browser cloud store uses real Cookie/CSRF/import/snapshot/lease APIs and PostgreSQL receipts',async()=>{
 const db=await createTestDatabase(),origin='http://127.0.0.1:3000',app=buildApp({db,origin,secureCookies:false}),auth=new AuthService(db),password='isolated-cloud-test-password';
 const local=new ProjectStore({name:'cloud-http-local-'+crypto.randomUUID()});let cloud:any,cookie='',dropSnapshot=false;
 try{
  await auth.bootstrapAdmin('admin',password);const administrator=await auth.login('admin',password);await auth.createUser(await auth.authenticate(administrator.sessionToken),{username:'cloudowner',password});
  const fetcher:typeof fetch=async(input,options={})=>{
   const headers=Object.fromEntries(new Headers(options.headers).entries());headers.origin=origin;if(cookie)headers.cookie=cookie;
   const response=await app.inject({method:(options.method||'GET') as 'GET'|'POST'|'PUT'|'DELETE',url:String(input),headers,...(options.body===undefined?{}:{payload:String(options.body)})});
   if(response.headers['set-cookie'])cookie=String(response.headers['set-cookie']).split(';')[0];
   if(dropSnapshot&&String(input).endsWith('/snapshot')&&response.statusCode===200){dropSnapshot=false;throw Error('transport dropped after PostgreSQL commit');}
   return new Response(response.body,{status:response.statusCode,headers:{'content-type':'application/json'}});
  };
  const api=new CloudAPI({fetch:fetcher});await api.login('cloudowner',password);assert.ok(cookie.startsWith('sp-session='));
  cloud=new CloudProjectStore({api,drafts:new CloudDraftStore({name:'cloud-http-drafts-'+crypto.randomUUID()})});
  const source=createDocument({title:'Imported private deck',slides:[{id:'slide',elements:[{id:'text',type:'text',x:1,y:2,w:200,h:50,text:'Original'}],notes:'private notes',nativeUnknown:{retain:[1,2]}}],extensions:{editorUnknown:{retain:true}}});
  await local.create(source);const imported=await cloud.migrate(local,source.id);assert.notEqual(imported.id,source.id);assert.deepEqual(imported.document.slides,source.slides);assert.deepEqual((await local.get(source.id)).document,source);
  const lease=await cloud.acquire(imported.id,'browser');assert.ok(lease);assert.equal(await cloud.acquire(imported.id,'other-browser'),null);
  const core=new DocumentCore(imported.document);core.edit([{type:'updateProject',properties:{title:'First local edit'}}]);const batched=core.edit([{type:'updateElement',slideId:'slide',elementId:'text',properties:{text:'Second local edit'}}]);
  const saved=await cloud.save(batched,{expectedRevision:0,lock:lease});assert.deepEqual(saved.document,batched);assert.equal((await cloud.get(imported.id)).document.revision,2);
  const uncertain=core.edit([{type:'updateProject',properties:{title:'Committed once'}}]);dropSnapshot=true;await assert.rejects(cloud.save(uncertain,{expectedRevision:2,lock:lease}),{code:'OFFLINE'});assert.deepEqual((await cloud.save(uncertain,{expectedRevision:2,lock:lease})).document,uncertain);
  assert.equal((await db.query('SELECT count(*) FROM mutation_receipts WHERE project_id=$1',[imported.id])).rows[0].count,'2');
  await cloud.release(lease);await cloud.setDeleted(imported.id,true);const trash=await cloud.list({trash:true});assert.equal(trash[0].id,imported.id);assert.equal(trash[0].document.revision,4);await cloud.setDeleted(imported.id,false);assert.equal((await cloud.get(imported.id)).document.revision,5);
  const reopened=new CloudAPI({fetch:fetcher});assert.equal((await reopened.restoreSession()).id,api.user.id);assert.ok(reopened.csrfToken);const newLease=await cloud.acquire(imported.id,'after-csrf-rotation');assert.ok(newLease,'Explicit stale-CSRF rejection must rotate and retry safely');await cloud.release(newLease);
  assert.equal((await cloud.drafts.list(cloud.accountId)).length,0);assert.equal((await cloud.drafts.migrations(cloud.accountId))[0].cloudProjectId,imported.id);
 }finally{cloud?.close();local.close();await app.close();await cleanupTestDatabase(db);}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../server/app.js';
import {AuthService} from '../../server/auth/auth-service.js';
import {createTestDatabase,cleanupTestDatabase} from './helpers.js';
const origin='http://127.0.0.1:3000';
const password='test-only-strong-password';
async function setup(options={}){
 const db=await createTestDatabase();const app=buildApp({db,origin,secureCookies:false,...options});const auth=new AuthService(db);
 await auth.bootstrapAdmin('admin',password);
 async function login(username:string){const response=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{username,password}});assert.equal(response.statusCode,200,response.body);return {cookie:String(response.headers['set-cookie']).split(';')[0],'x-csrf-token':response.json().csrfToken,origin};}
 const admin=await login('admin');
 const user=await app.inject({method:'POST',url:'/api/v1/admin/users',headers:admin,payload:{username:'alice',password}});assert.equal(user.statusCode,201,user.body);
 const other=await app.inject({method:'POST',url:'/api/v1/admin/users',headers:admin,payload:{username:'bob',password}});assert.equal(other.statusCode,201,other.body);
 return {db,app,auth,admin,alice:await login('alice'),bob:await login('bob'),user:user.json(),close:async()=>{await app.close();await cleanupTestDatabase(db);}};
}
test('HTTP login/session, CSRF+Origin, owner isolation and no forged role/owner acceptance',async()=>{
 const h=await setup();try{
  assert.equal((await h.app.inject('/api/v1/projects')).statusCode,401);
  assert.equal((await h.app.inject({method:'POST',url:'/api/v1/projects',headers:{...h.alice,origin:'https://evil.invalid'},payload:{}})).statusCode,403);
  assert.equal((await h.app.inject({method:'POST',url:'/api/v1/projects',headers:{cookie:h.alice.cookie,origin},payload:{}})).statusCode,403);
  const forged=await h.app.inject({method:'POST',url:'/api/v1/projects',headers:h.alice,payload:{ownerId:h.user.id,role:'admin'}});assert.equal(forged.statusCode,400);
  const created=await h.app.inject({method:'POST',url:'/api/v1/projects',headers:h.alice,payload:{title:'one'}});assert.equal(created.statusCode,201,created.body);const doc=created.json();
  for(const headers of [h.bob,h.admin])for(const url of [`/api/v1/projects/${doc.id}`,`/api/v1/projects/${doc.id}/document`])assert.equal((await h.app.inject({url,headers})).statusCode,404);
  assert.deepEqual((await h.app.inject({url:'/api/v1/projects',headers:h.bob})).json(),[]);
  assert.equal((await h.app.inject({url:'/api/v1/admin/users',headers:h.alice})).statusCode,403);
  assert.equal((await h.app.inject({url:'/health/ready',headers:h.alice})).statusCode,403);
  const metadata=await h.app.inject({url:'/api/v1/admin/users',headers:h.admin});assert.equal(metadata.statusCode,200);assert.doesNotMatch(metadata.body,/password_hash|session_hash|csrf_hash/);
  const logout=await h.app.inject({method:'POST',url:'/api/v1/auth/logout',headers:h.alice});assert.equal(logout.statusCode,200);
  assert.equal((await h.app.inject({url:'/api/v1/auth/me',headers:h.alice})).statusCode,401);
 }finally{await h.close();}
});
test('HTTP document edit/retry/lease/CAS/trash roundtrip persists through a new app instance',async()=>{
 const h=await setup();try{
  const created=await h.app.inject({method:'POST',url:'/api/v1/projects',headers:h.alice,payload:{title:'original'}});const doc=created.json();
  const payload={expectedRevision:0,clientMutationId:'http-edit-1',operations:[{type:'createSlide',slide:{id:'slide1',elements:[{id:'title1',type:'text',x:0,y:0,w:300,h:40,text:'durable'}]}}]};
  const url=`/api/v1/projects/${doc.id}/document`;
  const edited=await h.app.inject({method:'PATCH',url,headers:h.alice,payload});assert.equal(edited.statusCode,200,edited.body);assert.equal(edited.json().revision,1);
  assert.deepEqual((await h.app.inject({method:'PATCH',url,headers:h.alice,payload})).json(),edited.json());
  const conflict=await h.app.inject({method:'PATCH',url,headers:h.alice,payload:{...payload,clientMutationId:'http-edit-2'}});assert.equal(conflict.statusCode,409);assert.equal(conflict.json().error.code,'REVISION_CONFLICT');
  const lease=await h.app.inject({method:'POST',url:`/api/v1/projects/${doc.id}/lease`,headers:h.alice,payload:{holder:'browser'}});assert.equal(lease.statusCode,200,lease.body);
  const snapshot={...edited.json(),title:'browser snapshot'};
  const snap={expectedRevision:1,clientMutationId:'snapshot1',operations:[{type:'replaceContent',document:snapshot}]};
  assert.equal((await h.app.inject({method:'PATCH',url,headers:h.alice,payload:snap})).statusCode,409);
  const saved=await h.app.inject({method:'PATCH',url,headers:h.alice,payload:{...snap,leaseToken:lease.json().leaseToken}});assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().revision,2);
  const renewed=await h.app.inject({method:'POST',url:`/api/v1/projects/${doc.id}/lease/renew`,headers:h.alice,payload:{leaseToken:lease.json().leaseToken}});assert.equal(renewed.statusCode,200);
  const released=await h.app.inject({method:'DELETE',url:`/api/v1/projects/${doc.id}/lease`,headers:h.alice,payload:{leaseToken:lease.json().leaseToken}});assert.equal(released.statusCode,200);
  const newer=buildApp({db:h.db,origin,secureCookies:false});try{const read=await newer.inject({url,headers:h.alice});assert.equal(read.json().title,'browser snapshot');assert.equal(read.json().slides[0].elements[0].text,'durable');}finally{await newer.close();}
  const deleted=await h.app.inject({method:'DELETE',url:`/api/v1/projects/${doc.id}`,headers:h.alice,payload:{expectedRevision:2,clientMutationId:'delete1'}});assert.equal(deleted.statusCode,200,deleted.body);assert.equal(deleted.json().revision,3);
  assert.equal((await h.app.inject({url,headers:h.alice})).statusCode,404);
  const restored=await h.app.inject({method:'POST',url:`/api/v1/projects/${doc.id}/restore`,headers:h.alice,payload:{expectedRevision:3,clientMutationId:'restore1'}});assert.equal(restored.statusCode,200,restored.body);assert.equal(restored.json().revision,4);
 }finally{await h.close();}
});
test('HTTP login throttles uniformly and production cookies are Secure without token in JSON',async()=>{
 const db=await createTestDatabase();const app=buildApp({db,origin:'https://sp.jxcz.top',secureCookies:true,loginLimit:2});
 try{
  await new AuthService(db).bootstrapAdmin('admin',password);
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin:'https://sp.jxcz.top'},payload:{username:'admin',password}});
  assert.equal(login.statusCode,200);assert.match(String(login.headers['set-cookie']),/__Host-sp-session=.*HttpOnly.*SameSite=Strict.*Secure/);assert.equal(login.json().sessionToken,undefined);
  assert.equal(login.headers['strict-transport-security'],'max-age=31536000');assert.equal(login.headers['x-frame-options'],'SAMEORIGIN');assert.match(String(login.headers['content-security-policy']),/frame-ancestors 'self'/);
  const failed=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin:'https://sp.jxcz.top'},payload:{username:'unknown',password}});assert.equal(failed.statusCode,401);
  const limited=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin:'https://sp.jxcz.top'},payload:{username:'admin',password}});assert.equal(limited.statusCode,429);assert.ok(limited.headers['retry-after']);
  assert.equal((await app.inject('/api/v1/bootstrap')).statusCode,404);
 }finally{await app.close();await cleanupTestDatabase(db);}
});

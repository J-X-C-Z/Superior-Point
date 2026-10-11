import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthService} from '../../server/auth/auth-service.js';
import {buildApp} from '../../server/app.js';
import {createTestDatabase,cleanupTestDatabase} from './helpers.js';
test('session center is private, CSRF bound and revocation/audit are atomic; recorded login failures trigger admin warning',async()=>{
 const db=await createTestDatabase(),origin='http://127.0.0.1:3000',app=buildApp({db,origin}),auth=new AuthService(db),password='session-center-test-strong';
 try{
  await auth.bootstrapAdmin('sessionadmin',password);const first=await auth.login('sessionadmin',password),second=await auth.login('sessionadmin',password),actor=await auth.authenticate(first.sessionToken);
  const other=await auth.createUser(actor,{username:'sessionother',password}),foreign=await auth.login(other.username,password),foreignActor=await auth.authenticate(foreign.sessionToken);
  const headers={host:'127.0.0.1:3000',cookie:'sp-session='+first.sessionToken,origin,'x-csrf-token':first.csrfToken};
  const list=await app.inject({url:'/api/v1/me/sessions',headers});assert.equal(list.statusCode,200);assert.equal(list.json().length,2);assert.ok(list.json().every((s:any)=>!s.session_hash&&!s.csrf_hash));
  assert.equal((await app.inject({method:'DELETE',url:'/api/v1/me/sessions/'+foreignActor.sessionId,headers})).statusCode,404);
  const secondActor=await auth.authenticate(second.sessionToken);const missing={...headers,'x-csrf-token':''};assert.equal((await app.inject({method:'DELETE',url:'/api/v1/me/sessions/'+secondActor.sessionId,headers:missing})).statusCode,403);
  assert.equal((await app.inject({method:'DELETE',url:'/api/v1/me/sessions/'+secondActor.sessionId,headers})).statusCode,200);await assert.rejects(auth.authenticate(second.sessionToken));
  await db.query("UPDATE sessions SET reauth_until=clock_timestamp()-interval '1 minute' WHERE id=$1",[actor.sessionId]);assert.equal((await app.inject({method:'DELETE',url:'/api/v1/me/sessions/'+actor.sessionId,headers})).json().error.code,'REAUTHENTICATION_REQUIRED');
  for(let i=0;i<5;i++)await assert.rejects(auth.login('unknown-user',password));assert.equal((await app.inject({url:'/api/v1/admin/security',headers})).json().warning,true);
  assert.equal((await app.inject({url:'/api/v1/admin/security',headers:{host:headers.host,cookie:'sp-session='+foreign.sessionToken}})).statusCode,403);
 }finally{await app.close();await cleanupTestDatabase(db);}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {AuthService} from '../../server/auth/auth-service.js';
import {TokenService} from '../../server/auth/token-service.js';
import {ProjectService} from '../../server/services/project-service.js';
import {ShareService} from '../../server/services/share-service.js';
import {registerShareRoutes} from '../../server/routes/share-routes.js';
import {ServiceError} from '../../server/contracts.js';
import {createTestDatabase,cleanupTestDatabase} from './helpers.js';
const origin='http://127.0.0.1:3991',password='share-strong-test-password';
test('fixed revision owner sharing uses hashed capabilities, safe audience HTML, expiry/revoke and current owner lifecycle',async()=>{
 const db=await createTestDatabase(),auth=new AuthService(db),projects=new ProjectService(db),shares=new ShareService(db,{origin}),tokens=new TokenService(db);
 try{
  await auth.bootstrapAdmin('share-admin',password);const adminLogin=await auth.login('share-admin',password),admin=await auth.authenticate(adminLogin.sessionToken);
  await auth.createUser(admin,{username:'share-owner',password});const login=await auth.login('share-owner',password),owner=await auth.authenticate(login.sessionToken);assert.equal(owner.role,'user');
  const doc=await projects.create(owner,{title:'Visible title'}),saved=await projects.edit(owner,doc.id,{expectedRevision:0,clientMutationId:'share-content',operations:[{type:'updateProject',properties:{extensions:{private:'NEVER_EXTENSION',history:['NEVER_HISTORY']}}},{type:'createSlide',slide:{id:'visible',notes:'NEVER_NOTES',comments:['NEVER_COMMENTS'],elements:[{id:'visible-text',type:'text',x:10,y:20,w:200,h:30,text:'Visible content'}]}},{type:'createSlide',slide:{id:'hidden',hidden:true,elements:[{id:'hidden-text',type:'text',x:0,y:0,w:200,h:30,text:'NEVER_HIDDEN'}]}}]});
  await assert.rejects(shares.create(admin,doc.id,{expectedRevision:1}),{code:'NOT_FOUND'});await assert.rejects(shares.list(admin,doc.id),{code:'NOT_FOUND'});
  const pat=await tokens.authenticate((await tokens.create(owner,{name:'no-share-write'})).token);await assert.rejects(shares.create(pat,doc.id,{expectedRevision:1}),{code:'FORBIDDEN'});
  await assert.rejects(shares.create(owner,doc.id,{expectedRevision:0}),{code:'REVISION_CONFLICT'});await assert.rejects(shares.create(owner,doc.id,{expectedRevision:1,expiresAt:'2099-01-01'}),{code:'INVALID_REQUEST'});
  const link=await shares.create(owner,doc.id,{expectedRevision:1});assert.match(link.token,/^sp_share_[A-Za-z0-9_-]{43}$/);assert.equal(link.url,origin+'/share#'+link.token);
  const audience=await shares.view(link.token);assert.match(audience.html,/Visible content/);assert.doesNotMatch(audience.html,/NEVER_|sp-document|superior-point-project|application\/json/);assert.equal(audience.revision,1);assert.deepEqual(await projects.getRevision(owner,doc.id,1),saved);
  await projects.edit(owner,doc.id,{expectedRevision:1,clientMutationId:'later-private',operations:[{type:'updateElement',slideId:'visible',elementId:'visible-text',properties:{text:'LATER_NOT_SHARED'}}]});assert.doesNotMatch((await shares.view(link.token)).html,/LATER_NOT_SHARED/);
  const listed=await shares.list(owner,doc.id);assert.equal(listed[0].accessCount,2);assert.equal(listed[0].revision,1);assert.doesNotMatch(JSON.stringify(listed),/sp_share_|token_hash|html|NEVER_/);
  const stored=(await db.query('SELECT * FROM project_shares WHERE id=$1',[link.id])).rows[0];assert.match(stored.token_hash,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(stored),/sp_share_|NEVER_|LATER_NOT_SHARED/);
  const accesses=JSON.stringify((await db.query('SELECT * FROM project_share_access')).rows);assert.doesNotMatch(accesses,/sp_share_|token|html|ip|NEVER_/);
  await assert.rejects(shares.revoke(admin,doc.id,link.id),{code:'NOT_FOUND'});await shares.revoke(owner,doc.id,link.id);await assert.rejects(shares.view(link.token),{code:'SHARE_UNAVAILABLE'});
  const expired=await shares.create(owner,doc.id,{expectedRevision:2});await db.query("UPDATE project_shares SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.id]);await assert.rejects(shares.view(expired.token),{code:'SHARE_UNAVAILABLE'});
  const disabled=await shares.create(owner,doc.id,{expectedRevision:2});await auth.setUserStatus(admin,owner.id,'disabled');await assert.rejects(shares.view(disabled.token),{code:'SHARE_UNAVAILABLE'});await auth.setUserStatus(admin,owner.id,'active');
  const newLogin=await auth.login('share-owner',password),newOwner=await auth.authenticate(newLogin.sessionToken),trashed=await shares.create(newOwner,doc.id,{expectedRevision:2});await projects.remove(newOwner,doc.id,{expectedRevision:2,clientMutationId:'trash-shared'});await assert.rejects(shares.view(trashed.token),{code:'SHARE_UNAVAILABLE'});assert.ok((await shares.list(newOwner,doc.id)).every(row=>!row.active));
  await projects.restore(newOwner,doc.id,{expectedRevision:3,clientMutationId:'untrash-shared'});const transferred=await shares.create(newOwner,doc.id,{expectedRevision:4});await projects.adminTransfer(admin,doc.id,{newOwnerId:admin.id,expectedRevision:4,clientMutationId:'transfer-shared'});await assert.rejects(shares.view(transferred.token),{code:'SHARE_UNAVAILABLE'});
  const fresh=await shares.create(admin,doc.id,{expectedRevision:5});await auth.logout(adminLogin.sessionToken);await assert.rejects(shares.create(admin,doc.id,{expectedRevision:5}),{code:'UNAUTHENTICATED'});assert.equal((await shares.view(fresh.token)).revision,5);
 }finally{await cleanupTestDatabase(db);}
});
test('share routes enforce owner web CSRF and header-only readonly access; snapshot quota and audit failures rollback',async()=>{
 const db=await createTestDatabase(),auth=new AuthService(db),projects=new ProjectService(db),shares=new ShareService(db,{origin}),tokens=new TokenService(db),app=Fastify({ajv:{customOptions:{removeAdditional:false,coerceTypes:false}}});
 try{
  await auth.bootstrapAdmin('share-route-admin',password);const login=await auth.login('share-route-admin',password),owner=await auth.authenticate(login.sessionToken),doc=await projects.create(owner,{title:'only readonly'});
  const actor=async(request:any)=>request.headers.authorization?tokens.authenticate(request.headers.authorization.slice(7)):auth.authenticate((request.headers.cookie??'').replace('sp-session=',''));
  registerShareRoutes(app,{shares,actor,writable:async request=>{const current=await actor(request);if(request.headers.origin!==origin)throw new ServiceError('INVALID_ORIGIN',403,'来源无效');await auth.verifyCsrf(current,String(request.headers['x-csrf-token']??''));return current;}});
  app.setErrorHandler((error,_,reply)=>reply.code(error instanceof ServiceError?error.status:400).send({error:{code:error instanceof ServiceError?error.code:'INVALID_REQUEST'}}));
  const headers={cookie:'sp-session='+login.sessionToken,origin,'x-csrf-token':login.csrfToken},route='/api/v1/projects/'+doc.id+'/shares';
  assert.equal((await app.inject({method:'POST',url:route,headers:{cookie:headers.cookie,origin},payload:{expectedRevision:0}})).statusCode,403);
  const created=await app.inject({method:'POST',url:route,headers,payload:{expectedRevision:0}});assert.equal(created.statusCode,201,created.body);const link=created.json();
  const viewing=await app.inject({url:'/api/v1/public/shares/view',headers:{authorization:'Bearer '+link.token}});assert.equal(viewing.statusCode,200);assert.equal(viewing.headers['cache-control'],'no-store');
  assert.equal((await app.inject({url:'/api/v1/public/shares/view?token='+link.token})).statusCode,400);assert.equal((await app.inject({url:'/api/v1/public/shares/view',headers:{authorization:'Bearer '+link.token,cookie:headers.cookie}})).statusCode,404);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/public/shares/view',payload:{token:link.token}})).statusCode,404);assert.equal((await app.inject({method:'DELETE',url:route+'/'+link.id,headers:{cookie:headers.cookie,origin}})).statusCode,403);
  await db.query("INSERT INTO system_settings(key,value,updated_by) VALUES('storageQuota',$1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[JSON.stringify({maxProjects:1000,maxBytes:1,warningPercent:80}),owner.id]);
  await assert.rejects(shares.create(owner,doc.id,{expectedRevision:0}),{code:'QUOTA_EXCEEDED'});assert.equal((await shares.list(owner,doc.id)).length,1);await db.query("DELETE FROM system_settings WHERE key='storageQuota'");
  await db.query("CREATE FUNCTION reject_share_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='share.create' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END$$");await db.query('CREATE TRIGGER reject_share_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_share_audit()');await assert.rejects(shares.create(owner,doc.id,{expectedRevision:0}));assert.equal((await shares.list(owner,doc.id)).length,1);
  await db.query('DROP TRIGGER reject_share_audit ON audit_logs');
  const unsupported=await projects.edit(owner,doc.id,{expectedRevision:0,clientMutationId:'unsupported-share',operations:[{type:'createSlide',slide:{id:'unsupported',elements:[{id:'video',type:'video',x:0,y:0,w:100,h:100,src:'data:video/mp4;base64,AAAA'}]}}]});assert.equal(unsupported.revision,1);await assert.rejects(shares.create(owner,doc.id,{expectedRevision:1}),{code:'EXPORT_UNSUPPORTED'});
  assert.equal((await app.inject({method:'DELETE',url:route+'/'+link.id,headers})).statusCode,200);assert.equal((await app.inject({url:'/api/v1/public/shares/view',headers:{authorization:'Bearer '+link.token}})).statusCode,404);
 }finally{await app.close();await cleanupTestDatabase(db);}
});
test('actual HTTP sharing exposes only fixed audience content, enforces cookie/CSRF/PAT boundaries and logs no capability',async()=>{
 const {createServer}=await import('node:net'),{buildApp}=await import('../../server/app.js');
 const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=(probe.address() as {port:number}).port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
 const publicOrigin='http://127.0.0.1:'+port,db=await createTestDatabase(),app=buildApp({db,origin:publicOrigin}),auth=new AuthService(db),projects=new ProjectService(db),logs:string[]=[],originalInfo=console.info;console.info=(...args:unknown[])=>logs.push(args.map(String).join(' '));
 try{
  await auth.bootstrapAdmin('http-share-admin',password);const adminLogin=await auth.login('http-share-admin',password),admin=await auth.authenticate(adminLogin.sessionToken);await auth.createUser(admin,{username:'http-share-owner',password});const login=await auth.login('http-share-owner',password),owner=await auth.authenticate(login.sessionToken),doc=await projects.create(owner,{title:'HTTP readonly share'});
  await projects.edit(owner,doc.id,{expectedRevision:0,clientMutationId:'http-share-content',operations:[{type:'createSlide',slide:{id:'visible-http-share',notes:'HTTP_NEVER_NOTES',comments:['HTTP_NEVER_COMMENTS'],elements:[{id:'text',type:'text',x:0,y:0,w:100,h:30,text:'HTTP visible audience'}]}}]});await app.listen({host:'127.0.0.1',port});
  const route=publicOrigin+'/api/v1/projects/'+doc.id+'/shares',headers={cookie:'sp-session='+login.sessionToken,origin:publicOrigin,'x-csrf-token':login.csrfToken,'content-type':'application/json'};
  assert.equal((await fetch(route,{method:'POST',headers:{cookie:headers.cookie,origin:publicOrigin,'content-type':'application/json'},body:JSON.stringify({expectedRevision:1})})).status,403);
  const created=await fetch(route,{method:'POST',headers,body:JSON.stringify({expectedRevision:1})});assert.equal(created.status,201);const link=await created.json();assert.match(link.url,/\/share#sp_share_/);
  const page=await fetch(publicOrigin+'/share');assert.equal(page.status,200);assert.match(await page.text(),/sandbox="allow-scripts"/);
  const viewRoute=publicOrigin+'/api/v1/public/shares/view',viewHeaders={authorization:'Bearer '+link.token},view=await fetch(viewRoute,{headers:viewHeaders});assert.equal(view.status,200);assert.equal(view.headers.get('cache-control'),'no-store');const audience=await view.json();assert.match(audience.html,/HTTP visible audience/);assert.doesNotMatch(audience.html,/HTTP_NEVER_|sp-document|application\/json/);
  await projects.edit(owner,doc.id,{expectedRevision:1,clientMutationId:'http-share-later',operations:[{type:'updateElement',slideId:'visible-http-share',elementId:'text',properties:{text:'HTTP_FUTURE_PRIVATE'}}]});assert.doesNotMatch((await (await fetch(viewRoute,{headers:viewHeaders})).json()).html,/HTTP_FUTURE_PRIVATE/);
  assert.equal((await fetch(viewRoute,{headers:{...viewHeaders,cookie:headers.cookie}})).status,404);
  assert.equal((await fetch(publicOrigin+'/api/v1/projects/'+doc.id,{method:'PATCH',headers:{authorization:viewHeaders.authorization,'content-type':'application/json'},body:JSON.stringify({title:'share token cannot write',expectedRevision:2,clientMutationId:'unauthorized-write'})})).status,401);
  const listed=await (await fetch(route,{headers:{cookie:headers.cookie}})).json();assert.equal(listed[0].accessCount,2);assert.doesNotMatch(JSON.stringify(listed),/sp_share_|token_hash|html/);
  assert.equal((await fetch(route+'/'+link.id,{method:'DELETE',headers:{cookie:headers.cookie,origin:publicOrigin,'x-csrf-token':login.csrfToken}})).status,200);assert.equal((await fetch(viewRoute,{headers:viewHeaders})).status,404);
  assert.equal((await projects.get(owner,doc.id)).revision,2);assert.ok(logs.length>0);assert.ok(!logs.join('\n').includes(link.token));assert.doesNotMatch(logs.join('\n'),/HTTP_NEVER_|HTTP_FUTURE_PRIVATE|HTTP visible audience/);
 }finally{console.info=originalInfo;await app.close();await cleanupTestDatabase(db);}
});

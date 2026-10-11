import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {buildApp} from '../../server/app.js';
import {AuthService} from '../../server/auth/auth-service.js';
import {AdminService} from '../../server/services/admin-service.js';
import {TokenService} from '../../server/auth/token-service.js';
import {ProjectService} from '../../server/services/project-service.js';
import {createTestDatabase,cleanupTestDatabase} from './helpers.js';
const origin='http://127.0.0.1:3999';
test('global admin searches filter before SQL pagination, preserve literal wildcards and never return bodies or secrets',async()=>{
 const db=await createTestDatabase(),app=buildApp({db,origin}),auth=new AuthService(db),admin=new AdminService(db),tokens=new TokenService(db),projects=new ProjectService(db);
 try{
  await auth.bootstrapAdmin('search-admin','search-test-strong-password');const login=await auth.login('search-admin','search-test-strong-password'),actor=await auth.authenticate(login.sessionToken),headers={cookie:'sp-session='+login.sessionToken};
  await db.query("INSERT INTO users(username,password_hash,role,status,created_at) SELECT 'search-user-'||lpad(n::text,2,'0'),'SECRET_HASH','user',CASE WHEN n%2=0 THEN 'active' ELSE 'disabled' END,clock_timestamp()+n*interval '1 second' FROM generate_series(1,30) n");
  const target=(await db.query("SELECT id FROM users WHERE username='search-user-30'")).rows[0].id;
  assert.equal((await admin.listUsers(actor,{limit:1}))[0].username,'search-admin');
  assert.equal((await admin.listUsers(actor,{q:'SEARCH-USER-30',limit:1,status:'active',role:'user'}))[0].id,target);
  assert.equal((await admin.listUsers(actor,{q:'search-user',status:'disabled'})).length,15);
  const pageOne=await admin.listUsers(actor,{q:'search-user',limit:2}),pageTwo=await admin.listUsers(actor,{q:'search-user',limit:2,offset:2});assert.equal(pageOne.length,2);assert.ok(!pageOne.some(first=>pageTwo.some(second=>second.id===first.id)));
  const picker=await app.inject({url:'/api/v1/admin/users?q=search-user-30&status=active&role=user&limit=1&offset=0',headers});assert.equal(picker.statusCode,200,picker.body);assert.equal(picker.json()[0].id,target);
  const first=await projects.create(actor,{title:'report 100%_literal\\name'}),second=await projects.create(actor,{title:'another report'});await projects.edit(actor,first.id,{expectedRevision:0,clientMutationId:'body',operations:[{type:'updateProject',properties:{extensions:{private:'NEVER_EXPOSE_DOCUMENT'}}}]});
  assert.equal((await admin.listProjects(actor,{q:'%_',limit:1}))[0].id,first.id);assert.equal((await admin.listProjects(actor,{q:'\\name'}))[0].id,first.id);assert.deepEqual(await admin.listProjects(actor,{q:"' OR 1=1 --"}),[]);
  assert.equal((await admin.listProjects(actor,{q:'search-admin',limit:1,userId:actor.id})).length,1);assert.deepEqual(await admin.listProjects(actor,{userId:target}),[]);
  await projects.remove(actor,second.id,{expectedRevision:0,clientMutationId:'trash'});assert.deepEqual((await admin.listProjects(actor,{q:'another',trash:true})).map(row=>row.id),[second.id]);assert.deepEqual(await admin.listProjects(actor,{q:'another'}),[]);
  for(let n=0;n<6;n++)await tokens.create(actor,{name:'ordinary-token-'+n});const token=await tokens.create(actor,{name:'needle-token'});
  await db.query("UPDATE api_tokens SET created_at=now()-interval '1 day' WHERE id=$1",[token.id]);
  assert.ok(!(await admin.listTokens(actor,{limit:1})).some(row=>row.id===token.id));assert.equal((await admin.listTokens(actor,{q:'needle',limit:1,status:'active',userId:actor.id}))[0].id,token.id);
  const tokenPageOne=await admin.listTokens(actor,{limit:2}),tokenPageTwo=await admin.listTokens(actor,{limit:2,offset:2});assert.equal(tokenPageOne.length,2);assert.ok(!tokenPageOne.some(first=>tokenPageTwo.some(second=>second.id===first.id)));
  await tokens.revoke(actor,token.id);assert.equal((await admin.listTokens(actor,{status:'revoked',q:'needle'}))[0].id,token.id);assert.deepEqual(await admin.listTokens(actor,{status:'active',q:'needle'}),[]);
  const expiring=await tokens.create(actor,{name:'expired-token'});await db.query("UPDATE api_tokens SET expires_at=now()-interval '1 second' WHERE id=$1",[expiring.id]);assert.equal((await admin.listTokens(actor,{status:'expired'}))[0].id,expiring.id);
  const disabledTokenId=randomUUID();await db.query("INSERT INTO api_tokens(id,user_id,token_hash,prefix,name,scopes,expires_at) VALUES($1,$2,$3,'safe-prefix','disabled-account-token','[]',now()+interval '1 day')",[disabledTokenId,(await db.query("SELECT id FROM users WHERE username='search-user-01'")).rows[0].id,randomUUID()]);assert.equal((await admin.listTokens(actor,{status:'disabled'}))[0].id,disabledTokenId);
  const auditId=(await db.query("INSERT INTO audit_logs(actor_id,action,resource_type,resource_id,outcome,created_at) VALUES($1,'needle.audit','project',$2,'failure','2001-01-01T00:00:00Z') RETURNING id",[actor.id,first.id])).rows[0].id;
  const laterAuditId=(await db.query("INSERT INTO audit_logs(actor_id,action,resource_type,outcome) VALUES($1,'later.audit','user','success') RETURNING id",[actor.id])).rows[0].id;
  assert.ok(BigInt(laterAuditId)>BigInt(auditId));assert.equal((await admin.listAudit(actor,{limit:1}))[0].id,laterAuditId);assert.equal((await admin.listAudit(actor,{q:'needle.audit',outcome:'failure',userId:actor.id,from:'2000-01-01',to:'2002-01-01',limit:1}))[0].id,auditId);assert.deepEqual(await admin.listAudit(actor,{q:'needle.audit',from:'2020-01-01'}),[]);
  for(const [route,q,id] of [['projects','%_',first.id],['mcp/tokens','needle',token.id],['audit','needle.audit',auditId]]){const response=await app.inject({url:'/api/v1/admin/'+route+'?q='+encodeURIComponent(q)+'&limit=1&offset=0',headers});assert.equal(response.statusCode,200,response.body);assert.equal(String(response.json()[0].id),String(id));assert.doesNotMatch(response.body,/NEVER_EXPOSE_DOCUMENT|SECRET_HASH|token_hash|password_hash|session_hash|csrf_hash/);}
  for(const url of ['/api/v1/admin/users?status=unknown','/api/v1/admin/users?q='+('x'.repeat(129)),'/api/v1/admin/projects?userId=bad','/api/v1/admin/mcp/tokens?status=unknown','/api/v1/admin/audit?from=not-a-date','/api/v1/admin/audit?from=2020-01-01&to=2019-01-01','/api/v1/admin/users?offset=9007199254740992'])assert.equal((await app.inject({url,headers})).statusCode,400,url);
  const pat=await tokens.create(actor,{name:'no-admin-api'});assert.equal((await app.inject({url:'/api/v1/admin/mcp/tokens?q=needle',headers:{authorization:'Bearer '+pat.token}})).statusCode,403);
  await db.query("UPDATE users SET role='user' WHERE id=$1",[actor.id]);await assert.rejects(admin.listTokens(actor),{code:'FORBIDDEN'});
 }finally{await app.close();await cleanupTestDatabase(db);}
});

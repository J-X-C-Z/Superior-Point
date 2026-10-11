import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ThemeService} from '../../server/services/theme-service.js';
import {createThemeRef} from '../../core/theme-schema.js';
import {TokenService} from '../../server/auth/token-service.js';
import type {Actor} from '../../server/contracts.js';
import {createTestDatabase,cleanupTestDatabase} from './helpers.js';
const theme={format:'superior-point-theme',schemaVersion:1,id:'local-test',name:'Test',version:'1.0.0',author:'Author',license:'MIT',tags:[],supportedRatios:['16:9'],tokens:{colors:{background:'#FFFFFF'},typography:{},spacing:{},components:{}},layouts:[],assets:[],future:{kept:true}};
async function fixture(fn:(db:any,s:ThemeService,a:Actor,b:Actor)=>Promise<void>){const db=await createTestDatabase();const a:Actor={id:randomUUID(),role:'user',source:'web',sessionId:randomUUID()},b:Actor={id:randomUUID(),role:'admin',source:'web',sessionId:randomUUID()};try{for(const [i,actor] of [a,b].entries()){await db.query('INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,$3,$4)',[actor.id,'theme-user-'+i,'test-hash',actor.role]);await db.query("INSERT INTO sessions(id,user_id,session_hash,csrf_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')",[actor.sessionId,actor.id,randomUUID(),randomUUID()]);}await fn(db,new ThemeService(db),a,b);}finally{await cleanupTestDatabase(db);}}
test('private theme imports replay, hash readback, immutable versions, metadata and deletion',()=>fixture(async(db,s,a,b)=>{
 const input={theme,clientMutationId:'upload'};const [one,two]=await Promise.all([s.importTheme(a,input),s.importTheme(a,input)]);assert.deepEqual(one,two);assert.notEqual(one.id,theme.id);assert.deepEqual(one.ref.snapshot,{...theme,id:one.id});assert.deepEqual(one.ref,await createThemeRef(one.ref.snapshot));assert.equal(one.source.hash,(await createThemeRef(theme)).hash);
 assert.equal((await s.list(a)).length,1);assert.equal('ref' in (await s.list(a))[0],false);assert.deepEqual(await s.list(b),[]);
 for(const operation of [()=>s.get(b,one.id),()=>s.getVersion(b,one.id,'1.0.0'),()=>s.favorite(b,one.id,true),()=>s.patch(b,one.id,{name:'stolen',expectedRevision:0,clientMutationId:'steal'}),()=>s.remove(b,one.id,{expectedRevision:0,clientMutationId:'steal'})])await assert.rejects(operation(),{code:'NOT_FOUND'});
 await assert.rejects(s.importTheme(a,{theme:{...theme,name:'different'},clientMutationId:'upload'}),{code:'MUTATION_ID_REUSED'});
 const renamed=await s.patch(a,one.id,{name:'Label',expectedRevision:0,clientMutationId:'rename'});assert.equal(renamed.name,'Label');assert.equal(renamed.ref.snapshot.name,'Test');
 const next={...one.ref.snapshot,name:'Version two',version:'2.0.0'};const published=await s.publish(a,one.id,{theme:next,expectedRevision:1,clientMutationId:'publish'});assert.equal(published.version,'2.0.0');assert.deepEqual(await s.getVersion(a,one.id,'1.0.0'),one.ref);
 await assert.rejects(s.publish(a,one.id,{theme:next,expectedRevision:2,clientMutationId:'overwrite'}),{code:'THEME_VERSION_EXISTS'});
 assert.equal((await s.favorite(a,one.id,true)).favorite,true);assert.equal((await s.favorite(a,one.id,false)).favorite,false);
 await s.patch(a,one.id,{archived:true,expectedRevision:2,clientMutationId:'archive'});assert.equal((await s.list(a)).length,0);assert.equal((await s.list(a,{archived:true})).length,1);
 const removed=await s.remove(a,one.id,{expectedRevision:3,clientMutationId:'delete'});assert.ok(removed.deletedAt);assert.equal(removed.ref.hash,published.ref.hash);await assert.rejects(s.get(a,one.id),{code:'NOT_FOUND'});assert.equal((await db.query('SELECT count(*)::int AS n FROM theme_versions')).rows[0].n,2);
}));
test('theme trust boundary, revoked sessions/tokens, scopes and CAS reject writes',()=>fixture(async(db,s,a)=>{
 for(const bad of [{...theme,license:''},{...theme,schemaVersion:2},{...theme,script:'alert(1)'},{...theme,assets:[{id:'bad',mimeType:'image/png',data:'AA==',hash:'sha256:'+'0'.repeat(64),license:'MIT'}]}])await assert.rejects(s.importTheme(a,{theme:bad,clientMutationId:randomUUID()}),{code:'INVALID_REQUEST'});
 const one=await s.importTheme(a,{theme,clientMutationId:'one'});
 const results=await Promise.allSettled(['left','right'].map(name=>s.patch(a,one.id,{name,expectedRevision:0,clientMutationId:name})));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason.code,'REVISION_CONFLICT');
 const tokens=new TokenService(db);const token=await tokens.create(a,{name:'Themes',scopes:['themes:read']});const mcp=await tokens.authenticate(token.token);assert.equal((await s.get(mcp,one.id)).id,one.id);await assert.rejects(s.importTheme(mcp,{theme,clientMutationId:'forbidden'}),{code:'FORBIDDEN'});await tokens.revoke(a,token.id);await assert.rejects(s.get(mcp,one.id),{code:'UNAUTHENTICATED'});
 await db.query('UPDATE sessions SET revoked_at=now() WHERE id=$1',[a.sessionId]);await assert.rejects(s.get(a,one.id),{code:'UNAUTHENTICATED'});await assert.rejects(s.importTheme(a,{theme,clientMutationId:'one'}),{code:'UNAUTHENTICATED'});
}));
test('theme HTTP routes enforce CSRF and independent bearer scopes and return readback',async()=>{
 const db=await createTestDatabase();const {buildApp}=await import('../../server/app.js');const {AuthService}=await import('../../server/auth/auth-service.js');const origin='http://127.0.0.1:8799';const app=buildApp({db,origin});
 try{
  await new AuthService(db).bootstrapAdmin('theme-admin','theme-test-strong-password');const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{username:'theme-admin',password:'theme-test-strong-password'}});assert.equal(login.statusCode,200);const cookie=String(login.headers['set-cookie']).split(';')[0],headers={origin,cookie,'x-csrf-token':login.json().csrfToken};
  assert.equal((await app.inject({method:'POST',url:'/api/v1/themes/import',headers:{origin,cookie},payload:{theme,clientMutationId:'missing-csrf'}})).statusCode,403);
  const imported=await app.inject({method:'POST',url:'/api/v1/themes/import',headers,payload:{theme,clientMutationId:'http-import'}});assert.equal(imported.statusCode,201);const item=imported.json();assert.deepEqual((await app.inject({method:'GET',url:'/api/v1/themes/'+item.id,headers})).json(),item);
  const list=(await app.inject({method:'GET',url:'/api/v1/themes',headers})).json();assert.equal(list.length,1);assert.equal('ref' in list[0],false);
  const token=await app.inject({method:'POST',url:'/api/v1/me/tokens',headers,payload:{name:'Theme writer',scopes:['themes:read','themes:write','themes:publish']}});assert.equal(token.statusCode,201);const bearer={authorization:'Bearer '+token.json().token};
  const created=await app.inject({method:'POST',url:'/api/v1/themes',headers:bearer,payload:{theme,clientMutationId:'bearer-create'}});assert.equal(created.statusCode,201);
  const publish=await app.inject({method:'POST',url:'/api/v1/themes/'+item.id+'/publish',headers:bearer,payload:{theme:{...item.ref.snapshot,version:'1.1.0'},expectedRevision:0,clientMutationId:'http-publish'}});assert.equal(publish.statusCode,200);
  assert.deepEqual((await app.inject({method:'GET',url:'/api/v1/themes/'+item.id+'/versions/1.0.0',headers:bearer})).json(),item.ref);
 }finally{await app.close();await cleanupTestDatabase(db);}
});

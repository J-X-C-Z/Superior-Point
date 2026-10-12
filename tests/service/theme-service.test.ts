import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
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
  const imported=await app.inject({method:'POST',url:'/api/v1/themes/import',headers,payload:{theme:{...theme,assets:[image()]},clientMutationId:'http-import'}});assert.equal(imported.statusCode,201);const item=imported.json();assert.deepEqual((await app.inject({method:'GET',url:'/api/v1/themes/'+item.id,headers})).json(),item);
  const list=(await app.inject({method:'GET',url:'/api/v1/themes',headers})).json();assert.equal(list.length,1);assert.equal('ref' in list[0],false);assert.equal(list[0].author,'Author');assert.deepEqual(list[0].supportedRatios,['16:9']);assert.deepEqual(list[0].colors,theme.tokens.colors);assert.equal(JSON.stringify(list).includes(image().data),false);
  const token=await app.inject({method:'POST',url:'/api/v1/me/tokens',headers,payload:{name:'Theme writer',scopes:['themes:read','themes:write','themes:publish']}});assert.equal(token.statusCode,201);const bearer={authorization:'Bearer '+token.json().token};
  const created=await app.inject({method:'POST',url:'/api/v1/themes',headers:bearer,payload:{theme,clientMutationId:'bearer-create'}});assert.equal(created.statusCode,201);
  const publish=await app.inject({method:'POST',url:'/api/v1/themes/'+item.id+'/publish',headers:bearer,payload:{theme:{...item.ref.snapshot,version:'1.1.0'},expectedRevision:0,clientMutationId:'http-publish'}});assert.equal(publish.statusCode,200);
  assert.deepEqual((await app.inject({method:'GET',url:'/api/v1/themes/'+item.id+'/versions/1.0.0',headers:bearer})).json(),item.ref);
  const versionIndex=await app.inject({url:'/api/v1/themes/'+item.id+'/versions?limit=1&offset=1',headers:bearer});assert.equal(versionIndex.statusCode,200);assert.equal(versionIndex.json()[0].version,'1.0.0');assert.equal((await app.inject({url:'/api/v1/themes/'+item.id+'/versions?limit=101',headers:bearer})).statusCode,400);
  const resource=await app.inject({url:'/api/v1/themes/'+item.id+'/versions/1.0.0/assets/texture',headers:bearer});assert.equal(resource.statusCode,200,resource.body);assert.equal(resource.headers['content-type'],'image/png');assert.equal(resource.headers['x-content-type-options'],'nosniff');assert.equal(resource.headers['x-asset-hash'],image().hash);assert.deepEqual(resource.rawPayload,Buffer.from(image().data,'base64'));
  assert.equal((await app.inject({url:'/api/v1/themes/'+item.id+'/versions/1.0.0/assets/missing',headers:bearer})).json().error.code,'THEME_ASSET_MISSING');
  const project=(await app.inject({method:'POST',url:'/api/v1/projects',headers,payload:{title:'preview-http'}})).json();const builtins=(await app.inject({url:'/api/v1/themes/builtins',headers})).json();const fixed=builtins[0],route='/api/v1/projects/'+project.id+'/theme/preview',payload={themeId:fixed.id,version:fixed.version,hash:fixed.hash,expectedRevision:0};
  assert.equal((await app.inject({method:'POST',url:route,headers:{origin,cookie},payload})).statusCode,403);
  const dryRun=await app.inject({method:'POST',url:route,headers,payload});assert.equal(dryRun.statusCode,200,dryRun.body);assert.equal(dryRun.json().revision,0);
  assert.equal((await app.inject({method:'POST',url:route,headers,payload:{...payload,slideIds:[]}})).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:route,headers,payload:{...payload,slideIds:['same','same']}})).statusCode,400);
  assert.equal((await app.inject({url:'/api/v1/projects/'+project.id+'/theme/compatibility',headers})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:route,headers:bearer,payload})).statusCode,403);

 }finally{await app.close();await cleanupTestDatabase(db);}
});
test('project theme dry-run is scoped, private, revision-bound and never persists',()=>fixture(async(db,s,a,b)=>{
 const {ProjectService}=await import('../../server/services/project-service.js');const projects=new ProjectService(db),created=await projects.create(a);
 const doc=await projects.edit(a,created.id,{expectedRevision:0,clientMutationId:'preview-content',operations:['one','two'].map(id=>({type:'createSlide' as const,slide:{id,notes:'keep',elements:[{id:'text-'+id,type:'text' as const,x:10,y:20,w:100,h:40,text:id,color:'#123456'}],animations:[]}}))});
 const item=await s.importTheme(a,{theme,clientMutationId:'preview-theme'}),input={themeId:item.ref.id,version:item.ref.version,hash:item.ref.hash,slideIds:['one'],mode:'reset' as const,expectedRevision:1};
 const before=await db.query('SELECT count(*)::int AS n FROM mutation_receipts');const plan=await projects.previewTheme(a,doc.id,input);
 assert.equal(plan.revision,1);assert.ok(plan.changes.length);assert.ok(plan.changes.every(change=>change.slideId==='one'));assert.deepEqual(plan.scope.slideIds,['one']);
 assert.deepEqual(await projects.get(a,doc.id),doc);assert.deepEqual((await db.query('SELECT count(*)::int AS n FROM mutation_receipts')).rows,before.rows);
 await assert.rejects(projects.previewTheme(a,doc.id,{...input,slideIds:['missing']}),{code:'INVALID_REQUEST'});await assert.rejects(projects.previewTheme(a,doc.id,{...input,expectedRevision:0}),{code:'REVISION_CONFLICT'});
 await assert.rejects(projects.previewTheme(b,doc.id,input),{code:'NOT_FOUND'});const other=await s.importTheme(b,{theme,clientMutationId:'private'});await assert.rejects(projects.previewTheme(a,doc.id,{...input,themeId:other.ref.id,hash:other.ref.hash}),{code:'NOT_FOUND'});
 const applied=await projects.applyTheme(a,doc.id,{...input,clientMutationId:'scoped-apply'});assert.equal(applied.revision,2);assert.deepEqual(applied.slides[1],doc.slides[1]);assert.equal(applied.slides[0].notes,'keep');
 assert.deepEqual(await projects.applyTheme(a,doc.id,{...input,clientMutationId:'scoped-apply'}),applied);await assert.rejects(projects.applyTheme(a,doc.id,{...input,slideIds:['two'],clientMutationId:'scoped-apply'}),{code:'MUTATION_ID_REUSED'});
 const compatibility=await projects.themeCompatibility(a,doc.id);assert.equal(compatibility.revision,2);assert.ok(Array.isArray(compatibility.motionDiagnostics));assert.ok(Array.isArray(compatibility.diagnostics));assert.equal(compatibility.kind,'document');assert.equal('snapshot' in compatibility.themeReferences[0],false);assert.deepEqual(await projects.get(a,doc.id),applied);
 const tokens=new TokenService(db);const read=await tokens.create(a,{name:'dry-run',scopes:['projects:read','themes:read'],projectAllowlist:[doc.id]});const actor=await tokens.authenticate(read.token);assert.equal((await projects.previewTheme(actor,doc.id,{...input,expectedRevision:2})).revision,2);await assert.rejects(projects.applyTheme(actor,doc.id,{...input,expectedRevision:2,clientMutationId:'read-write'}),{code:'FORBIDDEN'});
 const outside=await projects.create(a);await assert.rejects(projects.previewTheme(actor,outside.id,input),{code:'FORBIDDEN'});await assert.rejects(projects.themeCompatibility(actor,outside.id),{code:'FORBIDDEN'});
 const legacy=await tokens.create(a,{name:'legacy',scopes:['projects:read']});await assert.rejects(projects.themeCompatibility(await tokens.authenticate(legacy.token),doc.id),{code:'FORBIDDEN'});
}));

const image=()=>{const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP7cAAAAASUVORK5CYII=','base64');return {id:'texture',mimeType:'image/png',data:bytes.toString('base64'),hash:'sha256:'+createHash('sha256').update(bytes).digest('hex'),license:'CC0'};};
test('version metadata and pinned raster resources retain history and require a live owner',()=>fixture(async(db,s,a,b)=>{
 const asset=image(),one=await s.importTheme(a,{theme:{...theme,assets:[asset]},clientMutationId:'assets'}),two=await s.publish(a,one.id,{theme:{...one.ref.snapshot,version:'2.0.0',assets:[]},expectedRevision:0,clientMutationId:'asset-version'});
 const versions=await s.versions(a,one.id);assert.deepEqual(versions.map(v=>[v.version,v.hash,v.current]),[['2.0.0',two.ref.hash,true],['1.0.0',one.ref.hash,false]]);assert.ok(versions.every(v=>v.createdAt&&!('snapshot' in v)));assert.equal((await s.versions(a,one.id,{limit:1,offset:1}))[0].version,'1.0.0');await assert.rejects(s.versions(a,one.id,{limit:101}),{code:'INVALID_REQUEST'});
 const read=await s.asset(a,one.id,'1.0.0','texture');assert.deepEqual(Buffer.from(read.bytes),Buffer.from(asset.data,'base64'));assert.equal(read.mimeType,'image/png');assert.equal(read.integrity,'sha256-'+createHash('sha256').update(read.bytes).digest('base64'));await assert.rejects(s.asset(a,one.id,'2.0.0','texture'),{code:'THEME_ASSET_MISSING'});
 for(const call of [()=>s.versions(b,one.id),()=>s.asset(b,one.id,'1.0.0','texture')])await assert.rejects(call(),{code:'NOT_FOUND'});
 const tokens=new TokenService(db),legacy=await tokens.create(a,{name:'legacy',scopes:['projects:read']}),readToken=await tokens.create(a,{name:'assets',scopes:['themes:read']}),legacyActor=await tokens.authenticate(legacy.token),reader=await tokens.authenticate(readToken.token);
 await assert.rejects(s.asset(legacyActor,one.id,'1.0.0','texture'),{code:'FORBIDDEN'});await assert.rejects(s.versions(legacyActor,one.id),{code:'FORBIDDEN'});assert.equal((await s.asset(reader,one.id,'1.0.0','texture')).hash,asset.hash);
 await s.favorite(a,one.id,true);await s.patch(a,one.id,{archived:true,expectedRevision:1,clientMutationId:'archive-assets'});assert.deepEqual(await s.versions(a,one.id),versions);assert.equal((await s.asset(a,one.id,'1.0.0','texture')).hash,asset.hash);
 await db.query("UPDATE theme_versions SET snapshot_jsonb=jsonb_set(snapshot_jsonb,'{assets,0,hash}',$3::jsonb) WHERE theme_id=$1 AND version=$2",[one.id,'1.0.0',JSON.stringify('sha256:'+'0'.repeat(64))]);await assert.rejects(s.asset(a,one.id,'1.0.0','texture'),{code:'THEME_ASSET_CORRUPT'});
 await tokens.revoke(a,readToken.id);await assert.rejects(s.versions(reader,one.id),{code:'UNAUTHENTICATED'});await assert.rejects(s.asset(reader,one.id,'1.0.0','texture'),{code:'UNAUTHENTICATED'});
 await db.query("UPDATE users SET status='disabled' WHERE id=$1",[a.id]);await assert.rejects(s.versions(a,one.id),{code:'UNAUTHENTICATED'});await assert.rejects(s.asset(a,one.id,'1.0.0','texture'),{code:'UNAUTHENTICATED'});
}));

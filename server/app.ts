import {registerQuotaRoutes} from './routes/quota-routes.js';
import {registerShareRoutes} from './routes/share-routes.js';
import {ShareService} from './services/share-service.js';
import {registerProjectEvents} from './project-events.js';
import {MetricsService} from './observability/metrics-service.js';
import {registerObservabilityRoutes} from './observability/routes.js';
import {registerMcpHttp, type McpAuthenticator} from './mcp-http.js';
import {OAuthService} from './auth/oauth-service.js';
import {registerOAuthRoutes} from './auth/oauth-routes.js';
import Fastify, {type FastifyRequest} from 'fastify';
import {randomUUID} from 'node:crypto';
import {ServiceError, errors, requireAdmin, type Database, type Actor} from './contracts.js';
import {AuthService} from './auth/auth-service.js';
import {ThemeService} from './services/theme-service.js';
import {ProjectService} from './services/project-service.js';
import {TokenService} from './auth/token-service.js';
import {registerAdminRoutes} from './routes/admin-routes.js';
import {registerStaticRoutes} from './routes/static-routes.js';
import {BackupService} from './services/backup-service.js';
import {validateDocument} from '../core/document-core.js';
import {exportHTML,renderSlideSVG,inspectRenderCompatibility} from '../io/html.js';
export type AppOptions = {hostMetricsFile?:string; authenticateMcp?:McpAuthenticator; db: Database; origin: string; secureCookies?: boolean; loginLimit?: number; loginWindowMs?: number; trustProxyHops?:number; backupDirectory?:string; assetDirectory?:string; backupDatabaseUrl?:string; restoreDatabaseUrl?:string; pgBinDirectory?:string};
const text={type:'string',minLength:1,maxLength:128} as const;
const revision={type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER} as const;
const mutation={expectedRevision:revision,clientMutationId:text};
const schema=(properties:Record<string,unknown>,required:string[])=>({type:'object',properties,required,additionalProperties:false});
function body(request: FastifyRequest): any {return request.body;}
export function buildApp(options: AppOptions) {
 const {db,origin}=options;const originURL=new URL(origin);
 if(options.trustProxyHops!==undefined&&options.trustProxyHops!==0&&options.trustProxyHops!==1)throw Error('Trust exactly zero or one proxy hop');
 if(originURL.origin!==origin || (!options.secureCookies && !['localhost','127.0.0.1','[::1]'].includes(originURL.hostname)) || (options.secureCookies && originURL.protocol!=='https:')) throw Error('Use exact HTTPS origin, or explicit loopback development HTTP');
 const auth=new AuthService(db,{origin,secureCookies:options.secureCookies});const projects=new ProjectService(db);const tokens=new TokenService(db);const themes=new ThemeService(db);
 // This opt-in requires private app access through a single ingress proxy.
 const app=Fastify({logger:false,trustProxy:options.trustProxyHops===1?(_address,hop)=>hop===0:false,bodyLimit:32*1024*1024,ajv:{customOptions:{removeAdditional:false,coerceTypes:false}},genReqId:()=>randomUUID()});
 const mcpRelays=new Map<string,string>();
 const oauth=new OAuthService(db,origin);const authenticateMcp=options.authenticateMcp??(raw=>raw.startsWith('sp_oauth_')?oauth.authenticate(raw):tokens.authenticate(raw));
 const cookieName=options.secureCookies?'__Host-sp-session':'sp-session';
 const cookie=(value:string,maxAge:number)=>`${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${options.secureCookies?'; Secure':''}`;
 function session(request:FastifyRequest){const entries=(request.headers.cookie??'').split(';').map(c=>c.trim().split('='));const values=entries.filter(([k])=>k===cookieName);if(values.length!==1)return '';return values[0][1]??'';}
 async function actor(request:FastifyRequest) {
  const authorization=request.headers.authorization;
  if(authorization!==undefined){if(request.headers.cookie||!/^Bearer \S+$/.test(authorization))throw errors.unauthorized();const raw=authorization.slice(7),relay=request.headers['x-sp-mcp-relay'];if(typeof relay==='string' && mcpRelays.get(relay)===raw){return authenticateMcp(raw);}return tokens.authenticate(raw);}
  const current=await auth.authenticate(session(request));const expected=request.headers['x-sp-account-id'];if(expected!==undefined&&(typeof expected!=='string'||expected!==current.id))throw new ServiceError('ACCOUNT_CHANGED',403,'账号已在其他标签页变更，请重新登录；当前草稿保留。');return current;
 }
 const attempts=new Map<string,{count:number;expires:number}>();
 app.addHook('onRequest',async(request,reply)=>{
  reply.header('X-Content-Type-Options','nosniff').header('Cache-Control','no-store').header('Referrer-Policy','no-referrer');
  reply.header('Content-Security-Policy',"frame-ancestors 'self'; object-src 'none'; base-uri 'self'").header('X-Frame-Options','SAMEORIGIN');
  if(options.secureCookies)reply.header('Strict-Transport-Security','max-age=31536000');
  if(!['/mcp','/token','/register','/revoke'].includes(request.url.split('?')[0]) && ['POST','PATCH','PUT','DELETE'].includes(request.method) && request.headers.origin!==origin && !(request.headers.authorization?.startsWith('Bearer ') && !request.headers.cookie && request.headers.origin===undefined && /^\/api\/v1\/(?:projects|themes)(?:\/|$)/.test(request.url))) throw new ServiceError('INVALID_ORIGIN',403,'请求来源无效');
  if(request.method==='POST' && request.url.split('?')[0]==='/api/v1/auth/login'){
   const now=Date.now();for(const [key,item] of attempts)if(item.expires<=now)attempts.delete(key);
   const limit=options.loginLimit??10; const item=attempts.get(request.ip)??{count:0,expires:now+(options.loginWindowMs??15*60*1000)};
   if(item.count>=limit || (attempts.size>=10000&&!attempts.has(request.ip))) {reply.header('Retry-After',String(Math.ceil((item.expires-now)/1000)));throw new ServiceError('RATE_LIMITED',429,'登录尝试过多，请稍后重试');}
   item.count++;attempts.set(request.ip,item);
  }
 });
 async function writable(request:FastifyRequest):Promise<Actor> {const current=await actor(request);if(current.source==='mcp')return current;const token=request.headers['x-csrf-token'];if(typeof token!=='string')throw new ServiceError('CSRF_INVALID',403,'请求验证失败');await auth.verifyCsrf(current,token);return current;}
 app.setErrorHandler((error,request,reply)=>{
  if(error instanceof ServiceError)return reply.code(error.status).send({error:{code:error.code,message:error.message,...(error.details?{details:error.details}:{})}});
  const failure=error as {validation?:unknown;statusCode?:number};
  if(failure.validation)return reply.code(400).send({error:{code:'INVALID_REQUEST',message:'请求参数无效'}});
  if(failure.statusCode===413)return reply.code(413).send({error:{code:'PAYLOAD_TOO_LARGE',message:'请求内容超过大小限制'}});
  if(failure.statusCode===400)return reply.code(400).send({error:{code:'INVALID_REQUEST',message:'请求参数无效'}});
  return reply.code(500).send({error:{code:'INTERNAL_ERROR',message:'服务暂不可用',requestId:request.id}});
 });
 app.addHook('preValidation',async(request)=>{
  if(!/^\/api\/v1\/(?:projects|themes)(?:\/|$)/.test(request.url))return;
  const rows=(await db.query("SELECT key,value FROM system_settings WHERE key IN ('maintenanceMode','maxUploadBytes')")).rows;
  const settings=Object.fromEntries(rows.map(row=>[row.key,row.value]));
  if(settings.maintenanceMode){const current=await actor(request);if(current.role!=='admin'||current.source!=='web')throw new ServiceError('MAINTENANCE_MODE',503,'服务维护中，请稍后重试');}
  if(request.body!==undefined&&Buffer.byteLength(JSON.stringify(request.body))>(settings.maxUploadBytes??32*1024*1024))throw new ServiceError('PAYLOAD_TOO_LARGE',413,'请求内容超过上传大小限制');
 });
 app.addHook('onResponse',async(request,reply)=>{console.info(JSON.stringify({requestId:request.id,method:request.method,route:request.routeOptions.url??'unmatched',status:reply.statusCode,durationMs:Math.round(reply.elapsedTime)}));});
 app.get('/api/v1/public/config',async()=>{const rows=(await db.query("SELECT key,value FROM system_settings WHERE key IN ('siteName','announcement','maintenanceMode')")).rows;return Object.fromEntries(rows.map(row=>[row.key,row.value]));});
 app.get('/health/live',async()=>({status:'ok'}));
 app.get('/health/ready',async request=>{requireAdmin(await actor(request));await db.query('SELECT 1');return {status:'ready'};});
 app.post('/api/v1/auth/login',{schema:{body:schema({username:{type:'string',minLength:3,maxLength:64},password:{type:'string',minLength:1,maxLength:1024}},['username','password'])}},async(request,reply)=>{
  const result=await auth.login(body(request).username,body(request).password);
  reply.header('Set-Cookie',cookie(result.sessionToken,Math.max(0,Math.floor((new Date(result.expiresAt).getTime()-Date.now())/1000))));return {user:result.user,csrfToken:result.csrfToken};
 });
 app.get('/api/v1/me/sessions',async request=>auth.listOwnSessions(await actor(request)));
 app.delete('/api/v1/me/sessions/:id',{schema:{params:schema({id:{type:'string',format:'uuid'}},['id'])}},async request=>auth.revokeOwnSession(await writable(request),(request.params as {id:string}).id));
 app.get('/api/v1/admin/security',async request=>auth.loginSecurity(await actor(request)));
 app.get('/api/v1/auth/me',async request=>({user:await auth.getUser(await actor(request))}));
 app.post('/api/v1/auth/csrf',async request=>{const current=await actor(request);if(current.source!=='web')throw errors.forbidden();return auth.rotateCsrf(current);});
 app.post('/api/v1/auth/reauth',{schema:{body:schema({password:{type:'string',minLength:1,maxLength:1024}},['password'])}},async request=>auth.reauthenticate(await writable(request),body(request).password));
 app.post('/api/v1/auth/password',{schema:{body:schema({currentPassword:{type:'string',minLength:1,maxLength:1024},newPassword:{type:'string',minLength:12,maxLength:1024}},['currentPassword','newPassword'])}},async request=>auth.changePassword(await writable(request),body(request)));
 app.get('/api/v1/me/tokens',async request=>tokens.list(await actor(request)));
 app.post('/api/v1/me/tokens',{schema:{body:schema({name:text,scopes:{type:'array',maxItems:9,uniqueItems:true,items:{type:'string',enum:['projects:read','projects:create','projects:write','projects:delete','projects:export','assets:write','themes:read','themes:write','themes:publish']}},projectAllowlist:{anyOf:[{type:'null'},{type:'array',maxItems:1000,uniqueItems:true,items:text}]},expiresAt:{type:'string',maxLength:64}},['name'])}},async(request,reply)=>reply.code(201).send(await tokens.create(await writable(request),body(request))));
 app.delete('/api/v1/me/tokens/:id',async request=>tokens.revoke(await writable(request),(request.params as {id:string}).id));
 app.post('/api/v1/projects/import',{schema:{body:schema({document:{type:'object'},clientMutationId:text},['document','clientMutationId'])}},async(request,reply)=>reply.code(201).send(await projects.importProject(await writable(request),body(request))));
 app.post('/api/v1/auth/logout',async(request,reply)=>{await writable(request);await auth.logout(session(request));reply.header('Set-Cookie',cookie('',0));return {success:true};});
 app.get('/api/v1/themes',async request=>{const q=request.query as {archived?:string;trash?:string};if([q.archived,q.trash].some(v=>v!==undefined&&!['true','false'].includes(v)))throw errors.invalid();return themes.list(await actor(request),{archived:q.archived==='true',trash:q.trash==='true'});});
 app.get('/api/v1/themes/builtins',async request=>themes.builtins(await actor(request)));
 app.get('/api/v1/themes/builtin/:id',async request=>themes.builtin(await actor(request),(request.params as {id:string}).id,(request.query as {version?:string}).version));
 app.post('/api/v1/themes/preview',{schema:{body:schema({themeId:text,version:{type:'string',minLength:1,maxLength:64},hash:{type:'string',pattern:'^sha256:[a-f0-9]{64}$'},ratio:{type:'string',enum:['16:9','4:3']}},['themeId','version','hash'])}},async request=>themes.preview(await writable(request),body(request)));
 app.get('/api/v1/themes/:id',async request=>themes.get(await actor(request),(request.params as {id:string}).id));
 app.get('/api/v1/themes/:id/versions',async request=>{const q=request.query as {limit?:string;offset?:string};if([q.limit,q.offset].some(v=>v!==undefined&&!/^\d+$/.test(v)))throw errors.invalid();return themes.versions(await actor(request),(request.params as {id:string}).id,{limit:q.limit===undefined?100:Number(q.limit),offset:q.offset===undefined?0:Number(q.offset)});});
 for(const builtin of [false,true])app.get('/api/v1/themes/'+(builtin?'builtin/':'')+':id/versions/:version/assets/:assetId',async(request,reply)=>{const p=request.params as {id:string;version:string;assetId:string},asset=await themes.asset(await actor(request),p.id,p.version,p.assetId,{builtin});return reply.type(asset.mimeType).header('X-Content-Type-Options','nosniff').header('Cache-Control','private, no-store').header('ETag','"'+asset.hash+'"').header('X-Asset-Hash',asset.hash).header('X-Asset-Integrity',asset.integrity).send(Buffer.from(asset.bytes));});
 app.get('/api/v1/themes/:id/versions/:version',async request=>{const p=request.params as {id:string;version:string};return themes.getVersion(await actor(request),p.id,p.version);});
 for(const path of ['/api/v1/themes','/api/v1/themes/import'])app.post(path,{schema:{body:schema({theme:{type:'object'},clientMutationId:text},['theme','clientMutationId'])}},async(request,reply)=>reply.code(201).send(await themes.importTheme(await writable(request),body(request))));
 app.post('/api/v1/themes/:id/publish',{schema:{body:schema({...mutation,theme:{type:'object'}},['expectedRevision','clientMutationId','theme'])}},async request=>themes.publish(await writable(request),(request.params as {id:string}).id,body(request)));
 app.patch('/api/v1/themes/:id',{schema:{body:schema({...mutation,name:{type:'string',minLength:1,maxLength:200},archived:{type:'boolean'}},['expectedRevision','clientMutationId'])}},async request=>themes.patch(await writable(request),(request.params as {id:string}).id,body(request)));
 app.delete('/api/v1/themes/:id',{schema:{body:schema(mutation,['expectedRevision','clientMutationId'])}},async request=>themes.remove(await writable(request),(request.params as {id:string}).id,body(request)));
 app.post('/api/v1/themes/:id/favorite',async request=>themes.favorite(await writable(request),(request.params as {id:string}).id,true));
 app.delete('/api/v1/themes/:id/favorite',async request=>themes.favorite(await writable(request),(request.params as {id:string}).id,false));
 app.get('/api/v1/projects',async request=>{const query=request.query as {trash?:string};if(query.trash!==undefined&&!['true','false'].includes(query.trash))throw errors.invalid();return projects.list(await actor(request),{trash:query.trash==='true'});});
 app.post('/api/v1/projects',{schema:{body:schema({title:{type:'string',maxLength:500},canvas:schema({width:{type:'number',exclusiveMinimum:0},height:{type:'number',exclusiveMinimum:0}},['width','height'])},[])}},async(request,reply)=>{const result=await projects.create(await writable(request),body(request));return reply.code(201).send(result);});
 app.get('/api/v1/projects/:id',async request=>projects.get(await actor(request),(request.params as {id:string}).id));
 const historyRevision=(value:unknown)=>{if(typeof value!=='string'||!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw errors.invalid('历史修订号无效');return Number(value);};
 app.get('/api/v1/projects/:id/revisions',async request=>projects.listRevisions(await actor(request),(request.params as {id:string}).id));
 app.get('/api/v1/projects/:id/revisions/:revision',async request=>{const p=request.params as {id:string;revision:string};return projects.getRevision(await actor(request),p.id,historyRevision(p.revision));});
 app.get('/api/v1/projects/:id/revision-diff',async request=>{const q=request.query as {from?:string;to?:string};return projects.revisionDiff(await actor(request),(request.params as {id:string}).id,historyRevision(q.from),historyRevision(q.to));});
 app.post('/api/v1/projects/:id/restore-revision',{schema:{body:schema({...mutation,revision,leaseToken:text},['revision','expectedRevision','clientMutationId'])}},async request=>projects.restoreRevision(await writable(request),(request.params as {id:string}).id,body(request)));
 app.get('/api/v1/projects/:id/document',async request=>projects.get(await actor(request),(request.params as {id:string}).id,{trash:(request.query as {trash?:string}).trash==='true'}));
 app.put('/api/v1/projects/:id/snapshot',{schema:{body:schema({...mutation,leaseToken:text,document:{type:'object'}},['expectedRevision','clientMutationId','leaseToken','document'])}},async request=>projects.saveSnapshot(await writable(request),(request.params as {id:string}).id,body(request)));
 app.get('/api/v1/projects/:id/slides',async request=>{const doc=await projects.get(await actor(request),(request.params as {id:string}).id);return {projectId:doc.id,revision:doc.revision,slides:doc.slides};});
 app.get('/api/v1/projects/:id/slides/:slideId',async request=>{const params=request.params as {id:string;slideId:string};const doc=await projects.get(await actor(request),params.id);const slide=doc.slides.find(slide=>slide.id===params.slideId);if(!slide)throw errors.missing();return {projectId:doc.id,revision:doc.revision,slide};});
 app.get('/api/v1/projects/:id/slides/:slideId/render',async request=>{const params=request.params as {id:string;slideId:string};const doc=await projects.get(await actor(request),params.id);if(!doc.slides.some(slide=>slide.id===params.slideId))throw errors.missing();return {projectId:doc.id,revision:doc.revision,mimeType:'image/svg+xml',svg:renderSlideSVG(doc,params.slideId),renderCompatibility:inspectRenderCompatibility(doc),limitations:['Static SVG; no animation playback','Generic renderer differs from editor']};});
 app.get('/api/v1/projects/:id/validate',async request=>{const doc=await projects.get(await actor(request),(request.params as {id:string}).id);return {...validateDocument(doc),revision:doc.revision,renderCompatibility:inspectRenderCompatibility(doc)};});
 app.post('/api/v1/projects/:id/exports',{schema:{body:schema({expectedRevision:revision,format:{type:'string',enum:['editable-html','audience-html']}},['expectedRevision','format'])}},async request=>{const doc=await projects.getForExport(await writable(request),(request.params as {id:string}).id);if(doc.revision!==body(request).expectedRevision)throw new ServiceError('REVISION_CONFLICT',409,'项目已有新修订');const report=inspectRenderCompatibility(doc);if(body(request).format==='audience-html'&&report.hasKnownGaps)throw new ServiceError('EXPORT_UNSUPPORTED',422,'此文稿需要在编辑器中使用原渲染器分享');return {html:await exportHTML(doc,{audience:body(request).format==='audience-html'}),mimeType:'text/html',revision:doc.revision,renderCompatibility:report};});
 const themeApplication={themeId:text,version:{type:'string',minLength:1,maxLength:64},hash:{type:'string',pattern:'^sha256:[a-f0-9]{64}$'},mode:{type:'string',enum:['preserve','reset']},slideIds:{type:'array',minItems:1,maxItems:1000,uniqueItems:true,items:text}};
 app.post('/api/v1/projects/:id/theme/preview',{schema:{body:schema({...themeApplication,expectedRevision:revision},['themeId','version','hash'])}},async request=>projects.previewTheme(await writable(request),(request.params as {id:string}).id,body(request)));
 app.get('/api/v1/projects/:id/theme/compatibility',async request=>projects.themeCompatibility(await actor(request),(request.params as {id:string}).id));
 app.post('/api/v1/projects/:id/theme',{schema:{body:schema({...mutation,...themeApplication,leaseToken:text},['expectedRevision','clientMutationId','themeId','version','hash'])}},async request=>projects.applyTheme(await writable(request),(request.params as {id:string}).id,body(request)));
 app.patch('/api/v1/projects/:id/document',{schema:{body:schema({...mutation,leaseToken:text,operations:{type:'array',minItems:1,maxItems:1000,items:{type:'object'}}},['expectedRevision','clientMutationId','operations'])}},async request=>projects.edit(await writable(request),(request.params as {id:string}).id,body(request)));
 app.patch('/api/v1/projects/:id',{schema:{body:schema({...mutation,title:{type:'string',maxLength:500},leaseToken:text},['expectedRevision','clientMutationId','title'])}},async request=>projects.rename(await writable(request),(request.params as {id:string}).id,body(request)));
 app.delete('/api/v1/projects/:id',{schema:{body:schema({...mutation,leaseToken:text},['expectedRevision','clientMutationId'])}},async request=>projects.remove(await writable(request),(request.params as {id:string}).id,body(request)));
 app.post('/api/v1/projects/:id/restore',{schema:{body:schema({...mutation,leaseToken:text},['expectedRevision','clientMutationId'])}},async request=>projects.restore(await writable(request),(request.params as {id:string}).id,body(request)));
 app.post('/api/v1/projects/:id/lease',{schema:{body:schema({holder:text},['holder'])}},async request=>projects.acquireLease(await writable(request),(request.params as {id:string}).id,body(request).holder));
 app.post('/api/v1/projects/:id/lease/renew',{schema:{body:schema({leaseToken:text},['leaseToken'])}},async request=>projects.renewLease(await writable(request),(request.params as {id:string}).id,body(request).leaseToken));
 app.delete('/api/v1/projects/:id/lease',{schema:{body:schema({leaseToken:text},['leaseToken'])}},async request=>projects.releaseLease(await writable(request),(request.params as {id:string}).id,body(request).leaseToken));
 const backupService=new BackupService(db,{directory:options.backupDirectory,assetDirectory:options.assetDirectory,databaseUrl:options.backupDatabaseUrl,restoreDatabaseUrl:options.restoreDatabaseUrl,pgBinDirectory:options.pgBinDirectory});
 app.addHook('onReady',async()=>backupService.reconcileInterrupted());
 app.addHook('onClose',async()=>backupService.waitForIdle());
 registerAdminRoutes(app,{db,auth,tokens,projects,actor,writable,backupService});
 registerQuotaRoutes(app,{db,actor});
 registerShareRoutes(app,{shares:new ShareService(db,{origin}),actor,writable});
 registerStaticRoutes(app,actor);
 registerProjectEvents(app,{db,origin,actor});
 registerOAuthRoutes(app,{db,origin,auth,actor,service:oauth});
 const metrics=new MetricsService(db,{hostMetricsFile:options.hostMetricsFile});
 registerObservabilityRoutes(app,{metrics,actor});
 registerMcpHttp(app,{onToolCall:call=>metrics.recordToolCall(call),origin,authenticate:authenticateMcp,dispatch:async(raw,method,route,payload)=>{
  const relay=randomUUID();mcpRelays.set(relay,raw);
  try{return await app.inject({method:method as 'GET'|'POST'|'PATCH'|'DELETE',url:'/api/v1'+route,headers:{authorization:'Bearer '+raw,host:originURL.host,'x-sp-mcp-relay':relay},...(payload===undefined?{}:{payload:payload as object})});}finally{mcpRelays.delete(relay);}
 }});
 return app;
}

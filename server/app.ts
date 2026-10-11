import Fastify, {type FastifyRequest} from 'fastify';
import {randomUUID} from 'node:crypto';
import {ServiceError, errors, requireAdmin, type Database, type Actor} from './contracts.js';
import {AuthService} from './auth/auth-service.js';
import {ProjectService} from './services/project-service.js';
export type AppOptions = {db: Database; origin: string; secureCookies?: boolean; loginLimit?: number; loginWindowMs?: number};
const text={type:'string',minLength:1,maxLength:128} as const;
const revision={type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER} as const;
const mutation={expectedRevision:revision,clientMutationId:text};
const schema=(properties:Record<string,unknown>,required:string[])=>({type:'object',properties,required,additionalProperties:false});
function body(request: FastifyRequest): any {return request.body;}
export function buildApp(options: AppOptions) {
 const {db,origin}=options;const originURL=new URL(origin);
 if(originURL.origin!==origin || (!options.secureCookies && !['localhost','127.0.0.1','[::1]'].includes(originURL.hostname)) || (options.secureCookies && originURL.protocol!=='https:')) throw Error('Use exact HTTPS origin, or explicit loopback development HTTP');
 const auth=new AuthService(db,{origin,secureCookies:options.secureCookies});const projects=new ProjectService(db);
 const app=Fastify({logger:false,bodyLimit:32*1024*1024,ajv:{customOptions:{removeAdditional:false,coerceTypes:false}},genReqId:()=>randomUUID()});
 const cookieName=options.secureCookies?'__Host-sp-session':'sp-session';
 const cookie=(value:string,maxAge:number)=>`${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${options.secureCookies?'; Secure':''}`;
 function session(request:FastifyRequest){const entries=(request.headers.cookie??'').split(';').map(c=>c.trim().split('='));const values=entries.filter(([k])=>k===cookieName);if(values.length!==1)return '';return values[0][1]??'';}
 async function actor(request:FastifyRequest) {return auth.authenticate(session(request));}
 const attempts=new Map<string,{count:number;expires:number}>();
 app.addHook('onRequest',async(request,reply)=>{
  reply.header('X-Content-Type-Options','nosniff').header('Cache-Control','no-store').header('Referrer-Policy','no-referrer');
  if(['POST','PATCH','PUT','DELETE'].includes(request.method) && request.headers.origin!==origin) throw new ServiceError('INVALID_ORIGIN',403,'请求来源无效');
  if(request.method==='POST' && request.url.split('?')[0]==='/api/v1/auth/login'){
   const now=Date.now();for(const [key,item] of attempts)if(item.expires<=now)attempts.delete(key);
   const limit=options.loginLimit??10; const item=attempts.get(request.ip)??{count:0,expires:now+(options.loginWindowMs??15*60*1000)};
   if(item.count>=limit || (attempts.size>=10000&&!attempts.has(request.ip))) {reply.header('Retry-After',String(Math.ceil((item.expires-now)/1000)));throw new ServiceError('RATE_LIMITED',429,'登录尝试过多，请稍后重试');}
   item.count++;attempts.set(request.ip,item);
  }
 });
 async function writable(request:FastifyRequest):Promise<Actor> {const current=await actor(request);const token=request.headers['x-csrf-token'];if(typeof token!=='string')throw new ServiceError('CSRF_INVALID',403,'请求验证失败');await auth.verifyCsrf(current,token);return current;}
 app.setErrorHandler((error,request,reply)=>{
  if(error instanceof ServiceError)return reply.code(error.status).send({error:{code:error.code,message:error.message,...(error.details?{details:error.details}:{})}});
  const failure=error as {validation?:unknown;statusCode?:number};
  if(failure.validation)return reply.code(400).send({error:{code:'INVALID_REQUEST',message:'请求参数无效'}});
  if(failure.statusCode===413)return reply.code(413).send({error:{code:'PAYLOAD_TOO_LARGE',message:'请求内容超过大小限制'}});
  if(failure.statusCode===400)return reply.code(400).send({error:{code:'INVALID_REQUEST',message:'请求参数无效'}});
  return reply.code(500).send({error:{code:'INTERNAL_ERROR',message:'服务暂不可用',requestId:request.id}});
 });
 app.get('/health/live',async()=>({status:'ok'}));
 app.get('/health/ready',async request=>{requireAdmin(await actor(request));await db.query('SELECT 1');return {status:'ready'};});
 app.post('/api/v1/auth/login',{schema:{body:schema({username:{type:'string',minLength:3,maxLength:64},password:{type:'string',minLength:1,maxLength:1024}},['username','password'])}},async(request,reply)=>{
  const result=await auth.login(body(request).username,body(request).password);
  reply.header('Set-Cookie',cookie(result.sessionToken,Math.max(0,Math.floor((new Date(result.expiresAt).getTime()-Date.now())/1000))));return {user:result.user,csrfToken:result.csrfToken};
 });
 app.get('/api/v1/auth/me',async request=>({user:await auth.getUser(await actor(request))}));
 app.post('/api/v1/auth/logout',async(request,reply)=>{await writable(request);await auth.logout(session(request));reply.header('Set-Cookie',cookie('',0));return {success:true};});
 app.get('/api/v1/projects',async request=>{const query=request.query as {trash?:string};if(query.trash!==undefined&&!['true','false'].includes(query.trash))throw errors.invalid();return projects.list(await actor(request),{trash:query.trash==='true'});});
 app.post('/api/v1/projects',{schema:{body:schema({title:{type:'string',maxLength:500},canvas:schema({width:{type:'number',exclusiveMinimum:0},height:{type:'number',exclusiveMinimum:0}},['width','height'])},[])}},async(request,reply)=>{const result=await projects.create(await writable(request),body(request));return reply.code(201).send(result);});
 app.get('/api/v1/projects/:id',async request=>projects.get(await actor(request),(request.params as {id:string}).id));
 app.get('/api/v1/projects/:id/document',async request=>projects.get(await actor(request),(request.params as {id:string}).id));
 app.patch('/api/v1/projects/:id/document',{schema:{body:schema({...mutation,leaseToken:text,operations:{type:'array',minItems:1,maxItems:1000,items:{type:'object'}}},['expectedRevision','clientMutationId','operations'])}},async request=>projects.edit(await writable(request),(request.params as {id:string}).id,body(request)));
 app.patch('/api/v1/projects/:id',{schema:{body:schema({...mutation,title:{type:'string',maxLength:500},leaseToken:text},['expectedRevision','clientMutationId','title'])}},async request=>projects.rename(await writable(request),(request.params as {id:string}).id,body(request)));
 app.delete('/api/v1/projects/:id',{schema:{body:schema({...mutation,leaseToken:text},['expectedRevision','clientMutationId'])}},async request=>projects.remove(await writable(request),(request.params as {id:string}).id,body(request)));
 app.post('/api/v1/projects/:id/restore',{schema:{body:schema({...mutation,leaseToken:text},['expectedRevision','clientMutationId'])}},async request=>projects.restore(await writable(request),(request.params as {id:string}).id,body(request)));
 app.post('/api/v1/projects/:id/lease',{schema:{body:schema({holder:text},['holder'])}},async request=>projects.acquireLease(await writable(request),(request.params as {id:string}).id,body(request).holder));
 app.post('/api/v1/projects/:id/lease/renew',{schema:{body:schema({leaseToken:text},['leaseToken'])}},async request=>projects.renewLease(await writable(request),(request.params as {id:string}).id,body(request).leaseToken));
 app.delete('/api/v1/projects/:id/lease',{schema:{body:schema({leaseToken:text},['leaseToken'])}},async request=>projects.releaseLease(await writable(request),(request.params as {id:string}).id,body(request).leaseToken));
 app.get('/api/v1/admin/users',async request=>auth.listUsers(await actor(request)));
 app.post('/api/v1/admin/users',{schema:{body:schema({username:{type:'string',minLength:3,maxLength:64},password:{type:'string',minLength:12,maxLength:1024},role:{type:'string',enum:['admin','user']}},['username','password'])}},async(request,reply)=>reply.code(201).send(await auth.createUser(await writable(request),body(request))));
 app.patch('/api/v1/admin/users/:id/status',{schema:{body:schema({status:{type:'string',enum:['active','disabled']}},['status'])}},async request=>auth.setUserStatus(await writable(request),(request.params as {id:string}).id,body(request).status));
 app.patch('/api/v1/admin/users/:id/role',{schema:{body:schema({role:{type:'string',enum:['admin','user']}},['role'])}},async request=>auth.setUserRole(await writable(request),(request.params as {id:string}).id,body(request).role));
 app.delete('/api/v1/admin/users/:id/sessions',async request=>{await auth.revokeUserSessions(await writable(request),(request.params as {id:string}).id);return {success:true};});
 return app;
}

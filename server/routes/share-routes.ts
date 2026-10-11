import type {FastifyInstance,FastifyRequest} from 'fastify';
import {ServiceError,type Actor} from '../contracts.js';
import type {ShareService} from '../services/share-service.js';
const uuid={type:'string',pattern:'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'};
const params={type:'object',properties:{id:uuid},required:['id'],additionalProperties:false};
export function registerShareRoutes(app:FastifyInstance,context:{shares:ShareService;actor:(request:FastifyRequest)=>Promise<Actor>;writable:(request:FastifyRequest)=>Promise<Actor>}){
 app.post('/api/v1/projects/:id/shares',{schema:{params,body:{type:'object',additionalProperties:false,properties:{expectedRevision:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},expiresAt:{type:'string',maxLength:64}},required:['expectedRevision']}}},async(request,reply)=>reply.code(201).send(await context.shares.create(await context.writable(request),(request.params as {id:string}).id,request.body as {expectedRevision:number;expiresAt?:string})));
 app.get('/api/v1/projects/:id/shares',{schema:{params}},async request=>context.shares.list(await context.actor(request),(request.params as {id:string}).id));
 app.delete('/api/v1/projects/:id/shares/:shareId',{schema:{params:{...params,properties:{id:uuid,shareId:uuid},required:['id','shareId']}}},async request=>{const p=request.params as {id:string;shareId:string};return context.shares.revoke(await context.writable(request),p.id,p.shareId);});
 app.get('/api/v1/public/shares/view',{schema:{querystring:{type:'object',properties:{},additionalProperties:false}}},async(request,reply)=>{
  const authorization=request.headers.authorization;
  if(request.headers.cookie||typeof authorization!=='string'||!/^Bearer sp_share_[A-Za-z0-9_-]{43}$/.test(authorization))throw new ServiceError('SHARE_UNAVAILABLE',404,'分享链接不可用或已到期');
  reply.header('Cache-Control','no-store').header('Referrer-Policy','no-referrer');return context.shares.view(authorization.slice(7));
 });
}

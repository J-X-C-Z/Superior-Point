import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Actor,Database} from '../contracts.js';
import {QuotaService} from '../services/quota-service.js';
export function registerQuotaRoutes(app:FastifyInstance,options:{db:Database;actor:(request:FastifyRequest)=>Promise<Actor>}){
 const service=new QuotaService(options.db);
 app.get('/api/v1/me/storage',async request=>service.own(await options.actor(request)));
 app.get('/api/v1/admin/storage',{schema:{querystring:{type:'object',additionalProperties:false,properties:{q:{type:'string',maxLength:128},limit:{type:'string',pattern:'^[0-9]{1,3}$'},offset:{type:'string',pattern:'^[0-9]{1,16}$'}}}}},async request=>{const q=request.query as {q?:string;limit?:string;offset?:string};return service.admin(await options.actor(request),{q:q.q,limit:q.limit===undefined?undefined:Number(q.limit),offset:q.offset===undefined?undefined:Number(q.offset)});});
 return service;
}

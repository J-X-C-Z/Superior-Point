import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Actor} from '../contracts.js';
import {MetricsService,mcpTools} from './metrics-service.js';
export function registerObservabilityRoutes(app:FastifyInstance,context:{metrics:MetricsService;actor:(request:FastifyRequest)=>Promise<Actor>}){
 app.get('/api/v1/admin/observability/tools',{schema:{querystring:{type:'object',additionalProperties:false,properties:{from:{type:'string',maxLength:64},to:{type:'string',maxLength:64},userId:{type:'string',format:'uuid'},tool:{type:'string',enum:[...mcpTools]},limit:{type:'string',pattern:'^[0-9]{1,3}$'},offset:{type:'string',pattern:'^[0-9]{1,16}$'}}}}},async request=>{
  const q=request.query as {from?:string;to?:string;userId?:string;tool?:string;limit?:string;offset?:string};
  return context.metrics.tools(await context.actor(request),{...q,limit:q.limit===undefined?undefined:Number(q.limit),offset:q.offset===undefined?undefined:Number(q.offset)});
 });
 app.get('/api/v1/admin/observability/resources',async request=>context.metrics.resources(await context.actor(request)));
}

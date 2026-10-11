import type {FastifyInstance,FastifyRequest} from 'fastify';
import {errors,ServiceError,transaction,type Actor,type Database} from './contracts.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
type Metadata={projectId:string;revision:number;deleted:boolean};
/** Revision hints only. Poll committed metadata so writes and streams never share a commit path. */
export function registerProjectEvents(app:FastifyInstance,options:{db:Database;origin:string;actor:(request:FastifyRequest)=>Promise<Actor>;pollMs?:number}) {
 const pollMs=options.pollMs??1000;if(!Number.isSafeInteger(pollMs)||pollMs<20||pollMs>30000)throw Error('Invalid event polling interval');
 const connections=new Map<()=>void,string>();let stopping=false;
 app.addHook('preClose',async()=>{stopping=true;for(const close of connections.keys())close();});
 app.get('/api/v1/projects/:id/events',async(request,reply)=>{
  if(stopping)throw new ServiceError('UNAVAILABLE',503,'服务正在关闭');
  if(request.headers.host!==new URL(options.origin).host||(request.headers.origin!==undefined&&request.headers.origin!==options.origin))throw new ServiceError('INVALID_ORIGIN',403,'请求来源无效');
  if(request.headers.authorization!==undefined)throw errors.forbidden();
  const id=(request.params as {id:string}).id,query=request.query as {accountId?:string};
  if(!uuid.test(id)||typeof query.accountId!=='string'||!uuid.test(query.accountId))throw errors.invalid();
  const cursor=request.headers['last-event-id'];if(cursor!==undefined&&(typeof cursor!=='string'||!/^\d{1,16}$/.test(cursor)||!Number.isSafeInteger(Number(cursor))))throw errors.invalid('修订游标无效');
  const read=async():Promise<Metadata>=>{
   const actor=await options.actor(request);if(actor.source!=='web'||!actor.sessionId)throw errors.forbidden();
   if(actor.id!==query.accountId)throw new ServiceError('ACCOUNT_CHANGED',403,'账号已变化，请重新登录');
   return transaction(options.db,async client=>{
    await client.query("SET LOCAL statement_timeout='2s'");
    if(!(await client.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR SHARE",[actor.id])).rowCount)throw errors.unauthorized();
    if(!(await client.query('SELECT id FROM sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE',[actor.sessionId,actor.id])).rowCount)throw errors.unauthorized();
    const row=(await client.query('SELECT revision,deleted_at FROM projects WHERE id=$1 AND owner_id=$2',[id,actor.id])).rows[0];if(!row)throw errors.missing();
    return {projectId:id,revision:Number(row.revision),deleted:row.deleted_at!==null};
   });
  };
  const initial=await read();if(stopping)throw new ServiceError('UNAVAILABLE',503,'服务正在关闭');
  if(connections.size>=100||[...connections.values()].filter(user=>user===query.accountId).length>=5){reply.header('Retry-After','10');throw new ServiceError('EVENT_LIMIT',429,'实时通知连接过多');}
  let ended=false,timer:NodeJS.Timeout|undefined,last=initial,heartbeat=Date.now();
  const close=()=>{if(ended)return;ended=true;if(timer)clearTimeout(timer);connections.delete(close);reply.raw.end();};
  connections.set(close,query.accountId);reply.raw.once('close',close);
  reply.header('Content-Type','text/event-stream; charset=utf-8').header('Cache-Control','no-store').header('X-Accel-Buffering','no');
  reply.hijack();for(const [key,value] of Object.entries(reply.getHeaders()))if(value!==undefined)reply.raw.setHeader(key,value);reply.raw.flushHeaders();
  const write=(text:string)=>{if(ended)return false;if(!reply.raw.write(text)){close();return false;}return true;};
  const emit=(value:Metadata)=>write(`event: revision\nid: ${value.revision}\ndata: ${JSON.stringify(value)}\n\n`);
  write('retry: 1000\n\n');emit(initial);
  const poll=async()=>{
   if(ended)return;
   try{const next=await read();if(ended)return;if(next.revision!==last.revision||next.deleted!==last.deleted){emit(next);last=next;}else if(Date.now()-heartbeat>=15000){write(': keepalive\n\n');heartbeat=Date.now();}}
   catch(error){if(ended)return;const code=error instanceof ServiceError?error.code:'UNAVAILABLE';const fatal=['UNAUTHENTICATED','FORBIDDEN','NOT_FOUND','ACCOUNT_CHANGED'].includes(code);write(`event: ${fatal?'access-revoked':'unavailable'}\ndata: ${JSON.stringify({code:fatal?code:'UNAVAILABLE'})}\n\n`);close();}
   if(!ended)timer=setTimeout(poll,pollMs);
  };
  if(!ended)timer=setTimeout(poll,pollMs);
 });
}

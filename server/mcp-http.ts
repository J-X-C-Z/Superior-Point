import type {FastifyInstance} from 'fastify';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {registerCloudTools} from '../mcp/cloud-tools.js';
import {errors, ServiceError, type Actor} from './contracts.js';

export type McpAuthenticator = (bearer: string) => Promise<Actor>;
export function registerMcpHttp(app: FastifyInstance, options: {onToolCall?:(call:{actor:Actor;tool:string;durationMs:number;outcome:"success"|"error";errorCode?:string;transport:"streamable-http"})=>Promise<unknown>;origin:string; authenticate:McpAuthenticator;dispatch:(raw:string,method:string,route:string,payload?:unknown)=>Promise<{statusCode:number;json:()=>any}>}) {
 app.route({method:['POST','GET','DELETE'],url:'/mcp',handler:async(request,reply)=>{
  if(request.headers.host!==new URL(options.origin).host || (request.headers.origin!==undefined && request.headers.origin!==options.origin))throw new ServiceError('INVALID_ORIGIN',403,'请求来源无效');
  const challenge=()=>reply.header('WWW-Authenticate',`Bearer resource_metadata="${options.origin}/.well-known/oauth-protected-resource/mcp"`);
  const authorization=request.headers.authorization;
  if(request.headers.cookie || !authorization || !/^Bearer \S+$/.test(authorization)){challenge();throw errors.unauthorized();}
  const raw=authorization.slice(7);
  let actor:Actor;try{actor=await options.authenticate(raw);}catch(error){if(error instanceof ServiceError && error.status===401)challenge();throw error;}
  if(actor.source!=='mcp'){challenge();throw errors.unauthorized();}
  // Stateless requests carry their own credentials; client session IDs never confer authority.
  if(request.headers['mcp-session-id']!==undefined)throw errors.invalid('此端点不使用 MCP 会话 ID');
  if(request.method!=='POST')return reply.header('Allow','POST').code(405).send({error:{code:'METHOD_NOT_ALLOWED',message:'此端点不提供 SSE 会话'}});
  const server=new McpServer({name:'superior-point-cloud',version:'0.1.0'});
  const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  const redact=(value:unknown)=>String(value).split(raw).join('[REDACTED]').replace(/sp_pat_[A-Za-z0-9_-]+/g,'[REDACTED]').replace(/Bearer\s+[^\s"\\]+/gi,'Bearer [REDACTED]');
  registerCloudTools(server,{redact,onToolCall:call=>options.onToolCall?.({...call,actor,transport:'streamable-http'})??Promise.resolve(),request:async(method:string,route:string,payload?:unknown)=>{
   // Dispatch through the existing validated API: every operation rechecks the bearer and business ACL.
   const response=await options.dispatch(raw,method,route,payload);
   const result=response.json();
   if(response.statusCode>=400)throw new ServiceError(result.error?.code??'API_ERROR',response.statusCode,result.error?.message??'请求失败',result.error?.details);
   return result;
  }});
  try {
   await server.connect(transport);
   const headers=new Headers();for(const [key,value] of Object.entries(request.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(','):value);
   const incoming=new Request(options.origin+'/mcp',{method:'POST',headers,body:JSON.stringify(request.body)});
   const response=await transport.handleRequest(incoming,{parsedBody:request.body});
   response.headers.forEach((value,key)=>reply.header(key,value));
   return reply.code(response.status).send(await response.text());
  } finally {await server.close();}
 }});
}

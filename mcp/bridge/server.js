#!/usr/bin/env node
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {realpath, lstat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {FileStore} from '../file-store.js';
import {registerCloudTools} from '../cloud-tools.js';

const fail=(code,message,details)=>Object.assign(new Error(message),{code,details});

/** No local project authority: FileStore is used only for bounded file reads and atomic exports. */
export async function createsBridgeServer({apiUrl,token,root,allowHttp=false}) {
 let base;try {base=new URL(apiUrl);}catch {throw fail('INVALID_API_URL','An explicit HTTPS API URL is required');}
 if(base.username||base.password||base.search||base.hash||base.pathname!=='/'||!(base.protocol==='https:'||(allowHttp&&base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname))))throw fail('INVALID_API_URL','Use an HTTPS origin, or explicitly enabled loopback HTTP');
 if(typeof token!=='string'||!token||/[\r\n]/.test(token))throw fail('TOKEN_REQUIRED','SP_API_TOKEN is required');
 let files;
 if(root){
  const requested=path.resolve(root);
  if((await lstat(requested)).isSymbolicLink()||await realpath(requested)!==requested)throw fail('OUT_OF_SCOPE','Authorized root must be a real directory without symlink components');
  files=await new FileStore(requested).init();
 }
 const redact=value=>String(value).split(token).join('[REDACTED]').replace(/sp_pat_[A-Za-z0-9_-]+/g,'[REDACTED]').replace(/Bearer\s+[^\s"\\]+/gi,'Bearer [REDACTED]');
 const request=async(method,route,payload,{retry=false}={})=>{
  const body=payload===undefined?undefined:JSON.stringify(payload);
  for(let attempt=0;;attempt++){
   let response;
   try {response=await fetch(new URL('/api/v1'+route,base),{method,headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},body,redirect:'error',signal:AbortSignal.timeout(15000)});}
   catch {if(retry&&attempt===0)continue;throw fail('API_UNAVAILABLE','API response was not confirmed; retry the same mutation ID and payload');}
   let result;try {result=await response.json();}catch {if(retry&&attempt===0)continue;throw fail('INVALID_API_RESPONSE','API returned an invalid JSON response');}
   if(response.ok)return result;
   if(retry&&response.status>=500&&attempt===0)continue;
   const error=result?.error;
   throw fail(typeof error?.code==='string'?redact(error.code):'API_ERROR',redact(error?.message??'API request failed'),{status:response.status,...(Number.isSafeInteger(error?.details?.actualRevision)?{actualRevision:error.details.actualRevision}:{})});
  }
 };
 const server=new McpServer({name:'superior-point-cloud-bridge',version:'0.1.0'});
 registerCloudTools(server,{request,files,redact});
 return server;
}
export const createBridgeServer=createsBridgeServer;
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const pos=process.argv.indexOf('--root');
 try {if(pos>=0&&!process.argv[pos+1])throw fail('ROOT_REQUIRED','--root requires a directory');const server=await createsBridgeServer({apiUrl:process.env.SP_API_URL,token:process.env.SP_API_TOKEN,root:pos>=0?process.argv[pos+1]:process.env.SP_BRIDGE_ROOT,allowHttp:process.env.SP_BRIDGE_ALLOW_HTTP==='1'});await server.connect(new StdioServerTransport());}
 catch {console.error('Bridge startup failed. Check HTTPS SP_API_URL, environment SP_API_TOKEN, and the authorized root.');process.exitCode=1;}
}

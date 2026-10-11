#!/usr/bin/env node
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {realpath, lstat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {FileStore} from '../file-store.js';
import {readImportFile} from '../../io/project-import.js';

const id=z.string().min(1).max(128), rev=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const fail=(code,message,details)=>Object.assign(new Error(message),{code,details});
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);

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
 const project=value=>'/projects/'+encodeURIComponent(value);
 const pending=new Map();
 const server=new McpServer({name:'superior-point-cloud-bridge',version:'0.1.0'});
 const register=(name,description,inputSchema,fn)=>server.registerTool(name,{description,inputSchema},async args=>{
  try {const result=await fn(args);return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:{result}};}
  catch(error){return {isError:true,content:[{type:'text',text:redact(JSON.stringify({error:{code:error.code??'BRIDGE_ERROR',message:error.message??'Bridge request failed',...(error.details?{details:error.details}:{})}}))}]};}
 });
 const fileStore=()=>{if(!files)throw fail('ROOT_REQUIRED','File import/export requires an explicit SP_BRIDGE_ROOT');return files;};
 register('sp_create_project','Create a cloud project with a new canonical server ID.',{projectId:id.optional(),title:z.string().max(500).optional(),canvas:z.object({width:z.number().positive(),height:z.number().positive()}).optional()},async({projectId,...options})=>{
  const document=await request('POST','/projects',options);return projectId?{...document,sourceProjectId:projectId}:document;
 });
 register('sp_open_project','Open a cloud project or safely import editable HTML into a new cloud ID.',{projectId:id.optional(),filename:id.optional(),clientMutationId:id.optional()},async args=>{
  if(Boolean(args.projectId)===Boolean(args.filename))throw fail('INVALID_REQUEST','Provide exactly projectId or filename');
  if(args.projectId)return request('GET',project(args.projectId)+'/document');
  if(!args.filename.endsWith('.html'))throw fail('INVALID_FILENAME','Only editable HTML import is supported');
  const html=await fileStore().readFile(args.filename);
  const {document}=await readImportFile({name:args.filename,size:Buffer.byteLength(html),text:async()=>html});
  const key='import:'+stable({filename:args.filename,document,clientMutationId:args.clientMutationId});
  const payload=pending.get(key)??{document,clientMutationId:args.clientMutationId??randomUUID()};pending.set(key,payload);
  try {const result=await request('POST','/projects/import',payload,{retry:true});pending.delete(key);return result;}
  catch(error){error.details={...error.details,clientMutationId:payload.clientMutationId};throw error;}
 });
 register('sp_get_document','Read the authoritative cloud document or revision summary.',{projectId:id,full:z.boolean().optional()},async args=>{
  const d=await request('GET',project(args.projectId)+'/document');return args.full?d:{id:d.id,title:d.title,revision:d.revision,canvas:d.canvas,slides:d.slides.map(s=>({id:s.id,elementCount:s.elements.length})),assetCount:d.assets.length};
 });
 register('sp_get_slide','Read canonical slide elements from the cloud service.',{projectId:id,slideId:id},args=>request('GET',project(args.projectId)+'/slides/'+encodeURIComponent(args.slideId)));
 register('sp_edit','Atomically apply revision-CAS operations alongside browser editing; full content replacement requires an exclusive lease. Retry uncertain writes with the same mutation ID.',{projectId:id,expectedRevision:rev,operations:z.array(z.record(z.unknown())).min(1).max(1000),clientMutationId:id.optional()},async args=>{
  const fingerprint=stable({expectedRevision:args.expectedRevision,operations:args.operations});
  const key=args.projectId+':'+(args.clientMutationId??fingerprint);
  let entry=pending.get(key);
  if(entry&&entry.fingerprint!==fingerprint)throw fail('MUTATION_ID_REUSED','Mutation ID already used with a different payload');
  if(!entry){const lease=args.operations.some(op=>op.type==='replaceContent')?await request('POST',project(args.projectId)+'/lease',{holder:'mcp-bridge'}):null;entry={fingerprint,payload:{expectedRevision:args.expectedRevision,operations:args.operations,clientMutationId:args.clientMutationId??randomUUID(),...(lease?{leaseToken:lease.leaseToken}:{})}};pending.set(key,entry);}
  try {
   const result=await request('PATCH',project(args.projectId)+'/document',entry.payload,{retry:true});
   if(!args.clientMutationId)pending.delete(key);return result;
  }catch(error){error.details={...error.details,clientMutationId:entry.payload.clientMutationId};throw error;}
  finally {if(entry.payload.leaseToken)try {await request('DELETE',project(args.projectId)+'/lease',{leaseToken:entry.payload.leaseToken});}catch { /* The server lease expires; never replace an uncertain write's identity. */ }}
 });
 register('sp_render_slide','Request the server sanitized static SVG preview.',{projectId:id,slideId:id},args=>request('GET',project(args.projectId)+'/slides/'+encodeURIComponent(args.slideId)+'/render'));
 register('sp_validate','Validate the saved server document.',{projectId:id},args=>request('GET',project(args.projectId)+'/validate'));
 register('sp_save_export','Save the server export of an exact revision atomically inside the authorized root.',{projectId:id,expectedRevision:rev,filename:id,format:z.enum(['editable-html','audience-html']).default('editable-html')},async args=>{
  const store=fileStore();store.name(args.filename);
  if(!args.filename.endsWith('.html'))throw fail('INVALID_FILENAME','Export filename must end with .html');
  const result=await request('POST',project(args.projectId)+'/exports',{expectedRevision:args.expectedRevision,format:args.format});
  if(typeof result.html!=='string'||result.revision!==args.expectedRevision)throw fail('INVALID_API_RESPONSE','Server export revision or HTML is invalid');
  await store.atomic(args.filename,result.html);return {projectId:args.projectId,revision:result.revision,filename:args.filename,format:args.format,bytes:Buffer.byteLength(result.html)};
 });
 const themeRoute=args=>args.themeId.startsWith('sp-')?'/themes/builtin/'+encodeURIComponent(args.themeId):'/themes/'+encodeURIComponent(args.themeId)+(args.version?'/versions/'+encodeURIComponent(args.version):'');
 register('sp_list_themes','List read-only built-ins and the current user private cloud themes.',{archived:z.boolean().optional()},async args=>{const [builtins,privateThemes]=await Promise.all([request('GET','/themes/builtins'),request('GET','/themes'+(args.archived?'?archived=true':''))]);return [...builtins,...privateThemes];});
 register('sp_get_theme','Read an authorized fixed theme package and its verified hash.',{themeId:id,version:id.optional()},async args=>{const value=await request('GET',themeRoute(args));const ref=value.ref??value;if(args.version&&ref.version!==args.version)throw fail('NOT_FOUND','Theme version does not exist');return ref;});
 const themeReference={themeId:id,version:id,hash:z.string().regex(/^sha256:[a-f0-9]{64}$/)};
 register('sp_preview_theme','Render four fixed safe samples as static SVG with compatibility limits, without reading user project content.',{...themeReference,ratio:z.enum(['16:9','4:3']).optional()},args=>request('POST','/themes/preview',args));
 const themeMutation=async(route,args)=>{
  const fingerprint=stable(args),key='theme:'+route+':'+(args.clientMutationId??fingerprint);let entry=pending.get(key);
  if(entry&&entry.fingerprint!==fingerprint)throw fail('MUTATION_ID_REUSED','Mutation ID already used with a different payload');
  if(!entry){entry={fingerprint,payload:{...args,clientMutationId:args.clientMutationId??randomUUID()}};pending.set(key,entry);}
  try{const result=await request('POST',route,entry.payload,{retry:true});if(!args.clientMutationId)pending.delete(key);return result;}catch(error){error.details={...error.details,clientMutationId:entry.payload.clientMutationId};throw error;}
 };
 register('sp_apply_theme','Apply a fixed theme atomically with project CAS. Preserve manual styles by default; reset requires explicit caller confirmation.',{projectId:id,expectedRevision:rev,...themeReference,mode:z.enum(['preserve','reset']).default('preserve'),clientMutationId:id.optional()},({projectId,...args})=>themeMutation(project(projectId)+'/theme',args));
 register('sp_save_theme','Safely import a new private theme, or publish a new immutable version of an owned theme.',{theme:z.record(z.unknown()),themeId:id.optional(),expectedRevision:rev.optional(),clientMutationId:id.optional()},args=>{
  if(args.themeId){if(args.expectedRevision===undefined)throw fail('INVALID_REQUEST','Publishing requires expectedRevision');return themeMutation('/themes/'+encodeURIComponent(args.themeId)+'/publish',{theme:args.theme,expectedRevision:args.expectedRevision,clientMutationId:args.clientMutationId});}
  if(args.expectedRevision!==undefined)throw fail('INVALID_REQUEST','expectedRevision requires themeId');return themeMutation('/themes/import',{theme:args.theme,clientMutationId:args.clientMutationId});
 });
 register('sp_list_projects','List authorized cloud projects.',{trash:z.boolean().optional()},args=>request('GET','/projects'+(args.trash?'?trash=true':'')));
 register('sp_project_info','Read authoritative project metadata and slide counts.',{projectId:id},async args=>{const d=await request('GET',project(args.projectId));return {id:d.id,title:d.title,revision:d.revision,canvas:d.canvas,metadata:d.metadata,slideCount:d.slides.length,assetCount:d.assets.length};});
 register('sp_list_slides','List slides from the authoritative cloud document.',{projectId:id},async args=>{const d=await request('GET',project(args.projectId)+'/document');return {projectId:d.id,revision:d.revision,slides:d.slides.map(s=>({id:s.id,title:s.title,hidden:s.hidden,elementCount:s.elements.length}))};});
 return server;
}
export const createBridgeServer=createsBridgeServer;
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const pos=process.argv.indexOf('--root');
 try {if(pos>=0&&!process.argv[pos+1])throw fail('ROOT_REQUIRED','--root requires a directory');const server=await createsBridgeServer({apiUrl:process.env.SP_API_URL,token:process.env.SP_API_TOKEN,root:pos>=0?process.argv[pos+1]:process.env.SP_BRIDGE_ROOT,allowHttp:process.env.SP_BRIDGE_ALLOW_HTTP==='1'});await server.connect(new StdioServerTransport());}
 catch {console.error('Bridge startup failed. Check HTTPS SP_API_URL, environment SP_API_TOKEN, and the authorized root.');process.exitCode=1;}
}

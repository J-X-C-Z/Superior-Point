import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {readImportFile} from '../io/project-import.js';

const id=z.string().min(1).max(128), rev=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const fail=(code,message,details)=>Object.assign(new Error(message),{code,details});
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);

export function registerCloudTools(server,{request,files,redact=value=>String(value),onToolCall}) {
 const project=value=>'/projects/'+encodeURIComponent(value);
 const pending=new Map();
 const register=(name,description,inputSchema,fn)=>server.registerTool(name,{description,inputSchema},async args=>{
  const started=performance.now();let outcome='success',errorCode;
  try {const result=await fn(args);return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:{result}};}
  catch(error){outcome='error';errorCode=error.code??'BRIDGE_ERROR';return {isError:true,content:[{type:'text',text:redact(JSON.stringify({error:{code:error.code??'BRIDGE_ERROR',message:error.message??'Bridge request failed',...(error.details?{details:error.details}:{})}}))}]};}
  finally {try {Promise.resolve(onToolCall?.({tool:name,durationMs:performance.now()-started,outcome,errorCode})).catch(()=>{});}catch { /* Telemetry cannot change a completed tool result. */ }}
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
 register('sp_list_revisions','List authorized immutable cloud revision metadata, newest first.',{projectId:id},args=>request('GET',project(args.projectId)+'/revisions'));
 register('sp_get_revision','Read an authorized immutable historical document without changing the current project.',{projectId:id,revision:rev},args=>request('GET',project(args.projectId)+'/revisions/'+args.revision));
 register('sp_revision_diff','Compare two authorized saved revisions with structured slide/object, theme and asset diagnostics.',{projectId:id,fromRevision:rev,toRevision:rev},args=>request('GET',project(args.projectId)+'/revision-diff?from='+args.fromRevision+'&to='+args.toRevision));
 register('sp_restore_revision','Restore an earlier revision as a new CAS revision under an exclusive lease. Requires an explicit stable mutation ID; preserves history and never steals browser editing authority.',{projectId:id,revision:rev,expectedRevision:rev,clientMutationId:id},async({projectId,...payload})=>{
  const route=project(projectId)+'/restore-revision';
  // Existing receipts resolve before lease validation, including retries after a Bridge restart.
  try{return await request('POST',route,payload,{retry:true});}catch(error){if(error.code!=='LOCK_LOST')throw error;}
  const lease=await request('POST',project(projectId)+'/lease',{holder:'mcp-history-restore'});
  try{return await request('POST',route,{...payload,leaseToken:lease.leaseToken},{retry:true});}
  finally{try{await request('DELETE',project(projectId)+'/lease',{leaseToken:lease.leaseToken});}catch{ /* An uncertain outcome keeps the same mutation ID; the lease expires. */ }}
 });

}

import {quotaBefore,enforceStorageQuota} from './quota-service.js';
import {createHash,randomUUID} from 'node:crypto';
import {createThemeRef} from '../../core/theme-schema.js';
import type {ThemeRef} from '../../core/theme-schema.js';
import {listBuiltinThemes,getBuiltinTheme} from '../../core/builtin-themes.js';
import {createThemePreviewDocument} from '../../core/theme-preview.js';
import {renderSlideSVG,inspectRenderCompatibility} from '../../io/html.js';
import {CoreError} from '../../core/document-core.js';
import {errors,requireScope,ServiceError,transaction,type Actor,type Database,type Transaction} from '../contracts.js';
import {checkTokenActor} from '../auth/token-service.js';

type Mutation={expectedRevision:number;clientMutationId:string};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const conflict=(code:string,message:string)=>new ServiceError(code,409,message);
const stable=(v:any):string=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const digest=(v:unknown)=>createHash('sha256').update(stable(v)).digest('hex');
function mutationId(id:string){if(typeof id!=='string'||!id.trim()||id.length>128)throw errors.invalid();}
async function validated(raw:unknown):Promise<ThemeRef>{try{return await createThemeRef(raw);}catch(e){if(e instanceof CoreError||e instanceof SyntaxError)throw errors.invalid('主题包或资源无效');throw e;}}
const columns=`t.id,t.name,t.current_version AS version,t.revision,t.source_jsonb AS source,t.archived,t.deleted_at AS "deletedAt",t.updated_at AS "updatedAt",v.hash,EXISTS(SELECT 1 FROM theme_favorites f WHERE f.theme_id=t.id AND f.user_id=t.owner_id) AS favorite`;
function metadata(row:any){const {snapshot_jsonb,...result}=row;return {...result,revision:Number(row.revision),updatedAt:row.updatedAt instanceof Date?row.updatedAt.toISOString():row.updatedAt,deletedAt:row.deletedAt instanceof Date?row.deletedAt.toISOString():row.deletedAt};}
function detail(row:any){return {...metadata(row),ref:{id:row.id,version:row.version,hash:row.hash,snapshot:row.snapshot_jsonb} as ThemeRef};}
/** Private packages and immutable published snapshots share transaction-time actor checks. */
export class ThemeService{
 constructor(private db:Database){}
 private async active(c:Transaction,a:Actor){
  if(!(await c.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR SHARE",[a.id])).rowCount)throw errors.unauthorized();
  if(a.source==='mcp')await checkTokenActor(c,a);
  if(a.sessionId!==undefined){if(!uuid.test(a.sessionId)||!(await c.query('SELECT id FROM sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE',[a.sessionId,a.id])).rowCount)throw errors.unauthorized();}
 }
 private async owned(c:Transaction,a:Actor,id:string,lock=false){
  if(!uuid.test(id))throw errors.missing();
  const r=await c.query(`SELECT ${columns},v.snapshot_jsonb FROM themes t JOIN theme_versions v ON v.theme_id=t.id AND v.version=t.current_version WHERE t.id=$1 AND t.owner_id=$2${lock?' FOR UPDATE OF t':''}`,[id,a.id]);
  if(!r.rowCount)throw errors.missing();return r.rows[0];
 }
 private audit(c:Transaction,a:Actor,id:string,action:string){return c.query("INSERT INTO audit_logs(actor_id,action,resource_type,resource_id,outcome) VALUES($1,$2,'theme',$3,'success')",[a.id,action,id]);}
 async list(a:Actor,{archived=false,trash=false}:{archived?:boolean;trash?:boolean}={}){
  requireScope(a,'themes:read');return transaction(this.db,async c=>{await this.active(c,a);return (await c.query(`SELECT ${columns} FROM themes t JOIN theme_versions v ON v.theme_id=t.id AND v.version=t.current_version WHERE t.owner_id=$1 AND t.archived=$2 AND (t.deleted_at IS NOT NULL)=$3 ORDER BY t.updated_at DESC,t.id`,[a.id,archived,trash])).rows.map(metadata);});
 }
 async get(a:Actor,id:string){requireScope(a,'themes:read');return transaction(this.db,async c=>{await this.active(c,a);const r=await this.owned(c,a,id);if(r.deletedAt)throw errors.missing();return detail(r);});}
 async getVersion(a:Actor,id:string,version:string){requireScope(a,'themes:read');return transaction(this.db,async c=>{await this.active(c,a);const r=await this.owned(c,a,id);if(r.deletedAt)throw errors.missing();const v=(await c.query('SELECT hash,snapshot_jsonb FROM theme_versions WHERE theme_id=$1 AND version=$2',[id,version])).rows[0];if(!v)throw errors.missing();return {id,version,hash:v.hash,snapshot:v.snapshot_jsonb} as ThemeRef;});}
 async builtins(a:Actor){requireScope(a,'themes:read');return transaction(this.db,async c=>{await this.active(c,a);return Promise.all(listBuiltinThemes().map(async theme=>{const ref=await validated(theme);return {id:ref.id,name:theme.name,version:ref.version,hash:ref.hash,builtin:true,tags:theme.tags,supportedRatios:theme.supportedRatios};}));});}
 async builtin(a:Actor,id:string){requireScope(a,'themes:read');return transaction(this.db,async c=>{await this.active(c,a);const theme=getBuiltinTheme(id);if(!theme)throw errors.missing();return {id,name:theme.name,builtin:true,ref:await validated(theme)};});}
 async resolveRef(c:Transaction,a:Actor,input:{themeId:string;version:string;hash:string}):Promise<ThemeRef>{
  requireScope(a,'themes:read');await this.active(c,a);const builtin=getBuiltinTheme(input.themeId);let ref:ThemeRef;
  if(builtin){ref=await validated(builtin);if(ref.version!==input.version)throw errors.missing();}
  else {const row=await this.owned(c,a,input.themeId);if(row.deletedAt)throw errors.missing();const v=(await c.query('SELECT snapshot_jsonb FROM theme_versions WHERE theme_id=$1 AND version=$2',[input.themeId,input.version])).rows[0];if(!v)throw errors.missing();ref=await validated(v.snapshot_jsonb);}
  if(ref.hash!==input.hash)throw conflict('THEME_HASH_MISMATCH','主题哈希与固定版本不一致');return ref;
 }
 async preview(a:Actor,input:{themeId:string;version:string;hash:string;ratio?:'16:9'|'4:3'}){
  requireScope(a,'themes:read');return transaction(this.db,async c=>{const ref=await this.resolveRef(c,a,input);if(!ref.snapshot.supportedRatios.includes(input.ratio??'16:9'))throw errors.invalid('主题不支持此画布比例');const doc=await createThemePreviewDocument(ref.snapshot,{ratio:input.ratio});return {ref:{id:ref.id,version:ref.version,hash:ref.hash},slides:doc.slides.map(slide=>({id:slide.id,title:slide.title,mimeType:'image/svg+xml',svg:renderSlideSVG(doc,slide.id)})),renderCompatibility:inspectRenderCompatibility(doc),limitations:(doc.extensions.themePreview as any).limitations};});
 }
 async importTheme(a:Actor,{theme,clientMutationId}:{theme:unknown;clientMutationId:string}){
  requireScope(a,'themes:write');mutationId(clientMutationId);const original=await validated(theme);const hash=digest({action:'import',ref:original});
  return transaction(this.db,async c=>{await this.active(c,a);const quota=await quotaBefore(c,a.id);await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['sp-theme:'+a.id+':'+clientMutationId]);
   const receipt=(await c.query('SELECT request_hash,theme_id,result_jsonb FROM theme_receipts WHERE actor_id=$1 AND client_mutation_id=$2',[a.id,clientMutationId])).rows[0];
   if(receipt){if(receipt.request_hash!==hash)throw conflict('MUTATION_ID_REUSED','变更 ID 已用于其他请求');await this.owned(c,a,receipt.theme_id);return receipt.result_jsonb;}
   const id=randomUUID(),ref=await validated({...original.snapshot,id});const source={id:original.id,version:original.version,hash:original.hash};
   await c.query('INSERT INTO themes(id,owner_id,name,current_version,source_jsonb) VALUES($1,$2,$3,$4,$5)',[id,a.id,ref.snapshot.name,ref.version,JSON.stringify(source)]);
   await c.query('INSERT INTO theme_versions(theme_id,version,hash,snapshot_jsonb) VALUES($1,$2,$3,$4)',[id,ref.version,ref.hash,JSON.stringify(ref.snapshot)]);
   await this.audit(c,a,id,'theme.import');const result=detail(await this.owned(c,a,id));await c.query('INSERT INTO theme_receipts(actor_id,client_mutation_id,request_hash,theme_id,result_jsonb) VALUES($1,$2,$3,$4,$5)',[a.id,clientMutationId,hash,id,JSON.stringify(result)]);await enforceStorageQuota(c,a.id,quota);return result;
  });
 }
 create(a:Actor,input:{theme:unknown;clientMutationId:string}){return this.importTheme(a,input);}
 private async mutate(a:Actor,id:string,request:Mutation,action:string,payload:unknown,change:(c:Transaction,row:any)=>Promise<void>){
  requireScope(a,action==='publish'?'themes:publish':'themes:write');mutationId(request.clientMutationId);if(!Number.isSafeInteger(request.expectedRevision)||request.expectedRevision<0)throw errors.invalid();const hash=digest({id,action,expectedRevision:request.expectedRevision,payload});
  return transaction(this.db,async c=>{await this.active(c,a);const quota=await quotaBefore(c,a.id);await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['sp-theme:'+a.id+':'+request.clientMutationId]);const row=await this.owned(c,a,id,true);
   const receipt=(await c.query('SELECT request_hash,result_jsonb FROM theme_receipts WHERE actor_id=$1 AND client_mutation_id=$2',[a.id,request.clientMutationId])).rows[0];if(receipt){if(receipt.request_hash!==hash)throw conflict('MUTATION_ID_REUSED','变更 ID 已用于其他请求');return receipt.result_jsonb;}
   if(row.deletedAt)throw errors.missing();if(Number(row.revision)!==request.expectedRevision)throw conflict('REVISION_CONFLICT','主题已有更新');await change(c,row);
   await c.query('UPDATE themes SET revision=revision+1,updated_at=clock_timestamp() WHERE id=$1',[id]);await this.audit(c,a,id,'theme.'+action);const result=detail(await this.owned(c,a,id));await c.query('INSERT INTO theme_receipts(actor_id,client_mutation_id,request_hash,theme_id,result_jsonb) VALUES($1,$2,$3,$4,$5)',[a.id,request.clientMutationId,hash,id,JSON.stringify(result)]);const patch=payload as {name?:string|null;archived?:boolean|null};const shrinking=action==='patch'&&typeof patch.name==='string'&&Buffer.byteLength(patch.name.trim())<Buffer.byteLength(row.name);const archive=action==='patch'&&patch.archived===true&&(patch.name===null||patch.name===undefined||Buffer.byteLength(patch.name.trim())<=Buffer.byteLength(row.name));await enforceStorageQuota(c,a.id,quota,action==='delete'||shrinking||archive);return result;
  });
 }
 async publish(a:Actor,id:string,request:Mutation&{theme:unknown}){const ref=await validated(request.theme);if(ref.id!==id)throw errors.invalid('主题身份不一致');return this.mutate(a,id,request,'publish',ref,async c=>{if((await c.query('SELECT 1 FROM theme_versions WHERE theme_id=$1 AND version=$2',[id,ref.version])).rowCount)throw conflict('THEME_VERSION_EXISTS','版本已发布，不能覆盖');await c.query('INSERT INTO theme_versions(theme_id,version,hash,snapshot_jsonb) VALUES($1,$2,$3,$4)',[id,ref.version,ref.hash,JSON.stringify(ref.snapshot)]);await c.query('UPDATE themes SET current_version=$2,name=$3 WHERE id=$1',[id,ref.version,ref.snapshot.name]);});}
 patch(a:Actor,id:string,request:Mutation&{name?:string;archived?:boolean}){if((request.name===undefined&&request.archived===undefined)||(request.name!==undefined&&(typeof request.name!=='string'||!request.name.trim()||request.name.length>200))||(request.archived!==undefined&&typeof request.archived!=='boolean'))throw errors.invalid();return this.mutate(a,id,request,'patch',{name:request.name??null,archived:request.archived??null},async c=>{await c.query('UPDATE themes SET name=COALESCE($2,name),archived=COALESCE($3,archived) WHERE id=$1',[id,request.name?.trim()??null,request.archived??null]);});}
 remove(a:Actor,id:string,request:Mutation){return this.mutate(a,id,request,'delete',{},async c=>{await c.query('UPDATE themes SET deleted_at=clock_timestamp() WHERE id=$1',[id]);});}
 async favorite(a:Actor,id:string,value:boolean){requireScope(a,'themes:write');return transaction(this.db,async c=>{await this.active(c,a);const row=await this.owned(c,a,id,true);if(row.deletedAt)throw errors.missing();if(value)await c.query('INSERT INTO theme_favorites(theme_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,a.id]);else await c.query('DELETE FROM theme_favorites WHERE theme_id=$1 AND user_id=$2',[id,a.id]);await this.audit(c,a,id,value?'theme.favorite':'theme.unfavorite');return detail(await this.owned(c,a,id));});}
}

import {errors,ServiceError,transaction,type Actor,type Database,type Transaction} from '../contracts.js';
import {checkAdminActor,pagination} from './admin-service.js';
import {defaultStorageQuota,validStorageQuota,type StorageQuota} from './quota-settings.js';
export {defaultStorageQuota,validStorageQuota} from './quota-settings.js';
async function limits(client:Transaction):Promise<StorageQuota>{const value=(await client.query("SELECT value FROM system_settings WHERE key='storageQuota'")).rows[0]?.value;return validStorageQuota(value)?value:defaultStorageQuota;}
export async function lockStorageQuota(client:Transaction,ids:string[]){for(const id of [...new Set(ids)].sort())await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['sp-storage-quota:'+id]);}
export async function storageUsage(client:Transaction,userId:string){
 const r=(await client.query(`SELECT
 (SELECT count(*) FROM projects WHERE owner_id=$1 AND deleted_at IS NULL)::text AS "activeProjects",
 (SELECT count(*) FROM projects WHERE owner_id=$1 AND deleted_at IS NOT NULL)::text AS "trashedProjects",
 (SELECT COALESCE(sum(pg_column_size(document_jsonb)),0) FROM projects WHERE owner_id=$1)::text AS "projectBytes",
 (SELECT COALESCE(sum(pg_column_size(r.document_jsonb)),0) FROM project_revisions r JOIN projects p ON p.id=r.project_id WHERE p.owner_id=$1)::text AS "historyBytes",
 (SELECT COALESCE(sum(pg_column_size(source_jsonb)),0) FROM themes WHERE owner_id=$1)::text AS "themeMetadataBytes",
 (SELECT COALESCE(sum(pg_column_size(v.snapshot_jsonb)),0) FROM theme_versions v JOIN themes t ON t.id=v.theme_id WHERE t.owner_id=$1)::text AS "themeVersionBytes",
 ((SELECT COALESCE(sum(pg_column_size(r.result_jsonb)),0) FROM mutation_receipts r JOIN projects p ON p.id=r.project_id WHERE p.owner_id=$1)+(SELECT COALESCE(sum(pg_column_size(r.result_jsonb)),0) FROM import_receipts r JOIN projects p ON p.id=r.project_id WHERE p.owner_id=$1)+(SELECT COALESCE(sum(pg_column_size(r.result_jsonb)),0) FROM theme_receipts r JOIN themes t ON t.id=r.theme_id WHERE t.owner_id=$1))::text AS "receiptBytes"`,[userId])).rows[0];
 const shareTable=(await client.query("SELECT to_regclass(current_schema()||'.project_shares') AS name")).rows[0].name;const shareBytes=shareTable?Number((await client.query('SELECT COALESCE(sum(octet_length(html)),0)::text AS bytes FROM project_shares WHERE owner_id=$1',[userId])).rows[0].bytes):0;
 const usage={shareBytes,activeProjects:Number(r.activeProjects),trashedProjects:Number(r.trashedProjects),projectBytes:Number(r.projectBytes),historyBytes:Number(r.historyBytes),themeMetadataBytes:Number(r.themeMetadataBytes),themeVersionBytes:Number(r.themeVersionBytes),receiptBytes:Number(r.receiptBytes)};
 return {...usage,totalBytes:usage.shareBytes+usage.projectBytes+usage.historyBytes+usage.themeMetadataBytes+usage.themeVersionBytes+usage.receiptBytes};
}
export async function quotaBefore(client:Transaction,userId:string){await lockStorageQuota(client,[userId]);return {usage:await storageUsage(client,userId),limits:await limits(client)};}
export async function enforceStorageQuota(client:Transaction,userId:string,before:Awaited<ReturnType<typeof quotaBefore>>,recovery=false){
 const usage=await storageUsage(client,userId),q=before.limits;
 if(usage.activeProjects>q.maxProjects&&usage.activeProjects>before.usage.activeProjects||!recovery&&usage.totalBytes>q.maxBytes&&usage.totalBytes>before.usage.totalBytes)throw new ServiceError('QUOTA_EXCEEDED',409,'存储额度不足；当前资料和历史保留，可读取、回收或缩小文稿。',{usage,limits:q,physicalDiskLimit:false});
}
export function projectContentBytes(document:any){const value={...document,metadata:{...document.metadata}};delete value.revision;delete value.metadata.updatedAt;return Buffer.byteLength(JSON.stringify(value));}
function result(userId:string,usage:Awaited<ReturnType<typeof storageUsage>>,quota:StorageQuota){return {userId,usage,limits:quota,warning:usage.activeProjects>=quota.maxProjects*quota.warningPercent/100||usage.totalBytes>=quota.maxBytes*quota.warningPercent/100,overQuota:usage.activeProjects>quota.maxProjects||usage.totalBytes>quota.maxBytes,scope:'retained-jsonb',physicalDiskLimit:false};}
export class QuotaService {
 constructor(private readonly db:Database){}
 async own(actor:Actor){return transaction(this.db,async client=>{
  if(actor.source!=='web'||!actor.sessionId)throw errors.forbidden();
  if(!(await client.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR SHARE",[actor.id])).rowCount||!(await client.query('SELECT id FROM sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE',[actor.sessionId,actor.id])).rowCount)throw errors.unauthorized();
  return result(actor.id,await storageUsage(client,actor.id),await limits(client));
 });}
 async admin(actor:Actor,filter:{limit?:number;offset?:number;q?:string}={}){const {limit,offset}=pagination(filter);if(filter.q!==undefined&&(typeof filter.q!=='string'||filter.q.length>128))throw errors.invalid();const q=filter.q?.trim()||null;return transaction(this.db,async client=>{
  await checkAdminActor(client,actor);const quota=await limits(client);const values=[q===null?null:'%'+q.replace(/[\\%_]/g,'\\$&')+'%'];const where="deleted_at IS NULL AND ($1::text IS NULL OR username ILIKE $1 ESCAPE '\\')";
  const total=Number((await client.query(`SELECT count(*) AS total FROM users WHERE ${where}`,values)).rows[0].total);const users=(await client.query(`SELECT id,username FROM users WHERE ${where} ORDER BY username,id LIMIT $2 OFFSET $3`,[...values,limit,offset])).rows;
  const rows=[];for(const user of users)rows.push({...result(user.id,await storageUsage(client,user.id),quota),username:user.username});return {rows,total,limit,offset};
 });}
}

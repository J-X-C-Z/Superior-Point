import {createHash,randomBytes} from 'node:crypto';
import {errors,ServiceError,transaction,type Actor,type Database,type Transaction} from '../contracts.js';
import {quotaBefore,enforceStorageQuota} from './quota-service.js';
import {exportHTML,inspectRenderCompatibility} from '../../io/html.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
const missing=()=>new ServiceError('SHARE_UNAVAILABLE',404,'分享链接不可用或已到期');
export class ShareService {
 constructor(private readonly db:Database,private readonly options:{origin:string}){}
 private async owner(client:Transaction,actor:Actor,projectId:string,quotaCheck=false){
  if(actor.source!=='web'||!actor.sessionId||!uuid.test(actor.sessionId))throw errors.forbidden();
  if(!uuid.test(projectId))throw errors.missing();
  if(!(await client.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR SHARE",[actor.id])).rowCount)throw errors.unauthorized();
  if(!(await client.query('SELECT id FROM sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE',[actor.sessionId,actor.id])).rowCount)throw errors.unauthorized();
  const quota=quotaCheck?await quotaBefore(client,actor.id):null;
  const project=(await client.query('SELECT id,revision,document_jsonb,deleted_at FROM projects WHERE id=$1 AND owner_id=$2 FOR SHARE',[projectId,actor.id])).rows[0];
  if(!project)throw errors.missing();return {...project,quota};
 }
 async create(actor:Actor,projectId:string,input:{expectedRevision:number;expiresAt?:string}){
  if(!input||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)throw errors.invalid('修订号无效');
  const expiresAt=input.expiresAt===undefined?new Date(Date.now()+7*86400000):new Date(input.expiresAt);
  if(!Number.isFinite(expiresAt.getTime())||expiresAt.getTime()<=Date.now()||expiresAt.getTime()>Date.now()+30*86400000)throw errors.invalid('分享有效期须在未来30天内');
  return transaction(this.db,async client=>{
   const project=await this.owner(client,actor,projectId,true);if(project.deleted_at)throw errors.missing();
   if(Number(project.revision)!==input.expectedRevision)throw new ServiceError('REVISION_CONFLICT',409,'项目已有新修订');
   if(inspectRenderCompatibility(project.document_jsonb).hasKnownGaps)throw new ServiceError('EXPORT_UNSUPPORTED',422,'此文稿需要使用编辑器原渲染器分享');
   let html:string;try{html=await exportHTML(project.document_jsonb,{audience:true});}catch{throw new ServiceError('EXPORT_UNSUPPORTED',422,'此文稿暂不支持安全观众分享');}
   const token='sp_share_'+randomBytes(32).toString('base64url');
   const share=(await client.query('INSERT INTO project_shares(project_id,owner_id,revision,token_hash,title,html,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,project_id AS "projectId",revision,created_at AS "createdAt",expires_at AS "expiresAt"',[projectId,actor.id,input.expectedRevision,digest(token),project.document_jsonb.title,html,expiresAt])).rows[0];
   await enforceStorageQuota(client,actor.id,project.quota);
   await client.query("INSERT INTO audit_logs(actor_id,action,resource_type,resource_id,outcome) VALUES($1,'share.create','share',$2,'success')",[actor.id,share.id]);
   return {...share,revision:Number(share.revision),token,url:this.options.origin+'/share#'+token};
  });
 }
 async list(actor:Actor,projectId:string){
  return transaction(this.db,async client=>{const project=await this.owner(client,actor,projectId);
   return (await client.query(`SELECT s.id,s.project_id AS "projectId",s.title,s.revision,s.created_at AS "createdAt",s.expires_at AS "expiresAt",s.revoked_at AS "revokedAt",(s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND NOT $3::boolean) AS active,
    (SELECT count(*)::int FROM project_share_access a WHERE a.share_id=s.id) AS "accessCount",(SELECT max(created_at) FROM project_share_access a WHERE a.share_id=s.id) AS "lastAccessAt"
    FROM project_shares s WHERE s.project_id=$1 AND s.owner_id=$2 ORDER BY s.created_at DESC,s.id`,[projectId,actor.id,Boolean(project.deleted_at)])).rows.map(row=>({...row,revision:Number(row.revision)}));
  });
 }
 async revoke(actor:Actor,projectId:string,shareId:string){
  if(!uuid.test(shareId))throw errors.missing();
  return transaction(this.db,async client=>{await this.owner(client,actor,projectId);
   if(!(await client.query('UPDATE project_shares SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id=$1 AND project_id=$2 AND owner_id=$3 RETURNING id',[shareId,projectId,actor.id])).rowCount)throw errors.missing();
   await client.query("INSERT INTO audit_logs(actor_id,action,resource_type,resource_id,outcome) VALUES($1,'share.revoke','share',$2,'success')",[actor.id,shareId]);return {success:true};
  });
 }
 async view(token:string){
  if(typeof token!=='string'||!/^sp_share_[A-Za-z0-9_-]{43}$/.test(token))throw missing();
  return transaction(this.db,async client=>{
   const lookup=(await client.query('SELECT id,owner_id,project_id FROM project_shares WHERE token_hash=$1',[digest(token)])).rows[0];if(!lookup)throw missing();
   if(!(await client.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR SHARE",[lookup.owner_id])).rowCount)throw missing();
   if(!(await client.query('SELECT id FROM projects WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR SHARE',[lookup.project_id,lookup.owner_id])).rowCount)throw missing();
   const row=(await client.query('SELECT id,revision,html,title FROM project_shares WHERE id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE',[lookup.id])).rows[0];
   if(!row)throw missing();
   await client.query('INSERT INTO project_share_access(share_id) VALUES($1)',[row.id]);return {title:row.title,revision:Number(row.revision),html:row.html};
  });
 }
}

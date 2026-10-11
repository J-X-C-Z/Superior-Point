import {defaultStorageQuota,validStorageQuota} from './quota-settings.js';
import {errors, requireAdmin, ServiceError, transaction, type Actor, type Database, type Transaction} from '../contracts.js';

export async function checkAdminActor(client: Transaction, actor: Actor, recent = false) {
  requireAdmin(actor);
  if (!actor.sessionId) throw errors.forbidden();
  const user = await client.query("SELECT role FROM users WHERE id=$1 AND status='active' FOR SHARE", [actor.id]);
  if (!user.rowCount) throw errors.unauthorized();
  if (user.rows[0].role !== 'admin') throw errors.forbidden();
  const session = await client.query('SELECT id,reauth_until>clock_timestamp() AS recent FROM sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE', [actor.sessionId, actor.id]);
  if (!session.rowCount) throw errors.unauthorized();
  if (recent && !session.rows[0].recent) throw new ServiceError('REAUTHENTICATION_REQUIRED', 403, '请重新验证密码');
}

export function pagination(options: {limit?: number; offset?: number} = {}) {
  const limit = options.limit ?? 50, offset = options.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) throw errors.invalid('分页参数无效');
  return {limit, offset};
}
type SearchPage={limit?:number;offset?:number;q?:string};
function searchPattern(options:SearchPage){
 if(options.q!==undefined&&(typeof options.q!=='string'||options.q.length>128))throw errors.invalid('搜索内容无效');
 const value=options.q?.trim();return value?'%'+value.replace(/[\\%_]/g,'\\$&')+'%':null;
}
function choice(value:unknown,values:string[]){if(value===undefined)return null;if(typeof value!=='string'||!values.includes(value))throw errors.invalid('筛选参数无效');return value;}
function userFilter(value:unknown){if(value===undefined)return null;if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))throw errors.invalid('用户 ID 无效');return value;}
function dateFilter(value:unknown){if(value===undefined)return null;if(typeof value!=='string'||value.length>64||!Number.isFinite(new Date(value).getTime()))throw errors.invalid('时间筛选无效');return new Date(value).toISOString();}
const defaults = {siteName: 'Superior Point', announcement: '', maxUploadBytes: 32 * 1024 * 1024, publicRegistration: false, maintenanceMode: false, storageQuota:defaultStorageQuota};
function validSetting(key: string, value: unknown) {
  if (key === 'storageQuota') return validStorageQuota(value);
  if (key === 'siteName') return typeof value === 'string' && value.trim().length > 0 && value.length <= 100;
  if (key === 'announcement') return typeof value === 'string' && value.length <= 2000;
  if (key === 'maxUploadBytes') return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 32 * 1024 * 1024;
  if (key === 'publicRegistration') return value === false;
  if (key === 'maintenanceMode') return typeof value === 'boolean';
  return false;
}

export class AdminService {
  constructor(private readonly db: Database) {}

  async dashboard(actor: Actor) {
    return transaction(this.db, async client => {
      await checkAdminActor(client, actor);
      const result = await client.query(`SELECT
        (SELECT count(*)::int FROM users WHERE deleted_at IS NULL) AS users,
        (SELECT count(*)::int FROM users WHERE status='active') AS active_users,
        (SELECT count(*)::int FROM users WHERE status='active' AND role='admin') AS admins,
        (SELECT count(*)::int FROM projects WHERE deleted_at IS NULL) AS projects,
        (SELECT count(*)::int FROM projects WHERE deleted_at IS NOT NULL) AS trash,
        (SELECT count(*)::int FROM api_tokens) AS tokens,
        (SELECT count(*)::int FROM api_tokens t JOIN users u ON u.id=t.user_id WHERE t.revoked_at IS NULL AND t.expires_at>clock_timestamp() AND u.status='active') AS active_tokens,
        (SELECT COALESCE(sum(pg_column_size(document_jsonb)),0)::text FROM projects) AS document_bytes,
        pg_database_size(current_database())::text AS database_bytes`);
      const row = result.rows[0];
      return {users: {total: row.users, active: row.active_users, admins: row.admins}, projects: {active: row.projects, trash: row.trash}, tokens: {total: row.tokens, active: row.active_tokens}, storage: {documentBytes: Number(row.document_bytes), databaseBytes: Number(row.database_bytes)}, service: {status: 'ok'}};
    });
  }
  async listUsers(actor:Actor,options:SearchPage&{status?:string;role?:string}={}){
    const {limit,offset}=pagination(options),q=searchPattern(options),status=choice(options.status,['active','disabled']),role=choice(options.role,['admin','user']);
    return transaction(this.db,async client=>{await checkAdminActor(client,actor);
      return (await client.query(`SELECT id,username,role,status,created_at AS "createdAt" FROM users WHERE deleted_at IS NULL
       AND ($3::text IS NULL OR username ILIKE $3 OR id::text ILIKE $3)
       AND ($4::text IS NULL OR status=$4) AND ($5::text IS NULL OR role=$5)
       ORDER BY created_at,id LIMIT $1 OFFSET $2`,[limit,offset,q,status,role])).rows;
    });
  }
  async listProjects(actor:Actor,options:SearchPage&{trash?:boolean;userId?:string}={}){
    const {limit,offset}=pagination(options),q=searchPattern(options),userId=userFilter(options.userId);
    if(options.trash!==undefined&&typeof options.trash!=='boolean')throw errors.invalid();
    return transaction(this.db,async client=>{await checkAdminActor(client,actor);
      const result=await client.query(`SELECT p.id,p.owner_id AS "ownerId",u.username AS "ownerUsername",p.title,p.revision,p.deleted_at AS "deletedAt",p.updated_at AS "updatedAt",pg_column_size(p.document_jsonb) AS "documentBytes" FROM projects p JOIN users u ON u.id=p.owner_id
       WHERE (p.deleted_at IS NOT NULL)=$3 AND ($4::text IS NULL OR p.title ILIKE $4 OR u.username ILIKE $4 OR p.id::text ILIKE $4 OR p.owner_id::text ILIKE $4)
       AND ($5::uuid IS NULL OR p.owner_id=$5) ORDER BY p.updated_at DESC,p.id LIMIT $1 OFFSET $2`,[limit,offset,options.trash??false,q,userId]);
      return result.rows.map(row=>({...row,revision:Number(row.revision)}));
    });
  }
  async listTokens(actor:Actor,options:SearchPage&{status?:string;userId?:string}={}){
    const {limit,offset}=pagination(options),q=searchPattern(options),status=choice(options.status,['active','revoked','expired','disabled']),userId=userFilter(options.userId);
    const state="CASE WHEN t.revoked_at IS NOT NULL THEN 'revoked' WHEN t.expires_at<=statement_timestamp() THEN 'expired' WHEN u.status<>'active' THEN 'disabled' ELSE 'active' END";
    return transaction(this.db,async client=>{await checkAdminActor(client,actor);
      return (await client.query(`SELECT t.id,t.user_id AS "userId",u.username AS "userUsername",u.status AS "userStatus",t.prefix,t.name,t.scopes,t.project_allowlist AS "projectAllowlist",t.expires_at AS "expiresAt",t.revoked_at AS "revokedAt",t.created_at AS "createdAt",t.last_used_at AS "lastUsedAt",${state} AS status FROM api_tokens t JOIN users u ON u.id=t.user_id
       WHERE ($3::text IS NULL OR t.name ILIKE $3 OR t.prefix ILIKE $3 OR u.username ILIKE $3 OR t.id::text ILIKE $3 OR t.user_id::text ILIKE $3)
       AND ($4::text IS NULL OR ${state}=$4) AND ($5::uuid IS NULL OR t.user_id=$5)
       ORDER BY t.created_at DESC,t.id LIMIT $1 OFFSET $2`,[limit,offset,q,status,userId])).rows;
    });
  }
  async listAudit(actor:Actor,options:SearchPage&{outcome?:string;userId?:string;from?:string;to?:string}={}){
    const {limit,offset}=pagination(options),q=searchPattern(options),outcome=choice(options.outcome,['success','failure']),userId=userFilter(options.userId),from=dateFilter(options.from),to=dateFilter(options.to);
    if(from&&to&&from>=to)throw errors.invalid('时间筛选无效');
    return transaction(this.db,async client=>{await checkAdminActor(client,actor);
      return (await client.query(`SELECT a.id,a.actor_id AS "actorId",u.username AS "actorUsername",a.action,a.resource_type AS "resourceType",a.resource_id AS "resourceId",a.outcome,a.created_at AS "createdAt" FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id
       WHERE ($3::text IS NULL OR a.action ILIKE $3 OR a.resource_type ILIKE $3 OR a.resource_id::text ILIKE $3 OR u.username ILIKE $3 OR a.actor_id::text ILIKE $3)
       AND ($4::text IS NULL OR a.outcome=$4) AND ($5::uuid IS NULL OR a.actor_id=$5)
       AND ($6::timestamptz IS NULL OR a.created_at>=$6) AND ($7::timestamptz IS NULL OR a.created_at<$7)
       ORDER BY a.id DESC LIMIT $1 OFFSET $2`,[limit,offset,q,outcome,userId,from,to])).rows;
    });
  }
  private async settings(client: Transaction) {
    const result = {...defaults};
    const rows = await client.query('SELECT key,value FROM system_settings WHERE key=ANY($1::text[])', [Object.keys(defaults)]);
    for (const row of rows.rows) if (validSetting(row.key, row.value)) Object.assign(result, {[row.key]: row.value});
    return result;
  }
  async getSettings(actor: Actor) {
    return transaction(this.db, async client => {await checkAdminActor(client, actor); return this.settings(client);});
  }
  async setSettings(actor: Actor, patch: Record<string, unknown>) {
    if (!patch || Array.isArray(patch) || !Object.keys(patch).length || Object.entries(patch).some(([key, value]) => !validSetting(key, value))) throw errors.invalid('设置字段或值无效');
    return transaction(this.db, async client => {
      await checkAdminActor(client, actor, true);
      for (const [key, value] of Object.entries(patch).sort(([a], [b]) => a.localeCompare(b))) {
        await client.query('INSERT INTO system_settings(key,value,updated_by) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp()', [key, JSON.stringify(value), actor.id]);
        await client.query("INSERT INTO audit_logs(actor_id,action,resource_type,resource_id,outcome) VALUES($1,'settings.update','setting',$2,'success')", [actor.id, key]);
      }
      return this.settings(client);
    });
  }
}

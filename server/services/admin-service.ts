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
const defaults = {siteName: 'Superior Point', announcement: '', maxUploadBytes: 32 * 1024 * 1024, publicRegistration: false, maintenanceMode: false};
function validSetting(key: string, value: unknown) {
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
        (SELECT count(*)::int FROM users) AS users,
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
  async listUsers(actor: Actor, options: {limit?: number; offset?: number} = {}) {
    const {limit, offset} = pagination(options);
    return transaction(this.db, async client => {
      await checkAdminActor(client, actor);
      return (await client.query('SELECT id,username,role,status,created_at AS "createdAt" FROM users ORDER BY created_at,id LIMIT $1 OFFSET $2', [limit, offset])).rows;
    });
  }
  async listProjects(actor: Actor, options: {limit?: number; offset?: number; trash?: boolean} = {}) {
    const {limit, offset} = pagination(options);
    if (options.trash !== undefined && typeof options.trash !== 'boolean') throw errors.invalid();
    return transaction(this.db, async client => {
      await checkAdminActor(client, actor);
      const result = await client.query('SELECT p.id,p.owner_id AS "ownerId",u.username AS "ownerUsername",p.title,p.revision,p.deleted_at AS "deletedAt",p.updated_at AS "updatedAt",pg_column_size(p.document_jsonb) AS "documentBytes" FROM projects p JOIN users u ON u.id=p.owner_id WHERE (p.deleted_at IS NOT NULL)=$3 ORDER BY p.updated_at DESC,p.id LIMIT $1 OFFSET $2', [limit, offset, options.trash ?? false]);
      return result.rows.map(row => ({...row, revision: Number(row.revision)}));
    });
  }
  async listAudit(actor: Actor, options: {limit?: number; offset?: number} = {}) {
    const {limit, offset} = pagination(options);
    return transaction(this.db, async client => {
      await checkAdminActor(client, actor);
      return (await client.query('SELECT id,actor_id AS "actorId",action,resource_type AS "resourceType",resource_id AS "resourceId",outcome,created_at AS "createdAt" FROM audit_logs ORDER BY id DESC LIMIT $1 OFFSET $2', [limit, offset])).rows;
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

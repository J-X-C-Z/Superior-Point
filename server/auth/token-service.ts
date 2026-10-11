import {createHash, randomBytes} from 'node:crypto';
import {checkAdminActor} from '../services/admin-service.js';
import {errors, requireAdmin, ServiceError, transaction, type Actor, type Database, type Transaction} from '../contracts.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const scopes = ['projects:read', 'projects:create', 'projects:write', 'projects:delete', 'projects:export', 'assets:write', 'themes:read', 'themes:write', 'themes:publish'];
const defaultScopes = ['projects:read', 'projects:create', 'projects:write', 'projects:export'];
const day = 24 * 60 * 60 * 1000;
const digest = (raw: string) => createHash('sha256').update(raw).digest('hex');
const columns = 'id,user_id,prefix,name,scopes,project_allowlist,expires_at,revoked_at,created_at,last_used_at';
type TokenRow = {id: string; user_id: string; prefix: string; name: string; scopes: string[]; project_allowlist: string[] | null; expires_at: Date; revoked_at: Date | null; created_at: Date; last_used_at: Date | null};
type TokenInput = {name: string; scopes?: string[]; projectAllowlist?: string[] | null; expiresAt?: string | Date};
function metadata(row: TokenRow) {
  return {id: row.id, userId: row.user_id, prefix: row.prefix, name: row.name, scopes: row.scopes, projectAllowlist: row.project_allowlist, expiresAt: row.expires_at, revokedAt: row.revoked_at, createdAt: row.created_at, lastUsedAt: row.last_used_at};
}
function tokenId(id: string) {if (typeof id !== 'string' || !uuid.test(id)) throw errors.invalid('令牌ID无效');}
async function audit(client: Transaction, actor: Actor, id: string, action: string) {
  await client.query("INSERT INTO audit_logs(actor_id,action,resource_type,resource_id,outcome) VALUES($1,$2,'token',$3,'success')", [actor.id, action, id]);
}

/** Caller holds the active user lock; token SHARE lock serializes document commits with revocation. */
export async function checkTokenActor(client: Transaction, actor: Actor) {
  if (actor.source !== 'mcp' || !actor.tokenId || !uuid.test(actor.tokenId)) throw errors.unauthorized();
  const result = await client.query<TokenRow>('SELECT scopes,project_allowlist FROM api_tokens WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE', [actor.tokenId, actor.id]);
  const row = result.rows[0];
  if (!row) throw errors.unauthorized();
  if (JSON.stringify(row.scopes) !== JSON.stringify(actor.scopes) || JSON.stringify(row.project_allowlist) !== JSON.stringify(actor.projectAllowlist)) throw errors.forbidden();
}

export class TokenService {
  constructor(private readonly db: Database) {}

  private async webActor(client: Transaction, actor: Actor, admin = false) {
    if (actor.source !== 'web' || !actor.sessionId || !uuid.test(actor.sessionId)) throw errors.forbidden();
    if (admin) requireAdmin(actor);
    const user = await client.query("SELECT role FROM users WHERE id=$1 AND status='active' FOR SHARE", [actor.id]);
    if (!user.rowCount) throw errors.unauthorized();
    if (admin && user.rows[0].role !== 'admin') throw errors.forbidden();
    const session = await client.query('SELECT id FROM sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE', [actor.sessionId, actor.id]);
    if (!session.rowCount) throw errors.unauthorized();
  }

  async create(actor: Actor, input: TokenInput) {
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 128) throw errors.invalid('令牌名称无效');
    const requestedScopes = input.scopes ?? defaultScopes;
    if (!Array.isArray(requestedScopes) || requestedScopes.length === 0 || requestedScopes.length > scopes.length || requestedScopes.some(scope => !scopes.includes(scope)) || new Set(requestedScopes).size !== requestedScopes.length) throw errors.invalid('令牌作用域无效');
    const allowlist = input.projectAllowlist ?? null;
    if (allowlist !== null && (!Array.isArray(allowlist) || allowlist.length > 1000 || allowlist.some(id => typeof id !== 'string' || !uuid.test(id)) || new Set(allowlist).size !== allowlist.length)) throw errors.invalid('项目范围无效');
    const now = Date.now();
    const expiresAt = input.expiresAt === undefined ? new Date(now + 30 * day) : new Date(input.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now || expiresAt.getTime() > now + 365 * day) throw errors.invalid('令牌期限须在未来365天以内');
    return transaction(this.db, async client => {
      await this.webActor(client, actor);
      if (allowlist?.length) {
        const owned = await client.query('SELECT id FROM projects WHERE owner_id=$1 AND id=ANY($2::uuid[])', [actor.id, allowlist]);
        if (owned.rowCount !== allowlist.length) throw errors.invalid('项目范围包含不可访问的项目');
      }
      const token = 'sp_pat_' + randomBytes(32).toString('base64url');
      const result = await client.query<TokenRow>(`INSERT INTO api_tokens(user_id,token_hash,prefix,name,scopes,project_allowlist,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${columns}`, [actor.id, digest(token), token.slice(0, 15), input.name.trim(), JSON.stringify(requestedScopes), allowlist === null ? null : JSON.stringify(allowlist), expiresAt]);
      await audit(client, actor, result.rows[0].id, 'token.create');
      return {token, ...metadata(result.rows[0])};
    });
  }

  async list(actor: Actor) {
    return transaction(this.db, async client => {
      await this.webActor(client, actor);
      const result = await client.query<TokenRow>(`SELECT ${columns} FROM api_tokens WHERE user_id=$1 ORDER BY created_at DESC,id`, [actor.id]);
      return result.rows.map(metadata);
    });
  }
  async adminList(actor: Actor) {
    return transaction(this.db, async client => {
      await this.webActor(client, actor, true);
      const result = await client.query<TokenRow>(`SELECT ${columns} FROM api_tokens ORDER BY created_at DESC,id`);
      return result.rows.map(metadata);
    });
  }
  private async revokeToken(actor: Actor, id: string, admin: boolean) {
    tokenId(id);
    return transaction(this.db, async client => {
      await this.webActor(client, actor, admin);
      if(admin)await checkAdminActor(client,actor,true);
      const result = await client.query(`UPDATE api_tokens SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id=$1${admin ? '' : ' AND user_id=$2'} RETURNING id`, admin ? [id] : [id, actor.id]);
      if (!result.rowCount) throw new ServiceError('NOT_FOUND', 404, '令牌不存在');
      await audit(client, actor, id, admin ? 'token.admin_revoke' : 'token.revoke');
      return {success: true};
    });
  }
  revoke(actor: Actor, id: string) {return this.revokeToken(actor, id, false);}
  adminRevoke(actor: Actor, id: string) {return this.revokeToken(actor, id, true);}

  async authenticate(raw: string): Promise<Actor> {
    if (typeof raw !== 'string' || !/^sp_pat_[A-Za-z0-9_-]{43}$/.test(raw)) throw errors.unauthorized();
    return transaction(this.db, async client => {
      const lookup = await client.query('SELECT user_id FROM api_tokens WHERE token_hash=$1', [digest(raw)]);
      if (!lookup.rowCount) throw errors.unauthorized();
      const userId = lookup.rows[0].user_id;
      const user = await client.query("SELECT role FROM users WHERE id=$1 AND status='active' FOR SHARE", [userId]);
      if (!user.rowCount) throw errors.unauthorized();
      const token = await client.query<TokenRow>(`SELECT ${columns} FROM api_tokens WHERE token_hash=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`, [digest(raw), userId]);
      if (!token.rowCount) throw errors.unauthorized();
      const row = token.rows[0];
      await client.query('UPDATE api_tokens SET last_used_at=clock_timestamp() WHERE id=$1', [row.id]);
      return {id: userId, role: user.rows[0].role, source: 'mcp', tokenId: row.id, scopes: row.scopes, projectAllowlist: row.project_allowlist};
    });
  }
}

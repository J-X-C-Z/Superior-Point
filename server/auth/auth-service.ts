import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {argon2id, hash, verify} from 'argon2';
import {errors, requireAdmin, ServiceError, transaction, type Actor, type Database, type Transaction} from '../contracts.js';

type Role = 'admin' | 'user';
type Status = 'active' | 'disabled';
type UserRow = {id: string; username: string; role: Role; status: Status; created_at: Date; password_hash?: string};
const userColumns = 'id, username, role, status, created_at';
const adminLock = 735005007;
const passwordOptions = {type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1};
// Unknown accounts still perform the same password verification work.
const dummyHash = hash(randomBytes(32), passwordOptions);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const publicUser = (row: UserRow) => ({id: row.id, username: row.username, role: row.role});
const metadata = (row: UserRow) => ({...publicUser(row), status: row.status, createdAt: row.created_at});

function credentials(username: string, password: string) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_.-]{3,64}$/.test(username)) throw errors.invalid('用户名须为3至64位字母、数字、下划线、点或短横线');
  validPassword(password);
}
function validPassword(password: string) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw errors.invalid('密码须为12至1024个字符');
}
function userId(id: string) {
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw errors.invalid('用户ID无效');
}
async function audit(client: Transaction, actorId: string | null, action: string, id: string | null, outcome = 'success') {
  await client.query('INSERT INTO audit_logs(actor_id,action,resource_type,resource_id,outcome) VALUES($1,$2,$3,$4,$5)', [actorId, action, 'user', id, outcome]);
}

export class AuthService {
  private readonly sessionTtlMs: number;
  constructor(private readonly db: Database, options: {sessionTtlMs?: number; secureCookies?: boolean; origin?: string} = {}) {
    this.sessionTtlMs = options.sessionTtlMs ?? 24 * 60 * 60 * 1000;
    if (!Number.isSafeInteger(this.sessionTtlMs) || this.sessionTtlMs <= 0) throw errors.invalid('会话期限无效');
  }

  private async checkAdmin(client: Transaction, actor: Actor, recent = false) {
    requireAdmin(actor);
    const result = await client.query('SELECT role,status FROM users WHERE id=$1 FOR UPDATE', [actor.id]);
    if (result.rows[0]?.role !== 'admin' || result.rows[0]?.status !== 'active') throw errors.forbidden();
    if (actor.sessionId) {
      const session = await client.query('SELECT id,reauth_until>clock_timestamp() AS recent FROM sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE', [actor.sessionId, actor.id]);
      if (!session.rowCount) throw errors.unauthorized();
      if (recent && !session.rows[0].recent) throw new ServiceError('REAUTHENTICATION_REQUIRED', 403, '请重新验证密码');
    }
  }

  async bootstrapAdmin(username: string, password: string) {
    credentials(username, password);
    const passwordHash = await hash(password, passwordOptions);
    return transaction(this.db, async client => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [adminLock]);
      const existing = await client.query('SELECT 1 FROM users LIMIT 1');
      if (existing.rowCount) throw new ServiceError('BOOTSTRAP_COMPLETE', 409, '管理员初始化已完成');
      const result = await client.query(`INSERT INTO users(username,password_hash,role,status) VALUES($1,$2,'admin','active') RETURNING ${userColumns}`, [username, passwordHash]);
      await audit(client, result.rows[0].id, 'auth.bootstrap', result.rows[0].id);
      return metadata(result.rows[0]);
    });
  }

  async createUser(actor: Actor, input: {username: string; password: string; role?: Role}) {
    requireAdmin(actor);
    credentials(input.username, input.password);
    const role = input.role ?? 'user';
    if (!['admin', 'user'].includes(role)) throw errors.invalid();
    const passwordHash = await hash(input.password, passwordOptions);
    try {
      return await transaction(this.db, async client => {
        await client.query('SELECT pg_advisory_xact_lock($1)', [adminLock]);
        await this.checkAdmin(client, actor, true);
        const result = await client.query(`INSERT INTO users(username,password_hash,role,status) VALUES($1,$2,$3,'active') RETURNING ${userColumns}`, [input.username, passwordHash, role]);
        await audit(client, actor.id, 'user.create', result.rows[0].id);
        return metadata(result.rows[0]);
      });
    } catch (error) {
      if ((error as {code?: string}).code === '23505') throw new ServiceError('USERNAME_EXISTS', 409, '用户名已存在');
      throw error;
    }
  }

  async listUsers(actor: Actor) {
    return transaction(this.db, async client => {
      await this.checkAdmin(client, actor);
      const result = await client.query(`SELECT ${userColumns} FROM users ORDER BY created_at,id`);
      return result.rows.map(metadata);
    });
  }

  private async changeUser(actor: Actor, id: string, field: 'role' | 'status', value: Role | Status) {
    userId(id);
    return transaction(this.db, async client => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [adminLock]);
      await this.checkAdmin(client, actor, true);
      const result = await client.query(`SELECT ${userColumns} FROM users WHERE id=$1 FOR UPDATE`, [id]);
      const user: UserRow | undefined = result.rows[0];
      if (!user) throw new ServiceError('NOT_FOUND', 404, '用户不存在');
      if (user.role === 'admin' && user.status === 'active' && ((field === 'role' && value === 'user') || (field === 'status' && value === 'disabled'))) {
        const count = await client.query("SELECT count(*)::int AS count FROM users WHERE role='admin' AND status='active'");
        if (count.rows[0].count <= 1) throw new ServiceError('LAST_ADMIN', 409, '不能停用最后一位有效管理员');
      }
      const updated = await client.query(`UPDATE users SET ${field}=$2 WHERE id=$1 RETURNING ${userColumns}`, [id, value]);
      if (field === 'status' && value === 'disabled') {
        await client.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [id]);
        await client.query('UPDATE api_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [id]);
      }
      await audit(client, actor.id, `user.${field}`, id);
      return metadata(updated.rows[0]);
    });
  }
  setUserStatus(actor: Actor, id: string, status: Status) {
    if (!['active', 'disabled'].includes(status)) throw errors.invalid();
    return this.changeUser(actor, id, 'status', status);
  }
  setUserRole(actor: Actor, id: string, role: Role) {
    if (!['admin', 'user'].includes(role)) throw errors.invalid();
    return this.changeUser(actor, id, 'role', role);
  }
  async revokeUserSessions(actor: Actor, id: string) {
    userId(id);
    return transaction(this.db, async client => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [adminLock]);
      await this.checkAdmin(client, actor, true);
      const user = await client.query('SELECT id FROM users WHERE id=$1', [id]);
      if (!user.rowCount) throw new ServiceError('NOT_FOUND', 404, '用户不存在');
      await client.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [id]);
      await audit(client, actor.id, 'user.revoke_sessions', id);
    });
  }

  async login(username: string, password: string) {
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > 1024) throw errors.invalid();
    const result = await transaction(this.db, async client => {
      const found = await client.query('SELECT * FROM users WHERE username=$1 FOR UPDATE', [username]);
      const user: UserRow | undefined = found.rows[0];
      const correct = await verify(user?.password_hash ?? await dummyHash, password);
      if (!user || !correct || user.status !== 'active') {
        await audit(client, null, 'auth.login', null, 'failure');
        return null;
      }
      const sessionToken = randomBytes(32).toString('base64url');
      const csrfToken = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + this.sessionTtlMs);
      await client.query("INSERT INTO sessions(user_id,session_hash,csrf_hash,expires_at,reauth_until) VALUES($1,$2,$3,$4,clock_timestamp()+interval '10 minutes')", [user.id, digest(sessionToken), digest(csrfToken), expiresAt]);
      await audit(client, user.id, 'auth.login', user.id);
      return {user: publicUser(user), sessionToken, csrfToken, expiresAt};
    });
    if (!result) throw new ServiceError('INVALID_CREDENTIALS', 401, '用户名或密码错误');
    return result;
  }
  async authenticate(sessionToken: string): Promise<Actor> {
    if (typeof sessionToken !== 'string' || sessionToken.length > 256) throw errors.unauthorized();
    const result = await this.db.query("SELECT u.id,u.role,s.id AS session_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.session_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='active'", [digest(sessionToken)]);
    const row = result.rows[0];
    if (!row) throw errors.unauthorized();
    return {id: row.id, role: row.role, source: 'web', sessionId: row.session_id};
  }
  async verifyCsrf(actor: Actor, token: string) {
    if (actor.source !== 'web' || !actor.sessionId || typeof token !== 'string' || token.length > 256) throw errors.forbidden();
    const result = await this.db.query("SELECT s.csrf_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='active'", [actor.sessionId, actor.id]);
    const stored = result.rows[0]?.csrf_hash;
    if (typeof stored !== 'string' || stored.length !== 64) throw errors.unauthorized();
    if(!timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(digest(token), 'hex')))throw new ServiceError('CSRF_INVALID',403,'请求验证失败');
  }
  async logout(sessionToken: string) {
    if (typeof sessionToken !== 'string' || sessionToken.length > 256) throw errors.unauthorized();
    await transaction(this.db, async client => {
      const session = await client.query('SELECT user_id FROM sessions WHERE session_hash=$1 AND revoked_at IS NULL', [digest(sessionToken)]);
      if (!session.rowCount) return;
      await client.query('SELECT id FROM users WHERE id=$1 FOR SHARE', [session.rows[0].user_id]);
      const result = await client.query('UPDATE sessions SET revoked_at=now() WHERE session_hash=$1 AND revoked_at IS NULL RETURNING user_id', [digest(sessionToken)]);
      if (result.rowCount) await audit(client, result.rows[0].user_id, 'auth.logout', result.rows[0].user_id);
    });
  }
  async getUser(actor: Actor) {
    const result = await this.db.query(`SELECT ${userColumns} FROM users WHERE id=$1 AND status='active'`, [actor.id]);
    if (!result.rowCount) throw errors.unauthorized();
    return metadata(result.rows[0]);
  }

  private async webSession(client: Transaction, actor: Actor, update = false) {
    if (actor.source !== 'web' || !actor.sessionId) throw errors.forbidden();
    const user = await client.query("SELECT password_hash FROM users WHERE id=$1 AND status='active'" + (update ? ' FOR UPDATE' : ' FOR SHARE'), [actor.id]);
    if (!user.rowCount) throw errors.unauthorized();
    const session = await client.query('SELECT id,reauth_until>clock_timestamp() AS recent FROM sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp()' + (update ? ' FOR UPDATE' : ' FOR SHARE'), [actor.sessionId, actor.id]);
    if (!session.rowCount) throw errors.unauthorized();
    return {passwordHash: user.rows[0].password_hash as string, recent: Boolean(session.rows[0].recent)};
  }
  async rotateCsrf(actor: Actor) {
    return transaction(this.db, async client => {
      await this.webSession(client, actor, true);
      const csrfToken = randomBytes(32).toString('base64url');
      await client.query('UPDATE sessions SET csrf_hash=$2 WHERE id=$1', [actor.sessionId, digest(csrfToken)]);
      return {csrfToken};
    });
  }
  async reauthenticate(actor: Actor, password: string) {
    if (typeof password !== 'string' || password.length > 1024) throw errors.invalid();
    const result = await transaction(this.db, async client => {
      const session = await this.webSession(client, actor, true);
      if (!await verify(session.passwordHash, password)) {
        await audit(client, actor.id, 'auth.reauthenticate', actor.id, 'failure');
        return null;
      }
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await client.query('UPDATE sessions SET reauth_until=$2 WHERE id=$1', [actor.sessionId, expiresAt]);
      await audit(client, actor.id, 'auth.reauthenticate', actor.id);
      return {expiresAt};
    });
    if (!result) throw new ServiceError('INVALID_CREDENTIALS', 401, '密码错误');
    return result;
  }
  async requireReauthentication(actor: Actor) {
    await transaction(this.db, async client => {
      if (!(await this.webSession(client, actor)).recent) throw new ServiceError('REAUTHENTICATION_REQUIRED', 403, '请重新验证密码');
    });
  }
  async changePassword(actor: Actor, input: {currentPassword: string; newPassword: string}) {
    validPassword(input.newPassword);
    if (typeof input.currentPassword !== 'string' || input.currentPassword.length > 1024) throw errors.invalid();
    const passwordHash = await hash(input.newPassword, passwordOptions);
    await transaction(this.db, async client => {
      const session = await this.webSession(client, actor, true);
      if (!await verify(session.passwordHash, input.currentPassword)) throw new ServiceError('INVALID_CREDENTIALS', 401, '密码错误');
      await client.query('UPDATE users SET password_hash=$2 WHERE id=$1', [actor.id, passwordHash]);
      await client.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL', [actor.id]);
      await audit(client, actor.id, 'user.change_password', actor.id);
    });
    return {success: true};
  }
  async resetUserPassword(actor: Actor, id: string, password: string) {
    userId(id); validPassword(password);
    const passwordHash = await hash(password, passwordOptions);
    await transaction(this.db, async client => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [adminLock]);
      await this.checkAdmin(client, actor, true);
      const target = await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [id]);
      if (!target.rowCount) throw new ServiceError('NOT_FOUND', 404, '用户不存在');
      await client.query('UPDATE users SET password_hash=$2 WHERE id=$1', [id, passwordHash]);
      await client.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL', [id]);
      await audit(client, actor.id, 'user.reset_password', id);
    });
    return {success: true};
  }
}

import {createHash, randomUUID} from 'node:crypto';
import {createDocument, DocumentCore, cloneJSON, CoreError} from '../../core/document-core.js';
import type {SPDocument, Operation} from '../../core/document-core.js';
import {errors, requireScope, ServiceError, transaction} from '../contracts.js';
import type {Actor, Database, Transaction} from '../contracts.js';

type Mutation = {expectedRevision: number; clientMutationId: string; leaseToken?: string};
type Edit = Mutation & {operations: Operation[]};
type ProjectRow = {id: string; owner_id: string; revision: string; document_jsonb: SPDocument; deleted_at: Date | null};
type LeaseRow = {actor_id: string; holder: string; fencing_token: string; expires_at: Date; active: boolean};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const conflict = (code: string, message: string, details?: Record<string, unknown>) => new ServiceError(code, 409, message, details);
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value)!;
};
function coreCall<T>(fn: () => T): T {
  try {return fn();}
  catch (error) {if (error instanceof CoreError || error instanceof SyntaxError) throw errors.invalid('文档或操作无效'); throw error;}
}
function documentJSON(document: SPDocument) {
  const text = JSON.stringify(document);
  if (Buffer.byteLength(text) > 32 * 1024 * 1024 || document.title.length > 500) throw errors.invalid('文档超过 32 MiB 或标题超过 500 字符');
  return text;
}

/** PostgreSQL owns documents; every actor, CAS, lease and receipt check shares the commit transaction. */
export class ProjectService {
  constructor(private db: Database) {}

  private async active(client: Transaction, actor: Actor) {
    const result = await client.query('SELECT id FROM users WHERE id=$1 AND status=\'active\' FOR SHARE', [actor.id]);
    if (!result.rowCount) throw errors.unauthorized();
    if (actor.sessionId !== undefined) {
      if (!uuid.test(actor.sessionId)) throw errors.unauthorized();
      const session = await client.query('SELECT id FROM sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE', [actor.sessionId, actor.id]);
      if (!session.rowCount) throw errors.unauthorized();
    }
  }

  private async owned(client: Transaction, actor: Actor, id: string, lock = false): Promise<ProjectRow> {
    if (!uuid.test(id)) throw errors.missing();
    const result = await client.query<ProjectRow>('SELECT id,owner_id,revision,document_jsonb,deleted_at FROM projects WHERE id=$1 AND owner_id=$2' + (lock ? ' FOR UPDATE' : ''), [id, actor.id]);
    if (!result.rowCount) throw errors.missing();
    return result.rows[0];
  }

  private async audit(client: Transaction, actor: Actor, id: string, action: string) {
    await client.query('INSERT INTO audit_logs(actor_id,action,resource_type,resource_id,outcome) VALUES($1,$2,\'project\',$3,\'success\')', [actor.id, action, id]);
  }

  private async revision(client: Transaction, actor: Actor, document: SPDocument) {
    await client.query('INSERT INTO project_revisions(project_id,revision,actor_id,source,document_jsonb) VALUES($1,$2,$3,$4,$5)', [document.id, document.revision, actor.id, actor.source, documentJSON(document)]);
  }

  async create(actor: Actor, options: {title?: string; canvas?: {width: number; height: number}} = {}) {
    requireScope(actor, 'projects:create');
    const document = coreCall(() => createDocument({title: options.title, canvas: options.canvas}));
    const text = documentJSON(document);
    return transaction(this.db, async client => {
      await this.active(client, actor);
      await client.query('INSERT INTO projects(id,owner_id,title,revision,document_jsonb) VALUES($1,$2,$3,$4,$5)', [document.id, actor.id, document.title, document.revision, text]);
      await this.revision(client, actor, document);
      await this.audit(client, actor, document.id, 'project.create');
      return document;
    });
  }

  async list(actor: Actor, {trash = false}: {trash?: boolean} = {}) {
    requireScope(actor, 'projects:read');
    return transaction(this.db, async client => {
      await this.active(client, actor);
      const result = await client.query('SELECT id,title,revision,deleted_at AS "deletedAt",updated_at AS "updatedAt" FROM projects WHERE owner_id=$1 AND (deleted_at IS NOT NULL)=$2 ORDER BY updated_at DESC,id', [actor.id, trash]);
      return result.rows.filter(row => actor.source !== 'mcp' || !actor.projectAllowlist || actor.projectAllowlist.includes(row.id)).map(row => ({...row, revision: Number(row.revision)}));
    });
  }

  async get(actor: Actor, id: string) {
    requireScope(actor, 'projects:read', id);
    return transaction(this.db, async client => {
      await this.active(client, actor);
      const row = await this.owned(client, actor, id);
      if (row.deleted_at) throw errors.missing();
      return row.document_jsonb;
    });
  }

  private async lease(client: Transaction, id: string): Promise<LeaseRow | undefined> {
    const result = await client.query<LeaseRow>('SELECT actor_id,holder,fencing_token,expires_at,expires_at>clock_timestamp() AS active FROM project_locks WHERE project_id=$1', [id]);
    return result.rows[0];
  }

  private async writeLease(client: Transaction, actor: Actor, id: string, token?: string, required = false) {
    const lease = await this.lease(client, id);
    if (token !== undefined && (!lease?.active || lease.actor_id !== actor.id || lease.fencing_token !== token)) throw conflict('LOCK_LOST', '项目写入租约已失效');
    if (required && token === undefined) throw conflict('LOCK_LOST', '完整快照提交需要有效租约');
    if (lease?.active && token === undefined) throw conflict('PROJECT_BUSY', '项目正在另一编辑会话中写入');
  }

  private async mutate(actor: Actor, id: string, request: Mutation, action: string, payload: Record<string, unknown>, change: (document: SPDocument) => SPDocument, {restore = false, remove = false, leaseToken, snapshot = false}: {restore?: boolean; remove?: boolean; leaseToken?: string; snapshot?: boolean} = {}) {
    requireScope(actor, remove || restore ? 'projects:delete' : 'projects:write', id);
    if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0 || typeof request.clientMutationId !== 'string' || !request.clientMutationId.trim() || request.clientMutationId.length > 128 || (request.leaseToken !== undefined && typeof request.leaseToken !== 'string')) throw errors.invalid();
    const hash = createHash('sha256').update(stable({action, expectedRevision: request.expectedRevision, ...payload, ...(request.leaseToken === undefined ? {} : {leaseToken: request.leaseToken})})).digest('hex');
    return transaction(this.db, async client => {
      await this.active(client, actor);
      const row = await this.owned(client, actor, id, true);
      const receipt = await client.query('SELECT request_hash,result_jsonb FROM mutation_receipts WHERE project_id=$1 AND actor_id=$2 AND client_mutation_id=$3', [id, actor.id, request.clientMutationId]);
      if (receipt.rowCount) {
        if (receipt.rows[0].request_hash !== hash) throw conflict('MUTATION_ID_REUSED', '此变更 ID 已用于不同请求');
        return receipt.rows[0].result_jsonb as SPDocument;
      }
      if (restore ? !row.deleted_at : Boolean(row.deleted_at)) throw errors.missing();
      await this.writeLease(client, actor, id, leaseToken, snapshot);
      if (Number(row.revision) !== request.expectedRevision) throw conflict('REVISION_CONFLICT', '项目已有更新版本', {expectedRevision: request.expectedRevision, actualRevision: Number(row.revision)});
      const document = coreCall(() => change(row.document_jsonb));
      const text = documentJSON(document);
      if (leaseToken !== undefined) await this.writeLease(client, actor, id, leaseToken, snapshot);
      await client.query('UPDATE projects SET title=$2,revision=$3,document_jsonb=$4,deleted_at=CASE WHEN $5 THEN clock_timestamp() WHEN $6 THEN NULL ELSE deleted_at END,updated_at=clock_timestamp() WHERE id=$1', [id, document.title, document.revision, text, remove, restore]);
      await this.revision(client, actor, document);
      await this.audit(client, actor, id, action);
      await client.query('INSERT INTO mutation_receipts(project_id,actor_id,client_mutation_id,request_hash,result_jsonb) VALUES($1,$2,$3,$4,$5)', [id, actor.id, request.clientMutationId, hash, text]);
      return document;
    });
  }

  async edit(actor: Actor, id: string, request: Edit) {
    const operations = coreCall(() => cloneJSON(request.operations));
    if (!Array.isArray(operations) || !operations.length || operations.length > 1000 || (request.leaseToken !== undefined && typeof request.leaseToken !== 'string')) throw errors.invalid();
    return this.mutate(actor, id, request, 'project.edit', {operations, ...(request.leaseToken === undefined ? {} : {leaseToken: request.leaseToken})}, document => new DocumentCore(document).edit(operations, {expectedRevision: request.expectedRevision}), {leaseToken: request.leaseToken, snapshot: operations.some(operation => operation?.type === 'replaceContent')});
  }

  async rename(actor: Actor, id: string, request: Mutation & {title: string}) {
    if (typeof request.title !== 'string' || request.title.length > 500) throw errors.invalid();
    return this.mutate(actor, id, request, 'project.rename', {title: request.title}, document => new DocumentCore(document).edit([{type: 'updateProject', properties: {title: request.title}}], {expectedRevision: request.expectedRevision}), {leaseToken: request.leaseToken});
  }

  async remove(actor: Actor, id: string, request: Mutation) {
    return this.mutate(actor, id, request, 'project.remove', {}, document => new DocumentCore(document).edit([{type: 'updateProject', properties: {title: document.title}}], {expectedRevision: request.expectedRevision}), {remove: true, leaseToken: request.leaseToken});
  }

  async restore(actor: Actor, id: string, request: Mutation) {
    return this.mutate(actor, id, request, 'project.restore', {}, document => new DocumentCore(document).edit([{type: 'updateProject', properties: {title: document.title}}], {expectedRevision: request.expectedRevision}), {restore: true, leaseToken: request.leaseToken});
  }

  async acquireLease(actor: Actor, id: string, holder: string) {
    requireScope(actor, 'projects:write', id);
    if (typeof holder !== 'string' || !holder.trim() || holder.length > 128) throw errors.invalid();
    return transaction(this.db, async client => {
      await this.active(client, actor);
      const row = await this.owned(client, actor, id, true);
      if (row.deleted_at) throw errors.missing();
      if ((await this.lease(client, id))?.active) throw conflict('PROJECT_BUSY', '项目已有活动写入租约');
      const token = randomUUID();
      const result = await client.query('INSERT INTO project_locks(project_id,actor_id,holder,fencing_token,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval \'60 seconds\') ON CONFLICT(project_id) DO UPDATE SET actor_id=EXCLUDED.actor_id,holder=EXCLUDED.holder,fencing_token=EXCLUDED.fencing_token,expires_at=EXCLUDED.expires_at RETURNING expires_at', [id, actor.id, holder, token]);
      await this.audit(client, actor, id, 'project.lease.acquire');
      return {leaseToken: token, holder, expiresAt: result.rows[0].expires_at.toISOString()};
    });
  }

  async renewLease(actor: Actor, id: string, leaseToken: string) {
    requireScope(actor, 'projects:write', id);
    return transaction(this.db, async client => {
      await this.active(client, actor);
      const row = await this.owned(client, actor, id, true);
      if (row.deleted_at) throw errors.missing();
      if (typeof leaseToken !== 'string' || !leaseToken) throw errors.invalid();
      await this.writeLease(client, actor, id, leaseToken, true);
      const result = await client.query('UPDATE project_locks SET expires_at=clock_timestamp()+interval \'60 seconds\' WHERE project_id=$1 RETURNING holder,expires_at', [id]);
      await this.audit(client, actor, id, 'project.lease.renew');
      return {leaseToken, holder: result.rows[0].holder, expiresAt: result.rows[0].expires_at.toISOString()};
    });
  }

  async releaseLease(actor: Actor, id: string, leaseToken: string) {
    requireScope(actor, 'projects:write', id);
    return transaction(this.db, async client => {
      await this.active(client, actor);
      const row = await this.owned(client, actor, id, true);
      if (row.deleted_at) throw errors.missing();
      if (typeof leaseToken !== 'string' || !leaseToken) throw errors.invalid();
      await this.writeLease(client, actor, id, leaseToken, true);
      await client.query('DELETE FROM project_locks WHERE project_id=$1', [id]);
      await this.audit(client, actor, id, 'project.lease.release');
      return {released: true};
    });
  }
}

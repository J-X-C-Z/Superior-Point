import {quotaBefore,enforceStorageQuota,lockStorageQuota,projectContentBytes} from './quota-service.js';
import {createHash, randomUUID} from 'node:crypto';
import {createDocument, DocumentCore, cloneJSON, CoreError, importDocument} from '../../core/document-core.js';
import type {SPDocument, Operation} from '../../core/document-core.js';
import {errors, requireScope, ServiceError, transaction} from '../contracts.js';
import type {Actor, Database, Transaction} from '../contracts.js';
import {checkTokenActor} from '../auth/token-service.js';
import {ThemeService} from './theme-service.js';
import {planThemeApplication} from '../../core/theme-application.js';
import {checkAdminActor} from './admin-service.js';

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
    if (actor.tokenId !== undefined) await checkTokenActor(client, actor);
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
    if(actor.source==='mcp' && actor.projectAllowlist!=null) throw errors.forbidden();
    const document = coreCall(() => createDocument({title: options.title, canvas: options.canvas}));
    const text = documentJSON(document);
    return transaction(this.db, async client => {
      await this.active(client, actor);
      const quota=await quotaBefore(client,actor.id);
      await client.query('INSERT INTO projects(id,owner_id,title,revision,document_jsonb) VALUES($1,$2,$3,$4,$5)', [document.id, actor.id, document.title, document.revision, text]);
      await this.revision(client, actor, document);
      await this.audit(client, actor, document.id, 'project.create');
      await enforceStorageQuota(client,actor.id,quota);
      return document;
    });
  }

  async list(actor: Actor, {trash = false}: {trash?: boolean} = {}) {
    requireScope(actor, 'projects:read');
    return transaction(this.db, async client => {
      await this.active(client, actor);
      const result = await client.query(`SELECT id,title,revision,document_jsonb->'canvas' AS canvas,jsonb_array_length(document_jsonb->'slides') AS "slideCount",deleted_at AS "deletedAt",updated_at AS "updatedAt" FROM projects WHERE owner_id=$1 AND (deleted_at IS NOT NULL)=$2 ORDER BY updated_at DESC,id`, [actor.id, trash]);
      return result.rows.filter(row => actor.source !== 'mcp' || !actor.projectAllowlist || actor.projectAllowlist.includes(row.id)).map(row => ({...row, revision: Number(row.revision)}));
    });
  }

  private async read(actor: Actor, id: string, scope: string, trash=false) {
    requireScope(actor, scope, id);
    return transaction(this.db, async client => {
      await this.active(client, actor);
      const row = await this.owned(client, actor, id);
      if (row.deleted_at && !trash) throw errors.missing();
      return row.document_jsonb;
    });
  }
  get(actor: Actor,id: string,{trash=false}: {trash?:boolean}={}) {return this.read(actor,id,'projects:read',trash);}
  getForExport(actor: Actor,id: string) {return this.read(actor,id,'projects:export');}

  private async historical(client:Transaction,id:string,revision:number):Promise<SPDocument> {
    if(!Number.isSafeInteger(revision)||revision<0)throw errors.invalid('历史修订号无效');
    const row=(await client.query('SELECT document_jsonb FROM project_revisions WHERE project_id=$1 AND revision=$2',[id,revision])).rows[0];
    if(!row)throw errors.missing();return row.document_jsonb;
  }

  async listRevisions(actor:Actor,id:string) {
    requireScope(actor,'projects:read',id);
    return transaction(this.db,async client=>{await this.active(client,actor);const project=await this.owned(client,actor,id);if(project.deleted_at)throw errors.missing();
      const result=await client.query(`SELECT revision,document_jsonb->>'title' AS title,source,created_at AS "createdAt",jsonb_array_length(document_jsonb->'slides') AS "slideCount" FROM project_revisions WHERE project_id=$1 ORDER BY revision DESC`,[id]);
      return result.rows.map(row=>({...row,revision:Number(row.revision),createdAt:row.createdAt.toISOString()}));
    });
  }

  async getRevision(actor:Actor,id:string,revision:number) {
    requireScope(actor,'projects:read',id);
    return transaction(this.db,async client=>{await this.active(client,actor);const project=await this.owned(client,actor,id);if(project.deleted_at)throw errors.missing();return this.historical(client,id,revision);});
  }

  async revisionDiff(actor:Actor,id:string,from:number,to:number) {
    requireScope(actor,'projects:read',id);
    return transaction(this.db,async client=>{await this.active(client,actor);const project=await this.owned(client,actor,id);if(project.deleted_at)throw errors.missing();
      const before=await this.historical(client,id,from),after=await this.historical(client,id,to);
      const changes=(left:{id:string}[],right:{id:string}[])=>{
        const a=new Map(left.map(value=>[value.id,value])),b=new Map(right.map(value=>[value.id,value]));
        return [...new Set([...a.keys(),...b.keys()])].flatMap(id=>!a.has(id)?[{id,status:'added'}]:!b.has(id)?[{id,status:'removed'}]:stable(a.get(id))!==stable(b.get(id))?[{id,status:'modified'}]:[]);
      };
      return {projectId:id,fromRevision:from,toRevision:to,titleChanged:before.title!==after.title,slideOrderChanged:stable(before.slides.map(s=>s.id))!==stable(after.slides.map(s=>s.id)),slides:changes(before.slides,after.slides).map(change=>({...change,elements:changes(before.slides.find(s=>s.id===change.id)?.elements??[],after.slides.find(s=>s.id===change.id)?.elements??[])})),assetsChanged:stable(before.assets)!==stable(after.assets),themeChanged:stable(before.extensions.theme??null)!==stable(after.extensions.theme??null)};
    });
  }

  async restoreRevision(actor:Actor,id:string,request:Mutation&{revision:number}) {
    if(!Number.isSafeInteger(request.revision)||request.revision<0)throw errors.invalid('历史修订号无效');
    return this.mutate(actor,id,request,'project.history_restore',{revision:request.revision},async(current,client)=>{
      if(request.revision>=current.revision)throw errors.invalid('只能恢复较早的历史修订');
      const historical=await this.historical(client,id,request.revision);
      const restored=importDocument({...historical,id:current.id,revision:current.revision,metadata:{...historical.metadata,createdAt:current.metadata.createdAt}});
      return coreCall(()=>new DocumentCore(current).edit([{type:'replaceContent',document:restored}],{expectedRevision:request.expectedRevision}));
    },{leaseToken:request.leaseToken,snapshot:true});
  }

  private async lease(client: Transaction, id: string): Promise<LeaseRow | undefined> {
    const result = await client.query<LeaseRow>('SELECT actor_id,holder,fencing_token,expires_at,expires_at>clock_timestamp() AS active FROM project_locks WHERE project_id=$1', [id]);
    return result.rows[0];
  }

  private async writeLease(client: Transaction, actor: Actor, id: string, token?: string, required = false, atomicMcp = false) {
    const lease = await this.lease(client, id);
    if (token !== undefined && (!lease?.active || lease.actor_id !== actor.id || lease.fencing_token !== token)) throw conflict('LOCK_LOST', '项目写入租约已失效');
    if (required && token === undefined) throw conflict('LOCK_LOST', '完整快照提交需要有效租约');
    if (lease?.active && token === undefined && !(atomicMcp && actor.source === 'mcp' && lease.actor_id === actor.id)) throw conflict('PROJECT_BUSY', '项目正在另一编辑会话中写入');
  }

  private async mutate(actor: Actor, id: string, request: Mutation, action: string, payload: Record<string, unknown>, change: (document: SPDocument, client:Transaction) => SPDocument | Promise<SPDocument>, {restore = false, remove = false, leaseToken, snapshot = false}: {restore?: boolean; remove?: boolean; leaseToken?: string; snapshot?: boolean} = {}) {
    requireScope(actor, remove || restore ? 'projects:delete' : 'projects:write', id);
    if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0 || typeof request.clientMutationId !== 'string' || !request.clientMutationId.trim() || request.clientMutationId.length > 128 || (request.leaseToken !== undefined && typeof request.leaseToken !== 'string')) throw errors.invalid();
    const {leaseToken: _leaseAuthority, ...semanticPayload}=payload;
    const hash = createHash('sha256').update(stable({action, expectedRevision: request.expectedRevision, ...semanticPayload})).digest('hex');
    return transaction(this.db, async client => {
      await this.active(client, actor);
      const quota=await quotaBefore(client,actor.id);
      const row = await this.owned(client, actor, id, true);
      const receipt = await client.query('SELECT request_hash,result_jsonb FROM mutation_receipts WHERE project_id=$1 AND actor_id=$2 AND client_mutation_id=$3', [id, actor.id, request.clientMutationId]);
      if (receipt.rowCount) {
        if (receipt.rows[0].request_hash !== hash) throw conflict('MUTATION_ID_REUSED', '此变更 ID 已用于不同请求');
        return receipt.rows[0].result_jsonb as SPDocument;
      }
      if (restore ? !row.deleted_at : Boolean(row.deleted_at)) throw errors.missing();
      await this.writeLease(client, actor, id, leaseToken, snapshot, ['project.edit','project.theme'].includes(action) && !snapshot);
      if (Number(row.revision) !== request.expectedRevision) throw conflict('REVISION_CONFLICT', '项目已有更新版本', {expectedRevision: request.expectedRevision, actualRevision: Number(row.revision)});
      let document:SPDocument;try{document=await change(row.document_jsonb,client);}catch(error){if(error instanceof CoreError||error instanceof SyntaxError)throw errors.invalid('文档或操作无效');throw error;}
      const text = documentJSON(document);
      if (leaseToken !== undefined) await this.writeLease(client, actor, id, leaseToken, snapshot);
      await client.query('UPDATE projects SET title=$2,revision=$3,document_jsonb=$4,deleted_at=CASE WHEN $5 THEN clock_timestamp() WHEN $6 THEN NULL ELSE deleted_at END,updated_at=clock_timestamp() WHERE id=$1', [id, document.title, document.revision, text, remove, restore]);
      await this.revision(client, actor, document);
      await this.audit(client, actor, id, action);
      await client.query('INSERT INTO mutation_receipts(project_id,actor_id,client_mutation_id,request_hash,result_jsonb) VALUES($1,$2,$3,$4,$5)', [id, actor.id, request.clientMutationId, hash, text]);
      await enforceStorageQuota(client,actor.id,quota,remove||projectContentBytes(document)<projectContentBytes(row.document_jsonb));
      return document;
    });
  }

  async edit(actor: Actor, id: string, request: Edit) {
    const operations = coreCall(() => cloneJSON(request.operations));
    if (!Array.isArray(operations) || !operations.length || operations.length > 1000 || (request.leaseToken !== undefined && typeof request.leaseToken !== 'string')) throw errors.invalid();
    return this.mutate(actor, id, request, 'project.edit', {operations, ...(request.leaseToken === undefined ? {} : {leaseToken: request.leaseToken})}, document => new DocumentCore(document).edit(operations, {expectedRevision: request.expectedRevision}), {leaseToken: request.leaseToken, snapshot: operations.some(operation => operation?.type === 'replaceContent')});
  }

  async applyTheme(actor:Actor,id:string,request:Mutation&{themeId:string;version:string;hash:string;mode?:'preserve'|'reset'}) {
    requireScope(actor,'themes:read');
    if(typeof request.themeId!=='string'||request.themeId.length>128||typeof request.version!=='string'||request.version.length>64||typeof request.hash!=='string'||!/^sha256:[a-f0-9]{64}$/.test(request.hash)||!['preserve','reset'].includes(request.mode??'preserve'))throw errors.invalid();
    const payload={themeId:request.themeId,version:request.version,hash:request.hash,mode:request.mode??'preserve'};
    return this.mutate(actor,id,request,'project.theme',payload,async(document,client)=>{
      const ref=await new ThemeService(this.db).resolveRef(client,actor,payload);
      let plan;try{plan=await planThemeApplication(document,ref.snapshot,{mode:payload.mode as 'preserve'|'reset'});}catch(error){if(error instanceof CoreError)throw errors.invalid(error.message);throw error;}
      return coreCall(()=>new DocumentCore(document).edit(plan.operations,{expectedRevision:request.expectedRevision}));
    },{leaseToken:request.leaseToken});
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

  async importProject(actor: Actor, {document: input, clientMutationId}: {document: SPDocument;clientMutationId:string}) {
    requireScope(actor,'projects:create');
    if(actor.source==='mcp' && actor.projectAllowlist!=null) throw errors.forbidden();
    if(typeof clientMutationId!=='string'||!clientMutationId.trim()||clientMutationId.length>128)throw errors.invalid();
    const original=coreCall(()=>importDocument(input));
    documentJSON(original);
    const hash=createHash('sha256').update(stable(original)).digest('hex');
    return transaction(this.db,async client=>{
      await this.active(client,actor);
      const quota=await quotaBefore(client,actor.id);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",['sp-import:'+actor.id+':'+clientMutationId]);
      const old=await client.query('SELECT request_hash,project_id,result_jsonb FROM import_receipts WHERE actor_id=$1 AND client_mutation_id=$2',[actor.id,clientMutationId]);
      if(old.rowCount){if(old.rows[0].request_hash!==hash)throw conflict('MUTATION_ID_REUSED','此导入ID已用于不同请求');await this.owned(client,actor,old.rows[0].project_id);return old.rows[0].result_jsonb as SPDocument;}
      const now=new Date().toISOString();
      const document=coreCall(()=>importDocument({...original,id:randomUUID(),revision:0,metadata:{...original.metadata,createdAt:now,updatedAt:now,spCloudImport:{type:'cloud-import',sourceId:original.id,sourceRevision:original.revision,importedAt:now,...((original.metadata as Record<string,unknown>).spCloudImport?{previous:(original.metadata as Record<string,unknown>).spCloudImport}:{})}}}));
      const text=documentJSON(document);
      await client.query('INSERT INTO projects(id,owner_id,title,revision,document_jsonb) VALUES($1,$2,$3,$4,$5)',[document.id,actor.id,document.title,0,text]);
      await this.revision(client,actor,document);await this.audit(client,actor,document.id,'project.import');
      await client.query('INSERT INTO import_receipts(actor_id,client_mutation_id,request_hash,project_id,result_jsonb) VALUES($1,$2,$3,$4,$5)',[actor.id,clientMutationId,hash,document.id,text]);
      await enforceStorageQuota(client,actor.id,quota);
      return document;
    });
  }

  async saveSnapshot(actor: Actor,id: string,request: Mutation & {document:SPDocument}) {
    const incoming=coreCall(()=>importDocument(request.document));
    if(incoming.id!==id||incoming.revision<=request.expectedRevision)throw errors.invalid('快照身份或修订号无效');
    documentJSON(incoming);
    return this.mutate(actor,id,request,'project.snapshot',{document:incoming},current=>{
      const normalized={...incoming,revision:current.revision};
      const validated=new DocumentCore(current).edit([{type:'replaceContent',document:normalized}],{expectedRevision:request.expectedRevision});
      return importDocument({...validated,revision:incoming.revision,metadata:{...validated.metadata,updatedAt:incoming.metadata.updatedAt}});
    },{leaseToken:request.leaseToken,snapshot:true});
  }

  async adminTransfer(actor: Actor,id:string,request: Mutation & {newOwnerId:string}) {
    return this.adminMutation(actor,id,request,'project.transfer',request.newOwnerId);
  }
  async setDeletedAdmin(actor:Actor,id:string,request:Mutation & {deleted?:boolean},deleted?:boolean) {
    return this.adminMutation(actor,id,request,(deleted??request.deleted)?'project.admin_trash':'project.admin_restore');
  }
  private async adminMutation(actor:Actor,id:string,request:Mutation,action:string,newOwnerId?:string){
    if(!uuid.test(id)||!Number.isSafeInteger(request.expectedRevision)||request.expectedRevision<0||typeof request.clientMutationId!=='string'||!request.clientMutationId.trim()||request.clientMutationId.length>128||(newOwnerId!==undefined&&!uuid.test(newOwnerId)))throw errors.invalid();
    return transaction(this.db,async client=>{
      await checkAdminActor(client,actor,true);
      const ownership=(await client.query('SELECT owner_id FROM projects WHERE id=$1',[id])).rows[0];if(!ownership)throw errors.missing();
      await lockStorageQuota(client,[ownership.owner_id,newOwnerId??ownership.owner_id]);const quota=await quotaBefore(client,newOwnerId??ownership.owner_id);
      const result=await client.query<ProjectRow>('SELECT id,owner_id,revision,document_jsonb,deleted_at FROM projects WHERE id=$1 FOR UPDATE',[id]);const row=result.rows[0];if(!row)throw errors.missing();
      const hash=createHash('sha256').update(stable({action,expectedRevision:request.expectedRevision,newOwnerId:newOwnerId??null})).digest('hex');
      const receipt=await client.query('SELECT request_hash,result_jsonb FROM mutation_receipts WHERE project_id=$1 AND actor_id=$2 AND client_mutation_id=$3',[id,actor.id,request.clientMutationId]);
      if(receipt.rowCount){if(receipt.rows[0].request_hash!==hash)throw conflict('MUTATION_ID_REUSED','变更ID已用于不同请求');return receipt.rows[0].result_jsonb;}
      if((await this.lease(client,id))?.active)throw conflict('PROJECT_BUSY','项目有活动编辑租约');
      if(Number(row.revision)!==request.expectedRevision)throw conflict('REVISION_CONFLICT','项目已有新修订');
      if(newOwnerId){const target=await client.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR SHARE",[newOwnerId]);if(!target.rowCount)throw errors.invalid('目标用户无效');}
      const document=new DocumentCore(row.document_jsonb).edit([{type:'updateProject',properties:{title:row.document_jsonb.title}}],{expectedRevision:request.expectedRevision});
      await client.query('UPDATE projects SET owner_id=$2,revision=$3,document_jsonb=$4,deleted_at=CASE WHEN $5 THEN clock_timestamp() WHEN $6 THEN NULL ELSE deleted_at END,updated_at=clock_timestamp() WHERE id=$1',[id,newOwnerId??row.owner_id,document.revision,documentJSON(document),action==='project.admin_trash',action==='project.admin_restore']);
      await this.revision(client,actor,document);await this.audit(client,actor,id,action);
      const metadata={id,ownerId:newOwnerId??row.owner_id,title:document.title,revision:document.revision,deleted:action==='project.admin_trash'||(action==='project.transfer'&&!!row.deleted_at)};
      await client.query('INSERT INTO mutation_receipts(project_id,actor_id,client_mutation_id,request_hash,result_jsonb) VALUES($1,$2,$3,$4,$5)',[id,actor.id,request.clientMutationId,hash,JSON.stringify(metadata)]);
      await enforceStorageQuota(client,newOwnerId??row.owner_id,quota,action==='project.admin_trash');
      return metadata;
    });
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

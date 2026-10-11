import type {FastifyInstance, FastifyRequest} from 'fastify';
import type {AuthService} from '../auth/auth-service.js';
import type {TokenService} from '../auth/token-service.js';
import {ServiceError, transaction, type Actor, type Database} from '../contracts.js';
import {AdminService, checkAdminActor, pagination} from '../services/admin-service.js';

type Mutation = {expectedRevision: number; clientMutationId: string};
type Context = {
  db: Database; auth: AuthService; tokens: TokenService;
  projects: {adminTransfer(actor: Actor, id: string, input: Mutation & {newOwnerId: string}): Promise<unknown>; setDeletedAdmin(actor: Actor, id: string, input: Mutation & {deleted: boolean}): Promise<unknown>};
  actor(request: FastifyRequest): Promise<Actor>; writable(request: FastifyRequest): Promise<Actor>;
  backupService?: {list(actor: Actor): Promise<unknown>; start(actor: Actor): Promise<unknown>; restoreChecks(actor: Actor): Promise<unknown>};
};
const string = {type: 'string', minLength: 1, maxLength: 128};
const password = {type: 'string', minLength: 12, maxLength: 1024};
const uuid = {type: 'string', pattern: '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'};
const revision = {type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER};
const mutation = {expectedRevision: revision, clientMutationId: string};
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({type: 'object', properties, required, additionalProperties: false});
const params = schema({id: uuid}, ['id']);
const query = schema({limit: {type: 'string', pattern: '^[0-9]{1,3}$'}, offset: {type: 'string', pattern: '^[0-9]{1,16}$'}});
function page(request: FastifyRequest) {
  const q = request.query as {limit?: string; offset?: string};
  return pagination({limit: q.limit === undefined ? undefined : Number(q.limit), offset: q.offset === undefined ? undefined : Number(q.offset)});
}
const id = (request: FastifyRequest) => (request.params as {id: string}).id;
const body = <T>(request: FastifyRequest) => request.body as T;

export function registerAdminRoutes(app: FastifyInstance, ctx: Context) {
  const admin = new AdminService(ctx.db);
  const guard = async (actor: Actor, recent = false) => transaction(ctx.db, client => checkAdminActor(client, actor, recent));
  const backups = () => {
    if (!ctx.backupService) throw new ServiceError('BACKUP_UNAVAILABLE', 503, '备份服务尚未配置');
    return ctx.backupService;
  };
  app.get('/api/v1/admin/dashboard', async request => admin.dashboard(await ctx.actor(request)));
  app.get('/api/v1/admin/health', async request => {await guard(await ctx.actor(request)); return {status: 'ready'};});
  app.get('/api/v1/admin/users', {schema: {querystring: query}}, async request => admin.listUsers(await ctx.actor(request), page(request)));
  app.post('/api/v1/admin/users', {schema: {body: schema({username: {type: 'string', minLength: 3, maxLength: 64}, password, role: {type: 'string', enum: ['admin', 'user']}}, ['username', 'password'])}}, async (request, reply) => reply.code(201).send(await ctx.auth.createUser(await ctx.writable(request), body(request))));
  app.delete('/api/v1/admin/users/:id', {schema: {params}}, async request => ctx.auth.deleteUser(await ctx.writable(request), id(request)));
  app.patch('/api/v1/admin/users/:id/status', {schema: {params, body: schema({status: {type: 'string', enum: ['active', 'disabled']}}, ['status'])}}, async request => ctx.auth.setUserStatus(await ctx.writable(request), id(request), body<{status: 'active' | 'disabled'}>(request).status));
  app.patch('/api/v1/admin/users/:id/role', {schema: {params, body: schema({role: {type: 'string', enum: ['admin', 'user']}}, ['role'])}}, async request => ctx.auth.setUserRole(await ctx.writable(request), id(request), body<{role: 'admin' | 'user'}>(request).role));
  app.delete('/api/v1/admin/users/:id/sessions', {schema: {params}}, async request => {await ctx.auth.revokeUserSessions(await ctx.writable(request), id(request)); return {success: true};});
  app.post('/api/v1/admin/users/:id/reset-password', {schema: {params, body: schema({password}, ['password'])}}, async request => ctx.auth.resetUserPassword(await ctx.writable(request), id(request), body<{password: string}>(request).password));
  app.get('/api/v1/admin/projects', {schema: {querystring: schema({...query.properties, trash: {type: 'string', enum: ['true', 'false']}})}}, async request => admin.listProjects(await ctx.actor(request), {...page(request), trash: (request.query as {trash?: string}).trash === 'true'}));
  app.post('/api/v1/admin/projects/:id/transfer', {schema: {params, body: schema({...mutation, newOwnerId: uuid}, ['newOwnerId', 'expectedRevision', 'clientMutationId'])}}, async request => ctx.projects.adminTransfer(await ctx.writable(request), id(request), body(request)));
  app.post('/api/v1/admin/projects/:id/trash', {schema: {params, body: schema(mutation, ['expectedRevision', 'clientMutationId'])}}, async request => ctx.projects.setDeletedAdmin(await ctx.writable(request), id(request), {...body<Mutation>(request), deleted: true}));
  app.post('/api/v1/admin/projects/:id/restore', {schema: {params, body: schema(mutation, ['expectedRevision', 'clientMutationId'])}}, async request => ctx.projects.setDeletedAdmin(await ctx.writable(request), id(request), {...body<Mutation>(request), deleted: false}));
  app.get('/api/v1/admin/mcp/tokens', {schema: {querystring: query}}, async request => {const {limit, offset} = page(request); return (await ctx.tokens.adminList(await ctx.actor(request))).slice(offset, offset + limit);});
  app.post('/api/v1/admin/mcp/tokens/:id/revoke', {schema: {params}}, async request => {const actor = await ctx.writable(request); await ctx.auth.requireReauthentication(actor); return ctx.tokens.adminRevoke(actor, id(request));});
  app.get('/api/v1/admin/audit', {schema: {querystring: query}}, async request => admin.listAudit(await ctx.actor(request), page(request)));
  app.get('/api/v1/admin/settings', async request => admin.getSettings(await ctx.actor(request)));
  app.patch('/api/v1/admin/settings', {schema: {body: schema({siteName: {type: 'string', minLength: 1, maxLength: 100}, announcement: {type: 'string', maxLength: 2000}, maxUploadBytes: {type: 'integer', minimum: 1, maximum: 33554432}, publicRegistration: {const: false}, maintenanceMode: {type: 'boolean'}})}}, async request => admin.setSettings(await ctx.writable(request), body(request)));
  app.get('/api/v1/admin/backups', async request => {const actor = await ctx.actor(request); await guard(actor); return backups().list(actor);});
  app.post('/api/v1/admin/backups', async request => {const actor = await ctx.writable(request); await guard(actor, true); return backups().start(actor);});
  app.post('/api/v1/admin/backups/restore-check', async request => {const actor = await ctx.writable(request); await guard(actor, true); return backups().restoreChecks(actor);});
}

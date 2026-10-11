import type {Pool, PoolClient} from 'pg';

export type Actor = {id: string; role: 'admin' | 'user'; source: 'web' | 'mcp'; sessionId?: string; scopes?: string[]; projectAllowlist?: string[] | null};
export type Database = Pool;
export type Transaction = PoolClient;
export class ServiceError extends Error {
  constructor(public code: string, public status: number, message: string, public details?: Record<string, unknown>) {super(message);}
}
export const errors = {
  unauthorized: () => new ServiceError('UNAUTHENTICATED', 401, '请先登录'),
  forbidden: () => new ServiceError('FORBIDDEN', 403, '无权执行此操作'),
  missing: () => new ServiceError('NOT_FOUND', 404, '项目不存在'),
  invalid: (message = '请求参数无效') => new ServiceError('INVALID_REQUEST', 400, message),
};
export function requireAdmin(actor: Actor) {if (actor.role !== 'admin' || actor.source !== 'web') throw errors.forbidden();}
export function requireScope(actor: Actor, scope: string, projectId?: string) {
  if (actor.source !== 'mcp') return;
  if (!actor.scopes?.includes(scope) || (projectId && actor.projectAllowlist && !actor.projectAllowlist.includes(projectId))) throw errors.forbidden();
}
export async function transaction<T>(db: Database, fn: (client: Transaction) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result;}
  catch (error) {await client.query('ROLLBACK'); throw error;}
  finally {client.release();}
}

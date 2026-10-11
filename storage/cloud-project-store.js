import {importDocument} from '../core/document-core.js';
import {CloudDraftStore} from './cloud-drafts.js';

export class CloudError extends Error {constructor(code,message,status=0){super(message);this.code=code;this.status=status;}}
export function stableJSON(value){if(Array.isArray(value))return '['+value.map(stableJSON).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stableJSON(value[key])).join(',')+'}';return JSON.stringify(value);}

/** Cookie credentials stay in the browser; only explicit CSRF failures permit automatic write retry. */
export class CloudAPI {
 constructor({base='/api/v1',fetch=globalThis.fetch?.bind(globalThis),timeoutMs=15000}={}){this.base=base;this.fetch=fetch;this.timeoutMs=timeoutMs;this.csrfToken=null;this.user=null;}
 async request(path,{method='GET',body,csrfRetry=true}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);
  let response,result;
  try{response=await this.fetch(this.base+path,{method,credentials:'same-origin',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(method==='GET'||!this.csrfToken?{}:{'X-CSRF-Token':this.csrfToken})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal});result=await response.json();}
  catch(error){if(response&&!controller.signal.aborted)throw new CloudError('INVALID_RESPONSE','云端响应无法读取，保存结果未确认。',response.status);throw new CloudError(controller.signal.aborted?'TIMEOUT':'OFFLINE',controller.signal.aborted?'云端请求超时；保存结果未确认，请重试同一份修改。':'无法连接云端；修改仍保留为本地恢复草稿。');}
  finally{clearTimeout(timer);}
  if(!response.ok){const error=result.error||{};if(error.code==='CSRF_INVALID'&&csrfRetry&&path!=='/auth/csrf'){await this.rotateCsrf();return this.request(path,{method,body,csrfRetry:false});}throw new CloudError(error.code||'CLOUD_ERROR',error.message||'云端操作失败',response.status);}
  return result;
 }
 async login(username,password){const result=await this.request('/auth/login',{method:'POST',body:{username,password},csrfRetry:false});this.user=result.user;this.csrfToken=result.csrfToken;return result.user;}
 async rotateCsrf(){if(this.user){const current=await this.request('/auth/me',{csrfRetry:false});if(current.user.id!==this.user.id){this.user=null;this.csrfToken=null;throw new CloudError('ACCOUNT_CHANGED','云端账号已在其他标签页变更，请切换到本地后重新登录；当前草稿保留。',403);}}const result=await this.request('/auth/csrf',{method:'POST',body:{},csrfRetry:false});this.csrfToken=result.csrfToken;return result.csrfToken;}
 async restoreSession(){const result=await this.request('/auth/me');this.user=result.user;this.csrfToken=result.csrfToken;if(!this.csrfToken)await this.rotateCsrf();return this.user;}
 async logout(){await this.request('/auth/logout',{method:'POST',body:{}});this.user=null;this.csrfToken=null;}
}

export function migrationContent(document){const doc=importDocument(document);delete doc.id;delete doc.revision;delete doc.metadata.createdAt;delete doc.metadata.updatedAt;delete doc.metadata.spCloudImport;return stableJSON(doc);}

export class CloudProjectStore {
 constructor({api,accountId=api?.user?.id,drafts=new CloudDraftStore()}={}){if(!api||!accountId)throw new Error('云端存储需要已登录账号');this.api=api;this.accountId=accountId;this.drafts=drafts;this.storage='cloud';this.name='cloud:'+accountId;this.leaseMs=60000;this.opened=new Map();this.locks=new Map();this.mutations=new Map();this.imports=new Map();}
 async open(){await this.drafts.open();return this;}
 close(){this.drafts.close();}
 record(document,metadata={}){const doc=importDocument(document);return {id:doc.id,document:doc,modifiedAt:Date.parse(metadata.updatedAt||doc.metadata.updatedAt),openedAt:this.opened.get(doc.id)||Date.parse(metadata.updatedAt||doc.metadata.updatedAt),deletedAt:metadata.deletedAt?Date.parse(metadata.deletedAt):null,storage:'cloud'};}
 async list({trash=false}={}){
  const rows=await this.api.request('/projects'+(trash?'?trash=true':'')),records=new Array(rows.length);let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,rows.length)},async()=>{while(cursor<rows.length){const index=cursor++,meta=rows[index];try{records[index]=this.record(await this.api.request('/projects/'+encodeURIComponent(meta.id)+'/document'+(trash?'?trash=true':'')),meta);}catch(error){if(error.code!=='NOT_FOUND')throw error;}}}));
  return records.filter(Boolean);
 }
 async get(id){try{return this.record(await this.api.request('/projects/'+encodeURIComponent(id)+'/document'));}catch(error){if(error.code!=='NOT_FOUND')throw error;const rows=await this.api.request('/projects?trash=true'),meta=rows.find(row=>row.id===id);if(!meta)return null;return this.record(await this.api.request('/projects/'+encodeURIComponent(id)+'/document?trash=true'),meta);}}
 async create(document){const doc=importDocument(document),key=stableJSON(doc);let request=this.imports.get(key);if(!request){request={document:doc,clientMutationId:crypto.randomUUID()};this.imports.set(key,request);}const saved=importDocument(await this.api.request('/projects/import',{method:'POST',body:request}));if(saved.id===doc.id||migrationContent(saved)!==migrationContent(doc))throw new CloudError('IMPORT_READBACK_MISMATCH','云端导入数据与来源不一致；原本地项目仍保留。');const readback=await this.get(saved.id);if(!readback||stableJSON(readback.document)!==stableJSON(saved))throw new CloudError('IMPORT_READBACK_MISMATCH','无法确认云端导入回读，请保留来源项目后重试。');this.imports.delete(key);return readback;}
 async markOpened(id){this.opened.set(id,Date.now());return true;}
 async acquire(id,owner,{takeover=false}={}){if(takeover)throw new CloudError('PROJECT_BUSY','云端不允许抢占活动租约，请等待写入方释放。',409);try{const lease=await this.api.request('/projects/'+encodeURIComponent(id)+'/lease',{method:'POST',body:{holder:owner}});const lock={id,owner,token:lease.leaseToken,expiresAt:Date.parse(lease.expiresAt)};this.locks.set(id,lock);return lock;}catch(error){if(error.code==='PROJECT_BUSY')return null;throw error;}}
 async renew(lock){const lease=await this.api.request('/projects/'+encodeURIComponent(lock.id)+'/lease/renew',{method:'POST',body:{leaseToken:lock.token}});const renewed={...lock,expiresAt:Date.parse(lease.expiresAt)};this.locks.set(lock.id,renewed);return renewed;}
 async release(lock){if(!lock)return;try{await this.api.request('/projects/'+encodeURIComponent(lock.id)+'/lease',{method:'DELETE',body:{leaseToken:lock.token}});return true;}finally{if(this.locks.get(lock.id)?.token===lock.token)this.locks.delete(lock.id);}}
 async captureDraft(document,sourceRevision){return this.drafts.save(this.accountId,document,{sourceRevision});}
 async save(document,{expectedRevision,lock}={}){
  const doc=importDocument(document);
  if(!lock||lock.id!==doc.id)throw new CloudError('LOCK_LOST','当前云端项目没有写入权',409);
  if(doc.revision===expectedRevision){const saved=await this.get(doc.id);if(saved&&stableJSON(saved.document)===stableJSON(doc))return saved;throw new CloudError('REVISION_CONFLICT','云端内容已变化，当前草稿仍保留。',409);}
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||doc.revision<=expectedRevision)throw new CloudError('INVALID_REVISION','快照修订必须大于已确认云端修订');
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableJSON({document:doc,expectedRevision,leaseToken:lock.token}))),fingerprint=Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');let pending=this.mutations.get(fingerprint);
  if(!pending){const existing=(await this.drafts.list(this.accountId,doc.id)).find(record=>record.mutation?.fingerprint===fingerprint),failure=existing?.mutation?.failure;pending={request:{document:doc,expectedRevision,leaseToken:lock.token,clientMutationId:existing?.mutation?.clientMutationId||crypto.randomUUID()},error:failure?new CloudError(failure.code,failure.message,failure.status):null,previousBranch:existing?.key[3]};this.mutations.set(fingerprint,pending);}
  if(pending.error)throw pending.error;
  await this.drafts.save(this.accountId,doc,{sourceRevision:expectedRevision,mutation:{fingerprint,clientMutationId:pending.request.clientMutationId}});
  let saved;
  try{saved=importDocument(await this.api.request('/projects/'+encodeURIComponent(doc.id)+'/snapshot',{method:'PUT',body:pending.request}));}
  catch(error){if(error.status>=400&&error.status<500){pending.error=error;await this.drafts.save(this.accountId,doc,{sourceRevision:expectedRevision,mutation:{fingerprint,clientMutationId:pending.request.clientMutationId,failure:{code:error.code,message:error.message,status:error.status}}}).catch(()=>{});}throw error;}
  if(saved.id!==doc.id||saved.revision!==doc.revision)throw new CloudError('INVALID_RESPONSE','云端快照修订不匹配，保存结果未确认。');
  this.mutations.delete(fingerprint);
  try{await this.drafts.clearSaved(this.accountId,doc.id,saved.revision);if(pending.previousBranch)await this.drafts.clearSaved(this.accountId,doc.id,saved.revision,pending.previousBranch);}catch(error){this.draftCleanupError=error;}
  return this.record(saved);
 }
 async setDeleted(id,deleted,{owner}={}){const record=await this.get(id);if(!record)throw new CloudError('NOT_FOUND','项目不存在',404);const lease=this.locks.get(id);const body={expectedRevision:record.document.revision,clientMutationId:crypto.randomUUID(),...(lease&&lease.owner===owner?{leaseToken:lease.token}:{})};await this.api.request('/projects/'+encodeURIComponent(id)+(deleted?'':'/restore'),{method:deleted?'DELETE':'POST',body});return true;}
 async migrate(localStore,id){const local=await localStore.get(id);if(!local||local.deletedAt)throw new CloudError('NOT_FOUND','本地项目不存在');const saved=await this.create(local.document);const source=await localStore.get(id);if(!source||stableJSON(source.document)!==stableJSON(local.document))throw new CloudError('LOCAL_CHANGED','本地项目在迁移期间发生修改，请重新核对；云端副本已经保留。');await this.drafts.markMigration(this.accountId,local.document,saved.id);return saved;}
 async recoverDraft(record){if(record.accountId!==this.accountId)throw new CloudError('FORBIDDEN','不能恢复其他账号的草稿',403);const doc=structuredClone(record.document);doc.title+=' · 云端恢复副本';const saved=await this.create(doc);await this.drafts.remove(this.accountId,record.key);return saved;}
}

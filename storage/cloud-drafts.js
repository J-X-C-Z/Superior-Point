import {importDocument} from '../core/document-core.js';

/** Drafts are recoverable local copies, never the cloud authority. Account IDs isolate readers. */
export class CloudDraftStore {
 constructor({name='superior-point-cloud-drafts-v1'}={}){this.name=name;this.branch=crypto.randomUUID();this.db=null;this.opening=null;}
 async open(){
  if(this.db)return this;
  if(!this.opening)this.opening=new Promise((resolve,reject)=>{const request=indexedDB.open(this.name,2);request.onupgradeneeded=()=>{for(const name of ['drafts','migrations'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'key'});};request.onsuccess=()=>{this.db=request.result;this.db.onversionchange=()=>this.close();resolve(this);};request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('请关闭旧版草稿标签页后重试'));}).finally(()=>this.opening=null);
  return this.opening;
 }
 close(){this.db?.close();this.db=null;}
 async tx(mode,operation,name='drafts'){await this.open();return new Promise((resolve,reject)=>{const tx=this.db.transaction(name,mode);let result;tx.oncomplete=()=>resolve(structuredClone(result));tx.onabort=tx.onerror=()=>reject(tx.error||new Error('本地恢复草稿写入失败'));operation(tx.objectStore(name),value=>result=value);});}
 async save(accountId,document,{sourceRevision,mutation}={}){
  const snapshot=importDocument(document);
  if(!accountId||!Number.isSafeInteger(sourceRevision)||sourceRevision<0)throw new Error('草稿缺少账号或来源修订');
  const record={key:[accountId,snapshot.id,sourceRevision,this.branch],accountId,projectId:snapshot.id,sourceRevision,document:snapshot,updatedAt:Date.now(),...(mutation?{mutation:structuredClone(mutation)}:{})};
  return this.tx('readwrite',(store,done)=>{const request=store.get(record.key);request.onsuccess=()=>{const old=request.result;if(old&&old.document.revision>snapshot.revision){done(old);return;}store.put(record);done(record);};});
 }
 async list(accountId,projectId){return this.tx('readonly',(store,done)=>{const request=store.getAll();request.onsuccess=()=>done(request.result.filter(record=>record.accountId===accountId&&(!projectId||record.projectId===projectId)).sort((a,b)=>b.updatedAt-a.updatedAt));});}
 async clearSaved(accountId,projectId,revision,branch=this.branch){return this.tx('readwrite',(store,done)=>{const request=store.getAll();request.onsuccess=()=>{for(const record of request.result)if(record.accountId===accountId&&record.projectId===projectId&&record.key[3]===branch&&record.document.revision<=revision)store.delete(record.key);done(true);};});}
 async remove(accountId,key){if(key?.[0]!==accountId)throw new Error('不能删除其他账号的草稿');return this.tx('readwrite',(store,done)=>{store.delete(key);done(true);});}
 async markMigration(accountId,source,cloudId){const record={key:[accountId,source.id],accountId,sourceProjectId:source.id,sourceRevision:source.revision,cloudProjectId:cloudId,verifiedAt:Date.now()};return this.tx('readwrite',(store,done)=>{store.put(record);done(record);},'migrations');}
 async migrations(accountId){return this.tx('readonly',(store,done)=>{const request=store.getAll();request.onsuccess=()=>done(request.result.filter(record=>record.accountId===accountId));},'migrations');}
}

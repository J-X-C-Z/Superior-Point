import {CloudError} from './cloud-project-store.js';

/** Project identities include their source; documents remain owned by the existing stores. */
export class WorkspaceLibrary {
 constructor({localStore,getCloudStore=()=>null}){this.localStore=localStore;this.getCloudStore=getCloudStore;}
 entry(source,record,store){return {source,id:record.id,accountId:source==='cloud'?store.accountId:null,record};}
 cloudStore(){const store=this.getCloudStore();if(!store)throw new CloudError('AUTH_REQUIRED','请先登录云端账号');this.checkCloud(store);return store;}
 checkCloud(store){if(this.getCloudStore()!==store||store.api?.user?.id!==store.accountId)throw new CloudError('ACCOUNT_CHANGED','云端账号或工作区已变化，本次云端结果未确认，请刷新项目库；本地项目仍保留。',403);}
 async list(options={}){
  const cloud=this.getCloudStore();
  const [localRecords,remote,recovery]=await Promise.all([
   this.localStore.list(options),
   (async()=>{if(!cloud)return {records:[],error:null};try{this.checkCloud(cloud);const records=await cloud.list(options);this.checkCloud(cloud);return {records,error:null};}catch(error){return {records:[],error};}})(),
   (async()=>{if(!cloud?.drafts)return {drafts:[],migrations:[]};try{this.checkCloud(cloud);const [drafts,migrations]=await Promise.all([cloud.drafts.list(cloud.accountId),cloud.drafts.migrations(cloud.accountId)]);this.checkCloud(cloud);return {drafts,migrations};}catch(error){return {drafts:[],migrations:[],error};}})()
  ]);
  // Local listing can finish later than the cloud request; recheck before exposing cloud records.
  if(cloud&&!remote.error)try{this.checkCloud(cloud);}catch(error){remote.records=[];remote.error=error;}
  if(cloud)try{this.checkCloud(cloud);}catch(error){recovery.drafts=[];recovery.migrations=[];remote.records=[];remote.error=error;}
  const localEntries=localRecords.map(record=>{const entry=this.entry('local',record,this.localStore),migration=recovery.migrations.find(item=>item.sourceProjectId===record.id);return {...entry,syncState:migration?(migration.sourceRevision===record.document.revision?'uploaded':'local-changed'):'local',...(migration?{cloudProjectId:migration.cloudProjectId}: {})};});
  return {entries:[...localEntries,...remote.records.map(record=>({...this.entry('cloud',record,cloud),syncState:'cloud',hasDraft:recovery.drafts.some(draft=>draft.projectId===record.id)}))],drafts:recovery.drafts,cloudError:remote.error||recovery.error||null};
 }
 storeFor(entry){if(entry.source==='local')return this.localStore;if(entry.source!=='cloud')throw new TypeError('未知项目来源');const store=this.cloudStore();if(entry.accountId!==store.accountId)throw new CloudError('ACCOUNT_CHANGED','该项目属于其他云端账号，请刷新项目库。',403);return store;}
 async migrate(entry){if(entry.source!=='local')throw new TypeError('只能上传本地项目');const store=this.cloudStore(),record=await store.migrate(this.localStore,entry.id);this.checkCloud(store);return this.entry('cloud',record,store);}
}

/** Roadmap terminology; the existing WorkspaceLibrary name remains compatible. */
export {WorkspaceLibrary as UnifiedProjectLibrary};
export function projectRef(entry){return {source:entry.source,projectId:entry.id,...(entry.accountId?{accountId:entry.accountId}:{})};}

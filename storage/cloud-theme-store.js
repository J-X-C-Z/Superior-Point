import {createThemeRef,importTheme,validateThemeRef} from '../core/theme-schema.js';
import {CloudError} from './cloud-project-store.js';

export class CloudThemeStore {
 constructor({api,accountId=api?.user?.id}){this.api=api;this.accountId=accountId;this.storage='cloud';this.pending=new Map();}
 check(){if(!this.accountId||this.api.user?.id!==this.accountId)throw new CloudError('ACCOUNT_CHANGED','主题库账号已变更，请重新打开。',403);}
 async request(path,options){this.check();const result=await this.api.request(path,options);this.check();return result;}
 async list({trash=false}={}){return (await this.request('/themes'+(trash?'?archived=true':''))).map(record=>({...record,deletedAt:record.deletedAt||(record.archived?record.updatedAt:null),storage:'cloud',accountId:this.accountId}));}
 async get(id,version){const detail=await this.request('/themes/'+encodeURIComponent(id)+(version?'/versions/'+encodeURIComponent(version):''));if(version&&detail.snapshot)return {id,version,ref:detail,storage:'cloud',accountId:this.accountId};return {...detail,deletedAt:detail.deletedAt||(detail.archived?detail.updatedAt:null),storage:'cloud',accountId:this.accountId};}
 async save(raw,{expectedRevision=null}={}){
  const theme=importTheme(raw),ref=await createThemeRef(theme);this.check();const importing=expectedRevision===null,path=importing?'/themes/import':'/themes/'+encodeURIComponent(theme.id)+'/publish';
  const key=JSON.stringify([this.accountId,path,ref.hash,expectedRevision]);let body=this.pending.get(key);if(!body){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)),hex=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');const clientMutationId=hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-8'+hex.slice(17,20)+'-'+hex.slice(20,32);body={theme,clientMutationId,...(importing?{}:{expectedRevision})};this.pending.set(key,body);}
  const result=await this.request(path,{method:'POST',body}),readback=await this.get(result.id);const expected=await createThemeRef({...theme,id:result.id});
  if(!(await validateThemeRef(readback.ref)).valid||readback.ref.hash!==expected.hash)throw new CloudError('THEME_READBACK_MISMATCH','云端主题回读不一致；本地原件仍保留。');this.pending.delete(key);return readback;
 }
 async setDeleted(id,deleted,{expectedRevision}={}){return this.request('/themes/'+encodeURIComponent(id),{method:'PATCH',body:{archived:!!deleted,expectedRevision,clientMutationId:crypto.randomUUID()}});}
 async favorite(id,enabled){return this.request('/themes/'+encodeURIComponent(id)+'/favorite',{method:enabled?'POST':'DELETE',body:{}});}
}

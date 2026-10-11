/** A notification subscription; it never reads, merges, saves or replaces a document. */
export function subscribeProjectEvents({api,projectId,revision=0,onRevision,onState=()=>{},EventSource=globalThis.EventSource}={}){
 const accountId=api?.user?.id;if(!accountId||typeof projectId!=='string'||!Number.isSafeInteger(revision)||revision<0||typeof onRevision!=='function')throw Error('Revision subscription requires an account, project and callback');
 if(typeof EventSource!=='function'){onState('unavailable');return {close(){}};}
 const source=new EventSource((api.base??'/api/v1')+'/projects/'+encodeURIComponent(projectId)+'/events?accountId='+encodeURIComponent(accountId));let closed=false,last=revision,lastDeleted=false;
 const close=()=>{if(closed)return;closed=true;source.close();};
 const active=()=>{if(closed)return false;if(api.user?.id!==accountId){close();onState('account-changed');return false;}return true;};
 source.onopen=()=>{if(active())onState('connected');};source.onerror=()=>{if(active())onState('reconnecting');};
 source.addEventListener('revision',event=>{if(!active())return;let data;try{data=JSON.parse(event.data);}catch{return;}if(data.projectId!==projectId||!Number.isSafeInteger(data.revision)||data.revision<0||typeof data.deleted!=='boolean')return;if(data.revision<last||data.revision===last&&data.deleted===lastDeleted)return;last=data.revision;lastDeleted=data.deleted;onRevision({projectId,revision:last,deleted:lastDeleted});});
 source.addEventListener('access-revoked',()=>{if(active()){close();onState('access-revoked');}});
 source.addEventListener('unavailable',()=>{if(active())onState('reconnecting');});
 return {close};
}

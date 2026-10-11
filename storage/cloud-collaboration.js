import {importDocument} from '../core/document-core.js';
import {stableJSON,CloudError} from './cloud-project-store.js';
const equal=(a,b)=>stableJSON(a)===stableJSON(b);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keyed=value=>Array.isArray(value)&&value.every(item=>object(item)&&typeof item.id==='string')&&new Set(value.map(item=>item.id)).size===value.length;

/** Merge edits to separate fields/objects; never guess when both writers change the same value. */
export function mergeCloudDocument(base,local,remote){
 if(base.id!==local.id||base.id!==remote.id)throw new CloudError('COLLABORATION_CONFLICT','协同文稿身份不一致，请保留备份。');
 function merge(before,mine,theirs,path){
  if(equal(mine,before))return structuredClone(theirs);
  if(equal(theirs,before)||equal(mine,theirs))return structuredClone(mine);
  if(object(before)&&object(mine)&&object(theirs)){
   const result={};
   for(const key of new Set([...Object.keys(before),...Object.keys(mine),...Object.keys(theirs)])){
    const value=merge(before[key],mine[key],theirs[key],path+'.'+key);
    if(value!==undefined)result[key]=value;
   }
   return result;
  }
  if(keyed(before)&&keyed(mine)&&keyed(theirs)){
   const ids=items=>items.map(item=>item.id),order=merge(ids(before),ids(mine),ids(theirs),path+'.顺序');
   const maps=[before,mine,theirs].map(items=>new Map(items.map(item=>[item.id,item])));
   const values=new Map([...new Set([...before,...mine,...theirs].map(item=>item.id))].map(id=>[id,merge(...maps.map(map=>map.get(id)),path+'.'+id)]));
   return order.map(id=>values.get(id)).filter(value=>value!==undefined);
  }
  throw new CloudError('COLLABORATION_CONFLICT','你与 AI 修改了同一处内容（'+path+'）。当前修改已保留，请导出备份或恢复为独立项目。');
 }
 const strip=document=>{const value=structuredClone(document);delete value.revision;delete value.metadata.updatedAt;return value;};
 const merged=merge(strip(base),strip(local),strip(remote),'文稿');
 const changed=!equal(merged,strip(remote));
 merged.revision=remote.revision+(changed?1:0);
 merged.metadata.updatedAt=changed?new Date().toISOString():remote.metadata.updatedAt;
 return importDocument(merged);
}

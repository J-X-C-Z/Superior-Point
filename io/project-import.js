import {importDocument, newId} from '../core/document-core.js';
import {importHTML} from './html.js';
import {editorToCanonical} from '../adapters/editor-v038-model.js';
import {importReferenceV032HTML,restoreReferenceV032} from '../adapters/reference-v032.js';

export const MAX_IMPORT_BYTES=25*1024*1024;
const tooLarge=()=>new Error('文件超过 25 MiB，未导入。请缩小文件后重试。');

/** Read native File streams with a byte budget; never insert imported markup into a DOM. */
async function readText(file){
 if(file.size>MAX_IMPORT_BYTES)throw tooLarge();
 if(typeof file.stream==='function'){
  const reader=file.stream().getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0,text='';
  try{
   for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_IMPORT_BYTES)throw tooLarge();text+=decoder.decode(value,{stream:true});}
   return text+decoder.decode();
  }catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
 }
 // Compatibility for File implementations without streams and programmatic imports.
 // Check actual UTF-8 bytes as well as declared size, which callers can misreport.
 const text=await file.text();
 if(typeof text!=='string')throw new Error('文件内容不是文本。');
 if(text.length>MAX_IMPORT_BYTES||new TextEncoder().encode(text).byteLength>MAX_IMPORT_BYTES)throw tooLarge();
 return text;
}

function schemaReason(reason){
 const exact={
  'Document must be an object':'文档必须是 JSON 对象', 'Invalid format':'format 必须是 superior-point',
  'Unsupported schemaVersion':'schemaVersion 仅支持 1，或可迁移的 0', 'Missing document id':'缺少文档 id',
  'title must be a string':'title 必须是字符串', 'revision must be a nonnegative safe integer':'revision 必须是非负安全整数',
  'Invalid canvas dimensions':'canvas.width 和 canvas.height 必须是正数', 'assets must be an array':'assets 必须是数组',
  'Invalid metadata timestamps':'metadata.createdAt 和 updatedAt 必须是有效时间', 'extensions must be an object':'extensions 必须是对象',
  'slides must be an array':'slides 必须是数组', 'elements must be an array':'elements 必须是数组',
  'animations must be an array':'animations 必须是数组', 'Invalid slide':'幻灯片必须是对象', 'Invalid element':'元素必须是对象'
 };
 if(exact[reason])return exact[reason];
 if(reason.startsWith('Invalid element geometry: '))return '元素坐标 x/y/w/h 必须是有限数字，宽高不能为负：'+reason.slice('Invalid element geometry: '.length);
 if(reason.startsWith('Missing or duplicate '))return '缺少或重复的 ID：'+reason.slice('Missing or duplicate '.length);
 if(reason.startsWith('Missing asset for element: '))return '元素引用的 assetId 不存在：'+reason.slice('Missing asset for element: '.length);
 if(reason.startsWith('Missing type: '))return '元素缺少 type：'+reason.slice('Missing type: '.length);
 if(reason.startsWith('Invalid animation fields: '))return '动画字段类型或数值无效：'+reason.slice('Invalid animation fields: '.length);
 if(reason.startsWith('Animation target missing: '))return '动画目标元素不存在：'+reason.slice('Animation target missing: '.length);
 return reason;
}
export function importErrorMessage(error){
 if(error?.details?.errors?.length)return '文件不符合 SP 文档结构：'+error.details.errors.map(schemaReason).join('；');
 if(error?.code==='INVALID_JSON')return '文件包含不安全或过深的 JSON 数据：'+error.message;
 return error?.message||'文件导入失败，请重试。';
}

export async function readImportFile(file,{allowEditorCandidate=false}={}){
 const name=typeof file?.name==='string'?file.name:'';
 if(!/\.(json|html?)$/i.test(name))throw new Error('仅支持 SP canonical JSON 备份或 SP 导出的 HTML（.json / .html / .htm），不支持普通网页或 v0.32 编辑器参考文件。');
 let text;
 try{text=await readText(file);}catch(error){throw new Error('无法读取文件：'+importErrorMessage(error),{cause:error});}
 const format=/\.html?$/i.test(name)?'html':'json';
 let payload=text;
 if(format==='html'){
  const matches=[...text.matchAll(/<script\s+id="sp-document"\s+type="application\/json"\s*>([\s\S]*?)<\/script\s*>/gi)];
  if(matches.length===0&&allowEditorCandidate){
   try{const project=restoreReferenceV032(importReferenceV032HTML(text));return {document:editorToCanonical(project),source:{fileName:name,fileFormat:format,schemaVersion:1,editorCandidate:'native-v1-compatible'},migrated:false,candidateImported:true};}
   catch(error){throw new Error('HTML没有受支持的SP文档数据，编辑器程序本身不能作为项目导入：'+importErrorMessage(error));}
  }
  if(matches.length!==1)throw new Error('此 HTML 必须包含且仅包含一个 SP 文档数据块（sp-document）。普通网页和 v0.32 编辑器参考文件不能导入。');
  payload=matches[0][1];
 }
 let raw;
 try{raw=JSON.parse(payload);}catch(error){throw new Error('JSON 已损坏或不是有效 JSON，请重新导出文件。解析原因：'+error.message,{cause:error});}
 if(allowEditorCandidate&&raw?.version===1&&Array.isArray(raw.slides)&&raw.slides.every(s=>Array.isArray(s?.objects)))return {document:editorToCanonical(raw),source:{fileName:name,fileFormat:format,schemaVersion:1,editorCandidate:'native-v1-compatible'},migrated:false,candidateImported:true};
 if(raw?.format!=='superior-point')throw new Error('文件不是 SP canonical 文档：format 必须是 superior-point。');
 if(raw.schemaVersion!==0&&raw.schemaVersion!==1)throw new Error(`不支持此文件的 schemaVersion（${String(raw.schemaVersion)}）。目前支持 1，以及原型 schemaVersion 0 的迁移；未来版本和 v0.32 编辑器参考文件不能导入。`);
 try{
  const document=importDocument(raw);
  // Keep the HTML importer's existing resource policy, including embedded image validation.
  if(format==='html')importHTML(text);
  return {document,source:{fileName:name,fileFormat:format,schemaVersion:raw.schemaVersion},migrated:raw.schemaVersion===0};
 }catch(error){
  if(error?.details||error?.code)throw new Error(importErrorMessage(error),{cause:error});
  throw new Error('HTML 安全校验未通过，未导入。仅支持安全的内嵌资源：'+error.message,{cause:error});
 }
}

/** New identity and provenance; existing metadata, unknown content, and past import history survive. */
export function createImportDocument(imported,titles=[]){
 const doc=importDocument(imported.document),source={...imported.source,projectId:doc.id,title:doc.title,revision:doc.revision,createdAt:doc.metadata.createdAt,updatedAt:doc.metadata.updatedAt};
 const base=(doc.title.trim()||'未命名演示文稿')+' · 导入副本',taken=new Set(titles);
 let title=base,index=2;while(taken.has(title))title=base+' '+index++;
 const previous=doc.metadata.spImport,now=new Date().toISOString();
 doc.id=newId();doc.title=title;doc.revision=0;doc.metadata.createdAt=now;doc.metadata.updatedAt=now;
 doc.metadata.spImport={type:'independent-import',importedAt:now,source,migrated:imported.migrated,...(previous===undefined?{}:{previous})};
 return importDocument(doc);
}

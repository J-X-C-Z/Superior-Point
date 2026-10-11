/** v0.39 handed-over editor integration in an opaque-origin iframe. Parent Core is authoritative. */
import {editorCandidateHTML} from '../vendor/editor-integrated.js';
import {canonicalToEditor,editorToCanonical} from '../adapters/editor-v038-model.js';
const detached=value=>JSON.parse(JSON.stringify(value));
const messageError=error=>error?.message||String(error);
export function createLegacyEditorAdapter({toLegacyDocument=canonicalToEditor,commitLegacyDocument,onImportFile,onExport}={}){
 return {candidate:true,async mount(context){
  const {container}=context,dom=container.ownerDocument,host=dom.defaultView;
  if(!host)throw new Error('候选编辑器需要浏览器窗口');
  const channel=host.crypto?.randomUUID?.()||`sp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let latest=detached(context.document),readOnly=!!context.readOnly,destroyed=false,initialized=false;
  let rejectedSnapshot=null,recoveryError=null;
  let handling=0,epoch=1,nextRequest=0,lastSequence=0,readyResolve,readyReject;
  const requests=new Map();
  const iframe=dom.createElement('iframe');
  iframe.className='sp-legacy-editor-frame';iframe.title='SuperiorPoint v0.39 集成编辑器';
  iframe.setAttribute('sandbox','allow-scripts allow-downloads');
  // Opaque srcdoc needs an explicit fullscreen origin wildcard; no other capability is delegated.
  iframe.setAttribute('allow','fullscreen *');iframe.setAttribute('allowfullscreen','');
  iframe.setAttribute('referrerpolicy','no-referrer');
  Object.assign(iframe.style,{width:'100%',height:'100%',minHeight:'0',display:'block',border:'0',background:'#f7f8fb'});
  const send=(type,data={})=>{
   if(destroyed)throw new Error('编辑器会话已关闭');
   iframe.contentWindow.postMessage({spCandidate:1,channel,type,...data},'*');
  };
  const rpc=(type,data={})=>new Promise((resolve,reject)=>{
   if(destroyed){reject(new Error('编辑器会话已关闭'));return;}
   const requestId=++nextRequest;
   const timer=host.setTimeout(()=>{requests.delete(requestId);reject(new Error('编辑器响应超时，请保留项目并重试'));},20000);
   requests.set(requestId,{resolve,reject,timer});send(type,{...data,requestId});
  });
  const projectState=()=>{const snapshot=latest.extensions?.theme?.ref?.snapshot;return {project:toLegacyDocument(latest),themeEntry:snapshot?{name:snapshot.name,version:snapshot.version}:null,revision:latest.revision,readOnly,epoch,history:context.getHistoryState?.()||{canUndo:true,canRedo:true}};};
  const notice=(text,error=true)=>send('notice',{text,error});
  const applyResult=result=>{
   if(result&&typeof result==='object'&&Array.isArray(result.slides))latest=detached(result);
  };
  const rejectEdit=(message,error)=>{
   rejectedSnapshot=detached(message.project);recoveryError=new Error('修改未提交，已保留恢复数据。请使用上方恢复或备份。'+messageError(error));
   readOnly=true;context.onCommitRejected?.(recoveryError);
   epoch++;
   send('reject',{...projectState(),rejectedProject:detached(message.project),sequence:message.sequence,error:messageError(error)});
  };
  const handler=async event=>{
   const message=event.data;
   // Opaque srcdoc origin is "null". Never use origin alone to authenticate it.
   if(destroyed||event.source!==iframe.contentWindow||!message||message.spCandidate!==1||message.channel!==channel)return;
   try{
    if(message.type==='ready'){
     if(initialized)return;initialized=true;
     await rpc('initialize',projectState());readyResolve();return;
    }
    if(message.type==='response'){
     const request=requests.get(message.requestId);if(!request)return;
     requests.delete(message.requestId);host.clearTimeout(request.timer);
     if(message.error)request.reject(new Error(message.error));else request.resolve(message.value);return;
    }
    if(message.type==='fatal'){readyReject(new Error(message.error||'候选编辑器初始化失败'));return;}
    if(!initialized)return;
    if(message.type==='edit'){
     if(message.epoch!==epoch){rejectEdit(message,new Error('编辑会话已更新，修改已保留用于恢复'));return;}
     if(readOnly){rejectEdit(message,new Error('项目当前只读'));return;}
     if(!Number.isSafeInteger(message.sequence)||message.sequence<=lastSequence){rejectEdit(message,new Error('编辑序列重复或无效'));return;}
     if(message.expectedRevision!==latest.revision){rejectEdit(message,new Error('项目修订已更新，请重新编辑'));return;}
     handling++;
     try{
      const base=detached(latest);
      const result=commitLegacyDocument?commitLegacyDocument(detached(message.project),{document:base,expectedRevision:message.expectedRevision,onEdit:context.onEdit}):context.onEdit([{type:'replaceContent',document:editorToCanonical(detached(message.project),{baseDocument:base})}],message.expectedRevision);
      if(result?.then)throw new Error('候选文档提交回调必须同步返回权威文档');
      applyResult(result);lastSequence=message.sequence;
      if(latest.revision<=message.expectedRevision)throw new Error('文档提交未返回新的权威修订');
      send('ack',{sequence:message.sequence,revision:latest.revision,epoch,history:context.getHistoryState?.()||{canUndo:true,canRedo:true}});
     }catch(error){rejectEdit(message,error);}finally{handling--;}
     return;
    }
    if(message.type==='themes'){
     if(message.epoch!==epoch)throw new Error('主题库请求来自过期编辑会话');
     if(readOnly)throw new Error('项目当前只读');
     if(message.expectedRevision!==latest.revision)throw new Error('项目修订已更新，请重新打开主题库');
     if(typeof context.onThemes!=='function'){notice('主题库入口尚未接入工作台。');return;}
     await context.onThemes();return;
    }
    if(message.epoch!==epoch)return;
    if(message.type==='recovery'){rejectedSnapshot=detached(message.project);recoveryError=new Error(message.error||'最后的修改未提交，已保留恢复数据');readOnly=true;context.onCommitRejected?.(recoveryError);return;}
    if(message.type==='undo'||message.type==='redo'){
     if(readOnly)throw new Error('项目当前只读');
     handling++;
     try{applyResult(await context[message.type==='undo'?'onUndo':'onRedo']?.());}
     finally{handling--;}
     epoch++;send('update',projectState());return;
    }
    if(message.type==='home'){await context.onHome?.();return;}
    if(message.type==='save'){
     await context.onSave?.();notice('已保存到本地。',false);return;
    }
    if(message.type==='import'){
     const callback=context.onImportFile||onImportFile;
     if(!callback)throw new Error('请用上方工作台的“打开本地文件”导入为独立项目。');
     await callback(message.file);return;
    }
    if(message.type==='export'){
     const callback=context.onExport||onExport;
     if(!callback)throw new Error('请用上方工作台导出 HTML 或 JSON 备份。');
     await callback(message.format||'html');return;
    }
   }catch(error){if(!initialized)readyReject(error);else notice(messageError(error));}
  };
  host.addEventListener('message',handler);
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const readyTimer=host.setTimeout(()=>readyReject(new Error('候选编辑器未能启动，请保留项目并重试')),20000);
  iframe.srcdoc=editorCandidateHTML.replace('__SP_BRIDGE_CHANNEL__',channel);
  container.replaceChildren(iframe);
  const api={
   update(document){
    if(destroyed)return;
    const next=detached(document);
    if(JSON.stringify(next)===JSON.stringify(latest))return;
    latest=next;
    if(handling||!initialized||rejectedSnapshot)return;
    epoch++;send('update',projectState());
   },
   setWorkspaceState(state){if(initialized&&!destroyed)send('workspaceState',{state});},
   setReadOnly(value){readOnly=rejectedSnapshot?true:!!value;if(initialized&&!destroyed)send('readOnly',{value:readOnly});},
   flush(){return ready.then(()=>{if(recoveryError)throw recoveryError;return rpc('flush');});},
   getRecoveryDocument(){return rejectedSnapshot?editorToCanonical(detached(rejectedSnapshot),{baseDocument:latest}):null;},
   getRejectedSnapshot(){return rejectedSnapshot?detached(rejectedSnapshot):null;},
   getSnapshot(){return ready.then(()=>rpc('snapshot'));},
   renderLegacyHTML(){return ready.then(()=>rpc('renderHTML'));},
   exportHTML(){return api.renderLegacyHTML();},
   destroy(){
    if(destroyed)return;
    send('dispose');destroyed=true;host.clearTimeout(readyTimer);host.removeEventListener('message',handler);
    const error=new Error('编辑器会话已关闭');readyReject(error);
    for(const {reject,timer} of requests.values()){host.clearTimeout(timer);reject(error);}requests.clear();
    iframe.remove();
   }
  };
  try{await ready;return api;}catch(error){api.destroy();throw error;}finally{host.clearTimeout(readyTimer);}
 }};
}
export const legacyEditorAdapter=createLegacyEditorAdapter();

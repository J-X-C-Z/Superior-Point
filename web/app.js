import {openShareCenter} from './share-center.js';
import {fiveSlideDocument} from '../examples/five-slides.js';
import {DocumentCore,createDocument} from '../core/document-core.js';
import {ProjectStore,AutosaveQueue} from '../storage/project-store.js';
import {createRecoveryDocument} from '../storage/project-recovery.js';
import {exportHTML,renderSlideSVG,inspectRenderCompatibility} from '../io/html.js';
import {readImportFile,createImportDocument,importErrorMessage} from '../io/project-import.js';
import {exportEditorHTML} from '../io/editor-export.js';
import {mountEditor,registerEditorAdapter,getEditorAdapter} from './editor-adapter.js';
import {subscribeProjectEvents} from './project-events.js';
import {initCloudWorkspace} from './cloud-workspace.js';
import {WorkspaceLibrary} from '../storage/workspace-library.js';
import {ThemeStore} from '../storage/theme-store.js';
import {CloudThemeStore} from '../storage/cloud-theme-store.js';
import {mountThemeLibrary} from './theme-library.js';
import {createThemePreviewDocument} from '../core/theme-preview.js';
import {planThemeApplication} from '../core/theme-application.js';
import {formDialog} from './admin/app.js';
import {mountProjectHistory} from './project-history.js';
const $=id=>document.getElementById(id),localStore=new ProjectStore(),owner=crypto.randomUUID();
let store=localStore,cloudWorkspace=null;
const localThemes=new ThemeStore();let cloudThemes=null,themeLibrary=null,projectHistory=null;
const library=new WorkspaceLibrary({localStore,getCloudStore:()=>cloudWorkspace?.getCloudStore()||null});
let navigation=Promise.resolve(),listRender=0,libraryPage=0,session=0,closing=false,drainingEditor=false,recovering=false,recoveryFlight=null,recoveryError=null;
let importFlight=null,importSource=null;
let leaseWait=null,revisionSubscription=null;
const navigate=fn=>{const next=navigation.catch(()=>{}).then(fn);navigation=next;return next;};
let view='home',core=null,lock=null,autosave=null,editor=null,persistedRevision=null,heartbeat=null,notifyTimer=null;
const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('sp-framework-changes'):null;
function notify(text,error=false){$('notification').textContent=text;$('notification').classList.toggle('error',error);$('notification').hidden=false;clearTimeout(notifyTimer);notifyTimer=setTimeout(()=>$('notification').hidden=true,6500);}
const guard=fn=>(...args)=>{try{return Promise.resolve(fn(...args)).catch(e=>{console.error(e);notify(e.message,true);});}catch(e){console.error(e);notify(e.message,true);}};
function syncWorkspaceChrome(failed=false){
 const attention=!!core&&(!lock||failed||!!autosave?.lastError||!!recoveryError||recovering);
 document.body.classList.toggle('editor-integrated',!!editor?.setWorkspaceState);
 document.body.classList.toggle('editor-attention',attention);
 editor?.setWorkspaceState?.({text:$('save-state').textContent,failed:attention,revision:core?.getDocument().revision,details:[$('recovery-note').textContent,$('import-note').textContent].filter(Boolean).join(' ')});
 cloudWorkspace?.workspace(!lock);
}
function refreshRecoveryControls(failed=false){
 $('backup-json').hidden=false;
 $('recover-project').hidden=!core||(!failed&&!!lock&&!autosave?.lastError&&!recoveryError);
 $('recover-project').disabled=recovering;
 $('recover-project').textContent=recovering?'正在保存恢复副本…':'恢复为独立项目';
 $('retry-save').disabled=recovering||!lock;
 $('takeover').disabled=recovering;
 syncWorkspaceChrome(failed);
}
function setState(state,revision,error){
 const latest=core?.getDocument().revision;
 if(state==='saved'&&revision===latest)recoveryError=null;
 if(recoveryError&&autosave?.paused){state='failed';error=recoveryError;}
 $('save-state').textContent=state==='saved'&&revision===latest?`已保存到${store.storage==='cloud'?'云端':'本地'} · 修订 ${revision}`:state==='failed'?`${store.storage==='cloud'?'云端未确认保存':'保存失败'} · ${error?.message||'请重试或恢复为独立项目'}`:state==='saving'?'正在保存…':store.storage==='cloud'?'云端尚未保存 · 正在保留本地恢复草稿…':'等待保存…';
 if(store.storage==='cloud')cloudWorkspace?.refreshDrafts().catch(()=>{});
 $('retry-save').hidden=state!=='failed';
 refreshRecoveryControls(state==='failed');
}
function announce(projectId=core?.getDocument().id){channel?.postMessage({projectId,owner});}
function setEditorReadOnly(value){try{editor?.setReadOnly?.(value);}catch(error){notify('编辑器状态更新失败：'+error.message,true);}}
function stopLeaseWait(waiting=leaseWait){
 if(!waiting)return;
 clearTimeout(waiting.timer);
 if(leaseWait===waiting)leaseWait=null;
}
function cleanLeaseWait(waiting){
 return leaseWait===waiting&&session===waiting.session&&core===waiting.core&&!lock&&!closing&&!recovering&&!recoveryError&&!autosave?.pending&&!autosave?.running&&!autosave?.lastError&&core.getDocument().revision===persistedRevision;
}
async function hasWaitingDraft(){
 // Do not replace an adapter's rejected snapshot, even if it never reached Core.
 try{return !!(editor?.getRejectedSnapshot?.()||await editor?.getRecoveryDocument?.()||(store.storage==='cloud'&&(await store.drafts.list(store.accountId,core.getDocument().id)).length));}
 catch{return true;}
}
function scheduleLeaseWait(waiting){
 if(leaseWait===waiting)waiting.timer=setTimeout(()=>retryWaitingLease(waiting),1000);
}
function startLeaseWait(){
 stopLeaseWait();
 const waiting={session,core,id:core.getDocument().id,timer:null};
 leaseWait=waiting;
 if(cleanLeaseWait(waiting))scheduleLeaseWait(waiting);else stopLeaseWait(waiting);
}
function retryWaitingLease(waiting){
 if(leaseWait!==waiting)return Promise.resolve();
 let task;
 task=navigate(async()=>{
  let acquired=null,activating=false;
  // A later navigation request also cancels this attempt while its I/O is in flight.
  const current=()=>navigation===task&&cleanLeaseWait(waiting);
  const preserveDraft=async()=>{
   const draft=await hasWaitingDraft();
   if(draft&&current()){stopLeaseWait(waiting);$('save-state').textContent='只读 · 检测到未提交修改，请先恢复为独立项目或导出备份。';refreshRecoveryControls(true);}
   return draft;
  };
  try{
   if(!current()||await preserveDraft()||!current()){stopLeaseWait(waiting);return;}
   acquired=await store.acquire(waiting.id,owner); // Never take over a live lease.
   if(!current()){stopLeaseWait(waiting);return;}
   if(!acquired){scheduleLeaseWait(waiting);return;}
   const record=await store.get(waiting.id);
   if(!current()||await preserveDraft()||!current()){stopLeaseWait(waiting);return;}
   if(!record||record.deletedAt){stopLeaseWait(waiting);$('save-state').textContent='只读 · 项目已不存在或已移入回收站，当前内容仍可导出备份。';syncWorkspaceChrome();return;}
   new DocumentCore(record.document); // Validate before retiring the visible snapshot.
   stopLeaseWait(waiting);clearCurrent();
   const lease=acquired;acquired=null;activating=true; // activateProject owns the new lease from here.
   await activateProject(record,lease);
   notify('写入权已恢复，已读取最新保存的内容。');
  }catch(error){
   if(activating)notify('写入权已取得，但重新打开项目失败，请返回工作台重试：'+error.message,true);
   else if(current()){$('save-state').textContent=store.storage==='cloud'?'只读 · 暂时无法检查云端写入权，稍后重试；不会抢占。':'只读 · 暂时无法检查写入权，稍后重试；可主动接管。';syncWorkspaceChrome();scheduleLeaseWait(waiting);}
   else if(leaseWait===waiting)stopLeaseWait(waiting);
  }finally{if(acquired)await store.release(acquired).catch(()=>{});}
 });
 return task;
}
function loseLock(){
 stopLeaseWait();
 lock=null;setEditorReadOnly(true);$('project-title').disabled=true;$('takeover').hidden=store.storage==='cloud';
 setState('failed',core?.getDocument().revision,new Error('写入权已失效，改动仍保留。请恢复为独立项目，或导出 JSON 备份。'));
 clearInterval(heartbeat);
}
async function renewCurrentLock(){
 const ownerSession=session,lease=lock;
 if(!lease||closing)return;
 try{
  const renewed=await store.renew(lease);
  if(ownerSession===session&&lock?.token===lease.token)lock=renewed;
 }catch{
  if(ownerSession===session&&lock?.token===lease.token)loseLock();
 }
}
function startHeartbeat(){clearInterval(heartbeat);if(lock)heartbeat=setInterval(renewCurrentLock,5000);}
function repaint(){const doc=core.getDocument();$('project-title').value=doc.title;$('revision').textContent=`r${doc.revision} / ${doc.slides.length} 页`;try{editor?.update?.(doc);syncWorkspaceChrome();}catch(error){notify('编辑器预览更新失败，文档仍保留：'+error.message,true);}}
function rememberCloudDraft(doc){if(store.storage==='cloud')store.captureDraft(doc,persistedRevision).then(()=>cloudWorkspace?.refreshDrafts()).catch(error=>notify('本地恢复草稿未保存，请保留当前页面并导出备份：'+error.message,true));}
function edit(operations,expectedRevision=core?.getDocument().revision){if(closing&&!drainingEditor)throw new Error('项目正在切换，当前编辑已停止');if(!core||!lock)throw new Error('当前项目只读，请先获取写入权');const result=core.edit(operations,{expectedRevision});rememberCloudDraft(result);autosave.schedule(core.getDocument());repaint();return result;}
function clearCurrent(){
 revisionSubscription?.close();revisionSubscription=null;
 $('remote-revision-notice').hidden=true;
 stopLeaseWait();
 document.body.classList.remove('editor-integrated','editor-attention');
 clearInterval(heartbeat);
 // Invalidate callbacks before calling a potentially re-entrant adapter destroy().
 session++;
 const previousEditor=editor;editor=null;core=null;lock=null;autosave=null;persistedRevision=null;recoveryError=null;
 try{previousEditor?.destroy?.();}catch(error){notify('编辑器关闭时发生错误：'+error.message,true);}
}
async function flushEditor(){drainingEditor=true;try{await editor?.flush?.();}finally{drainingEditor=false;}}
async function releaseCurrent(){
 if(!core)return;
 await flushEditor();
 if(autosave?.paused&&recoveryError)throw recoveryError;
 closing=true;setEditorReadOnly(true);$('project-title').disabled=true;
 try{await autosave?.flush();clearInterval(heartbeat);await store.release(lock);clearCurrent();}
 finally{closing=false;if(core){$('project-title').disabled=!lock;setEditorReadOnly(!lock);startHeartbeat();}}
}
function openProject(id,options={}){return navigate(()=>openProjectNow(id,options));}
async function activateProject(rec,lease,{waitForLease=false}={}){
 core=new DocumentCore(rec.document);lock=lease;persistedRevision=rec.document.revision;recoveryError=null;
 const ownerSession=++session,ownerCore=core;
 const active=()=>ownerSession===session&&ownerCore===core;
 let savedRevision=rec.document.revision;
 autosave=new AutosaveQueue({
  write:async doc=>{
   if(!active())throw new Error('保存会话已失效');
   const lease=lock;
   try{
    const saved=await store.save(doc,{expectedRevision:savedRevision,lock:lease});
    savedRevision=saved.document.revision;
    if(active()){persistedRevision=savedRevision;announce(doc.id);}
   }catch(error){if(active()&&error.code==='LOCK_LOST'&&lock?.token===lease?.token)loseLock();throw error;}
  },
  onState:(...args)=>{if(active())setState(...args);}
 });
 document.body.classList.add('editor-open');$('home-view').hidden=true;$('theme-view').hidden=true;$('workspace-view').hidden=false;$('project-title').disabled=!lock||closing;$('takeover').hidden=store.storage==='cloud'||!!lock;$('retry-save').hidden=true;
 $('save-state').textContent=lock?`已保存到${store.storage==='cloud'?'云端':'本地'} · 修订 ${persistedRevision}`:store.storage==='cloud'?(waitForLease?'只读 · 云端写入权被占用，等待释放；不会抢占。':'只读 · 请先恢复本地草稿，或取回云端编辑。'):waitForLease?'只读 · 写入权暂被占用，等待释放；可主动接管。':'只读 · 暂未取得写入权，可主动接管或恢复为独立项目。';
 const origin=rec.document.metadata.spRecovery;
 const isRecovery=origin?.type==='independent-project'&&typeof origin.source?.title==='string';
 $('recovery-note').hidden=!isRecovery;
 $('recovery-note').textContent=isRecovery?`此项目是「${origin.source.title}」的独立恢复副本（来源修订 ${origin.source.revision}）。原项目及其他标签页的更新未被此恢复操作覆盖。`:'';
 const imported=rec.document.metadata.spImport,isImport=imported?.type==='independent-import'&&typeof imported.source?.fileName==='string';
 $('import-note').hidden=!isImport;
 $('import-note').textContent=isImport?`独立导入自「${imported.source.fileName}」（来源修订 ${imported.source.revision}）。${imported.migrated?'原型 schemaVersion 0 已迁移为 1；':''}原文件及同名项目未被覆盖，未知数据字段保留。`:'';
 refreshRecoveryControls();
 let editorValid=true;
 const scoped=fn=>(...args)=>{if(!editorValid||!active()||(closing&&!drainingEditor))throw new Error('编辑器会话已失效');return fn(...args);};
 try{editor=await mountEditor({container:$('editor-mount'),document:core.getDocument(),readOnly:!lock||closing,onEdit:scoped(edit),onUndo:scoped(undo),onRedo:scoped(redo),onSave:scoped(()=>autosave.flush()),getHistoryState:()=>({canUndo:core?.canUndo??false,canRedo:core?.canRedo??false}),onImportFile:importFile,onExport:format=>format==='json'?exportJSONBackup():exportProject(undefined,{audience:format==='audience'}),onHome:()=>home(),onThemes:()=>home('themes'),onCommitRejected:error=>{if(!active())return;stopLeaseWait();recoveryError=error;setState('failed',core?.getDocument().revision,error);refreshRecoveryControls(true);}});}
 catch(error){editorValid=false;$('editor-mount').textContent='编辑器加载失败，项目仍保留，可导出备份。'+error.message;editor=null;notify('编辑器加载失败：'+error.message,true);}
 repaint();startHeartbeat();if(waitForLease&&!lock)startLeaseWait();
 if(store.storage==='cloud')revisionSubscription=subscribeProjectEvents({api:store.api,projectId:rec.id,revision:persistedRevision,onRevision:event=>{
  if(!active()||event.revision<=persistedRevision&&!event.deleted)return;
  const notice=$('remote-revision-notice');notice.textContent=event.deleted?'此项目已在云端移到回收站。当前文稿和恢复草稿保留。':`云端已有新修订 r${event.revision}。当前内容和草稿保持不变；请返回工作台查看历史差异，保存冲突时可恢复为独立项目。`;notice.hidden=false;
 },onState:state=>{if(!active())return;if(state==='access-revoked'||state==='account-changed'){const notice=$('remote-revision-notice');notice.textContent='云端访问已失效。当前内容保留，请导出或恢复草稿后重新登录。';notice.hidden=false;}}});

 return core.getDocument();
}
async function openProjectNow(id,{takeover=false}={}){
 await releaseCurrent();
 const hasDraft=store.storage==='cloud'&&(await store.drafts.list(store.accountId,id)).length>0;
 const lease=hasDraft?null:await store.acquire(id,owner,{takeover});
 let rec;
 try{rec=await store.get(id);if(!rec||rec.deletedAt)throw new Error('项目不存在或已在回收站');await store.markOpened(id);}
 catch(error){await store.release(lease).catch(()=>{});throw error;}
 if(hasDraft)notify('此项目有本地恢复草稿。已读取云端版本，请先将草稿恢复为独立项目。');
 return activateProject(rec,lease,{waitForLease:!takeover&&!lease&&!hasDraft});
}
function recoverProject(){
 // Multiple clicks share one operation, even while queued behind navigation.
 if(recoveryFlight)return recoveryFlight;
 const sourceCore=core;
 if(!sourceCore)return Promise.reject(new Error('请先打开需要恢复的项目'));
 const task=navigate(async()=>{
  if(core!==sourceCore)throw new Error('项目已切换，请在当前项目重新选择恢复');
  if(!autosave?.pending&&!autosave?.running&&!autosave?.lastError&&lock&&!recoveryError)throw new Error('当前项目没有待恢复的改动');
  return recoverProjectNow();
 });
 recoveryFlight=task.finally(()=>{recoveryFlight=null;});
 return recoveryFlight;
}
async function recoverProjectNow(){
 const sourceCore=core,sourceQueue=autosave;
 const rejectedDocument=await editor?.getRecoveryDocument?.();
 if(!rejectedDocument)await flushEditor();
 recovering=true;closing=true;recoveryError=null;
 setEditorReadOnly(true);$('project-title').disabled=true;refreshRecoveryControls(true);
 clearInterval(heartbeat);sourceQueue.pause();
 let committed=false;
 try{
  // No new old-project write may start, and an already-started write must settle first.
  await sourceQueue.waitForIdle();
  const recovered=createRecoveryDocument(rejectedDocument||sourceCore.getDocument(),{persistedRevision,reason:sourceQueue.lastError?.code||(!lock?'READ_ONLY':'SAVE_FAILED')});
  const record=await store.create(recovered);
  committed=true;
  // Only a completed IndexedDB create authorizes discarding the old retry queue.
  const oldLease=lock;
  sourceQueue.cancel();session++;
  let cleanupWarning='';
  try{await store.release(oldLease);}catch{cleanupWarning='旧项目写入权将自动到期。';}
  let lease=null;
  try{lease=await store.acquire(record.id,owner);}catch{cleanupWarning+='新副本暂时只读，可返回工作台重新打开。';}
  clearCurrent();
  // The old session is retired and the new document is durable. New adapter callbacks
  // may now edit only the freshly activated project, even without setReadOnly().
  closing=false;
  const doc=await activateProject(record,lease);
  announce(doc.id);
  notify('已保存并打开独立恢复副本，原项目未被覆盖。'+cleanupWarning);
  return doc;
 }catch(error){
  if(!committed){
   sourceQueue.resume();recoveryError=error;
   setState('failed',sourceCore.getDocument().revision,new Error('恢复副本未保存，原改动仍保留：'+error.message));
  }else{
   // The durable copy remains in the project library even if mounting the workspace fails.
   notify('恢复副本已保存在项目库，但打开失败。请返回工作台打开副本；原项目未被覆盖。',true);
  }
  throw error;
 }finally{
  recovering=false;closing=false;
  if(core){$('project-title').disabled=!lock;setEditorReadOnly(!lock);startHeartbeat();refreshRecoveryControls(!!recoveryError||!!autosave?.lastError);}
 }
}
function undo(){if(closing)throw new Error('项目正在切换');if(!lock)throw new Error('当前项目只读');const doc=core.undo({expectedRevision:core.getDocument().revision});rememberCloudDraft(doc);autosave.schedule(core.getDocument());repaint();return doc;}
function redo(){if(closing)throw new Error('项目正在切换');if(!lock)throw new Error('当前项目只读');const doc=core.redo({expectedRevision:core.getDocument().revision});rememberCloudDraft(doc);autosave.schedule(core.getDocument());repaint();return doc;}
function exportJSONBackup(){if(!core)throw new Error('请先打开项目');let rejected;try{rejected=editor?.getRecoveryDocument?.();}catch(error){const raw=editor?.getRejectedSnapshot?.();if(raw){notify('候选数据未通过Core校验，已导出原始编辑器JSON，请保留该文件。',true);return downloadJSONBackup(raw);}throw error;}if(rejected)return downloadJSONBackup(rejected);if(editor?.flush)return flushEditor().then(()=>downloadJSONBackup(core.getDocument()));return downloadJSONBackup(core.getDocument());}
function downloadJSONBackup(doc){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}));a.download='SP-backup-'+(doc.id||'editor-recovery')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);return doc;}
function download(html,title){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));a.download=(title.replace(/[\\/:*?"<>|]/g,'_').slice(0,100)||'SP')+'.html';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
async function exportProject(id,{audience=false,projectStore=store}={}){if(!id)await flushEditor();const doc=id?(await projectStore.get(id)).document:core.getDocument();if(!id&&editor?.renderLegacyHTML){download(await exportEditorHTML(doc,await editor.renderLegacyHTML(),{audience}),doc.title+(audience?'-分享':''));notify(audience?'已导出观众分享 HTML，仅含可见页面与放映内容，不含编辑项目数据。':'已导出可重新编辑版，包含备注与批注，请勿直接作为公开分享版。浏览器与复杂动效仍需验收。');return;}const report=inspectRenderCompatibility(doc);if(audience&&report.hasKnownGaps)throw new Error('基础渲染无法完整分享此项目的样式或动效，请打开项目后使用原渲染器分享。');download(await exportHTML(doc,{audience}),doc.title+(audience?'-分享':''));notify(audience?`已导出观众分享 HTML（基础渲染），不含编辑项目数据。`:!report.hasKnownGaps?'已生成可重新编辑版HTML，包含备注与批注，请勿直接作为公开分享版。':`已导出可重新编辑版，包含备注与批注，请勿直接作为公开分享版。基础渲染另有 ${report.warnings.length} 项样式仅保留数据。`);}
async function newProject(title,ratio='16:9'){const doc=createDocument({title,slides:[{id:crypto.randomUUID(),elements:[],animations:[]}],canvas:ratio==='4:3'?{width:960,height:720}:{width:1280,height:720}});const record=await store.create(doc);const opened=await openProject(record.id);announce();return opened;}
function showImportStatus(message,error=false,projectId=null){
 $('import-status').hidden=false;$('import-status').classList.toggle('error',error);
 $('import-message').textContent=message;$('import-go-home').hidden=!projectId;
}
function importFile(file){
 if(!file)return Promise.resolve();
 if(importFlight)return file===importSource?importFlight:Promise.reject(new Error('正在导入一个文件，请完成后再选择其他文件。'));
 importSource=file;$('import-top').disabled=true;$('file-input').disabled=true;
 $('import-top').textContent='正在导入…';showImportStatus('正在读取和验证文件；只读取 SP 文档数据，不执行文件中的脚本。');
 // Reserve navigation order before the first asynchronous read. Later Home/Open wins.
 const task=navigate(()=>importFileNow(file));
 importFlight=task.finally(()=>{importFlight=null;importSource=null;$('import-top').disabled=false;$('file-input').disabled=false;$('import-top').textContent='打开本地文件 ↗';});
 return importFlight;
}
async function importFileNow(file){
 let record=null,stage='read';
 try{
  const imported=await readImportFile(file,{allowEditorCandidate:!!getEditorAdapter()?.candidate});
  stage='save';await flushEditor();
  closing=true;setEditorReadOnly(true);$('project-title').disabled=true;clearInterval(heartbeat);
  stage='save';showImportStatus('文件校验通过，正在保存当前项目…');
  // A failed or in-flight final save must settle before any new project exists.
  // Keep the old session and lease intact until create() commits successfully.
  await autosave?.flush();
  stage='create';const existing=await store.list();
  const document=createImportDocument(imported,existing.map(rec=>rec.document.title));
  record=await store.create(document);
  let warning='';const oldLease=lock;
  try{await store.release(oldLease);}catch{warning='旧项目写入权清理失败，将自动到期。';}
  clearCurrent();
  let lease=null;
  try{lease=await store.acquire(record.id,owner);}catch{/* A committed import remains usable without a write lease. */}
  if(!lease)warning+='导入副本暂时只读，可在工作台重新打开。';
  closing=false;
  const result=await activateProject(record,lease);
  if(!editor)warning+='编辑器加载失败，数据已保存，可导出备份或在工作台重新打开。';
  announce(record.id);
  const message=`已导入「${result.title}」为独立项目，原文件和原项目未被覆盖。${imported.migrated?'原型 schemaVersion 0 已迁移为 1。':''}${imported.candidateImported?'原编辑器数据已接入候选适配，外链资源会被隔离，不代表全部功能已验收。':''}${warning}`;
  showImportStatus(message,!!warning,record.id);notify(message,!!warning);return result;
 }catch(error){
  const reason=importErrorMessage(error);
  const message=record?`「${record.document.title}」已保存到项目库，但打开失败：${reason}。请点“在工作台查看”打开已导入的副本，无需重复导入。`:stage==='save'?`未导入：当前项目尚未安全保存，改动仍保留。请先重试保存、恢复为独立项目或导出 JSON 备份。原因：${reason}`:stage==='create'?`导入副本未保存，原项目和当前会话仍保留。原因：${reason}`:`未导入：${reason}`;
  showImportStatus(message,true,record?.id);throw Object.assign(new Error(message,{cause:error}),{code:record?'IMPORT_OPEN_FAILED':'IMPORT_FAILED',projectId:record?.id});
 }finally{
  closing=false;
  if(core){$('project-title').disabled=!lock;setEditorReadOnly(!lock);startHeartbeat();}
 }
}
function openEntry(entry){return navigate(async()=>{
 library.storeFor(entry);await releaseCurrent();
 try{const selected=library.storeFor(entry);await selected.open();store=selected;const doc=await openProjectNow(entry.id);await cloudWorkspace.refresh();return doc;}
 catch(error){await homeNow(view);await cloudWorkspace.refresh();throw error;}
});}
async function mutateCard(entry,action,newTitle){
 if(action==='open')return openEntry(entry);
 if(action==='share-link'){const selected=library.storeFor(entry);await openShareCenter({document,api:selected.api,projectId:entry.id,accountId:entry.accountId});return;}
 if(action==='history'){const selected=library.storeFor(entry);if(entry.source!=='cloud')throw new Error('历史版本目前支持云端项目');projectHistory?.destroy();projectHistory=mountProjectHistory({document,api:selected.api,projectRef:{source:'cloud',projectId:entry.id,accountId:entry.accountId},notify,onRestore:async request=>{const target=library.storeFor(entry),lease=await target.acquire(entry.id,owner);if(!lease)throw new Error('项目正在另一个写入方编辑，请等待释放后恢复');try{const restored=await target.api.request('/projects/'+encodeURIComponent(entry.id)+'/restore-revision',{method:'POST',body:{...request,leaseToken:lease.token}});library.storeFor(entry);announce(entry.id);await renderProjects();return restored;}finally{await target.release(lease).catch(()=>notify('写入权清理失败，将自动到期。',true));}}});projectHistory.open();return;}
 if(action==='upload'){
  if(!cloudWorkspace.api.user||!cloudWorkspace.getCloudStore()){cloudWorkspace.openAccount();return;}
  await library.migrate(entry);notify('已上传并核对云端副本；本地原项目保留。');announce();await renderProjects();return;
 }
 const projectStore=library.storeFor(entry),id=entry.id,rec=await projectStore.get(id);if(!rec)throw new Error('项目已不存在');
 if(action==='export')return exportProject(id,{projectStore});if(action==='share')return exportProject(id,{audience:true,projectStore});
 if(action==='copy'){const doc=structuredClone(rec.document);doc.id=crypto.randomUUID();doc.title+=' · 副本';doc.revision=0;doc.metadata.createdAt=new Date().toISOString();doc.metadata.updatedAt=doc.metadata.createdAt;library.storeFor(entry);await projectStore.create(doc);}
 if(action==='rename'){if(rec.document.revision!==entry.record.document.revision)throw new Error('项目已有更新，重命名冲突；请刷新后重试。');library.storeFor(entry);const lease=await projectStore.acquire(id,owner);if(!lease)throw new Error('项目正在另一个标签页编辑');try{library.storeFor(entry);const c=new DocumentCore(rec.document);c.edit([{type:'updateProject',properties:{title:newTitle}}],{expectedRevision:rec.document.revision});await projectStore.save(c.getDocument(),{expectedRevision:rec.document.revision,lock:lease});}finally{await projectStore.release(lease).catch(()=>notify('写入权清理失败，将自动到期。',true));}}
 if(action==='delete'||action==='restore'){library.storeFor(entry);await projectStore.setDeleted(id,action==='delete',{owner});notify(action==='delete'?'已移入回收站，可随时恢复。':'项目已恢复。');}
 announce();await renderProjects();
}
function renameCard(entry,title,card){
 if(title.querySelector('input')||card.getAttribute('aria-busy')==='true')return;
 const oldTitle=entry.record.document.title,input=document.createElement('input'),status=document.createElement('span');
 input.className='project-title-input';input.value=oldTitle;input.setAttribute('aria-label','项目名称');
 status.className='project-rename-status';status.setAttribute('role','status');title.after(status);title.replaceChildren(input);
 let finished=false;
 const restore=()=>{title.textContent=oldTitle;status.remove();card.querySelector('[data-action=rename]')?.focus();};
 const commit=async()=>{
  if(finished)return;finished=true;
  const value=input.value.trim();
  if(!value||value.length>500){restore();notify(!value?'项目名称不能为空':'项目名称不能超过 500 个字符',true);return;}
  if(value===oldTitle){restore();return;}
  card.setAttribute('aria-busy','true');status.textContent='正在保存…';input.disabled=true;
  const controls=[...card.querySelectorAll('button')];controls.forEach(button=>button.disabled=true);
  try{await mutateCard(entry,'rename',value);const updated=[...$('projects').children].find(item=>item.dataset.source===entry.source&&item.dataset.projectId===entry.id&&(!entry.accountId||item.dataset.accountId===entry.accountId));updated?.querySelector('[data-action=rename]')?.focus();}
  catch(error){restore();notify(error.message,true);}
  finally{card.removeAttribute('aria-busy');controls.forEach(button=>button.disabled=false);if(card.isConnected)card.querySelector('[data-action=rename]')?.focus();}
 };
 input.onkeydown=event=>{if(event.isComposing)return;if(event.key==='Enter'||event.key==='Escape'){event.preventDefault();event.stopPropagation();if(event.key==='Escape'){finished=true;restore();}else void commit();}};
 input.onblur=()=>void commit();input.ondblclick=event=>event.stopPropagation();input.focus();input.select();
}
async function renderProjects(){
 const ticket=++listRender,trash=view==='trash',pending=library.list({trash});
 if(cloudWorkspace?.getCloudStore()){
  const local=await localStore.list({trash});if(ticket!==listRender)return;
  renderEntries({entries:local.map(record=>({source:'local',id:record.id,accountId:null,record})),cloudError:null},trash);
  $('library-status').hidden=false;$('library-status').textContent='正在读取云端项目；本地项目可继续使用。';
 }
 const result=await pending;if(ticket!==listRender)return;renderEntries(result,trash);if(['ACCOUNT_CHANGED','UNAUTHENTICATED'].includes(result.cloudError?.code)&&!cloudWorkspace.api.user){if(!core)store=localStore;await cloudWorkspace.refresh();}
}
function renderEntries(result,trash){
 const search=$('search').value.trim().toLowerCase(),source=$('project-source').value,entries=result.entries.filter(entry=>entry.record.document.title.toLowerCase().includes(search)&&(source==='all'||entry.source===source||source==='uploaded'&&entry.syncState==='uploaded'||source==='draft'&&entry.hasDraft));
 entries.sort($('sort').value==='title'?(a,b)=>a.record.document.title.localeCompare(b.record.document.title):(a,b)=>view==='recent'?b.record.openedAt-a.record.openedAt:b.record.modifiedAt-a.record.modifiedAt);
 $('library-status').hidden=!result.cloudError;$('library-status').textContent=result.cloudError?'云端项目暂不可用，本地项目仍可打开。'+result.cloudError.message:'';
 $('list-title').firstChild.textContent=trash?'回收站 ':view==='recent'?'最近使用 ':'我的项目 ';$('count').textContent=String(entries.length).padStart(2,'0');$('empty').hidden=!!entries.length;$('projects').replaceChildren();
 const pageSize=24;libraryPage=Math.min(libraryPage,Math.max(0,Math.ceil(entries.length/pageSize)-1));
 const pager=$('project-pages');pager.replaceChildren();pager.hidden=entries.length<=pageSize;
 if(!pager.hidden){const previous=document.createElement('button'),next=document.createElement('button'),label=document.createElement('span');previous.textContent='上一页';next.textContent='下一页';label.textContent=`第 ${libraryPage+1} / ${Math.ceil(entries.length/pageSize)} 页`;previous.disabled=libraryPage===0;next.disabled=(libraryPage+1)*pageSize>=entries.length;previous.onclick=()=>{libraryPage--;renderEntries(result,trash);};next.onclick=()=>{libraryPage++;renderEntries(result,trash);};pager.append(previous,label,next);}
 for(const entry of entries.slice(libraryPage*pageSize,(libraryPage+1)*pageSize)){const rec=entry.record,doc=rec.document,card=document.createElement('article');card.className='project';card.dataset.projectId=entry.id;card.dataset.source=entry.source;if(entry.accountId)card.dataset.accountId=entry.accountId;
  const cover=document.createElement('button');cover.className='cover';cover.style.setProperty('--cover-ratio',String(doc.canvas.width/doc.canvas.height));cover.setAttribute('aria-label','打开 '+doc.title);
  if(doc.slides.length){try{cover.innerHTML=renderSlideSVG(doc,doc.slides[0].id);}catch{cover.textContent='预览暂不可用';}}else{const mark=document.createElement('span');mark.className='empty-cover';mark.textContent='SUPERIOR POINT';cover.append(mark);}
  if(!trash){const hint=document.createElement('span');hint.className='cover-open-hint';hint.setAttribute('aria-hidden','true');hint.textContent='打开编辑 ↗';cover.append(hint);}cover.disabled=trash;cover.onclick=guard(()=>openEntry(entry));card.append(cover);
  const info=document.createElement('div');info.className='project-info';const title=document.createElement('h3');title.className='project-title';title.textContent=doc.title;if(!trash){title.title='双击重命名';title.ondblclick=event=>{event.preventDefault();event.stopPropagation();renameCard(entry,title,card);};}info.append(title);
  const meta=document.createElement('div');meta.className='project-meta';meta.textContent=`${rec.slideCount??doc.slides.length} 页 · ${entry.source==='cloud'?'云端'+(entry.hasDraft?' · 待恢复草稿':''):entry.syncState==='uploaded'?'已上传云端 · 本地原件':entry.syncState==='local-changed'?'仅本地 · 上传后已修改':'仅本地'} · ${new Date(rec.modifiedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}`;info.append(meta);
  const actions=document.createElement('div');actions.className='project-actions';const choices=trash?[['恢复','restore']]:[['重命名','rename'],['复制','copy'],...(entry.source==='cloud'?[['历史版本','history'],['分享链接','share-link']]:[]),...(entry.source==='local'?[['上传云端','upload']]:[]),['备份 HTML','export'],['分享 HTML','share'],['删除','delete']];
  for(const [label,action] of choices){const b=document.createElement('button');b.textContent=label;if(action==='export')b.title='可重新编辑版：包含备注与批注，请勿直接作为公开分享版';b.dataset.action=action;b.onclick=guard(async event=>{if(action==='upload')event.stopPropagation();if(action==='rename'){renameCard(entry,title,card);return;}b.disabled=true;try{await mutateCard(entry,action);}finally{b.disabled=false;}});actions.append(b);}info.append(actions);card.append(info);$('projects').append(card);
 }
}
function home(next=view){return navigate(()=>homeNow(next));}
async function homeNow(next){await releaseCurrent();document.body.classList.remove('editor-open');cloudWorkspace?.workspace(!lock);view=next;$('workspace-view').hidden=true;$('home-view').hidden=view==='themes';$('theme-view').hidden=view!=='themes';document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));if(view==='themes')await themeLibrary?.refresh();else await renderProjects();}
function getCloudThemes(){const api=cloudWorkspace?.api;if(!api?.user){cloudThemes=null;return null;}if(cloudThemes?.accountId!==api.user.id)cloudThemes=new CloudThemeStore({api});return cloudThemes;}
async function createFromTheme(theme,{ratio='16:9'}={}){return navigate(async()=>{await releaseCurrent();const document=await createThemePreviewDocument(theme,{ratio});document.id=crypto.randomUUID();document.title=theme.name+' · 演示文稿';const record=await store.create(document);await openProjectNow(record.id);announce();});}
async function applyProjectTheme(theme,{mode='preserve',projectRef}={}){
 const selected=library.storeFor(projectRef),record=await selected.get(projectRef.id);if(!record||record.deletedAt)throw new Error('目标项目不存在');
 const plan=await planThemeApplication(record.document,theme,{mode});
 const labels={background:'背景',fill:'填充色',stroke:'边框色',color:'文字颜色',fontFamily:'字体',fontSize:'字号',fontWeight:'字重',bold:'粗体',lineHeight:'行距',radius:'圆角',strokeWidth:'边框宽度',chartColor:'图表颜色'};const summary=plan.changes.slice(0,8).map(change=>`第 ${record.document.slides.findIndex(slide=>slide.id===change.slideId)+1} 页${change.elementId?'对象':''}：${labels[change.property]||'样式'}`).join('\n');
 const answer=await formDialog(document,'确认主题变更',[],{message:`「${record.document.title}」将修改 ${plan.changes.length} 项样式，记录主题固定版本。${mode==='reset'?'重置模式将覆盖受支持的手工样式。':'保留模式不覆盖已有手工样式。'}\n${summary}\n${plan.limitations.join('\n')}`,confirm:'应用并保存'});if(!answer)return false;
 library.storeFor(projectRef);await openEntry(projectRef);if(!lock)throw new Error('项目正在其他写入方编辑，未应用主题');if(core.getDocument().revision!==record.document.revision)throw new Error('项目已有更新，请重新预览主题变更');
 edit(plan.operations,record.document.revision);await autosave.flush();notify('主题已应用并保存，可在编辑器中撤销。');return true;
}

$('open-example').onclick=guard(async()=>{const doc=fiveSlideDocument();doc.id=crypto.randomUUID();doc.metadata.createdAt=new Date().toISOString();doc.metadata.updatedAt=doc.metadata.createdAt;const record=await store.create(doc);await openProject(record.id);});
$('new-project').onclick=()=>{$('new-dialog').showModal();$('new-title').select();};$('cancel-new').onclick=()=>$('new-dialog').close();$('new-form').onsubmit=guard(async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{await newProject($('new-title').value.trim()||'未命名演示文稿',$('new-ratio').value);$('new-dialog').close();}finally{button.disabled=false;}});
const chooseImport=()=>{if(!importFlight)$('file-input').click();};
$('import-top').onclick=chooseImport;$('file-input').onchange=guard(async e=>{try{await importFile(e.target.files[0]);}finally{e.target.value='';}});$('import-go-home').onclick=guard(()=>{$('search').value='';return home('home');});$('back-home').onclick=guard(()=>home());$('project-title').onchange=guard(e=>edit([{type:'updateProject',properties:{title:e.target.value.trim()||'未命名演示文稿'}}]));$('export-project').onclick=guard(()=>exportProject());$('share-project').onclick=guard(()=>exportProject(undefined,{audience:true}));$('retry-save').onclick=guard(()=>autosave?.flush());$('backup-json').onclick=guard(exportJSONBackup);$('recover-project').onclick=guard(recoverProject);$('takeover').onclick=guard(async()=>{const id=core.getDocument().id;if(autosave?.pending)throw new Error('请先恢复为独立项目以保存当前改动，再接管原项目。');await openProject(id,{takeover:true});announce();});$('search').oninput=guard(()=>{libraryPage=0;return renderProjects();});$('sort').onchange=guard(()=>{libraryPage=0;return renderProjects();});$('project-source').onchange=guard(()=>{libraryPage=0;return renderProjects();});document.querySelectorAll('[data-view]').forEach(b=>b.onclick=guard(()=>home(b.dataset.view)));
window.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='o'){e.preventDefault();chooseImport();}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();guard(()=>autosave?.flush())();}});
window.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();document.body.classList.add('dragging');}});window.addEventListener('dragleave',e=>{if(!e.relatedTarget)document.body.classList.remove('dragging');});window.addEventListener('drop',guard(async e=>{e.preventDefault();document.body.classList.remove('dragging');await importFile(e.dataTransfer.files[0]);}));
window.addEventListener('beforeunload',e=>{if(importFlight||recovering||autosave?.pending||autosave?.running){e.preventDefault();e.returnValue='';}});window.addEventListener('pagehide',()=>{store.release(lock).catch(()=>{});});document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')autosave?.flush().catch(()=>{});});
channel?.addEventListener('message',async e=>{if(e.data.owner===owner)return;if(!core)await renderProjects();else if(lock&&e.data.projectId===core.getDocument().id)await renewCurrentLock();});
async function switchStore(next){return navigate(async()=>{if(store===next){await next.open();return;}try{await releaseCurrent();}catch(error){if(store.storage!=='cloud'||!core)throw error;if(editor?.getRejectedSnapshot?.())throw new Error('编辑器还有未确认的内容，请先导出 JSON 备份或恢复为独立项目。');const previous=store;closing=true;setEditorReadOnly(true);$('project-title').disabled=true;try{await previous.captureDraft(core.getDocument(),persistedRevision);autosave.pause();await autosave.waitForIdle();autosave.cancel();await previous.release(lock).catch(()=>{});clearCurrent();notify('云端未确认的修改已保留为本地恢复草稿。');}finally{closing=false;if(core){$('project-title').disabled=!lock;setEditorReadOnly(!lock);}}}store=next;await store.open();await localStore.open();await homeNow('home');syncWorkspaceChrome();});}
async function recoverCloudDraft(draft){if(store.storage!=='cloud'||draft.accountId!==store.accountId)throw new Error('请登录草稿所属云端账号');if(core?.getDocument().id===draft.projectId&&(autosave?.pending||autosave?.running||autosave?.lastError||recoveryError)){const selected=store,document=await recoverProject();await selected.drafts.remove(selected.accountId,draft.key);return {id:document.id,alreadyOpened:true};}return store.recoverDraft(draft);}
window.SPFramework={ready:false,get store(){return store;},newProject,openProject,edit,undo,redo,flush:()=>autosave?.flush(),getDocument:()=>core?.getDocument(),applyProjectTheme,createFromTheme,getState:()=>({storage:store.storage||'local',readOnly:!lock,persistedRevision,saveError:autosave?.lastError?.message,recoveryError:recoveryError?.message,recovering,importing:!!importFlight,pending:!!autosave?.pending,saving:!!autosave?.running}),recoverProject,exportJSONBackup,importFile,home,exportProject,registerEditorAdapter,switchStore};
cloudWorkspace=initCloudWorkspace({getStore:()=>store,getLocalStore:()=>localStore,switchStore,openProject,recoverDraft:recoverCloudDraft,refreshProjects:async()=>{await renderProjects();await themeLibrary?.refresh();},notify});
themeLibrary=mountThemeLibrary({container:$('theme-view'),localStore:localThemes,getCloudStore:getCloudThemes,getProjects:()=>library.list(),onCreate:createFromTheme,onApply:applyProjectTheme,notify});
cloudWorkspace.initialize().then(async selected=>{store=selected;await localStore.open();await store.open();await home();await cloudWorkspace.refresh();window.SPFramework.ready=true;}).catch(e=>{notify('无法打开项目存储：'+e.message,true);$('save-state').textContent='存储不可用';});

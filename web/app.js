import {fiveSlideDocument} from '../examples/five-slides.js';
import {DocumentCore,createDocument} from '../core/document-core.js';
import {ProjectStore,AutosaveQueue} from '../storage/project-store.js';
import {createRecoveryDocument} from '../storage/project-recovery.js';
import {exportHTML,renderSlideSVG,inspectRenderCompatibility} from '../io/html.js';
import {readImportFile,createImportDocument,importErrorMessage} from '../io/project-import.js';
import {exportEditorHTML} from '../io/editor-export.js';
import {mountEditor,registerEditorAdapter,getEditorAdapter} from './editor-adapter.js';
const $=id=>document.getElementById(id), store=new ProjectStore(),owner=crypto.randomUUID();
let navigation=Promise.resolve(),listRender=0,session=0,closing=false,drainingEditor=false,recovering=false,recoveryFlight=null,recoveryError=null;
let importFlight=null,importSource=null;
let leaseWait=null;
const navigate=fn=>{const next=navigation.catch(()=>{}).then(fn);navigation=next;return next;};
let view='home',core=null,lock=null,autosave=null,editor=null,persistedRevision=null,heartbeat=null,notifyTimer=null;
const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('sp-framework-changes'):null;
function notify(text,error=false){$('notification').textContent=text;$('notification').classList.toggle('error',error);$('notification').hidden=false;clearTimeout(notifyTimer);notifyTimer=setTimeout(()=>$('notification').hidden=true,6500);}
const guard=fn=>(...args)=>{try{return Promise.resolve(fn(...args)).catch(e=>{console.error(e);notify(e.message,true);});}catch(e){console.error(e);notify(e.message,true);}};
function refreshRecoveryControls(failed=false){
 $('backup-json').hidden=false;
 $('recover-project').hidden=!core||(!failed&&!!lock&&!autosave?.lastError&&!recoveryError);
 $('recover-project').disabled=recovering;
 $('recover-project').textContent=recovering?'正在保存恢复副本…':'恢复为独立项目';
 $('retry-save').disabled=recovering||!lock;
 $('takeover').disabled=recovering;
}
function setState(state,revision,error){
 const latest=core?.getDocument().revision;
 if(state==='saved'&&revision===latest)recoveryError=null;
 $('save-state').textContent=state==='saved'&&revision===latest?`已保存到本地 · 修订 ${revision}`:state==='failed'?`保存失败 · ${error?.message||'请重试或恢复为独立项目'}`:state==='saving'?'正在保存…':'等待保存…';
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
 try{return !!(editor?.getRejectedSnapshot?.()||await editor?.getRecoveryDocument?.());}
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
   if(!record||record.deletedAt){stopLeaseWait(waiting);$('save-state').textContent='只读 · 项目已不存在或已移入回收站，当前内容仍可导出备份。';return;}
   new DocumentCore(record.document); // Validate before retiring the visible snapshot.
   stopLeaseWait(waiting);clearCurrent();
   const lease=acquired;acquired=null;activating=true; // activateProject owns the new lease from here.
   await activateProject(record,lease);
   notify('写入权已恢复，已读取最新保存的内容。');
  }catch(error){
   if(activating)notify('写入权已取得，但重新打开项目失败，请返回工作台重试：'+error.message,true);
   else if(current()){$('save-state').textContent='只读 · 暂时无法检查写入权，稍后重试；可主动接管。';scheduleLeaseWait(waiting);}
   else if(leaseWait===waiting)stopLeaseWait(waiting);
  }finally{if(acquired)await store.release(acquired).catch(()=>{});}
 });
 return task;
}
function loseLock(){
 stopLeaseWait();
 lock=null;setEditorReadOnly(true);$('project-title').disabled=true;$('takeover').hidden=false;
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
function repaint(){const doc=core.getDocument();$('project-title').value=doc.title;$('revision').textContent=`r${doc.revision} / ${doc.slides.length} 页`;try{editor?.update?.(doc);}catch(error){notify('编辑器预览更新失败，文档仍保留：'+error.message,true);}}
function edit(operations,expectedRevision=core?.getDocument().revision){if(closing&&!drainingEditor)throw new Error('项目正在切换，当前编辑已停止');if(!core||!lock)throw new Error('当前项目只读，请先获取写入权');const result=core.edit(operations,{expectedRevision});autosave.schedule(core.getDocument());repaint();return result;}
function clearCurrent(){
 stopLeaseWait();
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
 document.body.classList.add('editor-open');$('home-view').hidden=true;$('workspace-view').hidden=false;$('project-title').disabled=!lock||closing;$('takeover').hidden=!!lock;$('retry-save').hidden=true;
 $('save-state').textContent=lock?`已保存到本地 · 修订 ${persistedRevision}`:waitForLease?'只读 · 写入权暂被占用，等待释放；可主动接管。':'只读 · 暂未取得写入权，可主动接管或恢复为独立项目。';
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
 try{editor=await mountEditor({container:$('editor-mount'),document:core.getDocument(),readOnly:!lock||closing,onEdit:scoped(edit),onUndo:scoped(undo),onRedo:scoped(redo),onSave:scoped(()=>autosave.flush()),getHistoryState:()=>({canUndo:core?.canUndo??false,canRedo:core?.canRedo??false}),onImportFile:importFile,onExport:()=>exportProject(),onHome:()=>home(),onCommitRejected:error=>{if(!active())return;stopLeaseWait();recoveryError=error;setState('failed',core?.getDocument().revision,error);refreshRecoveryControls(true);}});}
 catch(error){editorValid=false;$('editor-mount').textContent='编辑器加载失败，项目仍保留，可导出备份。'+error.message;editor=null;notify('编辑器加载失败：'+error.message,true);}
 repaint();startHeartbeat();if(waitForLease&&!lock)startLeaseWait();return core.getDocument();
}
async function openProjectNow(id,{takeover=false}={}){
 await releaseCurrent();
 const lease=await store.acquire(id,owner,{takeover});
 let rec;
 try{rec=await store.get(id);if(!rec||rec.deletedAt)throw new Error('项目不存在或已在回收站');await store.markOpened(id);}
 catch(error){await store.release(lease).catch(()=>{});throw error;}
 return activateProject(rec,lease,{waitForLease:!takeover&&!lease});
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
function undo(){if(closing)throw new Error('项目正在切换');if(!lock)throw new Error('当前项目只读');const doc=core.undo({expectedRevision:core.getDocument().revision});autosave.schedule(core.getDocument());repaint();return doc;}
function redo(){if(closing)throw new Error('项目正在切换');if(!lock)throw new Error('当前项目只读');const doc=core.redo({expectedRevision:core.getDocument().revision});autosave.schedule(core.getDocument());repaint();return doc;}
function exportJSONBackup(){if(!core)throw new Error('请先打开项目');let rejected;try{rejected=editor?.getRecoveryDocument?.();}catch(error){const raw=editor?.getRejectedSnapshot?.();if(raw){notify('候选数据未通过Core校验，已导出原始编辑器JSON，请保留该文件。',true);return downloadJSONBackup(raw);}throw error;}if(rejected)return downloadJSONBackup(rejected);if(editor?.flush)return flushEditor().then(()=>downloadJSONBackup(core.getDocument()));return downloadJSONBackup(core.getDocument());}
function downloadJSONBackup(doc){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}));a.download='SP-backup-'+(doc.id||'editor-recovery')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);return doc;}
function download(html,title){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));a.download=(title.replace(/[\\/:*?"<>|]/g,'_').slice(0,100)||'SP')+'.html';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
async function exportProject(id){if(!id)await flushEditor();const doc=id?(await store.get(id)).document:core.getDocument();if(!id&&editor?.renderLegacyHTML){download(await exportEditorHTML(doc,await editor.renderLegacyHTML()),doc.title);notify('已导出可重新编辑版，包含备注与批注，请勿直接作为公开分享版。浏览器与复杂动效仍需验收。');return;}const report=inspectRenderCompatibility(doc);download(await exportHTML(doc),doc.title);notify(!report.hasKnownGaps?'已生成可重新编辑版HTML，包含备注与批注，请勿直接作为公开分享版。':`已导出可重新编辑版，包含备注与批注，请勿直接作为公开分享版。基础渲染另有 ${report.warnings.length} 项样式仅保留数据。`);}
async function newProject(title,ratio='16:9'){const doc=createDocument({title,slides:[{id:crypto.randomUUID(),elements:[],animations:[]}],canvas:ratio==='4:3'?{width:960,height:720}:{width:1280,height:720}});await store.create(doc);await openProject(doc.id);announce();return doc;}
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
async function mutateCard(id,action){const rec=await store.get(id);if(!rec)throw new Error('项目已不存在');if(action==='open')return openProject(id);if(action==='export')return exportProject(id);
 if(action==='copy'){const doc=structuredClone(rec.document);doc.id=crypto.randomUUID();doc.title+=' · 副本';doc.revision=0;doc.metadata.createdAt=new Date().toISOString();doc.metadata.updatedAt=doc.metadata.createdAt;await store.create(doc);}
 if(action==='rename'){const title=prompt('项目名称',rec.document.title);if(title===null||!title.trim())return;const lease=await store.acquire(id,owner);if(!lease)throw new Error('项目正在另一个标签页编辑');try{const c=new DocumentCore(rec.document);c.edit([{type:'updateProject',properties:{title:title.trim()}}],{expectedRevision:rec.document.revision});await store.save(c.getDocument(),{expectedRevision:rec.document.revision,lock:lease});}finally{await store.release(lease);}}
 if(action==='delete'||action==='restore'){await store.setDeleted(id,action==='delete',{owner});notify(action==='delete'?'已移入回收站，可随时恢复。':'项目已恢复。');}
 announce();await renderProjects();
}
async function renderProjects(){const ticket=++listRender,trash=view==='trash';let records=await store.list({trash});if(ticket!==listRender)return;const search=$('search').value.trim().toLowerCase();records=records.filter(r=>r.document.title.toLowerCase().includes(search));records.sort($('sort').value==='title'?(a,b)=>a.document.title.localeCompare(b.document.title):(a,b)=>(view==='recent'?b.openedAt-a.openedAt:b.modifiedAt-a.modifiedAt));$('list-title').firstChild.textContent=trash?'回收站 ':view==='recent'?'最近使用 ':'我的项目 ';$('count').textContent=String(records.length).padStart(2,'0');$('empty').hidden=!!records.length;$('projects').replaceChildren();for(const rec of records){const doc=rec.document,card=document.createElement('article');card.className='project';card.dataset.projectId=doc.id;const cover=document.createElement('button');cover.className='cover';cover.setAttribute('aria-label','打开 '+doc.title);if(doc.slides.length){try{cover.innerHTML=renderSlideSVG(doc,doc.slides[0].id);}catch{cover.textContent='预览暂不可用';}}else{const mark=document.createElement('span');mark.className='empty-cover';mark.textContent='SUPERIOR POINT';cover.append(mark);}cover.disabled=trash;cover.onclick=guard(()=>openProject(doc.id));card.append(cover);const info=document.createElement('div');info.className='project-info';const title=document.createElement('h3');title.className='project-title';title.textContent=doc.title;info.append(title);const meta=document.createElement('div');meta.className='project-meta';meta.textContent=`${doc.slides.length} 页 · 本地 · ${new Date(rec.modifiedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}`;info.append(meta);const actions=document.createElement('div');actions.className='project-actions';for(const [label,action] of trash?[['恢复','restore']]:[['重命名','rename'],['复制','copy'],['导出','export'],['删除','delete']]){const b=document.createElement('button');b.textContent=label;if(action==='export')b.title='可重新编辑版：包含备注与批注，请勿直接作为公开分享版';b.dataset.action=action;b.onclick=guard(()=>mutateCard(doc.id,action));actions.append(b);}info.append(actions);card.append(info);$('projects').append(card);}}
function home(next=view){return navigate(()=>homeNow(next));}
async function homeNow(next){await releaseCurrent();document.body.classList.remove('editor-open');view=next;$('workspace-view').hidden=true;$('home-view').hidden=false;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));await renderProjects();}
$('open-example').onclick=guard(async()=>{const doc=fiveSlideDocument();doc.id=crypto.randomUUID();doc.metadata.createdAt=new Date().toISOString();doc.metadata.updatedAt=doc.metadata.createdAt;await store.create(doc);await openProject(doc.id);});
$('new-project').onclick=()=>{$('new-dialog').showModal();$('new-title').select();};$('cancel-new').onclick=()=>$('new-dialog').close();$('new-form').onsubmit=guard(async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{await newProject($('new-title').value.trim()||'未命名演示文稿',$('new-ratio').value);$('new-dialog').close();}finally{button.disabled=false;}});
const chooseImport=()=>{if(!importFlight)$('file-input').click();};
$('import-top').onclick=chooseImport;$('file-input').onchange=guard(async e=>{try{await importFile(e.target.files[0]);}finally{e.target.value='';}});$('import-go-home').onclick=guard(()=>{$('search').value='';return home('home');});$('back-home').onclick=guard(()=>home());$('project-title').onchange=guard(e=>edit([{type:'updateProject',properties:{title:e.target.value.trim()||'未命名演示文稿'}}]));$('export-project').onclick=guard(()=>exportProject());$('retry-save').onclick=guard(()=>autosave?.flush());$('backup-json').onclick=guard(exportJSONBackup);$('recover-project').onclick=guard(recoverProject);$('takeover').onclick=guard(async()=>{const id=core.getDocument().id;if(autosave?.pending)throw new Error('请先恢复为独立项目以保存当前改动，再接管原项目。');await openProject(id,{takeover:true});announce();});$('search').oninput=guard(renderProjects);$('sort').onchange=guard(renderProjects);document.querySelectorAll('[data-view]').forEach(b=>b.onclick=guard(()=>home(b.dataset.view)));
window.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='o'){e.preventDefault();chooseImport();}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();guard(()=>autosave?.flush())();}});
window.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();document.body.classList.add('dragging');}});window.addEventListener('dragleave',e=>{if(!e.relatedTarget)document.body.classList.remove('dragging');});window.addEventListener('drop',guard(async e=>{e.preventDefault();document.body.classList.remove('dragging');await importFile(e.dataTransfer.files[0]);}));
window.addEventListener('beforeunload',e=>{if(importFlight||recovering||autosave?.pending||autosave?.running){e.preventDefault();e.returnValue='';}});window.addEventListener('pagehide',()=>{store.release(lock).catch(()=>{});});document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')autosave?.flush().catch(()=>{});});
channel?.addEventListener('message',async e=>{if(e.data.owner===owner)return;if(!core)await renderProjects();else if(lock&&e.data.projectId===core.getDocument().id)await renewCurrentLock();});
window.SPFramework={ready:false,store,newProject,openProject,edit,undo,redo,flush:()=>autosave?.flush(),getDocument:()=>core?.getDocument(),getState:()=>({readOnly:!lock,persistedRevision,saveError:autosave?.lastError?.message,recoveryError:recoveryError?.message,recovering,importing:!!importFlight,pending:!!autosave?.pending,saving:!!autosave?.running}),recoverProject,exportJSONBackup,importFile,home,exportProject,registerEditorAdapter};
store.open().then(()=>home()).then(()=>window.SPFramework.ready=true).catch(e=>{notify('无法打开本地存储：'+e.message,true);$('save-state').textContent='存储不可用';});

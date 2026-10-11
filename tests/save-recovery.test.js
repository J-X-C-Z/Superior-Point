// JSDOM/fake-indexeddb simulations; not real-browser, layout, or durability-after-crash evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import 'fake-indexeddb/auto';
import {DocumentCore} from '../core/document-core.js';
import {fiveSlideDocument} from '../examples/five-slides.js';
import {ProjectStore, AutosaveQueue} from '../storage/project-store.js';
import {createRecoveryDocument} from '../storage/project-recovery.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('DOM wait timed out');};
async function setup({channel=false}={}){
 await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase('superior-point-framework-v1');request.onsuccess=resolve;request.onerror=()=>reject(request.error);});
 const dom=new JSDOM(await readFile(new URL('../web/index.html',import.meta.url),'utf8'),{url:'http://localhost/web/'});
 globalThis.window=dom.window;globalThis.document=dom.window.document;
 let message;
 globalThis.BroadcastChannel=channel?class {postMessage(){} addEventListener(type,callback){if(type==='message')message=callback;}}:undefined;
 await import(`../web/app.js?recovery=${crypto.randomUUID()}`);await wait(()=>window.SPFramework?.ready);
 const app=window.SPFramework;
 return {app,dom,$:id=>document.getElementById(id),broadcast:data=>message({data}),cleanup:async()=>{await app.home();app.store.close();dom.window.close();}};
}

const editTitle=(app,title)=>app.edit([{type:'updateProject',properties:{title}}]);

test('recovery creates a fresh validated identity while retaining every content field and metadata history',()=>{
 const source=fiveSlideDocument();source.revision=17;source.metadata.author={name:'original'};source.metadata.spRecovery={custom:['untouched']};source.metadata.unknown='keep';source.extensions.vendor={raw:[1,2,3]};source.unknownRoot={preserved:true};
 const before=structuredClone(source),now='2026-10-10T10:00:00.000Z';
 const copy=createRecoveryDocument(source,{id:'recovered-id',now,persistedRevision:14,reason:'REVISION_CONFLICT'});
 assert.deepEqual(source,before);assert.equal(copy.id,'recovered-id');assert.equal(copy.revision,0);assert.equal(copy.title,source.title+' · 恢复副本');
 for(const key of ['slides','assets','canvas','extensions','unknownRoot'])assert.deepEqual(copy[key],source[key]);
 assert.equal(copy.metadata.createdAt,now);assert.equal(copy.metadata.updatedAt,now);assert.deepEqual(copy.metadata.author,source.metadata.author);assert.equal(copy.metadata.unknown,'keep');
 assert.deepEqual(copy.metadata.spRecovery.previous,source.metadata.spRecovery);
 assert.deepEqual(copy.metadata.spRecovery.source,{projectId:source.id,title:source.title,revision:17,persistedRevision:14,createdAt:source.metadata.createdAt,updatedAt:source.metadata.updatedAt});
 assert.equal(copy.metadata.spRecovery.reason,'REVISION_CONFLICT');
 assert.throws(()=>createRecoveryDocument(source,{id:source.id}),/新的项目 ID/);
 assert.throws(()=>createRecoveryDocument(source,{now:'invalid date'}),/validation/);
 const next=createRecoveryDocument(copy,{id:'second-copy'});assert.deepEqual(next.metadata.spRecovery.previous,copy.metadata.spRecovery);
});

test('paused autosave waits for in-flight success but does not drain or discard the newest pending snapshot',async()=>{
 const gate=deferred(),writes=[];const queue=new AutosaveQueue({delay:100000,write:async doc=>{writes.push(doc.revision);await gate.promise;}});
 queue.schedule({revision:1});const saving=queue.flush();queue.schedule({revision:2});queue.pause();const idle=queue.waitForIdle();gate.resolve();await Promise.all([saving,idle]);
 assert.deepEqual(writes,[1]);assert.equal(queue.pending.revision,2);await queue.flush();assert.deepEqual(writes,[1]);
 queue.resume();await queue.flush();assert.deepEqual(writes,[1,2]);queue.cancel();
});

test('paused autosave retains the newest pending document when an older write fails',async()=>{
 const gate=deferred();const queue=new AutosaveQueue({delay:100000,write:()=>gate.promise});
 queue.schedule({revision:1});const saving=assert.rejects(queue.flush(),/lost/);queue.schedule({revision:3});queue.pause();const idle=queue.waitForIdle();gate.reject(new Error('lost'));await Promise.all([saving,idle]);
 assert.equal(queue.pending.revision,3);assert.match(queue.lastError.message,/lost/);queue.cancel();
});

test('lock-loss recovery preserves latest local data and remote newer content; stale adapter callbacks cannot touch the copy',async()=>{
 const {app,$,cleanup}=await setup();const contexts=[];app.registerEditorAdapter({mount(context){contexts.push(context);return {update(){},setReadOnly(){},destroy(){}};}});
 const other=new ProjectStore({name:app.store.name});
 try{
  const source=await app.newProject('Original');const stale=contexts.at(-1);
  const doc=app.getDocument();editTitle(app,'Local unsaved');
  app.edit([{type:'updateProject',properties:{extensions:{custom:{full:['data']}},assets:[{id:'asset',data:'opaque-preserved-data'}]}},{type:'createElement',slideId:doc.slides[0].id,element:{id:'local-element',type:'text',x:1,y:2,w:200,h:40,text:'Keep latest'}}]);
  const latest=app.getDocument(),lease=await other.acquire(source.id,'other-tab',{takeover:true});
  const remote=new DocumentCore(source);remote.edit([{type:'updateProject',properties:{title:'Remote latest'}}]);await other.save(remote.getDocument(),{expectedRevision:0,lock:lease});
  await assert.rejects(app.flush(),{code:'LOCK_LOST'});assert.equal(app.getState().readOnly,true);assert.equal(app.getState().pending,true);assert.equal($('recover-project').hidden,false);
  const recovered=await app.recoverProject();
  assert.notEqual(recovered.id,source.id);assert.equal(recovered.revision,0);
  for(const key of ['slides','assets','canvas','extensions'])assert.deepEqual(recovered[key],latest[key]);
  assert.equal(recovered.metadata.spRecovery.source.revision,latest.revision);assert.equal(recovered.metadata.spRecovery.reason,'LOCK_LOST');
  assert.deepEqual((await other.get(source.id)).document,remote.getDocument());await other.renew(lease);
  assert.deepEqual((await app.store.get(recovered.id)).document,recovered);assert.equal(app.getState().pending,false);assert.equal(app.getState().readOnly,false);assert.equal(app.getState().saveError,undefined);
  for(const callback of ['onEdit','onUndo','onRedo','onSave'])assert.throws(()=>stale[callback]([]),/失效/);
  assert.equal($('recovery-note').hidden,false);assert.match($('recovery-note').textContent,/原项目.*未被.*覆盖/);
  editTitle(app,'Continue editing recovered copy');await app.flush();assert.equal((await app.store.get(recovered.id)).document.title,'Continue editing recovered copy');
  await app.home();await app.openProject(recovered.id);assert.equal($('recovery-note').hidden,false);
 }finally{other.close();await cleanup();}
});

test('CAS-conflict recovery never overwrites a newer stored source revision',async()=>{
 const {app,cleanup}=await setup();
 try{
  const source=await app.newProject('CAS source');editTitle(app,'Local branch');
  const remote=new DocumentCore(source);remote.edit([{type:'updateProject',properties:{title:'Stored newer branch'}}]);
  await app.store.tx(['projects'],'readwrite',(tx,done)=>{const table=tx.objectStore('projects'),request=table.get(source.id);request.onsuccess=()=>{request.result.document=remote.getDocument();table.put(request.result);done(true);};});
  await assert.rejects(app.flush(),{code:'REVISION_CONFLICT'});await assert.rejects(app.home(),{code:'REVISION_CONFLICT'});
  const recovered=await app.recoverProject();assert.equal(recovered.title,'Local branch · 恢复副本');assert.equal(recovered.metadata.spRecovery.reason,'REVISION_CONFLICT');
  assert.deepEqual((await app.store.get(source.id)).document,remote.getDocument());await app.home();assert.equal(app.getDocument(),undefined);
 }finally{await cleanup();}
});

test('failed recovery create retains source session and pending data; retries create one independent project',async()=>{
 const {app,$,cleanup}=await setup();const originalCreate=app.store.create.bind(app.store),originalSave=app.store.save.bind(app.store),originalRelease=app.store.release.bind(app.store);let releaseCalls=0;
 try{
  const source=await app.newProject('Quota source');editTitle(app,'Keep me');const latest=app.getDocument();
  app.store.save=async()=>{throw Error('original quota');};await assert.rejects(app.flush(),/original quota/);
  app.store.release=async lease=>{releaseCalls++;return originalRelease(lease);};
  app.store.create=async()=>{throw Error('recovery quota');};
  await assert.rejects(app.recoverProject(),/recovery quota/);
  assert.deepEqual(app.getDocument(),latest);assert.equal(app.getState().pending,true);assert.equal(app.getState().readOnly,false);assert.equal(app.getState().recovering,false);assert.equal(releaseCalls,0);
  assert.match($('save-state').textContent,/恢复副本未保存.*原改动仍保留/);assert.equal($('recover-project').disabled,false);assert.equal($('backup-json').hidden,false);
  editTitle(app,'Even newer retained data');app.store.create=originalCreate;
  const copy=await app.recoverProject();assert.equal(copy.title,'Even newer retained data · 恢复副本');assert.equal((await app.store.list()).length,2);assert.equal(releaseCalls,1);assert.equal((await app.store.get(source.id)).document.title,'Quota source');
 }finally{app.store.create=originalCreate;app.store.save=originalSave;app.store.release=originalRelease;await cleanup();}
});

test('recovery freezes edits, protects unload, waits for in-flight save, and coalesces double clicks before clearing old pending',async()=>{
 const {app,dom,$,cleanup}=await setup();const save=app.store.save.bind(app.store),create=app.store.create.bind(app.store),release=app.store.release.bind(app.store),saveGate=deferred(),createGate=deferred(),createEntered=deferred();let recovery,flush,createCalls=0,releaseCalls=0;const writes=[];
 try{
  const source=await app.newProject('Running save');editTitle(app,'Revision one');
  app.store.save=async(doc,options)=>{writes.push(doc.revision);await saveGate.promise;return save(doc,options);};
  flush=app.flush();editTitle(app,'Revision two');
  app.store.create=async doc=>{createCalls++;createEntered.resolve();await createGate.promise;return create(doc);};
  app.store.release=async lease=>{releaseCalls++;return release(lease);};
  recovery=app.recoverProject();assert.equal(app.recoverProject(),recovery);
  await wait(()=>app.getState().recovering);assert.throws(()=>editTitle(app,'Too late'),/切换/);assert.equal($('recover-project').disabled,true);
  const unload=new dom.window.Event('beforeunload',{cancelable:true});dom.window.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true);
  assert.equal(createCalls,0);saveGate.resolve();await createEntered.promise;await flush;
  assert.equal(app.getDocument().id,source.id);assert.equal(app.getState().pending,true);assert.equal(releaseCalls,0);assert.equal(app.recoverProject(),recovery);
  createGate.resolve();const copy=await recovery;
  assert.deepEqual(writes,[1]);assert.equal(createCalls,1);assert.equal(copy.title,'Revision two · 恢复副本');assert.equal(copy.metadata.spRecovery.source.persistedRevision,1);assert.equal((await app.store.get(source.id)).document.title,'Revision one');
  assert.equal(app.getState().pending,false);assert.equal(releaseCalls,1);await assert.rejects(app.recoverProject(),/没有待恢复/);
  const finishedUnload=new dom.window.Event('beforeunload',{cancelable:true});dom.window.dispatchEvent(finishedUnload);assert.equal(finishedUnload.defaultPrevented,false);
 }finally{saveGate.resolve();createGate.resolve();await flush?.catch(()=>{});await recovery?.catch(()=>{});app.store.save=save;app.store.create=create;app.store.release=release;await cleanup();}
});

test('recovery handles in-flight write failure and ignores old heartbeat failure after switching',async()=>{
 const {app,broadcast,cleanup}=await setup({channel:true});const save=app.store.save.bind(app.store),renew=app.store.renew.bind(app.store);const savingGate=deferred(),renewGate=deferred();let recovering,saving,renewing;
 try{
  const source=await app.newProject('Late failure');editTitle(app,'Latest before failure');
  app.store.renew=()=>renewGate.promise;renewing=broadcast({owner:'another-tab',projectId:source.id});
  app.store.save=()=>savingGate.promise;saving=assert.rejects(app.flush(),/in-flight failed/);
  recovering=app.recoverProject();await wait(()=>app.getState().recovering);savingGate.reject(Object.assign(new Error('in-flight failed'),{code:'LOCK_LOST'}));await saving;
  const copy=await recovering;assert.notEqual(copy.id,source.id);assert.equal(copy.title,'Latest before failure · 恢复副本');assert.equal(app.getState().readOnly,false);
  renewGate.reject(new Error('stale heartbeat failure'));await renewing;assert.equal(app.getState().readOnly,false);assert.equal(app.getState().saveError,undefined);
 }finally{savingGate.resolve();renewGate.resolve();await saving?.catch(()=>{});await recovering?.catch(()=>{});await renewing?.catch(()=>{});app.store.save=save;app.store.renew=renew;await cleanup();}
});

test('readonly project can recover independently; post-commit lock or adapter failures keep a reachable durable copy',async()=>{
 const {app,$,cleanup}=await setup();const acquire=app.store.acquire.bind(app.store),other=new ProjectStore({name:app.store.name});
 try{
  const source=await app.newProject('Readonly source');await app.home();await other.acquire(source.id,'other',{takeover:true});await app.openProject(source.id);assert.equal(app.getState().readOnly,true);
  app.store.acquire=async()=>{throw Error('new lock unavailable');};app.registerEditorAdapter({mount(){throw Error('adapter unavailable');}});
  const copy=await app.recoverProject();assert.equal(app.getState().readOnly,true);assert.equal(app.getState().pending,false);assert.match($('editor-mount').textContent,/编辑器加载失败/);assert.equal($('backup-json').hidden,false);
  assert.deepEqual((await app.store.get(copy.id)).document,copy);await app.home();assert.equal(document.querySelectorAll('.project').length,2);assert.equal((await app.store.get(source.id)).document.title,'Readonly source');
  app.store.acquire=acquire;await app.openProject(copy.id);assert.equal(app.getState().readOnly,false);assert.equal(app.getDocument().id,copy.id);
 }finally{app.store.acquire=acquire;other.close();await cleanup();}
});

test('JSON backup is always available and exports latest complete in-memory data without draining pending writes',async()=>{
 const {app,dom,$,cleanup}=await setup();const createURL=URL.createObjectURL,revokeURL=URL.revokeObjectURL;let blob,download;
 URL.createObjectURL=value=>{blob=value;return 'blob:backup';};URL.revokeObjectURL=()=>{};
 dom.window.HTMLAnchorElement.prototype.click=function(){download=this.download;};
 try{
  const source=await app.newProject('Backup');assert.equal($('backup-json').hidden,false);editTitle(app,'Unsaved JSON');
  const latest=app.getDocument();$('backup-json').click();assert.deepEqual(JSON.parse(await blob.text()),latest);assert.match(download,new RegExp(source.id));assert.equal(app.getState().pending,true);
 }finally{URL.createObjectURL=createURL;URL.revokeObjectURL=revokeURL;await cleanup();}
});

test('old lock release failure does not lose the committed copy and a new adapter without setReadOnly starts editable',async()=>{
 const {app,cleanup}=await setup();const release=app.store.release.bind(app.store);let mountContext;
 app.registerEditorAdapter({mount(context){mountContext=context;return {update(){},destroy(){}};}});
 try{
  const source=await app.newProject('Release failure');editTitle(app,'Preserved across cleanup error');
  app.store.release=async()=>{throw Error('release unavailable');};
  const copy=await app.recoverProject();assert.equal(mountContext.readOnly,false);assert.equal(app.getState().readOnly,false);assert.notEqual(copy.id,source.id);
  assert.deepEqual((await app.store.get(copy.id)).document,copy);mountContext.onEdit([{type:'updateProject',properties:{title:'Still editable'}}]);await app.flush();assert.equal((await app.store.get(copy.id)).document.title,'Still editable');
  assert.equal((await app.store.get(source.id)).document.title,'Release failure');
 }finally{app.store.release=release;await cleanup();}
});

test('successful original-save retry clears recovery-create failure and does not leave a false recovery warning',async()=>{
 const {app,$,cleanup}=await setup();const create=app.store.create.bind(app.store);
 try{
  await app.newProject('Retry original');editTitle(app,'Unsaved');app.store.create=async()=>{throw Error('create failed');};await assert.rejects(app.recoverProject(),/create failed/);
  assert.equal(app.getState().pending,true);assert.match(app.getState().recoveryError,/create failed/);
  await app.flush();assert.equal(app.getState().recoveryError,undefined);assert.equal($('recover-project').hidden,true);assert.match($('save-state').textContent,/已保存/);
 }finally{app.store.create=create;await cleanup();}
});

// JSDOM/fake-indexeddb lease simulations, not a real browser or pagehide reliability claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import 'fake-indexeddb/auto';
import {createDocument,DocumentCore} from '../core/document-core.js';
import {ProjectStore} from '../storage/project-store.js';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('DOM wait timed out');};
function leaseTimers(){
 const set=globalThis.setTimeout,clear=globalThis.clearTimeout,pending=new Set();
 globalThis.setTimeout=(fn,delay,...args)=>{if(delay!==1000)return set(fn,delay,...args);const timer={fn:()=>fn(...args)};pending.add(timer);return timer;};
 globalThis.clearTimeout=timer=>{if(!pending.delete(timer))clear(timer);};
 return {get size(){return pending.size;},peek(){return pending.values().next().value?.fn;},async fire(){const timer=pending.values().next().value;assert.ok(timer,'A lease retry must be scheduled');pending.delete(timer);return timer.fn();},restore(){globalThis.setTimeout=set;globalThis.clearTimeout=clear;pending.clear();}};
}
async function setup(){
 await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('superior-point-framework-v1');r.onsuccess=resolve;r.onerror=()=>reject(r.error);});
 const dom=new JSDOM(await readFile(new URL('../web/index.html',import.meta.url),'utf8'),{url:'http://localhost/web/'});
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.BroadcastChannel=undefined;
 await import(`../web/app.js?lease-reopen=${crypto.randomUUID()}`);await wait(()=>window.SPFramework?.ready);
 const app=window.SPFramework,contexts=[];app.registerEditorAdapter({mount(context){contexts.push(context);return {update(){},setReadOnly(){},destroy(){}};}});
 const timers=leaseTimers(),other=new ProjectStore({name:app.store.name});
 return {app,other,timers,contexts,$:id=>document.getElementById(id),cleanup:async()=>{await app.home();other.close();app.store.close();timers.restore();dom.window.close();}};
}
async function occupied(app,other,title='Reloaded project'){
 const doc=createDocument({title});await app.store.create(doc);const lease=await other.acquire(doc.id,'previous-page');await app.openProject(doc.id);return {doc,lease};
}

test('first read-only reopen waits for lease expiry, rereads the latest durable revision, and then saves safely',async()=>{
 const {app,other,timers,contexts,$,cleanup}=await setup();
 try{
  assert.equal(app.store.leaseMs,15000);
  const {doc,lease}=await occupied(app,other),oldContext=contexts.at(-1);
  assert.equal(app.getState().readOnly,true);assert.match($('save-state').textContent,/暂被占用.*等待释放/);assert.doesNotMatch($('save-state').textContent,/另一个标签页正在编辑/);
  const newer=new DocumentCore(doc);newer.edit([{type:'updateProject',properties:{title:'New authoritative content'}}]);await other.save(newer.getDocument(),{expectedRevision:0,lock:lease});
  await other.tx(['locks'],'readwrite',(tx,done)=>{tx.objectStore('locks').put({...lease,expiresAt:Date.now()-1});done(true);});
  await timers.fire();assert.equal(app.getState().readOnly,false);assert.deepEqual(app.getDocument(),newer.getDocument());assert.equal(app.getState().persistedRevision,1);assert.equal(timers.size,0);assert.equal(contexts.length,2);assert.equal($('takeover').hidden,true);
  assert.throws(()=>oldContext.onEdit([{type:'updateProject',properties:{title:'Stale'}}]),/失效/);
  oldContext.onCommitRejected(new Error('late old rejection'));assert.equal(app.getState().recoveryError,undefined);
  app.edit([{type:'updateProject',properties:{title:'Edit after automatic recovery'}}]);await app.flush();assert.equal((await app.store.get(doc.id)).document.revision,2);
 }finally{await cleanup();}
});

test('a live other writer is never taken over; explicit release permits automatic reopening',async()=>{
 const {app,other,timers,contexts,cleanup}=await setup();const acquire=app.store.acquire.bind(app.store),attempts=[];
 try{
  const {doc,lease}=await occupied(app,other);
  app.store.acquire=async(id,owner,options)=>{attempts.push(options);return acquire(id,owner,options);};
  await timers.fire();await timers.fire();assert.equal(app.getState().readOnly,true);assert.equal(contexts.length,1);assert.equal(timers.size,1);assert.ok(attempts.every(options=>!options?.takeover));
  const renewed=await other.renew(lease);assert.equal(renewed.token,lease.token);
  await other.release(renewed);await timers.fire();assert.equal(app.getState().readOnly,false);assert.equal(app.getDocument().id,doc.id);assert.equal(contexts.length,2);assert.equal(timers.size,0);
 }finally{app.store.acquire=acquire;await cleanup();}
});

test('navigation during an in-flight authority read cancels promotion and late callbacks cannot reopen a departed project',async()=>{
 const {app,other,timers,contexts,$,cleanup}=await setup();const get=app.store.get.bind(app.store),gate=deferred(),entered=deferred();let retry,leaving;
 try{
  const {doc,lease}=await occupied(app,other);await other.release(lease);const late=timers.peek();
  app.store.get=async id=>{if(id===doc.id){entered.resolve();await gate.promise;}return get(id);};
  retry=timers.fire();await entered.promise;leaving=app.home();gate.resolve();await Promise.all([retry,leaving]);
  assert.equal(app.getDocument(),undefined);assert.equal($('home-view').hidden,false);assert.equal(contexts.length,1);assert.equal(timers.size,0);
  const probe=await other.acquire(doc.id,'probe-after-navigation');assert.ok(probe,'Cancelled promotion must release its newly acquired lease');await other.release(probe);
  await late();assert.equal(app.getDocument(),undefined);assert.equal(contexts.length,1);assert.equal(timers.size,0);
 }finally{gate.resolve();await retry?.catch(()=>{});await leaving?.catch(()=>{});app.store.get=get;await cleanup();}
});

test('editor recovery drafts and a failed recovery creation stop initial waiting without replacing the draft',async()=>{
 const {app,other,timers,cleanup}=await setup();const create=app.store.create.bind(app.store);let context,draft;
 app.registerEditorAdapter({mount(value){context=value;return {update(){},setReadOnly(){},destroy(){},getRecoveryDocument(){return draft&&structuredClone(draft);}};}});
 try{
  const {doc,lease}=await occupied(app,other),late=timers.peek();const local=new DocumentCore(doc);local.edit([{type:'updateProject',properties:{title:'Uncommitted recovery draft'}}]);draft=local.getDocument();
  context.onCommitRejected(new Error('candidate commit rejected'));assert.equal(timers.size,0);
  app.store.create=async()=>{throw Error('recovery quota');};await assert.rejects(app.recoverProject(),/recovery quota/);app.store.create=create;
  const remote=new DocumentCore(doc);remote.edit([{type:'updateProject',properties:{title:'Remote newer document'}}]);await other.save(remote.getDocument(),{expectedRevision:0,lock:lease});await other.release(lease);
  await late();assert.equal(app.getState().readOnly,true);assert.equal(app.getDocument().title,doc.title);assert.equal(draft.title,'Uncommitted recovery draft');assert.match(app.getState().recoveryError,/recovery quota/);assert.equal((await app.store.get(doc.id)).document.title,'Remote newer document');assert.equal(timers.size,0);
 }finally{app.store.create=create;await cleanup();}
});

test('an unreported adapter recovery snapshot is also preserved instead of automatic authority reload',async()=>{
 const {app,other,timers,$,cleanup}=await setup();let draft;
 app.registerEditorAdapter({mount(){return {update(){},setReadOnly(){},destroy(){},getRecoveryDocument(){return draft;}};}});
 try{
  const {doc,lease}=await occupied(app,other);draft={...doc,title:'Retained adapter-only draft'};await other.release(lease);
  await timers.fire();assert.equal(timers.size,0);assert.equal(app.getState().readOnly,true);assert.equal(app.getDocument().title,doc.title);assert.equal(draft.title,'Retained adapter-only draft');assert.match($('save-state').textContent,/未提交修改.*恢复/);
  const probe=await other.acquire(doc.id,'draft-probe');assert.ok(probe);await other.release(probe);
 }finally{await cleanup();}
});

test('a previously writable session that loses its lease keeps pending edits and never enrolls in automatic reload',async()=>{
 const {app,other,timers,cleanup}=await setup();
 try{
  const doc=await app.newProject('Started writable');app.edit([{type:'updateProject',properties:{title:'Unsaved local work'}}]);const latest=app.getDocument();
  const lease=await other.acquire(doc.id,'new-writer',{takeover:true});await assert.rejects(app.flush(),{code:'LOCK_LOST'});await other.release(lease);
  assert.equal(app.getState().readOnly,true);assert.equal(app.getState().pending,true);assert.equal(timers.size,0);assert.deepEqual(app.getDocument(),latest);assert.equal((await app.store.get(doc.id)).document.title,'Started writable');
  const recovered=await app.recoverProject();assert.equal(recovered.title,'Unsaved local work · 恢复副本');
 }finally{await cleanup();}
});

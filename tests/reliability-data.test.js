// Storage tests use fake-indexeddb; no claim of browser crash/quota durability.
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {mkdtemp,rm,symlink,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DocumentCore,createDocument,importDocument} from '../core/document-core.js';
import {ProjectStore,AutosaveQueue} from '../storage/project-store.js';
import {importHTML} from '../io/html.js';
import {FileStore} from '../mcp/file-store.js';
const fresh=()=>new ProjectStore({name:'sp-reliability-'+crypto.randomUUID()});
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
const title=value=>[{type:'updateProject',properties:{title:value}}];

test('core failed batch preserves document and redo history; inputs/results never alias internal state',()=>{
 const source=createDocument({title:'zero'}),core=new DocumentCore(source);source.title='external mutation';
 const operations=title('one'),result=core.edit(operations);operations[0].properties.title='changed operation';result.title='changed output';
 assert.equal(core.getDocument().title,'one');core.undo();const before=core.getDocument();
 assert.throws(()=>core.edit([...title('partial'),{type:'createSlide',slide:{id:'invalid',elements:[{id:'broken'}]}}]));
 assert.deepEqual(core.getDocument(),before);assert.equal(core.canRedo,true);assert.equal(core.redo().title,'one');
 const detached=core.getDocument();detached.canvas.width=1;assert.equal(core.getDocument().canvas.width,1280);
});
test('IndexedDB abort rolls back both project and lock records in the same transaction',async()=>{
 const store=fresh(),doc=createDocument();try{
  await store.create(doc);const lock=await store.acquire(doc.id,'owner');
  await assert.rejects(store.tx(['projects','locks'],'readwrite',(tx,done,fail)=>{
   tx.objectStore('projects').delete(doc.id);tx.objectStore('locks').delete(doc.id);fail(new Error('injected abort'));
  }),/injected abort/);
  assert.deepEqual((await store.get(doc.id)).document,doc);assert.equal((await store.renew(lock)).token,lock.token);
 }finally{store.close();}
});
test('save snapshots caller data before awaiting IndexedDB and rejects invalid documents atomically',async()=>{
 const store=fresh(),doc=createDocument();try{
  await store.create(doc);const lock=await store.acquire(doc.id,'owner');const core=new DocumentCore(doc);const change=core.edit(title('captured'));
  const saving=store.save(change,{expectedRevision:0,lock});change.title='caller mutation';await saving;
  assert.equal((await store.get(doc.id)).document.title,'captured');const before=await store.get(doc.id);
  await assert.rejects(store.save({...before.document,revision:2,canvas:{width:-1,height:720}},{expectedRevision:1,lock}));
  assert.deepEqual(await store.get(doc.id),before);await store.renew(lock);
 }finally{store.close();}
});
test('autosave failure during a burst retains newest detached snapshot and all concurrent flush callers reject',async()=>{
 const gate=deferred(),writes=[],events=[];let calls=0;
 const queue=new AutosaveQueue({delay:100000,onState:(...args)=>events.push(args),write:async doc=>{writes.push(doc);if(++calls===1)await gate.promise;}});
 try{
  queue.schedule({revision:1,title:'first'});const a=queue.flush(),b=queue.flush();const latest={revision:2,title:'latest'};queue.schedule(latest);latest.title='mutated caller';
  gate.reject(new Error('quota injection'));const result=await Promise.allSettled([a,b]);assert.ok(result.every(r=>r.status==='rejected'));
  assert.deepEqual(queue.pending,{revision:2,title:'latest'});assert.ok(!events.some(([state])=>state==='saved'));
  await queue.flush();assert.deepEqual(writes.map(d=>d.revision),[1,2]);assert.equal(writes[1].title,'latest');assert.equal(queue.lastError,null);
 }finally{queue.cancel();}
});
test('takeover before pending autosave fails closed, retains losing changes, and preserves winning document',async()=>{
 const store=fresh(),doc=createDocument();let queue;try{
  await store.create(doc);const losing=await store.acquire(doc.id,'loser'),core=new DocumentCore(doc);const pending=core.edit(title('losing unsaved content'));
  queue=new AutosaveQueue({delay:100000,write:document=>store.save(document,{expectedRevision:0,lock:losing})});queue.schedule(pending);
  const winner=await store.acquire(doc.id,'winner',{takeover:true}),winning=new DocumentCore(doc).edit(title('winner saved'));
  await store.save(winning,{expectedRevision:0,lock:winner});await assert.rejects(queue.flush(),{code:'LOCK_LOST'});
  assert.deepEqual(queue.pending,pending);assert.deepEqual((await store.get(doc.id)).document,winning);
  await store.release(losing);await store.renew(winner);
 }finally{queue?.cancel();store.close();}
});
test('HTML imports never execute surrounding scripts and reject duplicate, corrupt, prototype and external-resource envelopes',()=>{
 const doc=createDocument(),envelope=d=>`<script id="sp-document" type="application/json">${JSON.stringify(d)}</script>`;
 globalThis.__spImportExecuted=false;
 assert.deepEqual(importHTML(`<script>globalThis.__spImportExecuted=true</script>${envelope(doc)}<img src="https://invalid.example/tracker">`),doc);
 assert.equal(globalThis.__spImportExecuted,false);delete globalThis.__spImportExecuted;
 assert.throws(()=>importHTML(envelope(doc)+envelope(doc)),/exactly one/);
 assert.throws(()=>importHTML('<script id="sp-document" type="application/json">{broken}</script>'),/Corrupt/);
 const poisoned=JSON.parse(JSON.stringify(doc).replace('"extensions":{}','"extensions":{"__proto__":{"polluted":true}}'));
 assert.throws(()=>importHTML(envelope(poisoned)),/Unsafe key/);assert.equal({}.polluted,undefined);
 assert.throws(()=>importDocument({...doc,schemaVersion:999}));
 assert.throws(()=>importHTML(envelope({...doc,extensions:{src:'https://invalid.example/tracker'}})),/external resource/);
});
test('file-store traversal and outside symlinks cannot read or overwrite outside the selected root',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sp-reliability-')),root=path.join(dir,'projects'),outside=path.join(dir,'outside.json');
 try{
  const store=await new FileStore(root).init();await writeFile(outside,'outside sentinel');
  await symlink(outside,path.join(root,'escape.json'));
  for(const candidate of ['../outside.json','/tmp/outside','a/b','a\\b','..','%2e%2e%2foutside']){
   await assert.rejects(store.readFile(candidate));await assert.rejects(store.atomic(candidate,'overwritten'));
  }
  await assert.rejects(store.readFile('escape.json'));await assert.rejects(store.atomic('escape.json','overwritten'));
  assert.equal(await readFile(outside,'utf8'),'outside sentinel');
  const doc=createDocument({id:'stable'});await store.create(doc);await assert.rejects(store.edit(doc.id,[...title('partial'),{type:'invalid'}],0));assert.deepEqual(await store.read(doc.id),doc);
 }finally{await rm(dir,{recursive:true,force:true});}
});

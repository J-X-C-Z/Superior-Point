// jsdom/fake-indexeddb simulations only; this is not real-browser or layout evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import 'fake-indexeddb/auto';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('DOM wait timed out');};
async function setup(){
 const dom=new JSDOM(await readFile(new URL('../web/index.html',import.meta.url),'utf8'),{url:'http://localhost/web/'});
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.BroadcastChannel=undefined;
 await import(`../web/app.js?reliability=${crypto.randomUUID()}`);await wait(()=>window.SPFramework?.ready);
 const app=window.SPFramework;return {app,dom,cleanup:async()=>{await app.home();app.store.close();dom.window.close();}};
}
test('navigation must reject late edits once final save has completed and lock release is pending',async()=>{
 const {app,cleanup}=await setup();const gate=deferred(),entered=deferred();const release=app.store.release.bind(app.store);let leaving;
 try{
  const doc=await app.newProject('Before navigation');
  app.store.release=async lock=>{entered.resolve();await gate.promise;return release(lock);};
  leaving=app.home();await entered.promise;
  assert.throws(()=>app.edit([{type:'updateProject',properties:{title:'Unsaveable late edit'}}]),/./,'An edit after the final flush must not be accepted');
  gate.resolve();await leaving;
  assert.equal((await app.store.get(doc.id)).document.title,'Before navigation');
 }finally{gate.resolve();await leaving;app.store.release=release;await new Promise(r=>setTimeout(r,550));await cleanup();}
});
test('destroyed editor onEdit cannot mutate a different project',async()=>{
 const {app,cleanup}=await setup();const sessions=[];
 app.registerEditorAdapter({mount(context){sessions.push(context);return {update(){},destroy(){}};}});
 try{
  const a=await app.newProject('Project A');const stale=sessions.at(-1);
  const b=await app.newProject('Project B');const before=app.getDocument();
  assert.notEqual(a.id,b.id);
  try{await stale.onEdit([{type:'updateProject',properties:{title:'Delayed A edit'}}]);}catch{}
  assert.deepEqual(app.getDocument(),before,'A destroyed editor callback must never edit B');
 }finally{await cleanup();}
});
test('repeated queued navigation flushes the original project and ends in the requested project',async()=>{
 const {app,cleanup}=await setup();
 try{
  const a=await app.newProject('A'),b=await app.newProject('B');
  await app.openProject(a.id);app.edit([{type:'updateProject',properties:{title:'A persisted'}}]);
  await Promise.all([app.openProject(b.id),app.home(),app.openProject(a.id),app.openProject(b.id)]);
  assert.equal(app.getDocument().id,b.id);assert.equal((await app.store.get(a.id)).document.title,'A persisted');
 }finally{await cleanup();}
});

test('failed navigation save keeps unsaved project recoverable and queued navigation can retry',async()=>{
 const {app,cleanup}=await setup();const save=app.store.save.bind(app.store);
 try{
  const a=await app.newProject('A');app.edit([{type:'updateProject',properties:{title:'Recover me'}}]);
  app.store.save=async()=>{throw new Error('injected quota failure');};
  await assert.rejects(app.home(),/quota/);assert.equal(app.getDocument().id,a.id);assert.equal(app.getDocument().title,'Recover me');
  assert.equal((await app.store.get(a.id)).document.title,'A');assert.match(app.getState().saveError,/quota/);
  app.store.save=save;await app.flush();await app.home();assert.equal(app.getDocument(),undefined);
  assert.equal((await app.store.get(a.id)).document.title,'Recover me');
 }finally{app.store.save=save;await cleanup();}
});

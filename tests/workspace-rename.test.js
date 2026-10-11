// DOM interaction acceptance; layout and real browser acceptance remain separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import 'fake-indexeddb/auto';
import {DocumentCore} from '../core/document-core.js';

const wait=async check=>{for(let i=0;i<500;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('DOM wait timed out');};
test('inline local/cloud rename commits, cancels, rejects and preserves titles on lease/CAS/network failures',async()=>{
 const dom=new JSDOM(await readFile(new URL('../web/index.html',import.meta.url),'utf8'),{url:'http://localhost/local'}),previousFetch=globalThis.fetch;
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.BroadcastChannel=undefined;
 const docs=new Map(),user={id:'rename-user',username:'Rename'};let cloudFailure=null,saveGate=null,snapshots=0;
 globalThis.fetch=async(url,options={})=>{
  const path=String(url).replace('/api/v1',''),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;
  const response=(result,status=200)=>({ok:status<400,status,json:async()=>structuredClone(result)});
  if(path==='/auth/login'||path==='/auth/me')return response({user,csrfToken:'csrf'});
  if(path==='/me/tokens')return response([]);
  if(path==='/projects'||path==='/projects?trash=true')return response([...docs.values()].map(doc=>({id:doc.id,title:doc.title,revision:doc.revision,canvas:doc.canvas,slideCount:doc.slides.length,updatedAt:doc.metadata.updatedAt})));
  const id=path.split('/')[2],doc=docs.get(id);assert.ok(doc,'known cloud project '+path);
  if(path.includes('/document'))return response(doc);
  if(path.endsWith('/lease')){
   if(method==='DELETE')return response({released:true});
   if(cloudFailure==='lease')return response({error:{code:'PROJECT_BUSY',message:'云端租约忙碌'}},409);
   return response({leaseToken:crypto.randomUUID(),expiresAt:new Date(Date.now()+60000).toISOString()});
  }
  if(path.endsWith('/snapshot')){
   snapshots++;if(saveGate)await saveGate;
   if(cloudFailure==='network')throw Error('network unavailable');
   if(body.expectedRevision!==doc.revision)return response({error:{code:'REVISION_CONFLICT',message:'云端修订冲突'}},409);
   docs.set(id,body.document);return response(body.document);
  }
  throw Error('unhandled '+path);
 };
 let app,local,cloud;
 const $=id=>document.getElementById(id),card=(source,id)=>document.querySelector(`[data-source="${source}"][data-project-id="${id}"]`);
 const start=(source,id,button=false)=>{const c=card(source,id);if(button)c.querySelector('[data-action=rename]').click();else c.querySelector('h3').dispatchEvent(new dom.window.MouseEvent('dblclick',{bubbles:true}));const input=c.querySelector('input');assert.ok(input);assert.equal(document.activeElement,input);assert.equal(input.selectionStart,0);assert.equal(input.selectionEnd,input.value.length);assert.equal(app.getDocument(),undefined,'rename never opens editor');return input;};
 const key=(input,value,key='Enter')=>{input.value=value;input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));};
 try{
  await import('../web/app.js?rename='+crypto.randomUUID());await wait(()=>window.SPFramework?.ready);app=window.SPFramework;local=app.store;
  app.registerEditorAdapter({mount(){return {update(){},setReadOnly(){},destroy(){},flush(){}};}});
  const original=await app.newProject('Inline original');await app.home();docs.set(original.id,structuredClone(original));
  $('account-trigger').click();const form=$('cloud-login');form.elements.username.value='Rename';form.elements.password.value='test';form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  await wait(()=>app.store.storage==='cloud'&&document.querySelectorAll('.project').length===2);cloud=app.store;
  for(const source of ['local','cloud']){
   const projectStore=source==='local'?local:cloud,id=original.id;
   key(start(source,id),'Discarded','Escape');assert.equal(card(source,id).querySelector('h3').textContent,'Inline original');assert.equal((await projectStore.get(id)).document.title,'Inline original');
   for(const value of ['   ','x'.repeat(501)]){key(start(source,id,true),value);assert.equal(card(source,id).querySelector('input'),null);assert.equal(card(source,id).querySelector('h3').textContent,'Inline original');assert.equal(card(source,id).getAttribute('aria-busy'),null);assert.equal(card(source,id).querySelector('[data-action=rename]').disabled,false);assert.match($('notification').textContent,/名称/);}
   key(start(source,id),source+' Enter');await wait(()=>card(source,id)?.querySelector('h3').textContent===source+' Enter');assert.equal((await projectStore.get(id)).document.title,source+' Enter');
   const blur=start(source,id,true);blur.value=source+' Blur';blur.blur();await wait(()=>card(source,id)?.querySelector('h3').textContent===source+' Blur');await app.home('recent');assert.equal(card(source,id).querySelector('h3').textContent,source+' Blur');
   const savedTitle=source+' Blur';
   // A real second holder blocks local writes; the cloud mock returns the same server lease rejection.
   let otherLease;if(source==='local')otherLease=await local.acquire(id,'other-tab');else cloudFailure='lease';
   key(start(source,id),source+' blocked');await wait(()=>!card(source,id).querySelector('input'));assert.equal(card(source,id).querySelector('h3').textContent,savedTitle);assert.equal((await projectStore.get(id)).document.title,savedTitle);assert.match($('notification').textContent,/标签页|租约/);
   if(otherLease)await local.release(otherLease);cloudFailure=null;
   const conflictInput=start(source,id),newer=new DocumentCore((await projectStore.get(id)).document);newer.edit([{type:'updateProject',properties:{title:source+' Other tab'}}]);
   if(source==='local'){const lease=await local.acquire(id,'other-tab');await local.save(newer.getDocument(),{expectedRevision:newer.getDocument().revision-1,lock:lease});await local.release(lease);}else docs.set(id,newer.getDocument());
   key(conflictInput,source+' stale overwrite');await wait(()=>!card(source,id).querySelector('input'));assert.equal(card(source,id).querySelector('h3').textContent,savedTitle,'failed CAS preserves visible original');assert.equal((await projectStore.get(id)).document.title,source+' Other tab');assert.match($('notification').textContent,/冲突/);await app.home('home');
   const save=projectStore.save;let release;saveGate=new Promise(resolve=>{release=resolve;});
   if(source==='local')projectStore.save=async()=>{await saveGate;throw Error('local storage failed');};else cloudFailure='network';
   key(start(source,id),source+' failure');await wait(()=>card(source,id).getAttribute('aria-busy')==='true');assert.equal(card(source,id).querySelector('input').disabled,true);assert.equal(card(source,id).querySelector('.project-rename-status').textContent,'正在保存…');assert.ok([...card(source,id).querySelectorAll('button')].every(button=>button.disabled));
   release();await wait(()=>!card(source,id).querySelector('input'));assert.equal(card(source,id).querySelector('h3').textContent,source+' Other tab');assert.equal((await projectStore.get(id)).document.title,source+' Other tab');assert.equal(card(source,id).getAttribute('aria-busy'),null);assert.equal(card(source,id).querySelector('[data-action=rename]').disabled,false);assert.match($('notification').textContent,/failed|连接云端/);projectStore.save=save;cloudFailure=null;saveGate=null;
   key(start(source,id),source+' Final');await wait(()=>card(source,id)?.querySelector('h3').textContent===source+' Final');await app.home();assert.equal(card(source,id).querySelector('h3').textContent,source+' Final');assert.equal(app.store,cloud,'rename does not switch editor storage');
  }
  assert.ok(snapshots>=4);
 }finally{await app?.home().catch(()=>{});cloud?.close();local?.close();dom.window.close();globalThis.fetch=previousFetch;}
});

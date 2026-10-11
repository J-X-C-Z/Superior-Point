import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import 'fake-indexeddb/auto';
import {createDocument} from '../core/document-core.js';
import {CloudProjectStore} from '../storage/cloud-project-store.js';
const metadata=()=>Array.from({length:1000},(_,index)=>({id:crypto.randomUUID(),title:'Deck '+String(index).padStart(4,'0'),revision:7,canvas:{width:1280,height:720},slideCount:9,updatedAt:'2026-10-11T00:00:00.000Z',deletedAt:null}));
const authoritative=meta=>{const doc=createDocument({id:meta.id,title:meta.title,slides:[{id:'source-slide',elements:[{id:'text',type:'text',text:'Authoritative body',x:1,y:2,w:30,h:20,futureField:'keep-me'}]}],extensions:{future:{keep:'exact'}}});doc.revision=meta.revision;doc.assets=[{id:'original-asset',futurePayload:{keep:'asset-content'}}];return doc;};
test('1000 metadata records require one list request; summaries cannot stand in for authoritative get',async()=>{
 const rows=metadata(),doc=authoritative(rows[0]),calls=[],api={user:{id:'user'},request:async path=>{calls.push(path);if(path==='/projects')return rows;if(path==='/projects/'+doc.id+'/document')return doc;throw Error('Unexpected API request');}};
 const store=new CloudProjectStore({api}),records=await store.list();assert.equal(records.length,1000);assert.deepEqual(calls,['/projects']);assert.ok(records.every(record=>record.summaryOnly===true&&record.document.slides.length===0&&record.document.assets.length===0&&record.slideCount===9));assert.equal(records[0].document.revision,7);
 const opened=await store.get(doc.id);assert.deepEqual(calls,['/projects','/projects/'+doc.id+'/document']);assert.equal(opened.summaryOnly,undefined);assert.deepEqual(opened.document,doc);assert.equal(records[0].document.slides.length,0,'authoritative get does not convert a list summary into a saveable document');store.close();
});
// DOM integration exercises the real app against a fake HTTP backend; browser layout is separate acceptance.
test('real workspace pagination performs no document reads; cloud rename and open fetch full body and preserve unknown data',async()=>{
 const rows=metadata(),docs=new Map([[rows[0].id,authoritative(rows[0])]]),calls=[],user={id:crypto.randomUUID(),username:'Library user',role:'user'};
 const dom=new JSDOM(await readFile(new URL('../web/index.html',import.meta.url),'utf8'),{url:'http://localhost/app'}),old={fetch:globalThis.fetch,window:globalThis.window,document:globalThis.document,BroadcastChannel:globalThis.BroadcastChannel,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};let app,cloud;const timeouts=new Set();
 globalThis.setTimeout=(callback,delay,...args)=>{const timer=old.setTimeout(()=>{timeouts.delete(timer);callback(...args);},delay);timeouts.add(timer);return timer;};globalThis.clearTimeout=timer=>{timeouts.delete(timer);old.clearTimeout(timer);};
 const wait=async predicate=>{for(let i=0;i<600;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Library DOM wait timed out');};
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.BroadcastChannel=undefined;
 globalThis.fetch=async(url,options={})=>{const path=String(url).replace('/api/v1',''),method=options.method??'GET',body=options.body?JSON.parse(options.body):undefined;calls.push({path,method,body});let result;
  if(path==='/auth/me')result={user,csrfToken:'csrf'};else if(path==='/auth/csrf')result={csrfToken:'csrf'};else if(path==='/me/tokens')result=[];
  else if(path==='/me/storage')result={usage:{activeProjects:1000,totalBytes:10000},limits:{maxProjects:10000,maxBytes:1073741824,warningPercent:80},warning:false,overQuota:false};
  else if(path==='/projects'||path==='/projects?trash=true')result=path.endsWith('true')?[]:rows.map(meta=>({...meta,title:docs.get(meta.id)?.title??meta.title,revision:docs.get(meta.id)?.revision??meta.revision}));
  else{const id=path.split('/')[2],doc=docs.get(id);assert.ok(doc,'Unexpected project read '+path);
   if(path.endsWith('/document'))result=doc;
   else if(path.endsWith('/lease/renew'))result={leaseToken:body.leaseToken,expiresAt:new Date(Date.now()+60000).toISOString()};
   else if(path.endsWith('/lease'))result=method==='DELETE'?{released:true}:{leaseToken:crypto.randomUUID(),expiresAt:new Date(Date.now()+60000).toISOString()};
   else if(path.endsWith('/snapshot')){assert.equal(body.expectedRevision,doc.revision);result=structuredClone(body.document);docs.set(id,result);}
   else throw Error('Unexpected backend route '+path);
  }return {ok:true,status:200,json:async()=>structuredClone(result)};
 };
 const $=id=>document.getElementById(id),target=()=>document.querySelector('[data-source="cloud"][data-project-id="'+rows[0].id+'"]');
 try{
  await import('../web/app.js?library-performance='+crypto.randomUUID());await wait(()=>window.SPFramework?.ready);app=window.SPFramework;cloud=app.store;assert.equal(cloud.storage,'cloud');app.registerEditorAdapter({mount(){return {update(){},setReadOnly(){},destroy(){},flush(){}};}});
  assert.equal(document.querySelectorAll('.project').length,24);assert.equal($('count').textContent,'1000');assert.match($('project-pages').textContent,/1 \/ 42/);assert.equal(calls.filter(call=>call.path.includes('/document')).length,0);
  const listRequests=calls.filter(call=>call.path==='/projects').length;$('project-pages').querySelectorAll('button')[1].click();assert.equal(document.querySelectorAll('.project').length,24);assert.match($('project-pages').textContent,/2 \/ 42/);assert.equal(calls.filter(call=>call.path==='/projects').length,listRequests);assert.equal(calls.filter(call=>call.path.includes('/document')).length,0);assert.equal(calls.filter(call=>call.method!=='GET').length,0);
  $('project-pages').querySelectorAll('button')[0].click();const original=structuredClone(docs.get(rows[0].id));target().querySelector('[data-action=rename]').click();const input=target().querySelector('input');input.value='Renamed authoritative deck';input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await wait(()=>docs.get(rows[0].id).title==='Renamed authoritative deck'&&target()?.querySelector('h3').textContent==='Renamed authoritative deck');
  const saved=calls.find(call=>call.path.endsWith('/snapshot'));assert.ok(saved);assert.deepEqual(saved.body.document.slides,original.slides);assert.deepEqual(saved.body.document.assets,original.assets);assert.deepEqual(saved.body.document.extensions,original.extensions);assert.equal(saved.body.document.revision,8);const saveIndex=calls.indexOf(saved);assert.ok(calls.slice(0,saveIndex).some(call=>call.path==='/projects/'+rows[0].id+'/document'));
  const reads=calls.filter(call=>call.path.endsWith('/document')).length;target().querySelector('.cover').click();await wait(()=>app.getDocument()?.title==='Renamed authoritative deck');assert.ok(calls.filter(call=>call.path.endsWith('/document')).length>reads);assert.deepEqual(app.getDocument().slides,original.slides);assert.deepEqual(app.getDocument().assets,original.assets);await app.home();
 }finally{await app?.home().catch(()=>{});cloud?.close();app?.store.close();for(const timer of timeouts)old.clearTimeout(timer);dom.window.close();Object.assign(globalThis,old);}
});

// DOM simulation checks routing and interaction; real browser layout is separate acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import 'fake-indexeddb/auto';

const wait=async check=>{for(let i=0;i<500;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('DOM wait timed out');};
test('combined workspace routes colliding IDs, title doubleclick, upload login and cloud failures safely',async()=>{
 const dom=new JSDOM(await readFile(new URL('../web/index.html',import.meta.url),'utf8'),{url:'http://localhost/local'}),previousFetch=globalThis.fetch,previousPrompt=globalThis.prompt,previousCreateURL=URL.createObjectURL,previousRevokeURL=URL.revokeObjectURL;
 const exports=[];URL.createObjectURL=blob=>{exports.push(blob);return 'blob:test';};URL.revokeObjectURL=()=>{};dom.window.HTMLAnchorElement.prototype.click=function(){};
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.BroadcastChannel=undefined;
 const docs=new Map(),user={id:'workspace-user',username:'Workspace'},calls=[];let offline=false,listGate=null;
 globalThis.fetch=async(url,options={})=>{
  const path=String(url).replace('/api/v1',''),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;calls.push({path,method,body});
  if(offline&&path.startsWith('/projects'))throw Error('offline');
  let result;
  if(path==='/auth/login'||path==='/auth/me')result={user,csrfToken:'csrf'};
  else if(path==='/auth/logout')result={success:true};
  else if(path==='/me/tokens')result=[];
  else if(path==='/projects'||path==='/projects?trash=true'){if(listGate)await listGate;result=[...docs.values()].filter(doc=>!!doc.deletedAt===path.endsWith('true')).map(doc=>({id:doc.id,updatedAt:doc.metadata.updatedAt,deletedAt:doc.deletedAt}));}
  else if(path==='/projects/import'){result=structuredClone(body.document);result.id=crypto.randomUUID();result.revision=0;docs.set(result.id,result);}
  else {const id=path.split('/')[2],doc=docs.get(id);assert.ok(doc,'known cloud project '+path);
   if(path.includes('/document'))result=doc;
   else if(path.endsWith('/snapshot')){result=body.document;docs.set(id,result);}
   else if(path.endsWith('/lease'))result=method==='DELETE'?{released:true}:{leaseToken:crypto.randomUUID(),expiresAt:new Date(Date.now()+60000).toISOString()};
   else if(path.endsWith('/lease/renew'))result={leaseToken:body.leaseToken,expiresAt:new Date(Date.now()+60000).toISOString()};
   else if(method==='DELETE'){doc.deletedAt=new Date().toISOString();result=doc;}
   else throw Error('unhandled '+path);
  }
  return {ok:true,status:200,json:async()=>structuredClone(result)};
 };
 let app,local,cloud;
 const $=id=>document.getElementById(id),card=(source,id)=>document.querySelector(`[data-source="${source}"][data-project-id="${id}"]`);
 try{
  await import('../web/app.js?workspace-ui='+crypto.randomUUID());await wait(()=>window.SPFramework?.ready);app=window.SPFramework;local=app.store;
  app.registerEditorAdapter({mount(){return {update(){},setReadOnly(){},destroy(){},flush(){}};}});
  const original=await app.newProject('Local collision');await app.home();
  card('local',original.id).querySelector('[data-action=upload]').click();assert.equal($('cloud-controls').hidden,false,'signed-out card upload opens existing account dialog');assert.equal(document.activeElement,$('cloud-login').elements.username);
  $('account-close').click();const cloudDoc=structuredClone(original);cloudDoc.title='Cloud collision';docs.set(original.id,cloudDoc);
  $('account-trigger').click();const form=$('cloud-login');form.elements.username.value='Workspace';form.elements.password.value='not-real';form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  await wait(()=>app.store.storage==='cloud'&&document.querySelectorAll('.project').length===2&&$('cloud-controls').hidden);cloud=app.store;
  card('local',original.id).querySelector('h3').dispatchEvent(new dom.window.MouseEvent('dblclick',{bubbles:true}));const localName=card('local',original.id).querySelector('input');localName.value='Local renamed';localName.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  await wait(()=>card('local',original.id)?.querySelector('h3').textContent==='Local renamed');assert.equal((await local.get(original.id)).document.title,'Local renamed');assert.equal(docs.get(original.id).title,'Cloud collision');assert.equal(app.store,cloud,'card rename does not change editor destination');
  card('cloud',original.id).querySelector('[data-action=rename]').click();const cloudName=card('cloud',original.id).querySelector('input');cloudName.value='Cloud renamed';cloudName.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await wait(()=>card('cloud',original.id)?.querySelector('h3').textContent==='Cloud renamed');assert.equal((await local.get(original.id)).document.title,'Local renamed');
  card('local',original.id).querySelector('[data-action=export]').click();await wait(()=>exports.length===1);assert.match(await exports[0].text(),/Local renamed/);assert.doesNotMatch(await exports[0].text(),/Cloud renamed/);
  card('cloud',original.id).querySelector('[data-action=export]').click();await wait(()=>exports.length===2);assert.match(await exports[1].text(),/Cloud renamed/);assert.doesNotMatch(await exports[1].text(),/Local renamed/);
  card('local',original.id).querySelector('.cover').click();await wait(()=>app.getDocument()?.title==='Local renamed');assert.equal(app.store,local);assert.equal($('account-menu').hidden,true);assert.equal($('cloud-controls').hidden,true);await app.home();
  card('cloud',original.id).querySelector('.cover').click();await wait(()=>app.getDocument()?.title==='Cloud renamed');assert.equal(app.store,cloud);await app.home();
  card('local',original.id).querySelector('[data-action=upload]').click();await wait(()=>docs.size===2&&document.querySelectorAll('.project').length===3);assert.equal((await local.get(original.id)).document.title,'Local renamed');assert.match($('notification').textContent,/核对.*本地原项目保留/);
  card('cloud',original.id).querySelector('[data-action=delete]').click();await wait(()=>document.querySelectorAll('.project').length===2);assert.equal((await local.get(original.id)).deletedAt,null);
  await app.home('trash');assert.equal(document.querySelectorAll('.project').length,1);assert.equal(document.querySelector('.project').dataset.source,'cloud');
  let release;listGate=new Promise(resolve=>{release=resolve;});const loading=app.home('home');await wait(()=>card('local',original.id)&&$('library-status').textContent.includes('正在读取云端'));assert.equal($('library-status').hidden,false);release();await loading;listGate=null;
  offline=true;card('cloud',[...docs.keys()].find(id=>id!==original.id)).querySelector('.cover').click();await wait(()=>$('notification').textContent.includes('无法连接云端'));assert.equal(app.getDocument(),undefined);assert.equal($('home-view').hidden,false);assert.equal($('account-menu').hidden,false);await app.home();assert.equal(document.querySelectorAll('.project').length,1);assert.ok(card('local',original.id));assert.match($('library-status').textContent,/本地项目仍可打开/);offline=false;
  $('account-trigger').click();$('cloud-logout').click();await wait(()=>!$('cloud-logout').disabled&&$('cloud-login').hidden===false);assert.equal(document.querySelectorAll('.project').length,1);assert.ok(card('local',original.id));assert.equal($('library-status').hidden,true);
  assert.ok(calls.some(call=>call.path.endsWith('/snapshot')));
 }finally{await app?.home().catch(()=>{});cloud?.close();local?.close();dom.window.close();globalThis.fetch=previousFetch;globalThis.prompt=previousPrompt;URL.createObjectURL=previousCreateURL;URL.revokeObjectURL=previousRevokeURL;}
});

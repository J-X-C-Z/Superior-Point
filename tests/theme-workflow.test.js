import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import 'fake-indexeddb/auto';
import {getBuiltinTheme} from '../core/builtin-themes.js';
import {importHTML} from '../io/html.js';
import {CloudAPI} from '../storage/cloud-project-store.js';

const wait=async check=>{for(let i=0;i<1000;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('workspace workflow timed out');};
const button=(root,label)=>[...root.querySelectorAll('button')].find(item=>item.textContent.trim()===label);
const submit=form=>form.dispatchEvent(new form.ownerDocument.defaultView.Event('submit',{bubbles:true,cancelable:true}));
const viewVisible=id=>!document.getElementById(id).hidden;

test('theme workflow creates, reopens, confirms once, undoes, redoes and round-trips a local project',async()=>{
 const dom=new JSDOM(await readFile(new URL('../web/index.html',import.meta.url),'utf8'),{url:'http://localhost/local'}),previous={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch,BroadcastChannel:globalThis.BroadcastChannel,createObjectURL:URL.createObjectURL,revokeObjectURL:URL.revokeObjectURL};
 const requests=[],exports=[];let app,themeStore;
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.BroadcastChannel=undefined;
 globalThis.fetch=async(url)=>{requests.push(String(url));return {ok:false,status:401,json:async()=>({error:{code:'UNAUTHENTICATED',message:'Login required'}})};};
 URL.createObjectURL=blob=>{exports.push(blob);return 'blob:theme-workflow';};URL.revokeObjectURL=()=>{};dom.window.HTMLAnchorElement.prototype.click=function(){};
 const findButton=(root,label)=>button(root,label);
 try{
  await import('../web/app.js?theme-workflow='+crypto.randomUUID());await wait(()=>window.SPFramework?.ready);app=window.SPFramework;
  app.registerEditorAdapter({mount(){return {update(){},setReadOnly(){},destroy(){},flush(){}};}});
  assert.deepEqual(requests,[],'local startup does not probe the cloud endpoint');
  const cloudAPI=new CloudAPI();await assert.rejects(cloudAPI.restoreSession(),{code:'UNAUTHENTICATED'});assert.equal(requests.length,1,'an unauthenticated cloud check ends after one request');

  document.querySelector('[data-view="themes"]').click();await wait(()=>viewVisible('theme-view')&&!viewVisible('home-view')&&app.getDocument()===undefined);await wait(()=>document.querySelectorAll('#theme-view .theme-card').length===6);
  const firstTheme=getBuiltinTheme('sp-margin');
  const firstCard=[...document.querySelectorAll('#theme-view .theme-card')].find(card=>card.textContent.includes(firstTheme.name));assert.ok(firstCard);
  findButton(firstCard,'详情与四页预览').click();await wait(()=>document.querySelector('.theme-dialog'));
  const details=document.querySelector('.theme-dialog');details.querySelector('select').value='4:3';findButton(details,'使用主题新建').click();
  await wait(()=>document.body.classList.contains('editor-open')&&app.getDocument()?.extensions?.theme?.ref?.id===firstTheme.id);
  const created=app.getDocument();assert.deepEqual(created.canvas,{width:960,height:720});assert.equal(created.title,firstTheme.name+' · 演示文稿');assert.deepEqual(created.extensions.theme.ref.snapshot,firstTheme);await app.flush();
  await app.home('home');await wait(()=>viewVisible('home-view')&&!viewVisible('theme-view')&&app.getDocument()===undefined);await wait(()=>document.querySelector(`[data-project-id="${created.id}"]`));
  document.querySelector(`[data-project-id="${created.id}"] .cover`).click();await wait(()=>viewVisible('workspace-view')&&app.getDocument()?.id===created.id);

  const opened=app.getDocument(),slide=opened.slides[0],title=slide.elements.find(element=>element.themeRole==='title');assert.ok(title);
  const privateNote='Private speaker notes stay here',motion=[{id:'motion-1',targetId:title.id,type:'appear',trigger:'click',duration:0.3,delay:0,easing:'ease',order:0}],extensions={...opened.extensions,futureMetadata:{originInfo:'workflow-test',preserve:true}};
  app.edit([
   {type:'updateElement',slideId:slide.id,elementId:title.id,properties:{color:'#912345'}},
   {type:'updateSlide',slideId:slide.id,properties:{notes:privateNote}},
   {type:'updateProject',properties:{extensions}}
  ]);
  await app.flush();await app.home('home');await wait(()=>viewVisible('home-view')&&!viewVisible('theme-view')&&app.getDocument()===undefined);
  const localStore=app.store,record=await localStore.get(created.id),withMotion=structuredClone(record.document);withMotion.slides[0].animations=motion;withMotion.revision++;withMotion.metadata.updatedAt=new Date().toISOString();
  const lease=await localStore.acquire(created.id,'theme-workflow-fixture');assert.ok(lease);await localStore.save(withMotion,{expectedRevision:record.document.revision,lock:lease});await localStore.release(lease);
  document.querySelector(`[data-project-id="${created.id}"] .cover`).click();await wait(()=>viewVisible('workspace-view')&&app.getDocument()?.id===created.id&&app.getDocument().slides[0].animations.length===1);
  const before=app.getDocument(),savedBefore=await app.store.get(created.id);
  assert.equal(savedBefore.document.slides[0].elements.find(element=>element.id===title.id).color,'#912345');

  document.querySelector('[data-view="themes"]').click();await wait(()=>viewVisible('theme-view')&&!viewVisible('home-view')&&app.getDocument()===undefined);await wait(()=>document.querySelectorAll('#theme-view .theme-card').length===6);
  const nextTheme=getBuiltinTheme('sp-signal'),nextCard=[...document.querySelectorAll('#theme-view .theme-card')].find(card=>card.textContent.includes(nextTheme.name));assert.ok(nextCard);
  findButton(nextCard,'详情与四页预览').click();await wait(()=>document.querySelector('.theme-dialog'));
  findButton(document.querySelector('.theme-dialog'),'应用到已有项目').click();await wait(()=>document.querySelector('.theme-dialog h2')?.textContent==='应用主题前预览'&&findButton(document.querySelector('.theme-dialog'),'确认应用'));
  const applyPreview=document.querySelector('.theme-dialog');
  const applyButton=findButton(applyPreview,'确认应用');applyButton.click();
  await wait(()=>[...document.querySelectorAll('dialog button')].some(control=>control.textContent==='应用并保存'));
  const confirmation=[...document.querySelectorAll('dialog')].find(dialog=>dialog.querySelector('h2')?.textContent==='确认主题变更');
  assert.equal(app.getDocument(),undefined,'confirmation leaves the editor unopened until approval');
  assert.deepEqual((await app.store.get(created.id)).document,before,'confirmation opens before writing IndexedDB');
  findButton(confirmation,'取消').click();await wait(()=>!confirmation.isConnected&&applyButton.isConnected&&!applyButton.disabled);
  assert.equal(app.getDocument(),undefined);assert.deepEqual((await app.store.get(created.id)).document,before);
  const {ThemeStore}=await import('../storage/theme-store.js');themeStore=new ThemeStore();const usedKey=JSON.stringify(['builtin',null,nextTheme.id,nextTheme.version]);
  assert.equal((await themeStore.preferences()).some(preference=>preference.key===usedKey&&preference.lastUsedAt),false,'cancelled application does not mark the theme as used');
  await wait(()=>applyButton.isConnected&&!applyButton.disabled);applyButton.click();await wait(()=>[...document.querySelectorAll('dialog button')].some(control=>control.textContent==='应用并保存'));
  const confirmationAgain=[...document.querySelectorAll('dialog')].find(dialog=>dialog.querySelector('h2')?.textContent==='确认主题变更');
  assert.deepEqual((await app.store.get(created.id)).document,before);
  submit(confirmationAgain.querySelector('form'));
  await wait(()=>viewVisible('workspace-view')&&app.getDocument()?.extensions?.theme?.ref?.id===nextTheme.id&&app.getDocument().revision===before.revision+1);
  const applied=app.getDocument(),savedApplied=(await app.store.get(created.id)).document;
  assert.equal(savedApplied.revision,before.revision+1,'theme application is one atomic history entry');
  assert.deepEqual(applied.extensions.theme.ref.snapshot,nextTheme);
  assert.equal(applied.slides[0].elements.find(element=>element.id===title.id).color,'#912345');
  assert.equal(applied.slides[0].notes,privateNote);assert.deepEqual(applied.slides[0].animations,motion);assert.deepEqual(applied.extensions.futureMetadata,extensions.futureMetadata);

  const undone=app.undo();assert.equal(undone.extensions.theme.ref.id,firstTheme.id);assert.equal(undone.slides[0].elements.find(element=>element.id===title.id).color,'#912345');
  assert.equal(undone.slides[0].notes,privateNote);assert.deepEqual(undone.slides[0].animations,motion);assert.deepEqual(undone.extensions.futureMetadata,extensions.futureMetadata);await app.flush();
  const redone=app.redo();assert.equal(redone.extensions.theme.ref.id,nextTheme.id);assert.equal(redone.slides[0].elements.find(element=>element.id===title.id).color,'#912345');
  assert.equal(redone.slides[0].notes,privateNote);assert.deepEqual(redone.slides[0].animations,motion);assert.deepEqual(redone.extensions.futureMetadata,extensions.futureMetadata);await app.flush();

  await app.exportProject();await wait(()=>exports.length===1);const html=await exports[0].text(),ioImported=importHTML(html);
  assert.deepEqual(ioImported.extensions.theme,redone.extensions.theme);assert.deepEqual(ioImported.extensions.futureMetadata,extensions.futureMetadata);
  await app.home('home');await wait(()=>viewVisible('home-view')&&!viewVisible('theme-view')&&app.getDocument()===undefined);await app.importFile({name:'theme-workflow.html',size:new TextEncoder().encode(html).byteLength,text:async()=>html});
  await wait(()=>viewVisible('workspace-view')&&app.getDocument()?.metadata?.spImport?.source?.fileName==='theme-workflow.html');
  assert.deepEqual(app.getDocument().extensions.theme,redone.extensions.theme);assert.deepEqual(app.getDocument().extensions.futureMetadata,extensions.futureMetadata);
  assert.equal((await themeStore.preferences()).some(preference=>preference.key===usedKey&&preference.lastUsedAt),true,'confirmed application records theme use');
  assert.equal(app.getState().saveError,undefined);
 }finally{
  await app?.home('home').catch(()=>{});await new Promise(resolve=>setTimeout(resolve,6600));themeStore?.close();app?.store?.close();dom.window.close();globalThis.window=previous.window;globalThis.document=previous.document;globalThis.fetch=previous.fetch;globalThis.BroadcastChannel=previous.BroadcastChannel;URL.createObjectURL=previous.createObjectURL;URL.revokeObjectURL=previous.revokeObjectURL;
 }
});

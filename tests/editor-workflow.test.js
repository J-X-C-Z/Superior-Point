// Real editor source + real parent adapter/Core/storage; two JSDOM windows simulate postMessage.
// This is NOT a real-browser/sandbox/layout acceptance test.
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {JSDOM,VirtualConsole} from 'jsdom';import 'fake-indexeddb/auto';
import {fiveSlideDocument} from '../examples/five-slides.js';
import {createLegacyEditorAdapter} from '../web/legacy-editor-adapter.js';import {registerEditorAdapter} from '../web/editor-adapter.js';import {importHTML} from '../io/html.js';
const wait=async fn=>{for(let i=0;i<250;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Integrated candidate timeout');};
test('integrated candidate simulation: native add/text edit -> Core -> save -> Home -> reopen -> native offline export/reimport',async()=>{
 const parent=new JSDOM(await readFile(new URL('../web/index.html',import.meta.url),'utf8'),{url:'https://sp-parent.invalid/'}),w=parent.window,children=[],errors=[];
 globalThis.window=w;globalThis.document=w.document;globalThis.BroadcastChannel=undefined;
 const observer=new w.MutationObserver(()=>{
  for(const frame of w.document.querySelectorAll('iframe.sp-legacy-editor-frame')){
   if(frame.__child)continue;frame.__child=true;
   const proxy={postMessage(message){queueMicrotask(()=>w.dispatchEvent(new w.MessageEvent('message',{source:frame.contentWindow,origin:'null',data:message})));}};
   let child;const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/Canvas|navigation/i.test(e.message))errors.push(e.message);});
   child=new JSDOM(frame.srcdoc,{url:'https://opaque-simulation.invalid/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(c){
    Object.defineProperty(c,'parent',{value:proxy});c.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});c.CSS??={};c.CSS.escape=s=>String(s);c.ResizeObserver=class{observe(){}disconnect(){}};c.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};c.HTMLElement.prototype.scrollIntoView=function(){};c.HTMLElement.prototype.scrollBy=function(){};c.HTMLElement.prototype.getAnimations=()=>[];c.HTMLCanvasElement.prototype.getContext=()=>({measureText:s=>({width:String(s).length*8}),setTransform(){},clearRect(){},fillRect(){},save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},arc(){},translate(){},scale(){},rect(){},clip(){},drawImage(){},setLineDash(){},quadraticCurveTo(){},closePath(){}});
   }});
   frame.contentWindow.postMessage=message=>queueMicrotask(()=>child.window.dispatchEvent(new child.window.MessageEvent('message',{source:proxy,data:message})));
   frame.__window=child.window;children.push(child);
  }
 });observer.observe(w.document,{childList:true,subtree:true});registerEditorAdapter(createLegacyEditorAdapter());
 let app;const blobs=[],oldURL=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:simulated-download';};URL.revokeObjectURL=()=>{};
 try{
  await import('../web/app.js?candidate-workflow');await wait(()=>w.SPFramework?.ready);app=w.SPFramework;
  const created=await app.newProject('可编辑候选');let child=w.document.querySelector('iframe').__window;
  assert.ok(w.document.body.classList.contains('editor-integrated'));
  assert.ok(!w.document.body.classList.contains('editor-attention'));
  await wait(()=>child.document.querySelector('#save-status').textContent.includes('已保存到本地'));
  child.document.querySelector('[data-action="sp-workspace-json"]').click();
  await wait(()=>blobs.length===1);
  assert.deepEqual(JSON.parse(await blobs[0].text()),app.getDocument());
  child.document.querySelector('[data-action="add-text"]').click();await wait(()=>app.getDocument().slides[0].elements.length===1);await wait(()=>!child.SPEditorCandidate.getState().pending);
  const object=child.document.querySelector('#stage-mount .slide-object');object.dispatchEvent(new child.MouseEvent('dblclick',{bubbles:true}));
  const text=child.document.querySelector('#stage-mount .editing');assert.ok(text,'native text editing should open');text.textContent='通过原编辑器输入并保存';
  await app.home();const saved=await app.store.get(created.id);assert.equal(saved.document.slides[0].elements[0].text,'通过原编辑器输入并保存');
  await app.openProject(created.id);child=w.document.querySelector('iframe').__window;assert.equal(child.SPEditorCandidate.getSnapshot().slides[0].objects[0].text,'通过原编辑器输入并保存');
  await app.exportProject();const output=await blobs.at(-1).text();assert.match(output,/通过原编辑器输入并保存/);assert.deepEqual(importHTML(output),app.getDocument());assert.doesNotMatch(output,/<script[^>]+src=/);
  const five=JSON.stringify(fiveSlideDocument());await app.importFile({name:'five.json',size:five.length,text:async()=>five});child=w.document.querySelector('iframe').__window;
  assert.equal(child.SPEditorCandidate.getSnapshot().slides.length,5);const original=child.SPEditorCandidate.getSnapshot();
  child.document.querySelector('.thumb-row[data-slide-id="slide-3"]').click();
  child.document.querySelector('#stage-mount .slide-object[data-id="step-2"]').dispatchEvent(new child.MouseEvent('dblclick',{bubbles:true}));
  const thirdText=child.document.querySelector('#stage-mount .editing');assert.ok(thirdText);thirdText.textContent='第三页原生编辑已提交';
  const fiveId=app.getDocument().id;await app.home();await app.openProject(fiveId);child=w.document.querySelector('iframe').__window;
  const reopened=child.SPEditorCandidate.getSnapshot();assert.equal(reopened.slides[2].objects.find(o=>o.id==='step-2').text,'第三页原生编辑已提交');
  for(const index of [0,1,3,4])assert.deepEqual(JSON.parse(JSON.stringify(reopened.slides[index])),JSON.parse(JSON.stringify(original.slides[index])));
  await app.exportProject();assert.deepEqual(importHTML(await blobs.at(-1).text()),app.getDocument());assert.deepEqual(errors,[]);
 }finally{if(app){await app.home().catch(()=>{});app.store.close();}observer.disconnect();for(const child of children)child.window.close();parent.window.close();URL.createObjectURL=oldURL;URL.revokeObjectURL=oldRevoke;registerEditorAdapter({mount(){return{destroy(){}};}});}
});

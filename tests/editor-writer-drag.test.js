import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocument} from '../core/document-core.js';
import {canonicalToEditor} from '../adapters/editor-v038-model.js';
import {editorCandidateHTML as integratedHTML} from '../vendor/editor-integrated.js';
import {editorCandidateHTML as candidateHTML} from '../vendor/editor-v038-candidate.js';
import {candidateHarness} from './helpers/editor-candidate.js';

const project=()=>canonicalToEditor(createDocument({id:'writer-drag',slides:[{id:'s1',elements:[{id:'r1',type:'shape',x:100,y:100,w:100,h:80,shape:'rect'}],animations:[]}]}));
const pointer=(w,target,type,x,y)=>target.dispatchEvent(new w.MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:y,ctrlKey:type!=='pointerdown'}));
async function startDrag(h){
 const w=h.window;
 Object.defineProperty(w.document.querySelector('#canvas-zone'),'clientWidth',{value:1400});
 Object.defineProperty(w.document.querySelector('#canvas-zone'),'clientHeight',{value:850});
 const zoom=w.document.querySelector('#zoom-range');zoom.value='100';zoom.dispatchEvent(new w.Event('input',{bubbles:true}));await h.pause(50);
 pointer(w,w.document.querySelector('#stage-mount [data-id="r1"]'),'pointerdown',100,100);
}
for(const [version,html] of [['v038',candidateHTML],['v039',integratedHTML]]){
 for(const loss of ['readOnly','reject','update'])test(`${version}: ${loss} ends a moved gesture and preserves the recovery draft`,async()=>{
  const p=project();p.customExtension={retained:true};const h=await candidateHarness(p,{html});
  try{
   const w=h.window;await startDrag(h);pointer(w,w.document,'pointermove',110,110);
   const draft=JSON.stringify(w.SPEditorCandidate.getSnapshot());assert.notEqual(w.SPEditorCandidate.getSnapshot().slides[0].objects[0].x,100);
   h.send(loss,loss==='readOnly'?{value:true}:{project:p,revision:3,epoch:2,readOnly:true,error:'Writer lost'});
   const recovery=h.messages.findLast(m=>m.type==='recovery');assert.ok(recovery);assert.equal(JSON.stringify(recovery.project),draft);
   const objectStyle=w.document.querySelector('#stage-mount [data-id="r1"]').style.cssText;
   pointer(w,w.document,'pointermove',130,130);pointer(w,w.document,'pointerup',130,130);
   assert.equal(w.SPEditorCandidate.getState().readOnly,true);
   assert.equal(JSON.stringify(w.SPEditorCandidate.getSnapshot()),draft);
   assert.equal(w.document.querySelector('#stage-mount [data-id="r1"]').style.cssText,objectStyle);
   assert.equal(JSON.stringify(recovery.project),draft);
   assert.equal(h.messages.filter(m=>m.type==='edit').length,0);
   await assert.rejects(w.SPEditorCandidate.flush());assert.equal(h.errors.length,0);
  }finally{h.close();}
 });
 test(`${version}: clean writer loss cancels the old gesture before access is restored`,async()=>{
  const h=await candidateHarness(project(),{html});try{
   const w=h.window;await startDrag(h);const before=JSON.stringify(w.SPEditorCandidate.getSnapshot());
   h.send('readOnly',{value:true});pointer(w,w.document,'pointermove',120,120);
   assert.equal(JSON.stringify(w.SPEditorCandidate.getSnapshot()),before);
   h.send('readOnly',{value:false});pointer(w,w.document,'pointermove',130,130);pointer(w,w.document,'pointerup',130,130);
   assert.equal(JSON.stringify(w.SPEditorCandidate.getSnapshot()),before);
   assert.equal(h.messages.some(m=>m.type==='recovery'||m.type==='edit'),false);assert.equal(h.errors.length,0);
  }finally{h.close();}
 });
 test(`${version}: writer loss freezes an in-progress animation timeline drag`,async()=>{
  const p=project();p.slides[0].objects[0].motionEffects=[{id:'fx1',kind:'entrance',effect:'fade',trigger:'click',step:0,delay:0,duration:400,easing:'ease-out'}];
  const h=await candidateHarness(p,{html});try{
   const w=h.window,zone=w.document.querySelector('[data-v15-drag-zone]'),bar=zone.querySelector('.v15-track-bar');
   zone.getBoundingClientRect=()=>({left:0,width:400});
   pointer(w,bar,'pointerdown',100,0);pointer(w,w.document,'pointermove',120,0);
   const draft=JSON.stringify(w.SPEditorCandidate.getSnapshot());assert.equal(w.SPEditorCandidate.getSnapshot().slides[0].objects[0].motionEffects[0].delay,100);
   h.send('readOnly',{value:true});const recovery=h.messages.findLast(m=>m.type==='recovery');assert.equal(JSON.stringify(recovery.project),draft);
   const style=bar.style.cssText;pointer(w,w.document,'pointermove',150,0);pointer(w,w.document,'pointerup',150,0);
   assert.equal(JSON.stringify(w.SPEditorCandidate.getSnapshot()),draft);assert.equal(bar.style.cssText,style);assert.equal(h.errors.length,0);
  }finally{h.close();}
 });
 test(`${version}: a clean timeline gesture does not resume after writer access returns`,async()=>{
  const p=project();p.slides[0].objects[0].motionEffects=[{id:'fx1',kind:'entrance',effect:'fade',trigger:'click',step:0,delay:0,duration:400,easing:'ease-out'}];
  const h=await candidateHarness(p,{html});try{
   const w=h.window,zone=w.document.querySelector('[data-v15-drag-zone]');zone.getBoundingClientRect=()=>({left:0,width:400});
   pointer(w,zone.querySelector('.v15-track-bar'),'pointerdown',100,0);const before=JSON.stringify(w.SPEditorCandidate.getSnapshot());
   h.send('readOnly',{value:true});h.send('readOnly',{value:false});
   pointer(w,w.document,'pointermove',150,0);pointer(w,w.document,'pointerup',150,0);
   assert.equal(JSON.stringify(w.SPEditorCandidate.getSnapshot()),before);assert.equal(h.messages.some(m=>m.type==='edit'),false);assert.equal(h.errors.length,0);
  }finally{h.close();}
 });
}

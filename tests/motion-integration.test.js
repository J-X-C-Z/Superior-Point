import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createDocument} from '../core/document-core.js';
import {canonicalToEditor,editorToCanonical} from '../adapters/editor-v038-model.js';
import {exportEditorHTML} from '../io/editor-export.js';
import {importHTML} from '../io/html.js';
import {candidateHarness} from './helpers/editor-candidate.js';

for(const [first,second,ids] of [['wipe-up','push-right',['wipe-top','blink','wipe-bottom']],['cover-left','uncover-up',['appear','teeter','swivel']],['circle','diamond',['split-h','teeter','stretch-v']]])test('motion survives editor initialization, mapping and exports: '+first,async()=>{
 const effects=ids.map((effect,step)=>({id:'fx-'+step,kind:['entrance','emphasis','exit'][step],effect,step,trigger:'click',delay:200,duration:400,easing:'ease-out'}));
 const input=createDocument({id:'motion-integration',title:'Motion integration',slides:[{id:'a',transition:first,transitionExit:first==='circle'?'fade':'',elements:[{id:'text',type:'text',x:80,y:80,w:600,h:120,text:'Directional motion',motionEffects:effects}],animations:[]},{id:'b',transition:second,elements:[],animations:[]}]});
 const h=await candidateHarness(canonicalToEditor(input));
 try{
  const snapshot=JSON.parse(JSON.stringify(h.window.SPEditorCandidate.getSnapshot()));
  assert.equal(snapshot.slides[0].transition,first);assert.equal(snapshot.slides[1].transition,second);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.slides[0].objects[0].motionEffects)),effects);
  const canonical=editorToCanonical(snapshot,{baseDocument:input});
  const reopened=canonicalToEditor(canonical);assert.deepEqual(reopened.slides[0].objects[0].motionEffects,effects);
  const native=h.window.SPEditorCandidate.renderLegacyHTML();
  for(const audience of [false,true]){
   const html=await exportEditorHTML(canonical,native,{domDocument:h.window.document,audience});
   const dom=new JSDOM(html);
   assert.ok(dom.window.document.querySelector('section').dataset.transition.startsWith(first));
   assert.equal(dom.window.document.querySelector('section').dataset.spTransitionExit,String(first==='circle'));
   assert.equal(dom.window.document.querySelectorAll('[data-v15-fx]').length,3);
   for(const id of ids)assert.ok(html.includes(id));
   if(!audience)assert.deepEqual(importHTML(html),canonical);
   else assert.equal(dom.window.document.querySelector('script[type="application/json"]'),null);
   dom.window.close();
  }
 }finally{h.close();}
});

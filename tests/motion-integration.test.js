import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createDocument} from '../core/document-core.js';
import {canonicalToEditor,editorToCanonical} from '../adapters/editor-v038-model.js';
import {exportEditorHTML} from '../io/editor-export.js';
import {importHTML} from '../io/html.js';
import {candidateHarness} from './helpers/editor-candidate.js';

test('expanded motion survives editor initialization, native mapping and both HTML exports',async()=>{
 const effects=[['entrance','wipe-top'],['emphasis','blink'],['exit','wipe-bottom']].map(([kind,effect],step)=>({id:'fx-'+step,kind,effect,step,trigger:'click',delay:0,duration:400,easing:'ease-out'}));
 const input=createDocument({id:'motion-integration',title:'Motion integration',slides:[{id:'a',transition:'wipe-up',elements:[{id:'text',type:'text',x:80,y:80,w:600,h:120,text:'Directional motion',motionEffects:effects}],animations:[]},{id:'b',transition:'push-right',elements:[],animations:[]}]});
 const h=await candidateHarness(canonicalToEditor(input));
 try{
  const snapshot=JSON.parse(JSON.stringify(h.window.SPEditorCandidate.getSnapshot()));
  assert.equal(snapshot.slides[0].transition,'wipe-up');assert.equal(snapshot.slides[1].transition,'push-right');
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.slides[0].objects[0].motionEffects)),effects);
  const canonical=editorToCanonical(snapshot,{baseDocument:input});
  const reopened=canonicalToEditor(canonical);assert.deepEqual(reopened.slides[0].objects[0].motionEffects,effects);
  const native=h.window.SPEditorCandidate.renderLegacyHTML();
  for(const audience of [false,true]){
   const html=await exportEditorHTML(canonical,native,{domDocument:h.window.document,audience});
   const dom=new JSDOM(html);
   assert.match(dom.window.document.querySelector('section').dataset.transition,/wipe-up/);
   assert.equal(dom.window.document.querySelectorAll('[data-v15-fx]').length,3);
   assert.match(html,/wipe-top/);assert.match(html,/wipe-bottom/);assert.match(html,/blink/);
   assert.match(html,/data-transition[^\n]*wipe-up/);
   if(!audience)assert.deepEqual(importHTML(html),canonical);
   else assert.equal(dom.window.document.querySelector('script[type="application/json"]'),null);
   dom.window.close();
  }
 }finally{h.close();}
});

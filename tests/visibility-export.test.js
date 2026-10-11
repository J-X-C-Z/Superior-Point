import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createDocument} from '../core/document-core.js';
import {renderSlideSVG,exportHTML,importHTML,inspectRenderCompatibility} from '../io/html.js';
import {exportEditorHTML} from '../io/editor-export.js';

const fixture=()=>createDocument({id:'visibility-export',title:'Visibility boundary',slides:[{id:'s1',elements:[
 {id:'public',type:'text',text:'PUBLIC_PAGE_TEXT',x:40,y:40,w:600,h:80},
 {id:'native-hidden',type:'text',text:'PRIVATE_NATIVE_HIDDEN',visible:false,x:40,y:160,w:600,h:80},
 {id:'core-hidden',type:'text',text:'PRIVATE_CORE_HIDDEN',hidden:true,x:40,y:260,w:600,h:80},
 {id:'private-group',type:'group',visible:false,children:['group-child'],x:40,y:360,w:600,h:80},
 {id:'group-child',type:'text',text:'PRIVATE_GROUP_CHILD',x:40,y:360,w:600,h:80}
],animations:[{id:'hidden-fx',targetId:'native-hidden',type:'spin',trigger:'click',duration:1,delay:0,easing:'linear',order:0}]}]});

test('generic SVG and audience HTML exclude both hidden flags and hidden group descendants',async()=>{
 const doc=fixture(),before=structuredClone(doc);
 const svg=renderSlideSVG(doc,'s1');assert.match(svg,/PUBLIC_PAGE_TEXT/);assert.doesNotMatch(svg,/PRIVATE_|data-element-id="(?:native-hidden|core-hidden|group-child)"/);
 const audience=await exportHTML(doc,{audience:true});assert.match(audience,/PUBLIC_PAGE_TEXT/);assert.doesNotMatch(audience,/PRIVATE_|application\/json/);
 assert.deepEqual(importHTML(await exportHTML(doc)),before);assert.deepEqual(doc,before);
 const compatibility=inspectRenderCompatibility(doc);assert.equal(compatibility.hasKnownGaps,false,'unpainted private objects and their animations are not visual fidelity gaps');
});

test('native audience boundary removes hidden objects and their playback markers from supplied markup',async()=>{
 const doc=fixture(),before=structuredClone(doc),dom=new JSDOM('');
 const elements=doc.slides[0].elements.map(el=>`<div data-v15-object-id="${el.id}">${el.text||''}</div>`).join('');
 const markup=`<div class="reveal"><div class="slides"><section data-slide-id="s1">${elements}<span class="fragment v15-motion-marker" data-v15-object-id="native-hidden">PRIVATE_MARKER</span><g data-element-id="core-hidden">PRIVATE_GENERIC_NODE</g><div data-id="group-child">PRIVATE_NATIVE_NODE</div></section></div></div>`;
 try{
  const shared=await exportEditorHTML(doc,markup,{audience:true,domDocument:dom.window.document});
  assert.match(shared,/PUBLIC_PAGE_TEXT/);assert.doesNotMatch(shared,/PRIVATE_|data-(?:v15-object-id|element-id|id)="(?:native-hidden|core-hidden|group-child|private-group)"/);
  const backup=await exportEditorHTML(doc,markup,{domDocument:dom.window.document});assert.deepEqual(importHTML(backup),before);assert.deepEqual(doc,before);
 }finally{dom.window.close();}
});

test('visibility does not relax resource validation for hidden objects',async()=>{
 const doc=fixture();doc.slides[0].elements.push({id:'unsafe',type:'image',visible:false,src:'https://invalid.example/private.png',x:0,y:0,w:10,h:10});
 await assert.rejects(exportHTML(doc,{audience:true}),/external resource/);
});

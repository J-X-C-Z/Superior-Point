// Native v039 handlers in JSDOM; real mouse/keyboard browser acceptance is separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {patchObjectStability} from '../tools/editor-object-stability.js';
import {editorCandidateHTML} from '../vendor/editor-integrated.js';
import {candidateHarness} from './helpers/editor-candidate.js';
import {createDocument,validateDocument} from '../core/document-core.js';
import {canonicalToEditor,editorToCanonical} from '../adapters/editor-v038-model.js';

const original=readFileSync(new URL('../vendor/editor-v039.source.html',import.meta.url),'utf8');
const html=editorCandidateHTML.includes('selectedIds=[...new Set(expand?expandGrouped(ids):ids)]')?editorCandidateHTML:patchObjectStability(editorCandidateHTML);
const shape=(id,x,extra={})=>({id,name:id,type:'shape',shape:'rect',x,y:40,w:60,h:50,fill:'#eeeeee',stroke:'#000000',strokeWidth:1,rotation:0,opacity:1,anim:'none',...extra});
const project=objects=>({version:1,name:'Object stability',width:1280,height:720,slides:[{id:'s1',background:'#ffffff',notes:'',objects}]});
const snapshot=h=>h.window.SPEditorCandidate.getSnapshot().slides[0].objects;
const keys=(h,key,options={})=>h.window.document.dispatchEvent(new h.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options}));
const pointer=(h,target,type,x=0,y=0,options={})=>target.dispatchEvent(new h.window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y,...options}));
const select=(h,id,options={})=>{
  pointer(h,h.window.document.querySelector(`#stage-mount [data-id="${id}"]`),'pointerdown',0,0,options);
  pointer(h,h.window.document,'pointerup');
};
const action=(h,id)=>{const button=h.window.document.querySelector(`[data-action="${id}"]`);assert.ok(button,id);button.click();};
async function acknowledge(h){
  await h.until(()=>h.messages.some(m=>m.type==='edit'));
  const edit=h.messages.filter(m=>m.type==='edit').at(-1);
  h.send('ack',{sequence:edit.sequence,revision:edit.expectedRevision+1,epoch:1,history:{canUndo:true,canRedo:false}});
  await h.until(()=>!h.window.SPEditorCandidate.getState().pending);
}

test('object patch only accepts its pinned native source once',()=>{
  const patched=patchObjectStability(original);assert.notEqual(patched,original);
  assert.throws(()=>patchObjectStability(patched),/expected one exact source match/);
});

test('locked objects reject ribbon edge reorder, keyboard layer reorder and ungroup without an edit',async()=>{
  const h=await candidateHarness(project([shape('a',40,{locked:true,groupId:'group'}),shape('b',180,{groupId:'group'}),shape('c',340)]),{html});
  try{
    select(h,'a');const before=JSON.stringify(snapshot(h));
    action(h,'bring-front');assert.equal(JSON.stringify(snapshot(h)),before);
    keys(h,'ArrowUp',{ctrlKey:true,shiftKey:true});assert.equal(JSON.stringify(snapshot(h)),before);
    keys(h,'g',{ctrlKey:true,shiftKey:true});assert.equal(JSON.stringify(snapshot(h)),before);
    select(h,'c');select(h,'a',{shiftKey:true});const mixed=JSON.stringify(snapshot(h));
    action(h,'send-back');assert.equal(JSON.stringify(snapshot(h)),mixed);
    await h.pause(30);assert.equal(h.messages.filter(m=>m.type==='edit').length,0);assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('unlocked group moves one layer in stable order then ungroups through keyboard',async()=>{
  const h=await candidateHarness(project([shape('a',40,{groupId:'group'}),shape('b',180,{groupId:'group'}),shape('c',340)]),{html});
  try{
    select(h,'a');keys(h,'ArrowUp',{ctrlKey:true,shiftKey:true});
    assert.deepEqual(Array.from(snapshot(h),o=>o.id),['c','a','b']);
    await acknowledge(h);
    keys(h,'g',{ctrlKey:true,shiftKey:true});
    assert.equal(snapshot(h).some(o=>o.groupId),false);assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('context menu selects the full group and cannot delete an unlocked member with a locked sibling',async()=>{
  const h=await candidateHarness(project([shape('a',40,{locked:true,groupId:'group'}),shape('b',180,{groupId:'group'})]),{html});
  try{
    const before=JSON.stringify(snapshot(h));
    h.window.document.querySelector('#stage-mount [data-id="b"]').dispatchEvent(new h.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
    assert.match(h.window.document.getElementById('selected-state').textContent,/2 个对象/);
    h.window.document.querySelector('#editor-context-menu [data-action="delete-object"]').click();
    assert.equal(JSON.stringify(snapshot(h)),before);assert.equal(h.messages.filter(m=>m.type==='edit').length,0);
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('Shift layer selection with a partially selected group counts each member once',async()=>{
  const h=await candidateHarness(project([shape('a',40,{groupId:'group'}),shape('b',180,{groupId:'group'})]),{html});
  try{
    select(h,'a');action(h,'show-layers');
    h.window.document.querySelector('[data-action="toggle-layer-visible"][data-value="b"]').click();
    await acknowledge(h);
    h.window.document.querySelector('[data-layer-select="b"]').dispatchEvent(new h.window.MouseEvent('click',{bubbles:true,shiftKey:true}));
    assert.match(h.window.document.getElementById('selected-state').textContent,/2 个对象/);
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('Shift marquee overlap retains one selected ID and single-object resize handles',async()=>{
  const h=await candidateHarness(project([shape('a',40)]),{html});
  try{
    select(h,'a');
    const stage=h.window.document.querySelector('#stage-mount .canvas-stage');
    stage.getBoundingClientRect=()=>({left:0,top:0,width:1280,height:720});
    // The native coordinate mapper uses the canvas-fit scale; JSDOM has no layout.
    const mount=h.window.document.querySelector('#stage-mount');
    mount.getBoundingClientRect=()=>({left:0,top:0,width:1280,height:720});
    pointer(h,stage,'pointerdown',0,0,{shiftKey:true});
    assert.ok(h.window.document.getElementById('marquee-select'),'native marquee starts');
    pointer(h,h.window.document,'pointermove',100000,100000,{shiftKey:true});
    assert.ok(parseFloat(h.window.document.getElementById('marquee-select').style.width)>100,'native marquee covers the object');
    pointer(h,h.window.document,'pointerup',100000,100000,{shiftKey:true});
    assert.equal(h.window.document.querySelectorAll('#stage-mount .slide-object.selected').length,1);
    assert.equal(h.window.document.querySelectorAll('#stage-mount .selection-bounds').length,0);
    assert.ok(h.window.document.querySelector('#stage-mount .sp32-transform-frame .resize-handle'));
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('native alignment, distribution, grouping and key nudge share the same selected objects',async()=>{
  const h=await candidateHarness(project([shape('a',40,{y:20}),shape('b',180,{y:70}),shape('c',340,{y:120})]),{html});
  try{
    keys(h,'a',{ctrlKey:true});action(h,'align-top');
    assert.deepEqual(Array.from(snapshot(h),o=>o.y),[20,20,20]);await acknowledge(h);
    action(h,'distribute-horizontal');
    assert.deepEqual(Array.from(snapshot(h),o=>o.x),[40,190,340]);await acknowledge(h);
    keys(h,'g',{ctrlKey:true});
    const objects=snapshot(h),groupId=objects[0].groupId;
    assert.ok(groupId);assert.equal(objects.every(o=>o.groupId===groupId),true);await acknowledge(h);
    keys(h,'ArrowRight');
    assert.deepEqual(Array.from(snapshot(h),o=>o.x),[41,191,341]);assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('a locked Core group blocks native pointer drag, key nudge, alignment, layer changes and ungroup',async()=>{
  const doc=createDocument({slides:[{id:'s1',elements:[
    shape('a',40),shape('b',180,{locked:false}),{id:'g',type:'group',x:40,y:40,w:200,h:50,children:['a','b'],locked:true,future:{keep:true}}
  ],animations:[]}]});
  const h=await candidateHarness(canonicalToEditor(doc),{html});
  try{
    const before=JSON.stringify(snapshot(h));select(h,'a');
    pointer(h,h.window.document.querySelector('#stage-mount [data-id="a"]'),'pointerdown',100,100);
    pointer(h,h.window.document,'pointermove',200,200);pointer(h,h.window.document,'pointerup',200,200);
    keys(h,'ArrowRight');action(h,'align-left');action(h,'bring-front');keys(h,'g',{ctrlKey:true,shiftKey:true});
    assert.equal(JSON.stringify(snapshot(h)),before);assert.equal(h.messages.filter(m=>m.type==='edit').length,0);
    const recovered=editorToCanonical(JSON.parse(JSON.stringify(h.window.SPEditorCandidate.getSnapshot())),{baseDocument:doc}).slides[0].elements;
    assert.equal(Object.hasOwn(recovered.find(o=>o.id==='a'),'locked'),false);
    assert.equal(recovered.find(o=>o.id==='b').locked,false);
    assert.equal(recovered.find(o=>o.id==='g').locked,true);assert.deepEqual(recovered.find(o=>o.id==='g').future,{keep:true});
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('canvas selection and marquee focus the persistent mount; right-button and text editing keep their focus',async()=>{
  const h=await candidateHarness(project([shape('a',40,{type:'text',text:'Editable'})]),{html});
  try{
    const d=h.window.document,mount=d.getElementById('stage-mount'),notes=d.getElementById('slide-notes');
    notes.focus();select(h,'a');
    assert.equal(d.activeElement,mount);assert.equal(mount.tabIndex,-1);
    d.activeElement.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
    assert.equal(snapshot(h)[0].x,41);assert.equal(d.activeElement,mount);await acknowledge(h);
    notes.focus();pointer(h,d.querySelector('#stage-mount [data-id="a"]'),'pointerdown',0,0,{button:2});
    assert.equal(d.activeElement,notes);
    pointer(h,d.querySelector('#stage-mount .canvas-stage'),'pointerdown');
    assert.equal(d.activeElement,mount);pointer(h,d,'pointerup');
    d.querySelector('#stage-mount [data-id="a"]').dispatchEvent(new h.window.MouseEvent('dblclick',{bubbles:true}));
    const text=d.querySelector('#stage-mount [data-id="a"] .obj-text');
    // JSDOM does not make contentEditable focusable as a browser does.
    assert.equal(text.contentEditable,'true');text.setAttribute('contenteditable','true');text.tabIndex=0;text.focus();
    assert.equal(d.activeElement,text);
    pointer(h,text,'pointerdown');assert.equal(d.activeElement,text);assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

for(const command of ['duplicate-slide','v11-slide-duplicate'])test(`native ${command} preserves copied Core group locks, references and unknown fields`,async()=>{
  const doc=createDocument({slides:[{id:'s1',notes:'Keep notes',comments:[{id:'comment',objectId:'a',text:'Keep comment',replies:[{id:'reply',text:'Keep reply'}]}],future:{keep:true},elements:[
    shape('a',40,{future:{child:true}}),shape('b',180,{locked:false}),
    {id:'g',type:'group',x:40,y:40,w:200,h:50,children:['b','a'],locked:true,future:{group:true}},
    {id:'empty',type:'group',x:0,y:0,w:0,h:0,children:[],future:{empty:true}},
    {id:'link',type:'connector',x:100,y:40,w:80,h:1,sourceId:'a',targetId:'b'}
  ],animations:[{id:'animation',targetId:'a',type:'fade',trigger:'click',easing:'ease',duration:.5,delay:0,order:0,future:{animation:true}}]}]});
  const h=await candidateHarness(canonicalToEditor(doc),{html});
  try{
    if(command==='v11-slide-duplicate')action(h,'v11-slide-duplicate');else action(h,'duplicate-slide');
    const project=JSON.parse(JSON.stringify(h.window.SPEditorCandidate.getSnapshot()));
    assert.equal(project.slides.length,2);
    const result=editorToCanonical(project,{baseDocument:doc});assert.equal(validateDocument(result).valid,true);
    const original=result.slides[0],copy=result.slides[1],a=copy.elements.find(o=>o.name==='a'),b=copy.elements.find(o=>o.name==='b');
    const group=copy.elements.find(o=>o.type==='group'&&o.children.length),empty=copy.elements.find(o=>o.type==='group'&&!o.children.length);
    assert.ok(group);assert.equal(group.locked,true);assert.deepEqual(group.children,[b.id,a.id]);
    assert.notEqual(group.id,'g');assert.notEqual(a.id,'a');assert.notEqual(b.id,'b');assert.notEqual(empty.id,'empty');
    assert.equal(Object.hasOwn(a,'locked'),false);assert.equal(b.locked,false);
    assert.deepEqual(group.future,{group:true});assert.deepEqual(a.future,{child:true});assert.deepEqual(empty.future,{empty:true});
    assert.equal(copy.notes,'Keep notes');assert.deepEqual(copy.future,{keep:true});
    assert.equal(copy.comments[0].objectId,a.id);assert.equal(copy.comments[0].text,'Keep comment');assert.notEqual(copy.comments[0].id,'comment');assert.notEqual(copy.comments[0].replies[0].id,'reply');
    assert.equal(copy.elements.find(o=>o.type==='connector').sourceId,a.id);assert.equal(copy.elements.find(o=>o.type==='connector').targetId,b.id);
    assert.equal(copy.animations.length,1);assert.equal(copy.animations[0].targetId,a.id);assert.notEqual(copy.animations[0].id,'animation');assert.deepEqual(copy.animations[0].future,{animation:true});
    assert.equal(original.elements.find(o=>o.id==='g').locked,true);assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

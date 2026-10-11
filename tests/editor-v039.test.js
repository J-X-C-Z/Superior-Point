// v0.39-specific integration contracts. JSDOM simulation, not browser/IME acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocument} from '../core/document-core.js';
import {canonicalToEditor} from '../adapters/editor-v038-model.js';
import {candidateHarness} from './helpers/editor-candidate.js';

const project=()=>canonicalToEditor(createDocument({id:'v039-contract',title:'MiMo contract',slides:[{
 id:'s1',notes:'Private speaker notes',comments:[{id:'c1',text:'Private review comment',author:'Reviewer',resolved:false}],
 elements:[{id:'t1',type:'text',x:50,y:60,w:600,h:120,text:'Initial text'}],animations:[]
}]}));
const snapshot=h=>JSON.stringify(h.window.SPEditorCandidate.getSnapshot());
const edits=h=>h.messages.filter(message=>message.type==='edit');
function editText(h){
 h.window.document.querySelector('#stage-mount [data-id="t1"]').dispatchEvent(new h.window.MouseEvent('dblclick',{bubbles:true}));
 const text=h.window.document.querySelector('#stage-mount [data-id="t1"] .obj-text');
 assert.equal(text.contentEditable,'true');
 // JSDOM does not reflect contentEditable to this attribute as browsers do.
 text.setAttribute('contenteditable','true');
 return text;
}
function inputText(h,text,value,isComposing=false){
 text.textContent=value;
 text.dispatchEvent(new h.window.InputEvent('input',{bubbles:true,inputType:isComposing?'insertCompositionText':'insertText',data:value,isComposing}));
}
function acknowledge(h,message,revision){
 h.send('ack',{sequence:message.sequence,revision,epoch:1,history:{canUndo:true,canRedo:false}});
}

test('v039 simulation: MiMo startup, mode and guide preserve document data and isolated preferences',async()=>{
 const h=await candidateHarness(project());
 try{
  const before=snapshot(h),doc=h.window.document;
  assert.equal(h.messages.find(message=>message.type==='ready').version,'v0.39-integrated-mimo');
  assert.equal(doc.body.dataset.spDesign,'mimo');assert.equal(doc.documentElement.dataset.rthMode,'light');
  const mode=doc.getElementById('sp39-mode');mode.click();assert.equal(doc.documentElement.dataset.rthMode,'dark');assert.equal(mode.getAttribute('aria-pressed'),'true');
  mode.click();assert.equal(doc.documentElement.dataset.rthMode,'light');assert.equal(mode.getAttribute('aria-pressed'),'false');
  doc.querySelector('[data-action="sp39-guide"]').click();assert.equal(doc.getElementById('sp39-guide-shade').hidden,false);
  assert.match(doc.getElementById('sp39-guide-shade').textContent,/含备注、批注及历史/);
  doc.querySelector('[data-action="sp39-guide-close"]').click();assert.equal(doc.getElementById('sp39-guide-shade').hidden,true);
  assert.equal(snapshot(h),before);assert.equal(edits(h).length,0);assert.deepEqual(h.storage(),{reads:0,writes:0,opens:0});assert.deepEqual(h.errors,[]);
 }finally{h.close();}
});

test('v039 simulation: quick-access undo and redo use parent history, not legacy snapshots',async()=>{
 const p=project(),h=await candidateHarness(p);
 try{
  const undo=h.window.document.querySelector('.sp39-quick-access [data-action="undo"]'),redo=h.window.document.querySelector('.sp39-quick-access [data-action="redo"]');
  assert.ok(undo&&redo);assert.equal(undo.disabled,true);assert.equal(redo.disabled,true);
  h.send('update',{project:p,revision:1,epoch:2,readOnly:false,history:{canUndo:true,canRedo:false}});
  assert.equal(undo.disabled,false);assert.equal(redo.disabled,true);undo.click();await h.until(()=>h.messages.some(message=>message.type==='undo'));
  assert.equal(h.messages.find(message=>message.type==='undo').expectedRevision,1);
  h.send('update',{project:p,revision:2,epoch:3,readOnly:false,history:{canUndo:false,canRedo:true}});
  assert.equal(undo.disabled,true);assert.equal(redo.disabled,false);redo.click();await h.until(()=>h.messages.some(message=>message.type==='redo'));
  assert.equal(h.messages.find(message=>message.type==='redo').expectedRevision,2);assert.equal(edits(h).length,0);
 }finally{h.close();}
});

test('v039 simulation: both HTML entries request complete parent export and never download or strip private data',async()=>{
 const h=await candidateHarness(project());
 try{
  const before=snapshot(h),doc=h.window.document;let downloads=0,blobs=0;
  h.window.URL.createObjectURL=()=>{blobs++;return 'blob:test';};h.window.HTMLAnchorElement.prototype.click=()=>{downloads++;};
  for(const action of ['export-reveal','sp39-export-editable']){
   const count=h.messages.filter(message=>message.type==='export').length;
   doc.querySelector(`[data-action="${action}"]`).click();await h.until(()=>h.messages.filter(message=>message.type==='export').length===count+1);
   const message=h.messages.filter(message=>message.type==='export').at(-1);assert.equal(message.format,'html');assert.equal(message.expectedRevision,0);
   assert.match(doc.getElementById('toast-container').textContent,/完整可重编辑 HTML/);assert.match(doc.getElementById('toast-container').textContent,/备注、批注及历史/);assert.match(doc.getElementById('toast-container').textContent,/不是观众脱敏版/);
  }
  assert.equal(downloads,0);assert.equal(blobs,0);assert.equal(snapshot(h),before);assert.equal(h.window.SPEditorCandidate.getSnapshot().slides[0].notes,'Private speaker notes');assert.equal(edits(h).length,0);
 }finally{h.close();}
});

test('v039 simulation: IME waits through composition, debounces its end, and flush preserves final text and notes',async()=>{
 const h=await candidateHarness(project());
 try{
  const text=editText(h);
  text.dispatchEvent(new h.window.CompositionEvent('compositionstart',{bubbles:true,data:''}));inputText(h,text,'输入中的文',true);
  await h.pause(430);assert.equal(edits(h).length,0,'composition must not commit when the autosave interval expires');
  text.textContent='输入完成';text.dispatchEvent(new h.window.CompositionEvent('compositionend',{bubbles:true,data:'完成'}));
  await h.pause(80);assert.equal(edits(h).length,0,'composition end keeps the bounded debounce');
  await h.until(()=>edits(h).length===1);assert.equal(edits(h)[0].project.slides[0].objects[0].text,'输入完成');acknowledge(h,edits(h)[0],1);
  const current=h.window.document.querySelector('#stage-mount [data-id="t1"] .obj-text');inputText(h,current,'输入完成，最后一笔');
  const notes=h.window.document.getElementById('slide-notes');notes.value='Final unsaved speaker note';notes.dispatchEvent(new h.window.Event('input',{bubbles:true}));
  let flushed=false;const flush=h.window.SPEditorCandidate.flush().then(()=>{flushed=true;});
  assert.equal(edits(h).length,2);assert.equal(edits(h)[1].project.slides[0].objects[0].text,'输入完成，最后一笔');assert.equal(edits(h)[1].project.slides[0].notes,'Final unsaved speaker note');
  await h.pause(20);assert.equal(flushed,false,'flush must wait for the authoritative acknowledgement');acknowledge(h,edits(h)[1],2);await flush;assert.equal(flushed,true);
  await h.pause(430);assert.equal(edits(h).length,2,'flush cancels the deferred autosave and note timers');assert.equal(h.window.SPEditorCandidate.getState().pending,false);assert.deepEqual(h.errors,[]);
 }finally{h.close();}
});

function typeKeys(h,target,text){
 for(const key of text){
  const down=new h.window.KeyboardEvent('keydown',{bubbles:true,cancelable:true,key});target.dispatchEvent(down);
  assert.equal(down.defaultPrevented,false,'pending commit must not consume keydown: '+key);
  const before=new h.window.InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertText',data:key});target.dispatchEvent(before);
  assert.equal(before.defaultPrevented,false,'pending commit must not consume beforeinput: '+key);
  if('value' in target)target.value+=key;else target.textContent+=key;
  const input=new h.window.InputEvent('input',{bubbles:true,inputType:'insertText',data:key});target.dispatchEvent(input);
  assert.equal(input.defaultPrevented,false);
  target.dispatchEvent(new h.window.KeyboardEvent('keyup',{bubbles:true,key}));
 }
}
function startPendingTitleCommit(h){
 const title=h.window.document.getElementById('document-title');title.value='Commit awaiting parent';title.dispatchEvent(new h.window.Event('change',{bubbles:true}));
 assert.equal(edits(h).length,1);assert.equal(h.window.SPEditorCandidate.getState().pending,true);
}

test('v039 input-event simulation: pending acknowledgement never blocks notes keys; flush drains the newest draft',async()=>{
 const h=await candidateHarness(project());
 try{
  startPendingTitleCommit(h);
  const notes=h.window.document.getElementById('slide-notes');notes.value='';notes.dispatchEvent(new h.window.Event('input',{bubbles:true}));
  const pointer=new h.window.MouseEvent('click',{bubbles:true,cancelable:true});notes.dispatchEvent(pointer);assert.equal(pointer.defaultPrevented,false);
  typeKeys(h,notes,'真实键盘备注1010');notes.dispatchEvent(new h.window.Event('change',{bubbles:true}));
  assert.equal(notes.value,'真实键盘备注1010');assert.equal(edits(h).length,1,'only one snapshot may be in flight');
  acknowledge(h,edits(h)[0],1);assert.equal(edits(h).length,2);assert.equal(edits(h)[1].expectedRevision,1);assert.equal(edits(h)[1].project.slides[0].notes,'真实键盘备注1010');
  let flushed=false;const flush=h.window.SPEditorCandidate.flush().then(()=>{flushed=true;});
  // These keystrokes arrive after flush began, before its last ack, and before
  // the notes debounce expires. They must become a third authoritative commit.
  typeKeys(h,notes,'尾0');acknowledge(h,edits(h)[1],2);await h.pause(0);
  assert.equal(flushed,false);assert.equal(edits(h).length,3);assert.equal(edits(h)[2].expectedRevision,2);assert.equal(edits(h)[2].project.slides[0].notes,'真实键盘备注1010尾0');
  acknowledge(h,edits(h)[2],3);await flush;assert.equal(flushed,true);assert.equal(h.window.SPEditorCandidate.getSnapshot().slides[0].notes,'真实键盘备注1010尾0');
  await h.pause(550);assert.equal(edits(h).length,3);assert.equal(h.window.SPEditorCandidate.getState().pending,false);
 }finally{h.close();}
});

test('v039 input-event simulation: rejecting the first snapshot preserves later text and notes still being typed',async()=>{
 const h=await candidateHarness(project());
 try{
  startPendingTitleCommit(h);const first=edits(h)[0];
  const text=editText(h);typeKeys(h,text,'，在途编辑尾0');
  const notes=h.window.document.getElementById('slide-notes');notes.value='';notes.dispatchEvent(new h.window.Event('input',{bubbles:true}));typeKeys(h,notes,'未确认备注1010');
  // No waiting for debounce and no blur: rejection must capture the latest DOM.
  h.send('reject',{project:project(),rejectedProject:first.project,sequence:first.sequence,revision:0,epoch:2,readOnly:true,error:'Simulated parent rejection'});
  const recovery=h.messages.findLast(message=>message.type==='recovery');assert.ok(recovery);
  assert.equal(recovery.project.slides[0].objects[0].text,'Initial text，在途编辑尾0');assert.equal(recovery.project.slides[0].notes,'未确认备注1010');
  assert.equal(h.window.SPEditorCandidate.getState().readOnly,true);assert.equal(h.window.SPEditorCandidate.getState().pending,false);await assert.rejects(h.window.SPEditorCandidate.flush(),/Simulated parent rejection/);
  const blocked=new h.window.InputEvent('beforeinput',{bubbles:true,cancelable:true,data:'x'});notes.dispatchEvent(blocked);assert.equal(blocked.defaultPrevented,true,'actual read-only state must still gate edits');
 }finally{h.close();}
});

test('workspace menus route backup and audience formats, while parent reports persistence',async()=>{
 const h=await candidateHarness(project());
 try{
  const doc=h.window.document;
  assert.ok(doc.querySelector('.sp-workspace-share'));
  for(const [action,format] of [['sp-workspace-json','json'],['sp-workspace-audience','audience']]){
   doc.querySelector(`[data-action="${action}"]`).click();
   await h.until(()=>h.messages.some(m=>m.type==='export'&&m.format===format));
  }
  h.send('workspaceState',{state:{text:'已保存到本地 · 修订 0',failed:false,revision:0}});
  assert.equal(doc.querySelector('#save-status').textContent,'已保存到本地 · 修订 0');
  h.send('workspaceState',{state:{text:'保存失败 · 磁盘空间不足',failed:true,revision:0,details:'恢复副本保留原项目。'}});
  assert.equal(doc.querySelector('#save-status').textContent,'保存失败 · 磁盘空间不足');
  assert.equal(doc.querySelector('#save-status').dataset.failed,'true');
  assert.equal(doc.querySelector('.sp-workspace-details').textContent,'恢复副本保留原项目。');
  assert.equal(doc.querySelector('.sp-workspace-details').hidden,false);
  doc.querySelector('[data-tab="文件"]').click();
  for(const action of ['save-json','sp-workspace-json','sp-workspace-audience','export-reveal','open'])assert.ok(doc.querySelector(`#ribbon [data-action="${action}"]`));
  assert.equal(doc.querySelector('#notes-panel').classList.contains('collapsed'),true);
  assert.equal(edits(h).length,0);assert.deepEqual(h.errors,[]);
 }finally{h.close();}
});

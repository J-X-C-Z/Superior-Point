import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {Script} from 'node:vm';
import {createDocument} from '../core/document-core.js';
import {canonicalToEditor} from '../adapters/editor-v038-model.js';
import {editorCandidateHTML,editorCandidateSourceSHA256} from '../vendor/editor-integrated.js';
import {legacyPlaybackBootstrap} from '../vendor/editor-integrated-playback.js';
import {candidateHarness} from './helpers/editor-candidate.js';
const project=()=>canonicalToEditor(createDocument({id:'candidate-test',title:'Candidate test',slides:[{id:'s1',elements:[{id:'t1',type:'text',x:50,y:60,w:500,h:120,text:'Preserved text'}],animations:[]}]}));
test('candidate source is unchanged and executable playback is extracted from trusted source',async()=>{
 const source=await readFile(new URL('../vendor/editor-v039.source.html',import.meta.url));assert.equal(createHash('sha256').update(source).digest('hex'),editorCandidateSourceSHA256);
 assert.match(editorCandidateHTML,/Content-Security-Policy/);assert.match(editorCandidateHTML,/connect-src 'none'/);assert.match(editorCandidateHTML,/sp-candidate-reveal-code/);
 assert.match(legacyPlaybackBootstrap,/function v15PlaybackBootstrap/);assert.match(legacyPlaybackBootstrap,/function v24OfflineExportBootstrap/);new Script(legacyPlaybackBootstrap);
});
test('jsdom simulation: explicit initialization preserves IDs and touches no legacy persistence',async()=>{
 const h=await candidateHarness(project());try{const snapshot=h.window.SPEditorCandidate.getSnapshot();assert.equal(snapshot.slides[0].id,'s1');assert.equal(snapshot.slides[0].objects[0].id,'t1');assert.deepEqual(h.storage(),{reads:0,writes:0,opens:0});assert.equal(h.errors.length,0,h.errors.map(x=>x.message).join(';'));assert.equal(typeof h.window.Reveal,'function');}finally{h.close();}
});
test('jsdom simulation: editing emits parent revision commit, ack unlocks, undo delegates',async()=>{
 const h=await candidateHarness(project());try{
  const input=h.window.document.getElementById('document-title');input.value='Changed title';input.dispatchEvent(new h.window.Event('change',{bubbles:true}));
  const edit=h.messages.find(m=>m.type==='edit');assert.ok(edit);assert.equal(edit.expectedRevision,0);assert.equal(edit.project.name,'Changed title');assert.equal(h.window.SPEditorCandidate.getState().pending,true);
  h.send('ack',{sequence:edit.sequence,revision:1,epoch:1,history:{canUndo:true,canRedo:false}});assert.equal(h.window.SPEditorCandidate.getState().pending,false);
  h.window.document.querySelector('[data-action="undo"]').click();await h.until(()=>h.messages.some(m=>m.type==='undo'));
  assert.equal(h.messages.find(m=>m.type==='undo').expectedRevision,1);assert.deepEqual(h.storage(),{reads:0,writes:0,opens:0});
 }finally{h.close();}
});
test('jsdom simulation: readonly blocks edits, parent update preserves unknown fields, export keeps motion markup',async()=>{
 const p=project();p.slides[0].objects[0].motionEffects=[{id:'fx1',kind:'entrance',effect:'fade',trigger:'click',step:0,delay:0,duration:400,easing:'ease-out'}];p.customExtension={unchanged:true};
 const h=await candidateHarness(p,{readOnly:true});try{
  const input=h.window.document.getElementById('document-title');input.value='Forbidden';input.dispatchEvent(new h.window.Event('change',{bubbles:true}));assert.equal(h.messages.filter(m=>m.type==='edit').length,0);assert.equal(h.window.SPEditorCandidate.getSnapshot().name,'Candidate test');
  h.send('update',{project:{...p,name:'External authoritative update'},revision:4,readOnly:false,epoch:2});assert.equal(h.window.SPEditorCandidate.getSnapshot().name,'External authoritative update');assert.equal(h.window.SPEditorCandidate.getSnapshot().customExtension.unchanged,true);
  const html=h.window.SPEditorCandidate.renderLegacyHTML();assert.match(html,/v15-motion-marker/);assert.match(html,/data-v15-object-id="t1"/);assert.match(html,/superior-point-project/);assert.doesNotMatch(html,/<script[^>]+src=/);
 }finally{h.close();}
});
test('jsdom simulation: flush commits notes and waits for ack; rejection preserves recovery snapshot',async()=>{
 const p=project(),h=await candidateHarness(p);try{
  const notes=h.window.document.getElementById('slide-notes');notes.value='Last keystroke before navigation';notes.dispatchEvent(new h.window.Event('input',{bubbles:true}));
  let settled=false;const flush=h.window.SPEditorCandidate.flush().then(()=>settled=true);
  const edit=h.messages.find(m=>m.type==='edit');assert.ok(edit);assert.equal(edit.project.slides[0].notes,'Last keystroke before navigation');await h.pause(20);assert.equal(settled,false);
  h.send('ack',{sequence:edit.sequence,revision:1,epoch:1,history:{canUndo:true,canRedo:false}});await flush;assert.equal(settled,true);
  const input=h.window.document.getElementById('document-title');input.value='Rejected';input.dispatchEvent(new h.window.Event('change',{bubbles:true}));
  const edits=h.messages.filter(m=>m.type==='edit'),second=edits.at(-1);assert.equal(second.expectedRevision,1);
  h.send('reject',{project:p,revision:9,epoch:2,sequence:second.sequence,error:'Revision changed',readOnly:false});assert.equal(h.window.SPEditorCandidate.getSnapshot().name,'Rejected');assert.equal(h.window.SPEditorCandidate.getState().pending,false);assert.equal(h.window.SPEditorCandidate.getState().readOnly,true);assert.equal(h.messages.findLast(m=>m.type==='recovery').project.name,'Rejected');await assert.rejects(h.window.SPEditorCandidate.flush(),/Revision changed/);
  h.send('update',{project:p,revision:10,epoch:3,readOnly:false});assert.equal(h.window.SPEditorCandidate.getSnapshot().name,'Rejected');
  h.send('ack',{sequence:second.sequence,revision:2,epoch:1});assert.equal(h.window.SPEditorCandidate.getState().revision,9);
 }finally{h.close();}
});
test('jsdom simulation: incoming project file routes to parent without adopting it',async()=>{
 const h=await candidateHarness(project());try{
  const input=h.window.document.getElementById('pptx-upload');const file=new h.window.File(['<script>window.bad=1</script>'],'untrusted.html',{type:'text/html'});
  Object.defineProperty(input,'files',{value:[file]});input.dispatchEvent(new h.window.Event('change',{bubbles:true}));await h.until(()=>h.messages.some(m=>m.type==='import'));
  assert.equal(h.messages.find(m=>m.type==='import').file.name,'untrusted.html');assert.equal(h.window.bad,undefined);assert.equal(h.window.SPEditorCandidate.getSnapshot().name,'Candidate test');assert.deepEqual(h.storage(),{reads:0,writes:0,opens:0});
 }finally{h.close();}
});
test('jsdom simulation: losing write access preserves unsent notes instead of discarding last input',async()=>{
 const h=await candidateHarness(project());try{
  const notes=h.window.document.getElementById('slide-notes');notes.value='Unsent notes at lock loss';notes.dispatchEvent(new h.window.Event('input',{bubbles:true}));
  h.send('readOnly',{value:true});const recovery=h.messages.findLast(m=>m.type==='recovery');assert.ok(recovery);assert.equal(recovery.project.slides[0].notes,'Unsent notes at lock loss');assert.equal(h.window.SPEditorCandidate.getState().readOnly,true);
  await assert.rejects(h.window.SPEditorCandidate.flush(),/写入权/);h.send('readOnly',{value:false});assert.equal(h.window.SPEditorCandidate.getState().readOnly,true);
 }finally{h.close();}
});
test('jsdom simulation: losing write access captures unblurred contenteditable text for recovery',async()=>{
 const h=await candidateHarness(project());try{
  h.window.document.querySelector('#stage-mount [data-id="t1"]').dispatchEvent(new h.window.MouseEvent('dblclick',{bubbles:true}));
  const text=h.window.document.querySelector('#stage-mount [data-id="t1"] .obj-text');assert.equal(text.contentEditable,'true');text.textContent='Final unblurred text';
  h.send('readOnly',{value:true});const recovery=h.messages.findLast(m=>m.type==='recovery');assert.ok(recovery);assert.equal(recovery.project.slides[0].objects[0].text,'Final unblurred text');
  await assert.rejects(h.window.SPEditorCandidate.flush(),/写入权/);
 }finally{h.close();}
});
test('jsdom simulation: external update during an in-flight edit retains the local draft for recovery',async()=>{
 const p=project(),h=await candidateHarness(p);try{
  const title=h.window.document.getElementById('document-title');title.value='In-flight local change';title.dispatchEvent(new h.window.Event('change',{bubbles:true}));assert.equal(h.window.SPEditorCandidate.getState().pending,true);
  h.send('update',{project:{...p,name:'External change'},revision:7,epoch:2,readOnly:false});
  assert.equal(h.window.SPEditorCandidate.getSnapshot().name,'In-flight local change');assert.equal(h.window.SPEditorCandidate.getState().pending,false);assert.equal(h.window.SPEditorCandidate.getState().readOnly,true);assert.equal(h.messages.findLast(m=>m.type==='recovery').project.name,'In-flight local change');
  await assert.rejects(h.window.SPEditorCandidate.flush(),/未提交/);
 }finally{h.close();}
});

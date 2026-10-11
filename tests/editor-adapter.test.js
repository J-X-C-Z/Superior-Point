import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {createLegacyEditorAdapter} from '../web/legacy-editor-adapter.js';
import {createDocument,DocumentCore} from '../core/document-core.js';import {canonicalToEditor} from '../adapters/editor-v038-model.js';
const tick=()=>new Promise(r=>setTimeout(r,0));
test('adapter simulation: opaque sandbox, exact source/channel validation, atomic revision commit, read-only and teardown',async()=>{
 const host=new JSDOM('<div id="mount"></div>',{url:'https://host.invalid/'}),win=host.window;
 const core=new DocumentCore(createDocument({id:'adapter-test',title:'Before',slides:[{id:'s1',elements:[],animations:[]}]}));
 const messages=[];let api;
 const mounting=createLegacyEditorAdapter().mount({container:win.document.getElementById('mount'),document:core.getDocument(),getHistoryState:()=>({canUndo:core.canUndo,canRedo:core.canRedo}),onEdit:(ops,revision)=>{const doc=core.edit(ops,{expectedRevision:revision});api?.update(doc);return doc;},onUndo:()=>core.undo(),onRedo:()=>core.redo()});
 const frame=win.document.querySelector('iframe'),channel=frame.srcdoc.match(/const spBridgeChannel='([^']+)'/)[1];
 assert.equal(frame.getAttribute('sandbox'),'allow-scripts allow-downloads');assert.equal(frame.hasAttribute('allow-same-origin'),false);
 const deliver=(type,data={},source=frame.contentWindow,nonce=channel)=>win.dispatchEvent(new win.MessageEvent('message',{source,origin:'null',data:{spCandidate:1,channel:nonce,type,...data}}));
 frame.contentWindow.postMessage=message=>{messages.push(message);if(message.type==='initialize')queueMicrotask(()=>deliver('response',{requestId:message.requestId,value:true}));};
 deliver('ready');api=await mounting;
 try{
  const project=canonicalToEditor(core.getDocument());project.name='After';
  deliver('edit',{project,sequence:1,expectedRevision:0,epoch:1},win);deliver('edit',{project,sequence:1,expectedRevision:0,epoch:1},frame.contentWindow,'wrong-channel');assert.equal(core.getDocument().revision,0);
  deliver('edit',{project,sequence:1,expectedRevision:0,epoch:1});assert.equal(core.getDocument().title,'After');assert.equal(core.getDocument().revision,1);assert.equal(messages.at(-1).type,'ack');assert.equal(messages.at(-1).history.canUndo,true);
  // Reentrant parent repaint must not emit a competing update before this ack.
  assert.equal(messages.filter(m=>m.type==='update').length,0);api.update(core.getDocument());assert.equal(messages.filter(m=>m.type==='update').length,0,'same-document repaint must not advance epoch');
  const flush=api.flush();await tick();const request=messages.findLast(m=>m.type==='flush');assert.ok(request);deliver('response',{requestId:request.requestId,value:true});await flush;
  deliver('edit',{project,sequence:1,expectedRevision:1,epoch:1});assert.equal(messages.at(-1).type,'reject');assert.equal(core.getDocument().revision,1);
  const epoch=messages.at(-1).epoch;assert.equal(api.getRecoveryDocument().title,'After');assert.equal(api.getRejectedSnapshot().name,'After');await assert.rejects(api.flush(),/保留恢复/);
  const preserved=api.getRecoveryDocument();preserved.title='Detached';assert.equal(api.getRecoveryDocument().title,'After');
  api.update({...core.getDocument(),title:'External update'});assert.equal(api.getRecoveryDocument().title,'After');
  api.setReadOnly(true);deliver('edit',{project,sequence:2,expectedRevision:1,epoch});assert.equal(messages.at(-1).type,'reject');assert.equal(core.getDocument().revision,1);
  const pending=api.getSnapshot();await tick();api.destroy();await assert.rejects(pending,/关闭/);assert.equal(win.document.querySelector('iframe'),null);
 }finally{api.destroy();win.close();}
});
test('adapter simulation: late old-epoch edits get explicit rejection and a recoverable snapshot',async()=>{
 const host=new JSDOM('<div id="mount"></div>',{url:'https://host.invalid/'}),w=host.window,messages=[];
 const core=new DocumentCore(createDocument({id:'late-edit',title:'Initial',slides:[{id:'s',elements:[]}]}));
 const mounting=createLegacyEditorAdapter().mount({container:w.document.getElementById('mount'),document:core.getDocument(),onEdit:(ops,expectedRevision)=>core.edit(ops,{expectedRevision})});
 const frame=w.document.querySelector('iframe'),channel=frame.srcdoc.match(/const spBridgeChannel='([^']+)'/)[1];
 const deliver=(type,data={})=>w.dispatchEvent(new w.MessageEvent('message',{source:frame.contentWindow,origin:'null',data:{spCandidate:1,channel,type,...data}}));
 frame.contentWindow.postMessage=message=>{messages.push(message);if(message.type==='initialize')queueMicrotask(()=>deliver('response',{requestId:message.requestId,value:true}));};
 deliver('ready');const api=await mounting;
 try{
  const local=canonicalToEditor(core.getDocument());local.name='Local edit before external update';
  const external=core.edit([{type:'updateProject',properties:{title:'New authoritative title'}}],{expectedRevision:0});api.update(external);assert.equal(messages.at(-1).epoch,2);
  deliver('edit',{project:local,sequence:1,epoch:1,expectedRevision:0});assert.equal(messages.at(-1).type,'reject');assert.equal(messages.at(-1).rejectedProject.name,local.name);assert.equal(api.getRecoveryDocument().title,local.name);assert.equal(core.getDocument().title,'New authoritative title');await assert.rejects(api.flush(),/保留恢复/);
 }finally{api.destroy();w.close();}
});

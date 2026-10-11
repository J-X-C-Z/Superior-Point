import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {createDocument,DocumentCore} from '../core/document-core.js';
import {canonicalToEditor} from '../adapters/editor-v038-model.js';
import {createLegacyEditorAdapter} from '../web/legacy-editor-adapter.js';
import {patchEditorThemeEntry} from '../tools/editor-theme-entry.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const source=readFileSync(new URL('../vendor/editor-v039.source.html',import.meta.url),'utf8');

test('v039 design entry shows the canonical snapshot and labels native presets as document styles',()=>{
 const patched=patchEditorThemeEntry(source);
 assert.match(patched,/spBridgeThemeEntry\?\.name/);
 assert.match(patched,/spBridgeThemeEntry\?\.version/);
 assert.match(patched,/文稿内样式（原设计预设）/);
 assert.equal((patched.match(/data-action="sp-theme-entry"/g)||[]).length,2);
 assert.equal(patchEditorThemeEntry(patched),patched);
 assert.throws(()=>patchEditorThemeEntry('no v0.39 design ribbon'),/Expected one/);
});

test('theme entry metadata is snapshot-backed and authenticated themes messages respect revision and read-only state',async()=>{
 const host=new JSDOM('<div id="mount"></div>',{url:'https://host.invalid/'}),win=host.window,messages=[],opened=[];
 const doc=createDocument({id:'theme-entry',title:'Theme entry',extensions:{theme:{ref:{snapshot:{name:'Paper',version:'2.4.1'}},bindings:{slides:{},elements:{}}}},slides:[{id:'s1',elements:[],animations:[]}]});
 const core=new DocumentCore(doc),adapter=createLegacyEditorAdapter();
 const mounting=adapter.mount({container:win.document.getElementById('mount'),document:core.getDocument(),onEdit:(ops,revision)=>core.edit(ops,{expectedRevision:revision}),onThemes:()=>opened.push(true)});
 const frame=win.document.querySelector('iframe'),channel=frame.srcdoc.match(/const spBridgeChannel='([^']+)'/)[1];
 const deliver=(type,data={},source=frame.contentWindow,nonce=channel)=>win.dispatchEvent(new win.MessageEvent('message',{source,origin:'null',data:{spCandidate:1,channel:nonce,type,...data}}));
 frame.contentWindow.postMessage=message=>{messages.push(message);if(message.type==='initialize')queueMicrotask(()=>deliver('response',{requestId:message.requestId,value:true}));};
 deliver('ready');const api=await mounting;
 try{
  assert.deepEqual(messages.find(message=>message.type==='initialize').themeEntry,{name:'Paper',version:'2.4.1'});
  deliver('themes',{epoch:1,expectedRevision:0},win);deliver('themes',{epoch:1,expectedRevision:0},frame.contentWindow,'wrong-channel');await tick();assert.deepEqual(opened,[]);
  api.setReadOnly(true);deliver('themes',{epoch:1,expectedRevision:0});await tick();assert.deepEqual(opened,[]);
  api.setReadOnly(false);deliver('themes',{epoch:1,expectedRevision:1});await tick();assert.deepEqual(opened,[],'stale revision cannot navigate');
  deliver('themes',{epoch:1,expectedRevision:0});await tick();assert.deepEqual(opened,[true]);
  const project=canonicalToEditor(core.getDocument());project.name='Edited';
  deliver('edit',{project,sequence:1,expectedRevision:0,epoch:1});
  assert.equal(core.getDocument().title,'Edited');assert.deepEqual(core.getDocument().extensions.theme,doc.extensions.theme);
 }finally{api.destroy();win.close();}
});

test('without a theme host callback, the bridge reports the unavailable entry',async()=>{
 const host=new JSDOM('<div id="mount"></div>',{url:'https://host.invalid/'}),win=host.window,messages=[];
 const doc=createDocument({id:'theme-entry-no-host',slides:[{id:'s1',elements:[]}]});
 const mounting=createLegacyEditorAdapter().mount({container:win.document.getElementById('mount'),document:doc});
 const frame=win.document.querySelector('iframe'),channel=frame.srcdoc.match(/const spBridgeChannel='([^']+)'/)[1];
 const deliver=(type,data={})=>win.dispatchEvent(new win.MessageEvent('message',{source:frame.contentWindow,origin:'null',data:{spCandidate:1,channel,type,...data}}));
 frame.contentWindow.postMessage=message=>{messages.push(message);if(message.type==='initialize')queueMicrotask(()=>deliver('response',{requestId:message.requestId,value:true}));};
 deliver('ready');const api=await mounting;
 try{
  deliver('themes',{epoch:1,expectedRevision:0});await tick();
  assert.equal(messages.at(-1).type,'notice');assert.match(messages.at(-1).text,/尚未接入/);
 }finally{api.destroy();win.close();}
});

import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';import {Script} from 'node:vm';import {JSDOM} from 'jsdom';
import {patchEditorPermissions} from '../tools/editor-permissions.js';
import {createLegacyEditorAdapter} from '../web/legacy-editor-adapter.js';
const source=await readFile(new URL('../vendor/editor-v039.source.html',import.meta.url),'utf8');
const patched=patchEditorPermissions(source);
function runtime(){
 const dom=new JSDOM('<button id="previous">Copy</button>',{runScripts:'outside-only'}),w=dom.window;
 const notices=[],objects=[];
 w.toast=(text,error)=>notices.push({text,error});w.v16={fullscreenRequested:true,didFullscreen:false};
 w.V11_NATIVE_CLIP='SUPERIORPOINT_OBJECTS_V1:';w.V11_NATIVE_SLIDES='SUPERIORPOINT_SLIDES_V1:';
 w.spBridgeReadOnly=false;w.makeText=text=>({text});w.addObject=obj=>objects.push(obj);
 Object.defineProperty(w.navigator,'userActivation',{value:{isActive:true}});
 w.eval(patched.slice(patched.indexOf('  // SP_EDITOR_PERMISSIONS_START'),patched.indexOf('  // SP_EDITOR_PERMISSIONS_END')));
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 return {dom,w,notices,objects};
}
test('permissions patch compiles and preserves reference; asynchronous initialization cannot consume fullscreen gesture',()=>{
 for(const match of patched.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi))new Script(match[1]);
 assert.equal(source.includes('SP_EDITOR_PERMISSIONS_START'),false);
 assert.ok(patched.indexOf('const spFullscreenStart=')<patched.indexOf('await reveal.initialize();'));
 assert.equal(patched.includes('navigator.clipboard?.writeText'),false);
 assert.equal(patched.includes("window.prompt('粘贴纯文本"),false);
 assert.throws(()=>patchEditorPermissions(patched),/expected one exact source match/);
});
test('copy requires active gesture, reports failed/oversized writes, preserves focus and internal payload',()=>{
 const {dom,w,notices}=runtime();try{
 const previous=w.document.getElementById('previous');previous.focus();
 let calls=0,output;
 w.document.execCommand=()=>{calls++;const event=new w.Event('copy',{cancelable:true});event.clipboardData={setData:(type,value)=>{assert.equal(type,'text/plain');output=value;}};w.document.dispatchEvent(event);return true;};
 w.spPermissionCopy('native payload','已复制对象');assert.equal(output,'native payload');assert.equal(notices.at(-1).error,false);assert.equal(w.document.activeElement,previous);assert.equal(w.document.querySelector('textarea'),null);
 w.navigator.userActivation.isActive=false;w.spPermissionCopy('blocked','已复制对象');assert.equal(calls,1);assert.match(notices.at(-1).text,/仅保留在本编辑器/);
 w.navigator.userActivation.isActive=true;w.spPermissionCopy('x'.repeat(1_200_000),'已复制页面');assert.equal(calls,1);
 w.document.execCommand=()=>true;w.spPermissionCopy('no event','已复制对象');assert.equal(notices.at(-1).error,true);
 w.document.execCommand=()=>{throw Error('denied');};w.spPermissionCopy('denied','已复制对象');assert.equal(notices.at(-1).error,true);assert.equal(w.document.querySelector('textarea'),null);
 }finally{dom.window.close();}
});
test('manual paste dialog retains failed text, validates data, inserts only into a writable session',()=>{
 const {dom,w,objects}=runtime();try{
 w.document.getElementById('previous').focus();w.spPermissionPasteText();w.spPermissionPasteText();assert.equal(w.document.querySelectorAll('dialog').length,1);
 const dialog=w.document.querySelector('dialog'),field=dialog.querySelector('textarea');
 assert.equal(dialog.querySelector('form'),null);
 const submit=()=>dialog.querySelector('[data-paste-insert]').click();
 field.value=w.V11_NATIVE_CLIP+'[]';submit();assert.equal(objects.length,0);assert.match(dialog.querySelector('[role="status"]').textContent,/常规粘贴/);
 field.value='Keep my words';w.spBridgeReadOnly=true;submit();assert.equal(objects.length,0);assert.equal(field.value,'Keep my words');
 w.spBridgeReadOnly=false;field.value='x'.repeat(10001);submit();assert.equal(objects.length,0);
 field.value='Inserted text';submit();assert.deepEqual(objects.map(obj=>obj.text),['Inserted text']);assert.equal(w.document.querySelector('dialog'),null);assert.equal(w.document.activeElement.id,'previous');
 w.spPermissionPasteText();w.document.querySelector('[data-paste-cancel]').click();assert.equal(w.document.querySelector('dialog'),null);assert.equal(objects.length,1);
 }finally{dom.window.close();}
});
test('fullscreen reports rejection and unsupported browsers while retaining window playback',async()=>{
 const {dom,w,notices}=runtime();try{
 await w.spPermissionFullscreen({requestFullscreen:async()=>{throw Error('denied');}});assert.equal(w.v16.fullscreenRequested,false);assert.match(notices.at(-1).text,/窗口放映/);
 await w.spPermissionFullscreen({});assert.match(notices.at(-1).text,/不支持全屏/);
 Object.defineProperty(w.document,'fullscreenElement',{value:{}});await w.spPermissionFullscreen({requestFullscreen:async()=>{}});assert.equal(w.v16.didFullscreen,true);
 }finally{dom.window.close();}
});
test('adapter grants fullscreen only; opaque sandbox and exact source/channel bridge validation remain',async()=>{
 const dom=new JSDOM('<div id="mount"></div>',{url:'https://host.invalid/'}),w=dom.window;
 const mounting=createLegacyEditorAdapter({toLegacyDocument:document=>document}).mount({container:w.document.getElementById('mount'),document:{revision:0,slides:[]}});
 const frame=w.document.querySelector('iframe'),channel=frame.srcdoc.match(/const spBridgeChannel='([^']+)'/)[1];
 assert.equal(frame.getAttribute('allow'),'fullscreen *');assert.equal(frame.hasAttribute('allowfullscreen'),true);assert.equal(frame.getAttribute('sandbox'),'allow-scripts allow-downloads');
 let initialized=0;
 const deliver=(type,data={},source=frame.contentWindow,nonce=channel)=>w.dispatchEvent(new w.MessageEvent('message',{source,data:{spCandidate:1,channel:nonce,type,...data}}));
 frame.contentWindow.postMessage=message=>{if(message.type==='initialize'){initialized++;queueMicrotask(()=>deliver('response',{requestId:message.requestId,value:true}));}};
 deliver('ready',{},w);deliver('ready',{},frame.contentWindow,'wrong');assert.equal(initialized,0);deliver('ready');const api=await mounting;api.destroy();w.close();
});

test('native paste sink routes real editor document handler across documents and preserves writer/slide boundaries',async()=>{
 const {dom,w,objects,notices}=runtime();try{
 let timeout,slide={id:'s1'},pastedObjects=[],pastedSlides=[];
 w.setTimeout=callback=>{timeout=callback;return 1;};w.clearTimeout=()=>{};
 w.presentation={active:false};w.spBridgeEpoch=1;w.sp30PasteVersion=0;w.objectClipboard=null;w.v11SlideClipboard=null;w.v11SlideFocus=false;
 w.$=()=>({hidden:true});w.curSlide=()=>slide;w.clone=value=>JSON.parse(JSON.stringify(value));w.addPicture=()=>{};
 w.pasteObjects=()=>{pastedObjects.push(...w.objectClipboard);};w.v11PasteSlides=()=>{pastedSlides.push(...w.v11SlideClipboard);};
 w.eval(patched.split('\n').find(line=>line.startsWith('  function isTyping(){')));
 const handlerStart=patched.indexOf("    document.addEventListener('paste',e=>{"),handlerEnd=patched.indexOf('    // Spreadsheet-like cell traversal',handlerStart);
 w.eval(patched.slice(handlerStart,handlerEnd));
 const paste=(sink,text)=>{const e=new w.Event('paste',{bubbles:true,cancelable:true});e.clipboardData={items:[],getData:()=>text};sink.dispatchEvent(e);return e;};
 w.document.getElementById('previous').focus();w.spPermissionPreparePaste();let sink=w.document.getElementById('sp-permission-paste-sink');assert.ok(sink);assert.equal(w.isTyping(),false);
 const payload=[{id:'o1',type:'text',text:'Across documents'},{id:'o2',type:'shape'}];const event=paste(sink,w.V11_NATIVE_CLIP+JSON.stringify(payload));assert.equal(event.defaultPrevented,true);assert.deepEqual(pastedObjects,payload);await Promise.resolve();assert.equal(w.document.getElementById('sp-permission-paste-sink'),null);assert.equal(w.document.activeElement.id,'previous');
 w.objectClipboard=null;w.spPermissionPreparePaste();sink=w.document.getElementById('sp-permission-paste-sink');paste(sink,'System words');assert.equal(objects.at(-1).text,'System words');await Promise.resolve();
 w.v11SlideFocus=true;w.spPermissionPreparePaste();sink=w.document.getElementById('sp-permission-paste-sink');const pages=[{id:'source-page',objects:[]}];paste(sink,w.V11_NATIVE_SLIDES+JSON.stringify(pages));assert.deepEqual(pastedSlides,pages);await Promise.resolve();
 w.spPermissionPreparePaste();sink=w.document.getElementById('sp-permission-paste-sink');w.spBridgeReadOnly=true;const before=pastedObjects.length;paste(sink,w.V11_NATIVE_CLIP+JSON.stringify(payload));assert.equal(pastedObjects.length,before);assert.match(notices.at(-1).text,/会话已改变/);await Promise.resolve();
 w.spPermissionPreparePaste();assert.equal(w.document.querySelector('#sp-permission-paste-sink'),null);w.spBridgeReadOnly=false;
 w.spPermissionPreparePaste();sink=w.document.getElementById('sp-permission-paste-sink');slide={id:'different-slide'};paste(sink,w.V11_NATIVE_CLIP+JSON.stringify(payload));assert.equal(pastedObjects.length,before);await Promise.resolve();
 w.v11SlideClipboard=null;w.objectClipboard=null;w.spPermissionPreparePaste();timeout();assert.match(notices.at(-1).text,/未收到系统粘贴/);assert.equal(w.document.querySelector('#sp-permission-paste-sink'),null);
 w.presentation.active=true;w.spPermissionPreparePaste();assert.equal(w.document.querySelector('#sp-permission-paste-sink'),null);
 }finally{dom.window.close();}
});

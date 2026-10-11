// JSDOM/fake-indexeddb UI simulations and real SDK stdio. No real-browser/layout claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {JSDOM} from 'jsdom';
import 'fake-indexeddb/auto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createDocument} from '../core/document-core.js';
import {exportHTML,importHTML} from '../io/html.js';
import {MAX_IMPORT_BYTES,readImportFile} from '../io/project-import.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('DOM wait timed out');};
const file=(data,name='project.json')=>{const text=typeof data==='string'?data:JSON.stringify(data);return new File([text],name,{type:name.endsWith('.json')?'application/json':'text/html'});};
const doc=(title='Import example')=>createDocument({title,slides:[{id:'slide',elements:[{id:'text',type:'text',x:10,y:10,w:400,h:80,text:'Source content'}],animations:[]}]});
const titleEdit=(app,title)=>app.edit([{type:'updateProject',properties:{title}}]);
async function setup(){
 await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase('superior-point-framework-v1');request.onsuccess=resolve;request.onerror=()=>reject(request.error);});
 const dom=new JSDOM(await readFile(new URL('../web/index.html',import.meta.url),'utf8'),{url:'http://localhost/web/'});
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.BroadcastChannel=undefined;
 await import(`../web/app.js?import=${crypto.randomUUID()}`);await wait(()=>window.SPFramework?.ready);
 const app=window.SPFramework;app.registerEditorAdapter({mount(){return {update(){},destroy(){},setReadOnly(){}};}});
 return {app,dom,$:id=>document.getElementById(id),cleanup:async()=>{await app.home();app.store.close();dom.window.close();}};
}
function captureDownload(dom){
 const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;let blob,name;
 URL.createObjectURL=value=>{blob=value;return 'blob:captured';};URL.revokeObjectURL=()=>{};
 dom.window.HTMLAnchorElement.prototype.click=function(){name=this.download;};
 return {get blob(){return blob;},get name(){return name;},restore(){URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;}};
}

test('actual latest JSON backup imports as an independent project, survives Home reopen, and preserves unknown fields/history',async()=>{
 const {app,dom,$,cleanup}=await setup(),download=captureDownload(dom);
 try{
  const source=doc('Original');source.unknownRoot={future:['kept']};source.metadata.author={name:'A'};source.metadata.spImport={vendor:'previous import'};source.extensions.custom={opaque:true};
  await app.store.create(source);await app.openProject(source.id);
  titleEdit(app,'Latest unsaved');app.edit([{type:'updateElement',slideId:'slide',elementId:'text',properties:{text:'Latest unsaved body',futureStyle:{custom:7}}}]);
  const latest=app.getDocument();app.exportJSONBackup();assert.equal(app.getState().pending,true);
  const backup=JSON.parse(await download.blob.text());assert.deepEqual(backup,latest);assert.match(download.name,/SP-backup/);
  const copy=await app.importFile(file(await download.blob.text(),'latest-backup.json'));
  assert.notEqual(copy.id,source.id);assert.equal(copy.revision,0);assert.equal(copy.title,'Latest unsaved · 导入副本');
  for(const key of ['canvas','slides','assets','extensions','unknownRoot'])assert.deepEqual(copy[key],latest[key]);
  assert.deepEqual(copy.metadata.author,latest.metadata.author);assert.deepEqual(copy.metadata.spImport.previous,latest.metadata.spImport);
  assert.equal(copy.metadata.spImport.source.projectId,source.id);assert.equal(copy.metadata.spImport.source.revision,latest.revision);assert.equal(copy.metadata.spImport.source.fileName,'latest-backup.json');
  assert.deepEqual((await app.store.get(source.id)).document,latest);assert.equal(app.getDocument().id,copy.id);assert.match($('import-note').textContent,/latest-backup.json/);
  await app.home();assert.equal(document.querySelectorAll('.project').length,2);assert.equal(document.querySelector(`[data-project-id="${copy.id}"] .project-title`).textContent,copy.title);
  await app.openProject(copy.id);assert.deepEqual(app.getDocument(),copy);assert.match($('import-note').textContent,/独立导入/);
 }finally{download.restore();await cleanup();}
});

test('prototype v0 migrates with a durable notice; same-name imports get distinct names and never replace source IDs',async()=>{
 const {app,$,cleanup}=await setup();
 try{
  const source=doc('Repeated');source.schemaVersion=0;delete source.revision;delete source.assets;delete source.extensions;delete source.metadata;
  source.vendorPayload={unknown:['preserved']};
  const first=await app.importFile(file(source,'prototype-v0.json')),second=await app.importFile(file(source,'prototype-v0.json'));
  assert.equal(first.schemaVersion,1);assert.equal(first.title,'Repeated · 导入副本');assert.equal(second.title,'Repeated · 导入副本 2');
  assert.notEqual(first.id,second.id);assert.notEqual(first.id,source.id);assert.equal(first.metadata.spImport.source.schemaVersion,0);assert.equal(first.metadata.spImport.migrated,true);assert.deepEqual(first.vendorPayload,source.vendorPayload);
  assert.equal((await app.store.list()).length,2);assert.equal(await app.store.get(source.id),null);assert.match($('import-note').textContent,/schemaVersion 0 已迁移/);
  await app.home();await app.openProject(first.id);assert.match($('import-note').textContent,/schemaVersion 0 已迁移/);
 }finally{await cleanup();}
});

test('invalid JSON, future schema, ordinary/reference HTML and schema-specific errors create nothing and render errors only as text',async()=>{
 const {app,$,cleanup}=await setup();
 try{
  const active=await app.newProject('Keep active');titleEdit(app,'Keep unsaved');const latest=app.getDocument();
  const future=doc();future.schemaVersion=2;
  const invalid=doc();invalid.canvas.width=0;invalid.slides[0].elements[0].x='bad';invalid.slides[0].elements[0].id='<img src=x onerror=alert(1)>';
  for(const [input,pattern]of [[file('{broken'),/JSON 已损坏/],[file(future),/schemaVersion（2）/],[file('<script>alert(1)</script>','v0.32.html'),/参考文件不能导入/],[file(invalid),/canvas.width.*元素坐标/],[file('{}','other.txt'),/仅支持 SP/]]){
   await assert.rejects(app.importFile(input),pattern);assert.deepEqual(app.getDocument(),latest);assert.equal((await app.store.list()).length,1);assert.equal($('import-top').disabled,false);
  }
  assert.equal(document.querySelectorAll('#import-status img, #notification img').length,0);assert.equal(app.getDocument().id,active.id);
 }finally{await cleanup();}
});

test('HTML perimeter is inert while existing payload resource safety remains enforced',async()=>{
 const {app,$,cleanup}=await setup();
 try{
  const source=doc(),html=await exportHTML(source);
  const hostile='<script>window.importExecuted=true</script><img src="https://invalid.example/probe" onerror="window.importExecuted=true"><iframe src="https://invalid.example"></iframe>'+html;
  const imported=await app.importFile(file(hostile,'hostile-perimeter.html'));
  assert.equal(window.importExecuted,undefined);assert.equal(document.querySelectorAll('iframe, img[src^="https://"]').length,0);assert.deepEqual(imported.slides,source.slides);
  const unsafe=doc();unsafe.slides[0].elements[0]={id:'image',type:'image',x:0,y:0,w:10,h:10,src:'https://invalid.example/remote.png'};
  await assert.rejects(app.importFile(file(`<script id="sp-document" type="application/json">${JSON.stringify(unsafe)}</script>`,'unsafe.html')),/HTML 安全校验未通过/);
  await assert.rejects(app.importFile(file(html+html,'duplicate-envelope.html')),/且仅包含一个/);
  assert.equal((await app.store.list()).length,1);assert.equal($('import-go-home').hidden,true);
 }finally{await cleanup();}
});

test('read budgets check real UTF-8 bytes, reject oversized declared size before read, and cancel oversized streams',async()=>{
 let read=false;
 await assert.rejects(readImportFile({name:'large.json',size:MAX_IMPORT_BYTES+1,text:async()=>{read=true;return '{}';}}),/25 MiB/);assert.equal(read,false);
 await assert.rejects(readImportFile({name:'lying-size.json',size:1,text:async()=>'界'.repeat(Math.floor(MAX_IMPORT_BYTES/3)+1)}),/25 MiB/);
 let cancelled=false,reads=0;
 const stream=new ReadableStream({pull(controller){reads++;controller.enqueue(new Uint8Array(MAX_IMPORT_BYTES+1));},cancel(){cancelled=true;}});
 await assert.rejects(readImportFile({name:'large-stream.json',size:1,stream:()=>stream}),/25 MiB/);assert.equal(cancelled,true);assert.ok(reads<=2);
});

test('failed final save or create leaves original session intact; file selection resets on failure and retry creates one copy',async()=>{
 const {app,$,cleanup}=await setup(),save=app.store.save.bind(app.store),create=app.store.create.bind(app.store),release=app.store.release.bind(app.store);let creates=0,releases=0;const oldError=console.error;
 console.error=()=>{};
 try{
  const source=await app.newProject('Current');titleEdit(app,'Unsaved current');const latest=app.getDocument(),input=file(doc());
  app.store.create=async value=>{creates++;return create(value);};app.store.release=async value=>{releases++;return release(value);};
  app.store.save=async()=>{throw Error('quota exceeded');};
  const selection={files:[input],value:'same-file.json'};await $('file-input').onchange({target:selection});
  assert.equal(selection.value,'');assert.equal(creates,0);assert.equal(releases,0);assert.deepEqual(app.getDocument(),latest);assert.equal(app.getState().pending,true);assert.match($('import-message').textContent,/未导入.*尚未安全保存/);
  app.store.save=save;app.store.create=async()=>{throw Error('create quota');};
  await assert.rejects(app.importFile(input),/副本未保存.*create quota/);assert.deepEqual(app.getDocument(),latest);assert.equal(releases,0);assert.equal(app.getState().readOnly,false);assert.equal((await app.store.list()).length,1);
  titleEdit(app,'Still editable');app.store.create=async value=>{creates++;return create(value);};
  const copy=await app.importFile(input);assert.equal(creates,1);assert.equal(releases,1);assert.equal((await app.store.list()).length,2);assert.equal((await app.store.get(source.id)).document.title,'Still editable');assert.equal(app.getDocument().id,copy.id);
 }finally{console.error=oldError;app.store.save=save;app.store.create=create;app.store.release=release;await cleanup();}
});

test('import serializes slow reads and in-flight saves, coalesces repeated calls, blocks late edits, and honors later navigation',async()=>{
 const {app,dom,$,cleanup}=await setup(),save=app.store.save.bind(app.store),create=app.store.create.bind(app.store);
 const readGate=deferred(),saveGate=deferred(),createGate=deferred(),createEntered=deferred();let importing,saving,leaving,creates=0;const contexts=[];
 app.registerEditorAdapter({mount(context){contexts.push(context);return {update(){},destroy(){},setReadOnly(){}};}});
 try{
  const source=await app.newProject('In-flight');const stale=contexts.at(-1);
  titleEdit(app,'Revision one');app.store.save=async(value,options)=>{await saveGate.promise;return save(value,options);};saving=app.flush();titleEdit(app,'Revision two');
  app.store.create=async value=>{creates++;createEntered.resolve();await createGate.promise;return create(value);};
  const input={name:'slow.json',size:1,text:()=>readGate.promise};importing=app.importFile(input);
  assert.equal(app.importFile(input),importing);await assert.rejects(app.importFile(file(doc('Other'))),/正在导入/);assert.equal($('import-top').disabled,true);
  let picker=0;$('file-input').click=()=>picker++;$('import-top').onclick();dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'o',ctrlKey:true,cancelable:true}));assert.equal(picker,0);
  leaving=app.home();assert.equal(creates,0);readGate.resolve(JSON.stringify(doc()));await wait(()=>$('import-message').textContent.includes('保存当前项目'));
  assert.throws(()=>titleEdit(app,'Too late'),/切换/);const unload=new dom.window.Event('beforeunload',{cancelable:true});dom.window.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true);
  assert.equal(creates,0);saveGate.resolve();await createEntered.promise;await saving;assert.equal(app.getDocument().id,source.id);
  createGate.resolve();const imported=await importing;await leaving;
  assert.equal(creates,1);assert.equal((await app.store.list()).length,2);assert.equal((await app.store.get(source.id)).document.title,'Revision two');assert.equal(app.getDocument(),undefined);assert.equal($('home-view').hidden,false);assert.equal($('import-top').disabled,false);
  assert.throws(()=>stale.onEdit([{type:'updateProject',properties:{title:'Stale mutation'}}]),/失效/);await app.openProject(imported.id);assert.equal(app.getDocument().title,imported.title);
 }finally{readGate.resolve(JSON.stringify(doc()));saveGate.resolve();createGate.resolve();await saving?.catch(()=>{});await importing?.catch(()=>{});await leaving?.catch(()=>{});app.store.save=save;app.store.create=create;await cleanup();}
});

test('in-flight save failure prevents import and later retry succeeds without losing pending data',async()=>{
 const {app,cleanup}=await setup(),save=app.store.save.bind(app.store),gate=deferred();let importing,saving;
 try{
  await app.newProject('Running failure');titleEdit(app,'Retain newest');app.store.save=()=>gate.promise;
  saving=assert.rejects(app.flush(),/late failure/);importing=assert.rejects(app.importFile(file(doc())),/尚未安全保存/);
  gate.reject(new Error('late failure'));await Promise.all([saving,importing]);assert.equal((await app.store.list()).length,1);assert.equal(app.getDocument().title,'Retain newest');assert.equal(app.getState().pending,true);
  app.store.save=save;await app.importFile(file(doc()));assert.equal((await app.store.list()).length,2);
 }finally{gate.resolve();await saving?.catch(()=>{});await importing?.catch(()=>{});app.store.save=save;await cleanup();}
});

test('post-commit cleanup, lock and editor failures keep a visible durable copy and a working Home path',async()=>{
 const {app,$,cleanup}=await setup(),release=app.store.release.bind(app.store),acquire=app.store.acquire.bind(app.store);
 try{
  const original=await app.newProject('Original');titleEdit(app,'Saved before import');
  app.store.release=async()=>{throw Error('cleanup failure');};app.store.acquire=async()=>{throw Error('lock failure');};app.registerEditorAdapter({mount(){throw Error('adapter failure');}});
  const copy=await app.importFile(file(doc()));assert.equal(app.getDocument().id,copy.id);assert.equal(app.getState().readOnly,true);assert.deepEqual((await app.store.get(copy.id)).document,copy);assert.equal((await app.store.get(original.id)).document.title,'Saved before import');
  assert.match($('import-message').textContent,/自动到期.*只读.*编辑器加载失败/);assert.equal($('import-go-home').hidden,false);
  app.store.release=release;app.store.acquire=acquire;$('search').value='cannot match';await $('import-go-home').onclick();assert.equal($('search').value,'');assert.equal($('home-view').hidden,false);assert.equal(document.querySelectorAll('.project').length,2);
  app.registerEditorAdapter({mount(){return {update(){},destroy(){}};}});await app.openProject(copy.id);titleEdit(app,'Editable after reopening');await app.flush();assert.equal((await app.store.get(copy.id)).document.title,'Editable after reopening');
 }finally{app.store.release=release;app.store.acquire=acquire;await cleanup();}
});

test('unexpected activation failure identifies the already-created copy and Home reveals it without another import',async()=>{
 const {app,$,cleanup}=await setup();const note=$('import-note');
 try{
  Object.defineProperty(note,'textContent',{configurable:true,set(){throw Error('injected UI activation failure');}});
  let failed;try{await app.importFile(file(doc('Saved copy')));}catch(error){failed=error;}
  assert.equal(failed.code,'IMPORT_OPEN_FAILED');assert.ok(failed.projectId);assert.equal((await app.store.list()).length,1);
  assert.match($('import-message').textContent,/已保存到项目库.*打开失败.*无需重复导入/);assert.equal($('import-go-home').hidden,false);
  delete note.textContent;await $('import-go-home').onclick();assert.equal($('home-view').hidden,false);assert.equal(document.querySelectorAll('.project').length,1);
  await app.openProject(failed.projectId);assert.equal(app.getDocument().title,'Saved copy · 导入副本');
 }finally{delete note.textContent;await cleanup();}
});

test('real SDK MCP HTML enters app.importFile, appears in Home, stays editable, and exports preserved content',async()=>{
 const {app,dom,cleanup}=await setup(),download=captureDownload(dom),dir=await mkdtemp(path.join(tmpdir(),'sp-app-import-'));
 const client=new Client({name:'app-import-acceptance',version:'1'});
 const call=async(name,args)=>{const response=await client.callTool({name,arguments:args});assert.equal(response.isError,undefined,JSON.stringify(response));return JSON.parse(response.content[0].text);};
 try{
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('mcp/server.js'),'--project-root',dir],stderr:'pipe'}));
  await call('sp_create_project',{projectId:'sdk-import',title:'SDK → Home'});
  await call('sp_edit',{projectId:'sdk-import',expectedRevision:0,operations:[{type:'createSlide',slide:doc().slides[0]},{type:'updateProject',properties:{extensions:{sdkCustom:{kept:[1,2]}}}}]});
  await call('sp_save_export',{projectId:'sdk-import',expectedRevision:1,filename:'sdk-import.html'});
  const html=await readFile(path.join(dir,'sdk-import.html'),'utf8'),original=importHTML(html),copy=await app.importFile(file(html,'sdk-import.html'));
  assert.notEqual(copy.id,original.id);assert.deepEqual(copy.slides,original.slides);assert.deepEqual(copy.extensions,original.extensions);
  await app.home();assert.equal(document.querySelector(`[data-project-id="${copy.id}"] .project-title`).textContent,copy.title);await app.openProject(copy.id);
  app.edit([{type:'updateElement',slideId:'slide',elementId:'text',properties:{text:'Edited after real MCP import'}}]);await app.flush();await app.exportProject();
  assert.match(download.name,/\.html$/);const exported=importHTML(await download.blob.text());assert.deepEqual(exported,app.getDocument());assert.equal(exported.slides[0].elements[0].text,'Edited after real MCP import');assert.deepEqual(exported.extensions,original.extensions);
 }finally{await client.close();download.restore();await cleanup();await rm(dir,{recursive:true,force:true});}
});

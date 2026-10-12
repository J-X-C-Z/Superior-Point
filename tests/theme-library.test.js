import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {JSDOM} from 'jsdom';
import {ThemeStore} from '../storage/theme-store.js';
import {listBuiltinThemes} from '../core/builtin-themes.js';
import {createThemeRef} from '../core/theme-schema.js';
import {copyPersonalTheme,filterThemes,mountThemeLibrary,nextThemeVersion,themeIdentity,uploadLocalTheme} from '../web/theme-library.js';
const entry=(theme,source='local',accountId=null)=>({source,accountId,id:theme.id,version:theme.version,theme});
const store=()=>new ThemeStore({name:'themes-ui-test-'+crypto.randomUUID()});
test('personal copy and edits preserve builtin and immutable older revisions across reopen',async()=>{
 const original=listBuiltinThemes()[0],local=store(),copy=copyPersonalTheme(original);assert.notEqual(copy.id,original.id);assert.equal(copy.version,'1.0.0');
 const saved=await local.save(copy);const changed=structuredClone(copy);changed.name='修改名称';changed.version=nextThemeVersion(copy.version);changed.tokens.colors.accent='#123456';await local.save(changed,{expectedRevision:saved.revision});local.close();
 assert.deepEqual((await local.get(copy.id,'1.0.0')).ref.snapshot,copy);assert.equal((await local.get(copy.id)).ref.snapshot.name,'修改名称');assert.notEqual(original.tokens.colors.accent,'#123456');
 await assert.rejects(local.save({...changed,name:'旧修订写入'},{expectedRevision:saved.revision}),{code:'REVISION_CONFLICT'});
 const newest=await local.get(copy.id);await local.setDeleted(copy.id,true,{expectedRevision:newest.revision});assert.equal((await local.list()).length,0);assert.equal((await local.list({trash:true})).length,1);assert.ok((await local.get(copy.id,'1.0.0')).ref);local.close();
});
test('same id and version do not collide between local, builtin or cloud accounts; filters honor rules',()=>{
 const theme=listBuiltinThemes()[0],entries=[entry(theme,'builtin'),entry(theme),entry(theme,'cloud','a'),entry(theme,'cloud','b')];assert.equal(new Set(entries.map(themeIdentity)).size,4);
 const favorites=new Set([themeIdentity(entries[2])]);assert.deepEqual(filterThemes(entries,{source:'favorites',favorites}),[entries[2]]);assert.equal(filterThemes(entries,{query:theme.tags[0],ratio:'4:3',tag:theme.tags[0],color:theme.tokens.colors.accent}).length,4);assert.equal(filterThemes(entries,{query:'不存在'}).length,0);
});
test('upload confirms changed cloud identity and package content, preserves local and fails corrupted readback',async()=>{
 const local=store(),theme=copyPersonalTheme(listBuiltinThemes()[0]);await local.save(theme);let saved;
 const cloud={async save(raw){saved={...structuredClone(raw),id:crypto.randomUUID()};return {id:saved.id,version:saved.version};},async get(){return {id:saved.id,version:saved.version,ref:await createThemeRef(saved)};}};
 const remote=await uploadLocalTheme(entry(theme),local,cloud);assert.notEqual(remote.id,theme.id);assert.deepEqual(remote.ref.snapshot,{...theme,id:remote.id});assert.deepEqual((await local.get(theme.id)).ref.snapshot,theme);
 cloud.get=async()=>({ref:await createThemeRef({...saved,name:'损坏回读'})});await assert.rejects(uploadLocalTheme(entry(theme),local,cloud),/回读不一致/);assert.ok(await local.get(theme.id));local.close();
});
test('mounted gallery opens four rendered samples, edits a real local record, publishes an immutable new version',async()=>{
 const dom=new JSDOM('<body><main></main></body>',{url:'http://localhost'}),container=dom.window.document.querySelector('main'),local=store(),errors=[];const theme=copyPersonalTheme(listBuiltinThemes()[0],{name:'测试我的主题'});await local.save(theme);
 const mounted=mountThemeLibrary({container,localStore:local,notify:message=>errors.push(message)});await mounted.refresh();
 const source=container.querySelector('select');source.value='local';source.dispatchEvent(new dom.window.Event('change'));await mounted.refresh();assert.equal(container.querySelectorAll('.theme-card').length,1);
 container.querySelector('.theme-actions button').click();await until(()=>dom.window.document.querySelectorAll('dialog .theme-sample svg').length===4);
 const detail=dom.window.document.querySelector('dialog');assert.equal(detail.querySelectorAll('.theme-sample svg image').length,1);findButton(detail,'编辑 / 重命名').click();await until(()=>dom.window.document.querySelector('dialog form'));
 const name=dom.window.document.querySelector('dialog form input');name.value='通过表单修改';name.dispatchEvent(new dom.window.Event('input'));dom.window.document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await until(()=>!dom.window.document.querySelector('dialog'));
 const record=await local.get(theme.id);assert.equal(record.ref.snapshot.name,'通过表单修改');assert.equal(record.version,'1.0.1');assert.equal((await local.get(theme.id,'1.0.0')).ref.snapshot.name,'测试我的主题');assert.deepEqual(errors,[]);mounted.destroy();assert.equal(container.children.length,0);local.close();dom.window.close();
});
function findButton(parent,label){return [...parent.querySelectorAll('button')].find(button=>button.textContent===label);}
async function until(check){for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('UI operation did not finish');}
test('gallery JSON import verifies package before saving a new local identity and export preserves content',async()=>{
 const dom=new JSDOM('<body><main></main></body>',{url:'http://localhost'}),container=dom.window.document.querySelector('main'),local=store(),messages=[];
 const mounted=mountThemeLibrary({container,localStore:local,notify:message=>messages.push(message)});await mounted.refresh();const file=container.querySelector('input[type=file]'),original=listBuiltinThemes()[0];
 Object.defineProperty(file,'files',{configurable:true,value:[{size:1024,text:async()=>JSON.stringify(original)}]});file.dispatchEvent(new dom.window.Event('change'));await until(()=>messages.includes('主题已验证并导入为新的本地主题'));
 const records=await local.list();assert.equal(records.length,1);assert.notEqual(records[0].id,original.id);const record=await local.get(records[0].id);assert.deepEqual(record.ref.snapshot.tokens,original.tokens);
 Object.defineProperty(file,'files',{configurable:true,value:[{size:1,text:async()=>JSON.stringify({...original,schemaVersion:99})}]});file.dispatchEvent(new dom.window.Event('change'));await until(()=>messages.some(message=>message==='Theme validation failed'));assert.equal((await local.list()).length,1);
 const source=container.querySelector('select');source.value='local';await mounted.refresh();container.querySelector('.theme-actions button').click();await until(()=>dom.window.document.querySelectorAll('dialog .theme-sample').length===4);
 let exported;const create=URL.createObjectURL,revoke=URL.revokeObjectURL;URL.createObjectURL=blob=>{exported=blob;return 'blob:test';};URL.revokeObjectURL=()=>{};dom.window.HTMLAnchorElement.prototype.click=function(){};
 try{findButton(dom.window.document.querySelector('dialog'),'导出 JSON').click();await until(()=>exported);assert.deepEqual(JSON.parse(await exported.text()),record.ref.snapshot);}finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;}
 mounted.destroy();local.close();dom.window.close();
});
test('new project carries chosen ratio; reset application needs explicit second confirmation and carries project identity',async()=>{
 const dom=new JSDOM('<body><main></main></body>',{url:'http://localhost'}),container=dom.window.document.querySelector('main'),local=store(),calls=[];
 const project={id:'same-id',source:'cloud',accountId:'account-a',record:{document:{metadata:{title:'目标项目'}}}};
 const mounted=mountThemeLibrary({container,localStore:local,getProjects:async()=>({entries:[project]}),onCreate:async(theme,options)=>calls.push(['create',theme,options]),onApply:async(theme,options)=>calls.push(['apply',theme,options])});await mounted.refresh();
 container.querySelector('.theme-actions button').click();await until(()=>dom.window.document.querySelectorAll('dialog .theme-sample').length===4);let d=dom.window.document.querySelector('dialog');d.querySelector('select').value='4:3';findButton(d,'使用主题新建').click();await until(()=>calls.length===1);assert.equal(calls[0][2].ratio,'4:3');await until(()=>!dom.window.document.querySelector('dialog'));await until(()=>container.querySelector('.theme-actions button'));
 container.querySelector('.theme-actions button').click();await until(()=>dom.window.document.querySelectorAll('dialog .theme-sample').length===4);findButton(dom.window.document.querySelector('dialog'),'应用到已有项目').click();await until(()=>[...dom.window.document.querySelectorAll('dialog button')].some(b=>b.textContent==='确认应用'));d=dom.window.document.querySelector('dialog');d.querySelectorAll('select')[1].value='reset';findButton(d,'确认应用').click();await until(()=>dom.window.document.querySelector('dialog h2')?.textContent==='确认重置手工样式');assert.equal(calls.length,1);findButton(dom.window.document.querySelector('dialog'),'确认重置并应用').click();await until(()=>calls.length===2);assert.equal(calls[1][2].mode,'reset');assert.deepEqual(calls[1][2].projectRef,project);mounted.destroy();local.close();dom.window.close();
});

test('scoped UI requires a fresh dry-run and binds confirmation to its revision',async()=>{
 const dom=new JSDOM('<body><main></main></body>',{url:'http://localhost'}),container=dom.window.document.querySelector('main'),local=store(),calls=[],previews=[];
 const doc={revision:7,slides:[{id:'one',title:'封面'},{id:'two',title:'正文'}]},project={id:'project',source:'local',title:'测试文稿'};
 const mounted=mountThemeLibrary({container,localStore:local,getProjects:async()=>[project],onReadProject:async()=>({document:doc}),onPreview:async(theme,options)=>{previews.push(options);return {revision:7,plan:{changes:[{slideId:'two',property:'color',before:'#000000',after:'#123456'}],summary:{preservedOverrides:2},limitations:['保留内容'],motionDiagnostics:[{renderer:'pptx',status:'refused',message:'退出动效保留意图并降级'}]}};},onApply:async(theme,options)=>{calls.push(options);return true;}});
 await mounted.refresh();container.querySelector('.theme-actions button').click();await until(()=>dom.window.document.querySelectorAll('dialog .theme-sample').length===4);findButton(dom.window.document.querySelector('dialog'),'应用到已有项目').click();await until(()=>dom.window.document.querySelectorAll('.theme-page-selection input').length===2);
 const d=dom.window.document.querySelector('dialog'),scope=d.querySelectorAll('select')[2],confirm=findButton(d,'确认应用');assert.equal(confirm.disabled,true);
 scope.value='selected';scope.dispatchEvent(new dom.window.Event('change'));let choices=d.querySelectorAll('.theme-page-selection input');choices[0].checked=false;choices[1].checked=true;choices[1].dispatchEvent(new dom.window.Event('change'));
 findButton(d,'预览变更').click();await until(()=>!confirm.disabled);assert.deepEqual(previews[0].slideIds,['two']);assert.match(d.querySelector('.theme-status').textContent,/保留 2 项手工覆盖/);assert.match(d.textContent,/PPTX：支持 0 · 降级 0 · 不支持 1/);assert.equal(calls.length,0);
 scope.value='all';scope.dispatchEvent(new dom.window.Event('change'));assert.equal(confirm.disabled,true);findButton(d,'预览变更').click();await until(()=>!confirm.disabled);confirm.click();await until(()=>calls.length===1);assert.equal(calls[0].expectedRevision,7);assert.equal(calls[0].slideIds,undefined);
 mounted.destroy();local.close();dom.window.close();
});

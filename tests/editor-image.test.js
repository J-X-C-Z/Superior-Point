import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createDocument} from '../core/document-core.js';
import {canonicalToEditor,editorToCanonical} from '../adapters/editor-v038-model.js';
import {exportEditorHTML} from '../io/editor-export.js';
import {importHTML} from '../io/html.js';
import {candidateHarness} from './helpers/editor-candidate.js';
import {editorCandidateSourceSHA256} from '../vendor/editor-integrated.js';

const png=await readFile(new URL('./fixtures/images/tiny.png',import.meta.url));
const source='data:image/png;base64,'+png.toString('base64');
function fixture({image=false}={}){
 const doc=createDocument({id:'picture-tests',title:'Picture tests',slides:[
  {id:'s1',elements:[{id:'t1',type:'text',x:10,y:10,w:300,h:50,text:'First page'},...(image?[{id:'image-1',type:'image',x:40,y:70,w:180,h:120,src:source,crop:[.1,.2,.05,0],rotation:17,opacity:.7,fit:'cover',name:'Original'}]:[])],animations:[]},
  {id:'s2',elements:[{id:'t2',type:'text',x:10,y:10,w:300,h:50,text:'Second page'}],animations:[]}
 ]});
 return {doc,project:canonicalToEditor(doc)};
}
const snapshot=h=>JSON.parse(JSON.stringify(h.window.SPEditorCandidate.getSnapshot()));
const edits=h=>h.messages.filter(m=>m.type==='edit');
const images=(p,id='s1')=>p.slides.find(s=>s.id===id)?.objects.filter(o=>o.type==='image')||[];
const text=h=>h.window.document.getElementById('toast-container').textContent;
const file=(h,name='valid.png')=>new h.window.File([png],name,{type:'image/png'});
function decodeControl(h){
 const jobs=[];
 h.window.Image=class{
  naturalWidth=0;naturalHeight=0;
  decode(){return new Promise((resolve,reject)=>jobs.push({image:this,resolve:(width=3,height=2)=>{this.naturalWidth=width;this.naturalHeight=height;resolve();},reject}));}
 };
 return jobs;
}
function upload(h,files,id='picture-upload'){
 const input=h.window.document.getElementById(id);Object.defineProperty(input,'files',{configurable:true,value:files});
 input.dispatchEvent(new h.window.Event('change',{bubbles:true}));
}
function drop(h,f){
 const event=new h.window.MouseEvent('drop',{bubbles:true,cancelable:true,clientX:200,clientY:160});
 Object.defineProperty(event,'dataTransfer',{value:{files:[f]}});h.window.document.getElementById('canvas-zone').dispatchEvent(event);
}
function paste(h,f){
 const event=new h.window.Event('paste',{bubbles:true,cancelable:true});
 Object.defineProperty(event,'clipboardData',{value:{items:[{type:'image/png',kind:'file',getAsFile:()=>f}],files:[f],getData:()=>''}});
 h.window.document.dispatchEvent(event);
}
function select(h,id){
 const node=h.window.document.querySelector('#stage-mount [data-id="'+id+'"]');assert.ok(node);
 node.dispatchEvent(new h.window.MouseEvent('pointerdown',{bubbles:true,button:0}));
 h.window.document.dispatchEvent(new h.window.MouseEvent('pointerup',{bubbles:true,button:0}));
}
function switchPage(h,id){h.window.document.querySelector('.thumb-row[data-slide-id="'+id+'"]').click();}
function action(h,name){
 const b=h.window.document.createElement('button');b.dataset.action=name;h.window.document.body.append(b);b.click();b.remove();
}
function ack(h,message=edits(h).at(-1),revision=1){h.send('ack',{sequence:message.sequence,revision,epoch:1,history:{canUndo:true,canRedo:false}});}
async function cancelled(h){await h.until(()=>/取消|失效/.test(text(h)));await h.pause(10);}

test('image candidate build preserves its declared trusted source SHA and records only explicit patches',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../vendor/editor-integrated.manifest.json',import.meta.url)));
 const raw=await readFile(new URL('../vendor/'+manifest.source,import.meta.url));
 assert.equal(createHash('sha256').update(raw).digest('hex'),editorCandidateSourceSHA256);
 assert.equal(manifest.sourceSHA256,editorCandidateSourceSHA256);
 for(const label of ['guard async picture insertion','guard async picture replacement','stage picture batch before one commit'])assert.ok(manifest.patches.includes(label));
});

test('jsdom image simulation: SVG insertion and replacement are rejected without edit or recovery',async()=>{
 const {project}=fixture({image:true}),h=await candidateHarness(project);try{
  const jobs=decodeControl(h),svg=()=>new h.window.File(['<svg xmlns="http://www.w3.org/2000/svg"/>'],'unsupported.svg',{type:'image/svg+xml'});
  upload(h,[svg()]);await h.until(()=>text(h).includes('暂不支持 SVG'));
  select(h,'image-1');upload(h,[svg()],'replace-picture-upload');await h.until(()=>text(h).includes('更换图片失败'));
  assert.equal(jobs.length,0);assert.deepEqual(snapshot(h),project);assert.equal(edits(h).length,0);assert.equal(h.messages.filter(m=>m.type==='recovery').length,0);
 }finally{h.close();}
});

test('jsdom image simulation: declared and actual image bytes share the canonical 16 MiB limit',async()=>{
 const {project}=fixture(),h=await candidateHarness(project);try{
  const jobs=decodeControl(h),large=file(h);Object.defineProperty(large,'size',{value:16*1024*1024+1});
  drop(h,large);await h.until(()=>text(h).includes('16 MiB'));
  h.window.FileReader=class{readAsDataURL(){this.result='data:image/png;base64,'+'A'.repeat(4*Math.ceil((16*1024*1024+1)/3));h.window.setTimeout(()=>this.onload(),0);}};
  drop(h,file(h));await h.until(()=>text(h).includes('byte limit'));
  assert.equal(jobs.length,0);assert.deepEqual(snapshot(h),project);assert.equal(edits(h).length,0);assert.equal(h.messages.filter(m=>m.type==='recovery').length,0);
 }finally{h.close();}
});

test('jsdom image simulation: corrupt actual raster bytes are rejected before codec work',async()=>{
 const {project}=fixture(),h=await candidateHarness(project);try{
  const jobs=decodeControl(h);drop(h,new h.window.File(['not PNG bytes'],'fake.png',{type:'image/png'}));
  await h.until(()=>text(h).includes('Invalid embedded image'));assert.equal(jobs.length,0);assert.deepEqual(snapshot(h),project);assert.equal(edits(h).length,0);
 }finally{h.close();}
});

test('jsdom image simulation: valid single drop commits once, preserves ratio and survives trusted HTML reimport',async()=>{
 const {doc,project}=fixture(),h=await candidateHarness(project);try{
  const jobs=decodeControl(h);drop(h,file(h));await h.until(()=>jobs.length===1);assert.deepEqual(snapshot(h),project);
  jobs[0].resolve();await h.until(()=>edits(h).length===1);const p=snapshot(h),image=images(p)[0];
  assert.ok(image);assert.ok(Math.abs(image.w/image.h-1.5)<.001);assert.equal(image.name,'valid.png');assert.equal(image.alt,'valid.png');assert.equal(image.src,source);
  ack(h);await h.window.SPEditorCandidate.flush();assert.equal(edits(h).length,1);
  const canonical=editorToCanonical(p,{baseDocument:doc}),html=await exportEditorHTML(canonical,h.window.SPEditorCandidate.renderLegacyHTML(),{domDocument:h.window.document});
  assert.deepEqual(importHTML(html),canonical);assert.deepEqual(h.storage(),{reads:0,writes:0,opens:0});
 }finally{h.close();}
});

test('jsdom image simulation: corrupt decode creates no object or commit and retry can succeed',async()=>{
 const {project}=fixture(),h=await candidateHarness(project);try{
  const jobs=decodeControl(h);drop(h,file(h,'broken.png'));await h.until(()=>jobs.length===1);jobs[0].reject(Error('bad image data'));
  await h.until(()=>text(h).includes('bad image data'));assert.deepEqual(snapshot(h),project);assert.equal(edits(h).length,0);assert.doesNotMatch(text(h),/已插入/);
  drop(h,file(h));await h.until(()=>jobs.length===2);jobs[1].resolve();await h.until(()=>edits(h).length===1);assert.equal(images(snapshot(h)).length,1);
 }finally{h.close();}
});

test('jsdom image simulation: zero dimensions fail before model mutation',async()=>{
 const {project}=fixture(),h=await candidateHarness(project);try{
  const jobs=decodeControl(h);upload(h,[file(h)]);await h.until(()=>jobs.length===1);jobs[0].resolve(0,2);
  await h.until(()=>text(h).includes('尺寸无效'));assert.deepEqual(snapshot(h),project);assert.equal(edits(h).length,0);assert.doesNotMatch(text(h),/已插入/);
 }finally{h.close();}
});

test('jsdom image simulation: file read errors and unsupported MIME never decode or mutate',async()=>{
 const {project}=fixture(),h=await candidateHarness(project);try{
  const jobs=decodeControl(h);h.window.FileReader=class{readAsDataURL(){h.window.setTimeout(()=>this.onerror(),0);}};
  upload(h,[file(h)]);await h.until(()=>text(h).includes('图片读取失败'));
  upload(h,[new h.window.File(['bad'],'bad.txt',{type:'text/plain'})]);await h.until(()=>text(h).includes('仅支持'));
  assert.equal(jobs.length,0);assert.deepEqual(snapshot(h),project);assert.equal(edits(h).length,0);
 }finally{h.close();}
});

test('jsdom image simulation: lost write access during FileReader prevents decode and all writes',async()=>{
 const {project}=fixture(),h=await candidateHarness(project);try{
  const jobs=decodeControl(h),readers=[];h.window.FileReader=class{readAsDataURL(){readers.push(this);}};
  drop(h,file(h));await h.until(()=>readers.length===1);h.send('readOnly',{value:true});readers[0].result=source;readers[0].onload();
  await cancelled(h);assert.equal(jobs.length,0);assert.deepEqual(snapshot(h),project);assert.equal(edits(h).length,0);
 }finally{h.close();}
});

test('jsdom image simulation: delayed clipboard image stays on its original page without changing new-page selection',async()=>{
 const {project}=fixture(),h=await candidateHarness(project);try{
  const jobs=decodeControl(h);paste(h,file(h));await h.until(()=>jobs.length===1);switchPage(h,'s2');select(h,'t2');
  jobs[0].resolve();await h.until(()=>edits(h).length===1);const p=snapshot(h);assert.equal(images(p,'s1').length,1);assert.equal(images(p,'s2').length,0);
  assert.ok(h.window.document.querySelector('#stage-mount [data-id="t2"].selected'));assert.match(h.window.document.getElementById('page-crumb').textContent,/2 \/ 2/);
 }finally{h.close();}
});

test('jsdom image simulation: mixed batch stages all images and commits once to the initial page',async()=>{
 const {project}=fixture(),h=await candidateHarness(project);try{
  const jobs=decodeControl(h);upload(h,[file(h,'one.png'),file(h,'broken.png'),file(h,'three.png')]);await h.until(()=>jobs.length===1);
  jobs[0].resolve();await h.until(()=>jobs.length===2);assert.deepEqual(snapshot(h),project);assert.equal(edits(h).length,0);
  switchPage(h,'s2');select(h,'t2');jobs[1].reject(Error('corrupt'));await h.until(()=>jobs.length===3);
  assert.deepEqual(snapshot(h),project);jobs[2].resolve();await h.until(()=>edits(h).length===1);
  assert.deepEqual(images(snapshot(h),'s1').map(o=>o.name),['one.png','three.png']);assert.equal(images(snapshot(h),'s2').length,0);
  assert.ok(h.window.document.querySelector('#stage-mount [data-id="t2"].selected'));assert.match(text(h),/已插入 2 张图片；1 张未导入/);
 }finally{h.close();}
});

test('jsdom image simulation: losing write access after the first staged batch image discards the whole batch',async()=>{
 const {project}=fixture(),h=await candidateHarness(project);try{
  const jobs=decodeControl(h);upload(h,[file(h,'one.png'),file(h,'two.png')]);await h.until(()=>jobs.length===1);jobs[0].resolve();await h.until(()=>jobs.length===2);
  h.send('readOnly',{value:true});jobs[1].resolve();await cancelled(h);assert.deepEqual(snapshot(h),project);assert.equal(edits(h).length,0);assert.doesNotMatch(text(h),/已插入/);
 }finally{h.close();}
});

test('jsdom image simulation: authoritative project update cancels an older decoding operation',async()=>{
 const {project}=fixture(),h=await candidateHarness(project);try{
  const jobs=decodeControl(h);drop(h,file(h));await h.until(()=>jobs.length===1);
  const next={...project,name:'New authoritative project'};h.send('update',{project:next,revision:4,epoch:2,readOnly:false});jobs[0].resolve();await cancelled(h);
  assert.deepEqual(snapshot(h),next);assert.equal(edits(h).length,0);
 }finally{h.close();}
});

test('jsdom image simulation: removing the original page prevents a late insertion into its successor',async()=>{
 const {project}=fixture(),h=await candidateHarness(project);try{
  const jobs=decodeControl(h);drop(h,file(h));await h.until(()=>jobs.length===1);action(h,'delete-slide');assert.equal(edits(h).length,1);ack(h);
  const afterDelete=snapshot(h);assert.equal(afterDelete.slides[0].id,'s2');jobs[0].resolve();await cancelled(h);
  assert.deepEqual(snapshot(h),afterDelete);assert.equal(edits(h).length,1);
 }finally{h.close();}
});

test('jsdom image simulation: rejected edit recovery survives a late decode without baseline reset',async()=>{
 const {project}=fixture(),h=await candidateHarness(project);try{
  const jobs=decodeControl(h);drop(h,file(h));await h.until(()=>jobs.length===1);
  const title=h.window.document.getElementById('document-title');title.value='Uncommitted recovery title';title.dispatchEvent(new h.window.Event('change',{bubbles:true}));const edit=edits(h)[0];
  h.send('reject',{project,revision:5,epoch:2,sequence:edit.sequence,error:'Concurrent revision',readOnly:true});
  const recovery=snapshot(h),message=JSON.stringify(h.messages.findLast(m=>m.type==='recovery'));assert.equal(recovery.name,'Uncommitted recovery title');
  jobs[0].resolve();await cancelled(h);assert.deepEqual(snapshot(h),recovery);assert.equal(JSON.stringify(h.messages.findLast(m=>m.type==='recovery')),message);assert.equal(edits(h).length,1);
  await assert.rejects(h.window.SPEditorCandidate.flush(),/Concurrent revision/);
 }finally{h.close();}
});

test('jsdom image simulation: disposed editor cancels pending image callbacks',async()=>{
 const {project}=fixture(),h=await candidateHarness(project);try{
  const jobs=decodeControl(h);drop(h,file(h));await h.until(()=>jobs.length===1);h.send('dispose');jobs[0].resolve();await cancelled(h);
  assert.deepEqual(snapshot(h),project);assert.equal(edits(h).length,0);
 }finally{h.close();}
});

test('jsdom image simulation: same-page insertion preserves text typed while decoding in one transaction',async()=>{
 const {project}=fixture(),h=await candidateHarness(project);try{
  const jobs=decodeControl(h);drop(h,file(h));await h.until(()=>jobs.length===1);
  h.window.document.querySelector('#stage-mount [data-id="t1"]').dispatchEvent(new h.window.MouseEvent('dblclick',{bubbles:true}));
  h.window.document.querySelector('#stage-mount [data-id="t1"] .obj-text').textContent='Last typed text';jobs[0].resolve();await h.until(()=>edits(h).length===1);
  assert.equal(snapshot(h).slides[0].objects.find(o=>o.id==='t1').text,'Last typed text');assert.equal(images(snapshot(h)).length,1);
 }finally{h.close();}
});

test('jsdom image simulation: delayed replacement stays on the original image and preserves geometry/crop/style',async()=>{
 const {project}=fixture({image:true}),h=await candidateHarness(project);try{
  const jobs=decodeControl(h);select(h,'image-1');upload(h,[file(h,'replacement.png')],'replace-picture-upload');await h.until(()=>jobs.length===1);
  switchPage(h,'s2');select(h,'t2');jobs[0].resolve(30,20);await h.until(()=>edits(h).length===1);const replaced=images(snapshot(h))[0],original=images(project)[0];
  for(const key of ['id','x','y','w','h','crop','rotation','opacity','fit'])assert.deepEqual(replaced[key],original[key],key);
  assert.equal(replaced.name,'replacement.png');assert.equal(replaced.alt,'replacement.png');assert.ok(h.window.document.querySelector('#stage-mount [data-id="t2"].selected'));
 }finally{h.close();}
});

test('jsdom image simulation: replacement decode failure leaves the original image untouched',async()=>{
 const {project}=fixture({image:true}),h=await candidateHarness(project);try{
  const jobs=decodeControl(h);select(h,'image-1');upload(h,[file(h,'broken.png')],'replace-picture-upload');await h.until(()=>jobs.length===1);jobs[0].reject(Error('bad replacement'));
  await h.until(()=>text(h).includes('bad replacement'));assert.deepEqual(snapshot(h),project);assert.equal(edits(h).length,0);assert.doesNotMatch(text(h),/已更换/);
 }finally{h.close();}
});

test('jsdom image simulation: replacement after lock loss does not overwrite recovery data',async()=>{
 const {project}=fixture({image:true}),h=await candidateHarness(project);try{
  const jobs=decodeControl(h);select(h,'image-1');upload(h,[file(h,'late.png')],'replace-picture-upload');await h.until(()=>jobs.length===1);
  const notes=h.window.document.getElementById('slide-notes');notes.value='Unsent recovery notes';notes.dispatchEvent(new h.window.Event('input',{bubbles:true}));
  h.send('readOnly',{value:true});const recovery=snapshot(h);assert.equal(recovery.slides[0].notes,'Unsent recovery notes');jobs[0].resolve();await cancelled(h);
  assert.deepEqual(snapshot(h),recovery);assert.equal(edits(h).length,0);await assert.rejects(h.window.SPEditorCandidate.flush(),/写入权/);
 }finally{h.close();}
});

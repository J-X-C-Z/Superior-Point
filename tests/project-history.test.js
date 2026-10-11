import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {diffProjectDocuments,mountProjectHistory} from '../web/project-history.js';

const document=(revision,slides,title='Demo',theme='Theme A')=>({id:'project-1',revision,title,extensions:{theme:{ref:{snapshot:{name:theme},hash:'hash'}}},slides});
const slide=(id,title,elements=[],notes='')=>({id,title,elements,notes});
const element=(id,value)=>({id,type:'text',text:value});
const metadata=revision=>({revision,title:`Demo r${revision}`,source:'browser',createdAt:`2026-01-0${revision}T00:00:00Z`,slideCount:1});
const wait=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,0));}throw new Error('wait timed out');};

test('history diff compares project, theme, slide and element content by ID, including notes and page titles',()=>{
 const current=document(4,[slide('same','Old page',[element('edited','before'),element('removed','gone')],'old notes'),slide('deleted','Deleted',[element('gone','x')])],'Before','Theme A');
 const historical=document(2,[slide('same','Restored page',[element('edited','after'),element('added','new')],'new notes'),slide('added-page','New page')],'After','Theme B');
 const diff=diffProjectDocuments(current,historical);
 assert.equal(diff.titleChanged,true);assert.equal(diff.themeChanged,true);assert.equal(diff.notesChanged,true);assert.equal(diff.slideOrderChanged,true);
 assert.equal(diff.counts.slides.added,1);assert.equal(diff.counts.slides.removed,1);assert.equal(diff.counts.slides.modified,1);
 assert.equal(diff.counts.elements.added,1);assert.equal(diff.counts.elements.removed,2);assert.equal(diff.counts.elements.modified,1);
 assert.deepEqual(diff.slides[0].elements.map(change=>[change.id,change.status]),[['edited','modified'],['removed','removed'],['added','added']]);
});

test('cloud history dialog reads scoped endpoints, previews, and retries a timed out restore with the same CAS identity',async()=>{
 const dom=new JSDOM('<main></main>',{url:'https://sp.example.test/app'}),api={user:{id:'owner'},calls:[],async request(path){this.calls.push(path);if(path.endsWith('/revisions'))return [metadata(2),metadata(4)];if(path.endsWith('/document'))return document(4,[slide('s1','Current',[element('e1','now')])]);if(path.endsWith('/revisions/2'))return document(2,[slide('s1','Past',[element('e1','then'),element('e2','added')])]);throw new Error('unexpected '+path);}};
 let restored=[],first=true,notices=[];const root=dom.window.document.querySelector('main'),history=mountProjectHistory({document:dom.window.document,api,projectRef:{source:'cloud',projectId:'project-1',accountId:'owner'},notify:(...args)=>notices.push(args),onRestore:async request=>{restored.push({...request});if(first){first=false;throw Object.assign(new Error('timeout'),{code:'TIMEOUT'});}}});
 try{
  assert.equal(history.open(),true);await wait(()=>root.querySelectorAll('.project-history-version').length===2);
  assert.deepEqual(api.calls,['/projects/project-1/revisions','/projects/project-1/document']);
  root.querySelectorAll('.project-history-version')[1].click();await wait(()=>root.querySelector('.project-history-preview')?.textContent.includes('added：新增'));
  assert.match(root.querySelector('.project-history-preview').textContent,/Current → Past/);
  root.querySelector('.project-history-actions button:last-child').click();await wait(()=>root.querySelector('[role=status]').textContent.includes('避免重复恢复'));
  assert.equal(root.querySelector('dialog').hasAttribute('open'),true);root.querySelector('.project-history-actions button:last-child').click();await wait(()=>!root.querySelector('dialog').hasAttribute('open'));
  assert.equal(restored.length,2);assert.deepEqual(restored[1],restored[0]);assert.equal(restored[0].revision,2);assert.equal(restored[0].expectedRevision,4);assert.match(restored[0].clientMutationId,/^[0-9a-f-]{36}$/);assert.equal(notices.length,1);
 }finally{history.destroy();dom.window.close();}
});

test('revision conflict requires refresh before another restore and retains access checks',async()=>{
 const dom=new JSDOM('<main></main>'),api={user:{id:'owner'},async request(path){if(path.endsWith('/revisions'))return [metadata(2)];if(path.endsWith('/document'))return document(4,[slide('s','Now')]);if(path.endsWith('/revisions/2'))return document(2,[slide('s','Then')]);throw new Error(path);}};
 let attempts=0;const root=dom.window.document.querySelector('main'),history=mountProjectHistory({document:dom.window.document,api,projectRef:{source:'cloud',id:'project-1',accountId:'owner'},onRestore:async()=>{attempts++;throw Object.assign(new Error('conflict'),{code:'REVISION_CONFLICT'});}});
 try{
  assert.equal(history.open(),true);await wait(()=>root.querySelector('.project-history-version'));root.querySelector('.project-history-version').click();await wait(()=>root.querySelector('.project-history-preview').hidden===false);root.querySelector('.project-history-actions button:last-child').click();await wait(()=>root.querySelector('[role=status]').textContent.includes('请刷新'));
  root.querySelector('.project-history-version').click();assert.equal(attempts,1);root.querySelector('.project-history-actions button:first-child').click();await wait(()=>root.querySelector('.project-history-version'));
  api.user={id:'other'};assert.equal(history.open(),false);assert.equal(root.querySelector('dialog').hasAttribute('open'),false);assert.equal(root.querySelector('.project-history-list').textContent,'');
 }finally{history.destroy();dom.window.close();}
});

test('account change during a pending history read discards and clears the old account response',async()=>{
 const dom=new JSDOM('<main></main>');let release;const delayed=new Promise(resolve=>{release=resolve;}),api={user:{id:'owner'},async request(path){if(path.endsWith('/revisions'))await delayed;if(path.endsWith('/revisions'))return [metadata(2)];if(path.endsWith('/document'))return document(4,[slide('s','Private old account')]);throw new Error(path);}};
 const root=dom.window.document.querySelector('main'),history=mountProjectHistory({document:dom.window.document,api,projectRef:{source:'cloud',projectId:'project-1',accountId:'owner'},onRestore:async()=>{}});
 try{history.open();api.user={id:'other'};release();await wait(()=>!root.querySelector('dialog').hasAttribute('open'));assert.equal(root.querySelector('.project-history-list').textContent,'');assert.doesNotMatch(root.querySelector('dialog').textContent,/Private old account|Demo r2/);}finally{history.destroy();dom.window.close();}
});

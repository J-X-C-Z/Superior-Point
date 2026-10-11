import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {initCloudWorkspace} from '../web/cloud-workspace.js';

test('Agent Center is an accessible workspace dialog, closes by keyboard, and leaves the editor', async()=>{
 const dom=new JSDOM('<main><header></header><section id="workspace-view"></section></main>',{url:'https://sp.example.test/app'});
 const {document}=dom.window;
 globalThis.window=dom.window;globalThis.document=document;
 try{
  const workspace=initCloudWorkspace({getStore:()=>({storage:'local'}),getLocalStore:()=>({storage:'local'}),switchStore:async()=>{},openProject:async()=>{},refreshProjects:async()=>{},notify:()=>{}});
  workspace.workspace(false);
  const entry=document.querySelector('#agent-center-trigger'),center=document.querySelector('#agent-center');
  assert.equal(center.parentElement.id,'');
  assert.notEqual(center.closest('#account-menu'),center);
  assert.equal(entry.textContent,'Agent 接入');
  assert.equal(center.getAttribute('aria-modal'),'true');
  assert.equal(center.getAttribute('aria-labelledby'),'agent-center-title');
  assert.match(center.textContent,/① 创建令牌/);
  assert.match(center.textContent,/② 安装 Bridge/);
  assert.match(center.textContent,/③ 配置客户端/);
  assert.match(center.textContent,/④ 测试连接/);
  assert.match(center.textContent,/⑤ 使用与撤销/);
  entry.click();
  assert.equal(center.hasAttribute('open'),true);
  assert.equal(entry.getAttribute('aria-expanded'),'true');
  assert.equal(document.activeElement,center.querySelector('[aria-label="关闭 Agent 接入中心"]'));
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(center.hasAttribute('open'),false);
  assert.equal(entry.getAttribute('aria-expanded'),'false');
  assert.equal(document.activeElement,entry);
  entry.click();document.body.classList.add('editor-open');workspace.workspace(false);
  assert.equal(center.hasAttribute('open'),false);
  assert.equal(entry.hidden,true);
 }finally{dom.window.close();delete globalThis.window;delete globalThis.document;}
});

test('Agent Center and rename feedback styles fit narrow screens and retain horizontal code access',async()=>{
 const css=await readFile(new URL('../web/style.css',import.meta.url),'utf8');
 assert.match(css,/\.agent-center\{width:min\(1080px,calc\(100vw - 32px\)\)/);
 assert.match(css,/@media\(max-width:660px\)[\s\S]*?\.agent-center\{width:calc\(100vw - 20px\)/);
 assert.match(css,/\.agent-guide-example pre\{[^}]*overflow:auto/);
 assert.match(css,/\.project-title-input/);
 assert.match(css,/\.project-rename-status/);
});

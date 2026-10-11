import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {openShareCenter} from '../web/share-center.js';
import {openStorageUsage} from '../web/storage-usage.js';
test('owner share center uses service active state and displays no capability in retained rows',async()=>{
 const dom=new JSDOM('<body><button>Previous</button></body>'),api={user:{id:'owner'},request:async()=>[{id:'share',revision:3,expiresAt:new Date(Date.now()+10000).toISOString(),active:false,revokedAt:null}]};
 try{const center=await openShareCenter({api,accountId:'owner',projectId:'project',document:dom.window.document});assert.match(dom.window.document.body.textContent,/暂不可用/);assert.doesNotMatch(dom.window.document.body.textContent,/sp_share_/);center.close();assert.equal(dom.window.document.querySelector('dialog'),null);}finally{dom.window.close();}
});
test('storage center reports retained history and warning without accepting stale account results',async()=>{
 const dom=new JSDOM('<body></body>');let resolve;const api={user:{id:'owner'},request:()=>new Promise(done=>{resolve=done;})};
 try{const pending=openStorageUsage({api,document:dom.window.document});api.user={id:'other'};resolve({usage:{totalBytes:999,activeProjects:1},limits:{maxBytes:1000,maxProjects:100}});const center=await pending;assert.match(dom.window.document.body.textContent,/账号已变更/);assert.doesNotMatch(dom.window.document.body.textContent,/0.9 KiB/);center.close();}finally{dom.window.close();}
});

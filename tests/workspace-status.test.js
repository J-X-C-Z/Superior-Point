import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceLibrary} from '../storage/workspace-library.js';
test('upload mapping and recovery status use account and source revision, even offline',async()=>{
 const localStore={list:async()=>[{id:'a',document:{revision:2}},{id:'b',document:{revision:3}},{id:'c',document:{revision:0}}]};
 const cloud={accountId:'u',api:{user:{id:'u'}},list:async()=>[{id:'remote',document:{revision:4}}],drafts:{list:async()=>[{accountId:'u',projectId:'remote'}],migrations:async()=>[{sourceProjectId:'a',sourceRevision:2,cloudProjectId:'remote'},{sourceProjectId:'b',sourceRevision:2,cloudProjectId:'remote2'}]}};
 const library=new WorkspaceLibrary({localStore,getCloudStore:()=>cloud});let result=await library.list();
 assert.deepEqual(result.entries.map(entry=>entry.syncState),['uploaded','local-changed','local','cloud']);assert.equal(result.entries[3].hasDraft,true);assert.equal(result.drafts.length,1);
 cloud.list=async()=>{throw Error('offline');};result=await library.list();assert.equal(result.entries.length,3);assert.equal(result.entries[0].syncState,'uploaded');assert.equal(result.drafts.length,1);assert.match(result.cloudError.message,/offline/);
 cloud.api.user=null;result=await library.list();assert.equal(result.drafts.length,0);assert.equal(result.entries[0].syncState,'local');assert.equal(result.cloudError.code,'ACCOUNT_CHANGED');
});

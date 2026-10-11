import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceLibrary} from '../storage/workspace-library.js';

const record=(id,title)=>({id,document:{id,title}});
function setup(){const localStore={async list(){return [record('shared','Local')];}},cloud={accountId:'account-a',api:{user:{id:'account-a'}},async list(){return [record('shared','Cloud')];}};let current=cloud;return {localStore,cloud,library:new WorkspaceLibrary({localStore,getCloudStore:()=>current}),set current(value){current=value;}};}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}

test('same project IDs remain distinct and route mutations to their original stores',async()=>{
 const {localStore,cloud,library}=setup(),options={trash:true};let localOptions,cloudOptions;
 localStore.list=async value=>{localOptions=value;return [record('shared','Local')];};cloud.list=async value=>{cloudOptions=value;return [record('shared','Cloud')];};
 const {entries,cloudError}=await library.list(options);assert.equal(cloudError,null);assert.equal(entries.length,2);assert.deepEqual(entries.map(({source,id,accountId})=>({source,id,accountId})),[{source:'local',id:'shared',accountId:null},{source:'cloud',id:'shared',accountId:'account-a'}]);assert.equal(library.storeFor(entries[0]),localStore);assert.equal(library.storeFor(entries[1]),cloud);assert.equal(localOptions,options);assert.equal(cloudOptions,options);
 assert.throws(()=>library.storeFor({source:'unknown'}),TypeError);
});

test('logged out and offline listings preserve local entries and expose cloud failures',async()=>{
 const context=setup();const failure=Error('offline');context.cloud.list=async()=>{throw failure;};let result=await context.library.list();assert.deepEqual(result.entries.map(entry=>entry.source),['local']);assert.equal(result.cloudError,failure);
 context.current=null;result=await context.library.list();assert.equal(result.entries.length,1);assert.equal(result.cloudError,null);assert.throws(()=>context.library.storeFor({source:'cloud',accountId:'account-a'}),{code:'AUTH_REQUIRED'});
});

test('account mismatch blocks cloud requests and old entries',async()=>{
 const context=setup();let requests=0;context.cloud.list=async()=>{requests++;return [];};context.cloud.api.user={id:'account-b'};
 const result=await context.library.list();assert.equal(requests,0);assert.equal(result.entries.length,1);assert.equal(result.cloudError.code,'ACCOUNT_CHANGED');assert.throws(()=>context.library.storeFor({source:'cloud',accountId:'account-a'}),{code:'ACCOUNT_CHANGED'});
 context.cloud.accountId='account-b';assert.throws(()=>context.library.storeFor({source:'cloud',accountId:'account-a'}),{code:'ACCOUNT_CHANGED'});
});

test('pending cloud results are discarded on account or store replacement, including while local listing waits',async()=>{
 for(const change of ['account','store','late-local']){
  const context=setup(),cloudPending=deferred(),localPending=deferred();context.cloud.list=()=>cloudPending.promise;if(change==='late-local')context.localStore.list=()=>localPending.promise;
  const resultPromise=context.library.list();if(change==='late-local'){cloudPending.resolve([record('old','Old account')]);await Promise.resolve();await Promise.resolve();}
  if(change==='account')context.cloud.api.user={id:'account-b'};else context.current={...context.cloud};
  cloudPending.resolve([record('old','Old account')]);localPending.resolve([record('shared','Local')]);const result=await resultPromise;assert.deepEqual(result.entries.map(entry=>entry.source),['local']);assert.equal(result.cloudError.code,'ACCOUNT_CHANGED',change);
 }
});

test('upload delegates migration without saving a second copy and rejects unconfirmed results after account changes',async()=>{
 const context=setup(),entry=(await context.library.list()).entries[0];let calls=0;
 context.cloud.migrate=async(store,id)=>{calls++;assert.equal(store,context.localStore);assert.equal(id,entry.id);return record('uploaded','Cloud upload');};
 const uploaded=await context.library.migrate(entry);assert.equal(calls,1);assert.equal(uploaded.source,'cloud');assert.equal(uploaded.accountId,'account-a');assert.equal(uploaded.id,'uploaded');await assert.rejects(context.library.migrate(uploaded),TypeError);
 const pending=deferred();context.cloud.migrate=()=>pending.promise;const upload=context.library.migrate(entry);context.cloud.api.user={id:'account-b'};pending.resolve(record('old','Old account'));await assert.rejects(upload,{code:'ACCOUNT_CHANGED'});
 await assert.rejects(context.library.migrate(entry),{code:'ACCOUNT_CHANGED'});
});

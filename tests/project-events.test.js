import test from 'node:test';
import assert from 'node:assert/strict';
import {subscribeProjectEvents} from '../web/project-events.js';
class Events{static instances=[];listeners=new Map();closed=false;constructor(url){this.url=url;Events.instances.push(this);}addEventListener(name,fn){this.listeners.set(name,fn);}emit(name,data){this.listeners.get(name)?.({data:typeof data==='string'?data:JSON.stringify(data)});}close(){this.closed=true;}}
const api=()=>({base:'/api/v1',user:{id:'account-a'}});
test('revision hints notify without modifying local document/draft; duplicates and stale/malformed events are ignored',()=>{
 const cloud=api(),document={id:'project',revision:2,title:'Unsaved typing'},draft=structuredClone(document),calls=[],states=[];
 const subscription=subscribeProjectEvents({api:cloud,projectId:'project',revision:2,onRevision:metadata=>calls.push(metadata),onState:state=>states.push(state),EventSource:Events});const source=Events.instances.at(-1);
 assert.equal(source.url,'/api/v1/projects/project/events?accountId=account-a');source.onopen();assert.deepEqual(states,['connected']);
 for(const data of ['invalid',{projectId:'other',revision:3,deleted:false},{projectId:'project',revision:'3',deleted:false},{projectId:'project',revision:1,deleted:false},{projectId:'project',revision:2,deleted:false}])source.emit('revision',data);
 assert.equal(calls.length,0);source.emit('revision',{projectId:'project',revision:4,deleted:false});source.emit('revision',{projectId:'project',revision:4,deleted:false});assert.deepEqual(calls,[{projectId:'project',revision:4,deleted:false}]);assert.deepEqual(document,draft);
 source.onerror();assert.equal(states.at(-1),'reconnecting');source.emit('revision',{projectId:'project',revision:5,deleted:true});assert.equal(calls.at(-1).deleted,true);
 subscription.close();source.emit('revision',{projectId:'project',revision:6,deleted:false});assert.equal(calls.length,2);assert.equal(source.closed,true);
});
test('account switching, revoked access and destroy stop old subscriptions; absent EventSource degrades explicitly',()=>{
 const cloud=api(),calls=[],states=[];const a=subscribeProjectEvents({api:cloud,projectId:'old',onRevision:v=>calls.push(v),onState:s=>states.push(s),EventSource:Events});const old=Events.instances.at(-1);cloud.user={id:'account-b'};old.emit('revision',{projectId:'old',revision:1,deleted:false});assert.equal(old.closed,true);assert.equal(calls.length,0);assert.equal(states.at(-1),'account-changed');a.close();
 const b=subscribeProjectEvents({api:cloud,projectId:'new',onRevision:v=>calls.push(v),onState:s=>states.push(s),EventSource:Events});const current=Events.instances.at(-1);current.emit('access-revoked',{});assert.equal(current.closed,true);assert.equal(states.at(-1),'access-revoked');b.close();
 subscribeProjectEvents({api:cloud,projectId:'new',onRevision:()=>{},onState:s=>states.push(s),EventSource:null}).close();assert.equal(states.at(-1),'unavailable');
});

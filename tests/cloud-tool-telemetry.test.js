import test from 'node:test';
import assert from 'node:assert/strict';
import {registerCloudTools} from '../mcp/cloud-tools.js';
test('completed tool result never waits for blocked telemetry',async()=>{
 const handlers=new Map();let committed=false,release;
 const blocked=new Promise(resolve=>{release=resolve;});
 registerCloudTools({registerTool:(name,options,handler)=>handlers.set(name,handler)},{request:async()=>{committed=true;return {id:'committed'};},onToolCall:()=>blocked});
 try{const result=await Promise.race([handlers.get('sp_list_projects')({}),new Promise((resolve,reject)=>setTimeout(()=>reject(Error('tool waited for telemetry')),200))]);assert.equal(committed,true);assert.deepEqual(result.structuredContent.result,{id:'committed'});}finally{release();}
});

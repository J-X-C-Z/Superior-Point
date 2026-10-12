import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {ThemeStore} from '../storage/theme-store.js';
const theme=()=>({format:'superior-point-theme',schemaVersion:1,id:'test-theme',name:'Test',version:'1.0.0',author:'SP',license:'internal',tags:['editorial'],supportedRatios:['16:9','4:3'],tokens:{colors:{background:'#ffffff',text:'#202020',accent:'#806050'},typography:{title:{fontFamily:'sans-serif',fallback:['sans-serif'],license:'system',fontSize:52,fontWeight:700},body:{fontFamily:'serif',fallback:['serif'],license:'system',fontSize:24,lineHeight:1.35}},spacing:{unit:8,pageInset:64},components:{title:{color:'#202020'}},motion:{durationMs:450,easing:'ease-out'}},layouts:['cover','section','content','data'].map(kind=>({id:kind,kind,rules:{columns:1,pageInset:64,gap:24}})),assets:[]});

test('personal theme versions are immutable, CAS isolated and retained on deletion/reopen',async()=>{
 const name='theme-store-'+crypto.randomUUID(),store=new ThemeStore({name}),other=new ThemeStore({name});
 const input=theme(),first=await store.save(input);assert.equal(first.revision,0);assert.equal((await other.get(input.id)).ref.hash,first.ref.hash);
 input.tokens.colors.accent='#123456';await assert.rejects(store.save(input,{expectedRevision:0}),{code:'IMMUTABLE_VERSION'});assert.equal((await store.get(input.id)).ref.hash,first.ref.hash);
 input.version='1.0.1';const second=await store.save(input,{expectedRevision:0});assert.equal(second.revision,1);assert.equal((await store.get(input.id,'1.0.0')).ref.hash,first.ref.hash);assert.equal((await store.get(input.id,'1.0.0')).version,'1.0.0');assert.equal((await store.get(input.id,'1.0.0')).hash,first.ref.hash);assert.equal((await store.list())[0].author,'SP');assert.equal('ref' in (await store.list())[0],false);assert.deepEqual((await store.versions(input.id)).map(v=>[v.version,v.current]),[['1.0.1',true],['1.0.0',false]]);assert.equal((await store.versions(input.id,{limit:1,offset:1}))[0].hash,first.ref.hash);await assert.rejects(store.versions(input.id,{limit:101}));await assert.rejects(other.save({...input,version:'1.0.2'},{expectedRevision:0}),{code:'REVISION_CONFLICT'});
 await store.favorite('builtin:catalog',true);await store.markUsed('builtin:catalog');assert.equal((await store.preferences())[0].favorite,true);
 const versions=await store.versions(input.id);await store.setDeleted(input.id,true,{expectedRevision:1});assert.deepEqual(await store.versions(input.id),versions);assert.equal((await store.list()).length,0);assert.equal((await store.get(input.id,'1.0.0')).ref.hash,first.ref.hash);assert.equal((await store.list({trash:true})).length,1);
 store.close();await store.open();assert.equal((await store.get(input.id)).ref.hash,second.ref.hash);assert.equal((await store.preferences())[0].favorite,true);await store.setDeleted(input.id,false,{expectedRevision:2});assert.equal((await store.list()).length,1);store.close();other.close();
});

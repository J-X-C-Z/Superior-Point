import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudThemeStore} from '../storage/cloud-theme-store.js';
import {createThemeRef} from '../core/theme-schema.js';
const theme=()=>({format:'superior-point-theme',schemaVersion:1,id:'test-theme',name:'Test',version:'1.0.0',author:'SP',license:'internal',tags:['editorial'],supportedRatios:['16:9','4:3'],tokens:{colors:{background:'#ffffff',text:'#202020',accent:'#806050'},typography:{title:{fontFamily:'sans-serif',fallback:['sans-serif'],license:'system',fontSize:52,fontWeight:700},body:{fontFamily:'serif',fallback:['serif'],license:'system',fontSize:24,lineHeight:1.35}},spacing:{unit:8,pageInset:64},components:{title:{color:'#202020'}},motion:{durationMs:450,easing:'ease-out'}},layouts:['cover','section','content','data'].map(kind=>({id:kind,kind,rules:{columns:1,pageInset:64,gap:24}})),assets:[]});

test('cloud theme upload readback is verified and timeout retries the same receipt across reopen',async()=>{
 let committed,first=true,requests=[];const api={user:{id:'u'},async request(path,{body}={}){if(path==='/themes/import'){requests.push(body);if(!committed)committed={id:'cloud-theme',revision:0,ref:await createThemeRef({...body.theme,id:'cloud-theme'})};if(first){first=false;throw Object.assign(Error('timeout'),{code:'TIMEOUT'});}return committed;}return structuredClone(committed);}};
 const input=theme(),original=structuredClone(input);await assert.rejects(new CloudThemeStore({api}).save(input),{code:'TIMEOUT'});const store=new CloudThemeStore({api}),saved=await store.save(input);assert.equal(saved.id,'cloud-theme');assert.equal(requests[0].clientMutationId,requests[1].clientMutationId);assert.deepEqual(input,original);
 committed.ref.snapshot.name='tampered';await assert.rejects(store.save(input),{code:'THEME_READBACK_MISMATCH'});
 api.user={id:'other'};await assert.rejects(store.get(saved.id),{code:'ACCOUNT_CHANGED'});
});

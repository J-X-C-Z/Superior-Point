import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {importTheme,validateTheme,verifyThemeAssets,createThemeRef,validateThemeRef,resolveThemeStyle,THEME_LIMITS} from '../core/theme-schema.js';

const theme=()=>({format:'superior-point-theme',schemaVersion:1,id:'test-theme',name:'Test',version:'1.0.0',author:'SP',license:'internal',tags:['editorial'],supportedRatios:['16:9','4:3'],tokens:{colors:{background:'#ffffff',text:'#202020',accent:'#806050'},typography:{title:{fontFamily:'sans-serif',fallback:['sans-serif'],license:'system',fontSize:52,fontWeight:700},body:{fontFamily:'serif',fallback:['serif'],license:'system',fontSize:24,lineHeight:1.35}},spacing:{unit:8,pageInset:64},components:{title:{color:'#202020'}},motion:{durationMs:450,easing:'ease-out'}},layouts:['cover','section','content','data'].map(kind=>({id:kind,kind,rules:{columns:1,pageInset:64,gap:24}})),assets:[]});
const image=()=>{const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP7cAAAAASUVORK5CYII=','base64');return {id:'texture',mimeType:'image/png',data:bytes.toString('base64'),hash:'sha256:'+createHash('sha256').update(bytes).digest('hex'),license:'CC0'};};

test('v1 JSON roundtrip preserves unknown safe fields and isolates returned values',()=>{
  const input=theme();input.future={motionHint:'script is an ordinary word here',custom:[1,null,true]};
  const copy=importTheme(JSON.stringify(input));assert.deepEqual(copy,input);copy.future.custom.push(2);assert.equal(input.future.custom.length,3);
  assert.throws(()=>importTheme({...input,schemaVersion:2}),{code:'INVALID_THEME'});
  assert.equal(validateTheme(JSON.parse('{"__proto__":{}}')).valid,false);
  assert.equal(validateTheme({...input,future:{constructor:'bad'}}).valid,false);
  const cycle=theme();cycle.future=cycle;assert.equal(validateTheme(cycle).valid,false);
});
test('reject executable structures, external loads, coordinate snapshots and out-of-bounds tokens',()=>{
  for(const patch of [{script:'alert(1)'},{future:{onclick:'alert(1)'}},{assets:[{...image(),url:'https://example.test/x.png'}]}])assert.equal(validateTheme({...theme(),...patch}).valid,false);
  const coordinate=theme();coordinate.layouts[0].rules.elements=[{x:0,y:0,w:20,h:20}];assert.equal(validateTheme(coordinate).valid,false);
  for(const mutate of [t=>t.tokens.typography.title.fontSize=1000,t=>t.tokens.typography.title.fallback=[],t=>delete t.tokens.typography.title.license,t=>t.tokens.spacing.pageInset=-1,t=>t.tokens.colors.text='url(javascript:alert(1))',t=>t.tokens.motion.durationMs=10001,t=>t.layouts[0].rules.columns=100,t=>t.tokens.components.title.fontSize=-10,t=>t.tokens.components.title.opacity=2]){const input=theme();mutate(input);assert.equal(validateTheme(input).valid,false);}
});
test('asset formats, licenses, size and hashes are checked before snapshot publication',async()=>{
  const t=theme();t.assets=[image()];assert.equal(validateTheme(t).valid,true);assert.deepEqual(await verifyThemeAssets(t),t);
  const corrupted=theme();corrupted.assets=[{...image(),hash:'sha256:'+'0'.repeat(64)}];await assert.rejects(createThemeRef(corrupted),{code:'INVALID_THEME'});
  for(const change of [{mimeType:'image/svg+xml'},{data:Buffer.from('<script>bad</script>').toString('base64')},{license:''},{data:'abcd==='}])assert.equal(validateTheme({...theme(),assets:[{...image(),...change}]}).valid,false);
  const oversized=Buffer.alloc(THEME_LIMITS.assetBytes+1);assert.equal(validateTheme({...theme(),assets:[{...image(),data:oversized.toString('base64')}]}).valid,false);
});
test('immutable references hash canonical package content and reject version or snapshot tampering',async()=>{
  const input=theme(),ref=await createThemeRef(input);assert.equal((await validateThemeRef(ref)).valid,true);
  const reordered=Object.fromEntries(Object.entries(input).reverse());assert.equal((await createThemeRef(reordered)).hash,ref.hash);
  input.tokens.colors.text='#eeeeee';assert.equal(ref.snapshot.tokens.colors.text,'#202020');
  assert.equal((await validateThemeRef({...ref,version:'2.0.0'})).valid,false);
  ref.snapshot.tokens.colors.text='#111111';assert.equal((await validateThemeRef(ref)).valid,false);
});
test('manual > page > component > global > default, nested values cascade without mutation',()=>{
  const defaults={font:{family:'serif',size:20},color:'black',padding:[1,2]},global={color:'blue',font:{size:24}},component={color:'green'},page={color:'yellow'},manual={color:'red',padding:[3],disabled:null};
  assert.deepEqual(resolveThemeStyle({defaults,global,component,page,manual}),{font:{family:'serif',size:24},color:'red',padding:[3],disabled:null});
  assert.equal(resolveThemeStyle({defaults,global,component,page}).color,'yellow');assert.equal(resolveThemeStyle({defaults,global,component}).color,'green');assert.equal(resolveThemeStyle({defaults,global}).color,'blue');
  assert.deepEqual(defaults.padding,[1,2]);assert.throws(()=>resolveThemeStyle({manual:JSON.parse('{"__proto__":{}}')}));
});

test('layout and component presets are optional, normalized only at import, and still validated when supplied',async()=>{
  const input=theme();delete input.layouts;delete input.tokens.components;
  assert.equal(validateTheme(input).valid,true);
  const imported=importTheme(input);assert.deepEqual(imported.layouts,[]);assert.deepEqual(imported.tokens.components,{});
  assert.equal(Object.hasOwn(input,'layouts'),false);assert.equal(Object.hasOwn(input.tokens,'components'),false);
  assert.equal((await validateThemeRef(await createThemeRef(input))).valid,true);
  for(const value of [null,{},'layouts'])assert.equal(validateTheme({...input,layouts:value}).valid,false);
  for(const value of [null,[],'components'])assert.equal(validateTheme({...input,tokens:{...input.tokens,components:value}}).valid,false);
  assert.throws(()=>importTheme({...input,tokens:{...input.tokens,components:{chart:{onclick:'evil'}}}}),{code:'INVALID_THEME'});
});

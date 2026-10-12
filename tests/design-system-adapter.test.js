import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {listBuiltinThemes,getBuiltinTheme} from '../core/builtin-themes.js';
import {createThemeRef} from '../core/theme-schema.js';
import {validateThemeManifest} from '../core/theme-manifest.js';
import {listDesignSystemReferences,DESIGN_SYSTEM_SOURCE} from '../core/design-system-inventory.js';
import {adaptDesignSystemRules} from '../core/design-system-adapter.js';
import {createThemePreviewDocument} from '../core/theme-preview.js';
import {inspectThemeCompatibility} from '../core/theme-motion.js';

test('legacy manifests retain exact id/version semantics and optional fixed version lookup',async()=>{
 // Hashes verified against the six pre-v1.2 manifests at ef869b3bc1ba973a7b0b062abc3533014d9f3d5f.
 const pinned={'sp-margin':'3517326902235447bee290aab81edd7b76677a00cb409f91e6b3ac0dc5a0720b','sp-signal':'9abd9b234b0427476a093fb148c7b435c94378c5af4c5034ba962a0cc52bb7ef','sp-folio':'152cdb4fbb76937a9ab70f513073e69e84d9152d21df25e6a67e46d3feeb31b7','sp-caliper':'a0145eaf0607f8642e5ffbd56ce244ed4b7be29279c7d5b3f2ca08b7c949fec9','sp-hearth':'ed1c6bb08375db6078525cf17a99441bd9dfeeb19d9d6070272aa46bc3a7e2bc','sp-orbit':'933832562dab8a4fe96f111147580e034ed1dcae2f71c729cead8ba9dcc53d13'};
 for(const [id,hash] of Object.entries(pinned))assert.equal((await createThemeRef(getBuiltinTheme(id,'1.0.0'))).hash,'sha256:'+hash);
 assert.equal(getBuiltinTheme('sp-margin','99.0.0'),null);
});
test('authoritative inventory keeps independent languages and explicit redistribution review',()=>{
 const rows=listDesignSystemReferences();assert.equal(rows.length,22);assert.equal(new Set(rows.map(r=>r.id)).size,22);assert.equal(rows[9].id,'midcentury-modern');assert.equal(rows.filter(r=>r.level===2).length,10);assert.equal(DESIGN_SYSTEM_SOURCE.license,null);assert.match(DESIGN_SYSTEM_SOURCE.revision,/^[a-f0-9]{40}$/);
 rows[0].source.repository='mutated';assert.equal(listDesignSystemReferences()[0].source.repository,'J-X-C-Z/Design-Systems');
 assert.equal(rows.some(r=>['lumina','noema'].includes(r.id)),false);
});
test('three curated languages differ in typography, geometry, image treatment and motion, with five editable pages',async()=>{
 const themes=listBuiltinThemes().filter(t=>t.designLanguage);assert.equal(themes.length,3);assert.equal(new Set(themes.map(t=>t.tokens.typography.title.fontFamily)).size,3);assert.equal(new Set(themes.map(t=>t.designLanguage.motion.enter)).size,3);assert.equal(new Set(themes.map(t=>t.designLanguage.visual.grid)).size,3);
 for(const theme of themes){assert.equal(validateThemeManifest(theme,{requireDesignLanguage:true}).valid,true);const doc=await createThemePreviewDocument(theme);assert.deepEqual(doc.slides.map(s=>s.themeLayout),['cover','content','data','image','section']);assert.equal(doc.slides.every(s=>s.elements.some(e=>e.type==='text')&&s.animations.length===1),true);assert.equal(doc.slides[4].elements[0].shape,theme.designLanguage.visual.shape==='rounded'?'ellipse':'rect');assert.equal(doc.slides[3].elements.find(e=>e.type==='image').fit,theme.designLanguage.visual.imageTreatment==='editorial-crop'?'cover':'contain');const diagnostics=inspectThemeCompatibility(doc);assert.ok(diagnostics.some(d=>d.renderer==='pptx'&&d.status==='refused'));assert.ok(diagnostics.some(d=>d.behavior==='exit'&&d.status!=='supported'));}
});
test('manual adapter reports exact provenance without mutating original or importing unlicensed resources',async()=>{
 const theme=getBuiltinTheme('sp-editorial-language'),input={theme,upstreamId:'editorial-magazine',review:{decision:'original-no-source-assets',reviewer:'SP rule review'}},before=JSON.stringify(input),result=await adaptDesignSystemRules(input);assert.equal(JSON.stringify(input),before);assert.equal(result.report.source.source.revision,DESIGN_SYSTEM_SOURCE.revision);assert.equal(result.theme.designLanguage.origin.type,'original');assert.deepEqual(result.report.copiedAssets,[]);assert.equal(result.report.mapping.length,3);
 await assert.rejects(adaptDesignSystemRules({...input,review:null}),{code:'ADAPTER_REVIEW_REQUIRED'});await assert.rejects(adaptDesignSystemRules({...input,upstreamId:'Lumina'}),{code:'UNKNOWN_DESIGN_SYSTEM'});await assert.rejects(adaptDesignSystemRules({...input,theme:{...theme,designLanguage:{...theme.designLanguage,origin:{...theme.designLanguage.origin,type:'derived'}}}}),{code:'UPSTREAM_LICENSE_REVIEW_REQUIRED'});await assert.rejects(adaptDesignSystemRules({...input,theme:{...theme,tokens:{...theme.tokens,script:'alert(1)'}}}),{code:'INVALID_THEME'});
 const output=JSON.parse(execFileSync(process.execPath,['tools/theme-adapter.js','--inventory'],{encoding:'utf8'}));assert.equal(output.length,22);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getBuiltinTheme} from '../core/builtin-themes.js';
import {importTheme,validateTheme,createThemeRef,validateThemeRef} from '../core/theme-schema.js';
import {validateThemeManifest,THEME_MANIFEST_SCHEMA} from '../core/theme-manifest.js';
import {inspectThemeCompatibility} from '../core/theme-motion.js';
import {createThemePreviewDocument} from '../core/theme-preview.js';
import {planThemeApplication} from '../core/theme-application.js';
import {DocumentCore,createDocument} from '../core/document-core.js';

const language=()=>({identity:{principles:['precision'],suitableFor:['data'],avoid:['noise'],distinctiveFeatures:['grid']},origin:{type:'original',ref:'Superior Point',sourceRevision:'1.0.0',license:'MIT',attribution:'SP'},visual:{grid:'modular',imageTreatment:'editorial-crop',shape:'square',spacingUnit:8},motion:{principles:['restrained'],timing:{shortMs:120,standardMs:240,longMs:420},easing:'ease-out',enter:'fade',exit:'fade',transition:'slide',reducedMotion:'none',unsupportedBehavior:'preserve-intent-and-report'}});
const theme=()=>({...structuredClone(getBuiltinTheme('sp-margin')),designLanguage:language()});
test('optional complete manifest preserves legacy and unknown safe fields; curated contract is strict',async()=>{
 const legacy=structuredClone(getBuiltinTheme('sp-margin'));delete legacy.designLanguage;legacy.future={safe:[1,true]};assert.deepEqual(importTheme(JSON.stringify(legacy)),legacy);assert.equal(validateThemeManifest(legacy).valid,true);assert.equal(validateThemeManifest(legacy,{requireDesignLanguage:true}).valid,false);
 const curated=theme();curated.future={safe:'retained'};assert.deepEqual(importTheme(JSON.stringify(curated)),curated);assert.equal(validateThemeManifest(curated,{requireDesignLanguage:true}).valid,true);assert.equal((await validateThemeRef(await createThemeRef(curated))).valid,true);
 for(const mutate of [t=>delete t.designLanguage.identity.distinctiveFeatures,t=>t.designLanguage.identity.suitableFor=[],t=>t.designLanguage.visual.grid='css-grid',t=>t.designLanguage.visual.custom='ignore me',t=>t.designLanguage.origin.sourceRevision='',t=>t.designLanguage.motion.enter='run-script',t=>t.designLanguage.motion.timing.shortMs=10001,t=>t.designLanguage.motion.timing.longMs=10,t=>t.designLanguage.motion.script='evil',t=>t.designLanguage.identity.principles=['<script>'],t=>t.tokens.typography={}]){const bad=theme();mutate(bad);assert.equal(validateTheme(bad).valid,false);assert.throws(()=>importTheme(bad),{code:'INVALID_THEME'});}
 assert.deepEqual(JSON.parse(readFileSync(new URL('../core/theme-manifest.schema.json',import.meta.url))),THEME_MANIFEST_SCHEMA);
});
test('selected Skin keeps untouched slides, baselines, fixed snapshots and all content; CAS undo restores mixed metadata',async()=>{
 const doc=await createThemePreviewDocument(getBuiltinTheme('sp-margin')),ids=[doc.slides[1].id];doc.slides[1].elements[0].color='#121212';
 const before=structuredClone(doc),plan=await planThemeApplication(doc,theme(),{slideIds:ids});assert.deepEqual(doc,before);assert.equal(plan.scope.type,'slides');assert.deepEqual(plan.scope.slideIds,ids);assert.ok(plan.manualOverrides.length);assert.equal(plan.summary.preservedOverrides,plan.manualOverrides.length);
 const applied=new DocumentCore(doc),result=applied.edit(plan.operations,{expectedRevision:doc.revision});
 for(const slide of doc.slides.filter(s=>!ids.includes(s.id))){assert.deepEqual(result.slides.find(s=>s.id===slide.id),slide);assert.deepEqual(result.extensions.theme.bindings.elements[slide.id],doc.extensions.theme.bindings.elements[slide.id]);assert.deepEqual(result.extensions.theme.bindings.slides[slide.id],doc.extensions.theme.bindings.slides[slide.id]);assert.equal(result.extensions.theme.slideRefs[slide.id].hash,doc.extensions.theme.ref.hash);}
 assert.equal(result.extensions.theme.ref.hash,doc.extensions.theme.ref.hash);assert.equal(result.extensions.theme.slideRefs[ids[0]].hash,plan.ref.hash);assert.equal((await validateThemeRef(result.extensions.theme.slideRefs[ids[0]])).valid,true);assert.deepEqual(applied.undo({expectedRevision:result.revision}).extensions,doc.extensions);
 for(const slideIds of [[],['unknown'],[ids[0],ids[0]],'all'])await assert.rejects(planThemeApplication(doc,theme(),{slideIds}),{code:'INVALID_THEME_SCOPE'});
 const noTheme=structuredClone(doc);delete noTheme.extensions.theme;const partial=await planThemeApplication(noTheme,theme(),{slideIds:ids});const mixed=new DocumentCore(noTheme).edit(partial.operations);assert.equal(mixed.extensions.theme.ref,undefined);assert.equal(mixed.extensions.theme.slideRefs[doc.slides[0].id],undefined);
 const full=await planThemeApplication(result,getBuiltinTheme('sp-signal'));const fullResult=new DocumentCore(result).edit(full.operations);assert.deepEqual(fullResult.extensions.theme.slideRefs,{});assert.equal(fullResult.extensions.theme.ref.id,'sp-signal');
});
test('motion diagnostics report renderer limitations while Skin keeps every animation intention',async()=>{
 const doc=await createThemePreviewDocument(getBuiltinTheme('sp-margin'));const slide=doc.slides[0];slide.animations=[{id:'appear',targetId:slide.elements[0].id,type:'appear',trigger:'click',duration:0.3,delay:0,easing:'ease',order:0},{id:'spin',targetId:slide.elements[1].id,type:'spin',trigger:'click',duration:1,delay:0,easing:'ease',order:1},{id:'unknown',targetId:slide.elements[2].id,type:'future-effect',trigger:'click',duration:1,delay:0,easing:'ease',order:2}];
 const plan=await planThemeApplication(doc,theme(),{slideIds:[slide.id]});assert.ok(plan.motionDiagnostics.some(d=>d.animationId==='appear'&&d.renderer==='reveal'&&d.status==='supported'));assert.ok(plan.motionDiagnostics.some(d=>d.animationId==='spin'&&d.renderer==='reveal'&&d.status==='degraded'));assert.ok(plan.motionDiagnostics.some(d=>d.animationId==='unknown'&&d.status==='refused'));assert.ok(plan.motionDiagnostics.some(d=>d.renderer==='pptx'&&d.status==='refused'));assert.ok(plan.motionDiagnostics.some(d=>d.behavior==='reducedMotion'&&d.status==='degraded'&&d.message.includes('does not')));
 const result=new DocumentCore(doc).edit(plan.operations);assert.deepEqual(result.slides.map(s=>s.animations),doc.slides.map(s=>s.animations));assert.ok(inspectThemeCompatibility(result).some(d=>d.code==='THEME_MOTION_POLICY'));assert.ok(!plan.operations.some(op=>op.type==='setAnimation'));
});

test('all scope accepts an empty document while explicit empty selection rejects',async()=>{const doc=createDocument();const plan=await planThemeApplication(doc,theme());assert.equal(plan.summary.selectedSlides,0);assert.deepEqual(plan.motionDiagnostics,[]);assert.equal(new DocumentCore(doc).edit(plan.operations).extensions.theme.ref.id,theme().id);await assert.rejects(planThemeApplication(doc,theme(),{slideIds:[]}),{code:'INVALID_THEME_SCOPE'});});

test('manifest declares optional presets and a usable version pattern; no-preset themes create and apply through Core',async()=>{
 const input=theme();delete input.layouts;delete input.tokens.components;
 assert.equal(THEME_MANIFEST_SCHEMA.required.includes('layouts'),false);
 assert.equal(THEME_MANIFEST_SCHEMA.properties.tokens.required.includes('components'),false);
 const versionPattern=new RegExp(THEME_MANIFEST_SCHEMA.properties.version.pattern);
 assert.equal(versionPattern.test('1.2.0'),true);assert.equal(versionPattern.test('1.2.0-beta.1'),true);assert.equal(versionPattern.test('v1.2'),false);
 const forbidden=new RegExp(THEME_MANIFEST_SCHEMA.$defs.safeValue.propertyNames.not.anyOf[1].pattern);
 for(const field of ['script','SCRIPT','href'])assert.equal(forbidden.test(field),true);
 assert.equal(forbidden.test('motionHint'),false);assert.deepEqual(THEME_MANIFEST_SCHEMA.$defs.safeValue.propertyNames.not.anyOf[0].enum,['__proto__','prototype','constructor']);
 const doc=await createThemePreviewDocument(input);assert.equal(doc.slides.length,5);
 const core=new DocumentCore(doc),plan=await planThemeApplication(doc,input),applied=core.edit(plan.operations,{expectedRevision:doc.revision});
 assert.deepEqual(applied.slides.map(s=>s.elements.map(e=>e.id)),doc.slides.map(s=>s.elements.map(e=>e.id)));
 assert.deepEqual(applied.extensions.theme.ref.snapshot.layouts,[]);assert.deepEqual(applied.extensions.theme.ref.snapshot.tokens.components,{});
 assert.equal((await validateThemeRef(applied.extensions.theme.ref)).valid,true);
});

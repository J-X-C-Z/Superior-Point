import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {inspectThemeDiagnostics} from '../core/theme-diagnostics.js';
import {getBuiltinTheme} from '../core/builtin-themes.js';
import {createThemeRef} from '../core/theme-schema.js';
import {fiveSlideDocument} from '../examples/five-slides.js';

test('diagnostics check fonts, unknown motion, generic/PPTX gaps and keep document content private',async()=>{
 const doc=fiveSlideDocument();doc.slides[0].notes='SECRET_NOTES';doc.slides[0].elements[1].fontFamily='Missing Fancy Font';doc.slides[0].animations=[{id:'unknown',targetId:doc.slides[0].elements[0].id,type:'future-animation',trigger:'click',duration:1,delay:0,order:0,easing:'ease'}];
 const before=structuredClone(doc),report=await inspectThemeDiagnostics(doc,{availableFonts:['Arial']});
 assert.equal(report.valid,true);assert.ok(report.diagnostics.some(d=>d.code==='FONT_FALLBACK'&&d.requestedFont==='Missing Fancy Font'&&d.renderedFont==='Arial, sans-serif'));assert.ok(report.diagnostics.some(d=>d.code==='UNKNOWN_MOTION'&&d.status==='refused'));assert.ok(report.diagnostics.some(d=>d.code==='PPTX_LIMITATIONS'));assert.ok(!JSON.stringify(report).includes('SECRET_NOTES'));assert.ok(!JSON.stringify(report).includes(doc.assets[0].dataUrl));assert.deepEqual(doc,before);
});
test('PPTX summary explains current exporter limits for documents and manifests without content disclosure',async()=>{
 const doc=fiveSlideDocument();doc.slides[0].notes='PRIVATE_PPTX_NOTES';doc.slides[0].hidden=true;
 for(const input of [doc,getBuiltinTheme('sp-margin')]){
  const before=structuredClone(input),report=await inspectThemeDiagnostics(input);
  const summary=report.diagnostics.filter(d=>d.code==='PPTX_LIMITATIONS');
  assert.equal(summary.length,1);assert.equal(summary[0].status,'degraded');assert.equal(summary[0].renderer,'pptx');assert.equal(report.valid,true);
  for(const phrase of ['does not embed fonts','may substitute','charts use Arial','crop, filters and fit are rasterized','groups become separate objects','editable tables/charts may differ','Notes and hidden slides are included','animations and slide transitions are absent','do not prove visual fidelity','verify the exported deck in PowerPoint'])assert.ok(summary[0].message.includes(phrase),phrase);
  assert.ok(!JSON.stringify(report).includes('PRIVATE_PPTX_NOTES'));assert.ok(!JSON.stringify(report).includes(doc.assets[0].dataUrl));assert.deepEqual(input,before);
 }
});
test('diagnostics fail missing/corrupt assets, missing slide and tampered theme references',async()=>{
 const doc=fiveSlideDocument();doc.assets=[];assert.equal((await inspectThemeDiagnostics(doc)).valid,false);assert.ok((await inspectThemeDiagnostics(doc)).diagnostics.some(d=>d.code==='ASSET_MISSING'));
 const corrupt=fiveSlideDocument();corrupt.assets[0].hash='sha256:'+'0'.repeat(64);assert.ok((await inspectThemeDiagnostics(corrupt)).diagnostics.some(d=>d.code==='ASSET_INTEGRITY'));
 const ref=await createThemeRef(getBuiltinTheme('sp-margin'));ref.hash='sha256:'+'0'.repeat(64);corrupt.extensions.theme={slideRefs:{absent:ref}};const report=await inspectThemeDiagnostics(corrupt);assert.ok(report.diagnostics.some(d=>d.code==='THEME_REFERENCE_INVALID'));assert.ok(report.diagnostics.some(d=>d.code==='THEME_REFERENCE_MISSING_SLIDE'));assert.equal(report.themeReferences[0].snapshot,undefined);
 const theme=structuredClone(getBuiltinTheme('sp-margin'));theme.layouts[0].rules.assetId='absent';assert.ok((await inspectThemeDiagnostics(theme)).diagnostics.some(d=>d.code==='ASSET_MISSING'));
 const image=fiveSlideDocument().assets[0].dataUrl;theme.assets=[{id:'picture',mimeType:'image/png',license:'MIT',data:image.split(',')[1],hash:'sha256:'+'0'.repeat(64)}];assert.ok((await inspectThemeDiagnostics(theme)).diagnostics.some(d=>d.code==='ASSET_INTEGRITY'));
});
test('CLI emits structured metadata and meaningful status for document, manifest and invalid input',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sp-diagnostics-'));try{const path=join(dir,'input.json');
 for(const [value,status,kind]of [[getBuiltinTheme('sp-margin'),0,'manifest'],[fiveSlideDocument(),0,'document'],[{format:'superior-point'},1,'document']]){await writeFile(path,JSON.stringify(value));const run=spawnSync(process.execPath,['tools/theme-validate.js',path,'--kind',kind],{cwd:new URL('..',import.meta.url),encoding:'utf8'});assert.equal(run.status,status,run.stderr);assert.equal(JSON.parse(run.stdout).valid,status===0);}
 await writeFile(path,'bad');const run=spawnSync(process.execPath,['tools/theme-validate.js',path],{cwd:new URL('..',import.meta.url),encoding:'utf8'});assert.equal(run.status,1);assert.equal(JSON.parse(run.stdout).diagnostics[0].code,'INVALID_INPUT');assert.equal(run.stderr,'');
 }finally{await rm(dir,{recursive:true,force:true});}
});

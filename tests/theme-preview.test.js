import test from 'node:test';
import assert from 'node:assert/strict';
import {listBuiltinThemes,getBuiltinTheme} from '../core/builtin-themes.js';
import {createThemePreviewDocument} from '../core/theme-preview.js';
import {validateTheme,validateThemeRef} from '../core/theme-schema.js';
import {validateDocument} from '../core/document-core.js';
import {canonicalToEditor,editorToCanonical} from '../adapters/editor-v038-model.js';
import {renderSlideSVG,exportHTML,inspectRenderCompatibility} from '../io/html.js';
import {inspectRasterDataURL} from '../io/image-assets.js';

const luminance=color=>{const channels=color.slice(1).match(/../g).map(hex=>parseInt(hex,16)/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;};
const contrast=(a,b)=>{const values=[luminance(a),luminance(b)].sort((a,b)=>b-a);return (values[0]+0.05)/(values[1]+0.05);};
test('six original validated built-ins expose immutable independent snapshots, licensed system fonts and distinct rules',()=>{
 const themes=listBuiltinThemes();assert.equal(themes.length,6);assert.equal(new Set(themes.map(t=>t.id)).size,6);assert.equal(new Set(themes.map(t=>t.layouts[0].rules.motif)).size,6);
 for(const theme of themes){assert.equal(validateTheme(theme).valid,true);assert.equal(theme.license,'MIT');assert.match(theme.provenance,/Original Superior Point/);assert.deepEqual(theme.supportedRatios,['16:9','4:3']);assert.ok(contrast(theme.tokens.colors.text,theme.tokens.colors.background)>=7);assert.ok(contrast(theme.tokens.colors.muted,theme.tokens.colors.background)>=4.5);assert.ok(theme.tokens.typography.title.fontSize>theme.tokens.typography.body.fontSize);assert.ok(theme.tokens.typography.body.fontSize>theme.tokens.typography.caption.fontSize);for(const font of Object.values(theme.tokens.typography)){assert.ok(font.fallback.length);assert.match(font.license,/no font files/);}assert.throws(()=>{theme.tokens.colors.accent='#000000';},TypeError);assert.notEqual(getBuiltinTheme(theme.id),theme);assert.notEqual(getBuiltinTheme(theme.id).tokens,theme.tokens);}
 assert.equal(getBuiltinTheme('nonexistent'),null);
});
test('every theme generates four safe canonical samples in both ratios and survives native editor roundtrip',async()=>{
 for(const theme of listBuiltinThemes())for(const ratio of theme.supportedRatios){
  const doc=await createThemePreviewDocument(theme,{ratio}),validation=validateDocument(doc);assert.equal(validation.valid,true);assert.deepEqual(validation.warnings,[]);assert.deepEqual(doc.slides.map(s=>s.themeLayout),['cover','content','data','image']);assert.equal(doc.canvas.width/doc.canvas.height,ratio==='4:3'?4/3:16/9);assert.equal((await validateThemeRef(doc.extensions.theme.ref)).valid,true);
  const chart=doc.slides[2].elements.find(e=>e.type==='chart'),image=doc.slides[3].elements.find(e=>e.type==='image');assert.deepEqual(chart.values,[24,38,52,76]);assert.equal(chart.chartColor,theme.tokens.components.chart.color);assert.ok(image);assert.equal(doc.assets[0].license,'MIT');const imageInfo=inspectRasterDataURL(doc.assets[0].dataUrl);assert.deepEqual([imageInfo.width,imageInfo.height],[160,100]);
  const editor=canonicalToEditor(doc);assert.equal(editor.slides.length,4);assert.equal(editor.slides[0].bg,theme.tokens.colors.background);const nativeChart=editor.slides[2].objects.find(e=>e.type==='chart');assert.deepEqual(nativeChart.values,chart.values);assert.equal(nativeChart.chartColor,chart.chartColor);const nativeImage=editor.slides[3].objects.find(e=>e.type==='image');assert.equal(nativeImage.src,doc.assets[0].dataUrl);assert.equal(editor.slides[0].objects.find(e=>e.type==='text'&&e.themeRole==='title').fontFamily,theme.tokens.typography.title.fontFamily);
  const restored=editorToCanonical(editor,{baseDocument:doc});assert.equal(validateDocument(restored).valid,true);assert.deepEqual(restored.slides.map(s=>s.elements.map(e=>e.id)),doc.slides.map(s=>s.elements.map(e=>e.id)));assert.deepEqual(restored.extensions.theme.ref,doc.extensions.theme.ref);
  for(const slide of doc.slides){const svg=renderSlideSVG(doc,slide.id);assert.ok(svg.startsWith('<svg'));assert.doesNotMatch(svg,/Preview unsupported/);assert.match(svg,new RegExp(theme.tokens.colors.background));if(slide.themeLayout==='image')assert.match(svg,/href="data:image\/png;base64,/);}
  const html=await exportHTML(doc);assert.match(html,/sp-document/);assert.doesNotMatch(html,/<(?:img|image)[^>]*(?:href|src)="https?:/);assert.equal(inspectRenderCompatibility(doc).hasKnownGaps,theme.tokens.typography.title.fontFamily!=='Arial');assert.ok(doc.extensions.themePreview.limitations.length);
 }
});
test('preview rejects invalid packages, scripts, unsupported ratios and wrong asset hashes before returning a document',async()=>{
 const theme=structuredClone(getBuiltinTheme('sp-margin'));
 await assert.rejects(createThemePreviewDocument(theme,{ratio:'1:1'}),/比例/);
 await assert.rejects(createThemePreviewDocument({...theme,schemaVersion:99}),/validation/);
 await assert.rejects(createThemePreviewDocument({...theme,tokens:{...theme.tokens,script:'evil()'}}),/validation/);
 const sample=await createThemePreviewDocument(theme),asset={id:'broken',mimeType:'image/png',data:sample.assets[0].dataUrl.split(',')[1],hash:'sha256:'+'0'.repeat(64),license:'MIT'};
 await assert.rejects(createThemePreviewDocument({...theme,assets:[asset]}),/hash mismatch/);
});


test('valid extreme layout spacing remains bounded in both preview ratios',async()=>{
 const theme=structuredClone(listBuiltinThemes()[0]);for(const layout of theme.layouts)Object.assign(layout.rules,{gap:512,pageInset:512});for(const ratio of ['16:9','4:3']){const doc=await createThemePreviewDocument(theme,{ratio});assert.equal(doc.slides.length,4);for(const slide of doc.slides)for(const el of slide.elements){assert.ok(el.w>0&&el.h>0);assert.ok(el.x>=0&&el.x+el.w<=doc.canvas.width);}}
});

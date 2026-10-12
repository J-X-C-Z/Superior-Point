import {importDocument} from './document-core.js';
import {validateThemeManifest} from './theme-manifest.js';
import {verifyThemeAssets,validateThemeRef} from './theme-schema.js';
import {inspectThemeCompatibility} from './theme-motion.js';
import {inspectRenderCompatibility} from '../io/html.js';
import {inspectRasterDataURL} from '../io/image-assets.js';

/** Metadata-only static diagnostics; never fetches fonts/resources or claims visual acceptance. */
export async function inspectThemeDiagnostics(input,{kind,availableFonts}={}){
 const diagnostics=[],themeReferences=[];
 const add=(code,status,message,fields={})=>diagnostics.push({code,status,...fields,message});
 kind??=input?.format==='superior-point-theme'?'manifest':'document';
 const finish=extra=>({kind,valid:!diagnostics.some(d=>d.status==='invalid'),themeReferences,diagnostics,...extra});
 if(!['manifest','document'].includes(kind)||availableFonts!==undefined&&(!Array.isArray(availableFonts)||availableFonts.some(f=>typeof f!=='string'))){add('INVALID_OPTIONS','invalid','Expected manifest/document kind and an optional font-name inventory.');return finish();}
 const fonts=(requested,fallback,fields)=>{
  const primary=requested.split(',').map(f=>f.trim().replace(/^['"]|['"]$/g,''));const families=[...primary,...fallback];
  const generic=new Set(['sans-serif','serif','monospace','system-ui','cursive','fantasy']);
  const selected=availableFonts?families.find(f=>generic.has(f.toLowerCase())||availableFonts.some(a=>a.toLowerCase()===f.toLowerCase())):undefined;
  add('FONT_AVAILABILITY',selected===primary[0]?'supported':'degraded',availableFonts?(selected?`Font inventory selects ${selected}${selected!==primary[0]?' as fallback':''}.`:'No requested or fallback font is present in the supplied inventory.'):'Native font availability was not measured; declared fallback is not proof of an installed font.',{renderer:'editor',...fields,requestedFont:requested,fallbackFonts:fallback,...(selected?{selectedFont:selected}:{})});
  add('FONT_FALLBACK',requested==='Arial'?'supported':'degraded','Generic HTML paints text with Arial, sans-serif; browser system substitution remains environment-dependent.',{renderer:'editable-html',...fields,requestedFont:requested,renderedFont:'Arial, sans-serif'});
 };
 async function manifest(theme,path){
  const validation=validateThemeManifest(theme);
  for(const message of validation.errors)add('INVALID_MANIFEST','invalid',message,{path});
  if(!validation.valid)return;
  try{await verifyThemeAssets(theme);}catch(error){const asset=theme.assets.find(a=>error.message===`Asset hash mismatch: ${a.id}`);add('ASSET_INTEGRITY','invalid','Theme asset hash does not match its embedded bytes.',{path,...(asset?{assetId:asset.id}:{})});}
  for(const [role,font]of Object.entries(theme.tokens.typography))fonts(font.fontFamily,font.fallback,{path:`${path}.tokens.typography.${role}`});
  const ids=new Set(theme.assets.map(a=>a.id));
  function visit(value,at){if(!value||typeof value!=='object')return;for(const [key,v]of Object.entries(value)){if(['assetId','themeAssetId'].includes(key)&&typeof v==='string'&&!ids.has(v))add('ASSET_MISSING','invalid','Theme rule references a missing embedded asset.',{path:`${at}.${key}`,assetId:v});visit(v,`${at}.${key}`);}}
  visit(theme.tokens,`${path}.tokens`);visit(theme.layouts,`${path}.layouts`);
  for(const asset of theme.assets){try{inspectRasterDataURL(`data:${asset.mimeType};base64,${asset.data}`);}catch{add('ASSET_INVALID','invalid','Theme asset is not a valid supported raster image.',{path,assetId:asset.id});}}
 }
 if(kind==='manifest'){await manifest(input,'theme');add('MOTION_POLICY','degraded','Theme motion policy is declarative; Skin preserves existing intent and does not synthesize playback.');add('PPTX_LIMITATIONS','degraded','PPTX visual fidelity, custom fonts and motion are not validated by static theme diagnostics.',{renderer:'pptx'});return finish();}
 let doc;try{doc=importDocument(input);}catch{add('INVALID_DOCUMENT','invalid','Document fails the canonical document contract.');if(Array.isArray(input?.assets)&&Array.isArray(input?.slides)){const ids=new Set(input.assets.map(a=>a?.id));for(const slide of input.slides)if(Array.isArray(slide?.elements))for(const el of slide.elements)if(el?.assetId!==undefined&&!ids.has(el.assetId))add('ASSET_MISSING','invalid','Element references a missing document asset.',{slideId:slide.id,elementId:el.id,assetId:el.assetId});}return finish();}
 const refs=doc.extensions.theme||{};
 if(refs.ref)themeReferences.push({path:'extensions.theme.ref',ref:refs.ref});
 for(const [slideId,ref]of Object.entries(refs.slideRefs||{})){themeReferences.push({path:`extensions.theme.slideRefs.${slideId}`,ref});if(!doc.slides.some(s=>s.id===slideId))add('THEME_REFERENCE_MISSING_SLIDE','invalid','Theme reference targets a missing slide.',{slideId});}
 for(const {path,ref}of themeReferences){const result=await validateThemeRef(ref);if(!result.valid)add('THEME_REFERENCE_INVALID','invalid','Theme ID, version, hash or embedded snapshot does not verify.',{path});await manifest(ref?.snapshot,path+'.snapshot');}
 // Return only identity/integrity metadata, never snapshots, asset bytes, notes or document text.
 for(let i=0;i<themeReferences.length;i++){const {path,ref}=themeReferences[i];themeReferences[i]={path,id:ref?.id,version:ref?.version,hash:ref?.hash};}
 const assets=new Map(doc.assets.map(a=>[a.id,a]));
 async function raster(source,fields,asset){try{const info=inspectRasterDataURL(source);if(asset?.mimeType&&asset.mimeType.replace('image/jpg','image/jpeg')!==info.mimeType)add('ASSET_INVALID','invalid','Asset MIME declaration does not match embedded bytes.',fields);if(asset?.hash){const bytes=Uint8Array.from(atob(source.split(',')[1]),c=>c.charCodeAt(0));const hash='sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==asset.hash)add('ASSET_INTEGRITY','invalid','Document asset hash does not match embedded bytes.',fields);}}catch{add('ASSET_INVALID','invalid','Asset requires valid embedded supported raster bytes; no external resources are loaded.',fields);}}
 for(const asset of doc.assets)await raster(asset.dataUrl??asset.src??asset.data,{assetId:asset.id},asset);
 for(const slide of doc.slides)for(const el of slide.elements){const fields={slideId:slide.id,elementId:el.id};if(el.type==='image'){const asset=assets.get(el.assetId);if(el.assetId&&!asset)add('ASSET_MISSING','invalid','Image references a missing document asset.',{...fields,assetId:el.assetId});const source=el.src??el.dataUrl??asset?.dataUrl??asset?.src??asset?.data;if(!source)add('ASSET_MISSING','invalid','Image has no embedded raster source.',fields);else if(el.src||el.dataUrl)await raster(source,fields);}
  if(el.type==='text'||el.text||['table','chart'].includes(el.type))fonts(el.fontFamily||'Arial',['sans-serif'],fields);
 }
 const renderCompatibility=inspectRenderCompatibility(doc),motion=inspectThemeCompatibility(doc);
 for(const warning of renderCompatibility.warnings)add(warning.code,'degraded',warning.message,{renderer:'editable-html',slideId:warning.slideId,elementId:warning.elementId,properties:warning.properties});
 diagnostics.push(...motion);
 add('NATIVE_GENERIC_DIFFERENCE','degraded','Generic HTML is a basic SVG renderer; recognized native editor vocabulary does not establish matching visuals or timing.');
 add('PPTX_LIMITATIONS','degraded','Static diagnostics do not prove PPTX visual fidelity; unsupported motion is reported separately. Verify the exported deck in a PPTX viewer.',{renderer:'pptx'});
 return finish({renderCompatibility,motion});
}

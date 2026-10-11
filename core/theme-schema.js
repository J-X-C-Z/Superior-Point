import {cloneJSON, CoreError} from './document-core.js';

export const THEME_FORMAT = 'superior-point-theme';
export const THEME_SCHEMA_VERSION = 1;
export const THEME_LIMITS = Object.freeze({packageBytes:12*1024*1024,assetBytes:2*1024*1024,totalAssetBytes:8*1024*1024,assets:16});
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v, max=200) => typeof v==='string' && v.trim().length>0 && v.length<=max;
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const utf8 = v => new TextEncoder().encode(v);
const fail = (message,details) => {throw new CoreError('INVALID_THEME',message,details);};
const bounded = (v,min,max) => Number.isFinite(v)&&v>=min&&v<=max;
const executableKeys = new Set(['script','scripts','javascript','html','css','src','href','url','code','onload','onclick']);
function inspect(value,errors,path='theme') {
  if (!value || typeof value!=='object') return;
  for (const [key,v] of Object.entries(value)) {
    if(executableKeys.has(key.toLowerCase())) errors.push(`Executable or external-load field is forbidden: ${path}.${key}`);
    inspect(v,errors,`${path}.${key}`);
  }
}
function bytesOf(asset) {
  if(typeof asset.data!=='string'||!asset.data.length||asset.data.length%4!==0||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.data)) fail('Asset data must be canonical base64');
  const raw=atob(asset.data),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  if(btoa(raw)!==asset.data) fail('Asset data must be canonical base64');
  return bytes;
}
function matchesImage(bytes,mime) {
  if(mime==='image/png')return bytes.length>=24&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)&&String.fromCharCode(...bytes.slice(12,16))==='IHDR';
  if(mime==='image/jpeg')return bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes.at(-2)===255&&bytes.at(-1)===217;
  if(mime==='image/webp')return bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  return false;
}
export function validateTheme(raw) {
  const errors=[],warnings=[];let theme;
  try {theme=cloneJSON(raw);}catch(e){return {valid:false,errors:[e.message],warnings};}
  if(!object(theme))return {valid:false,errors:['Theme must be an object'],warnings};
  if(utf8(JSON.stringify(theme)).length>THEME_LIMITS.packageBytes)return {valid:false,errors:['Theme package exceeds size limit'],warnings};
  inspect(theme,errors);
  if(theme.format!==THEME_FORMAT)errors.push('Invalid theme format');
  if(theme.schemaVersion!==THEME_SCHEMA_VERSION)errors.push('Unsupported theme schemaVersion');
  if(!text(theme.id,128)||!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(theme.id))errors.push('Invalid theme id');
  for(const key of ['name','author','license'])if(!text(theme[key]))errors.push(`Missing or invalid ${key}`);
  if(!text(theme.version,64)||!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(theme.version))errors.push('Invalid theme version');
  if(!Array.isArray(theme.tags)||theme.tags.length>32||theme.tags.some(v=>!text(v,64)))errors.push('Invalid tags');
  if(!Array.isArray(theme.supportedRatios)||!theme.supportedRatios.length||theme.supportedRatios.some(v=>!['16:9','4:3'].includes(v))||new Set(theme.supportedRatios).size!==theme.supportedRatios.length)errors.push('Invalid supportedRatios');
  if(!object(theme.tokens))errors.push('tokens must be an object');
  else {
    const t=theme.tokens;
    for(const k of ['colors','typography','spacing','components'])if(!object(t[k]))errors.push(`tokens.${k} must be an object`);
    for(const [key,v] of Object.entries(object(t.colors)?t.colors:{}))if(typeof v!=='string'||!/^#[a-fA-F0-9]{6}(?:[a-fA-F0-9]{2})?$/.test(v))errors.push(`Invalid color: ${key}`);
    for(const [role,v] of Object.entries(object(t.typography)?t.typography:{})) {
      if(!object(v)){errors.push(`Invalid typography role: ${role}`);continue;}
      if(!text(v.fontFamily,200)||/[;{}<>\n\r]/.test(v.fontFamily))errors.push(`Invalid fontFamily: ${role}`);
      if(!Array.isArray(v.fallback)||!v.fallback.length||v.fallback.some(f=>!text(f,100)||/[;{}<>\n\r]/.test(f)))errors.push(`Font fallback required: ${role}`);
      if(!text(v.license))errors.push(`Font license required: ${role}`);
      if(!bounded(v.fontSize,6,240))errors.push(`Invalid fontSize: ${role}`);
      if(v.fontWeight!==undefined&&(!Number.isInteger(v.fontWeight)||!bounded(v.fontWeight,100,900)))errors.push(`Invalid fontWeight: ${role}`);
      if(v.lineHeight!==undefined&&!bounded(v.lineHeight,0.5,4))errors.push(`Invalid lineHeight: ${role}`);
    }
    for(const [key,v] of Object.entries(object(t.spacing)?t.spacing:{}))if(!bounded(v,0,512))errors.push(`Invalid spacing: ${key}`);
    for(const [key,v] of Object.entries(object(t.components)?t.components:{})) {
      if(!object(v)){errors.push(`Component style must be an object: ${key}`);continue;}
      const styleBounds={fontSize:[6,240],fontWeight:[100,900],lineHeight:[0.5,4],opacity:[0,1],borderWidth:[0,64],borderRadius:[0,512],padding:[0,512],gap:[0,512]};
      const checkStyle=style=>{for(const [k,x]of Object.entries(style)){if(styleBounds[k]&&!bounded(x,...styleBounds[k]))errors.push(`Invalid component ${k}: ${key}`);if(object(x))checkStyle(x);}};
      checkStyle(v);
    }
    if(t.motion!==undefined){if(!object(t.motion)||!bounded(t.motion.durationMs,0,10000)||!['linear','ease','ease-in','ease-out','ease-in-out'].includes(t.motion.easing))errors.push('Invalid motion');}
  }
  const layoutIds=new Set();
  if(!Array.isArray(theme.layouts)||theme.layouts.length>32)errors.push('Invalid layouts');
  else for(const layout of theme.layouts){
    if(!object(layout)||!text(layout.id,64)||layoutIds.has(layout.id)||!['cover','section','content','data','image'].includes(layout.kind)||!object(layout.rules)){errors.push('Invalid or duplicate layout');continue;}
    layoutIds.add(layout.id);
    const checkRules=v=>{if(!v||typeof v!=='object')return;for(const [k,x]of Object.entries(v)){if(['x','y','w','h','elements','slides'].includes(k))errors.push('Layout must contain design rules, not coordinate snapshots');checkRules(x);}};
    checkRules(layout);
    for(const k of ['columns','gap','pageInset'])if(layout.rules[k]!==undefined&&!bounded(layout.rules[k],k==='columns'?1:0,k==='columns'?12:512))errors.push(`Invalid layout ${k}`);
  }
  let total=0;const assetIds=new Set();
  if(!Array.isArray(theme.assets)||theme.assets.length>THEME_LIMITS.assets)errors.push('Invalid assets');
  else for(const asset of theme.assets){
    if(!object(asset)||!text(asset.id,128)||assetIds.has(asset.id)||!hashPattern.test(asset.hash)||!text(asset.license)){errors.push('Invalid or duplicate asset identity, hash or license');continue;}
    assetIds.add(asset.id);
    try{const bytes=bytesOf(asset);total+=bytes.length;if(bytes.length>THEME_LIMITS.assetBytes)errors.push('Asset exceeds size limit');if(!matchesImage(bytes,asset.mimeType))errors.push('Asset format or signature not supported');}catch(e){errors.push(e.message);}
  }
  if(total>THEME_LIMITS.totalAssetBytes)errors.push('Total assets exceed size limit');
  return {valid:errors.length===0,errors,warnings};
}
/** V1 is the first package contract: future schemas fail closed, unknown safe fields survive. */
export function importTheme(input) {
  let theme;try{if(typeof input==='string'&&utf8(input).length>THEME_LIMITS.packageBytes)fail('Theme package exceeds size limit');theme=cloneJSON(typeof input==='string'?JSON.parse(input):input);}catch(e){if(e instanceof CoreError)throw e;fail('Invalid theme JSON');}
  const result=validateTheme(theme);if(!result.valid)fail('Theme validation failed',result);return theme;
}
function canonical(value){if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(object(value))return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;return JSON.stringify(value);}
async function sha256(bytes){return 'sha256:'+Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
export async function verifyThemeAssets(input) {
  const theme=importTheme(input);
  for(const asset of theme.assets)if(await sha256(bytesOf(asset))!==asset.hash)fail(`Asset hash mismatch: ${asset.id}`);
  return theme;
}
export async function createThemeRef(input) {
  const snapshot=await verifyThemeAssets(input);
  return {id:snapshot.id,version:snapshot.version,hash:await sha256(utf8(canonical(snapshot))),snapshot};
}
export async function validateThemeRef(input) {
  const errors=[],warnings=[];
  try {const ref=cloneJSON(input);if(!object(ref)||!hashPattern.test(ref.hash))fail('Invalid theme reference');const expected=await createThemeRef(ref.snapshot);if(ref.id!==expected.id||ref.version!==expected.version||ref.hash!==expected.hash)fail('Theme reference does not match snapshot');}
  catch(e){errors.push(e.message);}
  return {valid:errors.length===0,errors,warnings};
}
/** Arrays replace; nested objects cascade; explicit null remains an override. No values are executed. */
export function resolveThemeStyle({defaults={},global={},component={},page={},manual={}}={}) {
  const merge=(target,source)=>{for(const [key,value]of Object.entries(source)){target[key]=object(value)?merge(object(target[key])?target[key]:{},value):value;}return target;};
  let result={};for(const layer of [defaults,global,component,page,manual]){const value=cloneJSON(layer);if(!object(value))fail('Style layer must be an object');result=merge(result,value);}return result;
}

import {inspectRasterDataURL} from './image-assets.js';
import { importDocument } from '../core/document-core.js';
import { revealJS, revealCSS } from '../vendor/reveal-bundle.js';

export const RENDERER_LIMITATIONS = Object.freeze([
  'Generic framework preview only; the authoritative editor adapter is not integrated.',
  'Plain multiline text and system fonts; rich text, custom fonts, crop, groups, arbitrary SVG and complex charts are unsupported.',
  'Basic rectangles, ellipses, lines/connectors, raster images, plain tables and bar charts only.',
  'Reveal page navigation/transitions and ordered appear fragments only; complex timelines and triggers are preserved but not played.'
]);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = (v, fallback=0) => typeof v === 'number' && Number.isFinite(v) ? Math.max(-100000,Math.min(100000,v)) : fallback;
const color = (v, fallback='#24324b') => typeof v === 'string' && /^(#[\da-f]{3,8}|[a-z]{1,20}|rgba?\([\d.,%\s]+\))$/i.test(v) ? v : fallback;
const raster = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const transition = v => ['none','fade','slide','convex','concave','zoom'].includes(v) ? v : 'fade';

/** Capability diagnostics are about visual fidelity, independent of lossless JSON preservation. */
export function inspectRenderCompatibility(document) {
 const doc=importDocument(document),warnings=[];
 const add=(slide,el,properties,message)=>warnings.push({code:'RENDER_UNSUPPORTED',slideId:slide.id,elementId:el.id,properties,message});
 for(const slide of doc.slides)for(const el of slide.elements){
  if(!['text','shape','image','connector','line','table','chart'].includes(el.type))add(slide,el,['type'],'Generic preview shows a placeholder for '+el.type);
  if(el.type==='image'){
   const props=[];if(Array.isArray(el.crop)&&el.crop.some(v=>v!==0))props.push('crop');
   for(const [key,fallback]of Object.entries({brightness:100,contrast:100,saturation:100,grayscale:0,flipH:false,flipV:false,cornerRadius:0}))if(el[key]!==undefined&&el[key]!==fallback)props.push(key);
   if(el.fit&&el.fit!=='contain')props.push('fit');
   if(props.length)add(slide,el,props,'Image appearance settings are preserved as data but not painted by the generic renderer');
  }
  if(el.type==='shape'&&el.shape&&!['rect','rectangle','ellipse','circle','line','arrow'].includes(el.shape))add(slide,el,['shape'],'This shape is shown as a basic rectangle');
  if(el.type==='chart'&&el.chartType&&el.chartType!=='bar')add(slide,el,['chartType'],'Only basic bar charts are painted');
  if(el.motionEffects?.length)add(slide,el,['motionEffects'],'Legacy motion effects require the authoritative animation runtime');
  const textProps=[];if(el.runs?.length)textProps.push('runs');if(el.fontFamily&&!['Arial','sans-serif'].includes(el.fontFamily))textProps.push('fontFamily');if(el.align&&el.align!=='left')textProps.push('align');if(el.bold&&el.fontWeight===undefined)textProps.push('bold');if(textProps.length)add(slide,el,textProps,'Text formatting needs the authoritative editor renderer');
 }
 for(const slide of doc.slides)for(const animation of slide.animations||[])if(!['appear','fragment','fade-in'].includes(animation.type)||animation.trigger!=='click'||animation.delay>0)add(slide,{id:animation.targetId},['animations'],'Only ordered click/appear fragments are supported');
 return {hasKnownGaps:warnings.length>0,warnings,scope:'Known generic-renderer gaps only; not a complete visual-fidelity check',limitations:[...RENDERER_LIMITATIONS]};
}

function assertSafeResources(doc) {
  const checked=new Map();const validateImage=source=>{if(!checked.has(source))checked.set(source,inspectRasterDataURL(source));return checked.get(source);};
  const visit = (v, path='document') => {
    if (!v || typeof v !== 'object') return;
    for (const [key,value] of Object.entries(v)) {
      if (typeof value === 'string') {
        if (/^(src|href|url|dataUrl|source|fontUrl)$/i.test(key) && value && !raster.test(value)) throw new Error(`Unsupported or external resource at ${path}.${key}; use embedded raster data URLs`);
        if (/^(html|svg|innerHTML|script|css|styleText)$/i.test(key) && value) throw new Error(`Unsafe raw markup/style at ${path}.${key}`);
        if (/^(src|href|url|dataUrl|source|fontUrl)$/i.test(key) && raster.test(value)) validateImage(value);
        if (/(?:url\s*\(|@import)/i.test(value) && /style|fill|background|font|stroke/i.test(key)) throw new Error(`External CSS resources are unsupported at ${path}.${key}`);
      }
      visit(value, `${path}.${key}`);
    }
  };
  visit(doc);
  for (const asset of doc.assets || []) {
    const value = asset.dataUrl ?? asset.src ?? asset.data;
    if (typeof value !== 'string' || !raster.test(value)) throw new Error(`Asset ${asset.id || '(unknown)'} is not an embedded raster image; offline export refused`);
    const info=validateImage(value);if(asset.mimeType&&(typeof asset.mimeType!=='string'||asset.mimeType.replace('image/jpg','image/jpeg')!==info.mimeType))throw new Error('Asset MIME declaration does not match embedded bytes');
  }
  for (const slide of doc.slides) for (const el of slide.elements) {
    if (['svg','html','iframe','script','video','audio'].includes(el.type)) throw new Error(`Unsafe or unsupported active element type: ${el.type}`);
    if (el.type === 'image' && !raster.test(imageSource(doc,el) || '')) throw new Error(`Image ${el.id} has no embedded supported raster asset`);
    if(el.type==='image')validateImage(imageSource(doc,el));
  }
}
function imageSource(doc,el) {
  const asset = (doc.assets || []).find(a => a.id === el.assetId);
  return el.src ?? el.dataUrl ?? asset?.dataUrl ?? asset?.src ?? asset?.data;
}
function textSVG(text,x,y,fontSize,fill,weight='normal') {
  return `<text x="${x}" y="${y}" fill="${color(fill)}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="${weight === 'bold' || weight === 700 ? 'bold':'normal'}">${String(text ?? '').split('\n').map((line,i)=>`<tspan x="${x}" dy="${i ? fontSize*1.2 : 0}">${esc(line)}</tspan>`).join('')}</text>`;
}
function elementSVG(doc,el,fragmentIndex) {
  if (el.hidden) return '';
  const x=num(el.x),y=num(el.y),w=Math.max(0,num(el.w,160)),h=Math.max(0,num(el.h,60));
  const fill=color(el.fill,'#e8eef7'),stroke=color(el.stroke,'#5272a1');
  let body='';
  switch(el.type) {
    case 'text': body=textSVG(el.text,x,y+num(el.fontSize,28),num(el.fontSize,28),el.color,el.fontWeight); break;
    case 'image': body=`<image x="${x}" y="${y}" width="${w}" height="${h}" href="${esc(imageSource(doc,el))}" preserveAspectRatio="xMidYMid meet"/>`; break;
    case 'shape':
      if (['ellipse','circle'].includes(el.shape)) body=`<ellipse cx="${x+w/2}" cy="${y+h/2}" rx="${w/2}" ry="${h/2}" fill="${fill}" stroke="${stroke}"/>`;
      else if (['line','arrow'].includes(el.shape)) body=`<line x1="${x}" y1="${y}" x2="${x+w}" y2="${y+h}" stroke="${stroke}" stroke-width="${num(el.strokeWidth,3)}" ${el.shape==='arrow'?'marker-end="url(#sp-arrow)"':''}/>`;
      else body=`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${num(el.radius,8)}" fill="${fill}" stroke="${stroke}"/>`;
      if (el.text) body+=textSVG(el.text,x+12,y+30,22,el.color); break;
    case 'connector': case 'line': body=`<line x1="${x}" y1="${y}" x2="${num(el.x2,x+w)}" y2="${num(el.y2,y+h)}" stroke="${stroke}" stroke-width="${num(el.strokeWidth,3)}" marker-end="url(#sp-arrow)"/>`;break;
    case 'table': {
      const rows=(Array.isArray(el.rows)?el.rows:Array.isArray(el.cells)?el.cells:[]).slice(0,100);
      const cols=Math.max(1,...rows.map(r=>Array.isArray(r)?r.length:0));
      rows.forEach((row,ri)=>(Array.isArray(row)?row:[]).slice(0,30).forEach((cell,ci)=>{body+=`<rect x="${x+ci*w/cols}" y="${y+ri*h/rows.length}" width="${w/cols}" height="${h/rows.length}" fill="${ri?'#f1f5fb':'#dce7f7'}" stroke="#b7c6db"/>`+textSVG(cell&&typeof cell==='object'?cell.text:cell,x+ci*w/cols+8,y+ri*h/rows.length+24,18,'#24324b');}));break;
    }
    case 'chart': {
      const values=Array.isArray(el.values)?el.values.slice(0,50).map(v=>Math.max(0,num(v))):[];
      const max=Math.max(1,...values);
      values.forEach((v,i)=>{const bw=w/values.length;body+=`<rect x="${x+i*bw+4}" y="${y+h-v/max*(h-30)}" width="${Math.max(1,bw-8)}" height="${v/max*(h-30)}" fill="${fill}"/>`+textSVG(el.labels?.[i]??v,x+i*bw+8,y+h+22,16,'#24324b');});break;
    }
    default:body=`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff3da" stroke="#ca8c23"/>`+textSVG(`Preview unsupported: ${el.type}`,x+8,y+24,16,'#795517');
  }
  return `<g opacity="${Math.max(0,Math.min(1,num(el.opacity,1)))}" data-element-id="${esc(el.id)}"${fragmentIndex == null?'':` class="fragment" data-fragment-index="${fragmentIndex}"`}${el.rotation?` transform="rotate(${num(el.rotation)} ${x+w/2} ${y+h/2})"`:''}>${body}</g>`;
}
function slideSVG(doc,slide,fragments=false) {
  const animations=(slide.animations||[]).filter(a=>['appear','fragment','fade-in'].includes(a.type));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.canvas.width}" height="${doc.canvas.height}" viewBox="0 0 ${doc.canvas.width} ${doc.canvas.height}" role="img" aria-label="${esc(slide.title||doc.title)}"><title>${esc(slide.title||doc.title)}</title><desc>${esc(RENDERER_LIMITATIONS.join(' '))}</desc><defs><marker id="sp-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#5272a1"/></marker></defs><rect width="100%" height="100%" fill="${color(typeof slide.background==='string'?slide.background:slide.background?.color??slide.bg,'#ffffff')}"/>${slide.elements.map(el=>{const a=animations.find(a=>(a.targetId??a.targetElementId??a.elementId??a.target)===el.id);return elementSVG(doc,el,fragments ? (el.fragment===true?num(el.fragmentIndex,0):a?num(a.order,animations.indexOf(a)):null):null);}).join('')}</svg>`;
}
export function renderSlideSVG(document,slideId) {
  const doc=importDocument(document);assertSafeResources(doc);
  const slide=doc.slides.find(s=>s.id===slideId);if(!slide)throw new Error(`Unknown slide: ${slideId}`);
  return slideSVG(doc,slide);
}
export async function exportHTML(document) {
  const doc=importDocument(document);assertSafeResources(doc);
  const json=JSON.stringify(doc).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const sections=doc.slides.filter(s=>!s.hidden).map(s=>`<section data-slide-id="${esc(s.id)}" data-transition="${transition(s.transition)}">${slideSVG(doc,s,true)}</section>`).join('\n');
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="sp-format" content="superior-point/1"><title>${esc(doc.title)}</title><style>${revealCSS}</style><style>html,body{margin:0;background:#182033}.reveal .slides section{padding:0}.reveal svg{display:block;width:100%;height:auto}.sp-notice{position:fixed;bottom:4px;left:8px;z-index:99;color:#93a4bf;font:11px Arial;max-width:65%}</style></head><body><div class="reveal"><div class="slides">${sections}</div></div><div class="sp-notice" title="${esc(RENDERER_LIMITATIONS.join(' '))}">SP framework preview · Generic renderer · Re-import this HTML to recover full document</div><script id="sp-document" type="application/json">${json}</script><script>${revealJS.replace(/<\/script/gi,'<\\/script')}</script><script>window.spDeck = new Reveal(document.querySelector('.reveal'),{width:${doc.canvas.width},height:${doc.canvas.height},margin:0.04,hash:false,controls:true,progress:true,center:false,transition:'fade',embedded:false});window.spDeck.initialize().then(function(){document.documentElement.dataset.spReady='true';});</script></body></html>`;
}
export function importHTML(html) {
  if(typeof html!=='string'||html.length>64*1024*1024)throw new Error('Invalid or oversized HTML');
  // Only our exact inert data envelope is accepted. No DOM insertion, evaluation, or resource fetching.
  const matches=[...html.matchAll(/<script\s+id="sp-document"\s+type="application\/json"\s*>([\s\S]*?)<\/script\s*>/gi)];
  if(matches.length!==1)throw new Error('Expected exactly one inert SP document envelope; ordinary HTML is not supported');
  let data;try{data=JSON.parse(matches[0][1]);}catch{throw new Error('Corrupt SP JSON data');}
  const doc=importDocument(data);assertSafeResources(doc);return doc;
}

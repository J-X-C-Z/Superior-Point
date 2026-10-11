import {importDocument} from '../core/document-core.js';
import {exportHTML} from './html.js';
import {revealJS,revealCSS} from '../vendor/reveal-bundle.js';
import {legacyPlaybackBootstrap,legacyPresentationCSS} from '../vendor/editor-integrated-playback.js';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inert=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const script=value=>value.replace(/<\/script/gi,'<\\/script');
async function scriptHash(source){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));return "'sha256-"+btoa(String.fromCharCode(...new Uint8Array(bytes)))+"'";}

/** Candidate frame output is untrusted. Keep inert rendered markup, never frame-supplied code. */
export async function exportEditorHTML(input,renderedHTML,{domDocument=globalThis.document,audience=false}={}){
 const doc=importDocument(input);
 // Reuse existing strict document/resource checks, including raster bytes and raw markup refusal.
 await exportHTML(doc);
 if(typeof renderedHTML!=='string'||renderedHTML.length>50*1024*1024)throw new Error('候选渲染输出无效或过大');
 if(!domDocument?.createElement)throw new Error('候选编辑器导出需要浏览器DOM');
 const template=domDocument.createElement('template');template.innerHTML=renderedHTML;
 if(audience){
  const reveal=template.content.querySelector('.reveal');
  if(!reveal)throw new Error('候选渲染器没有生成可放映页面');
  const slides=reveal.querySelector('.slides');
  if(!slides)throw new Error('候选渲染器没有生成可放映页面');
  reveal.replaceChildren(slides);
  for(const node of [...slides.childNodes])if(node.nodeType!==1||node.localName!=='section')node.remove();
  const visible=new Set(doc.slides.filter(slide=>!slide.hidden).map(slide=>slide.id));
  for(const section of slides.children)if(!visible.has(section.dataset.slideId))section.remove();
  reveal.querySelectorAll('aside.notes,[data-v18-marker],style,script').forEach(node=>node.remove());
  template.content.replaceChildren(reveal);
 }
 const playbackAttributes=new Set('data-slide-id data-sp-transition-exit data-transition data-transition-speed data-background-transition data-background-color data-click-advance data-autoslide data-auto-animate data-auto-animate-duration data-auto-animate-easing data-auto-animate-id data-auto-animate-restart data-auto-animate-target data-fragment-index data-id data-v15-object-id data-v15-fx data-v15-kind data-v15-effect data-v15-trigger data-v15-delay data-v15-duration data-v15-easing'.split(' '));
 const allowed=new Set('style div section article span p br b strong i em u s small h1 h2 h3 h4 h5 h6 ul ol li table thead tbody tr th td img svg g defs path rect circle ellipse line polyline polygon text tspan marker clippath lineargradient radialgradient stop pattern use a video audio source'.split(' '));
 for(const el of [...template.content.querySelectorAll('*')]){
  if(!allowed.has(el.localName.toLowerCase())){el.remove();continue;}
  for(const attr of [...el.attributes]){
   const name=attr.name.toLowerCase(),value=attr.value;
   if(audience&&name==='style'){
    for(const property of [...el.style])if(property.startsWith('--')&&!['--sp-duration','--sp-delay','--sp-opacity'].includes(property))el.style.removeProperty(property);
   }
   if(audience&&((name.startsWith('data-')&&!playbackAttributes.has(name))||['title','aria-description'].includes(name)))el.removeAttribute(attr.name);
   else if(name.startsWith('on')||['srcdoc','formaction','action','target','download','ping','srcset','nonce'].includes(name))el.removeAttribute(attr.name);
   else if(['src','href','xlink:href','poster'].includes(name)&&!/^#[a-zA-Z0-9_-]+$/.test(value)&&!/^data:image\/(png|jpeg|jpg|gif|webp);base64,[a-zA-Z0-9+/]+={0,2}$/.test(value))el.removeAttribute(attr.name);
  }
 }
 if(!template.content.querySelector('.reveal .slides section'))throw new Error('候选渲染器没有生成可放映页面');
 const bootstrap=script(legacyPlaybackBootstrap+`;v15PlaybackBootstrap();Reveal.initialize({width:${doc.canvas.width},height:${doc.canvas.height},margin:.04,hash:false,center:false,controls:true,progress:true,slideNumber:'c/t',transition:'fade',backgroundTransition:'fade',autoAnimate:true,autoAnimateEasing:'cubic-bezier(.2,.8,.2,1)',autoAnimateDuration:.7,autoSlide:0}).then(()=>{window.SuperiorPointMotion?.attach(Reveal);document.documentElement.dataset.spReady='true';}).catch(()=>v24OfflineExportBootstrap(${doc.canvas.width},${doc.canvas.height}));`);
 const reveal=script(revealJS),csp=`default-src 'none'; script-src ${await scriptHash(reveal)} ${await scriptHash(bootstrap)}; style-src 'unsafe-inline'; img-src data:; media-src data:; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(csp)}"><title>${escape(doc.title)}</title><style>${revealCSS}${audience?legacyPresentationCSS(doc.canvas.width,doc.canvas.height):''}</style></head><body>${template.innerHTML}${audience?'':`<script id="sp-document" type="application/json">${inert(doc)}</script>`}<script>${reveal}</script><script>${bootstrap}</script></body></html>`;
}

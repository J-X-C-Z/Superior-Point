import {importDocument,CoreError} from './document-core.js';

const renderers=['editor','reveal','editable-html','audience-html','pptx'];
const fragments=new Set(['appear','fragment','fade-in']);
const editorEffects=new Set(['fade','float','zoom','fade-left','fade-right','wipe','fade-up','fade-down','wipe-left','wipe-right','wipe-top','wipe-bottom','appear','split-h','split-v','stretch-h','stretch-v','bounce','swivel','grow-turn','pulse','shake','spin','highlight-red','grow','blink','teeter','disappear']);
/** Diagnose current intent without synthesizing, replacing or deleting any animation. */
export function inspectThemeCompatibility(input,{theme,slideIds}={}){
 const document=importDocument(input),diagnostics=[];
 if(slideIds!==undefined&&(!Array.isArray(slideIds)||!slideIds.length||new Set(slideIds).size!==slideIds.length||slideIds.some(id=>!document.slides.some(s=>s.id===id))))throw new CoreError('INVALID_THEME_SCOPE','Selected slide IDs must be nonempty, unique and exist');
 for(const slide of document.slides){
  if(slideIds&&!slideIds.includes(slide.id))continue;
  const motion=(theme||document.extensions.theme?.slideRefs?.[slide.id]?.snapshot||document.extensions.theme?.ref?.snapshot)?.designLanguage?.motion;
  if(motion)for(const behavior of ['enter','exit','transition'])for(const renderer of renderers){
   const value=motion[behavior],available=value==='none'||(renderer==='editor'&&value==='fade')||(behavior==='transition'&&renderer!=='pptx'&&['fade','slide'].includes(value));
   diagnostics.push({renderer,status:available?'supported':renderer==='pptx'?'refused':'degraded',code:'THEME_MOTION_POLICY',slideId:slide.id,behavior,message:available?'Renderer supports this vocabulary; Skin preserves existing motion and does not create effects.':'Theme motion has no faithful mapping; existing intent is preserved and reported.'});
  }
  if(motion)for(const renderer of renderers)diagnostics.push({renderer,status:'degraded',code:'THEME_MOTION_POLICY',slideId:slide.id,behavior:'reducedMotion',message:`Reduced-motion policy (${motion.reducedMotion}) is recorded; Skin does not change existing animation or enforce browser reduced-motion playback.`});
  for(const animation of slide.animations||[])for(const renderer of renderers){
   const supported=renderer==='editor'?editorEffects.has(animation.type)||fragments.has(animation.type):renderer==='pptx'?false:fragments.has(animation.type)&&animation.trigger==='click'&&animation.delay===0;
   const unknown=!editorEffects.has(animation.type)&&!fragments.has(animation.type);
   diagnostics.push({renderer,status:supported?'supported':unknown||renderer==='pptx'?'refused':'degraded',code:'EXISTING_ANIMATION',slideId:slide.id,animationId:animation.id,message:supported?'Existing animation vocabulary is supported.':'Existing animation is preserved; this renderer cannot faithfully play it.'});
  }
 }
 return diagnostics;
}

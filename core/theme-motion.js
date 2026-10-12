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
   const value=motion[behavior],available=value==='none';
   diagnostics.push({renderer,status:available?'supported':renderer==='pptx'?'refused':'degraded',code:'THEME_MOTION_POLICY',slideId:slide.id,behavior,message:available?'No new motion requested; Skin preserves existing motion.':'Theme motion has no faithful mapping; existing intent is preserved and reported.'});
  }
  if(motion)for(const renderer of renderers){const generic=['reveal','editable-html','audience-html'].includes(renderer);diagnostics.push({renderer,status:generic&&motion.reducedMotion==='none'?'supported':'degraded',code:'THEME_MOTION_POLICY',slideId:slide.id,behavior:'reducedMotion',message:generic?'Generic HTML export honors browser reduced-motion with no transitions or animation; click fragments remain navigable. A requested fade degrades to none.':`Reduced-motion policy (${motion.reducedMotion}) is recorded; Skin does not change existing animation or enforce native editor/PPTX playback.`});}
  if(slide.transition)for(const renderer of renderers){const supported=renderer==='editor'?['none','fade','slide','zoom','convex','concave','morph'].includes(slide.transition):renderer!=='pptx'&&['none','fade','slide','zoom','convex','concave'].includes(slide.transition);diagnostics.push({renderer,status:supported?'supported':renderer==='pptx'?'refused':'degraded',code:'SLIDE_TRANSITION',slideId:slide.id,message:supported?'Existing slide transition vocabulary is recognized; native and generic rendering differ.':renderer==='pptx'?'PPTX transition playback is not implemented or validated.':'Existing transition cannot be faithfully rendered; generic HTML falls back to fade.'});}
  for(const animation of slide.animations||[])for(const renderer of renderers){
   const supported=renderer==='editor'?editorEffects.has(animation.type)||fragments.has(animation.type):renderer==='pptx'?false:fragments.has(animation.type)&&animation.trigger==='click'&&animation.delay===0;
   const unknown=!editorEffects.has(animation.type)&&!fragments.has(animation.type);
   diagnostics.push({renderer,status:supported?'supported':unknown||renderer==='pptx'?'refused':'degraded',code:unknown?'UNKNOWN_MOTION':'EXISTING_ANIMATION',slideId:slide.id,animationId:animation.id,message:supported?(renderer==='editor'?'Native editor vocabulary is recognized; actual playback fidelity requires editor acceptance.':'Generic HTML plays an ordered click fragment; timing and native effect styling are not reproduced.'):'Existing animation is preserved; this renderer cannot faithfully play it.'});
  }
 }
 return diagnostics;
}

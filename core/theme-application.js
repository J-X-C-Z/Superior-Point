import {cloneJSON,importDocument,CoreError} from './document-core.js';
import {createThemeRef,resolveThemeStyle} from './theme-schema.js';
import {inspectThemeCompatibility} from './theme-motion.js';

const fields=new Set(['fontFamily','fontSize','fontWeight','bold','lineHeight','color','fill','stroke','strokeWidth','radius','chartColor','align']);
const colors=new Set(['color','fill','stroke','chartColor']);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function knownStyle(raw={}){
 const style={};
 for(const [key,value] of Object.entries(raw)){
  if(!fields.has(key))continue;
  const valid=colors.has(key)?typeof value==='string'&&/^#[a-fA-F0-9]{6}(?:[a-fA-F0-9]{2})?$/.test(value):key==='fontFamily'?typeof value==='string'&&value.length>0&&value.length<=200&&!/[;{}<>\n\r]/.test(value):key==='bold'?typeof value==='boolean':key==='align'?['left','center','right','justify'].includes(value):key==='fontWeight'?Number.isInteger(value)&&value>=100&&value<=900:typeof value==='number'&&Number.isFinite(value)&&value>=(key==='fontSize'?6:key==='lineHeight'?0.5:0)&&value<=(key==='fontSize'?240:key==='lineHeight'?4:512);
  if(!valid)throw new CoreError('INVALID_THEME_STYLE','Invalid supported theme style: '+key);
  style[key]=value;
 }
 return style;
}
function fontStyle(font){if(!font)return {};return {fontFamily:font.fontFamily,fontSize:font.fontSize,fontWeight:font.fontWeight??400,bold:(font.fontWeight??400)>=700,lineHeight:font.lineHeight??1.25};}
export function themeElementStyle(theme,element,slide={}){
 const role=element.themeRole||(element.type==='text'?'body':element.type==='chart'?'chart':'panel'),{colors:c,typography:t,components}=theme.tokens;
 let global={};
 if(element.type==='text')global={color:c.text||'#252525',...fontStyle(t[role]||t.body)};
 else if(element.type==='shape')global={fill:role==='accent'?(c.accent||c.text||'#606760'):(c.surface||c.background||'#FFFFFF'),stroke:role==='accent'?(c.accent||c.text||'#606760'):(c.muted||c.text||'#252525')};
 else if(element.type==='chart')global={fill:components.chart?.surface||c.surface||c.background||'#FFFFFF',chartColor:components.chart?.color||c.accent||'#606760',color:components.chart?.text||c.text||'#252525'};
 else return {};
 if(element.type==='text'&&role==='caption')global.color=c.muted||c.text||'#252525';
 const component=knownStyle(components[role]);
 const overrides=slide.themeOverrides||{},page=knownStyle({...overrides,...overrides.components?.[role]});
 const style=resolveThemeStyle({global:knownStyle(global),component,page});
 if('bold' in page&&!('fontWeight' in page))style.fontWeight=style.bold?700:400;
 else if('fontWeight' in page)style.bold=style.fontWeight>=700;
 else if('bold' in component&&!('fontWeight' in component))style.fontWeight=style.bold?700:400;
 else if('fontWeight' in component)style.bold=style.fontWeight>=700;
 return style;
}
/** Baselines are recorded only for fields generated from this theme, never inferred from manual values. */
export function createThemeBindings(document){
 const bindings={slides:{},elements:{}};
 for(const slide of document.slides){bindings.slides[slide.id]={};if(slide.background!==undefined)bindings.slides[slide.id].background=cloneJSON(slide.background);bindings.elements[slide.id]={};for(const element of slide.elements){if(!element.themeRole)continue;bindings.elements[slide.id][element.id]={};for(const key of fields)if(Object.hasOwn(element,key))bindings.elements[slide.id][element.id][key]=cloneJSON(element[key]);}}
 return bindings;
}
/** Pure preview plan; commit all operations once through Core with the caller's expected revision and lease. */
export async function planThemeApplication(input,theme,{mode='preserve',slideIds}={}){
 if(!['preserve','reset'].includes(mode))throw new CoreError('INVALID_THEME_MODE','Unknown theme application mode');
 const document=importDocument(input),ref=await createThemeRef(theme),snapshot=ref.snapshot;
 if(slideIds!==undefined&&(!Array.isArray(slideIds)||!slideIds.length||new Set(slideIds).size!==slideIds.length||slideIds.some(id=>!document.slides.some(s=>s.id===id))))throw new CoreError('INVALID_THEME_SCOPE','Selected slide IDs must be nonempty, unique and exist');
 const selected=new Set(slideIds??document.slides.map(s=>s.id)),all=selected.size===document.slides.length;
 const ratio=document.canvas.width/document.canvas.height;
 if(!snapshot.supportedRatios.some(value=>Math.abs(ratio-(value==='16:9'?16/9:4/3))<0.001))throw new CoreError('THEME_RATIO_UNSUPPORTED','主题不支持当前文稿比例');
 const prior=document.extensions.theme?.bindings||{},bindings=cloneJSON({slides:prior.slides||{},elements:prior.elements||{}}),operations=[],changes=[],manualOverrides=[];
 const slideRefs=cloneJSON(document.extensions.theme?.slideRefs||{});
 // Pin old effective snapshots before changing the default reference in a mixed-theme document.
 for(const slide of document.slides)if(!selected.has(slide.id)&&!slideRefs[slide.id]&&document.extensions.theme?.ref)slideRefs[slide.id]=cloneJSON(document.extensions.theme.ref);
 const update=(target,desired,oldBinding,location)=>{const properties={},baseline={};for(const [property,after] of Object.entries(desired)){const exists=Object.hasOwn(target,property),driven=Object.hasOwn(oldBinding||{},property)&&same(target[property],oldBinding[property]);if(mode==='preserve'&&exists&&!driven){manualOverrides.push({...location,property,value:cloneJSON(target[property])});continue;}baseline[property]=cloneJSON(after);if(!exists||!same(target[property],after)){properties[property]=after;changes.push({property,...(exists?{before:cloneJSON(target[property])}:{}),after:cloneJSON(after)});}}return {properties,baseline};};
 for(const slide of document.slides){
  if(!selected.has(slide.id))continue;
  if(all)delete slideRefs[slide.id];else slideRefs[slide.id]=cloneJSON(ref);
  bindings.elements[slide.id]={};
  const override=slide.themeOverrides?.background,background=override??snapshot.tokens.colors.background??'#FFFFFF';
  if(typeof background!=='string'||!/^#[a-fA-F0-9]{6}(?:[a-fA-F0-9]{2})?$/.test(background))throw new CoreError('INVALID_THEME_STYLE','Invalid page background override');
  let offset=changes.length;const page=update(slide,{background},prior.slides?.[slide.id],{slideId:slide.id});bindings.slides[slide.id]=page.baseline;
  for(const change of changes.slice(offset))change.slideId=slide.id;
  if(Object.keys(page.properties).length)operations.push({type:'updateSlide',slideId:slide.id,properties:page.properties});
  for(const element of slide.elements){
   const style=themeElementStyle(snapshot,element,slide),old=prior.elements?.[slide.id]?.[element.id];
   // A legacy explicit weight/bold pair remains manual even when only one field was stored.
   if(mode==='preserve'&&element.type==='text'){
    if(['bold','fontWeight'].some(key=>Object.hasOwn(element,key)&&(!Object.hasOwn(old||{},key)||!same(element[key],old[key])))){for(const key of ['bold','fontWeight'])if(Object.hasOwn(element,key))manualOverrides.push({slideId:slide.id,elementId:element.id,property:key,value:cloneJSON(element[key])});delete style.fontWeight;delete style.bold;}
   }
   offset=changes.length;const result=update(element,style,old,{slideId:slide.id,elementId:element.id});bindings.elements[slide.id][element.id]=result.baseline;
   for(const change of changes.slice(offset)){change.slideId=slide.id;change.elementId=element.id;}
   if(Object.keys(result.properties).length)operations.push({type:'updateElement',slideId:slide.id,elementId:element.id,properties:result.properties});
  }
 }
 operations.push({type:'updateProject',properties:{extensions:{...document.extensions,theme:{...document.extensions.theme,...(all?{ref}:{}),bindings,slideRefs}}}});
 return {operations,changes,ref,scope:{type:all?'all':'slides',slideIds:[...selected]},manualOverrides,summary:{styleChanges:changes.length,manualOverrides:manualOverrides.length,preservedOverrides:manualOverrides.length,selectedSlides:selected.size},motionDiagnostics:inspectThemeCompatibility(document,{theme:snapshot,...(all?{}:{slideIds:[...selected]})}),limitations:['仅应用受支持的颜色、字体、背景和组件样式；布局坐标、内容、图像、备注与动画保持原样。','重置模式需调用方先确认；旧文稿的显式样式在保留模式中视为手工设置。','系统字体取决于设备；通用 SVG 字体与行距可能降级。']};
}

/** Candidate-only mapping. Source editor stays unchanged; Core owns identity/revision/history. */
import {cloneJSON,createDocument,importDocument} from '../core/document-core.js';
import {hiddenElementIds} from '../io/visibility.js';
const SLIDE={bg:'#f2f1ec',hidden:false,transition:'fade',duration:600,autoSec:0,advanceOnClick:true,transitionEnter:'',transitionExit:'',backgroundTransition:'fade',morphEase:'cubic-bezier(.22,1,.36,1)',morphGroup:'',notes:'',comments:[]};
const OBJECT={name:'对象',rotation:0,opacity:1,fill:'transparent',stroke:'transparent',strokeWidth:0,text:'',fontFamily:'Arial',fontSize:28,color:'#161715',bold:false,italic:false,align:'left',valign:'middle',padding:0,anim:'none',visible:true,locked:false};
const ROOT={version:1,themeId:'noema',themeAccent:'#d75c3c',guides:[],reviewAuthor:'本地用户',reviewHistory:[],motion:{defaultAutoSec:5,backgroundTransition:'fade'},master:{enabled:false,footer:'',pageNumber:false,accentLine:false,skipFirst:false},metadata:{author:'',description:'',keywords:''}};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const mapping=o=>o.spEditorMapping?.version===1?cloneJSON(o.spEditorMapping):{version:1};
const animationType=type=>['appear','fragment','fade-in'].includes(type)?'fade':type;
const emphasisTypes=new Set(['spin','pulse','shake','highlight-red','grow']);
function projectAnimations(o,animations,previous){
 // Native timelines are richer than Core's animation contract. Preserve their source
 // fields until an actual Core animation edit changes the last projected snapshot.
 if((previous&&!same(previous.canonical,animations))||(!previous&&animations.length)){
  if(animations.length){
   const first=animations[0];o.anim=animationType(first.type);o.fragmentIndex=first.order;o.animDuration=first.duration*1000;o.animDelay=first.delay*1000;
   if(Array.isArray(o.motionEffects)||animations.length>1||first.trigger!=='click'||emphasisTypes.has(first.type)){
    o.motionEffects=animations.map(a=>({...o.motionEffects?.find(e=>e.id===a.id),id:a.id,kind:emphasisTypes.has(a.type)?'emphasis':'entrance',effect:animationType(a.type),step:a.order,trigger:a.trigger,delay:a.delay*1000,duration:a.duration*1000,easing:a.easing}));
    o.anim='none';
   }
  }else{o.anim='none';if(Array.isArray(o.motionEffects))o.motionEffects=[];}
 }
 return {targetId:o.id,canonical:cloneJSON(animations)};
}
function checkGroups(groups,animations){
 const ids=new Set(groups.map(g=>g.id));
 if(groups.some(g=>g.children.some(id=>ids.has(id)))||animations.some(a=>ids.has(a.targetId))){
  const error=new Error('候选编辑器暂不支持嵌套 Core 组合或组合整体动画；请先在 Core 中取消组合。原始文档未改变。');
  error.code='EDITOR_UNSUPPORTED_GROUP';throw error;
 }
}
export function isEditorCandidateDocument(doc){return ['0.38','0.39'].includes(doc?.extensions?.editorCandidate?.sourceVersion);}
export function canonicalToEditor(input){
 const doc=importDocument(input),prior=doc.extensions.editorCandidate?.projectFields||{};
 const deck={...cloneJSON(ROOT),...cloneJSON(prior),version:1,name:doc.title,width:doc.canvas.width,height:doc.canvas.height};
 deck.metadata={...ROOT.metadata,createdAt:doc.metadata.createdAt,...(prior.metadata||{})};
 deck.slides=doc.slides.map(slide=>{
  const {elements,...fields}=slide,output={...SLIDE,...fields},slideMapping=mapping(slide);
  if(typeof slide.background==='string'){
   output.bg=slide.background;output.background={type:'solid',color:slide.background};
   slideMapping.background={canonical:slide.background,native:cloneJSON(output.background),bg:output.bg};
  }
  const groups=elements.filter(e=>e.type==='group'),hidden=hiddenElementIds(slide);checkGroups(groups,slide.animations||[]);
  output.spCanonicalGroups=groups;
  slideMapping.groupOrder=elements.map(e=>e.id);
  output.spEditorMapping=slideMapping;
  output.objects=elements.filter(e=>e.type!=='group').map(element=>{
   const o={...OBJECT,...element},source=mapping(element);
   if(hidden.has(o.id)&&o.visible!==false){
    source.visibility={...(Object.hasOwn(element,'visible')?{visible:element.visible}:{}),native:false};o.visible=false;
   }else delete source.visibility;
   if(o.type==='image'&&o.assetId){
    const asset=doc.assets.find(a=>a.id===o.assetId),src=asset?.dataUrl??asset?.src??asset?.data;
    // A changed src belongs to this image only. Never overwrite a shared asset.
    if(source.image&&o.src!==source.image.src&&o.assetId===source.image.assetId)delete o.assetId;
    else if(src!==undefined&&(o.src===undefined||(source.image&&o.src===source.image.src)))o.src=src;
    if(o.assetId)source.image={assetId:o.assetId,...(o.src!==undefined?{src:o.src}:{})};else delete source.image;
   }else delete source.image;
   if(o.type==='table'){
    if(Array.isArray(o.rows)){
     const rows=cloneJSON(o.rows);o.cells=rows.map(row=>row.map(v=>String(v??'')));
     source.table={rows,cells:cloneJSON(o.cells)};o.spCanonicalRows=true;o.rows=o.cells.length;o.cols=Math.max(1,...o.cells.map(r=>r.length));
    }
    o.cells??=[];o.merges??=[];o.cellStyles??={};o.rows??=o.cells.length;o.cols??=o.cells[0]?.length||1;
   }
   if(o.type==='connector'){o.fromId=o.sourceId??o.fromId??'';o.toId=o.targetId??o.toId??'';o.arrowEnd??=true;o.stroke=element.stroke??'#161715';o.strokeWidth=element.strokeWidth??2;}
   const parent=groups.find(g=>g.children.includes(o.id));
   if(parent){o.groupId=parent.id;source.groupId=parent.id;}
   else if(source.groupId){if(o.groupId===source.groupId)delete o.groupId;delete source.groupId;}
   source.animation=projectAnimations(o,(slide.animations||[]).filter(a=>a.targetId===o.id),source.animation);
   o.spEditorMapping=source;
   return o;
  });
  return output;
 });
 if(!deck.slides.length)deck.slides=[{...SLIDE,id:doc.id+'-empty-slide',objects:[],animations:[],spCanonicalGroups:[]}];
 return cloneJSON(deck);
}
export function editorToCanonical(input,{baseDocument}={}){
 const project=cloneJSON(input);
 if(!project||project.version!==1||typeof project.name!=='string'||!Array.isArray(project.slides)||!project.slides.length)throw new Error('候选编辑器项目格式无效');
 const base=baseDocument?importDocument(baseDocument):createDocument({title:project.name});
 const {slides,name,width,height,...projectFields}=project;
 const doc={...base,title:name,canvas:{...base.canvas,width,height},slides:slides.map(slide=>{
  if(!Array.isArray(slide.objects))throw new Error('候选编辑器页面缺少对象列表');
  const {objects,spCanonicalGroups=[],...fields}=slide,slideMapping=mapping(slide);
  checkGroups(spCanonicalGroups,fields.animations||[]);
  const elements=objects.map(raw=>{
   const o=cloneJSON(raw),source=mapping(o);
   // Native visibility also projects Core hidden/group state; restore unedited child flags.
   if(source.visibility&&o.visible===source.visibility.native){
    if(Object.hasOwn(source.visibility,'visible'))o.visible=source.visibility.visible;else delete o.visible;
   }else if(o.visible!==false&&o.hidden)o.hidden=false;
   delete source.visibility;
   if(o.type==='image'&&source.image&&o.assetId===source.image.assetId&&o.src!==source.image.src){delete o.assetId;delete source.image;}
   if(o.type==='connector'){if(o.fromId)o.sourceId=o.fromId;else delete o.sourceId;if(o.toId)o.targetId=o.toId;else delete o.targetId;}
   if(o.type==='table'&&o.spCanonicalRows){
    const prior=source.table;
    o.rows=o.cells.map((row,r)=>row.map((value,c)=>prior&&Object.hasOwn(prior.rows[r]||[],c)&&same(value,prior.cells[r]?.[c])?cloneJSON(prior.rows[r][c]):value));
    delete o.spCanonicalRows;
   }
   // Record native-origin animations too, so unrelated edits do not replace them.
   if(!source.animation||(source.animation.targetId&&source.animation.targetId!==o.id))source.animation={targetId:o.id,canonical:cloneJSON((fields.animations||[]).filter(a=>a.targetId===o.id))};
   o.spEditorMapping=source;
   return o;
  });
  // Flat Core groups use native membership flags. Empty source groups survive;
  // explicit ungroup/delete in the native editor removes formerly nonempty ones.
  for(const group of spCanonicalGroups){
   const members=elements.filter(e=>e.groupId===group.id).map(e=>e.id);
   const children=[...group.children.filter(id=>members.includes(id)),...members.filter(id=>!group.children.includes(id))];
   if(children.length||!group.children.length){
    const order=slideMapping.groupOrder||[],index=order.indexOf(group.id);
    const before=index<0?-1:elements.findIndex(e=>order.indexOf(e.id)>index);
    elements.splice(before<0?elements.length:before,0,{...group,children});
   }
  }
  const ids=new Set(elements.map(e=>e.id));
  const animations=(fields.animations||[]).filter(a=>ids.has(a.targetId));
  if(slideMapping.background&&same(fields.background,slideMapping.background.native))fields.background=fields.bg!==slideMapping.background.bg?fields.bg:slideMapping.background.canonical;
  else if(slideMapping.background){
   if(fields.background?.type==='solid')fields.background=fields.background.color;
   delete slideMapping.background;
  }
  return {...fields,spEditorMapping:slideMapping,elements,animations};
 }),extensions:{...base.extensions,editorCandidate:{...base.extensions.editorCandidate,sourceVersion:'0.39',candidate:true,projectFields}}};
 return importDocument(doc);
}

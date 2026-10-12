import {importTheme,THEME_FORMAT,THEME_SCHEMA_VERSION} from './theme-schema.js';

const systemFontLicense='System font reference only; no font files redistributed. Availability depends on the device.';
const font=(fontFamily,fontSize,fontWeight=400)=>({fontFamily,fallback:['Arial','sans-serif'],fontSize,fontWeight,lineHeight:1.25,license:systemFontLicense});
const specifications=[
 {id:'sp-margin',name:'留白札记',tags:['editorial','minimal','阅读'],colors:['#F6F5F0','#252525','#606760','#E6E7DF','#595D55'],family:'Arial',size:52,inset:72,gap:32,columns:1,motif:'rule',radius:0,description:'宽页边距、细分隔线和安静的信息层级。'},
 {id:'sp-signal',name:'信号网格',tags:['grid','geometric','汇报'],colors:['#F8F8F5','#171717','#B52B19','#EBEAE3','#55534F'],family:'Arial',size:76,inset:52,gap:20,columns:2,motif:'index',radius:0,description:'强数字索引、双栏网格和鲜明几何标记。'},
 {id:'sp-folio',name:'书页叙事',tags:['magazine','serif','叙事'],colors:['#FCF5E9','#352D27','#794337','#EEE1D0','#6A584B'],family:'Georgia',size:64,inset:64,gap:36,columns:2,motif:'band',radius:0,description:'衬线大标题、书页边框和左右图文节奏。'},
 {id:'sp-caliper',name:'标尺精度',tags:['industrial','technical','规格'],colors:['#EEF3F5','#20323C','#185A79','#D9E6EC','#4C6370'],family:'Courier New',size:48,inset:44,gap:16,columns:2,motif:'frame',radius:0,description:'等宽标注、紧凑留白和规格面板。'},
 {id:'sp-hearth',name:'暖光故事',tags:['warm','rounded','分享'],colors:['#FFF5E8','#463B32','#9D4F24','#F2DFCA','#755B47'],family:'Verdana',size:54,inset:76,gap:28,columns:1,motif:'circle',radius:26,description:'柔和圆形、圆角故事面板和舒展段落。'},
 {id:'sp-orbit',name:'夜航轨道',tags:['dark','future','发布'],colors:['#141B2A','#F1F4FF','#B8C5FF','#26324B','#B8C4DD'],family:'Arial',size:70,inset:56,gap:24,columns:2,motif:'orbit',radius:18,description:'深色分层、轨道线和宽幅发布标题。'}
];
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
const catalog=specifications.map(s=>importTheme({
 format:THEME_FORMAT,schemaVersion:THEME_SCHEMA_VERSION,id:s.id,name:s.name,version:'1.0.0',author:'Superior Point',license:'MIT',
 provenance:'Original Superior Point theme; not an imported or licensed third-party Design System.',description:s.description,tags:s.tags,supportedRatios:['16:9','4:3'],
 tokens:{colors:{background:s.colors[0],text:s.colors[1],accent:s.colors[2],surface:s.colors[3],muted:s.colors[4]},typography:{title:font(s.family,s.size,700),body:font(s.family,26),caption:font(s.family,18)},spacing:{unit:8,pageInset:s.inset,gap:s.gap},components:{panel:{radius:s.radius,strokeWidth:s.motif==='frame'?2:0},accent:{motif:s.motif},chart:{chartType:'bar',color:s.motif==='orbit'?'#5064A3':s.colors[2],surface:'#F8FAFC',text:'#20323C'}},motion:{durationMs:0,easing:'linear'}},
 layouts:['cover','section','content','data','image'].map(kind=>({id:kind,kind,rules:{columns:kind==='content'?s.columns:1,pageInset:s.inset,gap:s.gap,motif:s.motif,titlePosition:s.motif==='band'?'top':'inset'}})),assets:[],preview:{kinds:['cover','content','data','image'],limitations:['System fonts vary by device; no fonts are bundled.','Generic SVG preview substitutes Arial and does not reproduce custom line height; editor fields retain the selected fonts.','Sample data and illustration are original demonstration content, not live project data.']}
}));

const curated=[
 {base:'sp-folio',id:'sp-editorial-language',name:'书页叙事 · 设计语言',principles:['Reading hierarchy','Editorial rhythm'],suitableFor:['Narrative reports','Long-form explanation'],avoid:['Dense specification tables','Decorative gradients'],distinctiveFeatures:['Serif display paired with generous body leading','Asymmetric image and copy','Square page bands'],grid:'editorial',imageTreatment:'editorial-crop',shape:'square',spacingUnit:8,enter:'fade',exit:'fade',transition:'fade',easing:'ease-in-out',timing:[180,420,640]},
 {base:'sp-caliper',id:'sp-technical-language',name:'标尺精度 · 设计语言',principles:['Measurement before decoration','Indexed evidence'],suitableFor:['Technical review','Specification reports'],avoid:['Emotive collage','Soft decorative silhouettes'],distinctiveFeatures:['Monospaced display and compact body scale','Two aligned specification columns','Hard frames and indexed rules'],grid:'modular',imageTreatment:'contain',shape:'square',spacingUnit:4,enter:'slide',exit:'slide',transition:'slide',easing:'linear',timing:[120,240,360]},
 {base:'sp-hearth',id:'sp-warm-language',name:'暖光故事 · 设计语言',principles:['Human pacing','Soft emphasis'],suitableFor:['Team stories','Learning sessions'],avoid:['High-density specification grids','Aggressive flashing'],distinctiveFeatures:['Rounded panels and circular chapter mark','Single spacious narrative column','Image inset with warm supporting captions'],grid:'freeform',imageTreatment:'contain',shape:'rounded',spacingUnit:12,enter:'scale',exit:'fade',transition:'fade',easing:'ease-out',timing:[260,560,800]}
];
// New IDs preserve every existing 1.0.0 snapshot and its preview semantics.
for(const s of curated){
 const theme=structuredClone(catalog.find(t=>t.id===s.base));
 Object.assign(theme,{id:s.id,name:s.name,description:theme.description+' 完整原创视觉与运动语言。',tags:[...theme.tags,'design-language']});
 theme.tokens.spacing.unit=s.spacingUnit;theme.tokens.motion={durationMs:s.timing[1],easing:s.easing};
 theme.tokens.typography.body.lineHeight=s.grid==='editorial'?1.5:s.grid==='modular'?1.15:1.4;
 theme.designLanguage={identity:{principles:s.principles,suitableFor:s.suitableFor,avoid:s.avoid,distinctiveFeatures:s.distinctiveFeatures},origin:{type:'original',ref:'J-X-C-Z/Superior-Point',sourceRevision:'sp-design-language-1.0.0',license:'MIT',attribution:'Original Superior Point rules and geometric sample; no Design-Systems code, images or fonts copied.'},visual:{grid:s.grid,imageTreatment:s.imageTreatment,shape:s.shape,spacingUnit:s.spacingUnit},motion:{principles:s.principles,timing:{shortMs:s.timing[0],standardMs:s.timing[1],longMs:s.timing[2]},easing:s.easing,enter:s.enter,exit:s.exit,transition:s.transition,reducedMotion:'none',unsupportedBehavior:'preserve-intent-and-report'}};
 theme.preview.kinds=['cover','content','data','image','section'];
 theme.preview.limitations.push('Slide and scale entrance intents require native playback; generic HTML preserves intent and reports a gap. Exit intent and timing have explicit renderer diagnostics; PPTX motion is not guaranteed.');
 catalog.push(importTheme(theme));
}

/** Built-ins are read-only; each caller receives an independently validated snapshot. */
export function listBuiltinThemes(){return catalog.map(theme=>freeze(importTheme(theme)));}
export function getBuiltinTheme(id,version){const theme=catalog.find(item=>item.id===id&&(!version||item.version===version));return theme?freeze(importTheme(theme)):null;}

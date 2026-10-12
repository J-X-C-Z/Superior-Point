import {validateTheme} from './theme-schema.js';

const string={type:'string',minLength:1,maxLength:500,pattern:'\\S',not:{pattern:'[<>\\u0000-\\u001f]'}};
const list={type:'array',minItems:1,maxItems:32,items:string};
const choice=(...values)=>({enum:values});
const number=(minimum,maximum)=>({type:'number',minimum,maximum});
const record=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const behavior=choice('none','fade','slide','scale');
/** Legacy packages keep their format; this extension is declarative and closed to unknown fields. */
export const DESIGN_LANGUAGE_SCHEMA=record({
 identity:record({principles:list,suitableFor:list,avoid:list,distinctiveFeatures:list}),
 origin:record({type:choice('design-systems','original','derived'),ref:string,sourceRevision:string,license:string,attribution:string}),
 visual:record({grid:choice('modular','editorial','freeform','radial'),imageTreatment:choice('editorial-crop','contain','monochrome','duotone','none'),shape:choice('square','rounded','organic'),spacingUnit:number(0,512)}),
 motion:record({principles:list,timing:record({shortMs:number(0,10000),standardMs:number(0,10000),longMs:number(0,10000)}),easing:choice('linear','ease','ease-in','ease-out','ease-in-out'),enter:behavior,exit:behavior,transition:choice('none','fade','slide'),reducedMotion:choice('none','fade'),unsupportedBehavior:choice('preserve-intent-and-report')})
});
const shortText=maxLength=>({type:'string',minLength:1,maxLength,pattern:'\\S'});
const color={type:'string',pattern:'^#[a-fA-F0-9]{6}(?:[a-fA-F0-9]{2})?$'};
const fontName=maxLength=>({...shortText(maxLength),not:{pattern:'[;{}<>\\n\\r]'}});
const styleBounds={fontSize:number(6,240),fontWeight:number(100,900),lineHeight:number(0.5,4),opacity:number(0,1),borderWidth:number(0,64),borderRadius:number(0,512),padding:number(0,512),gap:number(0,512)};
const forbiddenFields=['script','scripts','javascript','html','css','src','href','url','code','onload','onclick'];
const forbiddenPattern='^(?:'+forbiddenFields.map(key=>key.replace(/[a-z]/g,c=>'['+c+c.toUpperCase()+']')).join('|')+')$';
/** Safe unknown package fields survive as inert JSON; designLanguage has a closed vocabulary. */
export const THEME_MANIFEST_SCHEMA={
 $schema:'https://json-schema.org/draft/2020-12/schema',
 title:'Superior Point Theme Manifest v1',type:'object',
 required:['format','schemaVersion','id','name','version','author','license','tags','supportedRatios','tokens','assets'],
 allOf:[{$ref:'#/$defs/safeValue'},{if:{required:['designLanguage']},then:{properties:{tokens:{properties:{colors:{minProperties:1},typography:{minProperties:1}}}}}}],
 properties:{
  format:{const:'superior-point-theme'},schemaVersion:{const:1},id:{...shortText(128),pattern:'^[a-zA-Z0-9][a-zA-Z0-9._-]*$'},name:shortText(200),
  version:{type:'string',maxLength:64,pattern:'^\\d+\\.\\d+\\.\\d+(?:-[a-zA-Z0-9.-]+)?$'},author:shortText(200),license:shortText(200),
  tags:{type:'array',maxItems:32,items:shortText(64)},supportedRatios:{type:'array',minItems:1,uniqueItems:true,items:choice('16:9','4:3')},
  tokens:{type:'object',required:['colors','typography','spacing'],properties:{
   colors:{type:'object',additionalProperties:color},
   typography:{type:'object',additionalProperties:{type:'object',required:['fontFamily','fallback','license','fontSize'],properties:{fontFamily:fontName(200),fallback:{type:'array',minItems:1,items:fontName(100)},license:shortText(200),fontSize:number(6,240),fontWeight:{...number(100,900),type:'integer'},lineHeight:number(0.5,4)}}},
   spacing:{type:'object',additionalProperties:number(0,512)},
   components:{type:'object',additionalProperties:{$ref:'#/$defs/style'},description:'Optional named declarative styles, including chart styles at components.chart; omitted groups normalize to an empty object.'},
   motion:{type:'object',required:['durationMs','easing'],properties:{durationMs:number(0,10000),easing:choice('linear','ease','ease-in','ease-out','ease-in-out')}}
  }},
  layouts:{type:'array',maxItems:32,description:'Optional recommendations; omission normalizes to an empty list and Skin never changes geometry.',items:{type:'object',required:['id','kind','rules'],allOf:[{$ref:'#/$defs/layoutRules'}],properties:{id:shortText(64),kind:choice('cover','section','content','data','image'),rules:{type:'object',properties:{columns:number(1,12),gap:number(0,512),pageInset:number(0,512)}}}}},
  assets:{type:'array',maxItems:16,items:{type:'object',required:['id','mimeType','data','hash','license'],properties:{id:shortText(128),mimeType:choice('image/png','image/jpeg','image/webp'),data:{type:'string',minLength:4,pattern:'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'},hash:{type:'string',pattern:'^sha256:[a-f0-9]{64}$'},license:shortText(200)}}},
  designLanguage:DESIGN_LANGUAGE_SCHEMA
 },
 $defs:{
  safeValue:{type:['object','array','string','number','boolean','null'],propertyNames:{not:{anyOf:[{enum:['__proto__','prototype','constructor']},{pattern:forbiddenPattern}]}},additionalProperties:{$ref:'#/$defs/safeValue'},items:{$ref:'#/$defs/safeValue'}},
  style:{type:'object',properties:styleBounds,additionalProperties:{if:{type:'object'},then:{$ref:'#/$defs/style'}}},
  layoutRules:{propertyNames:{not:{enum:['x','y','w','h','elements','slides']}},additionalProperties:{$ref:'#/$defs/layoutRules'},items:{$ref:'#/$defs/layoutRules'}}
 },
 additionalProperties:true,
 description:'Unknown safe JSON fields roundtrip without interpretation; executable/external-load and prototype keys are forbidden recursively. designLanguage rejects unknown fields. Runtime validation additionally checks duplicate IDs, asset bytes/signatures/hashes, ordered motion durations and package size. New curated themes must include designLanguage.'
};
export function validateDesignLanguage(value){
 const errors=[];
 function check(value,schema,path){
  if(schema.enum){if(!schema.enum.includes(value))errors.push(`Unsupported ${path}`);return;}
  if(schema.type==='object'){
   if(!value||typeof value!=='object'||Array.isArray(value)){errors.push(`${path} must be an object`);return;}
   for(const key of Object.keys(value))if(!Object.hasOwn(schema.properties,key))errors.push(`Unknown ${path}.${key}`);
   for(const key of schema.required)check(value[key],schema.properties[key],`${path}.${key}`);
  }else if(schema.type==='array'){
   if(!Array.isArray(value)||value.length<schema.minItems||value.length>schema.maxItems){errors.push(`Invalid ${path}`);return;}
   value.forEach((item,i)=>check(item,schema.items,`${path}[${i}]`));
  }else if(schema.type==='string'){
   if(typeof value!=='string'||!value.trim()||value.length>schema.maxLength||/[<>\u0000-\u001f]/.test(value))errors.push(`Invalid ${path}`);
  }else if(typeof value!=='number'||!Number.isFinite(value)||value<schema.minimum||value>schema.maximum)errors.push(`Invalid ${path}`);
 }
 check(value,DESIGN_LANGUAGE_SCHEMA,'designLanguage');
 const timing=value?.motion?.timing;
 if(timing&&!(timing.shortMs<=timing.standardMs&&timing.standardMs<=timing.longMs))errors.push('Motion durations must be ordered short <= standard <= long');
 return errors;
}
export function validateThemeManifest(raw,{requireDesignLanguage=false}={}){
 const result=validateTheme(raw);
 if(requireDesignLanguage&&!raw?.designLanguage){result.errors.push('Curated theme requires designLanguage');result.valid=false;}
 return result;
}

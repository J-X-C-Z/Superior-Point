import {validateTheme} from './theme-schema.js';

const string={type:'string',minLength:1,maxLength:500};
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
export const THEME_MANIFEST_SCHEMA={
 $schema:'https://json-schema.org/draft/2020-12/schema',
 title:'Superior Point Theme Manifest v1',type:'object',
 required:['format','schemaVersion','id','name','version','author','license','tags','supportedRatios','tokens','layouts','assets'],
 properties:{format:{const:'superior-point-theme'},schemaVersion:{const:1},id:string,name:string,version:{type:'string',pattern:'^\\d+\\.\\d+\\.\\d+(?:-[a-zA-Z0-9.-]+)?$'},author:string,license:string,tags:{type:'array',items:string},supportedRatios:{type:'array',minItems:1,uniqueItems:true,items:choice('16:9','4:3')},tokens:{type:'object',required:['colors','typography','spacing','components']},layouts:{type:'array'},assets:{type:'array'},designLanguage:DESIGN_LANGUAGE_SCHEMA},
 additionalProperties:true,
 description:'Safe legacy extension fields survive. Runtime validateTheme additionally enforces asset bytes/hashes, fonts, token bounds and executable-field restrictions. New curated themes must include designLanguage.'
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

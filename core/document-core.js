/** Browser/Node canonical JSON core. Renderer-specific properties remain extensible. */
export class CoreError extends Error {
  constructor(code, message, details) { super(message); this.name = 'CoreError'; this.code = code; this.details = details; }
}
const fail = (code, message, details) => { throw new CoreError(code, message, details); };
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
export const newId = () => globalThis.crypto.randomUUID();
export function cloneJSON(value) {
  const seen = new Set();
  const visit = (v, depth = 0) => {
    if (depth > 100) fail('INVALID_JSON', 'JSON nesting exceeds 100');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (!v || typeof v !== 'object' || seen.has(v)) fail('INVALID_JSON', 'Expected finite, acyclic JSON values');
    if (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) fail('INVALID_JSON', 'Expected plain JSON objects');
    seen.add(v);
    for (const k of Object.keys(v)) {
      if (['__proto__', 'prototype', 'constructor'].includes(k)) fail('INVALID_JSON', `Unsafe key: ${k}`);
      visit(v[k], depth + 1);
    }
    seen.delete(v);
  };
  visit(value); return JSON.parse(JSON.stringify(value));
}
export function validateDocument(doc) {
  const errors = [], warnings = [];
  try { cloneJSON(doc); } catch (e) { return {valid:false, errors:[e.message], warnings}; }
  if (!object(doc)) return {valid:false,errors:['Document must be an object'],warnings};
  if (doc.format !== 'superior-point') errors.push('Invalid format');
  if (doc.schemaVersion !== 1) errors.push('Unsupported schemaVersion');
  if (typeof doc.id !== 'string' || !doc.id) errors.push('Missing document id');
  if (typeof doc.title !== 'string') errors.push('title must be a string');
  if (!Number.isSafeInteger(doc.revision) || doc.revision < 0) errors.push('revision must be a nonnegative safe integer');
  if (!object(doc.canvas) || ![doc.canvas.width,doc.canvas.height].every(v=>Number.isFinite(v)&&v>0)) errors.push('Invalid canvas dimensions');
  if (!Array.isArray(doc.assets)) errors.push('assets must be an array');
  const assetIds=new Set();
  for(const asset of Array.isArray(doc.assets)?doc.assets:[]){if(!object(asset)||typeof asset.id!=='string'||!asset.id||assetIds.has(asset.id))errors.push('Missing or duplicate asset id');else assetIds.add(asset.id);}
  if (!object(doc.metadata) || !['createdAt','updatedAt'].every(k=>typeof doc.metadata[k]==='string'&&Number.isFinite(Date.parse(doc.metadata[k])))) errors.push('Invalid metadata timestamps');
  if (!object(doc.extensions)) errors.push('extensions must be an object');
  const ids = new Set();
  const idCheck = (id,kind) => { if (typeof id!=='string'||!id||ids.has(id)) errors.push(`Missing or duplicate ${kind} id: ${id}`); else ids.add(id); };
  if (!Array.isArray(doc.slides)) errors.push('slides must be an array');
  else for (const slide of doc.slides) {
    if (!object(slide)) {errors.push('Invalid slide');continue;}
    idCheck(slide.id,'slide');
    if (!Array.isArray(slide.elements)) {errors.push('elements must be an array');continue;}
    const local = new Map(slide.elements.map(e=>[e?.id,e]));
    for (const e of slide.elements) {
      if (!object(e)) {errors.push('Invalid element');continue;}
      idCheck(e.id,'element');
      if(e.assetId!==undefined&&!assetIds.has(e.assetId))errors.push(`Missing asset for element: ${e.id}`);
      if(e.type==='connector'){for(const key of ['sourceId','targetId'])if(e[key]!==undefined&&!local.has(e[key]))warnings.push(`Dangling connector ${key}: ${e.id}`);}
      if (typeof e.type!=='string'||!e.type) errors.push(`Missing type: ${e.id}`);
      if (!['x','y','w','h'].every(k=>Number.isFinite(e[k]))||e.w<0||e.h<0) errors.push(`Invalid element geometry: ${e.id}`);
      if (e.x<0||e.y<0||e.x+e.w>doc.canvas?.width||e.y+e.h>doc.canvas?.height) warnings.push(`Element outside canvas: ${e.id}`);
      if (e.type==='group' && (!Array.isArray(e.children)||new Set(e.children).size!==e.children.length||e.children.some(id=>!local.has(id)||id===e.id))) errors.push(`Invalid group children: ${e.id}`);
    }
    const parents = new Map();
    for (const e of slide.elements.filter(e=>e?.type==='group'&&Array.isArray(e.children))) for (const id of e.children) {if(parents.has(id))errors.push(`Multiple groups own ${id}`);parents.set(id,e.id);}
    for (const id of parents.keys()) {const visited=new Set();let cur=id;while(parents.has(cur)){if(visited.has(cur)){errors.push('Cyclic group');break;}visited.add(cur);cur=parents.get(cur);}}
    if (slide.animations!==undefined) {
      if(!Array.isArray(slide.animations)) errors.push('animations must be an array');
      else for(const a of slide.animations){if(!object(a)){errors.push('Invalid animation');continue;}idCheck(a.id,'animation');if(!local.has(a.targetId))errors.push(`Animation target missing: ${a.targetId}`);if(typeof a.type!=='string'||typeof a.trigger!=='string'||typeof a.easing!=='string'||!['duration','delay','order'].every(k=>Number.isFinite(a[k])&&a[k]>=0))errors.push(`Invalid animation fields: ${a.id}`);}
    }
  }
  return {valid:errors.length===0,errors,warnings};
}
function assertDocument(doc) {const r=validateDocument(doc);if(!r.valid)fail('INVALID_DOCUMENT','Document validation failed',r);return doc;}
export function createDocument(options={}) {
  const now=new Date().toISOString();
  return assertDocument(cloneJSON({format:'superior-point',schemaVersion:1,id:options.id??newId(),title:options.title??'Untitled',revision:0,canvas:options.canvas??{width:1280,height:720},slides:options.slides??[],assets:[],metadata:{createdAt:now,updatedAt:now},extensions:options.extensions??{}}));
}
/** Only the explicit prototype v0 -> v1 migration is supported; future versions fail closed. */
export function importDocument(input) {
  const doc=cloneJSON(typeof input==='string'?JSON.parse(input):input);
  if (doc.schemaVersion===0 && doc.format==='superior-point') {
    doc.schemaVersion=1;doc.revision??=0;doc.assets??=[];doc.extensions??={};
    const now=new Date().toISOString();doc.metadata??={createdAt:now,updatedAt:now};
  }
  return assertDocument(doc);
}
function index(value,max,defaultValue=max){const n=value??defaultValue;if(!Number.isInteger(n)||n<0||n>max)fail('INVALID_OPERATION','Index out of range');return n;}
function slideOf(doc,id){const s=doc.slides.find(s=>s.id===id);if(!s)fail('NOT_FOUND',`Slide not found: ${id}`);return s;}
function elementOf(slide,id){const e=slide.elements.find(e=>e.id===id);if(!e)fail('NOT_FOUND',`Element not found: ${id}`);return e;}
function properties(p,blocked){if(!object(p))fail('INVALID_OPERATION','properties must be an object');for(const k of blocked)if(k in p)fail('INVALID_OPERATION',`Cannot update ${k}`);return p;}
function apply(doc,op){
  if(!object(op))fail('INVALID_OPERATION','Operation must be an object');
  switch(op.type){
    case 'createSlide': {const s=op.slide??{id:op.slideId??newId(),elements:[],animations:[]};doc.slides.splice(index(op.index,doc.slides.length),0,s);break;}
    case 'deleteSlide': {slideOf(doc,op.slideId);doc.slides=doc.slides.filter(s=>s.id!==op.slideId);break;}
    case 'duplicateSlide': {const s=cloneJSON(slideOf(doc,op.slideId)),map=new Map();s.id=op.newSlideId??newId();for(const e of s.elements)map.set(e.id,newId());for(const e of s.elements){e.id=map.get(e.id);if(e.children)e.children=e.children.map(id=>map.get(id));for(const k of ['sourceId','targetId'])if(map.has(e[k]))e[k]=map.get(e[k]);}for(const a of s.animations??[]){a.id=newId();a.targetId=map.get(a.targetId);}doc.slides.splice(index(op.index,doc.slides.length,doc.slides.findIndex(s=>s.id===op.slideId)+1),0,s);break;}
    case 'moveSlide': {const s=slideOf(doc,op.slideId);const target=index(op.index,doc.slides.length-1);doc.slides.splice(doc.slides.indexOf(s),1);doc.slides.splice(target,0,s);break;}
    case 'createElement': {const s=slideOf(doc,op.slideId);s.elements.splice(index(op.index,s.elements.length),0,op.element);break;}
    case 'updateElement': {Object.assign(elementOf(slideOf(doc,op.slideId),op.elementId),properties(op.properties,['id','type']));break;}
    case 'deleteElement': {const s=slideOf(doc,op.slideId);elementOf(s,op.elementId);const removed=new Set([op.elementId]);let size;do{size=removed.size;for(const e of s.elements)if(removed.has(e.id)&&e.type==='group')for(const id of e.children)removed.add(id);}while(size!==removed.size);s.elements=s.elements.filter(e=>!removed.has(e.id));for(const e of s.elements)if(e.children)e.children=e.children.filter(id=>!removed.has(id));s.animations=(s.animations??[]).filter(a=>!removed.has(a.targetId));break;}
    case 'groupElements': {const s=slideOf(doc,op.slideId);if(!Array.isArray(op.elementIds)||op.elementIds.length<2)fail('INVALID_OPERATION','Select at least two elements');const es=op.elementIds.map(id=>elementOf(s,id));const x=Math.min(...es.map(e=>e.x)),y=Math.min(...es.map(e=>e.y));s.elements.push({id:op.groupId??newId(),type:'group',x,y,w:Math.max(...es.map(e=>e.x+e.w))-x,h:Math.max(...es.map(e=>e.y+e.h))-y,children:op.elementIds});break;}
    case 'ungroupElements': {const s=slideOf(doc,op.slideId),e=elementOf(s,op.groupId);if(e.type!=='group')fail('INVALID_OPERATION','Not a group');if(s.elements.some(other=>other.children?.includes(e.id)))fail('INVALID_OPERATION','Ungroup parent first');s.elements=s.elements.filter(v=>v.id!==e.id);s.animations=(s.animations??[]).filter(a=>a.targetId!==e.id);break;}
    case 'setAnimation': {const s=slideOf(doc,op.slideId);s.animations??=[];if(op.animation===null){s.animations=s.animations.filter(a=>a.id!==op.animationId);break;}const a=op.animation;const i=s.animations.findIndex(v=>v.id===a?.id);if(i<0)s.animations.push(a);else s.animations[i]=a;break;}
    case 'replaceContent': {
      const incoming=importDocument(op.document);
      for(const key of ['id','format','schemaVersion','revision'])if(incoming[key]!==doc[key])fail('INVALID_OPERATION',`Snapshot cannot change ${key}`);
      if(incoming.metadata.createdAt!==doc.metadata.createdAt)fail('INVALID_OPERATION','Snapshot cannot change creation identity');
      for(const key of Object.keys(doc))delete doc[key];Object.assign(doc,incoming);break;
    }
    case 'updateProject': Object.assign(doc,properties(op.properties,['id','format','schemaVersion','revision','metadata','slides']));break;
    default: fail('INVALID_OPERATION',`Unsupported operation: ${op.type}`);
  }
}
export class DocumentCore {
  #doc; #past=[]; #future=[];
  constructor(document){this.#doc=importDocument(document);}
  getDocument(){return cloneJSON(this.#doc);}
  get canUndo(){return this.#past.length>0;} get canRedo(){return this.#future.length>0;}
  #check(expectedRevision){if(expectedRevision!==undefined&&expectedRevision!==this.#doc.revision)fail('REVISION_CONFLICT','Document revision changed',{expectedRevision,actualRevision:this.#doc.revision});if(this.#doc.revision===Number.MAX_SAFE_INTEGER)fail('REVISION_EXHAUSTED','Revision limit reached');}
  #stamp(doc){doc.revision=this.#doc.revision+1;doc.metadata.updatedAt=new Date().toISOString();return assertDocument(doc);}
  edit(operations,{expectedRevision}={}){this.#check(expectedRevision);if(!Array.isArray(operations)||!operations.length)fail('INVALID_OPERATION','Nonempty operations array required');const ops=cloneJSON(operations),next=this.getDocument();for(const op of ops)apply(next,op);this.#stamp(next);this.#past.push(this.#doc);this.#future=[];this.#doc=next;return this.getDocument();}
  undo({expectedRevision}={}){this.#check(expectedRevision);if(!this.canUndo)fail('NO_HISTORY','Nothing to undo');const next=this.#stamp(cloneJSON(this.#past.at(-1)));this.#future.push(this.#doc);this.#past.pop();this.#doc=next;return this.getDocument();}
  redo({expectedRevision}={}){this.#check(expectedRevision);if(!this.canRedo)fail('NO_HISTORY','Nothing to redo');const next=this.#stamp(cloneJSON(this.#future.at(-1)));this.#past.push(this.#doc);this.#future.pop();this.#doc=next;return this.getDocument();}
}

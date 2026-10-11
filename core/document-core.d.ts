export type JSONValue = null | string | number | boolean | JSONValue[] | {[key:string]: JSONValue};
export interface Element { id:string; type:string; x:number; y:number; w:number; h:number; [key:string]:JSONValue }
export interface Animation {id:string;targetId:string;type:string;trigger:string;duration:number;delay:number;easing:string;order:number;[key:string]:JSONValue}
export interface Slide {id:string;elements:Element[];animations?:Animation[];[key:string]:unknown}
export interface SPDocument {format:'superior-point';schemaVersion:1;id:string;title:string;revision:number;canvas:{width:number;height:number};slides:Slide[];assets:JSONValue[];metadata:{createdAt:string;updatedAt:string};extensions:Record<string,JSONValue>;[key:string]:unknown}
export type Operation = {type:'replaceContent';document:SPDocument}|{type:'createSlide';slide?:Slide;slideId?:string;index?:number}|{type:'deleteSlide';slideId:string}|{type:'duplicateSlide';slideId:string;newSlideId?:string;index?:number}|{type:'moveSlide';slideId:string;index:number}|{type:'createElement';slideId:string;element:Element;index?:number}|{type:'updateElement';slideId:string;elementId:string;properties:Record<string,JSONValue>}|{type:'deleteElement';slideId:string;elementId:string}|{type:'groupElements';slideId:string;elementIds:string[];groupId?:string}|{type:'ungroupElements';slideId:string;groupId:string}|{type:'setAnimation';slideId:string;animation:Animation}|{type:'setAnimation';slideId:string;animation:null;animationId:string}|{type:'updateProject';properties:Record<string,JSONValue>};
export class CoreError extends Error {code:string;details?:unknown;constructor(code:string,message:string,details?:unknown)}
export function cloneJSON<T>(value:T):T;
export function newId():string;
export function createDocument(options?:{id?:string;title?:string;canvas?:{width:number;height:number};slides?:Slide[];extensions?:Record<string,JSONValue>}):SPDocument;
export function validateDocument(doc:unknown):{valid:boolean;errors:string[];warnings:string[]};
export function importDocument(raw:unknown):SPDocument;
export class DocumentCore {constructor(document:SPDocument);readonly canUndo:boolean;readonly canRedo:boolean;getDocument():SPDocument;edit(operations:Operation[],options?:{expectedRevision?:number}):SPDocument;undo(options?:{expectedRevision?:number}):SPDocument;redo(options?:{expectedRevision?:number}):SPDocument}

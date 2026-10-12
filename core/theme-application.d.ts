import type {SPDocument,Element,Slide,Operation,JSONValue} from './document-core.js';
import type {MotionDiagnostic} from './theme-motion.js';
import type {Theme,ThemeRef} from './theme-schema.js';
export interface ThemeBindings {slides:Record<string,Record<string,JSONValue>>;elements:Record<string,Record<string,Record<string,JSONValue>>>}
export interface ThemeChange {slideId:string;elementId?:string;property:string;before?:JSONValue;after:JSONValue}
export interface ThemeManualOverride {slideId:string;elementId?:string;property:string;value:JSONValue}
export interface ThemeApplicationPlan {operations:Operation[];changes:ThemeChange[];ref:ThemeRef;limitations:string[];scope:{type:'all'|'slides';slideIds:string[]};manualOverrides:ThemeManualOverride[];summary:{styleChanges:number;manualOverrides:number;preservedOverrides:number;selectedSlides:number};motionDiagnostics:MotionDiagnostic[]}
export function themeElementStyle(theme:Theme,element:Element,slide?:Slide):Record<string,JSONValue>;
export function createThemeBindings(document:SPDocument):ThemeBindings;
export function planThemeApplication(document:SPDocument,theme:Theme,options?:{mode?:'preserve'|'reset';slideIds?:string[]}):Promise<ThemeApplicationPlan>;

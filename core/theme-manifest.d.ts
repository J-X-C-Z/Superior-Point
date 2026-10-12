import type {ThemeValidation} from './theme-schema.js';
export interface DesignLanguage {
 identity:{principles:string[];suitableFor:string[];avoid:string[];distinctiveFeatures:string[]};
 origin:{type:'design-systems'|'original'|'derived';ref:string;sourceRevision:string;license:string;attribution:string};
 visual:{grid:'modular'|'editorial'|'freeform'|'radial';imageTreatment:'editorial-crop'|'contain'|'monochrome'|'duotone'|'none';shape:'square'|'rounded'|'organic';spacingUnit:number};
 motion:{principles:string[];timing:{shortMs:number;standardMs:number;longMs:number};easing:'linear'|'ease'|'ease-in'|'ease-out'|'ease-in-out';enter:'none'|'fade'|'slide'|'scale';exit:'none'|'fade'|'slide'|'scale';transition:'none'|'fade'|'slide';reducedMotion:'none'|'fade';unsupportedBehavior:'preserve-intent-and-report'};
}
export const DESIGN_LANGUAGE_SCHEMA:Record<string,unknown>;
export const THEME_MANIFEST_SCHEMA:Record<string,unknown>;
export function validateDesignLanguage(value:unknown):string[];
export function validateThemeManifest(raw:unknown,options?:{requireDesignLanguage?:boolean}):ThemeValidation;

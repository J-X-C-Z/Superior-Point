import type {DesignLanguage} from './theme-manifest.js';
import type {JSONValue} from './document-core.js';
export interface FontToken {fontFamily:string;fallback:string[];license:string;fontSize:number;fontWeight?:number;lineHeight?:number;[key:string]:JSONValue|undefined}
export interface ThemeAsset {id:string;mimeType:'image/png'|'image/jpeg'|'image/webp';data:string;hash:string;license:string;[key:string]:JSONValue}
export interface ThemeLayout {id:string;kind:'cover'|'section'|'content'|'data'|'image';rules:Record<string,JSONValue>;[key:string]:JSONValue}
export interface Theme {
  format:'superior-point-theme';schemaVersion:1;id:string;name:string;version:string;author:string;license:string;tags:string[];supportedRatios:('16:9'|'4:3')[];
  tokens:{colors:Record<string,string>;typography:Record<string,FontToken>;spacing:Record<string,number>;components:Record<string,Record<string,JSONValue>>;motion?:{durationMs:number;easing:'linear'|'ease'|'ease-in'|'ease-out'|'ease-in-out'};[key:string]:unknown};
  designLanguage?:DesignLanguage;
  layouts:ThemeLayout[];assets:ThemeAsset[];[key:string]:unknown;
}
export interface ThemeRef {id:string;version:string;hash:string;snapshot:Theme}
export interface ThemeValidation {valid:boolean;errors:string[];warnings:string[]}
export const THEME_FORMAT:'superior-point-theme';
export const THEME_SCHEMA_VERSION:1;
export const THEME_LIMITS:Readonly<{packageBytes:number;assetBytes:number;totalAssetBytes:number;assets:number}>;
export function validateTheme(raw:unknown):ThemeValidation;
export function importTheme(raw:unknown):Theme;
export function verifyThemeAssets(raw:unknown):Promise<Theme>;
export function createThemeRef(raw:unknown):Promise<ThemeRef>;
export function validateThemeRef(raw:unknown):Promise<ThemeValidation>;
export function resolveThemeStyle(layers?:{defaults?:Record<string,JSONValue>;global?:Record<string,JSONValue>;component?:Record<string,JSONValue>;page?:Record<string,JSONValue>;manual?:Record<string,JSONValue>}):Record<string,JSONValue>;

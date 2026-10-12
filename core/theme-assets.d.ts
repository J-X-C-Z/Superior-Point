import type {ThemeRef} from './theme-schema.js';
export interface VerifiedThemeAsset {id:string;mimeType:'image/png'|'image/jpeg'|'image/webp';hash:string;integrity:string;license:string;bytes:Uint8Array}
export function readThemeAsset(ref:ThemeRef,assetId:string):Promise<VerifiedThemeAsset>;

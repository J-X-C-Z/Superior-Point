import type {Theme} from './theme-schema.js';
import type {DesignSystemReference} from './design-system-inventory.js';
export function adaptDesignSystemRules(input:{theme:unknown;upstreamId:string;review:{decision:'original-no-source-assets';reviewer:string}}):Promise<{theme:Theme;report:{source:DesignSystemReference;theme:{id:string;version:string;origin:unknown};review:{decision:string;reviewer:string};mapping:{from:string;to:string;method:string}[];copiedAssets:never[];limitations:string[]}}>;

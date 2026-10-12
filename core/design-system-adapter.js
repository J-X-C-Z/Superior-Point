import {CoreError} from './document-core.js';
import {verifyThemeAssets} from './theme-schema.js';
import {validateThemeManifest} from './theme-manifest.js';
import {listDesignSystemReferences} from './design-system-inventory.js';
/** Manual declarative mapping only: upstream executable code and unlicensed assets are never loaded. */
export async function adaptDesignSystemRules({theme:input,upstreamId,review}){
 const source=listDesignSystemReferences().find(item=>item.id===upstreamId);
 if(!source)throw new CoreError('UNKNOWN_DESIGN_SYSTEM','Unknown upstream language');
 if(!review||review.decision!=='original-no-source-assets'||typeof review.reviewer!=='string'||!review.reviewer.trim()||review.reviewer.length>200)throw new CoreError('ADAPTER_REVIEW_REQUIRED','Manual original-rule review is required');
 const theme=await verifyThemeAssets(input),validation=validateThemeManifest(theme,{requireDesignLanguage:true});
 if(!validation.valid)throw new CoreError('INVALID_THEME','Adapter requires a complete design language',validation);
 if(theme.designLanguage.origin.type!=='original'||theme.assets.length)throw new CoreError('UPSTREAM_LICENSE_REVIEW_REQUIRED','This adapter only accepts original rules without redistributed source assets');
 return {theme,report:{source,theme:{id:theme.id,version:theme.version,origin:theme.designLanguage.origin},review:{decision:review.decision,reviewer:review.reviewer.trim()},mapping:[{from:'Language identity and independent direction',to:'designLanguage.identity',method:'manual-original-rules'},{from:'Visual rule review',to:'designLanguage.visual + tokens + optional layouts',method:'manual-original-rules'},{from:'Motion rule review',to:'designLanguage.motion + tokens.motion',method:'manual-original-rules'}],copiedAssets:[],limitations:['Source repository license is unresolved; metadata reference does not grant redistribution.','Mapping is manual, not lossless CSS/JS conversion.','SP-owned examples are distinct originals, not reproductions of the upstream specimens.']}};
}

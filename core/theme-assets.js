import {createThemeRef} from './theme-schema.js';
import {CoreError} from './document-core.js';

/** Read only licensed raster bytes from the exact immutable snapshot; never fetch external URLs. */
export async function readThemeAsset(ref,assetId){
 if(typeof assetId!=='string'||!assetId.length||assetId.length>128)throw new CoreError('THEME_ASSET_MISSING','主题素材不存在，请重新导入完整主题包。');
 let verified;
 try{verified=await createThemeRef(ref?.snapshot);}catch{throw new CoreError('THEME_ASSET_CORRUPT','主题资源校验失败，请重新导入可信的完整主题包。');}
 if(verified.id!==ref.id||verified.version!==ref.version||verified.hash!==ref.hash)throw new CoreError('THEME_ASSET_CORRUPT','主题固定快照不一致，请重新导入可信的完整主题包。');
 const asset=verified.snapshot.assets.find(asset=>asset.id===assetId);
 if(!asset)throw new CoreError('THEME_ASSET_MISSING','主题素材不存在，请重新导入完整主题包。');
 const bytes=Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0));
 const hashBytes=Uint8Array.from(asset.hash.slice(7).match(/../g),hex=>parseInt(hex,16));
 return {id:asset.id,mimeType:asset.mimeType,hash:asset.hash,integrity:'sha256-'+btoa(String.fromCharCode(...hashBytes)),license:asset.license,bytes};
}

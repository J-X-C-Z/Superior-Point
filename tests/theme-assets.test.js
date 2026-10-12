import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {listBuiltinThemes} from '../core/builtin-themes.js';
import {createThemeRef} from '../core/theme-schema.js';
import {readThemeAsset} from '../core/theme-assets.js';

test('pinned theme resources return hash verified raster bytes and reject corrupt or active content',async()=>{
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP7cAAAAASUVORK5CYII=','base64');
 const asset={id:'example',data:bytes.toString('base64'),mimeType:'image/png',license:'CC0',hash:'sha256:'+createHash('sha256').update(bytes).digest('hex')};
 const ref=await createThemeRef({...listBuiltinThemes()[0],assets:[asset]}),result=await readThemeAsset(ref,'example');
 assert.deepEqual(Buffer.from(result.bytes),bytes);assert.equal(result.hash,asset.hash);assert.equal(result.integrity,'sha256-'+createHash('sha256').update(bytes).digest('base64'));
 await assert.rejects(readThemeAsset(ref,'absent'),{code:'THEME_ASSET_MISSING'});
 await assert.rejects(readThemeAsset({...ref,version:'9.0.0'},'example'),{code:'THEME_ASSET_CORRUPT'});
 for(const patch of [{hash:'sha256:'+'0'.repeat(64)},{license:''},{mimeType:'image/svg+xml'},{url:'https://example.com/asset.png'},{script:'alert(1)'}]){
  const corrupted=structuredClone(ref);Object.assign(corrupted.snapshot.assets[0],patch);await assert.rejects(readThemeAsset(corrupted,'example'),{code:'THEME_ASSET_CORRUPT'});
 }
 assert.equal((await readThemeAsset(ref,'example')).hash,asset.hash);
});

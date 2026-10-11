import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {mountShare} from '../web/share.js';
test('share viewer removes the capability fragment before fetching and renders only sandboxed playback',async()=>{
 const html=await readFile(new URL('../web/share.html',import.meta.url),'utf8'),dom=new JSDOM(html),token='sp_share_'+'a'.repeat(43),events=[];
 try{
  await mountShare({document:dom.window.document,location:{hash:'#'+token,pathname:'/share',search:''},history:{replaceState(...args){events.push(['clear',args]);}},fetch:async(url,options)=>{events.push(['fetch',url,options]);return {ok:true,json:async()=>({title:'<script>untrusted title</script>',revision:3,html:'<p>visible audience</p>'})};}});
  assert.equal(events[0][0],'clear');assert.equal(events[0][1][2],'/share');assert.equal(events[1][1],'/api/v1/public/shares/view');assert.equal(events[1][2].credentials,'omit');assert.equal(events[1][2].headers.Authorization,'Bearer '+token);assert.equal(events[1][2].cache,'no-store');
  const frame=dom.window.document.querySelector('#share-frame');assert.equal(frame.getAttribute('sandbox'),'allow-scripts');assert.equal(frame.getAttribute('referrerpolicy'),'no-referrer');assert.equal(frame.srcdoc,'<p>visible audience</p>');assert.equal(frame.hidden,false);assert.equal(dom.window.document.querySelector('#share-title').children.length,0);assert.doesNotMatch(dom.serialize(),/sp_share_/);assert.match(dom.window.document.querySelector('#share-status').textContent,/r3/);
 }finally{dom.window.close();}
});
test('viewer requires the original link after refresh and hides content for revoked capabilities',async()=>{
 const html=await readFile(new URL('../web/share.html',import.meta.url),'utf8'),dom=new JSDOM(html);
 try{
  let requests=0;const options={document:dom.window.document,location:{hash:'',pathname:'/share',search:''},history:{replaceState(){}},fetch:async()=>{requests++;return {ok:false};}};
  await mountShare(options);assert.equal(requests,0);assert.match(dom.window.document.querySelector('#share-status').textContent,/原分享链接/);
  await mountShare({...options,location:{...options.location,hash:'#sp_share_'+'a'.repeat(43)}});assert.equal(requests,1);assert.equal(dom.window.document.querySelector('#share-frame').hidden,true);assert.match(dom.window.document.querySelector('#share-status').textContent,/已撤销或已到期/);
 }finally{dom.window.close();}
});

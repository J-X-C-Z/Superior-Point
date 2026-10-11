import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {exportHTML,importHTML} from '../io/html.js';
import {exportEditorHTML} from '../io/editor-export.js';
import {fiveSlideDocument} from '../examples/five-slides.js';

test('audience HTML contains visible playback without private data, editable payloads or document mutation',async()=>{
 const doc=fiveSlideDocument();
 doc.slides[0].notes='PRIVATE_NOTES_734';doc.slides[0].comments=['PRIVATE_COMMENTS_734'];
 doc.history=['PRIVATE_HISTORY_734'];doc.extensions.secret='PRIVATE_EXTENSION_734';
 doc.slides[4].hidden=true;doc.slides[4].elements[0].text='PRIVATE_HIDDEN_734';
 const before=structuredClone(doc),output=await exportHTML(doc,{audience:true});
 assert.doesNotMatch(output,/PRIVATE_|sp-document|superior-point-project|application\/json|Re-import this HTML/);
 assert.equal((output.match(/<section /g)||[]).length,4);
 assert.ok(output.includes(doc.assets[0].dataUrl));assert.match(output,/data-fragment-index/);
 assert.throws(()=>importHTML(output));assert.deepEqual(doc,before);
 assert.deepEqual(importHTML(await exportHTML(doc)),doc);
 const native=JSON.parse(await readFile(new URL('./evidence/candidate-native-render.document.json',import.meta.url),'utf8'));
 const html=await readFile(new URL('./evidence/candidate-native-render.html',import.meta.url),'utf8');
 const dom=new JSDOM('');
 try{
  const rendered=new JSDOM(html),root=rendered.window.document.querySelector('.reveal');
  const section=root.querySelector('section');
  section.insertAdjacentHTML('beforeend','<aside class="notes">PRIVATE_NOTES_734</aside><span data-v18-marker>PRIVATE_COMMENTS_734</span>');
  rendered.window.document.head.insertAdjacentHTML('beforeend','<style>/* PRIVATE_CSS_734 */</style>');
  section.setAttribute('title','PRIVATE_TITLE_734');
  section.style.setProperty('--private-secret','PRIVATE_STYLE_734');
  section.dataset.notes='PRIVATE_ATTRIBUTE_734';section.dataset.secret='PRIVATE_UNKNOWN_734';
  root.insertAdjacentHTML('beforeend','<section data-slide-id="hidden-private"><p>PRIVATE_HIDDEN_734</p></section>');
  native.slides.push({...structuredClone(native.slides[0]),id:'hidden-private',hidden:true,elements:[],animations:[]});
  const original=structuredClone(native);
  const shared=await exportEditorHTML(native,rendered.serialize(),{domDocument:dom.window.document,audience:true});
  assert.doesNotMatch(shared,/PRIVATE_|sp-document|superior-point-project|application\/json/);
  assert.match(shared,/v15-motion-marker/);assert.match(shared,/data-v15-duration/);
  assert.throws(()=>importHTML(shared));assert.deepEqual(native,original);
  assert.deepEqual(importHTML(await exportEditorHTML(native,html,{domDocument:dom.window.document})),native);
  const unsafe=fiveSlideDocument();unsafe.slides[1].elements[2].src='https://evil.invalid/a.png';
  await assert.rejects(exportHTML(unsafe,{audience:true}));
  await assert.rejects(exportEditorHTML(unsafe,html,{domDocument:dom.window.document,audience:true}));
  rendered.window.close();
 }finally{dom.window.close();}
});

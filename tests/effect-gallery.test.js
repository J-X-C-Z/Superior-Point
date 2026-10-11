import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {patchAnimationLibrary} from '../tools/editor-animation-library.js';
import {patchTransitionLibrary} from '../tools/editor-transition-library.js';
import {patchEffectGallery} from '../tools/editor-effect-gallery.js';
const original=readFileSync(new URL('../vendor/editor-v039.source.html',import.meta.url),'utf8');
const source=patchEffectGallery(patchTransitionLibrary(patchAnimationLibrary(original)));
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const gallery=slice('  // SP_EFFECT_GALLERY_START','  // SP_EFFECT_GALLERY_END');
const catalogs=source.split('\n').find(line=>/^  const TRANSITIONS\s*=/.test(line))+'\n'+slice('  const V15_EFFECTS={','  const V15_KINDS=')+source.split('\n').find(line=>line.startsWith('  const V15_KINDS='))+'\n'+source.split('\n').find(line=>line.startsWith('  const V14_BACKGROUND_FX='))+'\n'+source.split('\n').find(line=>line.startsWith('  const V14_REVEAL_FX='));
function harness({selected=true,reduced=false,fine=true}={}){
  const dom=new JSDOM('<body><button id="opener" data-sp-effect-open="transition">全部切换</button><div id="ribbon"></div></body>',{runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,d=w.document,animations=[],media=new Map();
  w.matchMedia=query=>{
    if(!media.has(query))media.set(query,{matches:query.includes('reduced')?reduced:fine,addEventListener(type,fn){this.onchange=fn;}});
    return media.get(query);
  };
  w.Element.prototype.animate=function(frames,options){const animation={node:this,frames,options,canceled:false,cancel(){this.canceled=true;}};animations.push(animation);return animation;};
  w.selected=selected;w.object={id:'obj',motionEffects:[]};w.slide={transition:'fade'};w.routes=[];
  w.eval(catalogs+'\n'+slice('  function v15Frames(', '  function v15StopPreview()')+`\n
    function selectedObject(){return selected?object:null;}
    function selectedObjects(){return selected?[object]:[];}
    function curSlide(){return slide;}
    function v15Effects(obj){return obj?.motionEffects||[];}
    function safe(text){return String(text).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');}
  `+gallery+'\nspEffectGalleryBoot();window.testAPI={spEffectOpen,spEffectClose,spEffectRibbon,spEffectPreview,spEffectStopPreview};');
  // The existing editor is the sole action dispatcher; the gallery must not add a second route.
  d.addEventListener('click',event=>{const card=event.target.closest('[data-action]');if(card&&!card.disabled)w.routes.push([card.dataset.action,card.dataset.value]);});
  return {dom,w,d,animations,media};
}
const hover=(w,node)=>node.dispatchEvent(new w.MouseEvent('pointerover',{bubbles:true}));
const leave=(w,node)=>node.dispatchEvent(new w.MouseEvent('pointerout',{bubbles:true}));
test('all effects remain visible, grouped, and use native routes instead of selectors',()=>{
  const {w,d}=harness();
  w.testAPI.spEffectOpen('transition',d.querySelector('#opener'));
  assert.equal(d.querySelectorAll('.sp-effect-card').length,27);
  assert.equal(d.querySelector('[data-sp-effect-id="fade"]').getAttribute('aria-pressed'),'true');
  assert.equal(d.querySelectorAll('select').length,0);
  w.object.motionEffects=[{kind:'emphasis',effect:'teeter'}];
  w.testAPI.spEffectOpen('animation',d.querySelector('#opener'));
  assert.equal(d.querySelectorAll('.sp-effect-card').length,46);
  assert.deepEqual([...d.querySelectorAll('h3')].map(n=>n.textContent),['进入','强调','退出']);
  assert.equal(d.querySelector('[data-sp-effect-id="teeter"]').getAttribute('aria-pressed'),'true');
  assert.equal(d.querySelector('[data-sp-effect-kind="exit"][data-sp-effect-id="fade"]').dataset.value,'exit:fade');
  assert.equal(source.includes("group('效果设置',"),false);
});
test('hover animates only miniature nodes without mutation; switch, leave and close cancel',()=>{
  const {w,d,animations}=harness();
  w.testAPI.spEffectOpen('transition',d.querySelector('#opener'));
  const before=JSON.stringify({slide:w.slide,obj:w.object});
  const cover=d.querySelector('[data-sp-effect-id="cover-left"]'),uncover=d.querySelector('[data-sp-effect-id="uncover-up"]');
  hover(w,cover);assert.equal(animations.length,2);
  assert.ok(animations.every(a=>a.node.closest('.sp-effect-stage')));
  hover(w,uncover);assert.ok(animations.slice(0,2).every(a=>a.canceled));
  assert.equal(uncover.querySelector('.sp-effect-old').style.zIndex,'2');
  leave(w,uncover);assert.ok(animations.every(a=>a.canceled));
  assert.equal(uncover.querySelector('.sp-effect-old').style.zIndex,'');
  hover(w,cover);w.testAPI.spEffectClose();assert.ok(animations.every(a=>a.canceled));
  assert.equal(JSON.stringify({slide:w.slide,obj:w.object}),before);assert.equal(w.routes.length,0);
});
test('each click dispatches exactly one existing action and closes the popup',async()=>{
  const {w,d}=harness();const opener=d.querySelector('#opener');
  w.testAPI.spEffectOpen('transition',opener);d.querySelector('[data-sp-effect-id="diamond"]').click();
  await Promise.resolve();assert.deepEqual([...w.routes[0]],['choose-transition','diamond']);
  assert.equal(w.routes.length,1);assert.equal(d.querySelector('#sp-effect-shade'),null);assert.equal(d.activeElement,opener);
  w.testAPI.spEffectOpen('animation',opener);const replacement=opener.cloneNode(true);opener.replaceWith(replacement);d.querySelector('[data-sp-effect-kind="entrance"][data-sp-effect-id="bounce"]').click();
  await Promise.resolve();assert.deepEqual([...w.routes[1]],['v15-preset','entrance:bounce']);assert.equal(w.routes.length,2);assert.equal(d.activeElement,replacement);
});
test('no editable selection disables addition but retains all thumbnail previews',()=>{
  const {w,d,animations}=harness({selected:false});
  w.testAPI.spEffectOpen('animation',d.querySelector('#opener'));
  assert.equal(d.querySelectorAll('.sp-effect-card:disabled').length,46);
  assert.match(d.querySelector('.sp-effect-panel-note').textContent,/先在画布选中/);
  const card=d.querySelector('.sp-effect-card');hover(w,card);assert.equal(animations.length,1);card.click();assert.equal(w.routes.length,0);
  w.selected=true;w.object.locked=true;assert.equal(w.testAPI.spEffectRibbon('animation').match(/ disabled /g).length,6);
});
test('fine hover and reduced motion gates preserve click selection and keyboard focus',()=>{
  const {w,d,animations,media}=harness({fine:false});
  w.testAPI.spEffectOpen('transition',d.querySelector('#opener'));const card=d.querySelector('[data-sp-effect-id="zoom"]');
  hover(w,card);assert.equal(animations.length,0);
  card.focus();assert.equal(animations.length,2);
  const reduce=media.get('(prefers-reduced-motion: reduce)');reduce.matches=true;reduce.onchange();assert.ok(animations.every(a=>a.canceled));
  w.testAPI.spEffectPreview(card,true);assert.equal(animations.length,2);card.click();assert.equal(w.routes.length,1);
});
test('dialog Escape, outside click, tab change, and page hide restore/reset safely',()=>{
  const {w,d,animations}=harness();const opener=d.querySelector('#opener');let escapedNative=0;
  d.addEventListener('keydown',()=>escapedNative++);
  w.testAPI.spEffectOpen('transition',opener);const card=d.querySelector('.sp-effect-card');hover(w,card);
  card.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(escapedNative,0);assert.equal(d.querySelector('#sp-effect-shade'),null);assert.equal(d.activeElement,opener);assert.ok(animations.every(a=>a.canceled));
  w.testAPI.spEffectOpen('transition',opener);d.querySelector('#sp-effect-shade').click();assert.equal(d.querySelector('#sp-effect-shade'),null);
  w.testAPI.spEffectOpen('transition',opener);const tab=d.createElement('button');tab.dataset.tab='开始';d.body.append(tab);tab.click();assert.equal(d.querySelector('#sp-effect-shade'),null);
  w.testAPI.spEffectOpen('transition',opener);hover(w,d.querySelector('.sp-effect-card'));Object.defineProperty(d,'hidden',{value:true});d.dispatchEvent(new w.Event('visibilitychange'));assert.equal(d.querySelector('#sp-effect-shade'),null);assert.ok(animations.every(a=>a.canceled));
});
test('focus stays within the dialog and exact-source patch rejects drift',()=>{
  const {w,d}=harness();w.testAPI.spEffectOpen('transition',d.querySelector('#opener'));
  const panel=d.querySelector('.sp-effect-panel'),buttons=[...panel.querySelectorAll('button')];
  panel.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));assert.equal(d.activeElement,buttons.at(-1));
  buttons.at(-1).dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));assert.equal(d.activeElement,buttons[0]);
  assert.throws(()=>patchEffectGallery(source),/expected one exact source match|missing shared transition/);
});

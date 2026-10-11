import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {patchTransitionLibrary} from '../tools/editor-transition-library.js';
import {revealCSS} from '../vendor/reveal-bundle.js';
const original=readFileSync(new URL('../vendor/editor-v039.source.html',import.meta.url),'utf8');
const source=patchTransitionLibrary(original);
const declaration=(name)=>source.split('\n').find(line=>line.startsWith('  const '+name+'=')||line.startsWith('  const '+name+' ='));
const runtime=vm.createContext({});
vm.runInContext(['TRANSITIONS','V14_BACKGROUND_FX','V14_REVEAL_FX','revealTransition'].map(declaration).join('\n')+'\n'+source.split('\n').find(line=>line.startsWith('  function v14TransitionSpec(')),runtime);
const ids=['push','wipe'].flatMap(effect=>['left','right','up','down'].map(direction=>effect+'-'+direction));
const frameStart=source.indexOf('    const effectFrames=(kind,name)=>{');
const frameEnd=source.indexOf('\n    };',frameStart)+7;
vm.runInContext(source.slice(frameStart,frameEnd)+'\nglobalThis.frames=effectFrames;',runtime);
const styleSource=source.split('\n').filter(line=>/^  function (revealStyleSheet|v15ExportCSS)\(/.test(line)).join('\n');
vm.runInContext(styleSource+'\nglobalThis.css=revealStyleSheet();',runtime);
test('all eight directions survive gallery, normalization and mixed transition spec',()=>{
  const normalizer=source.match(/slide\.transition=TRANSITIONS\.some[^;]+;/)[0];
  for(const id of [...ids,'fade','slide','zoom','convex','concave','morph','push','wipe']){
    runtime.s={transition:id};runtime.slide={};
    vm.runInContext(normalizer,runtime);
    const expected={push:'push-left',wipe:'wipe-left'}[id]||id;
    assert.equal(runtime.slide.transition,expected);
    assert.equal(vm.runInContext('V14_REVEAL_FX.includes(slide.transition)',runtime),id!=='morph');
  }
  runtime.s={transition:'wipe-left',transitionEnter:'push-down',transitionExit:'wipe-up'};
  assert.equal(vm.runInContext('v14TransitionSpec(s)',runtime),'push-down-in wipe-up-out');
  assert.equal(vm.runInContext('v14TransitionSpec({transition:"morph"})',runtime),'none');
  assert.equal(vm.runInContext('V14_BACKGROUND_FX.length',runtime),6);
});
test('preview and shared Reveal CSS use identical directional geometry, including mixed in/out',()=>{
  const dom=new JSDOM(`<style>${revealCSS}${runtime.css}</style><div class="reveal"><div class="slides"></div></div>`);
  const root=dom.window.document.querySelector('.slides');
  for(const id of ids){
    for(const [kind,state] of [['in','future'],['out','past']]){
      const frames=runtime.frames(kind,id),hidden=kind==='in'?frames[0]:frames[1];
      const node=dom.window.document.createElement('section');
      node.dataset.transition=id;node.className='sp-reveal-section '+state;root.replaceChildren(node);
      const style=dom.window.getComputedStyle(node);
      assert.equal(style.opacity,'1',id+' remains opaque');
      if(id.startsWith('push'))assert.equal(style.transform,hidden.transform,id+' '+kind);
      else assert.equal(style.clipPath,hidden.clipPath,id+' '+kind);
      node.dataset.transition=kind==='in'?id+'-in fade-out':'fade-in '+id+'-out';
      const mixed=dom.window.getComputedStyle(node);
      assert.equal(id.startsWith('push')?mixed.transform:mixed.clipPath,id.startsWith('push')?hidden.transform:hidden.clipPath);
    }
  }
  const mixed=dom.window.document.createElement('section');mixed.dataset.transition='push-down-in wipe-up-out';mixed.className='sp-reveal-section future';root.replaceChildren(mixed);
  assert.equal(dom.window.getComputedStyle(mixed).transform,'translate(0,-100%)');
  mixed.dataset.transition='push-down-in fade-out';mixed.className='sp-reveal-section past';
  assert.equal(dom.window.getComputedStyle(mixed).opacity,'0','native fade-out still applies alongside custom in');
  assert.ok(dom.window.getComputedStyle(mixed).transitionProperty.split(',').includes('opacity'),'mixed native fade-out retains its opacity transition');
  mixed.dataset.transition='fade-in wipe-up-out';mixed.className='sp-reveal-section future';
  assert.equal(dom.window.getComputedStyle(mixed).opacity,'0','native fade-in still applies alongside custom out');
  assert.ok(dom.window.getComputedStyle(mixed).transitionProperty.split(',').includes('opacity'),'mixed native fade-in retains its opacity transition');
  assert.match(source, /ribbonSelect\('切换效果','transition',TRANSITIONS,slide.transition\)/);
  assert.match(runtime.css,/@media\(prefers-reduced-motion:reduce\)/);
  dom.window.close();
});
test('patch refuses source drift and cannot silently reapply',()=>{
  assert.throws(()=>patchTransitionLibrary(source),/expected one exact source match/);
  assert.throws(()=>patchTransitionLibrary(original.replace("['slide','平移 Slide'],",'')),/transition gallery/);
});

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
const ids=['push','wipe','cover','uncover'].flatMap(effect=>['left','right','up','down'].map(direction=>effect+'-'+direction)).concat(['split-horizontal','split-vertical','circle','diamond']);
const frameStart=source.indexOf('    const effectFrames=(kind,name)=>{');
const frameEnd=source.indexOf('\n    };',frameStart)+7;
vm.runInContext(source.slice(frameStart,frameEnd)+'\nglobalThis.frames=effectFrames;',runtime);
const styleSource=source.split('\n').filter(line=>/^  function (revealStyleSheet|v15ExportCSS)\(/.test(line)).join('\n');
vm.runInContext(styleSource+'\nglobalThis.css=revealStyleSheet();',runtime);
test('all 27 transitions survive normalization and mixed transition spec',()=>{
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
  assert.equal(vm.runInContext('TRANSITIONS.length',runtime),27);
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
      if(hidden.transform)assert.equal(style.transform,hidden.transform,id+' '+kind);
      else assert.equal(style.clipPath,hidden.clipPath,id+' '+kind);
      node.dataset.transition=kind==='in'?id+'-in fade-out':'fade-in '+id+'-out';
      const mixed=dom.window.getComputedStyle(node);
      assert.equal(hidden.transform?mixed.transform:mixed.clipPath,hidden.transform?hidden.transform:hidden.clipPath);
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

test('cover/uncover pairing resets on forward, backward, reduced-motion and disposal',()=>{
  const dom=new JSDOM('<div class="reveal"><div class="slides"><section></section><section></section><section></section></div></div>');
  const [a,b,c]=dom.window.document.querySelectorAll('section');
  a.dataset.transition='cover-left';b.dataset.transition='uncover-up';c.dataset.transition='fade';
  a.dataset.transitionSpeed='fast';b.dataset.transitionSpeed='slow';c.dataset.transitionSpeed='default';
  let reduced=false,cancelled=false,backFrames;
  a.animate=(frames)=>{backFrames=frames;return {cancel:()=>{cancelled=true;}};};
  const events=new Map(),reveal={on:(name,fn)=>events.set(name,fn),getCurrentSlide:()=>a};
  const context=vm.createContext({window:{matchMedia:()=>({matches:reduced})},clearTimeout,setTimeout});
  const start=source.indexOf('  function v15PlaybackBootstrap(){'),end=source.indexOf('  v15PlaybackBootstrap();',start);
  vm.runInContext(source.slice(start,end)+'\nv15PlaybackBootstrap();',context);
  const playback=context.window.SuperiorPointMotion.attach(reveal);
  assert.equal(a.dataset.transition,'cover-left','initial sync keeps original page configuration');
  events.get('slidechanged')({previousSlide:a,currentSlide:b});
  assert.equal(a.dataset.transition,'uncover-up-out');assert.equal(a.dataset.transitionSpeed,'slow');
  const cssDom=dom.window.document.createElement('style');cssDom.textContent=revealCSS+runtime.css;dom.window.document.head.append(cssDom);
  a.className='past';assert.equal(dom.window.getComputedStyle(a).zIndex,'12','departing page sits above incoming for uncover');
  a.className='future';assert.equal(dom.window.getComputedStyle(a).transform,'translate(0,100%)','reverse uncover moves departing page toward opposite edge');
  events.get('slidechanged')({previousSlide:b,currentSlide:c});
  assert.equal(a.dataset.transition,'cover-left');assert.equal(a.dataset.transitionSpeed,'fast');
  assert.equal(b.dataset.transition,'uncover-up','normal transition never inherits a previous override');
  events.get('slidechanged')({previousSlide:c,currentSlide:a});
  assert.equal(c.dataset.transition,'cover-left-out');
  assert.equal(backFrames[0].transform,'translate(-100%,0)','backward cover starts outside the opposite edge');
  reduced=true;events.get('slidechanged')({previousSlide:a,currentSlide:b});
  assert.equal(c.dataset.transition,'fade');assert.equal(cancelled,true);assert.equal(a.dataset.transition,'cover-left');
  reduced=false;events.get('slidechanged')({previousSlide:a,currentSlide:b});playback.dispose();
  assert.equal(a.dataset.transition,'cover-left');assert.equal(a.dataset.transitionSpeed,'fast');
  dom.window.close();
});
test('new geometry keeps one page stationary for cover/uncover and uses genuine split/circle/diamond masks',()=>{
  for(const direction of ['left','right','up','down']){
    const cover=runtime.frames('out','cover-'+direction),uncover=runtime.frames('in','uncover-'+direction);
    assert.equal(cover[0].transform,'translate(0,0)');assert.equal(cover[1].transform,'translate(0,0)');
    assert.equal(uncover[0].transform,'translate(0,0)');assert.equal(uncover[1].transform,'translate(0,0)');
  }
  assert.equal(runtime.frames('in','split-horizontal')[0].clipPath,'inset(50% 0 50% 0)');
  assert.equal(runtime.frames('out','split-vertical')[1].clipPath,'inset(0 50% 0 50%)');
  assert.equal(runtime.frames('in','circle')[0].clipPath,'circle(0% at 50% 50%)');
  assert.equal(runtime.frames('in','circle')[1].clipPath,'circle(71% at 50% 50%)');
  assert.equal(runtime.frames('in','diamond')[1].clipPath,'polygon(50% -50%,150% 50%,50% 150%,-50% 50%)');
});
test('new masks hold an unconfigured previous page and preserve explicit exit choices',()=>{
  const dom=new JSDOM('<style>'+revealCSS+runtime.css+'</style><div class="reveal"><div class="slides"><section></section><section></section></div></div>');
  const [previous,current]=dom.window.document.querySelectorAll('section');
  previous.dataset.transition='fade';previous.dataset.transitionSpeed='fast';current.dataset.transitionSpeed='default';
  let reduced=false;
  const events=new Map(),context=vm.createContext({window:{matchMedia:()=>({matches:reduced})},clearTimeout,setTimeout});
  const start=source.indexOf('  function v15PlaybackBootstrap(){'),end=source.indexOf('  v15PlaybackBootstrap();',start);
  vm.runInContext(source.slice(start,end)+'\nv15PlaybackBootstrap();',context);
  const playback=context.window.SuperiorPointMotion.attach({on:(name,fn)=>events.set(name,fn),getCurrentSlide:()=>current});
  for(const id of ['circle','diamond','split-horizontal','split-vertical']){
    current.dataset.transition=id;previous.dataset.spTransitionExit='false';
    events.get('slidechanged')({previousSlide:previous,currentSlide:current});
    assert.equal(previous.dataset.transition,'sp-hold-out',id+' holds default exit');
    for(const state of ['past','future']){
      previous.className=state;
      const style=dom.window.getComputedStyle(previous);
      assert.equal(style.opacity,'1');assert.equal(style.transform,'none');assert.equal(style.clipPath,'none');assert.equal(style.zIndex,'0');
    }
    playback.dispose();assert.equal(previous.dataset.transition,'fade');assert.equal(previous.dataset.transitionSpeed,'fast');
    previous.dataset.spTransitionExit='true';
    events.get('slidechanged')({previousSlide:previous,currentSlide:current});
    assert.equal(previous.dataset.transition,'fade',id+' preserves explicit exit');
  }
  previous.dataset.spTransitionExit='false';current.dataset.transition='circle-in fade-out';
  events.get('slidechanged')({previousSlide:previous,currentSlide:current});assert.equal(previous.dataset.transition,'sp-hold-out');
  events.get('slidechanged')({previousSlide:current,currentSlide:previous});
  assert.equal(previous.dataset.transition,'fade','back navigation restores the held page');
  assert.equal(current.dataset.transition,'circle-in fade-out','normal target never inherits a hold');
  reduced=true;current.dataset.transition='diamond';
  events.get('slidechanged')({previousSlide:previous,currentSlide:current});assert.equal(previous.dataset.transition,'fade');
  assert.match(source,/sec.dataset.spTransitionExit=String\(!!s.transitionExit\)/);
  assert.match(source,/else old.style.opacity=hold\?'1':'0'/,'preview does not hide a held previous page');
  dom.window.close();
});

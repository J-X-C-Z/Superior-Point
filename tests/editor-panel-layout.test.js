import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const source=readFileSync(new URL('../tools/editor-panel-layout.inc.js',import.meta.url),'utf8');
function harness(){
 const dom=new JSDOM('<body><div id="ribbon"></div><div class="canvas-zone"></div><section id="notes-panel"></section></body>',{runScripts:'outside-only'});
 const w=dom.window,d=w.document;let fitted=0,frame;
 w.fitCanvas=()=>fitted++;w.requestAnimationFrame=fn=>{frame=fn;return 1;};
 d.querySelector('.canvas-zone').getBoundingClientRect=()=>({height:250});
 for(const [id,property,fallback] of [['ribbon','--sp-ribbon-height',96],['notes-panel','--sp-notes-height',113]]){
  const panel=d.getElementById(id);panel.getBoundingClientRect=()=>({height:parseFloat(panel.style.getPropertyValue(property))||fallback});
 }
 w.eval(source+';spPanelLayoutBoot();');
 const pointer=(handle,type,y,id=1)=>{const event=new w.Event(type,{bubbles:true,cancelable:true});Object.assign(event,{clientY:y,pointerId:id,button:0});handle.dispatchEvent(event);};
 for(const handle of d.querySelectorAll('[role=separator]')){let captured=false;handle.setPointerCapture=()=>captured=true;handle.hasPointerCapture=()=>captured;handle.releasePointerCapture=()=>captured=false;}
 return {dom,w,d,pointer,fit:()=>{frame?.();return fitted;},key:(handle,key)=>handle.dispatchEvent(new w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}))};
}

test('panel sizing preserves canvas area and ends pointer capture on cancellation',()=>{
 const h=harness();try{
  const handle=h.d.getElementById('sp-panel-ribbon-sash'),panel=h.d.getElementById('ribbon');
  h.pointer(handle,'pointerdown',100);h.pointer(handle,'pointermove',900);
  assert.equal(panel.style.getPropertyValue('--sp-ribbon-height'),'166px');
  assert.equal(handle.getAttribute('aria-valuenow'),'166');assert.equal(h.d.body.classList.contains('sp-panel-resizing'),true);
  h.pointer(handle,'pointercancel',900);h.pointer(handle,'pointermove',50);
  assert.equal(panel.style.getPropertyValue('--sp-ribbon-height'),'166px');assert.equal(h.d.body.classList.contains('sp-panel-resizing'),false);
  assert.equal(h.fit(),1);handle.dispatchEvent(new h.w.MouseEvent('dblclick'));
  assert.equal(panel.style.getPropertyValue('--sp-ribbon-height'),'96px');
 }finally{h.dom.window.close();}
});

test('notes sizing uses upward growth, keyboard adjustment, reset and a single handle',()=>{
 const h=harness();try{
  const handle=h.d.getElementById('sp-panel-notes-sash'),panel=h.d.getElementById('notes-panel');
  h.pointer(handle,'pointerdown',100);h.pointer(handle,'pointermove',70);h.pointer(handle,'pointerup',70);
  assert.equal(panel.style.getPropertyValue('--sp-notes-height'),'143px');
  h.key(handle,'ArrowUp');assert.equal(panel.style.getPropertyValue('--sp-notes-height'),'153px');
  h.key(handle,'Home');assert.equal(panel.style.getPropertyValue('--sp-notes-height'),'113px');
  panel.classList.add('collapsed');h.pointer(handle,'pointerdown',100);h.pointer(handle,'pointermove',50);
  assert.equal(panel.style.getPropertyValue('--sp-notes-height'),'113px');
  h.w.eval('spPanelLayoutBoot()');assert.equal(h.d.querySelectorAll('[role=separator]').length,2);
 }finally{h.dom.window.close();}
});

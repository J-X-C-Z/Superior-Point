import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {initHomeMotion} from '../web/home-motion.js';

function harness({reduced = false, fine = true} = {}) {
  const dom = new JSDOM('<section id="home-view"><div class="intro"><div class="home-dots" aria-hidden="true"></div><button>新建</button></div></section>', {pretendToBeVisual: true});
  const {window} = dom, doc = window.document;
  const media = [fine, reduced].map(matches => Object.assign(new window.EventTarget(), {matches}));
  window.matchMedia = query => media[query.includes('reduced') ? 1 : 0];
  let serial = 0, time = 0, hidden = false;
  const frames = new Map();
  window.requestAnimationFrame = fn => {frames.set(++serial, fn); return serial;};
  window.cancelAnimationFrame = id => frames.delete(id);
  Object.defineProperty(doc, 'hidden', {get: () => hidden});
  const field = doc.querySelector('.home-dots'), intro = doc.querySelector('.intro');
  field.getBoundingClientRect = () => ({left: 0, top: 0, width: 280, height: 210});
  initHomeMotion(doc);
  const move = () => intro.dispatchEvent(new window.MouseEvent('pointermove', {clientX: 145, clientY: 105}));
  function step() {
    const current = [...frames.values()];
    frames.clear(); time += 1000 / 60;
    current.forEach(fn => fn(time));
  }
  function settle() {
    for (let n = 0; frames.size && n < 600; n++) step();
    assert.equal(frames.size, 0, 'spring stops requesting frames after settling');
  }
  return {dom, doc, window, media, field, intro, frames, move, step, settle,
    hide() {hidden = true; doc.dispatchEvent(new window.Event('visibilitychange'));}};
}

test('home dots respond, retarget, return home, and never run an idle animation loop', () => {
  const h = harness();
  assert.equal(h.field.children.length, 108);
  assert.equal(h.frames.size, 0);
  h.move(); h.step();
  assert.ok([...h.field.children].some(dot => dot.style.transform !== 'translate(0.00px, 0.00px)'));
  h.settle();
  h.intro.dispatchEvent(new h.window.Event('pointerleave'));
  h.settle();
  assert.ok([...h.field.children].every(dot => dot.style.transform === 'translate(0.00px, 0.00px)'));
  h.dom.window.close();
});

test('home motion stays static for reduced motion/coarse pointers and stops when hidden', async () => {
  for (const options of [{reduced: true}, {fine: false}]) {
    const h = harness(options);
    h.move(); assert.equal(h.frames.size, 0);
    assert.equal(h.field.children.length, 108);
    h.dom.window.close();
  }
  const h = harness();
  h.move(); h.step();
  h.doc.getElementById('home-view').hidden = true;
  await Promise.resolve();
  assert.equal(h.frames.size, 0);
  assert.ok([...h.field.children].every(dot => dot.style.transform === ''));
  h.doc.getElementById('home-view').hidden = false;
  await Promise.resolve();
  assert.equal(h.frames.size, 0);
  h.move(); h.step();
  h.media[1].matches = true;
  h.media[1].dispatchEvent(new h.window.Event('change'));
  assert.equal(h.frames.size, 0);
  h.media[1].matches = false;
  h.move(); h.step(); h.hide();
  assert.equal(h.frames.size, 0);
  h.dom.window.close();
});

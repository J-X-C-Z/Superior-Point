import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {initProjectCardMotion} from '../web/project-card-motion.js';

function harness() {
 const dom = new JSDOM('<section id="home-view"><div id="projects"><button class="cover"><svg></svg><span>打开编辑</span></button><button class="cover"><svg></svg></button></div></section>', {pretendToBeVisual: true});
 const {window: win} = dom, doc = win.document, frames = new Map(), media = new Map();
 let id = 0, time = 0;
 win.requestAnimationFrame = callback => { frames.set(++id, callback); return id; };
 win.cancelAnimationFrame = key => frames.delete(key);
 win.matchMedia = query => {
  const item = {matches: !query.includes('reduced'), listeners: new Set(), addEventListener(type, cb) {this.listeners.add(cb);}, removeEventListener(type, cb) {this.listeners.delete(cb);}, change(matches) {this.matches = matches; for (const cb of this.listeners) cb();}};
  media.set(query, item); return item;
 };
 const covers = [...doc.querySelectorAll('.cover')];
 for (const cover of covers) cover.getBoundingClientRect = () => ({left: 0, top: 0, width: 200, height: 100});
 const dispose = initProjectCardMotion(doc);
 function move(cover, x = 180, y = 20) {cover.dispatchEvent(new win.MouseEvent('pointermove', {bubbles: true, clientX: x, clientY: y}));}
 function settle() {
  let steps = 0;
  while (frames.size && steps++ < 1000) {
   const callbacks = [...frames.values()]; frames.clear(); time += 16.67;
   for (const callback of callbacks) callback(time);
  }
  assert.equal(frames.size, 0, 'settled cards must stop requesting frames');
 }
 return {dom, win, doc, covers, frames, media, move, settle, dispose};
}

test('only the hovered slide tilts, retargets dynamically, and settles without an idle loop', () => {
 const h = harness(), [first, second] = h.covers;
 assert.equal(h.frames.size, 0);
 h.move(first); h.settle();
 assert.match(first.querySelector('svg').style.transform, /rotateX\(3deg\) rotateY\(4deg\)/);
 assert.equal(first.style.transform, '');
 assert.equal(first.querySelector('span').style.transform, '');
 h.move(second); h.settle();
 assert.equal(first.querySelector('svg').style.transform, '');
 assert.ok(second.classList.contains('card-tilting'));
 second.dispatchEvent(new h.win.MouseEvent('pointerleave')); h.settle();
 assert.equal(second.querySelector('svg').style.transform, '');
 assert.equal(second.classList.contains('card-tilting'), false);
 const dynamic = first.cloneNode(true); dynamic.getBoundingClientRect = first.getBoundingClientRect;
 h.doc.querySelector('#projects').append(dynamic); h.move(dynamic); h.settle();
 assert.ok(dynamic.querySelector('svg').style.transform);
 h.dispose(); h.dom.window.close();
});

test('reduced motion, coarse pointers, and leaving home immediately restore a static preview', async () => {
 const h = harness(), [cover] = h.covers;
 h.move(cover); h.settle();
 h.media.get('(prefers-reduced-motion: reduce)').change(true);
 assert.equal(cover.querySelector('svg').style.transform, ''); h.move(cover); assert.equal(h.frames.size, 0);
 h.media.get('(prefers-reduced-motion: reduce)').change(false);
 h.media.get('(hover: hover) and (pointer: fine)').change(false);
 h.move(cover); assert.equal(h.frames.size, 0);
 h.media.get('(hover: hover) and (pointer: fine)').change(true);
 h.move(cover); h.doc.querySelector('#home-view').hidden = true;
 await Promise.resolve(); assert.equal(h.frames.size, 0); assert.equal(cover.querySelector('svg').style.transform, '');
 h.dispose(); h.dom.window.close();
});

test('optional vibration failure does not prevent navigation, and synthetic clicks do not vibrate', () => {
 const dom = new JSDOM('<div id="projects"><button class="cover"><svg></svg></button></div>', {pretendToBeVisual: true});
 const {window: win} = dom, doc = win.document, projects = doc.querySelector('#projects');
 win.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
 let callback, attempts = 0, opened = 0;
 const add = projects.addEventListener.bind(projects);
 projects.addEventListener = (type, listener, options) => {if (type === 'click') callback = listener; add(type, listener, options);};
 win.navigator.vibrate = () => {attempts++; throw new Error('unavailable');};
 const dispose = initProjectCardMotion(doc), cover = doc.querySelector('.cover');
 cover.addEventListener('click', () => opened++);
 cover.click(); assert.equal(opened, 1); assert.equal(attempts, 0);
 assert.doesNotThrow(() => callback({isTrusted: true, target: cover}));
 assert.equal(attempts, 1);
 assert.equal(projects.dataset.hapticsRequest, 'error');
 cover.click(); assert.equal(opened, 2);
 dispose(); dom.window.close();
});

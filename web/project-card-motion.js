export function initProjectCardMotion(doc = document) {
 const win = doc.defaultView, projects = doc.querySelector('#projects');
 if (!projects) return;
 projects.dataset.hapticsApi = typeof win.navigator.vibrate === 'function' ? 'available' : 'unavailable';
 const fine = win.matchMedia('(hover: hover) and (pointer: fine)');
 const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
 let cover, svg, frame = 0, last = 0;
 let value = [0, 0, 0], velocity = [0, 0, 0], target = [0, 0, 0];
 function reset() {
  win.cancelAnimationFrame(frame); frame = 0; last = 0;
  if (svg) { svg.style.transform = ''; svg.style.transition = ''; }
  cover?.classList.remove('card-tilting'); cover = svg = null;
  value = [0, 0, 0]; velocity = [0, 0, 0]; target = [0, 0, 0];
 }
 function tick(time) {
  frame = 0;
  if (!svg?.isConnected) { reset(); return; }
  const dt = last ? Math.min((time - last) / 1000, 1 / 60) : 1 / 60;
  last = time;
  let moving = false;
  for (let i = 0; i < 3; i++) {
   velocity[i] += ((target[i] - value[i]) * 100 - velocity[i] * 10) * dt;
   value[i] += velocity[i] * dt;
   if (Math.abs(target[i] - value[i]) > .001 || Math.abs(velocity[i]) > .001) moving = true;
  }
  if (!moving) value = [...target];
  svg.style.transform = `perspective(700px) rotateX(${value[0]}deg) rotateY(${value[1]}deg) translateZ(${value[2] * 6}px) scale(${1 + value[2] * .025})`;
  if (moving) frame = win.requestAnimationFrame(tick);
  else { last = 0; if (!target[2]) reset(); }
 }
 function start() { if (!frame) frame = win.requestAnimationFrame(tick); }
 function move(event) {
  if (!fine.matches || reduced.matches || doc.hidden || doc.body.classList.contains('editor-open')) return;
  const next = event.target.closest?.('.cover:not(:disabled)');
  if (!next || !projects.contains(next)) { leave(); return; }
  if (cover !== next) {
   reset(); svg = next.querySelector('svg'); if (!svg) return;
   cover = next; cover.classList.add('card-tilting'); svg.style.transition = 'none';
  }
  const rect = cover.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const x = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
  const y = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1));
  target = [-y * 5, x * 5, 1]; start();
 }
 function leave(event) {
  if (!cover || (event && event.target !== cover && event.target !== projects)) return;
  target = [0, 0, 0]; start();
 }
 function visibility() {
  if (doc.hidden || doc.body.classList.contains('editor-open') || doc.querySelector('#home-view')?.hidden) reset();
 }
 function preference() { if (!fine.matches || reduced.matches) reset(); }
 function click(event) {
  if (!event.isTrusted || reduced.matches || !event.target.closest?.('.cover:not(:disabled)')) return;
  // shortcut: browser vibration cannot address a Mac trackpad; native haptics need a native host.
  try {
   projects.dataset.hapticsRequest = typeof win.navigator.vibrate === 'function'
    ? (win.navigator.vibrate(8) ? 'accepted' : 'rejected') : 'unavailable';
  } catch { projects.dataset.hapticsRequest = 'error'; }
 }
 projects.addEventListener('pointermove', move);
 projects.addEventListener('pointerleave', leave, true);
 projects.addEventListener('click', click);
 doc.addEventListener('visibilitychange', visibility);
 fine.addEventListener('change', preference); reduced.addEventListener('change', preference);
 const observer = new win.MutationObserver(visibility);
 observer.observe(doc.body, {attributes: true, attributeFilter: ['class']});
 const home = doc.querySelector('#home-view');
 if (home) observer.observe(home, {attributes: true, attributeFilter: ['hidden']});
 return () => {
  reset(); observer.disconnect();
  projects.removeEventListener('pointermove', move);
  projects.removeEventListener('pointerleave', leave, true);
  projects.removeEventListener('click', click);
  doc.removeEventListener('visibilitychange', visibility);
  fine.removeEventListener('change', preference); reduced.removeEventListener('change', preference);
 };
}

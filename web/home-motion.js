export function initHomeMotion(doc = document) {
  const field = doc.querySelector('.home-dots');
  if (!field) return;
  const win = doc.defaultView;
  const intro = field.closest('.intro');
  const home = doc.getElementById('home-view');
  const pointer = win.matchMedia('(hover: hover) and (pointer: fine)');
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  const dots = Array.from({length: 108}, (_, index) => {
    const column = index % 12, row = Math.floor(index / 12);
    const u = (column + .5) / 12, v = (row + .5) / 9;
    const wave = Math.max(0, 1 - Math.hypot((u - .5) * 1.7, (v - .5) * 1.8));
    const size = 2 + 8 * wave * (.65 + .35 * Math.sin(column * .65 + row * .5));
    const element = doc.createElement('i');
    element.style.cssText = `left:${u * 100}%;top:${v * 100}%;width:${size}px;height:${size}px;opacity:${.25 + wave * .65}`;
    field.append(element);
    return {element, u, v, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0};
  });
  let frame = 0, previous = 0;
  const enabled = () => pointer.matches && !reduced.matches && !home.hidden && !doc.hidden;
  function stop() {
    win.cancelAnimationFrame(frame);
    frame = previous = 0;
    for (const dot of dots) {
      dot.x = dot.y = dot.vx = dot.vy = dot.tx = dot.ty = 0;
      dot.element.style.transform = '';
    }
  }
  function tick(time) {
    frame = 0;
    if (!enabled()) return stop();
    const dt = previous ? Math.min((time - previous) / 1000, 1 / 30) : 1 / 60;
    previous = time;
    let moving = false;
    for (const dot of dots) {
      // Spring: mass 1, stiffness 100, damping 10; retain velocity when the pointer reverses.
      dot.vx += ((dot.tx - dot.x) * 100 - dot.vx * 10) * dt;
      dot.vy += ((dot.ty - dot.y) * 100 - dot.vy * 10) * dt;
      dot.x += dot.vx * dt;
      dot.y += dot.vy * dt;
      const settled = Math.abs(dot.tx - dot.x) + Math.abs(dot.ty - dot.y) + Math.abs(dot.vx) + Math.abs(dot.vy) < .02;
      if (settled) { dot.x = dot.tx; dot.y = dot.ty; dot.vx = dot.vy = 0; }
      else moving = true;
      dot.element.style.transform = `translate(${dot.x.toFixed(2)}px, ${dot.y.toFixed(2)}px)`;
    }
    if (moving) frame = win.requestAnimationFrame(tick);
    else previous = 0;
  }
  function start() {
    if (!frame && enabled()) frame = win.requestAnimationFrame(tick);
  }
  function move(event) {
    if (!enabled() || event.pointerType === 'touch') return;
    const rect = field.getBoundingClientRect();
    if (!rect.width) return;
    for (const dot of dots) {
      const dx = rect.left + dot.u * rect.width - event.clientX;
      const dy = rect.top + dot.v * rect.height - event.clientY;
      const distance = Math.hypot(dx, dy);
      const force = Math.max(0, 1 - distance / 110) ** 2 * 32;
      dot.tx = dx / (distance || 1) * force;
      dot.ty = dy / (distance || 1) * force;
    }
    start();
  }
  function leave() {
    for (const dot of dots) dot.tx = dot.ty = 0;
    start();
  }
  function sync() { if (!enabled()) stop(); }
  intro.addEventListener('pointermove', move);
  intro.addEventListener('pointerleave', leave);
  doc.addEventListener('visibilitychange', sync);
  pointer.addEventListener('change', sync);
  reduced.addEventListener('change', sync);
  const observer = new win.MutationObserver(sync);
  observer.observe(home, {attributes: true, attributeFilter: ['hidden']});
}

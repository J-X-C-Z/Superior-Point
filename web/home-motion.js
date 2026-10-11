// The create control previews a slide taking shape; no page-wide pointer tracking.
export function initHomeMotion(doc = document) {
  const field = doc.querySelector('#new-project .home-dots');
  if (!field) return;
  for (let index = 0; index < 40; index++) {
    const edge = Math.floor(index / 10), t = (index % 10) / 10;
    const x = edge === 0 ? t * 80 : edge === 1 ? 80 : edge === 2 ? (1 - t) * 80 : 0;
    const y = edge === 0 ? 0 : edge === 1 ? t * 45 : edge === 2 ? 45 : (1 - t) * 45;
    const startX = (index % 8) * 11, startY = Math.floor(index / 8) * 11;
    const dot = doc.createElement('i');
    dot.style.cssText = `left:${startX}px;top:${startY}px;--slide-x:${x - startX}px;--slide-y:${y - startY}px`;
    field.append(dot);
  }
}

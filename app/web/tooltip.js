// tooltip: quick hover labels for the viewer toolbars (the browser's own title tooltip waits ~1 s and some embedded
// browsers never show it). Any element inside a .toolbar with a title or aria-label gets a small label under it at once
// The title moves to data-tip so the native tooltip doesn't double up. Mouse only: touch has no hover.
const tip = document.createElement('div');
tip.className = 'qtip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
document.addEventListener('DOMContentLoaded', () => document.body.appendChild(tip));
let timer = 0, cur = null;

function labelOf(el) {
  if (el.title) { el.dataset.tip = el.title; el.removeAttribute('title'); }
  return el.dataset.tip || el.getAttribute('aria-label') || '';
}
function hide() { clearTimeout(timer); timer = 0; cur = null; tip.hidden = true; }
function show(el) {
  const text = labelOf(el); if (!text) return;
  if (!tip.isConnected) document.body.appendChild(tip);
  tip.textContent = text; tip.hidden = false;
  const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
  tip.style.left = Math.max(8, Math.min(r.left + r.width / 2 - t.width / 2, innerWidth - t.width - 8)) + 'px';
  tip.style.top = (r.bottom + 6 + t.height > innerHeight ? r.top - t.height - 6 : r.bottom + 6) + 'px';
}

document.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const el = e.target.closest?.('.toolbar [title], .toolbar [data-tip], .toolbar [aria-label]');
  if (el === cur) return;
  hide();
  if (!el) return;
  cur = el; labelOf(el); // strip the native title at once
  show(el); // instantly (Josh)
});
document.addEventListener('pointerdown', hide, true);
addEventListener('scroll', hide, true);
addEventListener('blur', hide);

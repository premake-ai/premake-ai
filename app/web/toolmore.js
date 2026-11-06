// toolmore: the viewer toolbar on phones (studio and build pages; styles.css "Viewer toolbar on phones").
// Desktop is unchanged: every tool sits inline. On phones the bar shows Explode, See-through, Fit and Render. Explode is a
// toggle button added here (.texp-btn, hidden on desktop): tapping it opens the explode slider in the bar (and opens the
// model halfway if it was closed up); tapping it again closes the slider and keeps the explode amount. It shows "on"
// while the model is exploded. The slider keeps its own handler (app.js / buildpage.js); this only sets its value and
// fires 'input'. Event delegation plus an observer, so toolbars rendered later (build page) need no wiring.

const ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1v4M8 11v4M1 8h4M11 8h4M3 3l2.5 2.5M13 13l-2.5-2.5M13 3l-2.5 2.5M3 13l2.5-2.5" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>';

function sync(tb) {
  const r = tb.querySelector('.tslider input'), b = tb.querySelector('.texp-btn');
  if (!r || !b) return;
  const on = Number(r.value) > 0;
  if (b.classList.contains('on') !== on) b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', String(on));
}
function ensure(tb) {
  const sl = tb.querySelector('.tslider');
  if (!sl || tb.querySelector('.texp-btn')) return;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'tbtn texp-btn'; b.title = 'Explode';
  b.setAttribute('aria-expanded', 'false');
  b.innerHTML = ICON + '<span>Explode</span>';
  sl.before(b);
  sync(tb);
}
function setOpen(tb, open) {
  tb.classList.toggle('exp-open', open);
  tb.querySelector('.texp-btn')?.setAttribute('aria-expanded', String(open));
}
const scan = () => { for (const tb of document.querySelectorAll('.toolbar')) if (!tb.querySelector('.texp-btn')) ensure(tb); };

document.addEventListener('click', (e) => {
  const b = e.target.closest?.('.texp-btn');
  if (!b) return;
  const tb = b.closest('.toolbar'), r = tb?.querySelector('.tslider input');
  if (!tb || !r) return;
  const open = !tb.classList.contains('exp-open');
  setOpen(tb, open);
  if (open && Number(r.value) === 0) { r.value = '50'; r.dispatchEvent(new Event('input', { bubbles: true })); }
  if (open) r.focus({ preventScroll: true });
  sync(tb);
});
document.addEventListener('input', (e) => { const tb = e.target.closest?.('.toolbar'); if (tb && e.target.matches('.tslider input')) sync(tb); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const tb = document.querySelector('.toolbar.exp-open');
  if (tb) { setOpen(tb, false); tb.querySelector('.texp-btn')?.focus(); }
});
scan();
new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });

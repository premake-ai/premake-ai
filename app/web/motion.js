// Move button: plays the design's motion (motion.json, CONTRACT.md "motion()") in the 3D viewer. Studio and build pages.
// The viewer (web/viewer.js) fires 'viewer:motion' on its container whenever it learns whether the loaded design moves or
// starts / stops moving. This adds a Move toggle to that viewer's toolbar, right after the explode slider (inside .tmore,
// so phones show it too, as a glass icon + label button), hidden when the design has no motion. (The desktop scrub slider
// that showed while playing is gone, owner 4 Nov: it read as a stray second slider when Turn on plays the motion.)
// Explode and Move exclude each other:
// Move resets the explode slider (firing its own 'input' handler) and closes the phone slider; exploding stops Move
// (the viewer does that in set('explode')).

const ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M5 3.2v9.6L12.6 8z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';

function toolbarOf(el) { return el?.closest?.('.model-pane')?.querySelector('.toolbar') || null; }

function ensure(tb) {
  let b = tb.querySelector('.tmove-btn');
  if (b) return b;
  b = document.createElement('button');
  b.type = 'button'; b.className = 'tbtn tmove-btn'; b.hidden = true;
  b.title = 'Move: show the mechanism moving';
  b.setAttribute('aria-pressed', 'false');
  b.innerHTML = ICON + '<span>Move</span>';
  tb.querySelector('.tmove-scrub')?.remove();
  const after = tb.querySelector('.tslider');
  if (after) after.after(b); else (tb.querySelector('.tmore') || tb).append(b);
  return b;
}

function sync(tb) {
  const v = tb._viewer, b = ensure(tb);
  const has = !!v?.motion, on = !!v?.moving;
  b.hidden = !has;
  b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
}

document.addEventListener('viewer:motion', (e) => {
  const tb = toolbarOf(e.target);
  if (!tb) return;
  tb._viewer = e.detail.viewer;
  sync(tb);
});

document.addEventListener('click', (e) => {
  const b = e.target.closest?.('.tmove-btn');
  if (!b) return;
  const tb = b.closest('.toolbar'), v = tb?._viewer;
  if (!v?.motion) return;
  const on = !v.moving;
  if (on) { // Explode off first (its own handler updates the viewer), and close the phone explode slider
    const r = tb.querySelector('.tslider input');
    if (r && Number(r.value) > 0) { r.value = '0'; r.dispatchEvent(new Event('input', { bubbles: true })); }
    tb.classList.remove('exp-open'); tb.querySelector('.texp-btn')?.setAttribute('aria-expanded', 'false');
  }
  v.setMoving(on); // fires viewer:motion -> sync
});

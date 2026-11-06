// chattools: "Screenshot the 3D view" for the chat composers (studio chat and the build page Modify box).
// takeShot(viewer) captures the view as shown (viewer.capture), then opens a quick markup sheet: drag to draw orange boxes
// around what you mean, Attach (Enter) or Cancel (Esc). Resolves to a File for attach.js add(), or null.

const ORANGE = '#f97316';

function injectCss() {
  if (document.getElementById('shot-css')) return;
  const s = document.createElement('style');
  s.id = 'shot-css';
  s.textContent = `
.shot-sheet { position: fixed; inset: 0; z-index: 1000; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
  padding: 20px 16px; background: rgba(250, 250, 249, .95); }
.shot-sheet canvas { max-width: 100%; max-height: calc(100% - 70px); border-radius: 8px; box-shadow: 0 0 0 1px rgba(28,25,23,.1), 0 20px 60px rgba(28,25,23,.16);
  cursor: crosshair; touch-action: none; background: #fff; }
.shot-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; max-width: 100%; }
.shot-bar .shot-hint { color: var(--muted, #6b6560); font-size: 13px; margin-right: 6px; }
@media (max-width: 640px) { .shot-sheet { padding: 12px 12px calc(12px + env(safe-area-inset-bottom)); } .shot-bar .shot-hint { flex-basis: 100%; text-align: center; margin: 0; } }
`;
  document.head.appendChild(s);
}

/** Markup sheet over a captured Blob. Resolves to a (marked-up) Blob, or null when cancelled. */
export function markup(blob) {
  injectCss();
  return new Promise(async resolve => {
    let img;
    try { img = await createImageBitmap(blob); } catch { return resolve(blob); }
    const W = img.width, H = img.height, rects = [];
    const sheet = document.createElement('div');
    sheet.className = 'shot-sheet';
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'Screenshot of the 3D view');
    sheet.innerHTML = `<canvas width="${W}" height="${H}" aria-label="Screenshot. Drag to mark an area."></canvas>
      <div class="shot-bar"><span class="shot-hint">Drag to box what you mean (optional)</span>
        <button type="button" class="btn sm" data-a="undo" disabled>Undo</button>
        <button type="button" class="btn sm" data-a="cancel">Cancel</button>
        <button type="button" class="btn primary sm" data-a="ok">Attach</button></div>`;
    document.body.appendChild(sheet);
    const cv = sheet.querySelector('canvas'), g = cv.getContext('2d'), undo = sheet.querySelector('[data-a="undo"]');
    const lw = Math.max(3, Math.round(Math.max(W, H) / 320));
    let drag = null;
    function draw() {
      g.clearRect(0, 0, W, H); g.drawImage(img, 0, 0);
      g.lineWidth = lw; g.strokeStyle = ORANGE; g.lineJoin = 'round';
      for (const r of drag ? [...rects, drag] : rects) {
        const x = Math.min(r.x0, r.x1), y = Math.min(r.y0, r.y1), w = Math.abs(r.x1 - r.x0), h = Math.abs(r.y1 - r.y0);
        g.fillStyle = 'rgba(249,115,22,.10)'; g.fillRect(x, y, w, h);
        g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, lw * 2) : g.rect(x, y, w, h); g.stroke();
      }
      undo.disabled = !rects.length;
    }
    const at = e => { const b = cv.getBoundingClientRect(); return [(e.clientX - b.left) * W / b.width, (e.clientY - b.top) * H / b.height]; };
    cv.addEventListener('pointerdown', e => { e.preventDefault(); cv.setPointerCapture(e.pointerId); const [x, y] = at(e); drag = { x0: x, y0: y, x1: x, y1: y }; });
    cv.addEventListener('pointermove', e => { if (!drag) return; [drag.x1, drag.y1] = at(e); draw(); });
    const end = () => { if (drag && Math.abs(drag.x1 - drag.x0) > 6 && Math.abs(drag.y1 - drag.y0) > 6) rects.push(drag); drag = null; draw(); };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', () => { drag = null; draw(); });
    function done(ok) {
      removeEventListener('keydown', onKey, true);
      sheet.remove();
      if (!ok) { img.close?.(); return resolve(null); }
      if (!rects.length) { img.close?.(); return resolve(blob); }
      drag = null; draw(); img.close?.();
      cv.toBlob(b => resolve(b || blob), 'image/png');
    }
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); rects.pop(); draw(); }
    };
    addEventListener('keydown', onKey, true);
    sheet.querySelector('.shot-bar').addEventListener('click', e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'undo') { rects.pop(); draw(); } else if (a === 'cancel') done(false); else if (a === 'ok') done(true);
    });
    draw();
    sheet.querySelector('[data-a="ok"]').focus({ preventScroll: true });
  });
}

/** Capture the viewer as shown, let the person mark it up, return a File (or null if cancelled / nothing to capture). */
export async function takeShot(viewer, { mark = true } = {}) {
  if (!viewer?.items?.length) throw new Error('There’s no 3D model to screenshot yet.');
  let blob = await viewer.capture();
  if (!blob) throw new Error('Couldn’t capture the 3D view.');
  if (mark) blob = await markup(blob);
  return blob ? new File([blob], `screenshot-${Date.now()}.png`, { type: 'image/png' }) : null;
}

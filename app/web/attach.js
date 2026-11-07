// Image attachments for the home prompt box, the studio chat composer and the build page Modify box.
// Paste (Cmd/Ctrl+V), drag and drop, or the image button. On phones (touch, no hover) there is also a camera button that
// opens the rear camera (<input capture="environment">) next to a "Choose photo" library button, and after a photo the box
// offers quick chips ("Replacement part for this"...) until the user types their own words. Every image is decoded (EXIF orientation applied)
// and re-encoded in the browser (max 2000 px long side, JPEG 0.85), so EXIF and other metadata never leave the device. Uploads go to
// POST /api/projects/<id>/uploads (server/uploads.js); messages then carry the returned ids.
import { current } from './nav.js'; // urls: clean URLs

const MAX_FILES = 4;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_SIDE = 2000;
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,.heic,.heif';
// Phones: plain image/* lets iOS hand over JPEG (it converts HEIC itself); listing HEIC would get the raw HEIC file.
const PHONE_ACCEPT = 'image/*';
const isPhone = () => { try { return matchMedia('(hover: none) and (pointer: coarse)').matches; } catch { return false; } };
const CAM_PLACEHOLDER = 'Describe it: what is it, what should it do, rough size?';
const CAM_CHIPS = ['Make one like this', 'Replacement part for this', 'Make it fit this', 'Improve this design'];
const NOTE_RE = /\n\n\[Attached images: ([^\]]*)\]\s*$/;

export const defaultImageText = n => (n > 1 ? 'Design a product based on these images.' : 'Design a product based on this image.');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const camSvg = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2 5.2c0-.7.5-1.2 1.2-1.2h1.7l1-1.5h4.2l1 1.5h1.7c.7 0 1.2.5 1.2 1.2v6.6c0 .7-.5 1.2-1.2 1.2H3.2c-.7 0-1.2-.5-1.2-1.2z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="8" cy="8.4" r="2.4" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
// chattools: screenshot button icon (kept here, not imported: the gateway home page loads /attach.js on its own)
const shotSvg = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2.5 5.5v-2a1 1 0 011-1h2M10.5 2.5h2a1 1 0 011 1v2M13.5 10.5v2a1 1 0 01-1 1h-2M5.5 13.5h-2a1 1 0 01-1-1v-2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><rect x="5.3" y="5.3" width="5.4" height="5.4" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
const imgSvg = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="6" cy="6.6" r="1.2" fill="currentColor"/><path d="M2.6 12l3.6-3.4 2.4 2.2 2-1.7 2.8 2.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';

// ---------- styles (kept here so the shared stylesheet stays untouched) ----------
function injectCss() {
  if (document.getElementById('att-css')) return;
  const s = document.createElement('style');
  s.id = 'att-css';
  s.textContent = `
.att-strip { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 8px; }
.att-strip:empty { display: none; }
.att-chip { position: relative; width: 58px; height: 58px; border-radius: 7px; overflow: hidden; border: 1px solid var(--line-2); background: var(--panel-3); flex: none; }
.att-chip img { width: 100%; height: 100%; object-fit: cover; display: block; }
.att-chip.err { border-color: var(--danger); }
.att-chip.err img { opacity: .35; }
.att-chip .att-x { position: absolute; top: 3px; right: 3px; width: 18px; height: 18px; border-radius: 50%; border: 0; padding: 0; cursor: pointer;
  background: rgba(0,0,0,.72); color: #fff; font: 11px/18px var(--ui); text-align: center; }
.att-chip .att-x:hover { background: rgba(0,0,0,.92); }
.att-chip .att-bar { position: absolute; left: 4px; right: 4px; bottom: 4px; height: 4px; border-radius: 2px; background: rgba(0,0,0,.55); overflow: hidden; }
.att-chip .att-bar i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .15s; }
.att-chip .att-wait { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,.35); color: #fff; font-size: 11px; }
.att-msg { flex-basis: 100%; color: var(--danger); font-size: 12px; }
.att-btn { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 7px; border: 1px solid transparent; background: transparent;
  color: var(--muted); cursor: pointer; flex: none; padding: 0; }
.att-btn:hover { color: var(--text); background: var(--panel-3); border-color: var(--line-2); }
.att-btn:disabled { opacity: .4; cursor: default; }
.att-btn.has-label { display: inline-flex; align-items: center; gap: 6px; width: auto; padding: 0 10px 0 8px; border-color: var(--line-2); color: var(--text-2);
  font: 500 12.5px var(--ui, inherit); white-space: nowrap; }
.att-btn.has-label:hover { color: var(--text); border-color: var(--accent); }
@media (max-width: 640px) { .att-btn.has-label { align-self: flex-start; } }
.att-drop { outline: 2px dashed var(--accent); outline-offset: 3px; background-color: var(--accent-soft) !important; }
.att-drop[data-drop-label]::after { content: attr(data-drop-label); position: absolute; inset: 0; z-index: 5; display: grid; place-items: center; padding: 12px;
  border-radius: inherit; background: rgba(255, 247, 237, .94); color: #c2410c; font: 600 15px/1.3 var(--ui, inherit); text-align: center; pointer-events: none; }
.att-menu { position: fixed; z-index: 1000; min-width: 220px; padding: 4px; background: var(--panel, #fff); border: 1px solid var(--line, #e7e5e4); border-radius: 10px; box-shadow: 0 6px 20px rgba(28,25,23,.12); display: flex; flex-direction: column; }
.att-menu button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: 0; border-radius: 7px; background: none; color: var(--text, #1c1917); font: 500 13.5px/1.2 var(--ui, inherit); text-align: left; cursor: pointer; }
.att-menu button:hover, .att-menu button:focus-visible { background: var(--panel-2, #f4f3f0); outline: none; }
.att-menu svg { width: 16px; height: 16px; flex: none; color: var(--muted, #78716c); }
.att-tip { margin: 10px 0 0; text-align: center; color: var(--muted); font-size: 12.5px; }
.cam-btns { display: inline-flex; gap: 6px; flex: none; }
.cam-btns .btn { gap: 6px; }
.cam-help { margin: 0 0 8px; min-width: 0; }
.cam-help[hidden] { display: none; }
.cam-chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding-bottom: 1px; }
.cam-chips::-webkit-scrollbar { display: none; }
.cam-chips .chip { cursor: pointer; flex: none; white-space: nowrap; border: 0; border-radius: 8px; padding: 5px 10px; font-size: 12.5px; background: var(--panel-2, #f4f3f0); color: var(--text-2); }
.cam-chips .chip:hover { color: var(--text); }
.cam-chips .chip.on { background: var(--accent-soft, rgba(249,115,22,.1)); color: var(--accent-2, #c2410c); }
.cam-chips[hidden] { display: none; }
.msg-imgs { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 6px; }
.msg-imgs button { padding: 0; border: 1px solid var(--line-2); border-radius: 6px; overflow: hidden; width: 72px; height: 72px; cursor: zoom-in; background: var(--panel-2); }
.msg-imgs img { width: 100%; height: 100%; object-fit: cover; display: block; }
.att-lightbox { position: fixed; inset: 0; z-index: 1000; background: rgba(250,250,249,.94); display: grid; place-items: center; padding: 24px; cursor: zoom-out; }
.att-lightbox img { max-width: min(100%, 1600px); max-height: 100%; object-fit: contain; border-radius: 6px; box-shadow: 0 20px 60px rgba(28,25,23,.18); }
.att-lightbox button { position: absolute; top: 14px; right: 16px; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--line-2, #d6d3d1);
  background: #fff; color: var(--text, #1c1917); font-size: 16px; cursor: pointer; box-shadow: 0 2px 8px rgba(28,25,23,.1); }
`;
  document.head.appendChild(s);
}

// ---------- image processing ----------
const isHeic = f => /image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name || '');
const isAccepted = f => /^image\/(png|jpeg|jpg|webp|gif|heic|heif)$/i.test(f.type) || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(f.name || '');

async function decode(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {} // phone photos: apply EXIF rotation
    try { return await createImageBitmap(file); } catch {}
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

const toBlob = (canvas, q) => new Promise(res => canvas.toBlob(res, 'image/jpeg', q));

/** File -> JPEG Blob (downscaled, metadata stripped; GIFs keep their first frame). Throws a user-facing Error. */
export async function processImage(file) {
  if (!isAccepted(file)) throw new Error(`${file.name || 'That file'} is not an image. Attach PNG, JPEG, WebP, GIF or HEIC.`);
  let src;
  try { src = await decode(file); } catch {
    throw new Error(isHeic(file) ? 'This browser can’t open HEIC photos. Take the photo from this page, or export it as JPEG and attach that.' : `Couldn’t read ${file.name || 'that image'}.`);
  }
  const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
  if (!w0 || !h0) throw new Error(`Couldn’t read ${file.name || 'that image'}.`);
  const k = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); // transparent PNGs: white, not black, behind them
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  if (src.close) src.close();
  for (const q of [0.85, 0.72, 0.6]) {
    const b = await toBlob(c, q);
    if (b && b.size <= MAX_BYTES) return b;
  }
  throw new Error('That image is over 5 MB even after shrinking it. Try a smaller one.');
}

export function upload(projectId, blob, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', `/api/projects/${encodeURIComponent(projectId)}/uploads`);
    x.setRequestHeader('Content-Type', blob.type || 'image/jpeg');
    x.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => {
      let j = null; try { j = JSON.parse(x.responseText); } catch {}
      if (x.status >= 200 && x.status < 300 && j?.id) resolve(j);
      else reject(new Error(j?.error || `Upload failed (${x.status})`));
    };
    x.onerror = () => reject(new Error('Upload failed. Check your connection and retry.'));
    x.send(blob);
  });
}

// ---------- the controller ----------
let seq = 0;
/**
 * Wire image attachments into a text box.
 * opts = { box: element that gets the drop zone, textarea, strip: { before: element } (where the chip row goes),
 *          button: { into: element, before?: element } (where the image button goes), projectId(): current project id or null
 *          (uploads start right away when there is one), enabled(): false to refuse new images (e.g. read-only),
 *          screenshot: optional async () => File|null; adds a "Screenshot the 3D view" button after the image button,
 *          label: text on the image button ('Add image'; phones get labelled "Take photo" + "Choose photo" buttons when set,
 *          icon-only camera + image buttons when not), tip: element whose text becomes the scale tip on phones }
 * Returns { count(), uploadAll(projectId) -> [{ id, url }], clear(), add(files) }.
 */
export function attachImages(opts) {
  injectCss();
  const items = []; // { key, file, blob, thumb, state: 'processing'|'ready'|'uploading'|'done'|'error', progress, pid, id, url, error, job }
  let msgTimer = null;
  const strip = document.createElement('div');
  strip.className = 'att-strip';
  opts.strip.before.before(strip);
  const phone = isPhone();
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: phone ? PHONE_ACCEPT : ACCEPT, multiple: true, hidden: true });
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'att-btn'; btn.title = 'Attach images (or paste / drop them)'; btn.setAttribute('aria-label', 'Attach images');
  btn.innerHTML = imgSvg;
  if (opts.label) { btn.classList.add('has-label'); btn.insertAdjacentHTML('beforeend', `<span>${esc(opts.label)}</span>`); btn.setAttribute('aria-label', opts.label); }
  // a clear "drop here" overlay while a file is dragged over the box (CSS .att-drop::after)
  if (!opts.box.dataset.dropLabel) opts.box.dataset.dropLabel = opts.dropLabel || 'Drop image to design from it';
  if (getComputedStyle(opts.box).position === 'static') opts.box.style.position = 'relative';
  opts.button.into.insertBefore(btn, opts.button.before || opts.button.into.firstChild);
  btn.after(input);
  btn.onclick = () => { if (!enabled()) return; if (opts.menu && opts.screenshot && !phone) toggleMenu(); else input.click(); };
  input.onchange = () => { add([...input.files]); input.value = ''; };
  const enabled = () => !opts.enabled || opts.enabled();

  // phones: a camera button (rear camera straight away) next to the library button
  let cam = null;
  if (phone) {
    const camInput = Object.assign(document.createElement('input'), { type: 'file', accept: PHONE_ACCEPT, hidden: true });
    camInput.setAttribute('capture', 'environment');
    camInput.className = 'cam-input';
    camInput.onchange = () => { add([...camInput.files]); camInput.value = ''; };
    cam = document.createElement('button');
    cam.type = 'button';
    cam.setAttribute('aria-label', 'Take photo');
    cam.onclick = () => { if (enabled()) camInput.click(); };
    if (opts.label) { // labelled boxes (home): two clear buttons using the shared .btn style
      const wrap = document.createElement('span');
      wrap.className = 'cam-btns';
      cam.className = 'btn cam-take'; cam.innerHTML = `${camSvg}<span>Take photo</span>`;
      btn.className = 'btn cam-pick'; btn.innerHTML = `${imgSvg}<span>Choose photo</span>`; btn.setAttribute('aria-label', 'Choose photo');
      btn.before(wrap); wrap.append(cam, btn, input, camInput);
    } else { // compact composers: camera icon next to the image icon
      cam.className = 'att-btn cam-take'; cam.innerHTML = camSvg; cam.title = 'Take photo';
      btn.before(cam); cam.after(camInput);
      btn.title = 'Choose photo'; btn.setAttribute('aria-label', 'Choose photo');
    }
  }

  // opts.menu: the image button opens a small menu, "Screenshot the 3D view" or "Choose from your computer"
  let menu = null;
  async function takeShot() {
    try { const f = await opts.screenshot(); if (f) { f.shot = true; await add([f]); } }
    catch (e) { say(e.message || 'Couldn’t take a screenshot.'); }
  }
  function closeMenu() { if (!menu) return; menu.remove(); menu = null; btn.setAttribute('aria-expanded', 'false'); removeEventListener('pointerdown', outside, true); removeEventListener('keydown', onKey, true); }
  const outside = e => { if (menu && !menu.contains(e.target) && !btn.contains(e.target)) closeMenu(); };
  const onKey = e => { if (e.key === 'Escape') closeMenu(); };
  function toggleMenu() {
    if (menu) { closeMenu(); return; }
    menu = document.createElement('div'); menu.className = 'att-menu'; menu.setAttribute('role', 'menu');
    menu.innerHTML = `<button type="button" role="menuitem" data-m="shot">${shotSvg}<span>Screenshot the 3D view</span></button>`
      + `<button type="button" role="menuitem" data-m="pick">${imgSvg}<span>Choose from your computer</span></button>`;
    menu.onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; const m = b.dataset.m; closeMenu(); if (m === 'shot') takeShot(); else input.click(); };
    document.body.appendChild(menu); btn.setAttribute('aria-expanded', 'true'); // on the page itself: a blurred composer would trap a fixed menu
    const r = btn.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.bottom = (innerHeight - r.top + 6) + 'px';
    addEventListener('pointerdown', outside, true); addEventListener('keydown', onKey, true);
    menu.querySelector('button')?.focus();
  }
  if (opts.menu) btn.setAttribute('aria-haspopup', 'menu');

  // chattools: screenshot of the 3D view, right after the image button. opts.screenshot() -> File | null (cancelled); throws a user-facing Error
  let shot = null;
  if (opts.screenshot && !opts.menu) {
    shot = document.createElement('button');
    shot.type = 'button'; shot.className = 'att-btn att-shot'; shot.innerHTML = shotSvg;
    shot.title = 'Screenshot the 3D view'; shot.setAttribute('aria-label', 'Screenshot the 3D view');
    input.after(shot);
    shot.onclick = async () => {
      if (!enabled() || shot.disabled) return;
      shot.disabled = true;
      try { const f = await opts.screenshot(); if (f) { f.shot = true; await add([f]); } }
      catch (e) { say(e.message || 'Couldn’t take a screenshot.'); }
      finally { shot.disabled = items.length >= MAX_FILES; }
    };
  }

  // after a photo: describe it (placeholder + quick chips, hidden once the user types their own words)
  const help = document.createElement('div');
  help.className = 'cam-help'; help.hidden = true;
  help.innerHTML = `<div class="cam-chips">${CAM_CHIPS.map(c => `<button type="button" class="chip" data-cam-chip="${esc(c)}">${esc(c)}</button>`).join('')}</div>`
;
  strip.after(help);
  let ph0 = null; // the box's own placeholder while ours is shown
  function describeMode(on) {
    help.hidden = !on;
    const ta = opts.textarea;
    if (on && ph0 === null) { ph0 = ta.placeholder; ta.placeholder = CAM_PLACEHOLDER; }
    else if (!on && ph0 !== null) { if (ta.placeholder === CAM_PLACEHOLDER) ta.placeholder = ph0; ph0 = null; }
  }
  const chipsEl = help.querySelector('.cam-chips');
  opts.textarea.addEventListener('input', () => { const v = opts.textarea.value.trim(); chipsEl.hidden = !!v && !CAM_CHIPS.some(c => v.startsWith(c)); });
  help.addEventListener('click', e => {
    const b = e.target.closest('[data-cam-chip]');
    if (!b) return;
    e.preventDefault();
    const ta = opts.textarea, lead = b.dataset.camChip;
    let rest = ta.value;
    for (const c of CAM_CHIPS) if (rest.startsWith(c)) { rest = rest.slice(c.length).replace(/^[.:]\s*/, ''); break; }
    ta.value = `${lead}: ${rest}`;
    help.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b));
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
    try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch {}
  });

  function say(msg) {
    clearTimeout(msgTimer);
    strip.querySelector('.att-msg')?.remove();
    if (!msg) return;
    const p = document.createElement('div'); p.className = 'att-msg'; p.textContent = msg;
    strip.appendChild(p);
    msgTimer = setTimeout(() => p.remove(), 6000);
  }

  function draw() {
    const msg = strip.querySelector('.att-msg');
    strip.innerHTML = items.map(it => `<div class="att-chip${it.state === 'error' ? ' err' : ''}" data-k="${it.key}" title="${esc(it.error || it.file.name || 'Image')}">
      ${it.thumb ? `<img src="${esc(it.thumb)}" alt="">` : ''}
      ${it.state === 'processing' ? '<div class="att-wait">…</div>' : ''}
      ${it.state === 'uploading' ? `<div class="att-bar"><i style="width:${Math.round((it.progress || 0) * 100)}%"></i></div>` : ''}
      <button type="button" class="att-x" aria-label="Remove image" data-rm="${it.key}">✕</button></div>`).join('');
    if (msg) strip.appendChild(msg);
    btn.disabled = items.length >= MAX_FILES;
    if (cam) cam.disabled = items.length >= MAX_FILES;
    if (shot) shot.disabled = items.length >= MAX_FILES;
    describeMode(items.some(it => !it.file.shot)); // chattools: screenshots of the model aren't photos to describe
  }
  strip.addEventListener('click', e => {
    const rm = e.target.closest('[data-rm]');
    if (!rm) return;
    e.preventDefault();
    remove(+rm.dataset.rm);
    opts.textarea.focus();
  });

  function remove(key) {
    const i = items.findIndex(it => it.key === key);
    if (i < 0) return;
    const [it] = items.splice(i, 1);
    it.removed = true;
    if (it.thumb) URL.revokeObjectURL(it.thumb);
    if (it.id && it.pid) fetch(`/api/projects/${encodeURIComponent(it.pid)}/uploads/${encodeURIComponent(it.id)}`, { method: 'DELETE' }).catch(() => {});
    draw();
  }

  async function startUpload(it, pid) {
    if (it.state === 'done' && it.pid === pid) return it;
    if (it.job && it.jobPid === pid) return it.job;
    it.state = 'uploading'; it.progress = 0; it.jobPid = pid; draw();
    it.job = upload(pid, it.blob, p => {
      it.progress = p;
      const bar = strip.querySelector(`[data-k="${it.key}"] .att-bar i`);
      if (bar) bar.style.width = Math.round(p * 100) + '%';
    }).then(r => {
      Object.assign(it, { state: 'done', pid, id: r.id, url: r.url, job: null });
      if (it.removed) fetch(`/api/projects/${encodeURIComponent(pid)}/uploads/${encodeURIComponent(r.id)}`, { method: 'DELETE' }).catch(() => {});
      draw(); return it;
    }, e => { Object.assign(it, { state: 'error', error: e.message, job: null }); draw(); throw e; });
    return it.job;
  }

  async function add(files) {
    if (!enabled()) return;
    files = files.filter(Boolean);
    if (!files.length) return;
    const room = MAX_FILES - items.length;
    if (room <= 0) { say(`You can attach up to ${MAX_FILES} images.`); return; }
    if (files.length > room) say(`You can attach up to ${MAX_FILES} images. Added the first ${room}.`);
    for (const file of files.slice(0, room)) {
      if (!isAccepted(file)) { say(`${file.name || 'That file'} is not an image. Attach PNG, JPEG, WebP, GIF or HEIC.`); continue; }
      const it = { key: ++seq, file, state: 'processing' };
      items.push(it); draw();
      try {
        it.blob = await processImage(file);
        if (it.removed) continue;
        it.thumb = URL.createObjectURL(it.blob);
        it.state = 'ready'; draw();
        if (document.activeElement !== opts.textarea) opts.textarea.focus({ preventScroll: true }); // ready to describe it
        const pid = opts.projectId?.();
        if (pid) startUpload(it, pid).catch(() => {});
      } catch (e) {
        const i = items.indexOf(it); if (i >= 0) items.splice(i, 1);
        draw(); say(e.message);
      }
    }
  }

  // paste: image data or image files from the clipboard (plain text pastes are untouched)
  opts.textarea.addEventListener('paste', e => {
    const files = [...(e.clipboardData?.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
    if (!files.length) return;
    if (!(e.clipboardData.types || []).includes('text/plain')) e.preventDefault();
    if (!enabled()) return;
    add(files);
  });

  // drag and drop onto the box
  let depth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  opts.box.addEventListener('dragenter', e => { if (!hasFiles(e) || !enabled()) return; e.preventDefault(); depth++; opts.box.classList.add('att-drop'); });
  opts.box.addEventListener('dragover', e => { if (!hasFiles(e) || !enabled()) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  opts.box.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; opts.box.classList.remove('att-drop'); } });
  opts.box.addEventListener('drop', e => {
    depth = 0; opts.box.classList.remove('att-drop');
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (enabled()) add([...e.dataTransfer.files]);
  });

  return {
    add,
    count: () => items.length,
    /** guest: the processed images (JPEG blobs), kept client-side until sign-in (web/guest.js) */
    blobs: () => items.filter(it => it.blob && it.state !== 'error').map(it => it.blob),
    /** Upload everything to projectId (re-uploads items that went to another project) and return [{ id, url }]. Throws on any failure. */
    async uploadAll(projectId) {
      const pending = items.filter(it => it.state === 'processing');
      if (pending.length) throw new Error('Still preparing an image. Try again in a second.');
      const done = await Promise.allSettled(items.map(it => startUpload(it, projectId)));
      const bad = done.find(r => r.status === 'rejected');
      if (bad) throw new Error(bad.reason?.message || 'An image failed to upload. Remove it and try again.');
      return items.map(it => ({ id: it.id, url: it.url }));
    },
    clear() { for (const it of items) if (it.thumb) setTimeout(() => URL.revokeObjectURL(it.thumb), 60e3); items.length = 0; say(''); draw(); help.querySelectorAll('.chip.on').forEach(x => x.classList.remove('on')); },
  };
}

// ---------- chat history: thumbnails + lightbox ----------
/** The note the server appends for the agent, hidden from the person. */
export const stripImageNote = t => String(t ?? '').replace(NOTE_RE, '');

/** Thumbnails for a sent user message: m.attachments, or (for messages saved before the tag landed) the server note. */
export function messageImagesHtml(m) {
  let list = Array.isArray(m.attachments) ? m.attachments : [];
  if (!list.length) {
    const hit = NOTE_RE.exec(String(m.text || ''));
    const pid = decodeURIComponent((current().match(/^\/p\/([^/?]+)/) || [])[1] || ''); // urls: route in the old shape (web/nav.js)
    if (hit && pid) list = [...hit[1].matchAll(/\.\/uploads\/([\w.-]+)/g)].map(x => ({ id: x[1], url: `/files/projects/${encodeURIComponent(pid)}/uploads/${x[1]}` }));
  }
  list = list.filter(a => a && typeof a.url === 'string' && /^(\/files\/projects\/|blob:)/.test(a.url));
  if (!list.length) return '';
  return `<div class="msg-imgs">${list.map(a => `<button type="button" data-att-full="${esc(a.url)}" aria-label="Open image"><img src="${esc(a.url)}" alt="Attached image" loading="lazy"></button>`).join('')}</div>`;
}

function openLightbox(url) {
  injectCss();
  const box = document.createElement('div');
  box.className = 'att-lightbox';
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Image');
  box.innerHTML = `<img src="${esc(url)}" alt="Attached image"><button type="button" aria-label="Close">✕</button>`;
  const close = () => { box.remove(); removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  box.onclick = close;
  addEventListener('keydown', onKey, true);
  document.body.appendChild(box);
  box.querySelector('button').focus();
}
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-att-full]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  openLightbox(b.dataset.attFull);
}, true);

// A file dropped anywhere else shouldn't make the browser navigate away to it.
addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
addEventListener('drop', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });

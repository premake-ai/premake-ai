// Guest mode: signed-out visitors (through the gateway) use the real studio read-only. Anything that would write
// (Start building, chat, Remix, Order, Launch, New design, publish...) opens a small "Sign in" modal instead.
// A prompt typed as a guest is kept as a draft (text in localStorage + sessionStorage, images as blobs in IndexedDB, or as
// data URLs in sessionStorage under ~4 MB where IndexedDB is unavailable) and sent automatically after sign-in: Google
// returns to /?resume=1. keepImages/takeImages are the same store for other pages (the build page's Modify box).
// Used by the studio (web/app.js) and by the gateway's public home page (gateway/home), so it imports nothing but
// /analytics.js (no imports itself; the gateway serves its own copy).
import { track } from './analytics.js';

const DRAFT_KEY = 'forma.draft';
const DRAFT_TTL = 2 * 3600e3;
const MAX_IMG_CHARS = 4 * 1024 * 1024; // data URLs, total
export const RESUME_NEXT = '/?resume=1'; // urls: was /#/?resume=1 (still works: the studio rewrites #/ links)

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const G_LOGO = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

/** Google sign-in that comes back to `next` (a same-site path, may include a #hash). */
export const signInHref = next => '/auth/login?next=' + encodeURIComponent(next || (location.pathname + location.search + location.hash) || '/');

// ---------------------------------------------------------------- modal
function injectCss() {
  if (document.getElementById('guest-css')) return;
  const s = document.createElement('style');
  s.id = 'guest-css';
  s.textContent = `
.gm-back { position: fixed; inset: 0; z-index: 2000; background: rgba(28,25,23,.32); backdrop-filter: blur(3px); display: grid; place-items: center; padding: 16px; animation: gm-in .14s ease-out; }
.gm { position: relative; width: 100%; max-width: 380px; background: var(--panel, #fff); color: var(--text, #1c1917); border: 1px solid var(--line-2, #d6d3d1);
  border-radius: 14px; padding: 28px 24px 20px; box-shadow: 0 30px 80px rgba(28,25,23,.18); font: 14px/1.5 var(--ui, Inter, system-ui, sans-serif); text-align: center; }
.gm h2 { margin: 0 0 6px; font-size: 20px; font-weight: 650; letter-spacing: normal; }
.gm p { margin: 0; color: var(--text-2, #44403c); }
.gm .gm-g { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; margin: 20px 0 12px; padding: 11px 14px; border-radius: 10px;
  background: #fff; color: #1f1f1f; border: 1px solid #dadce0; font-weight: 600; font-size: 15px; text-decoration: none; }
.gm .gm-g:hover { background: #f3f3f3; }
.gm .gm-g:focus-visible { outline: 2px solid var(--accent, #ff7a1a); outline-offset: 2px; }
.gm .gm-warn { margin: 12px 0 0; padding: 9px 11px; border-radius: 8px; background: var(--accent-soft, rgba(249,115,22,.1)); color: var(--text, #1c1917); font-size: 13px; text-align: left; }
.gm .gm-legal { margin-top: 14px; font-size: 12px; color: var(--muted, #6b6560); }
.gm .gm-legal a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
.gm .gm-x { position: absolute; top: 10px; right: 10px; width: 30px; height: 30px; border-radius: 8px; border: 0; background: transparent; color: var(--muted, #6b6560);
  font-size: 16px; cursor: pointer; }
.gm .gm-x:hover { background: var(--panel-3, #f1f1ef); color: var(--text, #1c1917); }
.gm-mark { display: inline-block; width: 28px; height: 28px; border-radius: 7px; margin-bottom: 14px;
  background: linear-gradient(135deg, #ff7a1a 0 50%, transparent 50%), repeating-linear-gradient(0deg, #ffb27a 0 2px, #e8610c 2px 4px); }
@keyframes gm-in { from { opacity: 0; } }
@media (max-width: 640px) { .gm .gm-x { width: 40px; height: 40px; top: 6px; right: 6px; } .gm .gm-legal { font-size: 13px; } .gm .gm-legal a { display: inline-block; padding: 6px 0; } }
`;
  document.head.appendChild(s);
}

let open = null;
/** Show the sign-in modal. opts: { title, text, next, warn } */
export function signInModal(opts = {}) {
  track('signup_cta_clicked', { cta: opts.next === RESUME_NEXT ? 'prompt' : 'modal', page: location.pathname }, { now: true }); // analytics:
  // Online: go to the full-page sign-in (split screen with the product animation) instead of a modal.
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
    location.href = '/auth/signin?next=' + encodeURIComponent(opts.next || (location.pathname + location.search + location.hash) || '/');
    return;
  }
  injectCss();
  open?.close();
  const back = document.createElement('div');
  back.className = 'gm-back';
  back.innerHTML = `<div class="gm" role="dialog" aria-modal="true" aria-labelledby="gmTitle">
    <button type="button" class="gm-x" aria-label="Close">✕</button>
    <span class="gm-mark" aria-hidden="true"></span>
    <h2 id="gmTitle">${esc(opts.title || 'Sign in to start building')}</h2>
    <p>${esc(opts.text || 'Free to try. Your designs are saved to your account.')}</p>
    ${opts.warn ? `<p class="gm-warn">${esc(opts.warn)}</p>` : ''}
    <a class="gm-g" id="gmGo" href="${esc(signInHref(opts.next))}">${G_LOGO}Continue with Google</a>
  </div>`;
  const prevFocus = document.activeElement;
  const close = () => { back.remove(); removeEventListener('keydown', onKey, true); open = null; prevFocus?.focus?.(); };
  const onKey = e => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'Tab') { // keep focus inside
      const f = [...back.querySelectorAll('button, a')]; const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  };
  back.addEventListener('click', e => { if (e.target === back || e.target.closest('.gm-x')) close(); });
  addEventListener('keydown', onKey, true);
  document.body.appendChild(back);
  back.querySelector('#gmGo').focus();
  open = { close };
  return open;
}

// ---------------------------------------------------------------- drafts
const store = kind => { try { return kind === 'session' ? sessionStorage : localStorage; } catch { return null; } };
const blobToDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

// Draft images in IndexedDB: phone photos (up to 4 x ~1 MB) don't fit sessionStorage. Same origin before and after
// the Google round trip (premake.ai), so the blobs are still there when the studio resumes.
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open('buildery-drafts', 1); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => req.result.createObjectStore('images');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction('images', mode);
        const r = fn(tx.objectStore('images'));
        tx.oncomplete = () => { db.close(); resolve(r?.result); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
      } catch (e) { db.close(); reject(e); }
    };
  });
}
/** Keep image blobs under `key` for after sign-in. Resolves true when stored. */
export async function keepImages(key, blobs) {
  try {
    if (!blobs.length) { await idb('readwrite', s => s.delete(key)); return true; }
    await idb('readwrite', s => s.put({ t: Date.now(), blobs: blobs.map(b => new Blob([b], { type: b.type || 'image/jpeg' })) }, key));
    return true;
  } catch { return false; }
}
/** The images kept under `key` (as Files, within the TTL), removed from the store unless keep. [] if none. */
export async function takeImages(key, keep = false) {
  try {
    const v = await idb('readonly', s => s.get(key));
    if (!keep) idb('readwrite', s => s.delete(key)).catch(() => {});
    if (!v || Date.now() - (v.t || 0) > DRAFT_TTL || !Array.isArray(v.blobs)) return [];
    return v.blobs.map((b, i) => new File([b], `photo-${i + 1}.jpg`, { type: b.type || 'image/jpeg' }));
  } catch { return []; }
}

/** Keep a guest's prompt for after sign-in. Returns { imagesKept, imagesDropped }. */
export async function saveDraft(text, blobs = []) {
  const t = Date.now();
  const base = { text: String(text || ''), t };
  if (blobs.length && await keepImages(DRAFT_KEY, blobs)) {
    base.idb = blobs.length;
    for (const k of ['local', 'session']) { try { store(k)?.setItem(DRAFT_KEY, JSON.stringify(base)); } catch {} }
    return { imagesKept: blobs.length, imagesDropped: 0 };
  }
  // no IndexedDB (some private modes): data URLs in sessionStorage, when small enough
  let images = [];
  try { images = await Promise.all(blobs.map(blobToDataUrl)); } catch { images = []; }
  const total = images.reduce((n, s) => n + s.length, 0);
  let kept = images.length && total <= MAX_IMG_CHARS ? images : [];
  try { store('local')?.setItem(DRAFT_KEY, JSON.stringify(base)); } catch {}
  const ss = store('session');
  try { ss?.setItem(DRAFT_KEY, JSON.stringify({ ...base, images: kept })); }
  catch { kept = []; try { ss?.setItem(DRAFT_KEY, JSON.stringify(base)); } catch {} }
  return { imagesKept: kept.length, imagesDropped: blobs.length - kept.length };
}
/** The saved draft ({ text, images: [dataUrl], idb: n images in IndexedDB }) or null. Doesn't clear it. */
export function readDraft() {
  for (const k of ['session', 'local']) {
    try {
      const d = JSON.parse(store(k)?.getItem(DRAFT_KEY) || 'null');
      if (d && typeof d.text === 'string' && Date.now() - (d.t || 0) < DRAFT_TTL && (d.text.trim() || d.images?.length || d.idb)) {
        return { text: d.text, idb: d.idb || 0, images: Array.isArray(d.images) ? d.images.filter(s => typeof s === 'string' && s.startsWith('data:image/')) : [] };
      }
    } catch {}
  }
  return null;
}
export function clearDraft() { for (const k of ['session', 'local']) { try { store(k)?.removeItem(DRAFT_KEY); } catch {} } }

/** A guest pressed Start building: keep the prompt, then ask them to sign in (coming back to /?resume=1). */
export async function guestStart(text, blobs = []) {
  const r = await saveDraft(text, blobs);
  signInModal({ next: RESUME_NEXT, warn: r.imagesDropped ? 'Your images are too large to keep while you sign in. Attach them again afterwards; your text is saved.' : '' });
  return r;
}

const dataUrlToFile = (u, i) => {
  const [head, b64] = u.split(',');
  const type = (/data:([^;]+)/.exec(head) || [])[1] || 'image/jpeg';
  const bin = atob(b64); const a = new Uint8Array(bin.length);
  for (let j = 0; j < bin.length; j++) a[j] = bin.charCodeAt(j);
  return new File([a], `image-${i + 1}.${type.split('/')[1] || 'jpg'}`, { type });
};

/**
 * After sign-in (/?resume=1): put the saved draft into the home box and press Start building, once.
 * ctx: { textarea, form, att (attachImages controller) }. The draft is cleared before sending, so a reload can't send it twice.
 */
let resumed = false;
export async function resumeDraft(ctx) {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of new URLSearchParams(location.hash.split('?')[1] || '')) q.set(k, v); // old /#/?resume=1
  if (!q.has('resume')) return false;
  q.delete('resume');
  history.replaceState(history.state, '', location.pathname + (q.toString() ? '?' + q : '')); // drop ?resume=1 either way
  if (resumed) return false;
  const d = readDraft();
  clearDraft();
  if (!d) return false;
  resumed = true;
  ctx.textarea.value = d.text;
  const files = d.idb ? await takeImages(DRAFT_KEY) : d.images.map(dataUrlToFile);
  if (files.length && ctx.att) { try { await ctx.att.add(files); } catch {} }
  if (!d.text.trim() && !files.length) return false;
  ctx.form.requestSubmit();
  return true;
}

// ---------------------------------------------------------------- the studio in guest mode
// Write controls: a capture-phase click guard opens the modal before the app's own handler runs.
const GUARDED = ['#newBtn', '#remixBtn', '#remixBtn2', '#launchBtn', '#sendBtn', '[data-buy]', '.mk-remix', '#scRemix', '#lnRemix', '#adsGen', '#lnGenAds',
  '#composer .att-btn'].join(',');
const TITLES = { '#newBtn': 'Sign in to start building', '[data-buy]': 'Sign in to order', '#launchBtn': 'Sign in to launch a product' };

/** ctx: { access, homeForm, homeTextarea, homeAtt } */
export function installGuest(ctx) {
  const { access } = ctx;
  if (!access || !access.showcase || !access.signin) return false;
  document.body.dataset.guest = '1';
  addEventListener('click', e => {
    const el = e.target.closest?.(GUARDED);
    if (!el || el.disabled) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const key = Object.keys(TITLES).find(k => el.matches(k));
    signInModal({ title: key ? TITLES[key] : el.matches('.mk-remix, #remixBtn, #remixBtn2, #scRemix, #lnRemix') ? 'Sign in to remix this design' : 'Sign in to continue',
      next: location.pathname + location.search + location.hash });
  }, true);
  // Start building (button or Enter): keep the prompt and images, then sign in.
  addEventListener('submit', e => {
    if (e.target !== ctx.homeForm) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const text = ctx.homeTextarea.value.trim();
    const blobs = ctx.homeAtt?.blobs ? ctx.homeAtt.blobs() : [];
    if (!text && !blobs.length) { ctx.homeTextarea.focus(); return; }
    guestStart(text, blobs);
  }, true);
  // Enter in the studio chat
  addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.target?.id !== 'chatInput') return;
    e.preventDefault(); e.stopImmediatePropagation();
    signInModal({ title: 'Sign in to start building', next: location.pathname + location.search + location.hash });
  }, true);
  // Anything else that tries to write (web/api.js raises this before refusing the request)
  addEventListener('forma:signin', () => { if (!open) signInModal({ title: 'Sign in to continue', next: location.pathname + location.search + location.hash }); });
  // Keep a typed prompt if they come back without signing in (same tab)
  const d = readDraft();
  if (d && !ctx.homeTextarea.value) ctx.homeTextarea.value = d.text;
  return true;
}

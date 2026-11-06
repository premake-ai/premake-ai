// apps: the studio's App tab (desktop). The companion app runs with demo data (/apps/<id>?preview=1, served by
// server/apps.js) in a Phone frame (an iPhone: bezel, Dynamic Island, status bar, home indicator) or a Web frame (a browser
// window at desktop width), chosen with a segmented control and remembered. Beside it, "Open on your phone": a QR code for
// a short-lived, read-only preview link (/apps/t/<token>, demo data only, 24 h, revocable; GET|POST|DELETE
// /api/apps/<id>/link) with the link text and Copy. The right panel's chat talks to the app agent (chat target "app").
// No app yet: one line about it and a "Build the app" button that starts the app agent with a first prompt.
// Examples (ctx.example): the example's own app at /apps/ex/<slug>, public, no build button, the QR opens that page.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const W = 393, H = 852, BEZEL = 14; // an iPhone 15/16 viewport in CSS px, plus the frame around it
const STATUS_H = 54; // the status bar the frame draws above the app (the app starts below it, like a Home Screen web app)
const WEB_W = 1100, WEB_H = 720, CHROME_H = 40; // the browser frame
const VIEW_KEY = 'premake.appView';

export const FIRST_PROMPT = 'Build the companion app for this product: a home screen with every device as a big card showing its status and latest readings, '
  + 'a device screen with day, week and month charts, its profile and a photo check, plus profiles and alerts that suit this product. '
  + 'If the product has anything the owner can drive (a servo, motor, relay, LEDs, a buzzer), give it big, touch-friendly controls for them.';

const PHONE_ART = `<svg class="ap-art" viewBox="0 0 120 220" width="120" height="220" aria-hidden="true">
  <rect x="4" y="4" width="112" height="212" rx="22" fill="#fff" stroke="#d6d3d1" stroke-width="2"/>
  <rect x="44" y="12" width="32" height="8" rx="4" fill="#e7e5e4"/>
  <rect x="14" y="34" width="92" height="52" rx="12" fill="#f1f1ef"/><rect x="22" y="44" width="40" height="7" rx="3.5" fill="#d6d3d1"/>
  <rect x="22" y="58" width="28" height="16" rx="5" fill="#e8590c" opacity=".85"/><path d="M58 74c8-10 14 0 22-8s12-4 18-10" fill="none" stroke="#e8590c" stroke-width="2.4" stroke-linecap="round" opacity=".5"/>
  <rect x="14" y="94" width="92" height="52" rx="12" fill="#f1f1ef"/><rect x="22" y="104" width="48" height="7" rx="3.5" fill="#d6d3d1"/><rect x="22" y="118" width="22" height="16" rx="5" fill="#a8a29e"/>
  <rect x="14" y="154" width="92" height="52" rx="12" fill="#f1f1ef"/><rect x="22" y="164" width="34" height="7" rx="3.5" fill="#d6d3d1"/><rect x="22" y="178" width="26" height="16" rx="5" fill="#a8a29e"/>
</svg>`;
const OPEN = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v3.5H3V4h3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const RELOAD = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const PHONE_I = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="4.25" y="1.75" width="7.5" height="12.5" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7 12h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const WEB_I = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1.75 5.75h12.5" stroke="currentColor" stroke-width="1.4"/></svg>';
// status bar glyphs: cellular bars, Wi-Fi, battery (drawn, no images)
const STATUS_ICONS = `<svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
  <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true"><path d="M8 2.2c2.4 0 4.6.9 6.2 2.5l1.2-1.3A10.4 10.4 0 0 0 8 .4C5.2.4 2.6 1.5.6 3.4l1.2 1.3A8.6 8.6 0 0 1 8 2.2zm0 3.6c1.4 0 2.7.5 3.6 1.4l1.3-1.3A7 7 0 0 0 8 4c-1.9 0-3.6.7-4.9 1.9l1.3 1.3c.9-.9 2.2-1.4 3.6-1.4zm0 3.5c-.6 0-1.2.3-1.6.7L8 11.6l1.6-1.6c-.4-.4-1-.7-1.6-.7z"/></svg>
  <svg width="27" height="13" viewBox="0 0 27 13" aria-hidden="true"><rect x=".5" y=".5" width="23" height="12" rx="3.8" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2.5"/><path d="M25 4.5v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2z" opacity=".45"/></svg>`;

const view = () => { try { return localStorage.getItem(VIEW_KEY) === 'web' ? 'web' : 'phone'; } catch { return 'phone'; } };
const setView = v => { try { localStorage.setItem(VIEW_KEY, v); } catch {} };

/** Draw the App tab into el. ctx: { id, title, info: { exists, ... }, running, step, build(), example?: { slug, url } }.
 *  Keeps the preview frame (and the app's state inside it) when nothing changed, so re-renders don't reload the app. */
export function renderAppPane(el, ctx) {
  const { id, info = {}, running } = ctx;
  const mode = info.exists ? 'app' : running ? 'building' : 'empty';
  const key = `${id}|${mode}|${view()}`;
  if (el._key === key) { syncBar(el, ctx); return; }
  el._key = key;
  el._ro?.disconnect(); el._ro = null;
  if (mode !== 'app') {
    el.innerHTML = `<div class="ap-empty">${PHONE_ART}
      ${mode === 'building'
        ? `<h2>Building your app…</h2><p class="muted ap-step"></p><div class="ap-spin" aria-hidden="true"></div>`
        : `<h2>A phone app for ${esc(ctx.title || 'this design')}</h2>
           <p class="muted">Live readings, history, alerts and controls, installable on any phone. The app agent writes it from this design’s parts and firmware.</p>
           <button class="btn primary ap-build" type="button">Build the app</button><p class="muted small">Takes a few minutes. You can keep designing meanwhile.</p>`}
    </div>`;
    const b = el.querySelector('.ap-build'); if (b) b.onclick = () => { b.disabled = true; ctx.build?.(FIRST_PROMPT); };
    syncBar(el, ctx);
    return;
  }
  const at = ctx.example ? ctx.example.url : `/apps/${encodeURIComponent(id)}`;
  const url = ctx.example ? at : `${at}?preview=1`;
  const v = view();
  el.innerHTML = `<div class="ap-bar">
      <div class="ap-seg" role="radiogroup" aria-label="Preview as">
        <button type="button" role="radio" data-v="phone" aria-checked="${v === 'phone'}" class="${v === 'phone' ? 'on' : ''}">${PHONE_I}<span>Phone</span></button>
        <button type="button" role="radio" data-v="web" aria-checked="${v === 'web'}" class="${v === 'web' ? 'on' : ''}">${WEB_I}<span>Web</span></button>
      </div>
      <span class="muted ap-note">Demo data</span><span class="ap-busy" hidden><span class="spin"></span>The app agent is updating it</span>
      <span class="ap-sp"></span>
      <button class="tbtn ap-reload" type="button" title="Reload the preview">${RELOAD}<span>Reload</span></button>
      ${ctx.example ? '' : `<a class="btn sm ap-open" href="${esc(at)}" target="_blank" rel="noopener" title="The real app, with your devices">Open app ${OPEN}</a>`}</div>
    <div class="ap-body">
      <div class="ap-stage ap-v-${v}"><div class="ap-fit">${v === 'phone' ? phoneFrame(url) : webFrame(url)}</div></div>
      <aside class="ap-side" aria-label="Open on your phone"></aside>
    </div>`;
  el.querySelector('.ap-reload').onclick = () => reloadAppPreview(el);
  el.querySelectorAll('.ap-seg [data-v]').forEach(b => b.onclick = () => { if (view() === b.dataset.v) return; setView(b.dataset.v); renderAppPane(el, ctx); });
  const stage = el.querySelector('.ap-stage'), fit = el.querySelector('.ap-fit'), dev = fit.firstElementChild;
  const [fw, fh] = v === 'phone' ? [W + BEZEL * 2, H + BEZEL * 2] : [WEB_W, WEB_H + CHROME_H];
  const size = () => {
    const r = stage.getBoundingClientRect();
    const s = Math.max(0.2, Math.min(1, (r.height - 40) / fh, (r.width - 40) / fw));
    fit.style.width = `${Math.round(fw * s)}px`; fit.style.height = `${Math.round(fh * s)}px`;
    dev.style.transform = `scale(${s})`;
  };
  el._ro = new ResizeObserver(size); el._ro.observe(stage); size();
  tick(el);
  renderSide(el.querySelector('.ap-side'), ctx);
  syncBar(el, ctx);
}
function phoneFrame(url) {
  return `<div class="ap-phone">
    <span class="ap-key ap-key-a" aria-hidden="true"></span><span class="ap-key ap-key-b" aria-hidden="true"></span><span class="ap-key ap-key-c" aria-hidden="true"></span><span class="ap-key ap-key-p" aria-hidden="true"></span>
    <div class="ap-screen">
      <div class="ap-status" aria-hidden="true"><span class="ap-time">9:41</span><span class="ap-island"></span><span class="ap-icons">${STATUS_ICONS}</span></div>
      <iframe class="ap-frame" title="App preview on a phone" src="${esc(url)}" style="height:${H - STATUS_H}px"></iframe>
      <span class="ap-home" aria-hidden="true"></span>
    </div></div>`;
}
function webFrame(url) {
  const shown = `${location.host}${url.replace(/\?preview=1$/, '')}`;
  return `<div class="ap-browser">
    <div class="ap-chrome" aria-hidden="true"><span class="ap-dots"><i></i><i></i><i></i></span><span class="ap-url">${esc(shown)}</span><span class="ap-dots ap-ghost"><i></i><i></i><i></i></span></div>
    <iframe class="ap-frame" title="App preview in a browser" src="${esc(url)}" style="width:${WEB_W}px;height:${WEB_H}px"></iframe></div>`;
}
/** The status bar clock shows the real time, like a phone would. */
function tick(el) {
  clearTimeout(el._tick);
  const t = el.querySelector('.ap-time'); if (!t) return;
  const d = new Date(); t.textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  el._tick = setTimeout(() => { if (el.isConnected) tick(el); }, 30e3);
}
function syncBar(el, ctx) {
  const busy = el.querySelector('.ap-busy'); if (busy) { busy.hidden = !ctx.running; const n = el.querySelector('.ap-note'); if (n) n.hidden = !!ctx.running; }
  const st = el.querySelector('.ap-step'); if (st) st.textContent = ctx.step || 'Writing the screens, charts and controls';
}
/** The app changed (an app-agent save): reload the preview, at most once a second. */
export function reloadAppPreview(el) {
  const f = el?.querySelector('.ap-frame');
  if (!f) return;
  clearTimeout(el._rt);
  el._rt = setTimeout(() => { try { f.contentWindow.location.reload(); } catch { f.src = f.src; } }, 900);
}

// ---------------------------------------------------------------- "Open on your phone": QR + link
let qrLoad = null;
/** web/apps/qr.js is a classic script (window.BuilderyQR); load it once. */
export function loadQr() {
  if (window.BuilderyQR) return Promise.resolve(window.BuilderyQR);
  qrLoad ||= new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = '/apps/qr.js'; s.async = true;
    s.onload = () => (window.BuilderyQR ? resolve(window.BuilderyQR) : reject(new Error('qr')));
    s.onerror = () => { qrLoad = null; reject(new Error('qr')); };
    document.head.append(s);
  });
  return qrLoad;
}
async function linkReq(id, method) {
  const r = await fetch(`/api/apps/${encodeURIComponent(id)}/link`, { method, credentials: 'same-origin', headers: { Accept: 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.');
  return j.link || null;
}
const left = iso => {
  const ms = Date.parse(iso) - Date.now();
  if (!(ms > 0)) return 'expired';
  const h = Math.floor(ms / 3600e3), m = Math.round((ms % 3600e3) / 60e3);
  return h >= 1 ? `${h} h${m && h < 3 ? ` ${m} min` : ''}` : `${Math.max(1, m)} min`;
};
async function renderSide(side, ctx) {
  const token = side._token = {};
  const fresh = () => side._token === token && side.isConnected;
  const draw = (link, err = '') => {
    if (!fresh()) return;
    const abs = link ? new URL(link.url, location.origin).href : '';
    side.innerHTML = `<h3>Open on your phone</h3>
      ${link ? `<div class="ap-qr"><canvas aria-label="QR code for ${esc(abs)}" role="img"></canvas></div>
        <p class="ap-hint">Point your phone’s camera at the code.${ctx.example ? '' : ' It opens this app with demo data, no sign-in needed.'}</p>
        <div class="ap-link"><input type="text" readonly value="${esc(abs)}" aria-label="Preview link"><button type="button" class="tbtn ap-copy">Copy</button></div>
        ${ctx.example ? '' : `<p class="ap-meta muted">Works for ${esc(left(link.expires))} · <button type="button" class="ap-lnk ap-new">New link</button> · <button type="button" class="ap-lnk ap-off">Turn off</button></p>`}
        <p class="ap-meta muted">To install it: open the link in Safari, tap Share, then Add to Home Screen.</p>`
      : `<div class="ap-qr ap-qr-empty">${PHONE_I.replace(/13/g, '30')}</div>
        <p class="ap-hint">Make a private link to try the app on your phone with demo data. It works for 24 hours, and you can turn it off any time.</p>
        <button type="button" class="btn primary ap-make">Show QR code</button>`}
      ${err ? `<p class="ap-err">${esc(err)}</p>` : ''}`;
    if (link) {
      const cv = side.querySelector('canvas');
      loadQr().then(Q => { if (fresh()) Q.draw(cv.getContext('2d'), Q.encode(abs), 5); }).catch(() => { cv.replaceWith(Object.assign(document.createElement('p'), { className: 'ap-err', textContent: 'The QR code didn’t load. Copy the link instead.' })); });
      const inp = side.querySelector('input');
      inp.onfocus = () => inp.select();
      side.querySelector('.ap-copy').onclick = async e => {
        try { await navigator.clipboard.writeText(abs); } catch { inp.select(); document.execCommand?.('copy'); }
        e.target.textContent = 'Copied'; setTimeout(() => { if (e.target.isConnected) e.target.textContent = 'Copy'; }, 1600);
      };
    }
    const act = (sel, method) => { const b = side.querySelector(sel); if (b) b.onclick = async () => { b.disabled = true; try { draw(await linkReq(ctx.id, method)); } catch (x) { draw(link, x.message); } }; };
    act('.ap-make', 'POST'); act('.ap-new', 'POST'); act('.ap-off', 'DELETE');
  };
  if (ctx.example) return draw({ url: ctx.example.url });
  side.innerHTML = '<h3>Open on your phone</h3><div class="ap-qr ap-qr-empty"><span class="spin"></span></div>';
  try { draw(await linkReq(ctx.id, 'GET')); } catch (e) { draw(null, e.message); }
}

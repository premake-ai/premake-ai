// Ads: static Meta ads for one design (#/ads/p/<id>, #/ads/examples/<slug>).
// Creatives are composited client-side on <canvas> from transparent renders + palette + copy.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => n == null ? '–' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export const FORMATS = { feed: { w: 1080, h: 1080, label: 'Feed 1:1' }, story: { w: 1080, h: 1920, label: 'Stories 9:16' } };
const SHOTS = ['hero', 'low', 'front', 'detail'];
const SHOT_LABEL = { hero: 'Hero', low: 'Low angle', front: 'Front', detail: 'Close-up' };

// ---------- design picker (shared by Ads and Website) ----------
export function srcKey(src) { return src ? (src.project ? 'p/' + src.project : 'examples/' + src.example) : ''; }
export function designPicker({ projects, examples, current, prefix }) {
  const item = (href, thumb, title, on) => `<a class="dp-item ${on ? 'on' : ''}" href="${href}">
    <span class="dp-thumb" ${thumb ? `style="background-image:url('${esc(thumb)}')"` : ''}></span><span class="dp-t">${esc(title)}</span></a>`;
  const cur = srcKey(current);
  const p = (projects || []).map(x => item(`${prefix}/p/${encodeURIComponent(x.id)}`, x.thumb, x.title || 'Untitled design', cur === 'p/' + x.id)).join('');
  const e = (examples || []).map(x => item(`${prefix}/examples/${encodeURIComponent(x.slug)}`, x.thumb, x.title, cur === 'examples/' + x.slug)).join('');
  return `<div class="dp-group">Your projects</div>${p || '<div class="dp-empty">No projects yet.</div>'}
    <div class="dp-group">Examples</div>${e || (examples ? '<div class="dp-empty">No examples.</div>' : '<div class="dp-empty">Loading…</div>')}`;
}

// ---------- colour helpers ----------
function lum(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a, b) { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); }
export function inkOn(bg) { return contrast(bg, '#ffffff') >= contrast(bg, '#111111') ? '#ffffff' : '#111111'; }
function mix(a, b, t) {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

// ---------- image loading + product bounds ----------
const imgCache = new Map();
export function loadImage(url) {
  if (!imgCache.has(url)) imgCache.set(url, new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => {
      // tight bounds of the product (opaque pixels, ignoring the soft shadow)
      const s = 256, c = document.createElement('canvas'); c.width = c.height = s;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0, s, s);
      const d = g.getImageData(0, 0, s, s).data;
      let x0 = s, y0 = s, x1 = 0, y1 = 0;
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) if (d[(y * s + x) * 4 + 3] > 170) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < x0) { x0 = y0 = 0; x1 = y1 = s - 1; }
      const k = im.naturalWidth / s;
      im.box = { x: x0 * k, y: y0 * k, w: (x1 - x0 + 1) * k, h: (y1 - y0 + 1) * k };
      res(im);
    };
    im.onerror = () => { imgCache.delete(url); rej(new Error('image failed to load')); };
    im.src = url;
  }));
  return imgCache.get(url);
}

// ---------- canvas text ----------
function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean), lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width <= maxW || !line) line = t; else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}
/** Largest font size (<= max) where text wraps into maxW x maxH. */
function fit(ctx, text, { maxW, maxH, max, min = 24, weight = 700, family = 'Inter', lh = 1.08, maxLines = 4 }) {
  for (let size = max; size >= min; size -= 2) {
    ctx.font = `${weight} ${size}px ${family}`;
    const lines = wrap(ctx, text, maxW);
    if (lines.length <= maxLines && lines.length * size * lh <= maxH && lines.every(l => ctx.measureText(l).width <= maxW)) return { size, lines, lh };
  }
  ctx.font = `${weight} ${min}px ${family}`;
  return { size: min, lines: wrap(ctx, text, maxW).slice(0, maxLines), lh };
}
function drawLines(ctx, f, x, y, { align = 'left', color, weight = 700, family = 'Inter', spacing = 0 }) {
  ctx.font = `${weight} ${f.size}px ${family}`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing * f.size}px`;
  f.lines.forEach((l, i) => ctx.fillText(l, x, y + f.size * 0.9 + i * f.size * f.lh));
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  return f.lines.length * f.size * f.lh;
}
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }
function pill(ctx, text, x, y, { bg, fg, size, align = 'left' }) {
  ctx.font = `600 ${size}px Inter`;
  const w = ctx.measureText(text).width + size * 1.5, h = size * 2.1;
  const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.fillStyle = bg; rrect(ctx, left, y, w, h, h / 2); ctx.fill();
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, left + w / 2, y + h / 2 + size * 0.04);
  ctx.textBaseline = 'alphabetic';
  return { w, h };
}

/** Draw the product so its opaque bounds fit inside the box, bottom-aligned (shadow sits under it). */
function drawProduct(ctx, im, bx, by, bw, bh, { anchor = 'bottom', W } = {}) {
  const b = im.box, n = im.naturalWidth, e = n * 0.01;
  if (b.x < e || b.y < e || b.x + b.w > n - e || b.y + b.h > n - e) {
    // close-up render that is cropped by its own frame: bleed it across the canvas width instead of floating a cut-off block
    if (by < ctx.canvas.height * 0.2) { bh += by; by = 0; } // near the top: run to the top edge too
    const cw = W || ctx.canvas.width, s = Math.max(cw / n, bh / n);
    ctx.save(); ctx.beginPath(); ctx.rect(0, by, cw, bh); ctx.clip();
    ctx.drawImage(im, (cw - n * s) / 2, by + (bh - n * s) / 2, n * s, n * s);
    ctx.restore(); return;
  }
  const s = Math.min(bw / b.w, bh / b.h);
  const dx = bx + (bw - b.w * s) / 2 - b.x * s;
  const dy = (anchor === 'center' ? by + (bh - b.h * s) / 2 : by + bh - b.h * s) - b.y * s;
  ctx.drawImage(im, dx, dy, im.naturalWidth * s, im.naturalHeight * s);
}
function studioBg(ctx, W, H, bg, cx, cy, r) {
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const light = lum(bg) > 0.4;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, light ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.10)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

function tagText(ad, price) {
  if (ad.cta === 'Pre-order') return `Pre-order · ${money(price)}`;
  if (ad.cta === 'Sign up') return 'Join the waitlist';
  if (ad.cta === 'Get offer') return `Early price ${money(price)}`;
  return 'Launching soon';
}

/** Composite one creative. ctx sized W x H. */
export function drawAd(ctx, ad, im, W, H, { price, brand } = {}) {
  const u = W / 1080, tall = H > W * 1.3;
  const pal = ad.palette, text = pal.text, acc = pal.accent, accInk = inkOn(acc);
  const pad = 72 * u, safeTop = tall ? 250 * u : 0, safeBot = tall ? 340 * u : 0; // keep clear of Stories UI
  const ov = ad.overlay_text || '';
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'left';

  if (ad.layout === 'split') {
    // colour panel + product on the studio background
    const panelH = tall ? H * 0.42 : H, panelW = tall ? W : W * 0.44;
    studioBg(ctx, W, H, pal.bg, tall ? W / 2 : W * 0.72, tall ? H * 0.68 : H * 0.5, W * 0.6);
    ctx.fillStyle = acc; ctx.fillRect(0, 0, panelW, panelH);
    const f = fit(ctx, ov, { maxW: panelW - pad * 2, maxH: tall ? panelH - safeTop - pad * 2 - 90 * u : H * 0.5, max: 104 * u, min: 40 * u, maxLines: 5 });
    const ty = tall ? safeTop + pad * 0.4 : pad * 1.6;
    drawLines(ctx, f, pad, ty, { color: accInk });
    pill(ctx, tagText(ad, price), pad, tall ? panelH - pad - 64 * u : H - pad - 64 * u, { bg: accInk, fg: acc, size: 30 * u });
    if (tall) drawProduct(ctx, im, pad, panelH + 60 * u, W - pad * 2, H - panelH - safeBot - 60 * u);
    else drawProduct(ctx, im, panelW + 40 * u, pad * 1.2, W - panelW - 80 * u, H - pad * 2.4);
  } else if (ad.layout === 'badge') {
    studioBg(ctx, W, H, pal.bg, W / 2, H * 0.55, W * 0.7);
    const top = safeTop + pad;
    const f = fit(ctx, ov, { maxW: W - pad * 2 - 250 * u, maxH: (tall ? 380 : 230) * u, max: (tall ? 104 : 84) * u, min: 36 * u, maxLines: 3 });
    const th = drawLines(ctx, f, pad, top, { color: text });
    // round badge
    const r = 112 * u, cx = W - pad - r, cy = top + r - 10 * u;
    ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = accInk; ctx.textAlign = 'center';
    const big = ad.cta === 'Pre-order' || ad.cta === 'Get offer';
    ctx.font = `700 ${big ? 46 * u : 34 * u}px Inter`; ctx.fillText(big ? money(price).replace(/\.00$/, '') : 'Soon', cx, cy + (big ? 4 : 2) * u);
    ctx.font = `600 ${22 * u}px Inter`; ctx.fillText(big ? 'pre-order' : 'join the list', cx, cy + 40 * u);
    const py = top + Math.max(th, 2 * r) + 50 * u;
    drawProduct(ctx, im, pad, py, W - pad * 2, H - py - safeBot - pad);
  } else if (ad.layout === 'minimal') {
    studioBg(ctx, W, H, pal.bg, W / 2, H * 0.45, W * 0.75);
    const foot = (tall ? 240 : 190) * u;
    drawProduct(ctx, im, pad * 1.4, safeTop + pad * 1.4, W - pad * 2.8, H - safeTop - safeBot - foot - pad * 1.8);
    const f = fit(ctx, ov, { maxW: W - pad * 2, maxH: foot - 70 * u, max: 76 * u, min: 32 * u, weight: 700, family: 'Inter', lh: 1.05, maxLines: 2 });
    const fy = H - safeBot - foot;
    drawLines(ctx, f, W / 2, fy, { align: 'center', color: text, weight: 700, family: 'Inter' });
    ctx.fillStyle = acc; ctx.fillRect(W / 2 - 30 * u, H - safeBot - pad - 6 * u, 60 * u, 4 * u);
    ctx.font = `600 ${28 * u}px Inter`; ctx.fillStyle = mix(text, pal.bg, 0.15); ctx.textAlign = 'center';
    ctx.fillText(tagText(ad, price), W / 2, H - safeBot - pad + 34 * u);
  } else { // hero
    studioBg(ctx, W, H, pal.bg, W / 2, H * 0.62, W * 0.7);
    const f = fit(ctx, ov, { maxW: W - pad * 2, maxH: (tall ? 420 : 250) * u, max: (tall ? 120 : 96) * u, min: 40 * u, maxLines: 3 });
    const th = drawLines(ctx, f, pad, safeTop + pad, { color: text });
    ctx.fillStyle = acc; ctx.fillRect(pad, safeTop + pad + th + 22 * u, 84 * u, 8 * u);
    const py = safeTop + pad + th + 70 * u;
    const pill_h = 64 * u;
    drawProduct(ctx, im, pad, py, W - pad * 2, H - py - safeBot - pad - pill_h - 30 * u);
    pill(ctx, tagText(ad, price), pad, H - safeBot - pad - pill_h, { bg: acc, fg: accInk, size: 30 * u });
  }
  if (brand && ad.layout !== 'minimal') { // small wordmark, bottom right (feed only; stories show it in the header)
    if (!tall) { ctx.font = `600 ${24 * u}px Inter`; ctx.textAlign = 'right'; ctx.fillStyle = ad.layout === 'split' ? mix(text, pal.bg, 0.35) : mix(text, pal.bg, 0.35); ctx.fillText(brand, W - pad, H - pad + 8 * u); }
  }
}

// ---------- page ----------
const A = { key: null, data: null, err: null, busy: false, started: 0, stages: null, fmt: {}, timer: null, es: null, saveT: null, el: null, ctx: null, pendingDraw: false };

/** The Ads tab's center pane for ctx.src. The ads chat lives in the app's right panel. */
export function renderAds(el, ctx) {
  const { api, src } = ctx;
  const key = srcKey(src);
  A.el = el; A.ctx = ctx;
  if (!src) { el.innerHTML = ''; return; }
  if (!el._fo) { el._fo = true; el.addEventListener('focusout', () => setTimeout(() => { if (A.pendingDraw && !el.contains(document.activeElement)) draw(A.el, A.ctx); }, 0)); }
  if (A.key !== key) {
    A.key = key; A.data = null; A.err = null; A.fmt = {}; A.busy = false; A.stages = null; clearInterval(A.timer);
    if (A.es) { A.es.close(); A.es = null; }
    api.ads(src).then(d => { if (A.key !== key) return; A.data = d; if (d.running) startBusy(el, ctx, true); draw(el, ctx); })
      .catch(e => { if (A.key !== key) return; A.err = e; draw(el, ctx); });
  }
  draw(el, ctx);
}

function startBusy(el, ctx, external) {
  A.busy = true; A.started = Date.now();
  A.stages = { render: false, copy: false };
  clearInterval(A.timer);
  A.timer = setInterval(() => { const t = $('#adsElapsed'); if (t) t.textContent = Math.round((Date.now() - A.started) / 1000) + ' s'; }, 1000);
  if (ctx.src.project && !A.es) {
    const key = A.key;
    A.es = ctx.api.events(ctx.src.project);
    A.es.onmessage = ev => {
      let d; try { d = JSON.parse(ev.data); } catch { return; }
      if (A.key !== key) return;
      if (d.type === 'ads_progress') { if (d.stage === 'rendered') A.stages.render = true; if (d.stage === 'written') A.stages.copy = true; drawProgress(); }
      if (d.type === 'ads_done' && external) { finishBusy(); ctx.api.ads(ctx.src).then(x => { A.data = x; draw(el, ctx); }); }
    };
  }
}
/** The ads agent (or generation) saved ads.json: refetch and redraw in place, unless the user is typing in a card. */
export function adsChanged(id) {
  if (A.key !== 'p/' + id || !A.el || A.busy) return;
  const key = A.key, el = A.el, ctx = A.ctx;
  ctx.api.ads(ctx.src).then(d => {
    if (A.key !== key) return;
    A.data = d;
    const typing = document.activeElement && el.contains(document.activeElement) && (document.activeElement.isContentEditable || document.activeElement.tagName === 'INPUT');
    if (typing) { A.pendingDraw = true; return; }
    draw(el, ctx);
  }).catch(() => {});
}
function finishBusy() { A.busy = false; clearInterval(A.timer); if (A.es) { A.es.close(); A.es = null; } }
function drawProgress() {
  const p = $('#adsProgress'); if (!p || !A.stages) return;
  const row = (done, t) => `<li class="${done ? 'done' : ''}">${done ? '<span class="check">✓</span>' : '<span class="spin"></span>'}${t}</li>`;
  p.innerHTML = row(A.stages.render, 'Rendering 4 product shots') + row(A.stages.copy, 'Writing 6 ad concepts with Claude');
}

async function generate(el, ctx) {
  if (A.busy) return;
  const key = A.key;
  startBusy(el, ctx, false);
  draw(el, ctx);
  try {
    const r = await ctx.api.generateAds(ctx.src);
    if (A.key !== key) return;
    finishBusy();
    A.data = { ...(A.data || {}), ads: r.ads, base: r.base, running: false };
    A.fmt = {};
    ctx.toast('Ads ready');
  } catch (e) {
    if (A.key !== key) return;
    finishBusy(); A.genErr = e;
  }
  draw(el, ctx);
}

function draw(el, ctx) {
  const d = A.data, ads = d?.ads;
  const title = ctx.title || ads?.title || '';
  A.pendingDraw = false;
  let body;
  if (A.err) body = `<div class="ads-empty"><h1>Couldn’t load this design</h1><p>${esc(A.err.message)}</p></div>`;
  else if (!d) body = `<div class="ads-grid">${Array(3).fill('<div class="skel" style="height:560px"></div>').join('')}</div>`;
  else {
    const has = !!ads?.ads?.length;
    const head = `<div class="ads-head">
      <div><h1>${esc(title || 'Ads')}</h1>
        <p class="muted">Suggested price ${money(d.price ?? ads?.price)} · about twice the 10-unit cost${has && ads.ship_weeks ? ` · ships in about ${ads.ship_weeks} weeks` : ''}</p></div>
      <div class="ads-actions">
        ${has ? `<button class="btn" id="adsAll" ${A.busy ? 'disabled' : ''}>Download all</button>` : ''}
        <button class="btn ${has ? '' : 'primary'}" id="adsGen" ${A.busy || !d.has_model ? 'disabled' : ''}>${A.busy ? '<span class="spin"></span>Generating…' : has ? 'Regenerate' : 'Generate ads'}</button>
      </div></div>
      <p class="ads-note">Advertising something you haven’t made yet? Say pre-order or waitlist, and ship within the time you promise (Meta ad policy and the FTC mail-order rule).</p>
      ${A.genErr ? `<div class="errbox" style="margin-bottom:16px"><div><b>Generation failed</b>${esc(A.genErr.message)}</div></div>` : ''}`;
    if (A.busy) {
      body = head + `<div class="ads-busy"><div class="ads-busy-card"><h3>Making your ads <span class="muted" id="adsElapsed">0 s</span></h3>
        <ul id="adsProgress"></ul><p class="muted small">Usually 20 to 60 seconds. Uses your Claude Code plan for one request.</p></div></div>`;
    } else if (!has) {
      body = head + `<div class="ads-busy"><div class="ads-busy-card"><h3>No ads yet</h3>
        <p class="muted">${d.has_model ? 'Generate renders four transparent product shots and writes six ad concepts with honest pre-order framing. Takes about a minute and uses one Claude Code request.' : 'This design has no exported model yet. Build it in the studio first.'}</p></div></div>`;
    } else {
      body = head + `<div class="ads-grid">${ads.ads.map((ad, i) => cardHtml(ad, i, ads, ctx)).join('')}</div>`;
    }
  }
  const top = el.querySelector('.ads-main')?.scrollTop || 0;
  el.innerHTML = `<main class="ads-main" id="adsMain">${body}</main>`;
  el.firstElementChild.scrollTop = top;
  drawProgress();
  const g = $('#adsGen', el); if (g) g.onclick = () => { A.genErr = null; generate(el, ctx); };
  const all = $('#adsAll', el); if (all) all.onclick = () => downloadAll(ctx);
  if (ads?.ads?.length && !A.busy) wireCards(el, ctx);
}

function cardHtml(ad, i, ads, ctx) {
  const fmt = A.fmt[ad.id] || 'feed';
  const brand = ads.title || ctx.title || 'Design';
  const avatar = `<span class="fb-av" style="background:${esc(ad.palette.accent)};color:${inkOn(ad.palette.accent)}">${esc(brand.trim()[0] || 'F')}</span>`;
  const ed = (k, cls, tag = 'div') => `<${tag} class="${cls}" contenteditable="plaintext-only" spellcheck="false" data-k="${k}" data-i="${i}">${esc(ad[k])}</${tag}>`;
  const shotSel = `<select class="ad-shot" data-i="${i}" aria-label="Product shot">${SHOTS.filter(s => ads.renders.some(r => r.name === s)).map(s => `<option value="${s}" ${ad.render === s ? 'selected' : ''}>${SHOT_LABEL[s]}</option>`).join('')}</select>`;
  const placement = fmt === 'feed' ? `
    <div class="fb-post">
      <div class="fb-top">${avatar}<div class="fb-who"><b>${esc(brand)}</b><span>Sponsored · <svg viewBox="0 0 16 16" width="11" height="11"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M1.5 8h13M8 1.5c2.2 2 2.2 11 0 13M8 1.5c-2.2 2-2.2 11 0 13" fill="none" stroke="currentColor" stroke-width="1.1"/></svg></span></div>
        <span class="fb-dots">···</span></div>
      ${ed('primary_text', 'fb-text')}
      <canvas class="ad-canvas" data-i="${i}" width="1080" height="1080"></canvas>
      <div class="fb-bar"><div class="fb-bar-l"><span class="fb-dom">${esc(brand.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'shop')}.shop</span>
        ${ed('headline', 'fb-head')}${ed('description', 'fb-desc')}</div>
        <span class="fb-cta">${esc(ad.cta)}</span></div>
      <div class="fb-acts"><span>Like</span><span>Comment</span><span>Share</span></div>
    </div>` : `
    <div class="story">
      <canvas class="ad-canvas" data-i="${i}" width="1080" height="1920"></canvas>
      <div class="story-ui"><div class="story-bar"><i></i></div>
        <div class="story-top">${avatar}<b>${esc(brand)}</b><span>Sponsored</span></div>
        <div class="story-bot"><div class="story-cap">${esc(ad.primary_text)}</div><span class="story-cta"><svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 10l4-4 4 4" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>${esc(ad.cta)}</span></div></div>
    </div>`;
  return `<article class="ad-card" data-i="${i}">
    <div class="ad-card-head"><span class="ad-angle">${esc(ad.angle)}</span>
      <div class="seg ad-fmt">${Object.entries(FORMATS).map(([k, f]) => `<button data-fmt="${k}" data-i="${i}" class="${fmt === k ? 'on' : ''}">${f.label}</button>`).join('')}</div></div>
    <div class="ad-stage">${placement}</div>
    <div class="ad-ctrl">
      <label class="ad-field"><span>On-image text</span><input class="ad-ov" data-i="${i}" maxlength="48" value="${esc(ad.overlay_text)}"></label>
      <label class="ad-field ad-field-s"><span>Shot</span>${shotSel}</label>
    </div>
    <div class="ad-btns">
      <button class="btn sm" data-dl="feed" data-i="${i}">Download 1:1</button>
      <button class="btn sm" data-dl="story" data-i="${i}">Download 9:16</button>
      <button class="btn sm" data-copy="${i}">Copy text</button>
    </div>
  </article>`;
}

function renderUrl(i) {
  const d = A.data, ad = d.ads.ads[i];
  const r = d.ads.renders.find(x => x.name === ad.render) || d.ads.renders[0];
  return `${d.base}${r.file}?t=${d.ads.t}`;
}
async function paint(canvas, i) {
  const ad = A.data.ads.ads[i];
  try {
    await document.fonts.load('700 40px Inter');
    const im = await loadImage(renderUrl(i));
    drawAd(canvas.getContext('2d'), ad, im, canvas.width, canvas.height, { price: A.data.ads.price, brand: A.data.ads.title });
  } catch (e) { console.warn('ad render failed', e); }
}

/** Full-resolution PNG blob for ad i in the given format. Exposed for tests as window.formaAds.exportAd. */
export async function exportAd(i, fmt = 'feed') {
  const f = FORMATS[fmt];
  const c = document.createElement('canvas'); c.width = f.w; c.height = f.h;
  await paint(c, i);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return { blob, width: c.width, height: c.height };
}
async function download(i, fmt) {
  const { blob } = await exportAd(i, fmt);
  const ad = A.data.ads.ads[i];
  const name = `${(A.data.ads.title || 'ad').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${ad.id}-${fmt === 'feed' ? '1080x1080' : '1080x1920'}.png`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function downloadAll(ctx) {
  const n = A.data.ads.ads.length;
  ctx.toast(`Downloading ${n * 2} images`);
  for (let i = 0; i < n; i++) for (const f of ['feed', 'story']) { await download(i, f); await new Promise(r => setTimeout(r, 300)); }
}

function saveSoon(ctx) {
  clearTimeout(A.saveT);
  const key = A.key;
  A.saveT = setTimeout(() => {
    if (A.key !== key) return;
    ctx.api.saveAds(ctx.src, A.data.ads.ads.map(a => ({ id: a.id, headline: a.headline, primary_text: a.primary_text, description: a.description, overlay_text: a.overlay_text, render: a.render })))
      .then(() => ctx.toast('Saved')).catch(e => ctx.toast(e.message));
  }, 700);
}

function wireCards(el, ctx) {
  $$('.ad-canvas', el).forEach(c => paint(c, +c.dataset.i));
  const repaint = i => { const c = $(`.ad-canvas[data-i="${i}"]`, el); if (c) paint(c, i); };
  $$('[data-fmt]', el).forEach(b => b.onclick = () => { A.fmt[A.data.ads.ads[+b.dataset.i].id] = b.dataset.fmt; draw(el, ctx); });
  $$('[contenteditable][data-k]', el).forEach(n => {
    n.oninput = () => { A.data.ads.ads[+n.dataset.i][n.dataset.k] = n.textContent.replace(/\s+/g, ' ').trim(); saveSoon(ctx); };
    n.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); n.blur(); } };
  });
  $$('.ad-ov', el).forEach(n => n.oninput = () => { const i = +n.dataset.i; A.data.ads.ads[i].overlay_text = n.value; repaint(i); saveSoon(ctx); });
  $$('.ad-shot', el).forEach(n => n.onchange = () => { const i = +n.dataset.i; A.data.ads.ads[i].render = n.value; repaint(i); saveSoon(ctx); });
  $$('[data-dl]', el).forEach(b => b.onclick = async () => { b.disabled = true; try { await download(+b.dataset.i, b.dataset.dl); } finally { b.disabled = false; } });
  $$('[data-copy]', el).forEach(b => b.onclick = async () => {
    const ad = A.data.ads.ads[+b.dataset.copy];
    try { await navigator.clipboard.writeText(`${ad.primary_text}\n\n${ad.headline}\n${ad.description}`); ctx.toast('Ad text copied'); }
    catch { ctx.toast('Clipboard blocked by the browser'); }
  });
}

window.formaAds = {
  async exportAd(i = 0, fmt = 'feed') { const r = await exportAd(i, fmt); return { width: r.width, height: r.height, bytes: r.blob.size, type: r.blob.type }; },
};

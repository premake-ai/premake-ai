// Hover tooltips for the 3D viewer (studio and the public build guide page): what a part is and what it costs.
//   "Base · 3D printed · PETG · 20 g · 1.2 h · $0.98"      "NEMA17 stepper motor 48 mm · bought · $13.00"
// Numbers come from the quote's part_costs (server.js partCosts: 1-unit tier, before margin) with a fallback to
// bom.json when the quote has none. Mouse: throttled raycast on move, the hovered part is lifted subtly. Touch: a tap
// shows the tooltip for the tapped part (a tap on empty space or a drag hides it).
// colours: with onColor (and canColor()), printed parts also get a row of filament swatches; a click recolours the part.
// chattools: with onAsk the tooltip has an Ask button. Mouse: the tooltip stops following once the pointer rests on a part
// (~0.3 s) and stays while the pointer travels to it, so Ask can be clicked. Touch: the tapped tooltip is live straight away.
import * as THREE from 'three';

/** colours: the filament palette (server.js FILAMENTS has the same hexes). */
export const FILAMENTS = [['#1c1c1c', 'Black'], ['#f4f4f1', 'White'], ['#8a8f98', 'Grey'], ['#e8590c', 'Orange'], ['#c92a2a', 'Red'],
  ['#1f5fbf', 'Blue'], ['#2f9e44', 'Green'], ['#f2c12e', 'Yellow']];
const PROC = { extrusion: 'Aluminium extrusion', sheet: 'Sheet metal', laser: 'Laser-cut' };
const MATERIAL_PER_G = 0.025, PRINT_PER_H = 0.40; // server.js pricing constants (fallback only)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = n => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;
const num = n => { const x = Math.round(Number(n) * 10) / 10; return Number.isInteger(x) ? String(x) : x.toFixed(1); };
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function injectStyle() {
  if (document.getElementById('hv-style')) return;
  const st = document.createElement('style');
  st.id = 'hv-style';
  st.textContent = `.hv-tip { position: fixed; z-index: 55; left: 0; top: 0; max-width: min(380px, calc(100vw - 16px)); padding: 7px 10px 8px; pointer-events: none;
  background: #fff; color: #1c1917; border: 1px solid #e7e5e4; border-radius: 8px; box-shadow: 0 8px 24px rgba(28, 25, 23, .12);
  font: 12.5px/1.35 var(--ui, system-ui, -apple-system, 'Segoe UI', sans-serif); opacity: 0; transform: translateY(2px);
  transition: opacity .12s ease, transform .12s ease; }
.hv-tip.on { opacity: 1; transform: none; }
.hv-tip b { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hv-tip span { display: block; color: #57534e; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hv-tip span em { font-style: normal; color: #1c1917; font-weight: 600; }
.hv-tip.live { pointer-events: auto; }
.hv-row { display: flex; align-items: center; gap: 10px; }
.hv-row > div { min-width: 0; flex: 1; }
.hv-ask { flex: none; display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 10px; border-radius: 20px; cursor: pointer;
  font: 600 12px var(--ui, system-ui, sans-serif); color: #c2410c; background: linear-gradient(180deg, #fff, #fff7ed); border: 1px solid rgba(249,115,22,.45);
  box-shadow: inset 0 1px 0 #fff, 0 1px 3px rgba(194,65,12,.12); }
.hv-ask:hover { border-color: #f97316; background: #fff7ed; }
.hv-askbox { margin-top: 8px; padding-top: 8px; border-top: 1px solid #f0efed; display: flex; flex-direction: column; gap: 6px; min-width: 250px; }
.hv-qs { display: flex; flex-wrap: wrap; gap: 5px; }
.hv-q { font: 500 12px var(--ui, system-ui, sans-serif); color: #44403c; background: #faf9f7; border: 1px solid #e7e5e0; border-radius: 999px; padding: 4px 9px; cursor: pointer; }
.hv-q:hover { border-color: #f97316; color: #c2410c; background: #fff7ed; }
.hv-ask-in { display: flex; align-items: center; gap: 6px; background: #fff; border: 1px solid #e7e5e0; border-radius: 999px; padding: 3px 3px 3px 11px; }
.hv-ask-in:focus-within { border-color: #f97316; box-shadow: 0 0 0 3px rgba(249,115,22,.12); }
.hv-ask-in input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; font: 13px var(--ui, system-ui, sans-serif); color: #1c1917; }
.hv-ask-in button { width: 24px; height: 24px; border-radius: 50%; border: 0; background: #e8590c; color: #fff; font-weight: 700; cursor: pointer; flex: none; }
.hv-tip:not(.live) .hv-askbox { opacity: .6; }
.hv-hide { position: absolute; top: 8px; right: 8px; display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px; border: 0; border-radius: 13px;
  background: #f5f5f4; color: #57534e; font: 600 12px/1 inherit; cursor: pointer; pointer-events: auto; }
.hv-tip > .hv-hide + b { display: block; padding-right: 72px; }
.hv-tip > .hv-hide + span { display: block; padding-right: 72px; }
.hv-hide:hover { background: #e7e5e4; color: #1c1917; }
.hv-hide svg { width: 14px; height: 14px; }
.hv-buy { display: inline-block; margin-top: 5px; font-size: 12.5px; font-weight: 600; color: #c2410c; text-decoration: none; pointer-events: auto; }
.hv-buy:hover { text-decoration: underline; }
.hv-tip:not(.live) .hv-ask { opacity: .75; }
.hv-sw { display: flex; align-items: center; gap: 5px; margin-top: 7px; padding-top: 7px; border-top: 1px solid #f0efed; }
.hv-sw button { width: 20px; height: 20px; border-radius: 50%; padding: 0; cursor: pointer; flex: none; border: 0;
  box-shadow: inset 0 0 0 1px rgba(28,25,23,.18), 0 1px 2px rgba(28,25,23,.12); transition: transform .12s; }
.hv-sw button:hover { transform: scale(1.15); }
.hv-sw button.on { box-shadow: inset 0 0 0 1px rgba(28,25,23,.18), 0 0 0 2px #fff, 0 0 0 3.5px #f97316; }
.hv-sw .hv-reset { width: auto; height: 20px; border-radius: 10px; padding: 0 7px; margin-left: 2px; background: transparent; box-shadow: none;
  color: #78716c; font: 500 11.5px var(--ui, system-ui, sans-serif); }
.hv-sw .hv-reset:hover { transform: none; color: #1c1917; background: #f5f5f4; }
.hv-tip:not(.live) .hv-sw { opacity: .8; }
@media (max-width: 640px) { .hv-tip { font-size: 13.5px; max-width: calc(100vw - 32px); } .hv-ask { height: 34px; padding: 0 14px; font-size: 13.5px; }
  .hv-sw { gap: 7px; flex-wrap: wrap; } .hv-sw button { width: 28px; height: 28px; } .hv-sw .hv-reset { height: 28px; } }`;
  document.head.appendChild(st);
}

/** Cost line for a part. p = viewer part (manifest entry); data = { quote, bom }. Returns { title, line }. */
export function describePart(p, data = {}) {
  const q = data.quote || null, bom = data.bom || {};
  const costs = q?.part_costs || null;
  const proc = p.process || (p.group === 'component' ? 'bought' : 'print');
  const byName = (list, name) => (list || []).find(x => x.name === name) || (list || []).find(x => norm(x.name) === norm(name)) || null;
  const byFile = (list, file) => (list || []).find(x => x.file && x.file === file) || null;
  const cut = (s, price) => price == null ? s : `${s} · <em>${esc(usd(price))}</em>`;

  if (proc === 'print') {
    const c = costs && (byFile(costs.filter(x => x.kind === 'print'), p.file) || byName(costs.filter(x => x.kind === 'print'), p.name));
    const b = byFile(bom.printed, p.file) || byName(bom.printed, p.name) || {};
    const g = c?.grams ?? b.grams, h = c?.hours ?? b.print_hours;
    const price = c ? c.usd : (g != null ? g * MATERIAL_PER_G + (h || 0) * PRINT_PER_H : null);
    const bits = ['3D printed', 'PETG'];
    if (g != null) bits.push(`${Math.round(g)} g`);
    if (h != null) bits.push(`${num(h)} h`);
    return { title: p.name, line: cut(esc(bits.join(' · ')), price) };
  }
  if (proc === 'extrusion' || proc === 'sheet' || proc === 'laser') {
    const c = costs && (byFile(costs, p.file) || byName(costs.filter(x => x.kind === proc), p.name));
    const f = byFile(bom.fabricated, p.file) || byName(bom.fabricated, p.name) || {};
    const pr = c?.params || f.params || {};
    let what = PROC[proc];
    if (proc === 'extrusion') what = `${pr.profile || ''} aluminium extrusion${pr.length_mm ? `, ${Math.round(pr.length_mm)} mm` : ''}`.trim();
    else if (proc === 'sheet') what = `Laser-cut ${pr.thickness_mm ? `${num(pr.thickness_mm)} mm ` : ''}${pr.material || 'sheet'}${Number(pr.bends) > 0 ? ', folded' : ''}`;
    else if (pr.thickness_mm || pr.material) what = `Laser-cut ${pr.thickness_mm ? `${num(pr.thickness_mm)} mm ` : ''}${pr.material || ''}`.trim();
    return { title: p.name, line: cut(esc(what.charAt(0).toUpperCase() + what.slice(1)), c ? c.usd : null) };
  }
  // bought
  const lib = p.lib || null;
  const bought = costs ? costs.filter(x => x.kind === 'bought') : (bom.parts || []).map(x => ({ name: x.name, qty: Number(x.qty_per_unit) || 0, unit_usd: Number(x.unit_cost_usd) || 0 }));
  let line = (lib?.name && byName(bought, lib.name)) || byName(bought, p.name);
  if (!line) { // hand-written bom: the line whose words best cover the part name
    const want = new Set(norm(p.name).split(' ').filter(w => w.length > 1));
    let best = 0;
    for (const x of bought) {
      const words = norm(x.name).split(' ');
      const hit = words.filter(w => want.has(w)).length / Math.max(1, Math.min(want.size, words.length));
      if (hit > best && hit >= 0.5) { best = hit; line = x; }
    }
  }
  const qty = lib ? Number(lib.qty) || 1 : 1;
  const unit = line ? Number(line.unit_usd ?? line.unit_cost_usd) : (lib?.unit_cost_usd ?? null);
  const name = lib?.name || p.name;
  // where to buy it: the bom line's own link, else an Amazon search for the part
  const bl = (bom.parts || []).find(x => norm(x.name) === norm(line?.name || name)) || null;
  const supplier = String(bl?.supplier || '').split('/')[0].trim();
  const buy = /^https?:\/\//.test(bl?.url || '') ? { url: bl.url, label: supplier || (new URL(bl.url).hostname.replace(/^www\./, '').split('.')[0]) }
    : { url: 'https://www.amazon.com/s?k=' + encodeURIComponent(bl?.search || line?.name || name), label: 'Amazon' };
  if (p.ref) { // refmodels: shown with a reference model (display only); the customer's own items are not included
    const credit = p.ref.partOf ? '' : p.ref.credit || '';
    if (p.ref.yours) return { title: p.ref.label || p.name, line: `${esc(p.name)} · not included`, credit };
    if (unit == null || !Number.isFinite(unit)) return { title: '', line: `${esc(name)} · bought part`, buy, credit };
    return { title: '', line: qty > 1 ? `${esc(name)} ×${qty} · <em>${esc(usd(unit * qty))}</em>` : `${esc(name)} · bought · <em>${esc(usd(unit))}</em>`, buy, credit };
  }
  if (unit == null || !Number.isFinite(unit)) return { title: '', line: `${esc(name)} · bought part`, buy };
  if (qty > 1) return { title: '', line: `${esc(name)} ×${qty} · <em>${esc(usd(unit * qty))}</em>`, buy };
  return { title: '', line: `${esc(name)} · bought · <em>${esc(usd(unit))}</em>`, buy };
}

/** Attach hover tooltips to a Viewer. getData() -> { quote, bom } (either may be missing). */
export function attachHover(v, { getData = () => ({}), onAsk = null, onColor = null, canColor = () => true } = {}) {
  const interactive = !!(onAsk || onColor);
  if (v.hover) return v.hover;
  injectStyle();
  const canvas = v.renderer.domElement;
  const tip = document.createElement('div');
  tip.className = 'hv-tip'; tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let cur = null, lit = null, last = 0, timer = 0, pt = { x: 0, y: 0 }, down = null, shownFor = null;
  let settled = null, settleT = 0; // chattools: the tooltip holds still (and takes clicks) once settled
  function settle(x = pt.x, y = pt.y) { if (!interactive || !cur || !tip.classList.contains('on')) return; settled = { x, y }; tip.classList.add('live'); }
  function unsettle() { clearTimeout(settleT); settleT = 0; settled = null; tip.classList.remove('live'); }
  function inHull(x, y) { // the box spanning the rest point and the tooltip: the path the pointer takes to reach Ask
    if (!settled) return false;
    const r = tip.getBoundingClientRect(), m = 12;
    return x >= Math.min(r.left, settled.x) - m && x <= Math.max(r.right, settled.x) + m && y >= Math.min(r.top, settled.y) - m && y <= Math.max(r.bottom, settled.y) + m;
  }

  function pick(cx, cy) {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    v.world.updateMatrixWorld(); v.camera.updateMatrixWorld();
    ray.setFromCamera(ndc, v.camera);
    const see = new Set(v.partmenu?.state?.see || []);
    const items = v.items.filter(it => it.mesh.visible && !see.has(it.p.name));
    const hits = ray.intersectObjects(items.map(it => it.mesh), false);
    return hits.length ? items.find(it => it.mesh === hits[0].object) || null : null;
  }
  // subtle highlight: a faint warm lift on the hovered part's current material (CAD or render mode)
  function light(it) {
    if (lit === it) return;
    if (lit) { const m = lit.mesh.material; if (m?.emissive && lit.saved) { m.emissive.copy(lit.saved.c); m.emissiveIntensity = lit.saved.i; } lit.saved = null; }
    lit = it;
    if (it) {
      const m = it.mesh.material;
      if (m?.emissive && !it.anim) { it.saved = { c: m.emissive.clone(), i: m.emissiveIntensity }; m.emissive.setHex(0xffb37a); m.emissiveIntensity = 0.13; }
    }
  }
  function place(x, y) {
    const w = tip.offsetWidth, h = tip.offsetHeight, m = 8;
    let left = x + 14, top = y + 16;
    if (left + w > innerWidth - m) left = x - w - 12;
    if (top + h > innerHeight - m) top = y - h - 12;
    tip.style.left = `${Math.max(m, left)}px`; tip.style.top = `${Math.max(m, top)}px`;
  }
  function swatchesHtml(p) { // colours: printed parts only
    if (!onColor || !canColor() || (p.process || (p.group === 'component' ? 'bought' : 'print')) !== 'print' || p.subparts?.length) return '';
    const curHex = String(p.color || '').toLowerCase();
    return `<div class="hv-sw" role="group" aria-label="Filament colour">${FILAMENTS.map(([hex, n]) =>
      `<button type="button" data-hv-color="${hex}" class="${curHex === hex ? 'on' : ''}" style="background:${hex}" title="${n}" aria-label="${n} filament"></button>`).join('')}`
      + (p.design_color ? `<button type="button" class="hv-reset" data-hv-color="" title="Back to the design's colour">Reset</button>` : '') + '</div>';
  }
  // Ask bubble: suggested questions for this kind of part, plus a one-line box; sends straight to the design chat
  const QS = {
    bought: ['Why this part?', 'Is there a cheaper one?', 'Can I use one I already have?'],
    print: ['Why is it shaped like this?', 'Make it stronger', 'Can it print faster?'],
    fab: ['Why metal here?', 'Can this be printed instead?', 'Can I buy this off the shelf?'],
  };
  function askHtml(p) {
    const proc = p.process || (p.group === 'component' ? 'bought' : 'print');
    const qs = QS[proc === 'bought' ? 'bought' : proc === 'print' ? 'print' : 'fab'];
    return `<div class="hv-askbox"><div class="hv-qs">${qs.map(q => `<button type="button" class="hv-q" data-hv-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <form class="hv-ask-in"><input type="text" placeholder="Ask about this part…" aria-label="Ask about this part" autocomplete="off"><button type="submit" aria-label="Send">↑</button></form></div>`;
  }
  function show(it, x, y) {
    if (!it) return hide();
    if (shownFor !== it.p.name || !tip.classList.contains('on')) {
      const d = describePart(it.p, getData() || {});
      const body = (d.title ? `<b>${esc(d.title)}</b>` : '') + `<span>${d.line}</span>`
        + (d.credit ? `<small class="hv-credit" title="${esc(it.p.ref?.attribution || '')}">${esc(d.credit)}</small>` : '') // refmodels: model attribution
        + (d.buy ? `<a class="hv-buy" href="${esc(d.buy.url)}" target="_blank" rel="noopener noreferrer">Buy on ${esc(d.buy.label)} ↗</a>` : '');
      const hideBtn = `<button type="button" class="hv-hide" data-hv-hide title="Hide this part (show it again from Parts)" aria-label="Hide ${esc(it.p.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2.5 12S6 19 12 19a9.9 9.9 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>Hide</button>`;
      tip.innerHTML = hideBtn + body + swatchesHtml(it.p) + (onAsk ? askHtml(it.p) : '');
      shownFor = it.p.name;
    }
    tip.classList.add('on'); place(x, y); light(it); cur = it;
  }
  function hide() { unsettle(); tip.classList.remove('on'); light(null); cur = null; shownFor = null; }
  const phoneCard = () => !!(v.present && window.__mPartTap && matchMedia('(max-width: 640px)').matches); // phonekit
  const menuOpen = () => { const m = document.querySelector('.pm-menu'); return m && !m.hidden; };

  function run() {
    timer = 0; last = performance.now();
    if (menuOpen() || !v.container.offsetParent || phoneCard()) return hide();
    show(pick(pt.x, pt.y), pt.x, pt.y);
  }
  canvas.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    pt = { x: e.clientX, y: e.clientY };
    if (e.buttons) { hide(); return; } // orbiting / panning
    if (settled) { if (inHull(pt.x, pt.y)) return; unsettle(); }
    if (cur) place(pt.x, pt.y);
    if (interactive) { clearTimeout(settleT); settleT = setTimeout(() => settle(), 300); }
    const wait = 60 - (performance.now() - last); // raycast at most ~16 times a second
    if (!timer) timer = setTimeout(run, Math.max(0, wait));
  });
  canvas.addEventListener('pointerleave', e => { clearTimeout(timer); timer = 0; if (settled && tip.contains(e.relatedTarget)) return; hide(); });
  tip.addEventListener('pointerleave', e => { if (e.relatedTarget !== canvas) hide(); });
  tip.addEventListener('click', e => {
    if (e.target.closest('[data-hv-hide]') && cur) { // hide the part; Parts' eye brings it back
      e.preventDefault(); e.stopPropagation();
      const name = cur.p.name; hide(); v.setHidden(name, true);
      document.dispatchEvent(new CustomEvent('forma:part-hidden', { detail: { name } }));
      return;
    }
    const sw = e.target.closest('[data-hv-color]');
    if (sw && cur && onColor) { // colours: recolour now, then save (onColor reverts on failure)
      e.preventDefault(); e.stopPropagation();
      const p = cur.p, hex = sw.dataset.hvColor || null;
      onColor(p.name, hex, p);
      shownFor = null; show(cur, settled?.x ?? pt.x, settled?.y ?? pt.y); // redraw with the new selection ring
      return;
    }
    const q = e.target.closest('[data-hv-q]'); if (!q || !cur || !onAsk) return;
    e.preventDefault(); e.stopPropagation();
    const p = cur.p; hide(); onAsk(p.name, p, q.dataset.hvQ);
  });
  tip.addEventListener('submit', e => {
    e.preventDefault(); const inp = e.target.querySelector('input'); const text = inp?.value.trim();
    if (!cur || !onAsk) return; const p = cur.p; hide(); onAsk(p.name, p, text || '');
  });
  tip.addEventListener('keydown', e => e.stopPropagation()); // typing in the box must not trigger viewer shortcuts
  addEventListener('pointerdown', e => { if (settled && !tip.contains(e.target) && e.target !== canvas) hide(); }, true);
  canvas.addEventListener('wheel', () => hide(), { passive: true });
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now(), type: e.pointerType }; if (e.pointerType === 'touch') hide(); });
  canvas.addEventListener('pointerup', e => {
    const d = down; down = null;
    if (!d || d.type !== 'touch' || e.pointerType !== 'touch') return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 450) return; // drag or long-press (part menu)
    if (phoneCard()) return hide(); // phonekit: on the phone studio card a tap opens the part's sheet instead (web/phonestudio.js)
    const it = pick(e.clientX, e.clientY);
    if (it) { show(it, e.clientX, e.clientY - 40); settle(e.clientX, e.clientY); } else hide();
  });
  addEventListener('scroll', () => hide(), { passive: true, capture: true });

  const api = { hide, pick, describe: p => describePart(p, getData() || {}) };
  v.hover = api;
  return api;
}

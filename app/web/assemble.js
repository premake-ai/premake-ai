// assemble: the Assemble tab (/designs/<x>/assemble[?step=flash]). THE guided way from parts on the desk to a working
// product, one step on screen at a time with a progress rail:
//   1. Print   the printed parts (thumbnail, hours, grams, STL), download all, "Print on my Bambu" (soon). Tick each.
//   2. Gather  the bought (and cut) parts with thumbnails, qty and the bom's notes ("In your ELEGOO kit"). Tick each.
//   3. Wire    one wire at a time: both parts, their pins and the wire colour; on desktop the Wiring view (wireview.js)
//              lights that wire in 3D next to the card. Wiring comes before the case is closed.
//   4. Flash   one button. The board comes from the design (server/firmware.js; "change" picks another). Compiles if
//              needed (progress), asks for the USB port (filtered to CP2102 / CH340 / FTDI / Espressif USB), writes the
//              merged image with esptool-js (progress bar), then Improv Wi-Fi setup inline when the sketch uses
//              premake_wifi.h. Trouble cards only on failure, matched to the error (no port, can't connect -> hold BOOT,
//              port busy). Phones and browsers without Web Serial: "Open this step on your computer" with a QR code.
//   5. Test    the board's serial log (Web Serial, 115200) and 2-3 checks from the build plan's test step. "No" sends
//              the check and the last log lines to the design chat, so the design agent fixes the firmware.
//   6. Close   the plan's mechanical steps (server/buildplan.js), shown in 3D by the Build steps player (assembly.js) on
//              desktop, then "It's done" with Share and a launch video nudge.
// Steps that don't apply are skipped (no electronics: no Wire / Flash / Test). Progress: localStorage per design.
// Phones: a full-screen view with a bottom action bar (assemble.css). app.js owns the tab; ctx comes from there.
import { partThumb } from './partthumbs.js';

const ESPTOOL = 'https://cdn.jsdelivr.net/npm/esptool-js@0.5.4/bundle.js';
const IMPROV = 'https://cdn.jsdelivr.net/npm/improv-wifi-serial-sdk@2.5.0/dist/serial.js/+esm';
// USB-to-serial chips on ESP32 boards: Silicon Labs CP210x (ELEGOO / DevKitC), WCH CH340 / CH9102, FTDI, Espressif native USB (C3 / S3)
const USB_FILTERS = [{ usbVendorId: 0x10c4 }, { usbVendorId: 0x1a86 }, { usbVendorId: 0x0403 }, { usbVendorId: 0x303a }];
const BAUD_LOG = 115200, BAUD_FLASH = 460800;
const KEY = id => `premake.assemble.${id}`;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const narrow = () => matchMedia('(max-width: 640px)').matches;
const serialOk = () => typeof navigator !== 'undefined' && 'serial' in navigator && window.isSecureContext;
const phoneUA = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || matchMedia('(max-width: 640px) and (pointer: coarse)').matches;
const short = n => String(n || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim() || String(n || '');
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmtH = h => !h ? '' : h < 1 ? `${Math.max(5, Math.round(h * 60 / 5) * 5)} min` : `${(Math.round(h * 2) / 2).toString().replace(/\.0$/, '')} h`;

const svg = (d, s = 18, w = 1.6) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const I = {
  print: svg('M7 9V3.5h10V9M7 17H4.5V10a1 1 0 011-1h13a1 1 0 011 1v7H17M7 14h10v6.5H7z'),
  gather: svg('M4 8l8-4 8 4-8 4-8-4zM4 8v8l8 4 8-4V8M12 12v8'),
  wire: svg('M5 6.5a1.8 1.8 0 100-.01M19 17.5a1.8 1.8 0 100-.01M6.8 6.5c8 0 2.4 11 10.4 11'),
  flash: svg('M8 8h8v8H8zM10 4.5V8M14 4.5V8M10 16v3.5M14 16v3.5M4.5 10H8M4.5 14H8M16 10h3.5M16 14h3.5'),
  test: svg('M4 12h3.5l2-5 4 10 2-5H20'),
  close: svg('M4 9.5L12 5l8 4.5v9L12 23l-8-4.5zM4 9.5l8 4.5 8-4.5M12 14v9'),
  check: svg('M5 12.5l4.5 4.5L19 7.5', 18, 2.2),
  back: svg('M15 5l-7 7 7 7', 22, 2),
  dl: svg('M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14'),
  usb: svg('M12 3v13M9 6l3-3 3 3M12 16a2 2 0 100 4 2 2 0 000-4zM12 12l4.5-2.5V7.5M12 13.5l-4.5-2.5V9', 20),
  box: svg('M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8'),
  screw: svg('M8 4h8l-1 3H9zM12 7v13M9.5 10l5-1M9.5 13l5-1M9.5 16l5-1'),
  board: svg('M5 6h14v12H5zM8 9h3v3H8zM14 9h2M14 12h2M8 15h8'),
  copy: svg('M9 9h10v11H9zM5 15V4h10'),
  send: svg('M4 12l16-7-6 16-3-7z'),
  share: svg('M12 15V4M8 8l4-4 4 4M5 13v7h14v-7'),
  video: svg('M4 6.5h11v11H4zM15 10.5l5-3v9l-5-3'),
};
const STEPS = {
  print: { label: 'Print', icon: I.print },
  gather: { label: 'Gather', icon: I.gather },
  wire: { label: 'Wire it', icon: I.wire },
  flash: { label: 'Flash', icon: I.flash },
  test: { label: 'Test', icon: I.test },
  close: { label: 'Close it up', icon: I.close },
};

/** A: the open design's state. */
let A = null, host = null;

// ---------------------------------------------------------------- persistence
function loadProg(id) { try { return JSON.parse(localStorage.getItem(KEY(id)) || 'null') || {}; } catch { return {}; } }
function save() { if (!A) return; try { localStorage.setItem(KEY(A.id), JSON.stringify(A.prog)); } catch {} }

async function api(path, opts = {}) {
  const r = await fetch(path, { credentials: 'same-origin', cache: 'no-store', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
const fwBase = () => `/api/projects/${encodeURIComponent(A.id)}/firmware`;

// ---------------------------------------------------------------- entry points (app.js)
/** Render the tab into el. ctx: { id, title, firmware, viewer(), canEdit, send(text), href(step), stage(on3d), share(), launch(), back() } */
export function renderAssemble(el, ctx) {
  host = el;
  if (!A || A.id !== ctx.id) {
    leaveAssemble();
    A = { id: ctx.id, ctx, d: null, err: null, fw: ctx.firmware || null, prog: loadProg(ctx.id), flash: { st: 'idle' }, log: [], logOn: false };
    A.prog.tick ||= {}; A.prog.done ||= {}; A.prog.checks ||= {};
    load();
  }
  A.ctx = ctx;
  const want = new URLSearchParams(location.search).get('step');
  if (want && STEPS[want]) A.want = want;
  draw();
}
/** Leaving the tab (or another design): 3D helpers off, ports closed. */
export function leaveAssemble() {
  if (!A) return;
  stage(null);
  stopLog();
  clearTimeout(A.poll); clearInterval(A.compTick); clearTimeout(A.modelT);
}
/** firmware_updated (live) for this design: fresh state; a changed firmware needs flashing again. */
export async function onFirmwareEvent(id, fw) {
  if (!A || A.id !== id) return;
  A.fw = fw || A.fw;
  if (A.fw?.hash && A.prog.flashed && A.prog.flashed !== A.fw.hash) { A.prog.done.flash = false; save(); }
  if (A.fw?.state === 'compiling') pollFw();
  if (A.cur === 'flash' && !['connecting', 'flashing', 'wifi'].includes(A.flash.st)) { A.flash = { st: 'idle' }; maybeCompile(); }
  draw();
}
/** The design changed (code / bom): the build plan is stale. */
export function onDesignChanged(id) { if (A && A.id === id) { A.d = null; load(); } }

async function load() {
  const id = A.id;
  try {
    const d = await api(`/build/${encodeURIComponent(id)}/data.json`);
    if (!A || A.id !== id) return;
    A.d = d; A.err = null;
  } catch (e) { if (A && A.id === id) A.err = e.message; }
  if (!A || A.id !== id) return;
  if (!A.fw || A.fw.state === undefined) { try { A.fw = await api(fwBase()); } catch {} }
  draw();
}

// ---------------------------------------------------------------- the steps that apply
function plan() {
  const d = A.d; if (!d) return null;
  const src = d.state === 'ready' && d.steps?.length && d.steps.every(s => s.kind) ? d.steps : d.plan?.steps || [];
  const wires = d.plan?.wiring?.list || [];
  const fw = A.fw || {};
  const printed = d.printed || [], bought = [...(d.bought || []), ...(d.fabricated || []).map(f => ({ ...f, cut: true }))];
  const place = src.filter(s => (s.kind || 'place') === 'place');
  const testSt = src.find(s => s.kind === 'test');
  const elec = wires.length > 0 || !!fw.sketch || !!fw.micropython || src.some(s => s.kind === 'flash' || s.kind === 'wire');
  const keys = [];
  if (printed.length) keys.push('print');
  if (bought.length) keys.push('gather');
  if (wires.length) keys.push('wire');
  if (fw.sketch || fw.micropython || src.some(s => s.kind === 'flash')) keys.push('flash');
  if (elec) keys.push('test');
  if (place.length || !keys.length) keys.push('close');
  return { keys, printed, bought, wires, place, test: testSt, elec };
}

function draw() {
  if (!host || !A) return;
  const P = plan();
  if (!P) {
    host.innerHTML = `<div class="as"><div class="as-col"><div class="as-load">${A.err ? `<p>${esc(A.err)}</p>` : '<span class="as-spin"></span>'}</div></div></div>`;
    return;
  }
  A.P = P;
  let cur = A.want && P.keys.includes(A.want) ? A.want : A.cur && P.keys.includes(A.cur) ? A.cur : A.prog.step && P.keys.includes(A.prog.step) ? A.prog.step : P.keys.find(k => !A.prog.done[k]) || P.keys[0];
  A.want = null;
  if (cur !== A.cur) { if (A.cur === 'test' && cur !== 'test') stopLog(); A.cur = cur; A.prog.step = cur; save(); }
  syncUrl();
  const i = P.keys.indexOf(cur);
  const rail = `<ol class="as-rail" aria-label="Steps">${P.keys.map((k, j) => `<li><button type="button" data-go="${k}" class="${k === cur ? 'on' : ''}${A.prog.done[k] ? ' done' : ''}" ${k === cur ? 'aria-current="step"' : ''}>
      <span class="as-dot">${A.prog.done[k] && k !== cur ? I.check : j + 1}</span><span class="as-rl">${esc(k === 'close' && !P.elec ? 'Put it together' : STEPS[k].label)}</span></button></li>`).join('')}</ol>`;
  const body = STEP_HTML[cur](P);
  const phoneTop = `<div class="as-ptop"><button type="button" class="as-pback" data-a="leave" aria-label="Back to the model">${I.back}</button><span class="as-ptitle">${esc(A.ctx.title || 'Assemble')}</span><span class="as-pcount">${i + 1}/${P.keys.length}</span></div>`;
  host.innerHTML = `<div class="as as-s-${cur}${A.three ? ' as-3d' : ''}"><div class="as-col">${phoneTop}${rail}<div class="as-body">${body.html}</div>
    <div class="as-bar">${i > 0 ? `<button type="button" class="as-btn ghost" data-a="prev">${esc(body.prev || 'Back')}</button>` : '<span></span>'}${body.next || ''}</div></div></div>`;
  wire(host, P);
  body.after?.();
  stage(body.three || null);
  whenModel();
}

function go(k) { if (!A.P.keys.includes(k)) return; A.cur = null; A.want = k; if (k !== 'flash' && !['connecting', 'flashing', 'wifi'].includes(A.flash.st)) A.flash = { st: 'idle' }; draw(); host.querySelector('.as-body')?.scrollTo?.(0, 0); }
function nextStep(markDone = true) {
  const k = A.cur, keys = A.P.keys, j = keys.indexOf(k);
  if (markDone) { A.prog.done[k] = true; save(); }
  if (j < keys.length - 1) go(keys[j + 1]); else draw();
}
function syncUrl() {
  const u = new URL(location.href);
  if (!/\/assemble\/?$/.test(u.pathname)) return;
  if (u.searchParams.get('step') === A.cur) return;
  u.searchParams.set('step', A.cur);
  history.replaceState(history.state, '', u.pathname + u.search);
}

/** Click handling for the whole view (delegated on each draw). */
function wire(root, P) {
  root.onclick = async e => {
    const g = e.target.closest('[data-go]'); if (g) { go(g.dataset.go); return; }
    const t = e.target.closest('[data-tick]');
    if (t) { const [k, n] = t.dataset.tick.split('|'); const m = A.prog.tick[k] ||= {}; m[n] = !m[n]; save(); t.classList.toggle('on', !!m[n]); t.setAttribute('aria-checked', String(!!m[n])); syncTickBar(k); return; }
    const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
    const a = b.dataset.a;
    if (a === 'leave') A.ctx.back?.();
    else if (a === 'prev') { const k = A.P.keys[A.P.keys.indexOf(A.cur) - 1]; if (A.cur === 'wire' && A.prog.wire > 0) { A.prog.wire--; save(); draw(); } else if (A.cur === 'close' && A.prog.close > 0 && !A.prog.done.close) { A.prog.close--; save(); draw(); } else if (k) go(k); }
    else if (a === 'next') nextStep();
    else if (a === 'skip') nextStep(false);
    else if (a === 'all') { const k = A.cur, m = A.prog.tick[k] ||= {}; (k === 'print' ? P.printed : P.bought).forEach(x => { m[x.name] = true; }); save(); nextStep(); }
    else if (a === 'wnext') { if (A.prog.wire < P.wires.length - 1) { A.prog.wire++; save(); draw(); } else nextStep(); }
    else if (a === 'wpick') { A.prog.wire = +b.dataset.i; save(); draw(); }
    else if (a === 'cnext') { if ((A.prog.close || 0) < P.place.length - 1) { A.prog.close = (A.prog.close || 0) + 1; save(); draw(); } else { A.prog.done.close = true; save(); draw(); } }
    else if (a === 'again') { A.prog.done.close = false; A.prog.close = 0; save(); draw(); }
    else if (a === 'flash') startFlash(false);
    else if (a === 'flash-any') startFlash(true);
    else if (a === 'retry-compile') compile({});
    else if (a === 'board') { const s = root.querySelector('.as-boardsel'); if (s) { s.hidden = !s.hidden; s.querySelector('select')?.focus(); } }
    else if (a === 'askfix') ask(b, `The firmware doesn't compile for the ${A.fw?.board_label || 'board'}. Fix it. Errors:\n${(A.fw?.errors || []).slice(0, 10).map(x => `- ${x}`).join('\n')}`);
    else if (a === 'wifi-hard') ask(b, 'Switch the firmware to Premake\'s Wi-Fi setup: #include "premake_wifi.h" and PremakeWiFi.begin(...) instead of the Wi-Fi name and password in the code, so I can enter them in the browser after flashing. Keep everything else the same.');
    else if (a === 'wifi-skip') { await improvClose(); A.flash = { st: 'done' }; draw(); }
    else if (a === 'wifi-retry') startWifi();
    else if (a === 'board-fix') compile({ board: b.dataset.b });
    else if (a === 'copyqr') { try { await navigator.clipboard.writeText(b.dataset.url); b.textContent = 'Copied'; } catch {} }
    else if (a === 'log') startLog();
    else if (a === 'restart') restartBoard();
    else if (a === 'copylog') { try { await navigator.clipboard.writeText(A.log.join('\n')); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy log'; }, 1500); } catch {} }
    else if (a === 'yes' || a === 'no') { A.prog.checks[b.dataset.c] = a; save(); draw(); }
    else if (a === 'sendlog') sendLog(b, b.dataset.c);
    else if (a === 'reflash') go('flash');
    else if (a === 'share') A.ctx.share?.(b);
    else if (a === 'video') A.ctx.launch?.();
  };
  root.onchange = e => {
    const s = e.target.closest('[data-boardpick]'); if (s) compile({ board: s.value });
  };
  root.onsubmit = e => { const f = e.target.closest('.as-wifi'); if (!f) return; e.preventDefault(); provision(f); };
}
function syncTickBar(k) {
  const list = k === 'print' ? A.P.printed : A.P.bought, m = A.prog.tick[k] || {};
  const n = list.filter(x => m[x.name]).length, all = n === list.length;
  const bar = host.querySelector('.as-bar [data-a="all"], .as-bar [data-a="next"]');
  if (bar) { bar.dataset.a = all ? 'next' : 'all'; bar.textContent = all ? `Next: ${STEPS[A.P.keys[A.P.keys.indexOf(k) + 1]]?.label || 'Done'}` : k === 'print' ? 'All printed' : 'Got everything'; }
  const c = host.querySelector('.as-count'); if (c) c.textContent = `${n} of ${list.length}`;
}

// ---------------------------------------------------------------- thumbnails (renders of the model's own parts)
function thumb(name, kind) {
  let url = null;
  try { const v = A.ctx.viewer?.(); if (v?.items?.length) url = partThumb(v, name); } catch {}
  if (url) return `<img class="as-th" src="${url}" alt="">`;
  const ic = kind === 'print' ? I.print : /screw|bolt|nut|washer|insert/i.test(name) ? I.screw : /wire|cable|jumper|dupont/i.test(name) ? I.wire : /esp|board|module|oled|display|sensor|servo|driver|pcb/i.test(name) ? I.board : I.box;
  return `<span class="as-th as-th-ic">${ic}</span>`;
}
/** The viewer may still be loading the model: draw again once it has parts (thumbnails, the 3D stage). */
function whenModel() {
  clearTimeout(A.modelT);
  if (A.ctx.viewer?.()?.items?.length) { A.modelTries = 0; return; }
  if ((A.modelTries = (A.modelTries || 0) + 1) > 20) return;
  const id = A.id;
  A.modelT = setTimeout(() => { if (A?.id === id && host?.isConnected && !host.hidden && A.ctx.viewer?.()?.items?.length && !['connecting', 'flashing', 'wifi'].includes(A.flash.st)) draw(); else if (A?.id === id) whenModel(); }, 700);
}

// ---------------------------------------------------------------- step views: { html, next, prev, after, three }
const nextLabel = () => { const k = A.P.keys[A.P.keys.indexOf(A.cur) + 1]; return k ? `Next: ${k === 'close' && !A.P.elec ? 'Put it together' : STEPS[k].label}` : 'Done'; };
function tickList(k, list, row) {
  const m = A.prog.tick[k] || {};
  return `<ul class="as-list">${list.map(x => `<li class="as-item">${thumb(x.name, k)}<div class="as-it">${row(x)}</div>
    <button type="button" class="as-tick${m[x.name] ? ' on' : ''}" role="checkbox" aria-checked="${!!m[x.name]}" aria-label="${esc(x.name)}" data-tick="${esc(k)}|${esc(x.name)}">${I.check}</button></li>`).join('')}</ul>`;
}
function tickNext(k, list, allLabel) {
  const m = A.prog.tick[k] || {}, all = list.every(x => m[x.name]);
  return `<button type="button" class="as-btn primary" data-a="${all ? 'next' : 'all'}">${all ? esc(nextLabel()) : allLabel}</button>`;
}

const STEP_HTML = {
  print(P) {
    const d = A.d, t = d.totals || {}, mats = [...new Set(P.printed.map(p => p.material).filter(Boolean))];
    const zip = (d.downloads || []).find(x => /printed-parts/.test(x.href));
    const p0 = P.printed[0] || {};
    const m = A.prog.tick.print || {};
    return {
      html: `<h2>Print the parts</h2>
        <p class="as-sub">${P.printed.length} part${P.printed.length === 1 ? '' : 's'} · about ${fmtH(t.hours || d.print_hours)} · ${Math.round(t.grams || 0)} g${mats.length ? ` of ${esc(mats.join(' / '))}` : ''}</p>
        <div class="as-acts">${zip ? `<a class="as-btn" href="${esc(zip.href)}" download>${I.dl}Download all (STL)</a>` : ''}
          <button type="button" class="as-btn" disabled title="Coming soon">${I.print}Print on my Bambu<span class="as-soon">Soon</span></button></div>
        ${p0.layer_height ? `<p class="as-note">${esc([p0.layer_height + ' layers', p0.walls, p0.infill, p0.supports && /none/i.test(p0.supports) ? 'no supports' : p0.supports].filter(Boolean).join(' · '))}</p>` : ''}
        <div class="as-lhead"><span>Tick each one when it's off the printer</span><span class="as-count">${P.printed.filter(x => m[x.name]).length} of ${P.printed.length}</span></div>
        ${tickList('print', P.printed, x => `<b>${esc(x.name)}</b><span>${esc([fmtH(x.hours), x.grams ? `${x.grams} g` : '', x.too_big ? 'too big for a 256 mm bed' : ''].filter(Boolean).join(' · '))}</span>
          <a class="as-mini" href="/files/projects/${encodeURIComponent(A.id)}/${esc(x.file)}" download>${I.dl}STL</a>`)}`,
      next: tickNext('print', P.printed, 'All printed'),
    };
  },
  gather(P) {
    const m = A.prog.tick.gather || {};
    const kit = x => /elegoo|your kit|in the kit|starter kit/i.test(x.notes || '');
    const kits = P.bought.filter(kit).length;
    return {
      html: `<h2>Gather the parts</h2>
        <p class="as-sub">${P.bought.length} thing${P.bought.length === 1 ? '' : 's'} to have on the desk${kits ? ` · ${kits} from your kit` : ''}</p>
        <div class="as-lhead"><span>Tick what you have</span><span class="as-count">${P.bought.filter(x => m[x.name]).length} of ${P.bought.length}</span></div>
        ${tickList('gather', P.bought, x => `<b><span class="as-qty">${Number(x.qty) > 1 ? `${x.qty}×` : ''}</span>${esc(x.name)}</b>
          ${kit(x) ? `<span class="as-kit">${/elegoo/i.test(x.notes) ? 'In your ELEGOO kit' : 'In your kit'}</span>` : x.cut ? '<span class="as-kit as-cut">Cut part</span>' : ''}
          ${x.notes && !/^search:/i.test(x.notes) ? `<span class="as-desc">${esc(String(x.notes).replace(/^In your ELEGOO kit\.?\s*/i, ''))}</span>` : ''}`)}`,
      next: tickNext('gather', P.bought, 'Got everything'),
    };
  },
  wire(P) {
    const n = P.wires.length;
    const i = A.prog.wire = Math.max(0, Math.min(n - 1, A.prog.wire || 0));
    const w = P.wires[i];
    const col = wireCss(w.color);
    const end = (e, side) => `<div class="as-end as-end-${side}">${thumb(e.model || e.part, 'wire')}<b>${esc(short(e.part))}</b><span class="as-pin" style="--wc:${col}">${esc(e.pin || '?')}</span></div>`;
    const grp = P.wires.map((x, j) => ({ x, j })).filter(o => short(o.x.to.part) === short(w.to.part) && short(o.x.from.part) === short(w.from.part));
    return {
      html: `<h2>Wire it</h2>
        <p class="as-sub">Wire ${i + 1} of ${n} · ${esc(short(w.from.part))} to ${esc(short(w.to.part))}${i === 0 ? ' · keep the USB unplugged while you wire' : ''}</p>
        <div class="as-wire" style="--wc:${col}">${end(w.from, 'a')}
          <svg class="as-wline" viewBox="0 0 120 40" preserveAspectRatio="none" aria-hidden="true"><path d="M4 20 C40 2, 80 38, 116 20" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round"/></svg>
          ${end(w.to, 'b')}</div>
        <p class="as-wcap"><i style="background:${col}"></i>${esc(cap(w.color || 'any colour'))} ${esc(w.kind === 'dupont' ? 'jumper wire' : w.kind || 'wire')}${w.note ? ` · ${esc(w.note)}` : ''}</p>
        <div class="as-wdots" role="group" aria-label="Wires">${P.wires.map((x, j) => `<button type="button" data-a="wpick" data-i="${j}" class="${j === i ? 'on' : ''}${j < i ? ' past' : ''}" style="--wc:${wireCss(x.color)}" aria-label="Wire ${j + 1}: ${esc(x.from.pin)} to ${esc(x.to.pin)}"></button>`).join('')}</div>
        ${grp.length > 1 ? `<ul class="as-wgrp">${grp.map(o => `<li class="${o.j === i ? 'on' : ''}${o.j < i ? ' past' : ''}"><i style="background:${wireCss(o.x.color)}"></i>${esc(o.x.from.pin)} → ${esc(o.x.to.pin)}</li>`).join('')}</ul>` : ''}`,
      prev: i > 0 ? 'Previous wire' : 'Back',
      next: `<button type="button" class="as-btn primary" data-a="wnext">${i < n - 1 ? 'Next wire' : 'Wiring done'}</button>`,
      three: { kind: 'wire', i },
    };
  },
  flash() { return flashView(); },
  test(P) { return testView(P); },
  close(P) {
    if (A.prog.done.close || !P.place.length) return doneView(P);
    const n = P.place.length, i = A.prog.close = Math.max(0, Math.min(n - 1, A.prog.close || 0)), st = P.place[i];
    const parts = st.parts || [];
    return {
      html: `<h2>${P.elec ? 'Close it up' : 'Put it together'}</h2>
        <p class="as-sub">Step ${i + 1} of ${n}${P.elec && i === 0 ? ' · it works, so now it goes in the case' : ''}</p>
        <div class="as-cstep"><b>${esc(st.title || st.text)}</b>${st.text && st.text.replace(/\.$/, '') !== st.title ? `<p>${esc(st.text)}</p>` : ''}
          ${st.warning ? `<p class="as-warn">${esc(st.warning)}</p>` : ''}
          ${parts.length ? `<div class="as-cparts">${parts.slice(0, 6).map(p => `<span>${thumb(p)}${esc(short(p))}</span>`).join('')}</div>` : ''}</div>
        <div class="as-wdots as-cdots" aria-hidden="true">${P.place.map((_, j) => `<span class="${j === i ? 'on' : ''}${j < i ? ' past' : ''}"></span>`).join('')}</div>`,
      prev: i > 0 ? 'Previous step' : 'Back',
      next: `<button type="button" class="as-btn primary" data-a="cnext">${i < n - 1 ? 'Next step' : "It's done"}</button>`,
      three: { kind: 'close', title: st.title, i },
    };
  },
};
function doneView(P) {
  return {
    html: `<div class="as-done"><span class="as-bigtick">${I.check}</span><h2>It's done</h2>
      <p class="as-sub">${esc(A.ctx.title || 'Your build')} is built${P.elec && A.prog.done.flash && A.prog.done.test ? ', flashed and tested' : ''}.</p>
      <div class="as-acts as-acts-c"><button type="button" class="as-btn primary" data-a="share">${I.share}Share it</button>
        <button type="button" class="as-btn" data-a="video">${I.video}Make a launch video</button></div>
      <button type="button" class="as-link" data-a="again">Go through the build again</button></div>`,
    next: '',
    three: null,
  };
}
function wireCss(c) {
  const H = { red: '#d93025', black: '#26231f', white: '#e7e5e4', yellow: '#f4c20d', green: '#1e8e3e', blue: '#1a73e8', orange: '#f57c00', purple: '#8e44ad', brown: '#795548', grey: '#9e9e9e', gray: '#9e9e9e', pink: '#e91e63' };
  return H[c] || '#b8b2a7';
}

// ---------------------------------------------------------------- 3D (desktop): the model pane beside the step card
function stage(s) {
  const v = A?.ctx?.viewer?.();
  const want = s && !narrow() && v?.items?.length ? s : null;
  A && (A.three = !!want);
  host?.querySelector('.as')?.classList.toggle('as-3d', !!want);
  A?.ctx?.stage?.(!!want);
  if (!v) return;
  if (want?.kind !== 'wire' && v.wiring?.on) v.wiring.set(false);
  if (want?.kind !== 'close' && v.assembly?.steps?.open) v.assembly.steps.close();
  if (want?.kind === 'wire' && v.wiring?.has) {
    if (!v.wiring.on) v.wiring.set(true);
    v.wiring.select(want.i, { keep: true, scroll: false });
  } else if (want?.kind === 'close') {
    const sv = v.assembly?.steps; if (!sv) return;
    const at = () => Math.max(0, sv.list.findIndex(x => x.title === want.title));
    if (sv.open) sv.go(at()); else sv.show(0, { play: false }).then(() => { if (sv.open && A?.cur === 'close') sv.go(at()); });
  }
}

// ---------------------------------------------------------------- flash
const isWeb = () => serialOk() && !phoneUA();
function boardLine(fw) {
  return `<div class="as-board">${I.flash}<span>${esc(fw.board_label || 'ESP32')}</span>${fw.board_from === 'default' ? '<em>(no board named in the design)</em>' : ''}
    <button type="button" class="as-link" data-a="board">change</button></div>
    <label class="as-boardsel" hidden><span>Board</span><select data-boardpick>${(fw.boards || []).map(b => `<option value="${esc(b.id)}" ${b.id === fw.board ? 'selected' : ''}>${esc(b.label)}</option>`).join('')}</select></label>`;
}
function flashView() {
  const fw = A.fw || {}, F = A.flash;
  const diy = fw.sketch ? `<details class="as-diy"><summary>Build it yourself in the Arduino IDE</summary><ol>
      <li><a href="${esc(fw.zip)}" download>Download the sketch (.zip)</a>, unzip it and open the <code>.ino</code> file.</li>
      <li>Boards Manager: install <b>esp32 by Espressif</b> (3.x). Library Manager: the libraries the sketch includes.</li>
      <li>Tools → Board: <b>${esc(fw.board === 'esp32c3' ? 'ESP32C3 Dev Module (USB CDC On Boot: Enabled)' : fw.board === 'esp32s3' ? 'ESP32S3 Dev Module' : 'ESP32 Dev Module')}</b>, pick the port, then Upload.</li></ol></details>` : '';
  const head = `<h2>Flash the firmware</h2>`;
  const nextBtn = A.prog.done.flash ? `<button type="button" class="as-btn primary" data-a="next">${esc(nextLabel())}</button>` : `<button type="button" class="as-btn ghost" data-a="skip">Skip</button>`;
  if (!fw.sketch) {
    return { html: head + `<p class="as-sub">${fw.micropython ? 'This firmware is MicroPython, which can\'t be flashed from the browser yet. Ask Premake in the chat to rewrite it as an Arduino sketch.' : 'This design has no firmware yet. Ask Premake in the chat: "Write the firmware for my ESP32".'}</p>`, next: nextBtn };
  }
  if (!isWeb()) { // phones, Safari, Firefox: the step on a computer
    const url = location.origin + A.ctx.href('flash');
    return {
      html: head + `<div class="as-away"><div class="as-qr"><canvas aria-label="QR code for this step" role="img"></canvas></div>
        <div><b>Open this step on your computer</b><p>Flashing talks to the board over USB, which only Chrome, Edge, Arc or Brave on a computer can do. Scan this or open the link there.</p>
        <div class="as-acts"><button type="button" class="as-btn" data-a="copyqr" data-url="${esc(url)}">${I.copy}Copy link</button></div></div></div>` + diy,
      next: nextBtn,
      after: () => drawQr(url),
    };
  }
  let main = '';
  const hard = fw.wifi_hardcoded && fw.state !== 'compiling' ? `<div class="as-card as-warnc"><b>The Wi-Fi name and password are written in the code</b><p>So it can't join your Wi-Fi after flashing. Let Premake switch it to Wi-Fi setup over USB.</p>
      <div class="as-acts"><button type="button" class="as-btn" data-a="wifi-hard">Switch to Wi-Fi setup</button></div></div>` : '';
  if (fw.state === 'compiling' || A.compiling) {
    main = progress('Getting the firmware ready', `Compiling for the ${esc(fw.board_label || 'board')}. About ${Math.max(20, fw.seconds || 45)} seconds.`, A.compPct || 4, 'compile');
  } else if (fw.state === 'failed') {
    main = `<div class="as-card as-errc"><b>The firmware didn't compile</b><ul class="as-errs">${(fw.errors || []).slice(0, 6).map(e => `<li>${esc(e)}</li>`).join('')}</ul>
      <div class="as-acts">${A.ctx.canEdit ? '<button type="button" class="as-btn primary" data-a="askfix">Ask Premake to fix it</button>' : ''}<button type="button" class="as-btn" data-a="retry-compile">Compile again</button></div></div>`;
  } else if (fw.state !== 'ready') {
    main = progress('Getting the firmware ready', '', 3, 'compile');
  } else if (F.st === 'connecting') {
    main = progress(F.picking ? 'Pick your board in the list' : 'Connecting to the board', F.picking ? 'It\'s named CP2102, USB Serial or similar.' : 'Hold on a few seconds.', null);
  } else if (F.st === 'flashing') {
    main = progress('Writing the firmware', 'Keep it plugged in.', F.pct || 0, 'flash');
  } else if (F.st === 'wifi') {
    main = wifiForm(F);
  } else if (F.st === 'done') {
    main = `<div class="as-ok"><span class="as-bigtick">${I.check}</span><b>Flashed${F.wifi ? ` · on ${esc(F.wifi)}` : ''}</b><span>${esc(F.chip || '')}</span></div>`;
  } else if (F.st === 'error') {
    main = trouble(F) + bigButton('Try again');
  } else {
    main = (A.prog.done.flash && A.prog.flashed === fw.hash ? `<p class="as-note as-okline">${I.check}This firmware is on the board. Flash again any time.</p>` : '') + bigButton('Flash to my ESP32');
  }
  return {
    html: head + `<p class="as-sub">Plug the board into this computer with a USB data cable.</p>` + boardLine(fw) + hard + main + diy,
    next: nextBtn,
    after: () => { if (fw.state === 'stale' || (!fw.state && fw.sketch)) maybeCompile(); if (fw.state === 'compiling') pollFw(); if (fw.state === 'ready') loadEsptool().catch(() => {}); },
  };
}
const bigButton = label => `<button type="button" class="as-big" data-a="flash">${I.usb}<span>${esc(label)}</span></button>`;
function progress(title, sub, pct, kind) {
  const ind = pct == null;
  return `<div class="as-prog${ind ? ' ind' : ''}" data-prog="${kind || ''}"><div class="as-ptxt"><b>${esc(title)}</b>${ind ? '' : `<span class="as-pct">${Math.round(pct)}%</span>`}</div>
    <div class="as-pbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" ${ind ? '' : `aria-valuenow="${Math.round(pct)}"`}><i style="width:${ind ? 35 : Math.max(2, pct)}%"></i></div>${sub ? `<p>${sub}</p>` : ''}</div>`;
}
function setPct(kind, pct) { // update a running bar without redrawing the step
  const p = host?.querySelector(`.as-prog[data-prog="${kind}"]`); if (!p) return;
  p.querySelector('.as-pbar i').style.width = Math.max(2, pct) + '%';
  p.querySelector('.as-pbar').setAttribute('aria-valuenow', String(Math.round(pct)));
  const t = p.querySelector('.as-pct'); if (t) t.textContent = Math.round(pct) + '%';
}
const BOOT_ART = `<svg class="as-boot" viewBox="0 0 220 110" aria-hidden="true">
  <rect x="10" y="18" width="200" height="74" rx="6" fill="#1f4f8f"/><rect x="0" y="44" width="22" height="22" rx="2" fill="#b8b2a7"/>
  <rect x="70" y="30" width="60" height="50" rx="3" fill="#cfd3d8"/><text x="100" y="59" text-anchor="middle" font-size="10" fill="#555" font-family="sans-serif">ESP32</text>
  <rect x="30" y="26" width="16" height="12" rx="2" fill="#2b2b2b"/><text x="38" y="20" text-anchor="middle" font-size="9" fill="currentColor" font-family="sans-serif">EN</text>
  <rect x="30" y="72" width="16" height="12" rx="2" fill="#2b2b2b"/><text x="38" y="104" text-anchor="middle" font-size="9" font-weight="700" fill="currentColor" font-family="sans-serif">BOOT</text>
  <circle class="as-press" cx="38" cy="78" r="13" fill="none" stroke="#f97316" stroke-width="3"/></svg>`;
function trouble(F) {
  const k = F.kind;
  if (k === 'noport') return `<div class="as-card as-trc"><b>No board picked</b><ul>
      <li>Use a USB <b>data</b> cable. Many cables only charge: try another one.</li>
      <li>Try another USB port, straight into the computer (no hub).</li>
      <li>Still nothing in the list? Install the USB driver: <a href="https://www.silabs.com/developer-tools/usb-to-uart-bridge-vcp-drivers" target="_blank" rel="noopener">CP210x</a> (ELEGOO / DevKit) or <a href="https://www.wch-ic.com/downloads/CH341SER_ZIP.html" target="_blank" rel="noopener">CH340</a>.</li></ul>
      <button type="button" class="as-link" data-a="flash-any">My board isn't in the list: show every port</button></div>`;
  if (k === 'boot') return `<div class="as-card as-trc as-trboot">${BOOT_ART}<div><b>The board didn't answer</b><p>Hold the <b>BOOT</b> button, click Try again, and let go when the bar starts moving.</p></div></div>`;
  if (k === 'busy') return `<div class="as-card as-trc"><b>Another app is using the board</b><p>Close the Arduino IDE's Serial Monitor, other Premake tabs or any serial terminal, then try again. Unplug and replug the board if it still says busy.</p></div>`;
  if (k === 'chip') return `<div class="as-card as-trc"><b>That's a ${esc(F.chip)}, not a ${esc(A.fw?.chip || 'match')}</b><p>The firmware was built for the ${esc(A.fw?.board_label || 'other board')}.</p>
      ${F.board ? `<div class="as-acts"><button type="button" class="as-btn primary" data-a="board-fix" data-b="${esc(F.board)}">Build it for the ${esc(F.chip)}</button></div>` : ''}</div>`;
  if (k === 'lib') return `<div class="as-card as-trc"><b>The flasher didn't load</b><p>Check the internet connection and try again.</p></div>`;
  return `<div class="as-card as-trc"><b>Flashing stopped</b><p>${esc(F.msg || 'Something went wrong.')}</p><p>Unplug the board, plug it back in and try again.</p></div>`;
}
function classify(e) {
  const m = String(e?.message || e || ''), n = e?.name || '';
  if (n === 'NotFoundError' || /no port selected/i.test(m)) return 'noport';
  if (n === 'InvalidStateError' || n === 'NetworkError' || /failed to open|already open|busy|access denied|in use/i.test(m)) return 'busy';
  if (/failed to connect|timeout|timed out|sync|invalid head|wrong boot mode|no serial data/i.test(m)) return 'boot';
  return 'other';
}

let esptool = null;
const loadEsptool = () => (esptool ||= import(ESPTOOL).catch(e => { esptool = null; throw e; }));
function maybeCompile() {
  const fw = A.fw;
  if (!fw?.sketch || A.compiling || fw.state === 'compiling' || fw.state === 'ready' || fw.state === 'failed') return;
  compile({});
}
async function compile(body) {
  if (!A || A.compiling) return;
  const id = A.id;
  A.compiling = true; A.compT0 = Date.now(); A.compPct = 3; A.flash = { st: 'idle' };
  tickCompile(); draw();
  try { const fw = await api(`${fwBase()}/compile`, { method: 'POST', body }); if (A?.id === id) A.fw = fw; }
  catch (e) { if (A?.id === id) A.fw = { ...(A.fw || {}), state: 'failed', errors: [e.message] }; }
  if (A?.id !== id) return;
  A.compiling = false;
  if (A.fw?.state === 'compiling') pollFw(); else clearInterval(A.compTick);
  draw();
}
/** The compile bar: time-based against the last compile's duration, easing towards 95 %. */
function tickCompile() {
  clearInterval(A.compTick);
  A.compT0 ||= Date.now();
  const est = Math.max(20, A.fw?.seconds || 45) * 1000;
  A.compTick = setInterval(() => {
    if (!A || !(A.compiling || A.fw?.state === 'compiling')) { clearInterval(A?.compTick); return; }
    A.compPct = 95 * (1 - Math.exp(-2.2 * (Date.now() - A.compT0) / est));
    setPct('compile', A.compPct);
  }, 400);
}
function pollFw() {
  clearTimeout(A.poll);
  if (!A.compTick) tickCompile();
  const id = A.id;
  A.poll = setTimeout(async () => {
    if (!A || A.id !== id) return;
    try { A.fw = await api(fwBase()); } catch {}
    if (A.fw?.state === 'compiling') pollFw(); else { clearInterval(A.compTick); A.compTick = null; A.compT0 = 0; draw(); }
  }, 2500);
}

/** One click: port (filtered), connect, write with progress, reset, then Wi-Fi (Improv) when the sketch uses it. */
async function startFlash(anyPort) {
  const fw = A.fw; if (!fw?.manifest || fw.state !== 'ready') return;
  stopLog();
  A.flash = { st: 'connecting', picking: true }; draw();
  let port, transport;
  try {
    port = await navigator.serial.requestPort(anyPort ? {} : { filters: USB_FILTERS });
  } catch (e) { return fail(e); }
  A.port = port;
  A.flash = { st: 'connecting' }; draw();
  try {
    const lib = await loadEsptool().catch(() => { const x = new Error('lib'); x.lib = true; throw x; });
    const manifest = await api(fw.manifest);
    transport = new lib.Transport(port, true);
    const term = { clean() {}, writeLine(l) { A.flog = [...(A.flog || []), l].slice(-40); }, write() {} };
    const loader = new lib.ESPLoader({ transport, baudrate: BAUD_FLASH, romBaudrate: 115200, terminal: term });
    const chipDesc = await within(loader.main(), 25000, 'Failed to connect with the device (timed out)');
    const chipName = loader.chip?.CHIP_NAME || '';
    const build = (manifest.builds || []).find(b => b.chipFamily === chipName);
    if (!build) {
      await transport.disconnect().catch(() => {});
      const board = { 'ESP32': 'esp32', 'ESP32-C3': 'esp32c3', 'ESP32-S3': 'esp32s3' }[chipName];
      A.flash = { st: 'error', kind: 'chip', chip: chipName || 'different chip', board: (fw.boards || []).some(b => b.id === board) ? board : null };
      draw(); return;
    }
    const base = new URL(fw.manifest, location.href);
    const files = [];
    for (const p of build.parts) {
      const r = await fetch(new URL(p.path, base), { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`Couldn't download the firmware (HTTP ${r.status})`);
      files.push({ data: bstr(new Uint8Array(await r.arrayBuffer())), address: p.offset });
    }
    A.flash = { st: 'flashing', pct: 0 }; draw();
    const total = files.reduce((s, f) => s + f.data.length, 0);
    let last = -1;
    await loader.writeFlash({ fileArray: files, flashSize: 'keep', flashMode: 'keep', flashFreq: 'keep', eraseAll: false, compress: true,
      reportProgress: (fi, written, tot) => { const pct = 100 * (files.slice(0, fi).reduce((s, f) => s + f.data.length, 0) + written / Math.max(1, tot) * files[fi].data.length) / total; if (Math.round(pct) !== last) { last = Math.round(pct); A.flash.pct = pct; setPct('flash', pct); } } });
    try { await loader.after('hard_reset'); } catch {}
    await transport.disconnect().catch(() => {});
    A.flash = { st: 'done', chip: chipDesc };
    A.prog.flashed = fw.hash; A.prog.done.flash = true; save();
    if (fw.uses_wifi_helper) return startWifi();
    draw();
  } catch (e) {
    try { await within(transport?.disconnect(), 3000); } catch {}
    fail(e);
  }
}
function fail(e) {
  const kind = e?.lib ? 'lib' : classify(e);
  A.flash = { st: 'error', kind, msg: String(e?.message || e) };
  draw();
}
/** p, or a rejection after ms (esptool can wait forever on a port that never answers). */
function within(p, ms, msg = 'Timed out') { let t; return Promise.race([Promise.resolve(p).finally(() => clearTimeout(t)), new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]); }
function bstr(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return s; }

// ---------------------------------------------------------------- Wi-Fi over USB (Improv), inline after flashing
let improvLib = null;
async function startWifi() {
  A.flash = { st: 'wifi', phase: 'wait' }; draw();
  try {
    improvLib ||= await import(IMPROV);
    await sleep(1500); // the sketch boots
    await A.port.open({ baudRate: BAUD_LOG });
    const imp = A.improv = new improvLib.ImprovSerial(A.port, { log() {}, error() {}, debug() {} });
    await imp.initialize(6000);
    if (imp.state === 4 && imp.nextUrl) { /* already on Wi-Fi */ }
    let nets = [];
    try { nets = await imp.scan(); } catch {}
    A.flash = { st: 'wifi', phase: 'form', nets: [...new Map(nets.map(n => [n.name, n])).values()].filter(n => n.name).slice(0, 12) };
  } catch (e) {
    await improvClose();
    A.flash = { st: 'wifi', phase: 'nope' };
  }
  draw();
}
function wifiForm(F) {
  if (F.phase === 'wait') return progress('Starting Wi-Fi setup', 'The board is restarting.', null);
  if (F.phase === 'nope') return `<div class="as-ok"><span class="as-bigtick">${I.check}</span><b>Flashed</b></div>
    <div class="as-card as-trc"><b>The board didn't answer the Wi-Fi setup</b><p>Press its EN (reset) button and try again, or skip: it works without Wi-Fi until you set it up.</p>
    <div class="as-acts"><button type="button" class="as-btn" data-a="wifi-retry">Try again</button><button type="button" class="as-btn ghost" data-a="wifi-skip">Skip Wi-Fi</button></div></div>`;
  if (F.phase === 'sending') return progress(`Joining ${F.ssid}`, 'Up to 30 seconds.', null);
  return `<div class="as-ok as-ok-s"><span class="as-bigtick">${I.check}</span><b>Flashed. Now your Wi-Fi.</b></div>
    <form class="as-wifi" autocomplete="off">
      <label><span>Wi-Fi name</span>${F.nets?.length ? `<select name="ssid">${F.nets.map(n => `<option>${esc(n.name)}</option>`).join('')}<option value="">Other…</option></select>` : '<input name="ssid" required autocapitalize="off" spellcheck="false">'}</label>
      <label><span>Password</span><input name="pw" type="password" autocomplete="off"></label>
      ${F.err ? `<p class="as-err">${esc(F.err)}</p>` : ''}
      <p class="as-note">2.4 GHz networks only. It's sent over the USB cable to the board, not to Premake.</p>
      <div class="as-acts"><button class="as-btn primary" type="submit">Connect</button><button type="button" class="as-btn ghost" data-a="wifi-skip">Skip</button></div></form>`;
}
async function provision(f) {
  let ssid = f.ssid?.value ?? f.querySelector('[name=ssid]').value;
  if (!ssid) { ssid = prompt('Wi-Fi name') || ''; if (!ssid) return; }
  const pw = f.querySelector('[name=pw]').value;
  const nets = A.flash.nets;
  A.flash = { st: 'wifi', phase: 'sending', ssid, nets }; draw();
  try {
    await A.improv.provision(ssid, pw, 30000);
    await improvClose();
    A.flash = { st: 'done', wifi: ssid }; draw();
  } catch (e) {
    A.flash = { st: 'wifi', phase: 'form', nets, err: /unable|connect/i.test(String(e?.message || e)) ? `Couldn't join ${ssid}. Check the password (and that it's 2.4 GHz).` : String(e?.message || e) };
    draw();
  }
}
async function improvClose() {
  try { await A.improv?.close(); } catch {}
  A.improv = null;
  try { if (A.port?.readable) await A.port.close(); } catch {}
}

// ---------------------------------------------------------------- test: serial log + checks
function checksOf(P) {
  const t = String(P.test?.text || '');
  const m = t.match(/check that (.+?)(?:\.\s|\.$|$)/i);
  let out = m ? m[1].split(/,\s*(?:and\s+)?(?=the\s|it\s|its\s|a\s|you\s|your\s)|\s+and\s+(?=the\s|it\s|its\s|a\s|you\s|your\s)/i) : [];
  out = out.map(s => cap(s.trim().replace(/\.$/, ''))).filter(s => s.length > 3).slice(0, 3);
  if (!out.length) out = ['It powers on and does what it should'];
  return out;
}
function testView(P) {
  const cs = checksOf(P), web = isWeb();
  const logBox = web ? `<div class="as-log"><div class="as-loghead"><b>Board log</b><span class="as-logst">${A.logOn ? '<i></i>Live · 115200' : 'Not connected'}</span>
      <span class="as-grow"></span>${A.logOn ? '<button type="button" class="as-mini" data-a="restart">Restart board</button>' : ''}<button type="button" class="as-mini" data-a="copylog">Copy log</button></div>
      <pre class="as-logtxt" aria-live="off">${A.log.length ? esc(A.log.slice(-300).join('\n')) : ''}</pre>
      ${A.logOn ? '' : `<button type="button" class="as-btn as-logbtn" data-a="log">${I.usb}Show the board's log</button>`}</div>`
    : `<p class="as-note">The board's log needs Chrome or Edge on a computer. You can still do the checks.</p>`;
  const items = cs.map((c, j) => {
    const a = A.prog.checks[c];
    return `<li class="as-check${a ? ' ' + a : ''}"><span>${esc(c)}</span><div class="as-yn"><button type="button" class="${a === 'yes' ? 'on' : ''}" data-a="yes" data-c="${esc(c)}">Yes</button><button type="button" class="${a === 'no' ? 'on' : ''}" data-a="no" data-c="${esc(c)}">No</button></div>
      ${a === 'no' ? (A.sent === c ? `<div class="as-sent">${I.check}<span>Sent to Premake. It's fixing the code; flash again when it's done.</span><button type="button" class="as-btn" data-a="reflash">Go to Flash</button></div>`
        : A.ctx.canEdit ? `<div class="as-sendrow"><button type="button" class="as-btn primary" data-a="sendlog" data-c="${esc(c)}">${I.send}Send the log to Premake</button><span>It reads the log and fixes the code.</span></div>` : '') : ''}</li>`;
  }).join('');
  const all = cs.every(c => A.prog.checks[c] === 'yes');
  return {
    html: `<h2>Test it</h2><p class="as-sub">Plug it in and watch it start.</p>${logBox}<h3>Does it work?</h3><ul class="as-checks">${items}</ul>`,
    next: `<button type="button" class="as-btn ${all ? 'primary' : 'ghost'}" data-a="${all ? 'next' : 'skip'}">${all ? esc(nextLabel()) : 'Skip'}</button>`,
    after: () => { const pre = host.querySelector('.as-logtxt'); if (pre) pre.scrollTop = pre.scrollHeight; if (web && !A.logOn && A.port && A.prog.done.flash && !A.logTried) { A.logTried = true; startLog(true); } },
  };
}
async function startLog(quiet) {
  if (A.logOn) return;
  try {
    let port = A.port;
    if (!port) { const ps = await navigator.serial.getPorts(); port = ps.length === 1 ? ps[0] : await navigator.serial.requestPort({ filters: USB_FILTERS }); A.port = port; }
    if (!port.readable) await port.open({ baudRate: BAUD_LOG });
    A.logOn = true; A.logPort = port;
    draw();
    readLoop(port);
    restartBoard(); // from the top, so the log shows the boot
  } catch (e) {
    A.logOn = false;
    if (!quiet) { const k = classify(e); A.log.push(k === 'busy' ? '[Premake] Another app is using the board. Close the Serial Monitor or other tabs.' : k === 'noport' ? '[Premake] No board picked.' : `[Premake] ${e.message}`); draw(); }
  }
}
async function readLoop(port) {
  const dec = new TextDecoder();
  let buf = '';
  try {
    A.reader = port.readable.getReader();
    for (;;) {
      const { value, done } = await A.reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split(/\r?\n/); buf = lines.pop();
      if (lines.length) { A.log.push(...lines.map(l => l.replace(/[\x00-\x08\x0b-\x1f]/g, ''))); if (A.log.length > 2000) A.log.splice(0, A.log.length - 1500); paintLog(); }
    }
  } catch {} finally { try { A.reader?.releaseLock(); } catch {} A.reader = null; }
}
function paintLog() {
  const pre = host?.querySelector('.as-logtxt'); if (!pre) return;
  const atEnd = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 30;
  pre.textContent = A.log.slice(-300).join('\n');
  if (atEnd) pre.scrollTop = pre.scrollHeight;
}
async function restartBoard() { // EN low via RTS (DTR high = GPIO0 stays up: normal boot)
  const p = A.logPort; if (!p?.setSignals) return;
  try { await p.setSignals({ dataTerminalReady: false, requestToSend: true }); await sleep(120); await p.setSignals({ dataTerminalReady: false, requestToSend: false }); } catch {}
}
async function stopLog() {
  if (!A?.logOn) return;
  A.logOn = false;
  try { await A.reader?.cancel(); } catch {}
  try { await A.logPort?.close(); } catch {}
  A.logPort = null;
}
async function sendLog(btn, check) {
  const lines = A.log.slice(-60).join('\n').trim();
  const text = `While testing the build, this didn't work: "${check}".\n\n` + (lines ? `Last lines of the board's serial log (115200 baud):\n\`\`\`\n${lines}\n\`\`\`\n\n` : 'There was no serial log (the board wasn\'t connected to the browser).\n\n')
    + 'Find the cause and fix the firmware. If it looks like a wiring problem instead, tell me which wire to check.';
  btn.disabled = true;
  try { await A.ctx.send(text); A.sent = check; A.prog.done.flash = false; save(); draw(); }
  catch (e) { btn.disabled = false; alert(e.message); }
}

// ---------------------------------------------------------------- chat asks (compile fixes, Wi-Fi switch)
async function ask(btn, text) {
  btn.disabled = true;
  try { await A.ctx.send(text); btn.textContent = 'Sent to Premake'; }
  catch (e) { btn.disabled = false; alert(e.message); }
}

// ---------------------------------------------------------------- QR (the App tab's helper, web/appview.js)
async function drawQr(url) {
  const cv = host?.querySelector('.as-qr canvas'); if (!cv) return;
  try { const { loadQr } = await import('./appview.js'); const Q = await loadQr(); if (cv.isConnected) Q.draw(cv.getContext('2d'), Q.encode(url), 4); }
  catch { cv.closest('.as-qr')?.remove(); }
}

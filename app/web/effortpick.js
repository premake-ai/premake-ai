// effortpick: how hard the design agent thinks (Claude Code --effort: low / medium / high / max), per user.
// Desktop: a compact native <select> at the left of the composer bar. Phone: an "Effort" row in the composer's + menu that
// opens a native-style sheet with a checkmark list. Saved with PUT /api/prefs (the server allowlists it and passes it to
// every design turn; default medium). Only shown in the design chat (the page / ads / app agents don't use it).
import { ACCESS } from './api.js';

const LEVELS = [
  ['low', 'Low', 'Fastest. Small tweaks'],
  ['medium', 'Medium', 'Recommended. Quick and careful'],
  ['high', 'High', 'Slower. Tricky mechanisms'],
  ['max', 'Max', 'Slowest. Hardest problems'],
];
const label = v => (LEVELS.find(l => l[0] === v) || LEVELS[1])[1];
let effort = 'medium', loaded = false;
const $ = (s, r = document) => r.querySelector(s);
const chev = '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const gauge = '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M3.5 13.5a6.5 6.5 0 1 1 13 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M10 13.5l3.2-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const tick = '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M3.5 8.3 6.6 11.3 12.5 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

async function save(v) {
  const prev = effort;
  effort = v; sync();
  try {
    const r = await fetch('/api/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ effort: v }), cache: 'no-store' });
    if (!r.ok) throw new Error();
    effort = (await r.json()).effort || v;
  } catch { effort = prev; }
  sync();
}

// ---------------------------------------------------------------- desktop
let wrap = null;
function mountDesktop() {
  const bar = $('#composer .cbar');
  if (!bar || wrap) return;
  wrap = document.createElement('label');
  wrap.className = 'ep-wrap';
  wrap.title = 'Effort: how hard the design agent thinks before it changes the model';
  wrap.innerHTML = `<select class="ep-sel" aria-label="Design agent effort">${LEVELS.map(([v, l]) => `<option value="${v}">${l} effort</option>`).join('')}</select>${chev}`;
  bar.prepend(wrap);
  wrap.querySelector('select').addEventListener('change', e => save(e.target.value));
}

// ---------------------------------------------------------------- phone: + menu row and sheet
let row = null, sheet = null, dim = null;
function mountPhone() {
  const menu = $('.m-pmenu');
  if (!menu || row) return;
  row = document.createElement('button');
  row.type = 'button'; row.className = 'ep-mrow'; row.setAttribute('role', 'menuitem');
  row.innerHTML = `${gauge}<span>Effort</span><span class="ep-mval"></span>`;
  menu.append(row);
  row.addEventListener('click', e => {
    e.stopPropagation();
    menu.hidden = true; // close the + menu (web/phonestudio.js owns it; its button just mirrors the state)
    const plus = $('.m-plus'); plus?.classList.remove('on'); plus?.setAttribute('aria-expanded', 'false');
    openSheet();
  });
}
function sheetHtml() {
  return `<div class="ab-grab"></div><div class="ab-shead"><span></span><b>Effort</b><button type="button" class="ab-stext ab-sdone" data-ep-done>Done</button></div>
    <div class="ab-sbody"><p class="ab-sh">How hard the design agent thinks before it changes your model.</p><div class="ab-group">
    ${LEVELS.map(([v, l, d]) => `<button type="button" class="ab-row" role="radio" aria-checked="${v === effort}" data-ep="${v}"><span class="ab-rl">${l}<small>${d}</small></span><span class="ab-chk">${v === effort ? tick : ''}</span></button>`).join('')}
    </div><p class="ep-foot">Higher effort is slower but more careful. Same model either way.</p></div>`;
}
function openSheet() {
  if (!sheet) {
    dim = document.createElement('div'); dim.className = 'ab-dim'; dim.hidden = true;
    sheet = document.createElement('div'); sheet.className = 'ab-sheet ep-sheet'; sheet.hidden = true;
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'Effort');
    document.body.append(dim, sheet);
    dim.addEventListener('click', closeSheet);
    sheet.addEventListener('click', e => {
      const b = e.target.closest('[data-ep]');
      if (b) { save(b.dataset.ep); setTimeout(closeSheet, 180); return; }
      if (e.target.closest('[data-ep-done]')) closeSheet();
    });
  }
  sheet.innerHTML = sheetHtml();
  document.activeElement?.blur?.();
  sheet.hidden = false; dim.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => { sheet.classList.add('on'); dim.classList.add('on'); }));
}
function closeSheet() {
  if (!sheet || sheet.hidden) return;
  sheet.classList.remove('on'); dim.classList.remove('on');
  setTimeout(() => { sheet.hidden = true; dim.hidden = true; }, 360);
}

// ---------------------------------------------------------------- state
const designChat = () => /3D design/i.test($('#chatWho')?.textContent || 'Editing the 3D design');
function sync() {
  const on = loaded && designChat();
  if (wrap) { wrap.hidden = !on; const s = wrap.querySelector('select'); if (s.value !== effort) s.value = effort; }
  if (row) { row.hidden = !on; row.querySelector('.ep-mval').textContent = label(effort); }
  if (sheet && !sheet.hidden) sheet.innerHTML = sheetHtml();
}

async function init() {
  if (!ACCESS.authed || ACCESS.showcase) return;
  try {
    const r = await fetch('/api/prefs', { cache: 'no-store' });
    if (!r.ok) return; // older server: no picker
    effort = (await r.json()).effort || 'medium';
    loaded = true;
  } catch { return; }
  if (!document.querySelector('link[href="/askcard.css"]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/askcard.css'; document.head.append(l);
  }
  mountDesktop(); mountPhone(); sync();
  const who = $('#chatWho');
  if (who) new MutationObserver(sync).observe(who, { childList: true, characterData: true, subtree: true });
  if (!row) { // the + menu is built by web/phonestudio.js; it may come later
    const mo = new MutationObserver(() => { if ($('.m-pmenu')) { mo.disconnect(); mountPhone(); sync(); } });
    mo.observe(document.body, { childList: true, subtree: true });
  }
}
init();

// chattools: "Ask about this part" for the studio design chat.
// Parts get into the composer from the hover tooltip's Ask button (web/hover.js), the floating "Ask about <part>" chip that
// appears above the composer after a click selects a part (web/partmenu.js onSelect), or a tap + Ask on phones.
// The composer shows one chip per part ("Tilting arm ✕") plus quick questions. On send, the message gets a one-line prefix
//   [Parts referenced: "Tilting arm" (id tilting-arm, printed, 32×110×6 mm, centre x 12 y -4 z 40 mm, CAD Z-up)]
// which the design agent reads (server/design_agent_prompt.md), and the chat history renders as chips (splitParts).

export const QUICK = ['Why is this here?', 'What does this do?', 'Can I remove it?', 'Make it stronger', 'Replace with an Amazon part'];
const PREFIX_RE = /^\[Parts referenced: ([^\n]*)\]\n+/;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = s => String(s ?? '').replace(/["\]\n\r]/g, "'").trim();
const n1 = x => { const r = Math.round(Number(x) * 10) / 10; return Number.isFinite(r) ? String(Object.is(r, -0) ? 0 : r) : '?'; };

/** The prefix line for a list of viewer.partInfo() results ('' when none). */
export function partsPrefix(infos) {
  const list = infos.filter(Boolean);
  if (!list.length) return '';
  const one = i => {
    const size = i.size?.length === 3 ? `${i.size.map(n1).join('×')} mm` : 'size unknown';
    const kind = i.kind === 'fabricated' ? `fabricated: ${i.process}` : i.kind;
    return `"${clean(i.name)}" (id ${clean(i.id)}, ${kind}, ${size}, centre x ${n1(i.center[0])} y ${n1(i.center[1])} z ${n1(i.center[2])} mm)`;
  };
  return `[Parts referenced: ${list.map(one).join('; ')}]\n\n`;
}

/** Split a sent message into { parts: [names], text } (the prefix is for the agent; people see chips). */
export function splitParts(text) {
  const s = String(text ?? ''), m = PREFIX_RE.exec(s);
  if (!m) return { parts: [], text: s };
  return { parts: [...m[1].matchAll(/"([^"]*)" \(/g)].map(x => x[1]), text: s.slice(m[0].length) };
}

/** Chips for the chat history. */
export function partChipsHtml(names) {
  if (!names?.length) return '';
  return `<div class="msg-parts">${names.map(n => `<span class="pc-tag">${partIcon}${esc(n)}</span>`).join('')}</div>`;
}
const partIcon = '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M8 1.8l5.4 3.1v6.2L8 14.2l-5.4-3.1V4.9z M2.6 4.9L8 8l5.4-3.1M8 8v6.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';

function injectCss() {
  if (document.getElementById('pc-css')) return;
  const s = document.createElement('style');
  s.id = 'pc-css';
  s.textContent = `
.pc-wrap { margin: 0 0 8px; display: grid; gap: 7px; min-width: 0; }
.pc-wrap[hidden] { display: none; }
.pc-row { display: flex; flex-wrap: wrap; gap: 6px; }
.pc-q { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 1px 1px 2px; }
.pc-q::-webkit-scrollbar { display: none; }
.pc-q .chip { flex: none; white-space: nowrap; cursor: pointer; }
.chip.pc-part { display: inline-flex; align-items: center; gap: 6px; padding: 3px 4px 3px 9px; color: var(--text, #1c1917); font-weight: 500; max-width: 100%;
  border-color: rgba(249,115,22,.45); cursor: default; }
.pc-part .pc-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; box-shadow: inset 0 0 0 1px rgba(28,25,23,.18); }
.pc-part .pc-n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pc-part .pc-x { width: 18px; height: 18px; border-radius: 50%; border: 0; padding: 0; background: transparent; color: var(--muted, #6b6560); cursor: pointer;
  font: 11px/18px var(--ui, inherit); flex: none; }
.pc-part .pc-x:hover { background: rgba(28,25,23,.08); color: var(--text, #1c1917); }
.pc-suggest { display: inline-flex; align-items: center; gap: 6px; margin: 0 0 8px; cursor: pointer; max-width: 100%; font-weight: 500; color: var(--text, #1c1917); }
.pc-suggest[hidden] { display: none; }
.pc-suggest b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.pc-suggest .pc-plus { color: var(--accent-2, #c2410c); font-weight: 700; }
.msg-parts { display: flex; flex-wrap: wrap; gap: 5px; margin: 0 0 6px; }
.pc-tag { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px 2px 7px; border-radius: 20px; font-size: 12px; font-weight: 500;
  color: var(--accent-2, #c2410c); background: rgba(255, 247, 237, .9); border: 1px solid rgba(249,115,22,.35); }
@media (max-width: 640px) { .chip.pc-part { min-height: 34px; padding: 0 4px 0 11px; } .pc-part .pc-x { width: 28px; height: 28px; line-height: 28px; font-size: 13px; }
  .pc-suggest { min-height: 38px; } }
`;
  document.head.appendChild(s);
}

/**
 * Part context for a composer.
 * opts = { cbox (the box the chips go in), textarea, viewer() -> Viewer|null, enabled() -> bool, before (element the floating
 *          suggestion chip goes before) }
 * Returns { add(name), remove(name), clear(), names(), suggest(name|null), prefix() }.
 */
export function partContext(opts) {
  injectCss();
  const names = [];
  const ta = opts.textarea;
  const wrap = document.createElement('div');
  wrap.className = 'pc-wrap'; wrap.hidden = true;
  wrap.innerHTML = `<div class="pc-row" role="list" aria-label="Parts in this message"></div>
    <div class="pc-q">${QUICK.map(q => `<button type="button" class="chip" data-pcq="${esc(q)}">${esc(q)}</button>`).join('')}</div>`;
  opts.cbox.prepend(wrap);
  const row = wrap.querySelector('.pc-row');
  const sug = document.createElement('button');
  sug.type = 'button'; sug.className = 'chip pc-suggest'; sug.hidden = true;
  opts.before.before(sug);
  let sugName = null, ph0 = null;

  const color = n => opts.viewer()?.items.find(it => it.p.name === n)?.p.color || '#a8a29e';
  function draw() {
    row.innerHTML = names.map(n => `<span class="chip pc-part" role="listitem" title="${esc(n)}"><span class="pc-dot" style="background:${esc(color(n))}"></span>`
      + `<span class="pc-n">${esc(n)}</span><button type="button" class="pc-x" data-pcx="${esc(n)}" aria-label="Remove ${esc(n)}">✕</button></span>`).join('');
    wrap.hidden = !names.length;
    if (names.length && ph0 === null) ph0 = ta.placeholder;
    if (names.length) ta.placeholder = names.length === 1 ? `Ask about ${names[0]}…` : `Ask about these ${names.length} parts…`;
    else if (ph0 !== null) { ta.placeholder = ph0; ph0 = null; }
    suggest(sugName);
  }
  function add(name) {
    if (!name || (opts.enabled && !opts.enabled())) return;
    if (!names.includes(name)) names.push(name);
    draw();
    ta.focus({ preventScroll: true });
  }
  function remove(name) { const i = names.indexOf(name); if (i >= 0) names.splice(i, 1); draw(); }
  function clear() { names.length = 0; sugName = null; // sent (or another project): the suggestion waits for the next click
    wrap.querySelectorAll('.chip.on').forEach(x => x.classList.remove('on')); draw(); }
  function suggest(name) {
    sugName = name || null;
    const show = !!sugName && !names.includes(sugName) && (!opts.enabled || opts.enabled());
    sug.hidden = !show;
    if (show) { sug.innerHTML = `<span class="pc-plus">+</span><span>Ask about</span><b>${esc(sugName)}</b>`; sug.title = `Add ${sugName} to your message`; }
  }
  sug.onclick = () => { if (sugName) add(sugName); };
  wrap.addEventListener('click', e => {
    const x = e.target.closest('[data-pcx]');
    if (x) { e.preventDefault(); remove(x.dataset.pcx); ta.focus(); return; }
    const q = e.target.closest('[data-pcq]');
    if (!q) return;
    e.preventDefault();
    ta.value = q.dataset.pcq;
    wrap.querySelectorAll('.pc-q .chip').forEach(b => b.classList.toggle('on', b === q));
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
    try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch {}
  });

  return {
    add, remove, clear, suggest,
    names: () => [...names],
    prefix: () => { const v = opts.viewer(); return v ? partsPrefix(names.map(n => v.partInfo(n))) : ''; },
  };
}

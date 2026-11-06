// Shared chat rendering (studio chat + website chat): Cursor-style step list and message bodies.
import { messageImagesHtml, stripImageNote } from './attach.js'; // images:
import { splitParts, partChipsHtml } from './askpart.js'; // chattools: part chips instead of the agent's context line
import { msgExtrasHtml } from './askcard.js'; // agentbrain: question cards + "Stopped after 25 min · Continue" under replies
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const chevSvg = '<svg class="chev" viewBox="0 0 16 16" width="12" height="12"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>';

/** Claude-style spark: an orange asterisk that turns while the agent works. */
export const sparkSvg = '<svg class="spark" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4M3.4 3.4l2.8 2.8M9.8 9.8l2.8 2.8M12.6 3.4L9.8 6.2M6.2 9.8l-2.8 2.8"/></g></svg>';
const caretSvg = '<svg class="chev" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Step list, Claude-style: a quiet text row ("14 steps ›") that opens to a plain list. While running, the row is a live
 * line (spark + current step in shimmer text). thinking: the agent's latest thinking summary (live turn only).
 */
export function activityHtml(steps, running, open, thinking = '', live = false, stepParts = null, first = false) {
  if (!steps.length && !running) return '';
  if (running && first) return firstRunHtml(steps, open, thinking, live);
  const lastParts = running && steps.length ? stepParts?.[steps.length - 1] : null; // editglow: "Editing [Link 1] [Link 2]"
  const label = running ? (steps.length ? esc(lastParts ? verbOf(steps[steps.length - 1]) : steps[steps.length - 1]) : 'Planning the change…') : `${steps.length} step${steps.length === 1 ? '' : 's'}`;
  const think = running && thinking ? `<p class="act-think">${esc(thinking.length > 320 ? '…' + thinking.slice(-320) : thinking)}</p>` : '';
  const list = steps.length ? `<ol>${steps.map((s, i) => `<li class="${running && i === steps.length - 1 ? 'cur' : ''}${/^Blocked/.test(s) ? ' bad' : ''}">${stepParts?.[i] ? `${esc(verbOf(s))} ${partChips(stepParts[i])}` : esc(s)}</li>`).join('')}</ol>` : '';
  const expandable = !!(list || think);
  // phonekit: phones show "Editing 6 parts" on one line instead of the chips (phone.css); a tap opens a sheet listing them
  const pn = lastParts ? `<span class="act-pn">${lastParts.length === 1 ? esc(lastParts[0]) : `${lastParts.length} parts`}</span>` : '';
  return `<details class="activity${running ? ' running' : ''}${expandable ? '' : ' bare'}" ${open && expandable ? 'open' : ''} ${live ? 'data-live' : ''}><summary${expandable ? '' : ' tabindex="-1"'}${lastParts ? ` data-eparts="${esc(JSON.stringify(lastParts))}"` : ''}>${running ? sparkSvg : ''}<span class="act-label">${label}</span>${pn}${lastParts ? partChips(lastParts, 3) : ''}${expandable ? caretSvg : ''}</summary>
    <div class="act-body">${list}${think}</div></details>`;
}

// designing: a new design's first run shows a short progress checklist (open by default) instead of raw tool steps.
// The phase comes from the steps the server streams (stepText in server.js): file edits = writing, ./build.sh = building.
const PHASES = [['Reading the request', 'Reading the request and planning'], ['Writing the CAD', 'Writing the CAD'],
  ['Building the parts', 'Building the parts'], ['Checking the result', 'Checking the result']];
function phaseOf(steps) {
  let p = 0;
  for (const s of steps) {
    if (/^Build (finished|failed)/.test(s)) p = Math.max(p, /failed/.test(s) ? 2 : 3);
    else if (/^Building model/.test(s)) p = Math.max(p, 2);
    else if (/^(Writing|Editing)\b/.test(s)) p = Math.max(p, 1);
  }
  return p;
}
/** The live run's current step in plain words (chat line + model card status). first: a new design's first run. */
export function liveStepLabel(L, first = false) {
  const steps = L?.steps || [], last = steps[steps.length - 1] || '';
  if (first) return /^Build failed/.test(last) ? 'Fixing a build error…' : PHASES[phaseOf(steps)][1] + '…';
  return last || 'Planning the change…';
}
const tickSvg = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 8.3 6.6 11.3 12.5 4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function firstRunHtml(steps, open, thinking, live) {
  const cur = phaseOf(steps);
  const list = `<ol class="act-phases">${PHASES.map(([name], i) => `<li class="${i < cur ? 'done' : i === cur ? 'cur' : 'todo'}"><span class="ph-ic">${i < cur ? tickSvg : ''}</span>${esc(name)}</li>`).join('')}</ol>`;
  const think = thinking ? `<p class="act-think">${esc(thinking.length > 240 ? '…' + thinking.slice(-240) : thinking)}</p>` : '';
  return `<details class="activity running first" ${open === false ? '' : 'open'} ${live ? 'data-live' : ''}><summary>${sparkSvg}<span class="act-label">${esc(liveStepLabel({ steps }, true))}</span>${caretSvg}</summary>
    <div class="act-body">${list}${think}</div></details>`;
}
// ---------- editglow: part chips (steps that name parts, part names in the agent's reply). Hover or tap one and the part
// lights up in 3D (web/changefx.js listens for 'buildery:partfocus'; chatui never imports the viewer).
const verbOf = s => String(s).split(' ')[0] || 'Editing';
function partChips(names, max = Infinity) {
  const shown = names.slice(0, max), more = names.length - shown.length;
  return `<span class="ep-chips">${shown.map(n => `<span class="ep-chip" data-part="${esc(n)}" title="${esc(n)}">${esc(n)}</span>`).join('')}${more > 0 ? `<span class="ep-more">+${more}</span>` : ''}</span>`;
}
const focusPart = (names, on, ms) => dispatchEvent(new CustomEvent('buildery:partfocus', { detail: { names, on, ms } }));
let chipsWired = false;
function wireChips() {
  if (chipsWired || typeof document === 'undefined') return;
  chipsWired = true;
  const s = document.createElement('style');
  s.textContent = `
.ep-chips { display: inline-flex; flex-wrap: wrap; gap: 4px; vertical-align: 1px; min-width: 0; }
summary .ep-chips { flex-wrap: nowrap; overflow: hidden; }
.ep-chip { display: inline-block; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: baseline;
  padding: 0 7px; border-radius: 6px; font: 500 12px/19px var(--ui, Inter, system-ui, sans-serif); color: #b4440c; background: #fff4ea;
  border: 1px solid rgba(232, 89, 12, .26); cursor: default; transition: background .12s, border-color .12s, box-shadow .12s; }
.ep-chip:hover, .ep-chip.on { background: #ffe8d4; border-color: rgba(232, 89, 12, .55); box-shadow: 0 0 0 2px rgba(232, 89, 12, .12); }
.ep-more { font: 500 12px/19px var(--ui, Inter, system-ui, sans-serif); color: var(--muted, #78716c); }
.body .ep-chip { display: inline; overflow: visible; max-width: none; font-size: .92em; line-height: 1.45; padding: 0 5px; vertical-align: baseline; -webkit-box-decoration-break: clone; box-decoration-break: clone; } /* inline: sits on the text baseline (an overflow-hidden inline-block aligns its bottom edge instead) */
@media (max-width: 640px) { .ep-chip { max-width: 140px; } }`;
  document.head.appendChild(s);
  let cur = null;
  addEventListener('pointerover', e => {
    const c = e.target.closest?.('.ep-chip');
    if (c === cur) return;
    if (cur && !c) { cur = null; focusPart(null, false); return; }
    if (c && e.pointerType !== 'touch') { cur = c; focusPart([c.dataset.part], true); }
  });
  addEventListener('buildery:partsloaded', () => { // replies rendered before the model loaded: chips now
    document.querySelectorAll('.msg.assistant:not(.live) .body[data-ep]').forEach(b => { b.innerHTML = replyChips(b.innerHTML); b.removeAttribute('data-ep'); });
  });
  addEventListener('click', e => { // taps (phones) and clicks: light it for a moment
    const c = e.target.closest?.('.ep-chip');
    if (!c) return;
    e.preventDefault(); e.stopPropagation(); // a chip in a step summary must not toggle the list
    c.classList.add('on'); setTimeout(() => c.classList.remove('on'), 2500);
    if (matchMedia('(max-width: 640px)').matches && window.__mPartSheet) { window.__mPartSheet(c.dataset.part); return; } // phonekit: the part's sheet (it glows while open)
    focusPart([c.dataset.part], true, 2500);
  }, true);
}
const partNames = () => { const ask = { names: [] }; dispatchEvent(new CustomEvent('buildery:partnames', { detail: ask })); return ask.names; };
const hasNames = () => partNames().length > 0;
/** Model part names (≥ 4 chars) in an assistant reply as chips. html: textHtml output (escaped, tags added). */
function replyChips(html) {
  if (html.includes('class="ep-chip"')) return html;
  const names = partNames().filter(n => n.length >= 4).sort((a, b) => b.length - a.length);
  if (!names.length) return html;
  const re = s => s.map(n => esc(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const rx = new RegExp(`(^|[^\\w-])(${re(names)})(?![\\w-])`, 'gi'); // longest first; one-word names must match case
  const canon = new Map(names.map(n => [esc(n).toLowerCase(), n]));
  let inA = 0, inCode = 0, seen = 0;
  return html.split(/(<[^>]+>)/).map(seg => {
    if (seg.startsWith('<')) { if (/^<a\b/.test(seg)) inA++; else if (seg === '</a>') inA--; else if (/^<(code|pre)\b/.test(seg)) inCode++; else if (/^<\/(code|pre)>/.test(seg)) inCode--; return seg; }
    if (inA || inCode || seen >= 12) return seg;
    return seg.replace(rx, (m, pre, nm) => {
      const n = canon.get(nm.toLowerCase());
      if (!n || seen >= 12 || (!/\s/.test(n) && nm !== esc(n))) return m;
      seen++; return `${pre}<span class="ep-chip" data-part="${esc(n)}">${nm}</span>`;
    });
  }).join('');
}

// ---------- run timeline: "First model 6.2 s · done 14.8 s", expandable to the full waterfall ----------
const sec = ms => (ms / 1000).toFixed(1) + ' s';
export function tlHtml(tl) {
  if (!tl || !Number.isFinite(tl.end)) return '';
  const head = [Number.isFinite(tl.first_model) ? `First model ${sec(tl.first_model)}` : '', `${Number.isFinite(tl.first_model) ? 'done' : 'Done'} ${sec(tl.end)}`].filter(Boolean).join(' · ');
  const max = Math.max(tl.end, 1);
  const pct = v => Math.max(0, Math.min(100, (v / max) * 100)).toFixed(2);
  const mark = (label, v) => Number.isFinite(v) ? `<div class="tl-row"><span class="tl-k">${label}</span><span class="tl-track"><i class="tl-dot" style="left:${pct(v)}%"></i><i class="tl-bar" style="width:${pct(v)}%"></i></span><span class="tl-v">${sec(v)}</span></div>` : '';
  const rows = [
    mark(tl.warm ? 'Agent was warm' : 'Agent started', tl.warm ? 0 : tl.spawn),
    mark('Message to agent', tl.cli_write), mark('Agent ready', tl.init), mark('First token', tl.first_token), mark('First tool', tl.first_tool),
    mark('Sketch', tl.sketch),
    ...(tl.builds || []).map((b, i) => `<div class="tl-row"><span class="tl-k">Build ${i + 1}${b.ok ? '' : ' (failed)'}</span><span class="tl-track"><i class="tl-span${b.ok ? '' : ' bad'}" style="left:${pct(b.start)}%;width:${Math.max(0.8, pct(b.ms))}%"></i></span><span class="tl-v">${sec(b.ms)}${b.warm ? ' warm' : ''}</span></div>`),
    mark('First model', tl.first_model), mark('Done', tl.end),
  ].join('');
  const foot = [tl.warm ? 'warm agent' : 'cold start', tl.effort ? `effort ${tl.effort}` : '', tl.model || '', tl.turns ? `${tl.turns} model calls` : ''].filter(Boolean).join(' · ');
  return `<details class="tl"><summary>${esc(head)}</summary><div class="tl-wf">${rows}</div><div class="tl-foot">${esc(foot)}</div></details>`;
}
/**
 * Chat message body: a safe markdown subset (bold, italic, `code`, ``` blocks, - / 1. lists, # headings as bold lines,
 * paragraphs + line breaks, [links](https://…) in a new tab). Everything is HTML-escaped FIRST; the transforms only
 * add tags, and link targets must be http(s) or mailto, so no HTML from the text can get through.
 */
export function textHtml(t) {
  const lines = esc(t).replace(/\r\n?/g, '\n').split('\n'), out = [];
  let para = [], list = null, code = null;
  const flushP = () => { if (para.length) out.push(`<p>${para.map(mdInline).join('<br>')}</p>`); para = []; };
  const flushL = () => { if (list) out.push(`<${list.tag}>${list.items.map(x => `<li>${mdInline(x)}</li>`).join('')}</${list.tag}>`); list = null; };
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    if (code) { if (/^\s*```/.test(line)) { out.push(`<pre class="md-pre"><code>${code.join('\n')}</code></pre>`); code = null; } else code.push(line); continue; }
    if (/^\s*```/.test(line)) { flushP(); flushL(); code = []; continue; }
    if (TROW.test(line) && TSEP.test(lines[k + 1] || '')) { // phonekit: a markdown table (scrolls sideways on phones when wide)
      flushP(); flushL();
      const al = cells(lines[k + 1]).map(c => /^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : '');
      const rows = [];
      for (k += 2; k < lines.length && TROW.test(lines[k]); k++) rows.push(cells(lines[k]));
      k--;
      const td = (tag, c, i) => `<${tag}${al[i] ? ` style="text-align:${al[i]}"` : ''}>${mdInline(c)}</${tag}>`;
      out.push(`<div class="md-table"><table><thead><tr>${cells(line).map((c, i) => td('th', c, i)).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => td('td', c, i)).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const li = /^\s*(?:([-*+])|(\d{1,3})[.)])\s+(.*)$/.exec(line);
    if (li) {
      flushP();
      const tag = li[1] ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushL();
      if (!list) list = { tag, items: [] };
      list.items.push(li[3]); continue;
    }
    if (!line.trim()) { flushP(); flushL(); continue; }
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue; } // wrapped list item
    flushL();
    const h = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (h) { flushP(); out.push(`<p><strong>${mdInline(h[1])}</strong></p>`); continue; }
    para.push(line);
  }
  if (code) out.push(`<pre class="md-pre"><code>${code.join('\n')}</code></pre>`);
  flushP(); flushL();
  return out.join('');
}
const TROW = /^\s*\|.*\|\s*$/, TSEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
function mdInline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`); // protect code spans from the other rules
  s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (_, txt, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${txt}</a>`);
  s = s.replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>').replace(/__(?=\S)(.+?)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w*])\*(?=\S)([^*]+?)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^\w])_(?=\S)([^_]+?)_(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

const undoSvg = '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M5.5 3.5L2.5 6.5l3 3" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M3 6.5h6.5a3.5 3.5 0 010 7H7" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>';
const redoSvg = '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M10.5 3.5l3 3-3 3" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M13 6.5H6.5a3.5 3.5 0 000 7H9" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>';

/** A user message. Messages that started a recorded run (m.run) can be rewound; undone ones (m.rewound) can be restored. */
function userHtml(m, i, editable) {
  const act = !m.run ? ''
    : m.rewound ? `<div class="mrw"><span>Undone</span>${editable ? `<button class="mact" data-restore="${m.run}" title="Bring back the changes from this message">${redoSvg}Restore</button>` : ''}</div>`
    : editable ? `<button class="mact rw" data-rewind="${i}" title="Undo this message and everything after it">${undoSvg}Rewind to here</button>` : '';
  const sp = splitParts(stripImageNote(m.text)); // chattools:
  const bubble = sp.text.trim() || sp.parts.length ? `<div class="ububble">${partChipsHtml(sp.parts)}${sp.text.trim() ? `<div class="mtext">${esc(sp.text)}</div>` : ''}</div>` : '';
  const by = m.by ? `<div class="mby">${esc(m.by)}</div>` : ''; // share: who wrote it, once someone besides the owner has (server labelChat)
  return `<div class="msg user${m.rewound ? ' rewound' : ''}" data-mi="${i}">${by}${messageImagesHtml(m)}${bubble}${act}</div>`; // images: thumbnails above the bubble
}

const copySvg = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 3.5v-.3A1.7 1.7 0 008.8 1.5H3.2A1.7 1.7 0 001.5 3.2v5.6c0 .9.8 1.7 1.7 1.7h.3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
/** Under a finished reply: copy + the run timings, both quiet until the message is hovered. */
function footHtml(m) {
  if (!String(m.text || '').trim()) return tlHtml(m.tl) ? `<div class="mfoot">${tlHtml(m.tl)}</div>` : '';
  return `<div class="mfoot"><button type="button" class="mcopy" data-copy title="Copy" aria-label="Copy reply">${copySvg}</button>${tlHtml(m.tl)}</div>`;
}

/** Messages + the live turn, as HTML. chat = { messages, live, steps }. opts.editable: show rewind / restore actions. */
/** refs: "Designing something like these": the reference photos a new design is based on (server/refs.js), each linking
 *  to the page it came from. img is relative to the design's files (opts.base). */
function refsHtml(refs, base) {
  if (!Array.isArray(refs) || !refs.length || !base) return '';
  return `<div class="refs"><p class="refs-h">Designing something like these</p><div class="refs-row">${refs.map(r => `<a class="ref" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">
    <img src="${esc(base + r.img)}" alt="${esc(r.caption || r.site || '')}" loading="lazy" decoding="async"><span class="ref-c">${esc(r.caption || '')}</span><span class="ref-s">${esc(r.site || '')}</span></a>`).join('')}</div></div>`;
}

export function threadHtml(chat, opts = {}) {
  const editable = !!opts.editable;
  wireChips();
  const body = t => { // editglow: part names as chips (design chat); data-ep: try again once the model has loaded
    if (!opts.parts) return textHtml(t);
    const h = textHtml(t), c = replyChips(h);
    return c === h && !hasNames() ? `<div class="body" data-ep>${h}</div>` : `<div class="body">${c}</div>`;
  };
  // narration: a text the agent wrote between steps, styled like the reply
  const narr = t => { const h = body(t); return h.startsWith('<div class="body"') ? h.replace('class="body"', 'class="body narr"') : `<div class="body narr">${h}</div>`; };
  const flowHtml = flow => flow.map(x => x.text != null ? narr(x.text) : activityHtml(x.steps, false, false, '', false, x.parts || null)).join('');
  let html = chat.messages.map((m, i) => m.role === 'user'
    ? userHtml(m, i, editable)
    : `<div class="msg assistant${m.rewound ? ' rewound' : ''}">${refsHtml(m.refs, opts.base)}${m.flow?.length ? flowHtml(m.flow) : chat.steps[i] ? activityHtml(chat.steps[i], false, false, '', false, chat.stepParts?.[i]) : ''}${body(m.text)}${opts.parts ? msgExtrasHtml(m, i, chat) : ''}${footHtml(m)}</div>`).join('');
  if (chat.live) {
    const L = chat.live;
    const partial = L.running && L.partial && !(L.text || '').endsWith(L.partial) ? L.partial : '';
    const first = !!opts.firstRun; // designing: a new design's first run (progress checklist, open unless the user closed it)
    const open = first ? (L.closed === true ? false : true) : L.running && L.closed === false;
    const flow = L.flow || [], tail = flow[flow.length - 1];
    let inner;
    if (flow.some(x => x.text != null)) { // narration: texts and step groups in order; only the newest group is the live line
      const done = tail?.steps && L.running ? flow.slice(0, -1) : flow;
      inner = flowHtml(done)
        + (L.running ? activityHtml(first ? L.steps : tail?.steps ? tail.steps : [], true, open, L.thinking, true, first ? L.stepParts : tail?.steps ? tail.parts || null : null, first) : '')
        + (partial ? `<div class="body narr">${textHtml(partial)}</div>` : '');
    } else {
      inner = `${activityHtml(L.steps, L.running, open, L.thinking, true, L.stepParts, first)}
      ${L.text || partial ? `<div class="body">${textHtml(L.text || '')}${partial ? textHtml(partial) : ''}</div>` : ''}`;
    }
    html += `<div class="msg assistant live">${refsHtml(L.refs, opts.base)}${inner}
      ${L.error ? `<div class="err">${esc(L.error)}</div>` : ''}</div>`;
  }
  return html;
}

/** Remember when the user collapses or opens the live step list, so re-renders don't undo it. */
export function wireLiveToggle(root, L) {
  const d = root.querySelector('details[data-live]');
  if (d && L) d.addEventListener('toggle', () => { if (L.running) L.closed = !d.open; });
}

/** Fold an assistant text event into the live turn. Returns true if it changed. */
export function addLiveText(L, t) {
  t = t || '';
  if (!t || L.text.endsWith(t)) { if (L.partial) { L.partial = ''; return true; } return false; }
  L.partial = ''; // the full block replaces the streamed partial
  L.text = t.startsWith(L.text) ? t : (L.text ? L.text + '\n\n' + t : t);
  const f = (L.flow ||= []), last = f[f.length - 1]; // narration: the texts in order between the step groups
  if (last?.text != null && t.startsWith(last.text)) last.text = t; else f.push({ text: t });
  return true;
}

/** Fold a step event into the live turn (the flat list + the current step group of the narration flow). */
export function addLiveStep(L, t, parts) {
  L.steps.push(t);
  if (parts?.length) (L.stepParts ||= {})[L.steps.length - 1] = parts;
  const f = (L.flow ||= []);
  let g = f[f.length - 1];
  if (!g?.steps) f.push(g = { steps: [] });
  g.steps.push(t);
  if (parts?.length) (g.parts ||= {})[g.steps.length - 1] = parts;
}

// ---------- undo / rewind (shared by the studio chat and the website chat) ----------

/** The row above the composer: "Undo last change" (+ Redo when possible). Empty when there is no history yet. */
export function undoBarHtml(h, running) {
  if (!h || !h.versions?.length) return '';
  if (h.versions.length < 2 && !h.can_redo) return ''; // designing: no previous version yet (a new design's first run, or only v1)
  const kbd = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘Z' : 'Ctrl+Z';
  return `<button class="ubtn" data-undo ${running || !h.can_undo ? 'disabled' : ''} title="Undo the last change (${kbd} with an empty message box)">${undoSvg}Undo last change</button>
    ${h.can_redo ? `<button class="ubtn" data-redo ${running ? 'disabled' : ''} title="Bring back the last undone change">${redoSvg}Redo</button>` : ''}
    <span class="uver">${h.current_v ? `v${h.current_v}` : 'Original'}</span>`;
}

/**
 * Wire rewind / restore / undo / redo clicks (event delegation; safe to call on every render) and Cmd/Ctrl+Z.
 * h = { noun: 'design' | 'page', busy(): bool, rewind(i), restore(n), undo(), redo() }
 */
export function wireHistory(msgsEl, barEl, panelEl, input, h) {
  msgsEl.onclick = e => {
    const rw = e.target.closest('[data-rewind]');
    if (rw) { e.preventDefault(); if (!h.busy()) confirmRewind(rw.closest('.msg'), +rw.dataset.rewind, h); return; }
    const go = e.target.closest('[data-rw-go]');
    if (go) { e.preventDefault(); closePops(msgsEl); h.rewind(+go.dataset.rwGo); return; }
    if (e.target.closest('[data-rw-cancel]')) { e.preventDefault(); closePops(msgsEl); return; }
    const cp = e.target.closest('[data-copy]');
    if (cp) { e.preventDefault(); copyReply(cp); return; }
    const rs = e.target.closest('[data-restore]');
    if (rs) { e.preventDefault(); if (!h.busy()) h.restore(+rs.dataset.restore); }
  };
  if (barEl) barEl.onclick = e => {
    if (e.target.closest('[data-undo]:not([disabled])')) h.undo();
    else if (e.target.closest('[data-redo]:not([disabled])')) h.redo();
  };
  if (panelEl && !panelEl._undoKeys) {
    panelEl._undoKeys = true;
    panelEl.addEventListener('keydown', e => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 'z') return;
      const t = e.target;
      const typing = t.isContentEditable || ((t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') && t.value !== '');
      if (typing || panelEl._h.busy()) return; // normal text undo while there's a draft
      e.preventDefault();
      if (e.shiftKey) panelEl._h.redo(); else panelEl._h.undo();
    });
  }
  if (panelEl) panelEl._h = h;
}

function copyReply(btn) {
  const body = btn.closest('.msg')?.querySelector('.body');
  if (!body || !navigator.clipboard) return;
  navigator.clipboard.writeText(body.innerText.trim()).then(() => {
    btn.classList.add('done'); setTimeout(() => btn.classList.remove('done'), 1200);
  }, () => {});
}
function closePops(root) { root.querySelectorAll('.rw-pop').forEach(p => p.remove()); }
function confirmRewind(msgEl, i, h) {
  if (matchMedia('(max-width: 640px)').matches && window.__ms?.confirmSheet) { // phonekit: an iOS action sheet (web/msheet.js)
    window.__ms.confirmSheet({ title: 'Rewind to here?', message: `The ${h.noun} goes back to before this message. You can go forward again.`, action: 'Rewind' })
      .then(ok => { if (ok && !h.busy()) h.rewind(i); });
    return;
  }
  const root = msgEl.parentElement;
  const open = msgEl.querySelector('.rw-pop');
  closePops(root);
  if (open) return;
  msgEl.insertAdjacentHTML('beforeend', `<div class="rw-pop" role="dialog" aria-label="Rewind">
    <p>Restore the ${h.noun} to before this message? Later changes stay in history and can be restored.</p>
    <div class="rw-btns"><button class="btn sm" data-rw-cancel>Cancel</button><button class="btn primary sm" data-rw-go="${i}">Rewind</button></div></div>`);
  const pop = msgEl.querySelector('.rw-pop');
  pop.querySelector('[data-rw-go]').focus();
  pop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); pop.remove(); } });
  const pr = pop.getBoundingClientRect(), rr = root.getBoundingClientRect();
  if (pr.bottom > rr.bottom) root.scrollTop += pr.bottom - rr.bottom + 8;
}

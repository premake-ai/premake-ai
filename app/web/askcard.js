// agentbrain: the design agent's question cards and run status rows in the chat.
//   - m.questions (server/agentbrain.js): 1-3 questions with tappable options + Other (free text) + Skip. Desktop: an inline
//     card under the agent's reply. Phone (<= 860 px): a compact card that opens a native-style bottom sheet (opened once
//     on its own). Answers go out as the next user message plus { answers } so the server remembers them for this user.
//   - askmock: a question with "mockup": true has a rough 3D mock-up per option (o.mock, server/askmock.js, it lands a
//     few seconds after the card). Hovering an option (desktop) or tapping it (phone) shows it over the real model through
//     'formery:askmock' (app.js -> viewer.askMock); the picked option's stays up; answering or dismissing clears it.
//     Phone: the sheet opens at half height with the model card left undimmed above it; Send is the second control.
//   - m.status: why a run stopped ("Stopped after 25 min", "Stopped: no progress for 5 min", "Stopped") + Continue.
// chatui.js renders msgExtrasHtml(m, i, chat) under each assistant message; sending goes through app.js's 'formery:send'.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CONTINUE_TEXT = 'Continue where you left off.';
const phone = () => matchMedia('(max-width: 640px)').matches;
const state = new Map(); // card key -> { sel: { qid: Set }, other: { qid: string }, otherOn: { qid: bool } }
const autoOpened = new Set();
let current = null; // { key, questions } of the pending card (the last message, no run live)

const tick = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3.5 8.3 6.6 11.3 12.5 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const playSvg = '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M5 3.5v9l7-4.5z" fill="currentColor"/></svg>';
const stopSvg = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.8v3.6M8 10.8v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

const cubeSvg = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1.8 13.6 5v6L8 14.2 2.4 11V5zM2.4 5 8 8.2 13.6 5M8 8.2v6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';

// ---------------------------------------------------------------- askmock: option mock-ups in the 3D view
let hoverOpt = null; // { key, qid, label } under the mouse (desktop)
let shownMock = null;
const optOf = (qid, label) => current?.questions.find(q => q.id === qid)?.options.find(o => o.label === label) || null;
const hasMocks = qs => (qs || []).some(q => q.mockup);
function setMock(sk) {
  if (sk === shownMock) return;
  shownMock = sk;
  dispatchEvent(new CustomEvent('formery:askmock', { detail: { mock: sk || null } }));
}
/** What the 3D view should show: the hovered option's mock-up, else the last picked option's (pinned), else nothing. */
function syncMock() {
  if (!current) return setMock(null);
  if (hoverOpt && hoverOpt.key === current.key) { const o = optOf(hoverOpt.qid, hoverOpt.label); if (o?.mock) return setMock(o.mock); }
  const s = st(current.key);
  if (s.pin) { const o = optOf(s.pin.qid, s.pin.label); if (o?.mock && s.sel[s.pin.qid]?.has(s.pin.label)) return setMock(o.mock); }
  setMock(null);
}
/** app.js: an `ask_mock` event put a mock-up on an option of message m: redraw the card and show it if it's in focus. */
export function mockLanded(m) {
  if (!current || current.questions !== m?.questions) return;
  refresh(current.key);
  syncMock();
}
const mockIcon = (q, o) => !q.mockup ? '' : `<span class="ab-mk${o.mock ? '' : ' wait'}" title="${o.mock ? 'Hover to preview on the model' : 'Drawing a quick mock-up'}">${cubeSvg}</span>`;

const keyOf = (m, i) => `${Math.round((m.t || 0) * 1000)}:${i}`;
function st(key) { if (!state.has(key)) state.set(key, { sel: {}, other: {}, otherOn: {} }); return state.get(key); }
function answered(key, q) { const s = st(key); return (s.sel[q.id]?.size || 0) > 0 || (s.otherOn[q.id] && (s.other[q.id] || '').trim()); }

/** HTML under an assistant message (i = its index in chat.messages). */
/** One option per row, name over its description: design options with mock-ups, and any options with a description
 *  (squeezed into pills they wrap into tall bubbles). */
const rowsOf = q => !!q.mockup || (q.options || []).some(o => o.detail);

export function msgExtrasHtml(m, i, chat) {
  ensureWired();
  const last = i === chat.messages.length - 1 && !chat.live?.running;
  let html = '';
  if (m.status?.text) {
    const same = String(m.text || '').trim().replace(/\.$/, '') === m.status.text; // the reply is just the status: don't say it twice
    if (!(same && !last)) html += `<div class="ab-status${last ? ' live' : ''}">${same ? '' : `${stopSvg}<span>${esc(m.status.text)}</span>`}${last && m.status.continuable !== false
      ? `<button type="button" class="ab-continue" data-ab-continue>${playSvg}Continue</button>` : ''}</div>`;
  }
  if (Array.isArray(m.questions) && m.questions.length) {
    const key = keyOf(m, i);
    if (!last) { // answered (or skipped): the questions stay, read-only, with the picks from the next user message
      if (current?.key === key) { current = null; hoverOpt = null; setMock(null); }
      html += answeredHtml(m.questions, chat.messages[i + 1]);
    } else {
      current = { key, questions: m.questions };
      html += phone() ? compactHtml(key, m.questions) : cardHtml(key, m.questions);
    }
  } else if (last && current && !chat.messages.some((x, j) => x.questions && keyOf(x, j) === current.key)) { current = null; hoverOpt = null; setMock(null); }
  return html;
}

function optsHtml(key, q) {
  const s = st(key), sel = s.sel[q.id] || new Set();
  return q.options.map(o => `<button type="button" class="ab-opt${sel.has(o.label) ? ' on' : ''}" data-ab-q="${esc(q.id)}" data-ab-o="${esc(o.label)}" aria-pressed="${sel.has(o.label)}">
      ${q.multi ? `<span class="ab-box">${sel.has(o.label) ? tick : ''}</span>` : ''}${rowsOf(q) ? `<span class="ab-ot"><span class="ab-ol">${esc(o.label)}</span>${o.detail ? `<small>${esc(o.detail)}</small>` : ''}</span>` : `<span class="ab-ol">${esc(o.label)}</span>${o.detail ? `<small>${esc(o.detail)}</small>` : ''}`}${mockIcon(q, o)}</button>`).join('')
    + `<button type="button" class="ab-opt ab-other${s.otherOn[q.id] ? ' on' : ''}" data-ab-q="${esc(q.id)}" data-ab-other aria-pressed="${!!s.otherOn[q.id]}"><span class="ab-ol">Other…</span></button>`;
}
function cardHtml(key, qs) {
  const s = st(key), n = qs.filter(q => answered(key, q)).length;
  return `<div class="ab-card" data-ab-key="${esc(key)}" role="group" aria-label="Questions from the designer">
    ${qs.map((q, k) => `<div class="ab-q" data-ab-qid="${esc(q.id)}">
      <p class="ab-qt"><span class="ab-n">${k + 1}</span>${esc(q.question)}${q.multi ? ' <span class="ab-hint">Pick any</span>' : ''}</p>
      <div class="ab-opts${rowsOf(q) ? ' ab-mkq' : ''}">${optsHtml(key, q)}</div>
      <input class="ab-otext" type="text" maxlength="200" placeholder="Type your answer" data-ab-otext="${esc(q.id)}" value="${esc(s.other[q.id] || '')}" ${s.otherOn[q.id] ? '' : 'hidden'}>
    </div>`).join('')}
    <div class="ab-foot"><button type="button" class="ab-skip" data-ab-skip>Skip, use defaults</button>
      <button type="button" class="btn primary sm ab-send" data-ab-send ${n ? '' : 'disabled'}>Send answers</button></div></div>`;
}
/** An answered card: each question with the picked options marked, from send()'s "- <question> <picks>" lines. */
export function answeredHtml(qs, reply) {
  const text = reply?.role === 'user' ? String(reply.text || '') : '';
  const skippedAll = !text || /^Skipped the questions/.test(text);
  const pickOf = q => {
    const line = text.split('\n').find(l => l.startsWith(`- ${q.question} `));
    const a = line ? line.slice(q.question.length + 3).trim() : '';
    return a && a !== '(skipped)' ? a : '';
  };
  return `<div class="ab-card ab-done" role="group" aria-label="Questions from the designer, answered">
    ${qs.map((q, k) => {
      const a = skippedAll ? '' : pickOf(q);
      const hit = o => a && (a === o.label || a.split(', ').includes(o.label));
      const other = a && !q.options.some(hit);
      return `<div class="ab-q"><p class="ab-qt"><span class="ab-n">${k + 1}</span>${esc(q.question)}${a ? '' : ' <span class="ab-hint">Skipped</span>'}</p>
      <div class="ab-opts">${q.options.map(o => `<span class="ab-opt${hit(o) ? ' on' : ''}"><span class="ab-ol">${esc(o.label)}</span></span>`).join('')}${other ? `<span class="ab-opt on"><span class="ab-ol">${esc(a)}</span></span>` : ''}</div></div>`;
    }).join('')}</div>`;
}
function compactHtml(key, qs) {
  const n = qs.filter(q => answered(key, q)).length;
  return `<div class="ab-compact" data-ab-key="${esc(key)}"><div class="ab-ctext"><b>${qs.length} quick question${qs.length === 1 ? '' : 's'}</b><span>${n ? `${n} of ${qs.length} answered` : 'Tap to answer, or skip for defaults'}</span></div>
    <button type="button" class="ab-copen" data-ab-open>Answer</button></div>`;
}

// ---------------------------------------------------------------- phone: bottom sheet
let sheet = null, dim = null;
function sheetHtml(key, qs) {
  const s = st(key), n = qs.filter(q => answered(key, q)).length;
  return `<div class="ab-grab"></div>
    <div class="ab-shead"><button type="button" class="ab-stext" data-ab-skip>Skip</button><b>Quick questions</b><button type="button" class="ab-stext ab-sdone" data-ab-send ${n ? '' : 'disabled'}>Send</button></div>
    <div class="ab-sbody">${qs.map(q => {
      const sel = s.sel[q.id] || new Set();
      return `<div class="ab-sec"><p class="ab-sh">${esc(q.question)}${q.multi ? ' · pick any' : ''}${q.mockup ? ' · tap to preview' : ''}</p><div class="ab-group">
        ${q.options.map(o => `<button type="button" class="ab-row${sel.has(o.label) ? ' on' : ''}" data-ab-q="${esc(q.id)}" data-ab-o="${esc(o.label)}" role="${q.multi ? 'checkbox' : 'radio'}" aria-checked="${sel.has(o.label)}">
          <span class="ab-rl">${esc(o.label)}${o.detail ? `<small>${esc(o.detail)}</small>` : ''}</span>${mockIcon(q, o)}<span class="ab-chk">${sel.has(o.label) ? tick : ''}</span></button>`).join('')}
        <button type="button" class="ab-row${s.otherOn[q.id] ? ' on' : ''}" data-ab-q="${esc(q.id)}" data-ab-other role="${q.multi ? 'checkbox' : 'radio'}" aria-checked="${!!s.otherOn[q.id]}"><span class="ab-rl">Other</span><span class="ab-chk">${s.otherOn[q.id] ? tick : ''}</span></button>
        ${s.otherOn[q.id] ? `<div class="ab-rowin"><input type="text" maxlength="200" placeholder="Type your answer" data-ab-otext="${esc(q.id)}" value="${esc(s.other[q.id] || '')}"></div>` : ''}
      </div></div>`;
    }).join('')}</div>`;
}
function openSheet() {
  if (!current) return;
  if (!sheet) {
    dim = document.createElement('div'); dim.className = 'ab-dim'; dim.hidden = true;
    sheet = document.createElement('div'); sheet.className = 'ab-sheet'; sheet.hidden = true;
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'Quick questions');
    document.body.append(dim, sheet);
    dim.addEventListener('click', closeSheet);
    let y0 = null;
    sheet.addEventListener('touchstart', e => { y0 = e.target.closest('.ab-sbody') && sheet.querySelector('.ab-sbody').scrollTop > 0 ? null : e.touches[0].clientY; }, { passive: true });
    sheet.addEventListener('touchmove', e => { if (y0 != null) { const d = e.touches[0].clientY - y0; if (d > 0) sheet.style.transform = `translateY(${d}px)`; } }, { passive: true });
    sheet.addEventListener('touchend', e => { if (y0 == null) return; const d = e.changedTouches[0].clientY - y0; y0 = null; sheet.style.transform = ''; if (d > 90) closeSheet(); });
  }
  sheet.dataset.abKey = current.key;
  const peek = hasMocks(current.questions); // askmock: half height, the model card stays visible and touchable above
  sheet.classList.toggle('ab-peek', peek); dim.classList.toggle('ab-clear', peek);
  sheet.innerHTML = sheetHtml(current.key, current.questions);
  document.activeElement?.blur?.();
  sheet.hidden = false; dim.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => { sheet.classList.add('on'); dim.classList.add('on'); }));
  syncMock(); // reopened: the picked option's mock-up comes back
}
function closeSheet() {
  if (!sheet || sheet.hidden) return;
  setMock(null); // dismissed: the mock-up goes with it
  sheet.classList.remove('on'); dim.classList.remove('on');
  setTimeout(() => { sheet.hidden = true; dim.hidden = true; }, 360);
}
const sheetOpen = () => !!sheet && !sheet.hidden && sheet.classList.contains('on');

// ---------------------------------------------------------------- answers -> one user message
function send(key, skip) {
  if (!current || current.key !== key) return;
  const s = st(key), answers = {}, lines = [];
  if (!skip) {
    for (const q of current.questions) {
      const picks = [...(s.sel[q.id] || [])];
      if (s.otherOn[q.id] && (s.other[q.id] || '').trim()) picks.push(s.other[q.id].trim());
      if (picks.length) { answers[q.id] = q.multi ? picks : picks[0]; lines.push(`- ${q.question} ${picks.join(', ')}`); }
      else lines.push(`- ${q.question} (skipped)`);
    }
  }
  const text = skip || !Object.keys(answers).length ? 'Skipped the questions: use sensible defaults and say which ones you picked.' : `Answers:\n${lines.join('\n')}`;
  current = null; hoverOpt = null; closeSheet(); setMock(null);
  dispatchEvent(new CustomEvent('formery:send', { detail: { text, answers: skip ? undefined : answers } }));
}

function refresh(key) {
  for (const el of document.querySelectorAll('[data-ab-key]')) {
    if (el.dataset.abKey !== key || !current) continue;
    if (el === sheet) {
      const top = el.querySelector('.ab-sbody')?.scrollTop || 0;
      el.innerHTML = sheetHtml(key, current.questions);
      el.querySelector('.ab-sbody').scrollTop = top;
    } else el.outerHTML = el.classList.contains('ab-compact') ? compactHtml(key, current.questions) : cardHtml(key, current.questions);
  }
}

let wired = false;
function ensureWired() {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  document.addEventListener('click', e => {
    if (e.target.closest('[data-ab-continue]')) { e.preventDefault(); dispatchEvent(new CustomEvent('formery:send', { detail: { text: CONTINUE_TEXT } })); return; }
    const host = e.target.closest('[data-ab-key]');
    if (!host) return;
    const key = host.dataset.abKey;
    if (e.target.closest('[data-ab-open]')) { e.preventDefault(); openSheet(); return; }
    if (e.target.closest('[data-ab-skip]')) { e.preventDefault(); send(key, true); return; }
    const sb = e.target.closest('[data-ab-send]');
    if (sb) { e.preventDefault(); if (!sb.disabled) send(key, false); return; }
    const b = e.target.closest('[data-ab-q]');
    if (!b || !current || current.key !== key) return;
    e.preventDefault();
    const q = current.questions.find(x => x.id === b.dataset.abQ); if (!q) return;
    const s = st(key), sel = (s.sel[q.id] ||= new Set());
    if (b.hasAttribute('data-ab-other')) {
      const on = !s.otherOn[q.id];
      if (!q.multi && on) sel.clear();
      s.otherOn[q.id] = on;
      refresh(key);
      if (on) setTimeout(() => document.querySelector(`[data-ab-key="${CSS.escape(key)}"] [data-ab-otext="${CSS.escape(q.id)}"]`)?.focus(), 30);
      return;
    }
    const o = b.dataset.abO;
    if (q.multi) { if (sel.has(o)) sel.delete(o); else sel.add(o); }
    else { const was = sel.has(o); sel.clear(); if (!was) sel.add(o); s.otherOn[q.id] = false; }
    if (sel.has(o)) s.pin = { qid: q.id, label: o }; // askmock: the picked option's mock-up stays on the model
    refresh(key);
    syncMock();
  });
  // askmock: hover previews (mouse only; on touch a tap selects, which pins the preview)
  document.addEventListener('pointerover', e => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    const b = e.target.closest?.('.ab-card [data-ab-o]'); const host = b?.closest('[data-ab-key]');
    const next = b && host && current?.key === host.dataset.abKey ? { key: host.dataset.abKey, qid: b.dataset.abQ, label: b.dataset.abO } : null;
    if (next?.qid === hoverOpt?.qid && next?.label === hoverOpt?.label) return;
    hoverOpt = next; syncMock();
  });
  document.addEventListener('pointerleave', e => { if (e.target === document.documentElement && hoverOpt) { hoverOpt = null; syncMock(); } }, true);
  document.addEventListener('input', e => {
    const t = e.target.closest?.('[data-ab-otext]'); if (!t) return;
    const host = t.closest('[data-ab-key]'); if (!host) return;
    st(host.dataset.abKey).other[t.dataset.abOtext] = t.value;
    const ok = current && current.questions.some(q => answered(host.dataset.abKey, q));
    document.querySelectorAll(`[data-ab-key="${CSS.escape(host.dataset.abKey)}"] [data-ab-send]`).forEach(b => { b.disabled = !ok; });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.closest?.('[data-ab-otext]')) { e.preventDefault(); const h = e.target.closest('[data-ab-key]'); h?.querySelector('[data-ab-send]:not([disabled])')?.click(); }
    if (e.key === 'Escape' && sheetOpen()) { e.stopPropagation(); closeSheet(); }
  }, true);
  // phone: a new question card opens its sheet once on its own
  new MutationObserver(() => {
    if (!current || !phone() || autoOpened.has(current.key) || sheetOpen()) return;
    if (!document.querySelector(`#msgs .ab-compact[data-ab-key="${CSS.escape(current.key)}"]`)) return;
    autoOpened.add(current.key);
    setTimeout(openSheet, 350);
  }).observe(document.body, { childList: true, subtree: true });
  if (!document.querySelector('link[href="/askcard.css"]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/askcard.css'; document.head.append(l);
  }
}

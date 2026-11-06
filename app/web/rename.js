// agentbrain: rename a design. Desktop: double-click its name in the sidebar (or click the top-bar title where shown) to
// edit it in place (Enter saves, Esc cancels).
// Phone: the right menu's "Rename" row (web/phonestudio.js) calls window.formeryRename(), an iOS-style alert with a text
// field. Saved with PATCH /api/projects/<id> {title}; the owner's title replaces the auto title for good.
const $ = (s, r = document) => r.querySelector(s);
const F = () => window.__forma || {};
const cur = () => F().state?.cur;
const own = () => { const c = cur(); return c && c.kind === 'project' && !c.readOnly && (!c.role || c.role === 'owner') ? c : null; }; // share: renaming is the owner's
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const phone = () => matchMedia('(max-width: 640px)').matches;

async function save(id, title) {
  title = String(title || '').replace(/\s+/g, ' ').trim();
  if (!title) return false;
  const r = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }), cache: 'no-store' });
  if (!r.ok) return false;
  const j = await r.json();
  F().titleChanged?.(id, j.title);
  return true;
}

// ---------------------------------------------------------------- desktop: inline edit (sidebar row title, or #crumb b when shown)
function mark() {
  const b = $('#crumb b');
  if (!b) return;
  const can = !!own() && !phone() && !$('#crumb').textContent.includes('/') && !!$('#studio:not([hidden])');
  b.classList.toggle('rn-able', can);
  if (can) b.title = 'Rename'; else b.removeAttribute('title');
}
function edit(el, id, onDone) {
  const old = el.textContent;
  const input = document.createElement('input');
  input.className = 'rn-input'; input.value = old; input.maxLength = 80; input.setAttribute('aria-label', 'Design name');
  input.style.width = `${Math.max(12, old.length + 2)}ch`;
  el.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const finish = async (keep) => {
    if (done) return; done = true;
    const v = input.value.trim();
    el.textContent = keep && v ? v : old;
    input.replaceWith(el); onDone?.();
    if (keep && v && v !== old && !(await save(id, v))) el.textContent = old;
  };
  input.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });
  input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
  input.addEventListener('input', () => { input.style.width = `${Math.max(12, input.value.length + 2)}ch`; });
  input.addEventListener('blur', () => finish(true));
}
document.addEventListener('click', e => {
  const b = e.target.closest?.('#crumb b.rn-able');
  const c = own();
  if (b && c) { e.preventDefault(); edit(b, c.id, mark); }
});
// sidebar: double-click a design's name (own designs only; the server checks the owner too)
document.addEventListener('dblclick', e => {
  const t = e.target.closest?.('a.proj[data-id] .ptitle');
  const row = t?.closest('a.proj');
  if (!t || phone() || row.querySelector('.rn-input') || row.dataset.owner) return;
  e.preventDefault();
  getSelection()?.removeAllRanges();
  edit(t, row.dataset.id);
});
document.addEventListener('mouseover', e => {
  const t = e.target.closest?.('a.proj[data-id] .ptitle');
  if (t && !t.title) t.title = 'Double-click to rename';
});
const crumb = $('#crumb');
if (crumb) new MutationObserver(mark).observe(crumb, { childList: true, subtree: true });

// ---------------------------------------------------------------- phone: iOS-style alert with a text field
let alertEl = null;
window.formeryRename = () => {
  const c = own(); if (!c) return;
  const old = c.data?.meta?.title || $('#crumb b')?.textContent || '';
  alertEl?.remove();
  alertEl = document.createElement('div');
  alertEl.className = 'rn-dim';
  alertEl.innerHTML = `<div class="rn-alert" role="alertdialog" aria-modal="true" aria-labelledby="rnT">
    <div class="rn-body"><b id="rnT">Rename design</b><input type="text" maxlength="80" value="${esc(old)}" aria-label="Design name" enterkeyhint="done"></div>
    <div class="rn-btns"><button type="button" data-rn="0">Cancel</button><button type="button" data-rn="1"><b>Save</b></button></div></div>`;
  document.body.append(alertEl);
  const input = $('input', alertEl);
  requestAnimationFrame(() => { alertEl.classList.add('on'); input.focus(); input.select(); });
  const close = () => { const el = alertEl; alertEl = null; if (!el) return; el.classList.remove('on'); setTimeout(() => el.remove(), 200); };
  const ok = async () => { const v = input.value.trim(); close(); if (v && v !== old) await save(c.id, v); };
  alertEl.addEventListener('click', e => { const b = e.target.closest('[data-rn]'); if (b) (b.dataset.rn === '1' ? ok : close)(); else if (e.target === alertEl) close(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ok(); } else if (e.key === 'Escape') close(); });
};

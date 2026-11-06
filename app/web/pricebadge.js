// Price provenance badges for quote lines (server/prices): Live · supplier · time, List price · supplier · checked date,
// Estimate (why), Premake. Styles are injected once so no shared stylesheet has to change.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CSS = `
.pb { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 1px 7px; border-radius: 999px; font-size: 10.5px; line-height: 16px;
  font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: 1px; border: 1px solid transparent; text-decoration: none; }
.pb, a.pb, table.parts a.pb { min-height: 0; min-width: 0; }
.pb i { width: 6px; height: 6px; border-radius: 50%; flex: none; background: currentColor; }
.pb.live { color: #166534; background: #ecfdf3; border-color: #bbf7d0; }
.pb.list { color: #1e40af; background: #eff6ff; border-color: #bfdbfe; }
.pb.estimate { color: #92400e; background: #fffbeb; border-color: #fde68a; }
.pb.buildery { color: #4b5563; background: #f3f4f6; border-color: #e5e7eb; }
a.pb:hover { filter: brightness(.97); }
.pb-why { display: block; font-size: 11px; color: var(--muted, #6b7280); margin-top: 2px; white-space: normal; }
.legend .v .pb, .legend .k .pb { margin-left: 6px; }
.pb-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px 0 2px; font-size: 12px; color: var(--muted, #6b7280); }
.ps-pick { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-2, #374151); margin: 8px 0 0; }
.ps-pick select { font: inherit; padding: 3px 6px; border: 1px solid var(--line, #e5e7eb); border-radius: 6px; background: #fff; }
.order-na { padding: 14px; border: 1px solid var(--line, #e5e7eb); border-radius: 10px; background: #fafaf9; }
.order-na b { display: block; font-size: 14px; margin-bottom: 4px; }
.order-na p { margin: 0; font-size: 12.5px; color: var(--text-2, #374151); }
.lead-why { font-size: 12px; color: var(--muted, #6b7280); margin: 8px 0 0; }
`;
let injected = false;
function inject() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const s = document.createElement('style'); s.id = 'pricebadge-css'; s.textContent = CSS; document.head.appendChild(s);
}

function when(at) {
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return '';
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function checkedOn(iso) {
  const d = new Date(String(iso || '') + 'T12:00:00');
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).replace(',', '') : '';
}

/** One badge. withWhy: also print an estimate's reason (or a line's detail) under it. */
export function badge(src, { withWhy = false } = {}) {
  inject();
  if (!src) return '';
  let text, title;
  if (src.kind === 'live') { text = ['Live', src.supplier, when(src.at)].filter(Boolean).join(' · '); title = src.detail || ''; }
  else if (src.kind === 'list') { const c = checkedOn(src.checked); text = ['List price', src.supplier, c && `checked ${c}`].filter(Boolean).join(' · '); title = src.detail || ''; }
  else if (src.kind === 'buildery') { text = 'Premake'; title = src.why || ''; }
  else { text = src.count ? `Estimate · ${src.count.estimate} of ${src.count.estimate + src.count.list + src.count.live}` : 'Estimate'; title = src.why || ''; }
  const tag = src.url ? 'a' : 'span';
  const href = src.url ? ` href="${esc(src.url)}" target="_blank" rel="noopener noreferrer"` : '';
  const html = `<${tag} class="pb ${esc(src.kind)}"${href} title="${esc(title)}"><i></i>${esc(text)}</${tag}>`;
  const why = withWhy ? (src.kind === 'estimate' || src.kind === 'buildery' ? src.why : src.detail) : '';
  return html + (why ? `<span class="pb-why">${esc(why)}</span>` : '');
}

/** Summary badge for a group of lines (sources.parts / sources.fabrication: kind + counts). */
export function groupBadge(sum) {
  inject();
  if (!sum) return '';
  if (sum.kind !== 'estimate' && sum.suppliers?.length === 1) return badge({ kind: sum.kind, supplier: sum.suppliers[0] });
  const c = sum.count || {};
  const parts = [c.live && `${c.live} live`, c.list && `${c.list} list`, c.estimate && `${c.estimate} est.`].filter(Boolean).join(' · ');
  return `<span class="pb ${esc(sum.kind)}" title="${esc(sum.why || '')}"><i></i>${esc(parts || sum.kind)}</span>`;
}

export { inject as injectPriceBadgeCss };

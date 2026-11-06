// "Where to source it": per-part supplier options under the Order tab (studio web/app.js renderOrder and the public
// build page web/buildpage.js). Data: GET /api/sourcing (server/sourcing.js). 202 = Slant 3D quote still running, so poll.
//
//   mountSourcing(el, { project } | { example }, { qty, builderyUnit })
// The host re-renders its pane freely; each call re-draws from the in-memory result, and polling draws into whatever
// element was mounted last.

const QTYS = [1, 10, 100, 500];
const POLL_MS = 4000, POLL_MAX = 40;
const state = new Map(); // srcKey -> { data, err, loading, polls, timer, el, opts, showAll }

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = v => v == null || !Number.isFinite(+v) ? '–' : '$' + (+v < 10 ? (+v).toFixed(2) : (+v).toFixed(+v < 1000 ? 2 : 0));
const safeUrl = u => /^https?:\/\//i.test(u || '') || /^\/(?!\/)/.test(u || '') ? u : '';
function ago(t) {
  if (!t) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
const nearestQty = q => QTYS.reduce((a, b) => (Math.abs(b - q) < Math.abs(a - q) ? b : a), 1);
const TYPE = { printed: 'Printed', fabricated: 'Fabricated', bought: 'Bought' };
const PROC = { sheet: 'Sheet metal', laser: 'Laser cut', extrusion: 'Extrusion' };

function injectCss() {
  if (document.getElementById('srcCss')) return;
  const st = document.createElement('style'); st.id = 'srcCss';
  st.textContent = `
.src-sum{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
.src-sum .box{border:1px solid var(--line);border-radius:8px;padding:9px 10px;background:var(--panel)}
.src-sum .box.diy{border-color:var(--accent);background:var(--accent-soft)}
.src-sum b{display:block;font-size:17px;font-variant-numeric:tabular-nums;letter-spacing: normal}
.src-sum span{font-size:11.5px;color:var(--muted)}
.src-sum p{grid-column:1/-1;margin:0;font-size:11.5px;color:var(--muted)}
.src-card{border:1px solid var(--line);border-radius:8px;background:var(--panel);margin-bottom:8px;overflow:hidden}
.src-hd{display:flex;align-items:baseline;gap:8px;padding:8px 10px 6px}
.src-hd b{font-size:12.5px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.src-hd .t{font-size:11px;color:var(--muted);white-space:nowrap}
.src-hd .dl{margin-left:auto;display:flex;gap:4px;flex:none}
.src-hd .dl a{font-size:11px;color:var(--link);border:1px solid var(--line);border-radius:4px;padding:0 5px;line-height:18px}
.src-hd .dl a:hover{border-color:var(--line-3)}
.src-sub{padding:0 10px 6px;font-size:11px;color:var(--muted);margin-top:-3px}
.src-row{display:grid;grid-template-columns:1fr auto;column-gap:8px;padding:6px 10px;border-top:1px solid var(--line);color:inherit}
a.src-row:hover{background:var(--panel-2)}
.src-row .n{font-size:12px;font-weight:500;color:var(--text)}
.src-row .p{font-size:12.5px;font-weight:600;text-align:right;font-variant-numeric:tabular-nums}
.src-row .p small{font-weight:400;color:var(--muted);font-size:11px}
.src-row .m{font-size:11px;color:var(--muted);min-width:0}
.src-row .r{display:flex;gap:6px;align-items:center;justify-content:flex-end;white-space:nowrap}
.src-row .go{font-size:11px;color:var(--link)}
.src-bd{font-size:10.5px;line-height:16px;padding:0 6px;border-radius:999px;border:1px solid var(--line-2);color:var(--muted);background:var(--panel-2)}
.src-bd.live{color:var(--ok);border-color:rgba(21,128,61,.35);background:rgba(21,128,61,.07)}
.src-bd.pend{color:var(--warn);border-color:rgba(161,98,7,.3);background:rgba(161,98,7,.06)}
.src-chips{display:flex;flex-wrap:wrap;gap:5px;padding:7px 10px 8px;border-top:1px solid var(--line)}
.src-chips a{font-size:11.5px;border:1px solid var(--line-2);border-radius:999px;padding:1px 8px;color:var(--text-2);background:var(--panel)}
.src-chips a:hover{border-color:var(--line-3);color:var(--text)}
.src-fb{margin:0;padding:6px 10px 8px 24px;border-top:1px dashed var(--line);font-size:11px;color:var(--text-2)}
.src-fb li{margin:1px 0}.src-fb li.problem{color:var(--danger)}
.src-more{width:100%;font-size:12px;color:var(--link);padding:6px 0}
.src-foot{font-size:11px;color:var(--muted);margin:6px 0 0}
.src-spin{display:inline-block;width:9px;height:9px;border:1.5px solid currentColor;border-right-color:transparent;border-radius:50%;animation:srcspin .8s linear infinite;vertical-align:-1px}
@keyframes srcspin{to{transform:rotate(360deg)}}`;
  document.head.appendChild(st);
}

export function mountSourcing(el, src, opts = {}) {
  if (!el || !src || !(src.project || src.example)) return;
  injectCss();
  const key = src.project ? 'project=' + encodeURIComponent(src.project) : 'example=' + encodeURIComponent(src.example);
  let s = state.get(key);
  if (!s) { s = { polls: 0 }; state.set(key, s); }
  s.el = el; s.opts = opts; s.key = key;
  draw(s);
  // first view, or a quiet refresh after 30 s (the design may have been rebuilt; the server answers from its cache)
  if (!s.loading && !s.timer && (!s.data && !s.err || Date.now() - (s.at || 0) > 30e3)) load(s);
}

/** The /api/sourcing result for a design without drawing anything (the Order tab's delivery timeline uses it for part
 * links). Returns what is in memory now (or null) and starts a load or quiet refresh when needed; onChange runs whenever
 * a load (or a 202 poll) finishes. One listener per design: the latest call wins. */
export function sourcingData(src, onChange) {
  if (!src || !(src.project || src.example)) return null;
  const key = src.project ? 'project=' + encodeURIComponent(src.project) : 'example=' + encodeURIComponent(src.example);
  let s = state.get(key);
  if (!s) { s = { polls: 0, key }; state.set(key, s); }
  s.key = key; s.onChange = onChange || null;
  if (!s.loading && !s.timer && !s.hidden && (!s.data && !s.err || Date.now() - (s.at || 0) > 30e3)) load(s);
  return s.hidden ? null : s.data || null;
}

/** The same data for a second reader (the studio's Buy the parts cards) without taking over the Order tab's listener:
 *  what is loaded now (or null), starting a load when there is none; onPeek runs after each load. */
export function sourcingPeek(src, onPeek) {
  if (!src || !(src.project || src.example)) return null;
  const key = src.project ? 'project=' + encodeURIComponent(src.project) : 'example=' + encodeURIComponent(src.example);
  let s = state.get(key);
  if (!s) { s = { polls: 0, key }; state.set(key, s); }
  s.onPeek = onPeek || null;
  if (!s.loading && !s.timer && !s.hidden && !s.data && !s.err) load(s);
  return s.hidden ? null : s.data || null;
}

async function load(s) {
  s.loading = true; clearTimeout(s.timer); s.timer = null;
  try {
    const r = await fetch(`/api/sourcing?${s.key}`, { cache: 'no-store' });
    const j = await r.json().catch(() => null);
    // not available here (404, or a signed-out page behind the gateway that answers with HTML): hide the section
    if (r.status === 404 || r.status === 401 || !j) { s.data = null; s.err = null; s.hidden = true; return; }
    if (!r.ok || !j) throw new Error(j?.error || `Request failed (${r.status})`);
    s.data = j; s.err = null; s.at = Date.now();
    if (r.status !== 202) s.polls = 0;
    if (r.status === 202 && s.polls++ < POLL_MAX) s.timer = setTimeout(() => load(s), POLL_MS);
  } catch (e) { s.err = e; }
  finally { s.loading = false; draw(s); try { s.onChange?.(s.data); } catch (e) { console.warn(e); } try { s.onPeek?.(s.data); } catch (e) { console.warn(e); } }
}

function draw(s) {
  const el = s.el;
  if (!el || !el.isConnected) return;
  if (s.hidden) { el.innerHTML = ''; return; }
  const qty = nearestQty(Number(s.opts?.qty) || 1);
  const head = `<h3>Where to source it <span class="muted">per unit at ${qty === 1 ? '1 unit' : qty + ' units'}</span></h3>`;
  if (s.err && !s.data) {
    el.innerHTML = `<section class="src">${head}<p class="muted">Couldn’t load suppliers: ${esc(s.err.message)} <button class="ln-linkbtn src-retry" style="color:var(--link)">Retry</button></p></section>`;
    el.querySelector('.src-retry').onclick = () => { s.err = null; load(s); };
    return;
  }
  if (!s.data) { el.innerHTML = `<section class="src">${head}<div class="skel" style="height:64px;margin-bottom:8px"></div><div class="skel" style="height:120px"></div></section>`; return; }
  const d = s.data, lines = d.lines || [];
  if (!lines.length) { el.innerHTML = ''; return; }
  const sum = d.diy?.[qty] || {};
  const bUnit = s.opts?.builderyUnit ?? sum.buildery_unit_usd;
  const quoting = d.status === 'quoting';
  const LIMIT = 8;
  const shown = s.showAll ? lines : lines.slice(0, LIMIT);
  el.innerHTML = `<section class="src">${head}
    <div class="src-sum">
      <div class="box diy"><b>${quoting ? '<span class="src-spin"></span> ' : ''}about ${money(sum.unit_usd)}</b><span>Make it yourself from these suppliers</span></div>
      <div class="box"><b>${money(bUnit)}</b><span>${esc(s.opts?.builderyLabel || 'Premake, made for you')}</span></div>
      <p>${[sum.live_usd ? `${money(sum.live_usd)} live from Slant 3D${sum.setup_per_unit_usd ? ` (incl. ${money(sum.setup_per_unit_usd)} setup)` : ''}` : '',
        sum.estimate_usd ? `${money(sum.estimate_usd)} estimated` : '', 'before shipping, tools and your time',
        sum.unpriced ? `${sum.unpriced} part${sum.unpriced > 1 ? 's' : ''} unpriced` : ''].filter(Boolean).join(' · ')}${quoting ? ' · getting a live Slant 3D quote…' : ''}</p>
    </div>
    ${shown.map(l => card(l, qty)).join('')}
    ${lines.length > LIMIT ? `<button class="src-more">${s.showAll ? 'Show fewer' : `Show all ${lines.length} parts`}</button>` : ''}
    <p class="src-foot">Live prices come from the supplier’s own quote API. Everything marked Estimate is our model, so check on the supplier’s site before buying.${d.slant?.error ? ` Slant 3D: ${esc(d.slant.error)}.` : ''}</p>
  </section>`;
  const more = el.querySelector('.src-more');
  if (more) more.onclick = () => { s.showAll = !s.showAll; draw(s); };
}

function badge(o) {
  if (o.kind === 'live') return `<span class="src-bd live" title="Live quote from ${esc(o.source)}">Live · ${esc(o.source)} · ${esc(ago(o.fetched_at))}</span>`;
  if (o.kind === 'listed') return `<span class="src-bd live" title="Price checked on ${esc(o.source)}">${esc(o.source)} · ${esc(ago(o.fetched_at))}</span>`;
  if (o.kind === 'pending') return '<span class="src-bd pend"><span class="src-spin"></span> Quoting…</span>';
  if (o.kind === 'estimate') return '<span class="src-bd">Estimate</span>';
  return '';
}

function row(o, qty) {
  const url = safeUrl(o.url);
  const price = o.prices?.[qty];
  const lead = o.lead?.[qty];
  const setup = o.setup?.[qty];
  const meta = [lead, setup ? `+${money(setup)} setup per order` : '', o.upload ? `Upload ${o.upload}` : '', o.note].filter(Boolean).join(' · ');
  const right = price != null ? `${money(price)}` : o.kind === 'pending' ? '' : '<small>Instant quote</small>';
  const tag = url ? `a href="${esc(url)}" target="_blank" rel="noopener noreferrer"` : 'div';
  return `<${tag} class="src-row">
    <span class="n">${esc(o.service)}</span><span class="p">${right}</span>
    <span class="m">${esc(meta)}</span><span class="r">${badge(o)}${url ? '<span class="go">Open ↗</span>' : ''}</span>
  </${url ? 'a' : 'div'}>`;
}

function card(l, qty) {
  const typ = l.type === 'fabricated' ? (PROC[l.process] || TYPE.fabricated) : TYPE[l.type] || '';
  const n = l.qty_per_unit > 1 ? ` × ${l.qty_per_unit}` : '';
  const dl = (l.downloads || []).filter(x => safeUrl(x.href)).map(x => `<a href="${esc(x.href)}" download title="Download ${esc(x.label)} to upload">${esc(x.label)} ↓</a>`).join('');
  const rows = [], chips = [];
  for (const o of l.options || []) {
    if (l.type === 'bought' && o.kind === 'link' && !o.upload) chips.push(o); else rows.push(o);
  }
  const est = l.estimate ? `<div class="src-row"><span class="n">Parts list</span><span class="p">${money(l.estimate.unit_usd)} <small>each</small></span>
    <span class="m">${esc(l.supplier ? `Usually from ${l.supplier}` : 'Typical price')}</span><span class="r"><span class="src-bd">Estimate</span></span></div>` : '';
  const fb = (l.feedback || []).map(f => `<li class="${f.severity === 'problem' ? 'problem' : ''}" title="${esc([f.message, f.suggestion].filter(Boolean).join(' '))}">${esc(fbText(f))}</li>`).join('');
  const sub = l.type === 'bought' ? (l.detail && l.detail.length < 90 ? l.detail : '') : l.detail;
  return `<div class="src-card">
    <div class="src-hd"><b title="${esc(l.name)}">${esc(l.name)}${n}</b><span class="t">${esc(typ)}</span>${dl ? `<span class="dl">${dl}</span>` : ''}</div>
    ${sub ? `<div class="src-sub">${esc(sub)}</div>` : ''}
    ${est}${rows.map(o => row(o, qty)).join('')}
    ${chips.length ? `<div class="src-chips">${chips.map(o => safeUrl(o.url) ? `<a href="${esc(o.url)}" target="_blank" rel="noopener noreferrer" title="${esc(o.note || 'Search ' + o.service)}">${esc(o.service)} ↗</a>` : '').join('')}</div>` : ''}
    ${fb ? `<ul class="src-fb">${fb}</ul>` : ''}
  </div>`;
}

/** Slant print feedback, shortened for the panel: "Needs support: 3169 mm²", "Add a 1 mm bottom chamfer". */
function fbText(f) {
  const m = String(f.message || ''), t = String(f.title || '');
  const area = /About\s+([\d,.]+)\s*mm²/i.exec(m);
  if (/support/i.test(t) && area) return `Needs support: ${area[1]} mm²`;
  if (/chamfer/i.test(t)) return `Add a ${/(\d+(?:\.\d+)?)\s*mm/.exec(t)?.[1] || 1} mm bottom chamfer`;
  const sup = /about\s+(\d+)%\s+of the part/i.exec(m);
  if (/excessive support/i.test(t) && sup) return `Heavy support: about ${sup[1]}% of the part's volume`;
  const thin = /about\s+([\d.]+)\s*mm\)/i.exec(m);
  if (/spidery|thin/i.test(t) && thin) return `Thin overall (${thin[1]} mm average), may flex or warp`;
  if (/flat/i.test(t) && /tip over/i.test(m)) return 'May tip over on the bed: weight sits outside its footprint';
  const flat = /Only\s+([\d,.]+)\s*mm²/i.exec(m);
  if (/flat/i.test(t) && flat) return `Small footprint on the bed: ${flat[1]} mm²`;
  const short = m.length > 100 ? m.slice(0, 97) + '…' : m;
  return short ? `${t}: ${short}` : t;
}

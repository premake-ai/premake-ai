// Make (the right panel's "Make" tab, data-rtab="launch", and /designs/<x>/launch): plain download rows for the design.
// Files come from server/makefiles.js (/api/make/<id>/...): every part zipped (STL + STEP + bom.json + CSV), the printed
// parts for a slicer, each part on its own, the shopping list, and a link to the Order tab to get it made.
import { track } from './analytics.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + Number(n).toFixed(2);
const PROC = { print: '3D printed', sheet: 'Sheet metal', laser: 'Laser cut', tube: 'Tube', cnc: 'CNC machined', fab: 'Fabricated', extrusion: 'Extrusion', rod: 'Rod', wood: 'Wood' };
const proc = p => PROC[p] || (p ? p[0].toUpperCase() + p.slice(1).replace(/[_-]+/g, ' ') : 'Part');
const size = b => (Array.isArray(b) && b.length === 3 ? b.map(x => Math.round(x)).join(' × ') + ' mm' : '');
const svg = (d, w = 16) => `<svg viewBox="0 0 16 16" width="${w}" height="${w}" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const I = {
  all: svg('M2.5 5 8 2.5 13.5 5v6L8 13.5 2.5 11zM2.5 5 8 7.5 13.5 5M8 7.5v6'),
  print: svg('M4.5 6V2.5h7V6M3 6h10v5H3zM5 11v2.5h6V11'),
  bambu: svg('M3 3h10v10H3zM6 6h4v4H6z'),
  part: svg('M3 4.5h10v7H3zM6 4.5v7'),
  cart: svg('M1.8 3h2l1.4 7h7.3l1.2-5H4.6M6.5 13h.01M11.5 13h.01'),
  made: svg('M2.5 13.5V7l3.5 2V7l3.5 2V4.5h4v9zM2.5 13.5h11'),
  dl: svg('M8 2.5v8M4.8 7.5 8 10.7l3.2-3.2M3 13.5h10'),
  chev: svg('M6 3.5 10.5 8 6 12.5', 14),
};

const M = { id: null, el: null, ctx: null, data: null, err: null, loading: false };

function ensureCss() {
  if (document.getElementById('makeCss')) return;
  const l = document.createElement('link'); l.id = 'makeCss'; l.rel = 'stylesheet'; l.href = '/make.css';
  document.head.append(l);
}

export function renderMake(el, ctx) {
  ensureCss();
  M.el = el; M.ctx = ctx;
  const id = ctx.src?.project || ctx.src?.example || null;
  if (!id) { M.id = null; el.innerHTML = `<div class="mt"><p class="mt-note">Open a design to download its parts.</p></div>`; return; }
  if (M.id !== id) { Object.assign(M, { id, data: null, err: null, loading: false }); load(); }
  else if (!M.data && !M.err && !M.loading) load(); // a load that never landed: ask again
  draw();
}

async function load() {
  const id = M.id;
  M.loading = true;
  try {
    const r = await fetch(`/api/make/${encodeURIComponent(id)}`, { cache: 'no-store' });
    const d = await r.json().catch(() => null);
    if (!r.ok) throw new Error(d?.error || `Couldn’t load the files (${r.status})`);
    if (M.id === id) { M.data = d; M.err = null; }
  } catch (e) { if (M.id === id) M.err = e; }
  M.loading = false;
  if (M.id === id) draw();
}

const href = f => `/api/make/${encodeURIComponent(M.id)}/${f}`;
function row({ icon, title, sub, action = '', cls = '', tag = 'div', attrs = '' }) {
  return `<${tag} class="mt-row ${cls}" ${attrs}><span class="mt-ic">${icon}</span><span class="mt-tx"><span class="mt-t">${esc(title)}</span>${sub ? `<span class="mt-s">${esc(sub)}</span>` : ''}</span>${action}</${tag}>`;
}
const dlBtn = (f, label = 'Download', primary = false) => `<a class="mt-act${primary ? ' primary' : ''}" href="${href(f)}" download data-mt-dl="${esc(f)}">${esc(label)}</a>`;
const off = why => `<span class="mt-why">${esc(why)}</span>`;

function draw() {
  const el = M.el; if (!el) return;
  const top = $('.mt', el)?.scrollTop || 0;
  if (M.err && !M.data) {
    el.innerHTML = `<div class="mt"><p class="mt-note">${esc(M.err.message)}</p><button class="mt-retry" type="button" id="mtRetry">Try again</button></div>`;
    $('#mtRetry', el).onclick = () => { M.err = null; draw(); load(); };
    return;
  }
  if (!M.data) { el.innerHTML = `<div class="mt"><div class="mt-loading"><div class="big-spin"></div></div></div>`; return; }
  const d = M.data, parts = d.parts || [], bought = d.bought || [];
  const built = parts.length > 0;
  const nStl = parts.filter(p => p.stl).length, nStep = parts.filter(p => p.step).length;
  const allSub = built ? `${parts.length} part${parts.length === 1 ? '' : 's'} as STL${nStep ? `, ${nStep} as STEP` : ''}, plus the parts list` : 'Build the model first';
  const pr = d.print || {};
  const printSub = pr.threemf ? '3MF file, ready for your slicer' : pr.count ? `${pr.count} STL file${pr.count === 1 ? '' : 's'}, zipped` : built ? 'No 3D printed parts in this design' : 'Build the model first';
  const total = bought.reduce((s, p) => s + (p.unit_usd || 0) * (p.qty || 0), 0);

  el.innerHTML = `<div class="mt">
    <h2 class="mt-h">Make ${esc(d.title)}</h2>
    <p class="mt-lede">Download the files and build it yourself, or have it made.</p>

    <div class="mt-group">
      ${row({ icon: I.all, title: 'Download all parts', sub: allSub, action: built ? dlBtn('all.zip', 'Download', true) : '', cls: built ? '' : 'is-off' })}
      ${row({ icon: I.print, title: 'Download for 3D printing', sub: printSub, action: pr.threemf || pr.count ? dlBtn('print.zip') : '', cls: pr.threemf || pr.count ? '' : 'is-off' })}
      ${row({ icon: I.bambu, title: 'Open in Bambu Studio', sub: M.bambu || (pr.count ? 'Every printed part laid flat on 256 mm plates' : built ? 'No 3D printed parts in this design' : 'Build the model first'),
        action: pr.count ? `<span class="mt-acts"><button class="mt-act" type="button" data-mt-bambu>${M.bambuBusy ? 'Opening…' : 'Open'}</button>${dlBtn('bambu.3mf', '3MF')}</span>` : '', cls: pr.count ? '' : 'is-off' })}
    </div>

    <div class="mt-group">
      ${row({ icon: I.made, title: 'Get it made', sub: 'Shops, prices and links for every part', action: `<span class="mt-chev">${I.chev}</span>`, tag: 'button', attrs: 'type="button" data-mt-order' })}
    </div>

    <h3 class="mt-gh">Parts</h3>
    <div class="mt-group">
      ${built ? parts.map(p => row({ icon: I.part, title: p.name, sub: [proc(p.process), size(p.bbox)].filter(Boolean).join(' · '),
        action: `<span class="mt-acts">${p.stl ? dlBtn(`part/${encodeURIComponent(p.file)}.stl`, 'STL') : ''}${p.step ? dlBtn(`part/${encodeURIComponent(p.file)}.step`, 'STEP') : ''}</span>` })).join('')
        : row({ icon: I.part, title: 'No parts yet', sub: 'Build the model first', cls: 'is-off' })}
    </div>

    <h3 class="mt-gh">Shopping list</h3>
    <div class="mt-group">
      ${bought.length ? bought.map(p => row({ icon: I.cart, title: `${p.qty > 1 ? p.qty + ' × ' : ''}${p.name}`,
        sub: [p.unit_usd != null ? `${money(p.unit_usd)} each` : '', p.supplier].filter(Boolean).join(' · '),
        action: p.url ? `<a class="mt-act" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Buy</a>` : '' })).join('')
        + row({ icon: I.dl, title: 'Download CSV', sub: total ? `About ${money(total)} in parts` : '', action: dlBtn('shopping-list.csv', 'CSV') })
        : row({ icon: I.cart, title: 'Nothing to buy', sub: built ? 'Every part is made' : 'Build the model first', cls: 'is-off' })}
    </div>
  </div>`;
  $('.mt', el).scrollTop = top;
  el.querySelectorAll('[data-mt-dl]').forEach(a => a.addEventListener('click', () => track('make_download', { file: a.dataset.mtDl.split('/')[0], design: M.id })));
  const bb = $('[data-mt-bambu]', el); // bambu: make the project file and open it in Bambu Studio on this computer
  if (bb) bb.onclick = async () => {
    if (M.bambuBusy) return;
    const id = M.id; M.bambuBusy = true; M.bambu = null; draw();
    track('make_bambu', { design: id });
    try {
      const r = await fetch(`/api/make/${encodeURIComponent(id)}/open-bambu`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Couldn’t make the file (${r.status})`);
      const n = `${d.parts} part${d.parts === 1 ? '' : 's'} on ${d.plates} plate${d.plates === 1 ? '' : 's'}`;
      M.bambu = d.opened ? `Opened in Bambu Studio: ${n}. Slice, then print.${d.too_big?.length ? ` Too big for the bed: ${d.too_big.join(', ')}.` : ''}` : `${d.why} (${n})`;
    } catch (e) { M.bambu = e.message; }
    M.bambuBusy = false; if (M.id === id) draw();
  };
  const o = $('[data-mt-order]', el);
  if (o) o.onclick = () => {
    track('make_get_it_made', { design: M.id });
    const t = document.querySelector('.tabbar [data-rtab="order"]');
    if (t && document.getElementById('launchPane')?.contains(el)) t.click();
    else location.href = location.pathname.replace(/\/launch\/?$/, '') || '/';
  };
}

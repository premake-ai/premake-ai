import { api, MOCK, captureRef, ACCESS, SHOWCASE_MSG } from './api.js';
import { renderLaunch, renderGuidePreview } from './launch.js';
import { highlightPython } from './highlight.js';
import { renderSite } from './site.js';
import { renderAds, adsChanged, designPicker } from './ads.js';
import { renderStore, siteChanged, heroReady } from './store.js';
import { threadHtml, textHtml, addLiveText, addLiveStep, undoBarHtml, wireHistory, wireLiveToggle, liveStepLabel } from './chatui.js';
import { thinkingLine, versionNote, partLabel } from './livecaption.js'; // livecaption: reasoning line, version notes, reveal names
import { renderMarket } from './market.js';
import { CHECKOUT, openCheckout, startCheckout, renderOrders, ordersLinkVisible } from './checkout.js'; // payments:
import { partThumb } from './partthumbs.js'; // order tab: a small render of each part next to its line
import { renderOrderView } from './ordertab.js'; // order tab: calendar, kit contents, delivery timeline (uses web/sourcing.js)
import { renderGuide, guideQuietLinkHtml } from './guide.js'; // guide:
import { attachImages, defaultImageText } from './attach.js'; // images:
import { installGuest, resumeDraft, signInModal } from './guest.js'; // guest: signed-out studio + prompt carry-over
import { statsHtml, statsText } from './stats.js'; // card-stats: "Designed in 8 min · $6.34 each"
import { socialHtml, mountTicker } from './social.js'; // social: likes / remixes / comments on cards, recent orders strip
import { supportBubble } from './support.js'; // call: floating "Call Josh" bubble in the Chat panel (web/support.js, web/call.js)
import { partContext, splitParts } from './askpart.js'; // chattools: "Ask about this part" chips in the design chat
import { toast as msToast } from './msheet.js'; // phonekit: the phone's shared sheets, action sheets and toasts
import { loadingCards } from './mloading.js'; // phonekit: a design's model loading on a phone (prompt + thumbnail cards)
import { go, current, legacyToPath, designPath, projectPath, canonicalize, setTitleLookup, setGuest, installNav } from './nav.js'; // urls: clean URLs (History API)
import { track } from './analytics.js'; // analytics: PostHog events (never blocks)
import { refCreditHtml } from './refmatch.js'; // refmodels: model credit under bought parts shown with a reference model
import { renderAppPane, reloadAppPreview, FIRST_PROMPT } from './appview.js'; // apps: the App tab (companion app preview + app agent chat)
import { mockLanded } from './askcard.js'; // askmock: a question-card option's mock-up landed
import { treeGroups, typeOf, loadPref as loadPartsBy, savePref as savePartsBy } from './sections.js'; // sections: Parts by machine section
import './effortpick.js'; // agentbrain: design agent effort picker (composer / phone + menu)
import './rename.js'; // agentbrain: rename a design (click the title; phone: menu > Rename)
setGuest(!MOCK && !!ACCESS.showcase && !!ACCESS.signin); // urls: nav.js has no imports (Safari async-module order)

// ---------- helpers ----------
const GUEST = !MOCK && !!ACCESS.showcase && !!ACCESS.signin; // guest: signed out through the gateway (web/guest.js)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = n => (n == null || isNaN(n)) ? '–' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = n => '$' + Math.round(n).toLocaleString('en-US');
const isNarrow = () => matchMedia('(max-width: 640px)').matches;
function ago(t) {
  if (!t) return '';
  const ms = typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : Date.parse(t);
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
let toastTimer;
function toast(msg, link) {
  // phonekit: phones show the shared toast pill (web/msheet.js); link.run makes its action a button ("Go forward")
  if (isNarrow()) { msToast(msg, link ? { action: link } : {}); return; }
  if (link?.run) link = null; // desktop: an in-app action has no href
  const t = $('#toast');
  t.innerHTML = `<span class="dot"></span>${esc(msg)}${link ? `<a href="${esc(link.href)}">${esc(link.label)}</a>` : ''}`;
  t.classList.add('show'); t.classList.toggle('has-link', !!link);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show', 'has-link'), link ? 6000 : 2200);
  if (link) $('a', t).onclick = () => t.classList.remove('show', 'has-link');
}
// Security A7: signing out is a POST. Any "Sign out" link (desktop menu, phone menu) submits a same-site form instead.
document.addEventListener('click', e => {
  const a = e.target.closest?.('a[href="/auth/logout"], a[href="/logout"]');
  if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  const f = document.createElement('form'); f.method = 'post'; f.action = a.getAttribute('href'); f.hidden = true;
  document.body.appendChild(f); f.submit();
}, true);
function setConn(state, label) {
  const c = $('#conn'); c.className = 'conn ' + state;
  // Signed in: avatar initial + email + Sign out (the gateway's /auth/logout). Otherwise a plain status.
  if (!label && !MOCK && state === 'ok' && ACCESS.user) {
    c.classList.add('user'); c.title = `Signed in as ${ACCESS.user}`;
    // Just the initial; click it for a small menu (email, admin, examples, sign out).
    c.innerHTML = `<details class="acct"><summary class="avatar" aria-label="Account">${esc(ACCESS.user[0].toUpperCase())}<span class="badge" id="inboxBadge" hidden></span></summary>
      <div class="acct-menu"><div class="acct-email">${esc(ACCESS.user)}</div>
      ${ACCESS.admin ? '<a href="/admin">Admin</a>' : ''}<a href="/examples">Examples</a>
      ${ACCESS.logout ? `<a href="${esc(ACCESS.logout)}">Sign out</a>` : ''}</div></details>`;
    if (!setConn.bound) { setConn.bound = true; document.addEventListener('click', e => { const d = $('#conn .acct'); if (d?.open && !d.contains(e.target)) d.open = false; }); }
    return;
  }
  if (GUEST && state !== 'err') { c.classList.add('guest'); c.title = ''; c.innerHTML = '<button type="button" class="btn sm guest-signin">Sign in</button>'; return; } // guest:
  c.innerHTML = '<span class="dot"></span><span class="conn-label"></span>';
  const okLabel = ACCESS.showcase ? 'Sign in' : 'Online';
  $('.conn-label', c).textContent = label || (MOCK ? 'Mock data' : state === 'ok' ? okLabel : state === 'err' ? 'Offline' : 'Connecting');
}
function errBox(err, retry) {
  const offline = !err.status;
  return `<div class="errbox"><div><b>${offline ? 'Can’t reach Premake' : err.status === 401 || err.status === 403 ? 'Sign in needed' : err.status === 503 ? 'Temporarily unavailable' : err.status === 429 ? 'Slow down' : 'Something went wrong'}</b>${esc(err.message)}
    ${offline ? '<div style="margin-top:6px">Check your connection, then retry.</div>' : ''}</div>
    ${retry ? '<button class="btn sm" data-retry>Retry</button>' : ''}</div>`;
}
function wireRetry(el, fn) { const b = $('[data-retry]', el); if (b) b.onclick = fn; }

const PROJECT_STARTERS = [
  'A minimalist pen holder for a desk, three compartments',
  'A battery-powered night light housing with a push button',
  'A cable organizer that clips to the edge of a desk',
];

const EDIT_STARTERS = [
  'Make it 20% bigger overall',
  'Add two screw holes so it can mount on a wall',
  'Cut the print time down, even if it looks simpler',
];

// ---------- state ----------
const S = {
  route: null,
  cur: null,          // { kind, id, data, base, readOnly }
  chat: { messages: [], live: null, steps: {} },  // === RUNS.get(id).chat for projects
  quote: null, quoteErr: null, mode: 'assembled', tierIdx: 1,
  rtab: 'chat', ctab: 'model', wantCtab: null,
  lprev: 'guide',     // Launch tab open: the center previews the 'guide' page or the 'site'
  examples: null, examplesErr: null,
  projects: null,
  galTag: null, galQuery: '',
  design: null,       // design carried across Studio | Ads | Website: { project } or { example }
  viewer: null, viewerErr: null,
  render: false, selPart: null, look: null, hero: null, heroStale: true,
};

// ---------- router ----------
function srcOf(m) {
  if (m[0] === 'p' && m[1]) return { project: decodeURIComponent(m[1]) };
  if (m[0] === 'examples' && m[1]) return { example: decodeURIComponent(m[1]) };
  return null;
}
function designTitle(d) {
  if (!d) return '';
  if (d.project) return (S.projects || []).find(p => p.id === d.project)?.title || (S.cur?.id === d.project && S.cur.data?.meta?.title) || 'Untitled design';
  return (S.examples || []).find(e => e.slug === d.example)?.title || d.example;
}
function pageCtx(src) {
  const fromStore = !!(src && S.storeBack && S.storeBack === JSON.stringify(src));
  const mine = () => !!(src && S.cur?.data && S.cur.id === (src.project || src.example));
  return { api, src, projects: S.projects, examples: S.examples, toast, title: designTitle(src), fromStore,
    // Website hero fallback: a live render snapshot of this design in the user's colour (after ads hero / thumb.png)
    hero: () => (mine() ? S.hero : null),
    wantHero: () => { if (src && S.cur?.id === (src.project || src.example)) { S.heroWanted = true; makeHero(true); } },
    onRemixed: id => { loadProjects(); go(designPath({ project: id }, 'site')); } };
}

function parse() {
  const h = current() || '/'; // urls: the clean path, read in the old #/ route shape (web/nav.js)
  const [p, query = ''] = h.split('?');
  const m = p.split('/').filter(Boolean);
  if (m[0] === 'store') return { name: 'market', params: new URLSearchParams(query) };
  if (m[0] === 'p' && m[1]) return { name: 'project', id: decodeURIComponent(m[1]) };
  if (m[0] === 'examples' && m[1]) return { name: 'example', id: decodeURIComponent(m[1]) };
  if (m[0] === 'examples') return { name: 'gallery' };
  if (m[0] === 'forma') return { name: 'forma' };
  if (m[0] === 'support') return { name: 'support', id: m[1] ? decodeURIComponent(m[1]) : null };
  if (m[0] === 'stats') return { name: 'stats' }; // admin: run timings
  // Website and Ads are tabs of the design workspace; their routes stay so old links keep working.
  if (m[0] === 'ads' || m[0] === 'site' || m[0] === 'app' || m[0] === 'assemble') { // apps: /designs/<x>/app; assemble: /designs/<x>/assemble
    const tab = m[0] === 'ads' ? 'ads' : m[0] === 'app' ? 'app' : m[0] === 'assemble' ? 'assemble' : 'site', src = srcOf(m.slice(1));
    if (!src) return tab === 'app' || tab === 'assemble' ? { name: 'home' } : { name: 'pick', tab };
    return src.project ? { name: 'project', id: src.project, tab } : { name: 'example', id: src.example, tab };
  }
  if (m[0] === 'launch') return { name: 'launch', src: srcOf(m.slice(1)) };
  if (m[0] === 'orders') return { name: 'orders', sub: m[1] || '', params: new URLSearchParams(query) }; // payments:
  if (m[0] === 'build' && m[2]) return { name: 'build', kind: m[1], id: decodeURIComponent(m[2]) }; // guide: #/build/p|examples/<id>
  return { name: 'home' };
}

async function route() {
  const r = parse();
  if (r.name === 'support') return location.replace('/admin#support' + (r.id ? '/' + encodeURIComponent(r.id) : '')); // admin: the help inbox moved to /admin
  const prev = S.route;
  S.route = r;
  // payments: #/orders, #/orders/all, #/orders/success (web/checkout.js)
  $('#orders').hidden = r.name !== 'orders';
  if (r.name === 'orders') {
    for (const s of ['#studio', '#site', '#market', '#launch']) $(s).hidden = true;
    document.body.classList.add('site-on'); document.body.classList.remove('market-on');
    for (const id of ['#swStudio', '#swStore']) { $(id).classList.remove('on'); $(id).setAttribute('aria-selected', 'false'); }
    S.design = null; updateLaunchBtn('orders'); closeDrawer(); afterRoute();
    setCrumb(r.sub === 'success' ? 'Order confirmed' : r.sub === 'all' ? 'All orders' : 'My orders');
    return renderOrders($('#orders'), r, { errBox });
  }
  // guide: #/build/p/<id>, #/build/examples/<slug> (web/guide.js)
  $('#guidePage').hidden = r.name !== 'build';
  if (r.name === 'build') {
    for (const s of ['#studio', '#site', '#market', '#launch']) $(s).hidden = true;
    document.body.classList.add('site-on'); document.body.classList.remove('market-on');
    for (const id of ['#swStudio', '#swStore']) { $(id).classList.remove('on'); $(id).setAttribute('aria-selected', 'false'); }
    S.design = null; updateLaunchBtn('build'); closeDrawer(); afterRoute(); setCrumb('Build guide');
    return renderGuide($('#guidePage'), { kind: r.kind, id: r.id });
  }
  const view = ['forma', 'market', 'launch'].includes(r.name) ? r.name : 'studio';
  const isDesign = r.name === 'project' || r.name === 'example';
  const src = r.name === 'project' ? { project: r.id } : r.name === 'example' ? { example: r.id } : null;
  // "Back to store" on a product page opened from the store (kept while you stay on that page)
  if (r.tab === 'site' && src) { if (prev?.name === 'market') S.storeBack = JSON.stringify(src); else if (S.storeBack !== JSON.stringify(src)) S.storeBack = null; }
  else if (r.name !== 'market') S.storeBack = null;
  if (src) S.design = src;
  else if (r.name === 'home' || r.name === 'gallery' || r.name === 'pick') S.design = null;
  else if (view === 'launch') S.design = r.src;
  document.body.classList.toggle('site-on', view !== 'studio');
  $('#studio').hidden = view !== 'studio'; $('#site').hidden = view !== 'forma';
  $('#market').hidden = view !== 'market'; $('#launch').hidden = view !== 'launch';
  updateLaunchBtn(view);
  // Top switch: Studio covers every design tab (Model, Code, Website, Ads); Store is the marketplace.
  const top = view === 'market' ? 'market' : view === 'studio' ? 'studio' : null;
  for (const [id, v] of [['#swStudio', 'studio'], ['#swStore', 'market']]) {
    $(id).classList.toggle('on', top === v); $(id).setAttribute('aria-selected', String(top === v));
  }
  document.body.classList.toggle('market-on', view === 'market');
  closeDrawer();
  if (view === 'market') {
    setCrumb(''); document.title = 'Store · Premake';
    afterRoute();
    renderMarket($('#market'), { api, toast, params: r.params, fresh: prev?.name !== 'market',
      onRemixed: id => { loadProjects(); go(designPath({ project: id })); } });
    return;
  }
  if (view === 'forma') { go('#/', { replace: true }); return; } // old in-app about page retired: the logo goes to the studio home
  if (false) { afterRoute(); setCrumb(''); document.title = 'Premake'; renderSite($('#site'), { examples: S.examples, quote: api.quote }); ensureExamples().then(() => renderSite($('#site'), { examples: S.examples, quote: api.quote })); return; }
  if (view === 'launch' && r.src?.project) { S.wantRtab = 'launch'; go(designPath(r.src), { replace: true }); return; }
  if (view === 'launch') {
    afterRoute();
    if (prev?.name !== r.name) track('launch_opened', { design: r.src?.project ? 'project' : r.src?.example ? 'example' : null, page: true }); // analytics:
    const draw = () => { renderLaunch($('#launch'), pageCtx(r.src)); setCrumb(r.src ? designTitle(r.src) : '', 'Make'); };
    draw();
    Promise.all([ensureExamples(), S.projects ? null : loadProjects()]).then(() => { if (S.route === r) setCrumb(r.src ? designTitle(r.src) : '', 'Make'); });
    return;
  }

  // One shell: the sidebar and the right panel stay mounted; only the center swaps.
  const mode = r.name === 'home' ? 'home' : r.name === 'gallery' ? 'gallery' : r.name === 'pick' ? 'pick' : r.name === 'support' || r.name === 'stats' ? 'inbox' : 'work';
  const cls = `studio mode-${mode}`;
  if ($('#studio').className !== cls) $('#studio').className = cls;
  $('#home').hidden = mode !== 'home'; $('#gallery').hidden = mode !== 'gallery'; $('#work').hidden = mode !== 'work';
  $('#pick').hidden = mode !== 'pick'; $('#inbox').hidden = mode !== 'inbox';
  { const on = r.name === 'gallery' || r.name === 'example', ex = $('#sideExamples'); if (ex && ex.classList.contains('on') !== on) ex.classList.toggle('on', on); } // local: no Examples link (they're in the sidebar)
  $('#sideStore')?.classList.toggle('on', r.name === 'market');
  renderProjects();

  afterRoute();
  if (r.name === 'home') { setCrumb(''); renderHome(); }
  else if (r.name === 'gallery') { setCrumb('Examples'); renderGallery(); }
  else if (r.name === 'pick') { renderPick(r.tab); renderChat(); }
  else if (r.name === 'support') renderInbox(r.id);
  else if (r.name === 'stats') renderStats();
  else if (isDesign) {
    S.wantCtab = r.tab || S.wantCtab || (S.ctab === 'code' ? 'code' : 'model');
    openDesign(r.name, r.id);
  }
}

/** #/ads or #/site with no design selected: the design picker, in the center of the same shell. */
function renderPick(tab) {
  const site = tab === 'site';
  setCrumb(site ? 'Website' : 'Ads');
  const draw = () => {
    $('#pick').innerHTML = `<div class="pick-inner"><h1>${site ? 'A product page for your design' : 'Test demand with ads'}</h1>
      <p class="muted">${site ? 'Pick a design. You get a single-product page with a pre-order button, specs from the model and a waitlist, ready to point your ads at.' : 'Pick a design. Premake renders product shots and writes six Meta ad concepts you can edit and download.'}</p>
      <div class="pick-list">${designPicker({ projects: S.projects, examples: S.examples, current: null, prefix: site ? '#/site' : '#/ads' }).replace(/href="(#\/[^"]+)"/g, (_, h) => `href="${legacyHref(h)}"`)}</div></div>`;
  };
  draw();
  Promise.all([ensureExamples(), S.projects ? null : loadProjects()]).then(() => { if (S.route?.name === 'pick') draw(); });
}

function updateLaunchBtn(view) {
  const b = $('#launchBtn'), d = S.design, guest = !!sharedRole() && S.cur?.id === d?.project; // share: launching is the owner's
  b.hidden = !d || guest;
  b.classList.toggle('on', view === 'launch');
  b.disabled = !!d?.example;
  $('.lb-t', b).textContent = d?.example ? 'Remix to make' : 'Make';
  b.title = d?.example ? 'Examples are read-only. Remix this design to make it.' : 'Download the parts or get it made';
  const m = $('#launchBtnM'); if (m) { m.hidden = !d || !!d.example || guest; m.classList.toggle('on', view === 'launch'); }
}
function setCrumb(t, sub) {
  $('#crumb').innerHTML = t ? `${sub ? esc(sub) + ' / ' : ''}<b>${esc(t)}</b>` : '';
  document.title = t ? `${t} · Premake` : 'Premake studio';
}

// ---------- sidebar ----------
async function loadProjects() {
  try { S.projects = await api.projects(); S.projectsErr = null; setConn('ok'); }
  catch (e) { S.projectsErr = e; setConn('err'); }
  for (const p of S.projects || []) {
    const e = RUNS.get(p.id); if (e) e.title = p.title;
    if (!p.running && !p.site_running && !p.ads_running && !p.app_running) continue;
    const r = runEntry(p.id); r.title = p.title;
    if (p.running && !r.chat.live?.running) r.chat.live = { steps: [], text: '', running: true };
    if (p.site_running && !r.site.live?.running) r.site.live = { steps: [], text: '', running: true };
    if (p.ads_running && !r.ads.live?.running) r.ads.live = { steps: [], text: '', running: true };
    if (p.app_running && !r.app.live?.running) r.app.live = { steps: [], text: '', running: true };
    ensureStream(p.id);
  }
  { // designing: the agent names a new design mid-run (meta.json); the list poll brings the name to the title / crumb
    const cp = S.cur?.kind === 'project' && S.cur.data && (S.projects || []).find(p => p.id === S.cur.id);
    if (cp?.title && cp.title !== S.cur.data.meta?.title) { S.cur.data.meta = { ...(S.cur.data.meta || {}), title: cp.title }; if (onStudioFor(cp.id)) setCrumb(cp.title); }
  }
  updateRunIndicator();
  renderProjects();
  canonicalize(); // urls: a renamed design gets its new slug in the address bar
  // While anything runs, re-poll the list every 5 s (steps, finish, fresh thumbnails); stops when nothing is running.
  clearTimeout(projPollTimer); projPollTimer = null;
  if ((S.projects || []).some(projBusy)) projPollTimer = setTimeout(loadProjects, 5000);
}
var projPollTimer; // var + lazy init: these can be used before this line runs at startup
var projUpdated; // projects whose run finished while they weren't open: green "Updated" dot until opened
/** What a project's agents are doing right now (run store first, then the list's own flags), or null when idle. */
function projBusy(p) {
  const e = RUNS.get(p.id);
  const last = L => (L?.steps?.length ? L.steps[L.steps.length - 1] : '') || '';
  if (e && designBusy(e) || (!e && p.running)) { const st = (e && last(e.chat.live)) || p.step || ''; return st ? `Designing · ${st}` : 'Designing…'; } // full text: the row's title tooltip
  if (e && siteBusy(e) || (!e && p.site_running)) return 'Editing website…';
  if (e && adsBusy(e) || (!e && p.ads_running)) return 'Writing ads…';
  if (e && appBusy(e) || (!e && p.app_running)) return 'Building app…';
  return null;
}
/** Sidebar subtitle while busy: a short label ("Building", "Editing", "Thinking"); the full step is the tooltip. */
function shortStep(t) {
  const x = String(t).replace(/^Designing\s*·\s*/, '');
  if (/^Editing website/.test(t)) return 'Editing website';
  if (/^Writing ads/.test(t)) return 'Writing ads';
  if (/^Building app/.test(t)) return 'Building app';
  if (/build/i.test(x)) return /fail/i.test(x) ? 'Fixing' : 'Building';
  if (/^(Editing|Writing)/.test(x)) return 'Editing';
  if (/^(Reading|Looking|Searching)/.test(x)) return 'Reading';
  if (/^Blocked/.test(x)) return 'Blocked';
  return 'Thinking';
}
// The sidebar is mounted once; the list only changes when its content does (no re-render on tab switches).
function setList(el, html) { if (el._html !== html) { el._html = html; el.innerHTML = html; } }
function renderProjects() {
  const el = $('#projList');
  if (S.projectsErr) { el.innerHTML = `<div class="side-empty">Can’t load projects. <a href="#" id="projRetry" style="color:var(--link)">Retry</a></div>`; $('#projRetry').onclick = e => { e.preventDefault(); loadProjects(); }; return; }
  if (!S.projects) { setList(el, '<div class="side-empty">Loading…</div>'); return; }
  if (!S.projects.length && GUEST) { setList(el, '<div class="side-empty">Sign in to save your designs. <a href="#" data-guest-signin style="color:var(--link)">Sign in</a></div>'); return; } // guest:
  if (!S.projects.length) { setList(el, '<div class="side-empty">No projects yet. Describe something to start one.</div>'); return; }
  const curId = S.route?.name === 'project' ? S.route.id : null;
  projUpdated ||= new Set();
  const search = $('#projSearch'); if (search) search.hidden = S.projects.length < 6; // owner (3 Nov): search the sidebar
  const q = (search && !search.hidden ? search.value : '').trim().toLowerCase();
  const list = q ? S.projects.filter(p => (p.title || 'Untitled design').toLowerCase().includes(q)) : S.projects;
  if (!list.length) { setList(el, `<div class="side-empty">No designs match “${esc(q)}”.</div>`); return; }
  if (curId) projUpdated.delete(curId);
  setList(el, list.map(p => {
    const busy = projBusy(p), fresh = !busy && projUpdated.has(p.id);
    const thumb = p.thumb && (p.thumb.includes('?') ? p.thumb : `${p.thumb}?v=${encodeURIComponent(p.updated || '')}`); // cache-bust (older servers send no ?v=)
    return `<a class="proj ${p.id === curId ? 'on' : ''}${busy ? ' busy' : ''}" href="${esc(projectPath(p.id, p.title || ''))}" data-id="${esc(p.id)}">
      <span class="pthumb-w">${thumb ? `<span class="pthumb" style="background-image:url('${esc(thumb)}')"></span>`
        : `<span class="pthumb blank"><svg viewBox="0 0 16 16" width="12" height="12"><path d="M8 2l5.5 3v6L8 14l-5.5-3V5z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></span>`}${fresh ? '<span class="pnew" title="Updated"></span>' : ''}</span>
      <span class="ptext"><div class="ptitle">${esc(p.title || 'Untitled design')}</div><div class="ptime"${busy ? ` title="${esc(busy)}"` : ''}>${p.shared && !busy ? '<span class="pshared">Shared</span> · ' : ''}${busy ? esc(shortStep(busy)) : fresh ? '<b class="pnew-t">Updated</b> · ' + esc(ago(p.updated)) : esc(ago(p.updated)) + (Number(p.price_each) > 0 ? ' · $' + Number(p.price_each).toFixed(2) : '')}</div></span></a>`;
  }).join(''));
}
$('#projSearch')?.addEventListener('input', () => renderProjects());
// Switching projects keeps you on the same tab (Website stays Website).
$('#projList').addEventListener('click', e => {
  const a = e.target.closest('a.proj'); if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  if (S.route?.name !== 'project' && S.route?.name !== 'example') return;
  if (S.ctab === 'site' || S.ctab === 'ads' || S.ctab === 'app' || S.ctab === 'assemble') { e.preventDefault(); go(designPath({ project: a.dataset.id }, S.ctab)); }
  else if (S.ctab === 'code') S.wantCtab = 'code';
});
// ---------- duplicate + the design row menu (right click) ----------
async function duplicateProject(id) {
  if (!id) return;
  try {
    const { id: nid } = await api.createProject({ fromProject: id });
    toast('Duplicated into your designs');
    await loadProjects();
    go(designPath({ project: nid }));
  } catch (e) { toast(e.message || 'Could not duplicate'); }
}
window.premakeDuplicate = () => duplicateProject(S.cur?.id); // phonestudio: the design menu's Duplicate row
async function renameProjectInline(a) {
  const t = a.querySelector('.ptitle'); if (!t) return;
  const was = t.textContent, inp = document.createElement('input');
  inp.className = 'ptitle-edit'; inp.value = was; inp.maxLength = 80; inp.setAttribute('aria-label', 'Design name');
  t.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = async (save) => {
    if (done) return; done = true;
    const v = inp.value.trim();
    inp.replaceWith(t);
    if (!save || !v || v === was) return;
    t.textContent = v;
    try { const r = await fetch(`/api/projects/${encodeURIComponent(a.dataset.id)}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: v }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Rename failed');
      if (S.cur?.id === a.dataset.id) setCrumb(v);
      loadProjects();
    } catch (e) { t.textContent = was; toast(e.message); }
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
  inp.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });
}
async function deleteProject(id, title) {
  try {
    const r = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Delete failed');
    toast(`Deleted ${title}`);
    if (S.cur?.id === id) go('/');
    loadProjects();
  } catch (e) { toast(e.message); }
}
/** Delete confirmation: an iOS action sheet on phones (msheet.js), a small modal on desktop. */
function confirmDelete(id, title) {
  if (matchMedia('(max-width: 640px)').matches && window.__ms?.confirmSheet) {
    return window.__ms.confirmSheet({ title: `Delete ${title}?`, message: 'It disappears from your designs. Ask support if you need it back.', action: 'Delete', destructive: true })
      .then(ok => { if (ok) deleteProject(id, title); });
  }
  const w = document.createElement('div');
  w.className = 'modal-wrap del-modal';
  w.innerHTML = `<div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="delT"><div class="modal-body">
    <h2 id="delT">Delete ${esc(title)}?</h2><p>It disappears from your designs. Ask support if you need it back.</p></div>
    <div class="modal-foot"><button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn del-go" data-go>Delete</button></div></div>`;
  const close = () => { w.remove(); removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  w.addEventListener('click', e => { if (e.target === w || e.target.closest('[data-x]')) close(); else if (e.target.closest('[data-go]')) { close(); deleteProject(id, title); } });
  addEventListener('keydown', onKey, true);
  document.body.appendChild(w);
  w.querySelector('[data-go]').focus();
}
let rowMenu = null;
function closeRowMenu() { rowMenu?.remove(); rowMenu = null; }
$('#projList').addEventListener('contextmenu', e => {
  const a = e.target.closest('a.proj'); if (!a) return;
  e.preventDefault(); closeRowMenu();
  const id = a.dataset.id, href = new URL(a.getAttribute('href'), location.href).href;
  const p = (S.projects || []).find(x => x.id === id);
  const mine = !p?.shared;
  const items = [['open', 'Open in new tab'], ...(mine ? [['dup', 'Duplicate'], ['rename', 'Rename']] : []), ['link', 'Copy link'], ...(matchMedia('(max-width: 640px)').matches ? [] : [['phone', 'Continue on phone']]), ...(mine ? [['del', 'Delete']] : [])];
  rowMenu = document.createElement('div');
  rowMenu.className = 'row-menu'; rowMenu.setAttribute('role', 'menu');
  rowMenu.innerHTML = items.map(([k, l]) => `<button type="button" role="menuitem" data-k="${k}">${l}</button>`).join('');
  document.body.appendChild(rowMenu);
  const r = rowMenu.getBoundingClientRect();
  rowMenu.style.left = Math.min(e.clientX, innerWidth - r.width - 8) + 'px';
  rowMenu.style.top = Math.min(e.clientY, innerHeight - r.height - 8) + 'px';
  rowMenu.querySelector('button')?.focus();
  rowMenu.addEventListener('click', ev => {
    const btn = ev.target.closest('button'), k = btn?.dataset.k; if (!k) return;
    closeRowMenu();
    if (k === 'del') return confirmDelete(id, p?.title || a.querySelector('.t, .title')?.textContent || 'this design');
    if (k === 'phone') return import('./handoff.js').then(h => h.openHandoff(id, p?.title || a.querySelector('.t, .title')?.textContent || 'this design')).catch(err => toast(err.message)); // handoff:
    if (k === 'open') window.open(href, '_blank', 'noopener');
    else if (k === 'dup') duplicateProject(id);
    else if (k === 'rename') renameProjectInline(a);
    else if (k === 'link') navigator.clipboard?.writeText(href).then(() => toast('Link copied'), () => toast('Could not copy'));
  });
});
addEventListener('pointerdown', e => { if (rowMenu && !rowMenu.contains(e.target)) closeRowMenu(); }, true);
addEventListener('keydown', e => { if (e.key === 'Escape') closeRowMenu(); });
addEventListener('blur', closeRowMenu); addEventListener('scroll', closeRowMenu, true);

function closeDrawer() { for (const s of ['#sidebar', '#scrim']) if ($(s).classList.contains('open')) $(s).classList.remove('open'); }

// ---------- examples data ----------
let exPromise = null;
function ensureExamples() {
  if (S.examples) return Promise.resolve(S.examples);
  if (!exPromise) exPromise = api.examples().then(x => { S.examples = x || []; S.examplesErr = null; setConn('ok'); return S.examples; })
    .catch(e => { S.examplesErr = e; exPromise = null; setConn('err'); return null; });
  return exPromise;
}

// ---------- home ----------
// hometiles: six finished examples under the composer (picked for their thumbnails); a tap opens the example
const HOME_TILES = ['arc-desk-lamp', 'spin-turntable', 'handlebar-phone-mount', 'twist-planter', 'hidden-cleat-hooks', 'bed-cooler'];
function renderHome() {
  const box = $('#homeTiles');
  const head = '<div class="ht-head"><p>Or open a finished example</p><a href="/examples">See all</a></div>';
  const draw = () => {
    if (S.examplesErr) { box.innerHTML = head + errBox(S.examplesErr, true); wireRetry(box, () => { ensureExamples().then(draw); }); return; }
    if (!S.examples) { box.innerHTML = head + `<div class="ht-grid">${Array(6).fill('<span class="home-tile"><span class="ht-img skel"></span><span class="ht-t">&nbsp;</span></span>').join('')}</div>`; return; }
    const by = new Map(S.examples.map(e => [e.slug, e]));
    const list = [...HOME_TILES.map(s => by.get(s)).filter(Boolean), ...S.examples.filter(e => !HOME_TILES.includes(e.slug))].slice(0, 6);
    box.innerHTML = head + `<div class="ht-grid">${list.map(e => `<a class="home-tile" href="/examples/${encodeURIComponent(e.slug)}">
      <span class="ht-img"><img src="${esc(e.thumb)}" alt="" loading="lazy" decoding="async"></span><span class="ht-t">${esc(e.title)}</span></a>`).join('')}</div>`;
  };
  draw(); ensureExamples().then(draw);
}
// images: paste / drop / pick images into the home box
const homeAtt = attachImages({ box: $('#homeForm'), textarea: $('#homePrompt'), strip: { before: $('#homePrompt') }, button: { into: $('#homeForm .prompt-row') }, label: 'Add image',
  tip: $('#home .att-tip') }); // phones: camera button + scale tip
let homeDraftId = null; // images: project made for an image upload that then failed; reused on retry
$('#homeForm').onsubmit = async e => {
  e.preventDefault();
  const nImg = homeAtt.count(); // images:
  const prompt = $('#homePrompt').value.trim() || (nImg ? defaultImageText(nImg) : '');
  if (!prompt) { $('#homePrompt').focus(); return; }
  const btn = $('#homeGo'); btn.disabled = true; $('#homeErr').hidden = true;
  try {
    let id, attachments; // images: with images: create the project, upload, then send the message with the ids
    if (nImg) {
      id = homeDraftId || (homeDraftId = (await api.createProject({})).id);
      attachments = await homeAtt.uploadAll(id);
      await api.send(id, prompt, attachments.map(a => a.id));
      homeAtt.clear(); homeDraftId = null;
    } else ({ id } = await api.createProject({ prompt }));
    track('design_started', { prompt_length: prompt.length, has_image: nImg > 0, images: nImg, project_id: id }); // analytics: length only, never the text
    $('#homePrompt').value = '';
    pendingPrompt = { id, text: prompt, attachments };
    // phonenav: on phones the new design takes the New design screen's place, so back goes to Designs
    go(designPath({ project: id }), { replace: isNarrow() && !GUEST && location.pathname === '/new' });
    loadProjects();
  } catch (err) { $('#homeErr').hidden = false; $('#homeErr').innerHTML = errBox(err); }
  btn.disabled = false;
};
$('#homePrompt').onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) { e.preventDefault(); $('#homeForm').requestSubmit(); } };
// install: /?prompt=<idea> (install.sh "design me a ...") starts that design straight away, once
{ const q = new URLSearchParams(location.search).get('prompt'); if (q && location.pathname === '/') { history.replaceState(null, '', '/'); $('#homePrompt').value = q.slice(0, 4000); setTimeout(() => $('#homeForm').requestSubmit(), 800); } }
let pendingPrompt = null;

// ---------- gallery ----------
function renderGallery() {
  const grid = $('#galGrid');
  const draw = () => {
    if (S.examplesErr) { grid.innerHTML = `<div style="grid-column:1/-1">${errBox(S.examplesErr, true)}</div>`; wireRetry(grid, () => ensureExamples().then(draw)); $('#galTags').innerHTML = ''; return; }
    if (!S.examples) { grid.innerHTML = Array(8).fill('<div class="skel" style="height:260px"></div>').join(''); return; }
    const tagN = new Map(); for (const t of S.examples.flatMap(e => [...new Set(e.tags || [])])) tagN.set(t, (tagN.get(t) || 0) + 1);
    const tags = [...tagN].filter(([t, n]) => n >= 2 || t === S.galTag).map(([t]) => t).sort(); // chips: tags shared by 2+ designs
    $('#galTags').innerHTML = [`<button class="chip ${!S.galTag ? 'on' : ''}" data-tag="">All</button>`,
      ...tags.map(t => `<button class="chip ${S.galTag === t ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`)].join('');
    $$('#galTags .chip').forEach(c => c.onclick = () => { S.galTag = c.dataset.tag || null; draw(); });
    const q = S.galQuery.toLowerCase();
    const list = S.examples.filter(e => (!S.galTag || (e.tags || []).includes(S.galTag)) &&
      (!q || [e.title, e.creator, e.description, ...(e.tags || [])].join(' ').toLowerCase().includes(q)));
    grid.innerHTML = list.length ? list.map(e => `<a class="card" href="/examples/${encodeURIComponent(e.slug)}">
        <div class="img" style="background-image:url('${esc(e.thumb)}')">${e.demo ? '<span class="badge">Example</span>' : ''}</div>
        <div class="meta"><div class="t">${esc(e.title)}</div><div class="by">by ${esc(e.creator || 'Unknown')}</div>${statsHtml(e)}${socialHtml(e)}
        <div class="ctags">${(e.tags || []).map(t => `<span>${esc(t)}</span>`).join('')}</div></div></a>`).join('')
      : '<div class="gal-empty">No examples match. Try another search or tag.</div>';
  };
  draw(); ensureExamples().then(draw);
  mountTicker(grid); // social: recent orders strip above the grid
}
$('#galSearch').oninput = e => { S.galQuery = e.target.value; renderGallery(); };

// ---------- design workspace ----------
// One shared promise: two callers racing on a fresh page (openDesign's empty state + a run_started / sketch / model_updated
// event) used to construct TWO viewers in #viewport. The first canvas kept the empty print volume on screen while the
// real model loaded into the second one, hidden behind it.
let viewerP = null;
function getViewer() {
  if (S.viewer || S.viewerErr) return Promise.resolve(S.viewer);
  return viewerP || (viewerP = (async () => {
    try { const { Viewer } = await import('./viewer.js'); S.viewer = new Viewer($('#viewport')); }
    catch (e) { S.viewerErr = e; }
    if (S.viewer) import('./partmenu.js').then(m => m.attachPartMenu(S.viewer, { state: S, renderTree, renderRenderBar, setRtab, toast, onSelect: n => partCtx.suggest(isNarrow() ? null : n) })) /* phonekit: phones open the part's sheet, no floating chip */.catch(e => console.warn('part menu', e)); // partmenu: right-click part menu
    if (S.viewer) import('./hover.js').then(m => m.attachHover(S.viewer, { getData: () => ({ quote: S.quote, bom: S.cur?.data?.bom }), onAsk: askPart, onColor: colorPart, canColor: () => S.cur?.kind === 'project' && !S.cur.readOnly && S.cur.role !== 'copy' })).catch(e => console.warn('hover', e)); // hover tooltips
    return S.viewer;
  })());
}
function overlay(html) { const o = $('#vpOverlay'); o.hidden = !html; o.innerHTML = html ? `<div class="box">${html}</div>` : ''; }

let openToken = 0;
async function openDesign(kind, id) {
  const token = ++openToken;
  const same = S.cur && S.cur.kind === kind && S.cur.id === id && S.cur.data;
  if (same) { // studio kept mounted: chat, viewer camera and model are all still here
    const t = S.cur.data.meta?.title || S.cur.data.manifest?.title || id;
    setCrumb(t, S.cur.readOnly ? 'Examples' : '');
    if (S.wantCtab) { setCtab(S.wantCtab); S.wantCtab = null; }
    if (S.wantRtab) { setRtab(S.wantRtab); S.wantRtab = null; } // #/launch/p/<id> on the open design
    renderChat(); S.viewer?.resize();
    if (S.cur.stale) { S.cur.stale = false; refreshAll(); }
    return;
  }
  const readOnly = kind === 'example';
  if (readOnly) track('example_opened', { example: id }); // analytics:
  S.cur = { kind, id, data: null, base: '', readOnly };
  S.chat = kind === 'project' ? runEntry(id).chat : { messages: [], live: null, steps: {} };
  if (kind === 'project') ensureStream(id);
  pruneStreams();
  S.quote = null; S.quoteErr = null; S.tierIdx = 1;
  partCtx.clear(); partCtx.suggest(null); // chattools: part chips belong to one project
  S.selPart = null; S.hero = null; S.heroStale = true; S.heroWanted = false; S.modelEmpty = false; loadLook(); if (S.viewer?.studio) pushLook();
  $('#vpStatus').hidden = true; $('#modelPane').classList.remove('vp-empty');
  $('#priceChip').hidden = true; $('#orderPill').hidden = true;
  $('#roTag').hidden = !readOnly; $('#remixBtn').hidden = !readOnly;
  $('#composer').hidden = readOnly; $('#remixCard').hidden = !readOnly;
  syncShareRole(); // share: the owner's controls until this design says otherwise
  setCrumb(readOnly ? 'Example' : 'Loading…', readOnly ? 'Examples' : '');
  setCtab(S.wantCtab || 'model'); S.wantCtab = null; setRtab(S.wantRtab || 'chat'); S.wantRtab = null;
  if (isNarrow()) { overlay('<div class="ml-host"></div>'); loadingCards($('#vpOverlay .ml-host')); } // phonekit: cards, not a spinner (none at all under 300 ms)
  else overlay('<div class="big-spin"></div><p>Loading model…</p>');
  if (S.viewer) { try { S.viewer.clear(); } catch {} renderTree(); } // another design: never show the previous model while this one loads
  $('#msgs').innerHTML = ''; $('#orderPane').innerHTML = ''; $('#code').innerHTML = ''; $('#undoBar').innerHTML = '';
  syncAppTab(); // apps: hidden until this design's data says it has electronics
  closeVersions(); $('#verBtn').hidden = true; $('#asmTabBtn').hidden = true;
  let data;
  try { data = kind === 'project' ? await api.project(id) : await api.example(id); setConn('ok'); }
  catch (e) {
    if (token !== openToken) return;
    $('#remixBtn').hidden = true; $('#remixCard').hidden = true; $('#roTag').hidden = true; // nothing to remix
    if (e.status) overlay(`<h3>${kind === 'project' ? 'Project' : 'Example'} not found</h3><p>${esc(e.message)}</p><a class="btn" href="${designPath(null)}">Back to start</a>`);
    else { setConn('err'); overlay(errBox(e, true)); wireRetry($('#vpOverlay'), () => { S.cur = null; openDesign(kind, id); }); }
    $('#msgs').innerHTML = `<div style="margin:auto 0">${errBox(e)}</div>`;
    return;
  }
  if (token !== openToken) return;
  S.cur.data = data; S.cur.base = data.base || '';
  S.cur.role = kind === 'project' ? (data.role || 'owner') : null; syncShareRole(); // share: 'edit' | 'copy' for designs shared with you
  const title = data.meta?.title || data.manifest?.title || (readOnly ? id : 'Untitled design');
  setCrumb(title, readOnly ? 'Examples' : '');
  if (!readOnly) { // urls: /designs/<id> or an old slug -> /designs/<slug>-<id>; a renamed design's sidebar row follows
    const pe = (S.projects || []).find(p => p.id === id);
    if (pe && data.meta?.title && pe.title !== data.meta.title) { pe.title = data.meta.title; renderProjects(); }
    canonicalize();
  }
  S.chat.messages = data.messages || [];
  S.chat.history = data.history || null;
  if (data.running && !S.chat.live?.running) S.chat.live = { steps: [], text: '', running: true };
  if (!data.running && S.chat.live?.running && !pendingPrompt) S.chat.live = null; // finished while we weren't listening
  if (kind === 'project') runEntry(id).title = title;
  if (pendingPrompt?.id === id) {
    if (!S.chat.messages.some(m => m.role === 'user')) S.chat.messages.push({ role: 'user', text: pendingPrompt.text, t: Date.now() / 1000, attachments: pendingPrompt.attachments }); // images:
    if (!S.chat.live) S.chat.live = { steps: [], text: '', running: true };
    if (kind === 'project') runEntry(id).sentAt = Date.now();
    pendingPrompt = null;
  }
  if (kind === 'project' && data.meta?.replay?.pending && data.manifest?.parts?.length) { startReplay(id, data, token); return; } // replay:
  syncAppTab(); // apps: the App tab shows for designs with electronics or an app/ folder
  syncAsmTab(); // assemble:
  renderChat(); renderCode(); updateRunIndicator();
  if (S.ctab === 'ads' || S.ctab === 'app' || S.ctab === 'assemble') renderCenterTab(); // header title is known now
  loadModel(data.manifest, false).then(() => { // a reload mid-run still shows the instant sketch until the model lands
    if (data.sketch && data.running && isCurProject(id) && S.viewer) { S.viewer.showSketch(data.sketch); renderVpStatus(); }
  });
  loadQuote();
  if (kind === 'project') warmUp(id, true);
}

// ---------- replay: a recorded real run played back sped up (web/replay.js, server.js startReplay) ----------
function startReplay(id, data, token) {
  pendingPrompt = null;
  syncAppTab(); syncAsmTab(); renderCode(); loadQuote();
  const final = { manifest: data.manifest, messages: data.messages || [] };
  const alive = () => token === openToken && isCurProject(id);
  let models = 0;
  const landed = async (manifest, base) => { // like loadModel, for a model from the replay folder
    const v = await getViewer(); if (!v || !alive()) return;
    const prev = v.parts().map(p => ({ name: p.name }));
    overlay(''); S.modelEmpty = false;
    await v.load(manifest, base, { keepCamera: models > 0, animate: true });
    v.showEmpty(false); renderTree(); renderVpStatus();
    if (models > 0 && v.fitBox) v.glideTo(v.fitBox, true); // the printer grows: ease back so all of it stays in view
    if (++models > 1) { const c = { id, text: versionNote(prev, manifest.parts || [], models) }; S.verCap = c; setTimeout(() => { if (S.verCap === c) { S.verCap = null; renderVpStatus(); } }, 4000); }
  };
  import('./replay.js').then(R => R.playReplay({
    id, base: S.cur.base, alive,
    onEvent: d => onProjectEvent(id, d),
    async prep() {
      S.cur.data.manifest = null; // a first run: the designing state, then the models as they land
      S.chat.messages = final.messages.filter(m => m.role === 'user').slice(0, 1);
      S.chat.live = { steps: [], text: '', running: true };
      if (!isNarrow()) $('#tree')?.classList.add('collapsed'); // the model is the show
      renderChat(); updateRunIndicator();
      await loadModel(null, false);
    },
    showModel: (m, base) => landed(m, base),
    async showFinal() { S.cur.data.manifest = final.manifest; await landed(final.manifest, S.cur.base); },
    async finish() {
      if (!alive()) return;
      S.cur.data.manifest = final.manifest;
      await api.replayDone?.(id).catch(() => {});
      const p = await api.project(id).catch(() => null); if (!alive()) return; // the saved reply (held back while it played)
      S.chat.live = null; S.chat.messages = p?.messages || final.messages; S.chat.history = p?.history || S.chat.history;
      renderChat(); updateRunIndicator();
      await loadModel(final.manifest, true, true);
      const v = S.viewer; if (!v || !alive()) return;
      v.fit(); await new Promise(r => setTimeout(r, 400));
      try { await v.playAssembly?.(); } catch {}
      if (!alive()) return;
      if (v.fitBox) v.glideTo(v.fitBox, true); await new Promise(r => setTimeout(r, 900)); // the Assemble camera ends close in
      if (alive()) { const b = $('#scaleBtn'); if (b && !b.classList.contains('on')) b.click(); await new Promise(r => setTimeout(r, 900)); if (alive()) v.fit(); } // fit: the printer and the phone, like the Fit button
    },
  })).catch(() => { if (alive()) { api.replayDone?.(id).catch(() => {}); loadModel(final.manifest, false); } });
}

// ---------- share: designs shared with you (server/share.js). edit: the studio, chatting on the shared design. copy: the
// studio read-only; the first change (or Make a copy) copies it into your designs. Never the owner's controls: Share,
// Website, Ads, Launch, App, Call Josh.
const sharedRole = () => (S.cur?.kind === 'project' && (S.cur.role === 'edit' || S.cur.role === 'copy') ? S.cur.role : null);
$('#phoneBtn').onclick = () => S.cur?.id && import('./handoff.js').then(h => h.openHandoff(S.cur.id, S.cur.data?.meta?.title || 'this design')).catch(e => toast(e.message)); // handoff: Continue on phone
function syncShareRole() {
  const role = sharedRole(), guest = !!role;
  $('#shareBtn').hidden = guest;
  $('#phoneBtn').hidden = guest || S.cur?.kind !== 'project' || !!S.cur?.readOnly; // handoff: your own designs
  $$('[data-ctab="site"], [data-ctab="ads"]').forEach(b => { b.hidden = guest; });
  if (guest && ['site', 'ads', 'app'].includes(S.ctab)) setCtab('model');
  if (guest) $('#appTabBtn').hidden = true;
  const tag = $('#roTag'), by = S.cur?.data?.owner_name || 'its owner';
  tag.textContent = role === 'edit' ? `Shared by ${by} · you can edit` : role === 'copy' ? `Shared by ${by} · view only` : 'Read-only example';
  $('#remixBtn').textContent = role === 'copy' ? 'Make a copy' : 'Remix this';
  if (!S.cur?.readOnly) { tag.hidden = !guest; $('#remixBtn').hidden = role !== 'copy'; }
  if (guest) { $('#launchBtn').hidden = true; if ($('#launchBtnM')) $('#launchBtnM').hidden = true; if (S.rtab === 'launch') setRtab('chat'); }
  else updateLaunchBtn($('#launchBtn').classList.contains('on') ? 'launch' : 'studio');
  renderChatMode();
}
/** Copy links: make your own copy of the shared design, open it, and (with text) send the first change there. */
async function forkShared(text = '', att = []) {
  const cur = S.cur, sid = cur?.data?.share?.id;
  if (!sid) return;
  $$('#remixBtn, #sendBtn').forEach(b => b.disabled = true);
  try {
    const { id } = await api.createProject({ fromShare: sid });
    track('share_copied', { share_id: sid, project_id: id, with_message: !!text }); // analytics:
    let attachments = [];
    if (text) {
      if (att.length) attachments = await chatAtt.uploadAll(id).catch(() => []); // images: they go with the copy
      chatAtt.clear(); $('#chatInput').value = ''; autoGrow();
      await api.send(id, text, attachments.map(a => a.id));
      pendingPrompt = { id, text, attachments };
    }
    toast('Copied into your designs');
    go(designPath({ project: id }));
    loadProjects();
  } catch (e) { toast(e.message); }
  $$('#remixBtn, #sendBtn').forEach(b => b.disabled = false);
}

// ---------- speed: pre-warm the design agent + build worker (studio open, composer focus / typing) ----------
const warmedAt = new Map();
function warmUp(id, force) {
  if (!id || ACCESS.showcase || !api.warm || S.cur?.readOnly) return;
  const last = warmedAt.get(id) || 0;
  if (!force && Date.now() - last < 60000) return; // the server keeps it warm for 10 min; one ping a minute is plenty
  warmedAt.set(id, Date.now());
  api.warm(id).catch(() => {});
}
let homeWarmAt = 0;
function warmHome() {
  if (ACCESS.showcase || !api.warmHome || Date.now() - homeWarmAt < 60000) return;
  homeWarmAt = Date.now();
  api.warmHome().catch(() => {});
}
$('#homePrompt').addEventListener('focus', warmHome);
$('#homePrompt').addEventListener('input', warmHome);
$('#chatInput').addEventListener('focus', () => { if (S.cur?.kind === 'project' && chatTarget() === 'design') warmUp(S.cur.id); });
$('#chatInput').addEventListener('input', () => { if (S.cur?.kind === 'project' && chatTarget() === 'design') warmUp(S.cur.id); });

async function loadModel(manifest, keepCamera, animate = false) {
  const v = await getViewer();
  if (!v) { overlay(`<h3>3D viewer failed to load</h3><p>Couldn’t load three.js from the CDN. Check your connection and reload.</p>`); return; }
  if (!manifest?.parts?.length) {
    // The real 3D space (grid, axes, print volume, live controls) with a status chip; the model appears in place.
    v.clear(); v.showEmpty(true); S.modelEmpty = true; renderTree(); renderPriceChip();
    overlay(S.cur?.readOnly ? '<h3>No model</h3><p>This example has no exported parts yet.</p>' : '');
    renderVpStatus();
    return;
  }
  overlay('');
  S.modelEmpty = false; renderVpStatus();
  v.sceneHint = { id: S.cur.id, title: S.cur.data?.meta?.title || manifest.title || '', text: [S.cur.data?.meta?.description, ...(S.cur.data?.meta?.tags || []), S.chat.messages.find(m => m.role === 'user')?.text].filter(Boolean).join(' ').slice(0, 2000) }; // scene.js: guess a scene
  await v.load(manifest, S.cur.base, { keepCamera, animate });
  v.showEmpty(false);
  if (S.selPart && !v.parts().some(p => p.name === S.selPart)) S.selPart = null;
  renderTree(); renderRenderBar(); renderPriceChip(); renderOrderPill();
  loadSections(manifest);
  if (S.quote && !$('#orderPane .ot-thumb')) renderOrder();
  S.heroStale = true; if (S.heroWanted) makeHero(true); else maybeHero();
}

// designing: the "building" state of an empty model card (a new design's first run, before the sketch or model lands):
// a small dashed ghost box floating over the grid, "Designing your part…" and the current step. Same ghost as the
// phone home stage (web/phonehome.js); the edges march slowly while the agent works.
const BUILD_GHOST = `<svg class="vb-ghost" viewBox="0 0 140 132" width="104" height="98" aria-hidden="true">
  <path d="M70 14 124 42 70 70 16 42Z" fill="rgba(255,255,255,.6)"/><path d="M16 42 70 70v58L16 100Z" fill="rgba(255,255,255,.36)"/><path d="M70 70 124 42v58l-54 28Z" fill="rgba(255,255,255,.22)"/>
  <path d="M70 14v58M16 100l54-28 54 28" fill="none" stroke="#948f85" stroke-opacity=".34" stroke-width="1.2" stroke-dasharray="3.5 3"/>
  <path class="vb-edge" d="M70 14 124 42 70 70 16 42ZM16 42v58l54 28 54-28V42M70 70v58" fill="none" stroke="#b4a08e" stroke-width="1.5" stroke-dasharray="4.5 3.2" stroke-linejoin="round"/></svg><span class="vb-shadow" aria-hidden="true"></span>`;
/** designing: is the open design's live run its first one (no reply and no model yet when it started)? Latched per run. */
function isFirstRun() {
  const L = S.chat?.live;
  if (!L?.running || S.cur?.kind !== 'project' || !S.cur.data) return false;
  if (L.first == null) L.first = !S.chat.messages.some(m => m.role === 'assistant') && !S.cur.data.manifest?.parts?.length;
  return L.first;
}
function renderVpStatus() {
  const el = $('#vpStatus'), pane = $('#modelPane');
  isFirstRun();
  const restoring = !!(S.restoring && S.cur?.id === S.restoring.id && Date.now() < S.restoring.until); // undo/redo/restore: rebuilding the old model
  const L = S.chat.live, own = !!(S.cur && !S.cur.readOnly), running = own && !!L?.running;
  const empty = !!(S.modelEmpty && own && S.cur.data), sketch = !!S.viewer?.sketch;
  const building = empty && running && !sketch && !restoring;
  // scan shimmer only over a real model being edited; the empty card and the sketch have their own status
  { const b = (running || (own && restoring)) && !empty; if (pane.classList.contains('building') !== b) pane.classList.toggle('building', b); }
  if (pane.classList.contains('vp-building') !== building) pane.classList.toggle('vp-building', building);
  S.viewer?.setGuides?.(!building); // the faint print volume steps aside for the ghost
  pane.classList.toggle('vp-empty', empty && !sketch);
  let cls = 'vp-status', html = '';
  // livecaption: what the agent is doing in plain words ("Cutting the camera window"); the phase until the first one.
  // The first model's reveal names each part as it lands; a rebuild in the same run says what changed.
  const over = own ? (S.revealCap || (S.verCap && S.verCap.id === S.cur?.id ? S.verCap.text : '')) : '';
  const cap = over || (running ? (L.caption || (empty ? liveStepLabel(L, !!L.first) : '')) : '');
  if (restoring) html = `<span class="spin"></span><span>${esc(S.restoring.label)}…</span><span class="vs-step">rebuilding the model</span>`;
  else if (building) { cls += ' vp-build'; html = `${BUILD_GHOST}<b class="vb-title">Designing your part…</b><span class="vs-step">${esc(cap)}</span>`; }
  else if ((running || over) && cap) { cls += ' vp-cap'; html = `<span class="vc-dot" aria-hidden="true"></span><span class="vc-text">${esc(cap)}</span>`; } // under the sketch or the model
  else if (empty && !sketch) html = '<span>No model yet. Describe it in the chat and it appears here.</span>';
  if (el.classList.contains('vp-build') && !building) { // the ghost fades and grows a little as the sketch / model pops in
    const g = el.cloneNode(true); g.removeAttribute('id'); g.removeAttribute('role'); g.removeAttribute('aria-live'); g.setAttribute('aria-hidden', 'true'); g.classList.add('vp-leave');
    el.after(g); setTimeout(() => g.remove(), 700);
  }
  if (!html) { el.hidden = true; el.className = 'vp-status'; return; }
  if (el.className !== cls) { el.className = cls; el.innerHTML = ''; }
  if (cls.includes('vp-build')) { // keep the ghost (and its animation) in place; only the step text changes
    if (!el.firstElementChild) el.innerHTML = html;
    else { const st = $('.vs-step', el), t = cap; if (st.textContent !== t) st.textContent = t; }
  } else if (cls.includes('vp-cap') && $('.vc-text', el)) { // livecaption: the new line slides in
    const t = $('.vc-text', el);
    if (t.textContent !== cap) { t.textContent = cap; t.classList.remove('swap'); void t.offsetWidth; t.classList.add('swap'); }
  } else if (el.innerHTML !== html) el.innerHTML = html;
  el.hidden = false;
}

document.addEventListener('forma:part-hidden', () => renderTree()); // hidden from the part's hover card
// sections: the design's machine sections ({ map: {part name: section}, order }) for the Parts panel. The design's own
// part.section needs no request; older designs of 8+ parts are classified once on the server (cached per part list).
S.sections = null; S.partsBy = loadPartsBy();
function loadSections(manifest) {
  const cur = S.cur, parts = manifest?.parts || [];
  const tag = cur ? `${cur.kind}:${cur.id}` : '';
  if (S.sections && S.sections.tag !== tag) S.sections = null;
  if (!cur || parts.length < 8 || parts.some(p => p.section) || !api.sections) return;
  const want = parts.map(p => p.name).sort().join('\n');
  if (S.sections?.want === want || S.sectionsLoading === tag + want) return;
  S.sectionsLoading = tag + want;
  api.sections(cur.kind, cur.id).then(r => {
    if (S.sectionsLoading !== tag + want) return;
    S.sectionsLoading = null;
    if (S.cur !== cur || !r?.map) return;
    S.sections = { tag, want, map: r.map, order: r.order || [] };
    renderTree();
  }).catch(() => { if (S.sectionsLoading === tag + want) S.sectionsLoading = null; });
}
/** The Parts panel's sections for the open design (null when it has none yet). */
const curSections = () => (S.sections && S.cur && S.sections.tag === `${S.cur.kind}:${S.cur.id}` ? S.sections : null);
function renderTree() {
  const parts = S.viewer?.parts() || [];
  const tree = $('#tree');
  tree.hidden = !parts.length;
  $('#treeCount').textContent = parts.length ? parts.length : '';
  const { mode, can, groups } = treeGroups(parts, curSections(), S.partsBy);
  const eye = off => off
    ? '<svg viewBox="0 0 16 16" width="13" height="13"><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M3 13L13 3" stroke="currentColor" stroke-width="1.2"/></svg>'
    : '<svg viewBox="0 0 16 16" width="13" height="13"><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/></svg>';
  const anyOff = parts.some(p => S.viewer.hidden.has(p.name)) || !!S.viewer.partmenu?.state.see.length;
  const seg = can ? `<div class="tby" role="group" aria-label="Group parts"><button type="button" data-by="section" aria-pressed="${mode === 'section'}">By section</button><button type="button" data-by="type" aria-pressed="${mode === 'type'}">By type</button></div>` : '';
  const bySec = mode === 'section';
  $('#treeBody').innerHTML = seg + (anyOff && !isNarrow() ? '<button type="button" class="tshowall" id="treeShowAll">Show all</button>' : '') + groups.map(({ key, label, parts: list }, gi) => {
    const allOff = list.every(p => S.viewer.hidden.has(p.name));
    const what = bySec ? `the ${label} parts` : `${label.toLowerCase()} parts`;
    return `<div class="tgroup${bySec ? ' tgsec' : ''}">${esc(label)}<span class="count">${list.length}</span><button class="eye geye" data-geye="${gi}" aria-label="${allOff ? 'Show' : 'Hide'} all ${esc(what)}" title="${allOff ? 'Show' : 'Hide'} all ${esc(what)}">${eye(allOff)}</button></div><div class="tsec">` + list.map(p => {
      const g = typeOf(p);
      const off = S.viewer.hidden.has(p.name);
      const over = g === 'case' && (p.size || []).some(n => n > 256);
      const dim = g === 'case' && p.size ? `<span class="dim ${over ? 'over' : ''}" title="${over ? 'Larger than the 256 mm print bed' : 'Bounding box, mm'}">${p.size.map(n => Math.round(n)).join('×')}</span>` : '';
      const sel = S.selPart === p.name;
      const kind = g === 'case' ? (p.process && p.process !== 'print' ? 'Made part' : '3D printed') : 'Bought part';
      return `<div class="titem ${off ? 'off' : ''} ${sel ? 'sel' : ''}" data-sel="${esc(p.name)}" data-g="${g}"><span class="sw${bySec && g === 'component' ? ' sw-b' : ''}" title="${bySec ? kind : ''}" style="--c:${esc(g === 'case' && S.render && S.look ? (S.look.parts[p.name] || S.look.all || p.color) : p.color)}"></span><span class="nm" title="${esc(p.name)}">${esc(p.name)}${refCreditHtml(p, esc)}</span>${dim}
        <button class="eye" data-part="${esc(p.name)}" aria-label="${off ? 'Show' : 'Hide'} ${esc(p.name)}">${eye(off)}</button></div>`;
    }).join('') + '</div>';
  }).join('');
  const sa = $('#treeShowAll'); if (sa) sa.onclick = e => { e.stopPropagation(); if (S.viewer.partmenu) S.viewer.partmenu.showAll(); else { S.viewer.hidden.clear(); S.viewer.apply(); } renderTree(); };
  $$('#treeBody .tby [data-by]').forEach(b => b.onclick = e => { e.stopPropagation(); S.partsBy = b.dataset.by; savePartsBy(S.partsBy); renderTree(); });
  document.dispatchEvent(new Event('forma:tree')); // phonestudio: the reset button on the model card
  $$('#treeBody .eye[data-part]').forEach(b => b.onclick = e => { e.stopPropagation(); const n = b.dataset.part; S.viewer.setHidden(n, !S.viewer.hidden.has(n)); renderTree(); });
  $$('#treeBody .geye').forEach(b => b.onclick = e => { // a whole group (type or section) on / off
    e.stopPropagation();
    const list = groups[Number(b.dataset.geye)]?.parts || [];
    const hide = list.some(p => !S.viewer.hidden.has(p.name));
    for (const p of list) { if (hide) S.viewer.hidden.add(p.name); else S.viewer.hidden.delete(p.name); }
    S.viewer.apply(); renderTree();
  });
  $$('#treeBody .titem').forEach(r => r.onclick = () => {
    if (r.dataset.g !== 'case') return; // colour applies to printed parts only
    S.selPart = S.selPart === r.dataset.sel ? null : r.dataset.sel; renderTree(); renderRenderBar();
  });
}

// toolbar
$$('#toolbar [data-view]').forEach(b => b.onclick = () => { S.viewer?.setView(b.dataset.view); });
$('#explode').oninput = e => S.viewer?.set('explode', e.target.value / 100);
$('#ghostBtn').onclick = e => { const b = e.currentTarget, on = !b.classList.contains('on'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); S.viewer?.set('ghost', on); };
$('#compBtn').onclick = e => { const b = e.currentTarget, on = !b.classList.contains('on'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); S.viewer?.set('showComp', on); };
$('#scaleBtn').onclick = () => S.viewer?.scaleRef?.toggle(); // scaleref: everyday object beside the model
$('#fitBtn').onclick = () => S.viewer?.fit();
addEventListener('buildery:share', async e => { try { (await import('./share.js')).toggleSharePop(e.detail, S.cur); } catch (err) { toast?.(err.message); } }); // Launch tab's Share button
// assemble: the Assemble tab (web/assemble.js), for projects: print, gather, wire, flash, test, close it up. It replaced the
// "Flash to my ESP32" sheet; window.premakeFlash opens it at the Flash step (phone menu, old callers).
function syncAsmTab() {
  $('#asmTabBtn').hidden = !(S.cur?.kind === 'project' && S.cur.data);
  if ($('#asmTabBtn').hidden && S.ctab === 'assemble' && S.cur?.data) setCtab('model');
}
function openAssemble(step) {
  if (S.cur?.kind !== 'project' || !S.design) return;
  go(designPath(S.design, 'assemble') + (step ? `?step=${step}` : ''));
}
window.premakeAssemble = () => openAssemble();
window.premakeFlash = () => openAssemble('flash');
let asmMod = null;
function renderAsm() {
  if (S.cur?.kind !== 'project' || !S.cur.data) return;
  const id = S.cur.id;
  (asmMod ||= import('./assemble.js')).then(m => {
    if (S.ctab !== 'assemble' || !isCurProject(id)) return;
    m.renderAssemble($('#asmPane'), {
      id, title: S.cur.data.meta?.title || '', firmware: S.cur.data.firmware || null,
      viewer: () => S.viewer, canEdit: S.cur.kind === 'project' && !S.cur.readOnly && sharedRole() !== 'copy',
      send: async text => {
        if (!isCurProject(id)) throw new Error('Open the design first');
        if (S.chat.live?.running) throw new Error('Premake is still working on the last change. Try again when it finishes.');
        track('change_requested', { kind: 'design', queued: false, prompt_length: text.length, has_image: false, project_id: id, via: 'assemble' }); // analytics:
        await sendDesign(id, S.chat, text, []);
        if (S.chat.live?.error) throw new Error(S.chat.live.error);
        if (isNarrow()) setRtab('chat');
      },
      href: step => designPath(S.design, 'assemble') + (step ? `?step=${step}` : ''),
      stage: on => asmStage(on),
      share: () => $('#shareBtn')?.click(),
      launch: () => { setRtab('launch'); if (isNarrow()) setPhonePanel(true); },
      back: () => goDesignTab('model'),
    });
  }).catch(err => { asmMod = null; toast?.(err.message); });
}
/** Wire / Close steps on desktop: the model pane beside the step card. */
function asmStage(on) {
  S.asm3d = !!on && S.ctab === 'assemble' && !isNarrow();
  $('#work').classList.toggle('asm-3d', S.asm3d);
  $('#modelPane').hidden = !(S.ctab === 'model' || S.asm3d);
  requestAnimationFrame(() => S.viewer?.resize());
}
$('#shareBtn').onclick = async e => { const b = e.currentTarget; try { (await import('./share.js')).toggleSharePop(b, S.cur); } catch (err) { toast?.(err.message); } }; // share: link popover
// look: viewport background (light / dark), remembered by the viewer in localStorage
function showBg(mode) { const b = $('#bgBtn'); $('span', b).textContent = mode === 'light' ? 'Light' : 'Dark'; b.setAttribute('aria-label', `Viewport background: ${mode}. Switch`); }
try { showBg(localStorage.getItem('buildery.viewportBg.v2') === 'dark' ? 'dark' : 'light'); } catch { showBg('light'); } // same key as viewer.js BG_KEY
$('#bgBtn').onclick = async () => { const v = await getViewer(); if (v) showBg(v.setBackdrop(v.backdrop === 'light' ? 'dark' : 'light')); };
$('#treeToggle').onclick = () => {
  const t = $('#tree');
  if (isNarrow() && window.__mParts) { t.classList.remove('collapsed', 'open-m'); window.__mParts(); } // phones: the Parts bottom sheet (phonestudio.js)
  else if (isNarrow()) { t.classList.remove('collapsed'); t.classList.toggle('open-m'); } else t.classList.toggle('collapsed');
};


// ---------- render mode (product shot) ----------
const lookKey = () => S.cur ? `forma.look.${S.cur.kind}:${S.cur.id}` : null;
function loadLook() {
  let l = null;
  try { l = JSON.parse(localStorage.getItem(lookKey()) || 'null'); } catch {}
  S.look = { all: null, parts: {}, finish: 'printed', backdrop: 'light', transparent: false, ...(l || {}) };
  S.look.parts ||= {};
}
function saveLook() { try { localStorage.setItem(lookKey(), JSON.stringify(S.look)); } catch {} }
async function pushLook() {
  const v = S.viewer; if (!v || !S.look) return;
  if (!v.studio) { const { Studio } = await import('./render.js'); v.studio = v.studio || new Studio(v); }
  v.studio.onPt = onPt;
  v.studio.setOpts({ finish: S.look.finish, backdrop: S.look.backdrop, colors: { all: S.look.all, parts: S.look.parts } });
}
let FIL = null;
async function setRender(on) {
  const v = await getViewer(); if (!v) return;
  if (!FIL) FIL = (await import('./render.js')).FILAMENTS;
  S.render = on;
  await pushLook();
  await v.setRender(on);
  const b = $('#renderBtn'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
  $('#modelPane').classList.toggle('rendering', on);
  renderRenderBar(); renderTree();
}
$('#renderBtn').onclick = () => setRender(!S.render);
matchMedia('(max-width: 640px)').addEventListener?.('change', () => renderRenderBar()); // phone sheet <-> desktop bar
// phone Look sheet: a tap outside it closes it (phonestudio.js, shared with the Parts and Explode sheets)

// ---------- reset view: the 3D preview back to its defaults (colours and finish are kept: they are design choices) ----------
function previewChanged() {
  const v = S.viewer; if (!v?.items?.length) return false;
  return v.hidden.size > 0 || !!v.partmenu?.state.see.length || !!v.partmenu?.state.isolated || Number($('#explode')?.value || 0) > 0
    || $('#ghostBtn')?.classList.contains('on') || !$('#compBtn')?.classList.contains('on') || !!v.fx?.on || !!v.moving
    || !!v.assembly?.steps?.open || (!!v.props && v.props.kind !== 'none') || !!v.wiring?.on || !!v.scaleRef?.on;
}
function resetPreview(opts = {}) { // phonekit: opts.quiet (no toast) when the phone card reopens
  const v = S.viewer; if (!v) return;
  try { v.assembly?.stop?.(false); v.assembly?.steps?.close(); } catch {}
  try { v.fx?.setPower(false); } catch {}
  if (v.moving) v.setMoving(false);
  v.wiring?.set(false); // wireview: Wiring off (and the see-through it turned on)
  v.scaleRef?.set(false); // scaleref
  const r = $('#explode'); if (r && Number(r.value) > 0) { r.value = '0'; r.dispatchEvent(new Event('input', { bubbles: true })); }
  if (v.ui?.explode) v.set('explode', 0);
  if ($('#ghostBtn')?.classList.contains('on')) $('#ghostBtn').click();
  if (!$('#compBtn')?.classList.contains('on')) $('#compBtn').click();
  if (v.props && v.props.kind !== 'none') v.props.set('none', { frame: false });
  v.partmenu?.closeMenu?.();
  if (v.partmenu) { v.partmenu.showAll(); v.partmenu.select(null); } else { v.hidden.clear(); v.apply(); }
  S.selPart = null;
  v.studio?.resetPt?.();
  v.fit();
  renderTree(); renderRenderBar();
  if (!opts.quiet) toast?.('View reset');
}
$('#resetBtn')?.addEventListener('click', resetPreview);

const ic = {
  turn: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M13.5 8a5.5 5.5 0 11-1.6-3.9" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M12.4 1.6v2.9H9.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  save: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M2.5 12.5v1h11v-1" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  spark: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.4 3.4l2 2M10.6 10.6l2 2M12.6 3.4l-2 2M5.4 10.6l-2 2" stroke="currentColor" stroke-width="1.3"/></svg>',
  sun: '<svg viewBox="0 0 16 16" width="13" height="13"><circle cx="8" cy="8" r="3" fill="currentColor"/></svg>',
  asm: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M2.5 9.5l3 3 3-3M5.5 12.5V5M9 2.5h4.5V7M13.5 2.5L9.5 6.5" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  reset: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M3.2 6.2A5.2 5.2 0 1 1 2.8 9.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M2.6 2.8v3.6h3.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  moon: '<svg viewBox="0 0 16 16" width="13" height="13"><circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
};
let PT = { state: 'off', n: 0 };
function onPt(state, n) {
  PT = { state, n };
  const b = $('#rbPt'); if (!b) return;
  const target = S.viewer?.studio?.PT_TARGET || 300;
  b.classList.toggle('on', state === 'running' || state === 'done' || state === 'loading');
  b.style.setProperty('--p', state === 'running' ? (n / target) : state === 'done' ? 1 : 0);
  $('span', b).textContent = state === 'loading' ? 'Loading…' : state === 'running' ? `Photoreal ${Math.round(100 * n / target)}%` : state === 'done' ? 'Photoreal ✓' : b.classList.contains('lk-row') ? 'Photoreal lighting' : 'Photoreal';
  if (state === 'error') { b.hidden = true; ptBroken = true; toast('Photoreal isn’t supported in this browser'); }
}
let ptBroken = false;

// phone: the Look panel is a native-style bottom sheet over the chat (same handlers as the desktop bar, phone markup)
let rbHome = null, rbPrev = null;
function lookSheetMarkup(L, sel, cur, custom, tt) {
  const fil = FIL.find(f => f.hex === cur);
  const curName = !cur ? 'Original' : fil ? fil.label : 'Custom';
  const prev = rbPrev || L; rbPrev = { finish: L.finish, backdrop: L.backdrop };
  const seg = (attr, items, now, was) => `<div class="lk-seg" style="--i:${Math.max(0, items.findIndex(i => i[0] === was))}" data-to="${Math.max(0, items.findIndex(i => i[0] === now))}">${items.map(([v, t]) => `<button type="button" data-${attr}="${v}" class="${now === v ? 'on' : ''}" aria-pressed="${now === v}">${t}</button>`).join('')}</div>`;
  const sw = (cls, on, attrs, label) => `<span class="lk-swc"><button type="button" class="sw ${cls} ${on ? 'on' : ''}" ${attrs} aria-label="${label}"></button></span>`;
  return `
    <div class="lk-head"><div class="m-grab"></div>
      <div class="lk-title">Look</div>
      <button type="button" class="lk-x" aria-label="Close"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      <div class="lk-sub">${sel ? `Colour for ${esc(sel)} <button type="button" class="lk-all">All parts</button>` : 'Tap a part to colour it on its own'}</div>
    </div>
    <div class="lk-body">
      <div class="lk-sec"><span>Colour</span><span class="lk-cur">${esc(curName)}</span></div>
      <div class="lk-sw" role="group" aria-label="Colour">
        ${sw('design', !cur, 'data-col=""', sel ? 'Same as the rest' : 'Original colours')}
        ${FIL.map(f => sw('', cur === f.hex, `data-col="${f.hex}" style="--c:${f.hex}"`, f.label)).join('')}
        <span class="lk-swc"><label class="sw custom ${custom ? 'on' : ''}" style="${custom ? `--c:${custom}` : ''}"><input type="color" id="rbCustom" value="${custom || '#7c5cff'}" aria-label="Custom colour"></label></span>
      </div>
      <div class="lk-sec"><span>Surface</span></div>
      ${seg('finish', [['printed', 'As printed'], ['finished', 'Smoothed']], L.finish, prev.finish)}
      <div class="lk-sec"><span>Background</span></div>
      ${seg('bd', [['light', 'Light'], ['dark', 'Dark']], L.backdrop, prev.backdrop)}
      ${S.viewer?.props?.sheetHTML() || ''}
      <div class="lk-list">
        <button type="button" class="lk-row ${tt ? 'on' : ''}" id="rbTurn" role="switch" aria-checked="${tt}"><i class="lk-ic">${ic.turn}</i><span>Spin</span><i class="lk-switch"></i></button>
        <button type="button" class="lk-row rb-pt" id="rbPt" role="switch" ${ptBroken ? 'hidden' : ''}><span>Photoreal lighting</span><i class="lk-ic">${ic.spark}</i><i class="lk-switch"></i></button>
        <button type="button" class="lk-row" id="rbSave"><i class="lk-ic">${ic.save}</i><span>Save image</span></button>
        <button type="button" class="lk-row" id="rbReset"><i class="lk-ic">${ic.reset}</i><span>Reset view</span></button>
      </div>
    </div>`;
}
function placeLookSheet(bar, phoneUi) {
  if (phoneUi && bar.parentElement !== document.body) { rbHome = [bar.parentElement, bar.nextSibling]; document.body.append(bar); }
  else if (!phoneUi && rbHome && bar.parentElement === document.body) { rbHome[0].insertBefore(bar, rbHome[1]); rbHome = null; }
  bar.classList.toggle('m-look', phoneUi);
  if (phoneUi) { bar.setAttribute('role', 'dialog'); bar.setAttribute('aria-label', 'Look'); } else { bar.removeAttribute('role'); bar.removeAttribute('aria-label'); bar.classList.remove('on'); bar.style.maxHeight = ''; bar.style.transform = ''; }
}
function renderRenderBar() {
  const bar = $('#renderBar');
  const phoneUi = isNarrow();
  placeLookSheet(bar, phoneUi);
  const show = !!S.render && !!S.viewer?.parts().length;
  if (phoneUi) { // slide in / out
    clearTimeout(bar._t);
    if (show) { // fits under the model card
      const top = $('#modelPane')?.getBoundingClientRect().bottom || 0;
      bar.style.maxHeight = Math.max(300, innerHeight - top - 8) + 'px';
    }
    if (show && !bar.classList.contains('on')) { bar.hidden = false; void bar.offsetHeight; bar.classList.add('on'); } // reflow first so it slides up
    else if (!show && !bar.hidden) { bar.classList.remove('on'); rbPrev = null; bar._t = setTimeout(() => { bar.hidden = true; bar.style.transform = ''; }, 380); }
    if (!show) return;
  } else bar.hidden = !show;
  if (!show || !S.look || !FIL) return;
  const L = S.look, sel = S.selPart;
  const cur = sel ? (L.parts[sel] || L.all) : L.all;
  const tt = !!S.viewer.studio?.turntable;
  const custom = cur && !FIL.some(f => f.hex === cur) ? cur : null;
  if (phoneUi) {
    const sx = $('.lk-sw', bar)?.scrollLeft || 0, sy = $('.lk-body', bar)?.scrollTop || 0;
    bar.innerHTML = lookSheetMarkup(L, sel, cur, custom, tt);
    $('.lk-sw', bar).scrollLeft = sx; $('.lk-body', bar).scrollTop = sy;
    void bar.offsetHeight; $$('.lk-seg', bar).forEach(g => g.style.setProperty('--i', g.dataset.to)); // thumb slides from the old choice
    $('.lk-x', bar).onclick = () => setRender(false);
    S.viewer.props?.bindSheet(bar, renderRenderBar); // scene.js: Scene chips
    // build steps: the "Build steps" pill on the model card (phonestudio.js 4c), no longer a row here
    $('#rbReset', bar).onclick = () => resetPreview(); // reset view (keeps the colours)
    const all = $('.lk-all', bar); if (all) all.onclick = () => { S.selPart = null; renderTree(); renderRenderBar(); };
  } else bar.innerHTML = `
    <div class="rb-group rb-colors" title="${sel ? '' : 'Filament colour for all printed parts. Select a part in Parts to colour it on its own.'}">
      <span class="rb-name">${sel ? 'Colour of ' + esc(sel) : 'Colour'}</span>
      ${sel ? `<span class="rb-label" title="Colour for this part only. Click it again in Parts to colour everything.">${esc(sel)}</span>` : ''}
      <button class="sw design ${!cur ? 'on' : ''}" data-col="" title="${sel ? 'Same as the rest' : 'Design colours'}" aria-label="${sel ? 'Same as the rest' : 'Design colours'}"></button>
      ${FIL.map(f => `<button class="sw ${cur === f.hex ? 'on' : ''}" data-col="${f.hex}" style="--c:${f.hex}" title="${f.label}" aria-label="${f.label}"></button>`).join('')}
      <label class="sw custom ${custom ? 'on' : ''}" title="Custom colour" style="${custom ? `--c:${custom}` : ''}"><input type="color" id="rbCustom" value="${custom || '#7c5cff'}" aria-label="Custom colour"></label>
    </div>
    <div class="rb-group seg rb-seg"><span class="rb-name">Surface</span>
      <button data-finish="printed" class="${L.finish === 'printed' ? 'on' : ''}" title="Visible 0.2 mm layer lines, straight off the printer">As printed</button>
      <button data-finish="finished" class="${L.finish === 'finished' ? 'on' : ''}" title="Sanded and smoothed">Smoothed</button>
    </div>
    <div class="rb-group seg rb-seg"><span class="rb-name">Background</span>
      <button data-bd="light" class="${L.backdrop === 'light' ? 'on' : ''}" title="Light backdrop" aria-label="Light backdrop">${ic.sun}<span class="rb-txt">Light</span></button>
      <button data-bd="dark" class="${L.backdrop === 'dark' ? 'on' : ''}" title="Dark backdrop" aria-label="Dark backdrop">${ic.moon}<span class="rb-txt">Dark</span></button>
    </div>
    <div class="rb-group rb-tools"><span class="rb-name">Show</span>
      <button class="tbtn ${tt ? 'on' : ''}" id="rbTurn" aria-pressed="${tt}" title="Turntable: slowly spin the product" aria-label="Turntable">${ic.turn}<span class="rb-txt">Spin</span></button>
      <button class="tbtn rb-pt" id="rbPt" ${ptBroken ? 'hidden' : ''} title="Photoreal: path-traced light. Moving the camera stops it.">${ic.spark}<span>Photoreal</span></button>
      <button class="tbtn" id="rbSave" title="Download a high-resolution PNG">${ic.save}<span>Save image</span></button>
      <label class="rb-check" title="Save with a transparent background"><input type="checkbox" id="rbTransp" ${L.transparent ? 'checked' : ''}>Clear background</label>
    </div>`;
  onPt(PT.state, PT.n);
  const setColor = hex => {
    if (sel) { if (hex) L.parts[sel] = hex; else delete L.parts[sel]; }
    else { L.all = hex || null; if (!hex) L.parts = {}; }
    saveLook(); pushLook(); renderRenderBar(); renderTree(); S.heroStale = true; maybeHero();
  };
  $$('[data-col]', bar).forEach(b => b.onclick = () => setColor(b.dataset.col));
  $('#rbCustom').oninput = e => { const lab = e.target.parentElement; lab.style.setProperty('--c', e.target.value); };
  $('#rbCustom').onchange = e => setColor(e.target.value);
  $$('[data-finish]', bar).forEach(b => b.onclick = () => { L.finish = b.dataset.finish; saveLook(); pushLook(); renderRenderBar(); S.heroStale = true; });
  $$('[data-bd]', bar).forEach(b => b.onclick = () => { L.backdrop = b.dataset.bd; saveLook(); pushLook(); renderRenderBar(); });
  $('#rbTurn').onclick = () => { S.viewer.studio.setTurntable(!S.viewer.studio.turntable); renderRenderBar(); };
  $('#rbPt').onclick = () => { const st = S.viewer.studio; if (PT.state === 'off' || PT.state === 'error') st.startPt(); else st.stopPt(); };
  const tr = $('#rbTransp'); if (tr) tr.onchange = e => { L.transparent = e.target.checked; saveLook(); }; // phone sheet has no clear-background option
  $('#rbSave').onclick = saveImage;
}

async function saveImage() {
  const v = S.viewer; if (!v?.parts().length) return;
  const el = $('#viewport'), w = el.clientWidth, h = el.clientHeight;
  const scale = Math.min(4, Math.max(2, 3000 / Math.max(w, h)));
  const W = Math.round(w * scale), H = Math.round(h * scale);
  const btn = $('#rbSave'); if (btn) btn.disabled = true;
  await new Promise(r => setTimeout(r, 30));
  let url;
  try { url = await v.snapshot({ width: W, height: H, transparent: !!S.look?.transparent }); }
  catch (e) { toast('Couldn’t render the image'); console.warn(e); }
  if (btn) btn.disabled = false;
  if (!url) return;
  const title = (S.cur?.data?.meta?.title || S.cur?.data?.manifest?.title || 'design').replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const a = document.createElement('a'); a.href = url; a.download = `${title || 'design'}-render.png`;
  document.body.appendChild(a); a.click(); a.remove();
  window.__forma.lastSave = { width: W, height: H, transparent: !!S.look?.transparent, url };
  toast(`Saved ${W} × ${H} image`);
}

/** Hero render for the Order tab: regenerated lazily when the model or colours change and the Order tab is open. */
let heroTimer;
function maybeHero() { makeHero(false); }
/** Product render snapshot (user's colour). force: needed now (Website hero fallback), whatever tab is open. */
function makeHero(force) {
  clearTimeout(heroTimer);
  const nudgeOn = !!S.chat.nudge && !S.chat.nudge.dismissed;
  if (force && S.hero && !S.heroStale) { heroReady(); return; }
  if (!S.viewer?.parts().length) { if (force) S.heroWanted = true; return; }
  if (!S.heroStale || (!force && S.rtab !== 'order' && !nudgeOn)) return;
  S.heroWanted = false;
  heroTimer = setTimeout(async () => {
    const id = S.cur?.id;
    if (!S.look) loadLook();
    await pushLook();
    let url = null;
    try { url = await S.viewer.snapshot({ width: 1080, height: 720, camera: 'hero' }); } catch (e) { console.warn(e); }
    if (!url || S.cur?.id !== id) return;
    S.hero = url; S.heroStale = false;
    const img = $('#orderPane .ot-thumb img');
    if (img) { img.src = url; img.closest('.ot-thumb').classList.remove('loading'); } else renderOrder();
    const nimg = $('.order-nudge img');
    if (nimg) nimg.src = url; else if ($('.order-nudge')) renderChat();
    heroReady();
  }, 120);
}

// ---------- price chip: this version's unit price at 10, with the change vs the last version ----------
// Prices are remembered per saved design VERSION (history entry n), recorded only from a fresh quote (record=true,
// from loadQuote) while no run or undo rebuild is in flight, so mid-run builds never count. The delta compares the
// current version with the previous active version; v1 / the original / examples show no delta.
function priceTrack(q, record) {
  if (!S.cur || !q?.tiers?.length) return null;
  const t10 = q.tiers.find(t => t.qty === 10) || q.tiers[0];
  const h = S.cur.kind === 'project' ? S.chat.history : null;
  const out = { qty: t10.qty, price: t10.unit_price, delta: null };
  if (!h?.head) return out;
  const key = `forma.vprice.${S.cur.id}:${q.mode || S.mode}`;
  let rec = {}; try { rec = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch {}
  const settled = !S.chat.live?.running && !(S.restoring?.id === S.cur.id) && !(h.versions || []).some(v => v.current && v.status === 'running');
  if (record && settled && rec[h.head] !== t10.unit_price) { rec[h.head] = t10.unit_price; try { localStorage.setItem(key, JSON.stringify(rec)); } catch {} }
  const prev = (h.versions || []).filter(v => v.active && v.n < h.head).sort((a, b) => b.n - a.n)[0];
  if (settled && prev && rec[prev.n] != null) out.delta = +(t10.unit_price - rec[prev.n]).toFixed(2);
  return out;
}
function renderPriceChip(record) { // top right of the model: the build tutorial (step-by-step assembly), not the price
  void record;
  const el = $('#priceChip');
  const n = S.viewer?.parts().length || 0;
  el.hidden = !(n > 1 && S.viewer?.assembly?.steps);
  if (el.hidden) return;
  if (!el.dataset.tut) {
    el.dataset.tut = '1';
    el.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M5 3.5v9l7-4.5z" fill="currentColor"/></svg><b>Build steps</b><span class="bt-time" hidden></span>`;
    el.title = 'Watch it go together, step by step';
    el.setAttribute('aria-label', el.title);
  }
  // buildtime: best-case build time next to the label ("3m", "45s"), once per model
  const key = `${S.cur?.id}:${S.cur?.data?.manifest?.t || ''}:${n}`;
  if (el.dataset.btKey !== key) {
    el.dataset.btKey = key;
    S.viewer.assembly.steps.estimate?.().then((sec) => {
      if (el.dataset.btKey !== key || !(sec > 0)) return;
      const t = sec < 60 ? `${Math.max(5, Math.round(sec / 5) * 5)}s` : `${Math.round(sec / 60)}m`;
      const span = el.querySelector('.bt-time'); if (!span) return;
      span.textContent = t; span.hidden = false;
      el.title = `Watch it go together, step by step. Best case about ${t} to build.`;
      el.setAttribute('aria-label', el.title);
    }).catch(() => {});
  }
  el.onclick = async () => { if (S.render) await setRender(false); S.viewer.assembly.steps.show(); };
}

// ---------- order pill + post-run nudge ----------
function tier1() { return S.quote?.tiers?.find(t => t.qty === 1) || null; }
function renderOrderPill() {
  const el = $('#orderPill'), t = tier1();
  el.hidden = !t || !S.cur?.data?.manifest?.parts?.length;
  if (el.hidden) return;
  el.innerHTML = `<span class="op-ic">${cartSvg}</span><span class="op-t"><b>Buy the parts</b><span>Shops and files for every part</span></span><span class="op-go">→</span>`; // order tab: where to buy, not a checkout
}
const cartSvg = '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M2 3h1.8l1.4 7.2h7.3L14 5H4.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="6" cy="13" r="1" fill="currentColor"/><circle cx="12" cy="13" r="1" fill="currentColor"/></svg>';
function orderPrototype() { setRtab('order'); renderOrder(); } // the Order tab: every part and where to buy it
$('#orderPill').onclick = () => orderPrototype();
function nudgeHtml(c) {
  const n = c.nudge;
  if (!n || n.dismissed || n.at !== c.messages.length || c.live?.running || S.cur?.readOnly) return '';
  const t = tier1(); if (!t) return '';
  return `<div class="order-nudge" role="note">
    <button class="icon-btn on-x" data-nudge-x aria-label="Dismiss"><svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5"/></svg></button>
    ${S.hero ? `<img src="${S.hero}" alt="">` : ''}
    <div class="on-t"><b>Looks good? Get the parts</b>
      <span>Every part with the shops that sell or make it, and the files to upload.</span>
      <button class="btn primary sm" data-nudge-go>${cartSvg}Where to buy</button></div></div>`;
}
function wireNudge(el) {
  const x = $('[data-nudge-x]', el); if (x) x.onclick = e => { e.stopPropagation(); if (S.chat.nudge) S.chat.nudge.dismissed = true; $('.order-nudge', el)?.remove(); };
  const g = $('[data-nudge-go]', el); if (g) g.onclick = e => { e.stopPropagation(); orderPrototype(); };
}
window.__forma = {
  /** Test hook: show the post-run order card as if a design run just finished. */
  nudge() {
    if (!S.chat.messages.length) S.chat.messages.push({ role: 'user', text: '(test) Make it 10 mm taller', t: Date.now() / 1000 }, { role: 'assistant', text: '(test) Done. Rebuilt and re-quoted.', t: Date.now() / 1000 });
    S.chat.nudge = { at: S.chat.messages.length, fresh: true }; renderChat(); maybeHero();
  },
  state: S,
  appBuild: () => { if (S.cur?.kind === 'project' && !S.cur.readOnly) agentSend(S.cur.id, 'app', FIRST_PROMPT); }, // app-preview: the phone App sheet
  appRunning: () => (S.cur?.kind === 'project' ? !!runEntry(S.cur.id).app.live?.running : false),
  resetPreview: o => resetPreview(o), previewChanged, // reset view: the toolbar, the parts list and the phone sheets (phonestudio.js)
  // phonekit (web/phonestudio.js): the ☰ menu's Undo / Redo / Versions, the part sheet's Ask / colour
  history: () => (S.cur?.kind === 'project' ? chatOf(chatTarget()).history : null),
  historyBusy: () => chatHistory.busy() || historyBusy,
  historyAct: (a, arg) => historyAct(a, arg),
  colorPart: (name, hex) => colorPart(name, hex),
  askPart: (name, p, q) => askPart(name, p, q),
  canEdit: () => S.cur?.kind === 'project' && !S.cur.readOnly && S.cur.role !== 'copy',
  renderTree: () => renderTree(),
  setRtab: t => setRtab(t), // phones: the right menu and the Order / Launch sheets (web/phonestudio.js)
  titleChanged: (id, t) => applyTitle(id, t), // agentbrain: rename (web/rename.js)
};
/** agentbrain: a design's title changed (auto title after the first reply, or a rename). */
function applyTitle(id, t) {
  if (!t) return;
  const r = RUNS.get(id); if (r) r.title = t;
  if (isCurProject(id) && S.cur?.data) { (S.cur.data.meta ||= {}).title = t; if (onStudioFor(id)) setCrumb(t); canonicalize(); }
  loadProjects();
}
// agentbrain: question-card answers and the Continue button (web/askcard.js) send a design message
addEventListener('formery:send', e => {
  const { text, answers } = e.detail || {};
  if (!text || !S.cur || S.cur.readOnly || S.cur.kind !== 'project' || chatTarget() !== 'design' || S.chat.live?.running) return;
  track('change_requested', { kind: 'design', queued: false, prompt_length: text.length, has_image: false, project_id: S.cur.id, via: answers ? 'question_card' : 'card' }); // analytics:
  sendDesign(S.cur.id, S.chat, text, [], answers ? { answers } : null);
});

// askmock: a question-card option's mock-up over the model (web/askcard.js -> viewer.askMock, web/askpreview.js)
addEventListener('formery:askmock', e => {
  const sk = e.detail?.mock;
  if (sk) { if (S.cur?.kind === 'project') getViewer().then(v => { if (v?.askMock && S.cur?.kind === 'project') v.askMock.show(sk); }); }
  else S.viewer?.askMock?.clear();
});

// ---------- center tabs: Model | Code | Website | Ads (the only part of the shell that swaps) ----------
const CTABS = ['model', 'assemble', 'code', 'site', 'ads', 'app'];
function setCtab(t) {
  if (!CTABS.includes(t)) t = 'model';
  if (matchMedia('(max-width: 640px)').matches && t !== 'assemble') t = 'model'; // phones: Website / Ads / Code are hidden, always the 3D model; Assemble is a full-screen view
  const changed = S.ctab !== t, before = chatTarget();
  S.ctab = t;
  $$('[data-ctab]').forEach(b => { const on = b.dataset.ctab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
  $('#modelPane').hidden = t !== 'model'; $('#codePane').hidden = t !== 'code';
  $('#sitePane').hidden = t !== 'site'; $('#adsPane').hidden = t !== 'ads'; $('#appPane').hidden = t !== 'app';
  $('#asmPane').hidden = t !== 'assemble';
  if (t !== 'assemble' && changed) { asmMod?.then(m => m.leaveAssemble()); asmStage(false); }
  if (t === 'model') S.viewer?.resize();
  if (t === 'site' || t === 'ads' || t === 'app' || t === 'assemble') renderCenterTab();
  syncLaunchPreview();
  syncAppNudge(); // app-preview: the pill lives over the model only
  if (changed) {
    $('.work > .tabbar .tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (chatTarget() !== before) { closeVersions(); renderChat(); } // Model <-> Code: same design chat, untouched
  }
}
function renderCenterTab() {
  if (!S.design || !(S.route?.name === 'project' || S.route?.name === 'example')) return;
  if (S.ctab === 'site') renderStore($('#sitePane'), pageCtx(S.design));
  else if (S.ctab === 'ads') renderAds($('#adsPane'), pageCtx(S.design));
  else if (S.ctab === 'app') renderAppTab();
  else if (S.ctab === 'assemble') renderAsm();
}
// ---------- apps: the App tab (web/appview.js). Shown when the design has electronics or an app/ folder (server apps.info).
// app-preview: an example with an app (the showcase copies app/) shows the tab too: "Try the app", demo data, read-only.
function appInfo() {
  if (S.cur?.kind === 'project') return S.cur.data?.app || null;
  const a = S.cur?.kind === 'example' ? S.cur.data?.app : null;
  return a?.exists ? { show: true, exists: true, name: a.name, example: { slug: S.cur.id, url: a.url } } : null;
}
function syncAppTab() {
  const show = !!appInfo()?.show;
  $('#appTabBtn').hidden = !show;
  $('#appTabBtn').textContent = appInfo()?.example ? 'Try the app' : 'App';
  if (!show && S.ctab === 'app' && S.cur?.data) setCtab('model'); // another design without electronics (data loaded)
  syncAppNudge();
}
function renderAppTab() {
  if (!S.cur?.data) return;
  const info = appInfo();
  if (info?.example) { renderAppPane($('#appPane'), { id: S.cur.id, title: S.cur.data.meta?.title || '', info, example: info.example }); return; }
  if (S.cur.kind !== 'project') return;
  const id = S.cur.id, c = runEntry(id).app, L = c.live;
  renderAppPane($('#appPane'), { id, title: S.cur.data.meta?.title || '', info: info || {}, running: !!L?.running,
    step: L?.steps?.length ? L.steps[L.steps.length - 1] : '', build: text => { setRtab('chat'); agentSend(id, 'app', text); } });
}
// app-preview: a subtle pill over the model when a design with electronics finishes a run: "Your app is ready" (open the
// App tab) or "This has electronics · Build its phone app". Once per design and state; × hides it for good.
const NUDGE_KEY = 'premake.appNudge';
const nudgeSeen = () => { try { return JSON.parse(localStorage.getItem(NUDGE_KEY) || '{}') || {}; } catch { return {}; } };
function appNudge(id) {
  const info = appInfo();
  if (!isCurProject(id) || S.cur.readOnly || sharedRole() || !info?.show || S.ctab === 'app') return;
  const state = info.exists ? 'ready' : 'build';
  if (nudgeSeen()[id] === state) return;
  S.appNudge = { id, state };
  syncAppNudge();
}
function syncAppNudge() {
  let el = $('#appNudge');
  const n = S.appNudge, on = !!n && isCurProject(n.id) && S.ctab === 'model' && !!appInfo()?.show;
  if (!on) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div'); el.id = 'appNudge'; el.className = 'ap-nudge'; el.setAttribute('role', 'status');
    $('#modelPane').append(el);
  }
  const ready = n.state === 'ready';
  el.innerHTML = `<button type="button" class="ap-nudge-go">${ready ? 'Your app is ready <b>See it</b>' : 'This has electronics <b>Build its phone app</b>'}</button>
    <button type="button" class="ap-nudge-x" aria-label="Hide"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>`;
  const done = () => { const seen = nudgeSeen(); seen[n.id] = n.state; try { localStorage.setItem(NUDGE_KEY, JSON.stringify(seen)); } catch {} S.appNudge = null; el.remove(); };
  el.querySelector('.ap-nudge-go').onclick = () => { done(); goDesignTab('app'); };
  el.querySelector('.ap-nudge-x').onclick = done;
}
/** The app agent saved a file, or its run finished: fresh info (has the app appeared?) and a fresh preview. */
async function appChanged(id) {
  if (!isCurProject(id)) return;
  try { const r = await api.appMessages(id); if (isCurProject(id) && S.cur.data) S.cur.data.app = r.info || S.cur.data.app; } catch {}
  if (!isCurProject(id)) return;
  syncAppTab();
  if (S.ctab === 'app') { renderAppTab(); reloadAppPreview($('#appPane')); }
}
const legacyHref = h => (h.startsWith('#/') ? legacyToPath(h) : h); // urls: an old #/ route as a clean href
/** Tab click. Website and Ads have their own routes (#/site/..., #/ads/...); Model and Code share the studio route. */
function goDesignTab(t) {
  const d = S.design; if (!d) return;
  if (t === 'site' || t === 'ads' || t === 'app' || t === 'assemble') { go(designPath(d, t)); return; }
  if (S.route?.tab) { S.wantCtab = t; go(designPath(d)); return; }
  setCtab(t);
}
$$('[data-ctab]').forEach(b => b.onclick = () => goDesignTab(b.dataset.ctab));
function renderCode() {
  const code = S.cur?.data?.code;
  $('#code').innerHTML = code ? highlightPython(code) : '<div class="code-empty">No design.py yet. It appears here once the agent writes it.</div>';
}

// right tabs (and mobile bottom tabs)
function setRtab(t) {
  if (t !== S.rtab && (t === 'order' || t === 'launch')) track(t === 'order' ? 'order_opened' : 'launch_opened', { design: S.design?.project ? 'project' : S.design?.example ? 'example' : null }); // analytics:
  if (t === 'launch' && S.rtab !== 'launch') S.lprev = 'guide'; // Launch opens on the guide preview
  S.rtab = t; syncRunPill();
  document.body.classList.remove('m-model'); // phones: back from the full-height Model view
  $$('[data-rtab]').forEach(b => b.classList.toggle('on', b.dataset.rtab === t));
  $$('[data-mtab]').forEach(b => b.classList.toggle('on', b.dataset.mtab === t));
  $('#chatPane').hidden = t !== 'chat'; $('#orderPane').hidden = t !== 'order'; $('#launchPane').hidden = t !== 'launch';
  if (t === 'order') maybeHero();
  if (t === 'launch') renderLaunch($('#launchPane'), { ...pageCtx(S.design), preview: m => launchPreviewOn() && (setLaunchPreview(m), true) });
  syncLaunchPreview();
  document.dispatchEvent(new CustomEvent('forma:rtab', { detail: t })); // phones: Order / Launch open as sheets (web/phonestudio.js)
}
// Phones: tapping Chat / Order / Launch opens that panel full screen; "Model" goes back to the split view
const isPhone = () => matchMedia('(max-width: 640px)').matches;
function setPhonePanel(full) { document.body.classList.toggle('m-panel', full); S.viewer?.resize?.(); }
$$('[data-rtab]').forEach(b => b.onclick = () => { setRtab(b.dataset.rtab); if (isPhone()) setPhonePanel(true); });
$('#mModelTab').onclick = () => setPhonePanel(false);
// Launch tab open on a project (desktop): the center shows the build guide page (or the website) instead of the model.
// The model / code panes are only hidden by CSS (.work.lp-on), so the viewer, its camera and the loaded model stay put.
function launchPreviewOn() { return false && S.rtab === 'launch' && /* make: the Make tab keeps the model in the center (guide preview moves to the future More tab) */ S.route?.name === 'project' && !!S.design?.project && !isNarrow(); }
function setLaunchPreview(m) { S.lprev = m === 'site' ? 'site' : 'guide'; syncLaunchPreview(); }
function syncLaunchPreview() {
  const on = launchPreviewOn(), site = on && S.lprev === 'site', w = $('#work'), was = w.classList.contains('lp-on');
  w.classList.toggle('lp-on', on); w.classList.toggle('lp-site', site);
  $('#lpTabs').hidden = !on;
  $$('[data-lprev]').forEach(b => { const v = b.dataset.lprev === S.lprev; b.classList.toggle('on', v); b.setAttribute('aria-selected', String(v)); });
  $('#guidePane').hidden = !on || site;
  $('#sitePane').hidden = !site && S.ctab !== 'site';
  if (on && !site) renderGuidePreview($('#guidePane'), pageCtx(S.design));
  if (site && S.ctab !== 'site') renderStore($('#sitePane'), pageCtx(S.design));
  if (was && !on && S.ctab === 'model') S.viewer?.resize();
}
$$('[data-lprev]').forEach(b => b.onclick = () => setLaunchPreview(b.dataset.lprev));
matchMedia('(max-width: 640px)').addEventListener?.('change', () => syncLaunchPreview());
// phones: "Model" gives the 3D view the whole height (Chat and Order hide); Chat / Order go back to the split
function setMobileModel() {
  document.body.classList.add('m-model');
  $$('[data-mtab]').forEach(b => b.classList.toggle('on', b.dataset.mtab === 'model'));
}
$$('[data-mtab]').forEach(b => b.onclick = () => b.dataset.mtab === 'model' ? setMobileModel() : setRtab(b.dataset.mtab));

// ---------- chat: one UI, three agents + a human ----------
// The right panel's chat talks to the design agent on Model/Code, the website agent on Website and the ads agent on
// Ads. Each keeps its own history, undo and run state (RUNS). Live support is the call bubble (web/support.js).
const TARGETS = {
  design: { who: 'Editing the 3D design', noun: 'design', placeholder: 'Ask for a change…', working: 'Agent is working…' },
  site: { who: 'Editing the website', noun: 'page', placeholder: 'Ask for a page change…', working: 'Editing the page…' },
  ads: { who: 'Editing the ads', noun: 'ads', placeholder: 'Ask for an ad change…', working: 'Editing the ads…' },
  app: { who: 'Editing the app', noun: 'app', placeholder: 'Ask for an app change…', working: 'Building the app…' }, // apps:
};
// Page / ads chat suggestions: generic, with the audience taken from the design's first tag when it has one.
const starterAudience = () => { const t = (S.cur?.data?.meta?.tags || []).find(x => x && x.length <= 24); return t ? `people into ${String(t).toLowerCase()}` : 'first-time buyers'; };
const SITE_STARTERS = () => ['Make it darker and more premium', `Rewrite the headline for ${starterAudience()}`, 'Change the button to Join the waitlist', 'Add a short FAQ section'];
const ADS_STARTERS = () => ['Make the headlines punchier', `Target ${starterAudience()}`, 'Use a darker palette on ad 3', 'Write 3 more variations'];
const chatTarget = () => (S.ctab === 'site' ? 'site' : S.ctab === 'ads' ? 'ads' : S.ctab === 'app' ? 'app' : 'design');
const APP_STARTERS = ['Make the readings bigger on the home screen', 'Add a weekly summary card', 'Show a watering log', 'Use a calmer green theme']; // apps:
/** Chat state for a target of the current design. */
function chatOf(kind) {
  if (kind === 'design' || !S.cur) return S.chat;
  if (S.cur.kind !== 'project') return { messages: [], live: null, steps: {}, loaded: true };
  return runEntry(S.cur.id)[kind];
}
const anyBusy = () => !!(S.chat.live?.running || (S.cur?.kind === 'project' && (siteBusy(runEntry(S.cur.id)) || adsBusy(runEntry(S.cur.id)) || appBusy(runEntry(S.cur.id)))));
// "Building" pill in the right panel's tab bar: only when the chat (and its live Thinking block) isn't in view.
function syncRunPill() { $('#runPill').hidden = !(anyBusy() && S.rtab !== 'chat'); }
/** Re-render the chat if it is showing this project's `kind` thread. */
function chatChanged(id, kind) { if (isCurProject(id) && chatTarget() === kind) renderChat(); else syncRunPill(); }

function readOnlyCard(cur, tgt) {
  const m = cur.data?.meta || {};
  const line = tgt === 'site' ? 'This is an example’s product page. Remix the design to get your own copy, then change the page by chatting.'
    : tgt === 'ads' ? 'These are an example’s ads. Remix the design to get your own copy, then improve the ads by chatting.'
    : matchMedia('(max-width: 640px)').matches ? 'Tap Order on the model to see what it costs to make.' // mqa: phones have no Code tab
    : 'Open the Code tab to read the CadQuery source, or Order to see what it costs to make.';
  return `<div class="msg assistant"><div class="body"><p><b style="color:var(--text)">${esc(m.title || cur.id)}</b>${m.creator ? ` <span class="muted">by ${esc(m.creator)}</span>` : ''}</p>
    ${m.description ? `<p>${esc(m.description)}</p>` : ''}
    ${(m.tags || []).length ? `<p class="muted small">${m.tags.map(esc).join(' · ')}</p>` : ''}
    <p class="muted">${line}</p></div></div>`;
}
// Live support: the floating call bubble at the top right of the Chat pane (web/support.js)
function renderChatMode() {
  const cur = S.cur, show = !!cur && S.route?.name !== 'pick';
  const own = cur?.kind === 'project' && !cur.readOnly && !sharedRole(); // share: support is about your own design
  supportBubble.sync({ show, project: own ? cur.id : null, example: cur && cur.kind !== 'project' ? cur.id : null, title: cur?.data?.meta?.title || '', admin: !!ACCESS.admin });
}
function renderChat() {
  const el = $('#msgs'), cur = S.cur, tgt = chatTarget(), T = TARGETS[tgt];
  syncRunPill(); renderVpStatus(); renderChatMode();
  const pick = S.route?.name === 'pick';
  if (pick || !cur) {
    el.innerHTML = `<div class="empty-chat"><h3>Pick a design</h3><p>Choose one of your projects or an example. Its chat, website and ads open here.</p></div>`;
    $('#composer').hidden = true; $('#remixCard').hidden = true; $('#undoBar').innerHTML = ''; renderVersions();
    return;
  }
  const c = chatOf(tgt);
  const running = !!c.live?.running;
  $('#chatWho').textContent = T.who;
  $('#chatInput').placeholder = sharedRole() === 'copy' ? 'Ask for a change. You get your own copy.' : T.placeholder; // share: copy links fork on send
  $('#stopBtn').hidden = !running;
  // chatlook: no status labels in the composer (the live thinking line in the thread says it); only "N queued" when there are
  $('#chatWho').hidden = true;
  $('#chatHint').textContent = c.queue?.length ? `${c.queue.length} queued` : '';
  $('#chatHint').hidden = !c.queue?.length;
  renderUndoBar(running); renderVersions();
  $('#composer').hidden = !!cur.readOnly; $('#remixCard').hidden = !cur.readOnly;
  if (cur.readOnly) { el.innerHTML = readOnlyCard(cur, tgt); return; }
  const unavailable = tgt !== 'design' && c.unavailable;
  $('#chatInput').disabled = !!unavailable;
  $('#sendBtn').disabled = (running && tgt !== 'design') || !!unavailable; // design chat: sending while busy queues
  if (tgt !== 'design' && !c.loaded && !c.loading) loadAgentChat(cur.id, tgt);
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  if (unavailable) {
    el.innerHTML = `<div class="empty-chat"><h3>Ads chat</h3><p>Available after the next server restart. Until then, edit any ad text right on the cards.</p></div>`;
    return;
  }
  if (!c.messages.length && !c.live) {
    let html;
    if (tgt === 'site') html = `<div class="empty-chat"><h3>Change anything on this page</h3><p>Describe it in plain English. The page agent rewrites copy, adds or reorders sections and restyles the page. It can’t touch the 3D model.</p>
      ${SITE_STARTERS().map(s => `<button class="starter">${esc(s)}</button>`).join('')}</div>`;
    else if (tgt === 'ads') html = c.noAds
      ? `<div class="empty-chat"><h3>Improve the ads by chatting</h3><p>Generate the ads first (button in the middle). Then ask for changes here: punchier headlines, a new audience, a different palette or more variations.</p></div>`
      : `<div class="empty-chat"><h3>Improve the ads by chatting</h3><p>The ads agent edits the copy, palettes and order of your ads. It keeps the honest pre-order framing and Meta’s length limits.</p>
      ${ADS_STARTERS().map(s => `<button class="starter">${esc(s)}</button>`).join('')}</div>`;
    else if (tgt === 'app') html = appInfo()?.exists // apps:
      ? `<div class="empty-chat"><h3>Shape the app by chatting</h3><p>The app agent writes the phone app for this product: its screens, charts, profiles and alerts. It can’t touch the 3D model or the firmware.</p>
        ${APP_STARTERS.map(s => `<button class="starter">${esc(s)}</button>`).join('')}</div>`
      : `<div class="empty-chat"><h3>A phone app for this product</h3><p>Press Build the app, or describe the app you want. The app agent writes it from this design’s parts and firmware; it can’t touch the 3D model.</p>
        <button class="starter">${esc(FIRST_PROMPT)}</button></div>`;
    else {
      const hasModel = !!cur?.data?.manifest?.parts?.length;
      html = hasModel
        ? `<div class="empty-chat"><h3>Make it yours</h3><p>Ask for any change. The agent edits the CadQuery source, rebuilds the parts and updates the quote.</p>
          ${EDIT_STARTERS.map(s => `<button class="starter">${esc(s)}</button>`).join('')}</div>`
        : `<div class="empty-chat"><h3>What should we build?</h3><p>Describe the product. The agent writes CadQuery, exports printable parts and picks real hardware you can buy.</p>
          ${PROJECT_STARTERS.map(s => `<button class="starter">${esc(s)}</button>`).join('')}</div>`;
    }
    el.innerHTML = html;
    $$('.starter', el).forEach(b => b.onclick = () => { $('#chatInput').value = b.textContent; autoGrow(); $('#chatInput').focus(); });
    return;
  }
  el.innerHTML = threadHtml(c, { editable: !running && !!api.undo, parts: tgt === 'design', firstRun: tgt === 'design' && isFirstRun() }) + (tgt === 'design' ? queueHtml(c) + nudgeHtml(c) : '');
  if (tgt === 'design') { wireNudge(el); $$('[data-qx]', el).forEach(b => b.onclick = () => { c.queue.splice(+b.dataset.qx, 1); renderChat(); }); }
  wireLiveToggle(el, c.live);
  if (atBottom || running || c.nudge?.fresh) { el.scrollTop = el.scrollHeight; if (c.nudge) c.nudge.fresh = false; }
}

/** Website / ads chat history for a project (loaded on first view, then kept up to date by events). */
async function loadAgentChat(id, kind) {
  const c = runEntry(id)[kind];
  c.loading = true;
  try {
    const r = kind === 'site' ? await api.siteMessages(id) : kind === 'app' ? await api.appMessages(id) : await api.adsMessages(id);
    c.messages = r.messages || []; c.history = r.history || null; c.loaded = true; c.unavailable = false;
    if (kind === 'ads') c.noAds = r.has_ads === false;
    if (kind === 'app' && r.info && isCurProject(id) && S.cur.data) { S.cur.data.app = r.info; syncAppTab(); } // apps:
    if (r.running && !c.live?.running) c.live = { steps: [], text: '', running: true };
    if (!r.running && c.live?.running) c.live = null;
  } catch (e) {
    c.loaded = true;
    if (e.status === 404 || e instanceof TypeError) c.unavailable = true; // older server (or mock): no ads chat yet
  }
  c.loading = false;
  updateRunIndicator(); chatChanged(id, kind);
}
async function agentSend(id, kind, text, att = []) { // images: att = [{ id, url }]
  const c = runEntry(id)[kind];
  if (!text || c.live?.running) return;
  c.messages.push({ role: 'user', text, t: Date.now() / 1000, attachments: att, ...(isCurProject(id) && sharedRole() || c.messages.some(m => m.by) ? { by: 'You' } : {}) }); // share: labelled like the rest
  c.live = { steps: [], text: '', running: true };
  runEntry(id).sentAt = Date.now(); kickPoll(id);
  chatChanged(id, kind); updateRunIndicator();
  try { await (kind === 'site' ? api.siteSend(id, text, att.map(a => a.id)) : kind === 'app' ? api.appSend(id, text) : api.adsSend(id, text, att.map(a => a.id))); }
  catch (err) {
    if (err.status === 404) { c.unavailable = true; c.messages.pop(); c.live = null; }
    else c.live = { steps: [], text: '', running: false, error: err.status === 409 ? (err.message || 'Already working. Wait for it or press Stop.') : err.message };
    chatChanged(id, kind); updateRunIndicator();
  }
}

// ---------- undo / rewind / versions (per chat target) ----------
function renderUndoBar(running) {
  const show = S.cur?.kind === 'project' && !!api.undo;
  $('#undoBar').innerHTML = show ? undoBarHtml(chatOf(chatTarget()).history, running) : '';
}
const chatHistory = {
  get noun() { return TARGETS[chatTarget()].noun; },
  busy: () => !!chatOf(chatTarget()).live?.running || S.cur?.kind !== 'project',
  rewind: i => historyAct('rewind', i),
  restore: n => historyAct('restore', n),
  undo: () => historyAct('undo'),
  redo: () => historyAct('redo'),
};
wireHistory($('#msgs'), $('#undoBar'), $('#chatPane'), $('#chatInput'), chatHistory);
// designing: the chat's top fade (support.css) only once the thread is scrolled away from its first message
{ const m = $('#msgs'), sync = () => {
    const on = m.scrollTop > 4; if (m.classList.contains('scrolled') !== on) m.classList.toggle('scrolled', on);
    m.style.setProperty('--msgs-fade', Math.min(64, Math.round(m.scrollTop)) + 'px');
  };
  m.addEventListener('scroll', sync, { passive: true }); new ResizeObserver(sync).observe(m); }

let historyBusy = false;
let historyToast = { label: '', until: 0 }; // keeps "Rewound to v3" visible over the quote / model toasts that follow it
async function historyAct(action, arg) {
  const kind = chatTarget(), c = chatOf(kind);
  if (!S.cur || S.cur.kind !== 'project' || c.live?.running || historyBusy || !api.undo) return;
  const id = S.cur.id;
  const before = c.history?.head; // phonekit: a rewind's toast offers "Go forward" (restore the version it left)
  historyBusy = true;
  // Design: the server rebuilds the old model (a few seconds). Show "Restoring…" over the viewer right away so the
  // current model doesn't look like the result; cleared on model_updated (or after 45 s).
  const restoring = kind === 'design' ? (S.restoring = { id, label: action === 'redo' ? 'Redoing' : action === 'undo' ? 'Undoing' : 'Restoring', until: Date.now() + 45000 }) : null;
  if (restoring) { renderVpStatus(); setTimeout(() => { if (S.restoring === restoring) { S.restoring = null; if (isCurProject(id)) renderVpStatus(); } }, 45000); }
  try {
    const r = action === 'rewind' ? await api.rewind(id, kind, arg) : action === 'restore' ? await api.restore(id, kind, arg) : await api[action](id, kind);
    const st = kind === 'design' ? runEntry(id).chat : runEntry(id)[kind];
    st.messages = r.messages || st.messages; st.history = r.history;
    if (st.live && !st.live.running) st.live = null;
    if (kind === 'design') st.nudge = null; // the "order this" card belonged to the version that was just undone
    historyToast = { label: r.label || 'Restored', until: Date.now() + 15000 };
    if (kind === 'site') siteChanged(id);
    if (kind === 'ads') adsChanged(id);
    if (kind === 'app') appChanged(id); // apps:
    if (isCurProject(id)) {
      closeVersions(); renderChat();
      const back = (action === 'rewind' || action === 'undo') && before && isNarrow() && r.history?.head !== before;
      historyToast.back = back ? { label: 'Go forward', run: () => historyAct('restore', before) } : null;
      toast(historyToast.label, historyToast.back || undefined);
    }
  } catch (e) { if (S.restoring === restoring) { S.restoring = null; renderVpStatus(); } toast(e.status === 409 ? 'Wait for the agent to finish, then try again' : e.message); }
  historyBusy = false;
}

function renderVersions() {
  const h = S.cur ? chatOf(chatTarget()).history : null, btn = $('#verBtn');
  const show = S.cur?.kind === 'project' && !!h?.versions?.length;
  btn.hidden = !show;
  if (!show) { closeVersions(); return; }
  $('#verCur').textContent = h.current_v ? `v${h.current_v}` : 'original';
  if (!$('#verPop').hidden) drawVersions();
}
function drawVersions() {
  const c = chatOf(chatTarget()), h = c.history, pop = $('#verPop');
  if (!h) return;
  const running = !!c.live?.running;
  const item = (n, label, title, sub, cur, off) => `<button class="ver-item${cur ? ' cur' : ''}${off ? ' off' : ''}" role="menuitem" data-ver="${n}" ${running || cur ? 'disabled' : ''}>
      <span class="vn">${esc(label)}</span><span class="vt"><b>${esc(title)}</b><small>${sub}</small></span>${cur ? '<span class="vtag">Current</span>' : off ? '<span class="vtag">Undone</span>' : ''}</button>`;
  pop.innerHTML = `<div class="ver-head"><b>${{ design: 'Design versions', site: 'Page versions', ads: 'Ads versions', app: 'App versions' }[chatTarget()]}</b><span>${running ? 'Available when the agent finishes' : 'Click one to go back to it. Nothing is lost.'}</span></div>
    <div class="ver-list">${h.versions.map(v => item(v.n, `v${v.v}`, v.summary || v.prompt || 'Change',
      `${esc(v.prompt ? '“' + v.prompt.slice(0, 70) + (v.prompt.length > 70 ? '…' : '') + '”' : '')} · ${esc(ago(v.t))}${v.files?.length ? ` · ${v.files.length} file${v.files.length === 1 ? '' : 's'}` : ''}${v.status === 'failed' ? ' · stopped early' : ''}`,
      v.current, !v.active)).join('')}
    ${item(0, 'v0', 'Original', 'Before the first chat change', !h.head, false)}</div>`;
}
function closeVersions() { $('#verPop').hidden = true; $('#verBtn').setAttribute('aria-expanded', 'false'); $('#verBtn').classList.remove('on'); }
$('#verBtn').onclick = e => {
  e.stopPropagation();
  if (!$('#verPop').hidden) { closeVersions(); return; }
  drawVersions(); $('#verPop').hidden = false; $('#verBtn').setAttribute('aria-expanded', 'true'); $('#verBtn').classList.add('on');
};
$('#verPop').onclick = e => {
  e.stopPropagation();
  const b = e.target.closest('[data-ver]'); if (!b || b.disabled) return;
  historyAct('restore', +b.dataset.ver);
};
addEventListener('click', e => { if (!$('#verPop').hidden && !e.target.closest('#verPop, #verBtn')) closeVersions(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#verPop').hidden) closeVersions(); });

function autoGrow() { const t = $('#chatInput'); t.style.height = 'auto'; t.style.height = Math.min(180, t.scrollHeight) + 'px'; }
// images: paste / drop / pick images in the chat composer (agent chats only; uploads start right away)
const chatAtt = attachImages({ box: $('#composer .cbox'), textarea: $('#chatInput'), strip: { before: $('#chatInput') }, button: { into: $('#composer .cbar') },
  projectId: () => (S.cur?.kind === 'project' && !S.cur.readOnly ? S.cur.id : null), enabled: () => S.cur?.kind === 'project' && !S.cur.readOnly && chatTarget() !== 'app' }); // no "Screenshot the 3D view" button (owner: removed); apps: the app agent reads ./app only, so no images
// chattools: parts referenced in the next message (hover Ask, the "Ask about <part>" chip after a click, phone tap + Ask)
const partCtx = partContext({ cbox: $('#composer .cbox'), textarea: $('#chatInput'), before: $('#composer .cbox'), viewer: () => S.viewer,
  enabled: () => S.cur?.kind === 'project' && !S.cur.readOnly });
// colours: a filament swatch in the hover tooltip recolours a printed part now and saves it (meta.json colors, no AI run)
async function colorPart(name, hex) {
  const v = S.viewer, id = S.cur?.id, it = v?.items.find(x => x.p.name === name);
  if (!it || !id) return;
  const was = { color: it.p.color, design: it.p.design_color };
  v.setPartColor(name, hex); renderTree();
  S.colorSavedAt = Date.now();
  track('part_color_changed', { color: hex, project_id: id }); // analytics:
  try { await api.partColor(id, name, hex); }
  catch (e) {
    if (S.cur?.id === id) { it.p.color = was.color; if (was.design) it.p.design_color = was.design; else delete it.p.design_color; v.tintItem(it); renderTree(); }
    toast(e.message);
  }
}
function askPart(name, p, question) {
  if (!S.cur || S.cur.readOnly || S.cur.kind !== 'project') { toast(S.cur?.readOnly ? 'Remix this design to ask about its parts' : 'Open your project to ask about a part'); return; }
  setRtab('chat');
  partCtx.add(name);
  if (question) { $('#chatInput').value = question; autoGrow(); sendChat(); } // a suggested question or typed one: send it now
  else $('#chatInput').focus();
}
$('#chatInput').oninput = autoGrow;
$('#chatInput').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); } };
$('#sendBtn').onclick = sendChat;
$('#stopBtn').onclick = async () => {
  if (!S.cur) return;
  const kind = chatTarget();
  $('#stopBtn').disabled = true;
  try { await (kind === 'site' ? api.siteStop(S.cur.id) : kind === 'ads' ? api.adsStop(S.cur.id) : kind === 'app' ? api.appStop(S.cur.id) : api.stop(S.cur.id)); } catch (e) { toast(e.message); }
  $('#stopBtn').disabled = false;
};
async function sendChat() {
  let text = $('#chatInput').value.trim();
  let nImg = chatAtt.count(); // images: an image-only message is fine
  if ((!text && !nImg) || !S.cur || S.cur.readOnly) return;
  if (sharedRole() === 'copy') return forkShared(text || defaultImageText(nImg), nImg ? [1] : []); // share: the first change makes your copy
  const kind = chatTarget();
  const refs = partCtx.names(); // chattools: parts referenced -> a context line for the agent + a screenshot with them highlighted
  if (refs.length && !text) { $('#chatInput').focus(); return; }
  if (refs.length && kind === 'design' && S.viewer?.items.length && nImg < 4) {
    try { const b = await S.viewer.capture({ highlight: refs }); if (b) { const f = new File([b], `parts-${Date.now()}.png`, { type: 'image/png' }); f.shot = true; await chatAtt.add([f]); nImg = chatAtt.count(); } }
    catch (e) { console.warn('parts screenshot', e); }
  }
  const pre = refs.length ? partCtx.prefix() : '';
  if (refs.length) track('part_asked', { parts: refs.length, project_id: S.cur.id }); // analytics:
  let att = []; // images: upload (or finish uploading) first; the message carries the ids
  if (nImg) {
    if (kind !== 'design' && (chatOf(kind).live?.running || chatOf(kind).unavailable)) return;
    try { att = await chatAtt.uploadAll(S.cur.id); } catch (e) { toast(e.message); return; }
    text = text || defaultImageText(nImg); chatAtt.clear();
  }
  if (pre) { text = pre + text; partCtx.clear(); }
  if (kind !== 'design') {
    if (chatOf(kind).live?.running || chatOf(kind).unavailable) return;
    $('#chatInput').value = ''; autoGrow(); document.dispatchEvent(new CustomEvent('forma:sent'));
    track('change_requested', { kind, queued: false, prompt_length: text.length, has_image: att.length > 0, project_id: S.cur.id }); // analytics:
    return agentSend(S.cur.id, kind, text, att);
  }
  $('#chatInput').value = ''; autoGrow(); document.dispatchEvent(new CustomEvent('forma:sent')); // phones: keyboard down, model card back (web/phonestudio.js)
  track('change_requested', { kind: 'design', queued: !!S.chat.live?.running, prompt_length: text.length, has_image: att.length > 0, project_id: S.cur.id }); // analytics:
  // Agent busy: queue it; queued messages go out one at a time as each run finishes
  if (S.chat.live?.running) { (S.chat.queue ||= []).push({ text, att }); renderChat(); return; }
  return sendDesign(S.cur.id, S.chat, text, att);
}
async function sendDesign(id, c, text, att = [], extra = null) {
  c.messages.push({ role: 'user', text, t: Date.now() / 1000, attachments: att, ...(isCurProject(id) && sharedRole() || c.messages.some(m => m.by) ? { by: 'You' } : {}) }); // share: labelled like the rest
  c.live = { steps: [], text: '', running: true };
  runEntry(id).sentAt = Date.now(); kickPoll(id);
  if (isCurProject(id)) renderChat(); updateRunIndicator();
  try { await api.send(id, text, att.map(a => a.id), extra); }
  catch (e) {
    if (e.status === 409) { c.messages.pop(); (c.queue ||= []).unshift({ text, att }); c.live = { steps: [], text: '', running: true }; } // still busy: keep it queued
    else c.live = { steps: [], text: '', running: false, error: e.message };
    if (isCurProject(id)) renderChat(); updateRunIndicator();
  }
}
function queueHtml(c) {
  if (!c.queue?.length) return '';
  return `<div class="q-list">${c.queue.map((q, i) => `<div class="q-item"><span class="q-tag">Queued</span><span class="q-text">${esc(splitParts(q.text).text)}</span>
    <button class="q-x" data-qx="${i}" aria-label="Remove queued message">✕</button></div>`).join('')}</div>`;
}

// ---------- support thread HTML (the admin inbox below); visitors reach Josh through the call bubble ----------
function supportHtml(list, mine) {
  return list.map(m => {
    const me = m.from === mine;
    const who = m.from === 'josh' ? 'Premake' : (mine === 'josh' ? (m.email || 'Customer') : 'You');
    return `<div class="sup-msg ${me ? 'me' : 'them'}"><div class="sup-meta">${esc(who)} · ${esc(ago(m.t))}${m.context?.tab ? ` · ${esc({ model: 'Model', code: 'Code', site: 'Website', ads: 'Ads' }[m.context.tab] || m.context.tab)}` : ''}</div><div class="sup-text">${textHtml(m.text)}</div></div>`;
  }).join('');
}
// ---------- admin run stats (#/stats): p50 / p90 per phase over the last N design runs, plus each run ----------
async function renderStats() {
  setCrumb('Run timings');
  const el = $('#inbox');
  if (!ACCESS.admin) { el.innerHTML = '<div class="pick-inner"><h1>Run timings</h1><p class="muted">Only admins can see this page.</p></div>'; return; }
  const n = Number(new URLSearchParams(location.search).get('n')) || 50;
  el.innerHTML = '<div class="pick-inner"><h1>Run timings</h1><div class="big-spin"></div></div>';
  let s;
  try { s = await api.stats(n); } catch (e) { el.innerHTML = `<div class="pick-inner"><h1>Run timings</h1>${errBox(e)}</div>`; return; }
  if (S.route?.name !== 'stats') return;
  const sec = v => v == null ? '–' : (v / 1000).toFixed(1) + ' s';
  const row = r => `<tr><td>${esc(new Date(r.t * 1000).toLocaleString())}</td><td><a href="${esc(projectPath(r.id, r.title))}">${esc(r.title)}</a></td>
    <td>${r.ok ? 'ok' : r.stopped ? 'stopped' : 'failed'}</td><td>${r.warm ? 'warm' : 'cold'}</td><td>${esc(r.effort || '')}${r.new_design ? ' · new' : r.small ? ' · small' : ''}</td>
    <td class="num">${sec(r.init)}</td><td class="num">${sec(r.first_token)}</td><td class="num">${sec(r.first_tool)}</td><td class="num">${sec(r.sketch)}</td>
    <td class="num">${(r.builds || []).map(b => sec(b.ms) + (b.warm ? '' : '*')).join(', ') || '–'}</td><td class="num">${sec(r.first_model)}</td><td class="num"><b>${sec(r.end)}</b></td></tr>`;
  el.innerHTML = `<div class="stats-wrap"><h1>Run timings</h1>
    <p class="muted">Last ${s.n} design runs (of ${s.total}). Times from the moment the message reached the server. * = cold build (no warm worker).
      Warm agents now: ${s.pool.length} / ${s.limits.pool_max}; build workers: ${s.workers.length} / ${s.limits.workers_max}.</p>
    <table class="parts stats-ph"><thead><tr><th>Phase</th><th class="num">Runs</th><th class="num">p50</th><th class="num">p90</th></tr></thead><tbody>
      ${s.phases.map(p => `<tr><td>${esc(p.label)}</td><td class="num">${p.n}</td><td class="num">${sec(p.p50)}</td><td class="num">${sec(p.p90)}</td></tr>`).join('')}</tbody></table>
    <div class="stats-scroll"><table class="parts stats-runs"><thead><tr><th>When</th><th>Design</th><th>Result</th><th>Agent</th><th>Effort</th><th class="num">Init</th><th class="num">1st token</th>
      <th class="num">1st tool</th><th class="num">Sketch</th><th class="num">Builds</th><th class="num">1st model</th><th class="num">Done</th></tr></thead>
      <tbody>${s.runs.map(row).join('') || '<tr><td colspan="12" class="muted">No runs recorded yet.</td></tr>'}</tbody></table></div></div>`;
}

// ---------- admin inbox (#/support): projects with support threads, reply as Josh ----------
const INBOX = { list: null, sel: null, err: null };
async function renderInbox(id) {
  setCrumb('Help inbox');
  if (!ACCESS.admin) { $('#inbox').innerHTML = '<div class="pick-inner"><h1>Help inbox</h1><p class="muted">Only admins can see this page.</p></div>'; return; }
  INBOX.sel = id || INBOX.sel;
  try { INBOX.list = await api.supportInbox(); INBOX.err = null; } catch (e) { INBOX.err = e; }
  drawInbox();
  updateInboxBadge();
}
function drawInbox() {
  const el = $('#inbox');
  if (INBOX.err) { el.innerHTML = `<div class="pick-inner"><h1>Help inbox</h1>${errBox(INBOX.err)}</div>`; return; }
  const list = INBOX.list || [];
  const sel = list.find(x => x.id === INBOX.sel) || null;
  el.innerHTML = `<div class="inbox-wrap ${sel ? 'has-sel' : ''}">
    <div class="inbox-list"><h1>Help inbox</h1>${list.length ? list.map(x => `<a class="ib-item ${x.id === INBOX.sel ? 'on' : ''}" href="/support/${encodeURIComponent(x.id)}">
        <span class="ib-top"><b>${esc(x.title)}</b>${x.unread ? `<span class="badge">${x.unread}</span>` : ''}</span>
        <span class="ib-sub">${esc(x.email || 'Customer')} · ${esc(ago(x.last.t))}</span>
        <span class="ib-last">${x.last.from === 'josh' ? 'You: ' : ''}${esc(x.last.text)}</span></a>`).join('') : '<p class="muted">No support messages yet.</p>'}</div>
    <div class="inbox-thread" id="ibThread">${sel ? `<div class="ib-head"><a class="ib-back" href="/support" id="ibBack" aria-label="Back to the inbox">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.6" fill="none"/></svg></a><div><b>${esc(sel.title)}</b><span class="muted">${esc(sel.email || '')}</span></div>
        <a class="btn sm primary" href="${esc(designPath({ project: sel.id }))}">Open this project</a></div>
        <div class="msgs ib-msgs" id="ibMsgs"><div class="empty-chat"><div class="big-spin"></div></div></div>
        <div class="composer"><div class="cbox"><textarea id="ibInput" rows="2" placeholder="Reply…"></textarea>
          <div class="cbar"><span class="muted small">Enter to send</span><button class="send" id="ibSend" aria-label="Send reply">
          <svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" stroke="currentColor" stroke-width="1.7" fill="none"/></svg></button></div></div></div>`
      : '<div class="empty-chat"><h3>Pick a conversation</h3></div>'}</div></div>`;
  if (!sel) return;
  $('#ibBack').onclick = () => { INBOX.sel = null; }; // phones: list and thread are separate screens
  const draw = async () => {
    try { const r = await api.support(sel.id); $('#ibMsgs') && ($('#ibMsgs').innerHTML = supportHtml(r.messages || [], 'josh'), $('#ibMsgs').scrollTop = 1e9); } catch (e) { if ($('#ibMsgs')) $('#ibMsgs').innerHTML = errBox(e); }
  };
  draw();
  const send = async () => {
    const t = $('#ibInput').value.trim(); if (!t) return;
    $('#ibInput').value = '';
    try { await api.supportSend(sel.id, t, { tab: 'model' }); } catch (e) { toast(e.message); }
    draw(); api.supportInbox().then(l => { INBOX.list = l; updateInboxBadge(); }).catch(() => {});
  };
  $('#ibSend').onclick = send;
  $('#ibInput').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } };
}
async function updateInboxBadge(fetch) {
  if (!ACCESS.admin) return;
  if (fetch) { try { INBOX.list = await api.supportInbox(); } catch (e) { if (e.status === 404) return; } }
  const n = (INBOX.list || []).reduce((a, x) => a + (x.unread ? 1 : 0), 0);
  const b = $('#inboxBadge'); if (b) { b.hidden = !n; b.textContent = n; }
}

// ---------- live events: one run store + one SSE stream per open project ----------
// Streams survive route changes (Studio ↔ Ads ↔ Website ↔ Store ↔ Examples). A stream is closed only when its
// project is idle (no design or site run) and no longer the focused design.
const RUNS = new Map(); // id -> { id, title, es, chat: {messages, live, steps}, site: {messages, live, steps, loaded} }
function runEntry(id) {
  let e = RUNS.get(id);
  if (!e) {
    e = { id, title: '', es: null, chat: { messages: [], live: null, steps: {} }, site: { messages: [], live: null, steps: {}, loaded: false },
      ads: { messages: [], live: null, steps: {}, loaded: false }, support: { messages: [], loaded: false },
      app: { messages: [], live: null, steps: {}, loaded: false }, // apps: the app agent's chat
      sseOk: false, lastMsg: 0, hello: false, sseTimer: null, poll: null, seq: { design: 0, site: 0, ads: 0, app: 0 }, boot: null, cursor: null, runApi: 0, psig: null, sentAt: 0 };
    RUNS.set(id, e);
  }
  return e;
}
const designBusy = e => !!e.chat.live?.running;
const siteBusy = e => !!e.site.live?.running;
const adsBusy = e => !!e.ads.live?.running;
const appBusy = e => !!e.app?.live?.running; // apps:
const isCurProject = id => S.cur?.kind === 'project' && S.cur.id === id;
// a function declaration (hoisted): it can be called during startup, before this line runs
function titleOf(id) { let t; try { t = RUNS.get(id)?.title; } catch {} return t || (S.projects || []).find(p => p.id === id)?.title || 'Untitled design'; }

// SSE can connect yet deliver nothing (Cloudflare quick tunnels buffer it). The server sends a "hello" data event on
// connect and a data "ping" every 15 s; a stream that hasn't delivered anything within 5 s, errors, or goes quiet
// after a hello falls back to polling GET /api/projects/<id>/run (or, on older servers, GET /api/projects/<id>).
// ?nosse=1 skips SSE entirely (for testing the fallback).
const NOSSE = new URLSearchParams(location.search).has('nosse');
function ensureStream(id) {
  const e = runEntry(id);
  if (e.es) { if (!e.sseOk && !e.poll && !e.sseTimer) startPoll(id); return e; }
  if (NOSSE || !api.events) { if (!e.poll) startPoll(id); return e; }
  const es = api.events(id); e.es = es; e.sseOk = false; e.hello = false;
  const armCheck = () => {
    clearTimeout(e.sseTimer);
    e.sseTimer = setTimeout(() => { e.sseTimer = null; if (e.es === es && !e.sseOk) startPoll(id); }, 5000);
  };
  armCheck();
  es.onopen = () => { if (isCurProject(id)) setConn('ok'); resync(id); armCheck(); };
  es.onerror = () => { if (e.es !== es) return; e.sseOk = false; if (isCurProject(id)) setConn('err', 'Reconnecting'); startPoll(id); };
  es.onmessage = ev => {
    if (e.es !== es) return;
    e.lastMsg = Date.now();
    if (!e.sseOk) { e.sseOk = true; clearTimeout(e.sseTimer); e.sseTimer = null; stopPoll(id); }
    let d; try { d = JSON.parse(ev.data); } catch { return; }
    onProjectEvent(id, d);
  };
  return e;
}
function pruneStreams() {
  const keep = new Set([S.cur?.kind === 'project' && S.cur.id, S.design?.project].filter(Boolean));
  for (const e of RUNS.values()) {
    if ((e.es || e.poll) && !designBusy(e) && !siteBusy(e) && !adsBusy(e) && !appBusy(e) && !keep.has(e.id)) {
      e.es?.close(); e.es = null; e.sseOk = false; clearTimeout(e.sseTimer); e.sseTimer = null; stopPoll(e.id);
    }
  }
}

// ---------- polling fallback ----------
function startPoll(id) {
  const e = runEntry(id);
  if (e.poll) return;
  e.poll = { timer: null, busy: false };
  schedulePoll(id, 0);
}
function stopPoll(id) { const e = RUNS.get(id); if (!e?.poll) return; clearTimeout(e.poll.timer); e.poll = null; }
function schedulePoll(id, ms) { const e = RUNS.get(id); if (!e?.poll) return; clearTimeout(e.poll.timer); e.poll.timer = setTimeout(() => pollOnce(id), ms); }
/** Poll right away (after a send), if this project is polling. */
function kickPoll(id) { const e = RUNS.get(id); if (e?.poll && !e.poll.busy) schedulePoll(id, 400); }
function pollDelay(e) {
  const active = S.design?.project === e.id || isCurProject(e.id);
  const busy = designBusy(e) || siteBusy(e) || adsBusy(e) || appBusy(e);
  if (!active) return busy ? 15000 : 30000; // background runs: just enough to finish them in the run indicator
  let ms = busy ? 2000 : 6000;
  if (document.hidden) ms = Math.max(ms, busy ? 5000 : 15000);
  return ms;
}
async function pollOnce(id) {
  const e = RUNS.get(id);
  if (!e?.poll || e.poll.busy) return;
  e.poll.busy = true;
  try {
    const useRun = api.run && Date.now() - e.runApi > 60000; // after a 404, retry the run endpoint once a minute
    if (useRun) await pollRun(id, e); else await pollProject(id, e);
  } catch {}
  if (!e.poll) return;
  e.poll.busy = false;
  schedulePoll(id, pollDelay(e));
}
const justSent = e => Date.now() - e.sentAt < 5000; // the POST may still be in flight: don't treat "not running" as finished
async function pollRun(id, e) {
  let r;
  try { r = await api.run(id, e.boot && e.cursor != null ? { since: e.cursor, boot: e.boot } : {}); }
  catch (err) { if (err.status === 404) { e.runApi = Date.now(); return pollProject(id, e); } throw err; }
  if (e.sseOk) return;
  if (e.boot && r.boot !== e.boot) e.seq = { design: 0, site: 0, ads: 0, app: 0 };
  e.boot = r.boot; e.cursor = r.seq;
  for (const ev of r.events || []) await onProjectEvent(id, ev);
  if (r.running && !designBusy(e)) await onProjectEvent(id, { type: 'run_started' });
  if (r.site_running && !siteBusy(e)) await onProjectEvent(id, { type: 'site_run_started' });
  if (r.ads_running && !adsBusy(e)) await onProjectEvent(id, { type: 'ads_run_started' });
  if (r.app_running && !appBusy(e)) await onProjectEvent(id, { type: 'app_run_started' });
  setPartial(id, e, 'design', r.running ? r.partial : '', r.running ? r.thinking : '');
  setPartial(id, e, 'site', r.site_running ? r.site_partial : '', r.site_running ? r.site_thinking : '');
  setPartial(id, e, 'ads', r.ads_running ? r.ads_partial : '', r.ads_running ? r.ads_thinking : '');
  setPartial(id, e, 'app', r.app_running ? r.app_partial : '', r.app_running ? r.app_thinking : '');
  if (!justSent(e)) {
    if (!r.running && designBusy(e)) await onProjectEvent(id, { type: 'run_finished', ok: true, resync: true });
    if (!r.site_running && siteBusy(e)) await onProjectEvent(id, { type: 'site_run_finished', ok: true, resync: true });
    if (!r.ads_running && adsBusy(e)) await onProjectEvent(id, { type: 'ads_run_finished', ok: true, resync: true });
    if (!r.app_running && appBusy(e)) await onProjectEvent(id, { type: 'app_run_finished', ok: true, resync: true });
  }
}
function setPartial(id, e, kind, text = '', thinking = '') {
  const L = (kind === 'design' ? e.chat : e[kind]).live;
  if (!L?.running || (L.partial || '') === text && (L.thinking || '') === thinking) return;
  if (kind === 'design' && thinking && thinking !== L.thinking) thinkCaption(id, L, thinking);
  L.partial = text; L.thinking = thinking;
  chatChanged(id, kind);
}
// livecaption: the caption line under the model. Reasoning shows as one plain sentence, changing at most every 2.5 s.
function showCap(id, L, text) {
  if (!text || L.caption === text) return;
  L.caption = text; L.capAt = Date.now();
  if (isCurProject(id)) renderVpStatus();
}
function thinkCaption(id, L, thinking) {
  const line = thinkingLine(thinking);
  if (!line || line === L.caption) return;
  L.thinkNext = line;
  if (L.thinkTimer) return;
  L.thinkTimer = setTimeout(() => { L.thinkTimer = null; const t = L.thinkNext; L.thinkNext = null; if (L.running && t) showCap(id, L, t); }, Math.max(0, 2500 - (Date.now() - (L.capAt || 0))));
}
// reveal: the first model builds up part by part (viewer.reveal); the caption names each part as it lands
addEventListener('buildery:reveal', (e) => { S.revealCap = e.detail?.done ? null : partLabel(e.detail?.name); renderVpStatus(); });
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h + ':' + s.length; }
/** Older servers: derive the SSE events from the project payload (no live steps or partial text there). */
async function pollProject(id, e) {
  const p = await api.project(id);
  if (e.sseOk) return;
  const h = p.history;
  const sig = { m: p.manifest ? (p.manifest.t ?? hashStr(JSON.stringify(p.manifest.parts || []))) : null, bom: JSON.stringify(p.bom || null), code: hashStr(p.code || ''),
    h: h ? `${h.head}|${h.current_v}|${h.versions?.length}|${h.can_redo}` : '' };
  const prev = e.psig; e.psig = sig;
  if (p.running && !designBusy(e)) await onProjectEvent(id, { type: 'run_started' });
  if (p.site_running && !siteBusy(e)) await onProjectEvent(id, { type: 'site_run_started' });
  if (p.ads_running && !adsBusy(e)) await onProjectEvent(id, { type: 'ads_run_started' });
  if (p.app_running && !appBusy(e)) await onProjectEvent(id, { type: 'app_run_started' });
  if (prev) {
    if (sig.m !== prev.m && sig.m != null) await onProjectEvent(id, { type: 'model_updated', t: sig.m });
    if (sig.code !== prev.code) await onProjectEvent(id, { type: 'code_updated' });
    if (sig.bom !== prev.bom) await onProjectEvent(id, { type: 'bom_updated' });
    if (sig.h !== prev.h && !p.running) await onProjectEvent(id, { type: 'history_changed', kind: 'design' });
  }
  if (p.site_running) siteChanged(id); // no site_updated signal in this payload: refresh the page while it's being edited
  if (!justSent(e)) {
    if (!p.running && designBusy(e)) await onProjectEvent(id, { type: 'run_finished', ok: true });
    if (!p.site_running && siteBusy(e)) await onProjectEvent(id, { type: 'site_run_finished', ok: true });
    if (!p.ads_running && adsBusy(e)) await onProjectEvent(id, { type: 'ads_run_finished', ok: true });
    if (!p.app_running && appBusy(e)) await onProjectEvent(id, { type: 'app_run_finished', ok: true });
  }
}
// A stream that said hello but then missed two pings is dead: poll until it delivers again.
setInterval(() => {
  for (const e of RUNS.values()) if (e.es && e.sseOk && e.hello && Date.now() - e.lastMsg > 40000) { e.sseOk = false; startPoll(e.id); }
}, 10000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  for (const e of RUNS.values()) if (e.poll && !e.poll.busy) schedulePoll(e.id, 0);
  loadProjects(); // designs started elsewhere (another tab, the phone, a script) show up without a reload
  if (staleBuild && !typingSomething()) location.reload(); else checkBuild(); // assetver: back on a tab that is out of date
});
setInterval(() => { if (!document.hidden) { loadProjects(); checkBuild(); } }, 60e3);

// assetver: is this tab running the latest Premake? The page carries its build id (server/assetver.js); when the
// server's differs, a pill offers a reload, and coming back to the tab reloads it unless something is being typed.
const PAGE_BUILD = document.querySelector('meta[name="premake-build"]')?.content || '';
let staleBuild = false;
function typingSomething() {
  return [...document.querySelectorAll('textarea, input[type="text"], input:not([type])')].some(el => el.offsetParent && el.value.trim());
}
async function checkBuild() {
  if (!PAGE_BUILD || staleBuild) return;
  try {
    const r = await fetch('/api/version', { cache: 'no-store', credentials: 'same-origin' });
    const { build } = await r.json();
    if (!build || build === PAGE_BUILD) return;
  } catch { return; }
  staleBuild = true;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'build-stale'; b.textContent = 'Premake updated · Reload';
  b.onclick = () => location.reload();
  document.body.appendChild(b);
}

/** After a (re)connect: if we think a run is live but the server says it ended (e.g. server restart), finish it. */
async function resync(id) {
  const e = runEntry(id);
  if (!designBusy(e) && !siteBusy(e) && !appBusy(e)) return;
  try {
    const p = await api.project(id);
    if (designBusy(e) && !p.running) onProjectEvent(id, { type: 'run_finished', ok: true, resync: true });
    if (siteBusy(e) && !p.site_running) onProjectEvent(id, { type: 'site_run_finished', ok: true, resync: true });
    if (appBusy(e) && !p.app_running) onProjectEvent(id, { type: 'app_run_finished', ok: true, resync: true });
  } catch {}
}

function startLive(chat, d) {
  if (d.replay || !chat.live?.running) chat.live = { steps: [], text: '', running: true };
  else chat.live.error = null;
}

async function onProjectEvent(id, d) {
  const e = runEntry(id);
  if (d.type === 'hello') { if (e.boot && d.boot !== e.boot) e.seq = { design: 0, site: 0, ads: 0, app: 0 }; e.boot = d.boot; e.hello = true; return; }
  if (d.type === 'ping') return;
  // SSE and polling can both deliver an event (e.g. a tunnel flushing late): apply each sequence number once.
  const kind = String(d.type).startsWith('site_') ? 'site' : String(d.type).startsWith('ads_') ? 'ads' : String(d.type).startsWith('app_') ? 'app' : 'design';
  if (/run_started$/.test(d.type) && d.replay) e.seq[kind] = 0; // a replay rebuilds the live turn from scratch
  if (d.seq != null) { if (d.seq <= e.seq[kind]) return; e.seq[kind] = d.seq; }
  if (/run_started$/.test(d.type)) e.sentAt = 0;
  if (kind !== 'design') return onAgentEvent(id, e, d, kind);
  if (d.type === 'support_message') {
    const st = e.support;
    st.loaded = false;
    if (ACCESS.admin) { updateInboxBadge(true); if (S.route?.name === 'support') renderInbox(S.route.id); }
    return;
  }
  const c = e.chat;
  const live = () => c.live || (c.live = { steps: [], text: '', running: true });
  switch (d.type) {
    case 'run_started':
      startLive(c, d); updateRunIndicator();
      if (isCurProject(id)) { renderChat(); if (!S.viewer?.parts().length && !S.viewer?.sketch && S.cur.data) loadModel(S.cur.data.manifest, false); }
      break;
    case 'step': { const L = live(); addLiveStep(L, d.text || 'Working', d.parts); if (isCurProject(id)) renderChat(); updateRunIndicator(); break; }
    case 'editing_parts': if (isCurProject(id) && live().running && (d.parts?.length || d.replay)) S.viewer?.editGlow?.set(d.parts); break; // editglow: shimmer what the agent is editing (a replayed [] = the build landed)
    case 'assistant': if (addLiveText(live(), d.text) && isCurProject(id)) renderChat(); break;
    case 'partial': setPartial(id, e, 'design', d.text, d.thinking); break;
    case 'caption': if (d.text) { const L = live(); clearTimeout(L.thinkTimer); L.thinkTimer = null; showCap(id, L, d.text); } break; // livecaption: server/caption.js (tool steps win over reasoning)
    case 'part_preview': // livepreview: a part of the design.py still being written, on the workbench until the full model lands
      if (isCurProject(id) && live().running && d.url && (isFirstRun() || !S.viewer?.parts().length)) { const v = await getViewer(); if (v && isCurProject(id)) { overlay(''); v.addPreview(d); renderVpStatus(); } }
      break;
    case 'sketch': // instant blockout for a new design, replaced by the real model when its first build lands
      if (isCurProject(id) && d.sketch && !d.replay) { const v = await getViewer(); if (v && isCurProject(id)) { overlay(''); v.showSketch(d.sketch); renderVpStatus(); } }
      break;
    case 'model_updated': {
      if (isCurProject(id) && S.cur.data) {
        try {
          const m = await api.manifest(S.cur.base);
          if (!isCurProject(id)) break;
          const first = !S.viewer?.parts().length;
          // livecaption: a rebuild within the same run is a visible step ("Version 2: added the wall plate and hook")
          const Lv = c.live?.running ? c.live : null;
          if (Lv) Lv.models = (Lv.models || 0) + 1;
          if (Lv && Lv.models > 1 && !first && S.cur.data.manifest?.parts?.length) {
            const v = { id, text: versionNote(S.cur.data.manifest.parts, m.parts || [], Lv.models) };
            S.verCap = v; setTimeout(() => { if (S.verCap === v) { S.verCap = null; renderVpStatus(); } }, 6000);
          }
          S.cur.data.manifest = m;
          if (S.restoring?.id === id) S.restoring = null; // undo/restore rebuild landed
          await loadModel(m, !first, true); // keeps the camera, even while the studio is hidden; animates the change
          const afterHistory = Date.now() < historyToast.until && !c.live?.running;
          if (onStudioFor(id) && (afterHistory || (!(Date.now() - (S.viewer?.lastChange?.at || 0) < 2000) && !(Date.now() - (S.colorSavedAt || 0) < 5000)))) toast(afterHistory ? `${historyToast.label} · model rebuilt` : 'Model updated', afterHistory && historyToast.back ? historyToast.back : undefined); // changefx: its chip says what changed; colours: a swatch pick is not news
          if (afterHistory) historyToast.until = Date.now() + 1500; // swallow the quote toast that follows, then back to normal
        } catch {}
      }
      loadProjects();
      break;
    }
    case 'history_changed': {
      if (d.kind === 'site' || d.kind === 'ads' || d.kind === 'app') { e[d.kind].loaded = false; if (isCurProject(id)) loadAgentChat(id, d.kind); break; }
      if (c.live?.running) break;
      try { const p = await api.project(id); c.messages = p.messages || []; c.history = p.history || null; } catch { break; }
      if (isCurProject(id)) renderChat();
      break;
    }
    case 'code_updated': if (isCurProject(id)) { await refreshProject(['code']); renderCode(); } break;
    case 'title': if (!d.replay) applyTitle(id, d.title); break; // agentbrain: auto title / rename
    case 'ask_mock': { // askmock: one option of a question card now has its mock-up (server/askmock.js)
      const m = c.messages.find(x => x.role === 'assistant' && x.t === d.t && Array.isArray(x.questions));
      const o = m?.questions.find(q => q.id === d.qid)?.options.find(x => x.label === d.label);
      if (!o || !d.mock) break;
      o.mock = d.mock;
      if (isCurProject(id)) mockLanded(m);
      break;
    }
    case 'firmware_updated': // firmware: a compile started or finished (server/firmware.js)
      if (isCurProject(id) && S.cur.data) {
        try { const r = await fetch(`/api/projects/${encodeURIComponent(id)}/firmware`, { credentials: 'same-origin' }); if (r.ok) S.cur.data.firmware = await r.json(); } catch {}
        asmMod?.then(m => m.onFirmwareEvent(id, S.cur?.data?.firmware)).catch(() => {}); // assemble: the Flash step
      }
      break;
    case 'bom_updated': if (isCurProject(id)) { await refreshProject(['bom']); loadQuote(true); } break;
    case 'run_finished': {
      if (!c.live && d.resync) break;
      { const t0 = runEntry(id).sentAt; track('design_run_finished', { ok: !!d.ok, secs: t0 ? Math.round((Date.now() - t0) / 1000) : null, project_id: id, stopped: d.error === 'Stopped' }); } // analytics:
      const L = live(); L.running = false;
      if (!d.ok && d.error && !d.status) L.error = d.error; // agentbrain: a stop with a status shows it under the reply (+ Continue)
      const before = c.messages.filter(m => m.role === 'assistant').length;
      try {
        const p = await api.project(id);
        c.messages = p.messages || [];
        c.history = p.history || c.history;
        if (p.meta?.title) e.title = p.meta.title;
        if (isCurProject(id) && S.cur.data) { S.cur.data.code = p.code; S.cur.data.bom = p.bom; if (p.meta) S.cur.data.meta = p.meta; if (p.app) { S.cur.data.app = p.app; syncAppTab(); } if (p.firmware) S.cur.data.firmware = p.firmware; if (onStudioFor(id)) setCrumb(p.meta?.title || e.title); canonicalize(); }
      } catch {}
      const after = c.messages.filter(m => m.role === 'assistant').length;
      if (after > before) {
        const idx = c.messages.map(m => m.role).lastIndexOf('assistant');
        if (L.steps.length) c.steps[idx] = L.steps;
        if (L.stepParts) (c.stepParts ||= {})[idx] = L.stepParts;
        c.live = L.error ? { steps: [], text: '', running: false, error: L.error } : null;
      } else if (d.resync) c.live = null;
      if (isCurProject(id)) { S.viewer?.editGlow?.stop(); S.viewer?.clearPreviews?.(); } // editglow: no new model came: fade the shimmer out; livepreview: the workbench goes
      // once per successful run: a gentle "order one" card under the agent's reply
      if (d.ok && !d.resync && after > before && !c.live?.error && !d.questions?.length) { c.nudge = { at: c.messages.length, fresh: true }; if (isCurProject(id)) setTimeout(maybeHero, 600); appNudge(id); } // app-preview: the App pill
      if (isCurProject(id)) {
        renderChat(); renderCode(); loadQuote(true);
        if (!S.viewer?.parts().length && S.cur.data) { // first build: a missed model_updated (or a sketch that never got replaced) must not leave the view empty
          try { const m = await api.manifest(S.cur.base); if (isCurProject(id) && m?.parts?.length) S.cur.data.manifest = m; } catch {}
          if (isCurProject(id)) { if (!S.cur.data.manifest?.parts?.length) S.viewer?.clearSketch?.(); await loadModel(S.cur.data.manifest, false); }
        }
      }
      loadProjects(); updateRunIndicator();
      if (c.queue?.length && !d.resync && d.error !== 'Stopped') { const q = c.queue.shift(); sendDesign(id, c, q.text, q.att); } // next queued message
      if (!onStudioFor(id) && !d.resync) toast(`${d.ok ? 'Design run finished' : 'Design run stopped'} · ${titleOf(id)}`, { href: designPath({ project: id }), label: 'Open studio' });
      pruneStreams();
      break;
    }
  }
}

/** Website and ads agents: same event shapes with a site_ / ads_ prefix. */
async function onAgentEvent(id, e, d, kind) {
  const c = e[kind], P = kind + '_';
  const live = () => c.live || (c.live = { steps: [], text: '', running: true });
  switch (d.type) {
    case P + 'run_started': startLive(c, d); if (kind === 'app' && isCurProject(id) && S.ctab === 'app') renderAppTab(); break;
    case P + 'step': addLiveStep(live(), d.text || 'Working'); if (kind === 'app' && isCurProject(id) && S.ctab === 'app') renderAppTab(); break;
    case P + 'assistant': if (!addLiveText(live(), d.text)) return; break;
    case P + 'partial': setPartial(id, e, kind, d.text, d.thinking); return;
    case 'site_updated': siteChanged(id); return;
    case 'ads_updated': adsChanged(id); return;
    case 'app_updated': appChanged(id); return; // apps: a file in app/ changed
    case P + 'run_finished': {
      if (!c.live && d.resync) return;
      const L = live(); L.running = false;
      if (!d.ok && d.error) L.error = d.error;
      const before = c.messages.filter(m => m.role === 'assistant').length;
      try { const r = kind === 'site' ? await api.siteMessages(id) : kind === 'app' ? await api.appMessages(id) : await api.adsMessages(id); c.messages = r.messages || []; c.history = r.history || null; c.loaded = true; } catch {}
      const after = c.messages.filter(m => m.role === 'assistant').length;
      if (after > before) {
        const idx = c.messages.map(m => m.role).lastIndexOf('assistant');
        if (L.steps.length) c.steps[idx] = L.steps;
        c.live = L.error ? { steps: [], text: '', running: false, error: L.error } : null;
      } else if (d.resync) c.live = null;
      if (kind === 'site') siteChanged(id); else if (kind === 'app') appChanged(id).then(() => { if (!d.resync) appNudge(id); }); else adsChanged(id); // final, honesty-filtered version
      if (!viewingTab(id, kind) && !d.resync) toast(`${kind === 'site' ? 'Page edit finished' : kind === 'app' ? 'App updated' : 'Ads updated'} · ${titleOf(id)}`, { href: designPath({ project: id }, kind), label: kind === 'site' ? 'Open page' : kind === 'app' ? 'Open app' : 'Open ads' });
      pruneStreams();
      break;
    }
    default: return;
  }
  chatChanged(id, kind); updateRunIndicator();
}

/** Is this project's tab on screen? (studio = Model or Code) */
const viewingTab = (id, kind) => S.route?.name === 'project' && S.route.id === id && (kind === 'design' ? S.ctab === 'model' || S.ctab === 'code' || S.ctab === 'assemble' : S.ctab === kind);
const onStudioFor = id => viewingTab(id, 'design');

/** Top-bar indicator: any project's agent running somewhere you're not looking. */
var wasBusy; // sidebar: ids that were running at the last indicator update (to spot finishes)
function updateRunIndicator() {
  { // sidebar: live step text; a run that finished on a project that isn't open gets the "Updated" dot + a fresh thumbnail
    let finished = false; wasBusy ||= new Set(); projUpdated ||= new Set();
    for (const e of RUNS.values()) {
      const b = designBusy(e) || siteBusy(e) || adsBusy(e) || appBusy(e);
      if (b) wasBusy.add(e.id);
      else if (wasBusy.delete(e.id)) { finished = true; if (!isCurProject(e.id)) projUpdated.add(e.id); }
    }
    if (finished) loadProjects(); else renderProjects();
    if ([...RUNS.values()].some(e => designBusy(e) || siteBusy(e) || adsBusy(e) || appBusy(e)) && !projPollTimer) projPollTimer = setTimeout(loadProjects, 5000);
  }
  const el = $('#runInd'); if (!el) return;
  const items = [];
  for (const e of RUNS.values()) {
    if (designBusy(e) && !onStudioFor(e.id)) items.push({ label: 'Designing', title: titleOf(e.id), href: designPath({ project: e.id }) });
    if (siteBusy(e) && !viewingTab(e.id, 'site')) items.push({ label: 'Editing page', title: titleOf(e.id), href: designPath({ project: e.id }, 'site') });
    if (adsBusy(e) && !viewingTab(e.id, 'ads')) items.push({ label: 'Editing ads', title: titleOf(e.id), href: designPath({ project: e.id }, 'ads') });
    if (appBusy(e) && !viewingTab(e.id, 'app')) items.push({ label: 'Building app', title: titleOf(e.id), href: designPath({ project: e.id }, 'app') }); // apps:
  }
  el.hidden = !items.length;
  if (!items.length) return;
  const it = items[0];
  el.href = it.href;
  el.title = items.map(i => `${i.label} · ${i.title}`).join('\n');
  el.innerHTML = `<span class="spin"></span><span class="ri-l">${esc(it.label)}</span><span class="ri-t"> · ${esc(it.title)}</span>${items.length > 1 ? `<span class="ri-more">+${items.length - 1}</span>` : ''}`;
}

function afterRoute() { pruneStreams(); updateRunIndicator(); }

async function refreshProject(keys) {
  if (!S.cur || S.cur.kind !== 'project') return;
  const id = S.cur.id;
  try {
    const p = await api.project(id);
    if (!isCurProject(id)) return;
    for (const k of keys) {
      if (k === 'messages') { S.chat.messages = p.messages || []; S.chat.history = p.history || null; }
      else S.cur.data[k] = p[k];
    }
    if (p.meta) S.cur.data.meta = p.meta;
    if (p.meta?.title && onStudioFor(id)) setCrumb(p.meta.title);
    canonicalize(); // urls: renamed -> new slug
  } catch {}
}
async function refreshAll() {
  await refreshProject(['messages', 'code', 'bom', 'manifest']);
  renderChat(); renderCode(); loadQuote(true);
  if (S.cur?.data) loadModel(S.cur.data.manifest, true);
}

// ---------- order ----------
async function loadQuote(silent) {
  if (!S.cur) return;
  const src = S.cur.kind === 'project' ? { project: S.cur.id } : { example: S.cur.id };
  const id = S.cur.id;
  if (!silent) { S.quote = null; S.quoteErr = null; renderOrder(); }
  try { const q = await api.quote(src, S.mode); if (S.cur?.id !== id) return; S.quote = q; S.quoteErr = null; if (q.sell_assembled === false) S.mode = 'kit'; pollPrices(q, id); if (silent && silent !== 'quiet' && (S.route?.name === 'project' || S.route?.name === 'example') && S.route.id === id && Date.now() > historyToast.until) toast('Quote updated'); }
  catch (e) { if (S.cur?.id !== id) return; S.quoteErr = e; }
  renderOrder(); renderPriceChip(true); renderOrderPill();
  if (S.chat.nudge && !S.chat.nudge.dismissed) refreshNudge();
}
/** prices: while Slant 3D / DigiKey / Mouser lookups run in the background (quote.pricing.refreshing), re-fetch the quote
 * quietly every 4 s (up to ~3 min) so live prices replace the estimates in place. */
let pricePoll = { id: null, n: 0, t: 0 };
function pollPrices(q, id) {
  clearTimeout(pricePoll.t);
  if (pricePoll.id !== id) pricePoll = { id, n: 0, t: 0 };
  if (!q?.pricing?.refreshing || pricePoll.n >= 45) return;
  pricePoll.n++;
  pricePoll.t = setTimeout(() => { if (S.cur?.id === id && !document.hidden) loadQuote('quiet'); else if (S.cur?.id === id) pollPrices(q, id); }, 4000);
}
/** Re-render the post-run order card from the live quote (same tier as the order pill), in place. */
function refreshNudge() {
  const old = $('.order-nudge');
  if (!old) { renderChat(); return; }
  const html = nudgeHtml(S.chat);
  if (!html) { old.remove(); return; }
  const tmp = document.createElement('div'); tmp.innerHTML = html;
  const nu = tmp.firstElementChild; old.replaceWith(nu); wireNudge(nu.parentElement);
}

function renderOrder() {
  const el = $('#orderPane'), q = S.quote, bom = S.cur?.data?.bom;
  if (S.quoteErr) {
    const noModel = S.quoteErr.status && !S.cur?.data?.manifest;
    el.innerHTML = noModel ? `<div class="order-empty"><h3>No quote yet</h3><p>Pricing appears once the agent has exported parts and a parts list.</p></div>`
      : errBox(S.quoteErr, true);
    wireRetry(el, () => loadQuote()); return;
  }
  if (!q) { el.innerHTML = `<div class="skel" style="height:150px;margin-bottom:22px"></div><div class="skel" style="height:190px;margin-bottom:22px"></div><div class="skel" style="height:220px"></div>`; return; }
  if (!q.tiers?.length) { el.innerHTML = `<div class="order-empty"><h3>No quote yet</h3><p>Pricing appears once the agent has exported parts and a parts list.</p></div>`; return; }
  const src = S.cur.kind === 'project' ? { project: S.cur.id } : { example: S.cur.id };
  // order tab: web/ordertab.js lists every part and the shops that sell or make it (we don't sell the parts)
  renderOrderView(el, {
    key: `${S.cur.kind}:${S.cur.id}`, quote: q, src,
    partThumb: name => partThumb(S.viewer, name),
    title: S.cur?.data?.meta?.title || S.cur?.data?.manifest?.title || 'This design',
    thumb: S.viewer?.parts().length ? (S.hero || '') : undefined, thumbLoading: !S.hero,
    buildHtml: guideQuietLinkHtml(S.cur), // guide: "Build it yourself" -> /designs/<x>/guide
    // order tab: "Ask Premake to not use cut metal" (your own design only): a normal chat message to the design agent
    askNoMetal: S.cur?.kind === 'project' && !S.cur.readOnly && !sharedRole() ? text => {
      setRtab('chat'); if (isPhone()) setPhonePanel(true);
      $('#chatInput').value = text; autoGrow(); sendChat();
    } : null,
  });
}

// ---------- checkout ----------
function closeModal() { $('#modal').hidden = true; $('#modalBox').innerHTML = ''; }
$('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
// payments: the order modal and the redirect to Stripe Checkout live in web/checkout.js
function checkout(t, omit) {
  const title = S.cur?.data?.meta?.title || S.cur?.data?.manifest?.title || 'Design';
  const src = S.cur.kind === 'project' ? { project: S.cur.id } : { example: S.cur.id };
  const bom = S.cur?.data?.bom; // agentbrain: designs that need soldering offer an iron kit at checkout
  openCheckout({ title, src, mode: S.quote?.sell_assembled === false ? 'kit' : S.mode, tier: t, omit, close: closeModal, errBox, solder: bom?.needs_soldering === true ? { reason: bom.soldering_reason || '' } : null });
}

// ---------- remix / new ----------
async function remix() {
  if (sharedRole() === 'copy') return forkShared(); // share: Make a copy
  if (!S.cur?.readOnly) return;
  const slug = S.cur.id;
  $$('#remixBtn, #remixBtn2').forEach(b => b.disabled = true);
  try {
    const { id } = await api.createProject({ fromExample: slug });
    track('remix_started', { example: slug, project_id: id }); // analytics:
    toast('Remixed into your projects');
    go(designPath({ project: id }));
    loadProjects();
  } catch (e) { toast(e.message); }
  $$('#remixBtn, #remixBtn2').forEach(b => b.disabled = false);
}
$('#remixBtn').onclick = remix; $('#remixBtn2').onclick = remix;
$('#newBtn').onclick = () => { go(designPath(null)); setTimeout(() => $('#homePrompt').focus(), 50); };
$('#swStudio').onclick = () => { go(designPath(S.design)); };
$('#launchBtnM').onclick = () => setRtab('launch');
$('#swStore').onclick = () => { if (S.route?.name !== 'market') go('/store'); };
$('#menuBtn').onclick = () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('open'); };
$('#scrim').onclick = closeDrawer;

// ---------- phones: visible height + keyboard ----------
// --app-h is the height that is really visible (Safari toolbars, the on-screen keyboard), so the composer sits right
// above the keyboard instead of under it. body.typing (a text field has focus) lets the CSS fold the viewer and
// hide the bottom tabs while typing.
if (window.visualViewport) {
  // Same approach as the Forfeit support chat PWA: iOS doesn't resize the layout when the keyboard opens, it shrinks
  // the visual viewport and pans the page, which strands the composer mid-screen above a dead gap. So: size the shell
  // to vv.height, undo the pan (offsetTop as well as scrollY) on every settle, one write per frame, and while the
  // keyboard is up drop the home-indicator inset (--kb-inset) that would otherwise sit as a gap under the composer.
  const vv = visualViewport, root = document.documentElement;
  let last = 0, raf = 0;
  const apply = () => {
    raf = 0;
    if (vv.scale && Math.abs(vv.scale - 1) > 0.01) return; // pinch-zoomed: leave the layout alone
    const h = Math.round(vv.height);
    if (h !== last) { last = h; root.style.setProperty('--app-h', h + 'px'); }
    const kb = isNarrow() && innerHeight - vv.height > 80;
    if (root.classList.contains('kb-open') !== kb) root.classList.toggle('kb-open', kb);
    root.style.setProperty('--kb-inset', kb ? '0px' : 'env(safe-area-inset-bottom, 0px)');
    if (isNarrow() && (vv.offsetTop > 0 || scrollY > 0 || scrollX > 0)) scrollTo(0, 0);
  };
  const fit = () => { if (!raf) raf = requestAnimationFrame(apply); };
  vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); apply();
  // iOS can report the height mid-way through the keyboard animation and then go quiet: measure again once it settles
  const refit = () => [80, 250, 500, 900].forEach(t => setTimeout(fit, t));
  addEventListener('focusin', refit); addEventListener('focusout', refit);
}
{
  const editable = el => !!el && !el.readOnly && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
    || (el.tagName === 'INPUT' && !/^(checkbox|radio|range|button|submit|reset|file|color)$/.test(el.type)));
  const sync = () => { const on = editable(document.activeElement); if (document.body.classList.contains('typing') !== on) document.body.classList.toggle('typing', on); };
  addEventListener('focusin', sync); addEventListener('focusout', () => setTimeout(sync, 0));
}

// ---------- boot ----------
// Access: signed-out visitors can browse (examples, store, product pages, quotes). The server enforces it; this hides the dead ends.
function applyAccess() {
  // guest: signed out through the gateway. The real studio, read-only; writes open the sign-in modal (web/guest.js).
  if (GUEST) {
    document.body.dataset.access = 'guest';
    installGuest({ access: ACCESS, homeForm: $('#homeForm'), homeTextarea: $('#homePrompt'), homeAtt });
    document.addEventListener('click', e => { if (e.target.closest('.guest-signin, [data-guest-signin]')) { e.preventDefault(); signInModal({ title: 'Sign in to Premake', next: '/' }); } });
    return;
  }
  document.body.dataset.access = ACCESS.showcase ? 'showcase' : 'full';
  const c = $('#conn');
  if (ACCESS.showcase && ACCESS.signin) { c.style.cursor = 'pointer'; c.title = 'Sign in'; c.onclick = () => { location.href = ACCESS.signin; }; }
  let msg = '';
  if (ACCESS.showcase) msg = `<p>${esc(SHOWCASE_MSG)}</p><p class="muted">Browse the examples and the store, open any design in the studio, and check its price.</p>${ACCESS.signin ? `<a class="btn primary" href="${esc(ACCESS.signin)}">Sign in</a>` : ''}`;
  else if (!ACCESS.ai) msg = '<p>AI is temporarily unavailable. You can still browse, view your designs and check prices.</p>';
  if (msg) { const note = document.createElement('div'); note.className = 'beta-note'; note.innerHTML = msg; $('#homeForm').before(note); }
}
applyAccess();
if ($('#sideOrders')) $('#sideOrders').hidden = !ordersLinkVisible(); // payments:
if (ACCESS.admin) { updateInboxBadge(true); setInterval(() => { if (!document.hidden) updateInboxBadge(true); }, 60000); }
if (innerWidth < 1280) $('#tree').classList.add('collapsed');
setConn('', MOCK ? 'Mock data' : 'Connecting');
if (isNarrow()) $('#tree').classList.remove('open-m');
captureRef();
// urls: clean URLs. Old #/ links are rewritten first (installNav), then every navigation fires forma:route.
setTitleLookup(id => (S.cur?.kind === 'project' && S.cur.id === id && S.cur.data?.meta?.title) || (S.projects || []).find(p => p.id === id)?.title || '');
installNav();
addEventListener('forma:route', () => { captureRef(); route(); });
loadProjects();
route();
// guest: back from sign-in with a prompt typed while signed out (/?resume=1, or the old /#/?resume=1): send it, once
if (ACCESS.authed && !ACCESS.showcase) resumeDraft({ textarea: $('#homePrompt'), form: $('#homeForm'), att: homeAtt });

// Desktop: drag the sidebar's right edge to resize it (double-click: default width). The close-sidebar icon folds it to a
// thumbnail strip that opens over the page while hovered; the icon again opens it for good. Both remembered per browser.
(() => {
  const h = $('#sideResize'), tg = $('#sideToggle'), st = $('#studio'); if (!h || !st) return;
  const KEY = 'premake.sideW', RAIL_KEY = 'premake.sideRail';
  let width = 0;
  const show = () => {
    const rail = st.classList.contains('side-rail');
    if (rail) st.style.setProperty('--side-w', '60px'); else if (width) st.style.setProperty('--side-w', width + 'px'); else st.style.removeProperty('--side-w');
    st.classList.toggle('has-sw', rail || !!width);
    if (tg) { const t = rail ? 'Open sidebar' : 'Close sidebar'; tg.setAttribute('aria-label', t); tg.title = t; tg.dataset.tip = t; tg.setAttribute('aria-pressed', String(rail)); }
  };
  const setRail = on => { st.classList.toggle('side-rail', on); show(); try { on ? localStorage.setItem(RAIL_KEY, '1') : localStorage.removeItem(RAIL_KEY); } catch {} };
  try { width = +localStorage.getItem(KEY) || 0; if (width < 180) width = 0; st.classList.toggle('side-rail', localStorage.getItem(RAIL_KEY) === '1'); } catch {}
  show();
  // hovering the strip opens it over the page; not straight after closing it, until the mouse has left once
  const sb = $('#sidebar'); let hold = false;
  sb?.addEventListener('mouseenter', () => { if (!hold && st.classList.contains('side-rail')) sb.classList.add('side-peek'); });
  sb?.addEventListener('mouseleave', () => { hold = false; sb.classList.remove('side-peek'); });
  tg?.addEventListener('click', () => { const on = !st.classList.contains('side-rail'); hold = on; sb?.classList.remove('side-peek'); setRail(on); });
  h.addEventListener('pointerdown', e => {
    e.preventDefault(); h.setPointerCapture(e.pointerId); document.body.classList.add('resizing');
    const move = ev => { width = Math.max(180, Math.min(Math.round(ev.clientX - st.getBoundingClientRect().left), 440)); show(); };
    const up = () => { document.body.classList.remove('resizing'); h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up);
      try { if (width) localStorage.setItem(KEY, width); } catch {} };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
  });
  h.addEventListener('dblclick', () => { width = 0; show(); try { localStorage.removeItem(KEY); } catch {} });
})();

// Desktop: drag the panel's left edge to make Chat / Order / Launch wider (remembered per browser)
(() => {
  const h = $('#panelResize'), st = $('#studio'); if (!h || !st) return;
  const clamp = w => Math.max(320, Math.min(w, Math.round(innerWidth * 0.6)));
  const apply = w => { st.style.setProperty('--right-w', clamp(w) + 'px'); st.classList.add('has-rw'); };
  try { const w = +localStorage.getItem('buildery.rightW'); if (w) apply(w); } catch {}
  h.addEventListener('pointerdown', e => {
    e.preventDefault(); h.setPointerCapture(e.pointerId); document.body.classList.add('resizing');
    const move = ev => apply(innerWidth - ev.clientX);
    const up = () => { document.body.classList.remove('resizing'); h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up);
      try { localStorage.setItem('buildery.rightW', parseInt(st.style.getPropertyValue('--right-w'))); } catch {} };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
  });
  h.addEventListener('dblclick', () => { st.classList.remove('has-rw'); st.style.removeProperty('--right-w'); try { localStorage.removeItem('buildery.rightW'); } catch {} });
})();

// urls: clean studio URLs on the History API (pushState / popstate) instead of #/ hash routes.
//   /                      studio home (signed in; Designs on phones)   /new  new design (also the guest home)
//   /designs/<slug>-<id>   a project (the id at the end is what counts; /designs/<id> works too)
//   /designs/<x>/website   /designs/<x>/ads   /designs/<x>/launch   /designs/<x>/guide   (same tabs for /examples/<slug>/...)
//   /examples              gallery                         /examples/<slug>   an example
//   /store[?q=&category=]  marketplace                     /orders, /orders/all, /orders/success?session_id=
//   /website, /ads         design picker for that tab      /launch   launch with no design
//   /stats                 admin run stats                 /support[/<id>]   -> /admin#support
// Inside, the router keeps the old route shape ('/p/<id>', '/site/examples/<slug>', '/store?q=...'): current() returns it
// for the address bar's clean path. Any old #/... link (bookmarks, shared links, Stripe's return URL) is rewritten to its
// clean path on load and on hashchange, so old links keep working.
// No imports on purpose: api.js uses top-level await, and Safari can run a module that depends on an async module before
// it has finished, which crashed the studio ("Cannot access 'titleOf' before initialization"). app.js calls setGuest().
let GUEST = false; // signed out: / is the landing page, the guest studio home is /new
export function setGuest(g) { GUEST = !!g; }
export const isGuest = () => GUEST;
const HOME = () => (GUEST ? '/new' : '/');
/** phonenav: screen depth in the phone app's list -> detail stack, from a clean path.
 *  0 = Designs (signed-in /; for guests the New design screen /new is the root), 1 = a page opened from it (/new,
 *  /examples, /store, /orders, the pickers), 2 = a design (/designs/<x>..., /examples/<slug>...). */
export function phoneDepth(pathname = location.pathname) {
  const m = String(pathname || '/').split(/[?#]/)[0].split('/').filter(Boolean);
  if (!m.length) return 0;
  if (m[0] === 'new' || m[0] === 'start') return GUEST ? 0 : 1;
  if ((m[0] === 'designs' || m[0] === 'examples') && m[1]) return 2;
  return 1;
}
const ID_TAIL = /(?:^|-)([0-9a-f]{10})$/; // project ids are 10 hex characters (server newId)
const TABS = { site: 'website', ads: 'ads', launch: 'launch', build: 'guide', app: 'app', assemble: 'assemble' }; // old route word -> clean sub-path (apps: /designs/<x>/app)
const TAB_OF = Object.fromEntries(Object.entries(TABS).map(([k, v]) => [v, k]));
const APP_ROOTS = new Set(['', 'new', 'start', 'designs', 'examples', 'store', 'orders', 'website', 'ads', 'launch', 'stats', 'support']);

// hoisted function + property: safe even if called before this module's body has run
function titleOf(id) { return setTitleLookup.fn ? setTitleLookup.fn(id) : ''; }
/** app.js: how to find a project's current title (for the slug). */
export function setTitleLookup(fn) { setTitleLookup.fn = fn; }

/** "SCARA Arm 3D Printer!" -> "scara-arm-3d-printer" (ascii, lowercase, hyphens, at most 60 characters). */
export function slugify(t) {
  return String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}
/** /designs/<slug>-<id> for a project (title looked up when not given). */
export function projectPath(id, title) {
  const s = slugify(title ?? titleOf(id));
  return `/designs/${s && !/^untitled(-design)?$/.test(s) ? s + '-' : ''}${encodeURIComponent(id)}`;
}
/** Clean path for a design: { project } or { example }, plus an optional old tab word ('site' | 'ads' | 'launch' | 'build'). */
export function designPath(src, tab) {
  if (!src) return HOME();
  const base = src.project ? projectPath(src.project) : `/examples/${encodeURIComponent(src.example)}`;
  return base + (tab && TABS[tab] ? '/' + TABS[tab] : '');
}
/** Project id from a /designs/ segment: the 10-hex tail of <slug>-<id>, else the whole segment. */
export function idFromSeg(seg) {
  const m = String(seg).match(ID_TAIL);
  return m ? m[1] : seg;
}

/** Old route ('/p/<id>?x=1', as in a #/ link) -> clean path + query. */
export function legacyToPath(h) {
  const [p, q = ''] = String(h || '/').replace(/^#/, '').split('?');
  const m = p.split('/').filter(Boolean);
  const qs = q ? '?' + q : '';
  const dec = s => { try { return decodeURIComponent(s); } catch { return s; } };
  const src = (k, id) => (k === 'p' && id ? { project: dec(id) } : k === 'examples' && id ? { example: dec(id) } : null);
  if (!m.length || m[0] === 'forma') return HOME() + qs;
  if (m[0] === 'p' || m[0] === 'examples') { const s = src(m[0], m[1]); return (s ? designPath(s) : '/examples') + qs; }
  if (TABS[m[0]]) {
    const s = src(m[1], m[2]);
    if (s) return designPath(s, m[0]) + qs;
    return (m[0] === 'site' ? '/website' : m[0] === 'build' || m[0] === 'app' || m[0] === 'assemble' ? HOME() : '/' + m[0]) + qs;
  }
  if (['store', 'orders', 'stats', 'support'].includes(m[0])) return '/' + m.join('/') + qs;
  return HOME() + qs;
}
/** Clean path -> old route shape (what the router parses). Unknown paths are home. */
export function pathToLegacy(pathname) {
  const m = String(pathname || '/').split('/').filter(Boolean);
  const tabbed = (base, sub) => (sub && TAB_OF[sub] ? `/${TAB_OF[sub]}${base}` : base);
  if (m[0] === 'designs' && m[1]) {
    let seg = m[1]; try { seg = decodeURIComponent(seg); } catch {}
    return tabbed('/p/' + encodeURIComponent(idFromSeg(seg)), m[2]);
  }
  if (m[0] === 'examples') return m[1] ? tabbed('/examples/' + m[1], m[2]) : '/examples';
  if (m[0] === 'website') return '/site';
  if (m[0] === 'ads' || m[0] === 'launch') return '/' + m[0];
  if (['store', 'orders', 'stats', 'support'].includes(m[0])) return '/' + m.join('/');
  return '/';
}
/** The current route in the old shape, query included: '/p/0cc247aa90', '/store?q=hook'. */
export function current() {
  if (location.hash.startsWith('#/')) return location.hash.slice(1); // not rewritten yet (shouldn't happen after init)
  return pathToLegacy(location.pathname) + location.search;
}
/** Is this same-origin path a studio route (handled here, without a page load)? */
export function isAppPath(pathname) {
  const m = String(pathname).split('/').filter(Boolean);
  if (m.length && /\.[a-z0-9]+$/i.test(m[m.length - 1])) return false; // a file
  return APP_ROOTS.has(m[0] || '');
}

const fire = () => dispatchEvent(new Event('forma:route'));
/** Go to a studio URL. Accepts a clean path ('/designs/x-id'), an old '#/...' route, or a full same-origin URL. */
export function go(href, { replace = false } = {}) {
  let to = String(href || '/');
  if (to.startsWith('#/')) to = legacyToPath(to);
  else if (to.startsWith('#')) return;
  const u = new URL(to, location.href);
  if (u.origin !== location.origin || !isAppPath(u.pathname)) { location.assign(u.href); return; }
  if (u.hash.startsWith('#/')) { const c = new URL(legacyToPath(u.hash), location.href); u.pathname = c.pathname; u.search = mergeSearch(u.search, c.search); u.hash = ''; }
  const next = u.pathname + u.search + u.hash;
  if (next === location.pathname + location.search + location.hash && !replace) { fire(); return; }
  history[replace ? 'replaceState' : 'pushState'](null, '', next);
  fire();
}
/** Rewrite the address bar to the canonical form of the current route (a renamed design's new slug), no navigation. */
export function canonicalize() {
  if (location.hash.startsWith('#/')) return;
  const want = legacyToPath(pathToLegacy(location.pathname));
  if (location.pathname === '/start' && want === HOME()) return; // the gateway's guest studio entry stays as it is
  // phonenav: on phones /new (New design) is its own screen, one step in from Designs at /
  if (location.pathname === '/new' && want === HOME() && matchMedia('(max-width: 640px)').matches) return;
  if (want !== location.pathname) history.replaceState(history.state, '', want + location.search);
}
function mergeSearch(a, b) {
  const out = new URLSearchParams(a);
  for (const [k, v] of new URLSearchParams(b)) out.set(k, v);
  const s = out.toString();
  return s ? '?' + s : '';
}
/** Old #/... in the address bar -> its clean path (replaceState). Returns true when it rewrote. */
function fromHash() {
  if (!location.hash.startsWith('#/')) return false;
  const c = new URL(legacyToPath(location.hash), location.href);
  let path = c.pathname;
  if (path === HOME() && ['/start', '/new'].includes(location.pathname)) path = location.pathname;
  history.replaceState(history.state, '', path + mergeSearch(location.search, c.search));
  return true;
}

// ---------------------------------------------------------------- wiring
let wired = false;
/** Studio only (app.js): rewrite old links, follow back/forward, and keep internal link clicks in the page. */
export function installNav() {
  if (wired) return; wired = true;
  fromHash();
  // back / forward (and a typed #/ link, which fires popstate first, then hashchange)
  addEventListener('popstate', () => { fromHash(); fire(); });
  addEventListener('hashchange', () => { if (fromHash()) fire(); });
  // Internal links: no page load. Cmd / Ctrl / Shift / Alt-click and middle-click keep the browser's own new-tab behaviour.
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.('a[href]');
    if (!a || a.hasAttribute('download') || (a.target && a.target !== '_self') || a.dataset.reload != null) return;
    const raw = a.getAttribute('href');
    if (!raw || (raw.startsWith('#') && !raw.startsWith('#/'))) return;
    const u = new URL(raw, location.href);
    if (u.origin !== location.origin || (!raw.startsWith('#/') && !isAppPath(u.pathname))) return;
    if (u.pathname === '/' && GUEST && !raw.startsWith('#/')) return; // guests: / is the landing page, a real page load
    e.preventDefault();
    go(raw);
  });
}

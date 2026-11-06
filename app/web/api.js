// API client for the local server (see app/CONTRACT.md). ?mock=1 switches to built-in fixtures.
export const MOCK = new URLSearchParams(location.search).has('mock');

export class ApiError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

// Who is this visitor? Hosted builds are a read-only showcase until you log in (see DEPLOY.md).
export const ACCESS = MOCK ? { authed: true, showcase: false, ai: true, hosted: false, login: false }
  : await fetch('/api/auth', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ authed: true, showcase: false, ai: true, hosted: false, login: false }));
export const SHOWCASE_MSG = (ACCESS.message && !/beta|demo/i.test(ACCESS.message) ? ACCESS.message : '') || 'Sign in to design your own products.';

async function req(path, opts = {}) {
  if (ACCESS.showcase && opts.method && opts.method !== 'GET') {
    dispatchEvent(new CustomEvent('forma:signin')); // guest: web/guest.js opens the sign-in modal
    throw new ApiError(SHOWCASE_MSG, 403);
  }
  let r;
  try {
    r = await fetch(path, {
      ...opts,
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('Can’t reach Premake. Check your connection and retry.', 0);
  }
  let data = null;
  try { data = await r.json(); } catch {}
  if (!r.ok) throw new ApiError(data?.error || `Request failed (${r.status})`, r.status);
  return data;
}

// Referral attribution: ?ref=<code> (in the hash query or the URL) is remembered for 30 days and sent with new projects.
const REF_KEY = 'forma.ref';
export function captureRef() {
  const h = location.hash.split('?')[1] || '';
  const ref = new URLSearchParams(h).get('ref') || new URLSearchParams(location.search).get('ref');
  if (ref && /^[A-Za-z0-9_-]{1,40}$/.test(ref)) { try { localStorage.setItem(REF_KEY, JSON.stringify({ ref, t: Date.now() })); } catch {} }
}
export function currentRef() {
  try { const r = JSON.parse(localStorage.getItem(REF_KEY) || 'null'); return r && Date.now() - r.t < 30 * 864e5 ? r.ref : null; } catch { return null; }
}
const P = id => `/api/projects/${encodeURIComponent(id)}`;

const qs = src => src.project ? 'project=' + encodeURIComponent(src.project) : 'example=' + encodeURIComponent(src.example);

const real = {
  examples: () => req('/api/examples'),
  example: slug => req(`/api/examples/${encodeURIComponent(slug)}`),
  projects: () => req('/api/projects'),
  project: id => req(`/api/projects/${encodeURIComponent(id)}`),
  sections: (kind, id) => req(`/api/${kind === 'example' ? 'examples' : 'projects'}/${encodeURIComponent(id)}/sections`), // sections: Parts panel groups
  createProject: body => req('/api/projects', { method: 'POST', body: { ...body, ...(currentRef() ? { ref: currentRef() } : {}) } }),
  launch: id => req(`${P(id)}/launch`),
  // build guides (server/guide.js): the payload, write the steps (202, then poll guide()), share on/off
  guide: id => req(`/build/${encodeURIComponent(id)}/data.json`),
  guideGenerate: (slug, force) => req('/api/guide/generate', { method: 'POST', body: { slug, force: !!force } }),
  guideShare: (slug, on) => req('/api/guide/share', { method: 'POST', body: { slug, on: !!on } }),
  deploy: (id, html, css) => req(`${P(id)}/deploy`, { method: 'POST', body: { html, css } }),
  setDomain: (id, domain) => req(`${P(id)}/launch/domain`, { method: 'PUT', body: { domain } }),
  saveCampaign: (id, c) => req(`${P(id)}/launch/campaign`, { method: 'POST', body: c }),
  campaignStatus: (id, status) => req(`${P(id)}/launch/campaign`, { method: 'PATCH', body: { status } }),
  partColor: (id, part, color) => req(`/api/projects/${encodeURIComponent(id)}/colors`, { method: 'POST', body: { part, color } }), // colours: hover swatches
  send: (id, text, attachments, extra) => req(`/api/projects/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { text, ...(attachments?.length ? { attachments } : {}), ...(extra || {}) } }), // images: attachment ids; agentbrain: extra.answers
  stop: id => req(`/api/projects/${encodeURIComponent(id)}/stop`, { method: 'POST', body: {} }),
  // speed: pre-warm a design agent + build worker (studio open, composer focus); never starts a turn
  warm: id => req(`${P(id)}/warm`, { method: 'POST', body: {} }),
  warmHome: () => req('/api/warm', { method: 'POST', body: {} }),
  stats: (n = 50, kind = 'design') => req(`/api/stats?n=${n}&kind=${kind}`),
  quote: (src, mode) => req(`/api/quote?${src.project ? 'project=' + encodeURIComponent(src.project) : 'example=' + encodeURIComponent(src.example)}&mode=${mode}`),
  setPrintSource: (src, source) => req('/api/pricing/print-source', { method: 'POST', body: { ...src, source } }), // prices: admin, in-house | slant | default
  order: body => req('/api/orders', { method: 'POST', body }),
  events: id => new EventSource(`/api/projects/${encodeURIComponent(id)}/events`),
  // polling fallback when SSE doesn't deliver (404 on servers without it)
  run: (id, q = {}) => req(`${P(id)}/run?${new URLSearchParams(q)}`),
  siteMessages: id => req(`/api/projects/${encodeURIComponent(id)}/site/messages`),
  siteSend: (id, text, attachments) => req(`/api/projects/${encodeURIComponent(id)}/site/messages`, { method: 'POST', body: { text, ...(attachments?.length ? { attachments } : {}) } }), // images:
  // version history (kind: 'design' | 'site')
  rewind: (id, kind, to_message_index) => req(`${P(id)}/rewind`, { method: 'POST', body: { kind, to_message_index } }),
  undo: (id, kind) => req(`${P(id)}/undo`, { method: 'POST', body: { kind } }),
  redo: (id, kind) => req(`${P(id)}/redo`, { method: 'POST', body: { kind } }),
  restore: (id, kind, n) => req(`${P(id)}/restore`, { method: 'POST', body: { kind, n } }),
  versions: (id, kind) => req(`${P(id)}/versions?kind=${kind}`),
  siteStop: id => req(`/api/projects/${encodeURIComponent(id)}/site/stop`, { method: 'POST', body: {} }),
  // ads chat (an agent that edits ads/ads.json) and human support (a plain thread with Josh)
  adsMessages: id => req(`${P(id)}/ads/messages`),
  adsSend: (id, text, attachments) => req(`${P(id)}/ads/messages`, { method: 'POST', body: { text, ...(attachments?.length ? { attachments } : {}) } }), // images:
  adsStop: id => req(`${P(id)}/ads/stop`, { method: 'POST', body: {} }),
  // apps: the app agent's chat (edits ./app/**; text only) and the App tab's info ({ show, exists, ... })
  appMessages: id => req(`${P(id)}/app/messages`),
  appSend: (id, text) => req(`${P(id)}/app/messages`, { method: 'POST', body: { text } }),
  appStop: id => req(`${P(id)}/app/stop`, { method: 'POST', body: {} }),
  support: id => req(`${P(id)}/support`),
  supportSend: (id, text, context) => req(`${P(id)}/support`, { method: 'POST', body: { text, context } }),
  supportInbox: () => req('/api/support/inbox'),
  ads: src => req(`/api/ads?${qs(src)}`),
  generateAds: src => req('/api/ads/generate', { method: 'POST', body: src }),
  saveAds: (src, ads) => req('/api/ads', { method: 'PUT', body: { ...src, ads } }),
  site: src => req(`/api/site?${qs(src)}`),
  saveSite: (src, copy) => req('/api/site', { method: 'PUT', body: { ...src, copy } }),
  store: (params = {}) => req('/api/store?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString()),
  publish: (project, on) => req(`/api/site/${on ? 'publish' : 'unpublish'}`, { method: 'POST', body: { project } }),
  waitlist: (src, body) => req('/api/site/waitlist', { method: 'POST', body: { ...src, ...body } }),
  async manifest(base) { return req(`${base}manifest.json?t=${Date.now()}`); },
};

export const api = MOCK ? (await import('./mock.js')).mockApi : real;

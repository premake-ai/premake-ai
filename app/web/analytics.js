// analytics: PostHog product analytics on every Premake page (studio, build pages, /guides, share pages, admin, and the
// gateway's landing, sign-in and legal pages). Load it with <script type="module" src="/analytics.js"></script> or import
// { track } from it. The gateway serves its own copy (gateway/home/analytics.js, kept identical by server/analytics.test.js):
//   cp web/analytics.js gateway/home/analytics.js
// posthog-js comes from jsDelivr at a pinned version (with SRI); its lazy parts (recorder, exception capture, remote config)
// come from us-assets.i.posthog.com. Every page that sets a Content-Security-Policy allows both, plus us.i.posthog.com.
// Dev: nothing loads on localhost / 127.0.0.1 / [::1] / *.localhost / private LAN addresses unless the URL has ?ph=1
// (remembered for the tab; ?ph=0 turns it off again, anywhere). Events sent from dev carry environment: 'development'.
// Privacy: inputs are masked in recordings, email addresses are masked in recorded text and scrubbed from event
// properties; the only PII sent is the signed-in user's email (identify). Prompts are never sent, only their length.
// No imports and no top-level await on purpose (nav.js note: Safari module order). track() never throws or blocks.
const KEY = ''; // PostHog project key: empty in the open-source app, so nothing is sent anywhere
const VERSION = '1.438.9';
const SRC = `https://cdn.jsdelivr.net/npm/posthog-js@${VERSION}/dist/array.js`;
const SRI = 'sha384-WF0ELetIPCVjn4p8+Q7ku4OYiHutrmWmevBw9Q7r8nDqyqQEc5IgbC5bWwJV6htA';
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const KEEP = new Set(['distinct_id', '$user_id', '$anon_distinct_id', '$device_id', '$set', '$set_once', 'email', 'token']);

const host = location.hostname;
const DEV = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host) || host.endsWith('.localhost')
  || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
let opt = null;
try {
  opt = new URLSearchParams(location.search).get('ph');
  if (opt === '1' || opt === '0') sessionStorage.setItem('buildery.ph', opt); else opt = sessionStorage.getItem('buildery.ph');
} catch {}
export const ENABLED = !!KEY && (DEV ? opt === '1' : opt !== '0');

let ph = null; // the posthog instance once loaded
const queue = []; // [name, props, opts] tracked before posthog loaded

function scrub(v, depth = 0) {
  if (typeof v === 'string') return v.includes('@') ? v.replace(EMAIL, '[email]') : v;
  if (!v || typeof v !== 'object' || depth > 5) return v;
  if (Array.isArray(v)) return v.map((x) => scrub(x, depth + 1));
  const o = {};
  for (const k of Object.keys(v)) o[k] = KEEP.has(k) ? v[k] : scrub(v[k], depth + 1);
  return o;
}

/** Send a product event. props: small, no PII (lengths and counts, never prompt text). opts.now: send at once (before a redirect). */
export function track(name, props = {}, opts = {}) {
  try {
    if (!ENABLED) return;
    if (!ph) { if (queue.length < 100) queue.push([name, props, opts]); return; }
    ph.capture(name, props, opts.now ? { send_instantly: true, transport: 'sendBeacon' } : undefined);
  } catch {}
}

/** Sign-in state from /api/auth (ACCESS): identify signed-in users by email; forget them after sign-out. */
export function identify(access) {
  try {
    if (!ph || !access) return;
    const email = typeof access.user === 'string' && access.user.includes('@') ? access.user.toLowerCase() : null;
    if (email) {
      const before = ph.get_distinct_id();
      ph.identify(email, { email, ...(access.admin ? { is_admin: true } : {}) });
      if (before !== email) track('signed_in');
    } else if (access.authed === false && ph._isIdentified?.()) ph.reset();
  } catch {}
}

/** Sign-out: a new anonymous id from here on. */
export function reset() { try { ph?.reset(); } catch {} }

function loaded(p) {
  ph = p;
  p.register({ environment: DEV ? 'development' : 'production', app: 'buildery' });
  if (location.pathname === '/auth/signed-out') p.reset();
  for (const [n, pr, o] of queue.splice(0)) track(n, pr, o);
  fetch('/api/auth', { cache: 'no-store', credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).then(identify).catch(() => {});
}

function load() {
  if (window.posthog?.__loaded) return loaded(window.posthog);
  const s = document.createElement('script');
  s.src = SRC; s.async = true; s.crossOrigin = 'anonymous'; s.integrity = SRI;
  s.onload = () => {
    try {
      window.posthog.init(KEY, {
        api_host: 'https://us.i.posthog.com',
        ui_host: 'https://us.posthog.com',
        person_profiles: 'identified_only',
        autocapture: true,
        capture_pageview: 'history_change', // clean URLs use pushState (web/nav.js): a $pageview per route change
        capture_pageleave: true,
        capture_exceptions: true, // error tracking
        enable_heatmaps: true,
        disable_surveys: true,
        session_recording: {
          maskAllInputs: true,
          maskTextSelector: '*', // every text node goes through maskTextFn, which only masks email addresses
          maskTextFn: (t) => (t && t.includes('@') ? t.replace(EMAIL, (m) => '*'.repeat(m.length)) : t),
        },
        before_send: (ev) => {
          if (ev && ev.properties && ev.event !== '$snapshot') ev.properties = scrub(ev.properties);
          return ev;
        },
        loaded,
      });
    } catch {}
  };
  (document.head || document.documentElement).appendChild(s);
}

// Clicks worth naming, wherever they are: build-guide downloads, and sign-in / sign-up calls to action.
function onClick(e) {
  const a = e.target?.closest?.('a[href]');
  if (!a) return;
  const href = a.getAttribute('href') || '';
  if (a.hasAttribute('download') && /\/build\/|\/files\//.test(new URL(href, location.href).pathname)) {
    const f = new URL(href, location.href).pathname.split('/').pop() || '';
    track('guide_downloaded', { file_type: (f.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || 'other', page: location.pathname.startsWith('/build/') ? 'build_page' : 'studio' });
  } else if (/^\/auth\/(login|signin)\b/.test(href) && !a.closest('.gm')) { // .gm: guest.js's modal, counted when it opens
    track('signup_cta_clicked', { cta: 'link', page: location.pathname }, { now: true });
  }
}

if (ENABLED) {
  addEventListener('click', onClick, true);
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', load, { once: true }); else load();
}

// local-landing: the public landing page (gateway/home, the one signed-out visitors see at premake.ai) for a local guest
// on this Mac (signed out with forma_local_out=1). The gateway's renderer is reused as is, not forked: gateway/home reads
// its data through gateway/landing's data() and thumbUrl(), which on the gateway come from an HTTP cache of this Mac's API.
// Here those two exports are pointed at local data instead: the example list from data/examples, the hero quote from
// quote(), and thumbnails at /files/examples/<slug>/thumb.png?v=... (served by this server). Nothing else in this process
// uses gateway/landing, so overriding its exports is safe.
// Routes (only for local requests, never gateway traffic): GET / (local guest), GET /home/home.css, GET /home/home.js.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const GW = path.join(__dirname, '..', 'gateway');
const gwLanding = require(path.join(GW, 'landing'));
const home = require(path.join(GW, 'home'));
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/; // as gateway/landing

let ctx = null;
let heroSlug = null;
const gatewayData = gwLanding.data; // with no Mac registered it resolves at once to { examples: [], quote: null, heroSlug }

function examples() {
  const { exampleSlugs, exDir, readJSON, vurl } = ctx;
  const out = [];
  for (const slug of exampleSlugs()) { // showcase: repo examples, then the owner's published designs
    if (gwLanding.OFF_LANDING?.has(slug)) continue; // never on the public landing (gateway/landing OFF_LANDING)
    const dir = SLUG_RE.test(slug) && exDir(slug);
    if (!dir || !fs.existsSync(path.join(dir, 'meta.json'))) continue;
    const thumb = vurl(dir, 'thumb.png', `/files/examples/${slug}/thumb.png`);
    if (!thumb) continue; // the gateway only lists examples it has a thumbnail for
    const meta = readJSON(path.join(dir, 'meta.json'), {}) || {};
    out.push({ slug, title: String(meta.title || slug).slice(0, 120), description: String(meta.description || '').slice(0, 400),
      creator: String(meta.creator || '').slice(0, 60), thumb, ...(ctx.social ? ctx.social.cardStats(slug) : {}) }); // social: likes, remixes, comments
    if (out.length >= 150) break;
  }
  return out;
}

async function localData() {
  if (heroSlug == null) heroSlug = (await gatewayData().catch(() => null))?.heroSlug || '';
  const ex = examples();
  const hero = ex.find((e) => e.slug === heroSlug) || ex[0];
  let quote = null;
  if (hero) {
    const bom = ctx.readJSON(path.join(ctx.exDir(hero.slug), 'bom.json'), {}) || {};
    try { quote = { slug: hero.slug, a: ctx.quote(bom, 'assembled'), k: ctx.quote(bom, 'kit') }; } catch { quote = null; }
    if (!quote || !Array.isArray(quote.a?.tiers)) quote = null;
  }
  return { examples: ex, quote, heroSlug, recent: ctx.social ? ctx.social.recent(24) : [] }; // social: designs finished lately (real)
}

/** ctx: { exampleSlugs, exDir, readJSON, vurl, quote, social? } */
function init(c) {
  ctx = c;
  gwLanding.data = localData;
  gwLanding.thumbUrl = (e) => e.thumb; // /files/examples/<slug>/thumb.png?v=<mtime>
  return { page: (req, res) => home.page(req, res, `http://${req.headers.host}`), asset: (req, res, p) => home.asset(req, res, p) };
}
module.exports = { init };

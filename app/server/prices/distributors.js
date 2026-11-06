// Live distributor prices: DigiKey Product Information API v4 and the Mouser Search API.
//
//   DigiKey  OAuth2 client credentials (2-legged). env DIGIKEY_CLIENT_ID + DIGIKEY_CLIENT_SECRET.
//            POST https://api.digikey.com/v1/oauth2/token            (form: client_id, client_secret, grant_type=client_credentials)
//            POST https://api.digikey.com/products/v4/search/keyword  (JSON: Keywords, Limit, Offset)
//            GET  https://api.digikey.com/products/v4/search/{productNumber}/productdetails
//            headers: Authorization: Bearer <token>, X-DIGIKEY-Client-Id, X-DIGIKEY-Locale-Site/Language/Currency
//   Mouser   env MOUSER_SEARCH_API_KEY (the "Search API" key, not the Order API key).
//            POST https://api.mouser.com/api/v1/search/keyword?apiKey=...     {SearchByKeywordRequest: {keyword, records, startingRecord}}
//            POST https://api.mouser.com/api/v1/search/partnumber?apiKey=...  {SearchByPartRequest: {mouserPartNumber, partSearchOptions}}
//
// Nothing here orders anything: search and product details only.
//
// Lookups never block a quote: get() answers from the cache (memory, backed by <DATA>/.sourcing/distributors.json) at once
// and queues a background fetch when the entry is missing or older than 24 h. One request at a time, spaced out, so the
// free tiers' rate limits are never hit. Without keys every lookup answers { status: "not_configured" }.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const TTL_MS = 24 * 3600e3;
const RETRY_AFTER_FAIL_MS = 15 * 60e3;
const GAP_MS = 2100;          // between requests: Mouser allows 30/min, DigiKey 120/min (one queue for both, so <= 29/min)
const DAILY_MAX = 900;        // per distributor per day (both free tiers allow 1,000/day)
const TIMEOUT_MS = 15e3;
const DIGIKEY = 'https://api.digikey.com';
const MOUSER = 'https://api.mouser.com/api/v1';

const env = (k) => String(process.env[k] || '').trim();
const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : null; };

function configured() {
  return { digikey: !!(env('DIGIKEY_CLIENT_ID') && env('DIGIKEY_CLIENT_SECRET')), mouser: !!env('MOUSER_SEARCH_API_KEY') };
}

// ---------------------------------------------------------------- response normalisers (pure; tested)
/** One normalised offer: { distributor, sku, mpn, manufacturer, description, url, stock, moq, breaks: [{qty, unit_usd}], lead_days } */
function fromDigikeyProduct(p) {
  if (!p || typeof p !== 'object') return null;
  const vars = Array.isArray(p.ProductVariations) ? p.ProductVariations : [];
  // Cut tape / bulk / tray, never Digi-Reel (adds a reeling fee); the variation with the lowest qty-1 price wins
  const usable = vars.filter((v) => !/digi-?reel/i.test(v?.PackageType?.Name || '') && (v.StandardPricing || []).length);
  usable.sort((a, b) => (a.MinimumOrderQuantity || 1) - (b.MinimumOrderQuantity || 1) || (a.StandardPricing[0].UnitPrice - b.StandardPricing[0].UnitPrice));
  const v = usable[0];
  const breaks = v ? v.StandardPricing.map((s) => ({ qty: Number(s.BreakQuantity) || 1, unit_usd: Number(s.UnitPrice) })).filter((b) => b.unit_usd > 0)
    : Number(p.UnitPrice) > 0 ? [{ qty: 1, unit_usd: Number(p.UnitPrice) }] : [];
  if (!breaks.length) return null;
  const weeks = num(p.ManufacturerLeadWeeks);
  return {
    distributor: 'DigiKey', sku: v?.DigiKeyProductNumber || '', mpn: p.ManufacturerProductNumber || '', manufacturer: p.Manufacturer?.Name || '',
    description: p.Description?.ProductDescription || p.Description?.DetailedDescription || '', url: p.ProductUrl || '',
    stock: Number(v?.QuantityAvailableforPackageType ?? p.QuantityAvailable) || 0, moq: Number(v?.MinimumOrderQuantity) || breaks[0].qty,
    breaks: breaks.sort((a, b) => a.qty - b.qty), lead_days: weeks ? Math.round(weeks * 7) : null,
    status: p.ProductStatus?.Status || '',
  };
}

function fromMouserPart(p) {
  if (!p || typeof p !== 'object') return null;
  const breaks = (p.PriceBreaks || []).filter((b) => !b.Currency || /usd/i.test(b.Currency))
    .map((b) => ({ qty: Number(b.Quantity) || 1, unit_usd: num(b.Price) })).filter((b) => b.unit_usd > 0).sort((a, b) => a.qty - b.qty);
  if (!breaks.length) return null;
  const lead = /(\d+)\s*(day|week)/i.exec(String(p.LeadTime || ''));
  return {
    distributor: 'Mouser', sku: p.MouserPartNumber || '', mpn: p.ManufacturerPartNumber || '', manufacturer: p.Manufacturer || '',
    description: p.Description || '', url: p.ProductDetailUrl || '',
    stock: num(p.AvailabilityInStock) ?? (num(/^([\d,]+)\s+In Stock/i.exec(String(p.Availability || ''))?.[1]) || 0),
    moq: Number(p.Min) || breaks[0].qty, breaks,
    lead_days: lead ? Number(lead[1]) * (/week/i.test(lead[2]) ? 7 : 1) : null,
    status: p.LifecycleStatus || '',
  };
}

/** Unit price at a quantity from price breaks (the break at or below qty; below the MOQ you pay the MOQ). */
function unitAt(breaks, qty) {
  if (!breaks?.length) return null;
  let best = breaks[0];
  for (const b of breaks) if (b.qty <= qty) best = b;
  const buy = Math.max(qty, best.qty);
  return { unit_usd: best.unit_usd, break_qty: best.qty, buy_qty: buy, extended_usd: +(best.unit_usd * buy).toFixed(4) };
}

/** Does an offer really match what the BOM line asked for? `must` = regex source the description/MPN has to contain. */
function matches(o, want) {
  if (!o) return false;
  if (/obsolete|discontinued|not for new designs/i.test(o.status || '')) return false;
  if (want.mpn && o.mpn && o.mpn.toUpperCase() === want.mpn.toUpperCase()) return true;
  if (want.must && !new RegExp(want.must, 'i').test(`${o.mpn} ${o.manufacturer} ${o.description}`)) return false;
  if (want.not && new RegExp(want.not, 'i').test(`${o.mpn} ${o.description}`)) return false;
  if (want.max_usd && o.breaks?.[0]?.unit_usd > want.max_usd) return false; // a $400 dev kit is not a $10 module
  return true;
}

// ---------------------------------------------------------------- HTTP clients
let dkToken = null; // { token, exp }
async function digikeyToken(fetchImpl) {
  if (dkToken && dkToken.exp > Date.now() + 30e3) return dkToken.token;
  const body = new URLSearchParams({ client_id: env('DIGIKEY_CLIENT_ID'), client_secret: env('DIGIKEY_CLIENT_SECRET'), grant_type: 'client_credentials' });
  const r = await fetchImpl(`${DIGIKEY}/v1/oauth2/token`, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`DigiKey sign-in ${r.status}${j.error_description ? ': ' + j.error_description : j.ErrorMessage ? ': ' + j.ErrorMessage : ''}`);
  dkToken = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 599) * 1000 };
  return dkToken.token;
}

async function digikey(want, fetchImpl) {
  const token = await digikeyToken(fetchImpl);
  const headers = { Authorization: `Bearer ${token}`, 'X-DIGIKEY-Client-Id': env('DIGIKEY_CLIENT_ID'), 'X-DIGIKEY-Locale-Site': 'US',
    'X-DIGIKEY-Locale-Language': 'en', 'X-DIGIKEY-Locale-Currency': 'USD', Accept: 'application/json', 'Content-Type': 'application/json' };
  // Keyword search for both MPNs and keywords: productdetails may need X-DIGIKEY-Account-Id with 2-legged tokens.
  const search = async (kw) => {
    const r = await fetchImpl(`${DIGIKEY}/products/v4/search/keyword`, { method: 'POST', headers, signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ Keywords: String(kw).slice(0, 250), Limit: 10, Offset: 0 }) });
    if (r.status === 401) dkToken = null;
    if (!r.ok) throw new Error(`DigiKey ${r.status}${r.status === 429 ? ' (rate limit)' : ''}`);
    const j = await r.json();
    return [...(j.ExactMatches || []), ...(j.Products || [])];
  };
  let products = [];
  if (want.digikey || want.mpn) products = await search(want.digikey || want.mpn);
  if (!products.map(fromDigikeyProduct).some((o) => matches(o, want)) && want.keyword && want.keyword !== (want.digikey || want.mpn)) products = await search(want.keyword);
  return products.map(fromDigikeyProduct).filter(Boolean);
}

async function mouser(want, fetchImpl) {
  const key = encodeURIComponent(env('MOUSER_SEARCH_API_KEY'));
  const post = async (p, body) => {
    const r = await fetchImpl(`${MOUSER}${p}?apiKey=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) throw new Error(`Mouser ${r.status}`);
    const j = await r.json();
    if (j.Errors?.length) throw new Error(`Mouser: ${j.Errors[0].Message || j.Errors[0].Code || 'error'}`);
    return j.SearchResults?.Parts || [];
  };
  let parts = [];
  if (want.mouser || want.mpn) parts = await post('/search/partnumber', { SearchByPartRequest: { mouserPartNumber: want.mouser || want.mpn, partSearchOptions: 'Exact' } });
  if (!parts.map(fromMouserPart).some((o) => matches(o, want)) && want.keyword) parts = await post('/search/keyword', { SearchByKeywordRequest: { keyword: want.keyword, records: 10, startingRecord: 0, searchOptions: 'InStock', searchWithYourSignUpLanguage: 'false' } });
  return parts.map(fromMouserPart).filter(Boolean);
}

/** Best matching offer per distributor, cheapest at qty 1 among in-stock ones (out-of-stock only when nothing is stocked). */
function pick(offers, want) {
  const ok = offers.filter((o) => matches(o, want));
  const cheap = (a, b) => a.breaks[0].unit_usd - b.breaks[0].unit_usd;
  const stocked = ok.filter((o) => o.stock > 0).sort(cheap);
  return stocked[0] || ok.sort(cheap)[0] || null;
}

// ---------------------------------------------------------------- cache + background queue
function create({ cacheFile, fetchImpl = (...a) => fetch(...a), now = () => Date.now(), log = console.error }) {
  let mem = null;
  const load = () => { if (!mem) { try { mem = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { mem = {}; } } return mem; };
  let saveT = null;
  const save = () => {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); const tmp = cacheFile + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(mem)); fs.renameSync(tmp, cacheFile); }
      catch (e) { log(`[prices] distributor cache write failed: ${e.message}`); }
    }, 300);
    saveT.unref?.();
  };
  const queue = [];
  const queued = new Set();
  let running = false;

  const day = { d: '', n: { digikey: 0, mouser: 0 } };
  const underCap = (dist) => { const d = new Date(now()).toISOString().slice(0, 10); if (day.d !== d) { day.d = d; day.n = { digikey: 0, mouser: 0 }; } return day.n[dist] < DAILY_MAX; };
  const keyOf = (dist, want) => `${dist}|${want.digikey || want.mouser || want.mpn || ''}|${want.keyword || ''}`.toLowerCase();

  async function pump() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const { dist, want, k } = queue.shift();
        if (!underCap(dist)) { queued.delete(k); continue; } // tomorrow
        day.n[dist]++;
        try {
          const offers = dist === 'digikey' ? await digikey(want, fetchImpl) : await mouser(want, fetchImpl);
          load()[k] = { at: now(), offer: pick(offers, want) };
        } catch (e) {
          const prev = load()[k];
          load()[k] = { ...(prev?.offer ? { offer: prev.offer, at: prev.at } : {}), failed_at: now(), error: String(e?.message || e).slice(0, 160) };
          log(`[prices] ${dist} lookup failed (${want.mpn || want.keyword}): ${load()[k].error}`);
        }
        queued.delete(k);
        save();
        if (queue.length) await new Promise((r) => setTimeout(r, GAP_MS));
      }
    } finally { running = false; }
  }

  /** Sync. -> { status: "not_configured" | "pending" | "live" | "no_match" | "error", offer?, at?, error? } for one distributor. */
  function one(dist, want) {
    if (!configured()[dist]) return { status: 'not_configured' };
    const k = keyOf(dist, want);
    const e = load()[k];
    const t = now();
    const fresh = e && ((e.at && !e.failed_at && t - e.at < TTL_MS) || (e.failed_at && t - e.failed_at < RETRY_AFTER_FAIL_MS));
    if (!fresh && !queued.has(k)) { queued.add(k); queue.push({ dist, want, k }); setImmediate(pump); }
    if (e?.offer && e.at && t - e.at < 7 * TTL_MS) return { status: 'live', offer: e.offer, at: e.at, refreshing: !fresh };
    if (e?.failed_at && fresh) return { status: 'error', error: e.error };
    if (e && e.at && !e.offer && fresh) return { status: 'no_match', at: e.at };
    return { status: 'pending' };
  }

  /** Sync. Cheapest live offer for `need` pieces across configured distributors, plus why when there is none. */
  function get(want, need) {
    const cfg = configured();
    if (!cfg.digikey && !cfg.mouser) return { status: 'not_configured' };
    const rs = ['digikey', 'mouser'].filter((d) => cfg[d]).map((d) => one(d, want));
    let best = null;
    for (const r of rs) {
      if (r.status !== 'live') continue;
      const p = unitAt(r.offer.breaks, need);
      if (!p) continue;
      const enough = r.offer.stock >= need;
      const score = p.extended_usd + (enough ? 0 : 1e6); // stocked first, then cheapest for this qty
      if (!best || score < best.score) best = { score, offer: r.offer, at: r.at, price: p, enough };
    }
    const pending = rs.some((r) => r.status === 'pending' || r.refreshing);
    if (best) return { status: 'live', ...best, pending };
    if (pending) return { status: 'pending' };
    const err = rs.find((r) => r.status === 'error');
    return err ? { status: 'error', error: err.error } : { status: 'no_match' };
  }

  return { get, configured, _pump: pump, _queue: queue, _mem: () => load() };
}

module.exports = { create, configured, fromDigikeyProduct, fromMouserPart, unitAt, matches, pick, TTL_MS };

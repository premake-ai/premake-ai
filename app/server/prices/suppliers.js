// The three shops we order from (config.ALLOWED_SUPPLIERS): Amazon (bought parts, pre-cut extrusion), SendCutSend
// (sheet / laser / CNC-routed parts), Slant 3D (printed parts). bom.json suppliers are free text written by the design
// agent ("Home Depot", "McMaster / hardware store", "Amazon / Micro Center"), so every reader normalises on read:
//   normalizeBom(bom)  bought lines from any other shop become "Amazon" (the original text kept as supplier_note, a
//                      non-Amazon link as ref_url) with an Amazon search URL, Prime-only, when there's no Amazon link.
//                      Exception (agentbrain, 2026-10-30): the three shops are PREFERRED, not the only ones. A line the
//                      agent marked "manual_order": true with a real shop and link keeps them; it is ordered by hand
//                      (fulfilment routes it to the manual "other" supplier) and priced from its parts-list estimate.
// Used by quote() in server.js (outermost wrapper), server/prices (list / distributor / extrusion gating), server/sourcing.js
// (links) and server/fulfilment (job suppliers). Existing designs show correctly without a rebuild.
'use strict';
const cfg = require('./config');

/** Amazon's "Prime eligible" search refinement (rh=p_85:2470955011), stable on amazon.com search URLs for years. */
const PRIME_RH = 'p_85:2470955011';
const AMAZON_RE = /^https?:\/\/([\w-]+\.)*(amazon\.com|amzn\.to|amzn\.com|a\.co)(\/|$)/i;

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIAS = { slant: 'slant3d', scs: 'sendcutsend', amazoncom: 'amazon', amzn: 'amazon', buildery: 'inhouse', builderyprint: 'inhouse' };
/** "Slant 3D" / "slant3d" / "SendCutSend" -> one comparable key. */
const canon = (s) => ALIAS[squash(s)] || squash(s);

/** The allowed shops (env ALLOWED_SUPPLIERS read live so tests and admins can widen it). */
function allowed() {
  const env = process.env.ALLOWED_SUPPLIERS;
  return env != null && env.trim() ? env.split(',').map((s) => s.trim()).filter(Boolean) : cfg.ALLOWED_SUPPLIERS;
}
/** Is this shop on the list? "A + B" (a list-price line from two shops) needs both. */
function isAllowed(name) {
  const keys = new Set(allowed().map(canon));
  const parts = String(name || '').split(/\s+\+\s+/).map(canon).filter(Boolean);
  return parts.length > 0 && parts.every((k) => keys.has(k));
}

/** Python's urllib quote_plus (cadlib/parts/catalog.py search_url). */
const quotePlus = (s) => encodeURIComponent(String(s || '')).replace(/%20/g, '+');
/** Amazon search, Prime-eligible only. Same URL cadlib.parts.search_url writes. */
const amazonSearchUrl = (term) => `https://www.amazon.com/s?k=${quotePlus(term)}&rh=${encodeURIComponent(PRIME_RH)}`;
const isAmazonUrl = (u) => AMAZON_RE.test(str(u));
/** A real product page (not a search): /dp/ASIN, /gp/product/ASIN, or a short link. */
const isAmazonProduct = (u) => isAmazonUrl(u) && (/\/(dp|gp\/product)\/[A-Z0-9]{10}/i.test(u) || /\/\/(amzn\.to|a\.co)\//i.test(u));
/** Add the Prime filter to a plain Amazon search link the agent wrote. */
function primeSearch(u) {
  if (!/amazon\.com\/s\?/i.test(u) || /[?&]rh=/.test(u)) return u;
  return `${u}&rh=${encodeURIComponent(PRIME_RH)}`;
}

/** What to search for a bought line: an explicit `search "..."` in notes, else the name without brackets / after a comma. */
function searchTerm(p) {
  const m = /search\s+["“]([^"”]{2,80})["”]/i.exec(str(p.notes)) || /search\s+["“]([^"”]{2,80})["”]/i.exec(str(p.search));
  if (m) return m[1].trim();
  if (str(p.search) && !/search\s/i.test(str(p.search))) return str(p.search).slice(0, 80);
  return str(p.name).replace(/\([^)]*\)/g, ' ').replace(/,.*$/, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** A deliberate non-preferred shop: "manual_order": true, a named shop and a real http(s) link (we don't auto-order it). */
function isManual(p) {
  const sup = str(p && p.supplier);
  return !!(p && p.manual_order === true && sup && !isAllowed(sup) && /^https?:\/\//i.test(str(p.url)));
}

/** The shop a bought line is ordered from: SendCutSend / Slant 3D when named (and allowed), another allowed shop when the
 * list was widened, the agent's own shop for a manual-order line, otherwise Amazon. */
function shopFor(p) {
  const sup = str(p && p.supplier);
  if (isManual(p)) return sup;
  if (sup && isAllowed(sup)) {
    const hit = allowed().find((a) => canon(a) === canon(sup));
    return hit || sup;
  }
  return 'Amazon';
}

/** One bought line -> its normalised copy (idempotent). */
function normalizePart(p) {
  if (!p || typeof p !== 'object') return p;
  if (isManual(p)) return { ...p, manual_order: true };
  const shop = shopFor(p);
  const orig = str(p.supplier);
  const out = { ...p, supplier: shop };
  if (p.manual_order) delete out.manual_order; // no real link / an allowed shop: ordered normally
  if (orig && orig !== shop && !p.supplier_note) out.supplier_note = orig;
  if (canon(shop) === 'amazon') {
    const u = str(p.url);
    if (isAmazonUrl(u)) out.url = primeSearch(u);
    else {
      out.url = amazonSearchUrl(searchTerm(p));
      if (u && !p.ref_url) out.ref_url = u; // the other shop's link, for reference only
    }
  }
  return out;
}

/** bom.json -> a copy whose bought lines are on allowed shops. Never written back to disk. */
function normalizeBom(bom) {
  if (!bom || typeof bom !== 'object' || bom._suppliers) return bom;
  const out = { ...bom, parts: Array.isArray(bom.parts) ? bom.parts.map(normalizePart) : bom.parts };
  Object.defineProperty(out, '_suppliers', { value: true, enumerable: false });
  return out;
}

/** The shop for a fabricated part: extrusion is bought pre-cut on Amazon; sheet, laser and CNC go to SendCutSend. */
const fabShop = (f) => (String(f && f.process) === 'extrusion' ? 'Amazon' : 'SendCutSend');

// ---------------------------------------------------------------- Amazon pre-cut extrusion
// T-slot / V-slot extrusion on Amazon comes in pre-cut lengths (100-1000 mm in 50 mm steps, then 1200 / 1500), usually
// 2-4 per pack. Price per piece (USD, Prime listings, Oct 2026 ballpark): base + per mm of the stock length. Estimate only.
const EXT_LENGTHS = [...Array.from({ length: 19 }, (_, i) => 100 + i * 50), 1200, 1500];
const EXT_PRICE = { 2020: [2.5, 0.009], 2040: [4, 0.016], 3030: [4, 0.015], 2060: [5, 0.024], 2080: [6, 0.032], 4040: [6, 0.026] };

/** profile, needed length (mm), tapped ends -> { usd, stock_mm, how, cut, url } or null (no pre-cut length is long enough). */
function amazonExtrusion(profile, lengthMm, taps = 0) {
  const prof = String(profile || '2020');
  const key = prof.replace(/[^0-9]/g, '').slice(0, 4);
  const len = Number(lengthMm) || 0;
  const stock = EXT_LENGTHS.find((L) => L >= len - 1);
  if (!(len > 0) || !stock) return null;
  const [a, b] = EXT_PRICE[key] || EXT_PRICE[2020].map((x) => x * 1.5);
  const cut = stock - len > 2;
  const how = `${stock} mm pre-cut${cut ? `, cut to ${Math.round(len)} mm` : ''}${taps ? `, tap ${taps} end${taps > 1 ? 's' : ''}` : ''}`;
  return { usd: Math.round((a + b * stock) * 100) / 100, stock_mm: stock, how, cut, url: amazonSearchUrl(`${prof} aluminum extrusion ${stock}mm`) };
}

module.exports = { PRIME_RH, allowed, isAllowed, canon, quotePlus, amazonSearchUrl, isAmazonUrl, isAmazonProduct, primeSearch, searchTerm,
  shopFor, isManual, normalizePart, normalizeBom, fabShop, amazonExtrusion, EXT_LENGTHS };

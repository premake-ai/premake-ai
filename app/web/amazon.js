// "Add all to Amazon basket" for the Order tab (web/ordertab.js). Pure helpers, no DOM (tests: server/ordertab.test.js).
// Amazon's cart-add URL takes exact ASINs: https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=<asin>&Quantity.1=<n>&...
// Amazon opens its own "add these to your cart?" page; nothing is added until the person confirms there. We never fetch
// or scrape Amazon: an ASIN only comes from a product link already in the parts list (amazon.com/dp/<ASIN>, etc.).

/** Associates tag appended to the basket link when set (e.g. 'premake-20'). Empty: no tag. The one place to add it. */
export const AMAZON_TAG = '';
export const CART_URL = 'https://www.amazon.com/gp/aws/cart/add.html';
const MAX_ITEMS = 50; // keep one link to a sane length; more items go in a second basket link

const AMZ_HOST = /^https?:\/\/([\w-]+\.)*amazon\.com(\/|$)/i;
const ASIN_RE = /^[A-Z0-9]{10}$/;

/** The ASIN in an amazon.com product link (/dp/X, /gp/product/X, /gp/aw/d/X, /exec/obidos/ASIN/X), else ''. Searches,
 * short links (amzn.to, a.co: we can't see where they go without fetching) and other sites give ''. */
export function asinOf(url) {
  const u = String(url || '').trim();
  if (!AMZ_HOST.test(u)) return '';
  const m = /\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/ASIN|o\/ASIN)\/([A-Za-z0-9]{10})(?=[/?#&]|$)/.exec(u);
  const a = m ? m[1].toUpperCase() : '';
  return ASIN_RE.test(a) ? a : '';
}

/** The ASIN for one Order-tab line: an explicit line.asin, else the first Amazon product link among its options. */
export function lineAsin(l) {
  const own = String(l?.asin || '').trim().toUpperCase();
  if (ASIN_RE.test(own)) return own;
  for (const o of l?.options || []) { const a = asinOf(o?.url); if (a) return a; }
  return asinOf(l?.url) || asinOf(l?.ref_url) || '';
}

/** Cart-add URL(s) for [{ asin, qty }]: same ASIN merged, bad ones dropped, at most 50 items per link.
 * opts.tag overrides AMAZON_TAG (tests). -> [url, ...] (empty when nothing has an ASIN). */
export function amazonCartUrls(items, opts = {}) {
  const tag = opts.tag ?? AMAZON_TAG;
  const merged = new Map();
  for (const it of items || []) {
    const a = String(it?.asin || '').toUpperCase(), q = Math.max(1, Math.floor(Number(it?.qty)) || 1);
    if (ASIN_RE.test(a)) merged.set(a, (merged.get(a) || 0) + q);
  }
  const all = [...merged], urls = [];
  for (let i = 0; i < all.length; i += MAX_ITEMS) {
    const qs = all.slice(i, i + MAX_ITEMS).map(([a, q], k) => `ASIN.${k + 1}=${a}&Quantity.${k + 1}=${q}`);
    if (tag) qs.push(`AssociateTag=${encodeURIComponent(tag)}`);
    urls.push(`${CART_URL}?${qs.join('&')}`);
  }
  return urls;
}

/** Split the Order tab's bought lines at n builds: { basket: [{ line, asin, qty }], search: [{ line, url, qty }], urls }.
 * search = lines with an Amazon option but no exact product (each opens its Amazon search). Lines with no Amazon option
 * at all (a manual-order shop) are in neither. */
export function amazonBasket(lines, n = 1, opts = {}) {
  const basket = [], search = [];
  for (const l of lines || []) {
    const qty = Math.max(1, (Number(l?.qty_per_unit) || 1) * (Math.floor(Number(n)) || 1));
    const asin = lineAsin(l);
    if (asin) { basket.push({ line: l, asin, qty }); continue; }
    const o = (l?.options || []).find(x => AMZ_HOST.test(String(x?.url || '')));
    if (o) search.push({ line: l, url: o.url, qty });
  }
  return { basket, search, urls: amazonCartUrls(basket, opts) };
}

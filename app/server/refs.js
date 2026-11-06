'use strict';
// refs: "Designing something like these": a few real photos of what a new design is based on, shown in the chat before
// the model lands (like a person showing reference pictures). The design agent finds 2-4 pages with a clear photo
// (WebSearch) and writes ./references.json; this module fetches each page's own preview image (og:image, twitter:image,
// or the URL itself when it is an image), saves it as <project>/uploads/ref-<n>.<ext> and returns the cards.
//
//   references.json: {"refs": [{"url": "https://...", "caption": "Open-source SCARA printer"}]}
//   fetchAll(dir, refs) -> [{ img: 'uploads/ref-1.jpg', url, caption, site }]
//
// Safety: http(s) only, no credentials in URLs, every hop's host must resolve to a public address (no localhost, LAN
// or link-local: the server runs on the user's machine), redirects followed by hand (3 max), small size and time caps,
// images must say they are JPEG / PNG / WebP / GIF and start with that format's magic bytes.
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns').promises;
const net = require('node:net');

const MAX = 4, PAGE_BYTES = 2e6, IMG_BYTES = 6e6, TIMEOUT = 9000;
const UA = 'Premake (open-source design studio; reference photos)';
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

function clean(j) {
  const list = Array.isArray(j?.refs) ? j.refs : Array.isArray(j) ? j : [];
  const out = [];
  for (const r of list) {
    let u; try { u = new URL(String(r?.url || '')); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) continue;
    out.push({ url: u.href, caption: String(r.caption || '').replace(/\s+/g, ' ').trim().slice(0, 90) });
    if (out.length >= MAX) break;
  }
  return out;
}

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || a >= 224;
  }
  const s = ip.toLowerCase();
  if (s.startsWith('::ffff:')) return privateIp(s.slice(7));
  return s === '::' || s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb') || s.startsWith('ff');
}
async function publicHost(u) {
  if (net.isIP(u.hostname)) return !privateIp(u.hostname);
  try { const addrs = await dns.lookup(u.hostname, { all: true }); return addrs.length > 0 && addrs.every((a) => !privateIp(a.address)); } catch { return false; }
}

/** GET with manual redirects, every hop checked; returns { res, url } or null. */
async function safeGet(href, accept) {
  let u = new URL(href);
  for (let hop = 0; hop < 4; hop++) {
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || !(await publicHost(u))) return null;
    const res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT), headers: { 'User-Agent': UA, Accept: accept } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { u = new URL(res.headers.get('location'), u); continue; }
    return res.ok ? { res, url: u } : null;
  }
  return null;
}
async function readCapped(res, cap) {
  const len = Number(res.headers.get('content-length') || 0);
  if (len > cap) return null;
  const chunks = []; let n = 0;
  for await (const c of res.body) { n += c.length; if (n > cap) return null; chunks.push(c); }
  return Buffer.concat(chunks);
}
const magicOk = (b, ext) => ext === 'jpg' ? b[0] === 0xff && b[1] === 0xd8 : ext === 'png' ? b.slice(0, 4).toString('hex') === '89504e47'
  : ext === 'gif' ? b.slice(0, 3).toString() === 'GIF' : ext === 'webp' ? b.slice(8, 12).toString() === 'WEBP' : false;

function previewImage(html, base) {
  const head = html.slice(0, 300000);
  const meta = (k) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*>`, 'i'), m = head.match(re);
    const c = m && m[0].match(/content=["']([^"']+)["']/i);
    return c ? c[1] : null;
  };
  const src = meta('og:image:secure_url') || meta('og:image') || meta('twitter:image') || meta('twitter:image:src')
    || (head.match(/<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i) || [])[1];
  const firstPhoto = () => { // no preview image: the first big-looking photo in the page (not a logo, icon or badge)
    for (const m of html.slice(0, 600000).matchAll(/<img\b[^>]*>/gi)) {
      const tag = m[0], u = (tag.match(/\ssrc=["']([^"']+)["']/i) || [])[1], w = Number((tag.match(/\swidth=["']?(\d+)/i) || [])[1] || 0);
      if (u && /\.(jpe?g|png|webp)(\?|$)/i.test(u) && !/logo|icon|sprite|badge|avatar|banner|button|flag|1x1|pixel/i.test(u) && (!w || w >= 250)) return u;
    }
    return null;
  };
  const pick = src || firstPhoto();
  if (!pick) return null;
  try { return new URL(pick.replace(/&amp;/g, '&'), base).href; } catch { return null; }
}

async function one(dir, r, n) {
  let got = await safeGet(r.url, 'text/html,image/*;q=0.9');
  if (!got) return null;
  let type = String(got.res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const pageUrl = got.url.href;
  if (!TYPES[type]) { // a page: its preview image
    if (!/html/.test(type)) return null;
    const html = await readCapped(got.res, PAGE_BYTES);
    const img = html && previewImage(html.toString('utf8'), got.url);
    if (!img) return null;
    got = await safeGet(img, 'image/*');
    if (!got) return null;
    type = String(got.res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  }
  const ext = TYPES[type];
  if (!ext) return null;
  const buf = await readCapped(got.res, IMG_BYTES);
  if (!buf || buf.length < 8000 || !magicOk(buf, ext)) return null; // a real photo, not a tiny icon
  const rel = `uploads/ref-${n}.${ext}`;
  fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), buf);
  return { img: rel, url: pageUrl, caption: r.caption, site: new URL(pageUrl).hostname.replace(/^www\./, '') };
}

/** Fetch every ref's picture (in parallel); the ones that worked, in order. */
async function fetchAll(dir, refs) {
  const res = await Promise.all(refs.map((r, i) => one(dir, r, i + 1).catch(() => null)));
  return res.filter(Boolean);
}

module.exports = { clean, fetchAll, privateIp };

// Web Push for companion-app alerts. Node crypto only, no dependencies:
//   RFC 8291 message encryption (ECDH P-256 + HKDF), RFC 8188 aes128gcm content coding, RFC 8292 VAPID (ES256 JWT),
//   RFC 8030 delivery (POST to the subscription's endpoint; 404/410 = the subscription is gone, so it's pruned).
//
//   GET    /api/push/key                              -> { publicKey }   (VAPID, base64url: the browser's applicationServerKey)
//   POST   /api/push/subscribe {subscription, app}    -> { ok }          (app = one of your own projects)
//   DELETE /api/push/subscribe {endpoint, app?}       -> { ok }          (no app: every app on that endpoint)
// All three are signed-in only (server/devices.js routes /api/push/* here); anyone else gets 404.
//
// Storage: <DATA>/push/<owner-hash>.json = [ { endpoint, keys: { p256dh, auth }, app, created } ]
// Endpoints must be a browser push service (Google, Mozilla, Microsoft, Apple): the Mac only ever POSTs to those, never
// to a URL a user picked (no SSRF into this Mac or the LAN).
// Keys live in app/.env.local: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT. Generate them once with
//   node server/push.js --gen-vapid        (appends to app/.env.local; never prints the private key)
// Changing the keys invalidates every existing subscription. VAPID_PRIVATE_KEY is in server.js SECRET_ENV (no child sees it).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');

const RS = 4096; // record size; one record per message (the payload is far smaller)
const MAX_PLAINTEXT = 3000; // push services must accept 4096 bytes of body; leave room for the header and tag
const SUBS_PER_OWNER = 20;
const PUSH_HOST = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/];
const APP_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const b64u = (b) => Buffer.from(b).toString('base64url');
/** Strict base64url (standard base64 and padding tolerated) -> Buffer of exactly len bytes, or null. */
function unb64u(s, len) {
  if (typeof s !== 'string') return null;
  const t = s.trim().replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (!/^[A-Za-z0-9_-]+$/.test(t)) return null;
  const b = Buffer.from(t, 'base64url');
  return len == null || b.length === len ? b : null;
}
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// ---------------------------------------------------------------- RFC 8291 / RFC 8188
/** All the RFC 8291 section 3.4 keys (returned whole so the tests can check each against the RFC's vector). */
function deriveKeys(ecdhSecret, authSecret, uaPublic, asPublic, salt) {
  const prkKey = hmac(authSecret, ecdhSecret); // HKDF-Extract(auth_secret, ecdh_secret)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])])); // HKDF-Expand(PRK_key, key_info, 32)
  const prk = hmac(salt, ikm); // HKDF-Extract(salt, IKM)
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  return { prkKey, keyInfo, ikm, prk, cek, nonce };
}

/**
 * Encrypt one push message for a subscription's keys ({ p256dh, auth } as base64url strings or Buffers).
 * Returns the aes128gcm body: salt(16) | rs(4) | idlen(1) | as_public(65) | ciphertext+tag.
 * opts.salt / opts.asPrivate fix the random parts (only the RFC test vector uses them); opts.pad adds zero padding.
 */
function encrypt(plaintext, keys, opts = {}) {
  const uaPublic = Buffer.isBuffer(keys.p256dh) ? keys.p256dh : unb64u(keys.p256dh, 65);
  const authSecret = Buffer.isBuffer(keys.auth) ? keys.auth : unb64u(keys.auth, 16);
  if (!uaPublic || uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('bad p256dh key');
  if (!authSecret || authSecret.length !== 16) throw new Error('bad auth secret');
  const data = Buffer.from(plaintext);
  const pad = opts.pad || 0;
  const rs = opts.rs || RS;
  if (data.length + 1 + pad + 16 > rs) throw new Error('push payload too large');
  const ecdh = crypto.createECDH('prime256v1');
  if (opts.asPrivate) ecdh.setPrivateKey(opts.asPrivate); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey(); // uncompressed, 65 bytes
  const salt = opts.salt || crypto.randomBytes(16);
  const k = deriveKeys(ecdh.computeSecret(uaPublic), authSecret, uaPublic, asPublic, salt);
  const cipher = crypto.createCipheriv('aes-128-gcm', k.cek, k.nonce);
  // a single, final record: plaintext, then the 0x02 delimiter, then optional zero padding
  const ct = Buffer.concat([cipher.update(Buffer.concat([data, Buffer.from([2]), Buffer.alloc(pad)])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(rs, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, ct]);
}

/** The browser's side of encrypt() (single record): used by the tests and the live end-to-end check. */
function decrypt(body, uaPrivate, authSecret) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const k = deriveKeys(ecdh.computeSecret(asPublic), authSecret, ecdh.getPublicKey(), asPublic, salt);
  const d = crypto.createDecipheriv('aes-128-gcm', k.cek, k.nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const rec = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  let i = rec.length - 1;
  while (i >= 0 && rec[i] === 0) i--;
  if (rec[i] !== 2) throw new Error('bad record delimiter');
  return rec.subarray(0, i);
}

// ---------------------------------------------------------------- RFC 8292 VAPID
function generateVapidKeys() {
  for (;;) {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = privateKey.export({ format: 'jwk' });
    const x = Buffer.from(jwk.x, 'base64url'), y = Buffer.from(jwk.y, 'base64url'), d = Buffer.from(jwk.d, 'base64url');
    if (x.length === 32 && y.length === 32 && d.length === 32) return { publicKey: b64u(Buffer.concat([Buffer.from([4]), x, y])), privateKey: b64u(d) };
  }
}

/** { publicKey, key (KeyObject), subject } from VAPID_* env vars, or null when missing / not a matching pair. */
function vapidFrom(env) {
  const pub = unb64u(env.VAPID_PUBLIC_KEY || '', 65);
  const d = unb64u(env.VAPID_PRIVATE_KEY || '', 32);
  const subject = String(env.VAPID_SUBJECT || '').trim();
  if (!pub || pub[0] !== 4 || !d || !/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(subject)) return null;
  try {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(d);
    if (!ecdh.getPublicKey().equals(pub)) return null;
    const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: b64u(d), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
    return { publicKey: b64u(pub), key, subject };
  } catch { return null; }
}

/** ES256 JWT for one push service origin; valid 12 h (push services reject more than 24 h). */
function vapidJwt(aud, vapid, nowSec = Math.floor(Date.now() / 1000)) {
  const enc = (o) => b64u(JSON.stringify(o));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud, exp: nowSec + 12 * 3600, sub: vapid.subject })}`;
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: vapid.key, dsaEncoding: 'ieee-p1363' });
  return `${unsigned}.${b64u(sig)}`;
}
const vapidAuth = (endpoint, vapid, nowSec) => `vapid t=${vapidJwt(new URL(endpoint).origin, vapid, nowSec)}, k=${vapid.publicKey}`;

// ---------------------------------------------------------------- subscriptions
/** A browser PushSubscription (toJSON() shape) checked and reduced to { endpoint, keys }; throws a 422 otherwise. */
function cleanSubscription(sub) {
  const bad = (why) => Object.assign(new Error(`Bad push subscription: ${why}`), { code: 422 });
  if (!sub || typeof sub !== 'object') throw bad('missing');
  const endpoint = typeof sub.endpoint === 'string' ? sub.endpoint.trim() : '';
  if (!endpoint || endpoint.length > 1024) throw bad('endpoint');
  if (!pushHostOk(endpoint)) throw bad('endpoint must be a browser push service');
  const p256dh = unb64u(sub.keys?.p256dh, 65), auth = unb64u(sub.keys?.auth, 16);
  if (!p256dh || p256dh[0] !== 4 || !auth) throw bad('keys');
  try { const e = crypto.createECDH('prime256v1'); e.generateKeys(); e.computeSecret(p256dh); } catch { throw bad('p256dh is not a P-256 point'); }
  return { endpoint, keys: { p256dh: b64u(p256dh), auth: b64u(auth) } };
}
function pushHostOk(endpoint) {
  let u; try { u = new URL(endpoint); } catch { return false; }
  return u.protocol === 'https:' && !u.port && !u.username && !u.password && PUSH_HOST.some((re) => re.test(u.hostname));
}

let deps = null; // { DATA, readJson, reply, ownsProject, now, env, transport }
let vapid = null;
let dir = null;

function init(d) {
  deps = d;
  dir = path.join(d.DATA, 'push');
  vapid = vapidFrom(d.env || process.env);
  if (!vapid) console.log('[push] VAPID keys missing or not a matching pair: push alerts are off (run: node server/push.js --gen-vapid)');
  return module.exports;
}
const enabled = () => !!vapid;
const publicKey = () => (vapid ? vapid.publicKey : null);
const ownerFile = (owner) => path.join(dir, crypto.createHash('sha256').update('buildery-push\0' + String(owner).toLowerCase()).digest('hex').slice(0, 32) + '.json');

function realDir() {
  const s = (() => { try { return fs.lstatSync(dir); } catch { return null; } })();
  if (!s) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  else if (!s.isDirectory()) throw Object.assign(new Error('push storage is not a directory'), { code: 500 });
  return dir;
}
function load(owner) {
  let fd;
  try { fd = fs.openSync(ownerFile(owner), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); } catch { return []; }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > 1e6) return [];
    const list = JSON.parse(fs.readFileSync(fd, 'utf8'));
    return Array.isArray(list) ? list.filter((s) => s && typeof s.endpoint === 'string' && s.keys && APP_RE.test(String(s.app || ''))) : [];
  } catch { return []; } finally { fs.closeSync(fd); }
}
function save(owner, list) {
  realDir();
  const file = ownerFile(owner);
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(list, null, 1)); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
function subscribe(owner, sub, app) {
  const s = cleanSubscription(sub);
  const list = load(owner).filter((x) => !(x.endpoint === s.endpoint && x.app === app));
  list.push({ endpoint: s.endpoint, keys: s.keys, app, created: new Date(now()).toISOString() });
  save(owner, list.slice(-SUBS_PER_OWNER));
}
function unsubscribe(owner, endpoint, app) {
  const list = load(owner);
  const keep = list.filter((x) => !(x.endpoint === endpoint && (!app || x.app === app)));
  if (keep.length !== list.length) save(owner, keep);
  return list.length - keep.length;
}
const now = () => (deps && deps.now ? deps.now() : Date.now());

// ---------------------------------------------------------------- sending
function httpsPost(endpoint, headers, body) {
  return new Promise((resolve) => {
    const req = https.request(endpoint, { method: 'POST', headers, timeout: 15e3 }, (r) => {
      let text = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { if (text.length < 2000) text += c; });
      r.on('end', () => resolve({ status: r.statusCode, body: text }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.end(body);
  });
}

/** POST one encrypted message. opts: { ttl (s), urgency: very-low|low|normal|high, topic (<= 32 base64url chars) } */
async function sendOne(sub, payload, opts = {}) {
  if (!vapid) return { status: 0, error: 'push is not configured' };
  if (!pushHostOk(sub.endpoint)) return { status: 0, error: 'endpoint not allowed' };
  const body = encrypt(payload, sub.keys);
  const headers = {
    'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', 'Content-Length': body.length,
    TTL: String(Math.max(0, Math.min(Math.floor(opts.ttl ?? 12 * 3600), 28 * 86400))),
    Urgency: ['very-low', 'low', 'normal', 'high'].includes(opts.urgency) ? opts.urgency : 'normal',
    Authorization: vapidAuth(sub.endpoint, vapid, Math.floor(now() / 1000)),
  };
  if (typeof opts.topic === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(opts.topic)) headers.Topic = opts.topic;
  return (deps?.transport || httpsPost)(sub.endpoint, headers, body);
}

/** Send msg (a small JSON object, see CONTRACT.md "Push message") to every subscription of owner for app; prune dead ones. */
async function notify(owner, app, msg, opts = {}) {
  if (!vapid) return { sent: 0, pruned: 0, skipped: 'push is not configured' };
  const subs = load(owner).filter((s) => s.app === app);
  if (!subs.length) return { sent: 0, pruned: 0 };
  let payload = Buffer.from(JSON.stringify(msg));
  if (payload.length > MAX_PLAINTEXT) payload = Buffer.from(JSON.stringify({ ...msg, body: String(msg.body || '').slice(0, 300) }));
  const results = await Promise.all(subs.map((s) => sendOne(s, payload, opts).catch((e) => ({ status: 0, error: e.message }))));
  const gone = new Set(subs.filter((s, i) => results[i].status === 404 || results[i].status === 410).map((s) => s.endpoint));
  if (gone.size) save(owner, load(owner).filter((x) => !(x.app === app && gone.has(x.endpoint))));
  const failed = results.filter((r) => !(r.status >= 200 && r.status < 300) && r.status !== 404 && r.status !== 410);
  if (failed.length) console.log(`[push] ${failed.length} of ${subs.length} sends failed: ${failed.map((r) => r.status || r.error).join(', ')}`);
  return { sent: results.filter((r) => r.status >= 200 && r.status < 300).length, pruned: gone.size, results: results.map((r) => r.status) };
}

// ---------------------------------------------------------------- routes (called by devices.api for /api/push/*)
async function api(req, res, { parts, m, acc }) {
  const { reply, readJson, ownsProject } = deps;
  const [, , b, c] = parts;
  if (c !== undefined || (b !== 'key' && b !== 'subscribe')) return false;
  const user = acc && acc.authed && typeof acc.user === 'string' ? acc.user : '';
  if (!user) { reply(res, 404, { error: 'not found' }); return true; }
  if (b === 'key') {
    if (m !== 'GET') { reply(res, 405, { error: 'GET only' }); return true; }
    if (!vapid) { reply(res, 503, { error: 'Push alerts are not set up on this server yet.' }); return true; }
    reply(res, 200, { publicKey: vapid.publicKey });
    return true;
  }
  if (m !== 'POST' && m !== 'DELETE') { reply(res, 405, { error: 'POST or DELETE' }); return true; }
  if (!deps.allow('push:' + user, 60, 3600e3)) { reply(res, 429, { error: 'Too many changes to alerts this hour. Try again later.' }); return true; }
  const body = await readJson(req, 8192);
  const app = typeof body.app === 'string' ? body.app : '';
  if (m === 'POST') {
    if (!APP_RE.test(app) || !ownsProject(user, app)) { reply(res, 404, { error: 'not found' }); return true; }
    if (!vapid) { reply(res, 503, { error: 'Push alerts are not set up on this server yet.' }); return true; }
    subscribe(user, body.subscription, app);
    reply(res, 200, { ok: true });
    return true;
  }
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
  if (!endpoint) { reply(res, 422, { error: 'endpoint required' }); return true; }
  if (app && !APP_RE.test(app)) { reply(res, 422, { error: 'bad app' }); return true; }
  unsubscribe(user, endpoint, app || null);
  reply(res, 200, { ok: true });
  return true;
}

module.exports = { init, api, notify, sendOne, subscribe, unsubscribe, load, enabled, publicKey, encrypt, decrypt, deriveKeys,
  generateVapidKeys, vapidFrom, vapidJwt, vapidAuth, cleanSubscription, pushHostOk, ownerFile, unb64u, b64u };

// ---------------------------------------------------------------- one-time key generation
// node server/push.js --gen-vapid [env file] [subject]   appends VAPID_* to app/.env.local unless they are already there
if (require.main === module && process.argv[2] === '--gen-vapid') {
  const file = path.resolve(process.argv[3] || path.join(__dirname, '..', '.env.local'));
  const subject = process.argv[4] || (process.env.FORMA_CONTACT_EMAIL ? `mailto:${process.env.FORMA_CONTACT_EMAIL}` : 'mailto:admin@localhost.local');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (/^\s*VAPID_(PUBLIC|PRIVATE)_KEY=/m.test(text)) {
    console.log(`VAPID keys are already in ${file}; left unchanged (new keys would break existing subscriptions).`);
  } else {
    const k = generateVapidKeys();
    fs.appendFileSync(file, `${text && !text.endsWith('\n') ? '\n' : ''}\n# Web Push for companion-app alerts (server/push.js). Generated once: new keys break existing subscriptions.\n`
      + `VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}\nVAPID_SUBJECT=${subject}\n`, { mode: 0o600 });
    console.log(`VAPID keys added to ${file}. Public key: ${k.publicKey}`);
  }
}

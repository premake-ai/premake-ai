// node --test server/push.test.js   (no network: push services are replaced by a fake transport)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const P = require('./push');

const u = (s) => Buffer.from(s.replace(/\s+/g, ''), 'base64url');

// ---------------------------------------------------------------- RFC 8291 section 5 / appendix A
test('encryption matches the RFC 8291 test vector, byte for byte', () => {
  const v = {
    plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
    asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    salt: 'DGv6ra1nlYgDCS1FRnbzlw',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    ecdh: 'kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs',
    prkKey: 'Snr3JMxaHVDXHWJn5wdC52WjpCtd2EIEGBykDcZW32k',
    keyInfo: `V2ViUHVzaDogaW5mbwAEJXGyvs3942BVGq8e0PTNNmwRzr5VX4m8t7GGpTM5FzFo7OLr4BhZe9MEebhuPI-OztV3ylkYfpJGmQ22ggCLDgT-M_SrDepxkU21WCP3O1SUj0Ew
      bZIHMtu5pZpTKGSCIA5Zent7wmC6HCJ5mFgJkuk5cwAvMBKiiujwa7t45ewP`,
    ikm: 'S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg',
    prk: '09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc',
    cek: 'oIhVW04MRdy2XN9CiKLxTg',
    nonce: '4h_95klXJ5E_qnoN',
    body: `DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
      pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`,
  };
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(u(v.asPrivate));
  assert.ok(ecdh.getPublicKey().equals(u(v.asPublic)), 'as_public');
  const secret = ecdh.computeSecret(u(v.uaPublic));
  assert.ok(secret.equals(u(v.ecdh)), 'ecdh_secret');
  const k = P.deriveKeys(secret, u(v.auth), u(v.uaPublic), u(v.asPublic), u(v.salt));
  for (const name of ['prkKey', 'keyInfo', 'ikm', 'prk', 'cek', 'nonce']) assert.ok(k[name].equals(u(v[name])), name);
  const body = P.encrypt(u(v.plaintext), { p256dh: v.uaPublic, auth: v.auth }, { salt: u(v.salt), asPrivate: u(v.asPrivate) });
  assert.equal(P.b64u(body), P.b64u(u(v.body)));
  assert.equal(body.readUInt32BE(16), 4096, 'rs');
  assert.equal(body[20], 65, 'idlen');
  assert.equal(P.decrypt(body, u(v.uaPrivate), u(v.auth)).toString(), 'When I grow up, I want to be a watermelon');
});

test('encryption round trip with random keys, padding, tampering, size limit', () => {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const keys = { p256dh: P.b64u(ua.getPublicKey()), auth: P.b64u(auth) };
  const msg = JSON.stringify({ title: 'Plant Sensor', body: 'Fern needs a drink (25%)' });
  const a = P.encrypt(msg, keys), b = P.encrypt(msg, keys);
  assert.ok(!a.equals(b), 'fresh salt and key every time');
  assert.equal(P.decrypt(a, ua.getPrivateKey(), auth).toString(), msg);
  assert.equal(P.decrypt(P.encrypt(msg, keys, { pad: 100 }), ua.getPrivateKey(), auth).toString(), msg);
  const bad = Buffer.from(a); bad[bad.length - 1] ^= 1;
  assert.throws(() => P.decrypt(bad, ua.getPrivateKey(), auth));
  assert.throws(() => P.encrypt('x'.repeat(4096), keys), /too large/);
  assert.throws(() => P.encrypt(msg, { p256dh: keys.p256dh, auth: 'short' }), /auth/);
  assert.throws(() => P.encrypt(msg, { p256dh: 'AAAA', auth: keys.auth }), /p256dh/);
});

// ---------------------------------------------------------------- RFC 8292 VAPID
test('VAPID: generated keys, matching pair check, ES256 JWT that verifies, vapid auth header', () => {
  const k = P.generateVapidKeys();
  assert.equal(u(k.publicKey).length, 65);
  assert.equal(u(k.publicKey)[0], 4);
  assert.equal(u(k.privateKey).length, 32);
  const vapid = P.vapidFrom({ VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey, VAPID_SUBJECT: 'mailto:owner@example.com' });
  assert.ok(vapid);
  const other = P.generateVapidKeys();
  assert.equal(P.vapidFrom({ VAPID_PUBLIC_KEY: other.publicKey, VAPID_PRIVATE_KEY: k.privateKey, VAPID_SUBJECT: 'mailto:a@b.co' }), null, 'mismatched pair');
  assert.equal(P.vapidFrom({ VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey, VAPID_SUBJECT: 'josh' }), null, 'subject must be mailto: or https:');
  assert.equal(P.vapidFrom({}), null);
  const now = 1_800_000_000;
  const jwt = P.vapidJwt('https://fcm.googleapis.com', vapid, now);
  const [h, p, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(u(h)), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(u(p)), { aud: 'https://fcm.googleapis.com', exp: now + 12 * 3600, sub: 'mailto:owner@example.com' });
  const pub = u(k.publicKey);
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: P.b64u(pub.subarray(1, 33)), y: P.b64u(pub.subarray(33)) }, format: 'jwk' });
  assert.equal(u(s).length, 64, 'JOSE r||s, not DER');
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, u(s)));
  const auth = P.vapidAuth('https://updates.push.services.mozilla.com/wpush/v2/abc', vapid, now);
  assert.match(auth, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/);
  assert.equal(JSON.parse(u(auth.slice(8).split('.')[1])).aud, 'https://updates.push.services.mozilla.com', 'aud is the origin only');
});

test('--gen-vapid appends the keys once and never prints the private key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vapid-'));
  const env = path.join(dir, '.env.local');
  fs.writeFileSync(env, 'FORMA_PASSWORD=x', { mode: 0o600 });
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'push.js'), '--gen-vapid', env], { encoding: 'utf8' });
    const text = fs.readFileSync(env, 'utf8');
    const get = (k) => (new RegExp(`^${k}=(.*)$`, 'm').exec(text) || [])[1];
    assert.ok(text.startsWith('FORMA_PASSWORD=x\n'));
    assert.ok(P.vapidFrom({ VAPID_PUBLIC_KEY: get('VAPID_PUBLIC_KEY'), VAPID_PRIVATE_KEY: get('VAPID_PRIVATE_KEY'), VAPID_SUBJECT: get('VAPID_SUBJECT') }));
    assert.equal(get('VAPID_SUBJECT'), 'mailto:owner@example.com');
    assert.ok(out.includes(get('VAPID_PUBLIC_KEY')));
    assert.ok(!out.includes(get('VAPID_PRIVATE_KEY')), 'private key never printed');
    assert.equal(fs.statSync(env).mode & 0o777, 0o600);
    execFileSync(process.execPath, [path.join(__dirname, 'push.js'), '--gen-vapid', env], { encoding: 'utf8' });
    assert.equal(fs.readFileSync(env, 'utf8'), text, 'second run changes nothing');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- subscriptions and sending
function browserSub(endpoint) {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  return { sub: { endpoint, expirationTime: null, keys: { p256dh: P.b64u(ua.getPublicKey()), auth: P.b64u(auth) } }, priv: ua.getPrivateKey(), auth };
}

test('subscriptions: browser push services only (no SSRF), valid P-256 keys', () => {
  for (const ep of ['https://fcm.googleapis.com/fcm/send/abc:def', 'https://updates.push.services.mozilla.com/wpush/v2/gAAA', 'https://web.push.apple.com/QGx',
    'https://wns2-par02p.notify.windows.com/w/?token=x', 'https://android.googleapis.com/gcm/send/x']) {
    assert.equal(P.cleanSubscription(browserSub(ep).sub).endpoint, ep);
  }
  for (const ep of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://[::1]/x',
    'https://evil.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://evilpush.apple.com.attacker.net/x', 'https://user:pw@fcm.googleapis.com/x',
    'https://192.168.1.10/x', 'https://premake.ai/api/d/ingest', 'file:///etc/passwd', '', 'x'.repeat(2000)]) {
    assert.throws(() => P.cleanSubscription(browserSub(ep).sub), /Bad push subscription/, ep);
  }
  const { sub } = browserSub('https://fcm.googleapis.com/fcm/send/x');
  assert.throws(() => P.cleanSubscription({ ...sub, keys: { ...sub.keys, auth: 'AAAA' } }), /keys/);
  const notOnCurve = Buffer.alloc(65, 1); notOnCurve[0] = 4;
  assert.throws(() => P.cleanSubscription({ ...sub, keys: { ...sub.keys, p256dh: P.b64u(notOnCurve) } }), /P-256/);
  assert.throws(() => P.cleanSubscription(null), /missing/);
});

function setup(transport) {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'push-test-'));
  const k = P.generateVapidKeys();
  const owners = { pa: 'a@x.com', pc: 'a@x.com', pb: 'b@x.com' };
  const replies = [];
  const hits = new Map();
  P.init({
    DATA, now: () => 1_800_000_000_000, transport,
    env: { VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey, VAPID_SUBJECT: 'mailto:owner@example.com' },
    ownsProject: (user, app) => owners[app] === user,
    allow: (key, limit) => { hits.set(key, (hits.get(key) || 0) + 1); return hits.get(key) <= limit; },
    readJson: async (req) => req.body,
    reply: (res, code, obj) => replies.push([code, obj]),
  });
  return { DATA, k, replies, close: () => fs.rmSync(DATA, { recursive: true, force: true }) };
}

test('notify: encrypted, VAPID-signed POSTs to that app\'s subscriptions; 404/410 pruned, other failures kept', async () => {
  const calls = [];
  const status = new Map();
  const env = setup(async (endpoint, headers, body) => { calls.push({ endpoint, headers, body }); return { status: status.get(endpoint) || 201 }; });
  try {
    const s1 = browserSub('https://fcm.googleapis.com/fcm/send/one');
    const s2 = browserSub('https://updates.push.services.mozilla.com/wpush/v2/two');
    const s3 = browserSub('https://web.push.apple.com/three');
    const other = browserSub('https://fcm.googleapis.com/fcm/send/other-app');
    P.subscribe('a@x.com', s1.sub, 'pa');
    P.subscribe('a@x.com', s2.sub, 'pa');
    P.subscribe('a@x.com', s3.sub, 'pa');
    P.subscribe('a@x.com', other.sub, 'pc');
    P.subscribe('a@x.com', s1.sub, 'pa'); // same endpoint + app again: replaced, not duplicated
    const file = P.ownerFile('a@x.com');
    assert.match(path.basename(file), /^[0-9a-f]{32}\.json$/);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(P.load('a@x.com').length, 4);
    status.set(s2.sub.endpoint, 410);
    status.set(s3.sub.endpoint, 500);
    const msg = { title: 'Plant Sensor', body: 'Fern needs a drink (25%)', tag: 'dv_0123456789:thirsty', url: '/apps/pa', app: 'pa', device: 'dv_0123456789', rule: 'thirsty', severity: 'high', t: '2027-01-15T08:00:00.000Z' };
    const r = await P.notify('a@x.com', 'pa', msg, { urgency: 'high', topic: 'dv0123456789thirsty', ttl: 3600 });
    assert.deepEqual([r.sent, r.pruned], [1, 1]);
    assert.equal(calls.length, 3, 'only app pa');
    const one = calls.find((c) => c.endpoint === s1.sub.endpoint);
    assert.equal(one.headers['Content-Encoding'], 'aes128gcm');
    assert.equal(one.headers['Content-Type'], 'application/octet-stream');
    assert.equal(one.headers.TTL, '3600');
    assert.equal(one.headers.Urgency, 'high');
    assert.equal(one.headers.Topic, 'dv0123456789thirsty');
    assert.equal(one.headers['Content-Length'], one.body.length);
    assert.match(one.headers.Authorization, new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${env.k.publicKey}$`));
    assert.deepEqual(JSON.parse(P.decrypt(one.body, s1.priv, s1.auth)), msg, 'the browser can decrypt it');
    assert.deepEqual(P.load('a@x.com').map((s) => [s.endpoint, s.app]).sort(),
      [[s1.sub.endpoint, 'pa'], [s3.sub.endpoint, 'pa'], [other.sub.endpoint, 'pc']].sort(), '410 pruned; 500 kept; other app untouched');
    status.set(s1.sub.endpoint, 404);
    await P.notify('a@x.com', 'pa', msg);
    assert.ok(!P.load('a@x.com').some((s) => s.endpoint === s1.sub.endpoint), '404 pruned');
    assert.deepEqual(await P.notify('nobody@x.com', 'pa', msg), { sent: 0, pruned: 0 });
    assert.equal(P.unsubscribe('a@x.com', other.sub.endpoint, 'pa'), 0, 'app must match when given');
    assert.equal(P.unsubscribe('a@x.com', other.sub.endpoint), 1);
  } finally { env.close(); }
});

test('push routes: signed in only, your own app only, 503 without keys', async () => {
  const env = setup(async () => ({ status: 201 }));
  try {
    const call = async (m, b, acc, body) => { env.replies.length = 0; const handled = await P.api({ body }, {}, { parts: ['api', 'push', b], m, acc }); return [handled, ...(env.replies[0] || [])]; };
    const a = { authed: true, user: 'a@x.com' };
    assert.deepEqual(await call('GET', 'key', { authed: false, user: '' }), [true, 404, { error: 'not found' }]);
    assert.deepEqual(await call('GET', 'key', a), [true, 200, { publicKey: env.k.publicKey }]);
    const s = browserSub('https://fcm.googleapis.com/fcm/send/x');
    assert.deepEqual((await call('POST', 'subscribe', a, { subscription: s.sub, app: 'pb' })).slice(1), [404, { error: 'not found' }], "b's app");
    assert.deepEqual((await call('POST', 'subscribe', a, { subscription: s.sub, app: '../pa' })).slice(1), [404, { error: 'not found' }]);
    assert.deepEqual((await call('POST', 'subscribe', a, { subscription: s.sub, app: 'pa' })).slice(1), [200, { ok: true }]);
    await assert.rejects(call('POST', 'subscribe', a, { subscription: { ...s.sub, endpoint: 'https://127.0.0.1:8800/api/admin' }, app: 'pa' }), (e) => e.code === 422);
    assert.equal(P.load('a@x.com').length, 1);
    assert.deepEqual((await call('DELETE', 'subscribe', a, { endpoint: s.sub.endpoint })).slice(1), [200, { ok: true }]);
    assert.equal(P.load('a@x.com').length, 0);
    assert.deepEqual(await call('POST', 'nope', a, {}), [false]);
    // no keys: the key route and new subscriptions say so
    P.init({ DATA: env.DATA, env: {}, reply: (res, code, obj) => env.replies.push([code, obj]), readJson: async (req) => req.body, ownsProject: () => true, allow: () => true });
    assert.equal((await call('GET', 'key', a))[1], 503);
    assert.equal((await call('POST', 'subscribe', a, { subscription: s.sub, app: 'pa' }))[1], 503);
    assert.deepEqual(await P.notify('a@x.com', 'pa', {}), { sent: 0, pruned: 0, skipped: 'push is not configured' });
  } finally { env.close(); }
});

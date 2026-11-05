'use strict';
// premake-api: the HTTP server around src/api.js. No dependencies beyond Node 22 (and Python + CadQuery for STEP files).
//
//   PORT                 port to listen on (default 8080)
//   DATA_DIR             where uploads, quotes, supplier caches and the RMFG token live (default ./data; a volume in prod)
//   PUBLIC_URL           base URL put in quote links (default http://<Host header>)
//   GATEWAY_SECRET       when set, a request carrying X-Premake-Gateway: <secret> is trusted for X-Premake-Client-Ip
//                        (a reverse proxy in front tells us the visitor's IP for the per-IP limits)
//   TRUST_PROXY=1        otherwise trust X-Real-IP / the last X-Forwarded-For hop (behind a plain reverse proxy)
//   PYTHON               interpreter with cadquery installed (default python3)
//   API_V1_SUPPLIERS_OFF comma list of supplier ids to switch off (rmfg, materiam, afn, slant3d, sendcutsend, premake)
//   API_V1_PARTS_PER_DAY, API_V1_QUOTES_PER_DAY, API_V1_QUOTES_ALL_PER_DAY   limits (60, 20, 500)
//   RMFG_TOKEN_JSON, RMFG_CLIENT_ID   see src/suppliers/rmfg.js
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 8080);
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const GATEWAY_SECRET = process.env.GATEWAY_SECRET || '';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function viaGateway(req) {
  const v = req.headers['x-premake-gateway'];
  if (!GATEWAY_SECRET || typeof v !== 'string') return false;
  const h = (x) => crypto.createHash('sha256').update(x).digest();
  return crypto.timingSafeEqual(h(v), h(GATEWAY_SECRET));
}
function clientIp(req) {
  const ok = (v) => { const s = String(v || '').trim(); return net.isIP(s) ? s : ''; };
  if (viaGateway(req)) { const ip = ok(req.headers['x-premake-client-ip']); if (ip) return ip; }
  if (TRUST_PROXY) {
    const real = ok(req.headers['x-real-ip']);
    if (real) return real;
    const last = ok(String(req.headers['x-forwarded-for'] || '').split(',').pop());
    if (last) return last;
  }
  return req.socket.remoteAddress || '?';
}

/** Sliding-window counter: true if under the limit (and records the hit). In memory: a restart resets the limits. */
const hits = new Map();
function allow(key, limit, windowMs) {
  const t = Date.now();
  const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
  if (list.length >= limit) { hits.set(key, list); return false; }
  list.push(t); hits.set(key, list);
  return true;
}
setInterval(() => { const t = Date.now(); for (const [k, l] of hits) if (!l.some((x) => t - x < 864e5)) hits.delete(k); }, 600e3).unref();

const api = require('./src/api').init({ DATA, send, allow, clientIp });

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    const m = req.method;
    if (url.pathname === '/healthz') return send(res, 200, { ok: true });
    if (parts.length === 0 && (m === 'GET' || m === 'HEAD')) {
      return send(res, 200, { name: 'premake-api', docs: 'https://github.com/premake-ai/premake-ai', endpoints: ['GET /api/v1/suppliers', 'POST /api/v1/parts', 'POST /api/v1/quotes', 'GET /api/v1/quotes/:id'] });
    }
    if (((parts[0] === 'api' && parts[1] === 'v1') || parts[0] === 'q') && await api.handle(req, res, { parts, m, url }) !== false) return;
    send(res, 404, { error: 'Not found. See GET /api/v1/suppliers, POST /api/v1/parts, POST /api/v1/quotes, GET /api/v1/quotes/:id' });
  } catch (e) {
    console.error('[server]', e.stack || e.message);
    if (!res.headersSent) send(res, 500, { error: 'server error' }); else res.destroy();
  }
});
server.requestTimeout = 5 * 60e3; // slow 50 MB uploads
server.keepAliveTimeout = 65e3;
// '::' takes IPv4 and IPv6 (Railway's private network is IPv6)
server.listen(PORT, '::', () => console.log(`premake-api on :${PORT}  data: ${DATA}  public: ${process.env.PUBLIC_URL || '(from Host)'}  gateway secret: ${GATEWAY_SECRET ? 'set' : 'not set'}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); setTimeout(() => process.exit(0), 500).unref(); });

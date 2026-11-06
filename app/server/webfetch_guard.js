// Security recheck C3: a Claude Code PreToolUse hook for the design agent's WebFetch (server.js agentArgs --settings).
// WebFetch runs on this Mac, and the hostname deny rules (AGENT_DENIED) are easy to dodge (127.0.0.1.nip.io, decimal IPs,
// the Mac's LAN or IPv6 address). This resolves the name first and refuses any URL whose addresses include loopback,
// private, link-local, carrier-grade NAT, multicast/reserved space or one of this Mac's own interface addresses.
// Every redirect hop is a new WebFetch call (WebFetch hands cross-host redirects back to the model), so each hop is checked.
// Exit 2 = block (Claude Code shows stderr to the model); exit 0 = allow.
'use strict';
const dns = require('node:dns').promises;
const net = require('node:net');
const os = require('node:os');

function v4parts(a) { return a.split('.').map(Number); }
function privateV4(a) {
  const [x, y] = v4parts(a);
  return x === 0 || x === 10 || x === 127 || (x === 100 && y >= 64 && y <= 127) || (x === 169 && y === 254)
    || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 192 && y === 0) || (x === 198 && (y === 18 || y === 19))
    || x >= 224;
}
function expandV6(a) {
  let s = a.toLowerCase().split('%')[0];
  const m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s); // trailing dotted v4
  if (m) { const [p, q, r, t] = v4parts(m[2]); s = m[1] + ((p << 8) | q).toString(16) + ':' + ((r << 8) | t).toString(16); }
  const [h, t = ''] = s.split('::');
  const hs = h ? h.split(':') : [], ts = t ? t.split(':') : [];
  const mid = s.includes('::') ? Array(8 - hs.length - ts.length).fill('0') : [];
  return [...hs, ...mid, ...ts].map((x) => parseInt(x || '0', 16));
}
function privateV6(a) {
  const w = expandV6(a);
  if (w.length !== 8 || w.some((x) => Number.isNaN(x))) return true;
  if (w.every((x) => x === 0)) return true; // ::
  if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return true; // ::1
  const v4 = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) return privateV4(v4(w[6], w[7])); // v4-mapped / compatible
  if (w[0] === 0x64 && w[1] === 0xff9b) return privateV4(v4(w[6], w[7])); // NAT64
  if (w[0] === 0x2002) return privateV4(v4(w[1], w[2])); // 6to4
  return (w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfe80 || (w[0] & 0xffc0) === 0xfec0 || (w[0] & 0xff00) === 0xff00;
}
function ownAddrs() {
  const out = new Set();
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) out.add(String(i.address).toLowerCase().split('%')[0]);
  return out;
}
function blockedAddr(a, own = ownAddrs()) {
  const kind = net.isIP(a);
  if (!kind) return true;
  if (own.has(a.toLowerCase().split('%')[0])) return true;
  return kind === 4 ? privateV4(a) : privateV6(a);
}

/** null if the URL may be fetched, else the reason. lookup is injectable for tests. */
async function check(raw, lookup = (h) => dns.lookup(h, { all: true, verbatim: true })) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return 'not a valid URL'; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'only http(s) URLs';
  if (u.username || u.password) return 'URLs with credentials are not allowed';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host) return 'no host';
  if (/(^|\.)(localhost|local|internal|lan|home|arpa)$/i.test(host)) return 'local host names are not allowed';
  let addrs;
  if (net.isIP(host)) addrs = [host];
  else {
    try { addrs = (await lookup(host)).map((x) => x.address); } catch { return `could not resolve ${host}`; }
  }
  if (!addrs.length) return `could not resolve ${host}`;
  const own = ownAddrs();
  const bad = addrs.find((a) => blockedAddr(a, own));
  return bad ? `${host} points at a private or local address, which this agent can't fetch` : null;
}

async function main() {
  let input = '';
  for await (const c of process.stdin) input += c;
  let j; try { j = JSON.parse(input); } catch { process.stderr.write('WebFetch blocked: unreadable hook input'); process.exit(2); }
  if (j?.tool_name && j.tool_name !== 'WebFetch') process.exit(0);
  const why = await check(j?.tool_input?.url);
  if (why) { process.stderr.write(`WebFetch blocked: ${why}.`); process.exit(2); }
  process.exit(0);
}

if (require.main === module) main().catch(() => { process.stderr.write('WebFetch blocked: guard error'); process.exit(2); });
module.exports = { check, blockedAddr, privateV4, privateV6 };

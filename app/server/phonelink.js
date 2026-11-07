// phonelink: "Continue on phone" straight to this computer. A Cloudflare quick tunnel (https://<random>.trycloudflare.com,
// no account) to 127.0.0.1:PORT, started the first time someone asks for a phone code and kept while the server runs.
// Nothing goes through premake.ai. The tunnel URL alone gets you nothing: a phone signs in only by redeeming a handoff
// code (2 minutes, single use, made by the local admin), which sets a random phone session cookie for that tunnel host.
//   start()          -> Promise<'https://x.trycloudflare.com'> (null if cloudflared can't be found or fetched)
//   host()           -> 'x.trycloudflare.com' while the tunnel is up, else ''
//   isPhoneHost(req) -> the request came in through this tunnel
//   issueSession() / sessionOk(req) / COOKIE: the phone's sign-in cookie (kept in memory: a restart signs phones out,
//     and the tunnel URL changes on restart anyway)
// cloudflared: PREMAKE_CLOUDFLARED, then PATH, Homebrew, app/.bin/cloudflared; if none, the official release is
// downloaded from github.com/cloudflare/cloudflared into app/.bin (macOS and Linux).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const COOKIE = 'premake_phone';
const SESSION_DAYS = 30;
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

function createLink({ port, appDir, log = console.log }) {
  const BIN_DIR = path.join(appDir, '.bin');
  let proc = null, url = '', starting = null, stopped = false;
  const sessions = new Map(); // sha256(token) -> expiry ms

  function findBin() {
    const c = [process.env.PREMAKE_CLOUDFLARED, path.join(BIN_DIR, 'cloudflared'), '/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared', '/usr/bin/cloudflared'];
    try { c.splice(1, 0, execFileSync('/usr/bin/which', ['cloudflared'], { encoding: 'utf8', timeout: 3000 }).trim()); } catch {}
    return c.find((p) => p && fs.existsSync(p)) || '';
  }
  /** The official cloudflared release for this machine, into app/.bin (about 20 MB, once). */
  async function download() {
    const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'amd64' : '';
    if (!arch || !['darwin', 'linux'].includes(process.platform)) return '';
    const name = process.platform === 'darwin' ? `cloudflared-darwin-${arch}.tgz` : `cloudflared-linux-${arch}`;
    const res = await fetch(`https://github.com/cloudflare/cloudflared/releases/latest/download/${name}`, { signal: AbortSignal.timeout(120e3) });
    if (!res.ok) return '';
    fs.mkdirSync(BIN_DIR, { recursive: true });
    const tmp = path.join(BIN_DIR, name + '.part');
    fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    const out = path.join(BIN_DIR, 'cloudflared');
    if (name.endsWith('.tgz')) { execFileSync('/usr/bin/tar', ['-xzf', tmp, '-C', BIN_DIR], { timeout: 60e3 }); fs.rmSync(tmp, { force: true }); }
    else fs.renameSync(tmp, out);
    fs.chmodSync(out, 0o755);
    log('[phonelink] downloaded cloudflared to ' + out);
    return out;
  }

  function run(bin) {
    return new Promise((resolve) => {
      const p = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
      proc = p;
      let done = false, buf = '';
      const finish = (u) => { if (!done) { done = true; clearTimeout(t); resolve(u); } };
      const t = setTimeout(() => finish(''), 45e3);
      const onData = (d) => { buf = (buf + d).slice(-20000); const m = buf.match(URL_RE); if (m) finish(m[0]); };
      p.stdout.on('data', onData); p.stderr.on('data', onData);
      p.on('error', () => finish(''));
      p.on('exit', () => {
        if (proc === p) { proc = null; url = ''; }
        finish('');
        if (!stopped && done) log('[phonelink] tunnel stopped; the next phone code starts a new one');
      });
    });
  }

  async function start() {
    if (url && proc) return url;
    starting ||= (async () => {
      try {
        const bin = findBin() || await download().catch((e) => { log('[phonelink] cloudflared download failed: ' + e.message); return ''; });
        if (!bin) return null;
        const u = await run(bin);
        if (!u) { proc?.kill(); return null; }
        url = u;
        log('[phonelink] phone link up at ' + u);
        return u;
      } finally { starting = null; }
    })();
    return starting;
  }
  function stop() { stopped = true; proc?.kill(); proc = null; url = ''; }
  const host = () => (url ? new URL(url).host : '');
  const isPhoneHost = (req) => !!url && String(req.headers.host || '').toLowerCase() === host();

  const hash = (t) => crypto.createHash('sha256').update('premake-phone\0' + t).digest('hex');
  function issueSession() {
    const now = Date.now();
    for (const [k, exp] of sessions) if (exp <= now) sessions.delete(k);
    const token = crypto.randomBytes(24).toString('base64url');
    sessions.set(hash(token), now + SESSION_DAYS * 86400e3);
    return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
  }
  function sessionOk(req) {
    for (const part of String(req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0 && part.slice(0, i).trim() === COOKIE) {
        const exp = sessions.get(hash(part.slice(i + 1).trim()));
        return !!exp && exp > Date.now();
      }
    }
    return false;
  }
  return { start, stop, host, isPhoneHost, issueSession, sessionOk, get url() { return url; } };
}

module.exports = { createLink, COOKIE };

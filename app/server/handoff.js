// handoff: "Continue on phone". The studio on a computer makes a short-lived, single-use token for one design; the phone
// scans it as https://premake.ai/phone/<token>, and redeeming it signs the phone in as the same account and opens the design.
//   - token: 16 random bytes (base64url, 22 chars). Only its SHA-256 is kept, in memory (a restart drops every token).
//   - bound to who made it (the account email, and whether it was the local admin on this Mac), their session and one design
//   - expires after TTL_MS (2 min); one live token per session and design (a new one replaces the old); redeemed once
// The gateway (gateway/handoff.js) redeems tokens through POST /api/handoff/redeem and sets its own session cookie for that
// email; this Mac never hands out a cookie value or the local admin token. Routes live in server/server.js.
'use strict';
const crypto = require('node:crypto');

const TTL_MS = 2 * 60e3;
const MAX_LIVE = 500; // live tokens across everyone; past this, creating one fails (503) until some expire
const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
const hash = (t) => crypto.createHash('sha256').update('premake-handoff\0' + t).digest('hex');

/** A token store. `now` is injectable for tests. */
function createStore({ ttlMs = TTL_MS, now = Date.now, max = MAX_LIVE } = {}) {
  const live = new Map(); // sha256(token) -> { who, kind, project, sid, exp }
  function sweep() { const t = now(); for (const [k, v] of live) if (v.exp <= t) live.delete(k); }
  /** New token for { who (email), kind ('local' | 'gw'), project, sid }. Returns { token, expires (ms) }. */
  function issue({ who, kind, project, sid }) {
    if (!who || !project || !sid || !['local', 'gw'].includes(kind)) throw Object.assign(new Error('bad handoff'), { code: 400 });
    sweep();
    for (const [k, v] of live) if (v.sid === sid && v.project === project) live.delete(k); // regenerate: the old code stops working
    if (live.size >= max) throw Object.assign(new Error('Too many phone codes right now. Try again in a couple of minutes.'), { code: 503 });
    const token = crypto.randomBytes(16).toString('base64url');
    const exp = now() + ttlMs;
    live.set(hash(token), { who: String(who), kind, project: String(project), sid: String(sid), exp });
    return { token, expires: exp };
  }
  function find(token) {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
    const k = hash(token), r = live.get(k);
    if (!r) return null;
    if (r.exp <= now()) { live.delete(k); return null; }
    return { k, r };
  }
  /** What a token would grant, without using it up. null if unknown, used or expired. */
  function peek(token) { const f = find(token); return f ? { ...f.r } : null; }
  /** Use the token: returns what it grants and forgets it, so a second redeem gets null. */
  function redeem(token) { const f = find(token); if (!f) return null; live.delete(f.k); return { ...f.r }; }
  /** Drop every token a session made (sign out). */
  function revokeSession(sid) { for (const [k, v] of live) if (v.sid === sid) live.delete(k); }
  return { issue, peek, redeem, revokeSession, size: () => (sweep(), live.size) };
}

module.exports = { createStore, TTL_MS, TOKEN_RE };

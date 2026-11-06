// Video calls with Josh (live support): browser-to-browser WebRTC, signaled through this server with short polling
// (SSE doesn't get through the Cloudflare quick tunnel). Call state lives in memory with timeouts; nothing is stored
// except Josh's "Available for calls" switch (data/call.json) and a missed-call note in the project's support thread.
//
// Visitor (signed in, owner of the project):  POST /api/call/start {project?, example?, offer}
//                                              GET  /api/call/status            -> { available, reason }
// Both sides:                                  GET  /api/call/config            -> { iceServers }
//                                              GET  /api/call/<id>/events?since=<seq>
//                                              POST /api/call/<id>/signal {type: 'answer'|'offer'|'ice', sdp?, candidates?}
//                                              POST /api/call/<id>/end
// Josh (admins):                               GET  /api/call/incoming          (also marks Josh as reachable)
//                                              POST /api/call/available {on}
//                                              POST /api/call/<id>/accept {answer} | /decline
// TURN (optional, for strict NATs / corporate networks): TURN_URL, TURN_USER, TURN_PASS in app/.env.local.
'use strict';
const path = require('node:path');
const crypto = require('node:crypto');

let D = null; // deps from server.js (init)
const RING_MS = 60e3;        // unanswered -> missed
const LOST_MS = 25e3;        // a side that stops polling during a call has gone
const JOSH_REACH_MS = 20e3;  // Josh counts as reachable while /admin polled /api/call/incoming this recently
const KEEP_MS = 10 * 60e3;   // ended calls are kept this long (late polls get the final state), then dropped
const MAX_EVENTS = 400;
const calls = new Map();     // id -> call
let joshSeen = 0;
let FILE = '';
let settings = null;

const loadSettings = () => { if (!settings) settings = { available: true, ...(D.readJSON(FILE, {}) || {}) }; return settings; };
const reachable = () => Date.now() - joshSeen < JOSH_REACH_MS;
const activeCall = () => [...calls.values()].find((c) => c.state === 'active');
function availability() {
  if (!loadSettings().available) return { available: false, reason: 'off' };
  if (!reachable()) return { available: false, reason: 'away' };
  if (activeCall()) return { available: false, reason: 'busy' };
  return { available: true, reason: null };
}
function iceServers() {
  const out = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  const url = String(process.env.TURN_URL || '').trim();
  if (url) out.push({ urls: url.split(',').map((s) => s.trim()).filter(Boolean), username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || '' });
  return out;
}

function push(call, from, type, data = {}) {
  call.events.push({ seq: ++call.seq, from, type, t: Date.now(), ...data });
  if (call.events.length > MAX_EVENTS) call.events.splice(0, call.events.length - MAX_EVENTS);
}
function finish(call, state, by, why) {
  if (['ended', 'missed', 'declined', 'canceled'].includes(call.state)) return;
  const wasRinging = call.state === 'ringing';
  call.state = state; call.ended = Date.now();
  push(call, by, 'state', { state, why: why || null });
  if (state === 'missed' || (state === 'declined' && wasRinging)) note(call, state);
}
/** A line in the project's support thread, so the request stays visible and Josh can reply there. */
function note(call, state) {
  if (!call.project) return;
  const dir = D.projDir(call.project);
  if (!dir || !D.exists(path.join(dir, 'meta.json'))) return;
  const text = state === 'missed' ? 'Missed video call: I tried to call, but nobody was available.'
    : 'Video call request: nobody could pick up right away.';
  try { D.addSupportMessage(call.project, dir, { authed: true, user: call.user }, { text, as: 'user' }); } catch {}
}
function sweep() {
  const t = Date.now();
  for (const c of calls.values()) {
    if (c.state === 'ringing' && t - c.created > RING_MS) finish(c, 'missed', 'server', 'timeout');
    else if (c.state === 'ringing' && t - c.seen.user > LOST_MS) finish(c, 'canceled', 'server', 'caller left');
    else if (c.state === 'active' && (t - c.seen.user > LOST_MS || t - c.seen.josh > LOST_MS)) finish(c, 'ended', 'server', 'connection lost');
    if (c.ended && t - c.ended > KEEP_MS) calls.delete(c.id);
  }
}

/** Who this request is on the call: 'user' (the caller), 'josh' (an admin), or null. */
function roleOf(acc, call) {
  if (acc.user && acc.user === call.user) return 'user';
  if (D.isAdmin(acc)) return 'josh';
  return null;
}
const pub = (c) => ({ id: c.id, state: c.state, user: c.user, project: c.project, example: c.example, title: c.title, created: c.created, answered: c.answered || null });
const sdpOk = (x) => x && typeof x === 'object' && ['offer', 'answer'].includes(x.type) && typeof x.sdp === 'string' && x.sdp.length < 2e5;
const candOk = (list) => Array.isArray(list) && list.length <= 60 && list.every((x) => x === null || (x && typeof x === 'object' && typeof x.candidate === 'string' && x.candidate.length < 1000));

/** Returns true if it answered. parts = ['api', 'call', ...]. */
async function handle(req, res, { parts, m, acc, url, readBody }) {
  if (parts[0] !== 'api' || parts[1] !== 'call') return false;
  const [, , a, b] = parts;
  const send = (code, obj) => { D.send(res, code, obj); return true; };
  if (!acc.authed || !acc.user) return send(401, { error: 'Sign in to start a call.', code: 'signin' });
  const admin = D.isAdmin(acc);
  sweep();

  if (a === 'config' && !b && m === 'GET') return send(200, { iceServers: iceServers(), ring_s: RING_MS / 1000 });
  if (a === 'status' && !b && m === 'GET') return send(200, availability());

  // ---- Josh: incoming calls (polled from every /admin page), availability switch
  if (a === 'incoming' && !b && m === 'GET') {
    if (!admin) return send(404, { error: 'no such endpoint' });
    joshSeen = Date.now();
    for (const c of calls.values()) if (c.state === 'active' && c.joshUser === acc.user) c.seen.josh = Date.now();
    const ringing = [...calls.values()].filter((c) => c.state === 'ringing').map((c) => ({ ...pub(c), offer: c.offer }));
    return send(200, { available: loadSettings().available, ringing, active: activeCall() ? pub(activeCall()) : null });
  }
  if (a === 'available' && !b && m === 'POST') {
    if (!admin) return send(404, { error: 'no such endpoint' });
    const body = await readBody(req, 1e3);
    loadSettings().available = !!body.on;
    D.writeJSON(FILE, settings);
    return send(200, { available: settings.available });
  }

  // ---- visitor: start a call (the offer comes with it, so Josh's Accept can answer straight away)
  if (a === 'start' && !b && m === 'POST') {
    if (!D.allow('call:' + acc.user, 12, 3600e3)) return send(429, { error: 'That’s a lot of calls this hour. Leave a message instead.' });
    const body = await readBody(req, 3e5);
    if (!sdpOk(body.offer) || body.offer.type !== 'offer') return send(400, { error: 'offer required' });
    let project = null, title = '', example = null;
    if (typeof body.project === 'string' && body.project) {
      const dir = D.projDir(body.project);
      if (!dir || !D.exists(path.join(dir, 'meta.json')) || !D.canEdit(acc, body.project)) return send(404, { error: 'project not found' });
      project = body.project; title = (D.readJSON(path.join(dir, 'meta.json'), {}) || {}).title || 'Untitled';
    } else if (typeof body.example === 'string' && /^[a-z0-9][a-z0-9-]{0,80}$/.test(body.example)) {
      example = body.example; title = body.example;
    }
    for (const c of calls.values()) if (c.user === acc.user && c.state === 'ringing') finish(c, 'canceled', 'user', 'replaced');
    const av = availability();
    if (!av.available) {
      const fake = { project, user: acc.user };
      if (project) note(fake, 'missed');
      return send(409, { error: 'Nobody is available right now.', unavailable: true, reason: av.reason });
    }
    const id = crypto.randomBytes(9).toString('base64url');
    const call = { id, user: acc.user, project, example, title, state: 'ringing', created: Date.now(), offer: body.offer, events: [], seq: 0,
      seen: { user: Date.now(), josh: 0 }, joshUser: null };
    calls.set(id, call);
    push(call, 'user', 'state', { state: 'ringing' });
    return send(200, { id, state: call.state, ring_s: RING_MS / 1000, iceServers: iceServers() });
  }

  // ---- per call
  const call = a && calls.get(a);
  if (!call) return send(404, { error: 'call not found' });
  const role = roleOf(acc, call);
  if (!role) return send(404, { error: 'call not found' });
  if (role === 'josh' && call.joshUser && call.joshUser !== acc.user && call.state === 'active') return send(409, { error: 'Another admin took this call.' });
  call.seen[role] = Date.now();

  if (b === 'events' && m === 'GET') {
    const since = Number(url.searchParams.get('since')) || 0;
    return send(200, { state: call.state, seq: call.seq, events: call.events.filter((e) => e.seq > since && e.from !== role), call: pub(call) });
  }
  if (b === 'accept' && m === 'POST') {
    if (role !== 'josh') return send(403, { error: 'admins only' });
    if (call.state !== 'ringing') return send(409, { error: call.state === 'canceled' ? 'The caller hung up.' : 'This call has already ended.', state: call.state });
    const body = await readBody(req, 3e5);
    if (!sdpOk(body.answer) || body.answer.type !== 'answer') return send(400, { error: 'answer required' });
    call.state = 'active'; call.answered = Date.now(); call.joshUser = acc.user; call.seen.josh = Date.now();
    push(call, 'josh', 'answer', { sdp: body.answer });
    if (candOk(body.candidates) && body.candidates.length) push(call, 'josh', 'ice', { candidates: body.candidates });
    push(call, 'josh', 'state', { state: 'active' });
    for (const c of calls.values()) if (c !== call && c.state === 'ringing') finish(c, 'missed', 'server', 'busy');
    return send(200, { ok: true, call: pub(call) });
  }
  if (b === 'decline' && m === 'POST') {
    if (role !== 'josh') return send(403, { error: 'admins only' });
    finish(call, 'declined', 'josh');
    return send(200, { ok: true, state: call.state });
  }
  if (b === 'signal' && m === 'POST') {
    if (!['ringing', 'active'].includes(call.state)) return send(409, { error: 'call ended', state: call.state });
    const body = await readBody(req, 3e5);
    if (body.type === 'ice') {
      if (!candOk(body.candidates)) return send(400, { error: 'bad candidates' });
      push(call, role, 'ice', { candidates: body.candidates });
    } else if (body.type === 'offer' || body.type === 'answer') { // renegotiation (e.g. camera added later)
      if (!sdpOk(body.sdp)) return send(400, { error: 'bad sdp' });
      push(call, role, body.type, { sdp: body.sdp });
    } else if (body.type === 'media') { // mute / camera state, shown on the other side
      push(call, role, 'media', { audio: !!body.audio, video: !!body.video });
    } else return send(400, { error: 'unknown signal' });
    return send(200, { ok: true, seq: call.seq });
  }
  if (b === 'end' && m === 'POST') {
    if (call.state === 'ringing') finish(call, role === 'user' ? 'canceled' : 'declined', role);
    else finish(call, 'ended', role);
    return send(200, { ok: true, state: call.state });
  }
  return send(404, { error: 'no such endpoint' });
}

function init(deps) {
  D = deps;
  FILE = path.join(D.DATA, 'call.json');
  setInterval(sweep, 2000).unref();
  return module.exports;
}

module.exports = { init, handle, availability };

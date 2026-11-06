// Video calls with Josh (live support). Browser-to-browser WebRTC; signaling through the Mac (server/call.js) by short
// polling, because SSE doesn't get through the Cloudflare quick tunnel. Used by the studio (visitor: the Chat panel's call
// bubble, web/support.js: callStatus + startCall) and by /admin (initAdminCalls: ringing, Accept/Decline, availability switch).
// The visitor's offer goes up with the call request (ICE gathered first, so it carries its candidates); Accept answers
// it straight away. Later candidates are batched. All styles live in call.css under .call-*.

import { track } from './analytics.js'; // analytics: PostHog events (never blocks)
import { ACCESS } from './api.js'; // open-source app: live support calls only on a hosted server (none when you run it yourself)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
if (!document.querySelector('link[data-call-css]')) {
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/call.css'; l.dataset.callCss = '';
  document.head.append(l);
}

async function api(path, body) {
  let r;
  try {
    r = await fetch(path, { method: body ? 'POST' : 'GET', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  } catch { throw Object.assign(new Error('Can’t reach Premake. Check your connection.'), { status: 0 }); }
  let d = null; try { d = await r.json(); } catch {}
  if (!r.ok) throw Object.assign(new Error(d?.error || `Request failed (${r.status})`), { status: r.status, data: d });
  return d;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isPhone = () => matchMedia('(max-width: 720px), (pointer: coarse)').matches;
const NO_TURN_HINT = 'Some office and school networks block video calls.';

// ---------------------------------------------------------------- media
/** Camera + mic. Throws an Error with a message a person can act on. */
async function getMedia(facing = 'user') {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(isSecureContext ? 'This browser can’t make video calls. Try Chrome or Safari.' : 'Video calls need a secure (https) page.');
  }
  const video = { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } };
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video });
  } catch (e) {
    if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') { // no camera: voice only
      try { return await navigator.mediaDevices.getUserMedia({ audio: true }); } catch {}
      throw new Error('No camera or microphone found. Plug one in and try again.');
    }
    if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      throw new Error(ios ? 'Camera and microphone are blocked. In Settings › Safari › Camera and Microphone, choose Ask or Allow, then try again.'
        : 'Camera and microphone are blocked. Click the camera icon in the address bar, allow both, then try again.');
    }
    if (e.name === 'NotReadableError' || e.name === 'AbortError') throw new Error('Your camera or microphone is in use by another app. Close it and try again.');
    throw new Error('Couldn’t start your camera: ' + (e.message || e.name));
  }
}
async function hasManyCameras() {
  try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput').length > 1; } catch { return false; }
}

// ---------------------------------------------------------------- peer: one RTCPeerConnection + batched ICE over polling
class Peer {
  constructor(iceServers, ui) {
    this.ui = ui; this.id = null; this.since = 0; this.queue = []; this.remoteSet = false; this.pendingRemote = []; this.closed = false;
    this.pc = new RTCPeerConnection({ iceServers });
    this.pc.onicecandidate = e => { if (e.candidate) { this.queue.push(e.candidate.toJSON()); this.flushSoon(); } };
    this.pc.ontrack = e => ui.setRemote(e.streams[0] || new MediaStream([e.track]));
    this.pc.onconnectionstatechange = () => ui.onConn(this.pc.connectionState);
    this.pc.oniceconnectionstatechange = () => { if (!this.pc.connectionState) ui.onConn(this.pc.iceConnectionState); }; // old Safari
  }
  /** Wait for ICE gathering (so the SDP carries the candidates), at most ms. Candidates in the SDP aren't re-sent. */
  async gathered(ms) {
    if (this.pc.iceGatheringState !== 'complete') {
      await new Promise(res => { const t = setTimeout(res, ms); this.pc.addEventListener('icegatheringstatechange', () => { if (this.pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } }); });
    }
    this.queue = [];
    return { type: this.pc.localDescription.type, sdp: this.pc.localDescription.sdp };
  }
  flushSoon() {
    if (this.flushT || !this.id) return;
    this.flushT = setTimeout(async () => {
      this.flushT = null;
      const c = this.queue.splice(0, 50);
      if (!c.length || this.closed) return;
      try { await api(`/api/call/${this.id}/signal`, { type: 'ice', candidates: c }); } catch {}
      if (this.queue.length) this.flushSoon();
    }, 250);
  }
  async addRemote(list) {
    for (const c of list) {
      if (!c) continue;
      if (!this.remoteSet) { this.pendingRemote.push(c); continue; }
      try { await this.pc.addIceCandidate(c); } catch {}
    }
  }
  async setRemote(desc) {
    await this.pc.setRemoteDescription(desc);
    this.remoteSet = true;
    const p = this.pendingRemote.splice(0); await this.addRemote(p);
  }
  /** Poll the call's events until it ends. Fast until connected, then every 1.5 s (keeps the call alive server-side). */
  async poll(onEvent) {
    while (!this.closed) {
      try {
        const r = await api(`/api/call/${this.id}/events?since=${this.since}`);
        for (const ev of r.events) { this.since = Math.max(this.since, ev.seq); await onEvent(ev); if (this.closed) return; }
        this.since = Math.max(this.since, r.seq);
      } catch (e) { if (e.status === 404) { onEvent({ type: 'state', state: 'ended', why: 'gone' }); return; } }
      await sleep(this.pc.connectionState === 'connected' ? 1500 : 450);
    }
  }
  close() { this.closed = true; clearTimeout(this.flushT); try { this.pc.close(); } catch {} }
}

// ---------------------------------------------------------------- call UI (light, full screen on phones)
const IC = {
  mic: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21M4 4l16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  cam: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="3" y="6.5" width="12.5" height="11" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15.5 10.5l5-3v9l-5-3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  camOff: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="3" y="6.5" width="12.5" height="11" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15.5 10.5l5-3v9l-5-3zM3 3l18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  flip: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 9a8 8 0 0114.5-3M20 15a8 8 0 01-14.5 3M18.5 2.5V6H15M5.5 21.5V18H9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  end: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M3 14.5c5-5 13-5 18 0l-2.4 2.4-3.3-1.6v-2.6a10 10 0 00-6.6 0v2.6l-3.3 1.6z" fill="currentColor"/></svg>',
  call: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="1.5" y="4" width="9" height="8" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 7l4-2.3v6.6l-4-2.3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
};

class CallUI {
  constructor({ title, sub = '', who = 'J', links = '', onHangup }) {
    this.onHangup = onHangup; this.audioOn = true; this.videoOn = true; this.facing = 'user'; this.t0 = 0;
    const el = this.el = document.createElement('div');
    el.className = 'call-ui'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Video call');
    el.innerHTML = `<div class="call-frame">
      <div class="call-stage">
        <video class="call-remote" playsinline autoplay></video>
        <div class="call-wait"><div class="call-avatar">${esc(who)}</div><h2 class="call-title"></h2><p class="call-sub"></p><div class="call-actions"></div></div>
        <div class="call-head"><div class="call-head-l"><b class="call-name"></b><span class="call-meta"></span></div><span class="call-timer" hidden>0:00</span></div>
        <div class="call-pip" hidden><video class="call-local" playsinline autoplay muted></video><span class="call-pip-off" hidden>Camera off</span></div>
      </div>
      <div class="call-bar">
        <button class="btn call-ctl" data-act="mic" aria-label="Mute">${IC.mic}</button>
        <button class="btn call-ctl" data-act="cam" aria-label="Turn camera off">${IC.cam}</button>
        <button class="btn call-ctl" data-act="flip" aria-label="Switch camera" hidden>${IC.flip}</button>
        <button class="btn danger call-ctl call-hang" data-act="hang" aria-label="Hang up">${IC.end}</button>
      </div></div>`;
    this.$ = s => el.querySelector(s);
    this.$('.call-name').textContent = title; this.$('.call-meta').innerHTML = links || esc(sub);
    el.querySelector('.call-bar').onclick = e => { const b = e.target.closest('[data-act]'); if (b) this.act(b.dataset.act); };
    this.keys = e => { if (e.key === 'Escape' && !this.live) this.act('hang'); };
    addEventListener('keydown', this.keys);
    this.drag(this.$('.call-pip'));
    document.body.append(el); document.body.classList.add('call-open');
  }
  wait(title, sub = '', actions = '') {
    this.$('.call-wait').hidden = false; this.$('.call-title').textContent = title; this.$('.call-sub').textContent = sub;
    this.$('.call-actions').innerHTML = actions; this.el.classList.toggle('call-ended', !!actions);
  }
  setLocal(stream) {
    this.stream = stream;
    const v = this.$('.call-local'); v.srcObject = stream; v.play?.().catch(() => {});
    this.$('.call-pip').hidden = false;
    this.$('.call-pip').classList.toggle('mirror', this.facing === 'user');
    const hasVideo = stream.getVideoTracks().length > 0;
    this.$('[data-act=cam]').hidden = !hasVideo;
    if (hasVideo) hasManyCameras().then(m => { this.$('[data-act=flip]').hidden = !(m || isPhone()); });
  }
  setRemote(stream) {
    const v = this.$('.call-remote');
    if (v.srcObject !== stream) { v.srcObject = stream; v.play?.().catch(() => {}); }
  }
  connected() {
    this.live = true; this.$('.call-wait').hidden = true; this.el.classList.add('call-live');
    if (!this.t0) {
      this.t0 = Date.now(); const t = this.$('.call-timer'); t.hidden = false;
      this.tick = setInterval(() => { const s = Math.floor((Date.now() - this.t0) / 1000); t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 1000);
    }
  }
  remoteMedia({ audio, video }) { this.el.classList.toggle('call-remote-off', !video); this.$('.call-head .call-meta').dataset.muted = audio ? '' : '1'; }
  act(a) {
    const s = this.stream;
    if (a === 'hang') return this.onHangup?.();
    if (!s) return;
    if (a === 'mic') { this.audioOn = !this.audioOn; s.getAudioTracks().forEach(t => { t.enabled = this.audioOn; }); }
    if (a === 'cam') { this.videoOn = !this.videoOn; s.getVideoTracks().forEach(t => { t.enabled = this.videoOn; }); }
    if (a === 'flip') return this.onFlip?.();
    const mic = this.$('[data-act=mic]'), cam = this.$('[data-act=cam]');
    mic.innerHTML = this.audioOn ? IC.mic : IC.micOff; mic.classList.toggle('off', !this.audioOn); mic.setAttribute('aria-label', this.audioOn ? 'Mute' : 'Unmute');
    cam.innerHTML = this.videoOn ? IC.cam : IC.camOff; cam.classList.toggle('off', !this.videoOn); cam.setAttribute('aria-label', this.videoOn ? 'Turn camera off' : 'Turn camera on');
    this.$('.call-pip-off').hidden = this.videoOn;
    this.onMedia?.({ audio: this.audioOn, video: this.videoOn });
  }
  /** Draggable picture-in-picture; snaps to the nearest corner. */
  drag(pip) {
    let sx, sy, ox, oy, on = false;
    pip.addEventListener('pointerdown', e => {
      on = true; pip.setPointerCapture(e.pointerId); const r = pip.getBoundingClientRect(), p = pip.offsetParent.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left - p.left; oy = r.top - p.top;
      pip.style.left = ox + 'px'; pip.style.top = oy + 'px'; pip.style.right = pip.style.bottom = 'auto'; pip.classList.add('dragging');
    });
    pip.addEventListener('pointermove', e => {
      if (!on) return;
      const p = pip.offsetParent.getBoundingClientRect();
      pip.style.left = Math.max(8, Math.min(p.width - pip.offsetWidth - 8, ox + e.clientX - sx)) + 'px';
      pip.style.top = Math.max(8, Math.min(p.height - pip.offsetHeight - 8, oy + e.clientY - sy)) + 'px';
    });
    const up = () => {
      if (!on) return; on = false; pip.classList.remove('dragging');
      const p = pip.offsetParent.getBoundingClientRect(), r = pip.getBoundingClientRect();
      const right = r.left + r.width / 2 > p.left + p.width / 2, bottom = r.top + r.height / 2 > p.top + p.height / 2;
      pip.style.left = pip.style.top = pip.style.right = pip.style.bottom = '';
      pip.dataset.corner = (bottom ? 'b' : 't') + (right ? 'r' : 'l');
    };
    pip.addEventListener('pointerup', up); pip.addEventListener('pointercancel', up);
  }
  close() {
    clearInterval(this.tick); removeEventListener('keydown', this.keys);
    this.stream?.getTracks().forEach(t => t.stop());
    this.el.remove(); document.body.classList.remove('call-open');
  }
}

/** Swap the camera (front <-> back) on a live call. */
async function flipCamera(ui, peer) {
  const next = ui.facing === 'user' ? 'environment' : 'user';
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: next } } }).catch(() => navigator.mediaDevices.getUserMedia({ video: { facingMode: next } }));
    const track = s.getVideoTracks()[0]; track.enabled = ui.videoOn;
    const sender = peer?.pc.getSenders().find(x => x.track?.kind === 'video');
    if (sender) await sender.replaceTrack(track);
    ui.stream.getVideoTracks().forEach(t => { t.stop(); ui.stream.removeTrack(t); });
    ui.stream.addTrack(track); ui.facing = next; ui.setLocal(ui.stream);
  } catch { /* keep the current camera */ }
}
function wireMedia(ui, peer) {
  ui.onFlip = () => flipCamera(ui, peer);
  ui.onMedia = m => { if (peer.id && !peer.closed) api(`/api/call/${peer.id}/signal`, { type: 'media', ...m }).catch(() => {}); };
}

// ================================================================ visitor
const VIS = { status: null, statusT: 0, busy: false };
/** Josh's availability: { available, reason: 'off' | 'away' | 'busy' | null }, or { available: true, guest: true } when
 *  signed out (the server only answers signed-in visitors), or null when it can't be reached. Cached for 20 s. */
export async function callStatus(force) {
  if (!force && VIS.status && Date.now() - VIS.statusT < 20000) return VIS.status;
  try { VIS.status = await api('/api/call/status'); } catch (e) { VIS.status = e.status === 401 ? { available: true, guest: true } : null; }
  VIS.statusT = Date.now();
  return VIS.status;
}
export const callsSupported = () => !!ACCESS.hosted && !!window.RTCPeerConnection;

/** Visitor: request a call. Must run from a click (iOS needs the gesture for camera and audio). */
export async function startCall({ project = null, example = null } = {}) {
  if (VIS.busy) return;
  const st = await callStatus(false);
  if (st?.guest) { dispatchEvent(new CustomEvent('forma:signin')); return; }
  VIS.busy = true;
  track('call_started', { design: project ? 'project' : example ? 'example' : null }); // analytics:
  let peer = null, done = false, ringT = null;
  const ui = new CallUI({ title: 'Premake', sub: 'Premake live support', onHangup: () => hangup('user') });
  const finish = (title, sub, actions) => {
    if (done) return; done = true; clearTimeout(ringT);
    if (peer) { if (!peer.closed && peer.id && !actions) api(`/api/call/${peer.id}/end`, {}).catch(() => {}); peer.close(); }
    ui.stream?.getTracks().forEach(t => t.stop());
    removeEventListener('pagehide', onLeave);
    VIS.busy = false; VIS.statusT = 0;
    if (!actions) { ui.close(); return; }
    ui.$('.call-pip').hidden = true; ui.$('.call-bar').hidden = true; ui.$('.call-timer').hidden = true; ui.el.classList.remove('call-live');
    ui.wait(title, sub, actions);
    ui.$('.call-actions').onclick = e => {
      const a = e.target.closest('[data-call-act]')?.dataset.callAct; if (!a) return;
      ui.close(); if (a === 'retry') startCall({ project, example });
    };
  };
  const CLOSE = '<button class="btn" data-call-act="close">Close</button>';
  const unavailable = () => finish('Nobody is available right now', 'Try again later.', CLOSE);
  function hangup(by) {
    if (done) return;
    if (peer?.id) api(`/api/call/${peer.id}/end`, {}).catch(() => {});
    if (peer) peer.closed = true;
    finish(by === 'user' && !ui.live ? '' : 'Call ended', '', by === 'user' ? '' : '<button class="btn" data-call-act="close">Close</button>');
  }
  const onLeave = () => { if (peer?.id) navigator.sendBeacon?.(`/api/call/${peer.id}/end`); };
  addEventListener('pagehide', onLeave);

  ui.wait('Starting your camera…', 'Allow camera and microphone when your browser asks.');
  let stream;
  try { stream = await getMedia('user'); }
  catch (e) {
    return finish('Can’t start the call', e.message, '<button class="btn primary" data-call-act="retry">Try again</button>' + CLOSE);
  }
  if (done) { stream.getTracks().forEach(t => t.stop()); return; }
  ui.setLocal(stream);
  ui.wait('Calling Premake…', 'Connecting');
  try {
    const cfg = await api('/api/call/config');
    peer = new Peer(cfg.iceServers, { setRemote: s => ui.setRemote(s), onConn });
    wireMedia(ui, peer);
    stream.getTracks().forEach(t => peer.pc.addTrack(t, stream));
    if (!stream.getVideoTracks().length) peer.pc.addTransceiver('video', { direction: 'recvonly' });
    await peer.pc.setLocalDescription(await peer.pc.createOffer());
    const offer = await peer.gathered(1200);
    if (done) return;
    const r = await api('/api/call/start', { project, example, offer });
    peer.id = r.id; peer.flushSoon();
    ui.wait('Calling Premake…', 'Ringing');
    ringT = setTimeout(() => { if (!ui.live) unavailable(); }, (r.ring_s + 4) * 1000);
  } catch (e) {
    if (done) return;
    if (e.status === 409 || e.data?.unavailable) return unavailable();
    if (e.status === 401) { finish(); dispatchEvent(new CustomEvent('forma:signin')); return; }
    return finish('Can’t start the call', e.message, '<button class="btn primary" data-call-act="retry">Try again</button>' + CLOSE);
  }
  function onConn(s) {
    if (s === 'connected') { clearTimeout(ringT); if (!ui.counted) { ui.counted = true; track('call_connected', {}); } ui.connected(); }
    if (s === 'failed') finish('Couldn’t connect the video', `${NO_TURN_HINT} Try another network.`,
      '<button class="btn primary" data-call-act="retry">Try again</button>' + CLOSE);
  }
  peer.poll(async ev => {
    if (ev.type === 'answer') { await peer.setRemote(ev.sdp).catch(() => {}); ui.wait('Connecting…', 'Premake picked up'); }
    else if (ev.type === 'ice') await peer.addRemote(ev.candidates || []);
    else if (ev.type === 'media') ui.remoteMedia(ev);
    else if (ev.type === 'state') {
      if (ev.state === 'active') { clearTimeout(ringT); if (!ui.live) ui.wait('Connecting…', 'Premake picked up'); }
      if (ev.state === 'missed') unavailable();
      if (ev.state === 'declined') finish('Nobody can pick up right now', 'Try again later.', CLOSE);
      if (ev.state === 'ended' || ev.state === 'canceled') hangup('josh');
    }
  });
}

// ================================================================ Josh (/admin)
const ADM = { ringing: [], shown: null, call: null, ring: null, actx: null, notes: new Map(), available: true };
function ringStart() {
  if (ADM.ring) return;
  const beep = () => {
    try {
      const a = ADM.actx = ADM.actx || new (window.AudioContext || window.webkitAudioContext)();
      if (a.state === 'suspended') a.resume();
      const t0 = a.currentTime;
      for (let i = 0; i < 2; i++) { // classic two-tone ring: 2 x 0.4 s bursts
        const g = a.createGain(); g.connect(a.destination);
        g.gain.setValueAtTime(0.0001, t0 + i * 0.6); g.gain.exponentialRampToValueAtTime(0.3, t0 + i * 0.6 + 0.03);
        g.gain.setValueAtTime(0.3, t0 + i * 0.6 + 0.37); g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.6 + 0.42);
        for (const f of [440, 480]) { const o = a.createOscillator(); o.frequency.value = f; o.connect(g); o.start(t0 + i * 0.6); o.stop(t0 + i * 0.6 + 0.45); }
      }
    } catch {}
  };
  beep(); ADM.ring = setInterval(beep, 3000);
}
function ringStop() { clearInterval(ADM.ring); ADM.ring = null; }
addEventListener('pointerdown', () => { try { ADM.actx = ADM.actx || new (window.AudioContext || window.webkitAudioContext)(); if (ADM.actx.state === 'suspended') ADM.actx.resume(); } catch {} }, { passive: true });

function notifyRing(c) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || ADM.notes.has(c.id)) return;
  try {
    const n = new Notification('Incoming video call', { body: `${c.user}${c.title ? ' · ' + c.title : ''}`, tag: 'call-' + c.id, requireInteraction: true });
    n.onclick = () => { focus(); n.close(); };
    ADM.notes.set(c.id, n);
  } catch {}
}
function clearNote(id) { try { ADM.notes.get(id)?.close(); } catch {} ADM.notes.delete(id); }

function banner() {
  let el = document.querySelector('.call-banner');
  const c = ADM.ringing[0];
  if (!c || ADM.call) { el?.remove(); ringStop(); ADM.shown = null; return; }
  if (!el) { el = document.createElement('div'); el.className = 'call-banner'; el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-label', 'Incoming video call'); document.body.append(el); }
  if (ADM.shown !== c.id) {
    ADM.shown = c.id;
    const left = Math.max(0, Math.round(60 - (Date.now() - c.created) / 1000));
    el.innerHTML = `<div class="call-banner-ic">${IC.call}</div>
      <div class="call-banner-t"><b>Incoming video call</b><span>${esc(c.user)}${c.title ? ' · ' + esc(c.title) : ''}${ADM.ringing.length > 1 ? ` · ${ADM.ringing.length - 1} more waiting` : ''}</span><span class="call-banner-left" data-left="${left}"></span></div>
      <div class="call-banner-b"><button class="btn danger" data-ans="no">Decline</button><button class="btn primary" data-ans="yes">${IC.call}Accept</button></div>`;
    el.onclick = e => { const b = e.target.closest('[data-ans]'); if (b) b.dataset.ans === 'yes' ? accept(c) : decline(c); };
  }
  ringStart();
}
async function decline(c) {
  ADM.ringing = ADM.ringing.filter(x => x.id !== c.id); clearNote(c.id); banner();
  try { await api(`/api/call/${c.id}/decline`, {}); } catch {}
}
function admToast(msg) {
  const t = document.createElement('div'); t.className = 'call-toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.append(t); setTimeout(() => t.remove(), 5000);
}
async function accept(c) {
  ringStop(); clearNote(c.id);
  ADM.ringing = ADM.ringing.filter(x => x.id !== c.id);
  const studio = c.project ? `/designs/${encodeURIComponent(c.project)}` : c.example ? `/examples/${encodeURIComponent(c.example)}` : null;
  const links = `${esc(c.title || 'No design open')}${studio ? ` · <a href="${studio}" target="_blank" rel="noopener">Open design</a>` : ''}${c.project ? ` · <a href="/admin#support/${encodeURIComponent(c.project)}" target="_blank" rel="noopener">Chat</a>` : ''}`;
  let peer = null, done = false;
  const ui = new CallUI({ title: c.user, links, who: (c.user[0] || '?').toUpperCase(), onHangup: () => end(true) });
  ADM.call = { id: c.id, ui }; banner();
  const end = (mine, title = 'Call ended', sub = '') => {
    if (done) return; done = true;
    if (mine && peer?.id) api(`/api/call/${peer.id}/end`, {}).catch(() => {});
    peer?.close(); ui.stream?.getTracks().forEach(t => t.stop());
    ADM.call = null;
    if (mine) { ui.close(); banner(); return; }
    ui.$('.call-pip').hidden = true; ui.$('.call-bar').hidden = true; ui.el.classList.remove('call-live');
    ui.wait(title, sub, '<button class="btn" data-call-act="close">Close</button>');
    ui.$('.call-actions').onclick = () => { ui.close(); banner(); };
  };
  ui.wait('Starting your camera…', 'Allow camera and microphone when your browser asks.');
  try {
    const stream = await getMedia('user');
    if (done) { stream.getTracks().forEach(t => t.stop()); return; }
    ui.setLocal(stream);
    ui.wait('Connecting…', c.user);
    const cfg = await api('/api/call/config');
    peer = new Peer(cfg.iceServers, { setRemote: s => ui.setRemote(s), onConn: s => {
      if (s === 'connected') ui.connected();
      if (s === 'failed') end(true, 'Couldn’t connect the video', NO_TURN_HINT);
    } });
    wireMedia(ui, peer);
    await peer.setRemote(c.offer);
    stream.getTracks().forEach(t => peer.pc.addTrack(t, stream));
    await peer.pc.setLocalDescription(await peer.pc.createAnswer());
    const answer = await peer.gathered(800);
    if (done) return;
    await api(`/api/call/${c.id}/accept`, { answer });
    peer.id = c.id; peer.flushSoon();
  } catch (e) {
    return end(false, e.status === 409 ? 'The caller hung up' : 'Can’t answer the call', e.message);
  }
  peer.poll(async ev => {
    if (ev.type === 'ice') await peer.addRemote(ev.candidates || []);
    else if (ev.type === 'media') ui.remoteMedia(ev);
    else if (ev.type === 'offer') { await peer.setRemote(ev.sdp).catch(() => {}); }
    else if (ev.type === 'state' && ['ended', 'canceled'].includes(ev.state)) end(false, 'Call ended', ev.why === 'connection lost' ? 'The connection dropped.' : `${c.user} hung up.`);
  });
}

function drawToggle() {
  let el = document.querySelector('.call-avail');
  if (!el) {
    const host = document.querySelector('.adm-top-r'); if (!host) return;
    el = document.createElement('label'); el.className = 'call-avail';
    el.innerHTML = '<input type="checkbox" role="switch"><span class="call-avail-sw" aria-hidden="true"></span><span class="call-avail-l">Available for calls</span>';
    host.prepend(el);
    el.querySelector('input').onchange = async e => {
      const on = e.target.checked;
      if (on && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
      try { const r = await api('/api/call/available', { on }); ADM.available = r.available; } catch (err) { admToast(err.message); }
      drawToggle();
    };
  }
  el.querySelector('input').checked = ADM.available;
  el.classList.toggle('on', ADM.available);
  el.title = ADM.available ? 'Visitors can video call you while /admin is open' : 'Visitors see “Nobody is available right now”';
}

/** /admin: poll for incoming calls on every admin page. A worker drives the timer so a background tab still rings. */
export function initAdminCalls() {
  let inflight = false;
  const tick = async () => {
    if (inflight) return; inflight = true;
    try {
      const r = await api('/api/call/incoming');
      ADM.available = r.available; drawToggle();
      const ids = new Set(r.ringing.map(x => x.id));
      for (const id of ADM.notes.keys()) if (!ids.has(id)) clearNote(id);
      ADM.ringing = r.ringing.filter(x => x.id !== ADM.call?.id);
      if (ADM.shown && !ids.has(ADM.shown)) ADM.shown = null;
      ADM.ringing.forEach(notifyRing);
      banner();
    } catch {}
    inflight = false;
  };
  try {
    const w = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 1500)'], { type: 'text/javascript' })));
    w.onmessage = tick;
  } catch { setInterval(tick, 1500); }
  tick();
}

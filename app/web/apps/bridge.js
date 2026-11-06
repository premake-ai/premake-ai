// apps: the shell's side of the app bridge (companion-app CONTRACT.md §5), as pure functions. The trusted shell
// (web/apps/shell.js) runs every message from the sandboxed app through parseRequest() before it touches anything, and
// passes every API answer through the sanitizers before the app sees it. server/apps.test.js tests this file directly.
// A classic script: in the browser it sets window.BuilderyBridge, under Node it is module.exports.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BuilderyBridge = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // method -> the parameters it takes (nothing else is accepted)
  const METHODS = Object.freeze({
    devices: [], readings: ['device', 'range'], rename: ['device', 'name'], setProfile: ['device', 'profile'],
    addDevice: [], photo: ['device'], photos: ['device'], alerts: [], profiles: [], app: [],
    command: ['device', 'set'], // controls: set a device's controls ({ field: value }), checked again by the server
  });
  // methods that open one of the shell's own sheets (they wait for the person, so they get a long timeout)
  const UI_METHODS = Object.freeze(['addDevice', 'photo', 'alerts']);
  const DEVICE_RE = /^dv_[0-9a-f]{10}$/;
  const PROFILE_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
  const FIELD_RE = /^[a-z][a-z0-9_]{0,23}$/;
  const STATUS = ['ok', 'watch', 'alert', 'offline'];
  const HEALTH = ['good', 'watch', 'bad'];
  const RANGES = Object.freeze({ day: { span: 864e5, bucket: 900 }, week: { span: 7 * 864e5, bucket: 3600 }, month: { span: 30 * 864e5, bucket: 14400 } });
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  /** A plain JSON-like object (what structured clone makes of an object literal), not an array, null or a class instance. */
  function isPlain(v) {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
    const p = Object.getPrototypeOf(v);
    return p === null || p === Object.prototype || Object.getPrototypeOf(p) === null;
  }

  /** A device or sensor name: no control or bidi characters, single spaces, 1..40 characters. '' when unusable. */
  function cleanName(v) {
    if (typeof v !== 'string') return '';
    // eslint-disable-next-line no-control-regex
    const s = v.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, ' ').replace(/\s+/g, ' ').trim();
    const n = [...s].length;
    return n >= 1 && n <= 40 ? s : '';
  }

  /** Validate one app -> shell message. null: not a bridge request (ignore it). { id: null, error }: unanswerable.
   *  { id, error }: answer with that error. { id, method, params, ui }: run it (the device still has to be checked
   *  against this project's own devices, and a profile against profiles.json: checkDevice / checkProfile). */
  function parseRequest(data) {
    if (!isPlain(data) || data.bx !== 1 || !hasOwn(data, 'method')) return null; // events, replies, other messages
    const id = data.id;
    if (!Number.isSafeInteger(id) || id < 0) return { id: null, error: 'Bad request id' };
    const method = data.method;
    if (typeof method !== 'string' || !hasOwn(METHODS, method)) return { id, error: 'Unknown method' };
    const raw = data.params === undefined || data.params === null ? {} : data.params;
    if (!isPlain(raw)) return { id, error: 'params must be an object' };
    const want = METHODS[method];
    for (const k of Object.keys(raw)) if (!want.includes(k)) return { id, error: `Unexpected parameter "${String(k).slice(0, 40)}"` };
    const params = {};
    for (const k of want) {
      const v = raw[k];
      if (k === 'device') {
        if (typeof v !== 'string' || !DEVICE_RE.test(v)) return { id, error: 'Unknown device' };
        params.device = v;
      } else if (k === 'range') {
        const r = v === undefined ? 'day' : v;
        if (typeof r !== 'string' || !hasOwn(RANGES, r)) return { id, error: 'range must be "day", "week" or "month"' };
        params.range = r;
      } else if (k === 'name') {
        const n = cleanName(v);
        if (!n) return { id, error: 'A name is 1 to 40 characters' };
        params.name = n;
      } else if (k === 'set') {
        const set = commandValues(v);
        if (!set) return { id, error: 'set is { control: value } with 1 to 8 controls' };
        params.set = set;
      } else if (k === 'profile') {
        if (v === null || v === '') params.profile = null;
        else if (typeof v !== 'string' || !PROFILE_RE.test(v)) return { id, error: 'Unknown profile' };
        else params.profile = v;
      }
    }
    return { id, method, params, ui: UI_METHODS.includes(method) };
  }
  // ---------------------------------------------------------------- controls: app.json "controls" and commands to devices
  const CONTROL_TYPES = ['range', 'toggle', 'color', 'choice', 'button'];
  const OPTION_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,23}$/;
  const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  const fin = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e7;
  // eslint-disable-next-line no-control-regex
  const label = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
  /** A command's values as sent: { field: number | boolean | short string }, 1..8 of them, else null. */
  function commandValues(v) {
    if (!isPlain(v)) return null;
    const keys = Object.keys(v);
    if (keys.length < 1 || keys.length > 8) return null;
    const out = {};
    for (const k of keys) {
      const x = v[k];
      if (!FIELD_RE.test(k)) return null;
      if (fin(x) || typeof x === 'boolean' || (typeof x === 'string' && x.length <= 24)) out[k] = x;
      else return null;
    }
    return out;
  }
  /** app.json "controls" -> { field: { type, label, unit?, min, max, step | options } }: at most 12, malformed ones dropped.
   *  range: a number from min to max in steps; toggle: true/false; color: "#rrggbb"; choice: one of options;
   *  button: a press (the device sees a counter that goes up by one per press). */
  function cleanControls(raw) {
    const out = {};
    if (!isPlain(raw)) return out;
    for (const k of Object.keys(raw).slice(0, 12)) {
      const c = raw[k];
      if (!FIELD_RE.test(k) || !isPlain(c) || !CONTROL_TYPES.includes(c.type)) continue;
      const o = { type: c.type, label: label(c.label, 40) || k };
      if (typeof c.unit === 'string' && c.unit) o.unit = label(c.unit, 12);
      if (c.type === 'range') {
        const min = fin(c.min) ? c.min : 0, max = fin(c.max) ? c.max : 100;
        if (!(max > min)) continue;
        const step = fin(c.step) && c.step > 0 && c.step <= max - min ? c.step : (max - min) / 100 >= 1 ? 1 : (max - min) / 100;
        Object.assign(o, { min, max, step });
      } else if (c.type === 'choice') {
        const opts = Array.isArray(c.options) ? [...new Set(c.options.filter((x) => typeof x === 'string' && OPTION_RE.test(x)))].slice(0, 12) : [];
        if (!opts.length) continue;
        o.options = opts;
      }
      out[k] = o;
    }
    return out;
  }
  /** Check a command against the app's controls. -> { set } (values normalised: a range snapped to its step, a colour in
   *  lower case, a button press as true) or { error }. */
  function checkCommand(set, controls) {
    const v = commandValues(set);
    if (!v) return { error: 'Send 1 to 8 controls as { control: value }' };
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      const c = isPlain(controls) && hasOwn(controls, k) ? controls[k] : null;
      if (!c) return { error: `This app has no control "${k}"` };
      if (c.type === 'range') {
        if (!fin(x) || x < c.min || x > c.max) return { error: `${c.label} goes from ${c.min} to ${c.max}` };
        const n = Math.round((x - c.min) / c.step);
        out[k] = Math.min(c.max, Math.round((c.min + n * c.step) * 1e6) / 1e6);
      } else if (c.type === 'toggle') {
        if (typeof x !== 'boolean') return { error: `${c.label} is on or off (true or false)` };
        out[k] = x;
      } else if (c.type === 'color') {
        if (typeof x !== 'string' || !COLOR_RE.test(x)) return { error: `${c.label} is a colour like "#ff8800"` };
        out[k] = x.toLowerCase();
      } else if (c.type === 'choice') {
        if (typeof x !== 'string' || !c.options.includes(x)) return { error: `${c.label} is one of ${c.options.join(', ')}` };
        out[k] = x;
      } else if (c.type === 'button') {
        if (x !== true) return { error: `${c.label} is pressed with true` };
        out[k] = true;
      }
    }
    return { set: out };
  }
  /** A device's control state as the app may see it: { set: { field: value }, seq, delivered, polled } or null. */
  function control(c) {
    if (!isPlain(c)) return null;
    const set = isPlain(c.set) && Object.keys(c.set).length ? commandValues(c.set) || {} : {};
    return { set, seq: Number.isSafeInteger(c.seq) && c.seq >= 0 ? c.seq : 0, delivered: c.delivered === true, polled: str(c.polled, 40) };
  }

  /** The device must be one of this project's own (ids the shell got from /api/apps/<project>/devices). */
  function checkDevice(params, known) {
    if (!params.device) return null;
    const ok = known instanceof Set ? known.has(params.device) : Array.isArray(known) && known.includes(params.device);
    return ok ? null : 'Unknown device';
  }
  /** A profile key must exist in this app's profiles.json (null clears it). */
  function checkProfile(params, profiles) {
    if (params.profile === undefined || params.profile === null) return null;
    return profiles && typeof profiles === 'object' && hasOwn(profiles, params.profile) ? null : 'Unknown profile';
  }

  /** day | week | month -> the readings query: the last 24 h in 15 min buckets, 7 days hourly, 30 days in 4 h buckets. */
  function rangeQuery(range, now) {
    const r = RANGES[hasOwn(RANGES, range) ? range : 'day'];
    const to = Math.floor((Number.isFinite(now) ? now : Date.now()) / 1000) * 1000;
    return { from: new Date(to - r.span).toISOString(), to: new Date(to).toISOString(), bucket: r.bucket };
  }

  // ---------------------------------------------------------------- sanitizers: only known fields reach the app
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e7 ? v : null);
  /** { field: number } with contract field names only (at most 16). */
  function values(r) {
    const out = {};
    if (!isPlain(r)) return out;
    let n = 0;
    for (const k of Object.keys(r)) {
      if (n >= 16) break;
      const v = num(r[k]);
      if (FIELD_RE.test(k) && v !== null) { out[k] = v; n++; }
    }
    return out;
  }
  /** The alert rules firing on a device now (platform addition to CONTRACT §3): [{ id, severity, message, since }]. */
  function alerts(a) {
    return Array.isArray(a) ? a.filter(isPlain).slice(0, 32).map((x) => ({ id: str(x.id, 40), severity: x.severity === 'high' ? 'high' : 'low',
      message: str(x.message, 200) || '', since: str(x.since, 40) })) : [];
  }
  /** A device as the app may see it (CONTRACT §3 list shape, plus fw and alerts). Never a key or key hash. null if it isn't a device. */
  function device(d) {
    if (!isPlain(d) || typeof d.id !== 'string' || !DEVICE_RE.test(d.id)) return null;
    const last = isPlain(d.last) && typeof d.last.t === 'string' ? { t: d.last.t.slice(0, 40), r: values(d.last.r) } : null;
    return {
      id: d.id, name: str(d.name, 80) || 'Sensor', profile: typeof d.profile === 'string' && PROFILE_RE.test(d.profile) ? d.profile : null,
      created: str(d.created, 40), last, status: STATUS.includes(d.status) ? d.status : (last ? 'ok' : 'offline'), battery: num(d.battery),
      fw: typeof d.fw === 'string' && /^[0-9A-Za-z._-]{1,16}$/.test(d.fw) ? d.fw : null, alerts: alerts(d.alerts),
      ...(control(d.control) ? { control: control(d.control) } : {}), // controls: what the app last asked the device to do
    };
  }
  function devices(list) { return Array.isArray(list) ? list.map(device).filter(Boolean).slice(0, 200) : []; }
  /** { fields, points: [[iso, {field: number}], ...] } (at most 2000 points). */
  function readings(r) {
    const fields = isPlain(r) && Array.isArray(r.fields) ? r.fields.filter((f) => typeof f === 'string' && FIELD_RE.test(f)).slice(0, 16) : [];
    const points = [];
    for (const p of isPlain(r) && Array.isArray(r.points) ? r.points.slice(0, 2000) : []) {
      if (Array.isArray(p) && typeof p[0] === 'string') points.push([p[0].slice(0, 40), values(p[1])]);
    }
    return { fields, points };
  }
  const list = (a, n, len) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string').slice(0, n).map((x) => x.slice(0, len)) : []);
  const IMG_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  /** A photo check (CONTRACT §3 photo answer), plus the shell's own small copy of the photo as a data: URL. */
  function analysis(a) {
    if (!isPlain(a)) return null;
    const out = { id: str(a.id, 64), t: str(a.t, 40), health: HEALTH.includes(a.health) ? a.health : 'watch', summary: str(a.summary, 800) || '',
      issues: list(a.issues, 10, 300), advice: list(a.advice, 10, 300) };
    if (typeof a.growth === 'string' && a.growth) out.growth = a.growth.slice(0, 400);
    if (typeof a.image === 'string' && a.image.length < 700000 && IMG_RE.test(a.image)) out.image = a.image;
    return out;
  }
  function photos(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, 50).filter(isPlain).map((p) => {
      const o = { id: str(p.id, 64), t: str(p.t, 40), health: HEALTH.includes(p.health) ? p.health : 'watch', summary: str(p.summary, 800) || '' };
      if (typeof p.image === 'string' && p.image.length < 700000 && IMG_RE.test(p.image)) o.image = p.image;
      return o;
    });
  }

  /** Token bucket: burst `cap` requests, then `perSec` a second. take(now) -> false when over the limit. */
  function limiter(cap, perSec) {
    let tokens = cap, at = null;
    return {
      take(now) {
        const t = Number.isFinite(now) ? now : Date.now();
        if (at !== null) tokens = Math.min(cap, tokens + (Math.max(0, t - at) / 1000) * perSec);
        at = t;
        if (tokens < 1) return false;
        tokens -= 1;
        return true;
      },
    };
  }

  return { METHODS, UI_METHODS, RANGES, DEVICE_RE, PROFILE_RE, FIELD_RE, isPlain, cleanName, parseRequest, checkDevice, checkProfile,
    rangeQuery, values, device, devices, readings, analysis, photos, limiter, cleanControls, checkCommand, commandValues, control, CONTROL_TYPES };
});

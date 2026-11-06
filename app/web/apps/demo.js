// apps: demo data for /apps/<id>?preview=1 (companion-app CONTRACT.md §5 "Preview"). Three made-up devices with 30 days
// of believable history, so the studio's App tab looks alive before any hardware exists. No network, no randomness:
// the same project always gets the same devices and the same curves (seeded by its id), and "now" keeps moving, so
// every poll brings a fresh reading. Shapes match the owner API (CONTRACT §3), so the shell treats it like the real thing.
// Classic script: window.BuilderyDemo in the browser, module.exports under Node (server/apps.test.js).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BuilderyDemo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const H = 3600e3, D = 24 * H;
  const DEFAULT_FIELDS = { moisture: { label: 'Soil moisture', unit: '%' }, light: { label: 'Light', unit: 'lux' }, temp: { label: 'Temperature', unit: '°C' },
    humidity: { label: 'Humidity', unit: '%' }, battery: { label: 'Battery', unit: 'V' } };
  const RANGES = { day: { span: D, bucket: 900 }, week: { span: 7 * D, bucket: 3600 }, month: { span: 30 * D, bucket: 14400 } };

  function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  /** Deterministic noise in [-1, 1] for (seed, n). */
  function noise(seed, n) {
    let x = (seed ^ Math.imul(n | 0, 0x9e3779b1)) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); x ^= x >>> 16;
    return ((x >>> 0) / 4294967295) * 2 - 1;
  }
  /** Smooth noise: interpolated between hourly knots. */
  function smooth(seed, t, period) {
    const k = t / period, i = Math.floor(k), f = k - i, s = f * f * (3 - 2 * f);
    return noise(seed, i) * (1 - s) + noise(seed, i + 1) * s;
  }
  const hourOf = (t) => { const d = new Date(t); return d.getHours() + d.getMinutes() / 60; };
  const dayIndex = (t) => Math.floor((t - new Date(t).getTimezoneOffset() * 60e3) / D);
  /** 0 at night, 1 at solar noon (sunrise 6:30, sunset 19:30). */
  function daylight(t) { const h = hourOf(t); return h <= 6.5 || h >= 19.5 ? 0 : Math.pow(Math.sin(Math.PI * (h - 6.5) / 13), 1.6); }
  const kindOf = (field, unit) => {
    const f = `${field} ${unit || ''}`.toLowerCase();
    if (/moist|soil|water/.test(f)) return 'moisture';
    if (/light|lux|illum/.test(f)) return 'light';
    if (/temp|°c|°f|celsius/.test(f)) return 'temp';
    if (/hum/.test(f)) return 'humidity';
    if (/batt|volt|\bv\b/.test(f)) return 'battery';
    if (/co2|ppm/.test(f)) return 'co2';
    if (/%/.test(f)) return 'percent';
    return 'other';
  };
  const round = (v, kind) => (kind === 'light' || kind === 'co2' ? Math.round(v) : kind === 'battery' ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10);

  // Where each demo device lives: how bright, how long since it was watered, how its battery is doing.
  const SPOTS = [
    { place: 'Kitchen', lux: 16000, sinceWater: 1.6 * D, every: 6.2, batt: 4.12 },
    { place: 'Bedroom', lux: 5200, sinceWater: 5.4 * D, every: 7.5, batt: 3.96 },
    { place: 'Office', lux: 2600, sinceWater: 8.6 * D, every: 8.5, batt: 3.71 },
  ];

  function create(opts = {}) {
    const seed = hash(opts.id || 'demo');
    const fields = opts.fields && Object.keys(opts.fields).length ? opts.fields : DEFAULT_FIELDS;
    const profiles = opts.profiles && typeof opts.profiles === 'object' ? opts.profiles : {};
    const keys = Object.keys(profiles);
    const plant = keys.length > 0 || Object.keys(fields).some((f) => kindOf(f, fields[f]?.unit) === 'moisture');
    const t0 = Number.isFinite(opts.now) ? opts.now : Date.now();
    const clock = typeof opts.clock === 'function' ? opts.clock : () => Date.now();
    const hex = (i) => (hash(`${opts.id}:${i}`).toString(16).padStart(8, '0') + hash(`${i}#${opts.id}`).toString(16).padStart(8, '0')).slice(0, 10);
    const devs = SPOTS.map((s, i) => {
      const profile = keys.length ? keys[i % keys.length] : null;
      const pname = profile ? String(profiles[profile]?.name || profile) : '';
      const name = pname ? `${pname} in the ${s.place.toLowerCase()}` : `${s.place} ${plant ? 'plant' : 'sensor'}`;
      return { id: 'dv_' + hex(i), name, profile, created: new Date(t0 - (34 + i * 3) * D).toISOString(), spot: s, seed: hash(`${seed}:${i}`) };
    });
    const photoLog = new Map(); // device id -> [analysis]
    // controls: app.json "controls" (cleaned by the shell). Each demo device starts at a sensible state, answers every
    // command at once ("delivered"), and a reading with the same name as a control follows it.
    const controls = opts.controls && typeof opts.controls === 'object' ? opts.controls : {};
    const startState = () => {
      const st = {};
      for (const [k, c] of Object.entries(controls)) {
        st[k] = c.type === 'range' ? Math.round((c.min + (c.max - c.min) / 2) / c.step) * c.step : c.type === 'toggle' ? false
          : c.type === 'color' ? '#e8590c' : c.type === 'choice' ? c.options[0] : 0;
      }
      return st;
    };
    for (const d of devs) d.ctl = { set: startState(), seq: 0 };

    // ---- the curves (continuous in time, so every poll can return a new "now" reading)
    /** Watering times for a device: the last one sinceWater ago, then every `every` (+-1) days back for 40 days. */
    function waterings(d) {
      if (d._w) return d._w;
      const out = [t0 - d.spot.sinceWater];
      for (let i = 1; out[out.length - 1] > t0 - 40 * D; i++) out.push(out[out.length - 1] - (d.spot.every + noise(d.seed, 900 + i)) * D);
      return (d._w = out.reverse());
    }
    function value(d, field, t) {
      const kind = kindOf(field, fields[field]?.unit), sd = d.seed ^ hash(field);
      const n = noise(sd, Math.floor(t / 600e3)) * 0.5 + smooth(sd, t, 3 * H) * 0.5;
      switch (kind) {
        case 'moisture': {
          const w = waterings(d);
          let last = w[0]; for (const x of w) if (x <= t) last = x;
          const h = Math.max(0, t - last) / D;
          // a quick soak (half an hour), then drying towards a floor, a little faster in daylight
          const top = 74 + noise(d.seed, Math.floor(last / D)) * 4, floor = 11;
          const soak = Math.min(1, (t - last) / (0.5 * H));
          return Math.max(4, Math.min(92, floor + (top - floor) * Math.exp(-h / 4.1) * soak + (1 - soak) * 20 - daylight(t) * 0.8 + n * 0.5));
        }
        case 'light': {
          const cloud = 0.42 + 0.58 * (0.5 + 0.5 * noise(d.seed ^ 77, dayIndex(t)));
          const lamp = hourOf(t) >= 18.5 && hourOf(t) < 23 ? 35 + 10 * n : 0;
          return Math.max(0, d.spot.lux * cloud * daylight(t) * (1 + 0.08 * n) + lamp);
        }
        case 'temp': return 21 + 2.3 * Math.sin(2 * Math.PI * (hourOf(t) - 9) / 24) + 0.9 * Math.sin(2 * Math.PI * t / (9.3 * D) + d.seed % 7) + n * 0.25;
        // humidity follows the temperature curve ('__temp': the temperature whatever the field is called)
        case 'humidity': return Math.max(25, Math.min(88, 54 - 1.8 * (value(d, '__temp', t) - 21) + 5 * Math.sin(2 * Math.PI * t / (11.7 * D) + d.seed % 5) + n * 0.8));
        case 'battery': return d.spot.batt - 0.0075 * ((t - t0) / D) + n * 0.004; // about 0.23 V a month
        case 'co2': return 430 + 380 * Math.max(0, Math.sin(Math.PI * (hourOf(t) - 7) / 16)) + 40 * n;
        case 'percent': return 50 + 18 * smooth(sd, t, 2 * D) + 3 * n;
        default: return 50 + 30 * smooth(sd, t, 2 * D) + 4 * n;
      }
    }
    function reading(d, t) {
      const r = {};
      for (const f of Object.keys(fields)) r[f] = round(value(d, f, t), kindOf(f, fields[f]?.unit));
      return r;
    }
    function fieldOfKind(kind) { return Object.keys(fields).find((f) => kindOf(f, fields[f]?.unit) === kind) || null; }
    function status(d, r) {
      const p = d.profile ? profiles[d.profile] || {} : {};
      const m = fieldOfKind('moisture'), b = fieldOfKind('battery');
      // thresholds are <field>_min / <field>_max (CONTRACT §4), whatever the moisture field is called
      const lo = m && Number.isFinite(p[`${m}_min`]) ? p[`${m}_min`] : p.moisture_min, hi = m && Number.isFinite(p[`${m}_max`]) ? p[`${m}_max`] : p.moisture_max;
      let s = 'ok';
      if (m && Number.isFinite(lo) && r[m] < lo) return 'alert';
      if (m && Number.isFinite(lo) && r[m] < lo + 6) s = 'watch';
      if (m && Number.isFinite(hi) && r[m] > hi) s = 'watch';
      if (b && r[b] < 3.45) s = 'watch';
      if (!d.profile && m && r[m] < 25) return 'alert';
      if (!d.profile && m && r[m] < 32) s = 'watch';
      return s;
    }
    /** The rules that would be firing (the platform's device.alerts), with their messages filled in. */
    function firing(d, r, st) {
      const m = fieldOfKind('moisture'), b = fieldOfKind('battery'), out = [], since = new Date(t0 - 5 * H).toISOString();
      if (st === 'alert' && m) out.push({ id: 'thirsty', severity: 'high', message: `${d.name} needs a drink`, since });
      else if (st === 'watch' && m && r[m] < 40) out.push({ id: 'drying', severity: 'low', message: `${d.name} will need water soon`, since });
      if (b && r[b] < 3.45) out.push({ id: 'battery', severity: 'low', message: `${d.name}'s sensor needs charging`, since });
      return out;
    }
    function snapshot(d) {
      if (d.fresh) {
        if (clock() < d.fresh) return { id: d.id, name: d.name, profile: d.profile, created: d.created, last: null, status: 'offline', battery: null, fw: null, alerts: [] };
      }
      const t = Math.floor(clock() / 60e3) * 60e3; // a new reading every minute in the demo
      const r = reading(d, t), b = fieldOfKind('battery'), st = status(d, r);
      if (d.ctl) for (const [k, v] of Object.entries(d.ctl.set)) if (Object.prototype.hasOwnProperty.call(r, k) && typeof v === 'number' && controls[k]?.type === 'range') r[k] = v;
      const out = { id: d.id, name: d.name, profile: d.profile, created: d.created, last: { t: new Date(t).toISOString(), r }, status: st, battery: b ? r[b] : null,
        fw: '1.0.0', alerts: firing(d, r, st) };
      if (d.ctl && Object.keys(controls).length) out.control = { set: { ...d.ctl.set }, seq: d.ctl.seq, delivered: true, polled: new Date(clock() - 3e3).toISOString() };
      return out;
    }
    const find = (id) => { const d = devs.find((x) => x.id === id); if (!d) throw new Error('Unknown device'); return d; };

    return {
      demo: true,
      fields: Object.keys(fields),
      devices() { return devs.map(snapshot); },
      readings(id, range) {
        const d = find(id), r = RANGES[range] || RANGES.day;
        const now = clock(), step = r.bucket * 1000, start = Math.floor((now - r.span) / step) * step;
        const flist = Object.keys(fields);
        const from = d.fresh ? Math.max(start, d.fresh) : start;
        const points = [];
        for (let t = start; t < now; t += step) {
          if (t + step <= from) continue;
          const avg = {};
          for (const f of flist) { // average 3 samples per bucket so light curves don't alias
            const k = kindOf(f, fields[f]?.unit);
            avg[f] = round((value(d, f, t + step * 0.17) + value(d, f, t + step * 0.5) + value(d, f, t + step * 0.83)) / 3, k);
          }
          points.push([new Date(t + step / 2).toISOString(), avg]);
        }
        return { fields: flist, points };
      },
      rename(id, name) { const d = find(id); d.name = String(name).slice(0, 40); return snapshot(d); },
      /** controls: a command the shell already checked against the controls; a button press counts up. */
      command(id, set) {
        const d = find(id);
        if (!d.ctl) d.ctl = { set: startState(), seq: 0 };
        for (const [k, v] of Object.entries(set || {})) {
          if (!controls[k]) continue;
          d.ctl.set[k] = controls[k].type === 'button' ? (Number(d.ctl.set[k]) || 0) + 1 : v;
        }
        d.ctl.seq++;
        return snapshot(d);
      },
      setProfile(id, profile) { const d = find(id); d.profile = profile; return snapshot(d); },
      /** A new demo sensor: no readings yet, its first one arrives about 20 s later. */
      createDevice(name) {
        const i = devs.length;
        const s = { place: '', lux: 7000, sinceWater: 0.4 * D, every: 6, batt: 4.15 };
        const d = { id: 'dv_' + hex(i), name: String(name).slice(0, 40), profile: keys[i % (keys.length || 1)] || null, created: new Date(clock()).toISOString(), spot: s, seed: hash(`${seed}:${i}`), fresh: clock() + 20e3, ctl: { set: startState(), seq: 0 } };
        devs.push(d);
        return { device: snapshot(d), key: demoKey(seed + i) };
      },
      /** A believable photo check for this device (the plant on the dry side gets told to water). */
      photo(id) {
        const d = find(id), snap = snapshot(d), dry = snap.status === 'alert';
        const p = d.profile ? profiles[d.profile] || {} : {};
        const a = dry
          ? { health: 'watch', summary: `${p.name || 'The plant'} looks thirsty: the lower leaves are starting to droop and the topsoil is dry.`,
            issues: ['Slight wilting on the lower leaves', 'Dry, pulled-away topsoil'], advice: ['Water slowly until it drains from the bottom', 'Check it again tomorrow morning'] }
          : { health: 'good', summary: `${p.name || 'The plant'} looks healthy: firm, upright leaves with good colour and new growth at the top.`,
            issues: [], advice: ['Keep the current watering rhythm', 'Turn the pot a quarter turn each week for even growth'], growth: 'One new leaf since the last photo' };
        const out = { id: 'ph_' + hex(900 + (photoLog.get(id)?.length || 0)), t: new Date(clock()).toISOString(), ...a };
        photoLog.set(id, [out, ...(photoLog.get(id) || [])]);
        return out;
      },
      photos(id) {
        const d = find(id);
        const past = [
          { id: 'ph_' + hex(700), t: new Date(t0 - 9 * D).toISOString(), health: 'good', summary: 'Healthy leaves, even colour. A new leaf is unfurling.' },
          { id: 'ph_' + hex(701), t: new Date(t0 - 23 * D).toISOString(), health: 'watch', summary: 'A little yellowing on one lower leaf; otherwise fine.' },
        ];
        return [...(photoLog.get(d.id) || []).map(({ id: pid, t, health, summary }) => ({ id: pid, t, health, summary })), ...past];
      },
    };
  }
  /** A key-shaped string for the demo pairing sheet (never valid on the real server). */
  function demoKey(n) {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let s = '';
    for (let i = 0; i < 43; i++) s += A[(hash(`${n}:${i}`) >>> 3) % 64];
    return s;
  }
  return { create, DEFAULT_FIELDS, kindOf };
});

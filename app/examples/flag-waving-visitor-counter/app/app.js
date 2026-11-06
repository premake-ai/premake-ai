(function () {
  'use strict';

  var B = window.buildery || null;

  var DEFAULT_FIELDS = {
    visits: { label: 'Visits today', unit: 'visits' },
    designs: { label: 'Designs today', unit: 'designs' },
    rssi: { label: 'Wi-Fi signal', unit: 'dBm' }
  };
  var DEFAULT_CONTROLS = {
    angle: { type: 'range', label: 'Flag angle', min: 0, max: 180, step: 1, unit: '°' },
    wave: { type: 'button', label: 'Wave now' },
    mode: { type: 'choice', label: 'Wave for', options: ['all', 'designs', 'quiet'] },
    brightness: { type: 'range', label: 'Screen brightness', min: 0, max: 100, step: 5, unit: '%' }
  };
  var MODE_LABELS = { all: 'Everything', designs: 'Designs', quiet: 'Quiet' };
  var MODE_HELP = {
    all: 'Waves for every visit and every design.',
    designs: 'Waves only when someone designs something.',
    quiet: 'Keeps counting on the screen, but the flag stays still.'
  };
  var CHART_TITLES = { visits: 'Visits', designs: 'Designs', rssi: 'Wi-Fi signal' };
  var COUNTERS = { visits: true, designs: true };
  var BUCKET_MIN = { day: 15, week: 60, month: 240 };
  var STATUS_ORDER = { bad: 0, warn: 1, busy: 2, off: 3, ok: 4 };
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var FLAG_SVG = '<svg class="flag-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/><path d="M7 4.2c3-1.6 5.5 1.4 11 0v8c-5.5 1.4-8-1.6-11 0z" fill="currentColor"/></svg>';
  var BACK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var PENCIL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
  var BELL_SVG = '<svg class="bell" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2zM10 20a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  var CAMERA_SVG = '<svg class="bell" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  var EMPTY_SVG = '<svg viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="46" fill="#fdeee5"/><path d="M34 22v54" stroke="#3a3733" stroke-width="5" stroke-linecap="round"/><path d="M37 24c10-5 17 5 29 0v24c-12 5-19-5-29 0z" fill="#c2410c"/><rect x="24" y="74" width="22" height="6" rx="3" fill="#3a3733"/></svg>';

  var state = {
    devices: [],
    loaded: false,
    error: '',
    profiles: {},
    app: { fields: DEFAULT_FIELDS, controls: DEFAULT_CONTROLS },
    view: 'home',
    id: null,
    range: 'day',
    readings: {},
    readErr: {},
    readLoading: {},
    photos: {},
    photoNew: {},
    photoBusy: false,
    photoErr: '',
    local: {},
    cmd: {},
    cmdTok: {},
    watchT: {},
    dragging: false,
    scrubbing: false,
    renaming: false,
    renameErr: '',
    goalErr: '',
    alertsNote: '',
    homeScroll: 0
  };

  /* ---------- helpers ---------- */

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function msg(err) { return (err && err.message) || 'Something went wrong. Try again.'; }
  function isCancel(err) { return !!(err && /cancel/i.test(err.message || '')); }
  function call(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    try {
      if (!B || typeof B[name] !== 'function') return Promise.reject(new Error("The app isn't connected yet."));
      return Promise.resolve(B[name].apply(B, args));
    } catch (e) { return Promise.reject(e); }
  }
  function fields() {
    var f = state.app && state.app.fields;
    return f && typeof f === 'object' && Object.keys(f).length ? f : DEFAULT_FIELDS;
  }
  function controls() {
    var c = state.app && state.app.controls;
    return c && typeof c === 'object' ? c : {};
  }
  function labelOf(f) { var d = fields()[f]; return (d && d.label) || f; }
  function unitOf(f) { var d = fields()[f]; return (d && d.unit) || ''; }
  function byId(id) {
    for (var i = 0; i < state.devices.length; i++) if (state.devices[i] && state.devices[i].id === id) return state.devices[i];
    return null;
  }
  function prof(d) {
    var k = d && d.profile;
    var p = k && state.profiles && state.profiles[k];
    return p && typeof p === 'object' ? p : null;
  }
  function alertsOf(d) { return d && Array.isArray(d.alerts) ? d.alerts.filter(Boolean) : []; }
  function reading(d) { return (d && d.last && d.last.r && typeof d.last.r === 'object') ? d.last.r : {}; }

  function fmt(field, v) {
    if (!num(v)) return '–';
    if (field === 'rssi') return String(Math.round(v));
    if (COUNTERS[field]) return Math.round(v).toLocaleString('en-US');
    return (Math.round(v * 10) / 10).toLocaleString('en-US');
  }
  function signalWord(v) {
    if (!num(v)) return 'Unknown';
    if (v >= -60) return 'Strong';
    if (v >= -72) return 'Good';
    if (v >= -82) return 'Weak';
    return 'Very weak';
  }
  function fmtFull(field, v) {
    if (!num(v)) return '–';
    if (field === 'rssi') return signalWord(v) + ' (' + Math.round(v) + ' dBm)';
    var u = unitOf(field);
    return fmt(field, v) + (u ? (u === '%' || u === '°C' ? u : ' ' + u) : '');
  }
  function batteryPct(v) { return Math.round(clamp((v - 3.3) / 0.9, 0, 1) * 100); }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function dayName(d) {
    var now = new Date();
    if (sameDay(d, now)) return 'Today';
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, y)) return 'Yesterday';
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }
  function ago(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d)) return '';
    var s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 6 * 3600) return Math.floor(s / 3600) + ' h ago';
    var n = dayName(d);
    return (n === 'Today' ? 'today' : n === 'Yesterday' ? 'yesterday' : n) + ' ' + hm(d);
  }

  /* ---------- status ---------- */

  function chip(d) {
    var st = d && d.status;
    var al = alertsOf(d);
    if (!d || !d.last) return { cls: 'off', text: 'Waiting' };
    if (st === 'offline') return { cls: 'off', text: 'Offline' };
    if (st === 'alert') return { cls: 'bad', text: 'Needs attention' };
    if (st === 'watch') {
      if (al.length && al.every(function (a) { return a.id === 'big_day'; })) return { cls: 'busy', text: 'Busy day' };
      if (al.some(function (a) { return a.id === 'weak_wifi'; })) return { cls: 'warn', text: 'Weak Wi-Fi' };
      return { cls: 'warn', text: 'Check soon' };
    }
    return { cls: 'ok', text: 'Waving' };
  }
  function sorted() {
    return state.devices.slice().sort(function (a, b) {
      var d = STATUS_ORDER[chip(a).cls] - STATUS_ORDER[chip(b).cls];
      if (d) return d;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }
  function summary(devs) {
    var n = { ok: 0, busy: 0, warn: 0, bad: 0, off: 0 };
    devs.forEach(function (d) { n[chip(d).cls]++; });
    if (n.ok === devs.length) return devs.length === 1 ? 'Your flag is waving' : 'All ' + devs.length + ' flags are waving';
    if (devs.length === 1) {
      var c = chip(devs[0]);
      return { busy: "It's a busy day", warn: 'Your flag needs a quick check', bad: 'Your flag needs attention', off: devs[0].last ? 'Your flag is offline' : "Your flag hasn't reported yet" }[c.cls] || 'Your flag';
    }
    var parts = [];
    if (n.bad) parts.push(n.bad + (n.bad === 1 ? ' needs' : ' need') + ' attention');
    if (n.warn) parts.push(n.warn + ' to check');
    if (n.off) parts.push(n.off + ' offline');
    if (n.busy) parts.push(n.busy + ' having a busy day');
    if (n.ok) parts.push(n.ok + ' waving');
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    var s = parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function todayLine(devs) {
    var best = null;
    devs.forEach(function (d) {
      if (!d.last || d.status === 'offline' || !num(reading(d).visits)) return;
      var t = Date.parse(d.last.t);
      if (!best || t > best.t) best = { t: t, r: reading(d) };
    });
    if (!best || !sameDay(new Date(best.t), new Date())) return '';
    var s = 'Today so far: ' + fmt('visits', best.r.visits) + ' visits';
    if (num(best.r.designs)) s += ' and ' + fmt('designs', best.r.designs) + ' designs';
    return s + '.';
  }

  /* ---------- controls state ---------- */

  function vals(d) {
    var c = controls();
    var set = (d && d.control && d.control.set) || {};
    var loc = (d && state.local[d.id]) || {};
    function pick(key, def) {
      if (loc[key] !== undefined) return loc[key];
      if (set[key] !== undefined) return set[key];
      return def;
    }
    var ac = c.angle || {}, bc = c.brightness || {};
    var a = Number(pick('angle', 90));
    var b = Number(pick('brightness', 80));
    var mode = pick('mode', 'all');
    var opts = (c.mode && Array.isArray(c.mode.options)) ? c.mode.options : ['all'];
    return {
      angle: clamp(Math.round(isFinite(a) ? a : 90), num(ac.min) ? ac.min : 0, num(ac.max) ? ac.max : 180),
      brightness: clamp(Math.round(isFinite(b) ? b : 80), num(bc.min) ? bc.min : 0, num(bc.max) ? bc.max : 100),
      mode: opts.indexOf(mode) >= 0 ? mode : opts[0]
    };
  }
  function deliveryText(d) {
    var c = d && d.control;
    if (!c) return '';
    if (c.delivered) return 'Device updated';
    return 'Waiting for the device…' + (c.polled ? ' It last checked in ' + ago(c.polled) + '.' : " It hasn't checked in yet.");
  }
  function statusFor(d) {
    var s = d && state.cmd[d.id];
    if (s) return s;
    if (d && d.control && !d.control.delivered) return { text: deliveryText(d), kind: 'wait' };
    return { text: '', kind: '' };
  }
  function statusLine(d) {
    var s = statusFor(d);
    return '<p class="cmd-status ' + esc(s.kind) + '" data-status="' + esc(d.id) + '" aria-live="polite">' + esc(s.text) + '</p>';
  }
  function setStatus(id, text, kind) {
    state.cmd[id] = { text: text, kind: kind };
    var els = document.querySelectorAll('[data-status]');
    for (var i = 0; i < els.length; i++) {
      if (els[i].getAttribute('data-status') !== id) continue;
      els[i].textContent = text;
      els[i].className = 'cmd-status ' + kind;
    }
  }
  function syncStatus(id) {
    var s = state.cmd[id], d = byId(id);
    if (!s || !d || (s.kind !== 'wait' && s.kind !== 'sent')) return;
    if (d.control && d.control.delivered) setStatus(id, 'Device updated', 'ok');
    else setStatus(id, deliveryText(d), 'wait');
  }

  function sendControl(id, set) {
    var d = byId(id);
    if (!d) return;
    var keys = Object.keys(set).filter(function (k) { return k !== 'wave'; });
    if (keys.length) {
      var loc = state.local[id] = state.local[id] || {};
      keys.forEach(function (k) { loc[k] = set[k]; });
    }
    setStatus(id, 'Sending…', 'sent');
    var tok = (state.cmdTok[id] || 0) + 1;
    state.cmdTok[id] = tok;
    call('command', id, set).then(function (dev) {
      if (dev && dev.id) replaceDevice(dev);
      if (state.cmdTok[id] !== tok) return;
      if (!state.dragging) state.local[id] = {};
      var nd = byId(id);
      if (nd && nd.control && nd.control.delivered) setStatus(id, 'Sent. Device updated', 'ok');
      else setStatus(id, 'Sent. ' + deliveryText(nd), 'wait');
      watchDelivery(id, 0);
    }).catch(function (err) {
      if (state.cmdTok[id] !== tok) return;
      state.local[id] = {};
      setStatus(id, msg(err), 'err');
      refreshControlsUI(id);
    });
  }
  function watchDelivery(id, n) {
    clearTimeout(state.watchT[id]);
    var d = byId(id);
    if (!d || !d.control || d.control.delivered || n >= 24) return;
    state.watchT[id] = setTimeout(function () {
      call('devices').then(function (list) { setDevices(list); render(true); })
        .catch(function () {})
        .then(function () { syncStatus(id); watchDelivery(id, n + 1); });
    }, 5000);
  }
  function refreshControlsUI(id) {
    if (state.view === 'home') renderHome();
    else if (state.id === id && !state.dragging) { var d = byId(id); if (d) fillRemote(d); }
  }

  /* ---------- data ---------- */

  function setDevices(list) {
    if (!Array.isArray(list)) return;
    state.devices = list.filter(function (d) { return d && d.id; });
  }
  function replaceDevice(dev) {
    for (var i = 0; i < state.devices.length; i++) {
      if (state.devices[i].id === dev.id) { state.devices[i] = Object.assign({}, state.devices[i], dev); return; }
    }
    state.devices.push(dev);
  }
  function loadDevices() {
    return call('devices').then(function (list) {
      setDevices(list);
      state.loaded = true;
      state.error = '';
      Object.keys(state.cmd).forEach(syncStatus);
      render(true);
    }).catch(function (err) {
      state.loaded = true;
      state.error = msg(err);
      render(true);
    });
  }
  var refreshT = null;
  function scheduleRefresh() {
    clearTimeout(refreshT);
    refreshT = setTimeout(loadDevices, 1500);
  }

  function loadReadings(id, range, force) {
    var key = id + '|' + range, c = state.readings[key];
    if (c && !force && Date.now() - c.at < 120000) { drawIfCurrent(id, range); return; }
    state.readLoading[key] = true;
    if (!c) drawIfCurrent(id, range);
    call('readings', id, range).then(function (res) {
      state.readings[key] = { at: Date.now(), data: res || {} };
      state.readErr[key] = '';
    }).catch(function (err) {
      state.readErr[key] = msg(err);
    }).then(function () {
      state.readLoading[key] = false;
      drawIfCurrent(id, range);
    });
  }
  function drawIfCurrent(id, range) {
    if (state.view !== 'device' || state.id !== id || state.range !== range) return;
    var d = byId(id);
    if (d) fillCharts(d);
  }
  function loadPhotos(id) {
    call('photos', id).then(function (list) {
      state.photos[id] = Array.isArray(list) ? list.filter(Boolean) : [];
    }).catch(function () {
      if (!state.photos[id]) state.photos[id] = [];
    }).then(function () {
      if (state.view === 'device' && state.id === id) { var d = byId(id); if (d) fillPhoto(d); }
    });
  }

  /* ---------- home ---------- */

  function render(skipCharts) {
    if (state.view === 'home') renderHome();
    else updateDevice(skipCharts);
  }

  function goalBar(p, v) {
    var lo = p && num(p.visits_min) ? p.visits_min : null;
    var hi = p && num(p.visits_max) ? p.visits_max : null;
    var top = Math.max(hi != null ? hi * 1.25 : 0, num(v) ? v * 1.1 : 0, 10);
    function pct(x) { return clamp(x / top * 100, 0, 100); }
    var band = (lo != null && hi != null)
      ? '<span class="bar-band" style="left:' + pct(lo).toFixed(1) + '%;width:' + (pct(hi) - pct(lo)).toFixed(1) + '%"></span>' : '';
    var mark = num(v)
      ? '<span class="bar-fill" style="width:' + pct(v).toFixed(1) + '%"></span><span class="bar-dot" style="left:' + pct(v).toFixed(1) + '%"></span>' : '';
    var note;
    if (lo != null && hi != null && num(v)) {
      var where = v < lo ? 'Quieter than usual' : v > hi ? 'Busier than usual' : 'A normal day';
      note = '<strong>' + where + '</strong> for ' + esc(p.name || 'this goal') + ' (' + fmt('visits', lo) + '–' + fmt('visits', hi) + ')';
    } else {
      note = 'Pick what a normal day looks like to compare';
    }
    return '<span class="bar" aria-hidden="true">' + band + mark + '</span><span class="bar-note">' + note + '</span>';
  }

  function bigBlock(d) {
    var r = reading(d), p = prof(d);
    var smalls = [];
    if (num(r.designs)) smalls.push('<span><b>' + fmt('designs', r.designs) + '</b> designs</span>');
    if (num(r.rssi)) smalls.push('<span>Wi-Fi <b>' + signalWord(r.rssi).toLowerCase() + '</b></span>');
    if (num(d.battery)) smalls.push('<span>Battery <b>' + batteryPct(d.battery) + '%</b></span>');
    return '<span class="big"><span class="big-num">' + fmt('visits', r.visits) + '</span><span class="big-unit">visits today</span></span>' +
      goalBar(p, r.visits) +
      (smalls.length ? '<span class="smalls">' + smalls.join('') + '</span>' : '') +
      '<span class="updated">Updated ' + esc(ago(d.last.t)) + '</span>';
  }

  function modeSeg(d, v, cls) {
    var c = controls().mode;
    if (!c) return '';
    var opts = Array.isArray(c.options) ? c.options : [];
    return '<div class="seg ' + (cls || '') + '" role="group" aria-label="' + esc(c.label || 'Wave for') + '">' +
      opts.map(function (o) {
        return '<button type="button" data-mode="' + esc(o) + '" data-dev="' + esc(d.id) + '" aria-pressed="' + (v.mode === o) + '">' + esc(MODE_LABELS[o] || o) + '</button>';
      }).join('') + '</div>';
  }

  function remoteMini(d) {
    var c = controls();
    if (!c.wave && !c.mode) return '';
    var v = vals(d);
    return '<div class="remote-mini">' +
      (c.wave ? '<button type="button" class="wave-btn" data-wave="' + esc(d.id) + '">' + FLAG_SVG + '<span>' + esc(c.wave.label || 'Wave now') + '</span></button>' : '') +
      (c.mode ? '<div class="mini-row"><span class="ctl-label">' + esc(c.mode.label || 'Wave for') + '</span>' + modeSeg(d, v) + '</div>' : '') +
      statusLine(d) + '</div>';
  }

  function cardHTML(d) {
    var c = chip(d), p = prof(d), al = alertsOf(d);
    var name = esc(d.name || 'Flag buddy');
    var alertLine = al.length
      ? '<span class="card-alert' + (al[0].id === 'big_day' ? ' busy' : '') + '">' + esc(al[0].message || '') + '</span>' : '';
    var body = d.last ? bigBlock(d)
      : '<span class="card-empty">This flag hasn\'t reported yet. Plug it into USB power and give it a minute to join Wi-Fi.</span>';
    return '<article class="card dev-card">' +
      '<button type="button" class="card-open" data-open="' + esc(d.id) + '" aria-label="Open ' + name + ', ' + esc(c.text) + '">' +
      '<span class="card-head"><span class="card-titles"><span class="card-name">' + name + '</span><span class="card-sub">' +
      esc(p ? p.name : 'Desk flag') + '</span></span><span class="chip ' + c.cls + '">' + esc(c.text) + '</span></span>' +
      alertLine + body + '</button>' + remoteMini(d) + '</article>';
  }
  function safeCard(d) {
    try { return cardHTML(d); } catch (e) {
      return '<article class="card"><p class="muted">' + esc((d && d.name) || 'A flag') + " couldn't be shown right now.</p></article>";
    }
  }

  function renderHome() {
    var root = $('#home');
    if (!root || !state.loaded) return;
    var devs = sorted();
    var html = '';
    if (state.error && devs.length) {
      html += '<div class="err-line" role="status"><span>Couldn\'t refresh. ' + esc(state.error) + '</span><button type="button" class="link-btn" data-retry>Try again</button></div>';
    }
    if (!devs.length) {
      if (state.error) {
        html += '<section class="card empty"><h2>Couldn\'t load your flags</h2><p>' + esc(state.error) + '</p><button type="button" class="btn primary" data-retry>Try again</button></section>';
      } else {
        html += '<section class="card empty fade-in">' + EMPTY_SVG + '<h2>Add your first flag</h2><p>Plug in your desk buddy, then pair it here. It\'ll wave every time someone visits or designs on premake.ai.</p><button type="button" class="btn primary" data-add>Add your first flag</button></section>';
      }
      root.innerHTML = html;
      return;
    }
    html += '<p class="summary">' + esc(summary(devs)) + '</p>';
    var tl = todayLine(devs);
    html += '<p class="summary-sub">' + esc(tl || 'Tap a flag for its history and the full remote.') + '</p>';
    html += devs.map(safeCard).join('');
    html += '<button type="button" class="btn wide add-more" data-add>Add another flag</button>';
    root.innerHTML = html;
  }

  /* ---------- device screen ---------- */

  function openDevice(id) {
    if (!byId(id)) return;
    state.homeScroll = window.scrollY || 0;
    state.view = 'device';
    state.id = id;
    state.renaming = false;
    state.renameErr = '';
    state.goalErr = '';
    state.photoErr = '';
    state.alertsNote = '';
    state.local[id] = {};
    $('#home').hidden = true;
    var el = $('#device');
    el.hidden = false;
    el.innerHTML =
      '<div class="dev-top"><button type="button" class="back" data-back>' + BACK_SVG + '<span>All flags</span></button></div>' +
      '<header id="d-head" class="d-head"></header>' +
      '<section id="d-remote" class="card remote" aria-labelledby="remote-h"></section>' +
      '<section id="d-today" class="card today" aria-labelledby="today-h"></section>' +
      '<section class="card" aria-labelledby="hist-h"><div class="charts-top"><h2 id="hist-h">History</h2><div id="d-range"></div></div><div id="d-charts"></div></section>' +
      '<section id="d-goal" class="card" aria-labelledby="goal-h"></section>' +
      '<section id="d-photo" class="card" aria-labelledby="photo-h"></section>' +
      '<section id="d-info" class="card" aria-labelledby="info-h"></section>';
    el.classList.remove('fade-in'); void el.offsetWidth; el.classList.add('fade-in');
    window.scrollTo(0, 0);
    updateDevice(false);
    loadReadings(id, state.range);
    loadPhotos(id);
  }
  function goHome() {
    state.view = 'home';
    state.id = null;
    state.dragging = false;
    $('#device').hidden = true;
    $('#device').innerHTML = '';
    $('#home').hidden = false;
    renderHome();
    window.scrollTo(0, state.homeScroll || 0);
  }

  function updateDevice(skipCharts) {
    var d = byId(state.id);
    if (!d) { if (state.loaded) goHome(); return; }
    var parts = [fillHead, fillToday, fillGoal, fillPhoto, fillInfo];
    if (!state.dragging) parts.unshift(fillRemote);
    if (!skipCharts && !state.scrubbing) parts.push(fillCharts);
    parts.forEach(function (fn) { try { fn(d); } catch (e) { /* keep the rest of the screen alive */ } });
  }

  function fillHead(d) {
    var el = $('#d-head');
    if (!el) return;
    if (state.renaming && $('#rename-in')) return;
    var p = prof(d), c = chip(d), al = alertsOf(d);
    var title = state.renaming
      ? '<form id="rename-form" class="rename"><label class="sr" for="rename-in">Flag name</label><input id="rename-in" type="text" maxlength="40" autocomplete="off" value="' + esc(d.name || '') + '"><button type="submit" class="btn primary">Save</button><button type="button" class="btn" data-cancel-rename>Cancel</button></form>' +
        (state.renameErr ? '<p class="form-err" role="alert">' + esc(state.renameErr) + '</p>' : '')
      : '<h1><button type="button" class="name-btn" data-rename aria-label="' + esc(d.name || 'Flag buddy') + ', rename"><span>' + esc(d.name || 'Flag buddy') + '</span>' + PENCIL_SVG + '</button></h1>';
    el.innerHTML = title +
      '<p class="d-sub"><span class="chip ' + c.cls + '">' + esc(c.text) + '</span><span>' + esc(p ? p.name : 'No normal day set') + '</span></p>' +
      (al.length ? '<ul class="d-alerts">' + al.map(function (a) {
        return '<li class="' + (a.id === 'big_day' ? 'busy' : '') + '">' + esc(a.message || '') + '</li>';
      }).join('') + '</ul>' : '');
    if (state.renaming) {
      var inp = $('#rename-in');
      if (inp) { inp.focus(); inp.select(); }
    }
  }

  var DC = { cx: 140, cy: 150, r: 112 };
  function dialPt(a, r) {
    var th = (180 - a) * Math.PI / 180;
    return [DC.cx + r * Math.cos(th), DC.cy - r * Math.sin(th)];
  }
  function P(p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }
  function dialInner(a) {
    var r = DC.r, s = dialPt(0, r), e = dialPt(180, r), p = dialPt(a, r);
    var html = '<path class="dial-track" d="M' + P(s) + ' A' + r + ' ' + r + ' 0 0 1 ' + P(e) + '"/>';
    if (a > 0) html += '<path class="dial-fill" d="M' + P(s) + ' A' + r + ' ' + r + ' 0 0 1 ' + P(p) + '"/>';
    [0, 45, 90, 135, 180].forEach(function (t) {
      html += '<line class="dial-tick' + (t === 90 ? ' mid' : '') + '" x1="' + dialPt(t, r - 28)[0].toFixed(1) + '" y1="' + dialPt(t, r - 28)[1].toFixed(1) +
        '" x2="' + dialPt(t, r - 20)[0].toFixed(1) + '" y2="' + dialPt(t, r - 20)[1].toFixed(1) + '"/>';
    });
    var top = dialPt(a, r - 36);
    var ux = (top[0] - DC.cx) / (r - 36), uy = (top[1] - DC.cy) / (r - 36);
    var nx = -uy, ny = ux;
    function q(along, out) { return [top[0] - ux * along + nx * out, top[1] - uy * along + ny * out]; }
    html += '<line class="dial-pole" x1="' + DC.cx + '" y1="' + DC.cy + '" x2="' + top[0].toFixed(1) + '" y2="' + top[1].toFixed(1) + '"/>';
    html += '<path class="dial-flag" d="M' + P(q(0, 2)) + ' Q' + P(q(-5, 18)) + ' ' + P(q(2, 34)) + ' L' + P(q(22, 34)) + ' Q' + P(q(17, 18)) + ' ' + P(q(24, 2)) + 'Z"/>';
    html += '<circle class="dial-base" cx="' + DC.cx + '" cy="' + DC.cy + '" r="8"/>';
    html += '<circle class="dial-thumb" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="17"/>';
    return html;
  }
  function angleWord(a) {
    if (a <= 5) return 'All the way left';
    if (a < 80) return 'Leaning left';
    if (a <= 100) return 'Straight up';
    if (a < 175) return 'Leaning right';
    return 'All the way right';
  }
  function paintDial(a) {
    var svg = $('#dial');
    if (svg) {
      svg.innerHTML = dialInner(a);
      svg.setAttribute('aria-valuenow', a);
      svg.setAttribute('aria-valuetext', a + ' degrees, ' + angleWord(a).toLowerCase());
    }
    var n = $('#dial-num'), w = $('#dial-word');
    if (n) n.textContent = a + '°';
    if (w) w.textContent = angleWord(a);
  }
  function setAngle(id, a) {
    var c = controls().angle || {};
    a = clamp(Math.round(a), num(c.min) ? c.min : 0, num(c.max) ? c.max : 180);
    var cur = vals(byId(id) || {}).angle;
    paintDial(a);
    if (a === cur && state.local[id] && state.local[id].angle === a) return;
    sendControl(id, { angle: a });
  }

  function fillRemote(d) {
    var el = $('#d-remote');
    if (!el) return;
    var c = controls();
    if (!Object.keys(c).length) { el.hidden = true; return; }
    el.hidden = false;
    var v = vals(d), id = d.id;
    var html = '<h2 id="remote-h">Remote</h2>';
    if (c.angle) {
      html += '<div class="dial-wrap"><div class="dial-read"><span class="dial-num" id="dial-num">' + v.angle + '°</span><span class="dial-word" id="dial-word">' + angleWord(v.angle) + '</span></div>' +
        '<svg class="dial" id="dial" viewBox="0 0 280 172" role="slider" tabindex="0" aria-label="' + esc(c.angle.label || 'Flag angle') +
        '" aria-valuemin="0" aria-valuemax="180" aria-valuenow="' + v.angle + '">' + dialInner(v.angle) + '</svg>' +
        '<div class="dial-quick"><button type="button" data-angle="0">Left</button><button type="button" data-angle="90">Up</button><button type="button" data-angle="180">Right</button></div></div>';
    }
    if (c.wave) html += '<button type="button" class="wave-btn big" data-wave="' + esc(id) + '">' + FLAG_SVG + '<span>' + esc(c.wave.label || 'Wave now') + '</span></button>';
    if (c.mode) {
      html += '<div class="ctl"><h3 class="ctl-label">' + esc(c.mode.label || 'Wave for') + '</h3>' + modeSeg(d, v) +
        '<p class="muted">' + esc(MODE_HELP[v.mode] || '') + '</p></div>';
    }
    if (c.brightness) {
      var bc = c.brightness, mn = num(bc.min) ? bc.min : 0, mx = num(bc.max) ? bc.max : 100;
      html += '<div class="ctl"><div class="ctl-row"><h3 class="ctl-label" id="br-l">' + esc(bc.label || 'Screen brightness') + '</h3><span class="ctl-val" id="br-v">' + v.brightness + '%</span></div>' +
        '<input type="range" class="slider" id="br" min="' + mn + '" max="' + mx + '" step="' + (num(bc.step) ? bc.step : 1) + '" value="' + v.brightness +
        '" aria-labelledby="br-l" style="--p:' + ((v.brightness - mn) / ((mx - mn) || 1) * 100).toFixed(1) + '%"></div>';
    }
    html += statusLine(d);
    el.innerHTML = html;
    bindDial(id);
    bindSlider(id);
  }

  function bindDial(id) {
    var svg = $('#dial');
    if (!svg) return;
    function angleAt(ev) {
      var r = svg.getBoundingClientRect();
      var x = (ev.clientX - r.left) * 280 / r.width;
      var y = (ev.clientY - r.top) * 172 / r.height;
      var th = Math.atan2(DC.cy - y, x - DC.cx) * 180 / Math.PI;
      if (th < -90) th = 180; else if (th < 0) th = 0;
      return 180 - th;
    }
    svg.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      state.dragging = true;
      try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
      setAngle(id, angleAt(ev));
    });
    svg.addEventListener('pointermove', function (ev) {
      if (!state.dragging) return;
      setAngle(id, angleAt(ev));
    });
    function end(ev) {
      if (!state.dragging) return;
      state.dragging = false;
      var a = vals(byId(id) || {}).angle;
      sendControl(id, { angle: a });
    }
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('keydown', function (ev) {
      var a = vals(byId(id) || {}).angle, k = ev.key;
      var na = k === 'ArrowLeft' || k === 'ArrowDown' ? a - 5 : k === 'ArrowRight' || k === 'ArrowUp' ? a + 5 : k === 'Home' ? 0 : k === 'End' ? 180 : null;
      if (na === null) return;
      ev.preventDefault();
      setAngle(id, na);
    });
  }

  function bindSlider(id) {
    var s = $('#br');
    if (!s) return;
    function upd() {
      var v = Number(s.value), mn = Number(s.min), mx = Number(s.max);
      s.style.setProperty('--p', ((v - mn) / ((mx - mn) || 1) * 100).toFixed(1) + '%');
      var o = $('#br-v'); if (o) o.textContent = v + '%';
      return v;
    }
    s.addEventListener('pointerdown', function () { state.dragging = true; });
    s.addEventListener('input', function () { sendControl(id, { brightness: upd() }); });
    s.addEventListener('change', function () { state.dragging = false; sendControl(id, { brightness: upd() }); });
  }

  function fillToday(d) {
    var el = $('#d-today');
    if (!el) return;
    if (!d.last) {
      el.innerHTML = '<h2 id="today-h">Today</h2><p class="muted" style="margin-top:6px">No counts yet. Once the flag joins Wi-Fi it reports about every 30 minutes.</p>';
      return;
    }
    el.innerHTML = '<h2 id="today-h">Today</h2>' + bigBlock(d);
  }

  function fillRange() {
    var el = $('#d-range');
    if (!el) return;
    el.innerHTML = '<div class="seg" role="group" aria-label="Chart range">' + ['day', 'week', 'month'].map(function (r) {
      return '<button type="button" data-range="' + r + '" aria-pressed="' + (state.range === r) + '">' + r.charAt(0).toUpperCase() + r.slice(1) + '</button>';
    }).join('') + '</div>';
  }

  function fillCharts(d) {
    fillRange();
    var el = $('#d-charts');
    if (!el) return;
    var key = d.id + '|' + state.range, c = state.readings[key], err = state.readErr[key];
    if (!c) {
      if (err) {
        el.innerHTML = '<div class="chart-empty"><p>Couldn\'t load the history. ' + esc(err) + '</p><button type="button" class="btn" data-reload style="margin-top:12px">Try again</button></div>';
      } else {
        el.innerHTML = '<div class="sk sk-chart"></div><div class="sk sk-chart"></div>';
      }
      return;
    }
    var html = err ? '<div class="err-line"><span>Couldn\'t refresh. ' + esc(err) + '</span><button type="button" class="link-btn" data-reload>Try again</button></div>' : '';
    var models = [];
    Object.keys(fields()).forEach(function (f, i) {
      var m;
      try { m = buildChart(f, c.data, prof(d), state.range, i); } catch (e) { m = { html: '<div class="chart-empty">This chart couldn\'t be drawn.</div>' }; }
      models.push(m);
      html += '<div class="chart-block"><div class="chart-head"><h3>' + esc(CHART_TITLES[f] || labelOf(f)) + '</h3><span class="chart-read" id="cr-' + i + '">' + esc(m.latest || '') + '</span></div>' +
        (m.meta ? '<p class="chart-meta">' + m.meta + '</p>' : '') +
        '<div class="chart" data-chart="' + i + '">' + m.html + '</div></div>';
    });
    el.innerHTML = html;
    models.forEach(function (m, i) {
      if (m && m.pts) bindChart($('[data-chart="' + i + '"]', el), m, $('#cr-' + i, el));
    });
  }

  function timeLabel(t, range) {
    var d = new Date(t);
    if (range === 'day') return hm(d);
    if (range === 'week') return DAYS[d.getDay()];
    return d.getDate() + ' ' + MONTHS[d.getMonth()];
  }
  function whenLabel(t, range) {
    var d = new Date(t);
    if (range === 'month') return dayName(d) + (sameDay(d, new Date()) ? ' ' + hm(d) : '');
    return dayName(d) + ' ' + hm(d);
  }

  function smoothPath(ps, top, bottom) {
    var d = 'M' + ps[0][0].toFixed(1) + ' ' + ps[0][1].toFixed(1);
    for (var i = 0; i < ps.length - 1; i++) {
      var p0 = ps[i - 1] || ps[i], p1 = ps[i], p2 = ps[i + 1], p3 = ps[i + 2] || p2;
      var c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = clamp(p1[1] + (p2[1] - p0[1]) / 6, top, bottom);
      var c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = clamp(p2[1] - (p3[1] - p1[1]) / 6, top, bottom);
      d += ' C' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
    }
    return d;
  }

  function buildChart(field, data, p, range, idx) {
    var W = 340, H = 170, PL = 4, PR = 4, PT = 10, PB = 26;
    var raw = data && Array.isArray(data.points) ? data.points : [];
    var pts = [];
    raw.forEach(function (row) {
      if (!Array.isArray(row)) return;
      var t = Date.parse(row[0]);
      if (isNaN(t)) return;
      var v = row[1] && row[1][field];
      pts.push({ t: t, v: num(v) ? v : null });
    });
    pts.sort(function (a, b) { return a.t - b.t; });
    var vals = pts.filter(function (q) { return q.v != null; });
    var title = (CHART_TITLES[field] || labelOf(field)).toLowerCase();
    if (!vals.length) return { html: '<div class="chart-empty">No ' + esc(title) + ' in this period yet.</div>' };

    var gap = (BUCKET_MIN[range] || 60) * 60000 * 2.5;
    var segs = [], cur = [], prevT = null;
    pts.forEach(function (q) {
      if (q.v == null) { if (cur.length) segs.push(cur); cur = []; prevT = null; return; }
      if (prevT != null && q.t - prevT > gap) { if (cur.length) segs.push(cur); cur = []; }
      cur.push(q); prevT = q.t;
    });
    if (cur.length) segs.push(cur);

    var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    if (t1 <= t0) t1 = t0 + 1;
    var lo = Infinity, hi = -Infinity;
    vals.forEach(function (q) { lo = Math.min(lo, q.v); hi = Math.max(hi, q.v); });
    var bmin = p && num(p[field + '_min']) ? p[field + '_min'] : null;
    var bmax = p && num(p[field + '_max']) ? p[field + '_max'] : null;
    var span = (hi - lo) || Math.abs(hi) || 1;
    var ymin = lo, ymax = hi;
    if (bmin != null) ymin = Math.min(ymin, Math.max(bmin, lo - span));
    if (bmax != null) ymax = Math.max(ymax, Math.min(bmax, hi + span));
    if (bmin != null && bmin > ymax) bmin = null;
    if (COUNTERS[field]) ymin = 0;
    if (ymax - ymin < 1e-9) { ymax += 1; ymin -= COUNTERS[field] ? 0 : 1; }
    var padv = (ymax - ymin) * 0.08;
    ymax += padv; if (!COUNTERS[field]) ymin -= padv;

    function X(t) { return PL + (t - t0) / (t1 - t0) * (W - PL - PR); }
    function Y(v) { return PT + (1 - (v - ymin) / (ymax - ymin)) * (H - PT - PB); }
    var base = H - PB;
    var gid = 'g' + idx + '-' + field;

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(CHART_TITLES[field] || labelOf(field)) + ' chart">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c2410c" stop-opacity="0.22"/><stop offset="1" stop-color="#c2410c" stop-opacity="0"/></linearGradient></defs>';
    svg += '<line class="chart-grid" x1="' + PL + '" x2="' + (W - PR) + '" y1="' + base + '" y2="' + base + '"/>';
    if (bmin != null || bmax != null) {
      var by1 = Y(clamp(bmax != null ? bmax : ymax, ymin, ymax)), by2 = Y(clamp(bmin != null ? bmin : ymin, ymin, ymax));
      if (by2 - by1 > 0.5) {
        svg += '<rect class="chart-band" x="' + PL + '" y="' + by1.toFixed(1) + '" width="' + (W - PL - PR) + '" height="' + (by2 - by1).toFixed(1) + '" rx="4"/>';
        if (bmax != null && bmax < ymax) svg += '<line class="chart-band-edge" x1="' + PL + '" x2="' + (W - PR) + '" y1="' + by1.toFixed(1) + '" y2="' + by1.toFixed(1) + '"/>';
        if (bmin != null && bmin > ymin) svg += '<line class="chart-band-edge" x1="' + PL + '" x2="' + (W - PR) + '" y1="' + by2.toFixed(1) + '" y2="' + by2.toFixed(1) + '"/>';
      }
    }
    var model = [];
    segs.forEach(function (seg) {
      var ps = seg.map(function (q) { var m = { t: q.t, v: q.v, x: X(q.t), y: Y(q.v) }; model.push(m); return [m.x, m.y]; });
      if (ps.length === 1) {
        svg += '<circle cx="' + ps[0][0].toFixed(1) + '" cy="' + ps[0][1].toFixed(1) + '" r="3" fill="#c2410c"/>';
        return;
      }
      var line = smoothPath(ps, PT, base);
      svg += '<path d="' + line + ' L' + ps[ps.length - 1][0].toFixed(1) + ' ' + base + ' L' + ps[0][0].toFixed(1) + ' ' + base + 'Z" fill="url(#' + gid + ')"/>';
      svg += '<path class="chart-line" d="' + line + '"/>';
    });
    var tm = t0 + (t1 - t0) / 2;
    svg += '<text class="chart-axis" x="' + PL + '" y="' + (H - 6) + '" text-anchor="start">' + esc(timeLabel(t0, range)) + '</text>';
    svg += '<text class="chart-axis" x="' + (W / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(timeLabel(tm, range)) + '</text>';
    svg += '<text class="chart-axis" x="' + (W - PR) + '" y="' + (H - 6) + '" text-anchor="end">' + esc(timeLabel(t1, range)) + '</text>';
    svg += '<g class="chart-cur" style="display:none"><line x1="0" x2="0" y1="' + PT + '" y2="' + base + '"/><circle cx="0" cy="0" r="5"/></g>';
    svg += '</svg>';

    var last = vals[vals.length - 1];
    var meta;
    if (COUNTERS[field] && range !== 'day') {
      var days = {};
      vals.forEach(function (q) {
        var dd = new Date(q.t), k = dd.getFullYear() + '-' + dd.getMonth() + '-' + dd.getDate();
        if (!days[k] || q.v > days[k].v) days[k] = q;
      });
      var best = null;
      Object.keys(days).forEach(function (k) { if (!best || days[k].v > best.v) best = days[k]; });
      meta = best ? 'Busiest day: ' + esc(dayName(new Date(best.t))) + ', ' + esc(fmtFull(field, best.v)) : '';
    } else if (COUNTERS[field]) {
      meta = 'Counts climb through the day and reset at midnight';
    } else {
      meta = 'Low ' + esc(fmt(field, lo)) + ' · High ' + esc(fmt(field, hi)) + (unitOf(field) ? ' ' + esc(unitOf(field)) : '');
    }
    if ((bmin != null || bmax != null) && p) meta += (meta ? ' · ' : '') + '<span class="band-key">' + esc(p.name || 'Normal') + ' range</span>';

    return {
      html: svg,
      pts: model.sort(function (a, b) { return a.x - b.x; }),
      field: field,
      range: range,
      latest: 'Latest ' + fmtFull(field, last.v),
      meta: meta,
      W: W
    };
  }

  function bindChart(el, m, readEl) {
    if (!el || !m.pts || !m.pts.length) return;
    var svg = $('svg', el), cur = $('.chart-cur', el);
    if (!svg || !cur) return;
    var line = $('line', cur), dot = $('circle', cur);
    function show(ev) {
      var r = svg.getBoundingClientRect();
      if (!r.width) return;
      var x = (ev.clientX - r.left) * m.W / r.width;
      var best = m.pts[0], bd = Infinity;
      for (var i = 0; i < m.pts.length; i++) {
        var dd = Math.abs(m.pts[i].x - x);
        if (dd < bd) { bd = dd; best = m.pts[i]; }
      }
      cur.style.display = '';
      line.setAttribute('x1', best.x); line.setAttribute('x2', best.x);
      dot.setAttribute('cx', best.x); dot.setAttribute('cy', best.y);
      if (readEl) readEl.textContent = fmtFull(m.field, best.v) + ' · ' + whenLabel(best.t, m.range);
    }
    function hide() {
      cur.style.display = 'none';
      if (readEl) readEl.textContent = m.latest || '';
    }
    el.addEventListener('pointerdown', function (ev) { state.scrubbing = true; show(ev); });
    el.addEventListener('pointermove', function (ev) { if (state.scrubbing || ev.pointerType === 'mouse') show(ev); });
    el.addEventListener('pointerup', function () { state.scrubbing = false; });
    el.addEventListener('pointercancel', function () { state.scrubbing = false; hide(); });
    el.addEventListener('pointerleave', function (ev) { if (ev.pointerType === 'mouse') { state.scrubbing = false; hide(); } });
  }

  function goalRange(p) {
    if (num(p.visits_min) && num(p.visits_max)) return fmt('visits', p.visits_min) + '–' + fmt('visits', p.visits_max) + ' visits a day';
    return '';
  }
  function fillGoal(d) {
    var el = $('#d-goal');
    if (!el) return;
    var keys = Object.keys(state.profiles || {}).filter(function (k) { return state.profiles[k] && typeof state.profiles[k] === 'object'; });
    if (!keys.length) { el.hidden = true; return; }
    el.hidden = false;
    var p = prof(d);
    function opt(k, name, sub) {
      var on = (d.profile || '') === k;
      return '<button type="button" class="goal" role="radio" aria-checked="' + on + '" data-goal="' + esc(k) + '"><span class="goal-text"><span class="goal-name">' + esc(name) +
        '</span>' + (sub ? '<span class="goal-range">' + esc(sub) + '</span>' : '') + '</span><span class="goal-check" aria-hidden="true"></span></button>';
    }
    el.innerHTML = '<h2 id="goal-h">A normal day</h2><p class="muted">Pick what a typical day looks like, so the app can tell you when it\'s quieter or busier.</p>' +
      '<div class="goal-list" role="radiogroup" aria-labelledby="goal-h">' +
      keys.map(function (k) { var q = state.profiles[k]; return opt(k, q.name || k, goalRange(q)); }).join('') +
      opt('', 'No comparison', 'Just count') + '</div>' +
      (p && p.notes ? '<p class="notes">' + esc(p.notes) + '</p>' : '') +
      (state.goalErr ? '<p class="form-err" role="alert">' + esc(state.goalErr) + '</p>' : '');
  }
  function setGoal(key) {
    var d = byId(state.id);
    if (!d) return;
    var prev = d.profile || null, next = key || null;
    if (prev === next) return;
    d.profile = next;
    state.goalErr = '';
    updateDevice(false);
    call('setProfile', d.id, next).then(function (dev) {
      if (dev && dev.id) replaceDevice(dev);
      render(true);
    }).catch(function (err) {
      var cd = byId(d.id);
      if (cd) cd.profile = prev;
      state.goalErr = "Couldn't save that. " + msg(err);
      render(false);
    });
  }

  function healthChip(h) {
    return { good: { cls: 'ok', text: 'Looks good' }, watch: { cls: 'warn', text: 'Worth a look' }, bad: { cls: 'bad', text: 'Needs fixing' } }[h] || { cls: 'off', text: 'Checked' };
  }
  function safeImg(src, alt) {
    return typeof src === 'string' && /^(data:image\/|blob:)/.test(src) ? '<img src="' + esc(src) + '" alt="' + esc(alt) + '">' : '';
  }
  function fillPhoto(d) {
    var el = $('#d-photo');
    if (!el) return;
    var list = state.photos[d.id] || [], fresh = state.photoNew[d.id];
    var latest = fresh || list[0];
    var html = '<h2 id="photo-h">Photo check</h2><p class="muted">Snap your desk buddy and get a quick check of the flag, the screen and the wiring.</p>';
    if (latest) {
      var hc = healthChip(latest.health);
      html += '<div class="photo-latest">' + safeImg(latest.image, 'Latest photo of ' + (d.name || 'the flag')) +
        '<div class="photo-meta"><span class="chip ' + hc.cls + '">' + hc.text + '</span><span class="photo-time">' + esc(ago(latest.t)) + '</span></div>' +
        (latest.summary ? '<p>' + esc(latest.summary) + '</p>' : '');
      if (fresh && fresh === latest) {
        if (Array.isArray(fresh.issues) && fresh.issues.length) html += '<p class="photo-list-title">What it spotted</p><ul class="photo-list">' + fresh.issues.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
        if (Array.isArray(fresh.advice) && fresh.advice.length) html += '<p class="photo-list-title">What to try</p><ul class="photo-list">' + fresh.advice.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
      }
      html += '</div>';
      var older = list.filter(function (x) { return x !== latest && x.id !== latest.id; }).slice(0, 8)
        .map(function (x) { return safeImg(x.image, 'Photo from ' + ago(x.t)); }).filter(Boolean);
      if (older.length) html += '<div class="photo-older">' + older.join('') + '</div>';
    } else if (state.photos[d.id]) {
      html += '<p style="margin-bottom:16px">No photo checks yet.</p>';
    }
    html += '<button type="button" class="btn primary wide" data-photo' + (state.photoBusy ? ' disabled' : '') + '>' + CAMERA_SVG + '<span>' + (state.photoBusy ? 'Checking…' : 'Check with a photo') + '</span></button>';
    if (state.photoErr) html += '<p class="form-err" role="alert">' + esc(state.photoErr) + '</p>';
    el.innerHTML = html;
  }
  function takePhoto() {
    var id = state.id;
    if (!id || state.photoBusy) return;
    state.photoBusy = true;
    state.photoErr = '';
    var d = byId(id); if (d) fillPhoto(d);
    call('photo', id).then(function (res) {
      if (res && typeof res === 'object') {
        state.photoNew[id] = res;
        var list = (state.photos[id] || []).filter(function (x) { return x && x.id !== res.id; });
        state.photos[id] = [res].concat(list);
      }
    }).catch(function (err) {
      if (!isCancel(err)) state.photoErr = msg(err);
    }).then(function () {
      state.photoBusy = false;
      if (state.id === id) { var nd = byId(id); if (nd) fillPhoto(nd); }
    });
  }

  function fillInfo(d) {
    var el = $('#d-info');
    if (!el) return;
    var r = reading(d);
    var created = d.created ? new Date(d.created) : null;
    var rows = [
      ['Wi-Fi', num(r.rssi) ? fmtFull('rssi', r.rssi) : 'Not reported yet'],
      ['Power', num(d.battery) ? 'Battery ' + batteryPct(d.battery) + '%' : 'USB-C, always on'],
      ['Last report', d.last ? ago(d.last.t) : 'Not yet'],
      ['Firmware', d.fw || 'Not reported'],
      ['Added', created && !isNaN(created) ? created.getDate() + ' ' + MONTHS[created.getMonth()] + ' ' + created.getFullYear() : '–']
    ];
    el.innerHTML = '<h2 id="info-h">About this flag</h2><dl class="facts">' + rows.map(function (x) {
      return '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>';
    }).join('') + '</dl><button type="button" class="btn wide" data-alerts>' + BELL_SVG + '<span>Notifications</span></button>' +
      (state.alertsNote ? '<p class="muted" style="margin-top:8px" role="status">' + esc(state.alertsNote) + '</p>' : '');
  }

  /* ---------- actions ---------- */

  function doWave(id, btn) {
    if (btn) {
      btn.classList.remove('waving'); void btn.offsetWidth; btn.classList.add('waving');
      setTimeout(function () { btn.classList.remove('waving'); }, 1400);
    }
    sendControl(id, { wave: true });
  }
  function addDevice() {
    call('addDevice').then(function (dev) {
      if (dev && dev.id) replaceDevice(dev);
      render(true);
      loadDevices();
    }).catch(function (err) {
      if (isCancel(err)) return;
      state.error = msg(err);
      render(true);
    });
  }
  function doRename() {
    var d = byId(state.id), inp = $('#rename-in');
    if (!d || !inp) return;
    var name = inp.value.trim();
    if (!name) { state.renameErr = 'Give your flag a name.'; state.renaming = true; $('#d-head').innerHTML = ''; fillHead(d); return; }
    if (name === d.name) { state.renaming = false; fillHead(d); return; }
    var prev = d.name;
    d.name = name;
    state.renaming = false;
    state.renameErr = '';
    fillHead(d);
    call('rename', d.id, name).then(function (dev) {
      if (dev && dev.id) replaceDevice(dev);
      render(true);
    }).catch(function (err) {
      var cd = byId(d.id);
      if (cd) cd.name = prev;
      state.renaming = true;
      state.renameErr = "Couldn't rename. " + msg(err);
      $('#d-head').innerHTML = '';
      if (cd) fillHead(cd);
    });
  }
  function openAlerts() {
    call('alerts').then(function (res) {
      state.alertsNote = res && res.on ? "Notifications are on. You'll hear about it if your flag goes offline or loses Wi-Fi." : 'Notifications are off.';
    }).catch(function (err) {
      state.alertsNote = isCancel(err) ? state.alertsNote : msg(err);
    }).then(function () {
      var d = byId(state.id); if (d) fillInfo(d);
    });
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!t || t.disabled) return;
    var ds = t.dataset;
    if (ds.open !== undefined) openDevice(ds.open);
    else if (ds.back !== undefined) goHome();
    else if (ds.wave !== undefined) doWave(ds.wave, t);
    else if (ds.mode !== undefined) {
      var d = byId(ds.dev);
      if (!d || vals(d).mode === ds.mode) return;
      sendControl(ds.dev, { mode: ds.mode });
      refreshControlsUI(ds.dev);
    }
    else if (ds.angle !== undefined) { if (state.id) setAngle(state.id, Number(ds.angle)); }
    else if (ds.range !== undefined) {
      if (state.range === ds.range) return;
      state.range = ds.range;
      var cd = byId(state.id);
      if (cd) fillCharts(cd);
      loadReadings(state.id, state.range);
    }
    else if (ds.reload !== undefined) loadReadings(state.id, state.range, true);
    else if (ds.add !== undefined) addDevice();
    else if (ds.retry !== undefined) loadDevices();
    else if (ds.rename !== undefined) { state.renaming = true; state.renameErr = ''; var rd = byId(state.id); if (rd) fillHead(rd); }
    else if (ds.cancelRename !== undefined) { state.renaming = false; state.renameErr = ''; var cr = byId(state.id); if (cr) fillHead(cr); }
    else if (ds.goal !== undefined) setGoal(ds.goal);
    else if (ds.photo !== undefined) takePhoto();
    else if (ds.alerts !== undefined) openAlerts();
  });
  document.addEventListener('submit', function (e) {
    e.preventDefault();
    if (e.target && e.target.id === 'rename-form') doRename();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.renaming) { state.renaming = false; var d = byId(state.id); if (d) fillHead(d); }
  });
  function endDrag() { state.dragging = false; }
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);

  /* ---------- start ---------- */

  function onReading(e) {
    if (!e) return;
    var id = e.device && typeof e.device === 'object' ? e.device.id : e.device;
    if (e.device && typeof e.device === 'object' && e.device.id) replaceDevice(e.device);
    var d = byId(id);
    if (d && e.r && typeof e.r === 'object') d.last = { t: e.t || new Date().toISOString(), r: e.r };
    render(true);
    if (state.view === 'device' && state.id === id) {
      ['day', 'week', 'month'].forEach(function (r) { if (state.readings[id + '|' + r]) state.readings[id + '|' + r].at = 0; });
      if (!state.scrubbing) loadReadings(id, state.range, true);
    }
    scheduleRefresh();
  }

  function start() {
    if (B && typeof B.on === 'function') {
      try {
        B.on('reading', function (e) { try { onReading(e); } catch (err) {} });
        B.on('devices', function () { loadDevices(); });
      } catch (e) {}
    }
    call('app').then(function (a) {
      if (a && typeof a === 'object') {
        state.app = {
          fields: a.fields && Object.keys(a.fields).length ? a.fields : DEFAULT_FIELDS,
          controls: a.controls && typeof a.controls === 'object' ? a.controls : {}
        };
      }
    }).catch(function () {}).then(function () { if (state.loaded) render(false); });
    call('profiles').then(function (p) {
      if (p && typeof p === 'object') state.profiles = p;
    }).catch(function () {}).then(function () { if (state.loaded) render(true); });
    loadDevices();
    setInterval(function () { if (state.loaded && !state.dragging && !state.renaming) render(true); }, 30000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

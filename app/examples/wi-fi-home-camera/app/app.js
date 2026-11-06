(function () {
  'use strict';

  var sdk = window.buildery || null;
  var THEME = '#3a5ba0';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var RANGES = {
    day: { label: 'Day', span: 864e5, gap: 75 * 6e4, words: 'day' },
    week: { label: 'Week', span: 7 * 864e5, gap: 2.5 * 36e5, words: 'week' },
    month: { label: 'Month', span: 30 * 864e5, gap: 10 * 36e5, words: 'month' }
  };
  var ORDER = { alert: 0, watch: 1, offline: 2, ok: 3 };

  var S = {
    devices: [], loaded: false, err: '', busy: null,
    profiles: {}, app: {},
    view: 'home', id: null, range: 'day', homeScroll: 0,
    readings: {}, rErr: {}, rLoading: {},
    photos: {}, pErr: {}, pLoading: {}, lastCheck: {}, photoBusy: false, photoMsg: {},
    cmd: {}, renaming: false, renameErr: '', renameBusy: false,
    profileBusy: false, profileErr: '', alertsMsg: '', dragging: false,
    profKey: ''
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function msg(e) { return (e && e.message) || 'Something went wrong. Try again.'; }
  function isCancel(e) { return /cancel/i.test((e && e.message) || ''); }
  function call(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    try {
      if (!sdk || typeof sdk[name] !== 'function') return Promise.reject(new Error("The app couldn't reach the camera service."));
      return Promise.resolve(sdk[name].apply(sdk, args));
    } catch (e) { return Promise.reject(e); }
  }
  function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function dayTime(t) {
    var d = new Date(t), now = new Date();
    var day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (t >= day0) return 'Today ' + hm(d);
    if (t >= day0 - 864e5) return 'Yesterday ' + hm(d);
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()] + ' ' + hm(d);
  }
  function ago(iso) {
    var t = typeof iso === 'number' ? iso : Date.parse(iso);
    if (!isFinite(t)) return 'Never';
    var s = (Date.now() - t) / 1000;
    if (s < 60) return 'Just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 6 * 3600) return Math.floor(s / 3600) + ' h ago';
    return dayTime(t);
  }
  function lower(s) { return s.charAt(0).toLowerCase() + s.slice(1); }
  function fmtUptime(m) {
    if (!num(m)) return '–';
    m = Math.max(0, Math.round(m));
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' h ' + (m % 60) + ' min';
    var d = Math.floor(h / 24);
    return d + ' d ' + (h % 24) + ' h';
  }
  function fmtRssi(v) { return num(v) ? Math.round(v) + ' dBm' : '–'; }
  function fmtStream(v) { return num(v) ? (v >= 0.5 ? 'Live' : 'Down') : '–'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function dev(id) {
    id = id || S.id;
    for (var i = 0; i < S.devices.length; i++) if (S.devices[i].id === id) return S.devices[i];
    return null;
  }
  function reading(d) { return (d && d.last && d.last.r) || {}; }
  function profileOf(d) {
    var p = d && d.profile && S.profiles[d.profile];
    return p && typeof p === 'object' ? p : null;
  }
  function band(d) {
    var p = profileOf(d) || {};
    return { min: num(p.rssi_min) ? p.rssi_min : -70, max: num(p.rssi_max) ? p.rssi_max : -30 };
  }
  function statusInfo(d) {
    switch (d.status) {
      case 'alert': return { label: 'Needs attention', cls: 'red' };
      case 'watch': return { label: 'Check soon', cls: 'amber' };
      case 'offline': return d.last ? { label: 'Offline', cls: 'grey' } : { label: 'Not set up yet', cls: 'grey' };
      default: return { label: 'All good', cls: 'green' };
    }
  }
  function signalInfo(v) {
    if (!num(v)) return { label: 'No signal data', bars: 0, cls: 'grey' };
    if (v >= -55) return { label: 'Excellent signal', bars: 4, cls: 'green' };
    if (v >= -67) return { label: 'Good signal', bars: 3, cls: 'green' };
    if (v >= -75) return { label: 'Fair signal', bars: 2, cls: 'amber' };
    if (v >= -85) return { label: 'Weak signal', bars: 1, cls: 'red' };
    return { label: 'Very weak signal', bars: 1, cls: 'red' };
  }
  function controls() {
    var c = S.app && S.app.controls;
    var out = [];
    if (c && typeof c === 'object') {
      Object.keys(c).forEach(function (k) {
        var x = c[k];
        if (x && (x.type === 'toggle' || x.type === 'button')) out.push({ key: k, type: x.type, label: x.label || k });
      });
    }
    return out;
  }
  function ctlValue(d, key) {
    var c = S.cmd[d.id];
    if (c && c.values && key in c.values) return c.values[key];
    var set = d.control && d.control.set;
    return set && key in set ? set[key] : false;
  }

  // ---------- icons ----------
  var ICON = {
    chev: '<svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><path d="M2 2l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    back: '<svg width="12" height="20" viewBox="0 0 12 20" aria-hidden="true"><path d="M10 2L2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pencil: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    camera: '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3l2-2.5h6L17 7h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    bell: '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0112 0v5l2 2H4l2-2zM10 20a2 2 0 004 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    plus: '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    empty: '<svg viewBox="0 0 88 88" aria-hidden="true"><circle cx="44" cy="44" r="44" fill="#e7ecf6"/><rect x="31" y="16" width="26" height="56" rx="13" fill="#fff" stroke="' + THEME + '" stroke-width="3"/><circle cx="44" cy="33" r="8" fill="' + THEME + '"/><circle cx="44" cy="33" r="3" fill="#fff"/><circle cx="44" cy="54" r="2.5" fill="' + THEME + '"/></svg>'
  };
  function barsSVG(n, cls) {
    var h = [10, 17, 24, 32], out = '';
    for (var i = 0; i < 4; i++) {
      out += '<rect x="' + (i * 12 + 1) + '" y="' + (36 - h[i]) + '" width="8" height="' + h[i] + '" rx="2" fill="' + (i < n ? 'currentColor' : '#dedbd3') + '"/>';
    }
    return '<svg class="bars ' + cls + '" viewBox="0 0 48 38" aria-hidden="true">' + out + '</svg>';
  }

  // ---------- home ----------
  function sorted() {
    return S.devices.slice().sort(function (a, b) {
      var oa = a.status in ORDER ? ORDER[a.status] : 3, ob = b.status in ORDER ? ORDER[b.status] : 3;
      if (oa !== ob) return oa - ob;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  function summaryText() {
    var c = { ok: 0, watch: 0, alert: 0, offline: 0 };
    S.devices.forEach(function (d) { c[d.status in c ? d.status : 'ok']++; });
    var n = S.devices.length;
    if (!n) return '';
    if (c.ok === n) return n === 1 ? 'Your camera is online and all good' : 'All ' + n + ' cameras are online and all good';
    var parts = [];
    var need = c.alert + c.watch;
    if (need) parts.push([need, 'needs a look', 'need a look']);
    if (c.offline) parts.push([c.offline, 'is offline', 'are offline']);
    if (c.ok) parts.push([c.ok, 'is all good', 'are all good']);
    return parts.map(function (p, i) {
      var verb = p[0] === 1 ? p[1] : p[2];
      return i === 0 ? plural(p[0], 'camera', 'cameras') + ' ' + verb : p[0] + ' ' + verb;
    }).join(', ');
  }

  function meterHTML(d) {
    var v = reading(d).rssi;
    if (!num(v)) return '';
    var b = band(d);
    var lo = -95, span = 65;
    var a = clamp((b.min - lo) / span * 100, 0, 100), z = clamp((b.max - lo) / span * 100, 0, 100);
    var p = clamp((v - lo) / span * 100, 0, 100);
    return '<span class="meter" aria-hidden="true"><span class="meter-band" style="left:' + a + '%;width:' + Math.max(0, z - a) + '%"></span>' +
      '<span class="meter-dot" style="left:' + p + '%"></span></span>' +
      '<span class="meter-labels" aria-hidden="true"><span>Weak</span><span>Good range for this spot</span><span>Strong</span></span>';
  }

  function heroHTML(d) {
    var r = reading(d);
    if (!d.last) return '<span class="waiting">Waiting for its first check-in. Plug the camera in near your Wi-Fi router and give it a minute.</span>';
    if (d.status === 'offline') {
      return '<span class="hero">' + barsSVG(0, 'grey') + '<span><span class="big">Offline</span>' +
        '<span class="sub">Last seen <span data-ago="' + esc(d.last.t) + '" data-lower="1">' + esc(lower(ago(d.last.t))) + '</span></span></span></span>';
    }
    var sig = signalInfo(r.rssi);
    return '<span class="hero">' + barsSVG(sig.bars, sig.cls) + '<span><span class="big">' + esc(sig.label) + '</span>' +
      '<span class="sub">Wi-Fi ' + esc(fmtRssi(r.rssi)) + '</span></span></span>' + meterHTML(d);
  }

  function statsHTML(d) {
    var r = reading(d);
    return '<span class="stats">' +
      '<span class="stat"><b>' + esc(fmtStream(r.online)) + '</b><span>Video stream</span></span>' +
      '<span class="stat"><b>' + esc(fmtUptime(r.uptime_min)) + '</b><span>Running for</span></span>' +
      '<span class="stat"><b data-ago="' + esc(d.last ? d.last.t : '') + '">' + esc(d.last ? ago(d.last.t) : 'Never') + '</b><span>Updated</span></span>' +
      '</span>';
  }

  function reasonsHTML(d) {
    var a = Array.isArray(d.alerts) ? d.alerts : [];
    if (!a.length) return '';
    return '<span class="reasons">' + a.slice(0, 3).map(function (x) {
      return '<span class="reason ' + (x && x.severity === 'high' ? 'red' : 'amber') + '">' + esc(x && x.message) + '</span>';
    }).join('') + '</span>';
  }

  function ctlMsg(d) {
    var c = S.cmd[d.id];
    if (c && c.err) return { t: c.err, cls: 'err' };
    if (c && c.sending) return { t: 'Sending…', cls: '' };
    var ctl = d.control;
    if (!ctl || !c || !c.sent) return null;
    if (ctl.delivered) return { t: 'Camera updated', cls: 'ok' };
    return { t: 'Sent. Waiting for the camera… ' + (ctl.polled ? 'It last checked in ' + lower(ago(ctl.polled)) + '.' : "It hasn't checked in yet."), cls: '' };
  }

  function controlsHTML(d) {
    var list = controls();
    if (!list.length) return '';
    var m = ctlMsg(d);
    return '<div class="ctls">' + list.map(function (c) {
      if (c.type === 'toggle') {
        var on = ctlValue(d, c.key) === true;
        return '<div class="ctl-row"><div><span class="ctl-label">' + esc(c.label) + '</span><span class="ctl-state">' + (on ? 'On' : 'Off') + '</span></div>' +
          '<button class="switch" role="switch" aria-checked="' + on + '" aria-label="' + esc(c.label) + '" data-act="toggle" data-id="' + esc(d.id) + '" data-key="' + esc(c.key) + '"></button></div>';
      }
      return '<div class="ctl-row"><span class="ctl-label">' + esc(c.label) + '</span><button class="pill" data-act="press" data-id="' + esc(d.id) + '" data-key="' + esc(c.key) + '">' + esc(c.label) + '</button></div>';
    }).join('') + (m ? '<p class="ctl-msg ' + m.cls + '" role="status">' + esc(m.t) + '</p>' : '') + '</div>';
  }

  function cardHTML(d) {
    var st = statusInfo(d), p = profileOf(d);
    return '<article class="card">' +
      '<button class="card-open" data-act="open" data-id="' + esc(d.id) + '" aria-label="Open ' + esc(d.name || 'camera') + '">' +
      '<span class="card-top"><span class="names"><h2>' + esc(d.name || 'Camera') + '</h2><span class="kind">' + esc(p ? p.name : 'Home camera') + '</span></span>' +
      '<span class="chip ' + st.cls + '">' + esc(st.label) + '</span><span class="chev">' + ICON.chev + '</span></span>' +
      reasonsHTML(d) + heroHTML(d) + (d.last ? statsHTML(d) : '') +
      '</button>' + (d.last ? controlsHTML(d) : '') + '</article>';
  }

  function renderHome() {
    var list = $('#list'), sum = $('#summary'), hm = $('#home-msg');
    if (!S.loaded) {
      sum.textContent = '';
      if (S.err) {
        list.innerHTML = '<div class="card empty"><h2>Couldn\'t load your cameras</h2><p>' + esc(S.err) + '</p><button class="btn big-btn" data-act="retry">Try again</button></div>';
      } else {
        list.innerHTML = '<div class="card"><div class="skel skel-card"></div></div><div class="card"><div class="skel skel-card"></div></div>';
      }
      hm.innerHTML = '';
      return;
    }
    hm.innerHTML = S.err ? '<div class="inline-msg" role="status"><span>Couldn\'t refresh. ' + esc(S.err) + '</span><button class="btn" data-act="retry">Try again</button></div>' : '';
    if (!S.devices.length) {
      sum.textContent = '';
      list.innerHTML = '<div class="card empty">' + ICON.empty + '<h2>No cameras yet</h2><p>Plug in your camera, then add it here to see if it\'s online, how strong its Wi-Fi is and how long it\'s been running.</p>' +
        '<button class="btn big-btn wide" data-act="add">' + ICON.plus + 'Add your first camera</button></div>';
      return;
    }
    sum.textContent = summaryText();
    list.innerHTML = sorted().map(function (d) {
      try { return cardHTML(d); } catch (e) { return ''; }
    }).join('') + '<button class="btn ghost wide add-more" data-act="add">' + ICON.plus + 'Add another camera</button>';
  }

  // ---------- device screen ----------
  function renderHead() {
    var d = dev(), el = $('#d-head');
    if (!d) return;
    var st = statusInfo(d), p = profileOf(d);
    if (S.renaming) {
      el.innerHTML = '<form class="rename" data-form="rename"><label class="sr" for="rn" hidden>Camera name</label>' +
        '<input id="rn" name="name" maxlength="40" autocomplete="off" value="' + esc(d.name || '') + '" aria-label="Camera name">' +
        '<button class="btn" type="submit"' + (S.renameBusy ? ' disabled' : '') + '>' + (S.renameBusy ? 'Saving…' : 'Save') + '</button>' +
        '<button class="btn ghost" type="button" data-act="rename-cancel">Cancel</button></form>' +
        (S.renameErr ? '<p class="field-err" role="alert">' + esc(S.renameErr) + '</p>' : '');
      return;
    }
    el.innerHTML = '<h1><button class="name-btn" data-act="rename" aria-label="Rename ' + esc(d.name || 'camera') + '">' + esc(d.name || 'Camera') + ICON.pencil + '</button></h1>' +
      '<div class="head-meta"><span class="chip ' + st.cls + '">' + esc(st.label) + '</span><span>' + esc(p ? p.name : 'No spot chosen yet') + '</span></div>' +
      reasonsHTML(d).replace('<span class="reasons">', '<span class="reasons" style="display:flex">');
  }

  function renderHero() {
    var d = dev(), el = $('#d-hero');
    if (!d) return;
    el.innerHTML = '<h2>Connection</h2>' + heroHTML(d).replace('class="hero"', 'class="hero" style="display:flex"') + (d.last ? statsHTML(d) : '') + (d.last ? controlsHTML(d) : '');
  }

  function renderProfile() {
    var d = dev(), el = $('#d-profile');
    if (!d) return;
    var p = profileOf(d);
    S.profKey = d.id + '|' + (d.profile || '');
    var keys = Object.keys(S.profiles).filter(function (k) { return S.profiles[k] && S.profiles[k].name; })
      .sort(function (a, b) { return String(S.profiles[a].name).localeCompare(String(S.profiles[b].name)); });
    var opts = '<option value="">Not chosen</option>' + keys.map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === d.profile ? ' selected' : '') + '>' + esc(S.profiles[k].name) + '</option>';
    }).join('');
    var b = band(d);
    el.innerHTML = '<div class="card-title-row"><h2><label for="prof">Where it\'s mounted</label></h2>' + (S.profileBusy ? '<span class="muted">Saving…</span>' : '') + '</div>' +
      '<select id="prof" data-act="profile"' + (S.profileBusy ? ' disabled' : '') + '>' + opts + '</select>' +
      (S.profileErr ? '<p class="field-err" role="alert">' + esc(S.profileErr) + '</p>' : '') +
      (p ? '<div class="notes"><b>Tips for this spot</b>' + esc(p.notes || '') + ' You\'ll hear from us if the signal stays below ' + b.min + ' dBm.</div>'
         : '<p class="muted" style="margin-top:10px">Pick a spot to get placement tips and the right Wi-Fi alert for it.</p>');
  }

  function renderInfo() {
    var d = dev(), el = $('#d-info');
    if (!d) return;
    var power = num(d.battery) ? Math.round(clamp((d.battery - 3.3) / 0.9, 0, 1) * 100) + '% battery' : 'USB power';
    var created = Date.parse(d.created);
    el.innerHTML = '<h2>About this camera</h2><dl class="rows">' +
      '<div class="row"><dt>Power</dt><dd>' + esc(power) + '</dd></div>' +
      '<div class="row"><dt>Last check-in</dt><dd data-ago="' + esc(d.last ? d.last.t : '') + '">' + esc(d.last ? ago(d.last.t) : 'Never') + '</dd></div>' +
      (d.fw ? '<div class="row"><dt>Firmware</dt><dd>' + esc(d.fw) + '</dd></div>' : '') +
      (isFinite(created) ? '<div class="row"><dt>Added</dt><dd>' + esc(new Date(created).getDate() + ' ' + MON[new Date(created).getMonth()] + ' ' + new Date(created).getFullYear()) + '</dd></div>' : '') +
      '</dl><div class="info-actions"><button class="btn ghost wide" data-act="alerts">' + ICON.bell + 'Notifications</button>' +
      (S.alertsMsg ? '<p class="muted" role="status" style="margin-top:8px;text-align:center">' + esc(S.alertsMsg) + '</p>' : '') + '</div>';
  }

  function renderRange() {
    $('#d-range').innerHTML = Object.keys(RANGES).map(function (k) {
      return '<button data-act="range" data-range="' + k + '" aria-pressed="' + (S.range === k) + '">' + RANGES[k].label + '</button>';
    }).join('');
  }

  // ---------- photos ----------
  var HEALTH = { good: ['Looks good', 'green'], watch: ['Worth a look', 'amber'], bad: ['Problem spotted', 'red'] };

  function loadPhotos(id) {
    if (S.pLoading[id]) return;
    S.pLoading[id] = true; S.pErr[id] = '';
    call('photos', id).then(function (l) { S.photos[id] = Array.isArray(l) ? l.filter(Boolean) : []; })
      .catch(function (e) { S.pErr[id] = msg(e); })
      .then(function () { S.pLoading[id] = false; if (S.view === 'device' && S.id === id) renderPhotos(); });
  }

  function renderPhotos() {
    var id = S.id, el = $('#d-photo');
    var list = S.photos[id];
    var head = '<h2>Placement check</h2>';
    var btn = '<div class="photo-actions"><button class="btn wide" data-act="photo"' + (S.photoBusy ? ' disabled' : '') + '>' + ICON.camera + (S.photoBusy ? 'Checking…' : 'Check with a photo') + '</button>' +
      (S.photoMsg[id] ? '<p class="field-err" role="alert">' + esc(S.photoMsg[id]) + '</p>' : '') + '</div>';
    if (!list) {
      if (S.pErr[id]) {
        el.innerHTML = head + '<div class="inline-msg" style="margin-top:12px"><span>Couldn\'t load photo checks. ' + esc(S.pErr[id]) + '</span><button class="btn" data-act="retry-photos">Try again</button></div>' + btn;
      } else {
        el.innerHTML = head + '<div class="skel skel-chart"></div>' + btn;
        loadPhotos(id);
      }
      return;
    }
    var latest = list[0];
    var fresh = S.lastCheck[id];
    if (fresh && latest && fresh.id === latest.id) latest = fresh;
    var body;
    if (!latest) {
      body = '<p class="muted" style="margin-top:8px">Take a photo of the camera where it\'s mounted. We\'ll check it has a clear view, isn\'t facing a bright window and that the cable is safely tucked away.</p>';
    } else {
      var h = HEALTH[latest.health] || ['Checked', 'grey'];
      var t = Date.parse(latest.t);
      body = '<div class="photo">' + (latest.image ? '<img src="' + esc(latest.image) + '" alt="Your latest photo of the camera">' : '') +
        '<div class="photo-meta"><span class="chip ' + h[1] + '">' + h[0] + '</span><span class="photo-time">' + esc(isFinite(t) ? ago(t) : '') + '</span></div>' +
        (latest.summary ? '<p>' + esc(latest.summary) + '</p>' : '') +
        (Array.isArray(latest.issues) && latest.issues.length ? '<h3>What we noticed</h3><ul>' + latest.issues.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
        (Array.isArray(latest.advice) && latest.advice.length ? '<h3>What to try</h3><ul>' + latest.advice.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
        '</div>';
      var older = list.slice(1, 8);
      if (older.length) {
        body += '<div class="history" aria-label="Earlier checks">' + older.map(function (o) {
          var oh = HEALTH[o.health] || ['Checked', 'grey'];
          var ot = Date.parse(o.t), od = new Date(ot);
          return '<figure>' + (o.image ? '<img src="' + esc(o.image) + '" alt="">' : '<span class="noimg"></span>') +
            '<figcaption>' + (isFinite(ot) ? od.getDate() + ' ' + MON[od.getMonth()] : '') + ' · ' + oh[0] + '</figcaption></figure>';
        }).join('') + '</div>';
      }
    }
    el.innerHTML = head + body + btn;
  }

  function takePhoto() {
    var id = S.id;
    if (S.photoBusy) return;
    S.photoBusy = true; S.photoMsg[id] = '';
    renderPhotos();
    call('photo', id).then(function (r) {
      if (r && typeof r === 'object') {
        S.lastCheck[id] = r;
        S.photos[id] = [r].concat((S.photos[id] || []).filter(function (p) { return p && p.id !== r.id; }));
      }
    }).catch(function (e) {
      if (!isCancel(e)) S.photoMsg[id] = msg(e);
    }).then(function () {
      S.photoBusy = false;
      if (S.view === 'device' && S.id === id) renderPhotos();
    });
  }

  // ---------- charts ----------
  function loadReadings() {
    var id = S.id, range = S.range, key = id + '|' + range;
    if (S.rLoading[key]) return;
    S.rLoading[key] = true;
    call('readings', id, range).then(function (res) {
      S.readings[key] = res && Array.isArray(res.points) ? res : { points: [] };
      S.rErr[key] = '';
    }).catch(function (e) { S.rErr[key] = msg(e); })
      .then(function () {
        S.rLoading[key] = false;
        if (S.view === 'device' && S.id === id && S.range === range && !S.dragging) renderCharts();
      });
  }

  function series(points, field) {
    var out = [];
    points.forEach(function (p) {
      if (!Array.isArray(p)) return;
      var t = Date.parse(p[0]), v = p[1] && p[1][field];
      if (isFinite(t) && num(v)) out.push([t, v]);
    });
    out.sort(function (a, b) { return a[0] - b[0]; });
    return out;
  }

  function timeLabel(t) {
    var d = new Date(t);
    if (S.range === 'day') return hm(d);
    if (S.range === 'week') return DAYS[d.getDay()] + ' ' + d.getDate();
    return d.getDate() + ' ' + MON[d.getMonth()];
  }

  function smoothPath(P, top, bottom) {
    if (P.length === 1) return 'M' + (P[0][0] - 1.5) + ',' + P[0][1] + 'L' + (P[0][0] + 1.5) + ',' + P[0][1];
    var d = 'M' + P[0][0].toFixed(1) + ',' + P[0][1].toFixed(1);
    for (var i = 0; i < P.length - 1; i++) {
      var p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
      var c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = clamp(p1[1] + (p2[1] - p0[1]) / 6, top, bottom);
      var c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = clamp(p2[1] - (p3[1] - p1[1]) / 6, top, bottom);
      d += 'C' + c1x.toFixed(1) + ',' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ',' + c2y.toFixed(1) + ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1);
    }
    return d;
  }

  function mountChart(box, sub, data, o) {
    var W = Math.max(260, Math.round(box.clientWidth || 320)), H = 160;
    var pl = 2, pr = 2, pt = 10, pb = 24, iw = W - pl - pr, ih = H - pt - pb;
    var x = function (t) { return pl + (t - o.t0) / (o.t1 - o.t0) * iw; };
    var y = function (v) { return pt + (1 - (v - o.lo) / (o.hi - o.lo)) * ih; };
    var segs = [], cur = [];
    data.forEach(function (p) {
      if (cur.length && p[0] - cur[cur.length - 1][0] > o.gap) { segs.push(cur); cur = []; }
      cur.push(p);
    });
    if (cur.length) segs.push(cur);
    var line = '', area = '', base = pt + ih;
    segs.forEach(function (s) {
      var P = s.map(function (p) { return [x(p[0]), y(p[1])]; });
      var d = smoothPath(P, pt, base);
      line += d;
      if (P.length > 1) area += d + 'L' + P[P.length - 1][0].toFixed(1) + ',' + base + 'L' + P[0][0].toFixed(1) + ',' + base + 'Z';
    });
    var gid = 'g' + o.id;
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.aria) + '">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + THEME + '" stop-opacity=".22"/><stop offset="1" stop-color="' + THEME + '" stop-opacity="0"/></linearGradient></defs>';
    if (o.band) {
      var b0 = clamp(y(o.band[1]), pt, base), b1 = clamp(y(o.band[0]), pt, base);
      if (b1 > b0) svg += '<rect x="' + pl + '" y="' + b0.toFixed(1) + '" width="' + iw + '" height="' + (b1 - b0).toFixed(1) + '" fill="#2e9b55" fill-opacity=".1"/>' +
        '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + b1.toFixed(1) + '" y2="' + b1.toFixed(1) + '" stroke="#2e9b55" stroke-opacity=".45" stroke-dasharray="4 4"/>';
    }
    svg += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + base + '" y2="' + base + '" stroke="#e6e3dc"/>';
    svg += '<path d="' + area + '" fill="url(#' + gid + ')"/>';
    svg += '<path d="' + line + '" fill="none" stroke="' + THEME + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';
    var mid = (o.t0 + o.t1) / 2;
    svg += '<text x="' + pl + '" y="' + (H - 6) + '" font-size="12" fill="#6b6b70">' + esc(timeLabel(o.t0)) + '</text>' +
      '<text x="' + (W / 2) + '" y="' + (H - 6) + '" font-size="12" fill="#6b6b70" text-anchor="middle">' + esc(timeLabel(mid)) + '</text>' +
      '<text x="' + (W - pr) + '" y="' + (H - 6) + '" font-size="12" fill="#6b6b70" text-anchor="end">Now</text>';
    svg += '<line class="cursor" x1="0" x2="0" y1="' + pt + '" y2="' + base + '" stroke="#8d8a83" stroke-width="1" opacity="0"/>' +
      '<circle class="cdot" r="5" cx="0" cy="0" fill="' + THEME + '" stroke="#fff" stroke-width="2" opacity="0"/>';
    svg += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="transparent"/></svg>';
    box.innerHTML = svg;

    var el = box.querySelector('svg'), cl = el.querySelector('.cursor'), dot = el.querySelector('.cdot');
    var def = sub.innerHTML, timer = null;
    function show(e) {
      var r = el.getBoundingClientRect();
      if (!r.width) return;
      var mx = (e.clientX - r.left) * (W / r.width), bi = 0, bd = Infinity;
      for (var i = 0; i < data.length; i++) {
        var dd = Math.abs(x(data[i][0]) - mx);
        if (dd < bd) { bd = dd; bi = i; }
      }
      var p = data[bi], cx = x(p[0]).toFixed(1);
      cl.setAttribute('x1', cx); cl.setAttribute('x2', cx); cl.setAttribute('opacity', '1');
      dot.setAttribute('cx', cx); dot.setAttribute('cy', y(p[1]).toFixed(1)); dot.setAttribute('opacity', '1');
      sub.innerHTML = '<b>' + esc(o.fmt(p[1])) + '</b> · ' + esc(dayTime(p[0]));
      S.dragging = true;
      clearTimeout(timer);
    }
    function hide() {
      cl.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0');
      sub.innerHTML = def; S.dragging = false;
    }
    el.addEventListener('pointerdown', show);
    el.addEventListener('pointermove', show);
    el.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hide(); });
    el.addEventListener('pointercancel', hide);
    el.addEventListener('pointerup', function (e) {
      if (e.pointerType !== 'mouse') { clearTimeout(timer); timer = setTimeout(hide, 2200); }
    });
  }

  function lineChart(wrap, data, o) {
    var box = wrap.querySelector('.chart-box'), sub = wrap.querySelector('.chart-sub');
    if (!data.length) {
      sub.textContent = '';
      box.innerHTML = '<p class="chart-empty">No readings in this ' + RANGES[S.range].words + ' yet.</p>';
      return;
    }
    var vals = data.map(function (p) { return p[1]; });
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    sub.innerHTML = 'Low <b>' + esc(o.fmt(mn)) + '</b> · High <b>' + esc(o.fmt(mx)) + '</b>';
    var lo = o.lo(mn, mx), hi = o.hi(mn, mx);
    if (hi - lo < 1e-6) hi = lo + 1;
    mountChart(box, sub, data, { id: o.id, lo: lo, hi: hi, band: o.band, fmt: o.fmt, gap: RANGES[S.range].gap, t0: o.t0, t1: o.t1, aria: o.aria });
  }

  function onlineStrip(wrap, points, d, t0, t1) {
    var N = 48, step = (t1 - t0) / N, slots = [];
    for (var i = 0; i < N; i++) slots.push({ sum: 0, n: 0 });
    series(points, 'online').forEach(function (p) {
      var k = Math.floor((p[0] - t0) / step);
      if (k >= 0 && k < N) { slots[k].sum += p[1]; slots[k].n++; }
    });
    // Slots where readings exist but "online" is missing still mean the camera checked in.
    points.forEach(function (p) {
      var t = Date.parse(p && p[0]);
      var k = Math.floor((t - t0) / step);
      if (k >= 0 && k < N && p[1] && !num(p[1].online) && slots[k].n === 0) { slots[k].sum = 1; slots[k].n = 1; slots[k].guess = true; }
    });
    var created = Date.parse(d.created);
    var counted = 0, up = 0, html = '';
    slots.forEach(function (s, i) {
      var start = t0 + i * step;
      if (isFinite(created) && start + step < created) { html += '<i class="pre"></i>'; return; }
      counted++;
      var cls = '';
      if (s.n) {
        var v = s.sum / s.n;
        up += clamp(v, 0, 1);
        cls = v >= 0.9 ? 'on' : v > 0.1 ? 'part' : 'off';
      }
      html += '<i class="' + cls + '"></i>';
    });
    var pct = counted ? Math.round(up / counted * 100) : 0;
    wrap.querySelector('.chart-sub').innerHTML = counted ? '<b>' + pct + '%</b> of the ' + RANGES[S.range].words : '';
    wrap.querySelector('.chart-box').innerHTML = '<div class="strip" role="img" aria-label="Online ' + pct + '% of the last ' + RANGES[S.range].words + '">' + html + '</div>' +
      '<div class="strip-labels" aria-hidden="true"><span>' + esc(timeLabel(t0)) + '</span><span>' + esc(timeLabel((t0 + t1) / 2)) + '</span><span>Now</span></div>' +
      '<div class="legend" aria-hidden="true"><span style="--c:#46a265">Streaming</span><span style="--c:#e0a93b">Patchy</span><span style="--c:#d9534a">Stream down</span><span style="--c:#e4e2dc">No check-in</span></div>';
  }

  function chartShell(id, title) {
    return '<div class="chart" id="c-' + id + '"><div class="chart-head"><h3>' + esc(title) + '</h3><span class="chart-sub"></span></div><div class="chart-box"></div></div>';
  }

  function renderCharts() {
    var d = dev(), box = $('#d-charts');
    if (!d) return;
    var key = S.id + '|' + S.range, data = S.readings[key];
    if (!data) {
      if (S.rErr[key]) {
        box.innerHTML = '<div class="inline-msg" style="margin-top:12px"><span>Couldn\'t load history. ' + esc(S.rErr[key]) + '</span><button class="btn" data-act="retry-readings">Try again</button></div>';
      } else {
        box.innerHTML = '<div class="skel skel-chart"></div><div class="skel skel-chart"></div>';
        loadReadings();
      }
      return;
    }
    var pts = data.points || [];
    var t1 = Date.now(), t0 = t1 - RANGES[S.range].span;
    box.innerHTML = (S.rErr[key] ? '<div class="inline-msg" style="margin-top:12px"><span>Couldn\'t refresh. ' + esc(S.rErr[key]) + '</span><button class="btn" data-act="retry-readings">Try again</button></div>' : '') +
      chartShell('online', 'Time online') + chartShell('rssi', 'Wi-Fi signal') + chartShell('uptime', 'Running since last restart');
    try { onlineStrip($('#c-online'), pts, d, t0, t1); } catch (e) { /* keep the other charts */ }
    var b = band(d);
    try {
      lineChart($('#c-rssi'), series(pts, 'rssi'), {
        id: 'rssi', t0: t0, t1: t1, fmt: fmtRssi, band: [b.min, b.max], aria: 'Wi-Fi signal over the last ' + RANGES[S.range].words,
        lo: function (mn) { return Math.floor(Math.min(mn, b.min) - 4); },
        hi: function (mn, mx) { return Math.ceil(Math.max(mx, b.min) + 4); }
      });
    } catch (e) { /* ignore */ }
    try {
      lineChart($('#c-uptime'), series(pts, 'uptime_min'), {
        id: 'uptime', t0: t0, t1: t1, fmt: fmtUptime, band: null, aria: 'Uptime over the last ' + RANGES[S.range].words + '. Drops mean the camera restarted.',
        lo: function () { return 0; },
        hi: function (mn, mx) { return Math.max(60, mx * 1.1); }
      });
    } catch (e) { /* ignore */ }
  }

  // ---------- navigation ----------
  function openDevice(id) {
    if (!dev(id)) return;
    S.homeScroll = window.scrollY || 0;
    S.view = 'device'; S.id = id; S.renaming = false; S.renameErr = ''; S.profileErr = ''; S.alertsMsg = '';
    $('#home').hidden = true; $('#device').hidden = false;
    window.scrollTo(0, 0);
    renderHead(); renderHero(); renderPhotos(); renderRange(); renderCharts(); renderProfile(); renderInfo();
    var b = $('.back'); if (b) b.focus({ preventScroll: true });
  }
  function goHome() {
    S.view = 'home'; S.id = null; S.renaming = false; S.dragging = false;
    $('#device').hidden = true; $('#home').hidden = false;
    renderHome();
    window.scrollTo(0, S.homeScroll || 0);
  }

  function renderAll() {
    renderHome();
    if (S.view === 'device') {
      var d = dev();
      if (!d) { goHome(); return; }
      if (!S.renaming) renderHead();
      renderHero(); renderInfo();
      if (S.profKey !== d.id + '|' + (d.profile || '')) { renderProfile(); if (!S.dragging) renderCharts(); }
    }
  }

  // ---------- data ----------
  function mergeDevice(nd) {
    if (!nd || !nd.id) return;
    for (var i = 0; i < S.devices.length; i++) {
      if (S.devices[i].id === nd.id) { S.devices[i] = Object.assign({}, S.devices[i], nd); return; }
    }
    S.devices.push(nd);
  }

  function loadDevices() {
    if (S.busy) return S.busy;
    S.busy = call('devices').then(function (l) {
      S.devices = Array.isArray(l) ? l.filter(function (d) { return d && d.id; }) : [];
      S.loaded = true; S.err = '';
    }).catch(function (e) { S.err = msg(e); })
      .then(function () { S.busy = null; renderAll(); watchControls(); });
    return S.busy;
  }

  var refreshTimer = null;
  function softRefresh(ms) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(loadDevices, ms || 1500);
  }

  var ctlTimer = null;
  function watchControls() {
    var waiting = S.devices.some(function (d) { return S.cmd[d.id] && S.cmd[d.id].sent && d.control && !d.control.delivered; });
    if (waiting && !ctlTimer) ctlTimer = setInterval(loadDevices, 15000);
    if (!waiting && ctlTimer) { clearInterval(ctlTimer); ctlTimer = null; }
  }

  function sendControl(id, key, value) {
    var d = dev(id);
    if (!d) return;
    var c = S.cmd[id] = S.cmd[id] || { values: {} };
    c.values[key] = value; c.sending = true; c.err = '';
    renderAll();
    var set = {}; set[key] = value;
    call('command', id, set).then(function (nd) {
      mergeDevice(nd);
      c.sending = false; c.sent = true;
      var s = nd && nd.control && nd.control.set;
      if (s && key in s) delete c.values[key];
    }).catch(function (e) {
      c.sending = false; delete c.values[key];
      c.err = "Couldn't change that. " + msg(e);
    }).then(function () { renderAll(); watchControls(); });
  }

  function addDevice() {
    call('addDevice').then(function (nd) { mergeDevice(nd); S.loaded = true; renderAll(); loadDevices(); })
      .catch(function (e) { if (!isCancel(e)) { S.err = msg(e); renderHome(); } });
  }

  function saveName(name) {
    var d = dev();
    if (!d) return;
    name = String(name || '').trim();
    if (!name || name.length > 40) { S.renameErr = 'Use 1 to 40 characters.'; renderHead(); return; }
    if (name === d.name) { S.renaming = false; renderHead(); return; }
    S.renameBusy = true; S.renameErr = ''; renderHead();
    call('rename', d.id, name).then(function (nd) {
      mergeDevice(nd && nd.id ? nd : Object.assign({}, d, { name: name }));
      S.renaming = false;
    }).catch(function (e) { S.renameErr = msg(e); })
      .then(function () { S.renameBusy = false; renderAll(); if (S.renaming) { var i = $('#rn'); if (i) i.focus(); } });
  }

  function saveProfile(key) {
    var d = dev();
    if (!d) return;
    S.profileBusy = true; S.profileErr = ''; renderProfile();
    call('setProfile', d.id, key || null).then(function (nd) {
      mergeDevice(nd && nd.id ? nd : Object.assign({}, d, { profile: key || null }));
    }).catch(function (e) { S.profileErr = msg(e); })
      .then(function () { S.profileBusy = false; renderProfile(); renderAll(); if (!S.dragging) renderCharts(); });
  }

  // ---------- events ----------
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t || t.tagName === 'SELECT') return;
    var act = t.getAttribute('data-act');
    if (act === 'open') openDevice(t.getAttribute('data-id'));
    else if (act === 'back') goHome();
    else if (act === 'retry') { S.err = ''; renderHome(); loadDevices(); }
    else if (act === 'add') addDevice();
    else if (act === 'toggle') {
      var d = dev(t.getAttribute('data-id')), k = t.getAttribute('data-key');
      if (d) sendControl(d.id, k, ctlValue(d, k) !== true);
    } else if (act === 'press') sendControl(t.getAttribute('data-id'), t.getAttribute('data-key'), true);
    else if (act === 'rename') {
      S.renaming = true; S.renameErr = ''; renderHead();
      var i = $('#rn'); if (i) { i.focus(); i.select(); }
    } else if (act === 'rename-cancel') { S.renaming = false; S.renameErr = ''; renderHead(); }
    else if (act === 'range') {
      S.range = t.getAttribute('data-range') || 'day'; S.dragging = false;
      renderRange(); renderCharts();
    } else if (act === 'retry-readings') {
      var key = S.id + '|' + S.range; delete S.rErr[key]; renderCharts(); loadReadings();
    } else if (act === 'retry-photos') { delete S.pErr[S.id]; renderPhotos(); }
    else if (act === 'photo') takePhoto();
    else if (act === 'alerts') {
      call('alerts').then(function (r) {
        S.alertsMsg = r && r.on ? 'Notifications are on for this phone.' : 'Notifications are off for this phone.';
      }).catch(function (e) { S.alertsMsg = isCancel(e) ? '' : msg(e); })
        .then(function () { if (S.view === 'device') renderInfo(); });
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'prof') saveProfile(e.target.value);
  });

  document.addEventListener('submit', function (e) {
    e.preventDefault();
    if (e.target && e.target.getAttribute('data-form') === 'rename') {
      var i = e.target.querySelector('input');
      saveName(i ? i.value : '');
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && S.renaming) { S.renaming = false; renderHead(); }
  });

  var lastW = window.innerWidth, rz = null;
  window.addEventListener('resize', function () {
    clearTimeout(rz);
    rz = setTimeout(function () {
      if (window.innerWidth !== lastW) { lastW = window.innerWidth; if (S.view === 'device' && !S.dragging) renderCharts(); }
    }, 200);
  });

  // Keep "5 min ago" labels fresh without re-rendering anything interactive.
  setInterval(function () {
    var els = document.querySelectorAll('[data-ago]');
    for (var i = 0; i < els.length; i++) {
      var v = els[i].getAttribute('data-ago');
      if (!v) continue;
      var txt = ago(v);
      els[i].textContent = els[i].getAttribute('data-lower') ? lower(txt) : txt;
    }
  }, 30000);

  function onReading(ev) {
    if (!ev) return;
    var id = ev.device && typeof ev.device === 'object' ? ev.device.id : ev.device;
    if (ev.device && typeof ev.device === 'object') mergeDevice(ev.device);
    var d = dev(id);
    if (d && ev.r && typeof ev.r === 'object') {
      d.last = { t: ev.t || new Date().toISOString(), r: Object.assign({}, reading(d), ev.r) };
    }
    renderAll();
    softRefresh(1500);
    if (S.view === 'device' && S.id === id && !S.dragging) loadReadings();
  }

  // ---------- start ----------
  renderHome();
  if (sdk && typeof sdk.on === 'function') {
    try {
      sdk.on('reading', onReading);
      sdk.on('devices', function () { loadDevices(); });
      sdk.on('theme', function () { /* light theme only; safe area comes via CSS variable */ });
    } catch (e) { /* events are optional */ }
  }
  Promise.all([
    call('profiles').then(function (p) { S.profiles = p && typeof p === 'object' ? p : {}; }).catch(function () {}),
    call('app').then(function (a) { S.app = a && typeof a === 'object' ? a : {}; }).catch(function () {})
  ]).then(loadDevices);
})();

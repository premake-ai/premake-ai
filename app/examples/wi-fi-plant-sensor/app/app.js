/* Plant Sensor companion app. All data comes from window.buildery. */
(function () {
  'use strict';

  var B = window.buildery;
  var ACCENT = '#2f7d4f';
  var CARE_FIELDS = ['moisture', 'light', 'temp', 'humidity'];
  var CHART_FIELDS = ['moisture', 'light', 'temp', 'humidity', 'battery'];
  var LABEL = { moisture: 'Soil moisture', light: 'Light', temp: 'Temperature', humidity: 'Humidity', battery: 'Battery' };
  var GROUPS = [
    ['foliage', 'Foliage'], ['trailing', 'Trailing and climbing'], ['flowering', 'Flowering'], ['fern', 'Ferns'],
    ['palm', 'Palms'], ['succulent', 'Succulents'], ['cactus', 'Cacti'], ['herb', 'Herbs'], ['other', 'Other']
  ];
  var GROUP_ONE = { foliage: 'Foliage plant', trailing: 'Trailing plant', flowering: 'Flowering plant', fern: 'Fern', palm: 'Palm', succulent: 'Succulent', cactus: 'Cactus', herb: 'Herb' };
  var DAY = 864e5;
  var SPAN = { day: DAY, week: 7 * DAY, month: 30 * DAY };
  var BUCKET = { day: 9e5, week: 36e5, month: 144e5 };
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var S = {
    devices: null, err: null, profiles: {},
    tab: 'plants', view: 'list', id: null, range: 'week', listScroll: 0,
    readings: {}, readErr: {}, inflight: {},
    photos: {}, photoErr: {}, latest: {}, photoBusy: false,
    renaming: false, renameBusy: false, typeBusy: false, alertsMsg: '',
    findId: null, findBusy: null, charts: {}, dragging: false
  };

  /* ---------- helpers ---------- */

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function msg(e) { return (e && e.message) || 'Something went wrong. Try again.'; }
  function cancelled(e) { return !!(e && /cancel/i.test(e.message || '')); }
  function call(name, args) {
    try {
      if (!B || typeof B[name] !== 'function') return Promise.reject(new Error("The app couldn't connect. Close it and open it again."));
      return Promise.resolve(B[name].apply(B, args || []));
    } catch (e) { return Promise.reject(e); }
  }
  function dev(id) {
    if (!S.devices || id == null) return null;
    for (var i = 0; i < S.devices.length; i++) if (String(S.devices[i].id) === String(id)) return S.devices[i];
    return null;
  }
  function realId(id) { var d = dev(id); return d ? d.id : id; }
  function upsert(d) {
    if (!d || typeof d !== 'object' || d.id == null) return;
    if (!S.devices) S.devices = [];
    for (var i = 0; i < S.devices.length; i++) {
      if (String(S.devices[i].id) === String(d.id)) { S.devices[i] = d; return; }
    }
    S.devices.push(d);
  }
  function prof(d) {
    var p = d && d.profile != null ? S.profiles[d.profile] : null;
    return p && typeof p === 'object' ? p : null;
  }
  function humanKey(k) { k = String(k || '').replace(/[_-]+/g, ' '); return k.charAt(0).toUpperCase() + k.slice(1); }
  function typeName(d) {
    var p = prof(d);
    if (p) return p.name || humanKey(d.profile);
    return d && d.profile ? humanKey(d.profile) : 'No plant type set';
  }
  function pname(p, key) { return (p && p.name) || humanKey(key); }
  function joinAnd(a) {
    if (a.length < 2) return a.join('');
    return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ---------- formatting ---------- */

  function thousands(v) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function battPct(v) { return num(v) ? clamp((v - 3.3) / 0.9 * 100, 0, 100) : null; }
  // field value -> { n, u }
  function vt(field, v) {
    if (!num(v)) return { n: '–', u: '' };
    if (field === 'light') return v < 10 ? { n: 'Dark', u: '' } : { n: thousands(v), u: 'lux' };
    if (field === 'temp') return { n: v.toFixed(1), u: '°C' };
    if (field === 'battery') return { n: String(Math.round(battPct(v))), u: '%' };
    return { n: String(Math.round(v)), u: '%' };
  }
  function show(field, v) {
    var x = vt(field, v);
    if (!x.u) return x.n;
    return x.n + (x.u === '%' ? '%' : ' ' + x.u);
  }
  function rangeText(field, a, b) {
    if (field === 'light') return thousands(a) + '–' + thousands(b) + ' lux';
    if (field === 'temp') return a + '–' + b + ' °C';
    return a + '–' + b + '%';
  }
  function compactLux(v) {
    if (v < 10) return 'Dark';
    if (v >= 1000) return (v / 1000).toFixed(v >= 9950 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return String(Math.round(v));
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function hm(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function yesterday() { var y = new Date(); y.setDate(y.getDate() - 1); return y; }
  function when(t) {
    var d = new Date(t);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    if (sameDay(d, now)) return 'Today ' + hm(d);
    if (sameDay(d, yesterday())) return 'Yesterday ' + hm(d);
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + hm(d);
  }
  function dateOnly(t) {
    var d = new Date(t);
    if (isNaN(d.getTime())) return '';
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }
  function ago(t) {
    var ms = Date.now() - new Date(t).getTime();
    if (!isFinite(ms)) return '';
    if (ms < 6e4) return 'just now';
    if (ms < 36e5) return Math.round(ms / 6e4) + ' min ago';
    if (ms < DAY) return Math.round(ms / 36e5) + ' h ago';
    var d = new Date(t);
    if (sameDay(d, yesterday())) return 'yesterday ' + hm(d);
    var days = Math.round(ms / DAY);
    if (days < 7) return days + ' days ago';
    return 'on ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }

  /* ---------- icons ---------- */

  function svg(body, size, extra) {
    size = size || 20;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + body + '</svg>';
  }
  var I = {
    back: function () { return svg('<path d="M15 5l-7 7 7 7"/>', 24, ' stroke-width="2.4"'); },
    chev: function () { return svg('<path d="M9 6l6 6-6 6"/>', 18, ' stroke-width="2.4"'); },
    pencil: function () { return svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/>', 20); },
    plus: function () { return svg('<path d="M12 5v14M5 12h14"/>', 20, ' stroke-width="2.4"'); },
    camera: function () { return svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>', 20); },
    bell: function () { return svg('<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>', 20); },
    check: function () { return svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 22, ' stroke-width="2.6"'); },
    drop: function () { return svg('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>', 20); },
    sun: function () { return svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', 20); },
    temp: function () { return svg('<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/>', 20); },
    air: function () { return svg('<path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h8"/>', 20); },
    leaf: function (s) { return svg('<path d="M19 4C10 4 5 8.5 5 15c0 1.8.6 3.4 1.6 4.6M19 4c.7 2 1 4 1 6 0 6-3.4 10-9 10-1.7 0-3.2-.5-4.4-1.4M19 4C13 7.5 9 12.5 7 19"/>', s || 24); }
  };
  var CARE_ICON = { moisture: I.drop, light: I.sun, temp: I.temp, humidity: I.air };

  /* ---------- status ---------- */

  function statusOf(d) {
    if (!d.last) return { k: 'new', label: 'Setting up', cls: 'grey' };
    switch (d.status) {
      case 'alert': return { k: 'alert', label: 'Needs attention', cls: 'red' };
      case 'watch': return { k: 'watch', label: 'Check soon', cls: 'amber' };
      case 'offline': return { k: 'offline', label: 'Offline', cls: 'grey' };
      default: return { k: 'ok', label: 'Happy', cls: 'green' };
    }
  }
  var RANK = { alert: 0, watch: 1, offline: 2, 'new': 3, ok: 4 };
  function chip(label, cls) { return '<span class="chip c-' + cls + '">' + esc(label) + '</span>'; }
  function alertList(d) {
    var a = Array.isArray(d.alerts) ? d.alerts.filter(function (x) { return x && x.message; }) : [];
    return a.sort(function (x, y) { return (x.severity === 'high' ? 0 : 1) - (y.severity === 'high' ? 0 : 1); });
  }
  function updatedText(d) {
    if (!d.last || !d.last.t) return 'No readings yet';
    return (d.status === 'offline' ? 'Last seen ' : 'Updated ') + ago(d.last.t);
  }
  function batteryOf(d) {
    if (num(d.battery)) return d.battery;
    var r = d.last && d.last.r;
    return r && num(r.battery) ? r.battery : null;
  }
  function sorted(list) {
    return list.slice().sort(function (a, b) {
      var r = RANK[statusOf(a).k] - RANK[statusOf(b).k];
      return r || String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  /* ---------- plants list ---------- */

  function skelCards(n) {
    var h = '<p class="sr" role="status">Loading your plants</p>';
    for (var i = 0; i < n; i++) h += '<div class="card" aria-hidden="true"><div class="sk sk-t"></div><div class="sk sk-s"></div><div class="sk sk-big"></div><div class="sk sk-bar"></div></div>';
    return h;
  }
  function errBox(text, act) {
    return '<div class="card err-box" role="alert"><p><b>Couldn\'t load.</b> ' + esc(text) + '</p><button type="button" class="link-btn" data-act="' + act + '">Try again</button></div>';
  }

  function summaryText(list) {
    var c = { happy: 0, water: 0, att: 0, off: 0, neu: 0 };
    list.forEach(function (d) {
      var k = statusOf(d).k;
      if (k === 'ok') c.happy++;
      else if (k === 'offline') c.off++;
      else if (k === 'new') c.neu++;
      else if ((d.alerts || []).some(function (a) { return a && a.id === 'thirsty'; })) c.water++;
      else c.att++;
    });
    var parts = [];
    function add(n, one, many) { if (n) parts.push([n, one, many]); }
    add(c.water, 'needs water', 'need water');
    add(c.att, 'needs attention', 'need attention');
    add(c.happy, 'is happy', 'are happy');
    add(c.off, 'is offline', 'are offline');
    add(c.neu, 'is setting up', 'are setting up');
    if (parts.length === 1 && c.happy === list.length) return list.length === 1 ? 'Your plant is happy' : 'All ' + list.length + ' plants are happy';
    return parts.map(function (p, i) {
      return p[0] + (i === 0 ? (p[0] === 1 ? ' plant ' : ' plants ') : ' ') + (p[0] === 1 ? p[1] : p[2]);
    }).join(', ');
  }

  function moistHTML(v, p) {
    var has = num(v), mn = p && p.moisture_min, mx = p && p.moisture_max, rng = num(mn) && num(mx);
    var state = !has || !rng ? 'n' : v < mn ? 'bad' : v > mx ? 'watch' : 'ok';
    var h = '<div class="hero"><div class="hero-num"><span class="big">' + (has ? Math.round(v) : '–') + '</span><span class="big-unit">%</span></div>' +
      '<div class="hero-side"><span class="hero-label">Soil moisture</span><span class="hero-hint">' +
      (rng ? 'Ideal ' + mn + '–' + mx + '%' : 'Pick a plant type for its ideal range') + '</span></div></div>';
    h += '<div class="bar" aria-hidden="true">' +
      (rng ? '<span class="band" style="left:' + clamp(mn, 0, 100) + '%;width:' + clamp(mx - mn, 0, 100) + '%"></span>' : '') +
      (has ? '<span class="mark m-' + state + '" style="left:' + clamp(v, 0, 100) + '%"></span>' : '') + '</div>';
    return h;
  }
  function mini(field, v, label) {
    var val;
    if (!num(v)) val = '–';
    else if (field === 'light') val = v < 10 ? 'Dark' : compactLux(v) + '<small>lux</small>';
    else { var x = vt(field, v); val = esc(x.n) + '<small>' + esc(x.u) + '</small>'; }
    return '<div class="mini"><span class="mini-val">' + val + '</span><span class="mini-label">' + label + '</span></div>';
  }
  function batMini(d) {
    var v = batteryOf(d);
    if (!num(v)) {
      // reporting but no battery value: a USB-powered sensor (no battery divider)
      if (d.last && d.last.r) return '<div class="mini"><span class="mini-val">USB</span><span class="mini-label">Power</span></div>';
      return mini('battery', null, 'Battery');
    }
    var low = v < 3.45 || battPct(v) < 15;
    return '<div class="mini' + (low ? ' low' : '') + '"><span class="mini-val">' + Math.round(battPct(v)) + '<small>%</small></span><span class="mini-label">' + (low ? 'Low battery' : 'Battery') + '</span></div>';
  }

  function cardHTML(d) {
    var st = statusOf(d), p = prof(d), r = (d.last && d.last.r) || {}, name = d.name || 'Plant sensor';
    var h = '<article class="card plant st-' + st.k + '">' +
      '<div class="plant-top"><div class="plant-titles"><h2 class="plant-name"><button type="button" class="card-link" data-act="open" data-id="' + esc(d.id) + '">' + esc(name) + '</button></h2>' +
      '<p class="plant-type">' + esc(typeName(d)) + '</p></div>' + chip(st.label, st.cls) + '</div>';
    if (st.k === 'new') {
      return h + '<p class="reason">Waiting for its first reading</p>' +
        '<p class="hint">To finish setup, join its Formery-Plant Wi-Fi on your phone, pick your home Wi-Fi and paste the sensor key. The first reading arrives a minute later.</p></article>';
    }
    if (st.k === 'alert' || st.k === 'watch') {
      alertList(d).slice(0, 2).forEach(function (a) { h += '<p class="reason">' + esc(a.message) + '</p>'; });
    }
    h += moistHTML(r.moisture, p);
    h += '<div class="minis">' + mini('light', r.light, 'Light') + mini('temp', r.temp, 'Temp') + mini('humidity', r.humidity, 'Humidity') + batMini(d) + '</div>';
    return h + '<p class="updated">' + esc(updatedText(d)) + '</p></article>';
  }

  function renderBanner() {
    var b = $('banner');
    var showIt = !!S.err && !!S.devices;
    b.hidden = !showIt;
    if (showIt) $('banner-msg').textContent = S.err;
  }

  function renderList() {
    var el = $('list'), sum = $('summary'), add = $('add-row');
    if (S.devices === null) {
      el.innerHTML = S.err ? errBox(S.err, 'retry') : skelCards(2);
      sum.textContent = '';
      add.hidden = true;
      return;
    }
    if (!S.devices.length) {
      sum.textContent = '';
      add.hidden = true;
      el.innerHTML = '<div class="card empty">' +
        '<svg class="art" viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="46" fill="#e6f1ea"/><path d="M33 60h30l-4 18H37z" fill="' + ACCENT + '"/><path d="M48 60V40" stroke="' + ACCENT + '" stroke-width="4" stroke-linecap="round"/><path d="M48 46c-2-9-9-14-18-13 1 9 8 14 18 13zM48 41c2-9 9-15 19-14-1 10-9 15-19 14z" fill="' + ACCENT + '"/></svg>' +
        '<h2>No plants yet</h2><p>Push a sensor into a pot up to its head, switch it on, then add it here.</p>' +
        '<button type="button" class="btn primary" data-act="add">' + I.plus() + 'Add your first sensor</button></div>';
      return;
    }
    sum.textContent = summaryText(S.devices);
    add.hidden = false;
    var h = '';
    sorted(S.devices).forEach(function (d) {
      try { h += cardHTML(d); } catch (e) { h += '<div class="card"><p class="muted">This sensor couldn\'t be shown.</p></div>'; }
    });
    el.innerHTML = h;
  }

  /* ---------- detail ---------- */

  function renderHead() {
    var el = $('d-head'), d = dev(S.id);
    if (!d) {
      el.innerHTML = '<h1 class="d-name">Sensor not found</h1><p class="muted">It may have been removed.</p>';
      return;
    }
    if (S.renaming) {
      if ($('rename-form')) return;
      el.innerHTML = '<form id="rename-form" class="rename" novalidate><label class="sr" for="rename-input">Plant name</label>' +
        '<input id="rename-input" type="text" maxlength="40" autocomplete="off" enterkeyhint="done" value="' + esc(d.name || '') + '">' +
        '<p class="form-err" id="rename-err" role="alert"></p>' +
        '<div class="rename-actions"><button type="button" class="btn ghost" data-act="rename-cancel">Cancel</button><button type="submit" class="btn primary">Save</button></div></form>';
      var inp = $('rename-input');
      try { inp.focus(); inp.select(); } catch (e) { /* ignore */ }
      return;
    }
    var st = statusOf(d), p = prof(d), name = d.name || 'Plant sensor';
    var h = '<h1 class="d-name"><button type="button" class="name-btn" data-act="rename" aria-label="' + esc(name) + ', rename">' + esc(name) + I.pencil() + '</button></h1>' +
      '<button type="button" class="type-btn" data-act="pick-type" aria-label="Plant type: ' + esc(p ? typeName(d) : 'not set') + '. Change">' + esc(p || d.profile ? typeName(d) : 'Choose a plant type') + I.chev() + '</button>' +
      '<div class="d-status">' + chip(st.label, st.cls) + '<span class="muted">' + esc(updatedText(d)) + '</span></div>';
    var al = alertList(d);
    if (al.length && st.k !== 'ok') {
      h += '<ul class="d-reasons">' + al.map(function (a) {
        return '<li class="sev-' + (a.severity === 'high' ? 'high' : 'low') + '">' + esc(a.message) + '</li>';
      }).join('') + '</ul>';
    }
    if (st.k === 'new') h += '<p class="d-hint">Waiting for its first reading. To finish setup, join its Formery-Plant Wi-Fi on your phone, pick your home Wi-Fi and paste the sensor key.</p>';
    el.innerHTML = h;
  }

  function brightestHour(data) {
    if (!data || !data.points) return null;
    var cutoff = Date.now() - DAY, hours = {}, best = null;
    data.points.forEach(function (p) {
      var t = Date.parse(p[0]), v = p[1] && p[1].light;
      if (!num(v) || !num(t) || t < cutoff) return;
      var k = Math.floor(t / 36e5);
      (hours[k] = hours[k] || []).push(v);
    });
    Object.keys(hours).forEach(function (k) {
      var a = hours[k], m = a.reduce(function (s, x) { return s + x; }, 0) / a.length;
      if (best === null || m > best) best = m;
    });
    return best;
  }

  function careEval(field, d, p) {
    var mn = p[field + '_min'], mx = p[field + '_max'], r = (d.last && d.last.r) || {};
    var o = { state: 'none', now: '', tip: '' };
    if (!num(mn) || !num(mx)) { o.tip = 'No guide for this plant type.'; return o; }
    o.ideal = 'Ideal ' + rangeText(field, mn, mx);
    if (field === 'light') {
      var day = S.readings[String(d.id) + '|day'];
      if (!day) { o.tip = S.readErr[String(d.id) + '|day'] ? "Couldn't load today's light." : "Checking the last 24 hours of light."; return o; }
      var v = brightestHour(day);
      if (!num(v)) { o.tip = 'Not enough light readings from the last 24 hours yet.'; return o; }
      o.now = 'Brightest hour ' + show('light', v);
      if (v < mn * 0.5) { o.state = 'bad'; o.tip = 'Move it nearer a window'; }
      else if (v < mn) { o.state = 'watch'; o.tip = 'A slightly brighter spot would help'; }
      else if (v > mx * 2) { o.state = 'bad'; o.tip = 'Too much direct sun. Move it back from the window'; }
      else if (v > mx) { o.state = 'watch'; o.tip = 'Strong midday sun. Watch for scorched leaves'; }
      else { o.state = 'ok'; o.tip = 'Light is just right'; }
      return o;
    }
    var x = r[field];
    if (!num(x)) { o.tip = 'No reading yet.'; return o; }
    o.now = show(field, x);
    if (field === 'moisture') {
      if (x < mn) { o.state = 'bad'; o.tip = 'Water it today'; }
      else if (x > mx + 15) { o.state = 'bad'; o.tip = 'The soil is soggy. Skip watering and check the pot drains'; }
      else if (x > mx) { o.state = 'watch'; o.tip = 'Let the soil dry out before watering again'; }
      else if (x < mn + 5) { o.state = 'watch'; o.tip = 'It will want water in a day or two'; }
      else { o.state = 'ok'; o.tip = 'No need to water yet'; }
    } else if (field === 'temp') {
      if (x < mn - 3) { o.state = 'bad'; o.tip = 'Too cold. Move it away from cold windows and drafts'; }
      else if (x < mn) { o.state = 'watch'; o.tip = 'A little cold. Keep it away from drafts'; }
      else if (x > mx + 3) { o.state = 'bad'; o.tip = 'Too hot. Move it away from heaters and hot glass'; }
      else if (x > mx) { o.state = 'watch'; o.tip = 'A little warm. Keep it out of hot afternoon sun'; }
      else { o.state = 'ok'; o.tip = 'Temperature is comfortable'; }
    } else {
      if (x < mn - 15) { o.state = 'bad'; o.tip = 'The air is very dry. Use a humidifier or a pebble tray'; }
      else if (x < mn) { o.state = 'watch'; o.tip = 'Mist it or group it with other plants'; }
      else if (x > mx + 10) { o.state = 'watch'; o.tip = 'Very humid. Give it more air flow'; }
      else if (x > mx) { o.state = 'watch'; o.tip = 'Give it a little more air flow'; }
      else { o.state = 'ok'; o.tip = 'Humidity is fine'; }
    }
    return o;
  }

  function renderCare() {
    var el = $('d-care'), d = dev(S.id);
    if (!d) { el.hidden = true; return; }
    el.hidden = false;
    var p = prof(d);
    var h = '<h2>Care</h2>';
    if (!p) {
      el.innerHTML = h + '<div class="care-empty"><p>Choose what is growing in this pot to see what it needs and get tips.</p>' +
        '<button type="button" class="btn secondary block" data-act="pick-type">Choose a plant type</button></div>';
      return;
    }
    if (p.notes) h += '<p class="notes">' + esc(p.notes) + '</p>';
    if (!d.last) { el.innerHTML = h + '<p class="muted">Care tips start after its first reading.</p>'; return; }
    if (d.status === 'offline') h += '<p class="notes">Based on its last reading, ' + esc(ago(d.last.t)) + '.</p>';
    h += '<ul class="care-list">';
    CARE_FIELDS.forEach(function (f) {
      var o = careEval(f, d, p);
      var c = o.state === 'ok' ? chip('OK', 'green') : o.state === 'watch' ? chip('Watch', 'amber') : o.state === 'bad' ? chip('Needs attention', 'red') : '';
      h += '<li><span class="care-icon">' + CARE_ICON[f]() + '</span><div class="care-body">' +
        '<div class="care-line"><span class="care-label">' + LABEL[f] + '</span>' + c + '</div>' +
        '<div class="care-now">' + esc([o.now, o.ideal].filter(Boolean).join(' · ')) + '</div>' +
        '<div class="care-tip">' + esc(o.tip) + '</div></div></li>';
    });
    el.innerHTML = h + '</ul>';
  }

  /* charts */

  function linePath(seg) {
    function f(n) { return n.toFixed(1); }
    var d = 'M' + f(seg[0].x) + ',' + f(seg[0].y);
    for (var i = 0; i < seg.length - 1; i++) {
      var p0 = seg[i - 1] || seg[i], p1 = seg[i], p2 = seg[i + 1], p3 = seg[i + 2] || p2;
      var lo = Math.min(p1.y, p2.y), hi = Math.max(p1.y, p2.y);
      var c1x = p1.x + (p2.x - p0.x) / 6, c1y = clamp(p1.y + (p2.y - p0.y) / 6, lo, hi);
      var c2x = p2.x - (p3.x - p1.x) / 6, c2y = clamp(p2.y - (p3.y - p1.y) / 6, lo, hi);
      d += 'C' + f(c1x) + ',' + f(c1y) + ' ' + f(c2x) + ',' + f(c2y) + ' ' + f(p2.x) + ',' + f(p2.y);
    }
    return d;
  }
  function axisTime(t, range) {
    var d = new Date(t);
    if (range === 'day') return hm(d);
    if (range === 'week') return DAYS[d.getDay()] + ' ' + d.getDate();
    return d.getDate() + ' ' + MONTHS[d.getMonth()];
  }
  function chartFmt(field, v) {
    if (field === 'battery') return Math.round(v) + '%';
    return show(field, v);
  }
  function axisFmt(field, v) {
    if (field === 'light') return v < 10 ? '0' : compactLux(v);
    if (field === 'temp') return Math.round(v) + '°';
    return Math.round(v) + '%';
  }

  function chartCard(field, data, p) {
    var W = 340, H = 168, L = 4, R = 296, T = 10, BT = 138;
    var pts = [];
    data.points.forEach(function (pt) {
      var t = Date.parse(pt[0]), v = pt[1] ? pt[1][field] : undefined;
      if (field === 'battery' && num(v)) v = battPct(v);
      if (num(t) && num(v)) pts.push({ t: t, v: v });
    });
    pts.sort(function (a, b) { return a.t - b.t; });
    var head = '<div class="chart-head"><h3>' + LABEL[field] + '</h3>';
    if (!pts.length) {
      return '<div class="card">' + head + '</div><p class="muted" style="margin-top:8px">No ' + LABEL[field].toLowerCase() + ' readings in this period.</p></div>';
    }
    var end = Math.max(Date.now(), pts[pts.length - 1].t), start = end - SPAN[S.range];
    pts = pts.filter(function (q) { return q.t >= start; });
    if (!pts.length) return '<div class="card">' + head + '</div><p class="muted" style="margin-top:8px">No readings in this period.</p></div>';

    var vals = pts.map(function (q) { return q.v; });
    var dmin = Math.min.apply(null, vals), dmax = Math.max.apply(null, vals), lo = dmin, hi = dmax;
    var bmin = p && field !== 'battery' ? p[field + '_min'] : null, bmax = p && field !== 'battery' ? p[field + '_max'] : null;
    var band = num(bmin) && num(bmax);
    if (band) { lo = Math.min(lo, bmin); hi = Math.max(hi, bmax); }
    if (field === 'light') lo = 0;
    if (field === 'battery') { lo = 0; hi = 100; }
    var padv = (hi - lo) * 0.08 || 1;
    lo -= padv; hi += padv;
    if (field !== 'temp') lo = Math.max(0, lo);
    if (field === 'moisture' || field === 'humidity' || field === 'battery') hi = Math.min(100, hi);
    if (hi - lo < 1) { hi += 0.5; lo -= 0.5; }
    function X(t) { return L + (t - start) / (end - start) * (R - L); }
    function Y(v) { return BT - (v - lo) / (hi - lo) * (BT - T); }
    pts.forEach(function (q) { q.x = X(q.t); q.y = Y(q.v); });

    var segs = [], cur = [], gap = BUCKET[S.range] * 2.5;
    pts.forEach(function (q) {
      if (cur.length && q.t - cur[cur.length - 1].t > gap) { segs.push(cur); cur = []; }
      cur.push(q);
    });
    if (cur.length) segs.push(cur);

    var gid = 'g-' + field, g = '';
    g += '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + ACCENT + '" stop-opacity=".26"/><stop offset="1" stop-color="' + ACCENT + '" stop-opacity="0"/></linearGradient></defs>';
    [T, (T + BT) / 2, BT].forEach(function (y) { g += '<line x1="' + L + '" x2="' + R + '" y1="' + y + '" y2="' + y + '" stroke="#ecebe6" stroke-width="1"/>'; });
    if (band) {
      var by1 = clamp(Y(bmax), T, BT), by2 = clamp(Y(bmin), T, BT);
      g += '<rect x="' + L + '" y="' + by1.toFixed(1) + '" width="' + (R - L) + '" height="' + Math.max(0, by2 - by1).toFixed(1) + '" fill="' + ACCENT + '" fill-opacity=".1" rx="3"/>';
    }
    segs.forEach(function (s) {
      if (s.length === 1) {
        g += '<circle cx="' + s[0].x.toFixed(1) + '" cy="' + s[0].y.toFixed(1) + '" r="2.5" fill="' + ACCENT + '"/>';
        return;
      }
      var lp = linePath(s);
      g += '<path d="' + lp + 'L' + s[s.length - 1].x.toFixed(1) + ',' + BT + 'L' + s[0].x.toFixed(1) + ',' + BT + 'Z" fill="url(#' + gid + ')"/>';
      g += '<path d="' + lp + '" fill="none" stroke="' + ACCENT + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
    });
    var last = pts[pts.length - 1];
    g += '<circle cx="' + last.x.toFixed(1) + '" cy="' + last.y.toFixed(1) + '" r="4" fill="' + ACCENT + '" stroke="#fff" stroke-width="2"/>';
    g += '<text x="' + (W - 2) + '" y="' + (T + 4) + '" text-anchor="end">' + esc(axisFmt(field, hi)) + '</text>';
    g += '<text x="' + (W - 2) + '" y="' + BT + '" text-anchor="end">' + esc(axisFmt(field, lo)) + '</text>';
    g += '<text x="' + L + '" y="' + (H - 6) + '" text-anchor="start">' + esc(axisTime(start, S.range)) + '</text>';
    g += '<text x="' + ((L + R) / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(axisTime((start + end) / 2, S.range)) + '</text>';
    g += '<text x="' + R + '" y="' + (H - 6) + '" text-anchor="end">' + esc(S.range === 'day' ? 'Now' : axisTime(end, S.range)) + '</text>';
    g += '<g class="ro" visibility="hidden"><line x1="0" x2="0" y1="' + T + '" y2="' + BT + '" stroke="#1c1c1e" stroke-opacity=".35" stroke-width="1"/><circle r="5" fill="#fff" stroke="' + ACCENT + '" stroke-width="2.5"/></g>';
    g += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="transparent"/>';

    S.charts[field] = { pts: pts, latest: chartFmt(field, last.v), latestWhen: ago(last.t) };
    var aria = LABEL[field] + ' over the last ' + S.range + ', from ' + chartFmt(field, dmin) + ' to ' + chartFmt(field, dmax) + (band ? '. Ideal ' + rangeText(field, bmin, bmax) : '');
    return '<div class="card">' + head +
      '<div class="chart-ro" id="ro-' + field + '" aria-live="off"><strong>' + esc(chartFmt(field, last.v)) + '</strong><span>' + esc(cap(ago(last.t))) + '</span></div></div>' +
      '<p class="chart-range">Low ' + esc(chartFmt(field, dmin)) + ' · High ' + esc(chartFmt(field, dmax)) + (band ? ' · Ideal ' + esc(rangeText(field, bmin, bmax)) : '') + '</p>' +
      '<svg class="chart-svg" data-field="' + field + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(aria) + '">' + g + '</svg></div>';
  }

  function setRO(field, value, label) {
    var el = $('ro-' + field);
    if (el) el.innerHTML = '<strong>' + esc(value) + '</strong><span>' + esc(label) + '</span>';
  }
  function bindCharts() {
    var svgs = $('d-charts').querySelectorAll('svg.chart-svg');
    Array.prototype.forEach.call(svgs, function (el) {
      var field = el.getAttribute('data-field');
      var ro = el.querySelector('.ro'), line = ro && ro.querySelector('line'), dot = ro && ro.querySelector('circle');
      function at(e) {
        var c = S.charts[field];
        if (!c || !c.pts.length || !ro) return;
        var rect = el.getBoundingClientRect();
        if (!rect.width) return;
        var x = (e.clientX - rect.left) / rect.width * 340, best = c.pts[0];
        for (var i = 1; i < c.pts.length; i++) if (Math.abs(c.pts[i].x - x) < Math.abs(best.x - x)) best = c.pts[i];
        ro.setAttribute('visibility', 'visible');
        line.setAttribute('x1', best.x); line.setAttribute('x2', best.x);
        dot.setAttribute('cx', best.x); dot.setAttribute('cy', best.y);
        setRO(field, chartFmt(field, best.v), when(best.t));
      }
      function end() {
        S.dragging = false;
        if (ro) ro.setAttribute('visibility', 'hidden');
        var c = S.charts[field];
        if (c) setRO(field, c.latest, cap(c.latestWhen));
      }
      el.addEventListener('pointerdown', function (e) { S.dragging = true; at(e); });
      el.addEventListener('pointermove', function (e) { if (S.dragging || e.pointerType === 'mouse') at(e); });
      el.addEventListener('pointerup', function (e) { if (e.pointerType === 'mouse') { S.dragging = false; } else end(); });
      el.addEventListener('pointerleave', end);
      el.addEventListener('pointercancel', end);
    });
  }

  function renderCharts() {
    if (S.dragging) return;
    var el = $('d-charts'), id = S.id, k = id + '|' + S.range, data = S.readings[k];
    Array.prototype.forEach.call(document.querySelectorAll('.seg button'), function (b) {
      var on = b.getAttribute('data-range') === S.range;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    S.charts = {};
    if (!data) {
      el.innerHTML = S.readErr[k] ? errBox(S.readErr[k], 'retry-readings') :
        '<div class="card" aria-hidden="true"><div class="sk sk-s"></div><div class="sk sk-chart"></div></div><div class="card" aria-hidden="true"><div class="sk sk-s"></div><div class="sk sk-chart"></div></div>';
      return;
    }
    var d = dev(id), p = prof(d);
    var fields = CHART_FIELDS.filter(function (f) {
      return data.fields.indexOf(f) >= 0 || data.points.some(function (pt) { return pt[1] && num(pt[1][f]); });
    });
    var h = '';
    if (S.readErr[k]) h += '<div class="inline-note" role="status"><span>Couldn\'t refresh the charts.</span><button type="button" class="link-btn" data-act="retry-readings">Try again</button></div>';
    if (!fields.length) {
      el.innerHTML = h + '<div class="card"><p class="muted">No readings in this period yet. Charts appear once the sensor has reported for a while.</p></div>';
      return;
    }
    fields.forEach(function (f) {
      try { h += chartCard(f, data, p); } catch (e) { /* skip a broken chart */ }
    });
    el.innerHTML = h;
    bindCharts();
  }

  function normReadings(res) {
    return {
      fields: res && Array.isArray(res.fields) ? res.fields : [],
      points: res && Array.isArray(res.points) ? res.points.filter(function (p) { return Array.isArray(p) && p.length >= 2; }) : []
    };
  }
  function loadReadings(id, range) {
    var k = String(id) + '|' + range;
    if (S.inflight[k]) return;
    S.inflight[k] = true;
    call('readings', [realId(id), range]).then(function (res) {
      S.readings[k] = normReadings(res);
      S.readErr[k] = null;
    }, function (e) {
      S.readErr[k] = msg(e);
    }).then(function () {
      S.inflight[k] = false;
      if (S.tab === 'plants' && S.view === 'detail' && String(S.id) === String(id)) {
        if (range === S.range) renderCharts();
        if (range === 'day') renderCare();
      }
      if (S.tab === 'find' && String(S.findId) === String(id) && range === 'week') renderFind();
    });
  }

  /* photos */

  var HEALTH = { good: ['Healthy', 'green'], watch: ['Keep an eye on it', 'amber'], bad: ['Needs care', 'red'] };
  function healthChip(h) { var x = HEALTH[h] || ['Checked', 'grey']; return chip(x[0], x[1]); }
  function safeImg(src) { return typeof src === 'string' && /^(data:image\/|blob:)/.test(src) ? src : ''; }
  function growthText(g) {
    if (g == null || g === '') return '';
    if (typeof g === 'string' || typeof g === 'number') return String(g);
    if (typeof g === 'object') {
      if (typeof g.summary === 'string') return g.summary;
      var parts = [];
      Object.keys(g).forEach(function (k) {
        var v = g[k];
        if (typeof v === 'string' || typeof v === 'number') parts.push(cap(k.replace(/_/g, ' ')) + ': ' + v);
      });
      return parts.join('. ');
    }
    return '';
  }
  function strList(a) { return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string' && x; }) : []; }

  function renderPhotos() {
    var el = $('d-photos'), id = S.id, d = dev(id);
    if (!d) { el.hidden = true; return; }
    el.hidden = false;
    var h = '<h2>Photo checks</h2><p class="notes">Take a photo every week or two to catch problems early and track growth.</p>' +
      '<button type="button" class="btn primary block" data-act="photo"' + (S.photoBusy ? ' disabled' : '') + '>' + I.camera() + (S.photoBusy ? 'Checking your photo…' : 'Check with a photo') + '</button>';
    var list = S.photos[id], latest = S.latest[id] || (list && list[0]) || null;
    if (latest) {
      var img = safeImg(latest.image), issues = strList(latest.issues), advice = strList(latest.advice), growth = growthText(latest.growth);
      h += '<div class="photo-result">' + (img ? '<img class="photo-img" src="' + esc(img) + '" alt="Latest photo of ' + esc(d.name || 'the plant') + '">' : '') +
        '<div class="h-top"><span class="h-date">' + esc(when(latest.t) || 'Latest check') + '</span>' + healthChip(latest.health) + '</div>' +
        (latest.summary ? '<p class="summary-text">' + esc(latest.summary) + '</p>' : '');
      if (issues.length) h += '<h3>What it noticed</h3><ul class="bullets">' + issues.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
      if (advice.length) h += '<h3>What to do</h3><ul class="bullets">' + advice.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
      if (growth) h += '<h3>Growth</h3><p class="care-tip">' + esc(growth) + '</p>';
      h += '</div>';
    }
    if (S.photoErr[id] && !list) {
      h += '<div class="inline-note" style="margin-top:14px"><span>Couldn\'t load past checks.</span><button type="button" class="link-btn" data-act="retry-photos">Try again</button></div>';
    } else if (list && list.length > 1) {
      h += '<div class="history"><h3>History</h3><ul>' + list.slice(0, 30).map(function (x) {
        var src = safeImg(x.image);
        return '<li>' + (src ? '<img class="thumb" src="' + esc(src) + '" alt="">' : '<span class="thumb">' + I.leaf(22) + '</span>') +
          '<div class="h-body"><div class="h-top"><span class="h-date">' + esc(when(x.t)) + '</span>' + healthChip(x.health) + '</div>' +
          (x.summary ? '<span class="h-sum">' + esc(x.summary) + '</span>' : '') + '</div></li>';
      }).join('') + '</ul></div>';
    } else if (list && !list.length && !latest) {
      h += '<p class="muted" style="margin-top:12px;font-size:15px">No photo checks yet.</p>';
    }
    el.innerHTML = h;
  }
  function loadPhotos(id) {
    call('photos', [realId(id)]).then(function (list) {
      S.photos[id] = Array.isArray(list) ? list.filter(function (x) { return x && typeof x === 'object'; }) : [];
      S.photoErr[id] = null;
    }, function (e) { S.photoErr[id] = msg(e); }).then(function () {
      if (S.view === 'detail' && S.id === id) renderPhotos();
    });
  }
  function takePhoto() {
    var id = S.id;
    if (S.photoBusy || !dev(id)) return;
    S.photoBusy = true;
    renderPhotos();
    call('photo', [realId(id)]).then(function (res) {
      if (res && typeof res === 'object') {
        S.latest[id] = res;
        S.photos[id] = [res].concat((S.photos[id] || []).filter(function (x) { return x.id !== res.id; }));
      }
    }, function (e) { if (!cancelled(e)) toast(msg(e)); }).then(function () {
      S.photoBusy = false;
      if (S.id === id) renderPhotos();
    });
  }

  function renderInfo() {
    var el = $('d-info'), d = dev(S.id);
    if (!d) { el.hidden = true; return; }
    el.hidden = false;
    var v = batteryOf(d), low = num(v) && (v < 3.45 || battPct(v) < 15);
    var h = '<h2>Sensor</h2>';
    if (low) h += '<p class="warn">The battery is low. Charge it through the USB-C port on the side.</p>';
    h += '<div class="info-row"><span>Battery</span><span>' + (num(v) ? Math.round(battPct(v)) + '% <span class="muted">(' + v.toFixed(2) + ' V)</span>' : '<span class="muted">' + (d.last && d.last.r ? 'USB power' : 'Not reported yet') + '</span>') + '</span></div>';
    h += '<div class="info-row"><span>Firmware</span><span>' + esc(d.fw || 'Unknown') + '</span></div>';
    if (d.created) h += '<div class="info-row"><span>Added</span><span>' + esc(dateOnly(d.created)) + '</span></div>';
    if (d.last && d.last.t) h += '<div class="info-row"><span>Last reading</span><span>' + esc(when(d.last.t)) + '</span></div>';
    h += '<button type="button" class="btn secondary block" data-act="alerts">' + I.bell() + 'Alerts</button>';
    if (S.alertsMsg) h += '<p class="alerts-msg" role="status">' + esc(S.alertsMsg) + '</p>';
    el.innerHTML = h;
  }

  function renderDetail() { renderHead(); renderCare(); renderCharts(); renderPhotos(); renderInfo(); }

  function openDetail(id) {
    if (!dev(id)) return;
    S.listScroll = window.scrollY || 0;
    S.view = 'detail';
    S.id = String(id);
    S.renaming = false;
    S.alertsMsg = '';
    showScreens();
    renderDetail();
    window.scrollTo(0, 0);
    loadReadings(S.id, S.range);
    if (S.range !== 'day') loadReadings(S.id, 'day');
    loadPhotos(S.id);
  }
  function back() {
    S.view = 'list';
    S.renaming = false;
    S.dragging = false;
    showScreens();
    renderList();
    window.scrollTo(0, S.listScroll);
  }

  /* rename */

  function saveRename() {
    var inp = $('rename-input'), errEl = $('rename-err');
    if (!inp || S.renameBusy) return;
    var v = inp.value.trim(), d = dev(S.id), id = S.id;
    if (!v) { errEl.textContent = 'Give it a name.'; return; }
    if (v.length > 40) { errEl.textContent = 'Keep it to 40 characters or fewer.'; return; }
    if (d && v === d.name) { S.renaming = false; renderHead(); return; }
    S.renameBusy = true;
    call('rename', [realId(id), v]).then(function (nd) {
      if (nd && nd.id != null) upsert(nd); else if (d) d.name = v;
      S.renaming = false;
    }, function (e) {
      var el = $('rename-err');
      if (el) el.textContent = msg(e);
    }).then(function () {
      S.renameBusy = false;
      if (!S.renaming) { renderHead(); renderList(); }
    });
  }

  /* plant type sheet */

  function profileGroup(p) {
    var g = p && p.group;
    for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i][0] === g) return g;
    return 'other';
  }
  function renderSheetList() {
    var q = ($('sheet-search').value || '').trim().toLowerCase(), d = dev(S.id), cur = d && d.profile;
    var keys = Object.keys(S.profiles), h = '';
    if (!keys.length) { $('sheet-list').innerHTML = '<p class="muted pad">Plant types couldn\'t load. Try again in a moment.</p>'; return; }
    if (cur && !q) h += '<button type="button" class="sheet-clear" data-act="set-type" data-key="">Clear plant type</button>';
    var any = false;
    GROUPS.forEach(function (g) {
      var items = keys.filter(function (k) {
        var p = S.profiles[k];
        if (!p || typeof p !== 'object' || profileGroup(p) !== g[0]) return false;
        return !q || pname(p, k).toLowerCase().indexOf(q) >= 0 || k.indexOf(q) >= 0 || g[1].toLowerCase().indexOf(q) >= 0;
      }).sort(function (a, b) { return pname(S.profiles[a], a).localeCompare(pname(S.profiles[b], b)); });
      if (!items.length) return;
      any = true;
      h += '<h3 class="sheet-group">' + esc(g[1]) + '</h3><ul class="sheet-ul">' + items.map(function (k) {
        var p = S.profiles[k], ranges = [];
        if (num(p.moisture_min) && num(p.moisture_max)) ranges.push('Soil ' + rangeText('moisture', p.moisture_min, p.moisture_max));
        if (num(p.light_min) && num(p.light_max)) ranges.push(rangeText('light', p.light_min, p.light_max));
        return '<li><button type="button" class="sheet-row" data-act="set-type" data-key="' + esc(k) + '"' + (k === cur ? ' aria-current="true"' : '') + '>' +
          '<span class="sr-text"><span class="sr-name">' + esc(pname(p, k)) + '</span>' + (p.notes ? '<span class="sr-notes">' + esc(p.notes) + '</span>' : '') +
          (ranges.length ? '<span class="sr-ranges">' + esc(ranges.join(' · ')) + '</span>' : '') + '</span>' +
          '<span class="sr-check">' + (k === cur ? I.check() + '<span class="sr">Current</span>' : '') + '</span></button></li>';
      }).join('') + '</ul>';
    });
    if (!any) h += '<p class="muted pad">No plants match "' + esc(q) + '".</p>';
    $('sheet-list').innerHTML = h;
  }
  var sheetTimer;
  function openSheet() {
    if (!dev(S.id)) return;
    var w = $('sheet');
    clearTimeout(sheetTimer);
    $('sheet-search').value = '';
    renderSheetList();
    w.hidden = false;
    document.body.classList.add('locked');
    $('sheet-list').scrollTop = 0;
    sheetTimer = setTimeout(function () { w.classList.add('open'); }, 20);
  }
  function closeSheet() {
    var w = $('sheet');
    w.classList.remove('open');
    document.body.classList.remove('locked');
    clearTimeout(sheetTimer);
    sheetTimer = setTimeout(function () { w.hidden = true; }, 260);
  }
  function setType(id, key, after) {
    if (S.typeBusy) return;
    S.typeBusy = true;
    var d = dev(id);
    call('setProfile', [realId(id), key || null]).then(function (nd) {
      if (nd && nd.id != null) upsert(nd); else if (d) d.profile = key || null;
      var p = key ? S.profiles[key] : null;
      toast(key ? (((dev(id) || {}).name || 'Your sensor') + ' is now set to ' + pname(p, key)) : 'Plant type cleared');
      if (after) after(true);
    }, function (e) {
      toast(msg(e));
      if (after) after(false);
    }).then(function () {
      S.typeBusy = false;
      renderList();
      if (S.view === 'detail' && S.id === String(id)) { renderHead(); renderCare(); renderCharts(); }
      refreshSoon();
    });
  }

  /* ---------- find plants ---------- */

  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function pctl(s, q) { return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))] : null; }

  function analyse(data) {
    var rows = ((data && data.points) || []).map(function (p) { return { t: Date.parse(p[0]), r: p[1] || {} }; })
      .filter(function (x) { return num(x.t); }).sort(function (a, b) { return a.t - b.t; });
    if (!rows.length) return { ready: false, none: true };
    var first = rows[0].t, span = (rows[rows.length - 1].t - first) / DAY;
    if (span < 3) return { ready: false, days: span, readyAt: first + 3 * DAY };
    var byDay = {}, temps = [], hums = [];
    rows.forEach(function (x) {
      var v = x.r.light, d = new Date(x.t), hr = d.getHours();
      if (num(v) && hr >= 10 && hr < 16) { var k = d.toDateString(); byDay[k] = Math.max(byDay[k] || 0, v); }
      if (num(x.r.temp)) temps.push(x.r.temp);
      if (num(x.r.humidity)) hums.push(x.r.humidity);
    });
    temps.sort(function (a, b) { return a - b; });
    return {
      ready: true, days: span,
      light: median(Object.keys(byDay).map(function (k) { return byDay[k]; })),
      tlo: pctl(temps, 0.1), thi: pctl(temps, 0.9),
      hum: hums.length ? hums.reduce(function (s, x) { return s + x; }, 0) / hums.length : null
    };
  }
  function lightWords(l) {
    if (!num(l)) return null;
    if (l < 1000) return 'Low light';
    if (l < 5000) return 'Medium light';
    if (l < 15000) return 'Bright, indirect light';
    if (l < 30000) return 'Bright light with some sun';
    return 'Full sun';
  }
  function humWords(h) {
    if (!num(h)) return null;
    if (h < 35) return 'dry air';
    if (h < 50) return 'fairly dry air';
    if (h < 65) return 'comfortable humidity';
    return 'humid air';
  }
  function describe(a) {
    var parts = [];
    var lw = lightWords(a.light);
    if (lw) parts.push(lw);
    if (num(a.tlo) && num(a.thi)) parts.push(Math.round(a.tlo) === Math.round(a.thi) ? 'around ' + Math.round(a.tlo) + ' °C' : Math.round(a.tlo) + '–' + Math.round(a.thi) + ' °C');
    var hw = humWords(a.hum);
    if (hw) parts.push(hw);
    return parts.length ? cap(parts.join(', ')) : 'Not enough readings to describe this spot yet';
  }
  function fit(p, a) {
    var pen = 0, good = [], bad = [];
    if (num(a.light) && num(p.light_min) && num(p.light_max)) {
      var l = Math.max(a.light, 1);
      if (l < p.light_min) { var r1 = Math.log(p.light_min / l) / Math.LN2; pen += r1 * 2; bad.push(r1 > 1.5 ? 'Too dark here' : 'Wants more light'); }
      else if (l > p.light_max) { var r2 = Math.log(l / p.light_max) / Math.LN2; pen += r2 * 2; bad.push(r2 > 1 ? 'Too much sun here' : 'May get a little too much sun'); }
      else good.push('light');
    }
    if (num(a.tlo) && num(a.thi) && num(p.temp_min) && num(p.temp_max)) {
      var below = Math.max(0, p.temp_min - a.tlo), above = Math.max(0, a.thi - p.temp_max);
      pen += (below + above) / 2.5;
      if (below > 0) bad.push(below > 3 ? 'Too cold here' : 'Can get a bit cold here');
      if (above > 0) bad.push(above > 3 ? 'Too warm here' : 'Can get a bit warm here');
      if (!below && !above) good.push('warmth');
    }
    if (num(a.hum) && num(p.humidity_min) && num(p.humidity_max)) {
      if (a.hum < p.humidity_min) { pen += (p.humidity_min - a.hum) / 10; bad.push('Wants more humidity'); }
      else if (a.hum > p.humidity_max) { pen += (a.hum - p.humidity_max) / 10; bad.push('Prefers drier air'); }
      else good.push('humidity');
    }
    var reason;
    if (good.length === 3) reason = 'Light, warmth and humidity all suit it';
    else if (good.length) reason = cap(joinAnd(good)) + (good.length > 1 ? ' suit it' : ' suits it');
    else reason = 'Could work with extra care';
    return { pen: pen, reason: reason, caveat: bad.join('. ') };
  }

  function renderFind() {
    var el = $('f-body'), sel = $('f-sensors');
    if (S.devices === null) { sel.innerHTML = ''; el.innerHTML = S.err ? errBox(S.err, 'retry') : skelCards(1); return; }
    if (!S.devices.length) {
      sel.innerHTML = '';
      el.innerHTML = '<div class="card empty"><h2>Add a sensor first</h2><p>Put a sensor where you would like a plant and give it 3 days to learn the spot.</p>' +
        '<button type="button" class="btn primary" data-act="add">' + I.plus() + 'Add a sensor</button></div>';
      return;
    }
    if (!dev(S.findId)) {
      var withData = S.devices.filter(function (d) { return d.last; });
      S.findId = String((withData[0] || S.devices[0]).id);
    }
    var list = S.devices.slice().sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
    sel.innerHTML = '<h2 class="sub">Which spot?</h2><div class="chips-row" role="group" aria-label="Sensor">' + list.map(function (d) {
      var on = String(d.id) === S.findId;
      return '<button type="button" class="pick' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-act="find-sensor" data-id="' + esc(d.id) + '">' + esc(d.name || 'Plant sensor') + '</button>';
    }).join('') + '</div>';

    var id = S.findId, k = id + '|week', data = S.readings[k], d = dev(id), dname = esc(d.name || 'This sensor');
    if (!data) {
      if (S.readErr[k]) el.innerHTML = errBox(S.readErr[k], 'retry-week');
      else { el.innerHTML = skelCards(1); loadReadings(id, 'week'); }
      return;
    }
    var a = analyse(data);
    if (!a.ready) {
      var body;
      if (a.none) body = 'Waiting for ' + dname + '\'s first reading. Suggestions are ready after 3 days in one spot.';
      else {
        var left = (a.readyAt - Date.now()) / DAY, rd = new Date(a.readyAt), whenTxt;
        if (left <= 0) whenTxt = 'very soon';
        else if (sameDay(rd, new Date())) whenTxt = 'later today';
        else if (left < 1.5) whenTxt = 'tomorrow';
        else whenTxt = 'on ' + LONG_DAYS[rd.getDay()];
        var dd = Math.max(0, a.days);
        body = dname + ' has been learning this spot for ' + (dd < 1 ? 'less than a day' : Math.floor(dd) === 1 ? '1 day' : Math.floor(dd) + ' days') +
          '. It needs 3 days of light, warmth and humidity, so suggestions will be ready ' + whenTxt + '.';
      }
      el.innerHTML = '<div class="card"><h2>Still learning this spot</h2><p class="muted">' + body + '</p><p class="muted" style="margin-top:8px;font-size:15px">Keep it in the same place so the reading reflects the room.</p></div>';
      return;
    }
    var h = '<div class="card"><h2>This spot</h2><p class="room-desc">' + esc(describe(a)) + '</p><div class="stats">' +
      '<div class="stat"><b>' + (num(a.light) ? esc(compactLux(a.light)) + (a.light >= 10 ? ' lux' : '') : '–') + '</b><span>Midday light</span></div>' +
      '<div class="stat"><b>' + (num(a.tlo) ? Math.round(a.tlo) + '–' + Math.round(a.thi) + ' °C' : '–') + '</b><span>Temperature</span></div>' +
      '<div class="stat"><b>' + (num(a.hum) ? Math.round(a.hum) + '%' : '–') + '</b><span>Avg. humidity</span></div></div></div>';
    var ranked = Object.keys(S.profiles).map(function (key) {
      var p = S.profiles[key];
      if (!p || typeof p !== 'object') return null;
      var f = fit(p, a);
      f.key = key; f.p = p;
      return f;
    }).filter(Boolean).sort(function (x, y) { return x.pen - y.pen || pname(x.p, x.key).localeCompare(pname(y.p, y.key)); }).slice(0, 8);
    if (!ranked.length) { el.innerHTML = h + '<p class="muted">Plant types couldn\'t load. Try again in a moment.</p>'; return; }
    h += '<h2 class="sub">Plants that would do well here</h2><ul class="fit-list">' + ranked.map(function (f) {
      var isCur = d.profile === f.key, busy = S.findBusy === f.key;
      var c = isCur ? chip('Current', 'grey') : f.pen < 0.3 ? chip('Great fit', 'green') : f.pen < 1.5 ? chip('Good fit', 'green') : chip('Could struggle', 'amber');
      return '<li><button type="button" class="fit-row" data-act="find-pick" data-key="' + esc(f.key) + '"' + (isCur || S.findBusy ? ' disabled' : '') + '>' +
        '<span class="fit-top"><span><span class="fit-name">' + esc(pname(f.p, f.key)) + '</span><span class="fit-group">' + esc(GROUP_ONE[f.p.group] || 'Plant') + '</span></span>' + c + '</span>' +
        '<span class="fit-reason">' + esc(f.reason) + '</span>' + (f.caveat ? '<span class="fit-caveat">' + esc(f.caveat) + '</span>' : '') +
        (isCur ? '' : '<span class="fit-use">' + (busy ? 'Saving…' : 'Use for ' + dname) + '</span>') + '</button></li>';
    }).join('') + '</ul>';
    el.innerHTML = h;
  }

  /* ---------- data ---------- */

  var refreshing = null, refreshTimer = null;
  function refresh() {
    if (refreshing) return refreshing;
    refreshing = call('devices').then(function (list) {
      S.devices = Array.isArray(list) ? list.filter(function (d) { return d && typeof d === 'object' && d.id != null; }) : [];
      S.err = null;
    }, function (e) {
      S.err = msg(e);
    }).then(function () {
      refreshing = null;
      renderAll();
    });
    return refreshing;
  }
  function refreshSoon() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 1500); }

  function renderAll() {
    renderBanner();
    renderList();
    if (S.view === 'detail') {
      if (!S.renaming) renderHead();
      renderCare(); renderInfo();
      if (!$('d-charts').innerHTML) renderCharts();
      if (!$('d-photos').innerHTML) renderPhotos();
    }
    if (S.tab === 'find') renderFind();
    if (!$('sheet').hidden) renderSheetList();
  }

  function onReading(ev) {
    if (!ev || typeof ev !== 'object') return;
    var raw = ev.device, id = raw && typeof raw === 'object' ? raw.id : raw;
    if (raw && typeof raw === 'object' && raw.id != null && raw.status) upsert(raw);
    var d = dev(id);
    if (d && ev.r && typeof ev.r === 'object') {
      d.last = { t: ev.t || new Date().toISOString(), r: ev.r };
      if (num(ev.r.battery)) d.battery = ev.r.battery;
      if (d.status === 'offline') d.status = 'ok';
    }
    renderList();
    if (d && S.view === 'detail' && S.id === String(d.id)) {
      if (!S.renaming) renderHead();
      renderCare(); renderInfo();
      loadReadings(S.id, S.range);
      if (S.range !== 'day') loadReadings(S.id, 'day');
    }
    refreshSoon();
  }

  /* ---------- screens and events ---------- */

  function showScreens() {
    $('screen-plants').hidden = !(S.tab === 'plants' && S.view === 'list');
    $('screen-detail').hidden = !(S.tab === 'plants' && S.view === 'detail');
    $('screen-find').hidden = S.tab !== 'find';
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      if (t.getAttribute('data-tab') === S.tab) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
  }
  function setTab(tab) {
    if (tab === S.tab) {
      if (tab === 'plants' && S.view === 'detail') back(); else window.scrollTo(0, 0);
      return;
    }
    if (S.tab === 'plants' && S.view === 'list') S.listScroll = window.scrollY || 0;
    S.tab = tab;
    S.renaming = false;
    showScreens();
    if (tab === 'find') { renderFind(); window.scrollTo(0, 0); }
    else if (S.view === 'detail') { renderDetail(); window.scrollTo(0, 0); }
    else { renderList(); window.scrollTo(0, S.listScroll); }
  }

  var toastTimer;
  function toast(text) {
    var el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 3200);
  }

  function addDevice() {
    call('addDevice').then(function (d) {
      if (d && d.id != null) { upsert(d); renderAll(); }
      refresh();
    }, function (e) { if (!cancelled(e)) toast(msg(e)); });
  }

  function onClick(e) {
    var t = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!t || t.disabled) return;
    var act = t.getAttribute('data-act');
    switch (act) {
      case 'open': openDetail(t.getAttribute('data-id')); break;
      case 'back': back(); break;
      case 'tab': setTab(t.getAttribute('data-tab')); break;
      case 'add': addDevice(); break;
      case 'retry': refresh(); break;
      case 'rename': S.renaming = true; renderHead(); break;
      case 'rename-cancel': S.renaming = false; renderHead(); break;
      case 'pick-type': openSheet(); break;
      case 'close-sheet': closeSheet(); break;
      case 'set-type': {
        var key = t.getAttribute('data-key') || null;
        setType(S.id, key, function (ok) { if (ok) closeSheet(); });
        break;
      }
      case 'range': {
        var r = t.getAttribute('data-range');
        if (SPAN[r] && r !== S.range) { S.range = r; S.dragging = false; renderCharts(); }
        loadReadings(S.id, S.range);
        break;
      }
      case 'retry-readings': S.readErr[S.id + '|' + S.range] = null; renderCharts(); loadReadings(S.id, S.range); break;
      case 'retry-photos': S.photoErr[S.id] = null; loadPhotos(S.id); break;
      case 'photo': takePhoto(); break;
      case 'alerts':
        call('alerts').then(function (res) {
          S.alertsMsg = res && res.on ? 'Alerts are on for this phone.' : 'Alerts are off for this phone.';
          renderInfo();
        }, function (e2) { if (!cancelled(e2)) toast(msg(e2)); });
        break;
      case 'find-sensor': S.findId = String(t.getAttribute('data-id')); renderFind(); break;
      case 'retry-week': S.readErr[S.findId + '|week'] = null; renderFind(); break;
      case 'find-pick': {
        var fk = t.getAttribute('data-key'), fid = S.findId;
        S.findBusy = fk;
        renderFind();
        setType(fid, fk, function () { S.findBusy = null; if (S.tab === 'find') renderFind(); });
        break;
      }
    }
  }

  function init() {
    document.addEventListener('click', onClick);
    document.addEventListener('submit', function (e) {
      e.preventDefault();
      if (e.target && e.target.id === 'rename-form') saveRename();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('sheet').hidden) closeSheet();
      else if (S.renaming) { S.renaming = false; renderHead(); }
    });
    $('sheet-search').addEventListener('input', renderSheetList);

    showScreens();
    renderAll();
    call('profiles').then(function (p) {
      if (p && typeof p === 'object' && !Array.isArray(p)) S.profiles = p;
    }, function () { /* keep empty; screens say so */ }).then(function () {
      renderAll();
      if (S.view === 'detail') renderCharts();
    });
    refresh();

    try {
      var a = B && B.on && B.on('reading', function (ev) { try { onReading(ev); } catch (e) { /* ignore */ } });
      if (a && a.catch) a.catch(function () {});
      var b = B && B.on && B.on('devices', function () { refresh(); });
      if (b && b.catch) b.catch(function () {});
    } catch (e) { /* events unavailable */ }

    setInterval(function () {
      if (document.hidden) return;
      if (S.tab === 'plants' && S.view === 'list') renderList();
      if (S.view === 'detail' && !S.renaming) renderHead();
    }, 30000);
    setInterval(function () { if (!document.hidden) refresh(); }, 300000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

/* Premake app SDK (companion-app CONTRACT.md §5). A generated app's index.html loads it first, from /apps/sdk.js
 * (the server puts it inline when it serves the page).
 * The app runs in a sandboxed iframe with no network and no storage; everything goes through the shell that hosts it:
 *   buildery.devices()                 -> [{ id, name, profile, created, last: { t, r } | null, status, battery, fw, alerts: [{ id, severity, message, since }] }]
 *   buildery.readings(device, range)   -> { fields: [...], points: [[iso, { field: number }], ...] }   range: 'day' | 'week' | 'month'
 *   buildery.rename(device, name)      -> device
 *   buildery.setProfile(device, key)   -> device            (key from profiles.json, or null to clear)
 *   buildery.addDevice()               -> device            (the shell shows its pairing sheet; rejects if the person cancels)
 *   buildery.photo(device)             -> { id, t, health, summary, issues, advice, growth?, image? }   (the shell opens the camera)
 *   buildery.photos(device)            -> [{ id, t, health, summary, image? }]
 *   buildery.alerts()                  -> { on }            (the shell shows its alerts sheet)
 *   buildery.command(device, set)      -> device            controls: set { control: value } from app.json "controls" (a
 *                                         slider, dial, toggle, colour, choice or button press). One request per device at a
 *                                         time: calls made while one is in flight are merged and sent next (latest value wins),
 *                                         so a dial can call it on every move. device.control = { set, seq, delivered, polled }.
 *   buildery.profiles()                -> profiles.json      buildery.app() -> app.json (+ preview: true in the studio demo)
 *   buildery.on('reading', cb)         cb({ device, t, r }) whenever a device reports (the shell checks every 60 s)
 *   buildery.on('devices', cb)         the device list changed (added, renamed, profile set)
 *   buildery.on('theme', cb)           cb({ dark, safe_bottom }); also sets --buildery-safe-bottom on <html>
 * Every call returns a Promise. Errors reject with an Error whose message is fit to show. */
(function () {
  'use strict';
  if (window.buildery && window.buildery.version) return;
  var host = window.parent && window.parent !== window ? window.parent : null;
  // The shell is always on the same site as this file, so only it may receive our requests.
  var target = '*';
  try { if (location.origin && location.origin !== 'null') target = location.origin; } catch (e) { /* keep '*' */ }
  var seq = 0, pending = {}, handlers = {}, cache = {};
  var cmdBusy = {}, cmdNext = {}; // controls: per device, the request in flight and the merged one waiting
  var SLOW = { addDevice: 1, photo: 1, alerts: 1 }; // these wait for the person: a long timeout

  function call(method, params) {
    return new Promise(function (resolve, reject) {
      if (!host) { reject(new Error('Open this app from its Premake page.')); return; }
      var id = ++seq;
      var timer = setTimeout(function () {
        delete pending[id];
        reject(new Error(method === 'devices' || method === 'readings' ? 'No answer from the app. Check your connection.' : 'That took too long. Try again.'));
      }, SLOW[method] ? 20 * 60e3 : 30e3);
      pending[id] = { resolve: resolve, reject: reject, timer: timer };
      var msg = { bx: 1, id: id, method: method };
      if (params) msg.params = params;
      try { host.postMessage(msg, target); } catch (e) { clearTimeout(timer); delete pending[id]; reject(new Error('Could not reach the app shell.')); }
    });
  }
  /** controls: one command per device in flight; later ones merge (latest value per control wins) and go next. */
  function command(device, set) {
    return new Promise(function (resolve, reject) {
      var n = cmdNext[device] || (cmdNext[device] = { set: {}, waiters: [] });
      for (var k in set) if (Object.prototype.hasOwnProperty.call(set, k)) n.set[k] = set[k];
      n.waiters.push({ resolve: resolve, reject: reject });
      pump(device);
    });
  }
  function pump(device) {
    if (cmdBusy[device] || !cmdNext[device]) return;
    var job = cmdNext[device]; delete cmdNext[device]; cmdBusy[device] = true;
    var finish = function (ok, v) {
      delete cmdBusy[device];
      for (var i = 0; i < job.waiters.length; i++) { if (ok) job.waiters[i].resolve(v); else job.waiters[i].reject(v); }
      pump(device);
    };
    call('command', { device: device, set: job.set }).then(function (v) { finish(true, v); }, function (e) { finish(false, e); });
  }
  function once(method) { // app.json and profiles.json don't change while the app is open
    if (!cache[method]) cache[method] = call(method).catch(function (e) { delete cache[method]; throw e; });
    return cache[method];
  }
  function emit(name, data) {
    var list = (handlers[name] || []).slice();
    for (var i = 0; i < list.length; i++) { try { list[i](data); } catch (e) { setTimeout(function () { throw e; }); } }
  }
  function applyTheme(d) {
    var b = typeof d.safe_bottom === 'number' && d.safe_bottom >= 0 && d.safe_bottom < 100 ? d.safe_bottom : 0;
    try { document.documentElement.style.setProperty('--buildery-safe-bottom', b + 'px'); } catch (e) { /* no <html> yet */ }
  }

  window.addEventListener('message', function (ev) {
    if (!host || ev.source !== host) return;
    var d = ev.data;
    if (!d || typeof d !== 'object' || d.bx !== 1) return;
    if (typeof d.id === 'number') {
      var p = pending[d.id];
      if (!p) return;
      delete pending[d.id]; clearTimeout(p.timer);
      if (typeof d.error === 'string') p.reject(new Error(d.error)); else p.resolve(d.result);
      return;
    }
    if (typeof d.event !== 'string') return;
    if (d.event === 'theme') applyTheme(d);
    var data = {};
    for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k) && k !== 'bx' && k !== 'event') data[k] = d[k];
    emit(d.event, data);
  });

  window.buildery = {
    version: 1,
    devices: function () { return call('devices'); },
    readings: function (device, range) { return call('readings', { device: device, range: range || 'day' }); },
    rename: function (device, name) { return call('rename', { device: device, name: name }); },
    setProfile: function (device, profile) { return call('setProfile', { device: device, profile: profile == null ? null : profile }); },
    addDevice: function () { return call('addDevice'); },
    photo: function (device) { return call('photo', { device: device }); },
    photos: function (device) { return call('photos', { device: device }); },
    alerts: function () { return call('alerts'); },
    command: function (device, set) { return command(device, set); },
    profiles: function () { return once('profiles'); },
    app: function () { return once('app'); },
    on: function (name, cb) { if (typeof cb === 'function') (handlers[name] = handlers[name] || []).push(cb); return window.buildery; },
    off: function (name, cb) { handlers[name] = (handlers[name] || []).filter(function (f) { return f !== cb; }); return window.buildery; },
  };
})();

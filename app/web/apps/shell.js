// apps: the trusted shell around a generated companion app (companion-app CONTRACT.md §5), served at /apps/<id> to the
// project's owner. It owns everything privileged: the top bar, pairing ("Add sensor": the key is shown once, here, and
// never reaches the app), alerts (notification permission + Web Push), photo capture, and every API call. The app itself
// runs in <iframe sandbox="allow-scripts allow-forms"> with an opaque origin and only talks to this page through the
// bridge below: each message is checked (source window, opaque origin, method whitelist, parameter types, this project's
// own devices) by web/apps/bridge.js before anything happens. ?preview=1 answers from web/apps/demo.js and calls no API.
(function () {
  'use strict';
  const cfg = JSON.parse(document.getElementById('bxcfg').textContent);
  // The shell's buttons and accents follow the app's own colour (app.json theme), so the two feel like one app.
  if (/^#[0-9a-f]{6}$/i.test(cfg.theme || '')) {
    const rs = document.documentElement.style;
    rs.setProperty('--bx-accent', cfg.theme);
    rs.setProperty('--bx-accent-ink', `color-mix(in srgb, ${cfg.theme} 80%, #000)`);
  }
  const B = window.BuilderyBridge;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = $('#bxApp');
  const appUrl = `${cfg.at || `/apps/${cfg.id}`}/ui/index.html`; // app-preview: /apps/<id>, /apps/t/<token> or /apps/ex/<slug>
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const X = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  // ---------------------------------------------------------------- toast, offline pill
  let toastTimer;
  function toast(msg) {
    const t = $('.bx-toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  const offlinePill = $('.bx-offline');
  const setOffline = (on) => { if (offlinePill) offlinePill.hidden = !on; };
  addEventListener('online', () => setOffline(false));

  // ---------------------------------------------------------------- data: the owner API, or the demo
  function friendly(status, data) {
    if (status === 404 && data && data.error === 'no such endpoint') return 'Live data isn’t switched on yet.';
    if (status === 404) return 'Not found. It may have been removed.';
    if (status === 413) return 'That photo is too big. Try another one.';
    if (status === 415) return 'Use a JPEG, PNG or HEIC photo.';
    if (status === 502 || status === 504) return 'The photo check didn’t work this time. Try again.';
    if (status === 429) return (data && data.error) || 'Too many tries. Wait a minute, then try again.';
    if (status === 401 || status === 403) return 'Sign in to Premake again, then reopen the app.';
    return (data && typeof data.error === 'string' && data.error.slice(0, 200)) || `Something went wrong (${status}). Try again.`;
  }
  async function api(method, url, body) {
    let r;
    try {
      r = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    } catch {
      const e = new Error('You’re offline. Check your connection.'); e.offline = true; throw e;
    }
    let data = null;
    try { data = await r.json(); } catch { /* not JSON */ }
    if (r.redirected || r.status === 401) throw new Error(friendly(401));
    if (!r.ok) { const e = new Error(friendly(r.status, data)); e.status = r.status; e.notOn = r.status === 404 && data?.error === 'no such endpoint'; throw e; }
    return data;
  }
  const enc = encodeURIComponent;
  const cacheKey = (k) => `bx:${cfg.id}:${k}`;
  function cached(k, fn) { // last good answer, for when the phone drops offline
    return fn().then((v) => { try { localStorage.setItem(cacheKey(k), JSON.stringify(v)); } catch {} setOffline(false); return v; }, (e) => {
      if (!e.offline) throw e;
      let v = null; try { v = JSON.parse(localStorage.getItem(cacheKey(k)) || 'null'); } catch {}
      if (v == null) throw e;
      setOffline(true);
      return v;
    });
  }
  const live = {
    devices: () => cached('devices', async () => B.devices(await api('GET', `/api/apps/${enc(cfg.id)}/devices`))),
    readings: (id, range) => cached(`r:${id}:${range}`, async () => {
      const q = B.rangeQuery(range, Date.now());
      return B.readings(await api('GET', `/api/devices/${enc(id)}/readings?from=${enc(q.from)}&to=${enc(q.to)}&bucket=${q.bucket}`));
    }),
    rename: async (id, name) => B.device(await api('PATCH', `/api/devices/${enc(id)}`, { name })),
    command: async (id, set) => B.device(await api('POST', `/api/devices/${enc(id)}/command`, { set })), // controls:
    setProfile: async (id, profile) => B.device(await api('PATCH', `/api/devices/${enc(id)}`, { profile })),
    createDevice: async (name) => { const r = await api('POST', `/api/apps/${enc(cfg.id)}/devices`, { name }); return { device: B.device(r?.device), key: typeof r?.key === 'string' ? r.key : '' }; },
    photo: async (id, image) => api('POST', `/api/devices/${enc(id)}/photo`, { image }),
    photos: async (id) => {
      const list = await api('GET', `/api/devices/${enc(id)}/photos`);
      const out = Array.isArray(list) ? list.slice(0, 50) : [];
      for (const p of out.slice(0, 12)) { // small copies of the pictures: the app can't fetch anything itself
        try {
          const u = new URL(p.url, location.origin);
          if (u.origin !== location.origin || !u.pathname.startsWith('/api/')) continue;
          const r = await fetch(u, { credentials: 'same-origin' });
          if (r.ok) p.image = await shrink(await r.blob(), 360, 0.78);
        } catch { /* no picture */ }
      }
      return B.photos(out);
    },
    pushKey: async () => (await api('GET', '/api/push/key'))?.publicKey,
    subscribe: (sub) => api('POST', '/api/push/subscribe', { subscription: sub, app: cfg.id }),
    unsubscribe: (endpoint) => api('DELETE', '/api/push/subscribe', { endpoint, app: cfg.id }),
  };
  function demoSource() {
    const d = window.BuilderyDemo.create({ id: cfg.id, fields: cfg.fields, profiles: cfg.demo_profiles, controls: cfg.controls });
    return {
      devices: async () => { await wait(120); return B.devices(d.devices()); },
      readings: async (id, range) => { await wait(160); return B.readings(d.readings(id, range)); },
      rename: async (id, name) => B.device(d.rename(id, name)),
      command: async (id, set) => { await wait(90); return B.device(d.command(id, set)); },
      setProfile: async (id, p) => B.device(d.setProfile(id, p)),
      createDevice: async (name) => { await wait(600); const r = d.createDevice(name); return { device: B.device(r.device), key: r.key }; },
      photo: async (id) => { await wait(2600); return d.photo(id); },
      photos: async (id) => B.photos(d.photos(id).map((p, i) => ({ ...p, image: demoPicture(`${id}:${p.id}`, p.health, i) }))),
    };
  }
  const src = cfg.preview ? demoSource() : live;

  // ---------------------------------------------------------------- devices, and "reading" events for the app
  let devices = [];
  const lastT = new Map();
  let knownAt = 0;
  function noteDevices(list) {
    for (const d of list) {
      const t = d.last ? d.last.t : null, prev = lastT.get(d.id);
      if (t && prev !== undefined && t !== prev) post({ bx: 1, event: 'reading', device: d.id, t, r: d.last.r });
      lastT.set(d.id, t);
    }
    devices = list; knownAt = Date.now();
    return list;
  }
  let notOnShown = false;
  async function loadDevices() {
    try { return noteDevices(await src.devices()); } catch (e) {
      if (e.notOn && !notOnShown) { notOnShown = true; showNotOn(); }
      throw e;
    }
  }
  function upsert(d) { if (!d) return; const i = devices.findIndex((x) => x.id === d.id); if (i >= 0) devices[i] = d; else devices.push(d); if (!lastT.has(d.id)) lastT.set(d.id, d.last ? d.last.t : null); }
  async function knownDevice(id) {
    if (devices.some((d) => d.id === id)) return;
    if (Date.now() - knownAt > 3000) { try { await loadDevices(); } catch { /* answered below */ } }
    if (B.checkDevice({ device: id }, devices.map((d) => d.id))) throw new Error('Unknown device');
  }
  const deviceName = (id) => devices.find((d) => d.id === id)?.name || '';
  let pollTimer = 0;
  function schedulePoll() { clearTimeout(pollTimer); if (document.visibilityState === 'visible') pollTimer = setTimeout(poll, 60e3); }
  async function poll() { try { await loadDevices(); } catch { /* the app shows its own state */ } schedulePoll(); }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); else clearTimeout(pollTimer); });

  // ---------------------------------------------------------------- the bridge
  function post(msg) { try { if (frame && frame.contentWindow) frame.contentWindow.postMessage(msg, '*'); } catch { /* gone */ } }
  const limit = B.limiter(30, 10);
  const METHODS = {
    devices: () => loadDevices(),
    readings: (p) => src.readings(p.device, p.range),
    rename: async (p) => { const d = await src.rename(p.device, p.name); upsert(d); post({ bx: 1, event: 'devices' }); return d; },
    // controls: checked against app.json "controls" here, and again by the server
    command: async (p) => { const v = B.checkCommand(p.set, cfg.controls || {}); if (v.error) throw new Error(v.error); const d = await src.command(p.device, v.set); upsert(d); return d; },
    setProfile: async (p) => {
      const bad = B.checkProfile(p, cfg.profiles);
      if (bad) throw new Error(bad);
      const d = await src.setProfile(p.device, p.profile); upsert(d); post({ bx: 1, event: 'devices' }); return d;
    },
    addDevice: async () => { const d = await pairFlow(); if (!d) throw new Error('Cancelled'); return d; },
    photo: async (p) => { const a = await photoFlow(p.device); if (!a) throw new Error('Cancelled'); return a; },
    photos: (p) => src.photos(p.device),
    alerts: () => alertsSheet(),
    profiles: () => cfg.profiles || {},
    app: () => ({ ...(cfg.app_json || {}), preview: !!cfg.preview }),
  };
  addEventListener('message', (ev) => {
    if (!frame || !frame.contentWindow || ev.source !== frame.contentWindow) return; // only the app's own frame
    if (ev.origin !== 'null') return; // the sandboxed app always has an opaque origin
    const req = B.parseRequest(ev.data);
    if (!req || req.id === null) return;
    const reply = (body) => { try { ev.source.postMessage({ bx: 1, id: req.id, ...body }, '*'); } catch { /* gone */ } };
    if (req.error) return reply({ error: req.error });
    if (!limit.take(Date.now())) return reply({ error: 'Too many requests. Slow down a little.' });
    if (req.ui && sheet) return reply({ error: 'Something is already open. Close it first.' });
    (async () => {
      if (req.params.device) await knownDevice(req.params.device);
      return METHODS[req.method](req.params);
    })().then((result) => reply({ result: result === undefined ? null : result }), (e) => reply({ error: String((e && e.message) || 'Something went wrong').slice(0, 200) }));
  });

  // the app frame: theme on every load; if the app navigates itself away (a link, a form), bring it back
  let loads = 0, expectLoad = false, resets = [];
  function safeBottom() {
    const p = document.createElement('div'); p.className = 'bx-probe'; document.body.append(p);
    const h = Math.round(p.getBoundingClientRect().height); p.remove();
    return Number.isFinite(h) ? h : 0;
  }
  const sendTheme = () => post({ bx: 1, event: 'theme', dark: false, safe_bottom: safeBottom() });
  if (frame) {
    frame.addEventListener('load', () => {
      loads++;
      if (loads > 1 && !expectLoad) {
        const now = Date.now(); resets = resets.filter((t) => now - t < 60e3);
        if (resets.length < 3) { resets.push(now); expectLoad = true; frame.src = appUrl; return; }
      }
      expectLoad = false;
      sendTheme();
    });
    let rt = 0;
    addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(sendTheme, 200); });
    sendTheme(); // in case the frame finished loading before this script ran
  }

  // ---------------------------------------------------------------- sheets
  const sheetEl = $('.bx-sheet'), scrim = $('.bx-scrim');
  let sheet = null;
  function showSheet(title, build) {
    return new Promise((resolve) => {
      if (sheet) sheet.close();
      const before = document.activeElement;
      clearTimeout(sheetEl._t);
      sheetEl.innerHTML = `<div class="bx-grab" aria-hidden="true"></div><div class="bx-sh-head"><h2 id="bxSheetTitle"></h2><button class="bx-round bx-x" type="button" aria-label="Close">${X}</button></div><div class="bx-sh-body"></div>`;
      $('#bxSheetTitle', sheetEl).textContent = title;
      let done = false;
      const ctl = {
        body: $('.bx-sh-body', sheetEl), result: undefined,
        title(t) { $('#bxSheetTitle', sheetEl).textContent = t; },
        close(v) {
          if (done) return;
          done = true; if (sheet === ctl) sheet = null;
          sheetEl.classList.remove('on'); scrim.classList.remove('on');
          if (frame) frame.inert = false;
          sheetEl._t = setTimeout(() => { if (!sheet) { sheetEl.hidden = true; scrim.hidden = true; sheetEl.innerHTML = ''; } }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420);
          try { before?.focus?.({ preventScroll: true }); } catch { /* fine */ }
          resolve(v === undefined ? ctl.result : v);
        },
      };
      sheet = ctl;
      $('.bx-x', sheetEl).onclick = () => ctl.close();
      build(ctl);
      sheetEl.hidden = false; scrim.hidden = false;
      if (frame) frame.inert = true;
      requestAnimationFrame(() => requestAnimationFrame(() => { sheetEl.classList.add('on'); scrim.classList.add('on'); }));
      setTimeout(() => (sheetEl.querySelector('input:not(.bx-file), [data-focus]') || $('.bx-x', sheetEl)).focus({ preventScroll: true }), 80);
    });
  }
  scrim.addEventListener('click', () => sheet && sheet.close());
  // Drag the grab handle or title row down to dismiss, like an iOS sheet.
  sheetEl.addEventListener('pointerdown', (e) => {
    if (!sheet || !e.target.closest('.bx-grab, .bx-sh-head') || e.target.closest('button')) return;
    const y0 = e.clientY, t0 = Date.now(), id = e.pointerId;
    let dy = 0;
    sheetEl.setPointerCapture?.(id);
    sheetEl.style.transition = 'none';
    const move = (ev) => { dy = Math.max(0, ev.clientY - y0); sheetEl.style.transform = `translateY(${dy}px)`; };
    const up = () => {
      sheetEl.removeEventListener('pointermove', move); sheetEl.removeEventListener('pointerup', up); sheetEl.removeEventListener('pointercancel', up);
      sheetEl.style.transition = ''; sheetEl.style.transform = '';
      if (sheet && (dy > 110 || (dy > 30 && dy / Math.max(1, Date.now() - t0) > 0.5))) sheet.close();
    };
    sheetEl.addEventListener('pointermove', move); sheetEl.addEventListener('pointerup', up); sheetEl.addEventListener('pointercancel', up);
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet) sheet.close(); });

  // ---------------------------------------------------------------- Add sensor: name -> key (shown once) + setup steps
  function pairFlow() {
    const example = cfg.plant ? 'Kitchen monstera' : 'Living room';
    return showSheet('Add a sensor', (s) => {
      s.body.innerHTML = `<p>Name it after where it lives, so you can tell your sensors apart.</p>
        <form novalidate><label class="bx-field"><span>Name</span><input name="name" maxlength="40" autocomplete="off" autocapitalize="sentences" enterkeyhint="go" placeholder="${esc(example)}"></label>
        <div class="bx-err" hidden></div><button class="bx-btn primary block" type="submit">Create its key</button></form>`;
      const form = $('form', s.body), input = form.elements.name, err = $('.bx-err', s.body), go = $('button[type=submit]', form);
      form.onsubmit = async (e) => {
        e.preventDefault();
        const name = B.cleanName(input.value);
        if (!name) { err.hidden = false; err.textContent = 'Type a name, up to 40 characters.'; input.focus(); return; }
        err.hidden = true; go.disabled = true; go.textContent = 'Creating…';
        try {
          const { device, key } = await src.createDevice(name);
          if (!device || !key) throw new Error('The sensor couldn’t be created. Try again.');
          upsert(device); s.result = device; post({ bx: 1, event: 'devices' });
          showKey(s, device, key);
        } catch (x) { err.hidden = false; err.textContent = x.message; go.disabled = false; go.textContent = 'Create its key'; }
      };
    });
  }
  function showKey(s, device, key) {
    s.title(`${device.name}: setup`);
    s.body.innerHTML = `<p>This is the sensor’s key. You type it into the sensor’s setup page.</p>
      <div class="bx-key"><code></code><div class="bx-qr"><canvas role="img" aria-label="QR code of the key"></canvas></div>
        <div class="bx-key-row"><button class="bx-btn plain" type="button" data-copy data-focus>Copy key</button></div></div>
      <p class="bx-once">It’s shown only this once. Copy it before you close this.${cfg.preview ? ' (Demo: this key isn’t real.)' : ''}</p>
      <ol class="bx-steps">
        <li><span><b>Power it on.</b> Plug it into USB-C or put its battery in.</span></li>
        <li><span><b>Join its Wi-Fi.</b> On your phone, open Wi-Fi settings and pick <code>${cfg.plant ? 'Premake-Plant-XXXX' : 'Premake-…-XXXX'}</code>${cfg.plant ? '' : ' (the name starts with Premake-)'}.</span></li>
        <li><span><b>Enter your Wi-Fi and this key.</b> The setup page opens by itself (if not, go to <code>192.168.4.1</code>). Type your home Wi-Fi name and password, then paste the key.</span></li>
        <li><span><b>Done.</b> Its first reading shows up here within a few minutes. To set it up again, press its RESET button, then hold BOOT for 5 seconds.</span></li>
      </ol>
      <div class="bx-actions"><button class="bx-btn primary block" type="button" data-done>Done</button></div>`;
    $('code', s.body).textContent = key;
    try { const ctx = $('canvas', s.body).getContext('2d'); window.BuilderyQR.draw(ctx, window.BuilderyQR.encode(key), 6); } catch { $('.bx-qr', s.body).hidden = true; }
    $('[data-copy]', s.body).onclick = async (e) => {
      const b = e.currentTarget;
      try { await navigator.clipboard.writeText(key); b.textContent = 'Copied'; toast('Key copied'); }
      catch { const r = document.createRange(); r.selectNodeContents($('code', s.body)); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast('Select and copy the key'); }
    };
    $('[data-done]', s.body).onclick = () => s.close(device);
  }

  // ---------------------------------------------------------------- Alerts: permission on a tap, then Web Push
  const alertsBtn = $('.bx-alerts');
  let alertsOn = false, reg = null, vapidKey = null;
  const LOCAL = 'bx:alerts'; // the apps on this device that have alerts on (one push subscription serves them all)
  const localApps = () => { try { const v = JSON.parse(localStorage.getItem(LOCAL) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  function markLocal(on) { try { const s = new Set(localApps()); if (on) s.add(cfg.id); else s.delete(cfg.id); localStorage.setItem(LOCAL, JSON.stringify([...s])); } catch { /* private mode */ } }
  function setAlertsUi(on) {
    alertsOn = on;
    if (!alertsBtn) return;
    alertsBtn.setAttribute('aria-pressed', String(on));
    alertsBtn.title = on ? 'Alerts are on' : 'Alerts';
    $('.bx-dot', alertsBtn).hidden = !on;
  }
  function pushBlocker() {
    if (cfg.preview) return 'preview';
    if (ios && !standalone) return 'install';
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    return null;
  }
  function keyBytes(b64) {
    const s = atob(String(b64).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (String(b64).length % 4)) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  }
  async function loadKey() { if (!vapidKey) vapidKey = await src.pushKey(); if (!vapidKey) throw new Error('Alerts aren’t switched on yet.'); return vapidKey; }
  /** Must start inside the tap: subscribe() (or the permission prompt) is the first thing that runs. */
  function enableAlerts() {
    let p;
    if (reg && vapidKey) p = reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) });
    else {
      p = Promise.resolve(Notification.requestPermission()).then(async (perm) => {
        if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for this site.' : 'Alerts stay off.');
        const r = reg || (reg = await navigator.serviceWorker.register('/apps/sw.js', { scope: '/apps/' }));
        await navigator.serviceWorker.ready;
        return r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(await loadKey()) });
      });
    }
    return p.then(async (sub) => {
      await src.subscribe(sub.toJSON());
      markLocal(true); setAlertsUi(true); toast('Alerts are on');
      return { on: true };
    }).catch((e) => { toast(Notification.permission === 'denied' ? 'Notifications are blocked for this site.' : e.message || 'Alerts stay off.'); return { on: alertsOn }; });
  }
  async function disableAlerts() {
    try {
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) {
        await src.unsubscribe(sub.endpoint).catch(() => {});
        if (!localApps().some((a) => a !== cfg.id)) await sub.unsubscribe().catch(() => {});
      }
    } catch { /* already gone */ }
    markLocal(false); setAlertsUi(false); toast('Alerts are off');
    return { on: false };
  }
  const BLOCKED = {
    preview: ['Alerts in the demo', 'The demo doesn’t send alerts. Open the app on your phone, add it to your Home Screen and turn alerts on there.'],
    install: ['Add it to your Home Screen', 'On iPhone, alerts work once the app is on your Home Screen. Tap Share, then Add to Home Screen, and open it from there.'],
    unsupported: ['Alerts aren’t available here', 'This browser can’t show alerts. On iPhone, add the app to your Home Screen first; on a computer, use Chrome, Edge or Firefox.'],
    denied: ['Notifications are blocked', 'Allow notifications for this site in your browser or phone settings, then come back and turn alerts on.'],
  };
  function alertsSheet() {
    const why = pushBlocker();
    return showSheet(why ? BLOCKED[why][0] : 'Alerts', (s) => {
      s.result = { on: alertsOn };
      if (why) {
        s.body.innerHTML = `<p>${esc(BLOCKED[why][1])}</p><div class="bx-actions"><button class="bx-btn plain block" type="button" data-focus>Got it</button></div>`;
        $('button', s.body).onclick = () => s.close();
        return;
      }
      const lines = (cfg.alerts || []).length ? cfg.alerts : ['When something needs your attention', 'When a sensor goes offline or runs low'];
      const draw = () => {
        s.body.innerHTML = `<div class="bx-state"><b>Alerts</b>${alertsOn ? '<span class="bx-on">On</span>' : '<span class="bx-offtxt">Off</span>'}</div>
          <p class="muted">A notification on this ${ios || /Android/.test(navigator.userAgent) ? 'phone' : 'device'} when:</p><ul class="bx-list">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
          <div class="bx-actions"><button class="bx-btn ${alertsOn ? 'plain' : 'primary'} block" type="button" data-focus>${alertsOn ? 'Turn off alerts' : 'Turn on alerts'}</button></div>`;
        $('[data-focus]', s.body).onclick = async (e) => {
          const b = e.currentTarget; b.disabled = true;
          const r = alertsOn ? await disableAlerts() : await enableAlerts(); // enableAlerts() starts inside this tap
          s.result = r; draw();
        };
      };
      draw();
    });
  }
  if (alertsBtn) alertsBtn.onclick = () => { if (!alertsOn && !pushBlocker() && reg && vapidKey) enableAlerts(); else alertsSheet(); };
  async function initPush() {
    if (cfg.preview || window.top !== window || !cfg.exists || !('serviceWorker' in navigator)) return;
    try {
      reg = await navigator.serviceWorker.register('/apps/sw.js', { scope: '/apps/' });
      if ('PushManager' in window && 'Notification' in window) {
        const sub = await reg.pushManager.getSubscription();
        setAlertsUi(!!sub && Notification.permission === 'granted' && localApps().includes(cfg.id));
        if (Notification.permission !== 'denied') loadKey().catch(() => {}); // ready before the tap, so subscribe() can run inside it
      }
    } catch { /* no service worker: no alerts */ }
  }

  // ---------------------------------------------------------------- photo check: camera -> AI -> back to the app
  /** A JPEG data: URL no wider or taller than `max` (re-encoded in the browser: HEIC from an iPhone becomes JPEG). */
  async function shrink(blob, max, q) {
    let img;
    try { img = await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch {
      const url = URL.createObjectURL(blob);
      try { img = new Image(); img.src = url; await img.decode(); } catch { throw new Error('That photo can’t be read here. Try a JPEG or PNG.'); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    }
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    let out = c.toDataURL('image/jpeg', q);
    for (let qq = q - 0.15; out.length > 5.5e6 && qq > 0.3; qq -= 0.15) out = c.toDataURL('image/jpeg', qq);
    return out;
  }
  function photoFlow(id) {
    const name = deviceName(id);
    return showSheet(cfg.plant ? `Check ${name || 'your plant'}` : 'Photo check', (s) => {
      const ask = (msg) => {
        s.body.innerHTML = `<p>${esc(cfg.plant ? 'Take a clear photo of the whole plant, leaves and soil, in good light.' : 'Take a clear photo in good light.')}</p>
          <div class="bx-err" hidden></div>
          <div class="bx-actions"><button class="bx-btn primary block" type="button" data-cam data-focus>Take a photo</button>
          <button class="bx-btn plain block" type="button" data-lib>Choose from photos</button></div>
          <input class="bx-file" type="file" accept="image/*" capture="environment" tabindex="-1" aria-hidden="true" data-in="cam">
          <input class="bx-file" type="file" accept="image/*" tabindex="-1" aria-hidden="true" data-in="lib">`;
        if (msg) { const e = $('.bx-err', s.body); e.hidden = false; e.textContent = msg; }
        $('[data-cam]', s.body).onclick = () => $('[data-in=cam]', s.body).click();
        $('[data-lib]', s.body).onclick = () => $('[data-in=lib]', s.body).click();
        for (const inp of s.body.querySelectorAll('.bx-file')) inp.onchange = () => { if (inp.files && inp.files[0]) check(inp.files[0]); };
      };
      const check = async (file) => {
        const url = URL.createObjectURL(file);
        s.body.innerHTML = `<div class="bx-photo"><img alt="Your photo"><div class="bx-checking"><span class="bx-spin"></span><span>${cfg.plant ? 'Checking your plant…' : 'Checking your photo…'}</span></div></div>
          <p class="muted">This usually takes under a minute. You can keep this open.</p>`;
        $('img', s.body).src = url;
        try {
          const [full, thumb] = [await shrink(file, 1600, 0.85), await shrink(file, 480, 0.8)];
          const a = B.analysis({ ...(await src.photo(id, full)), image: thumb });
          if (!a) throw new Error('The check came back empty. Try again.');
          s.close(a);
        } catch (e) { ask(e.message || 'The check failed. Try again.'); } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
      };
      ask();
    });
  }
  /** Demo photos: a little potted plant, drawn here (no image files). */
  function demoPicture(seed, health, i) {
    let h = 2166136261; for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967295; };
    const c = document.createElement('canvas'); c.width = 360; c.height = 270;
    const g = c.getContext('2d');
    const wall = g.createLinearGradient(0, 0, 0, 270); wall.addColorStop(0, i % 2 ? '#efe9df' : '#e7ecef'); wall.addColorStop(1, '#d9d3c7');
    g.fillStyle = wall; g.fillRect(0, 0, 360, 270);
    g.fillStyle = '#cfc6b6'; g.fillRect(0, 214, 360, 56);
    const greens = health === 'good' ? ['#2f7d4f', '#3c9460', '#256b41'] : ['#5f8a3f', '#8a9a3a', '#4f7a3a'];
    for (let k = 0; k < 9; k++) {
      const a = -Math.PI / 2 + (rnd() - 0.5) * 2.1, len = 60 + rnd() * 50;
      g.save(); g.translate(180, 168); g.rotate(a + Math.PI / 2);
      g.fillStyle = greens[k % 3]; g.beginPath(); g.ellipse(0, -len, 15 + rnd() * 9, len * 0.55, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    g.fillStyle = '#b8643c'; g.beginPath(); g.moveTo(132, 160); g.lineTo(228, 160); g.lineTo(214, 232); g.lineTo(146, 232); g.closePath(); g.fill();
    g.fillStyle = '#a65632'; g.fillRect(128, 154, 104, 14);
    return c.toDataURL('image/jpeg', 0.8);
  }

  // ---------------------------------------------------------------- top bar
  const addBtn = $('.bx-add');
  if (addBtn) addBtn.onclick = () => { pairFlow(); };
  const back = $('.bx-back');
  try {
    const ref = document.referrer ? new URL(document.referrer) : null;
    if (back && window.top === window && !standalone && ref && ref.origin === location.origin && ref.pathname.startsWith('/designs/') && history.length > 1) {
      back.hidden = false; back.onclick = () => history.back();
    }
  } catch { /* no referrer */ }
  /** Live data isn't on yet (the device API answers 404): say so once, and offer the demo. */
  function showNotOn() {
    const main = $('.bx-main');
    if (!main || $('.bx-noton', main)) return;
    const n = document.createElement('div');
    n.className = 'bx-noton';
    n.innerHTML = '<span>Live data isn’t switched on yet.</span><a href="?preview=1">See the demo</a>';
    main.prepend(n);
  }

  initPush();
  if (cfg.exists) poll();
})();

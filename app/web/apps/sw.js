// apps: the service worker for every companion app on this site (scope /apps/, registered by web/apps/shell.js).
// It only shows alert notifications and opens the right app when one is tapped (companion-app CONTRACT.md §5).
// Push payload (JSON): { "title", "body", "app": "<projectId>", "device"?: "dv_..", "tag"?, "url"?: "/apps/<projectId>" }.
// No fetch handler: pages and data always come from the network.
'use strict';
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

/** Where a notification should lead: an /apps/ page on this site, never anywhere else. */
function target(d) {
  const app = d && typeof d.app === 'string' && ID_RE.test(d.app) ? d.app : null;
  let url = app ? `/apps/${app}` : '/apps/';
  if (d && typeof d.url === 'string') {
    try {
      const u = new URL(d.url, self.location.origin);
      if (u.origin === self.location.origin && u.pathname.startsWith('/apps/')) url = u.pathname + u.search;
    } catch (e) { /* keep the app's own page */ }
  }
  return { app, url };
}

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  if (!d || typeof d !== 'object') d = {};
  const n = d.notification && typeof d.notification === 'object' ? d.notification : d; // { notification: {...} } too
  const { app, url } = target({ ...d, ...n });
  const title = String(n.title || d.title || 'Premake').slice(0, 80);
  const body = String(n.body || n.message || d.body || d.message || '').slice(0, 300);
  const tag = n.tag || d.tag ? String(n.tag || d.tag).slice(0, 64) : undefined;
  e.waitUntil(self.registration.showNotification(title, {
    body, tag, renotify: !!tag, icon: app ? `/apps/${app}/icon-192.png` : undefined, badge: app ? `/apps/${app}/icon-192.png` : undefined,
    data: { app, url },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(target(e.notification.data || {}).url, self.location.origin);
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      try { if (new URL(w.url).pathname === url.pathname && 'focus' in w) return w.focus(); } catch (err) { /* next */ }
    }
    return self.clients.openWindow(url.href);
  })());
});

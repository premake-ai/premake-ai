'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { APP_PAGE, GUEST_PAGE, slugify, designPath } = require('./approutes');

test('studio pages', () => {
  for (const p of ['/new', '/store', '/orders', '/orders/success', '/orders/all', '/examples', '/examples/phone-stand', '/examples/phone-stand/website',
    '/designs/0cc247aa90', '/designs/scara-arm-3d-printer-0cc247aa90', '/designs/scara-arm-0cc247aa90/launch', '/designs/x-0cc247aa90/guide',
    '/website', '/ads', '/launch', '/stats', '/support', '/support/0cc247aa90', '/designs/plant-sensor-4fe69f4d9c/app', '/examples/phone-stand/app']) assert.ok(APP_PAGE.test(p), p);
  for (const p of ['/', '/build/x', '/d/abc', '/guides', '/api/projects', '/files/examples/x/thumb.png', '/login', '/admin', '/terms',
    '/sitemap.xml', '/robots.txt', '/manifest.webmanifest', '/icons/favicon-32.png', '/app.js', '/store.js', '/stats.js', '/designs',
    '/designs/x/y', '/examples/a/b', '/s/slug/', '/start', '/apps/4fe69f4d9c', '/apps/sdk.js', '/examples/phone-stand/apps']) assert.ok(!APP_PAGE.test(p), p);
});

test('guest pages: examples and the store, never a design', () => {
  for (const p of ['/new', '/store', '/examples', '/examples/phone-stand', '/examples/phone-stand/guide', '/examples/phone-stand/app']) assert.ok(GUEST_PAGE.test(p), p);
  for (const p of ['/designs/0cc247aa90', '/orders', '/orders/success', '/stats', '/launch', '/support']) assert.ok(!GUEST_PAGE.test(p), p);
});

test('the gateway keeps the same guest page list', { skip: 'tests the hosted gateway (gateway/server.js), not in the open-source app' }, () => {
  const gw = fs.readFileSync(path.join(__dirname, '..', 'gateway', 'server.js'), 'utf8');
  const m = gw.match(/const GUEST_PAGE = (\/.*\/);/);
  assert.ok(m, 'GUEST_PAGE in gateway/server.js');
  assert.equal(m[1], String(GUEST_PAGE));
});

test('slugs', () => {
  assert.equal(slugify('SCARA Arm 3D Printer!'), 'scara-arm-3d-printer');
  assert.equal(slugify('Café  lamp — v2'), 'cafe-lamp-v2');
  assert.ok(slugify('x'.repeat(100)).length <= 60);
  assert.equal(designPath('0cc247aa90', 'SCARA arm'), '/designs/scara-arm-0cc247aa90');
  assert.equal(designPath('0cc247aa90', ''), '/designs/0cc247aa90');
  assert.equal(designPath('0cc247aa90', 'Untitled design'), '/designs/0cc247aa90');
});

// node --test server/analytics.test.js
// analytics: the gateway deploys only its own folder, so it serves a copy of web/analytics.js. After editing it run
//   cp web/analytics.js gateway/home/analytics.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const app = path.join(__dirname, '..');

test('gateway/home/analytics.js is an exact copy of web/analytics.js', () => {
  const a = fs.readFileSync(path.join(app, 'web', 'analytics.js'), 'utf8');
  const b = fs.readFileSync(path.join(app, 'gateway', 'home', 'analytics.js'), 'utf8');
  assert.strictEqual(b, a, 'run: cp web/analytics.js gateway/home/analytics.js');
});

test('gateway CSPs allow PostHog and the CDN', () => {
  for (const f of ['gateway/home/index.js', 'gateway/landing/index.js']) {
    const s = fs.readFileSync(path.join(app, f), 'utf8');
    for (const h of ['https://us.i.posthog.com', 'https://us-assets.i.posthog.com', 'https://cdn.jsdelivr.net']) assert.ok(s.includes(h), `${f} CSP lacks ${h}`);
  }
});

test('paid order -> server checkout_completed event', () => {
  const { paidEvent } = require('./analytics');
  const e = paidEvent({ id: 'ord_1', user: 'Ann@Example.com', qty: 2, mode: 'kit', amount_total: 4250, total: 40, livemode: false, paid_at: '2026-10-30T00:00:00Z' });
  assert.strictEqual(e.event, 'checkout_completed');
  assert.strictEqual(e.distinct_id, 'ann@example.com');
  assert.strictEqual(e.properties.total, 42.5);
  assert.strictEqual(e.properties.source, 'server');
  assert.strictEqual(e.properties.environment, 'test');
  const anon = paidEvent({ id: 'ord_2', user: 'local', qty: 1, mode: 'assembled', total: 10 });
  assert.strictEqual(anon.distinct_id, 'order:ord_2');
  assert.strictEqual(anon.properties.$process_person_profile, false);
});

// analytics: server-side PostHog events (the browser side is web/analytics.js). Only checkout_completed, sent when an
// order becomes paid (payments.js applySession -> onPaid), so revenue events aren't lost to ad blockers. The browser sends
// its own checkout_completed on /orders/success with source: 'web'; this one has source: 'server' (count revenue on it).
// Fire-and-forget: 5 s timeout, errors are logged and dropped. Off when FORMA_POSTHOG=0 or under node --test.
'use strict';
const KEY = ''; // PostHog project key: empty in the open-source app, so nothing is sent anywhere
const URL_ = 'https://us.i.posthog.com/i/v0/e/';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const enabled = () => !!KEY && process.env.FORMA_POSTHOG !== '0' && !process.env.NODE_TEST_CONTEXT;

/** The event body for a paid order (exported for tests). */
function paidEvent(o) {
  const email = [o.user, o.email].find((x) => typeof x === 'string' && EMAIL.test(x));
  const total = o.amount_total != null ? o.amount_total / 100 : o.total;
  return {
    api_key: KEY, event: 'checkout_completed', distinct_id: email ? email.toLowerCase() : `order:${o.id}`,
    timestamp: o.paid_at || new Date().toISOString(),
    properties: { source: 'server', order_id: o.id, qty: o.qty, mode: o.mode, total, revenue: total, currency: o.currency || 'usd',
      livemode: !!o.livemode, environment: o.livemode ? 'production' : 'test', ...(email ? {} : { $process_person_profile: false }) },
  };
}

function capture(body) {
  if (!enabled()) return;
  fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) })
    .then((r) => { if (!r.ok) console.log(`[analytics] posthog ${r.status}`); })
    .catch((e) => console.log(`[analytics] posthog ${e.name === 'TimeoutError' ? 'timeout' : e.message}`));
}

module.exports = { paidEvent, capture, orderPaid: (o) => { try { capture(paidEvent(o)); } catch {} } };

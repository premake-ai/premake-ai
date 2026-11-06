// Amazon adapter (server/fulfilment). No ordering API for buyers (Business punchout only).
// Manual: Web order from the kit.
'use strict';
const { manual } = require('./_base');

module.exports = manual({
  id: 'amazon',
  name: 'Amazon',
  kinds: [
    'bought',
    'fabricated'
  ],
  url: 'https://www.amazon.com/',
  env: [],
  api: 'No ordering API for buyers (Business punchout only).',
  todo: 'Web order from the kit.'
});

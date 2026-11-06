// Xometry adapter (server/fulfilment). No public ordering API (Instant Quoting Engine on the web, or the sales team).
// Manual: Ask Xometry about partner API access; if granted, add XOMETRY_API_KEY and implement quote()/place().
'use strict';
const { manual } = require('./_base');

module.exports = manual({
  id: 'xometry',
  name: 'Xometry',
  kinds: [
    'fabricated'
  ],
  url: 'https://www.xometry.com/quoting/home/',
  env: [],
  api: 'No public ordering API (Instant Quoting Engine on the web, or the sales team).',
  todo: 'Ask Xometry about partner API access; if granted, add XOMETRY_API_KEY and implement quote()/place().'
});

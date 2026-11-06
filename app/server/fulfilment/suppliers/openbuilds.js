// OpenBuilds adapter (server/fulfilment). No API.
// Manual: Web order from the kit.
'use strict';
const { manual } = require('./_base');

module.exports = manual({
  id: 'openbuilds',
  name: 'OpenBuilds',
  kinds: [
    'fabricated',
    'bought'
  ],
  url: 'https://openbuildspartstore.com/',
  env: [],
  api: 'No API.',
  todo: 'Web order from the kit.'
});

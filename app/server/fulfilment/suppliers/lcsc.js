// LCSC adapter (server/fulfilment). No public ordering API.
// Manual: Web order from the kit.
'use strict';
const { manual } = require('./_base');

module.exports = manual({
  id: 'lcsc',
  name: 'LCSC',
  kinds: [
    'bought'
  ],
  url: 'https://www.lcsc.com/',
  env: [],
  api: 'No public ordering API.',
  todo: 'Web order from the kit.'
});

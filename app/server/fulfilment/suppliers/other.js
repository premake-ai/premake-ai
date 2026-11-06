// Other supplier adapter (server/fulfilment). Unknown supplier.
// Manual: Use the part links.
'use strict';
const { manual } = require('./_base');

module.exports = manual({
  id: 'other',
  name: 'Other supplier',
  kinds: [
    'bought',
    'fabricated'
  ],
  url: '',
  env: [],
  api: 'Unknown supplier.',
  todo: 'Use the part links.'
});

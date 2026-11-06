// Misumi adapter (server/fulfilment). No public API; ordering via punchout/EDI.
// Manual: Web order from the kit.
'use strict';
const { manual } = require('./_base');

module.exports = manual({
  id: 'misumi',
  name: 'Misumi',
  kinds: [
    'fabricated',
    'bought'
  ],
  url: 'https://us.misumi-ec.com/',
  env: [],
  api: 'No public API; ordering via punchout/EDI.',
  todo: 'Web order from the kit.'
});

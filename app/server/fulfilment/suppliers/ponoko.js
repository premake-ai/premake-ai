// Ponoko adapter (server/fulfilment). No current ordering API found (an old 2011 API is gone).
// Manual: Web order from the kit.
'use strict';
const { manual } = require('./_base');

module.exports = manual({
  id: 'ponoko',
  name: 'Ponoko',
  kinds: [
    'fabricated'
  ],
  url: 'https://www.ponoko.com/laser-cutting',
  env: [],
  api: 'No current ordering API found (an old 2011 API is gone).',
  todo: 'Web order from the kit.'
});

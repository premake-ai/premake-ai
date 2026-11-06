// AliExpress adapter (server/fulfilment). Dropshipping API exists for approved sellers only.
// Manual: Web order from the kit.
'use strict';
const { manual } = require('./_base');

module.exports = manual({
  id: 'aliexpress',
  name: 'AliExpress',
  kinds: [
    'bought'
  ],
  url: 'https://www.aliexpress.com/',
  env: [],
  api: 'Dropshipping API exists for approved sellers only.',
  todo: 'Web order from the kit.'
});

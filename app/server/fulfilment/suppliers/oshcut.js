// OSHCut adapter (server/fulfilment). No public ordering API (web checkout at app.oshcut.com).
// Manual: Ask OSHCut for API access; if granted, add OSHCUT_API_KEY and implement place().
'use strict';
const { manual } = require('./_base');

module.exports = manual({
  id: 'oshcut',
  name: 'OSHCut',
  kinds: [
    'fabricated'
  ],
  url: 'https://app.oshcut.com/',
  env: [],
  api: 'No public ordering API (web checkout at app.oshcut.com).',
  todo: 'Ask OSHCut for API access; if granted, add OSHCUT_API_KEY and implement place().'
});

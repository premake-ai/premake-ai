// SendCutSend adapter (server/fulfilment). No public ordering API (web checkout only).
// Manual: Ask SendCutSend sales about an enterprise/API program; if granted, add SENDCUTSEND_API_KEY and implement place().
'use strict';
const { manual } = require('./_base');

module.exports = manual({
  id: 'sendcutsend',
  name: 'SendCutSend',
  kinds: [
    'fabricated'
  ],
  url: 'https://sendcutsend.com/',
  env: [],
  api: 'No public ordering API (web checkout only).',
  todo: 'Ask SendCutSend sales about an enterprise/API program; if granted, add SENDCUTSEND_API_KEY and implement place().'
});

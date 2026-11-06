// JLCCNC / JLC3DP adapter (server/fulfilment). JLCPCB/JLC3DP have a partner ordering API (approval on order volume). JLCCNC: web only.
// TODO(automation): Apply at api.jlcpcb.com, then sign requests with JLC_APP_ID/JLC_ACCESS_KEY/JLC_SECRET_KEY in quote()/place().
// Env: JLC_APP_ID, JLC_ACCESS_KEY, JLC_SECRET_KEY (app/.env.local). Until then this is manual.
'use strict';
const { manual } = require('./_base');

module.exports = manual({
  id: 'jlc',
  name: 'JLCCNC / JLC3DP',
  kinds: [
    'fabricated',
    'printed'
  ],
  url: 'https://jlccnc.com/cnc-machining-quote',
  env: [
    'JLC_APP_ID',
    'JLC_ACCESS_KEY',
    'JLC_SECRET_KEY'
  ],
  api: 'JLCPCB/JLC3DP have a partner ordering API (approval on order volume). JLCCNC: web only.',
  todo: 'Apply at api.jlcpcb.com, then sign requests with JLC_APP_ID/JLC_ACCESS_KEY/JLC_SECRET_KEY in quote()/place().'
});

// DigiKey adapter (server/fulfilment). Ordering API (OAuth by the account holder + an active DigiKey Credit account). Sandbox available.
// TODO(automation): Register an app at developer.digikey.com, get Ordering API access, do the OAuth sign-in, then implement place() against the sandbox first.
// Env: DIGIKEY_CLIENT_ID, DIGIKEY_CLIENT_SECRET (app/.env.local). Until then this is manual.
'use strict';
const { manual } = require('./_base');

module.exports = manual({
  id: 'digikey',
  name: 'DigiKey',
  kinds: [
    'bought'
  ],
  url: 'https://www.digikey.com/',
  env: [
    'DIGIKEY_CLIENT_ID',
    'DIGIKEY_CLIENT_SECRET'
  ],
  api: 'Ordering API (OAuth by the account holder + an active DigiKey Credit account). Sandbox available.',
  todo: 'Register an app at developer.digikey.com, get Ordering API access, do the OAuth sign-in, then implement place() against the sandbox first.'
});

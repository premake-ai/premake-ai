// Mouser adapter (server/fulfilment). Cart + Order API with a key from My Mouser. No test mode: every order is real.
// TODO(automation): Create the key in My Mouser, implement place() as cart-only first (build the cart, an admin submits it).
// Env: MOUSER_ORDER_API_KEY (app/.env.local). Until then this is manual.
'use strict';
const { manual } = require('./_base');

module.exports = manual({
  id: 'mouser',
  name: 'Mouser',
  kinds: [
    'bought'
  ],
  url: 'https://www.mouser.com/',
  env: [
    'MOUSER_ORDER_API_KEY'
  ],
  api: 'Cart + Order API with a key from My Mouser. No test mode: every order is real.',
  todo: 'Create the key in My Mouser, implement place() as cart-only first (build the cart, an admin submits it).'
});

// McMaster-Carr adapter (server/fulfilment). Product-data API for approved customers only; ordering via punchout/EDI.
// Manual: Only worth it at volume: eProcurement@mcmaster.com.
'use strict';
const { manual } = require('./_base');

module.exports = manual({
  id: 'mcmaster',
  name: 'McMaster-Carr',
  kinds: [
    'bought'
  ],
  url: 'https://www.mcmaster.com/',
  env: [],
  api: 'Product-data API for approved customers only; ordering via punchout/EDI.',
  todo: 'Only worth it at volume: eProcurement@mcmaster.com.'
});

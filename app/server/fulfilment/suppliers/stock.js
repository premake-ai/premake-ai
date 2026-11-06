// Premake stock (server/fulfilment): small parts we keep in NYC (config.STOCK: electronics, screws, feet...). Nothing to
// order: pick the parts from the shelf and pack them in the same box as the printed parts. The job's links say where the
// stock is bought from when it needs topping up (docs/business/BULK-STOCK-LIST.md).
'use strict';
const { manual } = require('./_base');

module.exports = manual({
  id: 'stock', name: 'Premake stock (pick and pack)', kinds: ['bought'], url: '',
  env: [], api: 'Our own shelf.', todo: 'Pick the parts and pack them with the printed parts.',
});
module.exports.quote = async () => ({ manual: true, reason: 'Stocked parts use the Premake bulk cost.' });

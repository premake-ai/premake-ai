// Print in-house (server/fulfilment): Premake prints the parts on its own printers. Nothing to order: the "kit" is the
// STL list, the material and the count. Mark it placed when the prints are queued and received when they are done.
'use strict';
const { manual } = require('./_base');

module.exports = manual({
  id: 'inhouse', name: 'Print in-house', kinds: ['printed'], url: '',
  env: [], api: 'Our own printers.', todo: 'Queue the STLs on the printers.',
});
module.exports.quote = async () => ({ manual: true, reason: 'In-house prints use the Premake cost estimate.' });

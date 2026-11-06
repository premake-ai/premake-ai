// PCBWay adapter (server/fulfilment). Partner API for PCB orders only (approval by email); CNC/sheet is web only. Place adds to cart, ConfirmOrder pays.
// TODO(automation): Email PCBWay for API approval; never call ConfirmOrder without an explicit admin click.
// Env: PCBWAY_API_KEY (app/.env.local). Until then this is manual.
'use strict';
const { manual } = require('./_base');

module.exports = manual({
  id: 'pcbway',
  name: 'PCBWay',
  kinds: [
    'fabricated'
  ],
  url: 'https://www.pcbway.com/rapid-prototyping/manufacture/',
  env: [
    'PCBWAY_API_KEY'
  ],
  api: 'Partner API for PCB orders only (approval by email); CNC/sheet is web only. Place adds to cart, ConfirmOrder pays.',
  todo: 'Email PCBWay for API approval; never call ConfirmOrder without an explicit admin click.'
});

'use strict';
// The User-Agent every outgoing supplier call sends: who we are and where to find us. Never a browser's.
const { version } = require('../package.json');
module.exports = `premake-api/${version} (+https://premake.ai)`;

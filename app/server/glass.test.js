// node --test server/glass.test.js
// The liquid glass styles live in web/glass.css (studio, admin, build pages, /guides). The gateway deploys only its own
// folder, so the landing and sign-in pages use a copy, gateway/home/glass.css. After editing web/glass.css run
//   cp web/glass.css gateway/home/glass.css
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('gateway/home/glass.css is an exact copy of web/glass.css', () => {
  const app = path.join(__dirname, '..');
  const a = fs.readFileSync(path.join(app, 'web', 'glass.css'), 'utf8');
  const b = fs.readFileSync(path.join(app, 'gateway', 'home', 'glass.css'), 'utf8');
  assert.strictEqual(b, a, 'run: cp web/glass.css gateway/home/glass.css');
});

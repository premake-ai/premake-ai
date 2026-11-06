#!/usr/bin/env node
// Sign in as the local admin on this Mac (security A3). Prints a one-time link (valid 5 minutes, works once) that sets
// the admin cookie in the browser you open it in. Run from the app folder:
//   node scripts/local-signin.js            print the link
//   node scripts/local-signin.js --open     print it and open it in your default browser
// Reads FORMA_LOCAL_TOKEN from app/.env.local (the server writes it on first start). Never prints the token itself.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const envFile = path.join(__dirname, '..', '.env.local');
let token = process.env.FORMA_LOCAL_TOKEN || '', port = process.env.PORT || '8800';
try {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*(FORMA_LOCAL_TOKEN|PORT)=(.*)$/.exec(line);
    if (m && m[1] === 'FORMA_LOCAL_TOKEN' && !token) token = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {}
if (!token) { console.error('No FORMA_LOCAL_TOKEN in app/.env.local yet. Start the server once, then run this again.'); process.exit(1); }
const p = process.argv.find((a) => /^--port=\d+$/.test(a)); if (p) port = p.split('=')[1];
const t = String(Math.floor(Date.now() / 1000));
const code = crypto.createHmac('sha256', token).update('forma-local-signin:' + t).digest('hex') + '.' + t;
const url = `http://127.0.0.1:${port}/auth/local?code=${code}`;
console.log(url);
if (process.argv.includes('--open')) require('node:child_process').spawn('/usr/bin/open', [url], { stdio: 'ignore', detached: true }).unref();

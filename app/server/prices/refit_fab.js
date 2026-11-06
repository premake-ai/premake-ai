#!/usr/bin/env node
// Refit the sheet / laser price model (fab_model.js) to SendCutSend prices. See CALIBRATION.md.
//   node server/prices/refit_fab.js            fit + write fab_calibration.json
//   node server/prices/refit_fab.js --dry      fit + print, write nothing
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const M = require('./fab_model');

const read = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
const pub = read('published_fab_examples.json').examples || [];
let real = [];
try { real = read('sendcutsend_quotes.json').quotes || []; } catch (e) { console.error(`sendcutsend_quotes.json: ${e.message}`); process.exit(1); }
const bad = real.filter((q) => !(Number(q.price_usd) > 0 && Number(q.qty) >= 1 && Number(q.thickness_mm) > 0 && (q.size_mm?.length === 2 || Number(q.area_cm2) > 0) && q.material));
if (bad.length) { console.error(`Fix these quotes (need material, thickness_mm, size_mm [w, h], qty, price_usd):\n${bad.map((q) => JSON.stringify(q)).join('\n')}`); process.exit(1); }
const records = [...pub.map((r) => ({ ...r, weight: r.weight ?? 1 })), ...real.map((r, i) => ({ ...r, part: r.part || r.file || `quote-${i}`, weight: (r.weight ?? 1) * 5 }))];
const r = M.fit(records);
const parts = new Set(real.map((q, i) => q.part || q.file || `quote-${i}`));
const out = {
  fitted_at: new Date().toISOString().slice(0, 10),
  supplier: 'SendCutSend',
  quotes: parts.size, // real owner quotes (distinct parts); 0 = published examples only
  published_examples: pub.length,
  part_min_usd: M.DEFAULT.part_min_usd,
  order_min_usd: M.DEFAULT.order_min_usd,
  lead_days: M.DEFAULT.lead_days,
  coeffs: r.coeffs,
  discount: r.discount,
};
console.log(JSON.stringify(out, null, 1));
console.log('\nqty-1 fit (actual -> model):');
for (const x of r.residuals) console.log(`  $${x.y.toFixed(2)} -> $${x.pred.toFixed(2)}`);
if (!process.argv.includes('--dry')) { fs.writeFileSync(M.CAL_FILE, JSON.stringify(out, null, 1) + '\n'); console.log(`\nWrote ${M.CAL_FILE}. Restart the server to use it.`); }

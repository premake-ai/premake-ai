#!/usr/bin/env node
// Writes the calibration sample parts (calibration_samples/*.dxf, mm, DXF R12) the owner uploads to SendCutSend by hand
// to get real quotes for CALIBRATION.md. Re-run to regenerate: node server/prices/sample_dxfs.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, 'calibration_samples');
const f = (x) => (+x).toFixed(3);
function dxf(ents) {
  const out = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  for (const e of ents) {
    if (e[0] === 'L') out.push('0', 'LINE', '8', 'CUT', '10', f(e[1]), '20', f(e[2]), '30', '0', '11', f(e[3]), '21', f(e[4]), '31', '0');
    else out.push('0', 'CIRCLE', '8', 'CUT', '10', f(e[1]), '20', f(e[2]), '30', '0', '40', f(e[3]));
  }
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n') + '\n';
}
const rect = (x, y, w, h) => [['L', x, y, x + w, y], ['L', x + w, y, x + w, y + h], ['L', x + w, y + h, x, y + h], ['L', x, y + h, x, y]];
const holes = (pts, d) => pts.map(([x, y]) => ['C', x, y, d / 2]);
const corners = (w, h, inset, d) => holes([[inset, inset], [w - inset, inset], [w - inset, h - inset], [inset, h - inset]], d);
const perim = (ents) => ents.reduce((s, e) => s + (e[0] === 'L' ? Math.hypot(e[3] - e[1], e[4] - e[2]) : 2 * Math.PI * e[3]), 0);

const SAMPLES = [
  { file: 'plate-50x50-4x3.4.dxf', what: 'Small plate, 4 M3 clearance holes', size: [50, 50], ents: [...rect(0, 0, 50, 50), ...corners(50, 50, 6, 3.4)] },
  { file: 'plate-100x60-4x5.5.dxf', what: 'Mounting plate, 4 M5 clearance holes', size: [100, 60], ents: [...rect(0, 0, 100, 60), ...corners(100, 60, 8, 5.5)] },
  { file: 'plate-150x100-6x5.5-cutout.dxf', what: 'Base plate, 6 M5 holes + 60x30 window', size: [150, 100],
    ents: [...rect(0, 0, 150, 100), ...holes([[10, 10], [75, 10], [140, 10], [10, 90], [75, 90], [140, 90]], 5.5), ...rect(45, 35, 60, 30)] },
  { file: 'flat-L-bracket-80x60.dxf', what: 'L-bracket flat pattern (1 bend at y=30 if bent), 4 M4 holes', size: [80, 60],
    ents: [...rect(0, 0, 80, 60), ...holes([[15, 12], [65, 12], [15, 48], [65, 48]], 4.5)] },
  { file: 'disc-80-center-22.dxf', what: 'Disc 80 mm with a 22 mm bore (acrylic spacer / bearing plate)', size: [80, 80],
    ents: [['C', 40, 40, 40], ['C', 40, 40, 11]] },
  { file: 'panel-200x120-acrylic.dxf', what: 'Front panel, 4 M3 holes + 90x40 display window', size: [200, 120],
    ents: [...rect(0, 0, 200, 120), ...corners(200, 120, 6, 3.4), ...rect(55, 50, 90, 40)] },
];

fs.mkdirSync(OUT, { recursive: true });
const index = [];
for (const s of SAMPLES) {
  fs.writeFileSync(path.join(OUT, s.file), dxf(s.ents));
  index.push({ file: s.file, what: s.what, size_mm: s.size, cut_length_mm: Math.round(perim(s.ents)), holes: s.ents.filter((e) => e[0] === 'C').length });
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');
console.log(index.map((x) => `${x.file}  ${x.size_mm.join('x')} mm  cut ${x.cut_length_mm} mm`).join('\n'));

// refmodels: which reference model stands in for a bought part, and how it is fitted (web/refmatch.js).
// Run: node --test server/refmatch.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const INDEX = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'web', 'refmodels', 'index.json'), 'utf8')).models;
const lib = () => import('../web/refmatch.js');
const pick = async (part, ext, side) => (await lib()).pickModel(part, ext, INDEX, side)?.model.key || null;
const comp = (name, extra = {}) => ({ name, group: 'component', process: 'bought', ...extra });

test('Switch Wall Mount names map to the console and both Joy-Con; the screen part and screws do not', async () => {
  assert.strictEqual(await pick(comp('Switch OLED (yours)'), [170.3, 30.5, 102.0]), 'switch_oled');
  assert.strictEqual(await pick(comp('Switch console (yours)'), [176.0, 13.9, 102.0]), 'switch_oled');
  assert.strictEqual(await pick(comp('Nintendo Switch (original) (yours)'), [173.0, 13.9, 102.0]), 'switch_v1');
  assert.strictEqual(await pick(comp('Switch OLED with Joy-Con (yours)'), [242, 28.4, 102]), 'switch_oled_full');
  assert.strictEqual(await pick(comp('Switch OLED screen (yours)'), [155.0, 15.4, 85.7]), null);
  assert.strictEqual(await pick(comp('Joy-Con L (yours)'), [35.9, 20.4, 102.0]), 'joycon_l');
  assert.strictEqual(await pick(comp('Right Joy-Con (yours)'), [35.9, 28.4, 102.0]), 'joycon_r');
  assert.strictEqual(await pick(comp('Joy-Con (yours)'), [35.9, 28.4, 102.0], 'R'), 'joycon_r');
  assert.strictEqual(await pick(comp('#8 x 1-1/4in wood screw x3'), [118.7, 32.8, 113.7]), null);
});

test('look-alikes and wrong sizes keep their box', async () => {
  assert.strictEqual(await pick(comp('Tactile switch 12 mm'), [12, 12, 7]), null);
  assert.strictEqual(await pick(comp('Light switch plate'), [70, 8, 115]), null);
  assert.strictEqual(await pick(comp('Switch OLED (yours)'), [60, 10, 40]), null); // far too small: not a console
  assert.strictEqual(await pick({ name: 'Switch holder', group: 'case', process: 'print' }, [176, 14, 102]), null);
  assert.strictEqual(await pick(comp('Rubber feet'), [186, 40, 3]), null);
});

test('LED sign: library ESP32-C3 SuperMini and WS2812B strip get the better models; other library parts keep theirs', async () => {
  assert.strictEqual(await pick(comp('ESP32-C3 SuperMini', { lib: { key: 'esp32_c3_supermini' }, subparts: [{}] }), [18.0, 23.5, 4.3]), 'esp32_c3_supermini');
  assert.strictEqual(await pick(comp('WS2812B LED strip, 12 LEDs', { lib: { key: 'ws2812_strip' }, subparts: [{}] }), [203.2, 10.0, 1.9]), 'ws2812b_strip');
  assert.strictEqual(await pick(comp('M3×8 countersunk screw ×4', { lib: { key: 'csk' }, subparts: [{}] }), [206, 34, 8]), null);
});

test('common bought parts by name and size', async () => {
  assert.strictEqual(await pick(comp('120mm fan'), [120, 120, 25]), 'fan_120');
  assert.strictEqual(await pick(comp('Cooling fan'), [40, 40, 10]), 'fan_40');
  assert.strictEqual(await pick(comp('NEMA 17 stepper'), [42.3, 42.3, 48]), 'nema17');
  assert.strictEqual(await pick(comp('iPhone 15 (yours)'), [71.6, 7.8, 147.6]), 'iphone_15');
  assert.strictEqual(await pick(comp('Phone (yours)'), [71.6, 7.8, 147.6]) !== null, true);
  assert.strictEqual(await pick(comp('2020 aluminium extrusion 300 mm'), [300, 20, 20]), 'extrusion_2020');
});

test('ref_model from cadlib.refmodels.ref() wins', async () => {
  assert.strictEqual(await pick(comp('Anything', { ref_model: { key: 'joycon_r', m: [] } }), [1, 1, 1]), 'joycon_r');
});

const boxPoints = (sx, sy, sz, rotX = 0, c = [0, 0, 0]) => {
  const out = [], cs = Math.cos(rotX), sn = Math.sin(rotX);
  for (const x of [-sx / 2, sx / 2]) for (const y of [-sy / 2, sy / 2]) for (const z of [-sz / 2, sz / 2]) {
    for (let k = 0; k < 5; k++) { // a few points per corner so PCA has mass at the corners
      const yy = y * cs - z * sn, zz = y * sn + z * cs;
      out.push(x + c[0], yy + c[1], zz + c[2]);
    }
  }
  return Float32Array.from(out);
};

test('fit: an upright console box faces -Y, top up, right-handed, back on the box back', async () => {
  const { orientedBox, fitMatrix } = await lib();
  const model = INDEX.find(m => m.key === 'switch_oled');
  const box = orientedBox(boxPoints(176, 13.9, 102, 0, [0, -10, 55]));
  const { m } = fitMatrix(model, box, { assemblyCenter: [0, 0, 50] });
  // model -Y (front) -> world -Y; model +Z -> world +Z
  assert.ok(m[5] > 0.99 && m[10] > 0.99 && m[0] > 0.99);
  assert.ok(Math.abs(m[3]) < 1e-6 && Math.abs(m[11] - 55) < 1e-6);
});

test('fit: a tilted (10 deg) console box is found by PCA and the model follows the tilt', async () => {
  const { orientedBox, fitMatrix } = await lib();
  const model = INDEX.find(m => m.key === 'switch_oled');
  const t = 10 * Math.PI / 180;
  const box = orientedBox(boxPoints(170, 13.9, 102, t));
  assert.ok(Math.abs(Math.min(...box.ext) - 13.9) < 0.5, `thin side ${box.ext}`);
  const { m } = fitMatrix(model, box, {});
  assert.ok(Math.abs(m[10] - Math.cos(t)) < 0.02, 'model Z follows the tilt'); // m[10] = world z of model Z
  const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
  assert.ok(det > 0.99, 'never mirrored');
});

test('fit: a strip tiles along its length; a board lies component-side up', async () => {
  const { orientedBox, fitMatrix } = await lib();
  const strip = INDEX.find(m => m.key === 'ws2812b_strip');
  const r = fitMatrix(strip, orientedBox(boxPoints(200, 10, 1.9)), {});
  assert.strictEqual(r.repeat, 12);
  const board = INDEX.find(m => m.key === 'esp32_c3_supermini');
  const b = fitMatrix(board, orientedBox(boxPoints(18, 23.5, 4.3)), {}); // rotated 90 deg in the design
  assert.ok(b.m[10] > 0.99, 'components up');
  assert.ok(Math.abs(b.m[4]) > 0.99, 'long side along world Y');
});

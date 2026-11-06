'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bp = require('./buildplan');

const box = (min, max) => ({ min, max });
const part = (name, b, extra = {}) => ({ name, group: 'component', box: b, ...extra });
const made = (name, b, extra = {}) => ({ name, group: 'case', process: 'print', box: b, ...extra });

// A small gauge: a 104 x 60 x 31.5 base, an 8 mm lid on top, a board and a charger on the floor, a battery holder with
// its cell, a display and a button mounted up in the lid, lid screws and display screws.
const gauge = () => [
  made('Base', box([-52, -30, 0], [52, 30, 31.5])),
  made('Lid', box([-52, -30, 26.5], [52, 30, 34.5]), { explode: [0, 0, 1] }),
  part('ESP32-C3 SuperMini', box([-16, -20, 4], [7, -2, 8])),
  part('TP4056 USB-C charger', box([-50, -19, 4], [-21, -2, 9])),
  part('18650 holder, 1 cell', box([-38, 6, 4], [39, 27, 23])),
  part('18650 Li-ion cell', box([-32, 7, 6], [34, 26, 24])),
  part('0.96" OLED display (SSD1306)', box([-36, -25, 20], [-8, 2, 31])),
  part('12 mm push button', box([6, -19, 17], [22, -3, 37])),
  part('Meat probe, 2.5 mm plug', box([-62, -56, -2], [120, -44, 10])),
  part('M2×5 self-tapping screw for plastic ×4', box([-36, -25, 27], [-8, 2, 34])),
  part('M3×10 self-tapping screw for plastic ×4', box([-49, -27, 24], [49, 27, 36])),
];
const W = (fp, fpin, tp, tpin, color, kind = 'solder') => ({ from: { part: fp, pin: fpin }, to: { part: tp, pin: tpin }, color, kind });
const gaugeWires = { source: 'wiring.json', wires: [
  W('18650 holder, 1 cell', '+', 'TP4056 USB-C charger', 'B+', 'red'), W('18650 holder, 1 cell', '-', 'TP4056 USB-C charger', 'B-', 'black'),
  W('TP4056 USB-C charger', 'OUT+', 'ESP32-C3 SuperMini', '5V', 'red'), W('TP4056 USB-C charger', 'OUT-', 'ESP32-C3 SuperMini', 'GND', 'black'),
  W('0.96" OLED display (SSD1306)', 'VCC', 'ESP32-C3 SuperMini', '3V3', 'red'), W('0.96" OLED display (SSD1306)', 'GND', 'ESP32-C3 SuperMini', 'GND', 'black'),
  W('0.96" OLED display (SSD1306)', 'SDA', 'ESP32-C3 SuperMini', 'GPIO6', 'blue'), W('0.96" OLED display (SSD1306)', 'SCL', 'ESP32-C3 SuperMini', 'GPIO7', 'yellow'),
  W('12 mm push button', '1', 'ESP32-C3 SuperMini', 'GPIO3', 'orange'), W('12 mm push button', '2', 'ESP32-C3 SuperMini', 'GND', 'black'),
] };
const idx = (steps, re) => steps.findIndex(s => re.test(s.title));
const stepOf = (steps, name) => steps.findIndex(s => (s.parts || []).includes(name));

test('the case is found from geometry: base, lid, inside parts', () => {
  const a = bp.analyse(gauge());
  assert.strictEqual(a.base.name, 'Base');
  assert.deepStrictEqual(a.covers.map(c => c.name), ['Lid']);
  const inside = a.P.filter(p => p.inside).map(p => p.name);
  assert.ok(inside.includes('ESP32-C3 SuperMini') && inside.includes('0.96" OLED display (SSD1306)'));
  assert.ok(!inside.includes('Meat probe, 2.5 mm plug'), 'the probe hangs outside');
  assert.strictEqual(a.P.find(p => p.name === '12 mm push button').onCover.name, 'Lid', 'the button sticks out through the lid');
  assert.strictEqual(a.P.find(p => p.name === 'ESP32-C3 SuperMini').onCover, null);
});

test('plan: base first, everything inside before the lid, wiring before the lid, test last', () => {
  const r = bp.plan(gauge(), gaugeWires);
  const s = r.steps;
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(stepOf(s, 'Base'), 0);
  const lid = stepOf(s, 'Lid');
  for (const n of ['ESP32-C3 SuperMini', 'TP4056 USB-C charger', '18650 holder, 1 cell', '18650 Li-ion cell', '0.96" OLED display (SSD1306)', '12 mm push button'])
    assert.ok(stepOf(s, n) >= 0 && stepOf(s, n) < lid, `${n} before the lid`);
  assert.ok(stepOf(s, '18650 holder, 1 cell') < stepOf(s, '18650 Li-ion cell'), 'holder before its cell');
  assert.ok(stepOf(s, 'Meat probe, 2.5 mm plug') > lid, 'the probe plugs in from outside');
  // fasteners ride with the part they fix
  assert.strictEqual(stepOf(s, 'M3×10 self-tapping screw for plastic ×4'), lid);
  assert.strictEqual(stepOf(s, 'M2×5 self-tapping screw for plastic ×4'), stepOf(s, '0.96" OLED display (SSD1306)'));
  // wiring: one step per peripheral, after both ends, before the lid; the loose cell goes in after the wiring
  const wires = s.map((x, i) => [x, i]).filter(([x]) => x.kind === 'wire');
  assert.strictEqual(wires.length, 4);
  for (const [w, i] of wires) {
    assert.ok(i < lid, `${w.title} before the lid`);
    for (const n of w.hl) assert.ok(stepOf(s, n) < i, `${n} fitted before "${w.title}"`);
  }
  assert.ok(wires.every(([, i]) => i < stepOf(s, '18650 Li-ion cell')), 'cell after the wiring');
  const oled = wires.find(([w]) => /OLED/.test(w.title))[0];
  assert.match(oled.title, /Connect the 0\.96" OLED display to the ESP32-C3 SuperMini/);
  assert.deepStrictEqual(oled.wires.map(w => w.text), ['VCC → 3V3', 'GND → GND', 'SDA → GPIO6', 'SCL → GPIO7']);
  assert.deepStrictEqual(oled.wires.map(w => w.color), ['red', 'black', 'blue', 'yellow']);
  assert.match(oled.text, /SDA → GPIO6 blue/);
  assert.match(wires[0][0].title, /18650 holder/, 'power wiring first');
  assert.strictEqual(s[s.length - 1].kind, 'test');
  assert.match(s[s.length - 1].title, /Power on and test/);
  assert.match(s[lid].title, /Close it up with the Lid/);
});

test('validate rejects a part fitted through a closed lid', () => {
  const r = bp.plan(gauge(), gaugeWires);
  const s = r.steps.map(x => ({ ...x }));
  const lid = stepOf(s, 'Lid');
  const bad = [...s];
  const [esp] = bad.splice(stepOf(bad, 'ESP32-C3 SuperMini'), 1);
  bad.splice(lid + 1, 0, esp); // board after the lid
  const errs = bp.validate(bad, r.model);
  assert.ok(errs.some(e => /ESP32-C3 SuperMini.*after.*closed the case/.test(e)), errs.join('\n'));
});

test('validate rejects wiring before a part is in, after the lid, and a test that is not last', () => {
  const r = bp.plan(gauge(), gaugeWires);
  const s = r.steps;
  const wi = s.findIndex(x => x.kind === 'wire');
  const early = [s[0], s[wi], ...s.filter((_, i) => i !== 0 && i !== wi)];
  assert.ok(bp.validate(early, r.model).some(e => /before it is fitted/.test(e)));
  const lid = stepOf(s, 'Lid');
  const late = s.filter((_, i) => i !== wi); late.splice(lid, 0, s[wi]); // after the lid (indices shift by one)
  assert.ok(bp.validate(late, r.model).some(e => /after it is closed/.test(e)));
  const t = [s[s.length - 1], ...s.slice(0, -1)];
  assert.ok(bp.validate(t, r.model).some(e => /must be the last step/.test(e)));
  const dup = [...s, { kind: 'place', title: 'x', parts: ['Base'] }];
  assert.ok(bp.validate(dup, r.model).some(e => /added twice/.test(e)));
});

test('validate rejects a cell before its holder (containment)', () => {
  const r = bp.plan(gauge(), gaugeWires);
  const s = r.steps.map(x => ({ ...x }));
  const h = stepOf(s, '18650 holder, 1 cell'), c = stepOf(s, '18650 Li-ion cell');
  [s[h], s[c]] = [s[c], s[h]];
  assert.ok(bp.validate(s, r.model).some(e => /holder.*before.*cell|must go in before/.test(e)));
});

test('no wiring list on an electronics design: a flagged "wiring missing" step before the lid', () => {
  const r = bp.plan(gauge(), { wires: [], source: null });
  assert.strictEqual(r.wiring.missing, true);
  const m = r.steps.findIndex(s => s.missing);
  assert.ok(m > 0 && m < stepOf(r.steps, 'Lid'));
  assert.match(r.steps[m].text, /Wiring missing/);
  assert.deepStrictEqual(r.errors, []);
});

test('no case and no electronics: structure by size, no wiring or test step', () => {
  const parts = [made('Shelf 1', box([0, 0, 100], [300, 200, 118])), made('Shelf 2', box([0, 0, 0], [300, 200, 18])), made('Side', box([0, 0, 0], [18, 200, 300])),
    part('M4×30 wood screw ×8', box([0, 10, 0], [300, 190, 118]))];
  const r = bp.plan(parts, { wires: [] });
  assert.deepStrictEqual(r.errors, []);
  assert.ok(r.steps.every(s => s.kind === 'place'));
  assert.strictEqual(r.model.covers.length, 0);
});

test('a sprocket goes on after the motor whose shaft it sits on', () => {
  const parts = [made('Housing', box([-71, 3, 0], [71, 46, 76])), made('Front Cover', box([-55, -12, 0], [55, 3, 76])),
    made('Sprocket', box([18, -7, 27], [45, 0, 54])), part('28BYJ-48 geared stepper 5 V', box([10, -7, 18], [52, 25, 46])),
    part('ESP32 DevKitC', box([-52, 29, 42], [3, 42, 70]))];
  const r = bp.plan(parts, { wires: [] });
  assert.deepStrictEqual(r.errors, []);
  assert.ok(stepOf(r.steps, 'Sprocket') > stepOf(r.steps, '28BYJ-48 geared stepper 5 V'));
  assert.match(r.steps[stepOf(r.steps, 'Sprocket')].title, /onto the 28BYJ-48/);
  assert.ok(stepOf(r.steps, 'Front Cover') > stepOf(r.steps, 'ESP32 DevKitC'));
});

test('wiring.md tables become wires (split "A / B" pins, colours, connector)', () => {
  const md = `# Wiring\n\n| From | Pin | To | Pin | Wire |\n|---|---|---|---|---|\n| ESP32 | GPIO25 | ULN2003 | IN1 | Dupont F-F |\n| ESP32 | 5V | ULN2003 | + (5-12V) | Dupont F-F |\n| ESP32 | GPIO21 / GPIO22 | OLED | SDA / SCL | Dupont |\n| BH1750 | ADDR | GND | | (address 0x23) |\n\nNotes\n- x`;
  const w = bp.parseWiringMd(md);
  assert.strictEqual(w.length, 5);
  assert.deepStrictEqual(w[0], { from: { part: 'ESP32', pin: 'GPIO25' }, to: { part: 'ULN2003', pin: 'IN1' }, color: '', kind: 'Dupont', note: '' });
  assert.strictEqual(w[1].color, 'red');
  assert.deepStrictEqual([w[2].from.pin, w[2].to.pin, w[3].from.pin, w[3].to.pin], ['GPIO21', 'SDA', 'GPIO22', 'SCL']);
  assert.deepStrictEqual(w[4].to, { part: 'BH1750', pin: 'GND' });
  const parts = [{ name: 'ESP32 DevKitC (WROOM-32, 38 pin)' }, { name: 'ULN2003 driver board' }, { name: '12 mm push button' }];
  assert.strictEqual(bp.matchPart('ESP32', parts).name, 'ESP32 DevKitC (WROOM-32, 38 pin)');
  assert.strictEqual(bp.matchPart('Push button', parts).name, '12 mm push button');
  assert.strictEqual(bp.matchPart('BH1750', parts), null);
});

test('resistors and capacitors join the peripheral that shares their signal pin', () => {
  const w = [W('Probe jack', 'Tip', 'ESP32', 'GPIO1', 'green'), W('Probe jack', 'Sleeve', 'ESP32', 'GND', 'black'),
    W('ESP32', '3V3', '100k resistor', '1', 'red'), W('100k resistor', '2', 'ESP32', 'GPIO1', 'green'),
    W('470k resistor', 'R1 a', 'Charger', 'OUT+', 'red'), W('470k resistor', 'R1 b', 'ESP32', 'GPIO0', 'white'),
    W('Button', '1', 'ESP32', 'GPIO3', 'orange'), W('Button', '2', 'ESP32', 'GND', 'black')];
  const g = bp.groupWires(w);
  const jack = g.find(x => x.periph === 'Probe jack');
  assert.deepStrictEqual(jack.extra, ['100k resistor']);
  assert.strictEqual(jack.wires.length, 4);
  assert.ok(g.find(x => x.periph === '470k resistor' && x.passive), 'the divider gets a step of its own');
  assert.ok(g.find(x => x.periph === 'Button'));
});

test('STL bounds: binary and ASCII', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-'));
  const b = Buffer.alloc(84 + 50); b.writeUInt32LE(1, 80);
  [[1, 2, 3], [4, -5, 6], [-7, 8, 9]].forEach((v, i) => v.forEach((x, j) => b.writeFloatLE(x, 84 + 12 + 12 * i + 4 * j)));
  fs.writeFileSync(path.join(d, 'a.stl'), b);
  assert.deepStrictEqual(bp.stlBox(path.join(d, 'a.stl')), { min: [-7, -5, 3], max: [4, 8, 9] });
  fs.writeFileSync(path.join(d, 'b.stl'), 'solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 5 -2\nendloop\nendfacet\nendsolid x\n');
  assert.deepStrictEqual(bp.stlBox(path.join(d, 'b.stl')), { min: [0, 0, -2], max: [10, 5, 0] });
  // buildPlan reads boxes only from files inside the design folder
  fs.writeFileSync(path.join(d, 'manifest.json'), '{}');
  const r = bp.buildPlan(d, { parts: [{ name: 'A', group: 'case', file: 'a.stl' }, { name: 'B', group: 'case', file: '../../etc/passwd' }] });
  assert.strictEqual(r.steps.length, 2);
  fs.rmSync(d, { recursive: true, force: true });
});

test('"Power on and test" names what this design does, from its own parts', () => {
  const all = bp.plan(gauge(), gaugeWires, { firmware: true }).steps, g = all.at(-1);
  assert.strictEqual(g.kind, 'test');
  assert.strictEqual(all.at(-2).kind, 'flash'); // firmware: its own step just before, pointing at Flash to my ESP32
  assert.match(all.at(-2).title, /^Flash the firmware/);
  assert.match(all.at(-2).text, /Flash to my ESP32/);
  assert.strictEqual(bp.plan(gauge(), gaugeWires, { firmware: false }).steps.at(-2).kind !== 'flash', true);
  assert.match(g.text, /Charge it over USB-C/);
  assert.match(g.text, /OLED display shows its start screen/);
  assert.match(g.text, /Meat probe reads room temperature/);
  assert.match(g.text, /pressing the 12 mm push button/);
  // a desk robot: tracks, a tilt servo, cliff sensors, a phone puck and a rocker switch; no "each button responds"
  const robot = [made('Chassis', box([-53, 6, -50], [53, 40, 50])), made('Head back', box([-42, 47, -24], [42, 128, -2])),
    made('Track L', box([-68, -1, -49], [-54, 35, 49])), part('Magnetic charger puck', box([-29, 66, -1], [29, 125, 5])),
    part('SG90 micro servo', box([20, 47, -28], [50, 60, 18])), part('N20 gear motor 6V 100rpm', box([-50, 11, 27], [-26, 23, 37])),
    part('2x18650 battery shield (USB-C)', box([-50, 8, -22], [50, 10, 26])), part('TCRT5000 cliff sensor', box([-25, 6, 40], [-11, 38, 46])),
    part('D4184 MOSFET module (charger switch)', box([13, 8, -47], [47, 18, -30])), part('Mini rocker switch', box([9, 23, -52], [22, 32, -34])),
    part('M3×8 button head screw ×3', box([-40, 56, -6], [40, 98, 3]))];
  const t = bp.plan(robot, { wires: [] }).steps.at(-1).text;
  assert.match(t, /switch it on with the Mini rocker switch/);
  assert.match(t, /phone starts charging/);
  assert.match(t, /head tilts/);
  assert.match(t, /on its tracks/);
  assert.match(t, /edge of the desk/);
  assert.doesNotMatch(t, /each button responds|readings look right|button head/);
  // nothing recognisable: a short neutral check
  const plain = bp.plan([made('Box', box([0, 0, 0], [50, 50, 20])), part('Custom PCB board', box([5, 5, 2], [45, 45, 6]))], { wires: [] }).steps.at(-1).text;
  assert.match(plain, /Check that it starts up and nothing gets hot/);
});

test('wiring.list: every wire with the model part each end maps to (null: not in the model)', () => {
  const r = bp.plan(gauge(), { source: 'wiring.json', wires: [...gaugeWires.wires, W('ESP32-C3 SuperMini', 'GPIO4', 'Piezo buzzer', '+', '', 'dupont')] });
  const L = r.wiring.list;
  assert.strictEqual(L.length, gaugeWires.wires.length + 1);
  assert.deepStrictEqual(L[0].from, { part: '18650 holder, 1 cell', pin: '+', model: '18650 holder, 1 cell', file: null });
  assert.strictEqual(L[0].color, 'red');
  const bz = L[L.length - 1];
  assert.strictEqual(bz.to.model, null, 'the buzzer is not in the model');
  assert.strictEqual(bz.from.model, 'ESP32-C3 SuperMini');
  assert.strictEqual(bz.kind, 'dupont');
});

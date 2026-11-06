// node --test server/editparts.test.js   (editglow: which parts an agent edit to design.py touches)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const EP = require('./editparts');

const SRC = `import cadquery as cq
from cadlib.parts import part

L1 = 150     # link length
W = 26
PLATE_T = 6


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane().box(x1 - x0, y1 - y0, z1 - z0)


def link(p, q, t, w=W):
    s = cq.Workplane().slot2D(L1 + w, w).extrude(t)
    return s


def parts():
    out = []
    corner = None

    def addc(s):
        nonlocal corner
        corner = s if corner is None else corner.union(s)

    for x in (-1, 1):
        addc(box(x, x + 1, 0, 1, 0, 1))
    plate = box(-100, 100, -80, 80, 0, PLATE_T)
    plate = plate.cut(box(-5, 5, -5, 5, 0, PLATE_T))
    out.append({"name": "Base plate", "shape": plate, "group": "case"})
    out.append({"name": "Link 1", "shape": link((0, 0), (1, 0), 26),
                "group": "case", "color": "#e8702a"})
    out.append({"name": "Link 2", "shape": link((1, 0), (2, 0), 20), "group": "case"})
    for i in range(2):
        out.append({"name": f"Leg {i + 1}", "shape": box(0, 1, 0, 1, 0, 1)})
    out.append(part("nema17_40", at=(0, 0, 0)))
    out.append(part("m3x10_standoff", at=[(0, 0, 0), (1, 1, 0)]))
    out.append({"name": "Corner bracket", "shape": corner})
    return out
`;
const MAN = { parts: [
  { name: 'Base plate' }, { name: 'Link 1' }, { name: 'Link 2' }, { name: 'Leg 1' }, { name: 'Leg 2' },
  { name: 'NEMA17 stepper motor 40 mm', lib: { key: 'nema17' } }, { name: 'M3×10 brass standoff ×2', lib: { key: 'standoff' } },
  { name: 'Corner bracket' },
] };
const edit = (old_string, new_string = old_string + ' ') => EP.partsForEdit('Edit', { file_path: 'design.py', old_string, new_string }, SRC, MAN);
const lineOf = (needle) => SRC.split('\n').findIndex((l) => l.includes(needle));

test('a statement belongs to the part it names', () => {
  assert.deepStrictEqual(edit('"group": "case", "color": "#e8702a"})').parts, ['Link 1']);
  assert.deepStrictEqual(edit('link((1, 0), (2, 0), 20)').parts, ['Link 2']);
});

test('setup lines belong to the part that uses what they assign', () => {
  assert.deepStrictEqual(edit('plate = plate.cut(box(-5, 5, -5, 5, 0, PLATE_T))').parts, ['Base plate']);
  // a nested helper writing a nonlocal: its calls build the corner bracket
  assert.deepStrictEqual(edit('addc(box(x, x + 1, 0, 1, 0, 1))').parts, ['Corner bracket']);
});

test('helper functions map to the parts that call them; constants to the parts that use them', () => {
  assert.deepStrictEqual(edit('s = cq.Workplane().slot2D(L1 + w, w).extrude(t)').parts, ['Link 1', 'Link 2']);
  assert.deepStrictEqual(edit('L1 = 150     # link length').parts, ['Link 1', 'Link 2']);
  assert.deepStrictEqual(edit('PLATE_T = 6').parts, ['Base plate']);
});

test('f-string names and library keys', () => {
  assert.deepStrictEqual(edit('out.append({"name": f"Leg {i + 1}"').parts, ['Leg 1', 'Leg 2']);
  assert.deepStrictEqual(edit('part("nema17_40", at=(0, 0, 0))').parts, ['NEMA17 stepper motor 40 mm']);
  assert.deepStrictEqual(edit('part("m3x10_standoff"').parts, ['M3×10 brass standoff ×2']);
});

test('a helper used by most of the model is not "everything"', () => {
  const lp = EP.lineParts(SRC, EP.vocab(MAN));
  assert.ok(lp[lineOf('return cq.Workplane().box(')].size <= EP.MAX_PARTS);
});

test('new parts, labels, already-applied edits and unknowns', () => {
  const r = edit('out.append({"name": "Corner bracket", "shape": corner})',
    'out.append({"name": "Corner bracket", "shape": corner})\n    out.append({"name": "Spool holder", "shape": box(0, 1, 0, 1, 0, 1)})');
  assert.deepStrictEqual(r.parts, ['Corner bracket']);
  assert.deepStrictEqual(r.added, ['Spool holder']);
  assert.strictEqual(EP.editLabel(r), 'Editing Corner bracket');
  assert.strictEqual(EP.editLabel({ parts: [], added: ['Spool holder'] }), 'Adding Spool holder');
  assert.strictEqual(EP.editLabel({ parts: ['A', 'B', 'C', 'D', 'E'], added: [] }), 'Editing A · B · C · +2 more');
  // the edit already landed on disk: found by its new_string
  assert.deepStrictEqual(EP.partsForEdit('Edit', { old_string: 'nothing like this', new_string: 'link((1, 0), (2, 0), 20)' }, SRC, MAN).parts, ['Link 2']);
  assert.strictEqual(edit('import cadquery as cq'), null);
  assert.strictEqual(EP.partsForEdit('Edit', { old_string: 'x' }, '', MAN), null); // no design yet
  assert.strictEqual(EP.partsForEdit('Edit', { old_string: 'x' }, SRC, { parts: [] }), null); // no model yet
});

test('Write: only the lines that changed', () => {
  const content = SRC.replace('PLATE_T = 6', 'PLATE_T = 8');
  assert.deepStrictEqual(EP.partsForEdit('Write', { content }, SRC, MAN).parts, ['Base plate']);
  assert.strictEqual(EP.partsForEdit('Write', { content: 'print(1)\n' }, SRC, MAN), null); // a rewrite
});

test('MultiEdit and statements listing several parts', () => {
  const src = 'def parts():\n    pot = 1\n    lid = 2\n    return [\n        {"name": "Pot", "shape": pot},\n        {"name": "Lid", "shape": lid},\n    ]\n';
  const man = { parts: [{ name: 'Pot' }, { name: 'Lid' }] };
  assert.deepStrictEqual(EP.partsForEdit('Edit', { old_string: 'lid = 2', new_string: 'lid = 3' }, src, man).parts, ['Lid']);
  assert.deepStrictEqual(EP.partsForEdit('MultiEdit', { edits: [{ old_string: 'pot = 1', new_string: 'pot = 2' }, { old_string: 'lid = 2', new_string: 'lid = 3' }] }, src, man).parts, ['Pot', 'Lid']);
});

test('narration: whole names, case-insensitive for multi-word names', () => {
  assert.deepStrictEqual(EP.namesInText('Thickening link 1 and Link 2, and widening the base plate.', MAN), ['Base plate', 'Link 1', 'Link 2']);
  const man = { parts: [{ name: 'Base' }, { name: 'Lid' }] };
  assert.deepStrictEqual(EP.namesInText('at the base of it, then the lid', man), []); // single words: exact case, ≥ 4 chars
  assert.deepStrictEqual(EP.namesInText('Moving the Base down', man), ['Base']);
});

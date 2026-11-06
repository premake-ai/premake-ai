// node --test server/askmock.test.js  (question-card option mock-ups: model boxes, prompt, targets, attach, job)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const M = require('./askmock');
const B = require('./agentbrain');

const man = { parts: [{ name: 'Base', file: 'stl/base.stl' }, { name: 'Z motor', file: 'stl/z.stl' }, { name: 'Ghost', file: 'stl/missing.stl' }] };
const boxes = { 'stl/base.stl': { min: [-100, -80, 0], max: [100, 80, 20] }, 'stl/z.stl': { min: [-21, 10, 150], max: [21, 52, 198] } };

test('modelBoxes: named boxes from each part, overall bounds, skips parts without geometry', () => {
  const b = M.modelBoxes(man, (p) => boxes[p.file] || null);
  assert.equal(b.parts.length, 2);
  assert.deepEqual(b.min, [-100, -80, 0]);
  assert.deepEqual(b.max, [100, 80, 198]);
  assert.equal(M.modelBoxes({ parts: [] }, () => null), null);
  assert.equal(M.modelBoxes(null, () => null), null);
});

test('partsForPrompt: biggest parts first, capped', () => {
  const b = M.modelBoxes(man, (p) => boxes[p.file] || null);
  assert.deepEqual(M.partsForPrompt(b, 1).map((p) => p.name), ['Base']);
});

test('mockPrompt: request, question, option and the model boxes', () => {
  const b = M.modelBoxes(man, (p) => boxes[p.file] || null);
  const t = M.mockPrompt({ request: 'tilt  the\nspindle', question: { question: 'How should it tilt?' }, option: { label: 'Gimbal', detail: '2 steppers' }, boxes: b });
  assert.match(t, /The user's request: tilt the spindle/);
  assert.match(t, /Option to draw: Gimbal \(2 steppers\)/);
  assert.match(t, /- Z motor: \[-21, 10, 150\] -> \[21, 52, 198\]/);
  assert.match(M.mockPrompt({ question: { question: 'Q' }, option: { label: 'A' }, boxes: null }), /no model yet/);
});

test('mockTargets: only mockup questions, skips options that have one, capped', () => {
  const qs = [{ id: 'a', mockup: true, options: [{ label: 'X' }, { label: 'Y', mock: { parts: [] } }] }, { id: 'b', options: [{ label: 'Z' }] }];
  assert.deepEqual(M.mockTargets(qs).map((t) => t.key), ['a\nx']);
  const many = [{ id: 'q', mockup: true, options: Array.from({ length: 12 }, (_, i) => ({ label: 'o' + i })) }];
  assert.equal(M.mockTargets(many).length, M.MAX_CALLS);
});

test('attachMocks: by question id and label (case-insensitive), never overwrites', () => {
  const qs = [{ id: 'a', options: [{ label: 'Gimbal' }, { label: 'Hinge', mock: 'old' }] }];
  const n = M.attachMocks(qs, new Map([['a\ngimbal', 'G'], ['a\nhinge', 'H']]));
  assert.equal(n, 1);
  assert.equal(qs[0].options[0].mock, 'G');
  assert.equal(qs[0].options[1].mock, 'old');
});

test('createJob: runs every target in parallel and reports each result', async () => {
  const qs = [{ id: 'a', question: 'Q', mockup: true, options: [{ label: 'One' }, { label: 'Two' }, { label: 'Bad' }] }];
  const seen = [];
  let live = 0, peak = 0;
  const job = M.createJob(qs, { request: 'r', boxes: null }, {
    run: async (prompt) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 10)); live--; return /Bad/.test(prompt) ? null : { parts: [{ shape: 'box' }] }; },
    onResult: (key) => seen.push(key),
  });
  assert.equal(job.pending, 3);
  await job.done;
  assert.equal(peak, 3);
  assert.equal(job.pending, 0);
  assert.deepEqual(seen.sort(), ['a\none', 'a\ntwo']);
  assert.equal(job.results.size, 2);
});

test('cleanQuestions keeps the mockup flag only when it is true', () => {
  const qs = B.cleanQuestions({ questions: [{ id: 'm', question: 'How?', mockup: true, options: ['A', 'B'] }, { id: 'n', question: 'Why?', mockup: 'yes', options: ['C'] }] });
  assert.equal(qs[0].mockup, true);
  assert.equal('mockup' in qs[1], false);
});

test('openEnded: questions and loose ideas yes, clear edits no', () => {
  assert.ok(M.openEnded('I want a rod that tilts the spindle. How could this work?'));
  assert.ok(M.openEnded('some ideas for a lid mechanism'));
  assert.ok(!M.openEnded('Make the base 5 mm thicker'));
  assert.ok(!M.openEnded('change the colour to blue'));
});

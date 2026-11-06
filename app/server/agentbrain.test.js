// node --test server/agentbrain.test.js  (question cards, per-user prefs, stop status, titles, manual-order lines, soldering add-on)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const B = require('./agentbrain');
const shops = require('./prices/suppliers');
const F = require('./fulfilment');

test('cleanQuestions: caps, cleans and drops unusable questions', () => {
  const qs = B.cleanQuestions({ questions: [
    { id: 'Soldering!', question: 'Are you comfortable soldering?', options: ['Yes', 'No', 'Other', 'yes', { label: 'Maybe', detail: 'a little' }] },
    { question: 'No options here' },
    { id: 'tools', question: 'What tools do you have?', options: ['3D printer', 'Drill'], multiSelect: true },
    { id: 'tools', question: 'Duplicate id', options: ['A'] },
    { id: 'x', question: 'Fourth', options: ['A'] },
  ] });
  assert.equal(qs.length, 3);
  assert.equal(qs[0].id, 'soldering');
  assert.deepEqual(qs[0].options, [{ label: 'Yes' }, { label: 'No' }, { label: 'Maybe', detail: 'a little' }]);
  assert.equal(qs[1].multi, true);
  assert.equal(qs[2].id, 'tools_2');
  assert.deepEqual(B.cleanQuestions('junk'), []);
});

test('readQuestions reads and removes questions.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-'));
  assert.equal(B.readQuestions(dir), null);
  fs.writeFileSync(path.join(dir, B.QUESTIONS_FILE), JSON.stringify({ questions: [{ id: 'build_type', question: 'Fun or permanent?', options: ['Fun', 'Permanent'] }] }));
  const qs = B.readQuestions(dir);
  assert.equal(qs[0].id, 'build_type');
  assert.ok(!fs.existsSync(path.join(dir, B.QUESTIONS_FILE)));
  fs.writeFileSync(path.join(dir, B.QUESTIONS_FILE), '{not json');
  assert.equal(B.readQuestions(dir), null);
});

test('answers are matched to the asked questions and remembered per user', () => {
  const asked = [{ id: 'soldering', question: 'Solder?' }, { id: 'tools', question: 'Tools?' }];
  const ans = B.cleanAnswers(asked, { soldering: 'No soldering please', tools: ['3D printer', 'Screwdriver'], evil: 'x' });
  assert.deepEqual(ans.map((a) => a.answer), ['No soldering please', '3D printer, Screwdriver']);
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-'));
  const s = B.store(DATA);
  s.saveAnswers('Josh@x.com', ans);
  const ctx = B.prefsContext(s.get('josh@x.com'));
  assert.match(ctx, /Solder\?: No soldering please/);
  assert.equal(B.prefsContext(s.get('other@x.com')), '');
  s.forget('josh@x.com', 'tools');
  assert.deepEqual(Object.keys(s.get('josh@x.com').answers), ['soldering']);
});

test('effort: allowlisted, default medium, persisted', () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-'));
  const s = B.store(DATA);
  assert.equal(s.effortOf('a@x.com'), 'medium');
  assert.equal(s.setEffort('a@x.com', 'turbo'), false);
  assert.equal(s.setEffort('a@x.com', 'xhigh'), false);
  assert.equal(s.setEffort('a@x.com', 'max'), true);
  assert.equal(B.store(DATA).effortOf('a@x.com'), 'max');
  assert.deepEqual(B.EFFORTS, ['low', 'medium', 'high', 'max']);
});

test('stopStatus says why a run stopped', () => {
  const run = { startedAt: Date.now() - 25 * 60e3 };
  assert.match(B.stopStatus({ ...run, stopReason: 'cap' }, 25 * 60e3).text, /Stopped after 25 min/);
  assert.match(B.stopStatus({ ...run, stopReason: 'stall' }, 25 * 60e3).text, /no progress/);
  assert.equal(B.stopStatus({ ...run, stopReason: 'user' }, 25 * 60e3).continuable, true);
});

test('titles: model output and user renames are cleaned', () => {
  assert.equal(B.cleanTitle('"Telescopic Camping Light."\n'), 'Telescopic Camping Light');
  assert.equal(B.cleanTitle('Title: Wi-Fi Lockbox'), 'Wi-Fi Lockbox');
  assert.equal(B.cleanTitle('This is a very long sentence that is not a title at all'), '');
  assert.equal(B.cleanUserTitle('  My <b>lamp</b> '), 'My blamp/b');
  assert.equal(B.cleanUserTitle(''), '');
  assert.equal(B.cleanUserTitle('x'.repeat(81)), '');
  const args = B.titleArgs('claude-opus-5-5');
  assert.ok(args.includes('--tools') && args.includes('claude-opus-5-5') && args.includes('low'));
});

test('soldering add-on only for designs that need soldering', () => {
  assert.deepEqual(B.addonsFor({ needs_soldering: true }, ['soldering_iron']).map((a) => a.id), ['soldering_iron']);
  assert.deepEqual(B.addonsFor({ needs_soldering: false }, ['soldering_iron']), []);
  assert.deepEqual(B.addonsFor({}, undefined), []);
  assert.throws(() => B.addonsFor({ needs_soldering: true }, ['free_tv']), /addons/);
  assert.throws(() => B.addonsFor({}, 'soldering_iron'), /list/);
});

test('manual-order lines keep their shop; others still become Amazon', () => {
  const manual = { name: 'Recliner', supplier: 'Walmart', url: 'https://www.walmart.com/ip/123', manual_order: true };
  assert.equal(shops.normalizePart(manual).supplier, 'Walmart');
  assert.equal(shops.normalizePart({ ...manual, url: '' }).supplier, 'Amazon'); // no real link: ordered normally
  assert.equal(shops.normalizePart({ name: 'Screw', supplier: 'McMaster-Carr' }).supplier, 'Amazon');
});

test('planJobs: manual-order lines and the soldering iron add-on never crash ordering', () => {
  const L = { bom: {}, lines: [
    { id: 'bought:0', type: 'bought', name: 'Recliner', supplier: 'Walmart', manual_order: true, options: [{ service: 'Walmart', kind: 'link', url: 'https://www.walmart.com/ip/123' }] },
    { id: 'bought:1', type: 'bought', name: 'ESP32', supplier: 'Amazon', options: [{ service: 'Amazon', kind: 'link', url: 'https://www.amazon.com/dp/B0' }] }] };
  const jobs = F.planJobs({ id: 'o', qty: 2, addons: [{ id: 'soldering_iron', name: 'Soldering iron kit', usd: 16, search: 'soldering iron kit' }] }, L);
  const manual = jobs.find((j) => j.supplier === 'other');
  assert.ok(manual && manual.manual && manual.parts[0].manual_order && manual.parts[0].shop === 'Walmart');
  const amazon = jobs.find((j) => j.supplier === 'amazon');
  const iron = amazon.parts.find((p) => p.addon);
  assert.equal(iron.qty, 1);
  assert.match(iron.url, /amazon\.com\/s\?k=soldering/);
  assert.doesNotThrow(() => F.jobCost ? jobs.forEach((j) => F.jobCost(j)) : null);
});

test('titleFromPrompt skips filler lead-ins ("Can you build this:") and never returns "This"', () => {
  assert.equal(B.titleFromPrompt('Can you build this: a little desk robot that uses my smartphone as its face. Like LOOI'), 'Little desk robot');
  assert.equal(B.titleFromPrompt('Can you build this: a telescopic camping light that extends up like a pole'), 'Telescopic camping light');
  assert.equal(B.titleFromPrompt('Design a cube with'), 'Cube');
  assert.equal(B.titleFromPrompt('I want you to make me a wall mount for two game controllers'), 'Wall mount for two game controllers');
  assert.equal(B.titleFromPrompt('Make one like this:\n\n[Attached images: ./uploads/x.jpg — Read each image]'), 'Untitled');
  assert.equal(B.titleFromPrompt('https://stickerbox.com/ Can you build this'), 'Untitled');
  assert.equal(B.titleFromPrompt('This'), 'Untitled');
});

test('titleFallback names a filler-titled design from its description', () => {
  assert.equal(B.titleFallback({ title: 'This', title_auto: true, description: 'Backyard privacy and noise screen bay in highway noise-wall style.' }), 'Backyard privacy and noise screen bay');
  assert.equal(B.titleFallback({ title: 'Untitled', title_auto: true, description: '' }), '');
  assert.equal(B.titleFallback({ title: 'Desk Robot', title_auto: true, description: 'A robot.' }), '');
  assert.equal(B.titleFallback({ title: 'This', title_auto: false, description: 'A robot.' }), '');
});

test('isPromptEcho spots a title that only repeats the request', () => {
  for (const x of ['Design a product based on this', 'Design this: a fold-up CNC plasma', 'The image I attached is a', 'Make me a', 'Product based on this image', 'Can you build this'])
    assert.ok(B.isPromptEcho(x), x);
  for (const x of ['Desk Watering Can', 'Fold-Up CNC Plasma Table', 'Model Rocket Stand', 'Weighted Headphone Stand', 'Wi-Fi Pet Feeder', 'Delta 3D Printer'])
    assert.ok(!B.isPromptEcho(x), x);
  assert.equal(B.titleFromPrompt('Design a product based on this image.\n\n[Attached images: ./uploads/x.jpg — Read each image]'), 'Untitled');
  assert.equal(B.titleFallback({ title: 'Design a product based on this', description: 'A compact desk watering can for houseplants with an angled spout.' }), 'Compact desk watering can');
});

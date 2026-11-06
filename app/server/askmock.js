// askmock: quick 3D mock-ups for the options of a question card (server/agentbrain.js questions).
//
// A question the agent marks `"mockup": true` gets one rough mock-up per option: a few primitives in the instant
// sketch's JSON shape (box / cylinder / sphere, CAD mm, Z up), placed on the CURRENT model (its parts' bounding boxes
// go into the prompt), drawn by one fast low-effort call per option, all in parallel. The studio shows an option's
// mock-up over the real model while it is hovered (desktop) or tapped (phone).
//
// Timing: server.js starts the calls the moment the agent's Write of ./questions.json streams in (before its turn
// ends), so the mock-ups usually land a few seconds after the card appears. Results are saved on the assistant message
// (questions[i].options[j].mock) once it exists, and pushed live as an `ask_mock` event.
'use strict';

const MAX_CALLS = 8;     // per card (each is its own short-lived CLI process)
const MAX_PARTS_LIST = 70;

const MOCK_SYSTEM = `You draw quick 3D mock-ups of one design option on top of an existing model, like a designer's napkin sketch. Output ONLY one JSON object, no prose, no code fences:
{"parts": [2 to 5 items, each {"name": "1-3 words", "shape": "box" | "cylinder" | "sphere", "size": [x, y, z] (box only, mm), "r": radius mm (cylinder, sphere), "h": height mm (cylinder), "axis": "x" | "y" | "z" (cylinder axis, default z), "at": [x, y, z] centre in mm, "color": "#rrggbb"}]}
Units mm, the existing model's own CAD coordinates (Z up). Draw ONLY what this option adds or changes (the new mechanism, bracket, motor, rod...), never the existing parts again. Place it where it would really go, touching or mounted on the existing parts it attaches to (their min/max boxes are listed), at real-world size. As few simple masses as show the idea (the main ones only, nothing under 3 mm, no fasteners). Colours: printed parts #e8590c, metal #9ca3af, motors and electronics #3f3f46, other #a8a29e. Different options of one question must look clearly different.`;

const r1 = (v) => Math.round(v * 10) / 10;
const fmt = (a) => `[${a.map((v) => r1(v)).join(', ')}]`;

/** The current model as named boxes: [{ name, min, max }] plus the overall box. boxOf(part) -> { min, max } | null. */
function modelBoxes(man, boxOf) {
  const parts = [];
  for (const p of man?.parts || []) {
    const b = boxOf(p);
    if (!b || !Array.isArray(b.min) || !Array.isArray(b.max)) continue;
    parts.push({ name: String(p.name || p.file || 'part').slice(0, 60), min: b.min, max: b.max });
  }
  if (!parts.length) return null;
  const min = [0, 1, 2].map((i) => Math.min(...parts.map((p) => p.min[i])));
  const max = [0, 1, 2].map((i) => Math.max(...parts.map((p) => p.max[i])));
  return { parts, min, max };
}

/** Big parts first (they're what new things mount on), then the rest, capped for the prompt. */
function partsForPrompt(boxes, n = MAX_PARTS_LIST) {
  const vol = (p) => (p.max[0] - p.min[0]) * (p.max[1] - p.min[1]) * (p.max[2] - p.min[2]);
  return [...boxes.parts].sort((a, b) => vol(b) - vol(a)).slice(0, n);
}

/** The user message for one option's mock-up call. */
function mockPrompt({ request, question, option, boxes }) {
  const L = [];
  if (request) L.push(`The user's request: ${String(request).replace(/\s+/g, ' ').trim().slice(0, 900)}`);
  L.push(`Question: ${question.question}`);
  L.push(`Option to draw: ${option.label}${option.detail ? ` (${option.detail})` : ''}`);
  if (boxes) {
    L.push(`Existing model, overall min ${fmt(boxes.min)} max ${fmt(boxes.max)}. Its parts (name: min -> max, mm):`);
    for (const p of partsForPrompt(boxes)) L.push(`- ${p.name}: ${fmt(p.min)} -> ${fmt(p.max)}`);
  } else L.push('There is no model yet: draw the option on its own, standing on Z = 0, centred on X = 0, Y = 0.');
  L.push('Return the JSON mock-up of just this option.');
  return L.join('\n');
}

/** A message that may well get a question card with design options (a question, an idea, a new mechanism). */
const OPEN_ENDED = /\?|\bhow (could|would|should|can|do|does)\b|\b(ideas?|options?|ways?|mechanism|something (like|that)|not sure|what if|could (we|i|it))\b/i;
const openEnded = (text) => OPEN_ENDED.test(String(text || '').slice(0, 2000));

const keyOf = (qid, label) => `${qid}\n${String(label).toLowerCase()}`;

/** The (question, option) pairs to draw: options of questions marked mockup, capped. */
function mockTargets(questions, max = MAX_CALLS) {
  const out = [];
  for (const q of questions || []) {
    if (!q?.mockup) continue;
    for (const o of q.options || []) { if (out.length >= max) return out; if (!o.mock) out.push({ q, o, key: keyOf(q.id, o.label) }); }
  }
  return out;
}

/** Put finished mock-ups ({ key -> sketch }) onto a question list; returns how many options got one. */
function attachMocks(questions, results) {
  let n = 0;
  for (const q of questions || []) for (const o of q.options || []) {
    const sk = results.get(keyOf(q.id, o.label));
    if (sk && !o.mock) { o.mock = sk; n++; }
  }
  return n;
}

/**
 * One card's mock-up job. deps: { run(prompt) -> Promise<sketch|null>, onResult(key, sketch) }.
 * start() fires every call at once; results arrive through onResult as each one lands.
 */
function createJob(questions, ctx, deps) {
  const job = { results: new Map(), pending: 0, started: Date.now(), msgT: null, questions, done: null, ms: [] };
  const targets = mockTargets(questions);
  job.pending = targets.length;
  job.done = Promise.all(targets.map(({ q, o, key }) => deps.run(mockPrompt({ ...ctx, question: q, option: o }))
    .then((sk) => { if (sk) { job.results.set(key, sk); job.ms.push(Date.now() - job.started); deps.onResult?.(key, sk, q, o); } })
    .catch(() => {})
    .finally(() => { job.pending--; })));
  return job;
}

module.exports = { openEnded, MOCK_SYSTEM, MAX_CALLS, modelBoxes, partsForPrompt, mockPrompt, mockTargets, attachMocks, createJob, keyOf };

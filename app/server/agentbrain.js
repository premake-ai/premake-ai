// agentbrain: the design agent's clarifying questions, per-user preferences (answers + effort), run stop reasons and
// auto titles. Pure helpers plus a small JSON store; server.js wires them into startAgent / finishRun / the messages API.
//
//   questions   The agent may end a turn by writing ./questions.json {questions:[{id, question, options[], multi}]}.
//               finishRun reads it (readQuestions), deletes it, and stores the cleaned list on the assistant message
//               (m.questions). The studio shows a question card; answers come back as the next user message plus
//               body.answers, which are saved per user (savePrefs) and fed to every later turn (prefsContext), so the
//               agent doesn't ask again.
//   effort      The design agent's Claude Code effort level per user (EFFORTS allowlist, default medium).
//   stops       Why a run stopped (stopStatus): the user, the 25 min cap or the no-progress watchdog. Saved on the
//               message (m.status) so the chat shows it with a Continue button.
//   titles      A short product name for a new design (titleArgs / cleanTitle), from one low-effort, tool-less call.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const EFFORTS = ['low', 'medium', 'high', 'max']; // `claude --help`: --effort <level> (low, medium, high, max)
const DEFAULT_EFFORT = 'medium'; // owner (3 Nov): medium by default - high was 4-5x slower for everyday designs
const MAX_Q = 3, MAX_OPT = 6, MAX_PREFS = 24;
const QUESTIONS_FILE = 'questions.json';

const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
const slug = (s) => str(s, 60).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

/** Clean the agent's questions (untrusted: it may have read web pages). Returns [] when there is nothing usable. */
function cleanQuestions(j) {
  const list = Array.isArray(j?.questions) ? j.questions : Array.isArray(j) ? j : [];
  const out = [], ids = new Set();
  for (const q of list) {
    if (out.length >= MAX_Q) break;
    if (!q || typeof q !== 'object') continue;
    const question = str(q.question || q.q || q.text, 160);
    if (!question) continue;
    let id = slug(q.id) || slug(question);
    while (ids.has(id)) id += '_2';
    ids.add(id);
    const options = [];
    for (const o of Array.isArray(q.options) ? q.options : []) {
      const label = str(typeof o === 'string' ? o : o?.label, 60);
      const detail = typeof o === 'object' && o ? str(o.detail || o.description, 180) : '';
      if (label && !options.some((x) => x.label.toLowerCase() === label.toLowerCase()) && !/^(other|skip)\b/i.test(label)) options.push(detail ? { label, detail } : { label });
      if (options.length >= MAX_OPT) break;
    }
    if (!options.length) continue; // free-text questions belong in the reply, not a card
    out.push({ id, question, options, multi: q.multi === true || q.multiSelect === true, ...(q.mockup === true ? { mockup: true } : {}) }); // askmock: draw each option
  }
  return out;
}

/** Read, clean and remove ./questions.json from a design dir (null when there is none). */
function readQuestions(dir) {
  const p = path.join(dir, QUESTIONS_FILE);
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); } catch { return null; }
  try { fs.rmSync(p, { force: true }); } catch {}
  let j; try { j = JSON.parse(raw); } catch { return null; }
  const qs = cleanQuestions(j);
  return qs.length ? qs : null;
}

/** Answers from the studio: { id: string | string[] } -> [{ id, question, answer }] for the questions that were asked. */
function cleanAnswers(asked, answers) {
  if (!Array.isArray(asked) || !answers || typeof answers !== 'object') return [];
  const out = [];
  for (const q of asked) {
    const v = answers[q.id];
    const a = Array.isArray(v) ? v.map((x) => str(x, 80)).filter(Boolean).slice(0, MAX_OPT + 1).join(', ') : str(v, 200);
    if (a) out.push({ id: q.id, question: q.question, answer: a });
  }
  return out;
}

// ---------------------------------------------------------------- per-user prefs (DATA/prefs.json, server-only)
function store(DATA) {
  const file = path.join(DATA, 'prefs.json');
  let cache = null;
  const load = () => { if (!cache) { try { cache = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { cache = {}; } } return cache; };
  const save = () => { fs.mkdirSync(DATA, { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(cache, null, 2)); fs.renameSync(tmp, file); };
  const key = (user) => String(user || '').trim().toLowerCase();
  return {
    get(user) { const u = load()[key(user)]; return { answers: { ...(u?.answers || {}) }, effort: EFFORTS.includes(u?.effort) ? u.effort : null }; },
    /** Remember answers (latest wins; skipped ones are not stored). */
    saveAnswers(user, list) {
      if (!key(user) || !list?.length) return;
      const all = load(), u = (all[key(user)] ||= {});
      const a = (u.answers ||= {});
      for (const x of list) a[x.id] = { q: x.question, a: x.answer, t: Math.floor(Date.now() / 1000) };
      const ks = Object.keys(a).sort((m, n) => (a[n].t || 0) - (a[m].t || 0));
      for (const k of ks.slice(MAX_PREFS)) delete a[k];
      save();
    },
    forget(user, id) { const u = load()[key(user)]; if (u?.answers?.[id]) { delete u.answers[id]; save(); } },
    setEffort(user, effort) {
      if (!key(user) || !EFFORTS.includes(effort)) return false;
      (load()[key(user)] ||= {}).effort = effort; save(); return true;
    },
    effortOf(user) { const e = load()[key(user)]?.effort; return EFFORTS.includes(e) ? e : DEFAULT_EFFORT; },
    _reset() { cache = null; },
  };
}

/** The user's earlier answers as a context block for the agent ('' when none). */
function prefsContext(prefs) {
  const a = prefs?.answers || {};
  const rows = Object.entries(a).filter(([, v]) => v && v.a).map(([id, v]) => `- ${v.q || id}: ${v.a}`);
  if (!rows.length) return '';
  return `[What this user told the app earlier (their own answers to your question cards; don't ask these again, follow them unless this message says otherwise):\n${rows.join('\n')}]`;
}

// ---------------------------------------------------------------- stops
const STALL_MS = Number(process.env.FORMA_STALL_MIN || 5) * 60e3;
/** run.stopReason -> the status saved on the message and the chat line. */
function stopStatus(run, capMs) {
  const mins = Math.max(1, Math.round((Date.now() - run.startedAt) / 60e3));
  if (run.stopReason === 'cap') return { kind: 'timeout', text: `Stopped after ${Math.round(capMs / 60e3)} min (the time limit for one turn)`, minutes: mins, continuable: true };
  if (run.stopReason === 'stall') return { kind: 'stalled', text: `Stopped: no progress for ${Math.round(STALL_MS / 60e3)} min`, minutes: mins, continuable: true };
  return { kind: 'stopped', text: 'Stopped', minutes: mins, continuable: true };
}
const CONTINUE_TEXT = 'Continue where you left off.';

// ---------------------------------------------------------------- titles
const TITLE_SYSTEM = 'You name products. Reply with ONLY the name: 2 to 4 words, Title Case, what the thing is (e.g. "Telescopic Camping Light", "Wi-Fi Smart Lockbox", "AirPods Pro Charging Dock"). No quotes, no punctuation at the end, no "Design", no brand names.';
/** CLI args for one tool-less, session-less, low-effort title call (subscription login, like the sketch). */
function titleArgs(model) {
  return ['-p', '--output-format', 'json', '--model', model, '--effort', 'low', '--setting-sources', '', '--strict-mcp-config', '--tools', '',
    '--disable-slash-commands', '--no-session-persistence', '--system-prompt', TITLE_SYSTEM];
}
function titleInput(prompt, reply) {
  return `The user asked for:\n${String(prompt || '').slice(0, 1500)}${reply ? `\n\nThe designer replied:\n${String(reply).slice(0, 800)}` : ''}\n\nName this product.`;
}
/** Model output -> a clean 2-6 word title, or ''. */
function cleanTitle(s) {
  let t = String(s || '').split('\n').map((x) => x.trim()).find(Boolean) || '';
  t = t.replace(/^["'“”‘’*_#\s]+|["'“”‘’*_.!\s]+$/g, '').replace(/^(title|name)\s*:\s*/i, '').replace(/\s+/g, ' ');
  if (!t || t.length > 48 || /[{}<>`]/.test(t)) return '';
  const words = t.split(' ');
  if (words.length < 1 || words.length > 6) return '';
  return t;
}

/** Short clean placeholder title from the first prompt: no "Can you build this:" / "Design a…" lead-in, first clause,
 *  whole words (≤ 6, ≤ 40 chars), no dangling connector at the end ("…cube with"), capitalised; 'Untitled' when the
 *  prompt only has filler ("Make one like this"). */
const TITLE_TAIL = new Set(['with', 'for', 'and', 'or', 'a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'by', 'from', 'that', 'which', 'so', 'but', 'my', 'your', 'some', 'it']);
// Lead-ins that say nothing about the product ("Can you build this:", "I want you to make me a", "Make one like this").
const TITLE_LEAD = /^(?:(?:please|hey|hi|ok(?:ay)?|so)[\s,]+|(?:can|could|would|will) you\s+|i(?:'d| would)? (?:want|need|like)(?: you)?(?: to)?\s+|i wanna\s+|i'?m (?:looking for|after)\s+|let'?s\s+|(?:this|it) (?:is|should be|will be)\s+|here'?s\s+|(?:design|make|create|build|draw|model|generate|sketch)(?:\s+me|\s+us)?\s+|(?:a|an|the|some)\s+)+/i;
const TITLE_FILLER = new Set(['this', 'it', 'that', 'these', 'one', 'something', 'thing', 'one like this', 'something like this', 'one of these',
  'like this', 'this one', 'me', 'us', 'untitled']);
/** A title that only repeats the request ("Design a product based on this", "The image I attached is a"), not a product name. */
const PROMPT_ECHO_RE = /^(?:(?:please\s+)?(?:design|make|create|build|draw|generate|sketch)(?:\s+me|\s+us)?\s+(?:a|an|the|some|this|these|something|one)\b|(?:can|could|would) you\b|i(?:'d| would)? (?:want|need|like)\b|the (?:image|photo|picture|pic)s? i\b)|\bbased on (?:this|these|the (?:image|photo|picture))\b|\b(?:this|these|attached) (?:image|photo|picture|pic)s?\b/i;
function isPromptEcho(title) { return PROMPT_ECHO_RE.test(String(title || '').trim()); }
function titleFromPrompt(text) {
  let t = String(text || '').replace(/\[Attached[^\]]*\]?/gi, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim().replace(TITLE_LEAD, '');
  // "Can you build this: a desk robot…" -> the part after the colon names the product
  const colon = t.match(/^((?:\w+\s+){0,3}\w+)\s*:\s*(\S.*)$/);
  if (colon && TITLE_FILLER.has(colon[1].toLowerCase())) t = colon[2];
  t = t.split(/[.!?;:,\n(]|\s[-–—]\s/)[0].trim().replace(TITLE_LEAD, '');
  // drop the clause that describes it rather than names it ("desk robot that uses my phone…")
  const clause = t.match(/\s(?:that|which|who|where|like|with)\s/i);
  if (clause && t.slice(0, clause.index).trim().includes(' ')) t = t.slice(0, clause.index).trim();
  const words = [];
  for (const w of t.split(' ').filter(Boolean)) { if (words.length >= 6 || [...words, w].join(' ').length > 40) break; words.push(w); }
  while (words.length > 1 && TITLE_TAIL.has(words[words.length - 1].toLowerCase())) words.pop();
  const out = words.join(' ').replace(/[^\p{L}\p{N})"']+$/u, '');
  return out && !TITLE_TAIL.has(out.toLowerCase()) && !TITLE_FILLER.has(out.toLowerCase()) && !isPromptEcho(out) ? out[0].toUpperCase() + out.slice(1) : 'Untitled';
}
/** The placeholder is still useless ("Untitled", "This"): a name from the agent's one-line description, or ''. */
function titleFallback(meta) {
  if (!meta || !(meta.title_auto || isPromptEcho(meta.title)) || (meta.title && meta.title !== 'Untitled' && !TITLE_FILLER.has(String(meta.title).toLowerCase()) && !isPromptEcho(meta.title))) return '';
  const t = meta.description ? titleFromPrompt(meta.description) : 'Untitled';
  return t !== 'Untitled' ? t : '';
}

/** A title the user typed (rename): one line, 1-80 chars, or '' when unusable. */
function cleanUserTitle(s) {
  const t = str(s, 200).replace(/[<>]/g, '').trim();
  return t && t.length <= 80 ? t : '';
}

// ---------------------------------------------------------------- soldering iron add-on (bom.needs_soldering)
// Offered at checkout when the design needs soldering; one per order (not per unit), ordered from Amazon with the kit.
const SOLDER_KIT = { id: 'soldering_iron', name: 'Soldering iron kit (60 W, adjustable, stand, solder, tips)', usd: 16,
  search: 'soldering iron kit 60W adjustable temperature stand solder' };
/** Checkout add-ons the customer ticked -> the valid ones for this bom ([] or [SOLDER_KIT]). Throws {code:400} on junk. */
function addonsFor(bom, addons) {
  if (addons == null) return [];
  if (!Array.isArray(addons) || addons.some((a) => typeof a !== 'string')) throw Object.assign(new Error('addons must be a list'), { code: 400 });
  const want = [...new Set(addons)];
  if (want.some((a) => a !== SOLDER_KIT.id)) throw Object.assign(new Error(`addons can only hold ${SOLDER_KIT.id}`), { code: 400 });
  return want.length && bom?.needs_soldering === true ? [SOLDER_KIT] : [];
}

module.exports = { cleanUserTitle, SOLDER_KIT, addonsFor, EFFORTS, DEFAULT_EFFORT, QUESTIONS_FILE, STALL_MS, CONTINUE_TEXT, cleanQuestions, readQuestions, cleanAnswers, store, prefsContext,
  stopStatus, titleArgs, titleInput, cleanTitle, titleFromPrompt, titleFallback, isPromptEcho, TITLE_FILLER };

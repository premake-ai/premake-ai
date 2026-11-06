// livecaption: the one calm line under the model while a design run works (app.js renderVpStatus). Pure helpers:
//  - thinkingLine: the agent's latest reasoning as a plain sentence ("Working out how tall the arm needs to be")
//  - versionNote:  what a rebuild in the same run changed ("Version 2: added the wall plate and hook")
//  - partLabel:    a part name as the reveal says it ("Lamp head")

const CODEY = /[`{}[\]<>=_\\|$#*~^]|\.(py|json|js|md|sh|ino|stl|step)\b|\b(def|return|import|lambda|self|cq|Workplane|stl|json|regex|grep|bash|build\.sh)\b|\/\w|\w\(|^\s*[-*]\s/;
const INTERNAL = /\b(the user|user's|users?|prompt|system|instructions?|tool|tools|claude|assistant|ai|model's|token|context|session|agent)\b/i;
// "I need to figure out X" -> "Figuring out X"
const LEAD = /^(?:ok(?:ay)?,?\s+|so,?\s+|now,?\s+|next,?\s+|then,?\s+|first,?\s+|hmm,?\s+|alright,?\s+)*(?:i\s+(?:need|want|have|ought|plan|am going|'m going|will need)\s+to|i\s+should|i'll|i\s+will|i\s+can|let\s+me|let's|we\s+need\s+to|we\s+should|i'm\s+going\s+to|time\s+to)\s+/i;
const GERUND_KEEP = new Set(['be', 'see', 'flee', 'agree', 'free']);
function gerund(v) {
  const w = v.toLowerCase();
  if (w.endsWith('ing')) return w;
  if (w === 'be') return 'being';
  if (w.endsWith('ie')) return w.slice(0, -2) + 'ying';
  if (w.endsWith('e') && !GERUND_KEEP.has(w) && !w.endsWith('ee')) return w.slice(0, -1) + 'ing';
  if (/^(put|cut|set|get|fit|run|plan|trim|pin|slot|swap|drop|stop|map|nut|sit|split|wrap|clip|snap|ship|step|tap|pad)$/.test(w)) return w + w.slice(-1) + 'ing';
  return w + 'ing';
}
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** Trim to about max characters on a word boundary, dropping a dangling clause. */
function trim(s, max = 90) {
  if (s.length <= max) return s;
  let t = s.slice(0, max + 1);
  const cut = Math.max(t.lastIndexOf(', '), t.lastIndexOf(' so '), t.lastIndexOf(' and '), t.lastIndexOf(' but '), t.lastIndexOf(' because '));
  t = cut > max * 0.55 ? t.slice(0, cut) : t.slice(0, t.lastIndexOf(' '));
  return t.replace(/[\s,;:]+(the|a|an|of|to|and|or|with|for|in|on|at)$/i, '').replace(/[\s,;:]+$/, '');
}

/** The latest complete sentence of the thinking, as a calm present-tense line, or '' when nothing reads well. */
export function thinkingLine(thinking, max = 90) {
  const text = String(thinking || '').replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const sentences = text.match(/[^.!?]+[.!?](?=\s|$)/g) || [];
  for (let i = sentences.length - 1; i >= Math.max(0, sentences.length - 4); i--) {
    let s = sentences[i].trim().replace(/[*_`#>]+/g, '').replace(/[.!?]+$/, '').trim();
    if (s.length < 14 || /\?$/.test(sentences[i].trim()) || CODEY.test(s)) continue;
    s = s.replace(/\bthe user's\b/gi, 'your');
    if (INTERNAL.test(s)) continue;
    // "..., so I'm switching to a plywood flat-pack" -> "Switching to a plywood flat-pack"; "I'll add X" mid-sentence too
    const mid = /(?:^|[,;:]\s*|\b(?:so|and|then|now)\s+)(?:i'm|i am|i'll|i will|i need to|let me)\s+([a-z]+)\b/gi;
    let mm, lastMid = null;
    while ((mm = mid.exec(s))) lastMid = mm;
    if (lastMid && lastMid.index > 0) s = s.slice(lastMid.index).replace(/^[,;:\s]+|^(?:so|and|then|now)\s+/i, '');
    s = s.replace(/^(?:i'm|i am)\s+(?=[a-z]+ing\b)/i, '');
    const m = LEAD.exec(s);
    if (m) {
      const rest = s.slice(m[0].length), v = /^([a-z]+)\b/i.exec(rest);
      if (!v) continue;
      s = gerund(v[1]) + rest.slice(v[1].length);
    } else if (/^(i|i'm|i've|i'd|we|we're|my|me)\b/i.test(s)) continue; // other first-person musings
    if (/\b(i|i'm|i've|i'd|me|my)\b/i.test(s)) continue;
    s = s.replace(/\bwe\b/gi, 'it');
    return cap1(trim(s, max));
  }
  return '';
}

/** "Lamp head (left) ×2" -> "Lamp head" */
export function partLabel(name) {
  return String(name || '').replace(/\s*\([^)]*\)/g, '').replace(/\s*[×x]\s?\d+$/i, '').trim() || String(name || '');
}

const list = (names) => {
  const n = [...new Set(names.map((x) => partLabel(x).toLowerCase()))];
  if (n.length <= 2) return n.join(' and ');
  return `${n.slice(0, 2).join(', ')} and ${n.length - 2} more`;
};
/** What changed between two manifests' parts ([{ name, bbox }]), as one short line. n: this run's version number. */
export function versionNote(before, after, n) {
  const key = (p) => `${p.name}|${(p.bbox || []).map((v) => Math.round(v)).join('x')}`;
  const bNames = new Set(before.map((p) => p.name)), aNames = new Set(after.map((p) => p.name));
  const added = after.filter((p) => !bNames.has(p.name)).map((p) => p.name);
  const removed = before.filter((p) => !aNames.has(p.name)).map((p) => p.name);
  const bKeys = new Set(before.map(key));
  const changed = after.filter((p) => bNames.has(p.name) && !bKeys.has(key(p))).map((p) => p.name);
  const bits = [];
  if (added.length) bits.push(`added the ${list(added)}`);
  if (removed.length) bits.push(`removed the ${list(removed)}`);
  if (changed.length && bits.length < 2) bits.push(`reshaped the ${list(changed)}`);
  return `Version ${n}: ${bits.length ? bits.join(', ') : 'refined the details'}`;
}

// sections: the Parts panel grouped by the machine's real sections (Frame, X axis, Y axis, Electronics...).
//
// New designs carry them: design.py sets "section" on each part and cadlib/build.py copies it into manifest.json.
// Older designs get them from one fast low-effort call that sorts the part names into sections (same CLI shape as
// the instant sketch, server.js spawnSketch), cached in the project's sections.json under a hash of the part names,
// so it only runs again when the parts change. Designs under MIN_PARTS parts don't get sections.
'use strict';
const crypto = require('node:crypto');

const MIN_PARTS = 8;
const MAX_SECTIONS = 12;
const OTHER = 'Other';

const SYSTEM = `You sort the parts of one product or machine into the sections a builder would name. Output ONLY one JSON object, no prose, no code fences:
{"sections": [{"name": "Y axis", "parts": [1, 4, 7]}, ...]}
5 to 10 sections, short Title-case names a builder would use (e.g. Frame, Base, X axis, Y axis, Z axis, Gantry, Spindle, Bed, Enclosure, Lid, Electronics, Wiring, Power, Mounts, Fasteners). Every part number exactly once, in the section it is built into: a motor, lead screw, coupler, rods and their screws go with the axis they drive; screws that join the frame go with Frame; only use Fasteners for leftover screws that belong nowhere specific. Order sections the way the product is built, first to last.`;

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
/** "y axis " -> "Y axis"; '' for nothing usable. */
function cleanName(s) {
  const t = clean(s).replace(/[."'`]+$/g, '').slice(0, 40).trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

/** The cache key: a hash of the part names (order and duplicates don't matter). */
function keyOf(names) {
  const list = [...new Set((names || []).map(clean).filter(Boolean))].sort();
  return crypto.createHash('sha1').update(list.join('\n')).digest('hex').slice(0, 16);
}

const partNames = (man) => (man?.parts || []).map((p) => clean(p?.name)).filter(Boolean);

/** Sections the design itself set (manifest part.section): { map: {name: section}, order } or null when none did.
 *  Parts without one go to Other. */
function fromManifest(man) {
  const parts = man?.parts || [];
  if (!parts.some((p) => cleanName(p?.section))) return null;
  const map = {}, order = [];
  for (const p of parts) {
    const n = clean(p?.name); if (!n) continue;
    const s = cleanName(p.section) || OTHER;
    map[n] = s; if (!order.includes(s)) order.push(s);
  }
  return { map, order: moveOtherLast(order) };
}

const moveOtherLast = (order) => [...order.filter((s) => s !== OTHER), ...(order.includes(OTHER) ? [OTHER] : [])];

/** The user message: the product and its numbered parts. */
function prompt({ title, description, names }) {
  const L = [];
  if (title) L.push(`Product: ${clean(title).slice(0, 120)}`);
  if (description) L.push(`About it: ${clean(description).slice(0, 400)}`);
  L.push(`Parts (${names.length}):`);
  names.forEach((n, i) => L.push(`${i + 1}. ${n.slice(0, 80)}`));
  L.push('Return the JSON sections.');
  return L.join('\n');
}

/** The model's JSON -> { map, order } over exactly `names`; anything unassigned goes to Other. null if unusable. */
function parseResult(obj, names) {
  const secs = Array.isArray(obj?.sections) ? obj.sections : null;
  if (!secs?.length) return null;
  const map = {}, order = [];
  for (const s of secs) {
    const name = cleanName(s?.name);
    if (!name || !Array.isArray(s.parts)) continue;
    for (const i of s.parts) {
      const n = names[Number(i) - 1];
      if (!Number.isInteger(Number(i)) || !n || map[n]) continue;
      const sec = order.includes(name) || order.length < MAX_SECTIONS ? name : OTHER;
      map[n] = sec; if (!order.includes(sec)) order.push(sec);
    }
  }
  const got = names.filter((n) => map[n]).length;
  if (got < Math.ceil(names.length / 2)) return null; // mostly missing: not worth showing
  for (const n of names) if (!map[n]) { map[n] = OTHER; if (!order.includes(OTHER)) order.push(OTHER); }
  return { map, order: moveOtherLast(order) };
}

/** A cached sections.json still matches these parts? */
const cacheFits = (cache, key) => !!(cache && cache.key === key && cache.map && Array.isArray(cache.order));

module.exports = { MIN_PARTS, OTHER, SYSTEM, keyOf, partNames, fromManifest, prompt, parseResult, cacheFits, cleanName };

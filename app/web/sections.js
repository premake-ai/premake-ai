// sections: the Parts panel grouped by the machine's real sections (Frame, X axis, Electronics...) or by type
// (Printed / Bought). Pure helpers; app.js renders. Sections come from GET /api/<projects|examples>/<id>/sections
// (server/sections.js): { map: {part name: section}, order } or { map: null } for small designs.
// sectionOf() / sectionList() are here for the Assemble and Order tabs to reuse later.

export const OTHER = 'Other';
const PREF_KEY = 'premake.partsBy';

/** 'case' (we make it) | 'component' (bought), as the panel has always split them. */
export const typeOf = p => (p.group === 'component' ? 'component' : 'case');

/** Printed / Bought groups: [{ key, label, parts }] (empty ones dropped). */
export function groupByType(parts) {
  return [['case', 'Printed'], ['component', 'Bought']]
    .map(([key, label]) => ({ key, label, parts: parts.filter(p => typeOf(p) === key) }))
    .filter(g => g.parts.length);
}

/** A part's section: the design's own part.section, then the classified map, else Other. */
export function sectionOf(sec, p) {
  const own = typeof p?.section === 'string' && p.section.trim();
  return own || sec?.map?.[p?.name] || OTHER;
}

/** Section groups in build order: [{ key: 's:<name>', label, parts }]; sections not in `order` follow, Other last. */
export function groupBySection(parts, sec) {
  const by = new Map();
  for (const p of parts) { const s = sectionOf(sec, p); if (!by.has(s)) by.set(s, []); by.get(s).push(p); }
  const order = [...(sec?.order || []).filter(s => by.has(s)), ...[...by.keys()].filter(s => !(sec?.order || []).includes(s))];
  const names = [...order.filter(s => s !== OTHER), ...(by.has(OTHER) ? [OTHER] : [])];
  return names.map(s => ({ key: 's:' + s, label: s, parts: by.get(s) }));
}

/** The sections a design has (for tabs that want a list), or [] when it has none. */
export const sectionList = (parts, sec) => hasSections(parts, sec) ? groupBySection(parts, sec).map(g => g.label) : [];

/** Worth grouping by section: some part has one (own or classified) and it is not all one group. */
export function hasSections(parts, sec) {
  if (!parts?.length) return false;
  const set = new Set(parts.map(p => (p.section || sec?.map?.[p.name]) ? sectionOf(sec, p) : null).filter(Boolean));
  return set.size >= 2;
}

/** The groups to show and the mode in use ('section' | 'type'); `pref` is the remembered choice or null. */
export function treeGroups(parts, sec, pref) {
  const can = hasSections(parts, sec);
  const mode = can && pref !== 'type' ? 'section' : 'type';
  return { mode, can, groups: mode === 'section' ? groupBySection(parts, sec) : groupByType(parts) };
}

export function loadPref() { try { const v = localStorage.getItem(PREF_KEY); return v === 'type' || v === 'section' ? v : null; } catch { return null; } }
export function savePref(v) { try { localStorage.setItem(PREF_KEY, v); } catch {} }

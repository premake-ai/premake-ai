// editglow: which parts of the model an agent edit to design.py touches, so the studio can light them up while the agent
// works (before the build lands). Pure functions, no I/O: server.js passes the current design.py and manifest.json.
//
// How a line of design.py maps to parts (the manifest's part names are the vocabulary):
//   1. Anchors: string literals that name a part ("name": "Link 1", ext("2020 x 400", …), f"Leg {i}" -> Leg 1, Leg 2…)
//      or a library key (part("nema17_40", …) -> the manifest parts whose lib.key it is).
//   2. Inside a function that has anchors (parts()), each statement belongs to its anchors; a statement without one
//      belongs to the anchored statements that use the variables it assigns, else to the next anchored statement
//      (the `cp = …` lines before out.append({"name": "Carriage", "shape": cp})).
//   3. A helper function (no anchors) belongs to the parts whose statements call it (link() -> Link 1, Link 2).
//   4. A top-level constant belongs to the parts whose lines use it (one level through other constants).
//   More than MAX_PARTS candidates means "a lot": treated as unknown (the step keeps its old label).
'use strict';

const MAX_PARTS = 10;
const STR_RE = /([rbfuRBFU]{0,2})("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/g;
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const baseName = (n) => String(n).replace(/\s+×\s*\d+$/, '').replace(/\s+\(\d+\)$/, '').trim();

/** Vocabulary from a manifest: unique names, lower-case lookups (incl. "×2" / "(2)" variants) and library keys. */
function vocab(manifest) {
  const parts = Array.isArray(manifest?.parts) ? manifest.parts : [];
  const names = [...new Set(parts.map((p) => String(p?.name || '')).filter(Boolean))];
  const byLower = new Map();
  const add = (k, n) => { k = k.toLowerCase(); if (!k) return; if (!byLower.has(k)) byLower.set(k, new Set()); byLower.get(k).add(n); };
  for (const n of names) { add(n, n); add(baseName(n), n); }
  const libs = new Map(); // key or id -> Set(names)
  for (const p of parts) {
    for (const k of [p?.lib?.key, p?.lib?.id]) {
      if (!k) continue;
      if (!libs.has(k)) libs.set(k, new Set());
      libs.get(k).add(String(p.name));
    }
  }
  return { names, byLower, libs };
}

/** Part names a string literal refers to (exact name, base name, f-string pattern or library key). */
function literalNames(prefix, body, V) {
  const out = new Set();
  if (!body || body.length > 120) return out;
  const hit = V.byLower.get(body.toLowerCase());
  if (hit) hit.forEach((n) => out.add(n));
  if (/f/i.test(prefix) && /\{[^}]*\}/.test(body)) {
    const re = new RegExp('^' + body.split(/\{[^}]*\}/).map(reEsc).join('.+?') + '$', 'i');
    for (const n of V.names) if (re.test(n) || re.test(baseName(n))) out.add(n);
  }
  if (!out.size && /^[a-z0-9_]+$/.test(body)) { // library key: "nema17_40" -> lib "nema17", "m3x10_standoff" -> "standoff"
    const bt = body.split('_').filter(Boolean);
    for (const [k, set] of V.libs) {
      const kt = String(k).toLowerCase().split('_').filter(Boolean);
      if (!kt.length || !kt.every((t) => bt.includes(t))) continue;
      const toks = bt.filter((t) => !kt.includes(t)); // the rest narrows the names ("40" -> "… 40 mm")
      const norm = (n) => n.toLowerCase().replace(/×/g, 'x');
      const narrowed = [...set].filter((n) => toks.every((t) => new RegExp(`(^|[^0-9a-z])${reEsc(t)}([^0-9a-z]|$)`).test(norm(n))));
      (narrowed.length ? narrowed : [...set]).forEach((n) => out.add(n));
    }
  }
  return out;
}
function namesInCode(text, V) {
  const out = new Set();
  for (const m of String(text).matchAll(STR_RE)) literalNames(m[1], m[2].slice(1, -1).replace(/\\(.)/g, '$1'), V).forEach((n) => out.add(n));
  return out;
}

/** Per-line structure: paren depth at line start, indent, blank/comment, code text without strings and comments. */
function scan(src) {
  const lines = src.split('\n');
  const info = [];
  let depth = 0, tri = null;
  for (const line of lines) {
    const startDepth = depth, inTri = !!tri;
    let code = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (tri) { if (line.startsWith(tri, i)) { tri = null; i += 2; } continue; }
      if (line.startsWith('"""', i) || line.startsWith("'''", i)) { tri = line.slice(i, i + 3); i += 2; code += ' "" '; continue; }
      if (ch === '#') break;
      if (ch === '"' || ch === "'") { // single-line string
        let j = i + 1;
        while (j < line.length && line[j] !== ch) j += line[j] === '\\' ? 2 : 1;
        code += ' "" '; i = j; continue;
      }
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
      code += ch;
    }
    const trimmed = line.trim();
    info.push({ line, code, startDepth, inTri, indent: line.length - line.trimStart().length, blank: !trimmed || trimmed.startsWith('#') });
  }
  return info;
}

/**
 * Map every line of design.py to the parts it builds. Returns an array (one Set of names per line, maybe empty).
 * V: vocab(manifest).
 */
function lineParts(src, V) {
  const L = scan(String(src || ''));
  const n = L.length;
  // statements: start at a non-blank line at paren depth 0 outside a docstring
  const stmtOf = new Array(n).fill(-1), stmts = [];
  for (let i = 0; i < n; i++) {
    if (!L[i].blank && L[i].startDepth === 0 && !L[i].inTri) stmts.push({ start: i, end: i, indent: L[i].indent });
    if (stmts.length) { stmtOf[i] = stmts.length - 1; stmts[stmts.length - 1].end = i; }
  }
  for (const s of stmts) { while (s.end > s.start && L[s.end].blank) s.end--; }
  // def blocks (by indentation)
  const defs = [];
  for (const s of stmts) {
    const m = /^\s*(?:async\s+)?def\s+(\w+)/.exec(L[s.start].line);
    if (!m) continue;
    let end = s.end;
    for (let j = s.end + 1; j < n; j++) { if (L[j].blank) continue; if (L[j].indent <= s.indent) break; end = j; }
    defs.push({ name: m[1], start: s.start, end, indent: s.indent, anchored: false });
  }
  const defOf = (i) => { let best = null; for (const d of defs) if (i >= d.start && i <= d.end && (!best || d.start > best.start)) best = d; return best; };
  // anchors per statement
  const lineNames = L.map((x) => (x.blank ? new Set() : namesInCode(x.line, V)));
  const stmtNames = stmts.map((s) => { const set = new Set(); for (let i = s.start; i <= s.end; i++) lineNames[i].forEach((x) => set.add(x)); return set; });
  for (const s of stmts) { s.def = defOf(s.start); s.isDef = /^\s*(?:async\s+)?def\s/.test(L[s.start].line); }
  for (const d of defs) d.anchored = stmts.some((s, k) => s.def === d && stmtNames[k].size);
  const res = Array.from({ length: n }, () => new Set());
  const put = (s, names) => { for (let i = s.start; i <= s.end; i++) names.forEach((x) => res[i].add(x)); };
  const idents = (code) => new Set(code.match(/[A-Za-z_]\w*/g) || []);
  const assigned = (s) => {
    const m = /^\s*([A-Za-z_][\w\s,]*?)\s*(?:[-+*/|&]|\/\/)?=(?!=)/.exec(L[s.start].code);
    return m ? m[1].split(',').map((x) => x.trim()).filter((x) => /^[A-Za-z_]\w*$/.test(x)) : [];
  };
  const stmtCode = (s) => { let c = ''; for (let i = s.start; i <= s.end; i++) c += L[i].code + '\n'; return c; };
  // nested helpers that write an outer variable (nonlocal corner): calling them counts as assigning it
  const nonlocalOf = new Map();
  for (const d of defs) {
    const vs = [];
    for (let i = d.start; i <= d.end; i++) { const m = /^\s*(?:nonlocal|global)\s+([\w\s,]+)/.exec(L[i].code); if (m) vs.push(...m[1].split(',').map((x) => x.trim()).filter(Boolean)); }
    if (vs.length) nonlocalOf.set(d.name, vs);
  }
  // 2. statements in anchored defs
  for (const d of defs.filter((x) => x.anchored)) {
    const own = stmts.map((s, k) => ({ s, k })).filter(({ s }) => s.def === d && !s.isDef);
    const header = (s) => /^\s*(for|while|if|elif|else|with|try|except|finally)\b/.test(L[s.start].code) && /:\s*$/.test(L[s.end].code);
    for (const { s, k } of own) {
      if (!stmtNames[k].size) continue;
      // one statement, several parts (return [{"name": "Pot", …}, {"name": "Lid", …}]): split by anchor line
      const al = []; for (let i = s.start; i <= s.end; i++) if (lineNames[i].size) al.push(i);
      if (al.length < 2) { put(s, stmtNames[k]); continue; }
      for (let i = s.start, cur = lineNames[al[0]]; i <= s.end; i++) { if (lineNames[i].size) cur = lineNames[i]; cur.forEach((x) => res[i].add(x)); }
    }
    own.forEach(({ s, k }, idx) => {
      if (stmtNames[k].size || /^\s*return\b/.test(L[s.start].code) || header(s)) return;
      // follow what it assigns (or a nested helper's nonlocal) through later statements until something names a part
      const vars = new Set([...assigned(s), ...[...idents(stmtCode(s))].flatMap((x) => nonlocalOf.get(x) || [])]), later = own.slice(idx + 1);
      const got = new Set();
      for (const o of later) {
        if (!vars.size) break;
        const code = stmtCode(o.s), ids = idents(code), uses = [...vars].some((x) => ids.has(x));
        const asg = assigned(o.s), rhs = new Set(idents(code.slice(code.indexOf('=') + 1)));
        if (uses && stmtNames[o.k].size) { // only the lines (parts) of it that use them
          for (let i = o.s.start; i <= o.s.end; i++) { const li = idents(L[i].code); if ([...vars].some((x) => li.has(x))) res[i].forEach((x) => got.add(x)); }
        }
        else if (uses) asg.forEach((x) => vars.add(x));
        for (const x of asg) if (!rhs.has(x) && !uses) vars.delete(x); // reassigned from scratch: no longer ours
      }
      if (!got.size) { const nx = later.find((o) => stmtNames[o.k].size); if (nx) stmtNames[nx.k].forEach((x) => got.add(x)); }
      if (got.size <= MAX_PARTS) put(s, got);
    });
    // loop / if headers: whatever their body builds (innermost first)
    for (const { s } of [...own].reverse()) {
      if (!header(s)) continue;
      const got = new Set();
      for (let j = s.end + 1; j < n && (L[j].blank || L[j].indent > s.indent); j++) res[j].forEach((x) => got.add(x));
      if (got.size <= MAX_PARTS) put(s, got);
    }
  }
  // 3. helpers: parts of the statements that call them (through other helpers, memoised)
  const helpers = defs.filter((d) => !d.anchored);
  const memo = new Map();
  function helperParts(h, seen = new Set()) {
    if (memo.has(h)) return memo.get(h);
    if (seen.has(h)) return new Set();
    seen.add(h);
    const out = new Set(), re = new RegExp(`(^|[^\\w.])${reEsc(h.name)}\\s*\\(`);
    for (let i = 0; i < n; i++) {
      if (i >= h.start && i <= h.end) continue;
      if (!re.test(L[i].code)) continue;
      const own = defOf(i);
      if (own && !own.anchored) helperParts(own, seen).forEach((x) => out.add(x));
      else res[i].forEach((x) => out.add(x));
    }
    memo.set(h, out);
    return out;
  }
  for (const h of helpers) { const p = helperParts(h); if (p.size <= MAX_PARTS) for (let i = h.start; i <= h.end; i++) p.forEach((x) => res[i].add(x)); }
  // 4. top-level statements (constants): parts of the lines that use what they assign (one level through constants)
  const top = stmts.filter((s) => !s.def && !s.isDef);
  const usesOf = (name, skip, depth) => {
    const out = new Set(), re = new RegExp(`(^|[^\\w.])${reEsc(name)}(?!\\w)`);
    for (let i = 0; i < n; i++) {
      if (i >= skip.start && i <= skip.end) continue;
      if (!re.test(L[i].code)) continue;
      res[i].forEach((x) => out.add(x));
      const ts = top.find((t) => i >= t.start && i <= t.end);
      if (ts && depth > 0) for (const v of assigned(ts)) usesOf(v, ts, depth - 1).forEach((x) => out.add(x));
    }
    return out;
  };
  for (const s of top) {
    if (/^\s*(import|from)\s/.test(L[s.start].code)) continue;
    const got = new Set();
    for (const v of assigned(s)) usesOf(v, s, 1).forEach((x) => got.add(x));
    if (got.size <= MAX_PARTS) put(s, got);
  }
  return res;
}

/** Old-file line indices an edit changes. Edit: where old_string sits (or new_string, if the edit already landed). */
function changedLines(src, oldStr, newStr) {
  const at = (needle) => {
    if (!needle) return null;
    let i = src.indexOf(needle);
    if (i < 0) { const t = needle.trim(); if (t.length >= 8) i = src.indexOf(t), needle = t; }
    if (i < 0) return null;
    const a = src.slice(0, i).split('\n').length - 1, b = a + needle.split('\n').length - 1;
    return [a, b];
  };
  const r = at(oldStr) || at(newStr);
  return r ? Array.from({ length: r[1] - r[0] + 1 }, (_, k) => r[0] + k) : [];
}

/** Write: lines of the old file that the new content drops or changes (LCS diff; inserts count against the next line). */
function diffLines(src, content) {
  const a = src.split('\n'), b = String(content).split('\n');
  if (a.length * b.length > 4e6) return null;
  const m = a.length, w = b.length, dp = new Uint32Array((m + 1) * (w + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = w - 1; j >= 0; j--) dp[i * (w + 1) + j] = a[i] === b[j] ? dp[(i + 1) * (w + 1) + j + 1] + 1 : Math.max(dp[(i + 1) * (w + 1) + j], dp[i * (w + 1) + j + 1]);
  const out = new Set();
  let i = 0, j = 0;
  while (i < m && j < w) {
    if (a[i] === b[j]) { i++; j++; } else if (dp[(i + 1) * (w + 1) + j] >= dp[i * (w + 1) + j + 1]) { out.add(i); i++; } else { out.add(Math.min(i, m - 1)); j++; }
  }
  while (i < m) out.add(i++);
  if (j < w) out.add(m - 1);
  return [...out].filter((x) => x >= 0);
}

/** Names that a new_string introduces ("name": "X" / name="X") but the current model doesn't have yet. */
function newNames(text, V) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/["']name["']\s*:\s*f?(["'])([^"'\n]{1,60})\1|\bname\s*=\s*f?(["'])([^"'\n]{1,60})\3/g)) {
    const nm = (m[2] || m[4] || '').trim();
    if (nm && !/\{/.test(nm) && !V.byLower.has(nm.toLowerCase())) out.add(nm);
  }
  return out;
}

/**
 * Which parts a design-agent tool call touches.
 * tool: 'Edit' | 'MultiEdit' | 'Write'; input: the tool input; src: design.py as it is now ('' if none); manifest: manifest.json.
 * Returns { parts: [names in the model], added: [new names], verb } or null when it can't tell.
 */
function partsForEdit(tool, input, src, manifest) {
  const V = vocab(manifest);
  if (!V.names.length || !src) return null;
  const lp = lineParts(src, V);
  const parts = new Set(), added = new Set();
  const edits = tool === 'MultiEdit' ? (Array.isArray(input?.edits) ? input.edits : [])
    : tool === 'Edit' ? [{ old_string: input?.old_string, new_string: input?.new_string }] : [];
  let lines = [];
  if (tool === 'Write') {
    const d = diffLines(src, input?.content || '');
    if (!d || d.length > 0.7 * src.split('\n').length) return null; // a rewrite: no point naming parts
    lines = d;
    // brand-new names in the new file
    newNames(input?.content, V).forEach((x) => added.add(x));
  }
  for (const e of edits) {
    const o = String(e?.old_string || ''), nw = String(e?.new_string || '');
    lines.push(...changedLines(src, o, nw));
    namesInCode(o, V).forEach((x) => parts.add(x));
    namesInCode(nw, V).forEach((x) => parts.add(x));
    newNames(nw, V).forEach((x) => added.add(x));
  }
  const fromLines = new Set();
  for (const i of lines) lp[i]?.forEach((x) => fromLines.add(x));
  if (fromLines.size <= MAX_PARTS) fromLines.forEach((x) => parts.add(x));
  if (parts.size > MAX_PARTS) parts.clear();
  if (!parts.size && !added.size) return null;
  const order = new Map(V.names.map((x, i) => [x, i]));
  return { parts: [...parts].sort((a, b) => order.get(a) - order.get(b)), added: [...added], verb: parts.size ? 'Editing' : 'Adding' };
}

/** Step label: "Editing Link 1 · Link 2", "Editing Base plate · +2 more", "Adding Spool holder". */
function editLabel(r) {
  const list = r.parts.length ? r.parts : r.added;
  const shown = list.slice(0, 3).join(' · ');
  return `${r.parts.length ? 'Editing' : 'Adding'} ${shown}${list.length > 3 ? ` · +${list.length - 3} more` : ''}`;
}

/** Part names mentioned in prose (narration): whole words, case-insensitive for multi-word names, ≥ 4 chars. */
function namesInText(text, manifest) {
  const V = vocab(manifest), t = String(text || ''), out = new Set();
  for (const n of V.names) {
    for (const cand of new Set([n, baseName(n)])) {
      if (cand.length < 4) continue;
      const multi = /\s/.test(cand);
      const re = new RegExp(`(^|[^\\w-])${reEsc(cand)}(?![\\w-])`, multi ? 'i' : '');
      if (re.test(t)) { out.add(n); break; }
    }
  }
  return out.size > MAX_PARTS ? [] : [...out];
}

module.exports = { vocab, lineParts, partsForEdit, editLabel, namesInText, baseName, MAX_PARTS };

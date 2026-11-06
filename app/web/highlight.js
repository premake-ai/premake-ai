// Tiny Python highlighter: returns HTML with one <span class="ln"> per line.
const KW = 'def|class|return|if|elif|else|for|while|in|import|from|as|with|try|except|finally|raise|lambda|and|or|not|is|pass|break|continue|yield|global|nonlocal|assert|del|async|await';
const RE = new RegExp([
  /("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|[rbfRBF]{0,2}"(?:\\.|[^"\\\n])*"|[rbfRBF]{0,2}'(?:\\.|[^'\\\n])*')/.source, // 1 string
  /(#[^\n]*)/.source,                                   // 2 comment
  /(@[\w.]+)/.source,                                   // 3 decorator
  /\b(\d+(?:\.\d+)?(?:e-?\d+)?)\b/.source,              // 4 number
  `\\b(${KW})\\b`,                                       // 5 keyword
  /\b(None|True|False|self)\b/.source,                  // 6 builtin const
  /\b([A-Za-z_]\w*)(?=\s*\()/.source,                   // 7 call / def name
].join('|'), 'g');
const CLS = [null, 's', 'c', 'd', 'n', 'k', 'b', 'f'];
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function highlightPython(src) {
  const toks = []; let last = 0, m;
  RE.lastIndex = 0;
  while ((m = RE.exec(src))) {
    if (m[0] === '') { RE.lastIndex++; continue; }
    if (m.index > last) toks.push([null, src.slice(last, m.index)]);
    const g = m.findIndex((x, i) => i > 0 && x !== undefined);
    toks.push([CLS[g], m[0]]);
    last = m.index + m[0].length;
  }
  if (last < src.length) toks.push([null, src.slice(last)]);
  const lines = [''];
  for (const [cls, text] of toks) {
    text.split('\n').forEach((part, i) => {
      if (i > 0) lines.push('');
      if (part) lines[lines.length - 1] += cls ? `<span class="${cls}">${esc(part)}</span>` : esc(part);
    });
  }
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.map(l => `<span class="ln">${l || ' '}</span>`).join('');
}

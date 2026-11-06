// livecaption: a short, calm line under the model while a design run works ("Cutting the camera window", "Adding
// screw posts", "Checking it fits the printer"). Plain words from what the agent is actually doing: the tool it calls,
// the functions and section headers it writes into design.py (also while that file is still streaming in), and the
// build's result. Never the agent's own prose, never "AI" talk. Pure functions; server.js emits { type: 'caption' }.
'use strict';

const ACRONYMS = { led: 'LED', leds: 'LEDs', usb: 'USB', pcb: 'PCB', esp32: 'ESP32', oled: 'OLED', lcd: 'LCD', ir: 'IR', ac: 'AC', dc: 'DC', rgb: 'RGB', sd: 'SD', hdmi: 'HDMI', xy: 'XY' };
// helper / boilerplate names that say nothing about the product
const SKIP = /^(box|rbox|cyl|cyl[xyz]|cyl_[xyz]|rrect|rect|soft|fillet|chamfer|shell|helper|util|utils|make|build|mm|deg|clamp|lerp|vec|pt|pts|at|place|move|rot|rotate|translate|union|cut|mirror|arr|grid|ring|tube|slot|hole|holes|wp|parts?|motion|main|assembly|steps?|scene|cables?)$/;
const WORD_FIX = /\b(make|build|create|get|gen|generate|draw|shape|solid|body_of|the|a|an|part|parts|geom|geometry|model|cq|wp|local|printed|print|petg|pla|abs|tpu|asa|mm|new|main|\d+)\b/g;

/** "camera_window_cut" -> "camera window"; null when it's a helper or says nothing. */
function label(raw) {
  let s = String(raw || '').split(/[(:,;.\u2014]| - /)[0].replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').toLowerCase();
  s = s.replace(/[^a-z0-9 ]+/g, ' ').replace(WORD_FIX, ' ').replace(/\s+/g, ' ').trim();
  if (!s || s.length < 3 || SKIP.test(s.replace(/ /g, '_')) || /^\d+$/.test(s)) return null;
  const words = s.split(' ').slice(0, 3).map((w) => ACRONYMS[w] || w);
  return words.join(' ');
}

/** A label -> a caption with a fitting verb. */
function phrase(lbl) {
  if (!lbl) return null;
  const l = lbl.toLowerCase();
  if (/\b(positions?|layout|dims?|dimensions|sizes?|params?|parameters|constants|settings|spacing|offsets?)\b/.test(l)) return 'Working out the sizes';
  if (/\b(fillets?|chamfers?|rounding|rounded|edges?)\b/.test(l)) return 'Rounding the edges';
  if (/\b(text|label|labels|engrav\w*|logo|lettering)\b/.test(l)) return 'Adding the lettering';
  if (/\b(holes?|windows?|cutouts?|cuts?|slots?|vents?|openings?|recess\w*|pockets?|grooves?|channels?|apertures?|grilles?|perforations?)\b/.test(l)) return `Cutting the ${trimVerb(lbl)}`;
  if (/\b(screws?|bosses|boss|posts?|standoffs?|inserts?|nuts?|bolts?|pilots?)\b/.test(l)) return `Adding the ${trimVerb(lbl)}`;
  if (/\b(hinges?|clips?|snaps?|latch\w*|magnets?|catch|detents?|tabs?)\b/.test(l)) return `Adding the ${trimVerb(lbl)}`;
  if (/\b(ribs?|brac\w*|gussets?|struts?|webs?)\b/.test(l)) return `Stiffening it with ${trimVerb(lbl)}`;
  if (/\b(wires?|wiring|cables?|routing)\b/.test(l)) return 'Routing the cables';
  if (/\b(electronics|board|boards|esp32|sensor|sensors|battery|motor|motors|leds?|pcb)\b/.test(l)) return `Placing the ${trimVerb(lbl)}`;
  if (/\b(motion|move|moves|moving|animation|anim)\b/.test(l)) return 'Working out how it moves';
  return `Shaping the ${trimVerb(lbl)}`;
}
const trimVerb = (l) => l.replace(/^(cut|add|adding|cutting|shaping|placing|drill|drilling)\s+/i, '');

/** Captions for code being written: section headers ("# ---- screw posts") and argument-free defs, in order. */
function fromCode(code) {
  const out = [];
  const re = /^(?:#[ \t]*[-=#*~]{2,}[ \t]*([A-Za-z][^\n#]{2,60}?)[ \t]*[-=#*~]*[ \t]*$|def[ \t]+([A-Za-z]\w*)[ \t]*\([ \t]*\)[ \t]*(?:->[^:\n]*)?:)/gm;
  let m;
  while ((m = re.exec(String(code || '')))) {
    if (m[2] === 'parts') { out.push('Putting the parts together'); continue; }
    if (m[2] === 'motion') { out.push('Working out how it moves'); continue; }
    const p = phrase(label(m[1] || m[2]));
    if (p && out[out.length - 1] !== p) out.push(p);
  }
  return out;
}

const base = (f) => String(f || '').split('/').pop();
/** One caption for a finished tool call (or null to keep the current one). parts: part names an Edit touches (editglow). */
function forTool(name, input = {}, parts = null) {
  const f = base(input.file_path);
  switch (name) {
    case 'Read':
      if (/^uploads\//.test(String(input.file_path || '').replace(/^\.\//, '')) || /\/uploads\//.test(String(input.file_path || ''))) return 'Studying your photo';
      if (f === 'design.py') return 'Looking over the design';
      if (/\.(md|txt)$/.test(f) || /\/cadlib\//.test(String(input.file_path || ''))) return 'Checking the part library';
      return null;
    case 'Glob': case 'Grep': return 'Checking the part library';
    case 'WebSearch': case 'WebFetch': return 'Looking up real sizes';
    case 'TodoWrite': return 'Planning the parts';
    case 'Write': case 'Edit': case 'MultiEdit': {
      if (f === 'bom.json') return 'Pricing the bought parts';
      if (f === 'wiring.json') return 'Planning the wiring';
      if (/\.(ino|cpp|h)$/.test(f)) return 'Writing the firmware';
      if (f !== 'design.py') return null;
      const code = name === 'Write' ? input.content : name === 'MultiEdit' ? (input.edits || []).map((e) => e.new_string || '').join('\n') : input.new_string;
      const list = fromCode(code);
      if (name !== 'Write' && list.length) return list[list.length - 1];
      if (name !== 'Write' && parts?.length) { const p = label(String(parts[0]).replace(/\(.*?\)/g, '')); if (p) return `Adjusting the ${p}`; }
      return name === 'Write' ? 'Putting the parts together' : 'Adjusting the design';
    }
    case 'Bash': return /build\.sh/.test(input.command || '') ? 'Building the parts' : /cadlib/.test(input.command || '') ? 'Checking the part library' : null;
    default: return null;
  }
}

/** After ./build.sh: what the build said. */
function forBuild(ok, body = '') {
  if (!ok) return 'Fixing a build problem';
  if (/exceeds the \d+ mm bed|bigger than the bed|exceeds .*bed/i.test(body)) return 'Making it fit the printer';
  return 'Checking it fits the printer';
}

/** Nothing new for a while (the agent is thinking): a calm line that fits where the run is. */
const idle = (built) => (built ? 'Refining the details' : 'Planning the parts');

module.exports = { label, phrase, fromCode, forTool, forBuild, idle };

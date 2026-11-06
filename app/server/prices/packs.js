// Pack sizes for bought parts. Shops sell small hardware by the pack: a design that needs 4 M3 screws still buys a bag of
// 100. The Order tab charges what the shop charges, so every bought line is priced per pack actually bought.
//
//   packFor(part) -> { qty, usd, why }   qty = pieces per pack, usd = price of one pack
//
// A parts-list line can say it directly with `pack_qty` (pieces per pack) and `pack_usd` (price of the pack). Otherwise the
// name picks a typical Amazon pack (Prime listings, Oct 2026 ballpark) for pieces that cost under $1 each, and the pack price is the per-piece estimate times
// the pack, kept between that kind of pack's usual floor price and twice it (a single-piece price times 100 overshoots a
// real bag). Anything not listed below is sold one at a time.
'use strict';

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** [name test, [[pieces per pack, lowest price seen for that pack], ...], noun]. First match wins. Several sizes: the
 * order takes whichever costs least for the pieces it needs (4 screws: a bag of 25, not 100). */
const PACKS = [
  [/\b(glue|adhesive|epoxy|loctite|thread ?lock|grease|lubricant|tape)\b/i, [[1, 5.99]], 'tube'],
  [/\bheat[- ]?set\b|\bthreaded inserts?\b|\binserts?\b.*\bM\d/i, [[50, 6.99], [100, 8.99]], 'bag'],
  [/\bfender washers?\b/i, [[25, 6.99]], 'bag'],
  [/\b(screws?|bolts?|shcs|bhcs|fhcs)\b/i, [[25, 5.99], [100, 7.99]], 'bag'],
  [/\bt-?nuts?\b/i, [[20, 6.99], [50, 7.99]], 'bag'],
  [/\b(nuts?|nylocks?|washers?)\b/i, [[50, 5.99], [100, 6.99]], 'bag'],
  [/\b(magnets?)\b/i, [[20, 8.99]], 'pack'],
  [/\b(rubber feet|bumpers?|bump ?ons?|feet)\b/i, [[24, 6.99]], 'sheet'],
  [/\b(zip ?ties?|cable ties?)\b/i, [[100, 5.99]], 'bag'],
  [/\b(springs?)\b/i, [[20, 7.99]], 'pack'],
  [/\b(o-?rings?)\b/i, [[50, 6.99]], 'pack'],
  [/\b(pins?|dowels?|rivets?)\b/i, [[50, 6.99]], 'pack'],
  [/\b(608|625|688|6[0-9]{3}).*\bbearings?\b|\bbearings?\b/i, [[10, 7.99]], 'pack'],
  [/\b(jumper wires?|dupont)\b/i, [[40, 6.99]], 'pack'],
  [/\b(resistors?|capacitors?|leds?)\b(?!.*\bstrip)/i, [[50, 5.99]], 'pack'],
  [/\b(suction cups?|hooks?|clips?)\b/i, [[10, 6.99]], 'pack'],
];

/** "(pack of 10)", "10-pack", "10 pcs", "set of 4" in a name -> pieces per pack, or 0. */
function packInName(name) {
  const s = String(name || '');
  const m = s.match(/\bpack of (\d{1,4})\b|\b(\d{1,4})[- ]?(?:pack|pk|pcs|pieces|count|ct)\b|\bset of (\d{1,4})\b|\bbag of (\d{1,4})\b/i);
  return m ? Number(m[1] || m[2] || m[3] || m[4]) || 0 : 0;
}

/** Pieces per pack and the pack price for one parts-list line. need: pieces the order needs (picks the cheapest pack size). */
function packFor(p, need = 1) {
  const each = n(p.unit_cost_usd);
  if (n(p.pack_qty) >= 1) {
    const qty = Math.floor(n(p.pack_qty));
    return { qty, usd: n(p.pack_usd) > 0 ? n(p.pack_usd) : each * qty, why: 'pack size from the parts list' };
  }
  const named = packInName(p.name);
  // the name says the pack size; a price over $2 is the pack's own price rather than a piece's
  if (named > 1) return { qty: named, usd: each > 2 ? each : Math.max(each * named, 0.01), why: `pack of ${named}` };
  const hit = PACKS.find(([re]) => re.test(String(p.name || '')));
  const floorMax = hit ? Math.max(...hit[1].map((x) => x[1])) : 0;
  if (hit && each > 0 && (each <= 1 || hit[1][0][0] === 1) && each < floorMax) { // under $1 a piece: a bulk item; dearer lines are sold singly
    // each size's price: the per-piece estimate times the pack, kept between that pack's usual floor and twice it
    // (a single-piece price times 100 overshoots a real bag)
    if (hit[1].length === 1 && hit[1][0][0] === 1) { // a tube or roll: the parts list's price is one kit's share of it
      const floor = hit[1][0][1], kits = Math.max(1, Math.floor(floor / each));
      const noun = /\b(tape|strip)\b/i.test(p.name) ? 'roll' : /\b(glue|lubricant)\b/i.test(p.name) ? 'bottle' : 'tube';
      return { qty: kits, usd: floor, why: kits > 1 ? `one ${noun} is enough for about ${kits}` : `sold by the ${noun}`, noun };
    }
    const opts = hit[1].map(([qty, floor]) => ({ qty, usd: Math.min(Math.max(each * qty, floor), floor * 2) }))
      .map((o) => ({ ...o, cost: Math.ceil(Math.max(1, need) / o.qty) * o.usd }))
      .sort((a, b) => a.cost - b.cost || b.qty - a.qty);
    const best = opts[0];
    return { qty: best.qty, usd: best.usd, why: best.qty > 1 ? `usually sold as a ${hit[2]} of ${best.qty}` : `sold as a ${hit[2]}` };
  }
  return { qty: 1, usd: each, why: '' };
}

/** "1 pack of 100", "2 packs of 25", "1 roll", "3 bottles", "4" (singles). */
function buyText(packs, qty, need, noun) {
  if (noun) return `${packs} ${noun}${packs === 1 ? '' : 's'}`;
  if (qty <= 1) return String(need);
  return `${packs} ${packs === 1 ? 'pack' : 'packs'} of ${qty}`;
}

module.exports = { packFor, packInName, buyText, PACKS };

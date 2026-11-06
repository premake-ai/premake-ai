// card-stats: the one-line "Designed in 8 min · $6.34 each" (or "Prints in 2.1 h · $6.34 each") under a product card's
// creator. Numbers come from the server (cardStats in server.js): price_each = the Order tab price for 1 kit (at cost, delivered), design_minutes =
// summed design-agent run time from runs.jsonl (null for script-built examples, so no design time is shown), print_hours =
// bom.json printed totals. Returns '' when there is nothing real to show.

/** "Designed in 8 min" (rounded up; "under 1 min"), else "Prints in 2.1 h", plus "$6.34 each". */
export function statsText(x) {
  if (!x) return '';
  const bits = [];
  const m = Number(x.design_minutes), h = Number(x.print_hours), p = Number(x.price_each);
  if (x.design_minutes != null && Number.isFinite(m) && m > 0) bits.push(m < 1 ? 'Designed in under 1 min' : `Designed in ${Math.ceil(m)} min`);
  else if (x.print_hours != null && Number.isFinite(h) && h > 0) bits.push(`Prints in ${h < 0.1 ? '0.1' : h.toFixed(1)} h`);
  if (x.price_each != null && Number.isFinite(p) && p > 0) bits.push(`$${p.toFixed(2)} each`);
  return bits.join(' · ');
}

/** The line as HTML (class "cstats": muted, tabular numbers, one line with ellipsis), or '' when empty. */
export function statsHtml(x, cls = 'cstats') {
  const t = statsText(x);
  return t ? `<div class="${cls}" title="${t}">${t}</div>` : '';
}

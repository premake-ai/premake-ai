// Plain-text tables for quotes and suppliers (CLI output and MCP tool text).
const money = (n) => (n == null ? '-' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const PROC = { cnc: 'CNC', sheet_metal: 'sheet metal', laser_cut: 'laser cut', tube_laser: 'tube laser', '3d_print': '3D print' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function niceDate(d) {
  if (!d) return '-';
  const x = new Date(d + 'T12:00:00Z');
  return Number.isNaN(x.getTime()) ? String(d) : `${DAYS[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`;
}

export function table(rows, { align = [] } = {}) {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => (align[i] === 'r' ? String(c).padStart(w[i]) : String(c).padEnd(w[i]))).join('  ').trimEnd();
  return [line(rows[0]), w.map((n) => '-'.repeat(n)).join('  '), ...rows.slice(1).map(line)].join('\n');
}

/** One offer's supplier label: "Justway (AFN)". */
const who = (o) => (o.via && o.via !== 'Premake estimate' ? `${o.supplier} (${o.via})` : o.via === 'Premake estimate' ? 'Local shop (model)' : o.supplier);

export function formatQuote(q, { maxRows = 8 } = {}) {
  const out = [];
  for (const p of q.parts) {
    out.push(`${p.name} · ${p.material}`);
    for (const qty of p.qtys) {
      const offers = q.offers.filter((o) => o.part_id === p.part_id && o.qty === qty)
        .sort((a, b) => ((a.total_usd ?? 1e12) + (a.shipping_usd || 0)) - ((b.total_usd ?? 1e12) + (b.shipping_usd || 0)));
      out.push('', `${qty} piece${qty === 1 ? '' : 's'}`);
      if (!offers.length) { out.push('  no offers yet'); continue; }
      const rows = [['Supplier', 'Process', 'Each', 'Total', 'Shipping', 'Arrives', 'Price']];
      for (const o of offers.slice(0, maxRows)) {
        rows.push([who(o), PROC[o.process] || o.process || '-', money(o.unit_usd), money(o.total_usd), o.shipping_usd ? money(o.shipping_usd) : '-',
          `${o.arrival_is_estimate && o.arrives_by ? '~' : ''}${niceDate(o.arrives_by)}`, o.live ? 'live' : 'estimate']);
      }
      out.push(table(rows, { align: [, , 'r', 'r', 'r'] }).split('\n').map((l) => '  ' + l).join('\n'));
      if (offers.length > maxRows) out.push(`  + ${offers.length - maxRows} more on the comparison page`);
      const b = (q.best || []).find((x) => x.part_id === p.part_id && x.qty === qty);
      if (b?.cheapest) out.push(`  Cheapest: ${who(b.cheapest)}, ${money((b.cheapest.total_usd || 0) + (b.cheapest.shipping_usd || 0))}${b.cheapest.shipping_usd ? ' with shipping' : ''}${b.cheapest.live ? '' : ' (estimate)'}`);
      if (b?.fastest) out.push(`  Fastest:  ${who(b.fastest)}, arrives ${b.fastest.arrival_is_estimate ? 'about ' : ''}${niceDate(b.fastest.arrives_by)}${b.fastest.live ? '' : ' (estimate)'}`);
    }
    out.push('');
  }
  if (q.status !== 'complete' && q.pending?.length) out.push(`Still waiting on: ${[...new Set(q.pending.map((x) => x.supplier))].join(', ')}. Run: premake-ai get ${q.quote_id}`);
  if (q.errors?.length) out.push(`No price from: ${q.errors.map((e) => `${e.supplier || 'a supplier'} (${e.message})`).join('; ')}`);
  out.push(`~ = arrival estimated. Shipping - = not included (priced at checkout). "estimate" = Premake's price model, not a shop's quote.`);
  out.push(`Compare and order: ${q.url}`);
  return out.join('\n');
}

export function formatSuppliers(s) {
  const rows = [['Supplier', 'Price', 'Makes', 'Where', 'Needs']];
  for (const x of s.suppliers) rows.push([x.name + (x.available === false ? ' (off)' : ''), x.kind, x.processes.map((p) => PROC[p] || p).join(', '), x.location, x.needs]);
  return table(rows);
}

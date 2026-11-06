// Slant 3D adapter (server/fulfilment). Semi-automatic through Slant's public MCP server (https://www.slant3d.com/mcp,
// Streamable HTTP JSON-RPC, no key, browser User-Agent, SSE `data:` replies):
//   quote()    quote_upload_part (each STL) -> quote_set_quantity -> quote_shipping_options(ship-to)   [admin click]
//   checkout() quote_checkout -> a Stripe payment link. Only on an explicit admin click with ctx.confirm === true.
//              It never pays: Josh opens the link and pays; once paid, Slant submits the order to its farm.
//   place()    manual: Josh marks the job placed and enters Slant's order #.
// TODO(automation): Slant's own print API (slant3dapi.com) takes orders directly with SLANT3D_API_KEY (account + card on
// file). With that key, place() can POST the order instead of a payment link. Not implemented: no key yet.
'use strict';
const { env } = require('./_base');

const MCP_URL = 'https://www.slant3d.com/mcp';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const MATERIAL = 'PETG';
const CALL_TIMEOUT_MS = 60e3;
// quote_checkout only creates a payment link; it is allowed, but only via checkout() below.
const TOOLS = new Set(['quote_upload_part', 'quote_set_quantity', 'quote_shipping_options', 'quote_checkout']);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

async function call(name, args) {
  if (!TOOLS.has(name)) throw new Error(`refusing Slant tool ${name}`);
  const r = await fetch(MCP_URL, {
    method: 'POST', signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Slant 3D ${r.status}`);
  let msg = null;
  if (/^\s*\{/.test(text)) msg = JSON.parse(text);
  else for (const l of text.split('\n')) if (l.startsWith('data:')) { try { msg = JSON.parse(l.slice(5)); } catch {} }
  if (!msg) throw new Error('Slant 3D: empty response');
  if (msg.error) throw new Error(`Slant 3D: ${msg.error.message || 'error'}`);
  const res = msg.result || {};
  let out = res.structuredContent;
  if (!out) { try { out = JSON.parse(res.content?.[0]?.text || ''); } catch { out = null; } }
  if (res.isError || !out) throw new Error(`Slant 3D: ${String(res.content?.[0]?.text || 'tool error').slice(0, 300)}`);
  return out;
}

/** Ship-to (Stripe-style address) -> Slant's quote_shipping_options args, or null with the missing fields. */
function slantAddress(a) {
  if (!a) return { missing: ['address'] };
  const out = { name: a.name, street1: a.line1, street2: a.line2 || undefined, city: a.city, state: a.state, postal_code: a.postal_code, country: a.country || 'US',
    phone: a.phone || undefined };
  const missing = ['name', 'street1', 'city', 'state', 'postal_code'].filter((k) => !String(out[k] || '').trim() || /^<.*>$/.test(String(out[k])));
  return missing.length ? { missing } : { args: out };
}

module.exports = {
  id: 'slant3d', name: 'Slant 3D', kinds: ['printed'], url: 'https://www.slant3d.com/',
  env: ['SLANT3D_API_KEY'],
  api: 'Public MCP: quote + shipping + payment link (no key). Print API with SLANT3D_API_KEY + card on file places orders directly.',
  todo: 'With SLANT3D_API_KEY, implement place() against the Slant print API (POST order) instead of the payment link.',
  auto: () => false,
  hasKeys: () => !!env('SLANT3D_API_KEY'),

  /** Upload every printed part, set the quantity, rate shipping to the job's ship-to. Returns the quote record. */
  async quote(job, ctx) {
    const parts = job.parts.filter((p) => p.file);
    if (!parts.length) throw Object.assign(new Error('No STL files in this job.'), { code: 409 });
    let quoteId = null, last = null;
    const feedback = [];
    const perPart = job.parts.map((p) => p.qty_per_unit || 1);
    // Slant prices "sets" of uploaded parts. A part needed twice per unit is uploaded twice.
    for (const p of parts) {
      const buf = ctx.readPart(p.file);
      if (!buf) throw Object.assign(new Error(`Missing file ${p.file}`), { code: 409 });
      for (let k = 0; k < Math.max(1, Math.min(10, p.qty_per_unit || 1)); k++) {
        last = await call('quote_upload_part', { file_name: `${p.name.replace(/[^\w.-]+/g, '-').slice(0, 60) || 'part'}${k ? '-' + (k + 1) : ''}.stl`,
          file_content: buf.toString('base64'), material: MATERIAL, ...(quoteId ? { quote_id: quoteId } : {}) });
        quoteId = last.quote_id || quoteId;
        if (!quoteId) throw new Error('Slant 3D: no quote_id');
      }
      for (const i of (last.print_feedback?.issues || []).slice(0, 3)) feedback.push({ part: p.name, severity: i.severity, title: i.title });
    }
    const quantity = Math.max(1, Number(ctx.order.qty) || 1);
    const q = await call('quote_set_quantity', { quote_id: quoteId, quantity });
    const sel = q.selected || {};
    const out = {
      quote_id: quoteId, material: q.material || MATERIAL, color: q.color || '', quantity, per_part_qty: perPart,
      unit_usd: num(sel.unit_price_usd), setup_usd: num(sel.setup_fee_usd) || 0, subtotal_usd: num(sel.subtotal_usd), lead_time: sel.lead_time || '',
      shipping_options: [], shipping_to: null, shipping_error: null, feedback, quoted_at: new Date().toISOString(),
    };
    const addr = slantAddress(ctx.shipTo);
    if (addr.args) {
      try {
        const s = await call('quote_shipping_options', { quote_id: quoteId, ...addr.args });
        out.shipping_options = (s.shipping_options || []).map((o) => ({ id: String(o.shipping_option_id), carrier: o.carrier, service: o.service,
          rate_usd: num(o.rate_usd), days: num(o.delivery_days) })).sort((a, b) => (a.rate_usd ?? 1e9) - (b.rate_usd ?? 1e9));
        out.boxes = num(s.boxes);
        out.shipping_to = `${addr.args.name}, ${addr.args.city} ${addr.args.state} ${addr.args.postal_code}`;
        if (s.pricing?.subtotal_usd != null) out.subtotal_usd = num(s.pricing.subtotal_usd);
      } catch (e) { out.shipping_error = String(e.message || e).slice(0, 200); }
    } else out.shipping_error = `Ship-to address incomplete (${addr.missing.join(', ')}).`;
    out.chosen_shipping = out.shipping_options[0]?.id || null;
    const ship = out.shipping_options[0]?.rate_usd ?? 0;
    out.total_usd = out.subtotal_usd != null ? Math.round((out.subtotal_usd + ship) * 100) / 100 : null;
    return out;
  },

  /** Payment link for a quoted job. Requires ctx.confirm (the admin clicked the button). Never pays. */
  async checkout(job, ctx, { shipping_option_id } = {}) {
    if (ctx.confirm !== true) throw Object.assign(new Error('Payment links are only created from an explicit admin click.'), { code: 400 });
    const sq = job.slant;
    if (!sq?.quote_id) throw Object.assign(new Error('Get a Slant quote first.'), { code: 409 });
    const opt = shipping_option_id || sq.chosen_shipping;
    if (!opt || !(sq.shipping_options || []).some((o) => o.id === opt)) throw Object.assign(new Error('Pick a shipping option from the quote.'), { code: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ctx.email || '')) throw Object.assign(new Error('Set BUILDERY_SHIP_FROM_EMAIL (Slant sends the receipt there).'), { code: 409 });
    const r = await call('quote_checkout', { quote_id: sq.quote_id, email: ctx.email, shipping_option_id: opt, quantity: sq.quantity });
    const url = [r.checkout_url, r.url, r.payment_url, r.payment_link].find((u) => /^https:\/\//.test(String(u || '')))
      || (JSON.stringify(r).match(/https:\/\/[^"\s]+/) || [])[0];
    if (!url) throw new Error('Slant 3D did not return a payment link.');
    return { checkout_url: url, shipping_option_id: opt, created_at: new Date().toISOString(), total_usd: num(r.total_usd ?? r.amount_usd) };
  },

  place: async () => ({ manual: true, reason: 'Pay the Slant payment link, then mark this job placed with the Slant order #.' }),
  status: async () => ({ manual: true, reason: 'Slant emails order updates to BUILDERY_SHIP_FROM_EMAIL. Enter tracking here when it ships.' }),
  _call: call, _slantAddress: slantAddress,
};

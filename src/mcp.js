// premake-ai MCP server (stdio): quote_part, get_quote, list_suppliers. Read-only: no tool orders or pays.
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { quoteFile, getQuote, listSuppliers, apiBase } from './client.js';
import { formatQuote, formatSuppliers } from './format.js';

/** The quote, trimmed for a model's context: no per-offer order links (one url covers them). */
function compact(q) {
  return {
    quote_id: q.quote_id, status: q.status, url: q.url, parts: q.parts,
    offers: q.offers.map(({ order_url, supplier_url, ...o }) => o),
    best: (q.best || []).map((b) => ({ part_id: b.part_id, qty: b.qty, cheapest: b.cheapest && pick(b.cheapest), fastest: b.fastest && pick(b.fastest), cheapest_live: b.cheapest_live && pick(b.cheapest_live) })),
    pending: q.pending, errors: q.errors, notice: q.notice,
  };
}
const pick = (o) => ({ supplier: o.supplier, via: o.via, total_usd: o.total_usd, shipping_usd: o.shipping_usd, arrives_by: o.arrives_by, live: o.live });
const reply = (text, data) => ({ content: [{ type: 'text', text }], structuredContent: data });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: `premake-ai: ${e.message}` }] });

export function createServer() {
  const server = new McpServer({ name: 'premake-ai', version: '0.2.0' });

  server.registerTool('quote_part', {
    title: 'Quote a part',
    description: 'Get live manufacturing quotes for a STEP or STL file from machine shops, sheet-metal shops, print networks and factories '
      + '(RMFG, MATERIAM, the AFN CNC network with Justway, PCBWay, Protolabs and others, Slant 3D), plus clearly labelled estimates. '
      + 'Uploads the file, waits for suppliers (up to a few minutes), and returns offers with price, shipping and arrival date, '
      + 'the cheapest and fastest option, and a comparison link. Never orders or pays: the person orders from the link.',
    inputSchema: {
      path: z.string().describe('Path to a .step/.stp (preferred: metal shops need it) or .stl file, up to 50 MB'),
      qtys: z.array(z.number().int().min(1).max(100000)).max(6).optional().describe('Quantities to price, e.g. [1, 10, 100]. Default [1]'),
      material: z.string().optional().describe('aluminium (default), steel, stainless, plastic (3D printed PETG) or acrylic'),
      ship_to_zip: z.string().optional().describe('Delivery postcode, if known'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ path, qtys, material, ship_to_zip }) => {
    try {
      const { part, quote } = await quoteFile(resolve(path), { qtys: qtys?.length ? qtys : [1], material, shipToZip: ship_to_zip, timeoutMs: 180e3 });
      const head = `${part.filename}: ${(part.bbox_mm || []).join(' x ')} mm, likely ${part.processes.join(' / ')}${(part.warnings || []).map((w) => `\nNote: ${w}`).join('')}\n\n`;
      return reply(head + formatQuote(quote), { part: { part_id: part.part_id, bbox_mm: part.bbox_mm, volume_mm3: part.volume_mm3, processes: part.processes, warnings: part.warnings }, quote: compact(quote) });
    } catch (e) { return fail(e); }
  });

  server.registerTool('get_quote', {
    title: 'Get a quote',
    description: 'Fetch a Premake quote by id (qt_...): offers so far, status pending or complete, cheapest and fastest options, comparison link. Use it to check on a quote that was still pending.',
    inputSchema: { quote_id: z.string().describe('The quote id, e.g. qt_8f3a...') },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ quote_id }) => {
    try { const q = await getQuote(quote_id); return reply(formatQuote(q), { quote: compact(q) }); } catch (e) { return fail(e); }
  });

  server.registerTool('list_suppliers', {
    title: 'List suppliers',
    description: 'Who Premake can quote: each supplier, whether its prices are live or estimates, what it makes, where, and which file it needs.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async () => {
    try { const s = await listSuppliers(); return reply(formatSuppliers(s), s); } catch (e) { return fail(e); }
  });

  return server;
}

export async function runStdio() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  console.error(`premake-ai MCP server on stdio, API ${apiBase()}`);
}

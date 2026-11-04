// End-to-end check of the MCP server over stdio, against a real API (PREMAKE_API).
//   PREMAKE_API=http://127.0.0.1:8800 node scripts/mcp-smoke.mjs part.step [material] [qtys]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const [file, material = 'aluminium', qtys = '1,10,100'] = process.argv.slice(2);
const bin = fileURLToPath(new URL('../bin/premake-ai.js', import.meta.url));
const client = new Client({ name: 'premake-ai-smoke', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [bin, 'mcp'], env: { ...process.env } }));
const { tools } = await client.listTools();
console.log('tools:', tools.map((t) => t.name).join(', '));
const sup = await client.callTool({ name: 'list_suppliers', arguments: {} });
console.log('list_suppliers:', sup.isError ? sup.content[0].text : `${sup.structuredContent.suppliers.length} suppliers`);
if (file) {
  const t0 = Date.now();
  const r = await client.callTool({ name: 'quote_part', arguments: { path: file, material, qtys: qtys.split(',').map(Number) } }, undefined, { timeout: 300e3 });
  console.log(`quote_part (${((Date.now() - t0) / 1000).toFixed(1)} s):`);
  console.log(r.content[0].text);
  if (!r.isError) {
    const q = r.structuredContent.quote;
    console.log(`\nstructured: status=${q.status} offers=${q.offers.length} live=${q.offers.filter((o) => o.live).length} suppliers=${[...new Set(q.offers.map((o) => o.supplier))].join(', ')}`);
    const g = await client.callTool({ name: 'get_quote', arguments: { quote_id: q.quote_id } });
    console.log(`get_quote: ${g.isError ? g.content[0].text : `${g.structuredContent.quote.status}, ${g.structuredContent.quote.offers.length} offers`}`);
  }
}
await client.close();

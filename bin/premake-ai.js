#!/usr/bin/env node
// premake-ai: quote a part across machine shops, print networks and factories.
import { parseArgs } from 'node:util';
import { quoteFile, getQuote, waitForQuote, listSuppliers, parseQtys, apiBase } from '../src/client.js';
import { formatQuote, formatSuppliers } from '../src/format.js';

const HELP = `premake-ai: get parts made. One API over machine shops, print networks and factories.

Usage
  premake-ai quote <file.step|file.stl> [--qty 1,10,100] [--material aluminium] [--zip 10001] [--json]
  premake-ai get <quote_id> [--json]
  premake-ai suppliers [--json]
  premake-ai mcp                         run the MCP server on stdio (for Claude Code, Cursor and others)

Materials: aluminium (default), steel, stainless, plastic (3D printed PETG), acrylic.
API: ${apiBase()}  (set PREMAKE_API to change it)
Premake never orders or pays for anything. Open the comparison link to order.`;

async function main() {
  const { values: v, positionals: [cmd, arg] } = parseArgs({
    allowPositionals: true,
    options: { qty: { type: 'string', short: 'q', default: '1' }, material: { type: 'string', short: 'm' }, zip: { type: 'string' },
      json: { type: 'boolean', default: false }, timeout: { type: 'string', default: '240' }, help: { type: 'boolean', short: 'h' } },
  });
  if (v.help || !cmd || cmd === 'help') { console.log(HELP); return; }
  if (cmd === 'mcp') { const { runStdio } = await import('../src/mcp.js'); await runStdio(); return; }
  if (cmd === 'suppliers') {
    const s = await listSuppliers();
    console.log(v.json ? JSON.stringify(s, null, 2) : formatSuppliers(s));
    return;
  }
  if (cmd === 'get') {
    if (!arg) throw new Error('Usage: premake-ai get <quote_id>');
    const q = await getQuote(arg);
    console.log(v.json ? JSON.stringify(q, null, 2) : formatQuote(q));
    return;
  }
  if (cmd === 'quote') {
    if (!arg) throw new Error('Usage: premake-ai quote <file.step> --qty 1,10,100 --material aluminium');
    const qtys = parseQtys(v.qty);
    const tty = process.stderr.isTTY && !v.json;
    let last = '';
    const { part, quote } = await quoteFile(arg, {
      qtys, material: v.material, shipToZip: v.zip, timeoutMs: Number(v.timeout) * 1000,
      onProgress: (q) => {
        if (!tty) return;
        const msg = q.status === 'complete' ? '' : `Asking ${[...new Set(q.pending.map((x) => x.supplier))].join(', ')}... ${q.offers.length} offers so far`;
        if (msg !== last) { process.stderr.write(`\r\x1b[K${msg}`); last = msg; }
      },
    });
    if (tty) process.stderr.write('\r\x1b[K');
    if (v.json) { console.log(JSON.stringify({ part, quote }, null, 2)); return; }
    const size = (part.bbox_mm || []).map((x) => Math.round(x * 10) / 10).join(' x ');
    console.log(`${part.filename}: ${size} mm, ${Math.round(part.volume_mm3).toLocaleString('en-US')} mm3, likely ${part.processes.join(' / ').replace(/_/g, ' ')}`);
    for (const w of part.warnings || []) console.log(`Note: ${w}`);
    console.log('');
    console.log(formatQuote(quote));
    return;
  }
  throw new Error(`Unknown command "${cmd}". Run premake-ai --help`);
}

main().catch((e) => { console.error(`premake-ai: ${e.message}`); process.exit(1); });

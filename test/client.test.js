// node --test test/   CLI and MCP server against a fake API on localhost (no network, no real suppliers).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { parseQtys, apiBase } from '../src/client.js';
import { formatQuote, niceDate, table } from '../src/format.js';

const BIN = fileURLToPath(new URL('../bin/premake-ai.js', import.meta.url));
const QID = 'qt_0123456789abcdef0123';
const offer = (o) => ({ part_id: 'prt_aaaaaaaaaaaaaaaaaaaa', qty: 1, process: 'sheet_metal', unit_usd: 10, total_usd: 10, shipping_usd: null, arrives_by: '2026-11-13', arrival_is_estimate: true, live: true, notes: [], ...o });
function quote(status) {
  const offers = [offer({ supplier: 'RMFG' }), offer({ supplier: 'Justway', via: 'AFN', process: 'cnc', unit_usd: 30, total_usd: 30, shipping_usd: 5, arrives_by: '2026-11-26', arrival_is_estimate: false }),
    offer({ supplier: 'SendCutSend', unit_usd: 39, total_usd: 39, live: false })];
  return { quote_id: QID, status, url: `http://x/q/${QID}`, parts: [{ part_id: 'prt_aaaaaaaaaaaaaaaaaaaa', name: 'bracket', material: 'Aluminium', qtys: [1] }],
    offers: status === 'complete' ? offers : offers.slice(0, 1), best: [{ part_id: 'prt_aaaaaaaaaaaaaaaaaaaa', qty: 1, cheapest: offers[0], fastest: offers[0] }],
    pending: status === 'complete' ? [] : [{ supplier: 'AFN network' }], errors: [] };
}
function fakeApi() {
  const seen = { uploads: [], quotes: [], polls: 0 };
  const srv = http.createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const send = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.method === 'POST' && req.url === '/api/v1/parts') { seen.uploads.push({ name: req.headers['x-filename'], bytes: body.length }); return send(201, { part_id: 'prt_aaaaaaaaaaaaaaaaaaaa', filename: req.headers['x-filename'], bbox_mm: [2, 50, 80], volume_mm3: 8000, processes: ['laser_cut', 'cnc'], warnings: [] }); }
      if (req.method === 'POST' && req.url === '/api/v1/quotes') { seen.quotes.push(JSON.parse(body)); return send(202, { quote_id: QID, url: `http://x/q/${QID}` }); }
      if (req.url === `/api/v1/quotes/${QID}`) return send(200, quote(++seen.polls >= 2 ? 'complete' : 'pending'));
      if (req.url === '/api/v1/suppliers') return send(200, { suppliers: [{ id: 'rmfg', name: 'RMFG', kind: 'live', processes: ['sheet_metal'], location: 'TX', needs: 'STEP', available: true }] });
      send(404, { error: 'not found' });
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, seen, url: `http://127.0.0.1:${srv.address().port}` })));
}
const stepFile = () => { const d = mkdtempSync(join(tmpdir(), 'premake-ai-')); const f = join(d, 'bracket.step'); writeFileSync(f, 'ISO-10303-21;\nHEADER;\nENDSEC;\n'); return f; };

test('helpers', () => {
  assert.deepEqual(parseQtys('100, 1,10,10'), [1, 10, 100]);
  assert.throws(() => parseQtys('x'));
  assert.equal(apiBase('http://a/'), 'http://a');
  assert.equal(niceDate('2026-11-13'), 'Fri 13 Nov');
  assert.equal(table([['a', 'b'], ['ccc', 'd']]), 'a    b\n---  -\nccc  d');
  const text = formatQuote(quote('complete'));
  assert.match(text, /RMFG/); assert.match(text, /Justway \(AFN\)/); assert.match(text, /estimate/);
  assert.match(text, /Cheapest: RMFG, \$10\.00/); assert.match(text, /Compare and order: http:\/\/x\/q\//);
});

test('CLI: quote uploads, polls and prints the table', async (t) => {
  const api = await fakeApi(); t.after(() => api.srv.close());
  const { stdout } = await promisify(execFile)(process.execPath, [BIN, 'quote', stepFile(), '--qty', '1,10', '--material', 'steel'], { env: { ...process.env, PREMAKE_API: api.url } });
  assert.equal(api.seen.uploads[0].name, 'bracket.step');
  assert.deepEqual(api.seen.quotes[0], { parts: [{ part_id: 'prt_aaaaaaaaaaaaaaaaaaaa', qty: [1, 10], material: 'steel' }] });
  assert.ok(api.seen.polls >= 2, 'polled until complete');
  assert.match(stdout, /Supplier\s+Process\s+Each/);
  assert.match(stdout, /Compare and order/);
  const sup = await promisify(execFile)(process.execPath, [BIN, 'suppliers'], { env: { ...process.env, PREMAKE_API: api.url } });
  assert.match(sup.stdout, /RMFG\s+live/);
});

test('CLI: refuses non-CAD files before uploading', async () => {
  const d = mkdtempSync(join(tmpdir(), 'premake-ai-')); writeFileSync(join(d, 'x.txt'), 'hi');
  await assert.rejects(promisify(execFile)(process.execPath, [BIN, 'quote', join(d, 'x.txt')], { env: { ...process.env, PREMAKE_API: 'http://127.0.0.1:9' } }), /STEP/);
});

test('MCP: tools listed, quote_part returns offers', async (t) => {
  const api = await fakeApi(); t.after(() => api.srv.close());
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [BIN, 'mcp'], env: { ...process.env, PREMAKE_API: api.url }, stderr: 'ignore' }));
  t.after(() => client.close());
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((x) => x.name).sort(), ['get_quote', 'list_suppliers', 'quote_part']);
  assert.ok(tools.every((x) => x.annotations?.readOnlyHint), 'read-only: nothing orders');
  const r = await client.callTool({ name: 'quote_part', arguments: { path: stepFile(), qtys: [1], material: 'aluminium' } });
  assert.ok(!r.isError, r.content?.[0]?.text);
  assert.equal(r.structuredContent.quote.status, 'complete');
  assert.equal(r.structuredContent.quote.offers.length, 3);
  assert.match(r.content[0].text, /Cheapest: RMFG/);
  const g = await client.callTool({ name: 'get_quote', arguments: { quote_id: 'nope' } });
  assert.ok(g.isError);
});

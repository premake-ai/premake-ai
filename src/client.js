// premake-ai API client. Talks to the Premake sourcing API over HTTP (https://premake.ai by default, or PREMAKE_API).
// No keys needed: anonymous use is rate-limited per IP. Nothing here can place an order or pay.
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

export const DEFAULT_API = 'https://premake.ai';
export const MAX_FILE = 50 * 1024 * 1024;
const VERSION = '0.1.0';

export function apiBase(override) {
  return String(override || process.env.PREMAKE_API || DEFAULT_API).replace(/\/+$/, '');
}

async function call(base, path, { method = 'GET', body, headers = {}, timeoutMs = 120e3 } = {}) {
  let res;
  try {
    res = await fetch(base + path, { method, body, headers: { 'User-Agent': `premake-ai/${VERSION}`, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new Error(`Could not reach ${base} (${e.cause?.code || e.name || e.message})`);
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) {
    const msg = json?.error || text.slice(0, 200) || res.statusText;
    throw Object.assign(new Error(`${res.status}: ${msg}`), { status: res.status });
  }
  if (!json) throw new Error(`Unexpected reply from ${base}${path}`);
  return json;
}

/** Upload a STEP or STL file. -> { part_id, bbox_mm, volume_mm3, processes, warnings, ... } */
export async function uploadPart(file, { api } = {}) {
  const st = await stat(file).catch(() => null);
  if (!st || !st.isFile()) throw new Error(`No such file: ${file}`);
  if (st.size > MAX_FILE) throw new Error(`${basename(file)} is ${(st.size / 1048576).toFixed(1)} MB; the limit is 50 MB`);
  if (!/\.(step|stp|stl)$/i.test(file)) throw new Error('Send a STEP (.step, .stp) or STL file');
  const buf = await readFile(file);
  return call(apiBase(api), '/api/v1/parts', { method: 'POST', body: buf, headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': basename(file) } });
}

/** Ask for quotes. parts: [{ part_id, qty: number | number[], material }] -> { quote_id, url, ... } */
export function createQuote(parts, { api, shipToZip } = {}) {
  return call(apiBase(api), '/api/v1/quotes', { method: 'POST', body: JSON.stringify({ parts, ...(shipToZip ? { ship_to_zip: shipToZip } : {}) }), headers: { 'Content-Type': 'application/json' } });
}

export function getQuote(id, { api } = {}) {
  if (!/^qt_[0-9a-f]{20}$/.test(String(id))) throw new Error(`Not a quote id: ${id}`);
  return call(apiBase(api), `/api/v1/quotes/${id}`);
}

export function listSuppliers({ api } = {}) {
  return call(apiBase(api), '/api/v1/suppliers');
}

/** Poll until every supplier has answered (or timeoutMs). onProgress(quote) after each poll. */
export async function waitForQuote(id, { api, timeoutMs = 240e3, intervalMs = 4000, onProgress } = {}) {
  const end = Date.now() + timeoutMs;
  let q = await getQuote(id, { api });
  onProgress?.(q);
  while (q.status !== 'complete' && Date.now() < end) {
    await new Promise((r) => setTimeout(r, intervalMs));
    q = await getQuote(id, { api });
    onProgress?.(q);
  }
  return q;
}

export function parseQtys(s) {
  const list = String(s ?? '1').split(',').map((x) => Math.round(Number(x.trim()))).filter((x) => Number.isFinite(x) && x >= 1);
  if (!list.length) throw new Error(`Bad quantity: ${s}. Use e.g. 1,10,100`);
  return [...new Set(list)].sort((a, b) => a - b);
}

/** Upload, quote and wait, in one go. */
export async function quoteFile(file, { qtys = [1], material, api, shipToZip, timeoutMs, onProgress } = {}) {
  const part = await uploadPart(file, { api });
  const created = await createQuote([{ part_id: part.part_id, qty: qtys, ...(material ? { material } : {}) }], { api, shipToZip });
  const quote = await waitForQuote(created.quote_id, { api, timeoutMs, onProgress });
  return { part, quote };
}

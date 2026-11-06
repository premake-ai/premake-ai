#!/usr/bin/env node
// codex: run OpenAI's Codex CLI as the studio's agent, behind the same command line the server uses for Claude Code.
// The server spawns this file (through the small wrapper start.sh writes, so it works with the server's scrubbed env)
// with Claude Code's flags; it runs `codex exec --json` and turns Codex's JSONL events into Claude Code's stream-json /
// json output, so server.js reads them exactly like a Claude run. The Claude path never touches this file.
//
// Mapping (Claude Code -> Codex):
//   -p <prompt> | --input-format stream-json   one turn per prompt (stdin: one turn per {"type":"user"} line; images -> -i)
//   --system-prompt / --append-system-prompt   prepended to the first turn's prompt (codex exec has no system prompt flag)
//   --session-id <id> (new) / --resume <id>    new thread / `codex exec resume <thread_id>`; the init event reports the
//                                              Codex thread id as session_id, which the server stores and resumes
//   --tools ''  (no tools)                      sandbox read-only;  Write/Edit tools -> sandbox workspace-write (cwd only)
//   WebSearch / WebFetch in --tools             `codex --search` (live web search)
//   --effort low|medium|high|xhigh|max          -c model_reasoning_effort=low|medium|high|xhigh|xhigh
//   --model                                     ignored (Claude names); Codex picks its own default model, the best one it
//                                               offers this login, unless PREMAKE_CODEX_MODEL is set (falls back once if refused)
//   --no-session-persistence                    --ephemeral
//   --allowedTools / --disallowedTools / --settings / --permission-mode   no Codex equivalent: the sandbox is the boundary
// Output: system init, assistant text / thinking / tool_use (Bash for commands, Write for file changes, WebSearch),
// user tool_result, and one result per turn (is_error on turn.failed / error).
// Env: PREMAKE_CODEX_BIN (default `codex` on PATH), PREMAKE_CODEX_MODEL (optional).
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BOOL = new Set(['-p', '--print', '--verbose', '--include-partial-messages', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']);
const EFFORT = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'xhigh' };
const MODEL_ERR_RE = /model_not_found|model is not supported|not supported when using codex|unknown model|does not exist/i;

/** Claude Code argv -> { flags, prompt } */
function parseArgs(argv) {
  const flags = {}; const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (BOOL.has(a)) { flags[a] = true; continue; }
    if (a.startsWith('--') || a === '-m') { flags[a] = argv[i + 1] ?? ''; i++; continue; }
    pos.push(a);
  }
  return { flags, prompt: pos.length ? pos.join(' ') : null };
}

/** The `codex ...` argv for one turn. */
function codexArgs(flags, { prompt, threadId = null, model = process.env.PREMAKE_CODEX_MODEL || '', images = [] } = {}) {
  const tools = String(flags['--tools'] ?? 'default');
  const writes = tools === 'default' || /\b(Write|Edit|MultiEdit|Bash)\b/.test(tools);
  const web = tools === 'default' || /\bWeb(Search|Fetch)\b/.test(tools);
  const top = web ? ['--search'] : [];
  const common = ['--json', '--skip-git-repo-check', '--ignore-user-config',
    '-c', `sandbox_mode="${writes ? 'workspace-write' : 'read-only'}"`, '-c', 'approval_policy="never"'];
  const eff = EFFORT[String(flags['--effort'] || '')];
  if (eff) common.push('-c', `model_reasoning_effort="${eff}"`);
  if (model) common.push('-m', model);
  if (flags['--no-session-persistence']) common.push('--ephemeral');
  for (const im of images) common.push('-i', im);
  return threadId ? [...top, 'exec', 'resume', ...common, threadId, prompt] : [...top, 'exec', ...common, prompt];
}

/** The first turn carries the system prompt (Codex has no flag for it). */
function withSystem(flags, prompt) {
  const sys = [flags['--system-prompt'], flags['--append-system-prompt']].filter((s) => s && String(s).trim()).join('\n\n');
  return sys ? `<instructions>\n${sys}\n</instructions>\n\n${prompt}` : prompt;
}

const MAX_OUT = 8000;
const readSmall = (p) => { try { const st = fs.statSync(p); return st.isFile() && st.size <= 200e3 ? fs.readFileSync(p, 'utf8') : ''; } catch { return ''; } };

/** One Codex JSONL event -> Claude stream-json messages. st: per-turn state { lastText, usage, error, threadId, model }. */
function translate(ev, st, cwd = process.cwd()) {
  const out = [];
  const asst = (content) => out.push({ type: 'assistant', message: { role: 'assistant', content } });
  const toolResult = (id, content, isError) => out.push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: String(content || '').slice(-MAX_OUT), is_error: !!isError }] } });
  if (ev.type === 'thread.started') {
    st.threadId = ev.thread_id || st.threadId;
    out.push({ type: 'system', subtype: 'init', session_id: st.threadId, model: st.model || 'codex (default)', apiKeySource: 'none', agent: 'codex' });
  } else if (ev.type === 'item.started' && ev.item?.type === 'command_execution') {
    asst([{ type: 'tool_use', id: ev.item.id, name: 'Bash', input: { command: unwrapShell(ev.item.command) } }]);
    st.started.add(ev.item.id);
  } else if (ev.type === 'item.completed' && ev.item) {
    const it = ev.item;
    if (it.type === 'agent_message' && it.text) { st.lastText = it.text; asst([{ type: 'text', text: it.text }]); }
    else if (it.type === 'reasoning' && it.text) asst([{ type: 'thinking', thinking: it.text }]);
    else if (it.type === 'command_execution') {
      if (!st.started.has(it.id)) asst([{ type: 'tool_use', id: it.id, name: 'Bash', input: { command: unwrapShell(it.command) } }]);
      const bad = it.status === 'failed' || it.status === 'declined' || (it.exit_code != null && it.exit_code !== 0);
      toolResult(it.id, it.aggregated_output || (it.status === 'declined' ? 'command not allowed (sandbox)' : ''), bad);
    } else if (it.type === 'file_change') {
      (it.changes || []).forEach((c, k) => {
        const id = `${it.id}_${k}`;
        const file = path.isAbsolute(String(c.path || '')) ? c.path : path.join(cwd, String(c.path || ''));
        const input = c.kind === 'delete' ? { file_path: file, content: '' } : { file_path: file, content: readSmall(file) };
        asst([{ type: 'tool_use', id, name: 'Write', input }]);
        toolResult(id, it.status === 'failed' ? 'patch failed' : `${c.kind || 'update'} ${c.path}`, it.status === 'failed');
      });
    } else if (it.type === 'web_search') {
      asst([{ type: 'tool_use', id: it.id, name: 'WebSearch', input: { query: it.query || '' } }]);
      toolResult(it.id, 'searched', false);
    } else if (it.type === 'error' && it.message) st.warnings.push(it.message);
  } else if (ev.type === 'turn.completed') {
    st.usage = ev.usage || null; st.done = true;
  } else if (ev.type === 'turn.failed' || ev.type === 'error') {
    st.error = String(ev.error?.message || ev.message || 'Codex failed');
  }
  return out;
}
/** "bash -lc './build.sh'" -> "./build.sh" (the server spots builds by the command text) */
function unwrapShell(cmd) {
  const s = Array.isArray(cmd) ? cmd.join(' ') : String(cmd || '');
  const m = /^(?:\/bin\/)?(?:ba|z)?sh -l?c (['"])([\s\S]*)\1$/.exec(s);
  return m ? m[2] : s;
}
function errorText(raw) {
  try { const j = JSON.parse(raw); return j.error?.message || j.message || raw; } catch { return raw; }
}
function resultMsg(st, turns) {
  const u = st.usage || {};
  const isError = !!st.error || !st.done;
  return { type: 'result', subtype: isError ? 'error_during_execution' : 'success', is_error: isError,
    result: isError ? errorText(st.error || 'Codex stopped before finishing the turn') : (st.lastText || ''), session_id: st.threadId, num_turns: turns,
    usage: { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0, cache_read_input_tokens: u.cached_input_tokens ?? 0, cache_creation_input_tokens: 0 },
    agent: 'codex' };
}

/** Run one Codex turn; emit translated lines; resolves the turn state. Retries once without -m if the model is refused. */
function runTurn(bin, flags, opts, emit, retried = false) {
  return new Promise((resolve) => {
    const st = { threadId: opts.threadId || null, model: opts.model || '', lastText: '', usage: null, error: null, done: false, started: new Set(), warnings: [], emitted: 0 };
    const child = spawn(bin, codexArgs(flags, opts), { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '', err = '';
    const onSig = (sig) => { try { child.kill(sig); } catch {} };
    process.once('SIGTERM', onSig); process.once('SIGINT', onSig);
    child.stdout.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        for (const m of translate(ev, st)) { if (m.type !== 'system') st.emitted++; emit(m); }
      }
    });
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    child.on('error', (e) => { st.error = `Could not run Codex (${bin}): ${e.message}`; });
    child.on('close', async (code) => {
      process.removeListener('SIGTERM', onSig); process.removeListener('SIGINT', onSig);
      if (!st.done && !st.error) st.error = (err.trim().split('\n').filter((l) => !/Reading additional input/.test(l)).pop()) || `codex exited ${code}`;
      if (st.error && opts.model && !retried && st.emitted === 0 && MODEL_ERR_RE.test(st.error)) {
        process.stderr.write(`[codex] model ${opts.model} refused, using Codex's default model\n`);
        return resolve(runTurn(bin, flags, { ...opts, model: '' }, emit, true));
      }
      resolve(st);
    });
  });
}

/** stdin stream-json user message -> { text, images (temp files) } */
function userTurn(msg, tmpDir) {
  const c = msg?.message?.content;
  if (typeof c === 'string') return { text: c, images: [] };
  const texts = [], images = [];
  for (const b of Array.isArray(c) ? c : []) {
    if (b.type === 'text' && b.text) texts.push(b.text);
    else if (b.type === 'image' && b.source?.type === 'base64' && b.source.data) {
      const ext = /png/.test(b.source.media_type || '') ? 'png' : 'jpg';
      const f = path.join(tmpDir, `codex-img-${process.pid}-${images.length}.${ext}`);
      fs.writeFileSync(f, Buffer.from(b.source.data, 'base64')); images.push(f);
    }
  }
  return { text: texts.join('\n\n'), images };
}

async function main(argv) {
  const { flags, prompt } = parseArgs(argv);
  const bin = process.env.PREMAKE_CODEX_BIN || 'codex';
  const stream = flags['--output-format'] === 'stream-json';
  const write = (m) => process.stdout.write(JSON.stringify(m) + '\n');
  let threadId = flags['--resume'] || null; // a Codex thread id from an earlier init (Claude's --session-id is ignored)
  let turns = 0, first = !threadId;
  const one = async (text, images = []) => {
    const all = [];
    const sink = (m) => (stream ? write(m) : all.push(m));
    const model = process.env.PREMAKE_CODEX_MODEL || '';
    let st = await runTurn(bin, flags, { prompt: first ? withSystem(flags, text) : text, threadId, images, model }, sink);
    if (st.error && threadId && st.emitted === 0 && !MODEL_ERR_RE.test(st.error)) { // e.g. a Claude session id, or a thread Codex no longer has
      process.stderr.write(`[codex] could not resume ${threadId} (${st.error.slice(0, 120)}), starting a new thread\n`);
      threadId = null;
      st = await runTurn(bin, flags, { prompt: withSystem(flags, text), threadId: null, images, model }, sink);
    }
    first = false; turns++;
    if (st.threadId) threadId = st.threadId;
    const res = resultMsg(st, turns);
    write(res);
    for (const f of images) try { fs.unlinkSync(f); } catch {}
    return res;
  };
  if (flags['--input-format'] === 'stream-json') {
    const tmpDir = process.env.TMPDIR || os.tmpdir();
    let buf = '', chain = Promise.resolve();
    process.stdin.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        let j; try { j = JSON.parse(line); } catch { continue; }
        if (j.type === 'control_request') { write({ type: 'control_response', response: { subtype: 'success', request_id: j.request_id, response: {} } }); continue; }
        if (j.type !== 'user') continue;
        const t = userTurn(j, tmpDir);
        chain = chain.then(() => one(t.text, t.images));
      }
    });
    process.stdin.on('end', () => { chain.then(() => process.exit(0)); });
    return;
  }
  const res = await one(prompt ?? fs.readFileSync(0, 'utf8'));
  process.exit(res.is_error ? 1 : 0);
}

if (require.main === module) main(process.argv.slice(2)).catch((e) => { process.stderr.write(`[codex] ${e.stack || e}\n`); process.exit(1); });
module.exports = { parseArgs, codexArgs, withSystem, translate, unwrapShell, resultMsg, userTurn, runTurn, main };

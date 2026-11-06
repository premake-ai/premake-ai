// codex: the Codex adapter (server/codex_cli.js) against a fake `codex` that replays Codex's exec --json events.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const C = require('./codex_cli');

const CLI = path.join(__dirname, 'codex_cli.js');

/** A fake codex: logs its argv, then prints the events for the scenario named in FAKE_SCENARIO. */
function fakeCodex(dir) {
  const bin = path.join(dir, 'codex');
  fs.writeFileSync(bin, `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const argv = process.argv.slice(2);
fs.appendFileSync(path.join(${JSON.stringify(dir)}, 'calls.jsonl'), JSON.stringify(argv) + '\\n');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const sc = process.env.FAKE_SCENARIO || 'design';
const isResume = argv.includes('resume');
if (sc === 'badmodel' && argv.includes('-m')) {
  out({ type: 'thread.started', thread_id: 't-bad' }); out({ type: 'turn.started' });
  out({ type: 'error', message: JSON.stringify({ type: 'error', status: 400, error: { message: "The 'gpt-x' model is not supported when using Codex with a ChatGPT account.", code: 'model_not_found' } }) });
  out({ type: 'turn.failed', error: { message: 'model_not_found' } }); process.exit(1);
}
if (sc === 'noresume' && isResume) { process.stderr.write('Error: thread not found\\n'); process.exit(1); }
out({ type: 'thread.started', thread_id: isResume ? argv[argv.length - 2] : 'thread-123' });
out({ type: 'turn.started' });
out({ type: 'item.completed', item: { id: 'item_0', type: 'reasoning', text: 'Planning a stand' } });
out({ type: 'item.started', item: { id: 'item_1', type: 'command_execution', command: "bash -lc './build.sh'", status: 'in_progress' } });
fs.writeFileSync('design.py', 'import cadquery as cq\\n');
out({ type: 'item.completed', item: { id: 'item_2', type: 'file_change', changes: [{ path: path.resolve('design.py'), kind: 'update' }], status: 'completed' } });
out({ type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: "bash -lc './build.sh'", aggregated_output: 'built 2 parts', exit_code: 0, status: 'completed' } });
out({ type: 'item.completed', item: { id: 'item_3', type: 'agent_message', text: 'Done: a phone stand.' } });
out({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 20 } });
`, { mode: 0o755 });
  return bin;
}
const lines = (s) => s.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
function run(dir, args, env = {}, input) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, input, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: os.tmpdir(), TMPDIR: dir, PREMAKE_CODEX_BIN: path.join(dir, 'codex'), ...env } });
  return { ...r, out: lines(r.stdout || ''), calls: fs.existsSync(path.join(dir, 'calls.jsonl')) ? lines(fs.readFileSync(path.join(dir, 'calls.jsonl'), 'utf8')) : [] };
}
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'premake-codex-')); fakeCodex(d); return d; };

test('Claude flags map onto codex exec', () => {
  const { flags, prompt } = C.parseArgs(['-p', 'make a stand', '--output-format', 'stream-json', '--verbose', '--model', 'claude-opus-5-5', '--effort', 'max',
    '--tools', 'Read,Write,Edit,Glob,Grep,WebSearch,WebFetch,Bash', '--allowedTools', 'Read(./**)', '--session-id', 'abc', '--append-system-prompt', 'SYS']);
  assert.equal(prompt, 'make a stand');
  const a = C.codexArgs(flags, { prompt: 'P', model: '' });
  assert.deepEqual(a.slice(0, 2), ['--search', 'exec']);
  assert.ok(a.includes('sandbox_mode="workspace-write"') && a.includes('model_reasoning_effort="xhigh"') && a.includes('--json') && a.includes('--ignore-user-config'));
  assert.ok(!a.includes('-m'), 'Claude model names are never passed to Codex');
  assert.equal(a[a.length - 1], 'P');
  const none = C.codexArgs(C.parseArgs(['-p', 'x', '--tools', '', '--no-session-persistence']).flags, { prompt: 'x', model: '' });
  assert.ok(none.includes('sandbox_mode="read-only"') && none.includes('--ephemeral') && none[0] === 'exec', 'no tools: read-only, no web');
  const res = C.codexArgs(flags, { prompt: 'Q', threadId: 'th1', model: 'gpt-x' });
  assert.deepEqual(res.slice(0, 3), ['--search', 'exec', 'resume']);
  assert.deepEqual(res.slice(-2), ['th1', 'Q']); assert.ok(res.includes('-m') && res.includes('gpt-x'));
  assert.match(C.withSystem(flags, 'hi'), /^<instructions>\nSYS\n<\/instructions>\n\nhi$/);
  assert.equal(C.unwrapShell("bash -lc './build.sh'"), './build.sh');
  assert.equal(C.unwrapShell("/bin/zsh -lc 'ls -la'"), 'ls -la');
});

test('a design turn streams as Claude stream-json: init with the thread id, Bash build, Write with content, text, result', () => {
  const d = tmp();
  const r = run(d, ['-p', 'a phone stand', '--output-format', 'stream-json', '--verbose', '--session-id', 'srv-uuid', '--append-system-prompt', 'You design things']);
  assert.equal(r.status, 0, r.stderr);
  const [init] = r.out; assert.deepEqual([init.type, init.subtype, init.session_id, init.apiKeySource], ['system', 'init', 'thread-123', 'none']);
  const uses = r.out.filter((m) => m.type === 'assistant').flatMap((m) => m.message.content);
  const bash = uses.find((c) => c.type === 'tool_use' && c.name === 'Bash');
  assert.equal(bash.input.command, './build.sh');
  const w = uses.find((c) => c.type === 'tool_use' && c.name === 'Write');
  assert.equal(path.basename(w.input.file_path), 'design.py'); assert.match(w.input.content, /cadquery/);
  assert.ok(uses.some((c) => c.type === 'thinking') && uses.some((c) => c.type === 'text' && c.text === 'Done: a phone stand.'));
  const tr = r.out.filter((m) => m.type === 'user').flatMap((m) => m.message.content).find((c) => c.tool_use_id === bash.id);
  assert.equal(tr.is_error, false); assert.equal(tr.content, 'built 2 parts');
  const res = r.out[r.out.length - 1];
  assert.deepEqual([res.type, res.is_error, res.result, res.session_id, res.usage.cache_read_input_tokens], ['result', false, 'Done: a phone stand.', 'thread-123', 40]);
  assert.match(r.calls[0][r.calls[0].length - 1], /^<instructions>\nYou design things\n<\/instructions>\n\na phone stand$/, 'system prompt goes into the first turn');
  assert.ok(!r.calls[0].includes('srv-uuid'), "the server's own session id is not a Codex thread");
});

test('--resume continues the Codex thread; a thread Codex does not know starts a new one', () => {
  const d = tmp();
  const r = run(d, ['-p', 'make it taller', '--output-format', 'stream-json', '--resume', 'thread-123', '--append-system-prompt', 'SYS']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.calls[0].slice(0, 3), ['--search', 'exec', 'resume']);
  assert.equal(r.calls[0][r.calls[0].length - 1], 'make it taller', 'no system prompt again on a resumed thread');
  const d2 = tmp();
  const r2 = run(d2, ['-p', 'go', '--output-format', 'stream-json', '--resume', 'claude-session-uuid', '--append-system-prompt', 'SYS'], { FAKE_SCENARIO: 'noresume' });
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(r2.calls.length, 2); assert.ok(!r2.calls[1].includes('resume')); assert.match(r2.calls[1][r2.calls[1].length - 1], /^<instructions>/);
});

test('a model Codex refuses is retried once with Codex\'s default model', () => {
  const d = tmp();
  const r = run(d, ['-p', 'hi', '--output-format', 'json'], { FAKE_SCENARIO: 'badmodel', PREMAKE_CODEX_MODEL: 'gpt-x' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.calls.length, 2); assert.ok(r.calls[0].includes('-m') && !r.calls[1].includes('-m'));
  assert.equal(r.out.length, 1, '--output-format json prints only the result'); assert.equal(r.out[0].is_error, false);
});

test('stdin stream-json: one turn per user line (images become -i files), control requests answered', () => {
  const d = tmp();
  const img = Buffer.from([0xff, 0xd8, 0xff]).toString('base64');
  const input = [
    { type: 'control_request', request_id: 'f1', request: { subtype: 'apply_flag_settings' } },
    { type: 'user', message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } }, { type: 'text', text: 'sketch this' }] } },
    { type: 'user', message: { role: 'user', content: 'second turn' } },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n';
  const r = run(d, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--tools', '', '--system-prompt', 'JSON only'], {}, input);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.out[0].type, 'control_response');
  assert.equal(r.out.filter((m) => m.type === 'result').length, 2);
  assert.ok(r.calls[0].includes('-i')); assert.ok(r.calls[1].includes('resume') && r.calls[1].includes('thread-123'));
  assert.equal(fs.readdirSync(d).filter((f) => f.startsWith('codex-img-')).length, 0, 'temp images removed');
});

test('a failed turn is a result with is_error and the message', () => {
  const st = { started: new Set(), warnings: [] };
  C.translate({ type: 'thread.started', thread_id: 't' }, st);
  C.translate({ type: 'turn.failed', error: { message: JSON.stringify({ error: { message: 'You hit your usage limit.' } }) } }, st);
  const r = C.resultMsg(st, 1);
  assert.equal(r.is_error, true); assert.equal(r.result, 'You hit your usage limit.');
});

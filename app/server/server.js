// Vibe-manufacturing backend. Zero dependencies. Node 22.
// Start: node app/server/server.js   (binds 127.0.0.1:8800 only)
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
// Re-read app/.env.local on every start, so a crash-loop restart picks up edited keys (start-online.sh only sources it once).
// Never loads ANTHROPIC_API_KEY: agents bill to the Claude Code subscription.
try {
  for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
    const m = /^\s*([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m && m[1] !== 'ANTHROPIC_API_KEY') process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {}
const versions = require('./versions');
const editparts = require('./editparts'); // editglow: which parts an agent edit touches (live 3D highlight)
const caption = require('./caption'); // livecaption: plain-words line under the model while a design run works
const livepreview = require('./livepreview'); // livepreview: parts appear while design.py is still being written
const PREVIEW_ON = process.env.FORMA_LIVE_PREVIEW !== '0';
const uploads = require('./uploads').init({ send, allow }); // images: chat image attachments (server/uploads.js)
const approutes = require('./approutes'); // urls: clean studio URLs (/designs/..., /examples/..., /store, /orders)
const admin = require('./admin'); // admin: /admin panel + /api/admin/* (server/admin.js), init at the bottom
const firmware = require('./firmware'); // firmware: compile a design's sketch with arduino-cli + ESP Web Tools flashing (server/firmware.js), init at the bottom
const apps = require('./apps'); // apps: companion apps /apps/<id> (shell, sandboxed UI, SDK, service worker) + the app agent (server/apps.js), init at the bottom

// ---------------------------------------------------------------- config
// Local default: 127.0.0.1:8800, everything unlocked (as before).
// FORMA_* env vars, forma.* localStorage keys and X-Forma-* headers are legacy names from before the Premake rename.
// They are invisible to users; renaming them would break existing env files, sessions and the gateway handshake.
// Online (FORMA_TUNNEL=1 behind a Cloudflare tunnel, or FORMA_PUBLIC=1 on a host that binds 0.0.0.0:$PORT):
// read-only showcase unless FORMA_PASSWORD is set and the visitor logs in. See ONLINE.md.
const PUBLIC = process.env.FORMA_PUBLIC === '1';
const TUNNEL = process.env.FORMA_TUNNEL === '1';
const ONLINE = PUBLIC || TUNNEL;
const HOST = process.env.FORMA_HOST || (PUBLIC ? '0.0.0.0' : '127.0.0.1');
const PORT = Number(process.env.PORT || 8800);
const APP = path.resolve(__dirname, '..');
const WEB = path.join(APP, 'web');
const assetver = require('./assetver').init(WEB);
const fusion = require('./fusion'); // fusion: buy parts from inside Autodesk Fusion (server/fusion.js, add-in in fusion-addin/), init at the bottom // assetver: fingerprinted studio code (cached a year, never stale)
// Writable data (projects, deploys, orders). Examples ship with the app in APP/examples (scripts/import-examples.sh refreshes them).
const DATA = process.env.FORMA_DATA_DIR ? path.resolve(process.env.FORMA_DATA_DIR) : path.join(APP, 'data');
const PROJECTS = path.join(DATA, 'projects');
const EXAMPLES = process.env.FORMA_EXAMPLES_DIR ? path.resolve(process.env.FORMA_EXAMPLES_DIR) : path.join(APP, 'examples');
const ORDERS = path.join(DATA, 'orders.json');
const brain = require('./agentbrain'); // agentbrain: question cards, per-user prefs (answers, effort), stop reasons, auto titles
const refs = require('./refs'); // refs: reference photos for a new design ("Designing something like these")
const prefs = brain.store(DATA);
const askmock = require('./askmock'); // askmock: quick 3D mock-ups for question-card options
const sections = require('./sections'); // sections: the Parts panel grouped by machine section
const { stlBox } = require('./buildplan');

// ---------------------------------------------------------------- access (see DEPLOY.md)
const PASSWORD = process.env.FORMA_PASSWORD || '';
const SESSION_KEY = crypto.createHash('sha256')
  .update((process.env.FORMA_SESSION_SECRET || crypto.randomBytes(32).toString('hex')) + '\0' + PASSWORD).digest();
const OPEN_LOCAL = !ONLINE && !PASSWORD; // local dev without a password: no login, no limits
// AI: every claude CLI run uses this Mac's logged-in Claude Code subscription. ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN
// are always removed from agent environments, so nothing is ever billed to an API key.
const AI_OK = true;
const AI_DOWN_MSG = 'AI is temporarily unavailable. Try again later.';
// Agent limits (per signed-in email; the Mac's own localhost admin is exempt from the per-user ones)
const RUNS_PER_HOUR = Number(process.env.FORMA_RUNS_PER_HOUR || 20);
const RUNS_PER_DAY = Number(process.env.FORMA_RUNS_PER_DAY || 100);
const MAX_CONCURRENT = Number(process.env.FORMA_MAX_CONCURRENT || 3);
const RUN_TIMEOUT_MS = Number(process.env.FORMA_RUN_TIMEOUT_MIN || 25) * 60e3; // agentbrain: + a no-progress watchdog (brain.STALL_MS)
const PROMPT_MAX = 4000;
// Warm design agents: one idle claude process per open studio (stream-json input), reused across turns.
// Idle processes cost no tokens and don't count as running agents; turns still go through agentGate.
const POOL_MAX = Number(process.env.FORMA_POOL_MAX || 4);
const POOL_PER_USER = Number(process.env.FORMA_POOL_PER_USER || 2);
const POOL_IDLE_MS = Number(process.env.FORMA_POOL_IDLE_MIN || 10) * 60e3;
// Warm build workers (cadlib/worker.py): cadquery pre-imported, same sandbox as build.sh, one per active project.
const WORKERS_MAX = Number(process.env.FORMA_WORKERS_MAX || 6);
const WORKERS_PER_USER = 2;
const WORKER_IDLE_MS = 10 * 60e3;
// Requests made on this Mac to 127.0.0.1/localhost (no tunnel headers) are this admin, no sign-in page.
const LOCAL_USER = String(process.env.FORMA_LOCAL_USER || 'you@localhost.local').trim().toLowerCase();
// Projects made before per-user ownership belong to this email.
const LEGACY_OWNER = String(process.env.FORMA_LEGACY_OWNER || LOCAL_USER).trim().toLowerCase();
// Public sign-in URL (the Google gateway). Direct tunnel visits are sent there.
const GATEWAY_URL = String(process.env.FORMA_GATEWAY_URL || '').replace(/\/+$/, '');
const COOKIE = 'forma_session';
const SESSION_DAYS = 30;
const SHOWCASE_MSG = 'Sign in to design your own products.';
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`,
  ...String(process.env.FORMA_ALLOWED_HOSTS || '').split(','), process.env.RAILWAY_PUBLIC_DOMAIN || '']
  .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean));
// Secrets the server needs but children never do.
const SECRET_ENV = ['FORMA_PASSWORD', 'FORMA_SESSION_SECRET', 'FORMA_GATEWAY_SECRET', 'FORMA_GATEWAY_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
  'VAPID_PRIVATE_KEY']; // devices: Web Push signing key (server/push.js)
// Google sign-in gateway (app/gateway on Railway): requests carrying X-Forma-Gateway = this secret count as logged in.
const GATEWAY_SECRET = process.env.FORMA_GATEWAY_SECRET || '';
/** Env for the server's own helpers: an allowlist, never the server's env (security recheck C5: no SSH_AUTH_SOCK,
 * SECURITYSESSIONID, CLAUDE_CODE_* session tokens, Stripe keys or server secrets reach a child). */
const CHILD_ENV_KEEP = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TMPDIR', 'FORMA_PARTS_CACHE'];
function childEnv() {
  const env = { PATH: `${NODE_BIN}:/usr/bin:/bin:/usr/sbin:/sbin` };
  for (const k of CHILD_ENV_KEEP) if (process.env[k] != null) env[k] = process.env[k];
  return env;
}
const VENV_PY = process.env.FORMA_PYTHON
  || (process.env.PREMAKE_SETUP_BG === '1' || fs.existsSync(path.join(APP, '.venv', 'bin', 'python')) ? path.join(APP, '.venv', 'bin', 'python') : 'python3'); // install.sh: the venv is still being made
const NODE_BIN = process.env.FORMA_NODE_BIN || path.dirname(process.execPath);
// The claude CLI: CLAUDE_BIN, else the newest Claude Code bundled with the Claude desktop app (kept up to date by the app;
// new models such as claude-opus-5-5 need a recent CLI), else `claude` next to node.
function findClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const root = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude-code');
  const ver = (v) => v.split('.').map(Number);
  const newer = (a, b) => { const x = ver(a), y = ver(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
  try {
    const vs = fs.readdirSync(root).filter((v) => /^\d+\.\d+\.\d+$/.test(v)).sort((a, b) => (newer(a, b) ? -1 : 1));
    for (const v of vs) for (const h of fs.readdirSync(path.join(root, v))) {
      const bin = path.join(root, v, h, 'claude.app', 'Contents', 'MacOS', 'claude');
      if (exists(bin)) return bin;
    }
  } catch {}
  return path.join(NODE_BIN, 'claude');
}
const CLAUDE = findClaude();
// One model for every claude spawn (design, website chat, ads chat, copywriter). CAD_AGENT_MODEL / ADS_MODEL still override.
// model-pick: the best model (Claude Opus 5.5) when this Claude Code login has it, else the CLI's own default ('default').
// FORMA_MODEL fixes it. Otherwise the choice is checked once (checkModel, at boot) and remembered in <DATA>/.model.json;
// a design run that fails with "issue with the selected model" also switches to 'default' and remembers it.
const BEST_MODEL = 'claude-opus-5-5';
// codex: PREMAKE_AGENT=codex when start.sh runs OpenAI's Codex CLI as the agent (CLAUDE_BIN is then server/codex_cli.js)
const AGENT_KIND = process.env.PREMAKE_AGENT === 'codex' ? 'codex' : 'claude';
const MODEL_FILE = path.join(DATA, '.model.json');
const MODEL_FIXED = !!process.env.FORMA_MODEL;
const rememberedModel = () => { try { return String(JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8')).model || ''); } catch { return ''; } };
let FORMA_MODEL = process.env.FORMA_MODEL || rememberedModel() || BEST_MODEL;
let AGENT_MODEL = process.env.CAD_AGENT_MODEL || FORMA_MODEL; // design, site and ads chat agents (agentArgs)
const MODEL_ERR_RE = /issue with the selected model|may not exist or you may not have access|unrecognized_model/i;
function setModel(m, why) {
  if (MODEL_FIXED || FORMA_MODEL === m) return;
  FORMA_MODEL = m;
  if (!process.env.CAD_AGENT_MODEL) AGENT_MODEL = m;
  if (!process.env.ADS_MODEL) ADS_MODEL = m;
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(MODEL_FILE, JSON.stringify({ model: m, why, at: new Date().toISOString() }) + '\n'); } catch {}
  console.log(`[model] using ${m === 'default' ? "Claude Code's default model" : m} (${why})`);
  for (const p of [...pool.values()]) killProc(p); // warm agents were started with the old model
}
/** model-pick: one tiny call with the best model; if this login can't use it, try 'default' once and remember the answer. */
function checkModel() {
  if (AGENT_KIND === 'codex' || MODEL_FIXED || rememberedModel()) return; // codex: Codex picks its own model (server/codex_cli.js)
  const probe = (m) => runProc(CLAUDE, ['-p', 'Reply with OK.', '--output-format', 'json', '--model', m, '--effort', 'low', '--setting-sources', '',
    '--strict-mcp-config', '--tools', '', '--no-session-persistence'], { cwd: os.tmpdir(), env: agentEnv(path.join(DATA, '.model-check')) }, 90e3)
    .then((r) => { let j = null; try { j = JSON.parse(String(r.stdout || '').trim().split('\n').pop()); } catch {} return { ok: !!j && !j.is_error, modelErr: MODEL_ERR_RE.test(String(j?.result || '') + (r.stderr || '')) }; })
    .catch(() => ({ ok: false, modelErr: false }));
  probe(BEST_MODEL).then(async (a) => {
    if (a.ok) return setModel(BEST_MODEL, 'checked: this login has it') || writeModelFile(BEST_MODEL);
    if (!a.modelErr) return console.log('[model] could not check the model (offline or not logged in?); will check again next start');
    const b = await probe('default');
    if (b.ok) setModel('default', `${BEST_MODEL} is not available on this login`);
    else console.log("[model] neither the best model nor Claude Code's default answered; will check again next start");
  });
}
function writeModelFile(m) { try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(MODEL_FILE, JSON.stringify({ model: m, at: new Date().toISOString() }) + '\n'); } catch {} }
const AGENT_PROMPT_FILE = path.join(__dirname, 'design_agent_prompt.md');
// Agent permissions (Claude Code rules, --permission-mode dontAsk: anything not allowed is refused).
// Every file rule is scoped to ./** (the project dir); there is deliberately no bare Read/Glob/Grep, which would allow
// absolute and ../ paths. The OS sandbox (server/sandbox.js) enforces the same boundary for every child process.
// WebFetch (read-only, runs in the CLI process, not the Python sandbox) lets the agent read spec pages and datasheets
// instead of guessing real-world sizes; fetching this Mac's own services is denied below (AGENT_DENIED).
const AGENT_TOOLS = 'Read,Write,Edit,Glob,Grep,WebSearch,WebFetch,Bash';
const AGENT_ALLOWED = 'Read(./**),Glob(./**),Grep(./**),WebSearch,WebFetch,Edit(./**),Write(./**),Bash(./build.sh),Bash(./views.sh)'; // exactly ./build.sh and ./views.sh, no arguments
// The design agent may also READ the shared CAD library's source (fab, look, motion, wiring, parts) so it stops guessing
// helper APIs (2 Nov run reviews: most wasted calls were denied reads of cadlib/*.py). Read-only; "//" = absolute path.
// Checked with --setting-sources '': server.js and cadlib/../.env.local stay denied.
const CADLIB_DIR = path.join(APP, 'cadlib');
const AGENT_ALLOWED_ALL = `${AGENT_ALLOWED},Read(/${CADLIB_DIR}/**),Glob(/${CADLIB_DIR}/**),Grep(/${CADLIB_DIR}/**)`;
// Website agent: reads the design dir, may only edit/write files under ./site/. No Bash, no web.
const SITE_PROMPT_FILE = path.join(__dirname, 'site_agent_prompt.md');
const SITE_TOOLS = 'Read,Glob,Grep,Edit,Write';
const SITE_ALLOWED = 'Read(./**),Glob(./**),Grep(./**),Edit(./site/**),Write(./site/**)';
// Ads agent: reads the design dir, may only edit ./ads/ads.json (never the renders). No Bash, no web.
const ADS_PROMPT_FILE = path.join(__dirname, 'ads_agent_prompt.md');
const ADS_TOOLS = 'Read,Glob,Grep,Edit,Write';
const ADS_ALLOWED = 'Read(./**),Glob(./**),Grep(./**),Edit(./ads/ads.json),Write(./ads/ads.json)';
// Admins: support inbox, every project, all orders. Same default as server/payments.js.
const ADMIN_EMAILS = new Set(String(process.env.FORMA_ADMIN_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
const NOTIFY = process.env.FORMA_NOTIFY === '1';
// Deny rules win over allow rules: no rewriting build.sh (the one Bash command allowed), no touching the agent's own
// home/config or project settings, no absolute or parent paths (belt and braces: the allow rules above don't cover them).
const AGENT_HOME = '.agent-home'; // per-project HOME, TMPDIR and Claude config (API-key mode); never served (dot dirs are hidden)
const AGENT_DENIED = ['Edit(./build.sh)', 'Write(./build.sh)', 'Edit(./views.sh)', 'Write(./views.sh)', `Edit(./${AGENT_HOME}/**)`, `Write(./${AGENT_HOME}/**)`, `Read(./${AGENT_HOME}/**)`,
  'Edit(./.claude/**)', 'Write(./.claude/**)', 'Read(~/.ssh/**)', 'Read(~/.claude/**)', 'Read(~/.aws/**)', 'Read(~/.config/**)',
  'Read(//etc/**)', 'Read(//private/etc/**)', 'Read(//tmp/**)', 'Read(//proc/**)',
  // WebFetch: no loopback / this-machine hosts (127.0.0.1 is the admin side of this server). Only the design agent has WebFetch.
  'WebFetch(domain:localhost)', 'WebFetch(domain:*.localhost)', 'WebFetch(domain:127.0.0.1)', 'WebFetch(domain:0.0.0.0)',
  'WebFetch(domain:[::1])', 'WebFetch(domain:*.local)', 'WebFetch(domain:169.254.169.254)',
  // C6: files Claude Code loads as instructions or config. Nothing may plant them (the build sandbox denies them too).
  ...['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.mcp.json'].flatMap((f) => [`Write(./${f})`, `Edit(./${f})`, `Write(./**/${f})`, `Edit(./**/${f})`]),
  'Edit(./**/.claude/**)', 'Write(./**/.claude/**)'].join(',');
// C3: WebFetch from this Mac resolves the host first and refuses loopback/private/this-Mac addresses (server/webfetch_guard.js),
// as a PreToolUse hook passed with --settings (still loaded with --setting-sources ''). The deny rules above stay as a first layer.
const WEBFETCH_HOOK = JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'WebFetch', hooks: [{ type: 'command', timeout: 15,
  command: `${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(__dirname, 'webfetch_guard.js'))}` }] }] } });
/** Files Claude Code would read as instructions (C6), removed before every agent spawn in case anything slipped through. */
const AGENT_INSTR = new Set(['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.mcp.json']);
function scrubAgentFiles(dir, depth = 0) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (AGENT_INSTR.has(e.name) || e.name === '.claude') { try { fs.rmSync(p, { recursive: true, force: true }); console.log(`[security] removed planted ${path.relative(PROJECTS, p)}`); } catch {} continue; }
    if (e.isDirectory() && !e.isSymbolicLink() && depth < 4 && e.name !== AGENT_HOME && e.name !== '.build' && e.name !== 'stl') scrubAgentFiles(p, depth + 1);
  }
}
const sandbox = require('./sandbox');
const PY_ROOT = (() => { try { return path.resolve(fs.realpathSync(VENV_PY), '..', '..'); } catch { return null; } })();
/** Env for a claude CLI run: built from scratch, so nothing from the server's env leaks (no secrets, no Stripe keys).
 * No ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN ever: the CLI signs in with this Mac's Claude Code subscription
 * (keychain + ~/.claude under the real HOME). */
function agentEnv(dir) {
  if (dir.startsWith(PROJECTS + path.sep)) scrubAgentFiles(dir); // C6
  const home = path.join(dir, AGENT_HOME);
  for (const d of ['tmp', 'cache']) fs.mkdirSync(path.join(home, d), { recursive: true });
  return {
    PATH: `${NODE_BIN}:/usr/bin:/bin:/usr/sbin:/sbin`, LANG: 'en_US.UTF-8', SHELL: '/bin/bash', USER: os.userInfo().username,
    HOME: os.homedir(), TMPDIR: path.join(home, 'tmp'), CLAUDE_CODE_TMPDIR: path.join(home, 'tmp'), XDG_CACHE_HOME: path.join(home, 'cache'),
    DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
  };
}
/** The Seatbelt profile build.sh applies to design.py (see sandbox.js). */
function buildProfile(dir) { return sandbox.profile({ dir, app: APP, pythonRoots: PY_ROOT ? [PY_ROOT] : [] }); }
/** C4: CPU, file-size and process caps for design.py, set by the shell before sandbox-exec. RLIMIT_NPROC counts every
 * process of this macOS user, so the cap is "what's running now + BUILD_PROCS" (a fork bomb stops there, the Mac doesn't).
 * Memory is capped inside Python (cadlib/build.py watchdog): macOS doesn't enforce RLIMIT_AS. */
const BUILD_CPU_S = Number(process.env.FORMA_BUILD_CPU_S || 600);
const BUILD_PROCS = Number(process.env.FORMA_BUILD_PROCS || 64);
const BUILD_FILE_MB = 2048;
const ULIMITS = `ulimit -t ${BUILD_CPU_S} 2>/dev/null; ulimit -f ${BUILD_FILE_MB * 1024} 2>/dev/null; ulimit -u $(( $(/bin/ps -U "$(/usr/bin/id -u)" -o pid= | /usr/bin/wc -l) + ${BUILD_PROCS} )) 2>/dev/null`;
/** C2: the server's VTK renders (thumb, ad heroes, guide steps, share cards) run inside the sandbox too, with no network,
 * a from-scratch env (C5) and write access to one dir. [cmd, args, opts] for runProc. */
function renderSpawn(mod, args, { dir, extraReads = [], extraWrites = [] }) {
  const home = path.join(dir, AGENT_HOME);
  try { for (const d of ['tmp', 'cache']) fs.mkdirSync(path.join(home, d), { recursive: true }); } catch {}
  const env = sandbox.cleanEnv(home, { PYTHONPATH: APP, OBJC_DISABLE_INITIALIZE_FORK_SAFETY: 'YES' });
  const py = [VENV_PY, ['-m', mod, ...args]];
  if (!sandbox.AVAILABLE) return [...py, { cwd: APP, env }];
  const prof = sandbox.profile({ dir, app: APP, pythonRoots: PY_ROOT ? [PY_ROOT] : [], extraReads, extraWrites, render: true });
  return ['/usr/bin/sandbox-exec', ['-p', prof, py[0], ...py[1]], { cwd: APP, env }];
}
const RUN_EVENTS_MAX = 400; // per-run replay buffer for SSE reconnects

// ---------------------------------------------------------------- pricing
const TIERS = [1, 10, 100, 500];
const BULK = { 1: 1.0, 10: 0.9, 100: 0.75, 500: 0.6 };
const MATERIAL_PER_G = 0.025;
const PRINT_PER_H = 0.40;
const ASSEMBLY_PER_MIN = 0.50;
const KIT_BAG = 1.00;
const PACKAGING = 2.00;
const PACKAGING_KIT = 1.50;
const MARGIN = 0.35;
const HANDLING_Q1 = 15.00;
const SHIPPING = { 1: 9, 10: 25, 100: 120, 500: 450 };
const PRINTERS = 50;
const PRINTER_HOURS_PER_DAY = 20;
const TRANSIT_DAYS = 5;
const MAX_QTY = require('./prices/config').MAX_QTY; // order tab: above this, we quote by email

const cents = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const tierOf = (q) => [...TIERS].reverse().find((t) => q >= t) || 1;

/** Price one quantity. bom = bom.json contents; mode = "assembled" | "kit". */
function priceFor(bom, q, mode) {
  const tier = tierOf(q);
  const parts = (bom.parts || []).reduce((s, p) => s + (Number(p.qty_per_unit) || 0) * (Number(p.unit_cost_usd) || 0), 0);
  const printed = bom.printed || [];
  const grams = printed.reduce((s, p) => s + (Number(p.grams) || 0), 0);
  const hours = printed.reduce((s, p) => s + (Number(p.print_hours) || 0), 0);
  const unit = {
    parts: cents(parts * BULK[tier]),
    material: cents(grams * MATERIAL_PER_G),
    printing: cents(hours * PRINT_PER_H),
    assembly: cents(mode === 'assembled' ? (Number(bom.assembly_minutes) || 0) * ASSEMBLY_PER_MIN : KIT_BAG),
    packaging: mode === 'assembled' ? PACKAGING : PACKAGING_KIT,
  };
  const cost = unit.parts + unit.material + unit.printing + unit.assembly + unit.packaging;
  unit.margin = cents(cost * MARGIN);
  unit.handling = q === 1 ? HANDLING_Q1 : 0;
  const unit_price = cents(cost + unit.margin + unit.handling);
  const subtotal = cents(unit_price * q);
  const shipping = SHIPPING[tier];
  // A single unit that prints within one printer-day ships the next day; batches queue on the farm.
  const lead = q === 1 && hours <= PRINTER_HOURS_PER_DAY ? 1
    : 2 + Math.ceil((q * hours) / (PRINTERS * PRINTER_HOURS_PER_DAY)) + (mode === 'assembled' && q >= 100 ? 1 : 0);
  return { qty: q, unit, unit_price, subtotal, shipping, total: cents(subtotal + shipping), lead_time_days: lead };
}

function quote(bom, mode, dir, opts) { // dir, opts: server/prices (print source, Slant cache)
  bom = bom || {};
  const notes = [];
  if (mode === 'kit' && bom.kit_ok === false) notes.push('This design needs special tools or skills to assemble, so a kit is not recommended.');
  const printed = bom.printed || [];
  const grams = printed.reduce((s, p) => s + (Number(p.grams) || 0), 0);
  const hours = printed.reduce((s, p) => s + (Number(p.print_hours) || 0), 0);
  if (!printed.length) notes.push('No printed parts yet. The price will update after the first build.');
  if (hours > 3) notes.push(`Print time is ${hours.toFixed(1)} h per unit. Under 3 h keeps costs and lead times down.`);
  for (const p of printed) if ((p.bbox || []).some((v) => v > 256)) notes.push(`${p.name} is larger than the 256 mm print bed.`);
  const noLink = (bom.parts || []).filter((p) => !p.url).length;
  if (noLink) notes.push(`${noLink} bought part${noLink > 1 ? 's have' : ' has'} no supplier link yet.`);
  notes.push('Estimate only. PETG print, US ground shipping to one address.');
  return {
    mode,
    print: { grams: cents(grams), hours: cents(hours), parts: printed.length },
    bom: (bom.parts || []).map((p) => ({ name: p.name, qty_per_unit: p.qty_per_unit, unit_cost_usd: p.unit_cost_usd, supplier: p.supplier || '', url: p.url || '',
      ...(p.supplier_note ? { supplier_note: p.supplier_note } : {}) })),
    tiers: TIERS.map((q) => priceFor(bom, q, mode, dir, opts)),
    notes,
  };
}
// fab-pricing: price extrusion / sheet / laser parts (bom.fabricated) via server/pricing_fab.js. Adds unit.fabrication
// (before margin) and quote().fabricated; drops stop-gap "fabricated": true parts lines. Must run before payments.init.
const pricingFab = require('./pricing_fab');
priceFor = pricingFab.wrapPriceFor(priceFor, { BULK, MARGIN, tierOf }); // eslint-disable-line no-func-assign
quote = pricingFab.wrapQuote(quote); // eslint-disable-line no-func-assign
// part costs: per-part numbers for the 3D viewer's hover tooltips (web/hover.js), at the 1-unit tier, before margin.
// Printed parts share the tier's material + printing by grams / hours; fabricated parts are pricing_fab's piece price;
// bought parts are qty x unit cost.
function partCosts(bom, q) {
  const u = (q.tiers || []).find((t) => t.qty === 1)?.unit || {};
  const printed = bom.printed || [];
  const G = printed.reduce((s, p) => s + (Number(p.grams) || 0), 0), H = printed.reduce((s, p) => s + (Number(p.print_hours) || 0), 0);
  const out = printed.map((p) => ({ name: p.name, file: p.file, kind: 'print', grams: Number(p.grams) || 0, hours: Number(p.print_hours) || 0,
    usd: cents((G ? (Number(u.material) || 0) * (Number(p.grams) || 0) / G : 0) + (H ? (Number(u.printing) || 0) * (Number(p.print_hours) || 0) / H : 0)) }));
  for (const l of q.fabricated?.lines || []) {
    const f = (bom.fabricated || []).find((x) => x.name === l.name) || {};
    out.push({ name: l.name, file: f.file, kind: l.process, detail: l.detail, params: f.params || {}, usd: l.piece_usd });
  }
  for (const p of q.bom || []) {
    const qty = Number(p.qty_per_unit) || 0, unit = Number(p.unit_cost_usd) || 0;
    out.push({ name: p.name, kind: 'bought', qty, unit_usd: unit, usd: cents(qty * unit) });
  }
  return out;
}
quote = ((orig) => function quoteParts(bom, mode, ...rest) { const q = orig(bom, mode, ...rest); q.part_costs = partCosts(bom || {}, q); return q; })(quote); // eslint-disable-line no-func-assign
// prices: real prices with provenance (server/prices): live Slant 3D / DigiKey / Mouser, catalog list prices, labelled
// estimates. Outermost wrappers; both take the design dir as an extra argument. SELL_ASSEMBLED off: kit pricing only.
const prices = require('./prices').init({ DATA, PROJECTS, EXAMPLES, BULK, MARGIN, tierOf, MATERIAL_PER_G, PRINT_PER_H, PRINTERS, PRINTER_HOURS_PER_DAY,
  readJSON: (...a) => readJSON(...a), writeJSON: (...a) => writeJSON(...a) });
priceFor = prices.wrapPriceFor(priceFor); // eslint-disable-line no-func-assign
quote = prices.wrapQuote(quote); // eslint-disable-line no-func-assign
// suppliers: every reader sees bought lines on the allowed shops (Amazon / SendCutSend / Slant 3D, server/prices/config.js
// ALLOWED_SUPPLIERS); other shops become Amazon with a Prime search link, the original text kept as supplier_note. On read only.
const suppliers = require('./prices/suppliers');
quote = ((orig) => function quoteSuppliers(bom, ...rest) { return orig(suppliers.normalizeBom(bom || {}), ...rest); })(quote); // eslint-disable-line no-func-assign

// ---------------------------------------------------------------- helpers
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const now = () => Date.now() / 1000;
function readJSON(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJSON(p, v) {
  const tmp = p + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
}
function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }
function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }
/** url + ?v=<mtime> for a file in dir (cache-busts thumb.png / renders after a model change), or null when it's missing. */
function vurl(dir, rel, url) { try { return url + '?v=' + Math.floor(fs.statSync(path.join(dir, rel)).mtimeMs); } catch { return null; } }
function newId() { return crypto.randomBytes(5).toString('hex'); }
function projDir(id) { return ID_RE.test(id || '') ? path.join(PROJECTS, id) : null; }
// showcase: the owner's finished designs are examples too (server/showcase.js, <DATA>/showcase/<slug>/). A repo example
// wins a slug clash. exampleSlugs(): repo examples (by slug), then showcase designs (newest first).
const SHOWCASE_OWNERS = new Set(String(process.env.FORMA_SHOWCASE_OWNERS || `${LEGACY_OWNER},${LOCAL_USER}`)
  .split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
let showcase = null; // set with the other modules below
function exDir(slug) {
  if (!ID_RE.test(slug || '')) return null;
  const d = path.join(EXAMPLES, slug);
  return exists(path.join(d, 'meta.json')) ? d : (showcase && showcase.dir(slug)) || d;
}
function exampleSlugs() {
  const repo = (fs.existsSync(EXAMPLES) ? fs.readdirSync(EXAMPLES) : []).filter((s) => ID_RE.test(s) && exists(path.join(EXAMPLES, s, 'meta.json'))).sort();
  const seen = new Set(repo);
  return [...repo, ...(showcase ? showcase.slugs().filter((s) => !seen.has(s)) : [])];
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const s = Buffer.concat(chunks).toString('utf8');
      if (!s) return resolve({});
      try { resolve(JSON.parse(s)); } catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.stl': 'model/stl', '.step': 'application/step',
  '.stp': 'application/step', '.py': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.3mf': 'model/3mf',
  '.webp': 'image/webp', '.gif': 'image/gif', // images: chat attachments
  '.webmanifest': 'application/manifest+json; charset=utf-8', // PWA: web/manifest.webmanifest
};

/** Serve a file strictly inside root. rel is the URL-decoded relative path. */
/** Security B1/B3: a project-relative path from untrusted JSON or HTML (manifest, ads.json, a deployed page) -> the real path
 * of a regular file inside dir, or null. No absolute or .. paths, no dot segments, no symlinks (lstat), realpath-contained. */
function projFileSync(dir, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || path.isAbsolute(rel) || rel.split(/[\\/]/).some((seg) => !seg || seg === '..' || seg.startsWith('.'))) return null;
  try {
    const root = fs.realpathSync(dir), p = path.join(root, rel);
    if (!fs.lstatSync(p).isFile()) return null; // a symlink is not a file to lstat
    const real = fs.realpathSync(p);
    return real.startsWith(root + path.sep) ? real : null;
  } catch { return null; }
}

/** A2: Content-Security-Policy for the studio shell (web/index.html). Inline scripts (the import map and the launch
 * splash) are allowed by hash, worked out from the file itself so editing index.html never needs a CSP edit. Allows what
 * the studio loads: jsDelivr (three.js, path tracer, posthog-js), PostHog, Google Fonts, same-origin frames (companion
 * app preview, build guide preview), blob workers (call timer) and https images (part photos). */
const shellCsp = { mtime: 0, value: '' };
function studioHeaders(file, mtimeMs, served) { // served: the HTML actually sent (assetver rewrites index.html)
  const key = served != null ? crypto.createHash('sha1').update(served).digest('hex') : mtimeMs;
  if (shellCsp.mtime !== key) {
    mtimeMs = key;
    const html = served != null ? served : readText(file) || '';
    const hashes = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
      .map((x) => `'sha256-${crypto.createHash('sha256').update(x[1]).digest('base64')}'`);
    shellCsp.value = [`default-src 'self'`,
      `script-src 'self' ${hashes.join(' ')} https://cdn.jsdelivr.net https://us-assets.i.posthog.com`,
      `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`, `font-src 'self' data: https://fonts.gstatic.com`,
      `img-src 'self' data: blob: https:`, `media-src 'self' data: blob:`,
      `connect-src 'self' data: blob: https://cdn.jsdelivr.net https://us.i.posthog.com https://us-assets.i.posthog.com`,
      `worker-src 'self' blob:`, `child-src 'self' blob:`, `frame-src 'self'`, `manifest-src 'self'`,
      `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'self'`].join('; ');
    shellCsp.mtime = mtimeMs;
  }
  return { 'Content-Security-Policy': shellCsp.value, 'X-Frame-Options': 'SAMEORIGIN', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin' };
}

async function serveFile(res, root, rel, { noCache = false, sandbox = false, v = null } = {}) {
  if (typeof rel !== 'string' || rel.includes('\0') || rel.split(/[\\/]/).some((seg) => seg === '..' || seg.startsWith('.'))) {
    return send(res, 404, { error: 'not found' });
  }
  const rootReal = await fsp.realpath(root).catch(() => null);
  if (!rootReal) return send(res, 404, { error: 'not found' });
  const target = path.resolve(rootReal, '.' + path.sep + rel);
  let real;
  try { real = await fsp.realpath(target); } catch { return send(res, 404, { error: 'not found' }); }
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) return send(res, 404, { error: 'not found' });
  let st;
  try { st = await fsp.stat(real); } catch { return send(res, 404, { error: 'not found' }); }
  if (!st.isFile()) return send(res, 404, { error: 'not found' });
  if (!sandbox && root === WEB && real === path.join(rootReal, 'index.html')) { // assetver: fingerprinted links + build id
    const body = Buffer.from(assetver.html(await fsp.readFile(real, 'utf8')));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store',
      ...studioHeaders(real, st.mtimeMs, body.toString('utf8')) });
    return res.end(body);
  }
  // assetver: a ?v= URL whose hash is this file's content never changes, so the browser keeps it for a year
  const pinned = !noCache && !sandbox && root === WEB && v && assetver.hashOf(path.relative(rootReal, real).split(path.sep).join('/')) === v;
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(real).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size,
    // app code is never cached (phones were running stale scripts after updates); images may revalidate
    'Cache-Control': pinned ? 'public, max-age=31536000, immutable' : noCache || /\.(m?js|css|html|json|webmanifest)$/i.test(real) ? 'no-store' : 'no-cache',
    ...(sandbox ? { 'Content-Security-Policy': 'sandbox; default-src \'none\'; img-src \'self\' data:; style-src \'unsafe-inline\'', 'X-Content-Type-Options': 'nosniff' } : {}),
    ...(!sandbox && root === WEB && /\.html$/i.test(real) && path.basename(real) !== 'admin.html' ? studioHeaders(real, st.mtimeMs) : {}), // A2
  });
  fs.createReadStream(real).pipe(res);
}

/** Small local-only pages: the A3 sign-in instructions and the A7 sign-out confirmation. */
function localPage(res, code, title, text, signOut = false) {
  const body = signOut
    ? '<form method="post" action="/logout"><button type="submit">Sign out</button></form><p><a href="/">Cancel</a></p>'
    : `<p>${escHtml(text)}</p><pre>cd "${escHtml(APP)}" && node scripts/local-signin.js</pre><p>Then open the link it prints. Until then you browse as a guest.</p><p><a href="/">Back</a></p>`;
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(title)} · Premake</title>
<style>body{font:16px/1.5 system-ui,-apple-system,sans-serif;max-width:34rem;margin:4rem auto;padding:0 16px;background:#fafaf9;color:#1c1917}
pre{background:#fff;border:1px solid #e7e5e4;border-radius:10px;padding:12px;white-space:pre-wrap;word-break:break-all;font-size:13px}
button{font:inherit;font-weight:600;padding:10px 18px;border-radius:10px;border:1px solid #d6d3d1;background:#fff;cursor:pointer}a{color:#1c1917}</style></head>
<body><h1>${escHtml(title)}</h1>${body}</body></html>`);
}

const PLACEHOLDER = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vibe manufacturing</title><style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 16px;background:#fafafa;color:#222}</style></head>
<body><h1>The server is running</h1><p>The web app has not been built yet. Try <a href="/api/examples">/api/examples</a> or <a href="/api/projects">/api/projects</a>.</p></body></html>`;

// ---------------------------------------------------------------- SSE + watching
const clients = new Map(); // id -> Set<res>
const runs = new Map(); // id -> design run { child, startedAt, events }
const siteRuns = new Map(); // id -> website run { child, startedAt, events }
const adsRuns = new Map(); // id -> ads chat run { child, startedAt, events }
const appRuns = new Map(); // apps: id -> app agent run (edits ./app/** only)
const runMap = (kind) => (kind === 'site' ? siteRuns : kind === 'ads' ? adsRuns : kind === 'app' ? appRuns : runs);
const KIND_P = { design: '', site: 'site_', ads: 'ads_', app: 'app_' };
const watchers = new Map(); // id -> { timer, sig }
// Every emitted event gets a sequence number and goes into a short per-project log, so clients that can't
// receive SSE (e.g. behind a Cloudflare quick tunnel) can poll GET /api/projects/<id>/run?since=<seq>&boot=<boot>.
const BOOT = Date.now().toString(36);
let EVENT_SEQ = 0;
const PROJ_LOG_MAX = 400;
const projLog = new Map(); // id -> [ev with seq]
const pollSeen = new Map(); // id -> last poll time; keeps the file watcher alive for pollers

/** Latest step text of a live run (sidebar subtitle), or ''. */
function lastStepOf(run) { const ev = run?.events || []; for (let i = ev.length - 1; i >= 0; i--) if (/step$/.test(ev[i].type)) return ev[i].text || ''; return ''; }
/** Emit and remember an event for this run, so reconnecting clients can replay it. */
function record(id, run, ev) {
  if (run.flow) flowAdd(run.flow, ev, run.P);
  run.events.push(ev);
  if (run.events.length > RUN_EVENTS_MAX) run.events.splice(0, run.events.length - RUN_EVENTS_MAX);
  emit(id, ev);
}

/** narration: the turn as it happened, [{ text } | { steps, parts? }], so the reply can show its messages between the steps. */
function flowAdd(flow, ev, P) {
  const last = flow[flow.length - 1];
  if (ev.type === P + 'assistant') flow.push({ text: ev.text });
  else if (ev.type === P + 'step') {
    const g = last?.steps ? last : (flow.push({ steps: [] }), flow[flow.length - 1]);
    g.steps.push(ev.text);
    if (ev.parts?.length) (g.parts ||= {})[g.steps.length - 1] = ev.parts;
  }
}
/** The flow to keep on the reply: only when the agent wrote between steps; the reply's own text is not repeated. */
function flowForReply(flow, reply) {
  const f = (flow || []).filter((x) => x.text == null || !reply.includes(x.text)); // a stopped run's reply is every text joined
  return f.some((x) => x.text != null) ? f : null;
}

function emit(id, ev) {
  ev.seq = ++EVENT_SEQ;
  const log = projLog.get(id) || [];
  log.push(ev);
  if (log.length > PROJ_LOG_MAX) log.splice(0, log.length - PROJ_LOG_MAX);
  projLog.set(id, log);
  emitLive(id, ev);
}
/** Send to connected SSE clients only (no sequence number, not logged): used for throttled partial text. */
function emitLive(id, ev) {
  const set = clients.get(id);
  if (!set) return;
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of set) if (!res.formaRole || memberEvent(res.formaRole, ev.type)) res.write(line); // share: collaborators' streams are filtered
}
/** The agent's in-progress prose and thinking, pushed at most every 250 ms. */
function livePartial(id, run) {
  if (run.partialTimer) return;
  run.partialTimer = setTimeout(() => {
    run.partialTimer = null;
    if (runMap(run.kind).get(id) !== run) return;
    emitLive(id, { type: run.P + 'partial', text: run.partial || '', thinking: run.thinking || '' });
  }, 250);
}

function fileSig(p) { try { const s = fs.statSync(p); return s.mtimeMs + ':' + s.size; } catch { return ''; } }
function sigs(dir) {
  return { manifest: fileSig(path.join(dir, 'manifest.json')), bom: fileSig(path.join(dir, 'bom.json')), code: fileSig(path.join(dir, 'design.py')),
    site: fileSig(path.join(dir, 'site', 'site.json')) + '|' + fileSig(path.join(dir, 'site', 'theme.css')), ads: fileSig(path.join(dir, 'ads', 'ads.json')),
    app: apps.sig(dir) }; // apps: any file in app/
}
/** Check the project's files right now (after a build finished) instead of waiting for the next tick. */
function pokeWatcher(id) { const w = watchers.get(id); if (w) setTimeout(w.tick, 30); }
function ensureWatcher(id) {
  if (watchers.has(id)) return;
  const dir = projDir(id);
  const w = { sig: sigs(dir), timer: null };
  w.tick = () => {
    const s = sigs(dir);
    if (s.manifest !== w.sig.manifest && s.manifest) {
      const m = readJSON(path.join(dir, 'manifest.json'));
      if (!m) return; // mid-write; retry next tick
      emit(id, { type: 'model_updated', t: m.t });
      const r = runs.get(id);
      if (r?.tl && r.tl.first_model == null && r.buildIds.size) r.tl.first_model = Date.now() - r.tl.t_send; // the agent's own build, not a leftover
      if (!r) renderThumb(dir); // no renders during a design run: the server renders thumb.png when it ends
    }
    if (s.bom !== w.sig.bom && s.bom) emit(id, { type: 'bom_updated' });
    if (s.code !== w.sig.code && s.code) emit(id, { type: 'code_updated' });
    if (s.site !== w.sig.site) {
      // only announce parseable site.json (the agent may be mid-write)
      if (exists(path.join(dir, 'site', 'site.json')) && !readJSON(path.join(dir, 'site', 'site.json'))) { s.site = w.sig.site; }
      else emit(id, { type: 'site_updated' });
    }
    if (s.ads !== w.sig.ads && s.ads) {
      if (!readJSON(path.join(dir, 'ads', 'ads.json'))) s.ads = w.sig.ads; // mid-write
      else emit(id, { type: 'ads_updated' });
    }
    if (s.app !== w.sig.app) emit(id, { type: 'app_updated' }); // apps: the studio's App tab reloads its preview
    w.sig = s;
    if (!runs.has(id) && !siteRuns.has(id) && !adsRuns.has(id) && !appRuns.has(id) && !(clients.get(id) || new Set()).size && Date.now() - (pollSeen.get(id) || 0) > 30000) { clearInterval(w.timer); watchers.delete(id); }
  };
  w.timer = setInterval(w.tick, 400);
  watchers.set(id, w);
}

// ---------------------------------------------------------------- projects
/** build.sh for one project dir. design.py runs with an empty env and inside the Seatbelt sandbox (server/sandbox.js),
 * whoever starts the build. The agent can't change this file (permission rules + the sandbox both deny it). */
function buildSh(dir) {
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const home = path.join(dir, AGENT_HOME);
  const box = sandbox.AVAILABLE ? `/usr/bin/sandbox-exec -p ${q(buildProfile(dir))} ` : '';
  // Fast path: hand the build to this project's warm worker (cadlib/worker.py, already inside the same sandbox with
  // cadquery imported) if one answers within 1.5 s; otherwise the normal cold build below.
  return `#!/bin/sh
# Exports STLs + manifest.json for this design dir. Run: ./build.sh
cd ${q(dir)} || exit 1
mkdir -p ${q(path.join(home, 'tmp'))} ${q(path.join(home, 'cache'))}
W=.build
if [ -f "$W/worker.pid" ] && kill -0 "$(cat "$W/worker.pid" 2>/dev/null)" 2>/dev/null; then
  N="$$.$(date +%s)"
  : > "$W/req.$N"
  i=0; while [ ! -e "$W/ack.$N" ] && [ $i -lt 30 ]; do sleep 0.05; i=$((i+1)); done
  if [ -e "$W/ack.$N" ]; then
    i=0
    while [ ! -e "$W/done.$N" ]; do
      sleep 0.05; i=$((i+1))
      if [ $((i % 20)) = 0 ] && ! kill -0 "$(cat "$W/worker.pid" 2>/dev/null)" 2>/dev/null; then break; fi
      [ $i -gt 12000 ] && break
    done
    if [ -e "$W/done.$N" ]; then
      cat "$W/out.$N" 2>/dev/null; code=$(cat "$W/done.$N" 2>/dev/null)
      rm -f "$W/ack.$N" "$W/done.$N" "$W/out.$N"
      case "$code" in ''|*[!0-9]*) exit 1;; *) exit "$code";; esac
    fi
  fi
  rm -f "$W/req.$N" "$W/ack.$N" "$W/out.$N"
fi
APP=${q(APP)}
PY=${q(VENV_PY)}
MOD="-m cadlib.build"; [ -f "$APP/cadlib/build.py" ] || MOD="$APP/server/fallback_build.py"
${ULIMITS}
${box ? `# codex: Codex runs this script inside its own macOS sandbox, where a second sandbox-exec is not allowed
[ -n "$CODEX_SANDBOX" ] && exec /usr/bin/env -i PATH=/usr/bin:/bin LANG=en_US.UTF-8 HOME=${q(home)} TMPDIR=${q(path.join(home, 'tmp'))} XDG_CACHE_HOME=${q(path.join(home, 'cache'))} \\
  MPLCONFIGDIR=${q(path.join(home, 'cache'))} FORMA_NO_RENDER=1 PYTHONPATH="$APP" PYTHONDONTWRITEBYTECODE=1 "$PY" $MOD .
` : ''}exec /usr/bin/env -i PATH=/usr/bin:/bin LANG=en_US.UTF-8 HOME=${q(home)} TMPDIR=${q(path.join(home, 'tmp'))} XDG_CACHE_HOME=${q(path.join(home, 'cache'))} \\
  MPLCONFIGDIR=${q(path.join(home, 'cache'))} FORMA_NO_RENDER=1 PYTHONPATH="$APP" PYTHONDONTWRITEBYTECODE=1 \\
  ${box}"$PY" $MOD .
`;
}

const DESIGN_STUB = `import cadquery as cq


def parts():
    # Placeholder: a 40 mm rounded cube. The design agent replaces this.
    cube = cq.Workplane("XY").box(40, 40, 40).translate((0, 0, 20)).edges().fillet(6)
    return [{"name": "Placeholder", "shape": cube, "group": "case", "color": "#c9ced6"}]
`;

function writeProjectScaffold(dir) {
  for (const [f, body] of [['build.sh', buildSh(dir)], ['views.sh', viewsSh(dir)]]) {
    const p = path.join(dir, f);
    fs.writeFileSync(p, body);
    fs.chmodSync(p, 0o755);
  }
}
/** Make sure the project has the current server-written build.sh and views.sh (older projects get the sandboxed ones). */
function ensureBuildSh(dir) { if (readText(path.join(dir, 'build.sh')) !== buildSh(dir) || readText(path.join(dir, 'views.sh')) !== viewsSh(dir)) writeProjectScaffold(dir); }
/** selfcheck: views.sh renders the last build from 4 sides into ./views/ (cadlib/views.py: numpy + Pillow, no VTK, so it
 * runs inside the same Seatbelt sandbox and empty env as build.sh, ~1 s) for the agent to Read and compare with the
 * user's photo. Like build.sh, the agent can run it but never change it. */
function viewsSh(dir) {
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const home = path.join(dir, AGENT_HOME);
  const box = sandbox.AVAILABLE ? `/usr/bin/sandbox-exec -p ${q(buildProfile(dir))} ` : '';
  return `#!/bin/sh
# Renders iso / front / side / top views of the last build into ./views/ (sheet.png = all four). Run: ./views.sh
cd ${q(dir)} || exit 1
mkdir -p ${q(path.join(home, 'tmp'))} ${q(path.join(home, 'cache'))}
${ULIMITS}
${box ? `[ -n "$CODEX_SANDBOX" ] && exec /usr/bin/env -i PATH=/usr/bin:/bin LANG=en_US.UTF-8 HOME=${q(home)} TMPDIR=${q(path.join(home, 'tmp'))} XDG_CACHE_HOME=${q(path.join(home, 'cache'))} \\
  MPLCONFIGDIR=${q(path.join(home, 'cache'))} PYTHONPATH=${q(APP)} PYTHONDONTWRITEBYTECODE=1 ${q(VENV_PY)} -m cadlib.views .
` : ''}exec /usr/bin/env -i PATH=/usr/bin:/bin LANG=en_US.UTF-8 HOME=${q(home)} TMPDIR=${q(path.join(home, 'tmp'))} XDG_CACHE_HOME=${q(path.join(home, 'cache'))} \\
  MPLCONFIGDIR=${q(path.join(home, 'cache'))} PYTHONPATH=${q(APP)} PYTHONDONTWRITEBYTECODE=1 \\
  ${box}${q(VENV_PY)} -m cadlib.views .
`;
}

const builds = new Map(); // id -> { again } while a server-started build runs (one at a time per project)
function runBuild(id) {
  const dir = projDir(id);
  ensureWatcher(id);
  const cur = builds.get(id);
  if (cur) { cur.again = true; return; }
  const b = { again: false };
  builds.set(id, b);
  ensureBuildSh(dir); // always the server's own build.sh (it sandboxes design.py itself)
  const child = spawn(path.join(dir, 'build.sh'), [], { cwd: dir, stdio: 'ignore', env: agentEnv(dir) });
  const done = () => { builds.delete(id); renderThumb(dir); if (b.again) runBuild(id); };
  child.on('error', done);
  child.on('close', done);
}

/** Warm build worker for one project: `python -m cadlib.worker` under exactly the build.sh sandbox profile and empty env,
 * cwd = the project. ./build.sh hands builds to it (see buildSh). Idempotent; LRU-evicts idle workers past the caps. */
const workers = new Map(); // id -> { child, owner, lastUsed, startedAt }
function warmWorker(id) {
  const dir = projDir(id);
  if (!dir || !exists(path.join(dir, 'design.py'))) return false;
  const cur = workers.get(id);
  if (cur) { cur.lastUsed = Date.now(); return true; }
  const owner = ownerOf(id);
  const idle = (list) => list.sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
  const mine = [...workers].filter(([, w]) => w.owner === owner);
  if (mine.length >= WORKERS_PER_USER) stopWorker(idle(mine)[0]);
  if (workers.size >= WORKERS_MAX) stopWorker(idle([...workers])[0]);
  const home = path.join(dir, AGENT_HOME);
  for (const d of ['tmp', 'cache']) fs.mkdirSync(path.join(home, d), { recursive: true });
  const env = { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', HOME: home, TMPDIR: path.join(home, 'tmp'), XDG_CACHE_HOME: path.join(home, 'cache'),
    MPLCONFIGDIR: path.join(home, 'cache'), FORMA_NO_RENDER: '1', PYTHONPATH: APP, PYTHONDONTWRITEBYTECODE: '1',
    OBJC_DISABLE_INITIALIZE_FORK_SAFETY: 'YES', FORMA_WORKER_IDLE: String(WORKER_IDLE_MS / 1000 + 300) };
  const [cmd, args] = sandbox.AVAILABLE ? ['/usr/bin/sandbox-exec', ['-p', buildProfile(dir), VENV_PY, '-m', 'cadlib.worker', dir]] : [VENV_PY, ['-m', 'cadlib.worker', dir]];
  let child;
  // C4: same caps as build.sh; the CPU cap is per process, so each forked build gets its own BUILD_CPU_S
  try { child = spawn('/bin/sh', ['-c', `${ULIMITS}; exec "$@"`, 'worker', cmd, ...args], { cwd: dir, env, stdio: ['ignore', 'ignore', 'pipe'] }); } catch (e) { console.error(`[worker ${id}] spawn failed: ${e.message}`); return false; }
  const w = { child, owner, lastUsed: Date.now(), startedAt: Date.now() };
  workers.set(id, w);
  let err = '';
  child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
  child.on('error', () => {});
  child.on('close', (code) => {
    if (workers.get(id) === w) workers.delete(id);
    if (code && !w.stopping) console.error(`[worker ${id}] exited ${code}: ${err.trim().split('\n').pop() || ''}`);
  });
  return true;
}
function stopWorker(id) { const w = workers.get(id); if (!w) return; w.stopping = true; workers.delete(id); try { w.child.kill('SIGTERM'); } catch {} }

// ---- colours: filament colour picks for printed parts (web/hover.js swatches). Saved in meta.json "colors" {part: hex};
// applied to manifest.json now and by cadlib/build.py on every rebuild (printed parts only), so no AI run is needed.
// The bom "printed" line gets "color" too, so the order shows which filament to load. Owner/admin only (canEdit gate).
const FILAMENTS = { '#1c1c1c': 'black', '#f4f4f1': 'white', '#8a8f98': 'grey', '#e8590c': 'orange', '#c92a2a': 'red', '#1f5fbf': 'blue', '#2f9e44': 'green', '#f2c12e': 'yellow' };
function setPartColor(id, dir, body) {
  const part = typeof body?.part === 'string' ? body.part : '';
  const color = body?.color == null ? null : String(body.color).toLowerCase();
  if (color !== null && !FILAMENTS[color]) throw Object.assign(new Error('Pick one of the filament colours.'), { code: 400 });
  const manPath = path.join(dir, 'manifest.json'), man = readJSON(manPath);
  const row = (man?.parts || []).find(p => p.name === part);
  if (!row) throw Object.assign(new Error('That part is not in the model.'), { code: 404 });
  if ((row.process || (row.group === 'component' ? 'bought' : 'print')) !== 'print') throw Object.assign(new Error('Only 3D printed parts can change colour.'), { code: 400 });
  const meta = readJSON(path.join(dir, 'meta.json'), {});
  const colors = meta.colors && typeof meta.colors === 'object' ? meta.colors : {};
  if (color) colors[part] = color; else delete colors[part];
  meta.colors = colors;
  writeJSON(path.join(dir, 'meta.json'), meta);
  const base = row.design_color || row.color;
  if (color) { row.design_color = base; row.color = color; } else { row.color = base; delete row.design_color; }
  writeJSON(manPath, man); // same t: the STLs did not change
  const bom = readJSON(path.join(dir, 'bom.json'));
  const line = (bom?.printed || []).find(x => x.name === part || (x.file && x.file === row.file));
  if (line) { if (color) line.color = color; else delete line.color; writeJSON(path.join(dir, 'bom.json'), bom); }
  renderThumb(dir);
  return { ok: true, part, color: row.color, colors };
}

/** thumb.png, rendered by the server (VTK needs the window server, which the sandbox blocks) when missing or older than the model.
 * Reads only manifest.json + STLs; never imports design.py. cwd is the app, so nothing in the project dir shadows cadlib. */
const thumbJobs = new Set();
function renderThumb(dir) {
  const man = path.join(dir, 'manifest.json'), th = path.join(dir, 'thumb.png');
  let mt; try { mt = fs.statSync(man).mtimeMs; } catch { return; }
  let tt = 0; try { tt = fs.statSync(th).mtimeMs; } catch {}
  if (tt >= mt || thumbJobs.has(dir)) return;
  thumbJobs.add(dir);
  const view = ((readText(path.join(dir, 'design.py')) || '').match(/^THUMB_VIEW\s*=\s*["'](iso|iso_low|iso_back|front|side|top)["']/m) || [])[1] || 'iso';
  const [cmd, args, opts] = renderSpawn('cadlib.render_thumb', [dir, '--view', view], { dir });
  runProc(cmd, args, opts, 60e3)
    .then((r) => { if (r.code !== 0) console.error(`[thumb ${path.basename(dir)}] render failed: ${(r.stderr || '').trim().split('\n').pop()}`); })
    .finally(() => thumbJobs.delete(dir));
}

function createProject({ fromExample, fromShare, fromProject, ref, owner, prompt } = {}) {
  if (!owner) throw Object.assign(new Error('Sign in to create a project'), { code: 401 });
  fs.mkdirSync(PROJECTS, { recursive: true });
  const id = newId();
  const dir = path.join(PROJECTS, id);
  const sharedLink = fromShare ? share.remixSource(fromShare) : null; // share: remix from a share link (/d/<id>)
  // duplicate: a copy of one of your own designs (the route checks you can edit it); copied like a share link's "Make a copy"
  const own = fromProject ? projDir(fromProject) : null;
  const shared = own && !sharedLink ? { dir: own, project: true, own: true } : sharedLink;
  if (fromShare && !shared) throw Object.assign(new Error('This design isn’t shared for remixing.'), { code: 404 });
  if (fromExample || shared) {
    const src = shared ? shared.dir : exDir(fromExample);
    if (!src || !exists(path.join(src, 'design.py'))) throw Object.assign(new Error('example not found'), { code: 404 });
    fs.cpSync(src, dir, {
      recursive: true,
      filter: (s) => {
        const b = path.basename(s);
        if (shared?.project && path.dirname(s) === src && ['site', 'ads', 'guide', 'uploads', 'build_log.txt', 'support', 'runs.jsonl', 'app', '.app_messages.json', '.sourcing', '.agent-home', '.build'].includes(b)) return false; // share: a remix copies the design, not the owner's site / ads / chats
        return s === src || !(b.startsWith('.') || ['messages.json', 'agent.json', 'versions.json', 'build.sh', 'views.sh', '__pycache__'].includes(b) || (b === 'preview' && path.dirname(s) === src)); // livepreview: scratch STLs
      },
    });
    const meta = readJSON(path.join(dir, 'meta.json'), {});
    meta.title = `${shared?.project ? 'Copy' : 'Remix'} of ${meta.title || fromExample}`; // share: "Make a copy" links make a copy
    if (shared?.own) meta.duplicate_of = fromProject; // duplicate:
    meta.creator = 'you';
    meta.remix_of = shared ? (shared.project ? undefined : shared.id) : fromExample;
    if (shared) { if (!shared.own) meta.remix_of_share = fromShare; delete meta.share; delete meta.referred_by; delete meta.referred_at; }
    meta.created = new Date().toISOString();
    delete meta.demo;
    meta.owner = owner;
    writeJSON(path.join(dir, 'meta.json'), meta);
  } else {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'design.py'), DESIGN_STUB);
    writeJSON(path.join(dir, 'bom.json'), { parts: [], assembly_minutes: 0, kit_ok: true });
    writeJSON(path.join(dir, 'meta.json'), { title: 'Untitled', description: '', creator: 'you', tags: [], created: new Date().toISOString(), owner });
  }
  if (typeof ref === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(ref) && ref !== id) { // referral attribution (?ref=), demo only
    const meta = readJSON(path.join(dir, 'meta.json'), {});
    meta.referred_by = ref; meta.referred_at = new Date().toISOString();
    writeJSON(path.join(dir, 'meta.json'), meta);
  }
  writeJSON(path.join(dir, 'messages.json'), []);
  setOwner(id, owner);
  writeJSON(path.join(dir, '.agent.json'), { sessionId: crypto.randomUUID(), started: false });
  writeProjectScaffold(dir);
  // A new design with a prompt skips the placeholder cube: the instant sketch and then the agent's first build fill the view.
  if (!exists(path.join(dir, 'manifest.json')) && !prompt) runBuild(id);
  return id;
}

/** Local installs: on first start, every repo example is copied into your projects (titles kept) so the sidebar starts
 *  full and each one opens and edits like your own design. Once only (DATA/.examples-seeded); deleting one keeps it gone. */
function seedExamples() {
  const mark = path.join(DATA, '.examples-seeded');
  if (ONLINE || exists(mark) || process.env.PREMAKE_SEED_EXAMPLES !== '1') return; // start.sh turns it on (not tests or dev servers)
  const slugs = (fs.existsSync(EXAMPLES) ? fs.readdirSync(EXAMPLES) : []).filter((s) => ID_RE.test(s) && exists(path.join(EXAMPLES, s, 'design.py')))
    .map((s) => [s, String(readJSON(path.join(EXAMPLES, s, 'meta.json'), {}).title || s)]).sort((a, b) => b[1].localeCompare(a[1])).map((x) => x[0]);
  let n = 0;
  for (const slug of slugs) { // Z-A by title, so the sidebar (newest first) reads A-Z
    try {
      const id = createProject({ fromExample: slug, owner: LOCAL_USER, prompt: true });
      const dir = path.join(PROJECTS, id), meta = readJSON(path.join(dir, 'meta.json'), {}), orig = readJSON(path.join(EXAMPLES, slug, 'meta.json'), {});
      meta.title = orig.title || meta.title; meta.creator = orig.creator || 'Premake'; meta.example_copy = slug; meta.showcase = false; // not re-published as a showcase example
      fs.rmSync(path.join(dir, 'replay'), { recursive: true, force: true }); // replay: only a new design plays it
      writeJSON(path.join(dir, 'meta.json'), meta); n++;
    } catch (e) { console.error(`[seed ${slug}] ${e.message}`); }
  }
  fs.writeFileSync(mark, new Date().toISOString() + '\n');
  if (n) console.log(`  examples: ${n} added to your projects`);
}

/** replay: a new design whose request matches an example with a recorded real run (examples/<slug>/replay/, made by
 *  scripts/make-replay.py) starts as that example and the studio plays the real run back sped up (web/replay.js), then
 *  hands over to the live agent. Local installs only (PREMAKE_REPLAY=0 turns it off). The reply says it was a replay. */
const REPLAYS = [{ slug: 'scara-arm-3d-printer', re: /\bscara\b/i }];
function replayFor(prompt) {
  if (ONLINE || process.env.PREMAKE_REPLAY === '0') return null;
  const r = REPLAYS.find((x) => x.re.test(prompt));
  return r && exists(path.join(EXAMPLES, r.slug, 'replay', 'replay.json')) ? r.slug : null;
}
function replayFlow(R) {
  const flow = [];
  for (const e of R.events || []) {
    const st = e.type === 'step' ? e.text : null;
    if (e.type === 'text') flow.push({ text: e.text });
    else if (e.type === 'round') flow.push({ text: `Feedback round ${e.n} of ${R.rounds_total}.` });
    else if (st) { const g = flow[flow.length - 1]; if (g?.steps) g.steps.push(st); else flow.push({ steps: [st] }); }
  }
  return flow;
}
function startReplay(slug, prompt, owner) {
  const id = createProject({ fromExample: slug, owner, prompt: true });
  const dir = path.join(PROJECTS, id), R = readJSON(path.join(dir, 'replay', 'replay.json'), {});
  const orig = readJSON(path.join(EXAMPLES, slug, 'meta.json'), {}), meta = readJSON(path.join(dir, 'meta.json'), {});
  meta.title = orig.title || meta.title; meta.replay = { pending: true, slug }; meta.showcase = false;
  writeJSON(path.join(dir, 'meta.json'), meta);
  const h = Math.floor((R.minutes || 0) / 60), mins = (R.minutes || 0) % 60, took = h ? `${h} h ${mins} min` : `${mins} min`;
  const text = `Here's your ${meta.title || 'design'}: ${String(orig.description || '').replace(/^[^:]*:\s*/, '').replace(/\.?$/, '.')} The Order tab has every part and where to buy it, and Make has the files.\n\n`
    + `This was a replay of a real Premake build: ${R.rounds_total || 'several'} rounds with a person giving feedback, ${took} of real work, shown here sped up. Ask for any change and it's live from here.`;
  const now = Date.now() / 1000;
  writeJSON(path.join(dir, 'messages.json'), [{ role: 'user', text: String(prompt).slice(0, 4000), t: now }, { role: 'assistant', text, flow: replayFlow(R), questions: [brain.finishCard({ electronics: apps.info(dir).electronics })], t: now + 1 }]);
  console.log(`[replay ${id}] ${slug} for ${JSON.stringify(String(prompt).slice(0, 80))}`);
  return id;
}

function projectUpdated(dir) {
  let t = 0;
  for (const f of ['meta.json', 'messages.json', 'manifest.json', 'design.py', 'bom.json']) {
    try { t = Math.max(t, fs.statSync(path.join(dir, f)).mtimeMs); } catch {}
  }
  return t ? new Date(t).toISOString() : null;
}

function designPayload(kind, id, dir) {
  return {
    meta: readJSON(path.join(dir, 'meta.json'), {}),
    manifest: readJSON(path.join(dir, 'manifest.json')),
    bom: readJSON(path.join(dir, 'bom.json'), { parts: [], assembly_minutes: 0, kit_ok: true }),
    base: `/files/${kind}/${id}/`,
    code: readText(path.join(dir, 'design.py')) || '',
  };
}

// ---------------------------------------------------------------- agent runs
// Two agents per project, each with its own Claude Code session:
//   design: edits design.py / bom.json, runs ./build.sh       events: run_started, step, assistant, run_finished
//   site:   edits ./site/** only (product page)               events: site_run_started, site_step, site_assistant, site_run_finished
//   ads:    edits ./ads/ads.json only (ad copy + palettes)     events: ads_run_started, ads_step, ads_assistant, ads_run_finished (+ ads_updated)
let agentPrompt = '';
let sitePrompt = '';
let adsAgentPrompt = '';
function loadAdsPrompt() { adsAgentPrompt = readText(ADS_PROMPT_FILE) || ''; }
// Master rules (server/master_rules.md): curated by the team from past chats, appended to the design prompt.
const LESSONS_FILE = path.join(__dirname, 'master_rules.md');
// Index of the real-world dimension library (cadlib/dims/*.json), appended so the agent knows which keys exist.
function dimsIndex() {
  const byCat = new Map();
  try {
    const d = path.join(APP, 'cadlib', 'dims');
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.json')).sort()) {
      for (const e of readJSON(path.join(d, f), [])) if (e && e.key) (byCat.get(e.category) || byCat.set(e.category, []).get(e.category)).push(e.key);
    }
  } catch {}
  if (!byCat.size) return '';
  return '\n\n## cadlib.dims keys (`from cadlib.dims import dim`)\n\n'
    + [...byCat].sort(([a], [b]) => a.localeCompare(b)).map(([c, ks]) => `- ${c}: ${ks.sort().join(', ')}`).join('\n') + '\n';
}
function loadAgentPrompt() {
  const t = (readText(AGENT_PROMPT_FILE) || '').replaceAll('{{CADLIB}}', CADLIB_DIR) + dimsIndex() + '\n\n' + (readText(LESSONS_FILE) || '');
  if (agentPrompt && t !== agentPrompt) promptGen++; agentPrompt = t;
}
function loadSitePrompt() { sitePrompt = readText(SITE_PROMPT_FILE) || ''; }

function addMessageTo(file, role, text, extra) {
  const msgs = readJSON(file, []);
  msgs.push({ role, text, t: now(), ...(extra || {}) });
  writeJSON(ensureDir(file), msgs);
  return msgs.length - 1;
}
function addMessage(dir, role, text) { addMessageTo(path.join(dir, 'messages.json'), role, text); }

function stepText(name, input = {}) {
  const base = (f) => (f ? path.basename(String(f)) : 'file');
  switch (name) {
    case 'Read': return `Reading ${base(input.file_path)}`;
    case 'Write': return `Writing ${base(input.file_path)}`;
    case 'Edit': case 'MultiEdit': return `Editing ${base(input.file_path)}`;
    case 'Glob': return 'Looking through files';
    case 'Grep': { // plain words, never the raw regex: "^def (screw_boss|pilot)" -> "Looking up screw boss and pilot"
      const words = [...new Set(String(input.pattern || '').replace(/\\[a-z]/gi, ' ').match(/[A-Za-z][A-Za-z0-9_]{2,}/g) || [])]
        .filter((w) => !/^(def|class|import|from|return|self)$/.test(w)).slice(0, 3).map((w) => w.replace(/_/g, ' ').toLowerCase());
      return words.length ? `Looking up ${words.length > 1 ? words.slice(0, -1).join(', ') + ' and ' + words.at(-1) : words[0]}` : 'Looking through files';
    }
    case 'WebSearch': return `Searching: ${String(input.query || '').slice(0, 80)}`;
    case 'WebFetch': return `Reading ${String(input.url || '').slice(0, 80)}`;
    case 'TodoWrite': return 'Planning';
    case 'Bash': return /build\.sh/.test(input.command || '') ? 'Building model' : /views\.sh/.test(input.command || '') ? 'Looking at the model from all sides' : String(input.description || '').trim().slice(0, 60) || 'Checking the design'; // never show a raw shell command
    default: return name;
  }
}
const { titleFromPrompt, titleFallback, TITLE_FILLER } = brain; // placeholder titles (server/agentbrain.js)

/** agentbrain: a short product name ("Telescopic Camping Light") for a design whose title is still the placeholder
 * (meta.title_auto). One low-effort, tool-less claude-opus-5-5 call on the subscription, like the sketch; the agent may
 * also set it (then title_auto is false and this is skipped). The user can rename any time. */
const titleJobs = new Set();
function autoTitle(id, prompt, reply = '') {
  if (titleJobs.has(id) || !String(prompt || '').trim()) return;
  titleJobs.add(id);
  const cw = path.join(DATA, '.sketcher');
  try { fs.mkdirSync(cw, { recursive: true }); } catch {}
  runProc(CLAUDE, ['-p', brain.titleInput(prompt, reply), ...brain.titleArgs(FORMA_MODEL).slice(1)], { cwd: cw, env: agentEnv(cw) }, 60e3).then((r) => {
    let out = ''; try { out = JSON.parse(r.stdout)?.result || ''; } catch {}
    const dir = projDir(id), mf = dir && path.join(dir, 'meta.json');
    const meta = mf && readJSON(mf, null);
    const llm = brain.cleanTitle(out);
    const title = (llm && !TITLE_FILLER.has(llm.toLowerCase()) ? llm : '') || (reply ? titleFallback(meta) : ''); // end of run: the agent's description
    if (!title || !meta || !meta.title_auto) { if (!title) console.log(`[title ${id}] no title (code ${r.code}${r.timedOut ? ', timed out' : ''})`); return; }
    meta.title = title; meta.title_auto = false;
    writeJSON(mf, meta);
    emit(id, { type: 'title', title });
    console.log(`[title ${id}] ${JSON.stringify(title)}`);
  }).catch(() => {}).finally(() => titleJobs.delete(id));
}

// ---- security recheck N1: an Edit collaborator's design turn runs in the owner's folder, so afterwards the owner-only
// parts (website, ads, companion app, build guide, support chat, app chat) are put back exactly as they were. Snapshots
// live outside the project (DATA/.member-guard), where neither the agent nor design.py can reach them.
const OWNER_ONLY = ['site', 'ads', 'app', 'guide', 'support', '.app_messages.json'];
const GUARD_ROOT = path.join(DATA, '.member-guard');
function guardFiles(root) { // rel -> sha1 of every regular file under the OWNER_ONLY paths (symlinks skipped)
  const out = new Map();
  const walk = (abs, rel, depth) => {
    let st; try { st = fs.lstatSync(abs); } catch { return; }
    if (st.isFile()) { try { out.set(rel, crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex')); } catch {} return; }
    if (!st.isDirectory() || depth > 8 || path.basename(abs) === AGENT_HOME) return;
    for (const n of fs.readdirSync(abs)) walk(path.join(abs, n), rel + '/' + n, depth + 1);
  };
  for (const p of OWNER_ONLY) walk(path.join(root, p), p, 0);
  return out;
}
function memberGuardStart(id, dir) {
  const snap = path.join(GUARD_ROOT, id + '-' + Date.now().toString(36));
  const files = guardFiles(dir);
  try {
    for (const rel of files.keys()) { const d = path.join(snap, rel); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(dir, rel), d); }
  } catch (e) { console.error(`[member-guard ${id}] snapshot failed: ${e.message}`); }
  return { snap, files, busy: () => siteRuns.has(id) || adsRuns.has(id) || appRuns.has(id) };
}
/** Put back what a collaborator's turn changed under OWNER_ONLY. Skipped (with a log line) if the owner's own website,
 * ads or app agent ran meanwhile, so their work is never undone. */
function memberGuardEnd(id, dir, g) {
  if (!g) return [];
  const changed = [];
  try {
    if (g.busy()) { console.log(`[member-guard ${id}] owner's agent ran during the collaborator turn; not restoring`); return []; }
    const now = guardFiles(dir);
    for (const [rel, h] of now) if (!g.files.has(rel)) { fs.rmSync(path.join(dir, rel), { force: true }); changed.push(rel); }
    for (const [rel, h] of g.files) {
      if (now.get(rel) === h) continue;
      const dst = path.join(dir, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      try { if (fs.lstatSync(dst).isSymbolicLink() || fs.lstatSync(dst).isDirectory()) fs.rmSync(dst, { recursive: true, force: true }); } catch {}
      const tmp = dst + '.' + process.pid + '.tmp'; fs.copyFileSync(path.join(g.snap, rel), tmp); fs.renameSync(tmp, dst);
      changed.push(rel);
    }
    // anything a collaborator turned into a symlink or planted outside the walk is gone with the rm above; dirs left empty are harmless
    if (changed.length) console.log(`[member-guard ${id}] restored owner-only files: ${changed.slice(0, 10).join(', ')}`);
  } catch (e) { console.error(`[member-guard ${id}] restore failed: ${e.message}`); }
  finally { fs.rmSync(g.snap, { recursive: true, force: true }); }
  return changed;
}

/** install.sh: setup.sh may still be installing CadQuery (PREMAKE_SETUP_BG=1) while the studio already runs; a design
 *  run waits for .venv/.premake-ready (checked every 2 s, up to 15 min). Everything else starts at once. */
const setupReady = () => process.env.PREMAKE_SETUP_BG !== '1' || exists(path.join(APP, '.venv', '.premake-ready'));
function whenSetupReady(fn) {
  if (setupReady()) return fn();
  const failed = () => exists(path.join(APP, '.setup-failed')); // setup.sh gave up: run anyway, so the error shows in the chat instead of a silent wait
  const t0 = Date.now(), tick = () => { if (setupReady() || failed()) fn(); else if (Date.now() - t0 < 15 * 60e3) setTimeout(tick, 2000); };
  setTimeout(tick, 2000);
}
function startRun(id, text, tSend, by) {
  if (!setupReady()) { console.log(`[setup] ${id}: waiting for setup to finish before the design run`); return whenSetupReady(() => startAgent(id, 'design', text, tSend, by)); }
  return startAgent(id, 'design', text, tSend, by);
}
function startSiteRun(id, text, tSend) { return startAgent(id, 'site', text, tSend); }

/** Exact CLI args for one agent turn (exported in logs so the command is auditable). stream: a warm design process that
 * reads its turns as stream-json on stdin (same tools, rules and prompt; no prompt argument). */
function agentArgs(kind, text, agent, extraPrompt = '', { stream = false, effort = null } = {}) {
  const site = kind === 'site', adsK = kind === 'ads', appK = kind === 'app'; // apps: Read/Write/Edit in ./app/** only (server/apps.js)
  const args = ['-p', ...(stream ? ['--input-format', 'stream-json'] : [text]), '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--permission-mode', 'dontAsk',
    // No settings files at all: the agent can write ./.claude/settings.json, so project settings must never load.
    '--setting-sources', '',
    '--strict-mcp-config',
    '--tools', site ? SITE_TOOLS : adsK ? ADS_TOOLS : appK ? apps.TOOLS : AGENT_TOOLS,
    '--allowedTools', site ? SITE_ALLOWED : adsK ? ADS_ALLOWED : appK ? apps.ALLOWED : AGENT_ALLOWED_ALL,
    '--disallowedTools', appK ? `${AGENT_DENIED},${apps.DENIED}` : AGENT_DENIED,
    ...(!site && !adsK && !appK ? ['--settings', WEBFETCH_HOOK] : []), // C3: only the design agent has WebFetch
    '--append-system-prompt', (site ? sitePrompt : adsK ? adsAgentPrompt : appK ? apps.prompt() : agentPrompt) + extraPrompt];
  if (AGENT_MODEL) args.push('--model', AGENT_MODEL);
  if (effort && brain.EFFORTS.includes(effort)) args.push('--effort', effort); // effortpick: the owner's pick at spawn (per turn: sendTurn)
  args.push(...(agent.started ? ['--resume', agent.sessionId] : ['--session-id', agent.sessionId]));
  return args;
}

/** by (share): a collaborator's { by_h, by } for their chat message; their run may not rename the design. */
function startAgent(id, kind, text, tSend, by = null) {
  const dir = projDir(id);
  const site = kind === 'site', adsK = kind === 'ads';
  const map = runMap(kind);
  if (map.has(id)) return false;
  const P = KIND_P[kind] || '';
  const msgFile = chatFile(dir, kind);
  let extra = '';
  let siteBackup = null, adsBackup = null, appBackup = null, keepTitle = null, memberGuard = null;
  if (kind === 'design') {
    const meta = readJSON(path.join(dir, 'meta.json'), {});
    // Placeholder title from the prompt; the agent replaces it with a real product name on its first run (title_auto).
    if (!meta.title || meta.title === 'Untitled') { meta.title = titleFromPrompt(text); meta.title_auto = true; writeJSON(path.join(dir, 'meta.json'), meta); }
    if (meta.title_auto) autoTitle(id, text); // agentbrain: a real product name from one low-effort call, while the agent works
    if (by && !meta.title_auto) keepTitle = meta.title; // share: renaming is the owner's
    if (by) memberGuard = memberGuardStart(id, dir); // N1
    if (!exists(path.join(dir, 'build.sh'))) writeProjectScaffold(dir);
    try { fs.rmSync(path.join(dir, brain.QUESTIONS_FILE), { force: true }); } catch {} // agentbrain: only this turn's questions count
  }
  // Version history: snapshot the files this agent may change, before it touches them (see versions.js).
  let ver = null;
  try { ver = versions.begin(dir, kind, (readJSON(msgFile, []) || []).length, text); } catch (e) { console.error(`[versions ${id}] snapshot failed: ${e.message}`); }
  if (site) {
    siteBackup = prepareSiteForAgent(dir);
    extra = siteContextPrompt(dir);
  }
  if (adsK) {
    adsBackup = { raw: readText(path.join(dir, 'ads', 'ads.json')) };
    extra = adsContextPrompt(dir);
  }
  if (kind === 'app') { appBackup = apps.prepare(dir); extra = apps.contextPrompt(dir); } // apps: app/ exists; the design, parts and firmware fields as context
  addMessageTo(msgFile, 'user', text, by && kind === 'design' ? by : undefined);
  if (ver) { try { versions.sync(dir, kind); } catch {} }

  // Separate Claude Code sessions: .agent.json (design) and .site_agent.json (website). Both live outside ./site so the site agent can't touch them.
  const agentFile = path.join(dir, site ? '.site_agent.json' : adsK ? '.ads_agent.json' : kind === 'app' ? '.app_agent.json' : '.agent.json');
  // Design: reuse this project's warm process if it is idle and current (same session, same prompt).
  let proc = kind === 'design' ? pool.get(id) : null;
  if (proc && (proc.dead || proc.run || proc.gen !== promptGen)) { if (!proc.run) killProc(proc); proc = null; }
  const agent = proc ? proc.agent : loadAgent(agentFile);
  // After an undo/rewind the session still remembers the undone edits: tell the agent once, at the top of this turn.
  let prompt = ver?.note && agent.started ? `${ver.note}\n\n${text}` : text;
  if (prompt !== text) console.log(`[${kind} run ${id}] prepended rewind note`);
  const tl = { t_send: tSend || Date.now(), kind };
  let effort = null; // null = the CLI default (medium for claude-opus-5-5)
  if (kind === 'design') {
    tl.new_design = isStubDesign(dir);
    tl.small = !tl.new_design && isSmallEdit(dir, text);
    effort = turnEffort(prefs.effortOf(ownerOf(id)), text); // effortpick: the user's pick (allowlisted, default medium), every turn; high with a photo
    tl.effort = effort;
    const ctx = designContext(dir, tl.new_design);
    const pc = brain.prefsContext(prefs.get(ownerOf(id))); // agentbrain: earlier question-card answers, so they aren't asked again
    tl.ctx_chars = ctx.length + pc.length;
    // rewind note (if any) first, then what the user told us before, then the files as they are now (after the restore), then the user's words
    prompt = [prompt === text ? '' : ver.note, pc, ctx].filter(Boolean).join('\n\n') + `\n\n${text}`;
  }

  if (kind === 'design') { ensureBuildSh(dir); warmWorker(id); }
  const run = { kind, P, dir, msgFile, ver, userText: String(text || "").replace(/\n*\[Attached images:[\s\S]*$/, "").slice(0, 1200), siteBackup, adsBackup, appBackup, keepTitle, memberGuard, agent, agentFile, child: null, proc: null, startedAt: Date.now(), texts: [], flow: [], result: null, isError: false, stderr: '', stopped: false,
    buildIds: new Set(), buildStart: new Map(), events: [], denied: 0, partial: '', thinking: '', partialTimer: null, tl, lastWork: Date.now(), lastAny: Date.now() };
  if (kind === 'design') { run.fwSig = firmware.sketchSig(dir); run.fwFix = fwFixTurns.get(id) || 0; fwFixTurns.delete(id); } // firmware: compile afterwards if the sketch changed
  map.set(id, run);
  // Hard cap on one turn's length, so a stuck agent can't run up the bill.
  const capMs = kind === 'app' ? Math.max(RUN_TIMEOUT_MS, 15 * 60e3) : RUN_TIMEOUT_MS; // apps: a first app build writes ~60k tokens (8 min measured)
  run.capMs = capMs;
  run.cap = setTimeout(() => { console.log(`[${kind} run ${id}] hit the ${capMs / 60e3} min cap, stopping`); stopRun(id, kind, 'cap'); }, capMs);
  run.cap.unref?.();
  // agentbrain: no-progress watchdog. Work = a tool call or result, reply text, a streamed tool input or a changed file;
  // thinking alone keeps it alive for twice as long. Stops a hung turn long before the cap.
  run.fileSig = JSON.stringify(sigs(dir));
  run.watchdog = setInterval(() => {
    const s = JSON.stringify(sigs(dir)); if (s !== run.fileSig) { run.fileSig = s; run.lastWork = run.lastAny = Date.now(); }
    const t = Date.now();
    if (run.kind === 'design' && run.capAt && t - run.capAt > 20e3 && !run.capTimer) setCaption(id, run, caption.idle(!!run.built)); // livecaption: a long think
    if (t - run.lastAny > brain.STALL_MS || t - run.lastWork > 2 * brain.STALL_MS) {
      console.log(`[${kind} run ${id}] no progress for ${Math.round((t - run.lastWork) / 1000)}s, stopping`);
      stopRun(id, kind, 'stall');
    }
  }, 15e3);
  run.watchdog.unref?.();
  ensureWatcher(id);
  emit(id, { type: P + 'run_started', t: run.startedAt / 1000 });
  if (tl.new_design) startSketch(id, text, run);
  else if (kind === 'design' && !tl.small && askmock.openEnded(text)) warmAskMocks(); // askmock: this turn may ask with mock-ups

  // The CLI runs on the subscription login (keychain + ~/.claude), confined by its permission rules; the code it can
  // trigger (./build.sh -> design.py) runs in the Seatbelt sandbox. See server/sandbox.js for why it's split that way.
  if (kind === 'design') {
    if (proc) { tl.warm = true; tl.proc_age = Date.now() - proc.spawnedAt; }
    else {
      const room = poolRoom(id, ownerOf(id));
      proc = spawnDesignProc(id, agent);
      if (!room) proc.ephemeral = true; // pool full of busy agents: this one goes away after its turn
      tl.warm = false; tl.spawn = Date.now() - tl.t_send;
    }
    proc.run = run; run.proc = proc; run.child = proc.child; proc.lastUsed = Date.now();
    sendTurn(proc, run, prompt, effort).catch((e) => { run.stderr += String(e); stopRun(id, kind); });
    return true;
  }
  const child = spawn(CLAUDE, agentArgs(kind, prompt, agent, extra), { cwd: dir, env: agentEnv(dir), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  run.child = child; tl.warm = false; tl.spawn = Date.now() - tl.t_send;
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line) handleLine(id, run, agent, agentFile, line);
    }
  });
  child.stderr.on('data', (d) => { run.stderr = (run.stderr + d.toString('utf8')).slice(-4000); });
  child.on('error', (e) => { run.stderr += String(e); });
  child.on('close', (code) => {
    if (buf.trim()) handleLine(id, run, agent, agentFile, buf.trim());
    finishRun(id, run, code);
  });
  return true;
}

/** One agent turn is over (result line, or its process exited): save the reply, history and timeline, tell the clients. */
function finishRun(id, run, code) {
  if (run.finished) return;
  run.finished = true;
  const { kind, P, dir, msgFile, ver, tl } = run;
  const map = runMap(kind);
  clearTimeout(run.cap); clearInterval(run.watchdog);
  if (run.preview) { run.preview.stop('turn ended'); setTimeout(() => { if (!runs.has(id)) try { fs.rmSync(path.join(dir, 'preview'), { recursive: true, force: true }); } catch {} }, 60e3).unref(); } // livepreview: scratch STLs go
  clearTimeout(run.capTimer); // livecaption
  if (run.partialTimer) { clearTimeout(run.partialTimer); run.partialTimer = null; }
  let siteNote = '';
  if (kind === 'site') { try { siteNote = finalizeSite(dir, run.siteBackup); } catch (e) { siteNote = 'Could not check the page: ' + e.message; } }
  if (kind === 'ads') { try { siteNote = finalizeAdsChat(dir, run.adsBackup); } catch (e) { siteNote = 'Could not check the ads: ' + e.message; } }
  if (kind === 'app') { try { siteNote = apps.finalize(dir, run.appBackup); } catch (e) { siteNote = 'Could not check the app: ' + e.message; } } // apps: JSON valid, no planted CLAUDE.md
  if (map.get(id) === run) map.delete(id);
  if (run.memberGuard) memberGuardEnd(id, dir, run.memberGuard); // N1: owner-only files back as they were
  if (run.keepTitle) { // share: a collaborator's run can't rename the owner's design
    const meta = readJSON(path.join(dir, 'meta.json'), {});
    if (meta && meta.title !== run.keepTitle) { meta.title = run.keepTitle; writeJSON(path.join(dir, 'meta.json'), meta); }
  }
  if (kind === 'design') renderThumb(dir);
  if (run.proc && !run.stderr) run.stderr = run.proc.stderr || '';
  const ok = !run.stopped && code === 0 && !run.isError;
  tl.end = Date.now() - tl.t_send; tl.ok = ok;
  const timeline = tlPublic(tl);
  let reply = (run.result || run.texts.join('\n\n')).trim();
  if (run.isError && MODEL_ERR_RE.test(reply) && !MODEL_FIXED && FORMA_MODEL !== 'default') { // model-pick: this login lost the best model
    setModel('default', `${FORMA_MODEL} was refused during a run`);
    reply = "This Claude Code login can't use the best model, so Premake switched to Claude Code's default model. Send your message again.";
  }
  if (siteNote) reply = (reply ? reply + '\n\n' : '') + siteNote;
  // agentbrain: question card (./questions.json, only from a turn that ended normally) and why a run stopped
  const questions = kind === 'design' ? brain.readQuestions(dir) : null;
  const asking = questions && !run.stopped ? questions : null;
  const finished = kind === 'design' && !asking && !run.stopped && !run.isError && run.tl?.new_design && exists(path.join(dir, 'manifest.json')) ? [brain.finishCard({ electronics: apps.info(dir).electronics })] : null; // the "what should I check?" card
  const status = run.stopped ? brain.stopStatus(run, run.capMs || RUN_TIMEOUT_MS) : null;
  if (asking && !reply) reply = 'A few quick questions before I start.';
  const flow = flowForReply(run.flow, reply);
  try { fs.rmSync(path.join(dir, 'references.json'), { force: true }); } catch {} // refs: the photos are saved on the reply
  const extra = { tl: timeline, ...(run.refs?.length ? { refs: run.refs } : {}), ...(asking || finished ? { questions: asking || finished } : {}), ...(status ? { status } : {}), ...(flow ? { flow } : {}) };
  const msgIdx = reply ? addMessageTo(msgFile, 'assistant', reply, extra) : -1;
  if (asking && msgIdx >= 0) { // askmock: the card's message exists now: save the mock-ups that already landed, the rest follow
    const job = startAskMocks(id, dir, asking, run.userText);
    if (job) {
      const msgs = readJSON(msgFile, []), m = msgs[msgIdx];
      job.msgT = m.t;
      if (askmock.attachMocks(m.questions, job.results)) writeJSON(msgFile, msgs);
    }
  }
  let error;
  if (run.stopped) error = 'Stopped';
  else if (!ok) error = (run.isError && run.result) || run.stderr.trim().split('\n').slice(-3).join(' ') || `Agent exited with code ${code}`;
  if (error && !reply) addMessageTo(msgFile, 'assistant', run.stopped ? `${status.text}.` : `Something went wrong: ${error}`, extra);
  // A design turn that was cut off (time cap, stall, late CLI error) after its last build succeeded still left a valid
  // design behind: the version is 'done', not 'failed'. Only a run whose last build failed, or that never built, fails.
  const builtOk = kind === 'design' && versions.builtOk(tl.builds, dir);
  if (ver) { try { versions.finish(dir, ver.n, reply || (run.stopped ? 'Stopped' : error || ''), ok || builtOk); } catch (e) { console.error(`[versions ${id}] after-snapshot failed: ${e.message}`); } }
  try { fs.appendFileSync(path.join(dir, 'runs.jsonl'), JSON.stringify({ t: now(), id, stopped: !!run.stopped, ...(run.stopped ? { stop_reason: run.stopReason || 'user' } : {}), ...(asking ? { asked: asking.length } : {}), denied: run.denied, ...timeline }) + '\n'); } catch {}
  emit(id, ok ? { type: P + 'run_finished', ok: true, timeline, ...(asking || finished ? { questions: asking || finished } : {}) } : { type: P + 'run_finished', ok: false, error, timeline, ...(status ? { status } : {}) });
  if (kind === 'design' && !run.stopped && (ok || builtOk)) firmwareAfterRun(id, dir, run);
  if (kind === 'design') showcase?.soon(); // showcase: a finished design shows up in Examples (or its snapshot refreshes)
  if (kind === 'design' && (ok || builtOk)) { // agentbrain: the start-of-run title call failed, or the agent echoed the prompt as the title ("Design a product based on this")
    const mf = path.join(dir, 'meta.json'), mt = readJSON(mf, null);
    if (mt && !mt.title_auto && brain.isPromptEcho(mt.title)) { mt.title_auto = true; writeJSON(mf, mt); }
    if (mt?.title_auto) autoTitle(id, readJSON(msgFile, []).find((m) => m.role === 'user')?.text || '', reply); // agentbrain: the start-of-run title call failed
  }
  console.log(`[${kind} run ${id}] finished ok=${ok} code=${code} denied=${run.denied} warm=${!!tl.warm} effort=${tl.effort || '-'} first_model=${tl.first_model ?? '-'}ms in ${(tl.end / 1000).toFixed(1)}s`);
  const p = run.proc;
  if (p) {
    if (p.run === run) p.run = null;
    p.lastUsed = Date.now();
    if (p.ephemeral && !p.dead) killProc(p);
    // a stopped or crashed warm agent comes back on its own while the studio is open
    if ((p.dead || p.ephemeral) && (clients.get(id) || new Set()).size) setTimeout(() => { if ((clients.get(id) || new Set()).size) warmAgent(id); }, 1500).unref();
  }
  if (kind === 'design' && workers.has(id)) workers.get(id).lastUsed = Date.now();
}

// firmware: after a design turn that changed the sketch (or a fix turn), compile it (server/firmware.js). A failed compile
// starts a short fix turn with the compiler errors, at most FW_FIX_MAX in a row, like a failed ./build.sh inside a turn.
const FW_FIX_MAX = 2;
const fwFixTurns = new Map(); // project -> fix turns so far in this chain (read and cleared when the next design turn starts)
function firmwareAfterRun(id, dir, run) {
  const sig = firmware.sketchSig(dir);
  if (!sig || (sig === run.fwSig && !run.fwFix)) return;
  firmware.compile(id, dir).then((r) => {
    if (r.ok) { console.log(`[firmware ${id}] compiled for ${r.board}${r.cached ? ' (cached)' : ''}`); return; }
    console.log(`[firmware ${id}] compile failed (${(r.errors || []).length} errors), fix turn ${run.fwFix + 1}/${FW_FIX_MAX}`);
    if (run.fwFix >= FW_FIX_MAX || runs.has(id) || firmware.sketchSig(dir) !== sig) return;
    fwFixTurns.set(id, run.fwFix + 1);
    if (!startRun(id, firmware.fixPrompt(r), Date.now())) fwFixTurns.delete(id);
  }).catch((e) => console.error(`[firmware ${id}] ${e.message}`));
}

function handleLine(id, run, agent, agentFile, line) {
  let j;
  try { j = JSON.parse(line); } catch { return; }
  handleMsg(id, run, agent, agentFile, j);
}

function handleMsg(id, run, agent, agentFile, j) {
  const P = run.P, tl = run.tl;
  run.lastAny = Date.now(); // agentbrain: watchdog (any stream event, thinking included)
  if (j.type === 'assistant' || j.type === 'user' || (j.type === 'stream_event' && j.event?.type === 'content_block_delta' && j.event.delta && j.event.delta.type !== 'thinking_delta')) run.lastWork = run.lastAny;
  const at = () => Date.now() - tl.t_send;
  if (j.type === 'system' && j.subtype === 'init') {
    if (tl.init == null) { tl.init = at(); tl.model = j.model || null; tl.api_key_source = j.apiKeySource || null; }
    console.log(`[${run.kind} run ${id}] auth: apiKeySource=${j.apiKeySource || 'unknown'} (none = subscription login) model=${j.model || '?'}`);
    if (!agent.started) { agent.started = true; if (j.session_id) agent.sessionId = j.session_id; writeJSON(agentFile, agent); }
  } else if (j.type === 'assistant' && j.message && Array.isArray(j.message.content)) {
    for (const c of j.message.content) {
      if (c.type === 'text' && c.text && c.text.trim()) { run.texts.push(c.text.trim()); run.partial = ''; record(id, run, { type: P + 'assistant', text: c.text.trim() }); narrationParts(id, run, c.text); }
      else if (c.type === 'thinking' && c.thinking && c.thinking.trim()) { run.thinking = c.thinking.trim().slice(-2000); livePartial(id, run); }
      else if (c.type === 'tool_use') {
        if (tl.first_tool == null) tl.first_tool = at();
        const ep = editingParts(run, c.name, c.input);
        if (ep?.parts.length) emitEditing(id, run, ep.parts, 'edit');
        record(id, run, { type: P + 'step', text: ep ? editparts.editLabel(ep) : stepText(c.name, c.input), ...(ep?.parts.length ? { parts: ep.parts } : {}) });
        if (run.kind === 'design') setCaption(id, run, caption.forTool(c.name, c.input, ep?.parts)); // livecaption:
        if (run.kind === 'design' && c.name === 'Write' && /(^|\/)references\.json$/.test(String(c.input?.file_path || '')) && !run.refsJob) { // refs: reference photos, fetched now
          let list = []; try { list = refs.clean(JSON.parse(String(c.input.content || ''))); } catch {}
          if (list.length) run.refsJob = refs.fetchAll(run.dir, list).then((cards) => { if (cards.length && !run.finished) { run.refs = cards; record(id, run, { type: P + 'references', refs: cards }); } }).catch(() => {});
        }
        if (run.kind === 'design' && c.name === 'Write' && /(^|\/)questions\.json$/.test(String(c.input?.file_path || ''))) { // askmock: start drawing the options now
          try { const qs = brain.cleanQuestions(JSON.parse(String(c.input.content || ''))); if (qs.length) startAskMocks(id, run.dir, qs, run.userText); } catch {}
        }
        if (c.name === 'Bash' && /build\.sh/.test((c.input || {}).command || '')) { run.buildIds.add(c.id); run.buildStart.set(c.id, at()); run.preview?.stop('build started'); } // livepreview: never alongside the real build
      }
    }
  } else if (j.type === 'user' && j.message && Array.isArray(j.message.content)) {
    for (const c of j.message.content) {
      if (c.type !== 'tool_result') continue;
      if (run.buildIds.has(c.tool_use_id)) {
        const body = typeof c.content === 'string' ? c.content : JSON.stringify(c.content || '');
        const start = run.buildStart.get(c.tool_use_id) ?? at(), end = at();
        (tl.builds ||= []).push({ start, end, ms: end - start, ok: !c.is_error, warm: body.includes('(warm build worker)'), ...(c.is_error ? { err: body.slice(0, 160) } : {}) });
        record(id, run, { type: P + 'step', text: c.is_error ? 'Build failed, fixing' : 'Build finished' });
        setCaption(id, run, caption.forBuild(!c.is_error, body)); // livecaption:
        if (!c.is_error) { // model_updated right away, not on the next poll
          pokeWatcher(id); run.built = true;
          if (run.editingSet) { run.editingSet = null; record(id, run, { type: 'editing_parts', parts: [], source: 'build' }); } // editglow: replays end clean
        }
      }
      else if (c.is_error && /permission|not allowed|denied/i.test(JSON.stringify(c.content || ''))) { run.denied++; record(id, run, { type: P + 'step', text: 'Blocked: outside what this agent may change' }); }
    }
  } else if (j.type === 'stream_event' && j.event) {
    // --include-partial-messages: token deltas. Prose is shown live; the full block still arrives as 'assistant'.
    const e = j.event;
    if (e.type === 'content_block_start') {
      if (e.content_block?.type === 'text') run.partial = '';
      if (e.content_block?.type === 'thinking') run.thinking = '';
      run.toolIn = e.content_block?.type === 'tool_use' && /^(Edit|MultiEdit)$/.test(e.content_block.name) && run.kind === 'design' ? { name: e.content_block.name, json: '', done: false } : null;
      run.toolStream = e.content_block?.type === 'tool_use' && /^(Write|Edit)$/.test(e.content_block.name) && run.kind === 'design' ? { name: e.content_block.name, json: '', scanned: 0, capN: 0 } : null; // livecaption / livepreview
    } else if (e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta' && ((run.toolIn && !run.toolIn.done) || run.toolStream)) {
      if (run.toolStream) toolStreamDelta(id, run, e.delta.partial_json || '');
      if (run.toolIn && !run.toolIn.done) earlyEditing(id, run, e.delta.partial_json || '');
      else if (tl.first_token == null) tl.first_token = at();
    } else if (e.type === 'content_block_stop' && run.toolStream) {
      toolStreamScan(id, run, true); run.toolStream = null;
    } else if (e.type === 'content_block_delta' && e.delta) {
      if (tl.first_token == null) tl.first_token = at();
      if (e.delta.type === 'text_delta' && e.delta.text) { run.partial = (run.partial + e.delta.text).slice(-4000); livePartial(id, run); }
      else if (e.delta.type === 'thinking_delta' && e.delta.thinking) { run.thinking = (run.thinking + e.delta.thinking).slice(-2000); livePartial(id, run); }
    }
  } else if (j.type === 'result') {
    run.result = typeof j.result === 'string' ? j.result : null;
    run.isError = !!j.is_error;
    tl.turns = j.num_turns ?? null; tl.api_ms = j.duration_api_ms ?? null;
    if (j.usage) tl.tokens = { in: j.usage.input_tokens, out: j.usage.output_tokens, cache_read: j.usage.cache_read_input_tokens, cache_write: j.usage.cache_creation_input_tokens };
  }
}

// ---------------------------------------------------------------- editglow: parts the agent is changing, live
/** design.py + manifest.json as they are now (the Edit hasn't run yet when its tool_use arrives). */
function editCtx(run) {
  try { return { src: fs.readFileSync(path.join(run.dir, 'design.py'), 'utf8'), man: readJSON(path.join(run.dir, 'manifest.json'), null) }; } catch { return null; }
}
/** { parts, added } for an Edit / MultiEdit / Write of design.py by the design agent, or null (old step label). */
function editingParts(run, name, input) {
  if (run.kind !== 'design' || !/^(Edit|MultiEdit|Write)$/.test(name) || path.basename(String(input?.file_path || '')) !== 'design.py') return null;
  run.built = false; // a new round of edits: narration counts again
  const ctx = editCtx(run);
  if (!ctx?.man) return null;
  try { return editparts.partsForEdit(name, input, ctx.src, ctx.man); } catch (e) { console.error(`[editglow] ${e.message}`); return null; }
}
/** Tell the studio which parts to shimmer (SSE + the polling log, like steps): everything named since the last build. */
function emitEditing(id, run, parts, source) {
  if (!parts.length) return;
  const all = [...new Set([...(run.editingSet || []), ...parts])];
  if (all.length === (run.editingSet || []).length) return; // nothing new
  run.editingSet = all;
  record(id, run, { type: 'editing_parts', parts: all, verb: 'Editing', source });
}
/** The Edit's input streams in: once old_string is complete (new_string has started), name the parts seconds early. */
function earlyEditing(id, run, chunk) {
  const t = run.toolIn;
  t.json += chunk;
  if (t.json.length > 200000) { t.done = true; return; }
  if (!/"new_string"\s*:/.test(t.json) && !/"edits"[\s\S]*"new_string"\s*:/.test(t.json)) return;
  t.done = true;
  const fp = /"file_path"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(t.json), old = /"old_string"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(t.json);
  if (!fp || !old) return;
  let input;
  try { input = { file_path: JSON.parse(fp[1]), old_string: JSON.parse(old[1]), new_string: '' }; } catch { return; }
  const ep = editingParts(run, 'Edit', input);
  if (ep?.parts.length) emitEditing(id, run, ep.parts, 'edit');
}
/** Second signal: the agent's narration names parts ("Thickening Link 1 and Link 2"). Not after a build (the reply). */
function narrationParts(id, run, text) {
  if (run.kind !== 'design' || run.built) return;
  const man = readJSON(path.join(run.dir, 'manifest.json'), null);
  if (!man) return;
  const parts = editparts.namesInText(text, man);
  if (parts.length) emitEditing(id, run, parts, 'narration');
}

// ---------------------------------------------------------------- livecaption + livepreview
/** livecaption: show `text` under the model (deduped; at most one new caption every 1.4 s, the latest one wins). */
function setCaption(id, run, text) {
  if (!text || run.kind !== 'design' || run.finished) return;
  if (text === run.capLast) { run.capNext = null; return; }
  const wait = run.capAt ? 1400 - (Date.now() - run.capAt) : 0;
  if (wait > 0) {
    run.capNext = text;
    if (!run.capTimer) run.capTimer = setTimeout(() => { run.capTimer = null; const t = run.capNext; run.capNext = null; if (t) setCaption(id, run, t); }, wait);
    return;
  }
  run.capLast = text; run.capAt = Date.now();
  record(id, run, { type: 'caption', text });
}
/** A Write / Edit's input streams in: caption the functions as they're typed; a new design's design.py feeds the preview. */
function toolStreamDelta(id, run, chunk) {
  const t = run.toolStream;
  if (t.skip) return;
  t.json += chunk;
  if (t.json.length > 400000) { t.skip = true; return; }
  if (t.json.length - t.scanned < 160 && !/\\n/.test(chunk)) return; // scan about once per line
  toolStreamScan(id, run, false);
}
function toolStreamScan(id, run, final) {
  const t = run.toolStream;
  if (!t || t.skip) return;
  t.scanned = t.json.length;
  if (t.design == null) {
    const fp = /"file_path"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(t.json);
    if (!fp) { if (t.json.length > 600) t.skip = true; return; }
    try { t.design = path.basename(JSON.parse(fp[1])) === 'design.py'; } catch { t.design = false; }
    if (!t.design) { t.skip = true; return; }
  }
  const code = livepreview.partialString(t.json, t.name === 'Write' ? 'content' : 'new_string');
  if (code == null) return;
  const caps = caption.fromCode(code);
  if (caps.length > t.capN) { t.capN = caps.length; setCaption(id, run, caps[caps.length - 1]); }
  // livepreview: a new design's first turn only (its blockout Write and the full Write after it); one session per Write,
  // stopped when that Write's build starts
  if (!PREVIEW_ON || t.name !== 'Write' || !run.tl.new_design || run.finished) return;
  if (!t.preview) {
    if (run.preview && !run.preview.stopped) run.preview.stop('another Write');
    const ses = t.preview = run.preview = new livepreview.PreviewSession(run.dir, {
      spawnPreview, log: (m) => console.log(`[preview ${id}] ${m}`),
      onPart: (p) => { if (!run.finished && !ses.stopped) { record(id, run, { type: 'part_preview', ...p, url: `/files/projects/${id}/${p.file}` }); if (!run.tl.preview) run.tl.preview = Date.now() - run.tl.t_send; } },
    });
    ses.warm();
  }
  if (final) t.preview.finish(code); else t.preview.feed(code);
}
/** livepreview: cadlib.preview for one project, under exactly the build.sh sandbox, empty env and caps, at low priority. */
function spawnPreview(dir) {
  const home = path.join(dir, AGENT_HOME);
  for (const d of ['tmp', 'cache']) fs.mkdirSync(path.join(home, d), { recursive: true });
  const env = { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', HOME: home, TMPDIR: path.join(home, 'tmp'), XDG_CACHE_HOME: path.join(home, 'cache'),
    MPLCONFIGDIR: path.join(home, 'cache'), FORMA_NO_RENDER: '1', PYTHONPATH: APP, PYTHONDONTWRITEBYTECODE: '1', OBJC_DISABLE_INITIALIZE_FORK_SAFETY: 'YES' };
  const [cmd, args] = sandbox.AVAILABLE ? ['/usr/bin/sandbox-exec', ['-p', buildProfile(dir), VENV_PY, '-m', 'cadlib.preview', dir]] : [VENV_PY, ['-m', 'cadlib.preview', dir]];
  return spawn('/usr/bin/nice', ['-n', '10', '/bin/sh', '-c', `${ULIMITS}; exec "$@"`, 'preview', cmd, ...args], { cwd: dir, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
}

/** The fields of a run timeline that are stored and shown (ms from the user's send). */
function tlPublic(tl) {
  const o = {};
  for (const k of ['t_send', 'kind', 'ok', 'warm', 'effort', 'small', 'new_design', 'spawn', 'proc_age', 'cli_write', 'init', 'first_token', 'first_tool', 'sketch', 'preview',
    'first_model', 'end', 'model', 'api_key_source', 'ctx_chars', 'turns', 'api_ms', 'tokens', 'builds']) if (tl[k] !== undefined) o[k] = tl[k];
  return o;
}

// ---------------------------------------------------------------- warm design agents (pool)
// A claude process per open studio, started with --input-format stream-json and the exact same args, rules, env and
// session as a per-message run would use. It sits idle on stdin (no tokens) until the user sends a message; each message
// is one turn (one `result` line), and the process stays for the next one. Stop / the 10 min cap kill it (it comes back
// on the next warm ping). Idle processes don't count as running agents; turns still go through agentGate.
const pool = new Map(); // project id -> { id, child, agent, agentFile, owner, spawnedAt, lastUsed, run, effort, gen, ctl, dead }
let promptGen = 0; // bumped when design_agent_prompt.md changes; older processes are replaced when idle
function loadAgent(file) {
  const a = readJSON(file, null) || { sessionId: crypto.randomUUID(), started: false };
  if (!exists(file)) writeJSON(file, a);
  return a;
}
function killProc(p) {
  p.dead = true;
  if (pool.get(p.id) === p) pool.delete(p.id);
  try { process.kill(-p.child.pid, 'SIGTERM'); } catch { try { p.child.kill('SIGTERM'); } catch {} }
  setTimeout(() => { try { process.kill(-p.child.pid, 'SIGKILL'); } catch {} }, 3000).unref();
}
/** Make room for one more process for this owner: evicts the least recently used idle ones. False if all are busy. */
function poolRoom(id, owner) {
  const idle = (f) => [...pool.values()].filter((p) => !p.run && p.id !== id && f(p)).sort((a, b) => a.lastUsed - b.lastUsed);
  if ([...pool.values()].filter((p) => p.owner === owner && p.id !== id).length >= POOL_PER_USER) { const v = idle((p) => p.owner === owner)[0]; if (!v) return false; killProc(v); }
  if ([...pool.values()].filter((p) => p.id !== id).length >= POOL_MAX) { const v = idle(() => true)[0]; if (!v) return false; killProc(v); }
  return true;
}
function spawnDesignProc(id, agent) {
  const dir = projDir(id);
  ensureBuildSh(dir);
  const old = pool.get(id); if (old && !old.run) killProc(old);
  const eff = prefs.effortOf(ownerOf(id));
  // livepreview / livecaption: tool input (design.py as the agent types it) streams token by token instead of arriving
  // in one piece when the Write is done. Same model, same tokens: only how the CLI delivers the deltas to us.
  const child = spawn(CLAUDE, agentArgs('design', null, agent, '', { stream: true, effort: eff }), { cwd: dir, env: { ...agentEnv(dir), CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING: '1' }, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const p = { id, child, agent, agentFile: path.join(dir, '.agent.json'), owner: ownerOf(id), spawnedAt: Date.now(), lastUsed: Date.now(), run: null, effort: eff, gen: promptGen,
    ctl: new Map(), ctlN: 0, stderr: '', dead: false };
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line) procLine(p, line);
    }
  });
  child.stderr.on('data', (d) => { p.stderr = (p.stderr + d.toString('utf8')).slice(-4000); });
  child.stdin.on('error', () => {});
  child.on('error', (e) => { p.stderr += String(e); });
  child.on('close', (code) => {
    p.dead = true;
    if (pool.get(id) === p) pool.delete(id);
    for (const r of p.ctl.values()) r(false);
    p.ctl.clear();
    if (p.run) finishRun(id, p.run, code ?? 1);
  });
  pool.set(id, p);
  return p;
}
function procLine(p, line) {
  let j;
  try { j = JSON.parse(line); } catch { return; }
  if (j.type === 'control_response') {
    const r = p.ctl.get(j.response?.request_id);
    if (r) { p.ctl.delete(j.response.request_id); r(j.response.subtype === 'success'); }
    return;
  }
  const run = p.run;
  if (!run) return;
  handleMsg(p.id, run, p.agent, p.agentFile, j);
  if (j.type === 'result') { p.run = null; finishRun(p.id, run, 0); }
}
/** Send a control request (effort, read-state seed) and wait for its answer. */
function control(p, request, ms = 3000) {
  return new Promise((resolve) => {
    if (p.dead) return resolve(false);
    const rid = `f${++p.ctlN}`;
    const timer = setTimeout(() => { p.ctl.delete(rid); resolve(false); }, ms);
    p.ctl.set(rid, (ok) => { clearTimeout(timer); resolve(ok); });
    p.child.stdin.write(JSON.stringify({ type: 'control_request', request_id: rid, request }) + '\n');
  });
}
/** Start one turn on a warm process: set the effort, mark the injected files as read (so Edit works without a Read
 * call), then write the user message. */
async function sendTurn(p, run, prompt, effort) {
  if (p.effort !== effort) {
    if (await control(p, { subtype: 'apply_flag_settings', settings: { effortLevel: effort } })) p.effort = effort;
    else console.log(`[design run ${p.id}] effort ${effort}: control request refused, the turn runs at ${p.effort || 'the default'}`);
  }
  run.tl.effort = p.effort || effort;
  for (const f of ['design.py', 'bom.json']) {
    const abs = path.join(run.dir, f);
    let st; try { st = fs.statSync(abs); } catch { continue; }
    await control(p, { subtype: 'seed_read_state', path: abs, mtime: Math.floor(st.mtimeMs) });
  }
  if (p.dead || run.finished || run.stopped) return;
  run.tl.cli_write = Date.now() - run.tl.t_send;
  p.child.stdin.write(JSON.stringify({ type: 'user', session_id: '', message: { role: 'user', content: prompt }, parent_tool_use_id: null }) + '\n');
}
/** Have a warm design agent ready for this project (studio open, composer focus). Never starts a turn. */
function warmAgent(id) {
  if (runs.has(id)) return 'running';
  const p = pool.get(id);
  if (p && !p.dead && p.gen === promptGen) { p.lastUsed = Date.now(); return 'warm'; }
  if (p) killProc(p);
  if (!poolRoom(id, ownerOf(id))) return 'full';
  spawnDesignProc(id, loadAgent(path.join(projDir(id), '.agent.json')));
  return 'started';
}
setInterval(() => {
  const t = Date.now();
  for (const p of [...pool.values()]) if (!p.run && (t - p.lastUsed > POOL_IDLE_MS || p.gen !== promptGen)) killProc(p);
  for (const [id, w] of [...workers]) if (t - w.lastUsed > WORKER_IDLE_MS && !runs.has(id)) stopWorker(id);
  if (sketchProc && t - sketchProc.spawnedAt > POOL_IDLE_MS) { killSketch(sketchProc); sketchProc = null; }
}, 30e3).unref();

// ---------------------------------------------------------------- context for each design turn (no Read calls needed)
function isStubDesign(dir) { const c = readText(path.join(dir, 'design.py')); return c == null || c.trim() === DESIGN_STUB.trim(); }
const DESIGN_CTX_MAX = 16000;
/** The current design.py, bom summary and last build, prepended to the user's message. */
function designContext(dir, stub) {
  const head = '[Context from the app, not typed by the user: the current files, read just now. Edit them directly without a Read call; re-read only if a tool says the file changed.]';
  // The user watches the 3D view build up: a first build ~100 s in that is already the finished model feels like nothing
  // happened and then it popped in. So the blockout-first rule is repeated here, where the agent plans its first move.
  if (stub) return `${head}\ndesign.py is still the 40 mm placeholder cube: replace it with the real design. bom.json is empty.\nThe user is watching the 3D view: unless you are asking question cards first, plan briefly, then make your FIRST action a Write of a rough blockout design.py (the main bodies as simple boxes/cylinders at real size, no detail) and run ./build.sh, so a model appears within about 30 seconds. Then refine in steps, building after each one, so they see it take shape.\n[End of context]`;
  const code = readText(path.join(dir, 'design.py')) || '';
  let src;
  if (code.length <= DESIGN_CTX_MAX) src = `design.py:\n\`\`\`python\n${code}\n\`\`\``;
  else {
    const lines = code.split('\n');
    const keep = lines.map((l, i) => [i + 1, l]).filter(([, l]) => /^[A-Z_][A-Z0-9_]*\s*=/.test(l) || /^def |^class /.test(l) || /"name"\s*:/.test(l));
    src = `design.py is long (${lines.length} lines), so only its parameters, functions and part names are here (line: text). Read the parts you change before editing them.\n${keep.map(([n, l]) => `${n}: ${l.trim().slice(0, 160)}`).join('\n').slice(0, DESIGN_CTX_MAX)}`;
  }
  const bom = readJSON(path.join(dir, 'bom.json'), {}) || {};
  const parts = (bom.parts || []).map((p) => `- ${p.qty_per_unit} x ${p.name} @ $${p.unit_cost_usd}${p.fabricated ? ' (fabricated stock)' : ''}`).join('\n') || '- none';
  const printed = bom.printed || [];
  const grams = printed.reduce((s, p) => s + (Number(p.grams) || 0), 0), hours = printed.reduce((s, p) => s + (Number(p.print_hours) || 0), 0);
  const man = readJSON(path.join(dir, 'manifest.json'));
  const log = readText(path.join(dir, 'build_log.txt')) || '';
  const failed = /BUILD FAILED/.test(log);
  let build = man?.parts?.length
    ? `Last good build: ${man.parts.length} parts. ${man.parts.map((p) => `${p.name} (${p.process || p.group}) ${(p.bbox || []).map((v) => Math.round(v)).join('x')} mm`).join('; ')}. Overall ${(designDims(dir, man) || []).join(' x ')} mm. Print estimate ${Math.round(grams)} g, ${hours.toFixed(1)} h.`
    : 'No successful build yet.';
  if (failed) build += `\nThe latest build FAILED:\n${log.trim().split('\n').slice(-12).join('\n')}`;
  return `${head}\n${src}\n\nbom.json bought parts (assembly ${bom.assembly_minutes ?? '?'} min, kit_ok ${bom.kit_ok !== false}):\n${parts}\n\n${build}\n[End of context]\n\nThe user's message:`;
}
/** selfcheck: a turn whose message carries an image (uploads.withImages' file list) runs at least at high effort:
 * matching a photo needs the extra thinking. Same warm process: sendTurn switches the level with a control request
 * and the next text-only turn switches back. */
function turnEffort(pick, text) {
  const order = brain.EFFORTS; // low < medium < high < max
  if (!/\[Attached images: \.\/uploads\//.test(String(text || ''))) return pick;
  return order.indexOf(pick) >= order.indexOf('high') ? pick : 'high';
}
/** A clearly small tweak to an existing model: runs at low effort (same model). */
const BIG_WORK = /\b(redesign|from scratch|start over|scratch|completely|entirely|brand new|new (product|design|version)|rebuild|electronics?|firmware|wiring|esp32|arduino|motor|stepper|servo|led|leds|battery|mechanism|hinge|gear|drawer|lid|enclosure|assembly|multiple|several|variants?|explain|why|research|search|compare)\b/i;
function isSmallEdit(dir, text) {
  if (!readJSON(path.join(dir, 'manifest.json'))?.parts?.length) return false;
  const t = String(text).trim();
  if (t.length > 220 || (t.match(/[.!?](\s|$)/g) || []).length > 2 || t.split('\n').length > 3) return false;
  return !BIG_WORK.test(t);
}

// ---------------------------------------------------------------- instant sketch for new designs
// One low-effort claude-opus-5-5 call per NEW design (never for edits), no tools, no session: a JSON blockout of a few
// primitives the viewer shows right away while the real agent works. A single-use process is pre-warmed on the first
// keystroke of a new prompt (it is never reused across prompts or users).
const SKETCH_SYSTEM = `You make instant rough 3D blockouts of product ideas, like a designer's first sketch. Output ONLY one JSON object, no prose, no code fences:
{"title": "<= 6 words", "parts": [3 to 10 items, each {"name": "short", "shape": "box" | "cylinder" | "sphere", "size": [x, y, z] (box only, mm), "r": radius mm (cylinder, sphere), "h": height mm (cylinder), "axis": "x" | "y" | "z" (cylinder axis, default z), "at": [x, y, z] centre in mm, "color": "#rrggbb"}]}
Units mm, Z up, the product sits on Z = 0 (every part's lowest point >= 0), front faces -Y, centred on X = 0, Y = 0, real-world size. Only the overall silhouette and main masses: no detail, no holes, nothing under 8 mm. Muted, realistic colours.
When a photo is attached it shows the product to make: copy its silhouette, proportions, how its main pieces stack and sit, and their colours from the photo (up to 14 parts), and estimate its real size from what it is.`;
const sketchJobs = new Map(); // project id -> { proc, startedAt }
let sketchProc = null; // the pre-warmed, unused sketch process (single use)
function spawnSketch(system = SKETCH_SYSTEM) {
  const cw = path.join(DATA, '.sketcher');
  fs.mkdirSync(cw, { recursive: true });
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', FORMA_MODEL, '--effort', 'low',
    '--setting-sources', '', '--strict-mcp-config', '--tools', '', '--disable-slash-commands', '--no-session-persistence', '--system-prompt', system];
  const child = spawn(CLAUDE, args, { cwd: cw, env: agentEnv(cw), detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const s = { child, spawnedAt: Date.now(), buf: '', err: '', onMsg: null, dead: false };
  child.stderr.on('data', (d) => { s.err = (s.err + d.toString('utf8')).slice(-600); }); // kept for the failure log
  child.stdout.on('data', (d) => {
    s.buf += d.toString('utf8');
    let i;
    while ((i = s.buf.indexOf('\n')) >= 0) {
      const line = s.buf.slice(0, i).trim(); s.buf = s.buf.slice(i + 1);
      let j; try { j = JSON.parse(line); } catch { continue; }
      s.onMsg?.(j);
    }
  });
  child.stdin.on('error', () => {});
  child.on('error', () => {});
  child.on('close', (code, sig) => { s.dead = true; s.onMsg?.({ type: 'closed', code, sig }); if (sketchProc === s) sketchProc = null; });
  return s;
}
function killSketch(s) { s.dead = true; try { process.kill(-s.child.pid, 'SIGKILL'); } catch { try { s.child.kill('SIGKILL'); } catch {} } }
function warmSketch() {
  if (sketchProc && !sketchProc.dead) { sketchProc.spawnedAt = Date.now(); return 'warm'; }
  sketchProc = spawnSketch();
  return 'started';
}
function startSketch(id, text, run, retry = false) {
  if (sketchJobs.has(id)) return;
  const dir = projDir(id);
  let s = !retry && sketchProc && !sketchProc.dead ? sketchProc : null;
  if (!retry) sketchProc = null;
  if (!retry) run.tl.sketch_warm = !!s;
  if (!s) s = spawnSketch();
  const job = { s, startedAt: Date.now() };
  sketchJobs.set(id, job);
  const done = () => { clearTimeout(timer); sketchJobs.delete(id); s.onMsg = null; killSketch(s); };
  // A failed sketch used to vanish without a trace (the viewer just kept the empty placeholder): log every failure,
  // and retry once with a fresh process when it died early and the real model hasn't landed yet.
  const fail = (why) => {
    const secs = ((Date.now() - job.startedAt) / 1000).toFixed(1);
    console.log(`[sketch ${id}] failed after ${secs}s: ${why}${s.err ? ` | stderr: ${JSON.stringify(s.err.trim().slice(-300))}` : ''}${retry ? ' (retry)' : ''}`);
    done();
    if (!retry && run.tl.first_model == null && Date.now() - job.startedAt < 30e3 && !run.stopped && !run.finished) startSketch(id, text, run, true);
  };
  // A stuck process is retried with a fresh one (above) instead of waiting out one long timeout.
  const limit = retry ? 30e3 : 25e3;
  const timer = setTimeout(() => fail(`timed out (${limit / 1000}s)`), limit);
  s.onMsg = (j) => {
    if (j.type === 'closed') return fail(`process exited (code ${j.code}${j.sig ? `, ${j.sig}` : ''}) before a result`);
    if (j.type !== 'result') return;
    const sk = cleanSketch(parseModelJSON(j.result));
    done();
    if (!sk) { console.log(`[sketch ${id}] no usable sketch${j.is_error ? ' (error)' : ''}: ${JSON.stringify(String(j.result || '').slice(0, 160))}`); return; }
    writeJSON(path.join(dir, '.sketch.json'), sk);
    if (run.tl.sketch == null) run.tl.sketch = Date.now() - run.tl.t_send;
    // only useful while the real model hasn't landed yet
    if (run.tl.first_model == null) emit(id, { type: 'sketch', sketch: sk });
    console.log(`[sketch ${id}] ${sk.parts.length} primitives in ${((Date.now() - job.startedAt) / 1000).toFixed(1)}s (warm=${run.tl.sketch_warm}, photos=${job.photos || 0}${job.imgMs != null ? `, photo prep ${job.imgMs}ms` : ''})`);
  };
  // sketchphoto: the user's attached photos go to the sketch too (as images, like the design agent sees them through
  // its Read tool), shrunk to 640 px so they cost few tokens; the text loses the "[Attached images: ...]" file note.
  const idea = String(text).replace(/\n*\[Attached images:[\s\S]*$/, '').trim().slice(0, 1200);
  const t0 = Date.now();
  sketchImages(dir, text).then((imgs) => {
    if (s.dead || sketchJobs.get(id) !== job) return;
    job.photos = imgs.length; job.imgMs = imgs.length ? Date.now() - t0 : null;
    const ask = imgs.length ? `Product idea: ${idea}\n\nThe attached photo${imgs.length > 1 ? 's show' : ' shows'} the product. Return the JSON blockout of it.` : `Product idea: ${idea}\n\nReturn the JSON blockout.`;
    const content = imgs.length ? [...imgs.map((b) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b } })), { type: 'text', text: ask }] : ask;
    s.child.stdin.write(JSON.stringify({ type: 'user', session_id: '', message: { role: 'user', content }, parent_tool_use_id: null }) + '\n');
  });
}
// ---------------------------------------------------------------- askmock: mock-ups for question-card options
// server/askmock.js holds the prompt and helpers. One fast call per option (same CLI shape as the instant sketch, its own
// system prompt), all in parallel, started as soon as the agent's Write of ./questions.json streams in.
const askJobs = new Map(); // project id -> askmock job
let askProcs = 0;          // live mock-up processes (counted as agents)
const askWarm = []; // pre-warmed, unused mock-up processes (single use each)
/** An open-ended turn on an existing design may end in a card with mock-ups: have 3 processes ready (saves ~2 s each). */
function warmAskMocks(n = 3) {
  for (let i = askWarm.filter((s) => !s.dead).length; i < n; i++) askWarm.push(spawnSketch(askmock.MOCK_SYSTEM));
  clearTimeout(warmAskMocks.timer);
  warmAskMocks.timer = setTimeout(() => { for (const s of askWarm.splice(0)) killSketch(s); }, 10 * 60e3);
  warmAskMocks.timer.unref?.();
}
function askMockCall(prompt) {
  return new Promise((resolve) => {
    let s; while ((s = askWarm.shift()) && s.dead);
    if (!s) s = spawnSketch(askmock.MOCK_SYSTEM);
    askProcs++;
    let settled = false;
    const end = (v, why) => { if (settled) return; settled = true; askProcs--; clearTimeout(timer); s.onMsg = null; killSketch(s); if (why) console.log(`[askmock] failed: ${why}${s.err ? ` | stderr: ${JSON.stringify(s.err.trim().slice(-200))}` : ''}`); resolve(v); };
    const timer = setTimeout(() => end(null, 'timed out (30s)'), 30e3);
    s.onMsg = (j) => {
      if (j.type === 'closed') return end(null, `process exited (code ${j.code})`);
      if (j.type !== 'result') return;
      const sk = cleanSketch(parseModelJSON(j.result));
      end(sk, sk ? null : `no usable mock-up: ${JSON.stringify(String(j.result || '').slice(0, 120))}`);
    };
    s.child.stdin.write(JSON.stringify({ type: 'user', session_id: '', message: { role: 'user', content: prompt }, parent_tool_use_id: null }) + '\n');
  });
}
// ---------------------------------------------------------------- sections: the Parts panel by machine section
// server/sections.js holds the prompt and helpers. The design's own part.section wins; otherwise one fast low-effort
// call sorts the part names, cached in <dir>/sections.json (examples: DATA/.sections/<slug>.json, never their folder)
// under a hash of the names. Signed-out visitors only get what is already cached.
const sectionJobs = new Map(); // cache file -> Promise
function sectionsCall(prompt, names) {
  return new Promise((resolve) => {
    const s = spawnSketch(sections.SYSTEM), t0 = Date.now();
    let settled = false;
    const end = (v, why) => { if (settled) return; settled = true; clearTimeout(timer); s.onMsg = null; killSketch(s); if (why) console.log(`[sections] failed: ${why}`); resolve(v); };
    const timer = setTimeout(() => end(null, 'timed out (60s)'), 60e3);
    s.onMsg = (j) => {
      if (j.type === 'closed') return end(null, `process exited (code ${j.code})`);
      if (j.type !== 'result') return;
      const r = sections.parseResult(parseModelJSON(j.result), names);
      end(r && { ...r, ms: Date.now() - t0 }, r ? null : `unusable answer: ${JSON.stringify(String(j.result || '').slice(0, 120))}`);
    };
    s.child.stdin.write(JSON.stringify({ type: 'user', session_id: '', message: { role: 'user', content: prompt }, parent_tool_use_id: null }) + '\n');
  });
}
/** { map: {part name: section}, order, source } or { map: null } (small design, or nothing cached and may not classify). */
async function designSections(dir, cacheFile, mayClassify) {
  const man = readJSON(path.join(dir, 'manifest.json')), names = sections.partNames(man);
  if (names.length < sections.MIN_PARTS) return { map: null };
  const own = sections.fromManifest(man);
  if (own) return { ...own, source: 'design' };
  const key = sections.keyOf(names), hit = readJSON(cacheFile);
  if (sections.cacheFits(hit, key)) return { map: hit.map, order: hit.order, source: 'cache' };
  if (!mayClassify) return { map: null };
  if (!sectionJobs.has(cacheFile)) {
    const meta = readJSON(path.join(dir, 'meta.json'), {});
    const job = sectionsCall(sections.prompt({ title: meta.title || man.title, description: meta.description, names }), names).then((r) => {
      if (r) { ensureDir(cacheFile); writeJSON(cacheFile, { key, map: r.map, order: r.order, ms: r.ms, at: new Date().toISOString() }); console.log(`[sections] ${names.length} parts -> ${r.order.length} sections in ${(r.ms / 1000).toFixed(1)}s`); }
      return r;
    }).finally(() => sectionJobs.delete(cacheFile));
    sectionJobs.set(cacheFile, job);
  }
  const r = await sectionJobs.get(cacheFile);
  return r ? { map: r.map, order: r.order, source: 'ai', ms: r.ms } : { map: null };
}
/** The current model as named boxes (CAD mm), from each part's STL. */
function askModelBoxes(dir) {
  const man = readJSON(path.join(dir, 'manifest.json'));
  return man?.parts?.length ? askmock.modelBoxes(man, (p) => { const f = projFileSync(dir, p.file); return f ? stlBox(f) : null; }) : null;
}
/** Start (once per card) the mock-up calls for the questions that asked for them. */
function startAskMocks(id, dir, questions, request) {
  const old = askJobs.get(id);
  if (old && Date.now() - old.started < 120e3 && askmock.mockTargets(questions).every((t) => old.keys.has(t.key))) return old; // the early start (Write) already covers this card
  if (!askmock.mockTargets(questions).length) return null;
  const job = askmock.createJob(questions, { request, boxes: askModelBoxes(dir) }, {
    run: askMockCall,
    onResult: (key, sk, q, o) => { if (askJobs.get(id) === job) saveAskMock(id, dir, job, key); },
  });
  job.keys = new Set(askmock.mockTargets(questions).map((t) => t.key));
  askJobs.set(id, job);
  console.log(`[askmock ${id}] ${job.pending} mock-up${job.pending === 1 ? '' : 's'} started`);
  job.done.then(() => { console.log(`[askmock ${id}] ${job.results.size}/${job.keys.size} mock-ups in ${job.ms.map((m) => (m / 1000).toFixed(1) + 's').join(', ') || '-'}`); });
  return job;
}
/** A mock-up landed: once the card's message exists, save it there and push it to the studio. */
function saveAskMock(id, dir, job, key) {
  if (job.msgT == null) return; // finishRun saves the ones that landed before the message was written
  const file = path.join(dir, 'messages.json');
  const msgs = readJSON(file, []);
  const m = msgs.find((x) => x.role === 'assistant' && x.t === job.msgT && Array.isArray(x.questions));
  if (!m) return;
  const one = new Map([[key, job.results.get(key)]]);
  if (!askmock.attachMocks(m.questions, one)) return;
  writeJSON(file, msgs);
  const [qid, label] = key.split('\n');
  const q = m.questions.find((x) => x.id === qid), o = q?.options.find((x) => x.label.toLowerCase() === label);
  if (o) emit(id, { type: 'ask_mock', t: job.msgT, qid, label: o.label, mock: o.mock });
}

/** sketchphoto: base64 JPEGs (640 px max) of the images named in the prompt's "[Attached images: ./uploads/...]" note. */
async function sketchImages(dir, text) {
  const m = /\[Attached images: ([^\]]*?) —/.exec(String(text));
  if (!m || !dir) return [];
  const files = m[1].split(',').map((f) => f.trim().replace(/^\.\/uploads\//, '')).filter((f) => /^[\w-][\w.-]*\.(png|jpg|jpeg|webp|gif)$/i.test(f)).slice(0, 4);
  const tmpDir = path.join(DATA, '.sketcher');
  const out = [];
  for (const f of files) {
    const src = projFileSync(dir, 'uploads/' + f);
    if (!src) continue;
    const tmp = path.join(tmpDir, `img-${process.pid}-${crypto.randomBytes(4).toString('hex')}.jpg`);
    try {
      const r = await runProc('/usr/bin/sips', ['-Z', '640', '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', src, '--out', tmp], { env: { PATH: '/usr/bin:/bin' } }, 8e3);
      const buf = r.code === 0 && exists(tmp) ? fs.readFileSync(tmp) : (/\.(jpe?g)$/i.test(f) ? fs.readFileSync(src) : null);
      if (buf && buf.length < 4.5e6) out.push(buf.toString('base64'));
    } catch {} finally { try { fs.rmSync(tmp, { force: true }); } catch {} }
  }
  return out;
}
/** The sketch, while it is newer than the model (a reload mid-run still shows it). */
function liveSketch(dir) {
  const sk = readJSON(path.join(dir, '.sketch.json'));
  if (!sk?.parts?.length) return null;
  const man = readJSON(path.join(dir, 'manifest.json'));
  return !man?.t || sk.t > man.t ? sk : null;
}
function cleanSketch(j) {
  const list = Array.isArray(j?.parts) ? j.parts : Array.isArray(j) ? j : [];
  const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  const vec = (a, lo, hi, d) => { const o = (Array.isArray(a) ? a : []).slice(0, 3).map((v) => num(v, lo, hi, d)); while (o.length < 3) o.push(d); return o; };
  const out = [];
  for (const s of list.slice(0, 16)) {
    if (!s || typeof s !== 'object' || !['box', 'cylinder', 'sphere'].includes(s.shape)) continue;
    const p = { shape: s.shape, at: vec(s.at, -1500, 1500, 0), color: hexOk(s.color) ? s.color.trim().toLowerCase() : '#9aa4b2', name: clip(s.name || '', 40) };
    if (s.shape === 'box') p.size = vec(s.size, 0.5, 2000, 20);
    else { p.r = num(s.r, 0.5, 1000, 10); if (s.shape === 'cylinder') { p.h = num(s.h, 0.5, 2000, 20); p.axis = ['x', 'y', 'z'].includes(s.axis) ? s.axis : 'z'; } }
    out.push(p);
  }
  return out.length ? { t: now(), title: clip(typeof j?.title === 'string' ? j.title : '', 60), parts: out } : null;
}

// ---------------------------------------------------------------- run stats (admin page #/stats)
const STAT_PHASES = [['spawn', 'Process start (cold runs)'], ['init', 'CLI init'], ['first_token', 'First token'], ['first_tool', 'First tool use'],
  ['sketch', 'Sketch shown'], ['build1_start', 'First build start'], ['build_ms', 'Build duration (each)'], ['first_model', 'First model'], ['end', 'Done']];
function runStats(n, kind) {
  const all = [];
  for (const id of fs.existsSync(PROJECTS) ? fs.readdirSync(PROJECTS) : []) {
    const dir = projDir(id);
    const raw = dir && readText(path.join(dir, 'runs.jsonl'));
    if (!raw) continue;
    for (const l of raw.split('\n')) { if (!l) continue; try { const r = JSON.parse(l); if (!kind || r.kind === kind) all.push(r); } catch {} }
  }
  all.sort((a, b) => b.t - a.t);
  const list = all.slice(0, n);
  const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
  const val = (r, k) => k === 'build1_start' ? r.builds?.[0]?.start : r[k];
  const phases = STAT_PHASES.map(([key, label]) => {
    const v = key === 'build_ms' ? list.flatMap((r) => (r.builds || []).map((b) => b.ms)) : list.map((r) => val(r, key)).filter((x) => Number.isFinite(x));
    return { key, label, n: v.length, p50: pct(v, 50), p90: pct(v, 90) };
  });
  return { n: list.length, total: all.length, phases, runs: list.map((r) => ({ ...r, title: readJSON(path.join(projDir(r.id) || '/nonexistent', 'meta.json'), {})?.title || r.id })),
    pool: [...pool.values()].map((p) => ({ id: p.id, busy: !!p.run, age_s: Math.round((Date.now() - p.spawnedAt) / 1000), idle_s: Math.round((Date.now() - p.lastUsed) / 1000), effort: p.effort || 'default' })),
    workers: [...workers].map(([id, w]) => ({ id, age_s: Math.round((Date.now() - w.startedAt) / 1000), idle_s: Math.round((Date.now() - w.lastUsed) / 1000) })),
    limits: { pool_max: POOL_MAX, pool_per_user: POOL_PER_USER, pool_idle_min: POOL_IDLE_MS / 60e3, workers_max: WORKERS_MAX } };
}

// ---------------------------------------------------------------- undo / rewind / redo (version history, see versions.js)
function chatFile(dir, kind) { return kind === 'site' ? path.join(dir, 'site', 'messages.json') : kind === 'ads' ? path.join(dir, 'ads', 'messages.json') : kind === 'app' ? path.join(dir, '.app_messages.json') : path.join(dir, 'messages.json'); } // apps: outside app/, so the app agent can't edit its own chat
function historyPayload(dir, kind) {
  try { return versions.history(dir, kind); } catch { return { head: 0, current_v: 0, can_undo: false, can_redo: false, versions: [] }; }
}
/** action: rewind {to_message_index} | undo | redo | restore {n}. Refused (409) while that chat's agent is running. */
function historyAction(id, dir, action, body) {
  const kind = body.kind === 'site' ? 'site' : body.kind === 'ads' ? 'ads' : body.kind === 'app' ? 'app' : 'design';
  if (runMap(kind).has(id)) throw Object.assign(new Error(kind === 'site' ? 'The page editor is working. Wait for it to finish or press Stop.' : kind === 'ads' ? 'The ads agent is working. Wait for it to finish or press Stop.' : kind === 'app' ? 'The app agent is working. Wait for it to finish or press Stop.' : 'The agent is working. Wait for it to finish or press Stop.'), { code: 409 });
  let r;
  if (action === 'rewind') {
    const i = Number(body.to_message_index);
    if (!Number.isInteger(i) || i < 0) throw Object.assign(new Error('to_message_index required'), { code: 400 });
    r = versions.rewindTo(dir, kind, i);
  } else if (action === 'undo') r = versions.undo(dir, kind);
  else if (action === 'redo') r = versions.redo(dir, kind);
  else if (action === 'restore') {
    const n = Number(body.n);
    if (!Number.isInteger(n) || n < 0) throw Object.assign(new Error('n required'), { code: 400 });
    r = versions.restoreTo(dir, kind, n);
  }
  if (kind === 'design') runBuild(id); // STLs + manifest + bom "printed" are rebuilt; the viewer updates on model_updated
  else ensureWatcher(id); // site_updated / ads_updated fire from the watcher
  emit(id, { type: 'history_changed', kind });
  console.log(`[history ${id}] ${kind} ${action} -> ${r.label}`);
  return { ok: true, kind, label: r.label, history: historyPayload(dir, kind), messages: readJSON(chatFile(dir, kind), []) };
}

function stopRun(id, kind = 'design', reason = 'user') {
  const run = runMap(kind).get(id);
  if (!run) return false;
  if (!run.stopped) run.stopReason = reason; // agentbrain: user | cap | stall (shown in the chat with a Continue button)
  run.stopped = true;
  try { process.kill(-run.child.pid, 'SIGTERM'); } catch { try { run.child.kill('SIGTERM'); } catch {} }
  setTimeout(() => { try { process.kill(-run.child.pid, 'SIGKILL'); } catch {} }, 3000).unref();
  return true;
}

// ---------------------------------------------------------------- support chat (a human, no agent)
function markSupportRead(dir, who) {
  const f = path.join(dir, 'support', 'state.json');
  if (!exists(path.join(dir, 'support', 'messages.json'))) return;
  const st = readJSON(f, {}) || {};
  st[who + '_read'] = now();
  writeJSON(f, st);
}
function addSupportMessage(id, dir, acc, body) {
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 4000) : '';
  if (!text) throw Object.assign(new Error('text required'), { code: 400 });
  const from = isAdmin(acc) && body.as !== 'user' ? 'josh' : 'user';
  const ctx = body.context && typeof body.context === 'object' ? body.context : {};
  const msg = { from, email: acc.user || (from === 'josh' ? 'josh' : ''), text, t: now(),
    context: { tab: ['model', 'code', 'site', 'ads'].includes(ctx.tab) ? ctx.tab : 'model', version: Number.isFinite(Number(ctx.version)) ? Number(ctx.version) : null } };
  const file = ensureDir(path.join(dir, 'support', 'messages.json'));
  const list = readJSON(file, []);
  if (list.length >= 2000) throw Object.assign(new Error('This thread is full'), { code: 400 });
  list.push(msg);
  writeJSON(file, list);
  markSupportRead(dir, from);
  emit(id, { type: 'support_message', from, t: msg.t });
  admin.onSupport(id, msg); // admin: live support pane (SSE + poll)
  if (from === 'user') notifyAdmin(readJSON(path.join(dir, 'meta.json'), {}).title || id, text);
  return msg;
}
/** macOS notification for the admin (FORMA_NOTIFY=1). Title and text go in as argv, never into the script. */
function notifyAdmin(title, text) {
  if (!NOTIFY || process.platform !== 'darwin') return;
  try {
    const child = spawn('/usr/bin/osascript', ['-e', 'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run',
      `Premake help: ${String(title).slice(0, 60)}`, String(text).slice(0, 200)], { stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {}
}
function supportInbox() {
  const out = [];
  let ids = [];
  try { ids = fs.readdirSync(PROJECTS); } catch {}
  for (const id of ids) {
    const dir = projDir(id);
    if (!dir) continue;
    const list = readJSON(path.join(dir, 'support', 'messages.json'), null);
    if (!Array.isArray(list) || !list.length) continue;
    const st = readJSON(path.join(dir, 'support', 'state.json'), {}) || {};
    const unread = list.filter((x) => x.from === 'user' && x.t > (st.josh_read || 0)).length;
    const last = list[list.length - 1];
    out.push({ id, title: readJSON(path.join(dir, 'meta.json'), {}).title || 'Untitled', unread, count: list.length,
      email: (list.find((x) => x.from === 'user' && x.email) || {}).email || '', last: { from: last.from, text: String(last.text).slice(0, 140), t: last.t } });
  }
  return out.sort((a, b) => b.last.t - a.last.t);
}

// ---------------------------------------------------------------- orders
function placeOrder(body) {
  const src = body.source || {};
  let dir;
  let source;
  if (src.project) { dir = projDir(src.project); source = { project: src.project }; }
  else if (src.example) { dir = exDir(src.example); source = { example: src.example }; }
  if (!dir || !exists(dir)) throw Object.assign(new Error('source not found'), { code: 404 });
  const qty = Math.floor(Number(body.qty));
  if (!(qty >= 1 && qty <= 100000)) throw Object.assign(new Error('qty must be 1 to 100000'), { code: 400 });
  const mode = body.mode === 'kit' ? 'kit' : 'assembled';
  const st = body.ship_to || {};
  const ship_to = {};
  for (const k of ['name', 'line1', 'city', 'state', 'zip']) ship_to[k] = String(st[k] || '').slice(0, 200);
  const bom = readJSON(path.join(dir, 'bom.json'), {});
  if (mode === 'assembled' && !prices.sellAssembled()) throw Object.assign(new Error('Only kits are sold right now.'), { code: 400 });
  if (mode === 'kit' && bom.kit_ok === false) throw Object.assign(new Error(prices.NOT_ORDERABLE), { code: 400 });
  const p = priceFor(bom, qty, mode, dir);
  const order = {
    id: 'ord_' + newId(), status: 'demo_received', created: new Date().toISOString(),
    source, qty, mode, ship_to, unit_price: p.unit_price, shipping: p.shipping, total: p.total,
    eta_days: p.lead_time_days + TRANSIT_DAYS, note: 'Demo, no payment taken',
  };
  fs.mkdirSync(DATA, { recursive: true });
  const all = readJSON(ORDERS, []);
  all.push(order);
  writeJSON(ORDERS, all);
  return { id: order.id, status: order.status, total: order.total, eta_days: order.eta_days };
}

// ---------------------------------------------------------------- ads
// Static Meta ads: 4 transparent hero renders (Python/VTK) + 6 copy concepts from a
// headless, tool-less Claude Code call. Both run in parallel; result saved to <dir>/ads/ads.json.
let ADS_MODEL = process.env.ADS_MODEL || FORMA_MODEL; // the copywriter
const ADS_RENDER_TIMEOUT = 90e3;
const ADS_COPY_TIMEOUT = 240e3;
const META_CTAS = ['Pre-order', 'Learn more', 'Shop now', 'Sign up', 'Get offer'];
const AD_LAYOUTS = ['hero', 'split', 'badge', 'minimal'];
const AD_ANGLES = ['Problem / solution', 'Benefit', 'Price anchor', 'Made to order', 'Founder story', 'Curiosity'];
const BANNED = /\b(best[- ]?selling|bestseller|#1|number one|top[- ]rated|award[- ]winning|\d(\.\d)?\s*stars?|★|reviews?|rated|testimonial|customers? (love|say)|thousands of|clinically|guaranteed results)\b/i;
const adsJobs = new Map(); // "kind:id" -> { stage, startedAt }

/** About 2x the 10-unit unit price, ending in .99 (under $100) or .00 (rounded to $5 above). */
function retailPrice(bom) {
  const p10 = priceFor(bom || {}, 10, 'assembled').unit_price;
  const x = Math.max(9, p10 * 2);
  return x < 100 ? Math.round(x) - 0.01 : Math.round(x / 5) * 5;
}

function adsSource(body) {
  if (body.project) { const d = projDir(body.project); return d && exists(path.join(d, 'meta.json')) ? { kind: 'projects', id: body.project, dir: d, project: true } : null; }
  if (body.example) { const d = exDir(body.example); return d && exists(path.join(d, 'meta.json')) ? { kind: 'examples', id: body.example, dir: d } : null; }
  return null;
}

/** adsSource for a change: your own project (or any, for admins). Examples are read-only except for admins. */
function writableSource(acc, body) {
  const src = adsSource(body || {});
  if (!src) return null;
  if (src.project ? !canEdit(acc, src.id) : !isAdmin(acc)) return null;
  return src;
}

/** Spawn with a hard timeout. Resolves {code, stdout, stderr, timedOut}. */
function runProc(cmd, args, opts, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
    const kill = (sig) => { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch {} } };
    const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 2000).unref(); }, timeoutMs);
    child.on('error', (e) => { stderr += String(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  });
}

function renderHeroes(dir) {
  const [cmd, args, opts] = renderSpawn('cadlib.render_hero', [dir], { dir });
  return runProc(cmd, args, opts, ADS_RENDER_TIMEOUT).then((r) => {
    if (r.timedOut) throw new Error('Rendering timed out');
    const line = r.stdout.trim().split('\n').pop();
    let j; try { j = JSON.parse(line); } catch {}
    if (r.code !== 0 || !j) throw new Error('Render failed: ' + (r.stderr.trim().split('\n').pop() || `exit ${r.code}`));
    return j;
  });
}

function adsPrompt(meta, bom, q, price, shipWeeks) {
  const parts = (bom.parts || []).map((p) => `- ${p.qty_per_unit} x ${p.name}`).join('\n') || '- none (fully printed)';
  const printed = (bom.printed || []).map((p) => p.name).join(', ') || 'none yet';
  return `Write static Meta (Facebook/Instagram) ad copy for a physical product that has been designed but NOT manufactured yet. The ads run a demand test: people pre-order or join a waitlist.

Product: ${meta.title || 'Untitled'}
Description: ${meta.description || '(none)'}
Tags: ${(meta.tags || []).join(', ') || '(none)'}
3D-printed parts (PETG): ${printed}
Bought hardware inside:
${parts}
Made to order in the USA, assembled by hand. Estimated ship time: about ${shipWeeks} weeks after ordering.
Suggested retail price: $${price.toFixed(2)} (10-unit cost-based price is $${q.tiers[1].unit_price.toFixed(2)}).

Rules (strict):
- Honest framing only: use pre-order, waitlist, "launching soon", or "reserve yours". Never imply it is in stock or already shipping.
- NO reviews, star ratings, testimonials, customer counts, "best-selling", "#1", awards, or invented stats/percentages. No competitor or brand names (hardware brand names from the parts list are also out). No medical or guaranteed-results claims.
- Don't invent features that are not in the description or parts list.
- Plain, specific, sentence case. No emojis. No hashtags.

Return ONLY a JSON object, no prose, no code fences:
{"ads":[ 6 items, each:
 {"angle": one of ${JSON.stringify(AD_ANGLES)} (use each exactly once),
  "headline": "<= 40 chars",
  "primary_text": "<= 125 chars, the text above the image",
  "description": "<= 30 chars, under the headline",
  "cta": one of ${JSON.stringify(META_CTAS)} (prefer Pre-order / Sign up / Learn more),
  "palette": {"bg": "#rrggbb", "accent": "#rrggbb", "text": "#rrggbb"} (bg must contrast with text at 4.5:1 or better; vary palettes across the 6 ads; keep them tasteful),
  "layout": one of ${JSON.stringify(AD_LAYOUTS)} (use each at least once),
  "overlay_text": "<= 6 words, big type on the image"}
 ],
 "site": {"tagline": "<= 70 chars, one line under the product name",
  "intro": "<= 220 chars, what it is and who it is for",
  "benefits": [4 items {"title": "<= 40 chars", "body": "<= 160 chars"}],
  "made": "<= 280 chars, how it's made: made to order, 3D printed in PETG, assembled by hand with the listed hardware",
  "faq": [4 or 5 items {"q": "<= 80 chars", "a": "<= 260 chars"}] (cover: when it ships, is this a pre-order, what it's made of, adjustability/size/care as relevant; answer honestly, say joining the pre-order list is free and nothing is charged until the person confirms an order),
  "cta": "Pre-order" or "Join the waitlist"}
}
The "site" object is copy for a single-product landing page for this product (not about any platform). Same honesty rules.`;
}

function hexOk(s) { return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.trim()); }
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); }
function clip(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const sent = s.slice(0, n).match(/^.*[.!?](?=\s|$)/);
  if (sent && sent[0].length >= n * 0.55) return sent[0];
  const cut = s.slice(0, n - 1);
  return (cut.slice(0, cut.lastIndexOf(' ') > n * 0.6 ? cut.lastIndexOf(' ') : cut.length).replace(/[\s,;:.-]+$/, '')) + '…';
}
function clipWords(s, n) { const w = String(s || '').replace(/\s+/g, ' ').trim().split(' '); return w.slice(0, n).join(' ').replace(/[,;:]+$/, ''); }

const FALLBACK_PALETTES = [
  { bg: '#f1ece3', accent: '#e8590c', text: '#1b1a17' }, { bg: '#14161a', accent: '#ff9a4d', text: '#f4f4f5' },
  { bg: '#dfe8f1', accent: '#1f5fbf', text: '#0f1b2d' }, { bg: '#1f3a2e', accent: '#c9f27b', text: '#f3f6ef' },
  { bg: '#f6e7d8', accent: '#b4361a', text: '#2a1710' }, { bg: '#ffffff', accent: '#111111', text: '#111111' },
];

/** Pull a JSON object out of model text (code fences, stray prose, trailing commas). */
function parseModelJSON(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(raw); } catch {}
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(raw.slice(a, b + 1).replace(/,\s*([}\]])/g, '$1')); } catch {} }
  return null;
}

/** Coerce the model's ads into spec. */
function repairAds(j, meta, max = 6) {
  const list = Array.isArray(j) ? j : Array.isArray(j?.ads) ? j.ads : [];
  if (!list.length) throw new Error('The copywriter did not return valid JSON');
  const title = meta.title || 'This design';
  const out = list.slice(0, max).map((a, i) => {
    a = a && typeof a === 'object' ? a : {};
    const pal = a.palette && typeof a.palette === 'object' ? a.palette : {};
    let palette = { bg: hexOk(pal.bg) ? pal.bg.trim().toLowerCase() : null, accent: hexOk(pal.accent) ? pal.accent.trim().toLowerCase() : null, text: hexOk(pal.text) ? pal.text.trim().toLowerCase() : null };
    if (!palette.bg || !palette.accent || !palette.text) palette = { ...FALLBACK_PALETTES[i % 6], ...Object.fromEntries(Object.entries(palette).filter(([, v]) => v)) };
    if (contrast(palette.bg, palette.text) < 4.5) palette.text = lum(palette.bg) > 0.35 ? '#111111' : '#ffffff';
    const scrub = (s) => (BANNED.test(s) ? '' : s);
    const ad = {
      id: `ad${i + 1}`,
      angle: clip(a.angle || AD_ANGLES[i % AD_ANGLES.length], 40),
      headline: clip(scrub(a.headline) || title, 40),
      primary_text: clip(scrub(a.primary_text) || `${title}. Designed, not yet made. Pre-order now and we build yours to order.`, 125),
      description: clip(scrub(a.description) || 'Pre-order, ships made to order', 30),
      cta: META_CTAS.find((c) => c.toLowerCase() === String(a.cta || '').trim().toLowerCase()) || 'Pre-order',
      palette,
      layout: AD_LAYOUTS.includes(a.layout) ? a.layout : AD_LAYOUTS[i % AD_LAYOUTS.length],
      overlay_text: clipWords(scrub(a.overlay_text) || 'Pre-orders open', 6),
      render: ['hero', 'low', 'front', 'detail'].includes(a.render) ? a.render : ['hero', 'low', 'hero', 'detail', 'low', 'hero'][i % 6],
    };
    return ad;
  });
  return out;
}

/** Honest pre-order ship estimate: a 100-unit batch build + transit, plus a week of buffer. */
function shipWeeksFor(q) { return Math.max(2, Math.ceil((q.tiers[2].lead_time_days + TRANSIT_DAYS) / 7) + 1); }

function ensureDir(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); return file; }

/** Template copy for the product page, built from meta + bom (used before / without generation). */
function siteTemplate(meta, bom) {
  const title = meta.title || 'This design';
  const desc = String(meta.description || '').trim();
  const first = (desc.match(/^.*?[.!?](\s|$)/) || [desc])[0].trim();
  const hw = (bom.parts || []).length;
  return {
    tagline: first && first.length <= 70 ? first : `${title}, made to order by hand.`.slice(0, 70),
    intro: clip(desc || `${title}, designed by ${shareMod.publicCreator(meta.creator) || 'an independent maker'} and built to order.`, 220),
    benefits: [
      { title: 'Made to order', body: 'Each one is printed and assembled after you order it, so nothing sits in a warehouse.' },
      { title: hw ? 'Real hardware inside' : 'Fully printed', body: hw ? `${hw} kinds of off-the-shelf hardware, the kind you can replace from any hardware store.` : 'Every part is printed, so there is nothing to wear out or go missing.' },
      { title: 'Tough PETG body', body: 'Printed in PETG, a strong, slightly flexible plastic that handles daily use.' },
      { title: 'Designed by its maker', body: `Designed by ${shareMod.publicCreator(meta.creator) || 'an independent maker'}. Every detail is open to feedback before production starts.` },
    ],
    made: 'Nothing is made until you order. Each unit is 3D printed in PETG, then assembled by hand with standard hardware, checked, and shipped.',
    faq: [
      { q: 'Is this in stock?', a: 'Not yet. This is a pre-order: we build each unit after it is ordered. Joining the pre-order list is free.' },
      { q: 'When will it ship?', a: 'Shipping estimates are shown above. If anything changes we will tell you before we build yours.' },
      { q: 'What is it made of?', a: 'PETG plastic printed parts plus the standard hardware listed under what is in the box.' },
      { q: 'Can I change my mind?', a: 'Yes. Joining the pre-order list takes no payment, so you can leave it any time.' },
    ],
    cta: 'Pre-order',
  };
}

/** Coerce model site copy into spec, filling gaps from the template. */
function repairSite(x, meta, bom) {
  const t = siteTemplate(meta, bom);
  x = x && typeof x === 'object' ? x : {};
  const ok = (v, n, d) => { const c = clip(typeof v === 'string' && !BANNED.test(v) ? v : '', n); return c || d; };
  const benefits = (Array.isArray(x.benefits) ? x.benefits : []).slice(0, 4).map((b, i) => ({ title: ok(b?.title, 40, t.benefits[i].title), body: ok(b?.body, 160, t.benefits[i].body) }));
  while (benefits.length < 3) benefits.push(t.benefits[benefits.length]);
  const faq = (Array.isArray(x.faq) ? x.faq : []).slice(0, 8).map((f) => ({ q: ok(f?.q, 80, ''), a: ok(f?.a, 260, '') })).filter((f) => f.q && f.a);
  const out = {
    tagline: ok(x.tagline, 70, t.tagline), intro: ok(x.intro, 220, t.intro), benefits,
    made: ok(x.made, 420, t.made), faq: faq.length >= 2 ? faq : t.faq,
    cta: cleanCta(x.cta),
  };
  const headline = ok(x.headline, 70, '');
  if (headline) out.headline = headline;
  return out;
}

// No wording that implies money changes hands now or that it is in stock.
const PAY_WORDS = /\b(buy|pay|payment|checkout|check out|purchase|cart|in stock|order now|ships? (today|now)|instant)\b/i;
function cleanCta(v) {
  const s = String(v || '').replace(/\s+/g, ' ').trim();
  if (/waitlist/i.test(s)) return 'Join the waitlist';
  if (!s || /^pre-?order$/i.test(s)) return 'Pre-order';
  if (s.length > 28 || BANNED.test(s) || PAY_WORDS.test(s)) return 'Pre-order';
  return s;
}

// Typed page sections, rendered in order by web/store.js. Documented in site_agent_prompt.md.
const SECTION_TYPES = ['hero', 'intro', 'benefits', 'gallery', 'specs', 'in-the-box', 'how-its-made', 'comparison', 'faq', 'custom-text', 'cta'];
const SECTION_STYLES = ['plain', 'dark', 'accent'];
const DEFAULT_SECTIONS = ['hero', 'intro', 'benefits', 'gallery', 'specs', 'in-the-box', 'how-its-made', 'faq', 'cta'].map((type) => ({ type }));
function cleanSections(list) {
  if (!Array.isArray(list)) return null;
  const str = (v, n) => { const c = clip(typeof v === 'string' || typeof v === 'number' ? String(v) : '', n); return BANNED.test(c) || PAY_WORDS.test(c) ? '' : c; };
  const body = (v, n) => { // keeps paragraph breaks
    const paras = String(typeof v === 'string' ? v : '').split(/\n{2,}/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p && !BANNED.test(p) && !PAY_WORDS.test(p));
    let total = 0; const keep = [];
    for (const p of paras) { if (total + p.length > n) break; keep.push(p); total += p.length; }
    return keep.join('\n\n');
  };
  const out = [];
  for (const x of list.slice(0, 24)) {
    if (!x || typeof x !== 'object') continue;
    const type = String(x.type || '').toLowerCase().trim().replace(/[\s_]+/g, '-');
    if (!SECTION_TYPES.includes(type)) continue;
    const sec = { type };
    const title = str(x.title, 80); if (title) sec.title = title;
    const sub = str(x.subtitle, 240); if (sub) sec.subtitle = sub;
    if (SECTION_STYLES.includes(x.style)) sec.style = x.style;
    if (type === 'comparison') {
      const columns = (Array.isArray(x.columns) ? x.columns : []).slice(0, 4).map((c) => str(c, 40));
      if (columns.length < 2) continue;
      const rows = (Array.isArray(x.rows) ? x.rows : []).slice(0, 14).filter(Array.isArray)
        .map((r) => columns.map((_, i) => str(r[i], 140))).filter((r) => r[0] && r.slice(1).some(Boolean));
      if (!rows.length) continue;
      sec.columns = columns; sec.rows = rows;
      if (!sec.title) sec.title = 'Compare';
    }
    if (type === 'custom-text') {
      const b = body(x.body, 1400); if (b) sec.body = b;
      if (!sec.body && !sec.title) continue;
    }
    out.push(sec);
  }
  return out.length ? out : null;
}

function cleanPalette(p) {
  if (!p || typeof p !== 'object') return null;
  const o = {};
  for (const k of ['paper', 'ink', 'accent', 'night']) if (hexOk(p[k])) o[k] = p[k].trim().toLowerCase();
  if (!Object.keys(o).length) return null;
  if (o.paper && o.ink && contrast(o.paper, o.ink) < 4.5) o.ink = lum(o.paper) > 0.35 ? '#141414' : '#f5f5f4';
  if (o.paper && !o.ink && lum(o.paper) < 0.2) o.ink = '#f5f5f4';
  return o;
}

/** Strip anything that can load or run outside code from the agent's theme.css, then scope every rule under .product-page. */
function sanitizeCss(css) {
  css = String(css || '').slice(0, 40000)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<\/?\s*style/gi, '')
    .replace(/\\/g, '') // no CSS escapes (used to smuggle "url(" / "expression(")
    .replace(/@import[^;{}]*;?/gi, '')
    .replace(/@(charset|namespace)[^;{}]*;?/gi, '')
    .replace(/url\s*\(([^)]*)\)/gi, (m, u) => {
      u = u.trim().replace(/^['"]|['"]$/g, '');
      return /^\/files\/projects\/[A-Za-z0-9_-]+\/[\w./-]+$/.test(u) && !u.includes('..') ? `url("${u}")` : 'none';
    })
    .replace(/expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|image-set\s*\(|src\s*\(/gi, 'x-blocked(');
  // sentence case only: no all-caps / small-caps labels (they read as "eyebrow" text)
  css = css.replace(/text-transform\s*:\s*(uppercase|capitalize)/gi, 'text-transform: none').replace(/font-variant(-caps)?\s*:\s*[\w\s-]*caps/gi, 'font-variant: normal');
  return scopeCss(css, '.product-page');
}
function scopeCss(css, root) {
  let out = '', i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const semi = css.indexOf(';', i);
    if (semi >= 0 && semi < open) { i = semi + 1; continue; } // stray statement: drop
    const prelude = css.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    const block = css.slice(open + 1, j - 1);
    i = j;
    if (prelude.startsWith('@')) {
      const name = (prelude.match(/^@([\w-]+)/) || [])[1]?.toLowerCase();
      if (['media', 'supports', 'container'].includes(name)) out += `${prelude}{${scopeCss(block, root)}}\n`;
      else if (name === 'keyframes' || name === '-webkit-keyframes') out += `${prelude}{${block}}\n`;
      continue; // @font-face, @page, @layer ... dropped
    }
    if (!prelude || block.includes('{')) continue;
    const sel = prelude.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      s = s.replace(/^(:root|html|body)(?![\w-])/, root).trim();
      return s === root || s.startsWith(root + ' ') || s.startsWith(root + '.') || s.startsWith(root + ':') || s.startsWith(root + '[') || s.startsWith(root + '>') ? s : `${root} ${s}`;
    }).join(', ');
    if (sel) out += `${sel}{${block.trim()}}\n`;
  }
  return out;
}

/** Before a website-agent turn: make sure site/site.json holds the full current page so the agent edits real content. Returns a backup. */
function prepareSiteForAgent(dir) {
  const file = ensureDir(path.join(dir, 'site', 'site.json'));
  const raw = readText(file);
  const prev = readJSON(file, {}) || {};
  const meta = readJSON(path.join(dir, 'meta.json'), {});
  const bom = readJSON(path.join(dir, 'bom.json'), {});
  const next = { ...prev };
  next.copy = prev.copy ? repairSite(prev.copy, meta, bom) : siteTemplate(meta, bom);
  if (!cleanSections(prev.sections)) next.sections = DEFAULT_SECTIONS.map((s) => ({ ...s }));
  if (!next.source) next.source = 'template';
  writeJSON(file, next);
  return { raw, prev, theme: readText(path.join(dir, 'site', 'theme.css')) };
}

function siteContextPrompt(dir) {
  const bom = readJSON(path.join(dir, 'bom.json'), {});
  const saved = readJSON(path.join(dir, 'site', 'site.json'), {});
  const q = quote(bom, 'assembled', dir);
  const ads = readJSON(path.join(dir, 'ads', 'ads.json'));
  const renders = (ads?.renders || []).filter((r) => exists(path.join(dir, r.file))).map((r) => r.name);
  return `\n\n## This product right now\n- Price shown on the page: $${sitePrice(saved, bom).toFixed(2)} (${saved.price ? 'set in site.json' : 'computed default; set "price" to change it'}). Cost-based unit price at 10 units: $${q.tiers[1].unit_price.toFixed(2)}, at 100 units: $${q.tiers[2].unit_price.toFixed(2)}. Kit mode ${bom.kit_ok === false ? 'is NOT offered' : 'is offered'}.\n- Estimated ship time: about ${shipWeeksFor(q)} weeks.\n- Product renders available for the gallery: ${renders.length ? renders.join(', ') : 'none yet (the gallery section shows nothing until ads are generated)'}.\n`;
}

/** After a website-agent turn: validate site.json (restore on broken JSON), keep store flags, apply the honesty filter. */
function finalizeSite(dir, backup) {
  const file = path.join(dir, 'site', 'site.json');
  const meta = readJSON(path.join(dir, 'meta.json'), {});
  const bom = readJSON(path.join(dir, 'bom.json'), {});
  let cur = readJSON(file, null);
  let note = '';
  if (!cur || typeof cur !== 'object') {
    if (backup?.raw != null) fs.writeFileSync(file, backup.raw);
    cur = readJSON(file, {}) || {};
    note = 'The page file came out invalid, so I restored the previous version.';
  }
  const prev = backup?.prev || {};
  const next = { t: now(), source: prev.source || cur.source || 'template', edited: true };
  if (prev.published !== undefined) next.published = prev.published; // publishing stays a user action
  if (prev.published_at !== undefined) next.published_at = prev.published_at;
  const price = Number(cur.price);
  if (price > 0 && price < 100000) next.price = cents(price);
  next.copy = repairSite(cur.copy, meta, bom);
  const sections = cleanSections(cur.sections); if (sections) next.sections = sections;
  const palette = cleanPalette(cur.palette); if (palette) next.palette = palette;
  writeJSON(file, next);
  return note;
}

/** Context for the ads agent: what the product costs and which product shots exist. */
function adsContextPrompt(dir) {
  const bom = readJSON(path.join(dir, 'bom.json'), {});
  const ads = readJSON(path.join(dir, 'ads', 'ads.json'), {}) || {};
  const q = quote(bom, 'assembled', dir);
  const renders = (ads.renders || []).filter((r) => exists(path.join(dir, r.file))).map((r) => r.name);
  return `\n\n## This product right now\n- Price in the ads: $${Number(ads.price || retailPrice(bom)).toFixed(2)}. Estimated ship time: about ${shipWeeksFor(q)} weeks.\n- Product shots you can pick for "render": ${renders.length ? renders.join(', ') : 'none'}.\n- There are ${(ads.ads || []).length} ads right now.\n`;
}

/** After an ads-agent turn: restore on broken JSON, keep server-managed fields, apply the honesty filter (repairAds). */
function finalizeAdsChat(dir, backup) {
  const file = path.join(dir, 'ads', 'ads.json');
  const meta = readJSON(path.join(dir, 'meta.json'), {});
  const prev = backup?.raw ? (() => { try { return JSON.parse(backup.raw); } catch { return null; } })() : null;
  let cur = readJSON(file, null);
  let note = '';
  if (!cur || typeof cur !== 'object' || !Array.isArray(cur.ads)) {
    if (backup?.raw != null) fs.writeFileSync(file, backup.raw);
    cur = readJSON(file, null);
    note = 'The ads file came out invalid, so I restored the previous version.';
    if (!cur) return note;
  }
  const keep = prev || cur;
  const shots = new Set((keep.renders || []).map((r) => r.name));
  let list;
  try { list = repairAds({ ads: cur.ads }, meta, 12); } catch { list = keep.ads || []; note = note || 'The ads came out empty, so I kept the previous ones.'; }
  list = list.map((a, i) => ({ ...a, render: shots.has(cur.ads[i]?.render) ? cur.ads[i].render : (shots.has(a.render) ? a.render : [...shots][0] || a.render) }));
  if (JSON.stringify(list) !== JSON.stringify(prev?.ads || null)) writeJSON(file, { ...keep, ads: list, edited: now() });
  return note;
}

/** Overall assembled size (mm) from the case STLs (binary STL), cached by manifest time. */
const dimsCache = new Map();
function designDims(dir, man) {
  if (!man?.parts?.length) return null;
  const key = dir + ':' + man.t;
  if (dimsCache.has(key)) return dimsCache.get(key);
  const mins = [Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity];
  const parts = man.parts.filter((p) => p.group !== 'component');
  for (const p of parts.length ? parts : man.parts) {
    const f = projFileSync(dir, p.file); // B3: manifest paths are untrusted
    let buf; try { buf = f && fs.readFileSync(f); } catch { continue; }
    if (!buf) continue;
    if (buf.length < 84) continue;
    const n = buf.readUInt32LE(80);
    if (84 + n * 50 !== buf.length) continue; // ascii STL: skip
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50 + 12;
      for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) {
        const x = buf.readFloatLE(o + v * 12 + a * 4);
        if (x < mins[a]) mins[a] = x; if (x > maxs[a]) maxs[a] = x;
      }
    }
  }
  let dims = mins[0] === Infinity ? null : maxs.map((m, a) => Math.round(m - mins[a]));
  if (!dims) { // fall back to the largest per-part bbox
    dims = [0, 1, 2].map((a) => Math.round(Math.max(...man.parts.map((p) => (p.bbox || [0, 0, 0])[a]))));
  }
  dimsCache.set(key, dims);
  return dims;
}

function sitePayload(src) {
  const dir = src.dir;
  const meta = readJSON(path.join(dir, 'meta.json'), {});
  const bom = readJSON(path.join(dir, 'bom.json'), {});
  const man = readJSON(path.join(dir, 'manifest.json'));
  const ads = readJSON(path.join(dir, 'ads', 'ads.json'));
  const saved = readJSON(path.join(dir, 'site', 'site.json'));
  const q = quote(bom, 'assembled', dir);
  const base = `/files/${src.kind}/${src.id}/`;
  const renders = {};
  for (const r of ads?.renders || []) if (exists(path.join(dir, r.file))) renders[r.name] = vurl(dir, r.file, base + r.file);
  const printed = bom.printed || [];
  const waitlist = readJSON(path.join(dir, 'site', 'waitlist.json'), []);
  return {
    meta: { title: meta.title || 'Untitled', description: meta.description || '', creator: meta.creator || '', tags: meta.tags || [] },
    copy: saved?.copy ? repairSite(saved.copy, meta, bom) : siteTemplate(meta, bom),
    generated: !!saved?.copy, edited: !!saved?.edited,
    price: sitePrice(saved, bom),
    published: src.kind === 'examples' ? true : isPublished(dir), listable: src.kind === 'projects',
    ship_weeks: shipWeeksFor(q), build_days: (q.tiers.find((t) => t.qty === 1) || q.tiers[0]).lead_time_days,
    sell_assembled: q.sell_assembled !== false, orderable: q.orderable !== false, // prices: kits only while SELL_ASSEMBLED is off
    palettes: (ads?.ads || []).map((a) => a.palette),
    images: { ...renders, thumb: vurl(dir, 'thumb.png', base + 'thumb.png') },
    specs: {
      dims: designDims(dir, man), grams: Math.round(printed.reduce((s, p) => s + (Number(p.grams) || 0), 0)),
      printed_parts: printed.length, material: 'PETG', assembly_minutes: Number(bom.assembly_minutes) || 0,
    },
    box: { kit_ok: bom.kit_ok !== false, hardware: (bom.parts || []).map((p) => ({ name: p.name, qty: p.qty_per_unit })), printed: printed.map((p) => p.name) },
    waitlist_count: waitlist.length,
    has_model: !!man,
    sections: cleanSections(saved?.sections) || DEFAULT_SECTIONS,
    palette: cleanPalette(saved?.palette),
    theme_css: src.kind === 'projects' ? sanitizeCss(readText(path.join(dir, 'site', 'theme.css')) || '') : '',
    chat: src.kind === 'projects' ? { running: siteRuns.has(src.id) } : null,
  };
}

/** Store-related flags and agent-made layout that survive copy rewrites. */
function keepSiteFlags(prev) {
  const o = {};
  for (const k of ['published', 'published_at', 'price', 'sections', 'palette']) if (prev && prev[k] !== undefined) o[k] = prev[k];
  return o;
}
function sitePrice(saved, bom) {
  const p = Number(saved?.price);
  return p > 0 && p < 100000 ? cents(p) : retailPrice(bom);
}

function setPublished(src, on) {
  if (on && !exists(path.join(src.dir, 'manifest.json'))) throw Object.assign(new Error('Build the model before listing it in the store'), { code: 400 });
  const file = ensureDir(path.join(src.dir, 'site', 'site.json'));
  const prev = readJSON(file, {});
  const next = { ...prev, published: !!on };
  if (on) next.published_at = new Date().toISOString(); else delete next.published_at;
  writeJSON(file, next);
  if (src.kind === 'projects') setPublicFlag('published', src.id, !!on); // N1: the authority
  return { ok: true, published: !!on };
}

// ---------------------------------------------------------------- store (marketplace)
// Categories derive from tags. Order matters: a design's first tag that maps decides its main category.
const CATEGORY_TAGS = [
  ['Fitness', ['fitness', 'grip', 'training', 'gym', 'workout']],
  ['Climbing', ['climbing', 'bouldering', 'hangboard']],
  ['Cycling', ['cycling', 'bike', 'bicycle']],
  ['Kitchen', ['kitchen', 'pantry', 'cooking', 'spice']],
  ['Pets', ['pets', 'pet', 'dog', 'cat']],
  ['Audio', ['audio', 'headphones', 'speaker', 'music']],
  ['Lighting', ['lighting', 'lamp', 'light', 'led']],
  ['Gaming', ['gaming', 'controller', 'game']],
  ['Desk', ['desk', 'monitor', 'laptop', 'phone', 'cables', 'phone-stand', 'desk-accessory', 'ergonomics', 'office']],
  ['Outdoor', ['outdoor', 'garden', 'camping', 'hiking']],
  ['Workshop', ['3d printing', 'garage', 'tools', 'workshop', 'electronics']],
  ['Home', ['home', 'home decor', 'plants', 'wall mount', 'wall-mount', 'organizer', 'shelf', 'drawer', 'entryway', 'keys', 'door', 'storage']],
];
function categoriesFor(tags) {
  const out = [];
  for (const t of (tags || []).map((x) => String(x).toLowerCase().trim())) {
    const hit = CATEGORY_TAGS.find(([, ts]) => ts.includes(t));
    if (hit && !out.includes(hit[0])) out.push(hit[0]);
  }
  return out.length ? out : ['Other'];
}

// card-stats: the "Designed in 8 min · $6.34 each" line on product cards (gallery, store, sidebar, landing). price_each =
// orderPrice(bom, dir, 1).total, the Order tab's default price (1 kit, delivered, at cost; null until built);
// design_minutes = sum of design-agent run durations (t_send to end) in runs.jsonl, null when there are none (script-built
// examples); print_hours = bom.json printed totals. Cached per dir, re-computed when bom/manifest/runs change.
const cardStatsCache = new Map(); // dir -> { sig, v }
/** The one price function for an order: `qty` kits at cost, with kit-contents groups left out. The Order tab
 * (/api/quote?qty=), checkout (payments.checkoutPrice) and the designs list (cardStats) all come through priceFor. */
function orderPrice(bom, dir, qty, omit, addons) {
  const o = { ...(omit && omit.length ? { omit } : {}), ...(addons && addons.length ? { addons } : {}) };
  return priceFor(bom || {}, qty, 'kit', dir, Object.keys(o).length ? o : undefined);
}
/** ?qty=&omit=&addons= on a quote URL -> the at-cost order price (Order tab), or {error} on a bad qty, or null without qty.
 * Used by /api/quote, /api/share/<id>/quote and /build/<slug>/quote.json. */
function orderPriceQuery(url, bom, dir) {
  if (!url.searchParams.has('qty')) return null;
  const qn = Number(url.searchParams.get('qty'));
  if (!(Number.isInteger(qn) && qn >= 1 && qn <= MAX_QTY)) return { error: `qty must be 1 to ${MAX_QTY}` };
  const omit = (url.searchParams.get('omit') || '').split(',').filter(Boolean);
  const addons = (url.searchParams.get('addons') || '').split(',').map((k) => (k === 'soldering_iron' ? 'solder' : k)).filter((k) => k === 'solder');
  return orderPrice(bom, dir, qn, omit, addons);
}
function cardStats(dir) {
  const sig = ['bom.json', 'manifest.json', 'runs.jsonl'].map((f) => { try { const s = fs.statSync(path.join(dir, f)); return s.mtimeMs + ':' + s.size; } catch { return '-'; } }).join('|');
  const hit = cardStatsCache.get(dir);
  if (hit && hit.sig === sig) return hit.v;
  const bom = readJSON(path.join(dir, 'bom.json'), {}) || {};
  const built = !!readJSON(path.join(dir, 'manifest.json'))?.parts?.length;
  const t1 = built ? priceFor(bom, 1, 'kit', dir, { background: true }) : null; // = orderPrice(bom, dir, 1): the Order tab's default, 1 kit delivered at cost; Slant quotes queue behind open Order tabs
  const hours = (bom.printed || []).reduce((s, p) => s + (Number(p.print_hours) || 0), 0);
  let ms = 0, n = 0;
  for (const l of (readText(path.join(dir, 'runs.jsonl')) || '').split('\n')) {
    if (!l.trim()) continue;
    try { const r = JSON.parse(l); if (r.kind === 'design' && Number.isFinite(r.end) && r.end > 0) { ms += r.end; n++; } } catch {}
  }
  const v = { price_each: t1 && t1.total > 0 ? t1.total : null, design_minutes: n ? Math.round(ms / 600) / 100 : null, print_hours: built && hours > 0 ? cents(hours) : null };
  if (!(t1 && t1.refreshing)) cardStatsCache.set(dir, { sig, v }); // live supplier prices still coming: work it out again next time
  return v;
}

function storeListing(kind, id, dir) {
  const meta = readJSON(path.join(dir, 'meta.json'), {});
  const bom = readJSON(path.join(dir, 'bom.json'), {});
  const site = readJSON(path.join(dir, 'site', 'site.json'));
  const ads = readJSON(path.join(dir, 'ads', 'ads.json'));
  const q = quote(bom, 'assembled', dir);
  const base = `/files/${kind}/${id}/`;
  const heroR = (ads?.renders || []).find((r) => r.name === 'hero' && exists(path.join(dir, r.file)));
  const waitlist = readJSON(path.join(dir, 'site', 'waitlist.json'), []);
  const copy = site?.copy ? repairSite(site.copy, meta, bom) : siteTemplate(meta, bom);
  const cta = site?.copy?.cta || '';
  const status = /waitlist/i.test(cta) ? 'Join waitlist' : site?.copy ? 'Pre-order' : 'Made to order';
  const cats = categoriesFor(meta.tags);
  const isEx = kind === 'examples';
  return {
    kind: isEx ? 'example' : 'project', id,
    title: meta.title || 'Untitled', tagline: site?.copy ? copy.tagline : (meta.description || copy.tagline), description: meta.description || '',
    creator: shareMod.publicCreator(meta.creator), tags: meta.tags || [], category: cats[0], categories: cats, // pen test A5
    price: sitePrice(site, bom), status,
    lead_time_days: (q.tiers.find((t) => t.qty === 1) || q.tiers[0]).lead_time_days, // same qty-1 lead time the studio's order pill shows
    waitlist_count: Array.isArray(waitlist) ? waitlist.length : 0,
    image: heroR ? vurl(dir, heroR.file, base + heroR.file) : vurl(dir, 'thumb.png', base + 'thumb.png'),
    image_kind: heroR ? 'render' : 'thumb',
    url: isEx ? `/examples/${encodeURIComponent(id)}/website` : approutes.designPath(id, meta.title) + '/website', // urls: clean studio URLs
    demo: isEx ? meta.demo !== false : false,
    created: (!isEx && site?.published_at) || meta.created || null,
    ...cardStats(dir), // card-stats
  };
}

// Examples kept out of the public store: the grip trainer reads as a gun in a thumbnail (owner rule: nothing weapon-like
// on public surfaces). It still opens as an example by its own link.
const STORE_HIDDEN = new Set(['grip-trainer']);
function storeListings({ q, category } = {}) {
  const out = [];
  for (const slug of exampleSlugs()) {
    if (STORE_HIDDEN.has(slug)) continue;
    const dir = exDir(slug);
    if (dir && exists(path.join(dir, 'meta.json'))) out.push(storeListing('examples', slug, dir));
  }
  for (const id of fs.existsSync(PROJECTS) ? fs.readdirSync(PROJECTS) : []) {
    const dir = projDir(id);
    if (!dir || !exists(path.join(dir, 'meta.json')) || !exists(path.join(dir, 'manifest.json'))) continue;
    if (!isPublished(dir)) continue; // N1: server record, not the agent-writable site.json
    out.push(storeListing('projects', id, dir));
  }
  let list = out;
  const cat = String(category || '').trim().toLowerCase();
  if (cat && cat !== 'all') list = list.filter((l) => l.categories.some((c) => c.toLowerCase() === cat));
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  if (words.length) {
    list = list.filter((l) => {
      const hay = [l.title, l.tagline, l.description, l.creator, ...l.tags, ...l.categories].join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
  list.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
  return list;
}

function saveSiteCopy(src, copy) {
  const meta = readJSON(path.join(src.dir, 'meta.json'), {});
  const bom = readJSON(path.join(src.dir, 'bom.json'), {});
  const clean = repairSite(copy, meta, bom);
  const file = ensureDir(path.join(src.dir, 'site', 'site.json'));
  const prev = readJSON(file, {});
  writeJSON(file, { ...keepSiteFlags(prev), t: now(), source: prev.source || 'template', edited: true, copy: clean });
  return clean;
}

function saveAdsEdits(src, list) {
  const file = path.join(src.dir, 'ads', 'ads.json');
  const cur = readJSON(file);
  if (!cur || !Array.isArray(list)) throw Object.assign(new Error('no ads to update'), { code: 400 });
  const meta = readJSON(path.join(src.dir, 'meta.json'), {});
  const byId = new Map(list.filter((a) => a && typeof a === 'object').map((a) => [a.id, a]));
  cur.ads = repairAds({ ads: cur.ads.map((a) => ({ ...a, ...(byId.get(a.id) || {}) })) }, meta)
    .map((a, i) => ({ ...a, id: cur.ads[i].id, render: ['hero', 'low', 'front', 'detail'].includes(byId.get(cur.ads[i].id)?.render) ? byId.get(cur.ads[i].id).render : cur.ads[i].render }));
  cur.edited = now();
  writeJSON(file, cur);
  return cur;
}

const EMAIL_RE = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z]{2,24}$/i;
function joinWaitlist(src, body) {
  const name = String(body.name || '').trim().slice(0, 120);
  const email = String(body.email || '').trim().slice(0, 254);
  if (!name) throw Object.assign(new Error('Name is required'), { code: 400 });
  if (!EMAIL_RE.test(email)) throw Object.assign(new Error('Enter a valid email'), { code: 400 });
  const file = ensureDir(path.join(src.dir, 'site', 'waitlist.json'));
  const list = readJSON(file, []);
  if (list.length >= 10000) throw Object.assign(new Error('Waitlist is full'), { code: 400 });
  const dup = list.some((x) => x.email.toLowerCase() === email.toLowerCase());
  if (!dup) list.push({ name, email, kind: body.kind === 'waitlist' ? 'waitlist' : 'preorder', t: new Date().toISOString(), note: 'No payment taken' });
  writeJSON(file, list);
  return { ok: true, already: dup, count: list.length };
}

async function generateAds(src) {
  const key = `${src.kind}:${src.id}`;
  if (adsJobs.has(key)) throw Object.assign(new Error('Ads are already being generated for this design'), { code: 409 });
  const job = { stage: 'starting', startedAt: Date.now() };
  adsJobs.set(key, job);
  const progress = (stage, text) => {
    job.stage = stage;
    if (src.project) emit(src.id, { type: 'ads_progress', stage, text });
  };
  try {
    const dir = src.dir;
    if (!exists(path.join(dir, 'manifest.json'))) throw Object.assign(new Error('This design has no exported model yet'), { code: 400 });
    const meta = readJSON(path.join(dir, 'meta.json'), {});
    const bom = readJSON(path.join(dir, 'bom.json'), {});
    const q = quote(bom, 'assembled', dir);
    const price = retailPrice(bom);
    const shipWeeks = shipWeeksFor(q);
    progress('working', 'Rendering product shots and writing copy');

    const t0 = Date.now();
    const timing = {};
    const renderP = renderHeroes(dir).then((r) => { timing.render_s = +((Date.now() - t0) / 1000).toFixed(1); progress('rendered', 'Product shots ready'); return r; });
    // The copywriter has no tools at all; it runs in a scratch dir of its own with the scrubbed env (subscription login).
    const cw = path.join(DATA, '.copywriter');
    fs.mkdirSync(cw, { recursive: true });
    const env = agentEnv(cw);
    const args = ['-p', adsPrompt(meta, bom, q, price, shipWeeks), '--output-format', 'json',
      '--setting-sources', '', '--strict-mcp-config', '--tools', '', '--disable-slash-commands', '--no-session-persistence',
      '--system-prompt', 'You are a direct-response copywriter for Meta ads. You write honest, specific copy and output only valid JSON.'];
    if (ADS_MODEL) args.push('--model', ADS_MODEL);
    const copyP = runProc(CLAUDE, args, { cwd: cw, env }, ADS_COPY_TIMEOUT).then((r) => {
      timing.copy_s = +((Date.now() - t0) / 1000).toFixed(1);
      if (r.timedOut) throw new Error('Copy generation timed out');
      let j; try { j = JSON.parse(r.stdout); } catch {}
      if (!j) throw new Error('Claude Code failed: ' + (r.stderr.trim().split('\n').pop() || `exit ${r.code}`));
      if (j.is_error) throw new Error(String(j.result || 'Claude Code returned an error').slice(0, 300));
      progress('written', 'Copy written');
      const parsed = parseModelJSON(j.result);
      return { ads: repairAds(parsed, meta), site: repairSite(parsed?.site, meta, bom) };
    });
    const [rend, copy] = await Promise.all([renderP, copyP]);
    const ads = copy.ads;
    { const sf = ensureDir(path.join(dir, 'site', 'site.json')); writeJSON(sf, { ...keepSiteFlags(readJSON(sf, {})), t: now(), source: 'claude', copy: copy.site }); }
    const out = {
      t: now(), title: meta.title || '', price, ship_weeks: shipWeeks,
      renders: rend.renders.map((f) => ({ name: path.basename(f, '.png'), file: f })),
      ads, timing: { ...timing, total_s: +((Date.now() - t0) / 1000).toFixed(1) },
    };
    writeJSON(ensureDir(path.join(dir, 'ads', 'ads.json')), out);
    console.log(`[ads ${key}] done render=${timing.render_s}s copy=${timing.copy_s}s`);
    if (src.project) emit(src.id, { type: 'ads_done', ok: true });
    return out;
  } catch (e) {
    if (src.project) emit(src.id, { type: 'ads_done', ok: false, error: e.message });
    throw e;
  } finally {
    adsJobs.delete(key);
  }
}

// ---------------------------------------------------------------- launch (demo): deploy a static site, pick a domain, schedule ads
// Nothing here buys a domain, calls Meta or takes payment. The static export is real and served at /s/<slug>/.
const DEPLOYS = path.join(DATA, 'deploys');
const DOMAIN_TLDS = ['com', 'shop', 'co', 'store'];
const BUDGET_MIN = 5, BUDGET_MAX = 500;
const DURATIONS = [3, 7, 14, 30, 0]; // 0 = ongoing
const COUNTRIES = ['US', 'CA', 'GB', 'AU'];
const CAMPAIGN_STATUSES = ['demo_scheduled', 'paused', 'stopped'];
// The only script on an exported page: opens the waitlist / pre-order form and posts it back to this server.
const WAITLIST_JS = `(function(){
var b=document.body,pid=b.getAttribute('data-project'),cta=b.getAttribute('data-cta')||'Pre-order',price=b.getAttribute('data-price')||'',title=b.getAttribute('data-title')||'';
var wait=/waitlist/i.test(cta),box=document.getElementById('sfModal');
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
var X='<button class="sf-x" data-close aria-label="Close"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6"/></svg></button>';
function close(){box.hidden=true;box.innerHTML='';}
function open(){
box.hidden=false;
box.innerHTML='<div class="sf-dialog" role="dialog" aria-modal="true" aria-labelledby="sfmT">'+X+'<h3 id="sfmT">'+(wait?'Join the waitlist':esc(cta)+' · '+esc(title))+'</h3><p>'+(wait?'We\\u2019ll email you once when it\\u2019s ready to order.':esc(price)+'. We\\u2019ll email you before we build yours.')+'</p><form id="sfForm"><label><span>Name</span><input name="name" required maxlength="120" autocomplete="name"></label><label><span>Email</span><input name="email" type="email" required maxlength="254" autocomplete="email"></label><div class="sf-demo">No payment now. We email you before anything is built.</div><div class="sf-err" id="sfErr" hidden></div><button class="sf-btn block" id="sfGo">'+(wait?'Join the waitlist':'Reserve mine')+'</button></form></div>';
var f=document.getElementById('sfForm');setTimeout(function(){f.elements.name.focus();},30);
f.onsubmit=function(e){e.preventDefault();var go=document.getElementById('sfGo'),err=document.getElementById('sfErr');go.disabled=true;err.hidden=true;
var name=f.elements.name.value,email=f.elements.email.value;
fetch('/api/site/waitlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:pid,name:name,email:email,kind:wait?'waitlist':'preorder'})})
.then(function(r){return r.json().catch(function(){return{};}).then(function(j){if(!r.ok)throw new Error(j.error||'Something went wrong. Try again.');return j;});})
.then(function(j){box.querySelector('.sf-dialog').innerHTML=X+'<h3>'+(j.already?'You\\u2019re already on the list':'You\\u2019re on the list')+'</h3><p>Thanks, '+esc(name.split(' ')[0])+'. We\\u2019ll email '+esc(email)+' before anything is built.</p><div class="sf-demo">No payment now. We email you before anything is built.</div><button class="sf-btn block" data-close style="margin-top:16px">Done</button>';})
.catch(function(x){err.hidden=false;err.textContent=x.message;go.disabled=false;});};
}
document.addEventListener('click',function(e){
var o=e.target.closest('[data-order]');if(o){e.preventDefault();open();return;}
var j=e.target.closest('[data-jump]');if(j){e.preventDefault();var t=document.getElementById(j.getAttribute('data-jump'));if(t)t.scrollIntoView({behavior:'smooth',block:'start'});return;}
if(box&&!box.hidden&&(e.target===box||e.target.closest('[data-close]')))close();});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&box&&!box.hidden)close();});
})();`;
const WAITLIST_HASH = crypto.createHash('sha256').update(WAITLIST_JS).digest('base64');
const DEPLOY_CSP = `default-src 'none'; script-src 'sha256-${WAITLIST_HASH}'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'`;

function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/^remix of /, '')
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/[\s-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '') || 'product';
}
const launchFile = (dir) => path.join(dir, 'site', 'launch.json');
const readLaunch = (dir) => readJSON(launchFile(dir), {}) || {};
function writeLaunch(dir, l) { l.t = now(); writeJSON(ensureDir(launchFile(dir)), l); return l; }
const deployDir = (slug) => (/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug || '') ? path.join(DEPLOYS, slug) : null);
function siteMtime(dir) {
  let t = 0;
  for (const f of ['site/site.json', 'site/theme.css', 'meta.json', 'bom.json', 'manifest.json', 'ads/ads.json']) { try { t = Math.max(t, fs.statSync(path.join(dir, f)).mtimeMs); } catch {} }
  return t;
}

function launchPayload(id, dir) {
  const l = readLaunch(dir);
  const meta = readJSON(path.join(dir, 'meta.json'), {});
  const bom = readJSON(path.join(dir, 'bom.json'), {});
  const ads = readJSON(path.join(dir, 'ads', 'ads.json'));
  const waitlist = readJSON(path.join(dir, 'site', 'waitlist.json'), []);
  const dd = deployDir(l.site?.slug);
  const live = !!(dd && exists(path.join(dd, 'index.html')));
  return {
    id, launch: l,
    site_url: live ? `/s/${l.site.slug}/` : null,
    stale: live ? siteMtime(dir) > Date.parse(l.site.deployed_at || 0) + 1000 : false,
    title: meta.title || 'Untitled', description: meta.description || '', tags: meta.tags || [], creator: meta.creator || '',
    price: sitePrice(readJSON(path.join(dir, 'site', 'site.json')), bom),
    thumb: vurl(dir, 'thumb.png', `/files/projects/${id}/thumb.png`),
    has_model: exists(path.join(dir, 'manifest.json')),
    ad_count: ads?.ads?.length || 0,
    waitlist_count: Array.isArray(waitlist) ? waitlist.length : 0,
    referred_by: meta.referred_by || null,
  };
}

/** Strip anything executable from the exported page markup (it was rendered client-side from already-filtered copy). */
function cleanExportHtml(html) {
  return String(html || '').slice(0, 800000)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(script|style|iframe|object|embed|link|meta|base|form|input|textarea|select|frame|frameset|template|noscript)\b[^>]*>/gi, '')
    .replace(/\s(on[a-z]+|contenteditable|spellcheck|srcdoc|formaction)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*(javascript|vbscript|data):[^"']*\2/gi, '$1=$2#$2');
}
function cleanExportCss(css) {
  return String(css || '').slice(0, 400000).replace(/<\/?\s*style/gi, '').replace(/@import[^;{}]*;?/gi, '')
    .replace(/url\s*\(\s*(['"]?)(?!data:image\/)[^)]*\)/gi, 'none');
}

function deploySite(id, dir, body) {
  if (!exists(path.join(dir, 'manifest.json'))) throw Object.assign(new Error('Build the model before deploying its page'), { code: 400 });
  const d = sitePayload({ kind: 'projects', id, dir });
  let html = cleanExportHtml(body.html);
  if (!/class="sf product-page/.test(html)) throw Object.assign(new Error('Nothing to deploy: the page did not render'), { code: 400 });
  // honesty filter, last line of defence: no invented social proof, no "buy now" wording on a pre-order page
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
  const bad = text.match(BANNED) || text.match(/\b(buy now|in stock|ships? (today|now)|order now|checkout)\b/i);
  if (bad) throw Object.assign(new Error(`The page says "${bad[0]}". Remove claims like that before it goes live.`), { code: 400 });

  fs.mkdirSync(DEPLOYS, { recursive: true });
  const l = readLaunch(dir);
  let slug = l.site?.slug;
  if (!deployDir(slug)) {
    slug = slugify(d.meta.title);
    const owner = (s) => readJSON(path.join(DEPLOYS, s, '.deploy.json'))?.project;
    if (exists(path.join(DEPLOYS, slug)) && owner(slug) !== id) slug = `${slug}-${id.slice(0, 4)}`.replace(/^-/, '');
    if (exists(path.join(DEPLOYS, slug)) && owner(slug) !== id) slug = `${slug}-${id}`;
  }
  const tmp = path.join(DEPLOYS, `.tmp-${slug}-${process.pid}-${Date.now()}`);
  const assets = path.join(tmp, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  const copied = new Map();
  const copyAsset = (rel) => {
    if (copied.has(rel)) return copied.get(rel);
    // B1: only real files inside the project (no symlinks, dot dirs or ..), and only page assets (images, models)
    const src = /\.(png|jpe?g|webp|gif|stl|glb|3mf)$/i.test(rel) ? projFileSync(dir, rel) : null;
    if (!src) return null;
    const name = rel.replace(/\//g, '-').replace(/[^\w.-]/g, '');
    fs.copyFileSync(src, path.join(assets, name));
    copied.set(rel, 'assets/' + name);
    return 'assets/' + name;
  };
  const prefix = `/files/projects/${id}/`;
  html = html.replace(/\/files\/projects\/([A-Za-z0-9_-]+)\/([\w./-]+?)(\?[^"'\s)<>]*)?(?=["'\s)<>])/g, (m, pid, rel) => (pid === id && copyAsset(rel)) || '');
  const thumb = copyAsset('thumb.png');
  const heroRel = (readJSON(path.join(dir, 'ads', 'ads.json'))?.renders || []).find((r) => r.name === 'hero')?.file;
  const hero = (heroRel && copyAsset(heroRel)) || thumb;
  fs.writeFileSync(path.join(assets, 'site.css'), cleanExportCss(body.css));
  fs.writeFileSync(path.join(assets, 'theme.css'), d.theme_css || '');
  const title = d.meta.title, tagline = d.copy.tagline || '';
  const price = '$' + Number(d.price).toFixed(2);
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escHtml(title)}${tagline ? ' · ' + escHtml(tagline) : ''}</title>
<meta name="description" content="${escHtml(tagline || d.meta.description)}">
<meta property="og:title" content="${escHtml(title)}">
<meta property="og:description" content="${escHtml(tagline)}">
${hero ? `<meta property="og:image" content="${hero}">\n<link rel="icon" href="${thumb || hero}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/site.css">
<link rel="stylesheet" href="assets/theme.css">
</head>
<body data-project="${escHtml(id)}" data-cta="${escHtml(d.copy.cta || 'Pre-order')}" data-price="${escHtml(price)}" data-title="${escHtml(title)}">
<div class="sf-scroll">
${html}
</div>
<script>${WAITLIST_JS}</script>
</body>
</html>
`;
  fs.writeFileSync(path.join(tmp, 'index.html'), page);
  writeJSON(path.join(tmp, '.deploy.json'), { project: id, slug, deployed_at: new Date().toISOString() });
  const final = path.join(DEPLOYS, slug);
  const old = exists(final) ? `${final}.old-${Date.now()}` : null;
  if (old) fs.renameSync(final, old);
  fs.renameSync(tmp, final);
  if (old) fs.rmSync(old, { recursive: true, force: true });
  const at = new Date().toISOString();
  l.site = { slug, url: `/s/${slug}/`, deployed_at: at, first_deployed_at: l.site?.first_deployed_at || at, deploys: (l.site?.deploys || 0) + 1, files: 1 + copied.size + 2 };
  writeLaunch(dir, l);
  return launchPayload(id, dir);
}
function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function setDomain(id, dir, body) {
  const l = readLaunch(dir);
  if (body.domain == null || body.domain === '') { delete l.domain; writeLaunch(dir, l); return launchPayload(id, dir); }
  const name = String(body.domain).toLowerCase().trim();
  const m = name.match(/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.([a-z]+)$/);
  if (!m || !DOMAIN_TLDS.includes(m[2])) throw Object.assign(new Error(`Use a name like yourbrand.com (${DOMAIN_TLDS.map((t) => '.' + t).join(', ')})`), { code: 400 });
  if (!l.site?.slug) throw Object.assign(new Error('Deploy the website first'), { code: 400 });
  l.domain = { name, tld: m[2], status: 'connected_demo', points_to: `/s/${l.site.slug}/`, selected_at: new Date().toISOString(),
    note: 'Demo: not registered, availability not checked, nothing charged' };
  writeLaunch(dir, l);
  return launchPayload(id, dir);
}

function saveCampaign(id, dir, body) {
  const l = readLaunch(dir);
  if (!l.site?.slug) throw Object.assign(new Error('Deploy the website first. The ads send people there.'), { code: 400 });
  const ads = readJSON(path.join(dir, 'ads', 'ads.json'));
  const ids = new Set((ads?.ads || []).map((a) => a.id));
  const pick = [...new Set((Array.isArray(body.ads) ? body.ads : []).filter((x) => ids.has(x)))];
  if (!pick.length) throw Object.assign(new Error('Pick at least one ad to run'), { code: 400 });
  const daily = Math.round(Number(body.daily_budget));
  if (!(daily >= BUDGET_MIN && daily <= BUDGET_MAX)) throw Object.assign(new Error(`Daily budget must be $${BUDGET_MIN} to $${BUDGET_MAX}`), { code: 400 });
  const days = Number(body.duration_days);
  if (!DURATIONS.includes(days)) throw Object.assign(new Error('Pick how long to run it'), { code: 400 });
  const country = COUNTRIES.includes(body.country) ? body.country : 'US';
  const interests = (Array.isArray(body.interests) ? body.interests : []).map((s) => String(s).replace(/[^\w &'-]/g, '').trim().slice(0, 40)).filter(Boolean).slice(0, 10);
  const prev = l.campaign && l.campaign.status !== 'stopped' ? l.campaign : null;
  const at = new Date().toISOString();
  l.campaign = {
    id: prev?.id || 'c_' + newId(), status: prev?.status === 'paused' ? 'paused' : 'demo_scheduled',
    objective: 'waitlist', destination: l.domain?.name || `/s/${l.site.slug}/`,
    ads: pick, daily_budget: daily, duration_days: days, country, interests, age_min: 18, age_max: 65,
    created: prev?.created || at, updated: at,
    history: [...(prev?.history || []), { status: prev ? 'edited' : 'demo_scheduled', t: at }].slice(-50),
    note: 'Not sent to Meta. Demo only, nothing charged.',
  };
  writeLaunch(dir, l);
  return launchPayload(id, dir);
}
function setCampaignStatus(id, dir, body) {
  const l = readLaunch(dir);
  if (!l.campaign) throw Object.assign(new Error('No campaign yet'), { code: 404 });
  if (!CAMPAIGN_STATUSES.includes(body.status)) throw Object.assign(new Error('Unknown status'), { code: 400 });
  if (l.campaign.status === 'stopped') throw Object.assign(new Error('This campaign is stopped. Set up a new one.'), { code: 400 });
  const at = new Date().toISOString();
  l.campaign.status = body.status; l.campaign.updated = at;
  l.campaign.history = [...(l.campaign.history || []), { status: body.status, t: at }].slice(-50);
  writeLaunch(dir, l);
  return launchPayload(id, dir);
}

// ---------------------------------------------------------------- access: login cookie, showcase mode, agent limits
const isLocalHost = (h) => h === `127.0.0.1:${PORT}` || h === `localhost:${PORT}`;
const TUNNEL_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com$/;
const hostAllowed = (h) => ALLOWED_HOSTS.has(h) || (TUNNEL && TUNNEL_HOST.test(h));
/** True if the request came through the Google sign-in gateway (constant-time secret compare). */
function viaGateway(req) {
  const v = req.headers['x-forma-gateway'];
  if (!GATEWAY_SECRET || typeof v !== 'string') return false;
  const h = (x) => crypto.createHash('sha256').update(x).digest();
  return crypto.timingSafeEqual(h(v), h(GATEWAY_SECRET));
}
function gatewayUser(req) { return String(req.headers['x-forma-user'] || '').trim().toLowerCase().slice(0, 254); }
function hostOk(req) {
  const h = String(req.headers.host || '').toLowerCase();
  if (!hostAllowed(h)) return false;
  const o = req.headers.origin;
  if (o) {
    let u; try { u = new URL(o); } catch { return false; }
    // Through the gateway the browser's Origin is the gateway's own domain (sent on as X-Forwarded-Host); the gateway checks it first.
    const fwd = viaGateway(req) && String(req.headers['x-forwarded-host'] || '').toLowerCase();
    if (fwd && u.host === fwd && u.protocol === 'https:') return true;
    if (!hostAllowed(u.host)) return false;
    if (u.protocol !== (isLocalHost(u.host) ? 'http:' : 'https:')) return false;
  }
  return true;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
function sign(v) { return b64url(crypto.createHmac('sha256', SESSION_KEY).update(v).digest()); }
function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
/** A request typed on this Mac: Host 127.0.0.1/localhost:PORT from a loopback socket, with none of the headers cloudflared
 * adds (Cf-Connecting-Ip, X-Forwarded-For, Cf-Ray), so tunnel traffic can't pass as local. Agents can't reach loopback
 * at all (the sandbox blocks it). */
function isLocalRequest(req) {
  const ra = String(req.socket.remoteAddress || '');
  return isLocalHost(String(req.headers.host || '').toLowerCase()) && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ra)
    && !req.headers['cf-connecting-ip'] && !req.headers['x-forwarded-for'] && !req.headers['cf-ray'] && !req.headers['x-forma-gateway'];
}
// ---- security A3: being on this Mac isn't enough to be admin. A local request is admin only with the local token
// (FORMA_LOCAL_TOKEN in app/.env.local, made on first start): the forma_local cookie (set by a one-time link from
// `node scripts/local-signin.js`) or an X-Forma-Local header (scripts). Without it, 127.0.0.1 browses as a signed-out guest.
// No .env.local at all (tests, temp checkouts) keeps the old behaviour.
const ENV_LOCAL = path.join(APP, '.env.local');
let LOCAL_TOKEN = String(process.env.FORMA_LOCAL_TOKEN || '').trim();
if (!LOCAL_TOKEN && exists(ENV_LOCAL) && process.env.FORMA_LOCAL_TOKEN !== '') {
  LOCAL_TOKEN = crypto.randomBytes(32).toString('hex');
  try { fs.appendFileSync(ENV_LOCAL, `\n# Local admin token (security A3). Sign in on this Mac: node scripts/local-signin.js\nFORMA_LOCAL_TOKEN=${LOCAL_TOKEN}\n`); fs.chmodSync(ENV_LOCAL, 0o600); }
  catch (e) { console.error(`[security] could not save FORMA_LOCAL_TOKEN: ${e.message}`); }
}
const LOCAL_COOKIE = 'forma_local';
const hmacHex = (k, v) => crypto.createHmac('sha256', k).update(v).digest('hex');
const safeEq = (a, b) => { const h = (x) => crypto.createHash('sha256').update(String(x)).digest(); return crypto.timingSafeEqual(h(a), h(b)); };
const localCookieValue = () => hmacHex(LOCAL_TOKEN, 'forma-local-cookie-v1');
function hasLocalCred(req) {
  if (!LOCAL_TOKEN) return true;
  const h = req.headers['x-forma-local'];
  if (typeof h === 'string' && h && safeEq(h, LOCAL_TOKEN)) return true;
  const c = readCookie(req, LOCAL_COOKIE);
  return !!c && safeEq(c, localCookieValue());
}
/** One-time sign-in code: <hmac>.<unix seconds>, valid 5 minutes, once. scripts/local-signin.js makes the same. */
const usedLocalCodes = new Map();
function localCodeOk(code) {
  const m = /^([0-9a-f]{64})\.(\d{10})$/.exec(String(code || ''));
  if (!LOCAL_TOKEN || !m) return false;
  const t = Number(m[2]), now = Date.now() / 1000;
  if (Math.abs(now - t) > 300 || usedLocalCodes.has(code) || !safeEq(m[1], hmacHex(LOCAL_TOKEN, 'forma-local-signin:' + m[2]))) return false;
  usedLocalCodes.set(code, now);
  for (const [k, v] of usedLocalCodes) if (now - v > 600) usedLocalCodes.delete(k);
  return true;
}
/** A1: a same-site path for ?next=. No control characters, no //, /\\ or scheme tricks; resolved against a dummy origin. */
function safeNextPath(n) {
  const s = String(n || '');
  if (!s.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(s) || s.startsWith('//')) return '/';
  try { const u = new URL(s, 'http://x.invalid'); return u.origin === 'http://x.invalid' ? (u.pathname + u.search + u.hash).slice(0, 2000) : '/'; } catch { return '/'; }
}
const USER_RE = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,190}\.[a-z]{2,24}$/i;
/** { authed, sid, user, local }. user is the signed-in Google email (from the gateway) or LOCAL_USER on this Mac. */
function access(req) {
  if (viaGateway(req)) {
    const user = gatewayUser(req);
    // The gateway passes a few public paths (webhook, legal pages, deployed sites) with no user: those are anonymous.
    return USER_RE.test(user) ? { authed: true, sid: 'gw:' + user, user } : { authed: false, sid: null, user: '' };
  }
  if (isLocalRequest(req) || OPEN_LOCAL) {
    // A3: no local token, no admin: a signed-out guest (who can still browse, and sign in with the one-time link)
    if (!hasLocalCred(req)) return { authed: false, sid: null, user: '', localGuest: true, noLocalCred: true };
    // "Sign out" on this Mac sets forma_local_out=1: browse as a signed-out guest until "Sign in" clears it.
    if (/(?:^|;\s*)forma_local_out=1(?:;|$)/.test(String(req.headers.cookie || ''))) return { authed: false, sid: null, user: '', localGuest: true };
    return { authed: true, sid: 'local', user: LOCAL_USER, local: true };
  }
  return { authed: false, sid: null, user: '' };
}
const viaHttps = (req) => PUBLIC || (ONLINE && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
function sessionCookie(req, clear = false) {
  const flags = `Path=/; HttpOnly; SameSite=Lax${viaHttps(req) ? '; Secure' : ''}`;
  if (clear) return `${COOKIE}=; ${flags}; Max-Age=0`;
  const sid = b64url(crypto.randomBytes(12));
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  return `${COOKIE}=${sid}.${exp}.${sign(`${sid}.${exp}`)}; ${flags}; Max-Age=${SESSION_DAYS * 86400}`;
}
function passwordOk(p) {
  // Behind the Google gateway the shared password is off: the bare tunnel URL must not bypass the email allowlist.
  if (GATEWAY_URL && GATEWAY_SECRET) return false;
  const h = (x) => crypto.createHash('sha256').update(String(x)).digest();
  return !!PASSWORD && crypto.timingSafeEqual(h(p), h(PASSWORD));
}
/** A6: the visitor's IP for rate limits. Via the gateway: X-Forma-Client-Ip, which the gateway sets from Railway's edge
 * (any copy the visitor sent is dropped there). On the bare tunnel: Cf-Connecting-Ip, set by Cloudflare. Never the
 * visitor-supplied left end of X-Forwarded-For. */
/** firmware: designs started today (server's local day), cached for 30 s. */
const statsCache = { t: 0, v: null };
function statsToday() {
  if (statsCache.v && Date.now() - statsCache.t < 30e3) return statsCache.v;
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  let n = 0;
  try {
    for (const id of fs.readdirSync(PROJECTS)) {
      const c = Date.parse(readJSON(path.join(PROJECTS, id, 'meta.json'), {})?.created || '');
      if (c >= d0.getTime()) n++;
    }
  } catch {}
  statsCache.t = Date.now(); statsCache.v = { designs_today: n, date: d0.toISOString().slice(0, 10) };
  return statsCache.v;
}
function clientIp(req) {
  const one = (v) => String(v || '').split(',')[0].trim().slice(0, 64);
  const ip = (viaGateway(req) && one(req.headers['x-forma-client-ip'])) || (ONLINE ? one(req.headers['cf-connecting-ip']) : '');
  return ip || req.socket.remoteAddress || '?';
}

/** Sliding-window counter: true if under the limit (and records the hit). */
const hits = new Map();
function allow(key, limit, windowMs) {
  const t = Date.now();
  const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
  if (list.length >= limit) { hits.set(key, list); admin.rateHit(key); return false; } // admin: counts refusals for the System page
  list.push(t); hits.set(key, list);
  return true;
}
setInterval(() => { const t = Date.now(); for (const [k, l] of hits) if (!l.some((x) => t - x < 86400e3)) hits.delete(k); }, 600e3).unref();

// Running turns + ad jobs + sketches. Idle warm processes (pool) wait on stdin and use nothing, so they don't count.
const activeAgents = () => runs.size + siteRuns.size + adsRuns.size + appRuns.size + adsJobs.size + sketchJobs.size + askProcs;
const isAdmin = (acc) => !!acc.authed && (!!acc.local || (!!acc.user && ADMIN_EMAILS.has(acc.user)));
const hitCount = (key, windowMs) => (hits.get(key) || []).filter((x) => Date.now() - x < windowMs).length;
/** Throws (401/503/429) if an agent run may not start now. Call before starting a design / site / ads run. */
function agentGate(acc) {
  if (!acc.authed || !acc.user) throw Object.assign(new Error('Sign in to use the AI agents.'), { code: 401 });
  if (activeAgents() >= MAX_CONCURRENT) throw Object.assign(new Error('The studio is busy right now. Try again in a minute.'), { code: 429 });
  if (acc.local) return;
  if (hitCount('runs-day:' + acc.user, 86400e3) >= RUNS_PER_DAY) throw Object.assign(new Error(`That's ${RUNS_PER_DAY} agent runs today, the daily limit. Try again tomorrow.`), { code: 429 });
  if (!allow('runs:' + acc.user, RUNS_PER_HOUR, 3600e3)) throw Object.assign(new Error(`That's ${RUNS_PER_HOUR} agent runs this hour, the limit for now. Try again later.`), { code: 429 });
  allow('runs-day:' + acc.user, Infinity, 86400e3);
}
// ---- per-user projects. Owners live in data/owners.json (server-only: agents can rewrite meta.json, so it is not the authority).
const OWNERS_FILE = path.join(DATA, 'owners.json');
let owners = {};
const ownerOf = (id) => owners[id] || null;
function setOwner(id, email) { owners[id] = email; writeJSON(OWNERS_FILE, owners); }
/** Owner or admin: may read everything and change anything in the project. */
const canEdit = (acc, id) => !!acc.authed && (isAdmin(acc) || (!!acc.user && ownerOf(id) === acc.user));
// ---- share: collaborators (members of a design's edit / copy link, server/share.js). What they may do in /api/projects/<id>:
//   both: the design (GET, no owner email), its live run (run, events: design agent only), versions
//   edit: + chat with the design agent (their own quota), stop it, undo / rewind / restore the design, part colours, chat images
//   copy: nothing that writes; sending a message answers {code: 'fork'} and the studio copies the design first
// Everything else (share settings, website, ads, launch / deploy / publish, the app agent, support) is the owner's: 403.
function memberRefusal(role, c, d, m) {
  if ((m === 'GET' || m === 'HEAD') && !d && (!c || c === 'run' || c === 'events' || c === 'sections' || (c === 'versions' && role === 'edit'))) return null; // N6: versions carry the owner's prompts
  const write = !d && m === 'POST' && ['messages', 'warm', 'stop', 'rewind', 'undo', 'redo', 'restore', 'colors'].includes(c);
  const upload = c === 'uploads' && ((m === 'POST' && !d) || (m === 'DELETE' && !!d));
  if (role === 'edit' && (write || upload)) return null;
  if (role === 'copy' && c === 'messages' && m === 'POST') return { code: 403, error: 'Make a copy to change this design.', fork: true };
  return { code: 403, error: 'Only the owner can do that.' };
}
/** Close collaborators' live streams on a design (sharing turned off or its mode changed): they reconnect with the new
 *  role, or get a 404 once they are no longer members. */
function dropMemberStreams(id) { for (const r of [...(clients.get(id) || [])]) if (r.formaRole) { try { r.end(); } catch {} clients.get(id)?.delete(r); } }
const COPY_EVENTS = new Set(['title', 'model_updated', 'bom_updated', 'code_updated', 'sketch', 'caption', 'part_preview', 'history_changed', 'run_started', 'run_finished', 'editing_parts']);
/** Which live events a collaborator's stream carries: edit links the design agent's (no website / ads / app / support),
 *  copy links only model changes (no chat). */
const memberEvent = (role, t) => (role === 'edit' ? !/^(site|ads|app)_/.test(String(t)) && t !== 'support_message' : COPY_EVENTS.has(t));
/** GET /api/projects/<id> for a collaborator: the design without the owner's email, website / ads / app, or (copy) chats. */
function memberPayload(acc, id, dir, mem) {
  const p = designPayload('projects', id, dir), edit = mem.role === 'edit';
  return { id, ...p, meta: share.publicMeta(p.meta), messages: edit ? share.labelChat(readJSON(path.join(dir, 'messages.json'), []), acc, id) : [],
    running: runs.has(id), site_running: false, ads_running: false, app_running: false, app: null,
    history: edit ? historyPayload(dir, 'design') : null, sketch: liveSketch(dir),
    role: mem.role, share: { id: mem.shareId, access: mem.role }, owner_name: shareMod.initials(ownerOf(id)) };
}
// ---- security recheck N1: who made a project public is the server's record, not a flag in the project folder (the design
// agent and design.py can write any file there, including for an Edit collaborator). DATA/public.json:
// { published: {id: iso}, guide: {id: iso} }. Seeded once from the old in-folder flags (site/site.json published,
// guide/guide.json share) the first time it doesn't exist.
const PUBLIC_FILE = path.join(DATA, 'public.json');
let publicFlags = null;
function pubFlags() {
  if (publicFlags) return publicFlags;
  publicFlags = readJSON(PUBLIC_FILE, null);
  if (!publicFlags || typeof publicFlags !== 'object') {
    publicFlags = { published: {}, guide: {} };
    for (const id of fs.existsSync(PROJECTS) ? fs.readdirSync(PROJECTS) : []) {
      const dir = projDir(id); if (!dir) continue;
      const site = readJSON(path.join(dir, 'site', 'site.json'));
      if (site?.published) publicFlags.published[id] = site.published_at || new Date().toISOString();
      if (readJSON(path.join(dir, 'guide', 'guide.json'))?.share) publicFlags.guide[id] = new Date().toISOString();
    }
    try { fs.mkdirSync(DATA, { recursive: true }); writeJSON(PUBLIC_FILE, publicFlags); } catch {}
  }
  for (const k of ['published', 'guide']) if (!publicFlags[k] || typeof publicFlags[k] !== 'object') publicFlags[k] = {};
  return publicFlags;
}
const projIdOf = (dir) => (dir && path.dirname(path.resolve(dir)) === PROJECTS ? path.basename(dir) : null);
function publicFlag(kind, id) { return !!id && Object.prototype.hasOwnProperty.call(pubFlags()[kind], id); }
function setPublicFlag(kind, id, on) {
  const f = pubFlags();
  if (on) f[kind][id] = new Date().toISOString(); else delete f[kind][id];
  writeJSON(PUBLIC_FILE, f);
}
/** Projects: the server's record (N1). Examples: their own site.json (shipped with the app, not agent-writable). */
const isPublished = (dir) => { const id = projIdOf(dir); return id ? publicFlag('published', id) : !!readJSON(path.join(dir, 'site', 'site.json'))?.published; };
/** Anyone may see a project's public face (product page, quote, renders) once its owner lists it in the store. */
const canView = (acc, id, dir) => canEdit(acc, id) || (!!dir && isPublished(dir));
function loadOwners() {
  owners = readJSON(OWNERS_FILE, {}) || {};
  let changed = 0;
  for (const id of fs.existsSync(PROJECTS) ? fs.readdirSync(PROJECTS) : []) {
    const dir = projDir(id);
    if (!dir || owners[id] || !exists(path.join(dir, 'meta.json'))) continue;
    owners[id] = LEGACY_OWNER; changed++;
    const meta = readJSON(path.join(dir, 'meta.json'), {});
    if (!meta.owner) { meta.owner = LEGACY_OWNER; writeJSON(path.join(dir, 'meta.json'), meta); }
  }
  if (changed) { fs.mkdirSync(DATA, { recursive: true }); writeJSON(OWNERS_FILE, owners); console.log(`[owners] assigned ${changed} existing project(s) to ${LEGACY_OWNER}`); }
}
/** Agent prompts are capped (cost and abuse). Returns the trimmed text or throws 400. */
function promptText(v) {
  const t = typeof v === 'string' ? v.trim() : '';
  if (t.length > PROMPT_MAX) throw Object.assign(new Error(`That message is too long (${t.length} characters). Keep it under ${PROMPT_MAX}.`), { code: 400 });
  return t;
}

// ---- handoff: "Continue on phone" (server/handoff.js). The studio makes a 2-minute, single-use code for one design; the
// phone opens <public site>/phone/<code>. Online, the gateway redeems it (POST /api/handoff/redeem, gateway only) and signs
// the phone in as the same email; on this Mac (127.0.0.1) a code made by the local admin sets the local admin cookie.
// Local admin -> LOCAL_USER: the email that owns this Mac's designs and is in FORMA_ADMIN_EMAILS, i.e. the account the
// gateway would sign Josh in as. Codes never carry a cookie value or FORMA_LOCAL_TOKEN.
const handoff = require('./handoff').createStore();
const PUBLIC_HOST_RE = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::\d{1,5})?$/;
/** The site the phone should open: the public host the request came through, else the public URL (premake.ai). */
function handoffBase(req) {
  const fwd = viaGateway(req) && String(req.headers['x-forwarded-host'] || '').toLowerCase();
  if (fwd && PUBLIC_HOST_RE.test(fwd)) return 'https://' + fwd;
  if (isLocalRequest(req) && !GATEWAY_URL && !process.env.FORMA_PUBLIC_URL) return `http://${req.headers.host}`;
  return String(process.env.FORMA_PUBLIC_URL || GATEWAY_URL || 'https://premake.ai').replace(/\/+$/, '');
}
/** May this identity open the design? Owner, admin, or a member of its share link. */
const handoffCanOpen = (acc, id) => !!projDir(id) && exists(path.join(projDir(id), 'meta.json')) && (canEdit(acc, id) || !!share.roleFor(acc, id));
const handoffAcc = (r) => ({ authed: true, user: r.who, sid: r.sid, local: r.kind === 'local' });
const handoffPath = (id) => approutes.designPath(id, readJSON(path.join(projDir(id), 'meta.json'), {})?.title);
// same-origin, not no-referrer: with no-referrer the Continue form's POST carries Origin: null, which hostOk refuses
function phonePage(res, code, title, text, form = '') {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex">
<title>${escHtml(title)} · Premake</title><style>*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:16px;background:#fafaf9;color:#1c1917;font:16px/1.5 Inter,system-ui,-apple-system,sans-serif}
main{width:100%;max-width:380px;background:#fff;border:1px solid #e7e5e4;border-radius:16px;padding:28px 22px}h1{font-size:22px;line-height:1.25;margin:0 0 8px;font-weight:650}
p{margin:0 0 20px;color:#6b6560;font-size:15px}b{color:#1c1917;font-weight:600;word-break:break-word}button{width:100%;min-height:50px;font:inherit;font-weight:600;border:0;border-radius:12px;background:#e8590c;color:#fff;cursor:pointer}
a{color:#1c1917;font-size:14px}</style></head><body><main><h1>${escHtml(title)}</h1><p>${text}</p>${form}</main></body></html>`);
}
async function handoffRoute(req, res, { parts, m, acc, url }) {
  // make a code: POST /api/projects/<id>/handoff (signed in; the design must be one you can open)
  if (parts[0] === 'api' && parts[1] === 'projects' && parts[3] === 'handoff' && parts.length === 4) {
    if (m !== 'POST') return send(res, 405, { error: 'POST only' }), true;
    const id = parts[2];
    if (!acc.authed || !acc.user || !acc.sid) return send(res, 401, { error: 'Sign in first.', code: 'signin' }), true;
    if (!handoffCanOpen(acc, id)) return send(res, 404, { error: 'project not found' }), true;
    if (!allow('handoff:' + acc.user, 10, 10 * 60e3) || !allow('handoff-ip:' + clientIp(req), 20, 10 * 60e3)) return send(res, 429, { error: 'That’s a lot of phone codes. Wait a few minutes and try again.' }), true;
    const { token, expires } = handoff.issue({ who: acc.user, kind: acc.local ? 'local' : 'gw', project: id, sid: acc.sid });
    const p = '/phone/' + token;
    return send(res, 200, { url: handoffBase(req) + p, path: p, expires: new Date(expires).toISOString(), ttl_s: Math.round((expires - Date.now()) / 1000) }), true;
  }
  // the gateway redeems (or, for its confirm page, peeks at) a code: server-to-server, gateway secret only
  if (url.pathname === '/api/handoff/redeem') {
    if (!viaGateway(req)) return send(res, 404, { error: 'not found' }), true;
    if (m !== 'POST') return send(res, 405, { error: 'POST only' }), true;
    if (!allow('handoff-redeem:' + clientIp(req), 30, 10 * 60e3)) return send(res, 429, { error: 'Too many tries. Wait a few minutes.' }), true;
    const body = await readBody(req, 4096);
    const token = String(body?.token || '');
    const r = body?.peek ? handoff.peek(token) : handoff.redeem(token);
    if (!r || !USER_RE.test(r.who) || !handoffCanOpen(handoffAcc(r), r.project)) return send(res, 410, { error: 'This code has expired or was already used.' }), true;
    if (!body?.peek) console.log(`[handoff] ${r.kind === 'local' ? 'local admin' : r.who} continued ${r.project} on a phone`);
    return send(res, 200, { email: r.who, path: handoffPath(r.project), title: readJSON(path.join(projDir(r.project), 'meta.json'), {})?.title || 'your design' }), true;
  }
  // /phone/<code> on this Mac (127.0.0.1): a code made by the local admin signs this browser in as the local admin.
  // Online, /phone/ is the gateway's (it never forwards it here).
  if (parts[0] === 'phone' && parts.length === 2 && (acc.local || acc.localGuest)) {
    const token = parts[1];
    const gone = () => phonePage(res, 410, 'This code has expired', 'Codes work once, for 2 minutes. On your computer, open Share, then Continue on phone, for a new one.');
    if (m === 'GET' || m === 'HEAD') {
      const r = handoff.peek(token);
      if (!r || !handoffCanOpen(handoffAcc(r), r.project)) return gone(), true;
      if (r.kind !== 'local') return phonePage(res, 409, 'Open this on your phone', 'This code signs a phone in through Premake online. Scan it with your phone’s camera instead.'), true;
      const title = readJSON(path.join(projDir(r.project), 'meta.json'), {})?.title || 'your design';
      return phonePage(res, 200, 'Continue on this phone', `Open <b>${escHtml(title)}</b> here, signed in as <b>${escHtml(r.who)}</b>.`,
        `<form method="post" action="/phone/${escHtml(token)}"><button type="submit">Continue</button></form>`), true;
    }
    if (m !== 'POST') return send(res, 405, { error: 'GET or POST' }), true;
    if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') return send(res, 403, { error: 'bad origin' }), true;
    const r0 = handoff.peek(token);
    if (!r0 || r0.kind !== 'local' || !handoffCanOpen(handoffAcc(r0), r0.project)) return gone(), true;
    const r = handoff.redeem(token);
    if (!r) return gone(), true;
    const cookies = ['forma_local_out=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'];
    if (LOCAL_TOKEN) cookies.push(`${LOCAL_COOKIE}=${localCookieValue()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`);
    res.writeHead(303, { Location: handoffPath(r.project), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Set-Cookie': cookies });
    return res.end(), true;
  }
  return false;
}

function loginPage(error = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Log in · Premake</title><meta name="robots" content="noindex">
<style>:root{color-scheme:light;--bg:#fafaf9;--card:#fff;--ink:#1c1917;--muted:#6b6560;--line:#e7e5e4;--accent:#e8590c}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 Inter,system-ui,sans-serif;padding:16px}
form{width:100%;max-width:360px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px}
h1{font-size:22px;margin:0 0 6px}p{margin:0 0 18px;color:var(--muted);font-size:14px}
input{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:9px;background:transparent;color:inherit}
button{margin-top:12px;width:100%;font:inherit;font-weight:600;padding:10px;border:0;border-radius:9px;background:var(--accent);color:#fff;cursor:pointer}
.err{color:#d9480f;font-size:14px;margin:10px 0 0}a{color:var(--muted);font-size:14px;display:inline-block;margin-top:14px}</style></head>
<body><form method="post" action="/login"><h1>Sign in to Premake</h1><p>Enter the access password.</p>
<input type="password" name="password" autocomplete="current-password" aria-label="Password" placeholder="Password" required autofocus>
${error ? `<div class="err">${escHtml(error)}</div>` : ''}<button>Log in</button><a href="/">Back to Premake</a></form></body></html>`;
}
function readForm(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > limit) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => resolve(new URLSearchParams(s)));
    req.on('error', reject);
  });
}
function html(res, code, body, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

// ---------------------------------------------------------------- routing
async function handle(req, res) {
  req.t0 = Date.now(); // run timelines count from here (t_send)
  if (req.url === '/healthz') return send(res, 200, { ok: true }); // before the host check: platform health probes use their own Host
  if (!hostOk(req)) return send(res, 403, { error: 'forbidden host/origin' });
  const url = new URL(req.url, `http://${req.headers.host}`);
  let parts;
  try { parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch { return send(res, 400, { error: 'bad path' }); }
  const m = req.method;
  const acc = access(req);

  // payments: Stripe webhook, no login (the gateway lets it through); verified by Stripe-Signature on the raw body
  if (url.pathname === '/stripe/webhook') return payments.webhook(req, res);
  // devices: firmware readings. Device key only: never a session, never local admin (server/devices.js; the gateway passes it)
  if (url.pathname === '/api/d/ingest') return devices.ingest(req, res);
  if (url.pathname === '/api/d/commands') return devices.commands(req, res, url); // controls: firmware long-polls its control state (device key only)
  // firmware: a tiny public counter for desk gadgets (the Wave Buddy). No user data: one number. The gateway passes it.
  if (url.pathname === '/api/version' && (m === 'GET' || m === 'HEAD')) return send(res, 200, { build: assetver.build() }); // assetver: is this tab current?
  if (url.pathname === '/api/stats/today' && (m === 'GET' || m === 'HEAD')) {
    if (!allow('stats:' + clientIp(req), 120, 60e3)) return send(res, 429, { error: 'too many requests' });
    return send(res, 200, statsToday());
  }

  // ---- legal pages (public). One copy in gateway/legal/, served by the gateway and by this server.

  // ---- the bare tunnel URL (not via the gateway, not this Mac): everyone signs in at the gateway instead
  if (ONLINE && !viaGateway(req) && !acc.local && !acc.localGuest) {
    if (GATEWAY_URL && (m === 'GET' || m === 'HEAD')) { res.writeHead(302, { Location: GATEWAY_URL + req.url, 'Cache-Control': 'no-store' }); return res.end(); }
    return send(res, 403, { error: 'Sign in first', signin: GATEWAY_URL ? GATEWAY_URL + '/auth/signin' : null });
  }

  if (await handoffRoute(req, res, { parts, m, acc, url })) return; // handoff: Continue on phone

  // ---- sign-in lives at the gateway (Google). The old password pages just point there.
  // On this Mac, sign out / sign in just toggles the local guest cookie (no Google involved).
  // A3: the one-time link from `node scripts/local-signin.js` sets the local admin cookie on this browser
  if ((acc.local || acc.localGuest) && url.pathname === '/auth/local' && (m === 'GET' || m === 'HEAD')) {
    if (!localCodeOk(url.searchParams.get('code'))) return localPage(res, 403, 'That sign-in link has expired', 'Links work once, for 5 minutes. Make a new one in Terminal:');
    res.writeHead(303, { Location: '/', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      'Set-Cookie': [`${LOCAL_COOKIE}=${localCookieValue()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`, 'forma_local_out=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'] });
    return res.end();
  }
  if ((acc.local || acc.localGuest) && ['/login', '/logout', '/auth/login', '/auth/signin', '/auth/logout'].includes(url.pathname)) {
    const out = url.pathname === '/logout' || url.pathname === '/auth/logout';
    if (!out && acc.noLocalCred) return localPage(res, 200, 'Sign in on this Mac', 'Run this in Terminal. It opens a one-time sign-in link for this browser:');
    // A7: signing out is a POST (a link or image on another site can't sign you out); a GET asks first
    if (out && m !== 'POST') return localPage(res, 200, 'Sign out?', '', true);
    res.writeHead(303, { Location: out ? '/' : safeNextPath(url.searchParams.get('next')), 'Cache-Control': 'no-store', // A1
      'Set-Cookie': out ? 'forma_local_out=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000' : 'forma_local_out=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
    return res.end();
  }
  if (url.pathname === '/login' || url.pathname === '/logout') {
    const to = acc.local ? '/' : url.pathname === '/login' ? '/auth/signin' : '/auth/logout';
    res.writeHead(303, { Location: to, 'Cache-Control': 'no-store' });
    return res.end();
  }
  // local-landing: on this Mac, signed out = premake.ai signed out. / is the public landing page (gateway/home, via
  // server/landing_local.js) and /start is the guest studio. Gateway traffic never gets here as local or localGuest.
  if (acc.local || acc.localGuest) {
    const p = url.pathname;
    if (p.startsWith('/home/') && landingLocal.asset(req, res, p)) return;
    if (acc.localGuest && p === '/' && (m === 'GET' || m === 'HEAD')) return landingLocal.page(req, res);
    // urls: signed out, only the guest pages open the studio; a design, orders, stats... ask to sign in (as the gateway does)
    if (acc.localGuest && (m === 'GET' || m === 'HEAD') && approutes.APP_PAGE.test(p) && !approutes.GUEST_PAGE.test(p)) {
      res.writeHead(302, { Location: '/login?next=' + encodeURIComponent(p + url.search), 'Cache-Control': 'no-store' }); return res.end();
    }
    if (p === '/start' && (m === 'GET' || m === 'HEAD')) {
      if (acc.local) { res.writeHead(302, { Location: '/' + url.search, 'Cache-Control': 'no-store' }); return res.end(); }
      return serveFile(res, WEB, 'index.html');
    }
  }

  admin.touch(acc, req, parts); // admin: presence + first/last seen
  if (parts[0] === 'api' && parts[1] === 'make' && await makefiles.handle(req, res, { parts, m, acc }) !== false) return; // makefiles: the Make tab's downloads (server/makefiles.js)
  if (((parts[0] === 'api' && parts[1] === 'v1') || (parts[0] === 'q' && parts.length === 2)) && await apiv1.handle(req, res, { parts, m, acc, url }) !== false) return; // apiv1: public sourcing API + /q/<id> (server/apiv1.js)
  if (((parts[0] === 'api' && parts[1] === 'fusion') || parts[0] === 'fusion' || parts[0] === 'rfq') && await fusion.handle(req, res, { parts, m, acc, url }) !== false) return; // fusion:
  if (await admin.handle(req, res, { parts, m, acc, url, readBody })) return; // admin: /admin, /api/admin/* (admins only, 404 otherwise)
  if (parts[0] === 'api' && parts[1] === 'call' && await call.handle(req, res, { parts, m, acc, url, readBody })) return; // call: video calls with Josh (server/call.js)
  if (parts[0] === 'api' && parts[1] === 'supportchat' && await supportchat.handle(req, res, { parts, m, acc, url, readBody })) return; // supportchat: "Message us" threads + the admin Inbox (server/supportchat.js)
  if ((parts[0] === 'build' || (parts[0] === 'api' && parts[1] === 'social')) && await social.handle(req, res, { parts, m, acc, readBody })) return; // social: comments, likes, orders feed
  // guide: build guides (server/guide.js): /build/<slug>[/...] (public when shared), POST /api/guide/*, plus the public
  // index /guides and /sitemap.xml, /robots.txt
  if ((parts[0] === 'build' || (parts[0] === 'api' && parts[1] === 'guide') || (parts.length === 1 && ['guides', 'sitemap.xml', 'robots.txt'].includes(parts[0]))) && await guide.handle(req, res, { parts, m, acc, readBody })) return;
  // share: public share links (server/share.js): /d/<id>[/...], GET /api/share/<id>[/quote]
  if ((parts[0] === 'd' || (parts[0] === 'api' && parts[1] === 'share')) && await share.handle(req, res, { parts, m, acc, url, readBody })) return;
  // apps: companion apps (server/apps.js): /apps/<id> shell (owner only), /apps/<id>/ui/* sandboxed, /apps/sdk.js, /apps/sw.js
  if (parts[0] === 'apps' && await apps.handle(req, res, { parts, m, acc, url })) return;

  // ---- API
  if (parts[0] === 'api') {
    const [, a, b, c, d] = parts;
    if (a === 'auth' && !b && m === 'GET') {
      const gw = viaGateway(req);
      return send(res, 200, { hosted: ONLINE, authed: acc.authed, showcase: !acc.authed, login: false, ai: AI_OK, user: acc.user || null, admin: isAdmin(acc),
        local: !!acc.local, signin: !acc.authed ? (gw ? '/auth/signin' : acc.localGuest ? '/login' : null) : null,
        logout: acc.authed ? (gw ? '/auth/logout' : acc.local ? '/logout' : null) : null,
        message: acc.authed ? (AI_OK ? '' : AI_DOWN_MSG) : SHOWCASE_MSG,
        limits: { runs_per_hour: RUNS_PER_HOUR, runs_per_day: RUNS_PER_DAY, concurrent: MAX_CONCURRENT, prompt_max: PROMPT_MAX } });
    }
    // Signed out: browse only. Writes are refused (except the public waitlist form on deployed product pages).
    if (!acc.authed) {
      if (m !== 'GET' && m !== 'HEAD' && !(a === 'site' && b === 'waitlist') && a !== 'checkout' && a !== 'orders') return send(res, 401, { error: SHOWCASE_MSG, code: 'signin' });
      if (a === 'projects') return b ? send(res, 404, { error: 'project not found' }) : send(res, 200, []);
    }
    // Project-scoped reads/writes outside /api/projects/<id> (quote, ads, site, publish): owner or admin; the public face
    // of a published project (site page + quote) is open to everyone.
    {
      const pid = url.searchParams.get('project');
      if (pid && ['ads', 'site', 'quote', 'sourcing'].includes(a)) { // sourcing: same rules as quote
        const pdir = projDir(pid);
        const pub = (a === 'site' || a === 'quote' || a === 'sourcing') && !b && m === 'GET';
        if (!pdir || !(canEdit(acc, pid) || (pub && (canView(acc, pid, pdir) || (a !== 'site' && share.roleFor(acc, pid)))))) return send(res, 404, { error: 'not found' }); // share: collaborators see the price
      }
    }
    // agentbrain: the signed-in user's design-agent prefs: effort (allowlisted) and remembered question-card answers
    if (a === 'prefs' && !b && (m === 'GET' || m === 'PUT')) {
      if (!acc.user) return send(res, 401, { error: 'Sign in first.' });
      if (m === 'PUT') {
        const body = await readBody(req, 4e3);
        if (body.effort !== undefined && !prefs.setEffort(acc.user, body.effort)) return send(res, 400, { error: `effort must be one of ${brain.EFFORTS.join(', ')}` });
        if (typeof body.forget === 'string') prefs.forget(acc.user, body.forget);
      }
      const p = prefs.get(acc.user);
      return send(res, 200, { effort: p.effort || brain.DEFAULT_EFFORT, efforts: brain.EFFORTS, default_effort: brain.DEFAULT_EFFORT,
        answers: Object.entries(p.answers).map(([id, v]) => ({ id, question: v.q, answer: v.a })) });
    }
    if (a === 'examples' && !b && m === 'GET') {
      const out = [];
      for (const slug of exampleSlugs()) {
        const dir = exDir(slug);
        if (!dir || !exists(path.join(dir, 'meta.json'))) continue;
        const meta = readJSON(path.join(dir, 'meta.json'), {});
        out.push({ slug, title: meta.title || slug, description: meta.description || '', creator: meta.creator || '', tags: meta.tags || [],
          thumb: vurl(dir, 'thumb.png', `/files/examples/${slug}/thumb.png`), demo: meta.demo !== false, ...cardStats(dir), ...social.cardStats(slug) }); // social: likes, remixes, comments
      }
      return send(res, 200, out);
    }
    if (a === 'examples' && b && c === 'sections' && !d && m === 'GET') { // sections: cached in DATA/.sections, never the example's folder
      const dir = exDir(b);
      if (!dir || !exists(path.join(dir, 'meta.json'))) return send(res, 404, { error: 'example not found' });
      return send(res, 200, await designSections(dir, path.join(DATA, '.sections', `${b}.json`), !!acc.authed));
    }
    if (a === 'examples' && b && !c && m === 'GET') {
      const dir = exDir(b);
      if (!dir || !exists(path.join(dir, 'meta.json'))) return send(res, 404, { error: 'example not found' });
      return send(res, 200, { slug: b, ...designPayload('examples', b, dir), app: apps.exampleInfo(b, dir) }); // app-preview: "Try the app"
    }
    if (a === 'projects' && !b && m === 'GET') {
      const out = [];
      for (const id of fs.existsSync(PROJECTS) ? fs.readdirSync(PROJECTS) : []) {
        const dir = projDir(id);
        if (!dir || !exists(path.join(dir, 'meta.json'))) continue;
        // Your own projects only. Admins see everyone's with ?all=1 (the sidebar stays personal).
        const mine = ownerOf(id) === acc.user;
        if (!mine && !(isAdmin(acc) && url.searchParams.get('all') === '1')) continue;
        const meta = readJSON(path.join(dir, 'meta.json'), {});
        out.push({ id, title: meta.title || 'Untitled', updated: projectUpdated(dir), ...(meta.example_copy && !readJSON(path.join(dir, 'messages.json'), []).length ? { example: true } : {}), running: runs.has(id), site_running: siteRuns.has(id), ads_running: adsRuns.has(id), app_running: appRuns.has(id),
          step: lastStepOf(runs.get(id) || siteRuns.get(id) || adsRuns.get(id) || appRuns.get(id)), // sidebar: what a running project is doing right now
          thumb: vurl(dir, 'thumb.png', `/files/projects/${id}/thumb.png`), ...cardStats(dir), ...(mine ? {} : { owner: ownerOf(id) }),
          ...(meta.replay?.pending ? { thumb: null, price_each: null, running: true, step: 'Designing' } : {}) }); // replay: looks like the new design it is until it has played
      }
      // share: designs shared with you (you opened their edit / copy link), marked shared: 'edit' | 'copy'
      for (const sh of share.sharedWith(acc.user)) {
        const dir = projDir(sh.project);
        if (!dir || !exists(path.join(dir, 'meta.json')) || out.some((p) => p.id === sh.project)) continue;
        const meta = readJSON(path.join(dir, 'meta.json'), {});
        out.push({ id: sh.project, title: meta.title || 'Untitled', updated: projectUpdated(dir), running: runs.has(sh.project), shared: sh.role,
          thumb: vurl(dir, 'thumb.png', `/files/projects/${sh.project}/thumb.png`), ...cardStats(dir) });
      }
      out.sort((x, y) => String(y.updated).localeCompare(String(x.updated)));
      return send(res, 200, out);
    }
    if (a === 'projects' && !b && m === 'POST') {
      const body = await readBody(req);
      const prompt = promptText(body.prompt);
      if (prompt) agentGate(acc);
      if (!allow('create:' + acc.user, 60, 3600e3)) return send(res, 429, { error: 'That is a lot of new projects this hour. Try again later.' });
      const fromProject = typeof body.fromProject === 'string' ? body.fromProject : undefined; // duplicate: only your own (or admin)
      if (fromProject && !(projDir(fromProject) && canEdit(acc, fromProject))) return send(res, 404, { error: 'project not found' });
      const rp = prompt && !body.fromExample && !body.fromShare && !fromProject ? replayFor(prompt) : null; // replay: a recorded real run
      if (rp) return send(res, 200, { id: startReplay(rp, prompt, acc.user), replay: true });
      const id = createProject({ fromExample: body.fromExample, fromShare: typeof body.fromShare === 'string' ? body.fromShare : undefined, fromProject, ref: body.ref, owner: acc.user, prompt: !!prompt });
      if (prompt) startRun(id, prompt, req.t0);
      return send(res, 200, { id });
    }
    if (a === 'projects' && b) {
      const dir = projDir(b);
      // Not yours (and not an admin), and not shared with you: it doesn't exist, as far as you can tell.
      if (!dir || !exists(path.join(dir, 'meta.json'))) return send(res, 404, { error: 'project not found' });
      const owner = canEdit(acc, b);
      const mem = owner ? null : share.roleFor(acc, b); // share: a member of its edit / copy link ({ role, shareId })
      if (!owner && !mem) return send(res, 404, { error: 'project not found' });
      // firmware: compile + flash (server/firmware.js). Owner, admin or an edit collaborator; copy links can't.
      if (c === 'firmware') {
        if (mem && mem.role !== 'edit') return send(res, 403, { error: 'Only the owner can do that.' });
        return firmware.api(req, res, { id: b, dir, sub: d || '', m, readBody, canWrite: true });
      }
      if (mem) {
        const why = memberRefusal(mem.role, c, d, m);
        if (why) return send(res, why.code, { error: why.error, ...(why.fork ? { code: 'fork', share: mem.shareId } : {}) });
      }
      if (!c && m === 'GET') {
        if (mem) return send(res, 200, memberPayload(acc, b, dir, mem));
        const pl = designPayload('projects', b, dir); let msgs = readJSON(path.join(dir, 'messages.json'), []);
        if (pl.meta?.replay?.pending) msgs = msgs.filter((x) => x.role === 'user'); // replay: the reply arrives when the replay ends
        return send(res, 200, { id: b, ...pl, messages: share.labelChat(msgs, acc, b), running: runs.has(b), site_running: siteRuns.has(b), ads_running: adsRuns.has(b),
          app_running: appRuns.has(b), app: apps.info(dir), // apps: the App tab shows when the design has electronics or an app/
          firmware: firmware.status(b, dir), // firmware: sketch, board, compile state (the Flash button)
          history: historyPayload(dir, 'design'), sketch: liveSketch(dir), role: 'owner' });
      }
      if (c === 'sections' && !d && m === 'GET') return send(res, 200, await designSections(dir, path.join(dir, 'sections.json'), true)); // sections: Parts panel groups
      if (c === 'replay-done' && !d && m === 'POST' && owner) { // replay: played once; the live agent takes over in a clean folder
        const mf = path.join(dir, 'meta.json'), meta = readJSON(mf, {});
        if (meta.replay?.pending) { meta.replay.pending = false; writeJSON(mf, meta); }
        fs.rmSync(path.join(dir, 'replay'), { recursive: true, force: true });
        return send(res, 200, { ok: true });
      }
      // agentbrain: rename (the owner's own title wins over the auto title)
      if (!c && m === 'PATCH') {
        const body = await readBody(req, 2e3);
        const title = brain.cleanUserTitle(body.title);
        if (!title) return send(res, 400, { error: 'Title must be 1-80 characters.' });
        const mf = path.join(dir, 'meta.json'), meta = readJSON(mf, {});
        meta.title = title; meta.title_auto = false;
        writeJSON(mf, meta);
        emit(b, { type: 'title', title });
        return send(res, 200, { ok: true, title });
      }
      // Delete a design (owner only). Soft: the folder moves to DATA/.trash/<id>-<time>, so it can be restored by hand.
      if (!c && m === 'DELETE') {
        if (mem) return send(res, 403, { error: 'Only the owner can delete this design.' });
        if (runs.has(b) || siteRuns.has(b) || adsRuns.has(b) || appRuns.has(b)) return send(res, 409, { error: 'Stop the running change first, then delete.' });
        const trash = ensureDir(path.join(DATA, '.trash', 'x'));
        fs.renameSync(dir, path.join(path.dirname(trash), `${b}-${Date.now()}`));
        console.log(`[delete] project ${b} moved to trash`);
        return send(res, 200, { ok: true });
      }
      // Pre-warm (studio open, composer focus/typing): a ready design agent + build worker. Cheap, idempotent, never starts a turn.
      if (c === 'warm' && !d && m === 'POST') {
        if (!acc.user || !allow('warm:' + acc.user, 300, 3600e3)) return send(res, 200, { ok: false });
        const r = { ok: true, agent: runs.has(b) ? 'running' : warmAgent(b), worker: warmWorker(b) };
        if (isStubDesign(dir)) r.sketch = warmSketch(); // a new design: its first message also gets an instant sketch
        return send(res, 200, r);
      }
      if (['rewind', 'undo', 'redo', 'restore'].includes(c) && !d && m === 'POST') {
        const body = await readBody(req, 1e4);
        if (mem) body.kind = 'design'; // share: collaborators only ever touch the design's history
        const r = historyAction(b, dir, c, body);
        return send(res, 200, { ...r, messages: share.labelChat(r.messages, acc, b) });
      }
      if (c === 'versions' && !d && m === 'GET') { const k = mem ? 'design' : url.searchParams.get('kind'); return send(res, 200, historyPayload(dir, k === 'site' || k === 'ads' || k === 'app' ? k : 'design')); }
      if (c === 'share' && !d) return share.api(req, res, { id: b, dir, m, readBody, onChange: () => dropMemberStreams(b) }); // share: owner/admin sets the link (members' streams reconnect with their new role, or lose access)
      if (c === 'colors' && !d && m === 'POST') return send(res, 200, setPartColor(b, dir, await readBody(req, 2e3))); // colours: hover tooltip swatches
      if (c === 'uploads') return uploads.api(req, res, { id: b, dir, acc, d, m }); // images: POST image / DELETE unsent image
      if (c === 'messages' && m === 'POST') {
        const body = await readBody(req);
        const att = uploads.pick(dir, body.attachments); // images:
        const text = uploads.withImages(promptText(body.text), att, dir); // images: appends the ./uploads/ file list for the agent
        if (!text) return send(res, 400, { error: 'text required' });
        if (runs.has(b)) return send(res, 409, { error: 'a run is already active' });
        agentGate(acc); // the sender's own run quota (a collaborator's runs count against them, not the owner)
        if (body.answers && typeof body.answers === 'object') { // agentbrain: question-card answers, remembered for this user
          const asked = [...readJSON(path.join(dir, 'messages.json'), [])].reverse().find((x) => x.role === 'assistant')?.questions;
          prefs.saveAnswers(acc.user, brain.cleanAnswers((asked || []).filter((q) => q.id !== brain.FINISH_ID), body.answers)); // the finish card is a one-off
        }
        startRun(b, text, req.t0, mem ? share.writerTag(acc) : null); // share: a collaborator's message is labelled with their initials
        uploads.tag(path.join(dir, 'messages.json'), text, att, b); // images: thumbnails in the chat history
        return send(res, 202, { ok: true });
      }
      if (c === 'stop' && m === 'POST') return send(res, 200, { ok: true, stopped: stopRun(b) });
      // launch (demo): static deploy, domain pick, ad campaign record
      if (c === 'launch' && !d && m === 'GET') return send(res, 200, launchPayload(b, dir));
      if (c === 'deploy' && !d && m === 'POST') return send(res, 200, deploySite(b, dir, await readBody(req, 4e6)));
      // Custom domains and ad campaigns are not built yet (the old endpoints only stored a record): coming soon.
      if (c === 'launch' && (d === 'domain' || d === 'campaign')) return send(res, 410, { error: 'Custom domains and ads are coming soon.' });
      // website chat: its own agent + session, edits ./site/** only
      if (c === 'site' && d === 'messages' && m === 'GET') {
        return send(res, 200, { messages: readJSON(path.join(dir, 'site', 'messages.json'), []), running: siteRuns.has(b), history: historyPayload(dir, 'site') });
      }
      if (c === 'site' && d === 'messages' && m === 'POST') {
        const body = await readBody(req);
        const att = uploads.pick(dir, body.attachments); // images:
        const text = uploads.withImages(promptText(body.text), att); // images:
        if (!text) return send(res, 400, { error: 'text required' });
        if (siteRuns.has(b)) return send(res, 409, { error: 'the page editor is already working' });
        agentGate(acc);
        startSiteRun(b, text);
        uploads.tag(path.join(dir, 'site', 'messages.json'), text, att, b); // images:
        return send(res, 202, { ok: true });
      }
      if (c === 'site' && d === 'stop' && m === 'POST') return send(res, 200, { ok: true, stopped: stopRun(b, 'site') });
      // ads chat: its own agent + session, edits ./ads/ads.json only
      if (c === 'ads' && d === 'messages' && m === 'GET') {
        return send(res, 200, { messages: readJSON(path.join(dir, 'ads', 'messages.json'), []), running: adsRuns.has(b), history: historyPayload(dir, 'ads'),
          has_ads: !!readJSON(path.join(dir, 'ads', 'ads.json'))?.ads?.length });
      }
      if (c === 'ads' && d === 'messages' && m === 'POST') {
        const body = await readBody(req);
        const att = uploads.pick(dir, body.attachments); // images:
        const text = uploads.withImages(promptText(body.text), att); // images:
        if (!text) return send(res, 400, { error: 'text required' });
        if (adsRuns.has(b)) return send(res, 409, { error: 'the ads agent is already working' });
        if (adsJobs.has(`projects:${b}`)) return send(res, 409, { error: 'Ads are being generated. Wait for them to finish.' });
        if (!readJSON(path.join(dir, 'ads', 'ads.json'))?.ads?.length) return send(res, 409, { error: 'Generate the ads first, then ask for changes here.' });
        agentGate(acc);
        startAgent(b, 'ads', text);
        uploads.tag(path.join(dir, 'ads', 'messages.json'), text, att, b); // images:
        return send(res, 202, { ok: true });
      }
      if (c === 'ads' && d === 'stop' && m === 'POST') return send(res, 200, { ok: true, stopped: stopRun(b, 'ads') });
      // apps: app chat: its own agent + session, edits ./app/** only (server/apps.js, server/app_agent_prompt.md)
      if (c === 'app' && d === 'messages' && m === 'GET') {
        return send(res, 200, { messages: readJSON(chatFile(dir, 'app'), []), running: appRuns.has(b), history: historyPayload(dir, 'app'), info: apps.info(dir) });
      }
      if (c === 'app' && d === 'messages' && m === 'POST') {
        const text = promptText((await readBody(req)).text); // text only: the app agent can't read ./uploads (Read is ./app/** only)
        if (!text) return send(res, 400, { error: 'text required' });
        if (appRuns.has(b)) return send(res, 409, { error: 'the app agent is already working' });
        agentGate(acc);
        startAgent(b, 'app', text);
        return send(res, 202, { ok: true });
      }
      if (c === 'app' && d === 'stop' && m === 'POST') return send(res, 200, { ok: true, stopped: stopRun(b, 'app') });
      // support chat with a human (no agent): <project>/support/messages.json
      if (c === 'support' && !d && m === 'GET') {
        const isAdm = isAdmin(acc);
        markSupportRead(dir, isAdm ? 'josh' : 'user');
        return send(res, 200, { messages: readJSON(path.join(dir, 'support', 'messages.json'), []), admin: isAdm, reply_hint: 'Usually replies within a few hours', admin_online: admin.adminOnline() }); // admin: presence
      }
      if (c === 'support' && !d && m === 'POST') {
        if (!allow('support:' + (acc.sid || clientIp(req)), 30, 3600e3)) return send(res, 429, { error: 'That is a lot of messages this hour. Try again later.' });
        const body = await readBody(req, 2e4);
        const msg = addSupportMessage(b, dir, acc, body);
        return send(res, 200, { ok: true, message: msg, messages: readJSON(path.join(dir, 'support', 'messages.json'), []) });
      }
      // Polling fallback for clients whose SSE doesn't deliver: events since <since> (same shapes as SSE), plus live partial text.
      if (c === 'run' && !d && m === 'GET') {
        pollSeen.set(b, Date.now()); ensureWatcher(b);
        const since = Number(url.searchParams.get('since'));
        const log = projLog.get(b) || [];
        const fresh = url.searchParams.get('boot') !== BOOT || !Number.isFinite(since) || (log.length && log[0].seq > since + 1);
        let events;
        if (fresh) {
          events = [];
          for (const run of [runs.get(b), siteRuns.get(b), adsRuns.get(b), appRuns.get(b)].filter(Boolean)) {
            events.push({ type: run.P + 'run_started', replay: true, t: run.startedAt / 1000 }, ...run.events.map(ev => ({ ...ev, replay: true })));
          }
        } else events = log.filter(ev => ev.seq > since);
        if (mem) { // share: collaborators see the design agent only (copy links: model updates, no chat)
          events = events.filter(ev => memberEvent(mem.role, ev.type));
          const dr = runs.get(b), live = mem.role === 'edit';
          return send(res, 200, { boot: BOOT, seq: EVENT_SEQ, reset: !!fresh, running: !!dr, site_running: false, ads_running: false, app_running: false, events,
            partial: live ? dr?.partial || '' : '', thinking: live ? dr?.thinking || '' : '' });
        }
        const dr = runs.get(b), sr = siteRuns.get(b), ar = adsRuns.get(b), pr = appRuns.get(b);
        return send(res, 200, { boot: BOOT, seq: EVENT_SEQ, reset: !!fresh, running: !!dr, site_running: !!sr, ads_running: !!ar, app_running: !!pr, events,
          partial: dr?.partial || '', thinking: dr?.thinking || '', site_partial: sr?.partial || '', site_thinking: sr?.thinking || '',
          ads_partial: ar?.partial || '', ads_thinking: ar?.thinking || '', app_partial: pr?.partial || '', app_thinking: pr?.thinking || '' });
      }
      if (c === 'events' && m === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(`retry: 2000\n\n`);
        // A data event (not a comment) so the browser can tell the stream is really delivering.
        res.write(`data: ${JSON.stringify({ type: 'hello', boot: BOOT, seq: EVENT_SEQ })}\n\n`);
        if (!clients.has(b)) clients.set(b, new Set());
        if (mem) res.formaRole = mem.role; // share: emitLive filters what a collaborator's stream carries
        clients.get(b).add(res);
        ensureWatcher(b);
        // replay in-flight runs (steps since run start) so a reload or reconnect shows the full live state
        for (const run of (mem ? [runs.get(b)] : [runs.get(b), siteRuns.get(b), adsRuns.get(b), appRuns.get(b)]).filter(Boolean)) {
          res.write(`data: ${JSON.stringify({ type: run.P + 'run_started', replay: true, t: run.startedAt / 1000 })}\n\n`);
          for (const ev of run.events) if (!mem || memberEvent(mem.role, ev.type)) res.write(`data: ${JSON.stringify({ ...ev, replay: true })}\n\n`);
        }
        const ping = setInterval(() => res.write(`data: {"type":"ping"}\n\n`), 15000);
        req.on('close', () => { clearInterval(ping); clients.get(b)?.delete(res); });
        return;
      }
    }
    if (a === 'sourcing' && !b && m === 'GET') return sourcing.handle(req, res, url); // sourcing: where to source each part (server/sourcing.js)
    if (a === 'quote' && !b && m === 'GET') {
      const mode = url.searchParams.get('mode') === 'kit' ? 'kit' : 'assembled';
      const pid = url.searchParams.get('project'); const ex = url.searchParams.get('example');
      const dir = pid ? projDir(pid) : ex ? exDir(ex) : null;
      if (!dir || !exists(dir)) return send(res, 404, { error: 'not found' });
      const op = orderPriceQuery(url, readJSON(path.join(dir, 'bom.json'), {}), dir); // order tab: one at-cost price for any quantity, same as checkout
      if (op) return send(res, op.error ? 400 : 200, op);
      return send(res, 200, quote(readJSON(path.join(dir, 'bom.json'), {}), mode, dir)); // prices: dir = print source + Slant cache
    }
    if (a === 'pricing' && b === 'print-source' && !c && m === 'POST') { // prices: admin per-design in-house / Slant 3D override
      return prices.handle(req, res, await readBody(req, 1e4), { acc, isAdmin, projDir, exDir, send });
    }
    if (a === 'ads' && !b && m === 'GET') {
      const src = adsSource({ project: url.searchParams.get('project'), example: url.searchParams.get('example') });
      if (!src) return send(res, 404, { error: 'not found' });
      const job = adsJobs.get(`${src.kind}:${src.id}`);
      const ads = readJSON(path.join(src.dir, 'ads', 'ads.json'));
      return send(res, 200, { ads, base: `/files/${src.kind}/${src.id}/`, running: !!job, stage: job?.stage || null,
        price: retailPrice(readJSON(path.join(src.dir, 'bom.json'), {})), has_model: exists(path.join(src.dir, 'manifest.json')) });
    }
    if (a === 'ads' && b === 'generate' && m === 'POST') {
      const src = writableSource(acc, await readBody(req));
      if (!src) return send(res, 404, { error: 'design not found' });
      if (adsJobs.has(`${src.kind}:${src.id}`)) return send(res, 409, { error: 'Ads are already being generated for this design' });
      if (src.kind === 'projects' && adsRuns.has(src.id)) return send(res, 409, { error: 'The ads chat is editing these ads. Wait for it to finish.' });
      agentGate(acc);
      const ads = await generateAds(src);
      return send(res, 200, { ads, base: `/files/${src.kind}/${src.id}/` });
    }
    if (a === 'ads' && !b && m === 'PUT') {
      const body = await readBody(req);
      const src = writableSource(acc, body);
      if (!src) return send(res, 404, { error: 'design not found' });
      return send(res, 200, { ads: saveAdsEdits(src, body.ads) });
    }
    if (a === 'site' && !b && (m === 'GET' || m === 'PUT')) {
      const body = m === 'PUT' ? await readBody(req) : {};
      const src = m === 'PUT' ? writableSource(acc, body) : adsSource({ project: url.searchParams.get('project'), example: url.searchParams.get('example') });
      if (!src) return send(res, 404, { error: 'design not found' });
      if (m === 'PUT') saveSiteCopy(src, body.copy);
      return send(res, 200, sitePayload(src));
    }
    // home prompt focus/typing: pre-warm the single-use sketch process for the new design about to be created
    if (a === 'warm' && !b && m === 'POST') {
      if (!acc.user || !allow('warm:' + acc.user, 300, 3600e3)) return send(res, 200, { ok: false });
      return send(res, 200, { ok: true, sketch: warmSketch() });
    }
    if (a === 'stats' && !b && m === 'GET') {
      if (!isAdmin(acc)) return send(res, 403, { error: 'admins only' });
      const kind = url.searchParams.get('kind');
      return send(res, 200, runStats(Math.min(500, Math.max(1, Number(url.searchParams.get('n')) || 50)), kind === 'all' ? null : (kind || 'design')));
    }
    if (a === 'support' && b === 'inbox' && !c && m === 'GET') {
      if (!isAdmin(acc)) return send(res, 403, { error: 'admins only' });
      return send(res, 200, supportInbox());
    }
    if (a === 'store' && !b && m === 'GET') {
      return send(res, 200, storeListings({ q: url.searchParams.get('q'), category: url.searchParams.get('category') }));
    }
    if (a === 'site' && (b === 'publish' || b === 'unpublish') && !c && m === 'POST') {
      const body = await readBody(req, 1e4);
      if (!body.project) return send(res, 400, { error: 'Only your own projects can be listed' });
      const src = writableSource(acc, { project: body.project });
      if (!src) return send(res, 404, { error: 'project not found' });
      return send(res, 200, setPublished(src, b === 'publish'));
    }
    if (a === 'site' && b === 'waitlist' && m === 'POST') {
      const body = await readBody(req, 1e4);
      const src = adsSource(body);
      // Public form on product pages: only for pages that are public (listed in the store, deployed, or an example).
      if (!src || (src.project && !canEdit(acc, src.id) && !isPublished(src.dir) && !readLaunch(src.dir).site?.slug)) return send(res, 404, { error: 'design not found' });
      if (!allow('waitlist:' + (acc.user || clientIp(req)), 20, 3600e3)) return send(res, 429, { error: 'Too many sign-ups from here. Try again later.' });
      return send(res, 200, joinWaitlist(src, body));
    }
    // devices: companion-app sensors, readings, photo checks, push alerts (server/devices.js, server/push.js); owner only, 404 otherwise
    if (a === 'apps' && c === 'link' && !d && await apps.linkApi(req, res, { id: b, m, acc })) return; // app-preview: phone preview link (owner only)
    if (['apps', 'devices', 'push'].includes(a) && await devices.api(req, res, { parts, m, acc, url })) return;
    // payments: /api/checkout, /api/checkout/config, /api/orders[...] (server/payments.js; replaces the demo placeOrder)
    if ((a === 'checkout' || a === 'orders') && await payments.api(req, res, { a, b, c, m, url, acc })) return;
    return send(res, 404, { error: 'no such endpoint' });
  }

  if (m !== 'GET' && m !== 'HEAD') return send(res, 405, { error: 'method not allowed' });

  // ---- design-dir files
  if (parts[0] === 'files') {
    const [, kind, id, ...rest] = parts;
    const root = kind === 'projects' ? projDir(id) : kind === 'examples' ? exDir(id) : null;
    if (!root || !rest.length) return send(res, 404, { error: 'not found' });
    // Project files: owner or admin. A published project shows its model and pictures to everyone, never its chats or code.
    if (kind === 'projects' && !canEdit(acc, id)) {
      const rel = rest.join('/');
      const publicFile = /^(thumb\.png|manifest\.json|stl\/[\w.-]+\.stl|ads\/renders\/[\w.-]+\.png)$/.test(rel);
      // share: collaborators get the model (and, on edit links, the chat's images); never meta, chats, code files or the rest
      const mem = share.roleFor(acc, id);
      const memberFile = !!mem && (/^(thumb\.png|manifest\.json|stl\/[\w.-]+\.stl)$/.test(rel) || (mem.role === 'edit' && /^uploads\/[\w-][\w.-]*$/.test(rel)));
      if (!memberFile && (!publicFile || !isPublished(root))) return send(res, 404, { error: 'not found' });
    }
    return serveFile(res, root, rest.join('/'), { noCache: true, sandbox: true });
  }

  // ---- deployed product sites (demo hosting): /s/<slug>/
  if (parts[0] === 's') {
    const [, slug, ...rest] = parts;
    const root = deployDir(slug);
    if (!root || !exists(path.join(root, 'index.html'))) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><meta charset="utf-8"><title>Not deployed</title><body style="font:16px system-ui;margin:4rem auto;max-width:32rem;padding:0 16px"><h1>Nothing deployed here</h1><p>This site has not been deployed yet, or it was moved.</p></body>');
    }
    if (!rest.length && !url.pathname.endsWith('/')) { res.writeHead(301, { Location: `/s/${slug}/` }); return res.end(); }
    res.setHeader('Content-Security-Policy', DEPLOY_CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return serveFile(res, root, rest.length ? rest.join('/') : 'index.html', { noCache: true });
  }

  // ---- static web app
  // urls: the studio's clean URLs are pages of the app itself (index.html, same access as /); files keep their own paths
  if (approutes.APP_PAGE.test(url.pathname) && approutes.wantsHtml(req)) return serveFile(res, WEB, 'index.html');
  const rel = parts.length ? parts.join('/') : 'index.html';
  if (rel === 'index.html' && !exists(path.join(WEB, 'index.html'))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(PLACEHOLDER);
  }
  return serveFile(res, WEB, rel, { v: url.searchParams.get('v') });
}

loadAgentPrompt();
loadSitePrompt();
loadAdsPrompt();
fs.watchFile(AGENT_PROMPT_FILE, { interval: 2000 }, loadAgentPrompt);
fs.watchFile(LESSONS_FILE, { interval: 2000 }, loadAgentPrompt);
fs.watchFile(SITE_PROMPT_FILE, { interval: 2000 }, loadSitePrompt);
fs.watchFile(ADS_PROMPT_FILE, { interval: 2000 }, loadAdsPrompt);
fs.mkdirSync(PROJECTS, { recursive: true });
loadOwners();
// Deployed pages embed WAITLIST_JS (allowed by its CSP hash). Bring pages deployed with an older copy up to date.
for (const slug of fs.existsSync(DEPLOYS) ? fs.readdirSync(DEPLOYS) : []) {
  const f = path.join(deployDir(slug) || '/nonexistent', 'index.html');
  const h = readText(f);
  if (!h) continue;
  const next = h.replace(/<script>[\s\S]*?<\/script>/, () => `<script>${WAITLIST_JS}</script>`);
  if (next !== h) { fs.writeFileSync(f + '.tmp', next); fs.renameSync(f + '.tmp', f); console.log(`[deploys] updated the waitlist script on /s/${slug}/`); }
}

// payments: Stripe Checkout + webhook + orders (server/payments.js, setup in PAYMENTS.md)
const analytics = require('./analytics'); // analytics: checkout_completed to PostHog when an order is paid (onPaid below)
const payments = require('./payments').init({ priceFor, readJSON, writeJSON, projDir, exDir, exists, send, ORDERS, DATA, TRANSIT_DAYS,
  canOrder: (acc, id) => canView(acc, id, projDir(id)) || share.isShared(id) || guide.isShared(id),
  onPaid: (o) => { analytics.orderPaid(o); return fulfilment.onPaid(o); } }); // per-user projects: order your own, anything listed in the store, (share:) a design with a live share link, or (guide:) one with a public build guide
// guide: build guides ("Generate instructions"): server/guide.js
// share: public share links (/d/<id>): server/share.js
const shareMod = require('./share');
const share = shareMod.init({ DATA, PROJECTS, EXAMPLES, exDir, readJSON, writeJSON, exists, send, serveFile, escHtml, allow, hitCount, clientIp, quote,
  designDims, viaGateway, ownerOf, cardStats, canEdit, orderPriceQuery });
const guide = require('./guide').init({ DATA, APP, VENV_PY, CLAUDE, get MODEL() { return FORMA_MODEL; }, PROJECTS, EXAMPLES, exDir, exampleSlugs, readJSON, writeJSON, readText, exists, send, quote,
  canEdit, isAdmin, isPublished, publicFlag, setPublicFlag, agentGate, agentEnv, runProc, childEnv, renderSpawn, escHtml, allow, clientIp, cardStats, serveFile, ownerOf, orderPriceQuery });
// local-landing: the public landing page for a signed-out local guest (server/landing_local.js reuses gateway/home)
// showcase: the owner's finished designs published as examples (server/showcase.js); synced at boot, every 3 min, after design runs
showcase = require('./showcase').init({ DATA, PROJECTS, EXAMPLES, OWNERS: SHOWCASE_OWNERS, readJSON, writeJSON, ownerOf,
  busy: (id) => runs.has(id) || siteRuns.has(id) || adsRuns.has(id) || appRuns.has(id), priceOf: (dir) => cardStats(dir).price_each });
// social: real comments and likes, and the recent-designs strip (server/social.js). No made-up activity is shown.
const social = require('./social').init({ APP, DATA, PROJECTS, exDir, exampleSlugs, showcase, cardStats, vurl, readJSON, writeJSON, send, isAdmin, ownerOf, canEdit, isShared: (id) => guide.isShared(id), allow });
const landingLocal = require('./landing_local').init({ exampleSlugs, exDir, readJSON, vurl, quote, social });
const sourcing = require('./sourcing').init({ DATA, projDir, exDir, exists, readJSON, writeJSON, send, quote }); // sourcing: live Slant 3D quotes + supplier links
prices.attach({ sourcing }); // prices: Slant 3D cache for designs printed by Slant
// fulfilment: paid order -> supplier jobs Josh places from /admin (server/fulfilment/, FULFILMENT.md)
const fulfilment = require('./fulfilment').init({ DATA, ORDERS, readJSON, writeJSON, send, sourcing, plateDxf: sourcing.plateDxf, projDir, exDir });
// call: video calls with Josh (WebRTC, short-poll signaling, in-memory state): server/call.js
const call = require('./call').init({ DATA, readJSON, writeJSON, exists, projDir, send, isAdmin, canEdit, allow, addSupportMessage });
const supportchat = require('./supportchat').init({ DATA, send, allow, isAdmin, notifyAdmin }); // supportchat: per-user support threads
// devices: companion-app devices, ingest, readings, alerts (+ stale timer), photo checks, Web Push: server/devices.js, server/push.js
const devices = require('./devices').init({ DATA, PROJECTS, projDir, ownerOf, agentEnv, runProc, CLAUDE, get MODEL() { return FORMA_MODEL; } });
firmware.init({ DATA, APP, readJSON, writeJSON, send, emit }); // firmware: compiles in the sandbox, one at a time
apps.init({ PROJECTS, WEB, DATA, projDir, exDir, ownerOf, readJSON, readText, send, canEdit, allow }); // apps: companion apps + the app agent (server/apps.js)

fusion.init({ DATA, send, readBody, allow, rmfg: require('./prices/rmfg').init(DATA), afn: require('./prices/afn').init(DATA), materiam: require('./prices/materiam').init(DATA), // fusion:
  BASE: (req) => (viaGateway(req) ? (process.env.FORMA_PUBLIC_URL || 'https://premake.ai') : `http://${req.headers.host}`) });
// bambu: the Make tab's Bambu Studio project (cadlib/bambu3mf.py), written to DATA/.bambu/<id>/<title>.3mf
async function bambu3mf(dir, id, title) {
  const out = path.join(DATA, '.bambu', id.replace(/[^\w-]/g, '_'), `${String(title).replace(/[^\w ()-]+/g, '').trim().slice(0, 60) || 'design'}.3mf`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = await runProc(VENV_PY, ['-m', 'cadlib.bambu3mf', dir, out], { cwd: APP, env: { ...process.env, PYTHONPATH: APP } }, 120e3);
  let summary = null; try { summary = JSON.parse(String(r.stdout || '').trim().split('\n').pop()); } catch {}
  if (r.code !== 0 || !exists(out)) throw new Error(summary?.error || 'Could not make the Bambu Studio file');
  return { file: out, summary };
}
/** Local installs only: open the file in Bambu Studio on this computer. true, or why not. */
function openBambu(file) {
  if (ONLINE) return Promise.resolve('Open the downloaded file in Bambu Studio.');
  if (process.platform !== 'darwin') return Promise.resolve('Open the downloaded file in Bambu Studio.');
  if (!['/Applications/BambuStudio.app', path.join(os.homedir(), 'Applications/BambuStudio.app')].some((a) => fs.existsSync(a))) return Promise.resolve('Bambu Studio isn’t installed. Get it free from bambulab.com, or download the file.');
  return runProc('/usr/bin/open', ['-a', 'BambuStudio', file], {}, 20e3).then((r) => (r.code === 0 ? true : 'Bambu Studio didn’t open. Download the file instead.'));
}
const makefiles = require('./makefiles').init({ projDir, exDir, canEdit, send, allow, clientIp, readJSON, bambu3mf, openBambu }); // makefiles: the Make tab's downloads
const apiv1 = require('./apiv1').init({ DATA, send, allow, clientIp, viaGateway, renderSpawn, runProc, estimatePart: fusion.estimatePart }); // apiv1: public sourcing API (server/apiv1.js)
admin.init({ DATA, PROJECTS, WEB, ORDERS, GATEWAY_URL, ONLINE, MAX_CONCURRENT, readJSON, writeJSON, readText, exists, projDir, vurl, send, serveFile, isAdmin, allow, fulfilment, // admin:
  owners: () => owners, projectUpdated, isPublished, isShared: (id) => share.isShared(id), historyPayload, supportInbox, markSupportRead, addSupportMessage,
  runs, siteRuns, adsRuns, adsJobs, sketchJobs, pool, workers, activeAgents,
  limits: { pool_max: POOL_MAX, pool_per_user: POOL_PER_USER, pool_idle_min: POOL_IDLE_MS / 60e3, workers_max: WORKERS_MAX, runs_per_hour: RUNS_PER_HOUR, runs_per_day: RUNS_PER_DAY, concurrent: MAX_CONCURRENT } });

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (res.headersSent) return res.end();
    send(res, e.code >= 400 && e.code < 600 ? e.code : (/JSON|too large/.test(e.message) ? 400 : 500), { error: e.message });
  });
});
/** Parts library cache (cadlib/parts/cache): builds whatever is missing, in the background, outside the sandbox (builds
 * can read cadlib/ but not write it; a part missing at build time is built into the project's own cache instead). */
function prebuildParts() {
  if (!setupReady()) return whenSetupReady(prebuildParts); // install.sh: CadQuery still installing
  if (!exists(path.join(APP, 'cadlib', 'parts', 'build_cache.py')) || process.env.FORMA_PARTS_PREBUILD === '0') return;
  try {
    const child = spawn(VENV_PY, ['-m', 'cadlib.parts.build_cache', '-j', '2'], { cwd: APP, env: { ...childEnv(), PYTHONPATH: APP }, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    child.on('exit', (code) => { if (code) console.error(`[parts] cache prebuild exited ${code}: ${err.trim().split('\n').pop()}`); });
    child.on('error', () => {});
    child.unref();
  } catch {}
}

server.listen(PORT, HOST, () => {
  console.log(`Vibe manufacturing server on http://${HOST}:${PORT}`);
  console.log(`  data: ${DATA}  online: ${PUBLIC ? 'public host' : TUNNEL ? 'cloudflare tunnel' : 'no'}  access: ${OPEN_LOCAL ? 'open (local)' : PASSWORD ? 'password login' : 'showcase only (FORMA_PASSWORD not set)'}  ai: ${AGENT_KIND === 'codex' ? 'OpenAI Codex (your ChatGPT login)' : 'Claude Code subscription'}  model: ${AGENT_KIND === 'codex' ? (process.env.PREMAKE_CODEX_MODEL || 'Codex default') : AGENT_MODEL}  code sandbox: ${sandbox.AVAILABLE ? 'on' : 'OFF'}`);
  console.log(AGENT_KIND === "codex" ? `  agent: OpenAI Codex (${process.env.PREMAKE_CODEX_BIN || "codex"}, model: ${process.env.PREMAKE_CODEX_MODEL || "Codex default"}) via ${CLAUDE}` : `  claude: ${CLAUDE}`);
  prebuildParts();
  checkModel(); // model-pick
  seedExamples(); // local: the examples start in the sidebar
  if (process.env.PREMAKE_OPEN === '1') { // start.sh: open the browser from here too (its own open can be blocked when an agent runs it)
    const url = `http://localhost:${PORT}`, cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    try { require('child_process').spawn(cmd, process.platform === 'win32' ? ['/c', 'start', '', url] : [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch {}
  }
  setTimeout(() => showcase.sync(), 5000).unref(); // showcase: publish the owner's finished designs, then keep them current
  setInterval(() => showcase.sync(), 3 * 60e3).unref();
  if (ONLINE) console.log(`  allowed hosts: ${[...ALLOWED_HOSTS].join(', ')}${TUNNEL ? ', *.trycloudflare.com' : ''}`);
});

function shutdown() {
  for (const id of runs.keys()) stopRun(id); for (const id of siteRuns.keys()) stopRun(id, 'site'); for (const id of adsRuns.keys()) stopRun(id, 'ads'); for (const id of appRuns.keys()) stopRun(id, 'app');
  for (const p of [...pool.values()]) killProc(p);
  for (const id of [...workers.keys()]) stopWorker(id);
  if (sketchProc) killSketch(sketchProc);
  for (const j of sketchJobs.values()) killSketch(j.s);
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

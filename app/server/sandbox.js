// Code sandbox. The design agent can make Python run (it writes design.py, then ./build.sh executes it), so every
// build runs design.py under macOS sandbox-exec with the Seatbelt profile built here. build.sh applies it itself, so it
// covers builds started by the agent and by the server alike.
//
// What sandboxed code may touch:
//   read+write  its own project dir only (HOME, TMPDIR and caches point into <dir>/.agent-home)
//   read only   the app's cadlib/ and .venv/, Python's install, system libraries
//   nothing     else: no ~/.ssh, ~/.claude, ~/Library, app/.env.local, other projects, /etc (bar DNS/TLS files), /tmp
//   network     none (security recheck C1: a build never needs it, so no exfiltration or proxying through this Mac)
//   agent files no CLAUDE.md / AGENTS.md / .claude / .mcp.json anywhere in the project (C6: no planted agent instructions)
// Also blocked: rewriting ./build.sh, creating symlinks (no ./x -> ~/.ssh/... for the agent's Read tool to follow),
// the keychain (`security` and its mach services), Apple Events, LaunchServices (`open`), osascript, launchctl,
// the window server, and reading other processes' arguments/environment.
//
// Why the claude CLI itself is not wrapped: it signs in with this Mac's Claude Code subscription, which lives in the
// login keychain and ~/.claude, and macOS doesn't allow a second sandbox inside a sandboxed process, so build.sh could
// not apply this stricter one. The CLI is confined by its permission rules instead (server.js AGENT_ALLOWED/DENIED:
// file tools scoped to ./**, Bash only for ./build.sh), plus a scrubbed environment.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const AVAILABLE = process.platform === 'darwin' && fs.existsSync(SANDBOX_EXEC) && process.env.FORMA_SANDBOX !== '0';

const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * Build the Seatbelt profile.
 * dir: the project (or scratch) dir the process may write. app: the app root. node: node install root.
 * pythonRoots: Python install roots to allow read. nodeRoot: optional, for running node inside.
 */
function profile({ dir, app, nodeRoot, pythonRoots = [], extraReads = [], extraWrites = [], render = false, network = false, symlinks = false }) {
  const D = real(dir);
  const A = real(app);
  const reads = [
    `(subpath ${q(D)})`,
    ...extraReads.map((p) => `(subpath ${q(real(p))})`),
    ...extraWrites.map((p) => `(subpath ${q(real(p))})`),
    `(subpath ${q(real(path.join(A, 'cadlib')))})`,
    `(subpath ${q(real(path.join(A, '.venv')))})`,
    `(literal ${q(real(path.join(A, 'server', 'fallback_build.py')))})`,
    `(literal ${q(A)})`, // directory listing only (Python scans sys.path entries); files inside stay unreadable
    ...(nodeRoot ? [`(subpath ${q(real(nodeRoot))})`] : []),
    ...pythonRoots.map((p) => `(subpath ${q(real(p))})`),
    '(subpath "/System")', '(subpath "/usr")', '(subpath "/bin")', '(subpath "/sbin")',
    '(subpath "/Library/Apple")', '(subpath "/Library/Frameworks")', '(subpath "/Library/Preferences")', '(subpath "/Library/Fonts")',
    '(subpath "/opt/homebrew/opt")', '(subpath "/opt/homebrew/Cellar")', '(subpath "/opt/homebrew/lib")', '(subpath "/opt/homebrew/share")',
    '(subpath "/private/var/db/timezone")', '(subpath "/private/var/db/dyld")', '(subpath "/System/Volumes/Preboot/Cryptexes")',
    '(subpath "/dev")', '(literal "/")', // dyld needs to list the root
    // DNS, TLS roots and time zone only; the rest of /etc stays closed
    '(literal "/private/etc/hosts")', '(literal "/private/etc/resolv.conf")', '(literal "/private/etc/services")',
    '(literal "/private/etc/protocols")', '(literal "/private/etc/localtime")', '(subpath "/private/etc/ssl")',
    '(literal "/private/var/run/resolv.conf")',
  ];
  const writes = [
    `(subpath ${q(D)})`,
    ...extraWrites.map((p) => `(subpath ${q(real(p))})`),
    '(literal "/dev/null")', '(literal "/dev/zero")', '(literal "/dev/tty")', '(literal "/dev/dtracehelper")', '(regex #"^/dev/fd/")', '(regex #"^/dev/ttys[0-9]+$")',
  ];
  const deniedExec = ['/usr/bin/osascript', '/usr/bin/open', '/bin/launchctl', '/usr/bin/sudo', '/usr/bin/su', '/usr/sbin/screencapture', '/usr/bin/pbpaste', '/usr/bin/pbcopy', '/usr/bin/security'];
  return `(version 1)
(allow default)
; ---- files: stat anywhere, read/write only what is listed
(deny file-read-data file-read-xattr)
(allow file-read-data file-read-xattr
  ${reads.join('\n  ')})
(deny file-write*)
(allow file-write*
  ${writes.join('\n  ')})
; build.sh and views.sh are the only commands the agent may run: it must not be able to rewrite them
(deny file-write* (literal ${q(path.join(D, 'build.sh'))}) (literal ${q(path.join(D, 'views.sh'))}))
${symlinks ? '' : '(deny file-write-create (vnode-type SYMLINK))\n'}; C6: Claude Code reads these as instructions/config; nothing in the sandbox may plant them
(deny file-write* (regex #"/(CLAUDE|AGENTS|CLAUDE\\.local)\\.md$" #"/\\.claude(/|$)" #"/\\.mcp\\.json$"))
; ---- processes: no GUI scripting, no launching apps or jobs outside the sandbox, no peeking at other processes
(deny process-exec ${deniedExec.map((p) => `(literal ${q(p)})`).join(' ')})
(deny lsopen)
(deny appleevent-send)
(deny process-info* (target others))
; Builds: no GUI (FORMA_NO_RENDER=1). Renders (render: true, VTK thumbs/heroes/steps) need launchservicesd for Cocoa
; but still can't open apps (deny lsopen above) or reach the keychain, pasteboard or Apple Events.
(deny mach-lookup ${render ? '' : '(global-name "com.apple.coreservices.launchservicesd") '}(global-name "com.apple.coreservices.appleevents")
  (global-name "com.apple.pasteboard.1") (global-name "com.apple.SecurityServer") (global-name "com.apple.securityd.xpc"))
; ---- network: ${network ? "internet only; never this Mac's loopback services or local sockets" : 'none at all (C1)'}
(deny network-outbound (remote ip "localhost:*"))
(deny network-outbound (remote unix-socket))
${network ? '(allow network-outbound (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))' : '(deny network*)'}
(deny network-bind (local ip "*:*"))
`;
}

/** Wrap a command: returns [cmd, args] that run it under the profile (or unchanged when sandbox-exec is unavailable). */
function wrap(cmd, args, opts) {
  if (!AVAILABLE) return [cmd, args];
  return [SANDBOX_EXEC, ['-p', profile(opts), cmd, ...args]];
}

/** Env for sandboxed helpers: built from scratch (C5: no SSH_AUTH_SOCK, Claude session tokens or server secrets). */
function cleanEnv(home, extra = {}) {
  return { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', HOME: home, TMPDIR: path.join(home, 'tmp'), XDG_CACHE_HOME: path.join(home, 'cache'),
    MPLCONFIGDIR: path.join(home, 'cache'), PYTHONDONTWRITEBYTECODE: '1', ...extra };
}

module.exports = { AVAILABLE, profile, wrap, cleanEnv };

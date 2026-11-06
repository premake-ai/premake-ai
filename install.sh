#!/usr/bin/env bash
# Install Premake and start it: download (or reuse) ~/premake-ai, set it up, start the studio in the background and
# open it in the browser. Run it again to update: it pulls the newest app code (your designs in app/data are never
# touched), restarts a running studio when something changed, and reopens it.
#   curl -fsSL https://raw.githubusercontent.com/premake-ai/premake-ai/main/install.sh | bash
#   PREMAKE_HOME=~/somewhere bash install.sh       install somewhere else
#   PREMAKE_AGENT=codex bash install.sh            use OpenAI Codex as the design agent
#   PREMAKE_NO_UPDATE=1 bash install.sh            start without checking for updates
#   bash install.sh "design me a SCARA arm 3D printer"   also start that design (curl ... | bash -s "...")
# Needs git, Node.js 20+ and Python 3.11/3.12 (or uv), and Claude Code or Codex logged in. No API key, no sudo.
set -euo pipefail
P="${PREMAKE_HOME:-$HOME/premake-ai}"
REPO="${PREMAKE_REPO:-https://github.com/premake-ai/premake-ai}"
say() { printf 'Premake: %s\n' "$*"; }
PROMPT="${1:-${PREMAKE_PROMPT:-}}"
withPrompt() { if [ -n "$PROMPT" ]; then printf '%s/?prompt=%s' "$1" "$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$PROMPT" 2>/dev/null)"; else printf '%s' "$1"; fi; }
open_url() { if [ "$(uname)" = Darwin ]; then open "$1"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1 || true; fi; }

# 1. Download (once). An existing install is left as it is: your designs live in it.
if [ ! -x "$P/app/start.sh" ]; then
  command -v git >/dev/null 2>&1 || { say "git is not installed. On a Mac run: xcode-select --install"; exit 1; }
  say "downloading to $P (about 140 MB with the example designs)"
  git clone --depth 1 "$REPO" "$P"
fi

# 2. Update: the app code only, and only a fast-forward of an unchanged copy (designs, setup and caches are git-ignored)
UPDATED=0
if [ "${PREMAKE_NO_UPDATE:-}" != 1 ] && [ -d "$P/.git" ]; then
  OLD="$(git -C "$P" rev-parse HEAD 2>/dev/null || true)"
  if [ -n "$(git -C "$P" status --porcelain --untracked-files=no 2>/dev/null)" ]; then
    say "Premake's own files were changed on this computer, so it won't update itself (your designs are fine)"
  elif git -C "$P" pull --ff-only -q 2>/dev/null; then
    [ "$(git -C "$P" rev-parse HEAD)" = "$OLD" ] || { UPDATED=1; say "updated to the newest version"; }
  else
    say "couldn't check for updates (offline?), starting the version you have"
  fi
fi

# 3. Already running? Just open it (after an update: stop it, so the new version starts below)
DATA="$P/app/data"; mkdir -p "$DATA"
if [ "$UPDATED" = 1 ] && [ -f "$DATA/.premake.pid" ] && kill -0 "$(cat "$DATA/.premake.pid")" 2>/dev/null; then
  kill "$(cat "$DATA/.premake.pid")" 2>/dev/null || true; sleep 1; rm -f "$DATA/.premake.pid"
fi
if [ -f "$DATA/.premake.pid" ] && kill -0 "$(cat "$DATA/.premake.pid")" 2>/dev/null && [ -f "$DATA/.premake.url" ]; then
  URL="$(cat "$DATA/.premake.url")"; open_url "$(withPrompt "$URL")"
  say "already running at $URL"; [ -z "$PROMPT" ] || say "your design: $(withPrompt "$URL")"; exit 0
fi

# 4. Set up. Already set up: a quick check. First time: CadQuery (1 to 3 minutes) installs in the background while the
#    studio starts, so the browser opens at once; the examples and the replay need no Python, new designs wait for it.
SETUP_PID=""
if [ -f "$P/app/.venv/.premake-ready" ]; then
  "$P/app/setup.sh" >/dev/null || { say "setup failed: run $P/app/setup.sh to see why"; exit 1; }
else
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$NODE_MAJOR" -ge 20 ] 2>/dev/null || { say "Premake needs Node.js 20 or newer: install it from https://nodejs.org (or: brew install node), then run this again."; exit 1; }
  say "setting up the CAD engine in the background (1 to 3 minutes); Premake opens now"
  "$P/app/setup.sh" > "$DATA/setup.log" 2>&1 &
  SETUP_PID=$!
  export PREMAKE_SETUP_BG=1
fi

# 5. Start in the background, wait for it to answer, open the browser
LOG="$DATA/premake.log"
nohup "$P/app/start.sh" --no-open > "$LOG" 2>&1 < /dev/null &
PID=$!; echo "$PID" > "$DATA/.premake.pid"
URL=""
for _ in $(seq 1 120); do
  kill -0 "$PID" 2>/dev/null || { cat "$LOG" >&2; say "it stopped before starting (above). Fix that, then run this again."; exit 1; }
  [ -n "$URL" ] || URL="$(grep -m1 -o 'http://localhost:[0-9]*' "$LOG" || true)"
  if [ -n "$URL" ] && curl -fsS -o /dev/null "$URL/" 2>/dev/null; then break; fi
  sleep 0.5
done
[ -n "$URL" ] || { cat "$LOG" >&2; say "it didn't start in time (log above: $LOG)"; exit 1; }
echo "$URL" > "$DATA/.premake.url"
open_url "$(withPrompt "$URL")"
say "running at $URL"
[ -z "$PROMPT" ] || say "your design: $(withPrompt "$URL")"
say "stop it: kill $PID   start or update it: bash $P/install.sh   log: $LOG"
if [ -n "$SETUP_PID" ]; then # stay until the CAD engine is in, so a failure is seen (the studio is already open)
  if wait "$SETUP_PID"; then say "setup done: new designs build now"
  else tail -15 "$DATA/setup.log" >&2; kill "$PID" 2>/dev/null || true; rm -f "$DATA/.premake.pid"; say "setup failed (above, full log: $DATA/setup.log). Fix that, then run this again."; exit 1; fi
fi

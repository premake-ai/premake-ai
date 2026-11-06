#!/usr/bin/env bash
# Install Premake and start it: download (or reuse) ~/premake-ai, set it up, start the studio in the background and
# open it in the browser. Safe to run again: it reuses the install and an already-running studio.
#   curl -fsSL https://raw.githubusercontent.com/premake-ai/premake-ai/main/install.sh | bash
#   PREMAKE_HOME=~/somewhere bash install.sh       install somewhere else
#   PREMAKE_AGENT=codex bash install.sh            use OpenAI Codex as the design agent
# Needs git, Node.js 20+ and Python 3.11/3.12 (or uv), and Claude Code or Codex logged in. No API key, no sudo.
set -euo pipefail
P="${PREMAKE_HOME:-$HOME/premake-ai}"
REPO="${PREMAKE_REPO:-https://github.com/premake-ai/premake-ai}"
say() { printf 'Premake: %s\n' "$*"; }
open_url() { if [ "$(uname)" = Darwin ]; then open "$1"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1 || true; fi; }

# 1. Download (once). An existing install is left as it is: your designs live in it.
if [ ! -x "$P/app/start.sh" ]; then
  command -v git >/dev/null 2>&1 || { say "git is not installed. On a Mac run: xcode-select --install"; exit 1; }
  say "downloading to $P (about 140 MB with the example designs)"
  git clone --depth 1 "$REPO" "$P"
fi

# 2. Already running? Just open it.
DATA="$P/app/data"; mkdir -p "$DATA"
if [ -f "$DATA/.premake.pid" ] && kill -0 "$(cat "$DATA/.premake.pid")" 2>/dev/null && [ -f "$DATA/.premake.url" ]; then
  URL="$(cat "$DATA/.premake.url")"; open_url "$URL"
  say "already running at $URL"; exit 0
fi

# 3. Set up (first time 1 to 3 minutes, then seconds)
"$P/app/setup.sh"

# 4. Start in the background, wait for it to answer, open the browser
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
open_url "$URL"
say "running at $URL"
say "stop it: kill $PID   start it again: bash $P/install.sh   log: $LOG"

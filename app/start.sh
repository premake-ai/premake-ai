#!/usr/bin/env bash
# Start Premake on this machine and open it in your browser.
#   ./start.sh                 first free port from 8800 up, data in app/data
#   ./start.sh --no-open       don't open a browser
#   PORT=8812 PREMAKE_DATA_DIR=~/premake-data ./start.sh
# The design agent is Claude Code running with YOUR Claude Code login (subscription). No API key is used:
# ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN are removed before the server starts. Stop it with Ctrl-C.
set -euo pipefail
cd "$(dirname "$0")"
APP_DIR="$(pwd)"
OPEN=1
for a in "$@"; do case "$a" in --no-open) OPEN=0 ;; -h|--help) sed -n '2,7p' "$0"; exit 0 ;; esac; done

fail() { printf 'Premake: %s\n' "$*" >&2; exit 1; }
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN

# 1. Setup done?
command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Run $APP_DIR/setup.sh first."
[ -x "$APP_DIR/.venv/bin/python" ] || fail "The Python venv is missing. Run $APP_DIR/setup.sh first."

# 2. Claude Code, logged in. Candidates: $CLAUDE_BIN, the Claude desktop app's bundled CLI (macOS), `claude` on PATH.
CANDIDATES=()
[ -n "${CLAUDE_BIN:-}" ] && CANDIDATES+=("$CLAUDE_BIN")
if [ "$(uname)" = "Darwin" ]; then
  # newest version folder first
  while IFS= read -r b; do CANDIDATES+=("$b"); done < <(ls -d "$HOME/Library/Application Support/Claude/claude-code/"*/*/claude.app/Contents/MacOS/claude 2>/dev/null | sort -t/ -k8 -V -r || true)
fi
command -v claude >/dev/null 2>&1 && CANDIDATES+=("$(command -v claude)")
[ ${#CANDIDATES[@]} -gt 0 ] || fail "Claude Code is not installed. Install it (https://claude.com/claude-code), run 'claude' once to log in, then run this again."

CLAUDE=""; WHY=""
for c in "${CANDIDATES[@]}"; do
  [ -x "$c" ] || continue
  # `claude auth status` needs a recent CLI; older ones don't have it.
  if ! "$c" auth --help 2>/dev/null | grep -q "authentication status"; then WHY="Claude Code at $c is too old. Update it with: claude update"; continue; fi
  st="$("$c" auth status --json 2>/dev/null || true)"
  if printf '%s' "$st" | grep -q '"loggedIn": *true'; then
    if printf '%s' "$st" | grep -q '"authMethod": *"\(api_key\|apiKey\|console\)"'; then WHY="Claude Code at $c is logged in with an API key. Premake uses your Claude subscription: run 'claude auth logout' then 'claude auth login'."; continue; fi
    CLAUDE="$c"; break
  fi
  WHY="Claude Code is installed but not logged in. Run: claude auth login   (or just 'claude' and follow the prompts)"
done
[ -n "$CLAUDE" ] || fail "$WHY"
export CLAUDE_BIN="$CLAUDE"

# 3. Port and data dir
port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
if [ -n "${PORT:-}" ]; then
  port_free "$PORT" || fail "Port $PORT is already in use. Pick another: PORT=8811 ./start.sh"
else
  PORT=8800; while ! port_free "$PORT"; do PORT=$((PORT + 1)); [ "$PORT" -lt 8900 ] || fail "No free port between 8800 and 8899."; done
fi
export PORT
if [ -n "${PREMAKE_DATA_DIR:-}" ]; then export FORMA_DATA_DIR="$PREMAKE_DATA_DIR"; fi
mkdir -p "${FORMA_DATA_DIR:-$APP_DIR/data}"
# The design agent is never allowed to read /tmp (a security rule), so designs can't live there.
case "$(cd "${FORMA_DATA_DIR:-$APP_DIR/data}" && pwd -P)/" in
  /tmp/*|/private/tmp/*) fail "Your designs folder is under /tmp, where the design agent isn't allowed to work. Set PREMAKE_DATA_DIR to a folder in your home directory (or move the app out of /tmp)." ;;
esac

URL="http://localhost:$PORT"
echo "Premake: $URL"
echo "  data:   ${FORMA_DATA_DIR:-$APP_DIR/data}"
echo "  claude: $CLAUDE ($("$CLAUDE" --version 2>/dev/null | head -1))"
echo "  Stop with Ctrl-C."

# 4. Open the browser once the server answers
if [ "$OPEN" = 1 ]; then
  (
    for _ in $(seq 1 60); do
      if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
        if [ "$(uname)" = "Darwin" ]; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1; fi
        exit 0
      fi
      sleep 0.5
    done
  ) &
fi

exec node "$APP_DIR/server/server.js"

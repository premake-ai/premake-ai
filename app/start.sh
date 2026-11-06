#!/usr/bin/env bash
# Start Premake on this machine and open it in your browser.
#   ./start.sh                 first free port from 8800 up, data in app/data
#   ./start.sh --no-open       don't open a browser
#   PORT=8812 PREMAKE_DATA_DIR=~/premake-data ./start.sh
#   PREMAKE_AGENT=codex ./start.sh   use OpenAI Codex instead of Claude Code (default: Claude Code if logged in)
# The design agent runs on YOUR login: Claude Code (your Claude subscription) or Codex (your ChatGPT plan). No API key
# is used: ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN are removed before the server starts. Stop it with Ctrl-C.
set -euo pipefail
cd "$(dirname "$0")"
APP_DIR="$(pwd)"
OPEN=1
for a in "$@"; do case "$a" in --no-open) OPEN=0 ;; -h|--help) sed -n '2,9p' "$0"; exit 0 ;; esac; done

fail() { printf 'Premake: %s\n' "$*" >&2; exit 1; }
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN

# 1. Setup done?
command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Run $APP_DIR/setup.sh first."
[ -x "$APP_DIR/.venv/bin/python" ] || fail "The Python venv is missing. Run $APP_DIR/setup.sh first."

# 2. The design agent: Claude Code (preferred) or OpenAI's Codex CLI, whichever is installed and logged in.
#    PREMAKE_AGENT=claude or PREMAKE_AGENT=codex picks one; the default (auto) tries Claude Code first.
AGENT_PICK="${PREMAKE_AGENT:-auto}"
case "$AGENT_PICK" in auto|claude|codex) ;; *) fail "PREMAKE_AGENT must be claude, codex or auto (got '$AGENT_PICK')." ;; esac

find_claude() { # sets CLAUDE (or WHY)
  CLAUDE=""; WHY=""
  local CANDIDATES=()
  [ -n "${CLAUDE_BIN:-}" ] && CANDIDATES+=("$CLAUDE_BIN")
  if [ "$(uname)" = "Darwin" ]; then
    # the Claude desktop app's bundled Claude Code, newest version folder first
    while IFS= read -r b; do CANDIDATES+=("$b"); done < <(ls -d "$HOME/Library/Application Support/Claude/claude-code/"*/*/claude.app/Contents/MacOS/claude 2>/dev/null | sort -t/ -k8 -V -r || true)
  fi
  command -v claude >/dev/null 2>&1 && CANDIDATES+=("$(command -v claude)")
  [ ${#CANDIDATES[@]} -gt 0 ] || { WHY="Claude Code is not installed. Install it (https://claude.com/claude-code), run 'claude' once to log in, then run this again."; return 1; }
  local c st
  for c in "${CANDIDATES[@]}"; do
    [ -x "$c" ] || continue
    # `claude auth status` needs a recent CLI; older ones don't have it.
    if ! "$c" auth --help 2>/dev/null | grep -q "authentication status"; then WHY="Claude Code at $c is too old. Update it with: claude update"; continue; fi
    st="$("$c" auth status --json 2>/dev/null || true)"
    if printf '%s' "$st" | grep -q '"loggedIn": *true'; then
      if printf '%s' "$st" | grep -q '"authMethod": *"\(api_key\|apiKey\|console\)"'; then WHY="Claude Code at $c is logged in with an API key. Premake uses your Claude subscription: run 'claude auth logout' then 'claude auth login'."; continue; fi
      CLAUDE="$c"; return 0
    fi
    WHY="Claude Code is installed but not logged in. Run: claude auth login   (or just 'claude' and follow the prompts)"
  done
  return 1
}
find_codex() { # sets CODEX (or WHY_CODEX)
  CODEX=""; WHY_CODEX=""
  local c="${PREMAKE_CODEX_BIN:-$(command -v codex 2>/dev/null || true)}"
  [ -n "$c" ] && [ -x "$c" ] || { WHY_CODEX="Codex is not installed (npm install -g @openai/codex, then: codex login)."; return 1; }
  if "$c" login status >/dev/null 2>&1; then CODEX="$c"; return 0; fi
  WHY_CODEX="Codex is installed but not logged in. Run: codex login"; return 1
}

AGENT=""
if [ "$AGENT_PICK" != codex ] && find_claude; then AGENT=claude; fi
if [ -z "$AGENT" ] && [ "$AGENT_PICK" != claude ] && find_codex; then AGENT=codex; fi
if [ -z "$AGENT" ]; then
  case "$AGENT_PICK" in
    claude) fail "$WHY" ;;
    codex) fail "$WHY_CODEX" ;;
    *) fail "No design agent found. Premake needs Claude Code or OpenAI Codex, installed and logged in.
  Claude Code: $WHY
  Codex:       ${WHY_CODEX:-not checked}" ;;
  esac
fi

if [ "$AGENT" = claude ]; then
  export CLAUDE_BIN="$CLAUDE" PREMAKE_AGENT=claude
  AGENT_LINE="Claude Code $CLAUDE ($("$CLAUDE" --version 2>/dev/null | head -1))"
else
  # Codex behind Claude Code's command line (server/codex_cli.js). The server gives agents a minimal environment, so
  # a small wrapper carries the paths. No warm agent pool (Codex has no long-lived stdin session).
  NODE_ABS="$(command -v node)"
  mkdir -p "$APP_DIR/.agent-bin"
  W="$APP_DIR/.agent-bin/codex-as-claude"
  {
    echo '#!/bin/sh'
    printf 'PREMAKE_CODEX_BIN=%q; export PREMAKE_CODEX_BIN\n' "$CODEX"
    printf 'PREMAKE_CODEX_MODEL=%q; export PREMAKE_CODEX_MODEL\n' "${PREMAKE_CODEX_MODEL:-}"
    printf 'exec %q %q "$@"\n' "$NODE_ABS" "$APP_DIR/server/codex_cli.js"
  } > "$W"
  chmod +x "$W"
  export CLAUDE_BIN="$W" PREMAKE_AGENT=codex PREMAKE_CODEX_BIN="$CODEX" FORMA_POOL_MAX=0
  AGENT_LINE="OpenAI Codex $CODEX ($("$CODEX" --version 2>/dev/null | head -1)), model: ${PREMAKE_CODEX_MODEL:-Codex default}"
fi

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
echo "  agent:  $AGENT_LINE"
echo "  Stop with Ctrl-C."

export PREMAKE_SEED_EXAMPLES="${PREMAKE_SEED_EXAMPLES:-1}" # first start: the examples go into your sidebar

# 4. The server opens the browser once it is listening (PREMAKE_OPEN=1)
if [ "$OPEN" = 1 ]; then export PREMAKE_OPEN=1; else export PREMAKE_OPEN=0; fi

exec node "$APP_DIR/server/server.js"

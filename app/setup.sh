#!/usr/bin/env bash
# Premake setup: checks Node and Python, makes the CadQuery virtualenv in app/.venv. No sudo, safe to re-run.
#   ./setup.sh
# Needs: macOS (arm64 or x86_64) or Linux, Node 20+, Python 3.11 or 3.12 (uv is used if you have it, and can fetch
# Python for you), and Claude Code logged in (checked by start.sh, not here).
set -euo pipefail
cd "$(dirname "$0")"
APP_DIR="$(pwd)"

say()  { printf '%s\n' "$*"; }
fail() { printf 'Premake setup: %s\n' "$*" >&2; touch "$APP_DIR/.setup-failed" 2>/dev/null; exit 1; } # the server stops waiting for it
rm -f "$APP_DIR/.setup-failed" 2>/dev/null

# 1. Node 20+ (the server has no npm dependencies)
command -v node >/dev/null 2>&1 || fail "Node.js 20 or newer is needed. Install it from https://nodejs.org (or: brew install node), then run ./setup.sh again."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js $(node -v) is too old. Premake needs Node 20 or newer."
say "1/3 Node $(node -v) ok"

# 2. Python venv with CadQuery (pinned). uv first, else python3.12 / python3.11 from PATH.
VENV="$APP_DIR/.venv"
if [ -x "$VENV/bin/python" ] && "$VENV/bin/python" -c 'import cadquery, trimesh, vtk, scipy' >/dev/null 2>&1; then
  say "2/3 Python venv already set up ($("$VENV/bin/python" -V))"
else
  rm -rf "$VENV"
  if command -v uv >/dev/null 2>&1; then
    say "2/3 Making the Python venv with uv (Python 3.12, downloads it if needed)..."
    uv venv --quiet --python 3.12 "$VENV" || uv venv --quiet --python 3.11 "$VENV" || fail "uv could not create a Python 3.12 or 3.11 venv."
    pyinstall() { uv pip install --quiet --python "$VENV/bin/python" "$@"; }
  else
    PY=""
    for c in python3.12 python3.11 python3; do
      if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info[:2] in ((3,11),(3,12)) else 1)' 2>/dev/null; then PY="$c"; break; fi
    done
    [ -n "$PY" ] || fail "Python 3.11 or 3.12 is needed (CadQuery has no wheels for 3.13+). Easiest: install uv (curl -LsSf https://astral.sh/uv/install.sh | sh) and run ./setup.sh again."
    say "2/3 Making the Python venv with $PY ($("$PY" -V))..."
    "$PY" -m venv "$VENV"
    "$VENV/bin/python" -m pip install --quiet --upgrade pip
    pyinstall() { "$VENV/bin/python" -m pip install --quiet "$@"; }
  fi
  say "    Installing CadQuery and friends (about 400 MB, 1 to 3 minutes)..."
  # Exact versions the studio is tested with; if a wheel is missing for this platform, fall back to the top-level pins.
  pyinstall -r requirements.lock.txt || { say "    Lock file install failed on this platform, trying requirements.txt..."; pyinstall -r requirements.txt; }
  "$VENV/bin/python" -c 'import cadquery, trimesh, vtk, scipy' || fail "CadQuery did not import. See the error above."
  say "    Python venv ready ($("$VENV/bin/python" -V))"
fi

# 3. Quick self-check: the CAD library builds a box.
"$VENV/bin/python" - <<'PY' || fail "The CAD self-check failed (see above)."
import cadquery as cq
assert cq.Workplane().box(10, 10, 10).val().Volume() > 999
PY
say "3/3 CAD self-check ok"
touch "$VENV/.premake-ready" # start.sh / the server: designs can build now
say ""
say "Setup done. Start Premake with: $APP_DIR/start.sh"

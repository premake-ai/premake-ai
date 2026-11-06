# Premake studio

The Premake app: describe a product, a Claude Code agent designs it in CAD (CadQuery) while you watch the 3D model build, then you get the files, a parts list with prices and where to buy each part, assembly steps and make files.

## Run it

```bash
./setup.sh     # once: checks Node 20+ and Python 3.11/3.12, makes .venv with CadQuery (1 to 3 minutes)
./start.sh     # starts the server on the first free port from 8800 and opens it in your browser
```

Needs macOS (Apple silicon or Intel) or Linux, Node 20+, Python 3.11 or 3.12 (or [uv](https://docs.astral.sh/uv/), which fetches Python for you), and [Claude Code](https://claude.com/claude-code) installed and logged in. The design agent runs on your own Claude Code login (your subscription). No API key is used: `start.sh` removes `ANTHROPIC_API_KEY` before starting.

Options:

| Variable | Default |
|---|---|
| `PORT` | first free port from 8800 |
| `PREMAKE_DATA_DIR` | `app/data` (your designs, never in git) |
| `CLAUDE_BIN` | the Claude desktop app's bundled Claude Code (macOS), else `claude` on your PATH |
| `FORMA_MODEL` | `claude-opus-5-5` (the model every agent uses) |
| `FORMA_PYTHON` | `.venv/bin/python` |

You are the only user and the admin. Hosted features (Google sign-in, Stripe checkout, live support calls, analytics) are off unless you configure them yourself.

## Security

The server spawns Claude Code with file access on your machine. It binds to 127.0.0.1 only and rejects other origins. The design agent can read and edit files inside its own project folder and run `./build.sh`. On macOS, design.py runs in a `sandbox-exec` sandbox (no network, no files outside the project); on Linux there is no build sandbox, so only run designs you asked for.

## Layout

```
server/   Node server (no npm dependencies), agent prompts
web/      Frontend (static ES modules, three.js from a CDN)
cadlib/   Python build library: design.py -> STLs, manifest, print estimate, renders
gateway/home, gateway/landing   the signed-out home page renderer (reused by the server)
data/     your designs (created at runtime, not in git)
CONTRACT.md   file formats and API
```

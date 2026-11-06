# Premake studio

The Premake app: describe a product, a Claude Code agent designs it in CAD (CadQuery) while you watch the 3D model build, then you get the files, a parts list with prices and where to buy each part, assembly steps and make files.

## Run it

```bash
./setup.sh     # once: checks Node 20+ and Python 3.11/3.12, makes .venv with CadQuery (1 to 3 minutes)
./start.sh     # starts the server on the first free port from 8800 and opens it in your browser
```

Needs macOS (Apple silicon or Intel) or Linux, Node 20+, Python 3.11 or 3.12 (or [uv](https://docs.astral.sh/uv/), which fetches Python for you), and a design agent installed and logged in: [Claude Code](https://claude.com/claude-code) (preferred) or [OpenAI Codex](https://developers.openai.com/codex). The agent runs on your own login (your Claude subscription or ChatGPT plan). No API key is used: `start.sh` removes `ANTHROPIC_API_KEY` before starting.

Options:

| Variable | Default |
|---|---|
| `PORT` | first free port from 8800 |
| `PREMAKE_DATA_DIR` | `app/data` (your designs, never in git; not under /tmp) |
| `PREMAKE_AGENT` | `auto`: Claude Code if logged in, else Codex. `claude` or `codex` to choose |
| `CLAUDE_BIN` | the Claude desktop app's bundled Claude Code (macOS), else `claude` on your PATH |
| `FORMA_MODEL` | Claude Opus 5.5 if your plan has it, else Claude Code's default model (checked once, remembered in `data/.model.json`) |
| `PREMAKE_CODEX_BIN` | `codex` on your PATH |
| `PREMAKE_CODEX_MODEL` | Codex's own default model (the best it offers your login); a model Codex refuses falls back to its default once |
| `FORMA_EXAMPLES_DIR` | `app/examples` |
| `FORMA_PYTHON` | `.venv/bin/python` |

You are the only user and the admin. Hosted features (Google sign-in, Stripe checkout, live support calls, analytics, Premake's own parts stock) are off unless you configure them yourself.

## Examples

`app/examples/` holds the example designs shown on the Examples page. `scripts/import-examples.sh <studio-data-dir>` rebuilds it from a studio's `data/examples` and published `data/showcase` designs, copying only the files the Examples page needs (model, parts list, code, thumbnail, wiring, firmware, app preview) and public meta fields.

## Using Codex instead of Claude Code

`server/codex_cli.js` runs `codex exec --json` behind the same command line the server uses for Claude Code and translates Codex's events, so the studio works the same way. What differs:

- Each turn starts a fresh Codex process (no warm agent), so the first reply takes a little longer.
- Claude Code's per-file permission rules have no Codex equivalent. Codex's sandbox is the boundary instead: the agent writes only inside the design's folder and its commands have no network, but it can read files elsewhere on your disk.
- Parts that appear while design.py is still being written, and the live highlight of parts being edited, need Claude's streamed tool input. With Codex the model updates when each file change lands, and replies appear a message at a time.
- Reasoning effort is set per turn (`model_reasoning_effort`); web search uses Codex's own search.
- A few labels still say Claude (the ads writer, the build guide).

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

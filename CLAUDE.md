# Premake: notes for AI agents (Claude Code, Codex)

## Installing or starting Premake

When the user asks to install, set up, run, start or open Premake (for example "Install premake-ai from github"), run this one command in the shell and wait for it to finish (1 to 3 minutes the first time):

```bash
curl -fsSL https://raw.githubusercontent.com/premake-ai/premake-ai/main/install.sh | bash
```

From a clone of this repo, `bash install.sh` does the same. It downloads Premake to `~/premake-ai` (or reuses it), sets it up, starts the studio in the background, opens it in the browser and prints `Premake: running at http://localhost:PORT`. Then:

1. Run `open http://localhost:PORT` (macOS) or `xdg-open http://localhost:PORT` (Linux) yourself too, in case the browser didn't open.
2. Give the user the link.

If it stops with a message, tell the user that message and the one command it names to fix it. The usual ones are:
- `claude auth login` (or `claude update`)
- `codex login`
- installing Node.js 20+
- installing uv: `curl -LsSf https://astral.sh/uv/install.sh | sh`

Never set or use `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. Premake runs on the user's own Claude Code or Codex login. To use Codex when both are installed, run it with `PREMAKE_AGENT=codex`.

Don't change the app's code unless the user asks. Their designs live in `~/premake-ai/app/data`.

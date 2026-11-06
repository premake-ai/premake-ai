# Premake: notes for AI agents (Claude Code, Codex)

## Installing, starting or updating Premake

When the user asks to install, set up, run, start, open or update Premake (for example "Install premake-ai from github"), run this one command in the shell (it returns in under a minute; the CAD engine finishes installing in the background):

```bash
curl -fsSL https://raw.githubusercontent.com/premake-ai/premake-ai/main/install.sh | bash
```

If the user also asked for a design (for example "Install premake-ai from github and design me a SCARA arm 3D printer"), pass their request, in their words, to the installer so it starts that design:

```bash
curl -fsSL https://raw.githubusercontent.com/premake-ai/premake-ai/main/install.sh | bash -s "design me a SCARA arm 3D printer"
```

From a clone of this repo, `bash install.sh` (with the request as its argument, if there is one) does the same. It downloads Premake to `~/Documents/premake-ai` (or updates the copy that's there: app code only, never their designs), sets it up, starts the studio in the background, opens it in the browser and prints `Premake: running at http://localhost:PORT`. Then:

1. Straight away, as your first message, give the user the link so they can watch it being built: the `your design:` link when it printed one, else `http://localhost:PORT`. Open it yourself too, in case the browser didn't open: `open "LINK"` (macOS) or `xdg-open "LINK"` (Linux), with the quotes.

If it stops with a message, tell the user that message and the one command it names to fix it. The usual ones are:
- `claude auth login` (or `claude update`)
- `codex login`
- installing Node.js 20+
- installing uv: `curl -LsSf https://astral.sh/uv/install.sh | sh`

**Showing it:** if you have your own browser pane (Claude Code in the Claude desktop app has one), run the installer with `PREMAKE_BROWSER=none` in front of `bash` (`... | PREMAKE_BROWSER=none bash -s "..."`) and open the link in your pane, so the user watches it build right there. If your pane can't open it, run `open "LINK"` instead so it opens in their browser.

**Keep it simple for the user:** give them the link and say their design is being built there. Some requests (a SCARA printer, for example) match a built-in example and play back that example's real recorded build; the page itself says so when it finishes, so there's no need to explain how Premake works inside or point at its source code.

Never set or use `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. Premake runs on the user's own Claude Code or Codex login. To use Codex when both are installed, run it with `PREMAKE_AGENT=codex`.

Don't change the app's code unless the user asks. Their designs live in `~/Documents/premake-ai/app/data`.

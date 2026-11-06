# Premake

Describe a product and Premake designs it. An AI design agent writes the CAD while you watch the 3D model take shape, then you get the files to make it, the full parts list, prices, and where to buy each part. It runs on your own computer, on your own Claude Code (or OpenAI Codex) login.

This repo is the home of Premake: the whole studio app, the Claude Code plugin, and the quoting service behind premake.ai's live shop prices. It starts with 128 example designs, from a bike hook to a desktop CNC router, that you can open, change and make.

Premake also gets live manufacturing quotes for any STEP or STL file from machine shops, sheet-metal shops and print networks, right from Claude Code. It never orders or pays for anything: you get a comparison link and order from the shop yourself.

| Folder | What it is |
|---|---|
| [`app/`](app/) | The Premake studio: server, web app, CAD library and the example designs |
| [`skills/`](skills/), [`commands/`](commands/), [`hooks/`](hooks/), [`.claude-plugin/`](.claude-plugin/) | The Claude Code plugin: installs and opens the studio, and quotes parts |
| [`api/`](api/) | The quoting API behind premake.ai/api/v1 (self-hostable) |

<!-- Screenshot goes here: ![The Premake studio](docs/studio.png) -->

## Install

Tell Claude Code or Codex:

```
Install premake-ai from github
```

It downloads Premake, sets it up, starts it and opens it in your browser. Every example design is already in your sidebar.

Or run it yourself in a terminal (the same thing):

```bash
curl -fsSL https://raw.githubusercontent.com/premake-ai/premake-ai/main/install.sh | bash
```

Run that again any time to start Premake. It reuses your install and your designs. Premake lives in `~/premake-ai`.

## Requirements

- macOS (Apple silicon or Intel) or Linux.
- A design agent, installed and logged in:
  - [Claude Code](https://claude.com/claude-code) (`claude auth login`). Uses your Claude subscription, never an API key. Premake picks Claude Opus 5.5 when your plan has it and otherwise Claude Code's default model, and remembers the choice. Set `FORMA_MODEL` to choose.
  - or [OpenAI Codex](https://developers.openai.com/codex) (`npm install -g @openai/codex`, then `codex login`). Uses your ChatGPT plan and Codex's own default model, the best one it offers you. Set `PREMAKE_CODEX_MODEL` to choose.
  - With both, Premake uses Claude Code. `PREMAKE_AGENT=codex ~/premake-ai/app/start.sh` picks Codex.
- Node.js 20 or newer.
- Python 3.11 or 3.12 for CadQuery, or [uv](https://docs.astral.sh/uv/), which fetches Python for you. `setup.sh` makes a venv inside `app/`; nothing is installed system-wide and nothing needs sudo.
- Quotes on their own (the skill below) need only `curl`, on macOS, Linux or Windows 10 and later.

## The studio

Describe a product (or paste a photo or sketch) and press Start building. The design agent writes a CadQuery model and the parts appear as it works. Then:

- **Model**: the 3D model, with parts you can hide, measure, section and recolour.
- **Assemble**: step-by-step assembly, built from the geometry.
- **Order**: every part with a price and where to buy it: printed parts, sheet and machined parts with live shop quotes, and off-the-shelf parts with store links.
- **Make**: STL and STEP files for every part, ready for your printer or a shop.

The Examples page opens any of the example designs; remix one to make it yours.

Ask for changes in the chat and the model updates. Your designs are saved in `app/data/` (set `PREMAKE_DATA_DIR` to keep them elsewhere). More options are in [app/README.md](app/README.md).

## Quotes from Claude Code

With the plugin installed, Claude can price any part you have as a STEP or STL file, with no app running. Free use allows 20 quotes a day per IP address and files up to 50 MB.

```
> What would 1 and 10 of crossbar-gusset-left.step cost in aluminium?

  Uploading the part... 120 x 120 x 3 mm plate, likely laser cut.
  Asking RMFG, MATERIAM, the AFN network and Slant 3D. Quotes take a minute or two.

  For 10 pieces:
    Cheapest   RMFG (Texas), laser cut 5052 aluminium   $25.50 total, ships Nov 8    live quote
    CNC        Justway via AFN, 6061 aluminium          $200.50, arrives Nov 30      live quote
    Estimate   SendCutSend                              about $41                    Premake's model

  Laser cutting is about 8x cheaper than machining for a flat plate like this.

  Compare and order: https://premake.ai/q/qt_e33fa468a45f30c823e8
```

Ask it in your own words ("where can I get this machined?", "how fast can I get 50 of these?"), or run `/premake-ai:quote bracket.step 1,10,100 aluminium`. If you only have a build123d, CadQuery, OpenSCAD or FreeCAD script, Claude exports a STEP file first.

"Live" means the shop's own price for your exact file. "Estimate" means Premake's price model, used where a shop has no quoting API.

## Suppliers

| Supplier | Makes | Price | File |
|---|---|---|---|
| RMFG (Fort Worth, Texas) | Laser cut and bent sheet metal, laser cut tube | Live | STEP |
| MATERIAM (Querétaro, Mexico, US duty included) | Sheet metal, tube, welded assemblies | Live | STEP |
| AFN network: Justway, PCBWay, Protolabs, Craftcloud, RivCut, SendCutSend CNC and others | CNC machining | Live (some shops' own estimates, marked) | STEP |
| Slant 3D | 3D printing in PETG | Live | STEP or STL |
| SendCutSend | Laser cut and bent sheet | Estimate | STEP or STL |
| Local shop | Any of the above | Estimate (Premake price model) | STEP or STL |

Materials: aluminium (the default), steel, stainless, plastic, acrylic. `curl https://premake.ai/api/v1/suppliers` lists what's on right now.

## Privacy

Everything runs on your machine, and your designs stay in `app/data/` on it. The design agent is your own Claude Code or Codex, so it talks to Anthropic or OpenAI like any session of those tools. The only files sent to Premake are the ones you choose to quote: the STEP or STL files of parts you ask prices for (from the Order tab or the quoting skill) go to premake.ai's quoting service and to the shops being asked. They are used only for quoting and deleted after 30 days, with their quotes. The app has no analytics, no account and no sign-in.

## The API

The skill calls a small HTTP API you can use from anything:

```
POST /api/v1/parts        raw STEP/STL body, X-Filename header    -> 201 {part_id, bbox_mm, volume_mm3, processes, warnings}
POST /api/v1/quotes       {"parts":[{"part_id","qty":[1,10],"material"}], "ship_to_zip"}   -> 202 {quote_id, poll, url}
GET  /api/v1/quotes/:id   {status: pending | complete, offers, best (cheapest, fastest), errors, url}
GET  /api/v1/suppliers    who is quoted, what they make, live or estimate
GET  /q/:id               read-only comparison page
```

```
curl -sS --data-binary @part.step -H "X-Filename: part.step" https://premake.ai/api/v1/parts
```

## Self-hosting

The API server is in [`api/`](api/): plain Node 22 with no npm dependencies, plus Python with CadQuery to read STEP files.

```
cd api
pip install -r py/requirements.txt      # cadquery, for STEP files
npm test
npm start                               # http://localhost:8080
```

Or build `api/Dockerfile`. Then point the plugin at your server:

```
export PREMAKE_API=http://localhost:8080
```

Settings are environment variables, listed at the top of [`api/server.js`](api/server.js). The ones you're most likely to want:

- `DATA_DIR`: where uploads, quotes and supplier caches live (default `api/data`).
- `PUBLIC_URL`: the base URL used in quote links.
- `API_V1_SUPPLIERS_OFF`: suppliers to switch off, for example `rmfg,afn`.
- `RMFG_TOKEN_JSON`: RMFG needs an OAuth connection of your own (see [RMFG's agent guide](https://www.rmfg.com/docs/api/agent-guide.txt)). Without it, RMFG is skipped and everything else still works.

MATERIAM, the AFN network and Slant 3D are public and need no key. Each supplier module in `api/src/suppliers/` only calls quoting tools; none can place an order.

## Licence

MIT. See [LICENSE](LICENSE). Contact: joshmitchell10@gmail.com

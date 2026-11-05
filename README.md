# premake-ai

Get parts made from Claude Code. Give Claude a STEP or STL file (or the CAD script that makes one) and ask what it would cost. Claude uploads it to Premake, which asks machine shops, sheet-metal shops and print networks at once and comes back with real prices, shipping and delivery dates.

Premake never orders or pays for anything. You get a comparison link and order from the shop yourself.

<!-- Demo GIF goes here: ![premake-ai in Claude Code](docs/demo.gif) -->

## Install

In Claude Code:

```
/plugin marketplace add premake-ai/premake-ai
/plugin install premake-ai@premake-ai
```

That's it. No account, no key, nothing else to install: the plugin is a skill that runs `curl`, which ships with macOS, Linux and Windows 10 and later.

- Needs Claude Code 2.0.20 or later (`claude --version`, upgrade with `claude update`).
- Works with any Claude model.
- Free use allows 20 quotes a day per IP address and files up to 50 MB.

## What it looks like

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

Your file goes to Premake's quoting service and to the shops being asked for a price. It is used only for quoting and deleted after 30 days, with its quotes.

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

MIT. See [LICENSE](LICENSE).

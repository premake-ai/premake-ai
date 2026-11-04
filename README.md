# premake-ai

Get parts made from Claude Code. Premake is an AI procurement provider: one API over machine shops, sheet-metal shops, print networks and factories. Send a STEP or STL file and get live prices, shipping and delivery dates from every supplier that can make it.

This repo is a Claude Code plugin: a skill that teaches Claude when to quote, how to export STEP from your CAD code, and how to ask Premake's API with `curl`, plus a `/premake-ai:quote` command. Nothing to install beyond the plugin.

Premake never orders or pays for anything. You get a comparison link and order yourself.

## Install

```
/plugin marketplace add premake-ai/premake-ai
/plugin install premake-ai@premake-ai
```

Then ask Claude "what would 20 of these cost in aluminium?" or run `/premake-ai:quote bracket.step 1,10,100`.

- Needs Claude Code 2.0.20 or later: plugins arrived in 2.0.12 and skills in 2.0.20. Check with `claude --version`, upgrade with `claude update`.
- Works with any Claude model, including Sonnet 4.5 and older. The skill is plain instructions and `curl` commands.
- No Node, Python or npm. Claude runs `curl`, which ships with macOS, Linux and Windows 10 and later.
- No account or key. Anonymous use allows 20 quotes a day per IP and files up to 50 MB.

Privacy: your file is sent to Premake's quoting service and the shops being asked. It is used only for quoting and deleted after 30 days.

## Example

```
$ npx premake-ai quote front-shell.step --qty 1,10 --material aluminium
front-shell.step: 20.8 x 58 x 64.5 mm, 9,573 mm3, likely sheet metal / cnc / 3d print

front-shell · Aluminium 6061 / 5052

1 piece
  Supplier            Process         Each    Total  Shipping  Arrives      Price
  ------------------  -----------  -------  -------  --------  -----------  --------
  RMFG                sheet metal   $10.07   $10.07         -  ~Fri 13 Nov  live
  MATERIAM            sheet metal   $10.67   $10.67         -  ~Sun 15 Nov  live
  SendCutSend         sheet metal   $39.00   $39.00         -  ~Sat 14 Nov  estimate
  Justway (AFN)       CNC           $34.68   $34.68     $5.65  Thu 26 Nov   live
  Local shop (model)  sheet metal   $43.76   $43.76         -  ~Fri 13 Nov  estimate
  PCBWay (AFN)        CNC           $39.78   $39.78    $40.00  Tue 17 Nov   live
  Protolabs (AFN)     CNC          $199.05  $199.05    $18.00  Wed 11 Nov   estimate
  Craftcloud (AFN)    CNC          $226.38  $226.38    $42.99  Tue 1 Dec    live
  Cheapest: RMFG, $10.07
  Fastest:  Protolabs (AFN), arrives Wed 11 Nov (estimate)

10 pieces
  Supplier            Process        Each    Total  Shipping  Arrives      Price
  ------------------  -----------  ------  -------  --------  -----------  --------
  MATERIAM            sheet metal   $4.84   $48.40         -  ~Sun 15 Nov  live
  RMFG                sheet metal   $6.70   $67.00         -  ~Fri 13 Nov  live
  SendCutSend         sheet metal  $12.52  $125.23         -  ~Sat 14 Nov  estimate
  Local shop (model)  sheet metal  $14.01  $140.10         -  ~Fri 13 Nov  estimate
  Justway (AFN)       CNC          $20.85  $208.50     $9.68  Thu 26 Nov   live
  PCBWay (AFN)        CNC          $23.72  $237.20    $40.00  Tue 17 Nov   live
  Craftcloud (AFN)    CNC          $35.72  $357.20    $78.50  Tue 22 Dec   live
  Protolabs (AFN)     CNC          $48.25  $482.50    $18.00  Wed 11 Nov   estimate
  Cheapest: MATERIAM, $48.40
  Fastest:  Protolabs (AFN), arrives Wed 11 Nov (estimate)

~ = arrival estimated. Shipping - = not included (priced at checkout). "estimate" = Premake's price model, not a shop's quote.
Compare and order: https://premake.ai/q/qt_65fbf02357961cbb29f4
```

"live" is the shop's own price for your exact file. "estimate" is Premake's model of a price, shown where a shop has no quoting API.

## Suppliers

| Supplier | Makes | Price | File |
|---|---|---|---|
| RMFG (Texas) | Laser cut and bent sheet metal, laser cut tube | Live | STEP |
| MATERIAM (Querétaro, Mexico, US duty included) | Sheet metal, tube, welded assemblies | Live | STEP |
| AFN network: Justway, PCBWay, Protolabs, Craftcloud, RivCut, SendCutSend CNC and others | CNC machining | Live (some shops' own estimates, marked) | STEP |
| Slant 3D | 3D printing (PETG) | Live | STEP or STL |
| SendCutSend | Laser cut and bent sheet | Estimate | STEP or STL |
| Local shop | Any of the above | Estimate (Premake price model) | STEP or STL |

Ask Claude "who can make this?" or `curl https://premake.ai/api/v1/suppliers` for the current list. Materials: aluminium (default), steel, stainless, plastic, acrylic.

## Optional: CLI and MCP server

The plugin doesn't need them. For other tools (Cursor, Claude Desktop, scripts), this repo also holds a small CLI and MCP server over the same API. They are not on npm yet; run them from a clone with Node 18.17 or later:

```
git clone https://github.com/premake-ai/premake-ai && cd premake-ai && npm install
node bin/premake-ai.js quote bracket.step --qty 1,10,100 --material aluminium
node bin/premake-ai.js get <quote_id>
node bin/premake-ai.js suppliers
node bin/premake-ai.js mcp      # MCP tools: quote_part, get_quote, list_suppliers
```

`PREMAKE_API` points the skill, CLI and MCP server at another server (default `https://premake.ai`).

## API

The skill calls a small HTTP API you can use directly:

```
POST /api/v1/parts          raw STEP/STL body, X-Filename header       -> part_id, bbox, volume, likely processes, warnings
POST /api/v1/quotes         {"parts":[{"part_id","qty":[1,10],"material"}], "ship_to_zip"}  -> quote_id
GET  /api/v1/quotes/:id     offers as they arrive, status pending | complete, cheapest and fastest, comparison url
GET  /api/v1/suppliers
```

Uploaded files are private, used only for quoting, and deleted after 30 days.

## Licence

MIT. The clients in this repo are open source; the Premake API server and price models are not.

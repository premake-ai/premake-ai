# premake-ai

Get parts made from your terminal or your coding agent. Premake is an AI procurement provider: one API over machine shops, sheet-metal shops, print networks and factories. Send a STEP or STL file and get live prices, shipping and delivery dates from every supplier that can make it.

This repo holds the open-source clients: a CLI, an MCP server, and a Claude Code plugin with a skill that teaches Claude when to quote and how to export STEP from your CAD code.

Premake never orders or pays for anything. You get a comparison link and order yourself.

## Install in 30 seconds

Claude Code:

```
/plugin marketplace add premake-ai/premake-ai
/plugin install premake-ai@premake-ai
```

Then ask Claude "what would 20 of these cost in aluminium?" or run `/premake-ai:quote bracket.step 1,10,100`. The plugin starts the MCP server with `npx`, so Node 18.17 or later must be installed.

Command line (Node 18.17 or later):

```
npx premake-ai quote bracket.step --qty 1,10,100 --material aluminium
```

Any other MCP client (Cursor, Claude Desktop, Codex):

```json
{ "mcpServers": { "premake-ai": { "command": "npx", "args": ["-y", "premake-ai", "mcp"] } } }
```

No account or key. Anonymous use allows 20 quotes a day per IP and files up to 50 MB.

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

`premake-ai suppliers` prints the current list. Materials: aluminium (default), steel, stainless, plastic, acrylic.

## Commands

```
premake-ai quote <file> [--qty 1,10,100] [--material aluminium] [--zip 10001] [--json]
premake-ai get <quote_id> [--json]
premake-ai suppliers [--json]
premake-ai mcp
```

`PREMAKE_API` points the clients at another server (default `https://premake.ai`).

MCP tools: `quote_part` (path, qtys, material), `get_quote` (quote_id), `list_suppliers`.

## API

The clients call a small HTTP API you can use directly:

```
POST /api/v1/parts          raw STEP/STL body, X-Filename header       -> part_id, bbox, volume, likely processes, warnings
POST /api/v1/quotes         {"parts":[{"part_id","qty":[1,10],"material"}], "ship_to_zip"}  -> quote_id
GET  /api/v1/quotes/:id     offers as they arrive, status pending | complete, cheapest and fastest, comparison url
GET  /api/v1/suppliers
```

Uploaded files are private, used only for quoting, and deleted after 30 days.

## Licence

MIT. The clients in this repo are open source; the Premake API server and price models are not.

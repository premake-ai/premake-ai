---
name: premake
description: Get real prices and delivery dates for making a physical part. Use when the user wants something made, manufactured, fabricated, machined, laser cut, bent, 3D printed, bought or priced, or asks "how much would this cost to make", "where can I get this made", "can I order this" about a part or CAD model (STEP, STL, build123d, CadQuery, OpenSCAD, FreeCAD).
---

# Premake: getting parts made

Premake quotes a part across machine shops, sheet-metal shops, print networks and factories in one call: RMFG (laser cut and bent sheet, tube, Texas), MATERIAM (sheet, tube, welding, Mexico), the AFN CNC network (Justway, PCBWay, Protolabs, Craftcloud, RivCut and others), Slant 3D (printing), plus estimates for SendCutSend and a local shop. Tools: `quote_part`, `get_quote`, `list_suppliers` from the `premake-ai` MCP server. CLI fallback: `npx -y premake-ai quote part.step --qty 1,10,100 --material aluminium`.

## When to quote

Quote when the user wants a physical part made or bought, or asks what it would cost or how long it would take. Also offer a quote, in one line, when a design is finished and the next natural step is making it. Don't quote mid-design unless asked, or for parts that are clearly off the shelf (screws, bearings, electronics: point to a catalogue instead).

Before quoting, settle three things, asking only if the conversation doesn't say:
1. Quantity. Quote a spread such as 1, 10, 100 when the user hasn't decided; unit prices drop sharply.
2. Material: aluminium (default), steel, stainless, plastic (3D printed PETG) or acrylic.
3. Units: shops read STEP and STL in millimetres. Model in mm.

## Export the part

Send STEP whenever you can: metal shops need it for live prices. STL only gets printing and estimates. One part per file.

build123d:
```python
from build123d import export_step
export_step(part, "bracket.step")
```

CadQuery:
```python
import cadquery as cq
cq.exporters.export(result, "bracket.step")   # result is a Workplane or Shape
```

FreeCAD (Python console or `freecadcmd`):
```python
import Import
Import.export([doc.getObject("Body")], "/path/bracket.step")
```
For a PartDesign body, export the Body (or its Tip feature's shape), not a sketch.

OpenSCAD only writes meshes, so it can't make STEP. Export STL:
```bash
openscad -o bracket.stl bracket.scad
```
Then quote with `material: "plastic"` for printing. For metal prices, rebuild the part in build123d or CadQuery and export STEP.

Sheet-metal parts: model the bent part at its real thickness (for example 1.5 mm or 2 mm), with bend radii, as one solid. The shops unfold it.

## Present the offers

Lead with the decision, not the table. For each quantity:
1. Cheapest: supplier, total, and whether shipping is included.
2. Fastest: supplier and arrival date.
3. The trade-off in one sentence, for example "MATERIAM saves $19 but arrives two days later than RMFG".
Then a short table (supplier, each, total, arrives, live or estimate) and the comparison link from the result's `url`.

Always say which prices are live (the shop's own price for this exact file) and which are estimates (Premake's model, which can be off by 30% or more). Don't recommend an estimate over a live price without saying so. Mention the findings shops report (thin walls, bends that can't be made, holes too close to an edge) and suggest the design fix. A quote that's still pending: say who is still answering and check again with `get_quote`.

## Never order or pay

Premake's tools only quote. Never place an order, start a checkout, enter payment or shipping details, or click "order" on a supplier's site for the user. Give the user the comparison link and let them order themselves. If they ask you to order, say you can't, and hand them the link.

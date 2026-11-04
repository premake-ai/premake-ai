---
description: Get live manufacturing quotes for a part (STEP or STL)
argument-hint: "[file.step] [quantities, e.g. 1,10,100] [material]"
---

Get manufacturing quotes for: $ARGUMENTS

1. Work out the file. If none was given, use the STEP file this conversation just made or exported. If there is only a CAD script (build123d, CadQuery, OpenSCAD, FreeCAD), export a STEP first, following the premake skill. Ask only if there is no part at all.
2. Work out the quantities (default 1) and material (default aluminium; "plastic" for 3D printing) from the arguments or the conversation.
3. Quote it with curl, following the three steps in the premake skill's "How to get a quote": upload the file to `/api/v1/parts`, ask for quotes at `/api/v1/quotes`, then poll `/api/v1/quotes/<quote_id>` until `status` is `complete`. The base URL is `${PREMAKE_API:-https://premake.ai}`.
4. Present the offers the way the premake skill describes: cheapest, fastest, the trade-off between them, which prices are live and which are estimates, then the comparison link (`url`).
5. Do not order, pay, or open checkout pages. The person orders by opening the link themselves.

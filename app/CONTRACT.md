# Premake: shared contract

Local-only prototype: "Cursor for 3D CAD". A user chats; a Claude Code agent (spawned by the server with `claude -p`, using the user's own Claude Code login/usage) writes CadQuery code; the 3D view updates live; a parts list + price quote for 1 / 10 / 100 / 500 units shipped appears; mock checkout.

App root: `app/` (inside the session working directory). Server on **http://127.0.0.1:8800** (bind 127.0.0.1 ONLY — the server can run code; never expose it through a tunnel).

Python venv with cadquery 2.8, trimesh, numpy, vtk (use it, never install system-wide):
`app/.venv/bin/python` (see README; override with FORMA_PYTHON)

## Directory layout and ownership (only edit what you own)

```
app/
  CONTRACT.md            (main session)
  cadlib/                (Agent C) shared Python build library
    __init__.py
    build.py             python -m cadlib.build <design_dir>
    render_thumb.py      used by build.py
  data/
    examples/<slug>/     (Agent C) gallery examples, one design_dir each
    projects/<id>/       (created at runtime by the server, Agent A)
  server/                (Agent A) Node server + design-agent prompt + build.sh template
  web/                   (Agent B) frontend, static, no build step
```

## A "design dir" (examples and projects use the same shape)

```
<design_dir>/
  design.py        CadQuery source. Must define:  def parts() -> list[dict]
                   each dict: {"name": str, "shape": cq.Workplane | cq.Shape,
                               "group": "case" | "component",   # case = printed, component = bought part dummy
                               "color": "#rrggbb" (optional),
                               "explode": [x,y,z] unit vector (optional),
                               "process": "print" | "extrusion" | "sheet" | "laser" | "bought" (optional;
                                          default "print" for case, "bought" for component; group defaults from it),
                               "params": {...} (optional, per process: extrusion {profile, length_mm, tapped_ends};
                                          sheet {material, thickness_mm, bends}; laser {material, thickness_mm})}
                   design.py may `from cadlib import fab` (extrusion / sheet / panel helpers + component dummies)
                   and `from cadlib.parts import part` (library of detailed bought parts: part(key, at, rot, **params)
                   returns a parts() dict with "subparts" + "lib"; cached meshes in cadlib/parts/cache/, built by
                   cadlib/parts/build_cache.py, lazily on first use otherwise).
                   Shapes are in ASSEMBLED position, Z-up, mm, product front facing -Y.
                   Optional per part: "id": str (unique handle, becomes the STL slug; motion() addresses parts by it).
                   Optional: def motion() (see "Motion" below) -> motion.json for the viewer's Move button.
  bom.json         bought parts (written by the design agent / example author):
                   {"parts": [{"name": str, "qty_per_unit": num, "unit_cost_usd": num,
                               "supplier": str, "url": str ("" if none), "notes": str}],
                    "assembly_minutes": num, "kit_ok": bool}
                   build.py ADDS/REPLACES the "printed" key:
                   "printed": [{"file": "stl/<slug>.stl", "name": str, "grams": num, "print_hours": num, "bbox": [x,y,z]}]
                   (only process "print" parts) and the "fabricated" key (extrusion / sheet / laser parts):
                   "fabricated": [{"file", "name", "process", "params" (filled with defaults), "bbox",
                                   "est": {"minutes": shop min, "material_usd": rough stock cost,
                                           extrusion: "length_mm"; sheet: "area_cm2" (flat ~= volume/t), "bends";
                                           laser: "cut_length_mm" (outline + holes perimeter), "area_cm2"}}]
                   Library parts add their bought line to "parts" themselves, marked "auto": "lib" (re-written each build,
                   summed per name; a hand-written line with the same name wins).
                   The quote prices "fabricated" (server/pricing_fab.js): stock + cut/tap/bend/laser time + labour
                   (est.minutes not already billed as machine time) x shop rate + per-batch sheet setup / qty, on the
                   same bulk curve; /api/quote gains "fabricated": {parts, lines: [{name, process, detail, material_usd,
                   machine_usd, labour_usd, labour_min, setup_usd_per_batch, piece_usd}], setup_usd_per_batch,
                   shop_rate_per_h, excluded_stopgap: [...]} and each tier's unit gains "fabrication".
                   Legacy: parts entries with "fabricated": true were a stop-gap stock line. When bom "fabricated" is
                   non-empty they are EXCLUDED from the parts sum and the quote's "bom" list (double-count guard);
                   without it they are still priced. The design agent no longer writes them.
  firmware/, wiring.md  optional: firmware source + pin/wiring table when the design has electronics
  meta.json        {"title": str, "description": str, "creator": str, "tags": [str], "created": iso8601,
                    "demo": true for seeded examples}
  stl/*.stl        written by build.py
  manifest.json    written by build.py LAST, atomically (tmp + os.replace):
                   {"t": unix_float, "title": str, "parts": [
                     {"file": "stl/<slug>.stl", "name": str, "group": "case"|"component",
                      "process": "print"|"extrusion"|"sheet"|"laser"|"bought",
                      "color": "#rrggbb", "explode": [x,y,z], "bbox": [x,y,z],
                      optional (library parts and fab.py dummies shown detailed):
                      "subparts": [{"file": "stl/<slug>__<i>.stl", "color": "#rrggbb",
                                    "finish": "pcb"|"metal"|"gold"|"plastic"|"rubber"|"glass"}],
                      "lib": {"key", "qty", "name" (its bom line), "unit_cost_usd", "mass_g"}}]}
                   "file" stays the whole part as one mesh (thumbnails, downloads, old viewers); the viewer draws
                   "subparts" instead when present.
                   "file" is RELATIVE to the design dir.
                   Optional top-level "motion": {"file": "motion.json", "duration": s, "frames": n, "parts": n moving}
                   when design.py defines motion() (absent otherwise; a stale motion.json is deleted).
  motion.json      written by build.py BEFORE the manifest, only with motion(); see "Motion".
  thumb.png        640x480 render written by build.py (white/transparent-ish neutral background is fine)
  build_log.txt    last build stdout/stderr (written by build.py)
```

## Motion (optional `motion()` in design.py, the viewer's Move button)

build.py calls `motion()` after `parts()` and samples it (cadlib/motion.py, numpy only, so it runs in the build sandbox
and the warm worker). A failing motion() never fails the build: it prints `WARNING: motion() failed ...` and the Move
button stays off. `motion()` returns any of:

- a function `pose(t) -> {key: transform}`, t in [0, 1) over one loop (do kinematics in Python: IK per frame);
- a list of declarative tracks;
- a dict `{"duration": 6, "frames": 90, "pose": pose, "tracks": [...]}` (duration 1-30 s, frames 12-240).

`key` = a part's `"id"` (preferred for repeated names), else its `"name"` (a name shared by several parts moves all).
Transforms are relative to the built pose, rotation about the pivot first, then translation:
`{"translate": [x,y,z]}`, `{"rotate": [ax,ay,az], "deg": a, "pivot": [x,y,z]}` (or `"rad"`), `{"quat": [x,y,z,w], "pivot"}`,
`{"matrix": 4x4}`. Helpers in `cadlib.motion`: `move(v)`, `rot(axis, deg, pivot)`, `link(a0, b0, a1, b1)` (rigid rod built
a0->b0 placed a1->b1: delta arms, con-rods, linkages), `then(first, second)`, `ease(x)` (smoothstep).

Tracks: `{"part": "Lid" | [names/ids], "type": "rotate" | "slide" | "spin", "axis": [x,y,z], "pivot": [x,y,z],
"range": [a, b]}` (rotate in degrees, or `"unit": "rad"`; slide in mm along axis) plays a -> b -> a smoothly over the
loop; `"keys": [[t, value], ...]` instead of range eases between keyframes (hold = two keys with the same value);
spin turns `"turns"` (default 1) full turns per loop. Several tracks on one part compose with the first listed outermost,
so a chain is listed base to tip, each joint naming every part it carries. `pose` (if both) is applied last.

motion.json: `{"version": 1, "duration": s, "frames": n, "loop": true, "parts": {"stl/<slug>.stl": {"name",
"pos": [[x,y,z] per frame], "quat": [[x,y,z,w] per frame]}}}`; a vertex p moves to `quat * p + pos` (CAD mm, Z up).
Only parts that move are listed. The loop should end where it starts (frame 0 = built pose looks best).

Viewer (web/viewer.js + web/motion.js): a **Move** toggle after the explode slider (desktop) and in the phone glass bar,
shown only when the manifest lists motion. It plays the loop (Catmull-Rom through the frames, slerped rotations), shows a
scrub slider on desktop while playing, and resets to the built pose when pressed again. Move and Explode turn each other
off. Served as `/files/projects/<id>/motion.json` and, on the public build page, `/build/<slug>/motion.json`.

Print estimate in build.py (PETG, 0.4 nozzle, ~6 walls/40% infill): grams = volume_cm3 * 1.27 * 0.55 (min 2 g); print_hours = grams / 20 (min 0.25 h). Printed parts must fit 256 x 256 x 256 mm (warn in build_log if not). Fabricated limits warned in build_log: extrusion <= 1500 mm, sheet flat blank <= 600 x 300 mm, laser bed 600 x 400 mm.

Build exit code 0 on success, non-zero with a readable error in build_log.txt on failure (e.g. Python exception, failed boolean).

## HTTP API (Agent A implements, Agent B consumes)

Static:
- `GET /` -> app/web/index.html (and /web assets at `/` root: `/app.js`, `/styles.css` ...)
- `GET /files/examples/<slug>/<path>` and `GET /files/projects/<id>/<path>` -> raw files from design dirs (no path traversal!)

JSON:
- `GET /api/examples` -> `[{"slug","title","description","creator","tags","thumb":"/files/examples/<slug>/thumb.png","demo":true}]`
- `GET /api/examples/<slug>` -> `{"slug","meta","manifest","bom","base":"/files/examples/<slug>/","code": "<design.py text>"}`
- `POST /api/projects` body `{"prompt"?: str, "fromExample"?: slug}` -> `{"id"}`. fromExample copies the example dir (a "remix"). If prompt given, starts an agent run with it.
- `GET /api/projects` -> list `[{"id","title","updated","thumb"}]`
- `GET /api/projects/<id>` -> `{"id","meta","manifest","bom","base":"/files/projects/<id>/","code","messages":[{"role":"user"|"assistant","text","t"}],"running":bool}`
- `POST /api/projects/<id>/messages` body `{"text"}` -> 202 `{"ok":true}`; starts (or queues) an agent run. 409 if a run is already active.
- `POST /api/projects/<id>/stop` -> stops the active run.
- `GET /api/projects/<id>/events` -> Server-Sent Events, each `data:` is JSON:
  - `{"type":"run_started"}`
  - `{"type":"step","text":"Editing design.py"}`         short human-readable tool step
  - `{"type":"assistant","text":"..."}`                  assistant prose (final or partial)
  - `{"type":"model_updated","t":<manifest t>}`          manifest.json changed -> frontend reloads manifest + STLs
  - `{"type":"bom_updated"}`                              bom.json changed -> frontend refetches quote
  - `{"type":"code_updated"}`                             design.py changed
  - `{"type":"run_finished","ok":bool,"error"?:str,"timeline":{...}}`   timeline = ms from the user's send: spawn (cold only), cli_write, init, first_token, first_tool, sketch, builds [{start,end,ms,ok,warm}], first_model, end, plus warm, effort, model, api_key_source. Also stored as `tl` on the assistant message and in `<project>/runs.jsonl`
  - `{"type":"sketch","sketch":{"title","parts":[{"shape":"box"|"cylinder"|"sphere","size"|"r","h","axis","at","color","name"}]}}`   instant blockout for a new design (mm, Z up)
- `POST /api/projects/<id>/warm` -> `{"agent":"warm"|"started"|"running"|"full","worker":bool}` pre-warms the design agent + build worker, never starts a turn. `POST /api/warm` pre-warms the sketch process (home prompt). `GET /api/stats?n=50` (admins) -> p50/p90 per phase + recent runs.
- Version history (undo / rewind), one tree per chat (`kind`: `"design"` | `"site"`). Every agent run snapshots its files to `<project>/.versions/<n>/before|after/` (design: design.py, bom.json, meta.json; site: `site/` minus waitlist.json, messages.json, launch.json) and is listed in `<project>/versions.json`. User messages that started a run get `"run": n`; undone messages get `"rewound": true`. All of these 409 while that chat's agent runs; design restores rebuild with ./build.sh (normal `model_updated`). Logic in `server/versions.js`, tests in `server/versions.test.js`.
  - `POST /api/projects/<id>/rewind` `{"kind","to_message_index"}` -> files as they were before that message's run
  - `POST /api/projects/<id>/undo` `{"kind"}` / `POST .../redo` `{"kind"}`
  - `POST /api/projects/<id>/restore` `{"kind","n"}` -> files as they were right after run n (`n: 0` = the original)
  - all return `{"ok","kind","label":"Rewound to v3","history","messages"}`; also emit SSE `{"type":"history_changed","kind"}`
  - `GET /api/projects/<id>/versions?kind=` -> `history` = `{"head","current_v","can_undo","can_redo","versions":[{"n","v","message_index","prompt","summary","t","files","status","active","current"}]}` (also in `GET /api/projects/<id>` and `GET .../site/messages`)
  - After any of these, the agent's next turn starts with a one-line note saying the files were restored and to re-read them (same Claude session).
- `GET /api/quote?project=<id>` or `?example=<slug>`, optional `&mode=assembled|kit` ->
  ```
  {"mode","print":{"grams","hours","parts":N},
   "bom":[{"name","qty_per_unit","unit_cost_usd","supplier","url"}],
   "tiers":[{"qty":1|10|100|500,
             "unit":{"parts","material","printing","assembly","packaging","margin"},
             "unit_price","subtotal","shipping","total","lead_time_days"}],
   "notes":[str],
   "part_costs":[{"name","file"?,"kind":"print"|"extrusion"|"sheet"|"laser"|"bought","usd", print: "grams","hours";
                  fabricated: "detail","params"; bought: "qty","unit_usd"}]}
  ```
  part_costs (1-unit tier, before margin) feed the viewer's hover tooltips (web/hover.js): printed parts share the
  tier's material + printing by grams / hours, fabricated parts are pricing_fab's piece price, bought = qty x unit.
- `POST /api/orders` body `{"source":{"project"|"example": id}, "qty", "mode", "ship_to":{"name","line1","city","state","zip"}}` -> `{"id","status":"demo_received","total","eta_days"}`. Saves to app/data/orders.json. NO payment collection of any kind (no card fields anywhere). UI must say "Demo — no payment taken".

## Pricing model (Agent A implements in one function, constants at top)
Per unit for quantity q:
- parts = sum(qty_per_unit * unit_cost_usd) * bulk(q), bulk = {1:1.0, 10:0.9, 100:0.75, 500:0.6}
- material = grams * 0.025
- printing = hours * 0.40
- assembly = (mode=="assembled" ? assembly_minutes * 0.50 : 0)   (kit: +1.00 for the hardware bag)
- packaging = 2.00 (kit 1.50)
- cost = sum of above; margin = 35% of cost; unit_price = cost + margin; for q==1 add 15.00 one-off handling
- shipping total (US ground, to one address): q1 9, q10 25, q100 120, q500 450
- lead_time_days = 2 + ceil(q * hours / (50 printers * 20 h))  (+1 if assembled and q>=100)
Round money to cents.

## Design agent (spawned per chat message by Agent A)
- `claude -p "<message>" --output-format stream-json --verbose --permission-mode acceptEdits --resume/--session-id <per-project uuid>`, cwd = project dir, append a system prompt from `app/server/design_agent_prompt.md`, restrict tools (Read, Write, Edit, Glob, Grep, WebSearch, Bash limited to running `./build.sh`).
- `./build.sh` in each project runs: `<venv python> -m cadlib.build .` with PYTHONPATH=app root, so cadlib is importable.
- The agent must: keep design.py defining parts(); run ./build.sh after EVERY meaningful change (so the user sees progress live; first rough export within ~2 minutes); update bom.json with real buyable parts (hardware store / Amazon / McMaster) with honest prices; design for fast printing (target < 3 h total print, few parts, no supports); fit 256 mm; no copying branded products' logos/trade dress; keep answers short.

## UI language
Plain, sentence case. NO eyebrow labels (small uppercase letter-spaced text above headings) anywhere.

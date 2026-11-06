# Reference models: licence policy

This is a good-faith policy written by the team, not legal advice. Have a lawyer look over it before the library or
Premake's usage grows.

## What a reference model is for

A reference model is a 3D stand-in for a real product or part: the customer's Nintendo Switch, a phone, an ESP32
board, a fan. Its only job is to make the design readable in the 3D view and in renders, so the customer can check the
fit.

Premake is a commercial product, so the rules are strict:

- **Display only.** A model is drawn in the viewer (studio, build page, share page) and in rendered images.
- **Never sold, printed or shipped.** It is never a printed part, never in an order or a fulfilment job, and never in
  the price or the BOM. A customer's own item gets no BOM line at all. A bought part keeps its normal BOM line, priced
  from the catalogue, never from the model.
- **Never in downloadable files.** Models are never in the STL zips, the "everything" zip, cut lists or parts CSVs.
  - `ref()` writes only a plain bounding box of the real size to the design's `stl/` folder.
  - The model file itself is served only from `/refmodels/<key>/model.glb` for the viewer.
- **Kept separate and unmodified.**
  - Each model lives in its own folder, `web/refmodels/<key>/`, holding `model.glb` and `license.json`.
  - A model is never merged into a design's geometry or into another model.
  - Third-party models get only mechanical changes: format conversion (STEP to GLB), re-centring, rotation to the
    library's axes and unit scaling.

Every `license.json` records `allowed_use: "display-only"`.

## Allowed sources and licences

Only these values may appear in `license.json` → `license`. The test `cadlib/refmodels/test_refmodels.py` fails on
anything else, and also fails when a model has no `license.json`.

| `license` value | What it is | Obligations we meet |
|---|---|---|
| `CC0-1.0` | CC0 / public domain | none (we credit anyway) |
| `CC-BY-4.0`, `CC-BY-3.0` | Creative Commons Attribution | Show the title, author, licence and link wherever the model appears (see "Attribution" below). Say that the model was modified (converted). |
| `CC-BY-SA-4.0`, `CC-BY-SA-3.0` | Creative Commons Attribution-ShareAlike | Attribution as above. See the share-alike section below. |
| `CC-BY-SA-4.0 WITH KiCad-libraries-exception` | KiCad 3D models library (gitlab.com/kicad/libraries/kicad-packages3D) | Attribution: "KiCad Library contributors". See the KiCad section below. |
| `RaspberryPi-design-files` | Official Raspberry Pi design files, offered with permission to use, copy, modify and distribute | Credit Raspberry Pi Ltd. |
| `Premake-original` | Our own parametric models, built with CadQuery from `cadlib.dims` sizes | none |

Other manufacturer CAD (Espressif, Arduino under CC BY-SA, Adafruit, SparkFun) may join only when its own terms allow
redistribution and use in customer designs. Add a new `license` value here and in `ALLOWED_LICENSES` at the same time,
with a link to those terms. Misumi and McMaster-style downloads join only if their terms allow redistribution. Most
McMaster terms do not, so they are excluded.

### Not allowed

The following are never accepted:

- **Restrictive licences:**
  - any NonCommercial licence (CC BY-NC, BY-NC-SA, BY-NC-ND)
  - "All rights reserved"
  - "Editorial use only" and "IP restricted" listings (TurboSquid, RenderHub)
- **GrabCAD's default terms.** They do not allow redistribution.
- **A licence that is unclear, missing, or only implied**, for example a forum post or a model with no licence field.
- **Anything that needs a login to download** (SnapEDA, Sketchfab downloads, CGTrader).
- **Thingiverse or Printables items**, unless that item's own licence is on the list above. Many are NC.
- **MIT, Apache and other software licences.** They are not on the list yet, though they are probably fine. Ask the
  owner first. The Adafruit CAD repo and the Raspberry Pi 5 STEP are MIT: see SOURCES.md.

### Share-alike (CC BY-SA, KiCad)

Share-alike applies to the model itself and to adaptations of it. It does not reach a customer's design that is only
displayed next to it. So we:

- keep each SA model in its own file, never merged with a design or with other models
- change it only by format conversion, re-centring, axis rotation and scaling, and say so in `license.json` → `modified`
- offer the converted file under the same licence, with attribution and a link to the original
  - the GLB at `/refmodels/<key>/model.glb` plus its `license.json` do this
- never add terms or technical measures that restrict what others may do with that file

The KiCad libraries carry an exception that waives share-alike for electronic designs that use them. KiCad's
`LICENSE.md` also says that redistributing the libraries, or parts of them, as a collection does not get that
exception: full CC BY-SA terms apply. Serving several KiCad models from one folder is close to a collection, so we
follow the full CC BY-SA terms for KiCad models, as listed above.

## Attribution in the UI

Where a reference model is shown, the UI shows its credit:

- the part's hover card in the 3D view: small muted text, for example "Model: KiCad Library contributors, CC BY-SA 4.0
  (KiCad library)"
- the Parts list: the same text under the part name, with the full `attribution_text` (title, author, licence URL,
  source URL, changes) as its tooltip

`web/refmodels/index.json` carries `credit`, `attribution_text`, `license_url` and `source_url` for each model.

## Trademarks and product likeness

A 3D likeness of a consumer product, such as a Switch or an iPhone, shown so customers can check that a holder fits
their own device, is nominative use: it names or shows the product only to say what the design is for. To keep it that
way:

- **No logos or brand marks on any model.** No decals, no printed text, no embossed logos. Our parametric models are
  built with shapes and colours only. Third-party models are checked for logo geometry before they join, and a model
  with one is rejected or stripped.
- **No implied endorsement.**
  - Products are labelled "<product> (reference model, not included)", for example "Nintendo Switch OLED console
    (reference model, not included)".
  - The customer's own items are named "... (yours)" and marked "not included".
  - No manufacturer is presented as a partner or sponsor.
- **Products are built ourselves.** Consoles, controllers and phones are Premake parametric models made from published
  dimensions, not copies of the manufacturer's CAD.

## Adding a model

1. Find a source on the allowed list. Record it in SOURCES.md: what you searched, the URL, the licence text you relied
   on, and why it was accepted.
2. Download it into a new, empty folder outside the repo, and treat it as untrusted data:
   - never execute anything in it
   - convert it only in isolated mode: `.venv/bin/python -I cadlib/refmodels/__main__.py convert FILE KEY --license license.json`
   - or add a spec to `library.py` and run `... build KEY --downloads DIR`
3. Check it in the viewer for logos and text, orientation (`front`) and size.
   - The build prints `MISMATCH` when a size is more than 1 mm off its `cadlib.dims` entry. The test fails on that too.
4. Run `python -m unittest cadlib.refmodels.test_refmodels` and `node --test server/refmatch.test.js`.

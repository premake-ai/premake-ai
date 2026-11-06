"""python -m cadlib.refmodels                      list the reference models (key, title, size, credit)
python -m cadlib.refmodels build [keys] [--downloads DIR]
                                                rebuild models: parametric ones always, downloaded ones from DIR
                                                (vetted files, see SOURCES.md); then rewrite the indexes
python -m cadlib.refmodels index               rewrite web/refmodels/index.json + catalog.json from the folders
python -m cadlib.refmodels convert FILE KEY --license LICENSE.json [--units mm] [--rotate rx,ry,rz]
                                                add one vetted file (writes web/refmodels/KEY/; add a spec to
                                                library.py too so the index keeps it)

Downloaded files are untrusted data. Convert them in isolated mode so nothing next to them can be imported:
    .venv/bin/python -I cadlib/refmodels/__main__.py build --downloads /path/to/refdl
"""
import os
import sys

if __package__ in (None, ""):  # run as a script (python -I path/to/__main__.py): import cadlib from this checkout only
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    __package__ = "cadlib.refmodels"

import datetime  # noqa: E402
import hashlib  # noqa: E402
import json  # noqa: E402

from cadlib.refmodels import ALLOWED_LICENSES, CATALOG, WEB_LIB, catalog_text  # noqa: E402
from cadlib.refmodels import convert as conv  # noqa: E402
from cadlib.refmodels.library import SPECS  # noqa: E402

TODAY = datetime.date.today().isoformat()
INDEX = os.path.join(WEB_LIB, "index.json")
VIEW_FIELDS = ("key", "title", "kind", "label", "front", "match", "prefer", "lib_keys", "fit", "pitch", "tint", "size",
               "file", "bytes", "swatch", "credit", "license", "license_url", "source_url", "author", "attribution_text")
SHORT = {"CC-BY-SA-4.0 WITH KiCad-libraries-exception": "CC BY-SA 4.0 (KiCad library)", "CC-BY-3.0": "CC BY 3.0",
         "CC-BY-4.0": "CC BY 4.0", "CC-BY-SA-4.0": "CC BY-SA 4.0", "CC-BY-SA-3.0": "CC BY-SA 3.0", "CC0-1.0": "CC0"}


def spec_by_key():
    return {s["key"]: s for s in SPECS}


def license_for(s, src_path=None, retrieved=None):
    own = s["src"].startswith("build:")
    lic = s.get("license", "Premake-original" if own else None)
    author = s.get("author", "Premake" if own else None)
    lj = {
        "key": s["key"],
        "title": s["title"],
        "source_url": s.get("source_url", ""),
        "author": author,
        "license": lic,
        "license_url": s.get("license_url", ""),
        "retrieved": retrieved or TODAY,
        "modified": ("parametric model built with CadQuery from cadlib.dims sizes, exported to GLB" if own
                     else "converted STEP to GLB (tessellated, one material per colour), "
                          f"re-centred{', rotated ' + str(tuple(s['rotate'])) + ' deg' if s.get('rotate') else ''}, "
                          "scaled to millimetres; geometry otherwise unchanged"),
        "attribution_text": "",
        "allowed_use": "display-only",
    }
    if own:
        lj["attribution_text"] = f"{s['title']} reference model by Premake (original parametric model)."
    else:
        name = os.path.basename(s["src"].split(":", 1)[1])
        lj["attribution_text"] = (f"\"{name}\" by {author}, {SHORT.get(lic, lic)} ({lj['license_url']}), "
                                  f"from {lj['source_url']}. {lj['modified'][0].upper() + lj['modified'][1:]}.")
    if src_path:
        with open(src_path, "rb") as f:
            lj["source_sha256"] = hashlib.sha256(f.read()).hexdigest()
    return lj


def credit(lj):
    if lj["license"] == "Premake-original":
        return "Model: Premake"
    if lj["license"] == "RaspberryPi-design-files":
        return f"Model: {lj['author']}"
    return f"Model: {lj['author']}, {SHORT.get(lj['license'], lj['license'])}"


def build(keys=None, downloads=None):
    specs = [s for s in SPECS if not keys or s["key"] in keys]
    for s in specs:
        out = os.path.join(WEB_LIB, s["key"])
        src = s["src"]
        if src.startswith("build:"):
            from cadlib.refmodels import builders
            size, n, tris = conv.convert_model(builders.BUILDERS[src[6:]](), out)
            lj = license_for(s)
        else:
            if not downloads:
                print(f"  skip {s['key']}: downloaded model (pass --downloads DIR to rebuild it)")
                continue
            path = os.path.join(downloads, src[5:])
            if not os.path.isfile(path):
                print(f"  skip {s['key']}: {path} not found")
                continue
            size, n, tris = conv.convert_file(path, out, rotate=tuple(s.get("rotate", (0, 0, 0))), tol=s.get("tol"))
            old = os.path.join(out, "license.json")
            prev = conv.load_json(old) if os.path.isfile(old) else {}
            lj = license_for(s, path, retrieved=prev.get("retrieved"))
        with open(os.path.join(out, "license.json"), "w") as f:
            json.dump(lj, f, indent=1)
        print(f"  {s['key']:20s} {size[0]:7.2f} x {size[1]:7.2f} x {size[2]:7.2f} mm  {n / 1024:6.0f} KB  {tris:6d} tris  {lj['license']}")
    index()


def dims_report(s, size):
    """[(dims key, field, axis, published, model, diff)] for the spec's cross-checks."""
    from cadlib import dims
    out = []
    for dk, field, axis, offset in s.get("dims", []):
        want = float(dims.entry(dk)["dims"][field])
        got = size["xyz".index(axis)] - offset
        out.append({"dims": dk, "field": field, "axis": axis, "published_mm": want, "model_mm": round(got, 2),
                    "diff_mm": round(got - want, 2)})
    return out


def index():
    """Write web/refmodels/index.json (viewer) and cadlib/refmodels/catalog.json (ref()) from the model folders."""
    rows, cat = [], []
    for s in SPECS:
        d = os.path.join(WEB_LIB, s["key"])
        glb, lic = os.path.join(d, "model.glb"), os.path.join(d, "license.json")
        if not (os.path.isfile(glb) and os.path.isfile(lic)):
            print(f"  warning: {s['key']} has no model yet")
            continue
        lj = conv.load_json(lic)
        size, tris, mats = conv.glb_info(glb)
        swatch = _swatch(glb)
        e = {
            "key": s["key"], "title": s["title"], "kind": s["kind"],
            "label": f"{s['title']} (reference model, not included)" if s["kind"] == "product" else s["title"],
            "front": s["front"], "match": s.get("match", []), "prefer": s.get("prefer", []), "lib_keys": s.get("lib_keys", []),
            "fit": s.get("fit", "fixed"), "pitch": s.get("pitch"), "tint": s.get("tint"), "size": size,
            "file": f"refmodels/{s['key']}/model.glb", "bytes": os.path.getsize(glb), "triangles": tris, "swatch": swatch,
            "credit": credit(lj), "license": lj["license"], "license_url": lj["license_url"],
            "source_url": lj["source_url"], "author": lj["author"], "attribution_text": lj["attribution_text"],
            "dims_check": dims_report(s, size),
        }
        for c in e["dims_check"]:
            if abs(c["diff_mm"]) > 1.0:
                print(f"  MISMATCH {s['key']}: {c['dims']}.{c['field']} published {c['published_mm']} mm, "
                      f"model {c['model_mm']} mm along {c['axis']}")
        rows.append(e)
        cat.append({k: e[k] for k in ("key", "title", "kind", "label", "size", "front", "swatch", "credit", "license")})
    with open(INDEX + ".tmp", "w") as f:
        json.dump({"v": 1, "models": [{k: r.get(k) for k in VIEW_FIELDS} for r in rows]}, f, indent=1)
    os.replace(INDEX + ".tmp", INDEX)
    with open(CATALOG + ".tmp", "w") as f:
        json.dump(cat, f, indent=1)
    os.replace(CATALOG + ".tmp", CATALOG)
    with open(os.path.join(os.path.dirname(CATALOG), "dims_check.json"), "w") as f:
        json.dump({r["key"]: r["dims_check"] for r in rows if r["dims_check"]}, f, indent=1)
    bad = [r["key"] for r in rows if r["license"] not in ALLOWED_LICENSES]
    if bad:
        print(f"  ERROR: licence outside the allowlist: {', '.join(bad)}")
    print(f"index: {len(rows)} models, {sum(r['bytes'] for r in rows) / 1024:.0f} KB")


def _swatch(glb):
    import trimesh
    sc = trimesh.load(glb, force="scene")
    best = max(sc.geometry.values(), key=lambda g: g.area)
    c = getattr(best.visual.material, "baseColorFactor", None)
    if c is None:
        return "#8a8f98"
    c = [float(x) / (255.0 if max(c) > 1 else 1.0) for x in list(c)[:3]]
    to = lambda x: max(0, min(255, round((x * 12.92 if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055) * 255)))
    return "#%02x%02x%02x" % tuple(to(x) for x in c)


def main(argv):
    if not argv:
        from cadlib.refmodels import catalog
        try:
            catalog()
        except FileNotFoundError:
            print("no catalog yet: run `python -m cadlib.refmodels build`")
            return 1
        print(catalog_text())
        return 0
    cmd, rest = argv[0], argv[1:]
    if cmd == "build":
        dl = None
        if "--downloads" in rest:
            i = rest.index("--downloads")
            dl = rest[i + 1]
            rest = rest[:i] + rest[i + 2:]
        build(set(rest) or None, dl)
        return 0
    if cmd == "index":
        index()
        return 0
    if cmd == "convert":
        src, key = rest[0], rest[1]
        opt = dict(zip(rest[2::2], rest[3::2]))
        with open(opt["--license"]) as f:
            lj = json.load(f)
        if lj.get("license") not in ALLOWED_LICENSES:
            print(f"refused: licence {lj.get('license')!r} is not on the allowlist ({', '.join(ALLOWED_LICENSES)})")
            return 1
        rot = tuple(float(x) for x in opt.get("--rotate", "0,0,0").split(","))
        out = os.path.join(WEB_LIB, key)
        size, n, tris = conv.convert_file(src, out, units=opt.get("--units", "mm"), rotate=rot)
        lj.update(key=key, allowed_use="display-only")
        with open(os.path.join(out, "license.json"), "w") as f:
            json.dump(lj, f, indent=1)
        print(f"{key}: {size} mm, {n} bytes, {tris} triangles. Add a spec in library.py, then run `index`.")
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

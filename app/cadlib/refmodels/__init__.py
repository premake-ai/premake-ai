"""Reference models: real-looking products and parts shown in the 3D view, display only.

    from cadlib.refmodels import ref
    ref("switch_oled", at=(0, -12, 4))                 # the customer's own Switch: "(yours)", no BOM line, price 0
    ref("joycon_l", at=(-110, -18, 3), rot=(0, 0, 0))
    ref("fan_120", at=(0, 0, 0), yours=False, price=9.0, search="120mm case fan")   # a bought part with a BOM line

ref() returns a parts() dict: a box of the model's real size (for clearance and picking; that box is what goes into
stl/) with "ref_model" set, so the viewer shows the vetted model there instead. The model itself is never part of the
design's files, downloads, order or price. Origin: centred in X and Y, bottom on z=0; standing products (consoles,
phones, controllers) face -Y, flat parts (boards, fans, motors) have their component side / airflow / shaft up (+Z).
rot = degrees about X, then Y, then Z (about the origin), then `at` moves it, like cadlib.parts.part().

`python -m cadlib.refmodels` lists the keys. Only this vetted library may be used: never import models from the web at
design time. Licences and the rules: cadlib/refmodels/LICENSES.md; where each model came from: SOURCES.md.
"""
import difflib
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(os.path.dirname(HERE))
WEB_LIB = os.path.join(APP, "web", "refmodels")
CATALOG = os.path.join(HERE, "catalog.json")

# Licences a model may carry (license.json "license"). Anything else fails cadlib/refmodels/test_refmodels.py.
ALLOWED_LICENSES = {
    "CC0-1.0": "Creative Commons Zero / public domain",
    "CC-BY-4.0": "Creative Commons Attribution 4.0 (attribution shown in the UI)",
    "CC-BY-3.0": "Creative Commons Attribution 3.0 (attribution shown in the UI)",
    "CC-BY-SA-4.0": "Creative Commons Attribution-ShareAlike 4.0 (attribution; file kept separate, only converted / scaled)",
    "CC-BY-SA-3.0": "Creative Commons Attribution-ShareAlike 3.0 (as above)",
    "CC-BY-SA-4.0 WITH KiCad-libraries-exception": "KiCad 3D models library (CC BY-SA 4.0 + design-use exception)",
    "RaspberryPi-design-files": "Raspberry Pi Ltd design files: use, copy, modify and distribute without limitation",
    "Premake-original": "Premake's own parametric model (built with CadQuery from cadlib.dims sizes)",
}
_cat = None


def catalog():
    """{key: entry} from catalog.json (title, kind, label, size [x, y, z] mm, front, credit, license, ...)."""
    global _cat
    if _cat is None:
        with open(CATALOG) as f:
            _cat = {e["key"]: e for e in json.load(f)}
    return _cat


def keys():
    return sorted(catalog())


def entry(key):
    cat = catalog()
    if key not in cat:
        close = difflib.get_close_matches(str(key), cat, n=4, cutoff=0.4)
        raise KeyError(f"no reference model {key!r}" + (f"; did you mean {', '.join(close)}?" if close else
                                                         "; `python -m cadlib.refmodels` lists them"))
    return cat[key]


def _matrix(at, rot, lift):
    """4x4 (row-major nested lists): model frame (bbox centre at origin) -> design frame."""
    rx, ry, rz = (math.radians(float(a)) for a in (list(rot) + [0, 0, 0])[:3])

    def mul(a, b):
        return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]
    Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]
    Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]
    R = mul(Rz, mul(Ry, Rx))  # X first, then Y, then Z (static axes), like cadlib.parts.part
    t = [sum(R[i][k] * (0, 0, lift)[k] for k in range(3)) + float(at[i]) for i in range(3)]
    return [[round(R[i][0], 9), round(R[i][1], 9), round(R[i][2], 9), round(t[i], 6)] for i in range(3)] + [[0, 0, 0, 1]]


def ref(key, at=(0, 0, 0), rot=(0, 0, 0), name=None, yours=None, explode=None, color=None, price=None, search=None):
    """A display-only reference model as a parts() entry (see the module docstring).
    yours: the customer's own item (default for products such as consoles and phones): named "... (yours)", no BOM
    line, price 0. Otherwise pass price (USD) and optionally search (an Amazon search term) to get a bought BOM line;
    without a price the part is shown but not listed (use cadlib.parts.part() for library parts with prices)."""
    import cadquery as cq
    e = entry(key)
    if yours is None:
        yours = e["kind"] == "product"
    sx, sy, sz = (float(v) for v in e["size"])
    m = _matrix(at, rot, sz / 2)
    shape = cq.Workplane("XY").box(sx, sy, sz).translate((0, 0, sz / 2))
    rx, ry, rz = (float(a) for a in (list(rot) + [0, 0, 0])[:3])
    if rx:
        shape = shape.rotate((0, 0, 0), (1, 0, 0), rx)
    if ry:
        shape = shape.rotate((0, 0, 0), (0, 1, 0), ry)
    if rz:
        shape = shape.rotate((0, 0, 0), (0, 0, 1), rz)
    shape = shape.translate(tuple(float(a) for a in at))
    out = {
        "name": name or (f"{e['title']} (yours)" if yours else e["title"]),
        "shape": shape,
        "process": "bought",
        "group": "component",
        "color": color or e.get("swatch") or "#8a8f98",
        "ref_model": {"key": key, "m": m, "yours": bool(yours)},
    }
    if not yours and price is not None:
        from urllib.parse import quote_plus
        term = search or e["title"]
        out["lib"] = {"key": "ref:" + key, "qty": 1, "bom": {
            "name": e["title"], "unit_cost_usd": float(price), "supplier": "Amazon",
            "url": "https://www.amazon.com/s?k=" + quote_plus(term), "notes": "shown with a reference model"}}
    if explode is not None:
        out["explode"] = explode
    return out


def catalog_text():
    lines = []
    for k in keys():
        e = catalog()[k]
        s = " x ".join(f"{v:g}" for v in e["size"])
        lines.append(f"{k:20s} {e['title']}  [{s} mm, {e['kind']}, front {e['front']}]  {e['credit']}")
    return "\n".join(lines)

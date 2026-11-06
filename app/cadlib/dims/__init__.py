"""Real-world dimensions (phones, consoles, jars, bike parts, threads, fans, boards, sheet stock...):

    from cadlib.dims import dim
    sw = dim("switch_oled")          # {"width_mm": 242, "height_mm": 102, ..., "name", "source", "checked", "notes", ...}
    w, h = sw["width_mm"], sw["height_mm"]

Every entry was looked up from a published source (manufacturer spec page, datasheet or standards table) and carries
its `source` URL, the date it was `checked` and a `confidence` ("official", "datasheet", "measured" or "estimate").
The data lives in one JSON file per group in this folder; `python -m cadlib.dims` prints the index, and
`python -m cadlib.dims <key>` one entry.

dim() records every key it is asked for; the build prints them ("sizes from cadlib.dims: ...") so the agent can cite
the numbers and sources it used. Unknown keys raise KeyError with the closest matches.
"""
import difflib
import glob
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
META = ("key", "name", "category", "source", "sources", "checked", "confidence", "notes", "parts_key")
CONFIDENCE = ("official", "datasheet", "measured", "estimate")
USED = {}  # key -> flattened entry, in the order dim() was called (printed by cadlib.build)
_lib = None


def _norm(key):
    return re.sub(r"[^a-z0-9]+", "_", str(key).lower()).strip("_")


def load():
    """{key: entry} for every entry in every JSON file here (cached). Raises ValueError on a duplicate key."""
    global _lib
    if _lib is None:
        lib = {}
        for path in sorted(glob.glob(os.path.join(HERE, "*.json"))):
            with open(path) as f:
                for e in json.load(f):
                    k = e["key"]
                    if k in lib:
                        raise ValueError(f"cadlib.dims: duplicate key {k!r} in {os.path.basename(path)}")
                    lib[k] = dict(e, file=os.path.basename(path))
        _lib = lib
    return _lib


def keys(category=None):
    return sorted(k for k, e in load().items() if category is None or e["category"] == category)


def categories():
    return sorted({e["category"] for e in load().values()})


def entry(key):
    """The raw entry (dims nested under "dims"). KeyError with suggestions if unknown."""
    lib = load()
    k = key if key in lib else _norm(key)
    if k not in lib:
        close = difflib.get_close_matches(k, lib, n=5, cutoff=0.5) or search(k)[:5]
        hint = f"; did you mean {', '.join(close)}?" if close else "; look it up (WebSearch + WebFetch) and cite it"
        raise KeyError(f"cadlib.dims has no {key!r}{hint}")
    return lib[k]


def dim(key):
    """Flat dict of one entry: its numbers (width_mm, ...) plus name, source, checked, confidence and notes."""
    e = entry(key)
    out = dict(e["dims"])
    for m in META:
        if m in e:
            out[m] = e[m]
    USED[e["key"]] = out
    return dict(out)


def search(text):
    """Keys whose key, name or category contains every word of `text`."""
    words = [w for w in re.split(r"[^a-z0-9]+", str(text).lower()) if w]
    hay = {k: f"{k} {e['name']} {e['category']}".lower() for k, e in load().items()}
    return sorted(k for k, h in hay.items() if all(w in h for w in words))


def reset_used():
    USED.clear()


def _fmt(v):
    if isinstance(v, float):
        return f"{v:g}"
    if isinstance(v, list):
        return "[" + ", ".join(_fmt(x) for x in v) + "]"
    return str(v)


def describe(key):
    """One line: key: name, the numbers, (confidence, source)."""
    e = entry(key)
    nums = ", ".join(f"{k} {_fmt(v)}" for k, v in e["dims"].items())
    return f"{e['key']}: {e['name']}: {nums} ({e['confidence']}, {e['source']}, checked {e['checked']})"


def used_report():
    """Lines for the build log: every entry design.py used, with its source."""
    return [describe(k) for k in USED]


def index():
    """'category: key, key, ...' lines (the agent's prompt carries the same index)."""
    return [f"{c}: {', '.join(keys(c))}" for c in categories()]


"""Live part previews while design.py is still being written:  python -m cadlib.preview <design_dir>

Started by the server (server/livepreview.js) for a NEW design's first Write of design.py, inside the same Seatbelt
sandbox, empty environment and caps as ./build.sh, at low priority. It never touches design.py, stl/ or manifest.json.

stdin: one JSON line per job, {"src": "<the complete top-level statements of design.py so far>"}.
For each job it runs the module-level code (statement by statement: one that fails, e.g. because a helper isn't written
yet, is skipped) and calls every argument-free, non-underscore top-level function except parts() / motion(). A function
whose result is a shape (cq.Workplane / cq.Shape / build123d object / trimesh / a cadlib.parts.part() dict, or a list of
those dicts) is exported as a coarse STL to <design_dir>/preview/<hash>.stl, cached by the function's source, and
reported as {"part": {name, file, lo, hi, color?, price?, bought?}}. A function that raises is retried on the next job.
Each job ends with {"done": true, "cpu_ms": n}.
Before each statement / function it may crash in (OpenCascade can segfault on a half-finished fillet; cadlib then
exits quietly), it prints {"trying": "<hash>"}; the server adds that hash to the job's "skip" list from then on, so a
crashing function is never run again in this session.
"""
import ast
import hashlib
import json
import os
import signal
import sys
import time

SKIP = {"parts", "motion", "main", "assembly", "scene", "steps"}
CALL_TIMEOUT_S = 8
STL_TOL, STL_ANG = 0.4, 0.5  # coarse: a preview, not a part


class Timeout(Exception):
    pass


def _alarm(signum, frame):
    raise Timeout()


def parse_prefix(src):
    """Longest prefix of src (cut at top-level line starts) that parses."""
    lines = src.split("\n")
    try:
        return src, ast.parse(src)
    except SyntaxError:
        pass
    for i in range(len(lines) - 1, 0, -1):
        ln = lines[i]
        if not ln or ln[0] in " \t#)]}":
            continue
        cut = "\n".join(lines[:i]) + "\n"
        try:
            return cut, ast.parse(cut)
        except SyntaxError:
            continue
    return "", None


def no_required_args(fn):
    a = fn.args
    return not a.posonlyargs and len(a.args) == len(a.defaults) and all(d is not None for d in a.kw_defaults) and not a.vararg


def to_items(r, name):
    """[(name, shape, extra)] for a function result, or [] if it isn't a shape."""
    import cadquery as cq
    if isinstance(r, dict) and "shape" in r:
        lib = r.get("lib") if isinstance(r.get("lib"), dict) else {}
        line = lib.get("bom") or {}
        extra = {"color": r.get("color")}
        if lib:
            extra.update(bought=True, price=line.get("unit_cost_usd"), qty=lib.get("qty"))
        return [(str(r.get("name") or name), r["shape"], extra)]
    if isinstance(r, (list, tuple)) and r and all(isinstance(x, dict) and "shape" in x for x in r[:12]):
        out = []
        for x in r[:12]:
            out += to_items(x, name)
        return out
    if isinstance(r, (cq.Workplane, cq.Shape, cq.Assembly)):
        return [(name, r, {})]
    if hasattr(r, "wrapped") and r.__class__.__module__.startswith("build123d"):
        return [(name, cq.Shape.cast(r.wrapped), {})]
    try:
        import trimesh
        if isinstance(r, trimesh.Trimesh):
            return [(name, r, {})]
    except Exception:
        pass
    return []


def export(shape, out):
    """Coarse STL; returns (lo, hi)."""
    import cadquery as cq
    from cadlib.build import to_cq_shape
    tmp = out + ".tmp"
    import trimesh
    s = None if isinstance(shape, trimesh.Trimesh) else to_cq_shape(shape)
    if s is not None:
        cq.exporters.export(s, tmp, exportType="STL", tolerance=STL_TOL, angularTolerance=STL_ANG)
        bb = s.BoundingBox()
        lo, hi = [bb.xmin, bb.ymin, bb.zmin], [bb.xmax, bb.ymax, bb.zmax]
    else:
        shape.export(tmp, file_type="stl")
        lo, hi = shape.bounds[0].tolist(), shape.bounds[1].tolist()
    if os.path.getsize(tmp) < 200:
        os.remove(tmp)
        raise ValueError("empty mesh")
    os.replace(tmp, out)
    return [round(v, 2) for v in lo], [round(v, 2) for v in hi]


def trying(h):
    print(json.dumps({"trying": h}), flush=True)


def run_job(src, design_dir, out_dir, cache, skip=()):
    code, tree = parse_prefix(src)
    if tree is None:
        return
    ns = {"__name__": "design_preview", "__file__": os.path.join(design_dir, "design.py")}
    signal.signal(signal.SIGALRM, _alarm)
    for node in tree.body:  # module-level code, one statement at a time
        if isinstance(node, (ast.FunctionDef, ast.ClassDef, ast.Import, ast.ImportFrom, ast.Assign, ast.AnnAssign, ast.AugAssign, ast.Expr, ast.If, ast.For, ast.Try, ast.With)):
            if isinstance(node, ast.Expr) and not isinstance(getattr(node, "value", None), ast.Constant):
                continue  # bare calls at module level (prints, debug) are skipped
            sh = "m" + hashlib.sha1((ast.get_source_segment(code, node) or "").encode("utf-8")).hexdigest()[:13]
            if sh in skip:
                continue
            if not isinstance(node, (ast.FunctionDef, ast.ClassDef, ast.Import, ast.ImportFrom)):
                trying(sh)
            try:
                signal.alarm(CALL_TIMEOUT_S)
                exec(compile(ast.Module(body=[node], type_ignores=[]), "design.py", "exec"), ns)
            except BaseException:
                pass
            finally:
                signal.alarm(0)
    for node in tree.body:
        if not isinstance(node, ast.FunctionDef) or node.name.startswith("_") or node.name in SKIP or not no_required_args(node):
            continue
        seg = ast.get_source_segment(code, node) or node.name
        h = hashlib.sha1(seg.encode("utf-8")).hexdigest()[:14]
        if h in cache or h in skip:
            continue
        fn = ns.get(node.name)
        if not callable(fn):
            continue
        trying(h)
        try:
            signal.alarm(CALL_TIMEOUT_S)
            r = fn()
        except BaseException:
            continue  # e.g. a helper it calls isn't written yet: retried with the next prefix
        finally:
            signal.alarm(0)
        items = []
        try:
            items = to_items(r, node.name)
        except Exception:
            items = []
        cache.add(h)  # a result that isn't a shape is never retried for this source
        for k, (name, shape, extra) in enumerate(items):
            fn_out = f"{h}{'-' + str(k) if k else ''}.stl"
            try:
                lo, hi = export(shape, os.path.join(out_dir, fn_out))
            except BaseException:
                continue
            part = {"name": name, "fn": node.name, "file": "preview/" + fn_out, "lo": lo, "hi": hi}
            part.update({k2: v for k2, v in extra.items() if v is not None})
            print(json.dumps({"part": part}), flush=True)


def main():
    if len(sys.argv) != 2:
        print("usage: python -m cadlib.preview <design_dir>", file=sys.stderr)
        return 2
    design_dir = os.path.abspath(sys.argv[1])
    out_dir = os.path.join(design_dir, "preview")
    os.makedirs(out_dir, exist_ok=True)
    os.chdir(design_dir)
    sys.path.insert(0, design_dir)
    try:
        os.nice(10)
    except Exception:
        pass
    import cadquery  # noqa: F401  the slow import, done while the code still streams in
    from cadlib import build  # noqa: F401
    cache = set()
    for line in sys.stdin:
        try:
            job = json.loads(line)
        except Exception:
            continue
        t0 = time.process_time()
        try:
            run_job(str(job.get("src") or ""), design_dir, out_dir, cache, set(job.get("skip") or ()))
        except BaseException:
            pass
        print(json.dumps({"done": True, "cpu_ms": int((time.process_time() - t0) * 1000)}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

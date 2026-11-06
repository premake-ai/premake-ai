"""Minimal fallback for `python -m cadlib.build <dir>`, used by build.sh only
when app/cadlib/build.py does not exist yet. Same outputs as the contract
(stl/, manifest.json, bom.json "printed", build_log.txt), no thumbnail."""
import importlib.util, io, json, os, re, sys, time, traceback, contextlib

import cadquery as cq


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "part"


def main(d):
    d = os.path.abspath(d)
    log = io.StringIO()
    ok = True
    try:
        with contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
            spec = importlib.util.spec_from_file_location("design", os.path.join(d, "design.py"))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            items = mod.parts()
            os.makedirs(os.path.join(d, "stl"), exist_ok=True)
            mparts, printed, used = [], [], set()
            for p in items:
                shape = p["shape"]
                if isinstance(shape, cq.Workplane):
                    shape = shape.val() if len(shape.vals()) == 1 else cq.Compound.makeCompound(shape.vals())
                s = slug(p["name"])
                while s in used:
                    s += "-x"
                used.add(s)
                rel = f"stl/{s}.stl"
                cq.exporters.export(shape, os.path.join(d, rel), tolerance=0.1, angularTolerance=0.2)
                bb = shape.BoundingBox()
                bbox = [round(bb.xlen, 2), round(bb.ylen, 2), round(bb.zlen, 2)]
                group = p.get("group", "case")
                mparts.append({"file": rel, "name": p["name"], "group": group,
                               "color": p.get("color", "#d8d8d8" if group == "case" else "#555555"),
                               "explode": p.get("explode", [0, 0, 0]), "bbox": bbox})
                if group == "case":
                    grams = max(2.0, shape.Volume() / 1000 * 1.27 * 0.55)
                    if max(bbox) > 256:
                        print(f"WARNING: {p['name']} exceeds 256 mm build volume: {bbox}")
                    printed.append({"file": rel, "name": p["name"], "grams": round(grams, 1),
                                    "print_hours": round(max(0.25, grams / 20), 2), "bbox": bbox})
            bp = os.path.join(d, "bom.json")
            try:
                bom = json.load(open(bp))
            except Exception:
                bom = {"parts": [], "assembly_minutes": 0, "kit_ok": True}
            bom["printed"] = printed
            json.dump(bom, open(bp, "w"), indent=2)
            title = "Untitled"
            try:
                title = json.load(open(os.path.join(d, "meta.json"))).get("title", title)
            except Exception:
                pass
            tmp = os.path.join(d, "manifest.json.tmp")
            json.dump({"t": time.time(), "title": title, "parts": mparts}, open(tmp, "w"), indent=2)
            os.replace(tmp, os.path.join(d, "manifest.json"))
            print(f"OK: {len(mparts)} parts exported (fallback builder)")
    except Exception:
        ok = False
        log.write(traceback.format_exc())
    out = log.getvalue()
    open(os.path.join(d, "build_log.txt"), "w").write(out)
    sys.stdout.write(out)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "."))

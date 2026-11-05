"""Facts about an uploaded STEP file for the quoting API (src/api.js, via src/step.js).

    python3 py/partinfo.py <file.step> [<mesh-out.stl>]

Prints one JSON line: bbox_mm (sorted, smallest first), volume_mm3, area_mm2, solids, faces by type, holes (cylindrical
faces, a rough count), and writes a mesh STL next to it when asked (Slant 3D quotes printed parts from STL).
Run by src/step.js with a clean environment and a timeout. Needs cadquery (pip install cadquery).
"""
import json
import resource
import sys


def main():
    # a hostile file must not eat the machine: 100 s of CPU, and 3 GB of memory where the OS allows the cap (Linux)
    for res, cap in ((resource.RLIMIT_CPU, 100), (resource.RLIMIT_AS, 3 << 30)):
        try:
            resource.setrlimit(res, (cap, cap))
        except (ValueError, OSError):
            pass
    src = sys.argv[1]
    out_stl = sys.argv[2] if len(sys.argv) > 2 else None
    import cadquery as cq
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Plane, GeomAbs_Cylinder

    shape = cq.importers.importStep(src).val()
    if shape is None or not shape.isValid():
        raise SystemExit(json.dumps({"error": "could not read a valid solid from this STEP file"}))
    bb = shape.BoundingBox()
    solids = shape.Solids()
    faces = shape.Faces()
    planar = cyl = other = 0
    for f in faces:
        t = BRepAdaptor_Surface(f.wrapped).GetType()
        if t == GeomAbs_Plane:
            planar += 1
        elif t == GeomAbs_Cylinder:
            cyl += 1
        else:
            other += 1
    vol = sum(s.Volume() for s in solids) if solids else shape.Volume()
    area = shape.Area()
    out = {
        "bbox_mm": sorted([round(bb.xlen, 3), round(bb.ylen, 3), round(bb.zlen, 3)]),
        "volume_mm3": round(abs(vol), 2),
        "area_mm2": round(area, 2),
        "solids": len(solids),
        "faces": {"planar": planar, "cylindrical": cyl, "other": other},
    }
    if out_stl:
        cq.exporters.export(shape, out_stl, tolerance=0.05, angularTolerance=0.2)
        out["mesh"] = True
    print(json.dumps(out))


if __name__ == "__main__":
    main()

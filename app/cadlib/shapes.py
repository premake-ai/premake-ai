"""Product shapes and crash-proof rounding for design.py (CadQuery 2.x).

    from cadlib.shapes import safe_fillet, soft_box, spout, loop_handle

    body = safe_fillet(body, "|Z", 6)                   # never crashes the build; retries r/2, r/4, else unrounded + warning
    shell = soft_box(120, 80, 40, r=8)                  # rounded box sitting on Z=0
    sp = spout(base=(50, 0, 30), tip=(130, 0, 70), base_r=16, tip_r=5, bore=3)    # tapered solid spout with a hole
    h = loop_handle(start=(-50, 0, 60), end=(-50, 0, 15), reach=40, w=12, t=10)  # open loop, rounded section

safe_fillet runs the fillet in a forked child process: if OpenCascade segfaults (ChFi3d_FilBuilder does on some edges)
only the child dies. The result also has to pass BRepCheck. Every rounding in design.py should go through it.
"""
import io
import os
import select
import sys
import time

import cadquery as cq

TIMEOUT_S = float(os.environ.get("SAFE_FILLET_TIMEOUT", "40"))


def _solid_of(obj):
    """(cq.Shape, was_workplane)"""
    if isinstance(obj, cq.Workplane):
        vals = [v for v in obj.vals() if isinstance(v, cq.Shape)]
        if not vals:
            raise ValueError("safe_fillet: the workplane holds no shape")
        return (vals[0] if len(vals) == 1 else cq.Compound.makeCompound(vals)), True
    return obj, False


def _edges(shape, edges):
    if edges is None:
        return shape.Edges()
    if isinstance(edges, str):
        return cq.Workplane().add(shape).edges(edges).vals()
    if isinstance(edges, cq.Edge):
        return [edges]
    if isinstance(edges, cq.Workplane):
        return [e for e in edges.vals() if isinstance(e, cq.Edge)]
    return list(edges)


def _fillet_once(shape, edges, r, chamfer):
    es = _edges(shape, edges)
    if not es:
        raise ValueError("no edges selected")
    out = shape.chamfer(r, None, es) if chamfer else shape.fillet(r, es)
    if not out.isValid():
        raise ValueError("result fails BRepCheck")
    return out


def _to_brep(shape):
    b = io.BytesIO()
    shape.exportBrep(b)
    return b.getvalue()


def _from_brep(data):
    return cq.Shape.importBrep(io.BytesIO(data))


def _try_in_child(shape, edges, r, chamfer, timeout):
    """(shape or None, reason). The OCC call runs in a forked child; a segfault, hang or exception only loses the child."""
    rfd, wfd = os.pipe()
    pid = os.fork()
    if pid == 0:  # child
        code = 1
        try:
            os.close(rfd)
            data = _to_brep(_fillet_once(shape, edges, r, chamfer))
            with os.fdopen(wfd, "wb") as w:
                w.write(b"OK" + data)
            code = 0
        except BaseException as e:  # noqa: BLE001 - report anything, the parent decides
            try:
                os.write(wfd, b"ER" + f"{type(e).__name__}: {e}".encode()[:300])
            except Exception:
                pass
        os._exit(code)
    os.close(wfd)
    chunks, t0, why = [], time.time(), None
    with os.fdopen(rfd, "rb") as rf:
        while True:
            left = timeout - (time.time() - t0)
            if left <= 0:
                why = f"took longer than {timeout:.0f} s"
                try:
                    os.kill(pid, 9)
                except OSError:
                    pass
                break
            ready, _, _ = select.select([rf], [], [], min(left, 1.0))
            if ready:
                c = os.read(rf.fileno(), 1 << 20)
                if not c:
                    break
                chunks.append(c)
    _, status = os.waitpid(pid, 0)
    data = b"".join(chunks)
    if why:
        return None, why
    if not data.startswith(b"OK") and not data.startswith(b"ER"):  # killed by a signal, or cadlib's quiet-crash _exit
        return None, "the CAD kernel crashed"
    if data.startswith(b"OK"):
        try:
            return _from_brep(data[2:]), None
        except Exception as e:  # noqa: BLE001
            return None, f"result unreadable ({e})"
    return None, data[2:].decode(errors="replace") or "failed"


def safe_fillet(obj, edges=None, r=1.0, *, chamfer=False, min_r=0.2, label=None, timeout=TIMEOUT_S):
    """Round (or chamfer) edges without ever crashing the build.

    obj: cq.Workplane or cq.Shape. edges: None (all edges), a selector string ("|Z", ">Z", "not <Z"), an Edge, a list
    of Edges or a Workplane of edges. Tries r, r/2, r/4 (never below min_r); on a crash, hang, error or invalid result
    it prints a warning to the build log and returns the shape unrounded. Returns the same type it was given."""
    shape, wp = _solid_of(obj)
    tag = label or (edges if isinstance(edges, str) else "edges")
    tried = []
    for k in (1, 2, 4):
        rr = r / k
        if rr < min_r and k > 1:
            break
        if hasattr(os, "fork"):
            out, why = _try_in_child(shape, edges, rr, chamfer, timeout)
        else:  # no fork (not macOS/Linux): in-process, exceptions only
            try:
                out, why = _fillet_once(shape, edges, rr, chamfer), None
            except Exception as e:  # noqa: BLE001
                out, why = None, str(e)
        if out is not None:
            if k > 1:
                print(f"  warning: safe_fillet({tag}, r={r:g}): used r={rr:g} ({'; '.join(tried)})", flush=True)
            return cq.Workplane("XY").newObject([out]) if wp else out
        tried.append(f"r={rr:g}: {why}")
    print(f"  WARNING: safe_fillet({tag}, r={r:g}) left the edges sharp: {'; '.join(tried)}", flush=True)
    return obj


def soft_box(x, y, z, r=3.0, *, top_r=None, bottom_r=None, centered_z=False):
    """A box with rounded vertical edges (r), then rounded top / bottom edges (top_r / bottom_r, default r/2 and 0).
    Sits on Z=0 unless centered_z."""
    r = min(r, x / 2 - 0.01, y / 2 - 0.01)
    b = cq.Workplane("XY").rect(x, y).extrude(z)
    if r > 0:
        b = safe_fillet(b, "|Z", r, label="soft_box sides")
    tr = r / 2 if top_r is None else top_r
    if tr and tr > 0:
        b = safe_fillet(b, ">Z", min(tr, z / 2 - 0.01), label="soft_box top")
    if bottom_r:
        b = safe_fillet(b, "<Z", min(bottom_r, z / 2 - 0.01), label="soft_box bottom")
    return b.translate((0, 0, -z / 2)) if centered_z else b


def _vec(p):
    return cq.Vector(*[float(c) for c in p])


def spout(base, tip, base_r, tip_r, *, bore=0.0, base_w=None, tip_w=None, sections=None):
    """A tapered spout as one smooth loft from a wide base (sunk into the body) to a small tip, with an optional
    bore (diameter) drilled along its axis. base / tip: (x, y, z) centres. base_w / tip_w: width across, for an
    oval/flattened section (default round). sections: optional [(t, r)] extra radii along the way (0 < t < 1) to
    bow the profile. Union it with the body (base inside the wall), then safe_fillet the seam if wanted."""
    a, b = _vec(base), _vec(tip)
    axis = b - a
    L = axis.Length
    if L <= 0:
        raise ValueError("spout: base and tip are the same point")
    d = axis.normalized()
    ref = cq.Vector(0, 0, 1) if abs(d.z) < 0.9 else cq.Vector(1, 0, 0)
    xdir = ref.cross(d).normalized()  # across the spout, horizontal when possible
    stations = [(0.0, base_r, base_w)] + [(t, rr, None) for t, rr in (sections or [])] + [(1.0, tip_r, tip_w)]
    wires = []
    for t, rr, w in stations:
        pl = cq.Plane(origin=a + d * (L * t), xDir=xdir, normal=d)
        wp = cq.Workplane(pl)
        wires.append((wp.ellipse(w / 2, rr) if w else wp.circle(rr)).val())
    solid = cq.Solid.makeLoft(wires, True)
    s = cq.Workplane("XY").newObject([solid])
    if bore and bore > 0:
        hole = cq.Workplane(cq.Plane(origin=a - d * 1.0, xDir=xdir, normal=d)).circle(bore / 2).extrude(L + 2)
        s = s.cut(hole)
    return s


def loop_handle(start, end, reach, w=12.0, t=10.0, *, bulge=None, plane_normal=None):
    """An open loop handle: a rounded-rectangle section swept along a smooth arc from start to end (both (x, y, z),
    sunk a few mm into the body), bulging out by `reach` mm. The bulge direction defaults to horizontal, away from
    the Z axis through the midpoint. w: section width (across), t: thickness (in the loop's plane)."""
    a, b = _vec(start), _vec(end)
    mid = (a + b) * 0.5
    if bulge is None:
        out = cq.Vector(mid.x, mid.y, 0)
        out = out.normalized() if out.Length > 1e-6 else cq.Vector(1, 0, 0)
    else:
        out = _vec(bulge).normalized()
    chord = b - a
    # two control points out at `reach` make a C-shaped loop; a spline through 5 points keeps it smooth
    p1 = a + out * (reach * 0.75) + chord * 0.05
    p2 = mid + out * reach
    p3 = b + out * (reach * 0.75) - chord * 0.05
    pts = [a, p1, p2, p3, b]
    path = cq.Workplane("XY").spline([p.toTuple() for p in pts], includeCurrent=False)
    tan = (p1 - a).normalized()
    n = (chord.cross(out)).normalized() if plane_normal is None else _vec(plane_normal).normalized()  # across the loop
    prof_plane = cq.Plane(origin=a, xDir=n, normal=tan)
    rr = min(w, t) * 0.3
    prof = cq.Workplane(prof_plane).sketch().rect(w, t).vertices().fillet(rr).finalize()
    return prof.sweep(path, transition="round")


def recess_lid(body, z_top, dia, depth=2.0, *, lid_t=3.0, clearance=0.3, slot=None, screws=0, screw_d=3.2,
               screw_r=None, center=(0, 0)):
    """Cut a round recess (dia, depth) into the top of `body` at z_top and return (body, lid): the lid is a disc that
    sits in the recess (top flush with z_top), with an optional slot (length, width) through it and `screws` holes
    on a circle of radius screw_r. Both are Workplanes in assembled position."""
    cx, cy = center
    rec = cq.Workplane("XY").workplane(offset=z_top - depth).center(cx, cy).circle(dia / 2).extrude(depth + 1)
    body = body.cut(rec)
    lid = cq.Workplane("XY").workplane(offset=z_top - min(lid_t, depth)).center(cx, cy).circle(dia / 2 - clearance).extrude(min(lid_t, depth))
    if slot:
        L, W = slot
        lid = lid.cut(cq.Workplane("XY").workplane(offset=z_top - lid_t - 1).center(cx, cy).slot2D(L, W).extrude(lid_t + 2))
    if screws:
        sr = screw_r or dia / 2 - clearance - screw_d * 1.6
        import math
        for i in range(screws):
            ang = 2 * math.pi * i / screws + math.pi / 4
            px, py = cx + sr * math.cos(ang), cy + sr * math.sin(ang)
            lid = lid.cut(cq.Workplane("XY").workplane(offset=z_top - lid_t - 1).center(px, py).circle(screw_d / 2).extrude(lid_t + 2))
    return body, lid

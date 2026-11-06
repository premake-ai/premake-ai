"""Minimal rotary delta 3D printer: no linear axes, no belts.
Three NEMA17s swing printed arms directly; magnetic rods carry the hotend.
Klipper `rotary_delta` kinematics (host: any Linux PC/laptop or a Pi)."""
import math
import cadquery as cq
from cadlib import fab
from cadlib.parts import part
from cadlib.motion import move, rot, link

T = fab.sheet_actual("plywood", 6)       # 5.5 mm real
BASE_Z, BASE_TOP = 0, T
COL_L = 300                               # stock 2020 length
TOP_Z = BASE_TOP + COL_L
TOP_TOP = TOP_Z + T
COL_R, PLATE_R = 120, 138
COL_ANG = (90, 210, 330)
ARM_ANG = (270, 30, 150)

H = TOP_Z - 30            # motor shaft / shoulder axis
F, E = 45, 25             # shoulder radius, effector ball radius
L1, L2 = 70, 180          # arm, magnetic rod (ball centre to centre)
S = 20                    # half ball spacing
WA = 8                    # arm mid-plane offset along shaft
NOZ = 55.3                # ball plane to nozzle tip (V6 62 overall)

BED_BOT = BASE_TOP + 10
BED_Z = BED_BOT + 3 + 0.4
P0 = (0.0, 0.0, BED_Z + 30)


def U(p): return (math.cos(math.radians(p)), math.sin(math.radians(p)), 0.0)
def Tn(p): return (-math.sin(math.radians(p)), math.cos(math.radians(p)), 0.0)
def L(p, r, w, z):
    u, t = U(p), Tn(p)
    return (r * u[0] + w * t[0], r * u[1] + w * t[1], z)
def add(a, b, k=1.0): return tuple(a[i] + k * b[i] for i in range(3))
def place(s, p): return s.rotate((0, 0, 0), (0, 0, 1), p)


def ik(P, i):
    u, t = U(ARM_ANG[i]), Tn(ARM_ANG[i])
    d = (P[0] + (E - F) * u[0], P[1] + (E - F) * u[1], P[2] + NOZ - H)
    a = d[0] * u[0] + d[1] * u[1]
    b = d[0] * t[0] + d[1] * t[1]
    c = d[2]
    K = (L1 ** 2 + a * a + b * b + c * c - L2 ** 2) / (2 * L1)
    R = math.hypot(a, c)
    if abs(K) > R:
        raise ValueError(f"unreachable {P}")
    return math.degrees(-math.atan2(c, a) - math.acos(K / R))


def joints(P, i):
    u, t = U(ARM_ANG[i]), Tn(ARM_ANG[i])
    th = math.radians(ik(P, i))
    Sh = add((F * u[0], F * u[1], H), t, WA)
    El = add(Sh, (L1 * math.cos(th) * u[0], L1 * math.cos(th) * u[1], -L1 * math.sin(th)))
    J = add((P[0] + E * u[0], P[1] + E * u[1], P[2] + NOZ), t, WA)
    return Sh, El, J, t


_a = [ik((r * math.cos(math.radians(a)), r * math.sin(math.radians(a)), BED_Z + z), i)
      for r in (0, 60) for a in range(0, 360, 30) for z in (0, 70) for i in range(3)]
print(f"workspace Ø120 x 70: arm angles {min(_a):.1f} .. {max(_a):.1f} deg")


def xz_cyl(r, w0, ln, x=0, z=0):
    return cq.Workplane("XZ", origin=(x, w0, z)).circle(r).extrude(-ln)


def arm():
    """Local: shaft axis on Y at origin, arm along +X, printed flat (Y up)."""
    a = xz_cyl(9, 2, 12).union(cq.Workplane().box(L1, 8, 10).translate((L1 / 2, WA, 0)))
    a = a.union(xz_cyl(6, 2, 12, x=L1))
    a = a.cut(xz_cyl(2.6, 0, 20)).cut(xz_cyl(2.2, 0, 20, x=L1))
    clamp = cq.Workplane("YZ", origin=(-12, WA, 0)).circle(1.7).extrude(12)     # M3 grub onto D-flat
    return a.cut(clamp)


def motor_mount():
    """Plate under the top plate holding a NEMA17 face, shaft along +w."""
    m = cq.Workplane().box(46, 5, 30 + 23).translate((0, -2.5, -30 + 26.5 - 23 + 23 / 2 + 3))
    m = cq.Workplane().box(46, 5, 56).translate((0, -2.5, 2))
    m = m.union(cq.Workplane().box(46, 25, 5).translate((0, -15, 27.5)))
    m = m.cut(xz_cyl(11.5, 5, 10))
    for dx in (-15.5, 15.5):
        for dz in (-15.5, 15.5):
            m = m.cut(xz_cyl(1.7, 5, 10, x=dx, z=dz))
        m = m.cut(cq.Workplane().circle(2.25).extrude(10).translate((dx, -16, 24)))
    try:
        m = m.edges("|Y").fillet(2)
    except Exception:
        pass
    return m


def rod(a, b):
    d = cq.Vector(b) - cq.Vector(a)
    n = d.normalized()
    s = cq.Solid.makeCylinder(2.5, d.Length - 20, cq.Vector(a) + n * 10, n)
    for p, dn in ((cq.Vector(a), n), (cq.Vector(b), -n)):
        s = s.fuse(cq.Solid.makeCylinder(5.5, 10, p + dn * 2, dn)).fuse(cq.Solid.makeSphere(5, p))
    return cq.Workplane().add(s)


def effector(z):
    e = cq.Workplane().circle(18).extrude(10).translate((0, 0, z - 5))
    for p in ARM_ANG:
        ear = cq.Workplane().box(12, 2 * S - 12, 10).translate((E, WA, z))
        hole = cq.Workplane("XZ", origin=(E, 40, z)).circle(2.2).extrude(80)
        e = e.union(place(ear, p)).cut(place(hole, p))
    slot = cq.Workplane().center(12, 0).rect(24, 12.2).extrude(20).union(cq.Workplane().circle(6.1).extrude(20))
    rec = cq.Workplane().center(12, 0).rect(24, 16.4).extrude(2).union(cq.Workplane().circle(8.2).extrude(2))
    for c in (slot.translate((0, 0, z - 10)), rec.translate((0, 0, z + 3)), rec.translate((0, 0, z - 5))):
        e = e.cut(place(c, 90))
    return e.cut(place(cq.Workplane("XZ", origin=(11, 25, z)).circle(1.7).extrude(50), 90))


def hotend(z):
    ht = z + 6.7
    h = cq.Workplane().circle(8).extrude(3.7).translate((0, 0, ht - 3.7))
    h = h.union(cq.Workplane().circle(6).extrude(6).translate((0, 0, ht - 9.7)))
    h = h.union(cq.Workplane().circle(8).extrude(3).translate((0, 0, ht - 12.7)))
    for k in range(10):
        h = h.union(cq.Workplane().circle(11.15).extrude(1).translate((0, 0, ht - 15 - 2.9 * k)))
    h = h.union(cq.Workplane().circle(4.5).extrude(31).translate((0, 0, ht - 44)))
    h = h.union(cq.Workplane().box(20, 16, 11.5).translate((4, 0, ht - 50.25)))
    return h.union(cq.Workplane().add(cq.Solid.makeCone(1, 4, 6, cq.Vector(0, 0, ht - 62))))


def parts():
    out = []
    zJ = P0[2] + NOZ
    top = cq.Workplane().circle(PLATE_R).extrude(T).translate((0, 0, TOP_Z))
    base = cq.Workplane().circle(PLATE_R).extrude(T)
    for p in COL_ANG:
        x, y, _ = L(p, COL_R, 0, 0)
        h = cq.Workplane().circle(2.75).extrude(30).translate((x, y, -10))
        top, base = top.cut(h.translate((0, 0, TOP_Z))), base.cut(h)
        base = base.cut(cq.Workplane().add(cq.Solid.makeCone(5.25, 2.75, 2.5, cq.Vector(x, y, 0))))
    out.append({"name": "Top plate", "shape": top, "process": "laser", "color": "#d9b98c",
                "params": {"material": "plywood", "thickness_mm": 6}})
    out.append({"name": "Base plate", "shape": base, "process": "laser", "color": "#d9b98c",
                "params": {"material": "plywood", "thickness_mm": 6}})
    cols = [L(p, COL_R, 0, 0) for p in COL_ANG]
    for k, (x, y, _) in enumerate(cols):
        out.append({"name": f"Column {k+1}", "shape": fab.extrusion(COL_L, axis="z", at=(x, y, BASE_TOP)),
                    "process": "extrusion", "params": {"profile": "2020", "length_mm": COL_L, "tapped_ends": 2}})
    out.append(part("m5x12_bhcs", at=[(x, y, TOP_TOP) for x, y, _ in cols]))
    out.append(part("m5x12_csk", at=[(x, y, 0) for x, y, _ in cols], rot=(180, 0, 0)))

    ar, mm = arm(), motor_mount()
    for i, p in enumerate(ARM_ANG):
        n = i + 1
        Sh, El, J, t = joints(P0, i)
        th0 = ik(P0, i)
        out.append({"name": f"Arm {n}", "id": f"arm{n}", "color": "#e4572e",
                    "shape": place(ar.rotate((0, 0, 0), (0, 1, 0), th0).translate((F, 0, H)), p)})
        out.append({"name": f"Motor mount {n}", "color": "#3a3d42", "shape": place(mm.translate((F, 0, H)), p)})
        out.append(part("nema17_40", at=L(p, F, -5, H), rot=(-90, 0, p)))
        out.append(part("m4x12_bhcs", at=[L(p, F + dx, -16, TOP_TOP) for dx in (-15.5, 15.5)]))
        stud = cq.Workplane().add(cq.Solid.makeCylinder(2, 2 * S, cq.Vector(El) - cq.Vector(t) * S, cq.Vector(t)))
        out.append({"name": f"Elbow stud {n}", "id": f"stud{n}", "group": "component", "color": "#8e939a", "shape": stud})
        for s, tag in ((-1, "a"), (1, "b")):
            out.append({"name": f"Rod {n}{tag}", "id": f"rod{n}{tag}", "group": "component", "color": "#222222",
                        "shape": rod(add(El, t, s * S), add(J, t, s * S))})

    out.append({"name": "Effector", "id": "eff", "shape": effector(zJ), "color": "#e4572e"})
    studs = None
    for p in ARM_ANG:
        c = add(add((0, 0, zJ), U(p), E), Tn(p), WA)
        s = cq.Workplane().add(cq.Solid.makeCylinder(2, 2 * S, cq.Vector(c) - cq.Vector(Tn(p)) * S, cq.Vector(Tn(p))))
        studs = s if studs is None else studs.union(s)
    out.append({"name": "Effector studs", "id": "estuds", "group": "component", "color": "#8e939a", "shape": studs})
    out.append({"name": "V6 hotend kit 24V (with fan)", "id": "hotend", "group": "component",
                "color": "#b8bcc2", "shape": hotend(zJ)})

    bed = cq.Workplane().circle(70).extrude(3).translate((0, 0, BED_BOT))
    posts = [L(p, 58, 0, 0) for p in COL_ANG]
    for x, y, _ in posts:
        bed = bed.cut(cq.Workplane().circle(1.7).extrude(10).translate((x, y, BED_BOT - 1)))
    out.append({"name": "Bed plate", "shape": bed, "process": "sheet", "color": "#c7ccd2",
                "params": {"material": "aluminium 5052", "thickness_mm": 3, "bends": 0}})
    out.append({"name": "PEI sheet", "group": "component", "color": "#c9a33c",
                "shape": cq.Workplane().circle(69).extrude(0.4).translate((0, 0, BED_BOT + 3))})
    out.append(part("m3x10_standoff", at=[(x, y, BASE_TOP) for x, y, _ in posts]))
    out.append(part("m3x8_bhcs", at=[(x, y, BED_BOT + 3.4) for x, y, _ in posts]))

    # extruder (MK8 on its motor) and controller on the top plate
    out.append(part("nema17_40", at=L(90, 85, 0, TOP_TOP + 40), rot=(0, 0, 90)))
    mk8 = cq.Workplane().box(42, 42, 14).translate((0, 85, TOP_TOP + 47))
    out.append({"name": "MK8 extruder kit", "group": "component", "color": "#c7ccd2", "shape": mk8})
    ex = cq.Workplane().box(46, 46, 4).translate((0, 85, TOP_TOP + 38))
    for sx in (-1, 1):
        ex = ex.union(cq.Workplane().box(4, 46, 36).translate((sx * 21, 85, TOP_TOP + 18)))
    ex = ex.cut(cq.Workplane().circle(11.5).extrude(10).translate((0, 85, TOP_TOP + 34)))
    out.append({"name": "Extruder stand", "color": "#3a3d42", "shape": ex})
    board = cq.Workplane().box(103.75, 70.25, 1.6).translate((0, -10, TOP_TOP + 11))
    board = board.union(cq.Workplane().box(90, 60, 12).translate((0, -10, TOP_TOP + 18)))
    out.append({"name": "SKR Mini E3 V3 board", "group": "component", "color": "#1d5c2e", "shape": board})
    out.append(part("m3x10_standoff", at=[(-44, -40, TOP_TOP), (44, -40, TOP_TOP), (-44, 20, TOP_TOP), (44, 20, TOP_TOP)]))
    return out


def motion():
    base = [joints(P0, i) for i in range(3)]

    def path(t):
        s = math.sin(math.pi * t)
        a = 4 * math.pi * t
        return (45 * s * math.cos(a), 45 * s * math.sin(a), P0[2] - 25 * s)

    def pose(t):
        P = path(t)
        res = {k: move((P[0] - P0[0], P[1] - P0[1], P[2] - P0[2])) for k in ("eff", "estuds", "hotend")}
        for i in range(3):
            n = i + 1
            Sh, El0, J0, tv = base[i]
            _, El, J, _ = joints(P, i)
            r = rot(list(tv), ik(P, i) - ik(P0, i), list(Sh))
            res[f"arm{n}"] = r
            res[f"stud{n}"] = r
            for s, tag in ((-1, "a"), (1, "b")):
                res[f"rod{n}{tag}"] = link(add(El0, tv, s * S), add(J0, tv, s * S), add(El, tv, s * S), add(J, tv, s * S))
        return res

    return {"duration": 8, "pose": pose}

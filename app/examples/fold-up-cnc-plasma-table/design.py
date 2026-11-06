"""Fold-up CNC plasma table: 4 x 4 ft steel slat bed, dual-motor gantry on V-slot rails, floating-head torch,
hinged at the back on a wall stand so the whole bed (with the gantry parked) swings up to stand against the wall.
Frame: 1.5 in 14 ga steel square tube bolted with laser-cut / bent 3 mm steel brackets (no welding)."""
import math

import cadquery as cq
from cadlib import fab
from cadlib.parts import part
from cadlib.shapes import safe_fillet

SCENE = "floor"

# ---- key sizes (mm) ----
ZF = 850.0                 # bed frame top (tubes z 810..850)
SLAT_TOP = 870.0           # cutting surface, 34 in working height
GY, CX = 0.0, 0.0          # gantry Y / carriage X in the built pose
PARK_DY = 610.0            # gantry moves back this far before folding
PIVOT = (810.0, 830.0)     # bed hinge axis (y, z), along X
LEG_PIVOT = (-610.0, 780.0)
SLAT_X = [-600.0 + 50.0 * i for i in range(25)]
STRUT_A = (860.0, 420.0)   # gas strut ends (y, z): stand / bed
STRUT_B = (510.0, 795.0)
STRUT_X = 811.0
TUBE = "steel square tube 1.5in 14ga"
STEEL, DARK, ALU, ZINC, BLACK = "#4a4e55", "#2f3237", "#c9ccd1", "#b8bcc2", "#1d1f22"

GROUP = {}                 # part id -> "stand" | "bed" | "gantry" | "leg" | "strut"


def rb(x0, x1, y0, y1, z0, z1, axis="z", r=0.0, hollow=0.0):
    """Box between the given bounds, extruded along `axis`, with rounded corners r (and a wall if hollow)."""
    sx, sy, sz = x1 - x0, y1 - y0, z1 - z0
    pl, a, b, L = {"x": ("YZ", sy, sz, sx), "y": ("XZ", sx, sz, sy), "z": ("XY", sx, sy, sz)}[axis]
    sk = cq.Workplane(pl).sketch().rect(a, b)
    if r > 0:
        sk = sk.vertices().fillet(r)
    if hollow > 0:
        sk = sk.reset().rect(a - 2 * hollow, b - 2 * hollow, mode="s")
    w = sk.finalize().extrude(L)
    bb = w.val().BoundingBox()
    return w.translate((x0 - bb.xmin, y0 - bb.ymin, z0 - bb.zmin))


def tube(x0, x1, y0, y1, z0, z1, axis, wall=1.9):
    return rb(x0, x1, y0, y1, z0, z1, axis, r=3.0, hollow=wall)


def cyl(c, r, L, axis="z"):
    return cq.Workplane({"x": "YZ", "y": "XZ", "z": "XY"}[axis]).circle(r).extrude(L / 2.0, both=True).translate(c)


def tri(plane, at, pts, t=3.0):
    """Flat triangle gusset: plane "YZ" (pts are (y, z), plate x at..at+t) or "XZ" (pts (x, z), plate y at..at+t)."""
    w = cq.Workplane(plane).polyline(pts).close().extrude(t)
    bb = w.val().BoundingBox()
    return w.translate((at - bb.xmin, 0, 0)) if plane == "YZ" else w.translate((0, at - bb.ymin, 0))


def xr(a, b, s):
    return (min(s * a, s * b), max(s * a, s * b))


def union(*ws):
    out = ws[0]
    for w in ws[1:]:
        out = out.union(w)
    return out


def steel(name, shp, L, prof=TUBE):
    return {"name": name, "shape": shp, "group": "case", "process": "extrusion", "color": DARK, "material": "steel",
            "params": {"profile": prof, "length_mm": L, "tapped_ends": 0}}


def sheet(name, shp, bends=0, t=3.0, mat="mild steel", color=STEEL):
    return {"name": name, "shape": shp, "group": "case", "process": "sheet", "color": color, "material": "steel",
            "params": {"material": mat, "thickness_mm": t, "bends": bends}}


def bought(name, shp, color=BLACK, **kw):
    d = {"name": name, "shape": shp, "group": "component", "process": "bought", "color": color}
    d.update(kw)
    return d


def printed(name, shp):
    return {"name": name, "shape": shp, "group": "case", "process": "print", "color": "#e8792b"}


def parts():
    P = []

    def add(grp, d):
        base = "".join(c if c.isalnum() else "-" for c in d["name"].lower()).strip("-")
        i, pid = 1, base
        while pid in GROUP:
            i += 1
            pid = f"{base}-{i}"
        d["id"] = pid
        GROUP[pid] = grp
        P.append(d)

    GROUP.clear()
    side = {-1: "left", 1: "right"}

    # ================= wall stand (fixed) =================
    for s in (-1, 1):
        n = side[s]
        add("stand", steel(f"Stand runner {n}", tube(*xr(740, 780, s), 460, 1160, 0, 40, "y"), 700))
        add("stand", steel(f"Stand post {n}", tube(*xr(740, 780, s), 870, 910, 40, 850, "z"), 810))
        hp = rb(*xr(737, 740, s), 775, 905, 795, 870, "x", r=8)
        for (hy, hz, hr) in ((PIVOT[0], PIVOT[1], 6.5), (785, 830, 5.3), (810, 855, 5.3)):
            hp = hp.cut(cyl((s * 738.5, hy, hz), hr, 10, "x"))
        add("stand", sheet(f"Hinge plate {n}", hp))
        add("stand", sheet(f"Post gusset {n}", tri("YZ", min(s * 737, s * 740), [(870, 40), (750, 40), (870, 160)])))
        add("stand", sheet(f"Crossbar gusset {n}",
                           tri("XZ", 867, [(s * 740, 440), (s * 620, 440), (s * 740, 560)])))
        add("stand", sheet(f"Strut bracket, stand {n}", rb(*xr(760, 825, s), 867, 870, 395, 445, "y", r=5)))
    add("stand", steel("Stand crossbar", tube(-740, 740, 870, 910, 400, 440, "x"), 1480))
    add("stand", steel("Stand rear foot", tube(-740, 740, 1120, 1160, 0, 40, "x"), 1480))
    hb = None
    for s in (-1, 1):
        b = union(cyl((s * 728, PIVOT[0], PIVOT[1]), 6, 56, "x"), cyl((s * 720, PIVOT[0], PIVOT[1]), 10, 34, "x"),
                  cyl((s * 752, PIVOT[0], PIVOT[1]), 10, 8, "x"))
        hb = b if hb is None else hb.union(b)
    add("stand", bought("Hinge bolts M12 + spacers", hb, ZINC))

    # ================= bed (folds about PIVOT) =================
    for s in (-1, 1):
        n = side[s]
        add("bed", steel(f"Bed side tube {n}", tube(*xr(660, 700, s), -670, 830, 810, 850, "y"), 1500))
        lug = rb(*xr(700, 703, s), 775, 830, 800, 850, "x", r=6)
        for (hy, hz, hr) in ((PIVOT[0], PIVOT[1], 6.5), (785, 830, 5.3)):
            lug = lug.cut(cyl((s * 701.5, hy, hz), hr, 10, "x"))
        add("bed", sheet(f"Hinge lug {n}", lug))
    for nm, y0 in (("front", -670), ("middle", 630), ("rear", 790)):
        add("bed", steel(f"Bed cross tube {nm}", tube(-660, 660, y0, y0 + 40, 810, 850, "x"), 1320))
    # inside corner brackets (L angles, M8 through-bolts)
    k = 0
    for s in (-1, 1):
        for yf, d in ((-630, 1), (630, -1), (790, -1)):
            k += 1
            a = rb(*xr(657, 660, s), *sorted((yf, yf + d * 80)), 812, 848, "x")
            b = rb(*xr(580, 660, s), *sorted((yf, yf + d * 3)), 812, 848, "y")
            add("bed", sheet(f"Frame corner bracket {k}", a.union(b), bends=1))
    # notched slat combs on the front / middle cross tubes (3 pieces each: 600 mm blank limit)
    for ys in (-1, 1):
        yc = 597.0 * ys
        for j, (x0, x1) in enumerate(((-630, -214), (-212, 212), (214, 630))):
            leg = rb(x0, x1, yc - 1.5, yc + 1.5, 800, 862, "y")
            fl = rb(x0, x1, *sorted((yc, 668 * ys)), 850, 853)
            c = leg.union(fl)
            for sx in SLAT_X:
                if x0 + 4 < sx < x1 - 4:
                    c = c.cut(rb(sx - 2, sx + 2, *sorted((yc - 3 * ys, 614 * ys)), 832, 864))
            add("bed", sheet(f"Slat comb {'front' if ys < 0 else 'rear'} {j + 1}", c, bends=1))
    slats = None
    for sx in SLAT_X:
        b = rb(sx - 1.5, sx + 1.5, -609.6, 609.6, 832, SLAT_TOP)
        slats = b if slats is None else slats.union(b)
    add("bed", bought("Steel slats 1/8 x 1-1/2 x 48 in (25)", slats, "#6b6f75", material="steel"))
    # Y rails: 2040 V-slot lying flat on the side tubes
    for s in (-1, 1):
        rail = fab.extrusion(1500, "2040", axis="y").rotate((0, 0, 0), (0, 1, 0), 90).translate((s * 680, -575, 860))
        add("bed", {"name": f"Y rail {side[s]} (2040 V-slot)", "shape": rail, "group": "case", "process": "extrusion",
                    "params": {"profile": "2040", "length_mm": 1500, "tapped_ends": 0}, "color": ALU})
    yb = None
    for s in (-1, 1):
        b = rb(*xr(746.4, 747.8, s), -585, 915, 864, 870)
        yb = b if yb is None else yb.union(b)
        for ye, d in ((-575, -1), (925, 1)):   # L anchor: face across the rail end + flange on the rail top (T-nuts)
            face = rb(*xr(660, 760, s), *sorted((ye, ye + 3 * d)), 850, 876, "y", r=3)
            fl = rb(*xr(660, 700, s), *sorted((ye + 3 * d, ye - 30 * d)), 870, 873)
            add("bed", sheet(f"Y belt anchor {side[s]} {'front' if d < 0 else 'rear'}", face.union(fl), 1))
    add("bed", bought("Y belts (GT2 6 mm)", yb, BLACK))
    add("bed", bought("Limit switch Y1", rb(-658, -640, 830, 850, 852, 866), "#d23a2a"))
    add("bed", bought("Limit switch Y2", rb(640, 658, 830, 850, 852, 866), "#d23a2a"))
    add("bed", sheet("Y chain bracket", rb(700, 703, 100, 140, 816, 850, "x").union(rb(700, 800, 100, 140, 816, 819)), 1))
    for s in (-1, 1):
        sb = rb(*xr(700, 703, s), 490, 530, 787, 850, "x").union(rb(*xr(700, 825, s), 490, 530, 787, 790))
        add("bed", sheet(f"Strut bracket, bed {side[s]}", sb, 1))
        lb = union(rb(*xr(657, 660, s), -640, -580, 765, 810, "x"), rb(*xr(700, 703, s), -640, -580, 765, 810, "x"),
                   rb(*xr(657, 703, s), -640, -580, 807, 810))
        lb = lb.cut(cyl((s * 680, LEG_PIVOT[0], LEG_PIVOT[1]), 5.5, 60, "x"))
        lb = lb.cut(cyl((s * 680, -622, 790), 4.3, 60, "x"))
        add("bed", sheet(f"Leg hinge bracket {side[s]}", lb, 2))
    lp, pins = None, None
    for s in (-1, 1):
        b = cyl((s * 680, LEG_PIVOT[0], LEG_PIVOT[1]), 5, 56, "x").union(cyl((s * 711, LEG_PIVOT[0], LEG_PIVOT[1]), 9, 6, "x"))
        lp = b if lp is None else lp.union(b)
        p = cyl((s * 726, 785, 830), 5, 52, "x").union(cyl((s * 756, 785, 830), 9, 4, "x"))
        pins = p if pins is None else pins.union(p)
    add("bed", bought("Leg pivot bolts M10", lp, ZINC))
    add("bed", bought("Bed lock pins (quick-release)", pins, ZINC))

    # ================= gantry (rolls on Y rails) =================
    for s, yn in ((-1, 1), (1, 2)):
        ep = rb(*xr(620, 800, s), GY - 80, GY + 80, 880, 883, "z", r=8)
        ep = ep.cut(cyl((s * 740, GY + 55, 881.5), 12, 10))
        add("gantry", sheet(f"Gantry end plate {side[s]}", ep, 0, 6.0, "aluminium 6061", ALU))
        add("gantry", part("nema17_48", at=(s * 740, GY + 55, 883), rot=(180, 0, 0), name=f"Y{yn} stepper (NEMA17 48 mm)"))
    yw = None
    for s in (-1, 1):
        for wy in (GY - 55, GY + 55):
            for wx in (680 - 32, 680 + 32):
                w = cyl((s * wx, wy, 860), 12, 11).union(cyl((s * wx, wy, 872.75), 5, 14.5))
                yw = w if yw is None else yw.union(w)
    add("gantry", bought("Y V-wheels (8)", yw, BLACK))
    add("gantry", part("gt2_pulley_20t", at=[(-740, GY + 55, 878), (740, GY + 55, 878), (CX + 26, GY - 50, 1015)],
                       rot=[(180, 0, 0), (180, 0, 0), (-90, 0, 0)]))
    idl = [(s * 755.8, GY + 55 + dy, 864) for s in (-1, 1) for dy in (-22, 22)] + \
          [(CX + 26 + dx, GY - 50, 999.2) for dx in (-22, 22)]
    add("gantry", part("bearing_625_2rs", at=idl, rot=[(0, 0, 0)] * 4 + [(-90, 0, 0)] * 2, name="Belt idlers (625-2RS)"))
    add("gantry", steel("Gantry beam (2 x 4 in tube)", tube(-750, 750, GY - 25, GY + 25, 883, 983, "x"), 1500,
                        "steel rect tube 2x4in 14ga"))
    xrail = fab.extrusion(1500, "2040", axis="x").rotate((0, 0, 0), (1, 0, 0), 90).translate((-750, GY - 35, 963))
    add("gantry", {"name": "X rail (2040 V-slot)", "shape": xrail, "group": "case", "process": "extrusion",
                   "params": {"profile": "2040", "length_mm": 1500, "tapped_ends": 0}, "color": ALU})
    add("gantry", bought("X belt (GT2 6 mm)", rb(-760, 760, GY - 49, GY - 43, 1007.2, 1008.6), BLACK))
    for s in (-1, 1):
        an = safe_fillet(rb(*xr(750, 772, s), GY - 56, GY - 20, 985, 1015, "z", r=4), ">Z", 2)
        add("gantry", printed(f"X belt clamp {side[s]}", an))
    add("gantry", bought("Limit switch X", rb(-748, -728, GY - 52, GY - 45, 950, 966), "#d23a2a"))
    # carriage
    cp = rb(CX - 70, CX + 70, GY - 55, GY - 52, 905, 1040, "y", r=6).union(rb(CX - 20, CX + 20, GY - 55, GY + 15, 1040, 1043))
    cp = cp.cut(cyl((CX + 26, GY - 53.5, 1015), 12, 10, "y"))
    add("gantry", sheet("X carriage plate", cp, 1, 6.0, "aluminium 6061", ALU))
    xw = None
    for wx in (CX - 45, CX + 45):
        for wz in (931, 995):
            w = cyl((wx, GY - 35, wz), 12, 11, "y").union(cyl((wx, GY - 46.25, wz), 5, 11.5, "y"))
            xw = w if xw is None else xw.union(w)
    add("gantry", bought("X V-wheels (4)", xw, BLACK))
    add("gantry", part("nema17_48", at=(CX + 26, GY - 55, 1015), rot=(-90, 0, 0), name="X stepper (NEMA17 48 mm)"))
    zs = rb(CX - 68, CX - 8, GY - 105, GY - 55, 895, 1095, "z", r=3)
    add("gantry", bought("Z axis slide, 100 mm stroke", zs, "#9aa0a8", material="aluminium"))
    add("gantry", part("nema17_40", at=(CX - 38, GY - 80, 1095), rot=(180, 0, 0), name="Z stepper (NEMA17 40 mm)"))
    add("gantry", sheet("Float plate", rb(CX - 63, CX - 13, GY - 108, GY - 105, 930, 1030, "y", r=4)))
    TX, TY = CX - 38, GY - 140
    for nm, rz in (("lower", 945), ("upper", 995)):
        ring = cyl((TX, TY, rz + 1.5), 25, 3).cut(cyl((TX, TY, rz + 1.5), 17.7, 5))
        cl = union(ring, rb(TX - 12, TX + 12, GY - 118, GY - 108, rz, rz + 3), rb(TX - 12, TX + 12, GY - 111, GY - 108, rz, rz + 30, "y"))
        add("gantry", sheet(f"Torch clamp {nm}", cl, 1))
    torch = union(cyl((TX, TY, 1007.5), 17.45, 225), cyl((TX, TY, 887.5), 11, 15), cyl((TX, TY, 876.5), 7, 7),
                  cyl((TX, TY, 1150), 9, 60))
    add("gantry", bought("Machine torch (yours)", torch, "#3c3c40"))
    add("gantry", bought("Float switch", rb(CX - 62, CX - 42, GY - 116, GY - 105, 1032, 1042), "#d23a2a"))
    add("gantry", bought("Limit switch Z", rb(CX - 78, CX - 68, GY - 90, GY - 70, 1075, 1095), "#d23a2a"))
    # drag chains
    ring = cyl((782.5, -250, 849.5), 27.5, 25, "x").cut(cyl((782.5, -250, 849.5), 12.5, 30, "x"))
    ring = ring.cut(rb(760, 810, -250, -150, 800, 900))
    add("gantry", bought("Y drag chain", union(rb(770, 795, -250, 140, 822, 837), rb(770, 795, -250, GY, 862, 877), ring), BLACK))
    ring = cyl((CX + 350, GY, 1011.5), 28.5, 30, "y").cut(cyl((CX + 350, GY, 1011.5), 13.5, 34, "y"))
    ring = ring.cut(rb(CX + 250, CX + 350, GY - 30, GY + 30, 970, 1050))
    add("gantry", bought("X drag chain", union(rb(CX, CX + 350, GY - 15, GY + 15, 983, 998),
                                               rb(CX, CX + 350, GY - 15, GY + 15, 1025, 1040), ring), BLACK))
    kn = None
    for s in (-1, 1):
        b = cyl((s * 680, GY - 65, 890.5), 12, 15)
        kn = b if kn is None else kn.union(b)
    add("gantry", bought("Gantry lock knobs M5", kn, BLACK))

    # ================= fold-down legs =================
    for s in (-1, 1):
        add("leg", steel(f"Leg {side[s]}", tube(*xr(660, 700, s), -630, -590, 25, 795, "z"), 770))
        add("leg", sheet(f"Leg brace bracket {side[s]}", rb(*xr(620, 700, s), -590, -587, 130, 210, "y", r=5)))
    add("leg", steel("Leg brace", tube(-660, 660, -630, -590, 150, 190, "x"), 1320))
    ft, lk = None, None
    for s in (-1, 1):
        b = cyl((s * 680, -610, 4), 25, 8).union(cyl((s * 680, -610, 16.5), 5, 17))
        ft = b if ft is None else ft.union(b)
        p = cyl((s * 680, -622, 790), 4, 56, "x").union(cyl((s * 711, -622, 790), 8, 4, "x"))
        lk = p if lk is None else lk.union(p)
    add("leg", bought("Levelling feet M10", ft, BLACK))
    add("leg", bought("Leg lock pins", lk, ZINC))
    es = rb(-775, -705, -645, -575, 640, 715, "z", r=4).union(rb(-775, -705, -645, -575, 640, 715))
    es = rb(-775, -705, -645, -575, 640, 715, "z", r=4).union(cyl((-740, -652, 677.5), 20, 14, "y"))
    add("leg", bought("E-stop station (22 mm, NC)", es, "#e0b400"))

    # ================= gas struts =================
    for s in (-1, 1):
        A = (s * STRUT_X, STRUT_A[0], STRUT_A[1])
        B = (s * STRUT_X, STRUT_B[0], STRUT_B[1])
        add("strut", bought(f"Gas strut {side[s]} body", _rod(A, B, 290, 11), BLACK))
        add("strut", bought(f"Gas strut {side[s]} rod", _rod(B, A, 420, 4), ZINC))

    # ================= control box (on the stand crossbar) =================
    u = union(rb(-128.5, 128.5, 770, 910, 440, 441.5), rb(-128.5, 128.5, 770, 771.5, 440, 510),
              rb(-128.5, 128.5, 908.5, 910, 440, 510))
    add("stand", sheet("Control box", u, 2, 1.5))
    capl = rb(-130, -128.5, 770, 910, 440, 510, "x")
    capl = capl.cut(rb(-135, -125, 800.5, 814.5, 457.5, 466.5))
    for gy in (855, 885):
        capl = capl.cut(cyl((-129, gy, 485), 8, 6, "x"))
    add("stand", sheet("Control box end cap left", capl, 0, 1.5))
    capr = rb(128.5, 130, 770, 910, 440, 510, "x").cut(cyl((129, 800, 475), 5.6, 6, "x"))
    add("stand", sheet("Control box end cap right", capr, 0, 1.5))
    add("stand", sheet("Control box lid", rb(-130, 130, 770, 910, 510, 511.5, "z", r=4), 0, 1.5))
    brk = union(rb(-127, -52, 775, 840, 446, 447.6), rb(-127, -52, 775, 783, 447.6, 456), rb(-127, -52, 832, 840, 447.6, 456))
    add("stand", bought("ESP32 screw-terminal breakout", brk, "#1f7a3a"))
    add("stand", part("esp32_devkitc", at=(-100.8, 807.5, 460), name="ESP32 DevKitC (WROOM-32)"))
    for nm, cx in (("X", -30), ("Y1", 12), ("Y2", 54), ("Z", 96)):
        add("stand", bought(f"Driver carrier {nm}", union(rb(cx - 19, cx + 19, 865, 905, 446, 447.6),
                                                           rb(cx - 19, cx + 19, 897, 905, 447.6, 456)), "#1f5fa8"))
        add("stand", part("tmc2209", at=(cx, 882, 456.1), name=f"{nm} driver (TMC2209)"))
    add("stand", part("lm2596", at=(-20, 800, 446), name="LM2596 buck (24 V to 5 V)"))
    add("stand", part("relay_5v", at=(40, 800, 446), name="Torch relay (5 V)"))
    add("stand", bought("Inline fuse holder (5 A)", rb(85, 115, 793, 807, 442, 454), "#c0392b"))
    add("stand", part("dc_jack_panel", at=(131.5, 800, 475), rot=(0, 90, 0), name="DC jack (24 V in)"))
    return P


def _rod(a, b, L, r):
    """Cylinder from point a toward b, length L (gas strut body / rod)."""
    d = [b[i] - a[i] for i in range(3)]
    n = math.sqrt(sum(v * v for v in d))
    u = [v / n for v in d]
    c = cq.Solid.makeCylinder(r, L, cq.Vector(*a), cq.Vector(*u))
    return cq.Workplane("XY").add(c)


ASSEMBLY = [["Stand runner left", "Stand runner right", "Stand rear foot"], ["Stand post left", "Stand post right", "Stand crossbar"],
            ["Bed side tube left", "Bed side tube right", "Bed cross tube front", "Bed cross tube middle", "Bed cross tube rear"],
            ["Leg left", "Leg right", "Leg brace"], ["Y rail left (2040 V-slot)", "Y rail right (2040 V-slot)"],
            ["Gantry beam (2 x 4 in tube)"], ["X carriage plate"], ["Control box"], ["Control box lid"]]


# ---------------- motion: park gantry, fold legs, swing the bed up, and back ----------------
def _bed_pt(y, z, deg):
    a = math.radians(deg)
    dy, dz = y - PIVOT[0], z - PIVOT[1]
    return (PIVOT[0] + dy * math.cos(a) - dz * math.sin(a), PIVOT[1] + dy * math.sin(a) + dz * math.cos(a))


def motion():
    from cadlib.motion import move, rot, link, then, ease

    def seg(t, a, b):
        return ease((t - a) / (b - a))

    def pose(t):
        if t > 0.5:
            t = 1.0 - t
        g = seg(t, 0.0, 0.12)          # gantry to park
        lg = seg(t, 0.12, 0.24)        # legs fold
        f = seg(t, 0.24, 0.44)         # bed up (holds 0.44..0.56)
        bdeg = -90.0 * f
        R = rot((1, 0, 0), bdeg, (0, PIVOT[0], PIVOT[1]))
        out = {}
        for pid, grp in GROUP.items():
            if grp == "bed":
                out[pid] = R
            elif grp == "gantry":
                out[pid] = then(move((0, PARK_DY * g, 0)), R)
            elif grp == "leg":
                out[pid] = then(rot((1, 0, 0), 90.0 * lg, (0, LEG_PIVOT[0], LEG_PIVOT[1])), R)
        By, Bz = _bed_pt(STRUT_B[0], STRUT_B[1], bdeg)
        for s, n in ((-1, "left"), (1, "right")):
            A = (s * STRUT_X, STRUT_A[0], STRUT_A[1])
            B0 = (s * STRUT_X, STRUT_B[0], STRUT_B[1])
            B1 = (s * STRUT_X, By, Bz)

            def along(p, q, L):
                d = [q[i] - p[i] for i in range(3)]
                m = math.sqrt(sum(v * v for v in d))
                return tuple(p[i] + d[i] / m * L for i in range(3))
            out[f"gas-strut-{n}-body"] = link(A, along(A, B0, 290), A, along(A, B1, 290))
            out[f"gas-strut-{n}-rod"] = link(B0, along(B0, A, 420), B1, along(B1, A, 420))
        return out

    return {"duration": 8, "frames": 120, "pose": pose}

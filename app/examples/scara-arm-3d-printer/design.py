import math
import cadquery as cq
from cadlib import fab
from cadlib.parts import part, info

# --- key dimensions ---
ZC = 150            # carriage plate top (shown mid-travel; travel ~80..430)
L1 = L2 = 150       # SCARA link lengths (axis to axis)
S = (0.0, 95.0)     # shoulder axis
T = (30.0, -45.0)   # nozzle position shown
COLX, COLY = 75, 160
COL_L = 450            # stock 2020 lengths only (Amazon): 450 / 400 / 300 / 250 / 200
BED = (200, 200, -30)  # w, d, centre y
M1 = (-40.0, 140.0)    # shoulder motor
M2 = (40.0, 140.0)     # elbow motor (drives elbow through a belt along link 1)
RA = 20                # big shoulder pulleys (3:1 vs 20T)
RC = 10                # elbow belt pulleys
ZS = (0.0, 138.0)      # Z lead screw, motor on top, just in front of the top bar
TOPZ = 20 + COL_L      # underside of top bar

# column bracing: stamped diagonal support bracket from column back to a short rear outrigger
BRACE_LEG = 150        # bracket reaches 150 up the column and 150 along the outrigger
OUT_L = 200


def ik(s, t, l):
    dx, dy = t[0] - s[0], t[1] - s[1]
    d = math.hypot(dx, dy)
    a = math.atan2(dy, dx) + math.acos(d / (2 * l))
    return (s[0] + l * math.cos(a), s[1] + l * math.sin(a))


E = ik(S, T, L1)


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane().box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def rbox(x0, x1, y0, y1, z0, z1, r, top=0.0):
    """box with rounded vertical edges (r) and optionally rounded top edges"""
    b = box(x0, x1, y0, y1, z0, z1)
    try:
        b = b.edges("|Z").fillet(r)
        if top:
            b = b.faces(">Z").edges().fillet(top)
    except Exception:
        pass
    return b


def gusset(pts, y0, t, holes=()):
    """flat plate in XZ (points are (x, z)), occupying y0-t..y0, with M5 clearance holes"""
    g = cq.Workplane("XZ").polyline(pts).close().extrude(t)
    if holes:
        g = g.cut(cq.Workplane("XZ").pushPoints(list(holes)).circle(2.75).extrude(t))
    return g.translate((0, y0, 0))


def lb_xz(x0, z0, sx, sz, y1, leg=20, t=3.5):
    """stock 2020 corner bracket in the XZ plane, corner at (x0, z0), 20 wide (y1-20..y1)"""
    return gusset([(x0, z0), (x0 + sx * leg, z0), (x0 + sx * leg, z0 + sz * t), (x0 + sx * t, z0 + sz * t),
                   (x0 + sx * t, z0 + sz * leg), (x0, z0 + sz * leg)], y1, 20)


def lb_xy(x0, y0, sx, sy, leg=20, t=3.5):
    """stock 2020 corner bracket in the XY plane (z 0..20), corner at (x0, y0)"""
    return cq.Workplane().polyline([(x0, y0), (x0 + sx * leg, y0), (x0 + sx * leg, y0 + sy * t), (x0 + sx * t, y0 + sy * t),
                                    (x0 + sx * t, y0 + sy * leg), (x0, y0 + sy * leg)]).close().extrude(20)


def quad_yz(pts, x0, w=20):
    return cq.Workplane("YZ").polyline(pts).close().extrude(w).translate((x0, 0, 0))


def cyl(x, y, z0, h, r):
    return cq.Workplane().circle(r).extrude(h).translate((x, y, z0))


def _pose(wp, p, q, z0):
    ang = math.degrees(math.atan2(q[1] - p[1], q[0] - p[0]))
    return wp.rotate((0, 0, 0), (0, 0, 1), ang).translate(((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, z0))


def link(p, q, z0, t, w=26, hole=8.2):
    L = math.hypot(q[0] - p[0], q[1] - p[1])
    s = cq.Workplane().slot2D(L + w, w).extrude(t)
    s = s.cut(cq.Workplane().slot2D(L - 2 * w, w - 14).extrude(t - 4).translate((0, 0, 4)))  # blind pocket, 4 mm floor = I-beam-like
    s = s.cut(cq.Workplane().pushPoints([(-L / 2, 0), (L / 2, 0)]).circle(hole / 2).extrude(t))
    return _pose(s, p, q, z0)


def belt(c1, r1, c2, r2, z0, w=6, t=1.5):
    def loop(o):
        a = cyl(c1[0], c1[1], 0, w, r1 + o).union(cyl(c2[0], c2[1], 0, w, r2 + o))
        L = math.hypot(c2[0] - c1[0], c2[1] - c1[1])
        q = cq.Workplane().polyline([(-L / 2, -(r1 + o)), (L / 2, -(r2 + o)),
                                     (L / 2, r2 + o), (-L / 2, r1 + o)]).close().extrude(w)
        return a.union(_pose(q, c1, c2, 0))
    return loop(t).cut(loop(0)).translate((0, 0, z0))


def centred(key, c, **kw):
    """place a library part with its bbox centre at c"""
    i = info(key)
    lo, hi = i["bbox_min"], i["bbox_max"]
    return part(key, at=tuple(c[k] - (lo[k] + hi[k]) / 2 for k in range(3)), **kw)


def ext(name, length, axis, at):
    return {"name": name, "shape": fab.extrusion(length, axis=axis, at=at), "group": "case",
            "process": "extrusion", "color": "#b8bcc2",
            "params": {"profile": "2020", "length_mm": length, "tapped_ends": 0}}


ORANGE = "#e8702a"
BUY = {"group": "component", "color": "#8e949b"}   # stock 2020 hardware (Amazon), listed in bom.json


def parts():
    out = []
    # --- frame: stock-length 2020, square cut, no tapping ---
    for y in (-160, 160):
        out.append(ext("2020 x 400", 400, "x", (-200, y, 10)))
    for x in (-190, 190):
        out.append(ext("2020 x 300", 300, "y", (x, -150, 10)))
    for x in (-COLX, COLX):
        out.append(ext("Z column 2020 x 450", COL_L, "z", (x, COLY, 20)))
    out.append(ext("Top bar 2020 x 200", 200, "x", (-100, COLY, TOPZ + 10)))

    corner = None   # all 90 deg corner brackets as one bought line

    def addc(s):
        nonlocal corner
        corner = s if corner is None else corner.union(s)

    # base frame inside corners
    for sx in (-1, 1):
        for sy in (-1, 1):
            addc(lb_xy(sx * 180, sy * 150, -sx, -sy))

    for cx in (-COLX, COLX):
        s = 1 if cx > 0 else -1
        # column feet: corner brackets both sides onto the rear bar
        addc(lb_xz(cx - 10, 20, -1, 1, COLY + 10))
        addc(lb_xz(cx + 10, 20, 1, 1, COLY + 10))
        # top: corner bracket under the top bar (inner side) + L plate on the back
        addc(lb_xz(cx - 10 * s, TOPZ, -s, -1, COLY + 10))
        out.append({"name": "2020 L joining plate", **BUY,
                    "shape": gusset([(cx + 20 * s, TOPZ + 20), (cx - 40 * s, TOPZ + 20), (cx - 40 * s, TOPZ),
                                     (cx - 10 * s, TOPZ), (cx - 10 * s, TOPZ - 50), (cx + 10 * s, TOPZ - 50),
                                     (cx + 10 * s, TOPZ), (cx + 20 * s, TOPZ)], COLY + 13, 3,
                                    [(cx - 28 * s, TOPZ + 10), (cx, TOPZ + 10), (cx, TOPZ - 20), (cx, TOPZ - 38)])})
        # short rear outrigger, held to the back of the rear bar by two corner brackets
        out.append(ext("Rear outrigger 2020 x 200", OUT_L, "y", (cx, COLY + 10, 10)))
        addc(lb_xy(cx - 10, COLY + 10, -1, 1))
        addc(lb_xy(cx + 10, COLY + 10, 1, 1))
        # stamped steel diagonal support bracket: back slot of the column -> top slot of the outrigger
        y0, z0, L = COLY + 10, 20, BRACE_LEG
        ds = (quad_yz([(y0, z0 + L - 10), (y0 + 3, z0 + L - 10), (y0 + 3, z0 + L + 30), (y0, z0 + L + 30)], cx - 9, 18)
              .union(quad_yz([(y0 + L - 10, z0), (y0 + L + 30, z0), (y0 + L + 30, z0 + 3), (y0 + L - 10, z0 + 3)], cx - 9, 18))
              .union(quad_yz([(y0, z0 + L), (y0 + L, z0), (y0 + L + 4, z0 + 3), (y0 + 3, z0 + L + 4)], cx - 9, 18)))
        ds = ds.cut(cq.Workplane("XZ").pushPoints([(cx, z0 + L + 15)]).circle(2.75).extrude(-10).translate((0, y0 - 2, 0)))
        out.append({"name": "2020 diagonal support bracket", **BUY, "shape": ds})
        out.append({"name": "Outrigger foot", "group": "case", "color": "#222222",
                    "shape": rbox(cx - 12, cx + 12, COLY + OUT_L - 15, COLY + OUT_L + 12, -3, 0, 4)})
        # MGN12 rail on the front face of the column + carriage block
        out.append({"name": "MGN12 rail 400 mm", "group": "component", "color": "#6d737a",
                    "shape": box(cx - 6, cx + 6, COLY - 18, COLY - 10, 30, 430)})
        out.append({"name": "MGN12H block", "group": "component", "color": "#3b4046",
                    "shape": rbox(cx - 13.5, cx + 13.5, COLY - 23, COLY - 14, ZC - 50, ZC - 5, 2)})
    out.append({"name": "2020 corner bracket", **BUY, "shape": corner})

    # under-frame flat L plates (rubber feet stick underneath)
    for sx in (-1, 1):
        for sy in (-1, 1):
            xo, yo = sx * 200, sy * 170
            cp_ = rbox(min(xo, xo - sx * 70), max(xo, xo - sx * 70), min(yo, yo - sy * 20), max(yo, yo - sy * 20), -3, 0, 4) \
                .union(rbox(min(xo, xo - sx * 20), max(xo, xo - sx * 20), min(yo, yo - sy * 70), max(yo, yo - sy * 70), -3, 0, 4))
            cp_ = cp_.cut(cq.Workplane().pushPoints([(xo - sx * 50, yo - sy * 10), (xo - sx * 10, yo - sy * 50),
                                                     (xo - sx * 10, yo - sy * 10)])
                          .circle(2.75).extrude(3).translate((0, 0, -3)))
            out.append({"name": "2020 flat L plate", "shape": cp_, **BUY})

    plate = rbox(-200, 200, -170, 170, 20, 26, 20)
    for x in (-COLX, COLX):
        plate = plate.cut(box(x - 31, x + 31, COLY - 10.5, 171, 20, 26))   # column + foot brackets
    holes = [(x, y) for x in (-150, -50, 50, 150) for y in (-160, 160) if not (abs(abs(x) - COLX) < 60 and y > 0)]
    holes += [(x, y) for x in (-190, 190) for y in (-100, 0, 100)]
    plate = plate.cut(cq.Workplane().pushPoints(holes).circle(2.75).extrude(6).translate((0, 0, 20)))
    out.append({"name": "Base plate", "shape": plate, "group": "case", "process": "laser",
                "params": {"material": "plywood", "thickness_mm": 6}, "color": "#d8b98a"})

    # --- bed: 3 mm aluminium on 4 standoffs, magnetic PEI sheet on top ---
    bw, bd, by = BED
    bed = rbox(-bw / 2, bw / 2, by - bd / 2, by + bd / 2, 36, 39, 10)
    corners = [(sx * (bw / 2 - 10), by + sy * (bd / 2 - 10)) for sx in (-1, 1) for sy in (-1, 1)]
    bed = bed.cut(cq.Workplane().pushPoints(corners).circle(1.7).extrude(3).translate((0, 0, 36)))
    out.append({"name": "Bed plate", "shape": bed, "group": "case", "process": "sheet",
                "params": {"material": "aluminium 5052", "thickness_mm": 3, "bends": 0},
                "color": "#9aa0a6"})
    out.append({"name": "PEI spring steel sheet", "shape": rbox(-bw / 2, bw / 2, by - bd / 2, by + bd / 2, 39, 40, 10),
                "group": "component", "color": "#c9a227"})
    out.append(part("m3x10_standoff", at=[(x, y, 26) for x, y in corners]))

    # --- Z drive: motor upside down on a plate on top of the top bar, screw hangs down ---
    zp = rbox(-30, 30, ZS[1] - 26, COLY + 10, TOPZ + 20, TOPZ + 23, 6)
    zp = zp.cut(cyl(ZS[0], ZS[1], TOPZ + 20, 3, 11.5)).cut(
        cq.Workplane().pushPoints([(-20, COLY), (20, COLY)]).circle(2.75).extrude(3).translate((0, 0, TOPZ + 20)))
    out.append({"name": "Z motor plate", "shape": zp, "group": "case", "process": "sheet",
                "params": {"material": "aluminium 5052", "thickness_mm": 3, "bends": 0}, "color": "#9aa0a6"})
    out.append(part("nema17_40", at=(ZS[0], ZS[1], TOPZ + 23), rot=(180, 0, 0)))
    out.append({"name": "Flexible coupler 5-8 mm", "shape": cyl(ZS[0], ZS[1], TOPZ - 10, 25, 9.5),
                "group": "component", "color": "#a0a6ad"})
    out.append({"name": "T8 lead screw 400 mm", "shape": cyl(ZS[0], ZS[1], TOPZ - 405, 400, 4),
                "group": "component", "color": "#d0d0d0"})

    # --- Z carriage: one bent 3 mm aluminium part (plate + two tabs bolted to the MGN blocks) ---
    cp = rbox(-90, 90, 75, COLY - 23, ZC - 3, ZC, 15).union(rbox(-62, 62, 120, 165, ZC - 3, ZC, 10))
    for sx in (-1, 1):
        cp = cp.union(box(min(sx * 62, sx * 90), max(sx * 62, sx * 90), COLY - 26, COLY - 23, ZC - 50, ZC))
    cp = cp.cut(cq.Workplane().pushPoints([M1, M2]).circle(11.5).extrude(3).translate((0, 0, ZC - 3)))
    cp = cp.cut(cq.Workplane().pushPoints([S, ZS]).circle(11.2).extrude(3).translate((0, 0, ZC - 3)))
    out.append({"name": "Carriage", "shape": cp, "group": "case", "process": "sheet",
                "params": {"material": "aluminium 5052", "thickness_mm": 3, "bends": 2},
                "color": "#9aa0a6"})
    out.append({"name": "T8 brass nut", "shape": cyl(ZS[0], ZS[1], ZC - 13, 10, 11).union(cyl(ZS[0], ZS[1], ZC - 3, 15, 5)),
                "group": "component", "color": "#c8a14a"})

    # --- SCARA arm ---
    out.append(part("nema17_48", at=[(M1[0], M1[1], ZC - 3), (M2[0], M2[1], ZC - 3)]))
    out.append(part("gt2_pulley_20t", at=[(M1[0], M1[1], ZC), (M2[0], M2[1], ZC + 12)]))
    out.append(part("bearing_608", at=[(S[0], S[1], ZC - 7), (E[0], E[1], ZC + 30)]))
    out.append({"name": "Shoulder shaft 8 mm", "shape": cyl(S[0], S[1], ZC - 10, 62, 4),
                "group": "component", "color": "#d0d0d0"})
    out.append({"name": "Shoulder pulley", "shape": cyl(S[0], S[1], ZC + 2, 12, RA).cut(cyl(S[0], S[1], ZC + 2, 12, 4.1)),
                "group": "case", "color": "#333333"})
    out.append({"name": "Elbow drive pulley", "shape": cyl(S[0], S[1], ZC + 14, 11, RA)
                .union(cyl(S[0], S[1], ZC + 52, 10, RC)).union(cyl(S[0], S[1], ZC + 25, 27, 6))
                .cut(cyl(S[0], S[1], ZC + 14, 48, 4.2)),
                "group": "case", "color": "#555555"})
    out.append({"name": "Link 1", "shape": link(S, E, ZC + 26, 26, 44), "group": "case", "color": ORANGE})
    out.append({"name": "Elbow pulley", "shape": cyl(E[0], E[1], ZC + 52, 10, RC), "group": "case", "color": "#555555"})
    out.append({"name": "Link 2", "shape": link(E, T, ZC + 62, 20, 36, hole=6), "group": "case", "color": ORANGE})
    out.append({"name": "GT2 belts (closed loops)",
                "shape": belt(M1, 6.5, S, RA, ZC + 5).union(belt(M2, 6.5, S, RA, ZC + 17))
                .union(belt(S, RC, E, RC, ZC + 54)),
                "group": "component", "color": "#1a1a1a"})

    # --- hotend on link 2 tip ---
    out.append({"name": "Hotend mount", "shape": cyl(T[0], T[1], ZC - 4, 66, 16).cut(cyl(T[0], T[1], ZC - 4, 66, 8.1)),
                "group": "case", "color": ORANGE})
    he = (cyl(T[0], T[1], ZC - 30, 26, 11)
          .union(box(T[0] - 8, T[0] + 12, T[1] - 8, T[1] + 8, ZC - 42, ZC - 31))
          .union(cq.Workplane().circle(0.4).workplane(offset=6).circle(3.5).loft()
                 .translate((T[0], T[1], ZC - 48))))
    out.append({"name": "V6-style hotend 24 V", "shape": he, "group": "component", "color": "#c0c0c0"})
    out.append(centred("fan_30", (T[0], T[1] + 22, ZC - 17), rot=(90, 0, 0)))

    # --- bowden extruder + spool holder on the top bar ---
    out.append(part("nema17_40", at=(-70, COLY, TOPZ + 60)))
    out.append({"name": "Bowden extruder kit", "shape": rbox(-92, -48, COLY - 21, COLY + 21, TOPZ + 60, TOPZ + 85, 5, top=3),
                "group": "component", "color": "#c0392b"})
    # one printed piece: foot bolted to the top bar's top slot (2 x M5), post, rod pointing back, end lip
    sh = (rbox(50, 90, COLY - 10, COLY + 10, TOPZ + 20, TOPZ + 26, 5)
          .union(rbox(60, 80, COLY - 10, COLY + 10, TOPZ + 20, TOPZ + 64, 4))
          .union(cq.Workplane("XZ").circle(14).extrude(-110).translate((70, COLY, TOPZ + 50)))
          .union(cq.Workplane("XZ").circle(22).extrude(-4).translate((70, COLY + 106, TOPZ + 50))))
    sh = sh.cut(cq.Workplane().pushPoints([(54, COLY), (86, COLY)]).circle(2.75).extrude(6)
                .translate((0, 0, TOPZ + 20)))
    out.append({"name": "Spool holder", "shape": sh, "group": "case", "color": ORANGE})

    # --- electronics box (printed) with clear acrylic lid ---
    eb = rbox(100, 190, 45, 135, 26, 60, 10).cut(rbox(102.5, 187.5, 47.5, 132.5, 28, 60, 7.5))
    eb = eb.cut(cq.Workplane("YZ").center(110, 43).circle(5.5).extrude(3).translate((187, 0, 0)))
    out.append({"name": "Electronics box", "shape": eb, "group": "case", "color": "#333333"})
    out.append({"name": "Electronics lid", "shape": rbox(100, 190, 45, 135, 60, 63, 10), "group": "case",
                "process": "laser", "params": {"material": "acrylic", "thickness_mm": 3},
                "color": "#cfe8ff"})
    out.append({"name": "32-bit printer board (4 TMC2209)", "shape": box(110, 180, 52, 128, 33, 35)
                .union(box(120, 170, 60, 120, 35, 45)),
                "group": "component", "color": "#1f6f3f"})
    out.append(part("dc_jack_panel", at=(190, 110, 43), rot=(0, 90, 0)))
    return out

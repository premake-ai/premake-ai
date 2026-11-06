"""Home hip-thrust machine for resistance bands.

Hidden aluminium frame (2040 rails, 2020 cross bars and posts) clad in laser-cut
birch plywood. An upholstered back pad sits on a telescoping plywood cap that pins
at three heights. Oak dowel band rails run along both sides (loop a band anywhere
along them to suit leg length); a padded oak hip bar with printed band guides.
Stands upright on its back end for storage.
"""
import cadquery as cq
from cadlib import fab
from cadlib.parts import part

SCENE = "floor"

T = fab.sheet_actual("plywood", 6)      # 5.5 mm real birch ply
PLY = {"material": "plywood", "thickness_mm": 6}
Z0 = 3.0                                 # rubber pads under the rails
RI, RO = 225.0, 245.0                    # rail inner / outer face (x)
W = RO + T                               # outer half-width of the shell
YF, YB = -594.0, 606.0                   # rail ends
YBOX = 206.0                             # bench box front face
RAIL_TOP = Z0 + 40
DECK_TOP = RAIL_TOP + T
POST_LEN = 250
BH = RAIL_TOP + POST_LEN + T             # box top surface
CAP_BAR_Z0 = BH + 0.5
CB0 = CAP_BAR_Z0 + 20                    # cap board underside (lowest setting)
CT = CB0 + T                             # cap board top
SKIRT_D = 150
PIN_Z = [CT - 126.5 + 40 * i for i in range(3)]   # pin holes in the box sides
PIN_Y = [260.0, 560.0]
PIN_D = 12.4
CAP_X = W + 0.5                          # cap skirt inner face
CAP_W = CAP_X + T
BAR_YS = [-584.0, -390.0, -194.0, 10.0, 209.0, 596.0]
POST_Y = [YBOX + T + 10, YB - 10]
DOWEL_R = 31.75 / 2                      # 1-1/4" oak dowel
AX, AZ = W + 7 + DOWEL_R, 40.0           # band rail axis (x, z): 7 mm band gap to the shell
ANCHOR_Y0, DOWEL_L = -560.0, 914.4       # 36" dowel
ANCHOR_BRK_Y = [-480.0, 120.0]
HIP_Y, HIP_Z = -180.0, 300.0             # hip bar shown mid-thrust
BAND_W = 31.75                           # 1-1/4" wide band (35-85 lb)
BRK_T = 7.0                              # rail bracket base thickness
GUIDE_W, GUIDE_GAP = 6.0, 72.0           # hip-bar lock rings: width, clear gap for a 2.5" band
RING_X = [AX + GUIDE_GAP / 2 + GUIDE_W / 2]   # outer stop only; the bar pad is the inner stop
BOLT_DY = (-8, 8)
CSK = "m5x10_csk"


def slab(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def round_edges(w, sel, r):
    try:
        return w.edges(sel).fillet(r)
    except Exception:
        return w


def csk_holes(w, pts, d):
    """M5 countersunk clearance holes; pts are head positions on the surface, d the shank direction."""
    v = cq.Vector(*d)
    for p in pts:
        pv = cq.Vector(*p)
        w = w.cut(cq.Workplane().add(cq.Solid.makeCylinder(2.75, 40, pv - v * 1, v)))
        w = w.cut(cq.Workplane().add(cq.Solid.makeCone(5.4, 2.6, 2.8, pv - v * 0.2, v)))
    return w


def thru_holes(w, pts, d, dia, length=60):
    v = cq.Vector(*d)
    for p in pts:
        w = w.cut(cq.Workplane().add(cq.Solid.makeCylinder(dia / 2, length, cq.Vector(*p) - v * (length / 2), v)))
    return w


def ply(name, shape, **kw):
    d = {"name": name, "shape": shape, "process": "laser", "params": PLY}
    d.update(kw)
    return d


# ---------------------------------------------------------------- screw maps
def deck_screws():
    pts = []
    for (y0, y1, bars) in ((YF, -194.0, [-584.0, -390.0]), (-194.0, YBOX, [10.0])):
        for s in (-1, 1):
            for f in (0.04, 0.33, 0.66, 0.96):
                pts.append((s * 235, y0 + 15 + (y1 - y0 - 30) * f, DECK_TOP))
        for yb in bars:
            pts += [(-120, yb, DECK_TOP), (120, yb, DECK_TOP)]
    return pts


SKIRT_SCREW_Y = [-420.0, -260.0, -60.0, 60.0]
BOX_SIDE_SCREWS = [(POST_Y[0], z) for z in (80, 170, 260)] + [(POST_Y[1], z) for z in (80, 170, 260)] + [(320, Z0 + 10), (500, Z0 + 10)]
CAP_BAR_Y = [260.0, 406.0, 552.0]
PAD_SCREWS = [(sx, sy) for sx in (-150, 150) for sy in (290, 520)]


# ---------------------------------------------------------------- printed parts
def anchor_bracket(s, yb):
    """Band-rail bracket: holds the oak rail 10 mm off the shell, 2 x M5 into the rail's lower slot."""
    x0 = W
    base = slab(0, BRK_T, -14, 14, 6, 48)
    base = round_edges(base, "|X", 4)
    ring = cq.Workplane("XZ").circle(DOWEL_R + 4.35).extrude(8, both=True).translate((AX - x0, 0, AZ))
    b = base.union(ring)
    b = b.cut(cq.Workplane("XZ").circle(DOWEL_R + 0.35).extrude(30, both=True).translate((AX - x0, 0, AZ)))
    for dy in BOLT_DY:
        b = b.cut(cq.Workplane("YZ").circle(2.8).extrude(40).translate((-5, dy, Z0 + 10)))
    b = b.cut(cq.Workplane("XY").circle(2.25).extrude(30).translate((AX - x0, 0, AZ)))
    b = b.translate((x0, yb, 0))
    return b if s > 0 else b.mirror("YZ")


def pin(s, y, z):
    """Height pin: 12 mm shank through cap skirt and box side, knurled 28 mm head."""
    head = cq.Workplane("YZ").circle(11).extrude(5)
    try:
        head = head.faces(">X").edges().fillet(1.5)
    except Exception:
        pass
    for i in range(10):
        head = head.cut(cq.Workplane("YZ").circle(1.3).extrude(5).translate((0, 0, 11)).rotate((0, 0, 0), (1, 0, 0), i * 36))
    shank = cq.Workplane("YZ").circle(6.0).extrude(-17.5)
    try:
        shank = shank.faces("<X").chamfer(1)
    except Exception:
        pass
    p = head.union(shank).translate((CAP_W, y, z))
    return p if s > 0 else p.mirror("YZ")


def band_ring(x):
    """Lock ring on the hip bar; a pair each side keeps a band (up to 2.5 in wide) over its rail."""
    g = cq.Workplane("YZ").circle(22).circle(DOWEL_R + 0.25).extrude(GUIDE_W).translate((x - GUIDE_W / 2, HIP_Y, HIP_Z))
    try:
        g = g.faces("<X or >X").edges().chamfer(1)
    except Exception:
        pass
    return g.cut(cq.Workplane("XY").circle(1.7).extrude(30).translate((x, HIP_Y, HIP_Z + 10)))


# ---------------------------------------------------------------- bands (display)
def band_loop(s):
    """Loop band: under the lengthwise rail, a quarter twist, then over the crosswise hip bar."""
    ro, ri = DOWEL_R + 4.7, DOWEL_R + 0.2
    zm = (AZ + HIP_Z) / 2
    hw = BAND_W / 2

    def half_ring(c, d, top):
        v = cq.Vector(*d)
        r = cq.Solid.makeCylinder(ro, BAND_W, cq.Vector(*c) - v * hw, v).cut(cq.Solid.makeCylinder(ri, BAND_W, cq.Vector(*c) - v * hw, v))
        cut = slab(-1e3, 1e3, -1e3, 1e3, c[2], 1e3) if not top else slab(-1e3, 1e3, -1e3, 1e3, -1e3, c[2])
        return cq.Workplane().add(r).cut(cut)

    b = half_ring((AX, HIP_Y, AZ), (0, 1, 0), False)
    for x0, x1 in ((AX - ro, AX - ri), (AX + ri, AX + ro)):
        b = b.union(slab(x0, x1, HIP_Y - hw, HIP_Y + hw, AZ - 0.1, zm))
    b = b.union(half_ring((AX, HIP_Y, HIP_Z), (1, 0, 0), True))
    for y0, y1 in ((HIP_Y - ro, HIP_Y - ri), (HIP_Y + ri, HIP_Y + ro)):
        b = b.union(slab(AX - hw, AX + hw, y0, y1, zm - 4, HIP_Z + 0.1))
    return b if s > 0 else b.mirror("YZ")


def parts():
    out = []
    # ---------------- hidden frame
    for s in (-1, 1):
        out.append({"name": "Side rail " + ("L" if s < 0 else "R"),
                    "shape": fab.extrusion(1200, profile="2040", axis="y", at=(s * 235, YF, Z0 + 20)),
                    "process": "extrusion", "params": {"profile": "2040", "length_mm": 1200, "tapped_ends": 0}})
    for i, yb in enumerate(BAR_YS):
        out.append({"name": f"Cross bar {i + 1}", "shape": fab.extrusion(450, profile="2020", axis="x", at=(-RI, yb, Z0 + 30)),
                     "process": "extrusion", "params": {"profile": "2020", "length_mm": 450, "tapped_ends": 0}})
    for i, (sx, yc) in enumerate([(sx, yc) for yc in POST_Y for sx in (-1, 1)]):
        out.append({"name": f"Box post {i + 1}", "shape": fab.extrusion(POST_LEN, profile="2020", axis="z", at=(sx * 235, yc, RAIL_TOP)),
                    "process": "extrusion", "params": {"profile": "2020", "length_mm": POST_LEN, "tapped_ends": 0}})
    # corner brackets: cross bars to rails, posts to rails
    fr = [yb for yb in BAR_YS if yb != BAR_YS[0]]
    out.append(part("bracket_2020", at=[(RI - 3, yb - 13, Z0 + 30) for yb in fr], rot=(-90, 0, 180)))
    out.append(part("bracket_2020", at=[(-RI + 3, yb - 13, Z0 + 30) for yb in fr], rot=(90, 0, 0)))
    out.append(part("bracket_2020", at=[(RI - 3, BAR_YS[0] + 13, Z0 + 30)], rot=(-90, 180, 0)))
    out.append(part("bracket_2020", at=[(-RI + 3, BAR_YS[0] + 13, Z0 + 30)], rot=(-90, 0, 0)))
    out.append(part("bracket_2020", at=[(sx * 235, POST_Y[0] + 13, RAIL_TOP + 3) for sx in (-1, 1)], rot=(0, 0, 90)))
    out.append(part("bracket_2020", at=[(sx * 235, POST_Y[1] - 13, RAIL_TOP + 3) for sx in (-1, 1)], rot=(0, 0, -90)))

    # ---------------- plywood shell
    deck_pts = deck_screws()
    for i, (y0, y1) in enumerate(((YF, -194.0), (-194.0, YBOX))):
        d = slab(-W, W, y0, y1, RAIL_TOP, DECK_TOP)
        if i == 0:
            d = round_edges(d, "|Z and <Y", 12)
        d = csk_holes(d, [p for p in deck_pts if y0 < p[1] < y1], (0, 0, -1))
        out.append(ply(f"Deck panel {i + 1}", d))
    out.append(ply("Front panel", round_edges(
        csk_holes(slab(-W, W, YF - T, YF, Z0, DECK_TOP), [(sx, YF - T, Z0 + 30) for sx in (-120, 120)], (0, 1, 0)),
        "|Y", 6)))
    for s in (-1, 1):
        for j, (y0, y1) in enumerate(((YF, -194.0), (-194.0, YBOX))):
            sk = slab(RO, W, y0, y1, Z0, RAIL_TOP) if s > 0 else slab(-W, -RO, y0, y1, Z0, RAIL_TOP)
            sk = csk_holes(sk, [(s * W, y, Z0 + 30) for y in SKIRT_SCREW_Y if y0 < y < y1], (-s, 0, 0))
            sk = thru_holes(sk, [(s * W, yb + dy, Z0 + 10) for yb in ANCHOR_BRK_Y for dy in BOLT_DY if y0 < yb < y1], (1, 0, 0), 5.6)
            out.append(ply(f"Skirt {'L' if s < 0 else 'R'}{j + 1}", sk))
        side = slab(RO, W, YBOX, YB, Z0, BH) if s > 0 else slab(-W, -RO, YBOX, YB, Z0, BH)
        side = round_edges(side, "|X and <Y and >Z", 4)
        side = csk_holes(side, [(s * W, y, z) for (y, z) in BOX_SIDE_SCREWS], (-s, 0, 0))
        side = thru_holes(side, [(s * (RO + T / 2), y, z) for y in PIN_Y for z in PIN_Z], (1, 0, 0), PIN_D)
        out.append(ply("Box side " + ("L" if s < 0 else "R"), side))
    fw = slab(-RO, RO, YBOX, YBOX + T, RAIL_TOP, BH)
    fw = csk_holes(fw, [(sx * 235, YBOX, z) for sx in (-1, 1) for z in (110, 250)], (0, 1, 0))
    out.append(ply("Box front", fw))
    bw = slab(-W, W, YB, YB + T, Z0, BH)
    bw = round_edges(bw, "|Y and >Z", 6)
    bw = csk_holes(bw, [(sx * 235, YB + T, z) for sx in (-1, 1) for z in (110, 250)] + [(sx, YB + T, Z0 + 30) for sx in (-120, 120)], (0, -1, 0))
    out.append(ply("Box back", bw))
    out.append(ply("Box top", slab(-RO, RO, YBOX + T, YB, BH - T, BH)))

    # ---------------- telescoping pad cap (moves together)
    for s in (-1, 1):
        out.append({"id": f"capbar{s}", "name": "Cap bar " + ("L" if s < 0 else "R"),
                    "shape": fab.extrusion(350, profile="2020", axis="y", at=(s * (CAP_X - 10), 231, CAP_BAR_Z0 + 10)),
                    "process": "extrusion", "params": {"profile": "2020", "length_mm": 350, "tapped_ends": 0}})
        sk = slab(CAP_X, CAP_W, YBOX, YB, CT - SKIRT_D, CB0) if s > 0 else slab(-CAP_W, -CAP_X, YBOX, YB, CT - SKIRT_D, CB0)
        sk = round_edges(sk, "|X and <Z", 10)
        sk = csk_holes(sk, [(s * CAP_W, y, CAP_BAR_Z0 + 10) for y in CAP_BAR_Y], (-s, 0, 0))
        sk = thru_holes(sk, [(s * (CAP_X + T / 2), y, PIN_Z[0]) for y in PIN_Y], (1, 0, 0), PIN_D)
        out.append(ply("Cap skirt " + ("L" if s < 0 else "R"), sk, id=f"capskirt{s}"))
    cb = slab(-CAP_W, CAP_W, YBOX, YB, CB0, CT)
    cb = round_edges(cb, "|Z", 10)
    cb = csk_holes(cb, [(sx * (CAP_X - 10), y, CT) for sx in (-1, 1) for y in CAP_BAR_Y], (0, 0, -1))
    cb = csk_holes(cb, [(x, y, CB0) for (x, y) in PAD_SCREWS], (0, 0, 1))
    out.append(ply("Cap board", cb, id="capboard"))
    pb = slab(-278, 278, YBOX + 1, YB - 1, CT, CT + T)
    pb = round_edges(pb, "|Z", 25)
    pb = thru_holes(pb, [(x, y, CT) for (x, y) in PAD_SCREWS], (0, 0, 1), 6.5)
    out.append(ply("Pad board", pb, id="padboard"))
    cush = slab(-285, 285, YBOX - 6, YB + 6, CT, CT + T + 50.8)
    cush = round_edges(cush, "|Z", 30)
    cush = round_edges(cush, ">Z", 22)
    cush = cush.cut(slab(-278.2, 278.2, YBOX + 0.8, YB - 0.8, CT - 1, CT + T + 1.4))
    out.append({"id": "cushion", "name": "Back pad (2in foam + boucle)", "shape": cush, "group": "component",
                "color": "#e8e0d2"})
    tee = cq.Workplane("XY")
    for (x, y) in PAD_SCREWS:
        tee = tee.union(cq.Workplane("XY").circle(9.5).extrude(1.2).translate((x, y, CT + T)))
    out.append({"id": "teenuts", "name": "M5 tee nut", "shape": tee, "group": "component", "color": "#b9b9b9"})
    out.append(dict(part(CSK, at=[(s * CAP_W, y, CAP_BAR_Z0 + 10) for y in CAP_BAR_Y for s in (1,)], rot=(0, 90, 0)), id="capscrR"))
    out.append(dict(part(CSK, at=[(-CAP_W, y, CAP_BAR_Z0 + 10) for y in CAP_BAR_Y], rot=(0, -90, 0)), id="capscrL"))
    out.append(dict(part(CSK, at=[(sx * (CAP_X - 10), y, CT) for sx in (-1, 1) for y in CAP_BAR_Y]), id="capscrT"))
    out.append(dict(part("m5x16_csk", at=[(x, y, CB0) for (x, y) in PAD_SCREWS], rot=(180, 0, 0)), id="padscr"))
    for s in (-1, 1):
        for i, y in enumerate(PIN_Y):
            out.append({"id": f"pin{s}{i}", "name": "Height pin", "shape": pin(s, y, PIN_Z[0]), "color": "#f4f4f2"})

    # ---------------- shell screws
    out.append(part(CSK, at=deck_pts))
    out.append(part(CSK, at=[(W, y, Z0 + 30) for y in SKIRT_SCREW_Y] + [(W, y, z) for (y, z) in BOX_SIDE_SCREWS], rot=(0, 90, 0)))
    out.append(part(CSK, at=[(-W, y, Z0 + 30) for y in SKIRT_SCREW_Y] + [(-W, y, z) for (y, z) in BOX_SIDE_SCREWS], rot=(0, -90, 0)))
    out.append(part(CSK, at=[(sx, YF - T, Z0 + 30) for sx in (-120, 120)] + [(sx * 235, YBOX, z) for sx in (-1, 1) for z in (110, 250)], rot=(90, 0, 0)))
    out.append(part(CSK, at=[(sx * 235, YB + T, z) for sx in (-1, 1) for z in (110, 250)] + [(sx, YB + T, Z0 + 30) for sx in (-120, 120)], rot=(-90, 0, 0)))

    # ---------------- band rails
    for s in (-1, 1):
        out.append({"name": "Band rail " + ("L" if s < 0 else "R"),
                    "shape": cq.Workplane("XZ").circle(DOWEL_R).extrude(-DOWEL_L).translate((s * AX, ANCHOR_Y0, AZ)),
                    "group": "component", "color": "#d8b07e", "material": "wood"})
        for j, yb in enumerate(ANCHOR_BRK_Y):
            out.append({"name": f"Rail bracket {'L' if s < 0 else 'R'}{j + 1}", "shape": anchor_bracket(s, yb), "color": "#f4f4f2"})
    out.append(part("m5x20_bhcs", at=[(W + BRK_T, yb + dy, Z0 + 10) for yb in ANCHOR_BRK_Y for dy in BOLT_DY], rot=(0, 90, 0)))
    out.append(part("m5x20_bhcs", at=[(-W - BRK_T, yb + dy, Z0 + 10) for yb in ANCHOR_BRK_Y for dy in BOLT_DY], rot=(0, -90, 0)))
    out.append(part("m4x20_selftap", at=[(s * AX, yb, AZ + DOWEL_R + 4.35) for s in (-1, 1) for yb in ANCHOR_BRK_Y]))

    # ---------------- hip bar + bands (shown in use)
    out.append({"name": "Hip bar (oak dowel)", "shape": cq.Workplane("YZ").circle(DOWEL_R).extrude(DOWEL_L).translate((-DOWEL_L / 2, HIP_Y, HIP_Z)),
                "group": "component", "color": "#d8b07e", "material": "wood"})
    pad = cq.Workplane("YZ").circle(50).circle(DOWEL_R).extrude(400).translate((-200, HIP_Y, HIP_Z))
    out.append({"name": "Hip bar pad", "shape": pad, "group": "component", "color": "#8d8a85"})
    for s in (-1, 1):
        for j, x in enumerate(RING_X):
            out.append({"name": f"Band ring {'L' if s < 0 else 'R'}{j + 1}", "shape": band_ring(s * x), "color": "#f4f4f2"})
        out.append({"name": "Loop band " + ("L" if s < 0 else "R"), "shape": band_loop(s), "group": "component", "color": "#7a5ca8", "material": "rubber"})
    out.append(part("m3x16_selftap", at=[(s * x, HIP_Y, HIP_Z + 22) for s in (-1, 1) for x in RING_X]))

    # ---------------- rubber feet (under rails; on the back for upright storage)
    feet = cq.Workplane("XY")
    for sx in (-1, 1):
        for y in (-575, -200, 200, 585):
            feet = feet.union(slab(sx * 235 - 9.5, sx * 235 + 9.5, y - 9.5, y + 9.5, 0, Z0))
        for z in (40, 260):
            feet = feet.union(cq.Workplane("XZ").circle(9.5).extrude(-3).translate((sx * 190, YB + T, z)))
    out.append({"name": "Rubber feet", "shape": feet, "group": "component", "color": "#222222", "material": "rubber"})
    if CHECK:
        _check(out)
    return out


CHECK = False   # True: print solid counts and clashes between our own parts


def _check(out):
    mine = [p for p in out if isinstance(p.get("shape"), cq.Workplane) and not p.get("lib")]
    for p in mine:
        if p.get("group") != "component":
            n = len(p["shape"].solids().vals())
            if n != 1:
                print("CHECK solids", p["name"], n)
    vals = [(p.get("id", p["name"]), p["shape"].val() if len(p["shape"].vals()) == 1 else cq.Compound.makeCompound(p["shape"].vals())) for p in mine]
    for i in range(len(vals)):
        for j in range(i + 1, len(vals)):
            a, b = vals[i][1], vals[j][1]
            ba, bb = a.BoundingBox(), b.BoundingBox()
            if ba.xmax < bb.xmin or bb.xmax < ba.xmin or ba.ymax < bb.ymin or bb.ymax < ba.ymin or ba.zmax < bb.zmin or bb.zmax < ba.zmin:
                continue
            try:
                v = a.intersect(b).Volume()
            except Exception:
                continue
            if v > 1:
                print("CHECK clash", vals[i][0], "x", vals[j][0], round(v))


CAP_IDS = ["capbar-1", "capbar1", "capskirt-1", "capskirt1", "capboard", "padboard", "cushion", "teenuts",
           "capscrR", "capscrL", "capscrT", "padscr", "pin-10", "pin-11", "pin10", "pin11"]


def motion():
    keys = [[0, 0], [0.2, 40], [0.4, 40], [0.6, 80], [0.8, 80], [1, 0]]
    return [{"part": i, "type": "slide", "axis": [0, 0, 1], "keys": keys} for i in CAP_IDS]


ASSEMBLY = [["Side rail L", "Side rail R"], ["Cross bar 1"], ["Box post 1"], ["Deck panel 1", "Deck panel 2"],
            ["Box side L", "Box side R", "Box front", "Box back"], ["Box top"], ["Band rail L", "Band rail R"],
            ["Cap board"], ["Back pad (2in foam + boucle)"], ["Height pin"], ["Hip bar (oak dowel)"]]

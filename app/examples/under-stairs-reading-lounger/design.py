import math
import cadquery as cq
from cadlib import fab
from cadlib.parts import part

SCENE = "floor"

# Under-stair space: X along the stair (tall end at -X), Y depth (stair wall at +Y, open side -Y), Z up
SPACE_L, SPACE_D, H_TALL, H_LOW = 1800, 800, 2100, 600
X0, YB = -SPACE_L / 2, SPACE_D / 2


def ceiling(x):
    return H_TALL - (H_TALL - H_LOW) * (x - X0) / SPACE_L


# Platform: 2020 frame on 100 mm legs, 6 mm plywood deck
FOOT = 3                                   # TPU foot cap floor thickness
LEG, PL_L, PL_W = 100, 1500, 660           # stock lengths: 100, 1500, 300 (cross rails)
PX0, PY0 = X0 + 300, YB - PL_W
RZ0 = FOOT + LEG                           # rail bottom
RZC = RZ0 + 10
T = fab.sheet_actual("plywood", 6)
SW = fab.slot_width("plywood", 6)
DECK = RZ0 + 20 + T                        # deck top
RAIL_Y = [PY0 + 10, PY0 + PL_W / 2, PY0 + PL_W - 10]
CROSS_XL = [0, 365, 740, 1115, 1480]       # cross rail start, local to PX0
LEG_XL = [0, 740, 1480]
PANEL_L, PANEL_W = PL_L / 4, PL_W / 2

# Bookcase / side table at the tall end
BX0, BX1, BY0, BY1, BH = X0, X0 + 300, YB - 400, YB, 600
SHELF_Z = [50, 320, 590]
BACK_Y = BY1 - 6 - T

# Bought floor lounger (60 x 125 x 20 cm flat), backrest raised 60 deg
LW, SEAT_L, BACK_L, CUSH = 600, 700, 550, 200
LY = PY0 + PL_W / 2
HINGE_X = PX0 + 280
BACK_DEG = 60


def box(x0, y0, z0, dx, dy, dz):
    return cq.Workplane("XY").box(dx, dy, dz, centered=False).translate((x0, y0, z0))


def soft(shape, r):
    try:
        return shape.edges().fillet(r)
    except Exception:
        return shape


def bar(name, shape, length):
    return {"name": name, "shape": shape, "process": "extrusion",
            "params": {"profile": "2020", "length_mm": length, "tapped_ends": 0}}


def ply(name, shape):
    return {"name": name, "shape": shape, "process": "laser", "color": "#d9b98c",
            "params": {"material": "plywood", "thickness_mm": 6}}


def frame():
    out = []
    for i, y in enumerate(RAIL_Y):
        out.append(bar(f"Long rail {i+1}", fab.extrusion(PL_L, axis="x", at=(PX0, y, RZC)), PL_L))
    n = 0
    for xl in CROSS_XL:
        for y0 in (RAIL_Y[0] + 10, RAIL_Y[1] + 10):
            n += 1
            out.append(bar(f"Cross rail {n}", fab.extrusion(300, axis="y", at=(PX0 + xl + 10, y0, RZC)), 300))
    n = 0
    for xl in LEG_XL:
        for y in RAIL_Y:
            n += 1
            out.append(bar(f"Leg {n}", fab.extrusion(LEG, axis="z", at=(PX0 + xl + 10, y, FOOT)), LEG))
    return out


def brackets():
    """2020 L brackets: cross rail to long rail, and leg to rail above."""
    rz_of = {(1, 1): 0, (-1, 1): 90, (-1, -1): 180, (1, -1): 270}
    joints = []
    for xl in CROSS_XL:
        xc = PX0 + xl + 10
        sx = -1 if xl == CROSS_XL[-1] else 1
        xf = xc + 10 * sx
        for yf, sy in ((RAIL_Y[0] + 10, 1), (RAIL_Y[1] - 10, -1), (RAIL_Y[1] + 10, 1), (RAIL_Y[2] - 10, -1)):
            joints.append(((xf + 3 * sx, yf + 3 * sy, RZC), (-90, 0, rz_of[(sx, sy)])))
    for xl in LEG_XL:
        xc = PX0 + xl + 10
        for y in RAIL_Y:
            if y != RAIL_Y[1]:        # outer legs: one under the long rail, one under the cross rail
                sx = -1 if xl == LEG_XL[-1] else 1
                joints.append(((xc + 13 * sx, y, RZ0 - 3), (180, 0, 0 if sx > 0 else 180)))
                sy = 1 if y == RAIL_Y[0] else -1
                joints.append(((xc, y + 13 * sy, RZ0 - 3), (180, 0, 90 if sy > 0 else 270)))
            else:                     # centre legs: one under each cross rail
                for sy in (1, -1):
                    joints.append(((xc, y + 13 * sy, RZ0 - 3), (180, 0, 90 if sy > 0 else 270)))
    out = []
    for rot in {j[1] for j in joints}:
        pts = [j[0] for j in joints if j[1] == rot]
        out.append((rot, pts))
    return [part("bracket_2020", at=pts, rot=rot) for rot, pts in out]


def deck():
    out, screws = [], []
    n = 0
    for row, (y0, edge_y) in enumerate(((PY0, PY0 + 10), (PY0 + PANEL_W, PY0 + PL_W - 10))):
        for c in range(4):
            x0 = PX0 + c * PANEL_L
            holes = [(x0 + d, edge_y) for d in (60, PANEL_L / 2, PANEL_L - 60)]
            ends = [-160, -10] if row == 0 else [160, 300]
            if c == 0:
                holes += [(PX0 + 10, y) for y in ends]
            if c == 3:
                holes += [(PX0 + PL_L - 10, y) for y in ends]
            p = box(x0, y0, DECK - T, PANEL_L, PANEL_W, T)
            p = p.edges("|Z").fillet(3)
            for hx, hy in holes:
                p = p.cut(cq.Workplane("XY").circle(2.75).extrude(T + 2).translate((hx, hy, DECK - T - 1)))
            n += 1
            out.append(ply(f"Deck panel {n}", p))
            screws += [(hx, hy, DECK) for hx, hy in holes]
    out.append(part("m5x12_bhcs", at=screws))
    return out


def foot_caps():
    out = []
    n = 0
    for xl in LEG_XL:
        for y in RAIL_Y:
            n += 1
            xc = PX0 + xl + 10
            cap = cq.Workplane("XY").box(26, 26, FOOT + 12, centered=(True, True, False))
            try:
                cap = cap.edges("|Z").fillet(4).faces("<Z").edges().fillet(1.5)
            except Exception:
                pass
            cap = cap.cut(cq.Workplane("XY").box(20.4, 20.4, 20, centered=(True, True, False)).translate((0, 0, FOOT)))
            out.append({"name": f"Foot cap {n}", "shape": cap.translate((xc, y, 0)), "color": "#3a3a3a",
                        "params": {"material": "TPU 95A"}})
    return out


def bookcase():
    tabs_y = [(60, 120), (260, 320)]
    tabs_z = [(120, 180), (420, 480)]
    side_slots = []
    for z in SHELF_Z:
        for a, b in tabs_y:
            side_slots.append((BY0 + a - 0.1, b - a + 0.2, z + T / 2 - SW / 2, SW))
    for a, b in tabs_z:
        side_slots.append((BACK_Y + T / 2 - SW / 2, SW, a - 0.1, b - a + 0.2))

    def side(x0, holes=()):
        s = box(x0, BY0, 0, T, BY1 - BY0, BH)
        try:
            s = s.edges("|X").edges(">Z").edges("<Y").fillet(40)
        except Exception:
            pass
        for y0, dy, z0, dz in side_slots:
            s = s.cut(box(x0 - 1, y0, z0, T + 2, dy, dz))
        for y, z in holes:
            s = s.cut(cq.Workplane("YZ").circle(2.75).extrude(T + 2).translate((x0 - 1, y, z)))
        return s

    inner = BX1 - BX0 - 2 * T
    out = [ply("Bookcase left side", side(BX0)),
           ply("Bookcase right side", side(BX1 - T, holes=[(BY0 + 150, RZC), (BY0 + 300, RZC)]))]
    for i, z in enumerate(SHELF_Z):
        s = box(BX0 + T, BY0, z, inner, BACK_Y - BY0, T)
        for a, b in tabs_y:
            s = s.union(box(BX0, BY0 + a, z, T, b - a, T)).union(box(BX1 - T, BY0 + a, z, T, b - a, T))
        out.append(ply(["Bookcase bottom", "Bookcase shelf", "Bookcase top"][i], s))
    back = box(BX0 + T, BACK_Y, 10, inner, T, SHELF_Z[-1] + T - 10)
    for a, b in tabs_z:
        back = back.union(box(BX0, BACK_Y, a, T, T, b - a)).union(box(BX1 - T, BACK_Y, a, T, T, b - a))
    out.append(ply("Bookcase back", back))
    # bookcase to platform: 2 x M5 through the right side into the end cross rail
    out.append(part("m5x12_bhcs", at=[(BX1 - T, BY0 + y, RZC) for y in (150, 300)], rot=(0, -90, 0)))
    return out


def seg(p0, p1, r):
    v = cq.Vector(*p1) - cq.Vector(*p0)
    return cq.Workplane("XY").add(cq.Solid.makeCylinder(r, v.Length, cq.Vector(*p0), v.normalized()))


def lamp():
    top = SHELF_Z[-1] + T
    bx, by = BX0 + 150, BY1 - 70
    base = cq.Workplane("XY").circle(32).extrude(14).translate((bx, by, top))
    pts = [(bx, by, top + 14), (bx, by, top + 200), (bx + 50, by - 30, top + 320),
           (bx + 150, by - 90, top + 380), (bx + 240, by - 150, top + 370)]
    neck = base
    for a, b in zip(pts, pts[1:]):
        neck = neck.union(seg(a, b, 5))
    head = seg((bx + 225, by - 140, top + 395), (bx + 255, by - 160, top + 345), 22)
    return [{"name": "Gooseneck reading lamp", "shape": neck, "group": "component", "color": "#222222"},
            {"name": "Lamp head", "shape": head, "group": "component", "color": "#2a2a2a",
             "fx": {"glow": {"color": "#ffc27a"}}}]


def lounger():
    seat = soft(box(HINGE_X, LY - LW / 2, DECK, SEAT_L, LW, CUSH), 40)
    back = soft(box(HINGE_X - BACK_L, LY - LW / 2, DECK, BACK_L, LW, CUSH - 20), 40)
    back = back.rotate((HINGE_X, 0, DECK), (HINGE_X, 1, DECK), BACK_DEG)
    foot = soft(box(HINGE_X + SEAT_L + 5, LY - 255, DECK, 510, 510, 150), 50)
    c = "#8a6f5a"
    return [{"name": "Floor lounger seat", "id": "seat", "shape": seat, "group": "component", "color": c},
            {"name": "Floor lounger backrest", "id": "backrest", "shape": back, "group": "component", "color": c},
            {"name": "Floor cushion", "shape": foot, "group": "component", "color": "#b8875f"}]


def stairs():
    s = None
    for y0 in (-YB, YB - 40):
        p = (cq.Workplane("XZ").polyline([(X0, H_TALL), (-X0, H_LOW), (-X0, H_LOW - 120), (X0, H_TALL - 120)])
             .close().extrude(-40).translate((0, y0, 0)))
        s = p if s is None else s.union(p)
    return {"name": "Staircase underside (yours)", "shape": s, "group": "component", "color": "#c9c2b8"}


def parts():
    return (frame() + brackets() + deck() + foot_caps() + bookcase() + lamp() + lounger() + [stairs()])


def motion():
    # the bought lounger's backrest: 60 deg lounge -> 85 deg upright reading -> back
    # (flat day-bed mode needs the lounger slid 270 mm toward the low end, clear of the bookcase)
    return [{"part": "backrest", "type": "rotate", "axis": [0, 1, 0], "pivot": [HINGE_X, 0, DECK],
             "keys": [[0, 0], [0.35, 25], [0.65, 25], [1, 0]]}]


ASSEMBLY = [["Foot cap 1"], ["Long rail 1", "Long rail 2", "Long rail 3"], ["Cross rail 1"], ["Leg 1"],
            ["Deck panel 1"], ["Bookcase left side", "Bookcase right side", "Bookcase bottom", "Bookcase shelf",
                               "Bookcase top", "Bookcase back"],
            ["Gooseneck reading lamp", "Lamp head"], ["Floor lounger seat", "Floor lounger backrest", "Floor cushion"]]

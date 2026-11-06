"""Wall key holder: laser-cut 6 mm birch plywood flat-pack, tab-and-slot, glued.
Back panel on the wall (y = 0), parts stick out towards -Y. Every part has tabs that
press into slots in the panel it meets."""
import cadquery as cq
from cadlib import fab

SCENE = "wall"

T = fab.sheet_actual("plywood", 6)         # real sheet, ~5.5 mm
SW = fab.slot_width("plywood", 6)          # press-fit slot
W = 266.0                                 # panel width
H = 195.0                                  # panel height
ENV_GAP = 246.0                            # pocket inner width (US #10 envelope is 241.3 mm)
POCKET_GAP = 28.0                          # pocket depth front to back
POCKET_Z = 80.0                            # pocket floor
POCKET_TOP = 145.0
SHELF_Z = 180.0                            # shelf underside
SHELF_D = 60.0
HOOK_X = (-96.0, -32.0, 32.0, 96.0)
GUSSET_X = 105.0
WALL_HOLES = [(-60.0, 160.0), (60.0, 160.0)]   # #8 screw holes (x, z)
LASER = {"material": "plywood", "thickness_mm": 6}
WOOD = "#c9a26b"


def box(x0, x1, y0, y1, z0, z1):
    return (cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0)
            .translate(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)))


def soft(shape, sel, r):
    try:
        return shape.edges(sel).fillet(r)
    except Exception:
        return shape                        # cosmetic only


def slot_x(xc, z0, z1, y0=-T, y1=0.0):
    """Slot for a tab of a YZ-plane part (thin in X) centred at xc."""
    return box(xc - SW / 2, xc + SW / 2, y0 - 0.01, y1 + 0.01, z0 - 0.1, z1 + 0.1)


# ---- tab layout (shared by parts and the slots they go into) ----
Y_FRONT_IN = -T - POCKET_GAP               # inner face of pocket front
Y_FRONT_OUT = Y_FRONT_IN - T
SIDE_X = ENV_GAP / 2 + T / 2               # pocket side centre
SHELF_TABS = (-90.0, 0.0, 90.0)            # x centres, 30 long
BOTTOM_TABS = (-60.0, 60.0)                # x centres, 40 long
LIP_TABS = (-80.0, 80.0)                   # x centres, 30 long
GUSSET_TOP = (-T - 38.0, -T - 18.0)        # y range of gusset top tab


def back_panel():
    p = box(-W / 2, W / 2, -T, 0, 0, H)
    p = soft(p, "|Y", 10)
    cuts = []
    for x in HOOK_X:
        cuts += [slot_x(x, 24, 34), slot_x(x, 46, 56)]
    for x in (-GUSSET_X, GUSSET_X):
        cuts.append(slot_x(x, 140, 162))
    for x in (-SIDE_X, SIDE_X):
        cuts.append(slot_x(x, 95, 125))
    for xc in SHELF_TABS:                  # shelf tabs, horizontal slots
        cuts.append(box(xc - 15.1, xc + 15.1, -T - 0.01, 0.01,
                        SHELF_Z + T / 2 - SW / 2, SHELF_Z + T / 2 + SW / 2))
    for xc in BOTTOM_TABS:
        cuts.append(box(xc - 20.1, xc + 20.1, -T - 0.01, 0.01,
                        POCKET_Z + T / 2 - SW / 2, POCKET_Z + T / 2 + SW / 2))
    for x, z in WALL_HOLES:
        cuts.append(cq.Workplane("XZ", origin=(x, 1, z)).circle(2.4).extrude(T + 2))
    for c in cuts:
        p = p.cut(c)
    return p


def hook(xc):
    x0, x1 = xc - T / 2, xc + T / 2
    h = box(x0, x1, -T - 8, -T, 18, 62)                    # stem glued to panel
    h = h.union(box(x0, x1, -T - 42, -T - 4, 22, 32))       # arm
    h = h.union(box(x0, x1, -T - 42, -T - 32, 22, 44))      # upturned tip
    h = soft(h, "|X", 2.0)
    h = h.union(box(x0, x1, -T - 0.5, 0, 24, 34)).union(box(x0, x1, -T - 0.5, 0, 46, 56))
    return h


def shelf():
    s = box(-W / 2, W / 2, -T - SHELF_D, -T, SHELF_Z, SHELF_Z + T)
    s = soft(s, "|Z and <Y", 8)
    for xc in SHELF_TABS:
        s = s.union(box(xc - 15, xc + 15, -T - 0.5, 0, SHELF_Z, SHELF_Z + T))
    for x in (-GUSSET_X, GUSSET_X):
        s = s.cut(box(x - SW / 2, x + SW / 2, GUSSET_TOP[0] - 0.1, GUSSET_TOP[1] + 0.1,
                      SHELF_Z - 0.01, SHELF_Z + T + 0.01))
    for xc in LIP_TABS:
        yc = -T - SHELF_D + 4 + T / 2                      # lip centre line
        s = s.cut(box(xc - 15.1, xc + 15.1, yc - SW / 2, yc + SW / 2,
                      SHELF_Z - 0.01, SHELF_Z + T + 0.01))
    return s


def lip():
    y0 = -T - SHELF_D + 4                                  # 4 mm in from the shelf edge
    l = box(-W / 2 + 8, W / 2 - 8, y0, y0 + T, SHELF_Z + T, SHELF_Z + T + 14)
    l = soft(l, "|Y", 4)
    for xc in LIP_TABS:
        l = l.union(box(xc - 15, xc + 15, y0, y0 + T, SHELF_Z, SHELF_Z + T + 0.5))
    return l


def gusset(xc):
    x0 = xc - T / 2
    pts = [(-T, SHELF_Z), (-T - 50, SHELF_Z), (-T, SHELF_Z - 50)]
    g = cq.Workplane("YZ", origin=(x0, 0, 0)).polyline(pts).close().extrude(T)
    g = g.union(box(x0, x0 + T, -T - 0.5, 0, 140, 162))
    g = g.union(box(x0, x0 + T, GUSSET_TOP[0], GUSSET_TOP[1], SHELF_Z - 0.5, SHELF_Z + T))
    return g


def pocket_front():
    f = box(-W / 2, W / 2, Y_FRONT_OUT, Y_FRONT_IN, POCKET_Z, POCKET_TOP)
    f = soft(f, "|Y", 6)
    for x in (-SIDE_X, SIDE_X):
        f = f.cut(slot_x(x, 95, 125, Y_FRONT_OUT, Y_FRONT_IN))
    for xc in BOTTOM_TABS:
        f = f.cut(box(xc - 20.1, xc + 20.1, Y_FRONT_OUT - 0.01, Y_FRONT_IN + 0.01,
                      POCKET_Z + T / 2 - SW / 2, POCKET_Z + T / 2 + SW / 2))
    return f


def pocket_side(xc):
    x0, x1 = xc - T / 2, xc + T / 2
    s = box(x0, x1, Y_FRONT_IN, -T, POCKET_Z, POCKET_TOP)
    s = s.union(box(x0, x1, -T - 0.5, 0, 95, 125))
    s = s.union(box(x0, x1, Y_FRONT_OUT, Y_FRONT_IN + 0.5, 95, 125))
    return s


def pocket_bottom():
    b = box(-ENV_GAP / 2, ENV_GAP / 2, Y_FRONT_IN, -T, POCKET_Z, POCKET_Z + T)
    for xc in BOTTOM_TABS:
        b = b.union(box(xc - 20, xc + 20, -T - 0.5, 0, POCKET_Z, POCKET_Z + T))
        b = b.union(box(xc - 20, xc + 20, Y_FRONT_OUT, Y_FRONT_IN + 0.5, POCKET_Z, POCKET_Z + T))
    return b


def ply(name, shape, explode):
    return {"name": name, "shape": shape, "group": "case", "process": "laser",
            "params": LASER, "material": "plywood", "color": WOOD, "explode": explode}


def parts():
    out = [ply("Back panel", back_panel(), [0, 1, 0]),
           ply("Shelf", shelf(), [0, -0.3, 1]),
           ply("Shelf lip", lip(), [0, -0.5, 1]),
           ply("Gusset L", gusset(-GUSSET_X), [-0.3, -1, 0]),
           ply("Gusset R", gusset(GUSSET_X), [0.3, -1, 0]),
           ply("Pocket bottom", pocket_bottom(), [0, -0.5, -0.3]),
           ply("Pocket side L", pocket_side(-SIDE_X), [-1, -0.3, 0]),
           ply("Pocket side R", pocket_side(SIDE_X), [1, -0.3, 0]),
           ply("Pocket front", pocket_front(), [0, -1, 0])]
    for i, x in enumerate(HOOK_X, 1):
        out.append(ply(f"Hook {i}", hook(x), [0, -1, -0.2]))
    return out


ASSEMBLY = [["Back panel"], ["Hook 1", "Hook 2", "Hook 3", "Hook 4"],
            ["Gusset L", "Gusset R"], ["Shelf"], ["Shelf lip"],
            ["Pocket bottom", "Pocket side L", "Pocket side R"], ["Pocket front"]]

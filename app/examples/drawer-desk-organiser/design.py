import cadquery as cq
from cadlib.dims import dim
from cadlib.refmodels import ref

SCENE = "desk"

# --- key sizes (mm) ---
CUP_R, CUP_H, CUP_WALL, CUP_X = 34, 92, 1.6, -47      # pen cup
HX0, HX1, HD, HH = -15, 90, 90, 40                     # drawer housing x-range, depth, height
WALL, DECK = 2, 2
CAV_X0, CAV_X1, CAV_Z0 = -12.6, 88, 1.6                   # drawer cavity
CLR = 0.3                                              # drawer slip clearance
SLOT = 13                                              # phone slot (fits phone in a case)
TILT = 15                                              # phone lean, deg
REST_H, REST_T = 68, 3

ph = dim("iphone_16")


def _fillet(wp, sel, r):
    try:
        return wp.edges(sel).fillet(r)
    except Exception:
        return wp


def body():
    cup = cq.Workplane().center(CUP_X, 0).circle(CUP_R).extrude(CUP_H)
    cup = _fillet(cup, ">Z", 1.2)
    hw = HX1 - HX0
    house = (cq.Workplane().box(hw, HD, HH, centered=(True, True, False))
             .translate(((HX0 + HX1) / 2, 0, 0)))
    house = _fillet(house, "|Z", 8)
    house = _fillet(house, ">Z", 2)
    b = cup.union(house)

    # phone stand on the deck: front lip + tilted back rest + two ribs
    ytop = HD / 2
    lip_y = -ytop + 5
    lip = cq.Workplane().box(HX1 - HX0 - 20, 4, 15, centered=False).translate((HX0 + 10, lip_y, HH - 1))
    lip = _fillet(lip, ">Z", 1.5)
    rest_y = lip_y + 4 + SLOT
    rest = (cq.Workplane().box(HX1 - HX0 - 20, REST_T, REST_H, centered=False)
            .translate((HX0 + 10, 0, 0)))
    rest = _fillet(rest, ">Z", 1.4)
    win = (cq.Workplane("XZ").center((HX0 + HX1) / 2, 40).slot2D(HX1 - HX0 - 44, 34)
           .extrude(-REST_T - 2).translate((0, -1, 0)))
    rest = rest.cut(win)
    rest = rest.rotate((0, 0, 0), (1, 0, 0), -TILT).translate((0, rest_y, HH))
    b = b.union(lip).union(rest)
    for x in (HX0 + 10, HX1 - 13):
        rib = (cq.Workplane("YZ").polyline([(rest_y + 2, HH - 1), (rest_y + 16, HH + 52),
                                            (rest_y + 34, HH - 1)]).close()
               .extrude(3).translate((x, 0, 0)))
        b = b.union(rib)

    # drawer cavity (open at the front) and cup bore
    cav = (cq.Workplane().box(CAV_X1 - CAV_X0, HD - WALL + 1, HH - DECK - CAV_Z0, centered=False)
           .translate((CAV_X0, -HD / 2 - 1, CAV_Z0)))
    bore = cq.Workplane().center(CUP_X, 0).circle(CUP_R - CUP_WALL).extrude(CUP_H).translate((0, 0, 2))
    return b.cut(cav).cut(bore)


def drawer():
    x0, x1 = CAV_X0 + CLR, CAV_X1 - CLR
    z0, z1 = CAV_Z0 + CLR, HH - DECK - CLR
    y1 = HD / 2 - WALL - CLR
    box = cq.Workplane().box(x1 - x0, y1 + HD / 2 + 1, z1 - z0, centered=False).translate((x0, -HD / 2 - 1, z0))
    inner = (cq.Workplane().box(x1 - x0 - 2.8, y1 + HD / 2 - 1.4, z1 - z0, centered=False)
             .translate((x0 + 1.4, -HD / 2, z0 + 1.4)))
    try:
        inner = inner.edges("|Z").fillet(4)
    except Exception:
        pass
    box = box.cut(inner)
    front = (cq.Workplane().box(CAV_X1 - CAV_X0 + 4, 3, HH - 2, centered=False)
             .translate((CAV_X0 - 2, -HD / 2 - 3, 1)))
    front = _fillet(front, "|Y", 3)
    d = box.union(front)
    pull = cq.Workplane("XZ").center((CAV_X0 + CAV_X1) / 2, HH - 1).circle(11).extrude(-20).translate((0, -HD / 2 - 5, 0))
    return d.cut(pull)


def parts():
    rest_y = -HD / 2 + 5 + 4 + SLOT
    return [
        {"name": "Organiser body", "shape": body(), "color": "#e8e4dc"},
        {"name": "Drawer", "id": "drawer", "shape": drawer(), "color": "#d9734a", "explode": [0, -1, 0]},
        ref("iphone_16", at=((HX0 + HX1) / 2, rest_y - 6.5, HH), rot=(-TILT, 0, 0)),
    ]


def motion():
    return [{"part": "drawer", "type": "slide", "axis": [0, -1, 0], "range": [0, 60]}]

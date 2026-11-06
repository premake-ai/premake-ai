import cadquery as cq
from cadlib.parts import part

# Desk-edge cable organizer: printed C-clamp + M5 thumb screw, snap-in cable comb on top.
# Prints on its side (YZ profile flat on the bed), no supports.
W = 80.0          # width along the desk edge (X)
T_SPINE = 5.0     # spine thickness
JAW_LO = 8.0      # lower jaw thickness (holds M5 nut)
GAP = 34.0        # clamp opening; screw adjusts for desks 12-32 mm thick
JAW_HI = 5.0      # upper jaw thickness
L_HI = 40.0       # upper jaw reach onto desk
L_LO = 30.0       # lower jaw reach under desk
COMB_H = 13.0     # cable comb height above upper jaw
COMB_L = 14.0     # comb depth (Y), at the desk edge
N_SLOTS = 5
SLOT_D = 7.0      # cable seat, fits 3-7 mm cables
SLOT_ENTRY = 4.2  # snap-in throat (PETG flexes, cable clicks in)
SCREW_Y = 17.0
DESK_T = 25.0     # reference desk

Z_TOP = JAW_LO + GAP              # desk top surface
Z_HI = Z_TOP + JAW_HI
PITCH = W / N_SLOTS
ZC = Z_HI + COMB_H - SLOT_D / 2 - 1.8   # cable centre height


def slot_x(i):
    return -W / 2 + PITCH * (i + 0.5)


def clamp():
    prof = (cq.Workplane("YZ").polyline([
        (-T_SPINE, 0), (L_LO, 0), (L_LO, JAW_LO), (0, JAW_LO), (0, Z_TOP),
        (L_HI, Z_TOP), (L_HI, Z_HI), (-T_SPINE, Z_HI)]).close()
        .extrude(W / 2, both=True))
    try:  # round the outer corners of the C
        prof = prof.edges("|X").edges(">Y or <Y").fillet(2.0)
    except Exception:
        pass
    comb = (cq.Workplane("XY").box(W, COMB_L, COMB_H + 1, centered=(True, False, False))
            .translate((0, -T_SPINE, Z_HI - 1)))
    try:
        comb = comb.edges("|Y").fillet(3.0)
    except Exception:
        pass
    body = prof.union(comb)
    for i in range(N_SLOTS):
        x = slot_x(i)
        seat = cq.Workplane("XZ").center(x, ZC).circle(SLOT_D / 2).extrude(40, both=True)
        throat = cq.Workplane("XY").box(SLOT_ENTRY, 80, 10).translate((x, 0, ZC + 5))
        body = body.cut(seat).cut(throat)
    # M5 clearance + hex nut trap from below in the lower jaw
    body = body.cut(cq.Workplane("XY").circle(2.75).extrude(JAW_LO + 1).translate((0, SCREW_Y, -0.5)))
    body = body.cut(cq.Workplane("XY").polygon(6, 8.0 / 0.866 + 0.3).extrude(4.5).translate((0, SCREW_Y, -0.01)))
    try:  # soften remaining outer edges
        body = body.edges("|Y").edges(">X or <X").fillet(1.5)
    except Exception:
        pass
    return body


def thumb_screw():
    # M5 x 30 knurled thumb screw, tip pushing up on the desk underside
    tip = Z_TOP - DESK_T
    shank = cq.Workplane("XY").circle(2.5).extrude(30).translate((0, SCREW_Y, tip - 30))
    head = cq.Workplane("XY").circle(8).extrude(5).translate((0, SCREW_Y, tip - 35))
    return shank.union(head)


def cables():
    out = None
    for i in (0, 2, 3):
        c = (cq.Workplane("XZ").center(slot_x(i), ZC).circle(2.5 if i else 3.2)
             .extrude(-170).translate((0, -40, 0)))
        out = c if out is None else out.union(c)
    return out


def parts():
    return [
        {"name": "Desk Clamp Organizer", "shape": clamp(), "group": "case", "color": "#2f3640"},
        {"name": "M5x30 thumb screw", "shape": thumb_screw(), "group": "component",
         "color": "#b0b4b8", "explode": [0, 0, -1]},
        {"name": "M5 hex nut", "group": "component", "color": "#9aa0a6",
         "shape": cq.Workplane("XY").polygon(6, 9.2).extrude(4).faces(">Z").workplane().hole(5)
            .translate((0, SCREW_Y, 0.2))},
        {"name": "Desk (reference)", "group": "component", "color": "#c8a27a",
         "shape": cq.Workplane("XY").box(200, 160, DESK_T, centered=(True, False, False))
            .translate((0, 0, Z_TOP - DESK_T))},
        {"name": "Cables (reference)", "shape": cables(), "group": "component", "color": "#1b1b1b"},
    ]

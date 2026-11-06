import cadquery as cq
from cadlib.parts import part

BAR_D = 31.8          # road bar clamp-area diameter (set 26.0 for older bars)
LINER = 1.0           # adhesive rubber liner in the bore
R_IN = BAR_D / 2 + LINER
R_OUT = R_IN + 4.5
BAR_Z = R_OUT         # bar centre height so the clamp sits on z=0
GAP = 0.75            # half the clamp split gap (takes up liner squeeze)
CX, CW = 45.0, 18.0   # clamp centre x (beside the stem) and width
EAR_Y = R_IN + 13     # clamp ear half-length
SCREW_Y = R_IN + 7.0
EAR_H = 9.0

PL_W, PL_Y0, PL_Y1, PL_T = 66.0, -80.0, 30.0, 4.0
PL_Z = BAR_Z + R_OUT + 4      # plate underside, clears the stem top
BAND_Y = (-62.0, 22.0)        # O-ring band positions
BAND_X = 39.5                 # band slot centre
LIP_H = 9.0
PHONE = (71.6, 147.6, 7.8)    # iPhone 15 reference (Apple spec)


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def bore(r):
    return (cq.Workplane("YZ").workplane(offset=CX - CW / 2 - 1).center(0, BAR_Z)
            .circle(r).extrude(CW + 2))


def screw_holes(z0, z1, d=4.5):
    s = None
    for sy in (-SCREW_Y, SCREW_Y):
        c = cq.Workplane("XY").circle(d / 2).extrude(z1 - z0).translate((CX, sy, z0))
        s = c if s is None else s.union(c)
    return s


def clamp_lower():
    ring = bore(R_OUT).union(box(CX - CW / 2, CX + CW / 2, -EAR_Y, EAR_Y, BAR_Z - EAR_H, BAR_Z))
    body = ring.intersect(box(CX - CW / 2, CX + CW / 2, -50, 50, -1, BAR_Z - GAP))
    try:
        body = body.edges("|X").fillet(2.5)
    except Exception:
        pass
    body = body.cut(bore(R_IN)).cut(screw_holes(-1, BAR_Z))
    cb = screw_holes(-1, BAR_Z - EAR_H + 4.0, d=7.6)   # M4 head counterbores
    return body.cut(cb)


def cradle():
    # clamp head: solid block tapering 45 deg into the plate (no overhangs printing plate-down)
    z0, z1 = BAR_Z + GAP, PL_Z + 1
    pts = [(-EAR_Y, z0), (EAR_Y, z0), (EAR_Y, BAR_Z + 10),
           (EAR_Y - (z1 - BAR_Z - 10), z1), (-(EAR_Y - (z1 - BAR_Z - 10)), z1), (-EAR_Y, BAR_Z + 10)]
    head = cq.Workplane("YZ").workplane(offset=CX - CW / 2).polyline(pts).close().extrude(CW)
    try:
        head = head.edges("|Y").fillet(2.0)
    except Exception:
        pass
    head = head.cut(bore(R_IN)).cut(screw_holes(BAR_Z, BAR_Z + 12))
    for sy in (-SCREW_Y, SCREW_Y):    # side-loaded M4 nut slots, open to +X
        head = head.cut(box(CX - 3.7, CX + CW, sy - 3.6, sy + 3.6, BAR_Z + 5.0, BAR_Z + 8.4))

    # phone plate with band ears, rounded outline
    plate = cq.Workplane("XY").center(0, (PL_Y0 + PL_Y1) / 2).rect(PL_W, PL_Y1 - PL_Y0).extrude(PL_T)
    for by in BAND_Y:
        plate = plate.union(cq.Workplane("XY").center(0, by).rect(2 * (BAND_X + 6.5), 14).extrude(PL_T))
    plate = plate.union(box(PL_W / 2 - 4, CX + CW / 2, -12, 12, 0, PL_T))   # tongue to the clamp head
    try:
        plate = plate.edges("|Z").fillet(3.0)
    except Exception:
        pass
    for by in BAND_Y:
        for sx in (-BAND_X, BAND_X):
            plate = plate.cut(cq.Workplane("XY").center(sx, by).slot2D(9, 4.6, 90).extrude(PL_T + 2).translate((0, 0, -1)))
    plate = plate.cut(cq.Workplane("XY").center(0, -25).slot2D(60, 22, 90).extrude(PL_T + 2).translate((0, 0, -1)))
    plate = plate.translate((0, 0, PL_Z))

    # front lip: braking pushes the phone into it
    lip = box(-28, 28, PL_Y0 - 3.5, PL_Y0 + 1, PL_Z, PL_Z + PL_T + LIP_H)
    try:
        lip = lip.edges("|Y").fillet(3.0)
    except Exception:
        pass
    body = head.union(plate).union(lip)
    try:
        body = body.faces(">Z").edges().fillet(1.0)
    except Exception:
        pass
    return body


def band(by):
    zt = PL_Z + PL_T + PHONE[2]
    outer = box(-BAND_X - 1.75, BAND_X + 1.75, by - 1.75, by + 1.75, PL_Z - 3.5, zt + 3.5)
    inner = box(-BAND_X + 1.75, BAND_X - 1.75, by - 2, by + 2, PL_Z, zt)
    return outer.cut(inner)


def parts():
    nz = BAR_Z + 5.1
    hz = BAR_Z - EAR_H + 4.0
    pts_s = [(CX, -SCREW_Y, hz), (CX, SCREW_Y, hz)]
    pts_n = [(CX, -SCREW_Y, nz), (CX, SCREW_Y, nz)]
    liner = bore(BAR_D / 2 + LINER).cut(bore(BAR_D / 2)).intersect(box(CX - CW / 2, CX + CW / 2, -50, 50, 0, 100))
    bar = cq.Workplane("YZ").workplane(offset=-120).center(0, BAR_Z).circle(BAR_D / 2).extrude(240)
    stem = box(-21, 21, -22, 90, BAR_Z - 20, BAR_Z + 20)
    try:
        stem = stem.edges("|Y").fillet(6)
    except Exception:
        pass
    phone = box(-PHONE[0] / 2, PHONE[0] / 2, PL_Y0, PL_Y0 + PHONE[1], PL_Z + PL_T, PL_Z + PL_T + PHONE[2])
    try:
        phone = phone.edges("|Z").fillet(9)
    except Exception:
        pass
    return [
        {"name": "Cradle", "shape": cradle(), "group": "case", "color": "#2b2f36"},
        {"name": "Clamp lower", "shape": clamp_lower(), "group": "case", "color": "#2b2f36", "explode": [0, 0, -1]},
        part("m4x16_shcs", at=pts_s, rot=(180, 0, 0)),
        part("m4_nut", at=pts_n),
        {"name": "Rubber band front", "shape": band(BAND_Y[0]), "group": "component", "color": "#e4572e", "explode": [0, 0, 1]},
        {"name": "Rubber band rear", "shape": band(BAND_Y[1]), "group": "component", "color": "#e4572e", "explode": [0, 0, 1]},
        {"name": "Bar liner", "shape": liner, "group": "component", "color": "#111111"},
        {"name": "Handlebar (ref)", "shape": bar, "group": "component", "color": "#9aa0a6"},
        {"name": "Stem (ref)", "shape": stem, "group": "component", "color": "#55595f"},
        {"name": "Phone (ref)", "shape": phone, "group": "component", "color": "#1a1a1a", "explode": [0, 0, 1]},
    ]

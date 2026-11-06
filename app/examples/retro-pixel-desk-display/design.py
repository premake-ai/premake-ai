import cadquery as cq
from cadlib import fab
from cadlib.parts import part

SCENE = "desk"
ASSEMBLY = [["Case", "M3 heat-set insert ×4"], ["Smoked front"], ["LED matrix 64x32 P2.5", "MatrixPortal S3"],
            ["Foam pad"], ["M3×10 brass standoff ×4", "Back cover"], ["M3×8 button head screw ×8"], ["Rubber foot"]]

# Waveshare RGB-Matrix-P2.5-64x32: 160 x 80 (wiki), ~15 thick (Seengreat equivalent)
PW, PH, PT = 160.0, 80.0, 15.0
WALL = 2.4
W, H, D = 186.0, 106.0, 38.0       # outer case
RO = 14.0                            # outer corner radius (front view)
FOOT = 3.0                           # rubber feet lift the case
ZB = FOOT                            # case bottom
ZC = ZB + H / 2                      # case / panel centre height
LIP = 2.5                            # front bezel thickness
WIN_W, WIN_H = 159.0, 79.0           # window onto the LEDs
TA = fab.sheet_actual("acrylic", 3)  # smoked acrylic real thickness
COVER_T = 3.0
CL = 0.3

Y0 = -D / 2                          # front face
Y_ACR = Y0 + LIP                     # acrylic front
Y_PAN = Y_ACR + TA                   # panel front
Y_PB = Y_PAN + PT                    # panel back
Y_CV = D / 2 - COVER_T               # back cover inner face

# corner bosses: hold inserts and locate the panel corners
BX, BZ, BR = PW / 2 + 4, PH / 2 + 4, 6.5
BOSSES = [(sx * BX, ZC + sz * BZ) for sx in (-1, 1) for sz in (-1, 1)]
PUSH = [(sx * 60, ZC + sz * 28) for sx in (-1, 1) for sz in (-1, 1)]
FOAM = Y_CV - Y_PB - 10.0           # 5 mm EVA pad between panel and M3x10 standoff


def rrect(w, h, r, y0, depth):
    """Rounded rectangle in XZ, centred at (0, ZC), from y0 to y0+depth."""
    return (cq.Workplane("XZ", origin=(0, y0 + depth, ZC)).rect(w, h)
            .extrude(depth).edges("|Y").fillet(r))


def inner_outline(off=0.0):
    return W - 2 * WALL - 2 * off, H - 2 * WALL - 2 * off, RO - WALL - off


def case():
    body = rrect(W, H, RO, Y0, D)
    try:
        body = body.faces("<Y").edges().fillet(2.5)
    except Exception:
        pass
    iw, ih, ir = inner_outline()
    body = body.cut(rrect(iw, ih, ir, Y_ACR, D))
    body = body.cut(rrect(WIN_W, WIN_H, 2.0, Y0 - 1, LIP + 2))
    for x, z in BOSSES:
        b = (cq.Workplane("XZ", origin=(x, Y_CV, z)).circle(BR).extrude(Y_CV - Y_ACR - TA - 0.3))
        body = body.union(b)
    # panel pocket through the bosses, then insert holes
    body = body.cut(cq.Workplane("XY").box(PW + 2 * CL, D, PH + 2 * CL).translate((0, Y_PAN + D / 2, ZC)))
    for x, z in BOSSES:
        body = body.cut(cq.Workplane("XZ", origin=(x, Y_CV + 1, z)).circle(2.0).extrude(7))
    return body


def acrylic():
    iw, ih, ir = inner_outline(CL)
    a = rrect(iw, ih, ir, Y_ACR, TA)
    for x, z in BOSSES:
        a = a.cut(cq.Workplane("XZ", origin=(x, Y_ACR + TA + 1, z)).circle(BR + CL).extrude(TA + 2))
    return a


def cover():
    """Flat laser-cut plywood back: screw holes, standoff holes, vents, cable notch."""
    iw, ih, ir = inner_outline(CL)
    c = rrect(iw, ih, ir, Y_CV, COVER_T)
    holes = [(x, z, 3.4) for x, z in BOSSES + PUSH]
    zb = ZB + WALL + CL
    holes += [(x, zb + 16, 3.0) for x in (-5, 5)]          # zip tie strain relief
    for x, z, d in holes:
        c = c.cut(cq.Workplane("XZ", origin=(x, D, z)).circle(d / 2).extrude(D))
    for z in (ZC + 36, ZC + 30, ZC - 30, ZC - 36):
        c = c.cut(cq.Workplane("XY").box(100, 20, 3).edges("|Y").fillet(1.4).translate((0, D / 2, z)))
    c = c.cut(cq.Workplane("XY").box(6, 20, 20).edges("|Y").fillet(2.9).translate((0, D / 2, zb)))
    return c


def parts():
    panel = cq.Workplane("XY").box(PW, PT, PH).translate((0, Y_PAN + PT / 2, ZC))
    portal = cq.Workplane("XY").box(64.8, 10, 50.8).translate((0, Y_PB + 5, ZC))
    foam = [cq.Workplane("XZ", origin=(x, Y_PB + FOAM, z)).rect(12, 12).extrude(FOAM) for x, z in PUSH]
    foam_s = foam[0]
    for f in foam[1:]:
        foam_s = foam_s.union(f)
    feet = None
    for sx in (-1, 1):
        for sy in (-1, 1):
            f = cq.Workplane("XY").circle(5).extrude(FOOT).translate((sx * 72, sy * 11, 0))
            feet = f if feet is None else feet.union(f)
    return [
        {"name": "Case", "shape": case(), "group": "case", "color": "#e9dfc7",
         "material": "pla", "explode": [0, 0, 0]},
        {"name": "Smoked front", "shape": acrylic(), "group": "case", "process": "laser",
         "params": {"material": "acrylic", "thickness_mm": 3}, "material": "acrylic_clear",
         "color": "#3a3a3a", "explode": [0, -1, 0]},
        {"name": "LED matrix 64x32 P2.5", "shape": panel, "group": "component", "color": "#111111",
         "fx": {"screen": {"text": "10:42\n72F SUNNY", "fg": "#ff9a1f", "bg": "#000000", "face": "-y"}},
         "explode": [0, 0.4, 0]},
        {"name": "MatrixPortal S3", "shape": portal, "group": "component", "color": "#1d1d1d",
         "cable": {"type": "usb-c", "at": [0, D / 2, ZB + WALL + 6], "dir": [0, 1, 0], "length_mm": 400},
         "explode": [0, 0.8, 0]},
        {"name": "Foam pad", "shape": foam_s, "group": "component", "color": "#222222",
         "explode": [0, 1, 0]},
        {"name": "Back cover", "shape": cover(), "group": "case", "process": "laser",
         "params": {"material": "plywood", "thickness_mm": 3}, "material": "plywood",
         "explode": [0, 1, 0]},
        part("m3x10_standoff", at=[(x, Y_CV, z) for x, z in PUSH], rot=(90, 0, 0)),
        part("m3_insert", at=[(x, Y_CV, z) for x, z in BOSSES], rot=(90, 0, 0)),
        part("m3x8_bhcs", at=[(x, D / 2, z) for x, z in BOSSES + PUSH], rot=(-90, 0, 0)),
        {"name": "Rubber foot", "shape": feet, "group": "component", "color": "#2a2a2a",
         "material": "rubber", "explode": [0, 0, -1]},
    ]

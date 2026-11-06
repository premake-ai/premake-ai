import math
import cadquery as cq

# Mechanical latte-art duster, modelled in USE pose: lens (rim ring) down on the cup.
# Press the shutter button -> 45 deg wedge shoves the sieve basket 6 mm sideways,
# release -> spring snaps it back against the bore wall: one shake + knock per press.

SCENE = "counter"
CABLES = False
Z0 = 1.2          # lens cap floor under everything

GOLD, CREAM, DARK = "#c9a24a", "#f1ece1", "#2b2b2b"

# body
BW, BD, BZ0, BZ1 = 106, 72, 15.5, 62      # camera body box (x, y, z range)
LENS_D = 98                                # lens base disc under the body
WALL = 1.8
# hopper / sieve
BORE_LO, BORE_HI, STEP_Z = 64, 68, 42      # basket bore, funnel bore, funnel seat
LEDGE_D = 50                               # basket rests on this ledge
BASKET_OD, BASKET_ID = 56, 52
SHAKE = 6.0                                # basket travel per press (mm)
REST_X = (BORE_LO - BASKET_OD) / 2         # basket rests against +X wall
# stencil card (stainless, laser cut)
CARD_W, CARD_L, CARD_T = 60, 88, 0.8
CARD_Y1 = 30.3                             # back stop of the card pocket
SLOT_Z0, SLOT_Z1 = 11.0, 12.6
# shutter plunger
PX = 45.0
STROKE = 6.0
CB_FLOOR = BZ1 - 12                        # button counterbore floor (spring seat)
# rim ring
RING_OD = 102


def cyl(d, h, x=0, y=0, z=0):
    return cq.Workplane("XY").circle(d / 2).extrude(h).translate((x, y, z))


def tube(od, idd, h, x=0, y=0, z=0):
    return cyl(od, h, x, y, z).cut(cyl(idd, h, x, y, z))


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def revolve(pts):
    """Solid of revolution about Z from (r, z) points."""
    return cq.Workplane("XZ").polyline(pts).close().revolve(360, (0, 0, 0), (0, 1, 0))


def xz_prism(pts, half_w):
    return cq.Workplane("XZ").polyline(pts).close().extrude(half_w, both=True)


def wedge_line(x):
    """45 deg contact plane between plunger tip and basket tab (rest pose)."""
    return 38.0 - (x - (PX - 4))


# ---------------------------------------------------------------- body
def camera_body():
    outer = box(-BW / 2, BW / 2, -BD / 2, BD / 2, BZ0, BZ1)
    try:
        outer = outer.edges("|Z").fillet(10).edges(">Z").fillet(4)
    except Exception:
        pass
    inner = box(-BW / 2 + WALL, BW / 2 - WALL, -BD / 2 + WALL, BD / 2 - WALL, BZ0 + WALL, BZ1 - WALL)
    body = outer.cut(inner)
    # lens base disc (holds card pocket and basket ledge)
    body = body.union(cyl(LENS_D, BZ0 + 1 - SLOT_Z0, z=SLOT_Z0))
    # hopper tube, plunger tube, web between them, spring boss, ribs
    body = body.union(cyl(BORE_HI + 4, BZ1 - BZ0 - 1, z=BZ0 + 0.5))
    body = body.union(cyl(15, BZ1 - 20.5, PX, 0, 20))
    body = body.union(box(34, 40, -7, 7, 20, BZ1 - 0.5))
    body = body.union(box(-42, -33, -6, 6, 21, 35))
    # viewfinder hump on top
    hump = box(-50, -38.5, -14, 14, BZ1 - 1, BZ1 + 6)
    try:
        hump = hump.edges("|Y").fillet(3)
    except Exception:
        pass
    body = body.union(hump)
    # spare-stencil holder rails on the back (+Y): cards drop in from the top
    for s in (-1, 1):
        body = body.union(box(min(s * 44.4, s * 47.5), max(s * 44.4, s * 47.5), BD / 2 - 1, BD / 2 + 3, BZ0, BZ1 - 6))
        body = body.union(box(min(s * 41, s * 47.5), max(s * 41, s * 47.5), BD / 2 + 3, BD / 2 + 5, BZ0, BZ1 - 6))
    body = body.union(box(-47.5, 47.5, BD / 2 - 1, BD / 2 + 3, BZ0, BZ0 + 3.5))
    body = body.union(box(-47.5, 47.5, BD / 2 + 3, BD / 2 + 5, BZ0, BZ0 + 7))

    # hopper bores + funnel seat step
    body = body.cut(cyl(LEDGE_D, BZ0 + 1 - SLOT_Z0 + 1, z=SLOT_Z0 - 0.5))
    body = body.cut(cyl(BORE_LO, STEP_Z - BZ0, z=BZ0))
    body = body.cut(cyl(BORE_HI, BZ1 - STEP_Z + 8, z=STEP_Z))
    # stencil card pocket in the base, open at the front
    body = body.cut(box(-(CARD_W + 0.6) / 2, (CARD_W + 0.6) / 2, -60, CARD_Y1, SLOT_Z0 - 0.5, SLOT_Z1))
    # plunger channel, floor hole, button counterbore, window to the basket tab
    body = body.cut(cyl(11, CB_FLOOR - 2 - 22, PX, 0, 22))
    body = body.cut(cyl(8.8, 3, PX, 0, CB_FLOOR - 2.5))
    body = body.cut(cyl(16.6, 20, PX, 0, CB_FLOOR))
    # lighten the lens base outside the card path (open recess, ring covers it)
    body = body.cut(tube(94, 66, 4.5, z=SLOT_Z0 - 0.5))
    body = body.cut(box(28, 52, -5, 5, 22, 40))
    # return-spring pocket at -X
    body = body.cut(cq.Workplane("YZ").circle(3.5).extrude(9).translate((-41, 0, 28)))
    # engraved faux lens rings on the front face
    for d, dd in ((40, 36), (28, 25)):
        ring = cq.Workplane("XZ").circle(d / 2).circle(dd / 2).extrude(-1.0).translate((14, -BD / 2 - 0.01, 41))
        body = body.cut(ring)
    return body


# ---------------------------------------------------------------- loose parts
def rim_ring():
    # cone centres cup rims 62-94 mm; collar slips over the lens base
    r = revolve([(49.4, 0), (RING_OD / 2, 5), (RING_OD / 2, SLOT_Z0), (LEDGE_D / 2 + 1, SLOT_Z0),
                 (LEDGE_D / 2 + 1, 9), (30, 9), (48, 0)])
    collar = tube(RING_OD, LENS_D + 0.3, BZ0 - 0.1 - SLOT_Z0, z=SLOT_Z0)
    collar = collar.cut(box(-34, 34, -60, -30, SLOT_Z0, BZ0 + 2))  # card entry notch
    return r.union(collar)


def sieve_basket():
    b = tube(BASKET_OD, BASKET_ID, 40 - (BZ0 + 2), z=BZ0 + 2)
    b = b.union(tube(BASKET_OD, LEDGE_D - 2, 2, z=BZ0))
    # tab with 45 deg ramp that the plunger tip pushes (rest pose coordinates)
    x0, x1 = BASKET_OD / 2 - 2 + REST_X, PX + 4
    tab = box(x0 - REST_X, x1 - REST_X, -4, 4, 26, 38)
    ramp = xz_prism([(PX - 4 - REST_X, wedge_line(PX - 4)), (x1 + 2 - REST_X, wedge_line(x1 + 2)),
                     (x1 + 2 - REST_X, 45), (PX - 4 - REST_X, 45)], 5)
    b = b.union(tab.cut(ramp))
    return b.translate((REST_X, 0, 0))


def clamp_ring():
    return tube(BASKET_ID + 0.15, LEDGE_D - 3, 2.5, REST_X, 0, BZ0 + 2.3)


def mesh_disc():
    return cyl(BASKET_ID - 0.2, 0.3, REST_X, 0, BZ0 + 2)


def funnel():
    # 45 deg cone, 1.8 mm skin, sleeve drops into the basket
    ro, rs = BORE_HI / 2 - 0.3, BORE_LO / 2          # rim sits on the bore step
    top = STEP_Z + 13
    return revolve([(ro, STEP_Z), (ro, top), (ro - 1.8, top), (20.6, top - (ro - 1.8 - 20.6)),
                    (20.6, 34), (22.3, 34), (22.3, top - (ro - 1.8 - 20.6) - 0.85),
                    (rs, top - (ro - 1.8 - 20.6) - 0.85 + (rs - 22.3)), (rs, STEP_Z)])


def hopper_lid():
    lid = cyl(72, 2.0, z=BZ1).union(tube(BORE_HI - 0.4, BORE_HI - 3.0, 4, z=BZ1 - 4))
    lid = lid.union(box(-14, 14, -2, 2, BZ1 + 2.0, BZ1 + 7))
    try:
        lid = lid.faces(">Z").edges().fillet(1.2)
    except Exception:
        pass
    return lid


def plunger():
    hz = BZ1 - 2  # head bottom: 4 mm proud of the top at rest
    head = cyl(16, 6, PX, 0, hz)
    try:
        head = head.faces(">Z").edges().fillet(1.5)
    except Exception:
        pass
    stem = cyl(8, hz - 20, PX, 0, 20.5)
    stem = stem.cut(xz_prism([(PX - 6, wedge_line(PX - 6)), (PX + 6, wedge_line(PX + 6)),
                              (PX + 6, 10), (PX - 6, 10)], 6))
    # split snap collar: squeeze, push through the floor hole; it stops the button's upstroke
    collar = cyl(10.4, 2, PX, 0, CB_FLOOR - 4)
    return head.union(stem).union(collar)


def lens_cap():
    # bought silicone stretch lid (fits 66-106 mm rims) pulled over the rim ring
    return cyl(RING_OD + 3, 6.2, z=-Z0).cut(cyl(RING_OD, 6, z=0))


# ---------------------------------------------------------------- stencils
def _star(R, r):
    pts = []
    for i in range(10):
        a = math.radians(90 + i * 36)
        rr = R if i % 2 == 0 else r
        pts.append((rr * math.cos(a), rr * math.sin(a)))
    return cq.Workplane("XY").polyline(pts).close()


def stencil(design):
    """Card in its own frame: XY, thickness +Z, pattern centred on the bore at (0, 0)."""
    card = box(-CARD_W / 2, CARD_W / 2, CARD_Y1 - CARD_L, CARD_Y1, 0, CARD_T)
    try:
        card = card.edges("|Z").fillet(3)
    except Exception:
        pass
    h = 5
    if design == "heart":
        s = 20
        sq = cq.Workplane("XY").rect(s, s).extrude(h).rotate((0, 0, 0), (0, 0, 1), 45).translate((0, -3, -1))
        o = s / (2 * math.sqrt(2))
        cut = sq.union(cyl(s, h, -o, -3 + o, -1)).union(cyl(s, h, o, -3 + o, -1))
    elif design == "star":
        cut = _star(20, 8.5).extrude(h).translate((0, 0, -1))
    elif design == "smile":
        mouth = tube(27, 20, h, z=-1).cut(box(-20, 20, -2, 20, -2, 6))
        cut = cyl(7, h, -7, 6, -1).union(cyl(7, h, 7, 6, -1)).union(mouth)
    else:  # snowflake
        cut = None
        for a in (0, 60, 120):
            sl = cq.Workplane("XY").rect(38, 2.6).extrude(h).rotate((0, 0, 0), (0, 0, 1), a).translate((0, 0, -1))
            cut = sl if cut is None else cut.union(sl)
        for a in range(0, 360, 60):
            r = math.radians(a)
            cut = cut.union(cyl(4, h, 13 * math.cos(r), 13 * math.sin(r), -1))
    card = card.cut(cut)
    # finger grip hole on the tab that sticks out of the slot
    return card.cut(cyl(6, h, 0, CARD_Y1 - CARD_L + 5.5, -1))


def stencil_on_back(design, i):
    c = stencil(design).rotate((0, 0, 0), (0, 0, 1), 90).rotate((0, 0, 0), (1, 0, 0), 90)
    bb = c.val().BoundingBox()
    # stand on the bottom rail, slid between the side rails, stacked outwards
    return c.translate((-(bb.xmin + bb.xmax) / 2, BD / 2 + 0.1 + i * 1.0 - bb.ymin, BZ0 + 3.6 - bb.zmin))


# ---------------------------------------------------------------- parts
def parts():
    steel = {"process": "sheet", "params": {"material": "stainless 304", "thickness_mm": CARD_T, "bends": 0},
             "material": "steel", "group": "case"}
    out = [
        {"name": "Camera body", "shape": camera_body(), "group": "case", "color": CREAM},
        {"name": "Cup rim ring", "shape": rim_ring(), "group": "case", "color": GOLD, "explode": [0, 0, -1]},
        {"name": "Silicone lens cap (stretch lid)", "shape": lens_cap(), "group": "component", "color": DARK,
         "material": "silicone", "explode": [0, 0, -1]},
        {"id": "basket", "name": "Sieve basket", "shape": sieve_basket(), "group": "case", "color": CREAM,
         "explode": [0, 0, -1]},
        {"id": "clamp", "name": "Mesh clamp ring", "shape": clamp_ring(), "group": "case", "color": CREAM,
         "explode": [0, 0, -1]},
        {"id": "mesh", "name": "Stainless sieve mesh (40 mesh)", "shape": mesh_disc(), "group": "component",
         "color": "#b8b8b8", "material": "steel", "explode": [0, 0, -1]},
        {"name": "Hopper funnel", "shape": funnel(), "group": "case", "color": CREAM, "explode": [0, 0, 1]},
        {"name": "Hopper lid", "shape": hopper_lid(), "group": "case", "color": GOLD, "explode": [0, 0, 1]},
        {"id": "plunger", "name": "Shutter button", "shape": plunger(), "group": "case", "color": GOLD,
         "explode": [0, 0, 1]},
        {"id": "spring_bsk", "name": "Sieve return spring", "group": "component", "color": "#9a9a9a",
         "shape": cq.Workplane("YZ").circle(3).circle(2.2).extrude(41 - (BASKET_OD / 2 - REST_X) - 0.1)
                    .translate((-41, 0, 28)), "explode": [-1, 0, 0]},
        {"id": "spring_btn", "name": "Button spring", "group": "component", "color": "#9a9a9a",
         "shape": tube(11, 9, 10, PX, 0, CB_FLOOR), "explode": [0, 0, 1]},
        dict(steel, name="Stencil: heart", shape=stencil("heart").translate((0, 0, SLOT_Z0 + 0.1)),
             explode=[0, -1, 0]),
        dict(steel, name="Stencil: star", shape=stencil_on_back("star", 0), explode=[0, 1, 0]),
        dict(steel, name="Stencil: smile", shape=stencil_on_back("smile", 1), explode=[0, 1, 0]),
        dict(steel, name="Stencil: snowflake", shape=stencil_on_back("snowflake", 2), explode=[0, 1, 0]),
    ]
    for p in out:
        p["shape"] = p["shape"].translate((0, 0, Z0))
    return out


ASSEMBLY = [["Camera body"], ["Stainless sieve mesh (40 mesh)", "Mesh clamp ring", "Sieve basket",
            "Sieve return spring"], ["Shutter button", "Button spring"], ["Hopper funnel", "Hopper lid"],
            ["Cup rim ring", "Stencil: heart"], ["Stencil: star", "Stencil: smile", "Stencil: snowflake"],
            ["Silicone lens cap (stretch lid)"]]


def motion():
    keys = [[0, 0], [0.08, 1], [0.16, 0], [0.30, 1], [0.38, 0], [0.52, 1], [0.60, 0], [1, 0]]
    kp = [[t, v * STROKE] for t, v in keys]
    kb = [[t, v * SHAKE] for t, v in keys]
    return [
        {"part": "plunger", "type": "slide", "axis": [0, 0, -1], "keys": kp},
        {"part": "basket", "type": "slide", "axis": [-1, 0, 0], "keys": kb},
        {"part": "clamp", "type": "slide", "axis": [-1, 0, 0], "keys": kb},
        {"part": "mesh", "type": "slide", "axis": [-1, 0, 0], "keys": kb},
    ]

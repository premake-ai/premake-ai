import cadquery as cq

# Phone clamp for a 1/4-20 tripod screw. The phone sits in landscape between a
# fixed lower jaw and a sliding upper jaw, locked by an M5 thumb screw.
W = 75.0          # phone width being clamped (works 50-97 mm)
SEAT = 16.0       # top of base = lower jaw seat
BAR_W, BAR_D, BAR_H = 24.0, 8.0, 100.0
BAR_Y0 = 2.8      # bar front face (phone back rests on y=0)
CL = 0.3          # slip clearance
WALL = 2.5
SLV_H = 50.0
JAW_W = 30.0      # narrow jaws grip mid-edge, clear of side buttons
LIP_Y = -17.0     # front lip: takes phones + case up to 14 mm thick
GROOVE_Z = (30.0, 97.0)
NUT_AF, NUT_T = 11.11 + 0.3, 5.56 + 0.3     # 1/4-20 hex nut (ASME B18.2.2) + clearance
TRIPOD_Y = -1.5
M5_AF, M5_T = 8.0 + 0.3, 4.0 + 0.3


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def fillet(wp, sel, r):
    try:
        return wp.edges(sel).fillet(r)
    except Exception:
        return wp


def hex_prism(af, h, plane="XY"):
    return cq.Workplane(plane).polygon(6, af / 0.8660254).extrude(h)


def body():
    b = box(-25, 25, LIP_Y, 14, 0, SEAT)
    b = fillet(b, "|Z", 6)
    b = fillet(b, ">Z or <Z", 1.5)
    bar = fillet(box(-BAR_W / 2, BAR_W / 2, BAR_Y0, BAR_Y0 + BAR_D, SEAT - 1, BAR_H), "|Z", 2)
    bar = fillet(bar, ">Z", 1.5)
    b = b.union(bar)
    lip = fillet(box(-JAW_W / 2, JAW_W / 2, LIP_Y, LIP_Y + 3, SEAT - 1, SEAT + 5), ">Z", 1.4)
    b = b.union(lip)
    # travel groove for the thumb screw tip (closed both ends = end stops)
    b = b.cut(box(-3.5, 3.5, BAR_Y0 + BAR_D - 1.5, BAR_Y0 + BAR_D + 1, *GROOVE_Z))
    # landscape socket: 1/4-20 nut, slid in from the back, 2 mm floor
    b = b.cut(cq.Workplane("XY").circle(3.4).extrude(14).translate((0, TRIPOD_Y, -1)))
    nut = hex_prism(NUT_AF, NUT_T).rotate((0, 0, 0), (0, 0, 1), 30).translate((0, TRIPOD_Y, 2))
    b = b.cut(nut).cut(box(-NUT_AF / 2, NUT_AF / 2, TRIPOD_Y, 15, 2, 2 + NUT_T))
    # portrait socket on the +X side face
    b = b.cut(cq.Workplane("YZ").circle(3.4).extrude(14).translate((12, TRIPOD_Y, 8)))
    xn = 25 - 2.5 - NUT_T
    nut2 = hex_prism(NUT_AF, NUT_T, "YZ").rotate((0, 0, 0), (1, 0, 0), 30).translate((xn, TRIPOD_Y, 8))
    b = b.cut(nut2).cut(box(xn, xn + NUT_T, TRIPOD_Y, 15, 8 - NUT_AF / 2, 8 + NUT_AF / 2))
    return b


def screw_z():
    return SEAT + W + 6 - 25


def slider():
    zj = SEAT + W
    sx = BAR_W / 2 + CL + WALL
    yb = BAR_Y0 + BAR_D + CL + WALL
    s = fillet(box(-sx, sx, 0, yb, zj + 6 - SLV_H, zj + 6), "|Z", 2)
    # boss with M5 nut trap for the thumb screw
    zs = screw_z()
    boss = fillet(box(-8, 8, yb - 1, yb + 6.5, zs - 9, zs + 9), "|Y", 3)
    s = s.union(boss)
    jaw = fillet(box(-JAW_W / 2, JAW_W / 2, LIP_Y, 1, zj, zj + 6), ">Z", 2)
    s = s.union(jaw)
    s = s.union(box(-JAW_W / 2, JAW_W / 2, LIP_Y, LIP_Y + 3, zj - 5, zj + 1))
    s = s.cut(box(-BAR_W / 2 - CL, BAR_W / 2 + CL, BAR_Y0 - CL, BAR_Y0 + BAR_D + CL, zj - 60, zj + 20))
    s = s.cut(cq.Workplane("XZ").circle(2.8).extrude(-12).translate((0, yb - 2, zs)))
    yn = yb + 0.5
    nut = hex_prism(M5_AF, M5_T, "XZ").translate((0, yn + M5_T, zs))
    s = s.cut(nut).cut(box(-M5_AF / 2, 10, yn, yn + M5_T, zs - M5_AF / 2, zs + M5_AF / 2))
    return s


def thumb_screw():
    yh = BAR_Y0 + BAR_D - 1.5 + 12     # tip resting on the groove floor
    zs = screw_z()
    head = cq.Workplane("XZ").circle(10).extrude(-4).translate((0, yh, zs))
    head = fillet(head, "%CIRCLE", 0.8)
    shank = cq.Workplane("XZ").circle(2.5).extrude(12).translate((0, yh, zs))
    return head.union(shank)


def tripod_nut(plane, at):
    n = hex_prism(11.11, 5.56, plane).faces(">" + ("Z" if plane == "XY" else "X")).workplane().hole(6.35)
    return n.translate(at)


def parts():
    yb = BAR_Y0 + BAR_D + CL + WALL
    m5 = hex_prism(8.0, 4.0, "XZ").faces("<Y").workplane().hole(5).translate((0, yb + 0.65 + 4, screw_z()))
    phone = fillet(box(-80, 80, -9, 0, SEAT, SEAT + W), "|Y", 9)
    return [
        {"name": "Body", "shape": body(), "group": "case", "color": "#2b2f36"},
        {"name": "Slider Jaw", "id": "slider", "shape": slider(), "group": "case", "color": "#e8833a",
         "explode": [0, 0, 1]},
        {"name": "M5x12 thumb screw", "id": "thumb", "shape": thumb_screw(), "group": "component",
         "color": "#c0c4c8", "explode": [0, 1, 0]},
        {"name": "M5 hex nut", "id": "m5nut", "shape": m5, "group": "component", "color": "#a8acb0"},
        {"name": "1/4-20 hex nut (landscape)", "shape": tripod_nut("XY", (0, TRIPOD_Y, 2.15)),
         "group": "component", "color": "#a8acb0", "explode": [0, 1, 0]},
        {"name": "1/4-20 hex nut (portrait)", "shape": tripod_nut("YZ", (25 - 2.5 - NUT_T + 0.15, TRIPOD_Y, 8)),
         "group": "component", "color": "#a8acb0", "explode": [0, 1, 0]},
        {"name": "Reference phone (not included)", "shape": phone, "group": "component", "color": "#151515",
         "explode": [0, -1, 0]},
    ]


def motion():
    # open the jaw to max width and back
    ids = ["slider", "thumb", "m5nut"]
    return [{"part": i, "type": "slide", "axis": [0, 0, 1], "range": [0, 20]} for i in ids]

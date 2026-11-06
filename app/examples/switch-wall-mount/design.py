import cadquery as cq

# Wall at y=0, product in front (-Y). Console (Joy-Cons off) stands in a cradle,
# Joy-Cons stand in two cups either side. Fits Switch OLED (176 wide) and original (173).
# Sources: Nintendo OLED spec (Joy-Con 102 x 35.9 x 28.4), Wikipedia (OLED tablet 176 x 102 x 14).
CON_W, CON_H, CON_T = 176.0, 102.0, 13.9
JC_W, JC_H, JC_T = 35.9, 102.0, 28.4

PLATE_T = 4.0
FLOOR = 4.0
CH_W = CON_W + 3.0          # channel inner width
CH_D = CON_T + 1.6          # channel inner depth
SIDE_T, SIDE_H = 3.0, 24.0
LIP_T, LIP_H = 3.0, 14.0
CR_W = CH_W + 2 * SIDE_T
CR_H = 45.0
SCREW_D, CSK_D = 4.5, 9.0   # #8 / 4 mm flat-head wood screw

JC_IN_W, JC_IN_D = JC_W + 1.0, JC_T + 1.0
JC_WALL = 2.4
JH_W, JH_H = 50.0, 50.0
JX = CR_W / 2 + 12 + JH_W / 2


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def screw_holes(shape, pts):
    for x, z in pts:
        shank = cq.Workplane("XZ").center(x, z).circle(SCREW_D / 2).extrude(-PLATE_T - 2).translate((0, -PLATE_T - 1, 0))
        cone = cq.Solid.makeCone(CSK_D / 2, SCREW_D / 2 - 0.01, (CSK_D - SCREW_D) / 2,
                                 cq.Vector(x, -PLATE_T - 0.01, z), cq.Vector(0, 1, 0))
        shape = shape.cut(shank).cut(cq.Workplane().add(cone))
    return shape


def soften(shape, r):
    try:
        return shape.edges("|Z").fillet(r)
    except Exception:
        return shape


def cradle():
    y_front = -PLATE_T - CH_D - LIP_T
    s = box(-CR_W / 2, CR_W / 2, -PLATE_T, 0, 0, CR_H)
    s = s.union(box(-CR_W / 2, CR_W / 2, y_front, -PLATE_T + 1, 0, FLOOR))
    s = s.union(box(-CR_W / 2, CR_W / 2, y_front, y_front + LIP_T, 0, LIP_H))
    for sx in (-1, 1):
        x0 = sx * CH_W / 2
        s = s.union(box(min(x0, x0 + sx * SIDE_T), max(x0, x0 + sx * SIDE_T), y_front, -PLATE_T + 1, 0, SIDE_H))
    s = soften(s, 1.0)
    # thumb notch in the lip
    notch = cq.Workplane("XZ").center(0, 7 + 30).circle(30).extrude(-10).translate((0, y_front - 2, 0))
    s = s.cut(notch)
    # USB-C cable slot under the console's bottom port
    y_con = -PLATE_T - CH_D / 2
    s = s.cut(box(-8, 8, y_con - 5, y_con + 5, -1, FLOOR + 1))
    return screw_holes(s, [(-65, 32), (65, 32)])


def jc_holder(x):
    y_front = -PLATE_T - JC_IN_D - JC_WALL
    s = box(x - JH_W / 2, x + JH_W / 2, -PLATE_T, 0, 0, JH_H)
    cw = JC_IN_W / 2 + JC_WALL
    s = s.union(box(x - cw, x + cw, y_front, -PLATE_T + 1, 0, 30))
    s = s.cut(box(x - JC_IN_W / 2, x + JC_IN_W / 2, -PLATE_T - JC_IN_D, -PLATE_T, 3, 60))
    s = soften(s, 1.0)
    # lower front so the stick and buttons clear and it's easy to grab
    s = s.cut(cq.Workplane("XZ").center(x, 18 + 40).circle(40).extrude(-6).translate((0, y_front - 2, 0)))
    return screw_holes(s, [(x - 15, 40), (x + 15, 40)])


def parts():
    y_con = -PLATE_T - CH_D / 2
    console = cq.Workplane("XY").box(CON_W, CON_T, CON_H).edges("|Y").fillet(8).translate((0, y_con, FLOOR + CON_H / 2))
    jy = -PLATE_T - JC_IN_D / 2
    jc = lambda x: cq.Workplane("XY").box(JC_W, JC_T, JC_H).edges("|Y").fillet(6).translate((x, jy, 3 + JC_H / 2))
    return [
        {"name": "Console Cradle", "shape": cradle(), "group": "case", "color": "#e8e8e8"},
        {"name": "Left Joy-Con Holder", "shape": jc_holder(-JX), "group": "case", "color": "#e8e8e8"},
        {"name": "Right Joy-Con Holder", "shape": jc_holder(JX), "group": "case", "color": "#e8e8e8"},
        {"name": "Switch console (yours)", "shape": console, "group": "component", "color": "#303030", "explode": [0, 0, 1]},
        {"name": "Left Joy-Con (yours)", "shape": jc(-JX), "group": "component", "color": "#00a8d8", "explode": [0, 0, 1]},
        {"name": "Right Joy-Con (yours)", "shape": jc(JX), "group": "component", "color": "#e8403a", "explode": [0, 0, 1]},
    ]

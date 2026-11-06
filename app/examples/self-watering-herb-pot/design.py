import cadquery as cq

# --- main dimensions (mm) ---
R = 58.0           # pot outer radius (116 mm pot)
H = 100.0          # pot height
T = 1.6            # wall (4 perimeters)
TUBE_BORE = 12.0   # fill / indicator tube bore radius (24 mm)
TUBE_W = 1.6
TUBE_Y = R - TUBE_BORE - TUBE_W - T + 1.2   # tube merges 1.2 mm into the back wall
OVERFLOW_Z = 38.0  # overflow hole = max water level
LEG_R = 22.0       # wicking leg radius
CONE_Z0 = 18.0     # where the cone leaves the leg
FLOAT_R = 10.5
FLOAT_H = 30.0
RISE = 17.0        # float rise from empty to full (63 % submerged at 6.5 g)


def revolve(pts):
    return cq.Workplane("XZ").polyline(pts).close().revolve(360, (0, 0, 0), (0, 1, 0))


def cyl(r, z0, h, x=0.0, y=0.0):
    return cq.Workplane("XY").workplane(offset=z0).center(x, y).circle(r).extrude(h)


def pot():
    body = cyl(R, 0, H)
    try:
        body = body.faces("<Z").edges().fillet(8)
    except Exception:
        pass
    body = body.cut(cyl(R - T, T, H))
    body = body.union(cyl(TUBE_BORE + TUBE_W, 0, H, y=TUBE_Y))
    body = body.cut(cyl(TUBE_BORE, T, H, y=TUBE_Y))
    # water inlets at the tube foot (front + sides)
    for a in (-90, 0, 180):
        slot = (cq.Workplane("XY").box(8, 5, 8).translate((TUBE_BORE + 1, 0, T + 4))
                .rotate((0, 0, 0), (0, 0, 1), a).translate((0, TUBE_Y, 0)))
        body = body.cut(slot)
    # overflow hole at the front: water can never drown the roots
    body = body.cut(cq.Workplane("XZ").workplane(offset=R + 5).center(0, OVERFLOW_Z).circle(3).extrude(15))
    try:
        body = body.faces(">Z").edges().fillet(0.6)
    except Exception:
        pass
    return body


def wick_cone():
    ri = R - T - 0.5                      # 0.5 slip clearance to the pot wall
    z1 = CONE_Z0 + ri - LEG_R             # 45 deg cone, prints without supports
    outer = revolve([(0, T), (LEG_R, T), (LEG_R, CONE_Z0), (ri, z1), (ri, z1 + 6), (0, z1 + 6)])
    d = T * 1.414
    inner = revolve([(0, 2 * T), (LEG_R - T, 2 * T), (LEG_R - T, CONE_Z0 + d - T),
                     (ri - T, z1 + d - T), (ri - T, z1 + 20), (0, z1 + 20)])
    c = outer.cut(inner)
    # wicking slots in the leg + drain holes in the cone
    for i in range(8):
        c = c.cut(cq.Workplane("XY").box(5, 6, 9).translate((LEG_R, 0, 9)).rotate((0, 0, 0), (0, 0, 1), i * 45 + 22.5))
    for i in range(12):
        c = c.cut(cq.Workplane("XY").circle(1.6).extrude(100).translate((38, 0, 0)).rotate((0, 0, 0), (0, 0, 1), i * 30))
    # notch around the fill tube
    c = c.cut(cyl(TUBE_BORE + TUBE_W + 0.5, 0, 100, y=TUBE_Y))
    return c


def level_float():
    f = cyl(FLOAT_R, T, FLOAT_H).cut(cyl(FLOAT_R - 1.2, T + 1.2, FLOAT_H - 2.4))   # sealed air chamber
    top = H - 6                                   # red ball hidden at empty, pops up when full
    f = f.union(cyl(2.5, T + FLOAT_H - 0.5, top - T - FLOAT_H + 0.5))
    f = f.union(cq.Workplane("XY").sphere(4.5).translate((0, 0, top)))
    return f.translate((0, TUBE_Y, 0))


def parts():
    return [
        {"name": "Pot", "shape": pot(), "group": "case", "color": "#e8e2d6"},
        {"name": "Wicking Cone", "shape": wick_cone(), "group": "case", "color": "#7a8f6a", "explode": [0, 0, 1]},
        {"name": "Level Float", "shape": level_float(), "group": "case", "color": "#d9482b", "explode": [0, 0, 1.6]},
    ]


def motion():
    # reservoir fills: the float rises and the red ball shows above the rim
    return [{"part": "Level Float", "type": "slide", "axis": [0, 0, 1], "range": [0, RISE]}]

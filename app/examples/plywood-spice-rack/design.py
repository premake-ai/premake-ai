import cadquery as cq

# Fits "tall" spice jars up to 52 dia x 127 mm (US 4 oz is ~48 x 105)
JAR_D, JAR_H = 48.0, 105.0         # reference jar shown in the model
N_PER_SHELF, N_SHELVES = 4, 3
POCKET = 56.0                      # width per jar
T = 6.0                            # plywood thickness
IN_W = N_PER_SHELF * POCKET        # 224 between sides
DEPTH = 62.0                       # side depth (front of rail to wall face of sides)
RAIL_H = 22.0                     # front rail height above floor bottom
PITCH = 150.0
Z0 = 10.0                          # bottom of lowest shelf floor
BOARD_H = Z0 + 2 * PITCH + T + 140 + 14
OUT_W = IN_W + 2 * T
SLOT = 0.1                         # press-fit undersize handled by kerf; slots nominal
TAB_L = 16.0
TAB_X = (-70.0, 70.0)              # back-tab positions
TAB_Y = (-38.0, -14.0)             # side-tab centres (on floor)


def side(sx):
    s = (cq.Workplane("XY").box(T, DEPTH, BOARD_H, centered=(True, False, False))
         .translate((sx, -DEPTH, 0)))
    try:
        s = s.edges("|X and <Y").fillet(18)
    except Exception:
        pass
    for i in range(N_SHELVES):
        z = Z0 + i * PITCH
        for ty in TAB_Y:
            s = s.cut(cq.Workplane("XY").box(T + 2, TAB_L, T).translate((sx, ty, z + T / 2)))
        # rail tab slot
        s = s.cut(cq.Workplane("XY").box(T + 2, T, 12).translate((sx, -DEPTH + T / 2 + 4, z + T + 8)))
    return s


def back():
    b = (cq.Workplane("XY").box(OUT_W, T, BOARD_H, centered=(True, False, False)))
    try:
        b = b.edges("|Y and >Z").fillet(16)
    except Exception:
        pass
    for i in range(N_SHELVES):
        z = Z0 + i * PITCH
        for tx in TAB_X:
            b = b.cut(cq.Workplane("XY").box(TAB_L * 2, T + 2, T).translate((tx, T / 2, z + T / 2)))
    # 4 countersunk wall-screw holes (#8 wood screw)
    for x in (-80.0, 80.0):
        for z in (Z0 + T + 60, BOARD_H - 35):
            b = b.cut(cq.Workplane("XZ").circle(2.6).extrude(-T * 3).translate((x, -T, z)))
            b = b.cut(cq.Solid.makeCone(5.0, 0, 5.0, pnt=cq.Vector(x, -0.01, z), dir=cq.Vector(0, 1, 0)))
    return b


def floor(z):
    f = cq.Workplane("XY").box(IN_W, DEPTH - T - 4, T, centered=(True, False, False)).translate((0, -DEPTH + T + 4, z))
    for ty in TAB_Y:
        for sx in (-1, 1):
            f = f.union(cq.Workplane("XY").box(T + 1, TAB_L, T).translate((sx * (IN_W / 2 + T / 2 - 0.5), ty, z + T / 2)))
    for tx in TAB_X:
        f = f.union(cq.Workplane("XY").box(TAB_L * 2, T + 1, T).translate((tx, T / 2 - 0.5, z + T / 2)))
    return f


def rail(z):
    r = cq.Workplane("XY").box(IN_W, T, RAIL_H, centered=(True, False, False)).translate((0, -DEPTH + 4, z))
    try:
        r = r.edges("|Y and >Z").fillet(4)
    except Exception:
        pass
    for sx in (-1, 1):
        r = r.union(cq.Workplane("XY").box(T + 1, T, 12).translate((sx * (IN_W / 2 + T / 2 - 0.5), -DEPTH + T / 2 + 4, z + T + 8)))
    return r


def jar(x, z):
    y = -DEPTH / 2 + 2
    body = cq.Workplane("XY").circle(JAR_D / 2).extrude(JAR_H - 18).translate((x, y, z))
    try:
        body = body.edges().fillet(3)
    except Exception:
        pass
    cap = cq.Workplane("XY").circle(JAR_D / 2 - 0.5).extrude(18).translate((x, y, z + JAR_H - 18))
    return body, cap


def parts():
    ply = {"process": "laser", "params": {"material": "plywood", "thickness_mm": 6}}
    out = [dict(name="Back Board", shape=back(), group="case", color="#c9a46c", **ply)]
    for sx, nm in ((-1, "Left Side"), (1, "Right Side")):
        out.append(dict(name=nm, shape=side(sx * (IN_W / 2 + T / 2)), group="case",
                        color="#d4b07a", explode=[sx, 0, 0], **ply))
    for i in range(N_SHELVES):
        z = Z0 + i * PITCH
        out.append(dict(name=f"Shelf {i+1}", shape=floor(z), group="case", color="#d9b886",
                        explode=[0, -1, 0], **ply))
        out.append(dict(name=f"Front Rail {i+1}", shape=rail(z), group="case", color="#d9b886",
                        explode=[0, -1, 0.3], **ply))
        for j in range(N_PER_SHELF):
            x = (j - (N_PER_SHELF - 1) / 2) * POCKET
            b, c = jar(x, z + T)
            n = i * N_PER_SHELF + j + 1
            out.append({"name": f"Spice jar {n} (yours)", "shape": b, "group": "component",
                        "color": "#e8e4dc", "process": "bought"})
            out.append({"name": f"Jar cap {n} (yours)", "shape": c, "group": "component",
                        "color": "#2b2b2b", "process": "bought"})
    return out

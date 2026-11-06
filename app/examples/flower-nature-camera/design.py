"""Pollinator flower cam: printed flower head with an ESP32-S3 camera pod on a stem,
a solar leaf, a nectar cup on a perch, planted in a plywood planter block that keys
onto a plywood mason-bee hotel block."""
import math
import cadquery as cq
from cadlib import fab
from cadlib.parts import part, info

SCENE = "floor"
CABLES = False

# ---- habitat blocks (laser-cut plywood) ----
T = fab.sheet_actual("plywood", 6)      # real thickness of "6 mm" ply
SW = fab.slot_width("plywood", 6)       # press-fit slot width
W, D = 160.0, 180.0                     # block footprint (x, y), front at -Y
H = 150.0                               # bee hotel height
PH = 110.0                              # planter wall height
O = 8.0                                 # top/bottom panel overhang (keeps slots off the edge)
TAB = 30.0                              # tab length
TUBE_D, TUBE_L = 8.0, 152.0             # 5/16" x 6" paper nesting tubes

# ---- flower head (printed ASA) ----
STEM_OD, STEM_ID, STEM_L = 25.0, 19.0, 250.0
BORE = 25.4                             # stem sockets (slip fit)
STEM_Y = 20.0
POD_R, POD_WALL, POD_D = 46.0, 2.5, 45.0
PF = STEM_Y - 26.0                      # pod front face y
Z_STEM0 = H + T                         # stem stands on the planter floor
HZ = Z_STEM0 + STEM_L + 48.0            # pod axis height
LZ = 300.0                              # solar leaf clamp height
PZ = HZ - 90.0                          # perch arm clamp height
CUP_Y = -110.0                          # nectar cup centre


def bx(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def soft(wp, r, sel="|Z"):
    try:
        return wp.edges(sel).fillet(r)
    except Exception:
        return wp


# ---------------- plywood blocks ----------------
def walls(z0, z1, front, offs_side, offs_fb):
    """Vertical walls of a block between z0 and z1, finger-jointed corners.
    Returns {name: shape} and the tab boxes that stick out top/bottom."""
    hw, hd = W / 2, D / 2
    yf = -hd + (T if front else 0.0)
    sh = {
        "left side": bx(-hw, -hw + T, yf, hd - T, z0, z1),
        "right side": bx(hw - T, hw, yf, hd - T, z0, z1),
        "back": bx(-hw + T, hw - T, hd - T, hd, z0, z1),
    }
    if front:
        sh["front"] = bx(-hw + T, hw - T, -hd, -hd + T, z0, z1)
    # corner fingers: 5 segments alternating side wall / front-back wall
    n = 5
    corners = [(-1, 1), (1, 1)] + ([(-1, -1), (1, -1)] if front else [])
    for sx, sy in corners:
        side = "left side" if sx < 0 else "right side"
        fb = "back" if sy > 0 else "front"
        xa, xb = (-hw, -hw + T) if sx < 0 else (hw - T, hw)
        ya, yb = (hd - T, hd) if sy > 0 else (-hd, -hd + T)
        for i in range(n):
            za = z0 + (z1 - z0) * i / n
            zb = z0 + (z1 - z0) * (i + 1) / n
            owner = side if i % 2 == 0 else fb
            sh[owner] = sh[owner].union(bx(xa, xb, ya, yb, za, zb))
    # tabs (centre, axis of wall length)
    tabs = []
    yc = (yf + hd - T) / 2
    for o in offs_side:
        tabs.append(("left side", -hw + T / 2, yc + o, "y"))
        tabs.append(("right side", hw - T / 2, yc + o, "y"))
    for o in offs_fb:
        tabs.append(("back", o, hd - T / 2, "x"))
        if front:
            tabs.append(("front", o, -hd + T / 2, "x"))
    return sh, tabs


def tab_box(x, y, axis, za, zb, slot=False):
    th = SW if slot else T
    ln = TAB + (0.2 if slot else 0.0)
    if axis == "y":
        return bx(x - th / 2, x + th / 2, y - ln / 2, y + ln / 2, za, zb)
    return bx(x - ln / 2, x + ln / 2, y - th / 2, y + th / 2, za, zb)


def plate(z0):
    return soft(bx(-W / 2 - O, W / 2 + O, -D / 2 - O, D / 2 + O, z0, z0 + T), 6.0)


def blocks():
    out = []
    # --- bee hotel: bottom, top, two sides, back, open front ---
    hb, ht = plate(0.0), plate(H - T)
    hw, htabs = walls(T, H - T, False, (-50, 50), (-40, 40))
    for name, x, y, ax in htabs:
        hw[name] = hw[name].union(tab_box(x, y, ax, 0, T)).union(tab_box(x, y, ax, H - T, H))
        hb = hb.cut(tab_box(x, y, ax, -1, T + 1, True))
        ht = ht.cut(tab_box(x, y, ax, H - T - 1, H + 1, True))
    # --- planter: bottom + four walls, its tabs reach down into the hotel top ---
    pb = plate(H)
    pw, ptabs = walls(H + T, H + T + PH, True, (-20, 20), (-15, 15))
    for name, x, y, ax in ptabs:
        pw[name] = pw[name].union(tab_box(x, y, ax, H - T + 0.5, H + T))
        pb = pb.cut(tab_box(x, y, ax, H - 1, H + T + 1, True))
        ht = ht.cut(tab_box(x, y, ax, H - T - 1, H + 1, True))
    # planter drains out the front (never onto the bee hotel) + stem socket screws
    for dx in (-45, 0, 45):
        hole = cq.Workplane("XZ").circle(4.0).extrude(-T - 2).translate((dx, -D / 2 - 1, H + T + 6))
        pw["front"] = pw["front"].cut(hole)
    for a in (90, 210, 330):
        x, y = 24 * math.cos(math.radians(a)), STEM_Y + 24 * math.sin(math.radians(a))
        pb = pb.cut(cq.Workplane("XY").circle(2.25).extrude(T + 2).translate((x, y, H - 1)))
        pb = pb.cut(cq.Workplane("XY").circle(4.6).workplane(offset=2.6).circle(2.25)
                    .loft().translate((x, y, H - 0.01)))
    lp = {"process": "laser", "params": {"material": "plywood", "thickness_mm": 6}}
    out += [dict(name="Hotel bottom", shape=hb, explode=[0, 0, -1], **lp),
            dict(name="Hotel top", shape=ht, explode=[0, 0, 1], **lp)]
    for k, s in hw.items():
        out.append(dict(name="Hotel " + k, shape=s, **lp))
    out.append(dict(name="Planter bottom", shape=pb, **lp))
    for k, s in pw.items():
        out.append(dict(name="Planter " + k, shape=s, explode=[0, 0, 1], **lp))
    # paper nesting tubes, recessed 20 mm behind the open front
    tubes = []
    y1 = D / 2 - T
    nx = int((W - 2 * T) // TUBE_D)
    nz = int((H - 2 * T) // TUBE_D)
    x0 = -(nx - 1) * TUBE_D / 2
    z0 = H / 2 - (nz - 1) * TUBE_D / 2
    for i in range(nx):
        for j in range(nz):
            c = cq.Solid.makeCylinder(TUBE_D / 2 - 0.05, TUBE_L, cq.Vector(x0 + i * TUBE_D, y1, z0 + j * TUBE_D),
                                      cq.Vector(0, -1, 0))
            tubes.append(c)
    out.append({"name": "Mason bee nesting tubes (%d)" % (nx * nz), "shape": cq.Compound.makeCompound(tubes),
                "group": "component", "color": "#c9a46a", "explode": [0, -1, 0]})
    return out


# ---------------- flower head ----------------
def pod():
    body = cq.Workplane("XZ").circle(POD_R).extrude(-POD_D).translate((0, PF, HZ))
    flange = cq.Workplane("XZ").circle(55).extrude(-3).translate((0, PF, HZ))
    body = body.union(flange)
    try:
        body = body.faces("<Y").edges().fillet(1.5)
    except Exception:
        pass
    body = body.cut(cq.Workplane("XZ").circle(POD_R - POD_WALL).extrude(-POD_D).translate((0, PF + 3, HZ)))
    # screw columns for the back cap (from the front wall to the rear, no overhangs)
    for a in (90, 210, 330):
        x, z = 41 * math.cos(math.radians(a)), HZ + 41 * math.sin(math.radians(a))
        col = cq.Workplane("XZ").circle(4.0).extrude(-(POD_D - 3)).translate((x, PF + 3, z))
        body = body.union(col)
        body = body.cut(cq.Workplane("XZ").circle(2.0).extrude(6.5).translate((x, PF + POD_D, z)))
    # camera frame and PIR tube on the inside of the front wall
    frame = bx(-12.8, 12.8, PF + 2, PF + 10, HZ - 11.2, HZ + 11.2).cut(
        bx(-10.8, 10.8, PF + 2, PF + 11, HZ - 9.2, HZ + 9.2))
    pirt = cq.Workplane("XZ").circle(7.5).extrude(-10).translate((0, PF + 2, HZ - 28))
    body = body.union(frame).union(pirt)
    body = body.cut(cq.Workplane("XZ").circle(6.0).extrude(-10).translate((0, PF - 1, HZ)))        # lens
    body = body.cut(cq.Workplane("XZ").circle(5.1).extrude(-14).translate((0, PF - 1, HZ - 28)))   # PIR dome
    for a in (90, 210, 330):                                                                         # petal screws
        body = body.cut(cq.Workplane("XZ").circle(1.7).extrude(-5).translate(
            (50 * math.cos(math.radians(a)), PF - 1, HZ + 50 * math.sin(math.radians(a)))))
    # hex stem socket under the pod (vertex forward so it prints face-down without supports)
    boss = (cq.Workplane("XY").polygon(6, 2 * 16 / math.cos(math.radians(30))).extrude(28)
            .rotate((0, 0, 0), (0, 0, 1), 30).translate((0, STEM_Y, HZ - 68)))
    body = body.union(boss)
    body = body.cut(cq.Workplane("XY").circle(BORE / 2).extrude(20).translate((0, STEM_Y, HZ - 68.1)))
    body = body.cut(cq.Workplane("XY").circle(6.0).extrude(30).translate((0, STEM_Y, HZ - 50)))
    body = body.cut(cq.Workplane("YZ").circle(1.7).extrude(40).translate((-20, STEM_Y, HZ - 58)))
    return body


def petal_ring():
    p = cq.Workplane("XY").circle(56).extrude(3)
    for k in range(8):
        a = 22.5 + 45 * k
        e = (cq.Workplane("XY").ellipse(36, 23).extrude(3)
             .translate((72, 0, 0)).rotate((0, 0, 0), (0, 0, 1), a))
        p = p.union(e)
    p = soft(p, 1.2, "|Z")
    p = p.cut(cq.Workplane("XY").circle(POD_R + 0.3).extrude(5).translate((0, 0, -1)))
    for a in (90, 210, 330):
        # plate y maps to world z after the rotation below
        p = p.cut(cq.Workplane("XY").circle(1.7).extrude(5)
                  .translate((50 * math.cos(math.radians(a)), 50 * math.sin(math.radians(a)), -1)))
    try:
        p = p.faces(">Z").edges().fillet(1.0)
    except Exception:
        pass
    return p.rotate((0, 0, 0), (1, 0, 0), 90).translate((0, PF + 6, HZ))


def back_cap():
    c = cq.Workplane("XZ").circle(POD_R).extrude(-3).translate((0, PF + POD_D + 1.5, HZ))
    try:
        c = c.faces(">Y").edges().fillet(1.2)
    except Exception:
        pass
    for a in (90, 210, 330):
        x, z = 41 * math.cos(math.radians(a)), HZ + 41 * math.sin(math.radians(a))
        c = c.cut(cq.Workplane("XZ").circle(1.7).extrude(-6).translate((x, PF + POD_D, z)))
    return c


def gasket():
    g = cq.Workplane("XZ").circle(POD_R).circle(39.5).extrude(-1.5).translate((0, PF + POD_D, HZ))
    for a in (90, 210, 330):
        x, z = 41 * math.cos(math.radians(a)), HZ + 41 * math.sin(math.radians(a))
        g = g.cut(cq.Workplane("XZ").circle(1.7).extrude(-3).translate((x, PF + POD_D - 0.5, z)))
    return g


def stem():
    s = cq.Workplane("XY").circle(STEM_OD / 2).circle(STEM_ID / 2).extrude(STEM_L).translate((0, STEM_Y, Z_STEM0))
    for z in (Z_STEM0 + 12, Z_STEM0 + STEM_L - 10):       # cross bolts
        s = s.cut(cq.Workplane("YZ").circle(1.7).extrude(40).translate((-20, STEM_Y, z)))
    s = s.cut(cq.Workplane("YZ").circle(3.5).extrude(20).translate((0, STEM_Y, LZ + 24)))  # solar wire in
    return s


def stem_socket():
    s = cq.Workplane("XY").circle(32).extrude(5).union(cq.Workplane("XY").circle(16.5).extrude(30))
    s = soft(s, 1.0, ">Z")
    s = s.cut(cq.Workplane("XY").circle(BORE / 2).extrude(32).translate((0, 0, -1)))
    for a in (90, 210, 330):
        s = s.cut(cq.Workplane("XY").circle(2.25).extrude(7).translate(
            (24 * math.cos(math.radians(a)), 24 * math.sin(math.radians(a)), -1)))
    s = s.cut(cq.Workplane("YZ").circle(1.7).extrude(40).translate((-20, 0, 12)))
    return s.translate((0, STEM_Y, H + T))


def clamp_ring(z, ear_dir):
    """Split ring around the stem with a bolted ear pointing ear_dir (+/-x or +/-y)."""
    r = cq.Workplane("XY").circle(16.5).extrude(14)
    ex, ey = ear_dir
    if ex:
        ear = bx(min(0, 24 * ex), max(0, 24 * ex), -6, 6, 0, 14)
        slot = bx(min(10 * ex, 26 * ex), max(10 * ex, 26 * ex), -1, 1, -1, 15)
        hole = cq.Workplane("XZ").circle(1.7).extrude(-20).translate((19.5 * ex, -10, 7))
    else:
        ear = bx(-6, 6, min(0, 24 * ey), max(0, 24 * ey), 0, 14)
        slot = bx(-1, 1, min(10 * ey, 26 * ey), max(10 * ey, 26 * ey), -1, 15)
        hole = cq.Workplane("YZ").circle(1.7).extrude(20).translate((-10, 19.5 * ey, 7))
    return r.union(ear), [slot, hole], z


def finish_clamp(body, cuts, z):
    body = body.cut(cq.Workplane("XY").circle(BORE / 2).extrude(80).translate((0, 0, -1)))
    for c in cuts:
        body = body.cut(c)
    return body.translate((0, STEM_Y, z))


def solar_leaf():
    ring, cuts, z = clamp_ring(LZ, (-1, 0))
    leaf = cq.Workplane("XY").ellipse(82, 48).extrude(3).translate((88, 0, 0))
    rim = bx(33 - 2.5, 143 + 2.5, -30.8 - 2.5, 30.8 + 2.5, 0, 6).cut(bx(32.7, 143.3, -30.8, 30.8, 3, 7))
    rim = rim.cut(bx(140, 150, -10, 10, 3, 7))                      # drain + cable gap
    body = ring.union(leaf).union(rim)
    body = soft(body, 1.0, ">Z")
    return finish_clamp(body, cuts, z)


def perch_arm():
    ring, cuts, z = clamp_ring(PZ, (0, 1))
    top = HZ - 42 - PZ
    arm = bx(-5, 5, CUP_Y - STEM_Y, -12, 0, 6)
    cradle = cq.Workplane("XY").circle(25).extrude(top).translate((0, CUP_Y - STEM_Y, 0))
    body = ring.union(arm).union(cradle)
    body = body.cut(cq.Workplane("XY").circle(22.3).extrude(top + 2).translate((0, CUP_Y - STEM_Y, -1)))
    return finish_clamp(body, cuts, z)


CUP_Z0 = HZ - 42 - 23.3        # cup chamfer rests on the cradle rim


def nectar_cup():
    pts = [(0, 0), (22, 0), (22, 23), (25, 26), (25, 27), (20, 27), (20, 2), (0, 2)]
    c = cq.Workplane("XZ").polyline(pts).close().revolve(360, (0, 0, 0), (0, 1, 0))
    return c.translate((0, CUP_Y, CUP_Z0))


def nectar_lid():
    l = cq.Workplane("XY").circle(25).extrude(2).union(
        cq.Workplane("XY").circle(19.85).circle(17.85).extrude(-5))
    l = soft(l, 0.8, ">Z")
    for k in range(4):
        a = math.radians(45 + 90 * k)
        l = l.cut(cq.Workplane("XY").circle(2.25).extrude(4).translate((13 * math.cos(a), 13 * math.sin(a), -1)))
    return l.translate((0, CUP_Y, CUP_Z0 + 27))


# ---------------- electronics (dummies for parts the library lacks) ----------------
def xiao_sense():
    b = bx(-10.5, 10.5, PF + 6, PF + 21, HZ - 8.9, HZ + 8.9)
    lens = cq.Workplane("XZ").circle(4).extrude(3).translate((0, PF + 6, HZ))
    return b.union(lens)


def parts():
    ta = fab.sheet_actual("acrylic", 3)
    out = blocks()
    out += [
        {"name": "Stem socket", "shape": stem_socket(), "color": "#2f7d32"},
        {"name": "Stem", "shape": stem(), "color": "#3f9a3a"},
        {"name": "Solar leaf", "shape": solar_leaf(), "color": "#4caf50"},
        {"name": "Perch arm", "shape": perch_arm(), "color": "#2f7d32"},
        {"name": "Nectar cup", "shape": nectar_cup(), "color": "#d62828", "explode": [0, -1, 0]},
        {"name": "Nectar lid", "shape": nectar_lid(), "color": "#e63946", "explode": [0, 0, 1]},
        {"name": "Camera pod", "shape": pod(), "color": "#f6c21c"},
        {"name": "Petal ring", "shape": petal_ring(), "color": "#8e5bd6", "explode": [0, -1, 0]},
        {"name": "Back cap gasket", "shape": gasket(), "color": "#222222", "explode": [0, 1, 0]},
        {"name": "Back cap", "shape": back_cap(), "color": "#2f7d32", "explode": [0, 1, 0]},
        {"name": "Camera window", "shape": cq.Workplane("XZ").circle(10.6).extrude(-ta).translate((0, PF + 2.5, HZ)),
         "process": "laser", "params": {"material": "acrylic", "thickness_mm": 3}, "material": "acrylic_clear"},
        {"name": "XIAO ESP32S3 Sense camera board", "shape": xiao_sense(), "group": "component", "color": "#1b5e20"},
        {"name": "AM312 mini PIR", "shape": cq.Workplane("XZ").circle(5).extrude(-23).translate((0, PF + 1, HZ - 28)),
         "group": "component", "color": "#eeeeee"},
        {"name": "TP4056 USB-C charger", "shape": bx(-8.5, 8.5, PF + 16, PF + 44, HZ + 24, HZ + 28),
         "group": "component", "color": "#1565c0"},
        {"name": "6V 1W solar panel", "shape": bx(33, 143, -30, 30, 3, 5.5).translate((0, STEM_Y, LZ)),
         "group": "component", "color": "#14213d", "material": "glass"},
    ]
    # 18650 holder lies along X, height along Y, behind the camera board
    hb = info("holder_18650")
    print("holder_18650", hb.get("dims"), hb.get("bbox_min"), hb.get("bbox_max"))
    print("cell_18650", info("cell_18650").get("bbox_min"), info("cell_18650").get("bbox_max"))
    out.append(part("holder_18650", at=(0, PF + 41, HZ), rot=(90, 0, 0)))
    # fasteners
    pet = [(50 * math.cos(math.radians(a)), PF, HZ + 50 * math.sin(math.radians(a))) for a in (90, 210, 330)]
    cap = [(41 * math.cos(math.radians(a)), PF + POD_D + 4.5, HZ + 41 * math.sin(math.radians(a))) for a in (90, 210, 330)]
    ins = [(x, PF + POD_D, z) for x, _, z in cap]
    out.append(part("m3x10_bhcs", at=pet, rot=(90, 0, 0)))
    out.append(part("m3_nylock", at=[(x, PF + 6, z) for x, _, z in pet], rot=(-90, 0, 0)))
    out.append(part("m3x10_shcs", at=cap, rot=(-90, 0, 0)))
    out.append(part("m3_insert", at=ins, rot=(90, 0, 0)))
    out.append(part("m3x40_bhcs", at=[(-16, STEM_Y, HZ - 58), (-16.5, STEM_Y, Z_STEM0 + 12)], rot=(0, -90, 0)))
    out.append(part("m3_nylock", at=[(16, STEM_Y, HZ - 58), (16.5, STEM_Y, Z_STEM0 + 12)], rot=(0, 90, 0)))
    out.append(part("m3x16_shcs", at=[(-19.5, STEM_Y + 6, LZ + 7)], rot=(-90, 0, 0)))
    out.append(part("m3x16_shcs", at=[(-6, STEM_Y + 19.5, PZ + 7)], rot=(0, -90, 0)))
    out.append(part("m3_nylock", at=[(-19.5, STEM_Y - 6, LZ + 7)], rot=(90, 0, 0)))
    out.append(part("m3_nylock", at=[(6, STEM_Y + 19.5, PZ + 7)], rot=(0, 90, 0)))
    sock = [(24 * math.cos(math.radians(a)), STEM_Y + 24 * math.sin(math.radians(a))) for a in (90, 210, 330)]
    out.append(part("m4x16_csk", at=[(x, y, H) for x, y in sock], rot=(180, 0, 0)))
    out.append(part("m4_nut", at=[(x, y, H + T + 5) for x, y in sock]))
    return out


ASSEMBLY = [
    ["Hotel bottom", "Hotel left side", "Hotel right side", "Hotel back", "Hotel top"],
    ["Mason bee nesting tubes"],
    ["Planter bottom", "Planter left side", "Planter right side", "Planter front", "Planter back", "Stem socket"],
    ["Stem", "Solar leaf", "6V 1W solar panel", "Perch arm", "Nectar cup", "Nectar lid"],
    ["Camera pod", "Camera window", "XIAO ESP32S3 Sense camera board", "AM312 mini PIR", "TP4056 USB-C charger"],
    ["Petal ring", "Back cap gasket", "Back cap"],
]

"""Replica of the 3018-PRO desktop CNC router (300 x 180 x 45 mm work area).

Layout follows the maker's parts list / assembly manual:
  base   = 2x 2040 x 290 profiles between front plate A and back plate B, 2x Y rail 10 x 290,
           300 x 180 T-slot worktable on 4 sliders, 295 lead screw, Y motor on plate B
  gantry = 2 tall pillar plates (C left, D right) on the base profiles, 2x 2020 x 360 profiles,
           2x X rail 10 x 360, 365 lead screw, X motor on the right pillar
  X-Z    = black block on the X rails with a Z slide + 775 spindle clamp, Z motor on top
The black Bakelite plates are copied as two laminated layers of 6 mm black acrylic.
"""
import cadquery as cq
from cadlib import fab
from cadlib.parts import part
from cadlib.shapes import safe_fillet
from cadlib.motion import move

SCENE = "desk"

T = fab.sheet_actual("acrylic", 6)   # one acrylic layer (~5.6)
PT = 2 * T                           # plate = 2 layers

# ---- base ----
PROF_X = 170          # centre of the 2040 base profiles (x 160..180)
PROF_L = 290
YP = PROF_L / 2       # plate inner faces at y = +-145
PLATE_W = 382         # plates A/B, x +-191
PLATE_H = 62
Y_RAIL_X = 110
Y_RAIL_Z = 50
Y_SCREW_Z = 40
BED_Z = 63            # bed bottom (slider tops)
BED_T = 20
BY = 0.0              # bed y (built pose)

# ---- gantry ----
PIL_X = 180           # pillar inner faces at x = +-180 (X rails 360 between them)
PIL_Y0, PIL_Y1 = -0.5, YP - 46.5 + 11   # back of pillar 46.5 mm from plate B front
PIL_H = 220
X_RAIL_Y = 55
X_RAIL_Z = (130, 190)
X_SCREW_Z = 160
CX = 0.0
# X-Z block
XZ_W = 38             # half width of the X-Z block
ARM_B = (108, 114)    # bottom arm z
ARM_T = (206, 212)    # top arm z
Z_ROD_X = 28
Z_ROD_Y = 22
ZC = 165.0            # Z slide centre (built pose, travel 134..168)
SP_Y = -24.0          # spindle axis y

BLACK = "#1b1b1d"
ALU = "#c9ccd1"
STEEL = "#9aa0a6"


# ---------- helpers ----------
def blk(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def cyl(axis, c, d, a0, a1):
    w = cq.Workplane("XY").circle(d / 2).extrude(a1 - a0)
    x, y, z = c
    if axis == "z":
        return w.translate((x, y, a0))
    if axis == "x":
        return w.rotate((0, 0, 0), (0, 1, 0), 90).translate((a0, y, z))
    return w.rotate((0, 0, 0), (1, 0, 0), -90).translate((x, a0, z))


def tube(axis, c, od, idia, a0, a1):
    return cyl(axis, c, od, a0, a1).cut(cyl(axis, c, idia, a0 - 1, a1 + 1))


def comp(name, shape, color=STEEL, **kw):
    d = {"name": name, "shape": shape, "group": "component", "color": color}
    d.update(kw)
    return d


def made(name, shape, process="print", color=BLACK, **kw):
    d = {"name": name, "shape": shape, "group": "case", "process": process, "color": color}
    d.update(kw)
    return d


def acrylic(name, shape, **kw):
    return made(name, shape, "laser", BLACK, params={"material": "acrylic", "thickness_mm": 6},
                material="pla", **kw)


# ---------- base plates A (front) / B (back) ----------
def end_plate(y0, y1, back):
    p = blk(-PLATE_W / 2, PLATE_W / 2, y0, y1, 0, PLATE_H)
    p = safe_fillet(p, "|Y", 6)
    p = p.cut(blk(-60, 60, y0 - 1, y1 + 1, -1, 14))          # arch between the feet
    for sx in (-1, 1):
        p = p.cut(cyl("y", (sx * Y_RAIL_X, 0, Y_RAIL_Z), 10.0, y0 - 1, y1 + 1))   # rail holes
        for z in (10, 30):                                     # M5 into 2040 ends
            p = p.cut(cyl("y", (sx * PROF_X, 0, z), 5.5, y0 - 1, y1 + 1))
    if back:
        p = p.cut(cyl("y", (0, 0, Y_SCREW_Z), 23, y0 - 1, y1 + 1))
        for dx in (-15.5, 15.5):
            for dz in (-15.5, 15.5):
                p = p.cut(cyl("y", (dx, 0, Y_SCREW_Z + dz), 3.4, y0 - 1, y1 + 1))
    else:
        p = p.cut(cyl("y", (0, 0, Y_SCREW_Z), 22.1, y0 - 1, y1 + 1))   # 608 bearing seat
    return p


# ---------- gantry pillars C (left) / D (right) ----------
def pillar_layer(x0, right):
    pts = [(PIL_Y0, 0), (PIL_Y1, 0), (PIL_Y1, PIL_H), (30, PIL_H), (30, 120), (PIL_Y0, 62)]
    p = cq.Workplane("YZ").polyline(pts).close().extrude(T).translate((x0, 0, 0))
    p = safe_fillet(p, "|X", 8)
    xa, xb = x0 - 1, x0 + T + 1
    for z in X_RAIL_Z:
        p = p.cut(cyl("x", (0, X_RAIL_Y, z), 10.0, xa, xb))
    if right:
        p = p.cut(cyl("x", (0, X_RAIL_Y, X_SCREW_Z), 23, xa, xb))
        for dy in (-15.5, 15.5):
            for dz in (-15.5, 15.5):
                p = p.cut(cyl("x", (0, X_RAIL_Y + dy, X_SCREW_Z + dz), 3.4, xa, xb))
    else:
        p = p.cut(cyl("x", (0, X_RAIL_Y, X_SCREW_Z), 22.1, xa, xb))
    for z in (110, 210):                     # M5 into the 2020 ends
        p = p.cut(cyl("x", (0, 90, z), 5.5, xa, xb))
    for y in (20, 80):                       # M5 + T-nuts into the 2040 base profile
        for z in (10, 30):
            p = p.cut(cyl("x", (0, y, z), 5.5, xa, xb))
    return p


# ---------- worktable (bought 300 x 180 T-slot plate) ----------
def worktable():
    t = blk(-150, 150, BY - 90, BY + 90, BED_Z, BED_Z + BED_T)
    for i in range(7):
        x = -120 + i * 40
        t = t.cut(blk(x - 3.2, x + 3.2, BY - 91, BY + 91, BED_Z + BED_T - 6, BED_Z + BED_T + 1))
        t = t.cut(blk(x - 6, x + 6, BY - 91, BY + 91, BED_Z + BED_T - 12, BED_Z + BED_T - 6))
    for x in (-140, -100, 100, 140):         # hollow cores
        pass
    return t


def slider(x, y):
    """SC10UU-style slider block (40 x 35 x 26), rail through the middle."""
    b = blk(x - 20, x + 20, y - 17.5, y + 17.5, Y_RAIL_Z - 13, Y_RAIL_Z + 13)
    return b.cut(cyl("y", (x, 0, Y_RAIL_Z), 10.2, y - 20, y + 20))


def y_nut_seat():
    b = blk(-11, 11, BY - 10, BY + 10, 31, BED_Z)
    b = b.union(blk(-22, 22, BY - 10, BY + 10, BED_Z - 4, BED_Z))     # flange to the table
    b = safe_fillet(b, "|Y", 3)
    b = b.cut(cyl("y", (0, 0, Y_SCREW_Z), 10.5, BY - 13, BY + 13))
    for x in (-16, 16):
        b = b.cut(cyl("z", (x, BY, 0), 5.5, BED_Z - 5, BED_Z + 1))   # M5 into table T-nuts
    return b


# ---------- X-Z assembly (printed black) ----------
def xz_block():
    x0, x1 = CX - XZ_W, CX + XZ_W
    body = cq.Workplane("XY")
    parts_ = []
    for z in X_RAIL_Z:   # LM10UU housings
        parts_.append(cyl("x", (0, X_RAIL_Y, z), 24, x0, x1))
    parts_.append(cyl("x", (0, X_RAIL_Y, X_SCREW_Z), 24, CX - 14, CX + 14))   # copper nut boss
    parts_.append(blk(x0, x1, 39.5, 44, ARM_B[0], ARM_T[1]))                  # front wall
    parts_.append(blk(x0, x1, Z_ROD_Y - 12, 44, *ARM_B))                       # bottom arm
    parts_.append(blk(x0, x1, Z_ROD_Y - 15, 44, *ARM_T))                       # top arm
    body = parts_[0]
    for p in parts_[1:]:
        body = body.union(p)
    body = safe_fillet(body, "|Y", 3)
    for z in X_RAIL_Z:
        body = body.cut(cyl("x", (0, X_RAIL_Y, z), 19.1, x0 - 1, x1 + 1))
    body = body.cut(cyl("x", (0, X_RAIL_Y, X_SCREW_Z), 10.5, CX - 15, CX + 15))
    for sx in (-1, 1):                                                          # two front windows
        a, b = sorted((CX + sx * 11, CX + sx * (XZ_W - 8)))
        body = body.cut(blk(a, b, 38, 45, 140, 180))
    for sx in (-1, 1):   # Z rod sockets (blind 4 mm)
        body = body.cut(cyl("z", (CX + sx * Z_ROD_X, Z_ROD_Y, 0), 10.0, ARM_B[1] - 4, ARM_B[1] + 1))
        body = body.cut(cyl("z", (CX + sx * Z_ROD_X, Z_ROD_Y, 0), 10.0, ARM_T[0] - 1, ARM_T[0] + 4))
    body = body.cut(cyl("z", (CX, Z_ROD_Y, 0), 9, ARM_B[0] - 1, ARM_B[1] + 1))   # Z screw
    body = body.cut(cyl("z", (CX, Z_ROD_Y, 0), 23, ARM_T[0] - 1, ARM_T[1] + 1))  # motor boss
    for dx in (-15.5, 15.5):
        for dy in (-15.5, 15.5):
            body = body.cut(cyl("z", (CX + dx, Z_ROD_Y + dy, 0), 3.4, ARM_T[0] - 1, ARM_T[1] + 1))
    return body


def z_slide():
    z0, z1 = ZC - 20, ZC + 20
    s = cyl("z", (CX - Z_ROD_X, Z_ROD_Y, 0), 25, z0, z1)
    s = s.union(cyl("z", (CX + Z_ROD_X, Z_ROD_Y, 0), 25, z0, z1))
    s = s.union(cyl("z", (CX, Z_ROD_Y, 0), 18, ZC - 12, ZC + 12))       # nut boss
    s = s.union(blk(CX - 5, CX + 5, 5, Z_ROD_Y, ZC - 12, ZC + 12))      # boss web
    s = s.union(blk(CX - 36, CX + 36, 0.5, 11, z0, z1))                 # front plate
    s = s.union(cyl("z", (CX, SP_Y, 0), 52, ZC - 12, ZC + 12))          # spindle ring
    s = s.union(blk(CX - 7, CX + 7, SP_Y - 35, SP_Y - 22, ZC - 12, ZC + 12))   # pinch lug
    s = safe_fillet(s, "|Z", 1.5)
    for sx in (-1, 1):
        s = s.cut(cyl("z", (CX + sx * Z_ROD_X, Z_ROD_Y, 0), 19.1, z0 - 1, z1 + 1))
    s = s.cut(cyl("z", (CX, Z_ROD_Y, 0), 10.5, z0 - 1, z1 + 1))
    s = s.cut(cyl("z", (CX, SP_Y, 0), 42.4, ZC - 14, ZC + 14))
    s = s.cut(blk(CX - 1.5, CX + 1.5, SP_Y - 36, SP_Y - 20, ZC - 14, ZC + 14))  # clamp split
    s = s.cut(cyl("x", (0, SP_Y - 30, ZC), 3.4, CX - 8, CX + 8))               # M3 pinch
    return s


def spindle():
    body = cyl("z", (CX, SP_Y, 0), 42, ZC - 30, ZC + 37)
    body = body.union(cyl("z", (CX, SP_Y, 0), 30, ZC + 37, ZC + 41))
    return body


def collet():
    rod = cyl("z", (CX, SP_Y, 0), 12, ZC - 50, ZC - 30)
    nut = cyl("z", (CX, SP_Y, 0), 19, ZC - 62, ZC - 50)
    bit = cyl("z", (CX, SP_Y, 0), 3.175, ZC - 78, ZC - 62)
    return rod.union(nut).union(bit)


def coupler(axis, c, a0):
    return tube(axis, c, 19, 8.3, a0, a0 + 25)


def controller_case():
    c = blk(-PROF_X - 10 - 34, -PROF_X - 12, -138, -38, 2, 72)
    c = safe_fillet(c, "|X", 4)
    fan = cyl("x", (0, -88, 37), 38, -PROF_X - 10 - 36, -PROF_X - 10 - 34)
    return c.union(fan)


# ---------- spindle-tilt phone mounts (printed, clamp in the table T-slots) ----------
# Local frame: camera on the phone back at (0, 0, CAM_Z), spindle at local -X, phone
# lying landscape in the YZ plane (x 0..9, length along -Y, camera 11 mm from its end).
CAM_D = 100.0             # camera to spindle axis
PH_L, PH_H, PH_T = 160, 76, 9
PH_Z0 = 88.0              # phone bottom edge (cradle ledge 2 mm above the table)
CAM_Z = PH_Z0 + 11        # ~camera centre height
MOUNTS = {                # world offset of the local origin and rotation about Z
    "R": ((CX + CAM_D, SP_Y, 0), 0),       # right end of the table, looking along -X
    "F": ((CX, SP_Y - CAM_D, 0), -90),     # front of the table, looking along +Y
}


def place(shape, kind):
    (dx, dy, dz), rz = MOUNTS[kind]
    return shape.rotate((0, 0, 0), (0, 0, 1), rz).translate((dx, dy, dz))


def phone_mount(kind):
    zt = PH_Z0 + PH_H                                            # phone top
    m = blk(-3, 0, -26, 14, PH_Z0 - 3, zt + 6)                    # back plate (camera side)
    m = m.union(blk(-3, 11, -26, 14, PH_Z0 - 3, PH_Z0))           # ledge under the phone
    m = m.union(blk(9, 11, -26, 11, PH_Z0, PH_Z0 + 5))            # front lip, bottom
    m = m.union(blk(9, 11, -26, 11, zt - 5, zt))                  # front lip, top
    m = m.union(blk(-3, 11, 11, 14, PH_Z0 - 3, zt + 6))           # end stop (locates the camera)
    if kind == "R":
        m = m.union(blk(-3, 11, -26, 14, zt, zt + 6))             # top bridge
        m = m.union(blk(-3, 28, -20, -4, zt, zt + 6))             # arm
        post = safe_fillet(blk(12, 28, -20, -4, 90, zt + 1), "|Z", 3)
        foot = safe_fillet(blk(12, 42, -20, 20, 83, 91), "|Z", 4)
        slot = blk(17.25, 22.75, -2, 16, 82, 92)                  # M5 slot over the x=120 T-slot
        bore = (20, -12)
    else:
        m = m.union(blk(-3, 11, -88, 14, zt, zt + 6))             # top bridge
        m = m.union(blk(-52, -3, -88, -72, zt, zt + 6))           # arm
        post = safe_fillet(blk(-52, -36, -88, -72, 90, zt + 1), "|Z", 3)
        foot = safe_fillet(blk(-76, -36, -95, -65, 83, 91), "|Z", 4)
        slot = blk(-74, -60, -82.75, -77.25, 82, 92)              # M5 slot over the x=-80 T-slot
        bore = (-44, -80)
    m = m.union(post).union(foot)
    m = m.cut(slot)
    m = m.cut(cyl("z", (bore[0], bore[1], 0), 9, 86, zt - 4))    # lighten the post (sealed core)
    m = m.cut(blk(-4, 1, -12, 12, PH_Z0 + 1, PH_Z0 + 25))         # camera window
    return place(m, kind)


def phone(kind):
    p = blk(0, PH_T, -PH_L + 11, 11, PH_Z0, PH_Z0 + PH_H)
    p = safe_fillet(p, "|X", 8)
    p = p.union(blk(-1.2, 0, -7, 7, CAM_Z - 7, CAM_Z + 7))        # camera bump
    return place(p, kind)


MOUNT_SCREW = {"R": (20, 7), "F": (-67, -80)}                    # local x, y of the M5 screw


def screw_at(kind):
    lx, ly = MOUNT_SCREW[kind]
    v = place(cq.Workplane("XY").box(1, 1, 1).translate((lx, ly, 0)), kind).val().Center()
    return (round(v.x, 2), round(v.y, 2), 91)


# ---------- spindle marker stickers ----------
DOT_Z = (ZC - 21, ZC + 19)   # two dots 40 mm apart, either side of the clamp ring


def marker_band(z0, z1):
    return tube("z", (CX, SP_Y, 0), 44, 42, z0, z1)


def marker_dots():
    d = None
    for z in DOT_Z:
        for ang in (0, 90, 180, 270):
            dot = cyl("x", (0, SP_Y, z), 6, CX + 21.9, CX + 22.4).rotate((CX, SP_Y, 0), (CX, SP_Y, 1), ang)
            d = dot if d is None else d.union(dot)
    return d


def collet_dot():
    return cyl("x", (0, SP_Y, ZC - 56), 4, CX + 9.2, CX + 9.8).rotate((CX, SP_Y, 0), (CX, SP_Y, 1), -45)


def parts():
    out = []

    def ext(nm, s, prof, L):
        return dict(name=nm, shape=s, group="case", process="extrusion", color=ALU,
                    params={"profile": prof, "length_mm": L, "tapped_ends": 2})

    # ---- base ----
    for i, sx in enumerate((-1, 1)):
        out.append(ext(f"Base profile 2040 {'LR'[i]}",
                       fab.extrusion(PROF_L, "2040", "y", (sx * PROF_X, -YP, 20)), "2040", PROF_L))
    out.append(acrylic("Plate A inner", end_plate(-YP - T, -YP, False)))
    out.append(acrylic("Plate A outer", end_plate(-YP - PT, -YP - T, False)))
    out.append(acrylic("Plate B inner", end_plate(YP, YP + T, True)))
    out.append(acrylic("Plate B outer", end_plate(YP + T, YP + PT, True)))
    for sx in (-1, 1):
        out.append(comp("Y rail 10 x 290", cyl("y", (sx * Y_RAIL_X, 0, Y_RAIL_Z), 10, -YP - T, YP + T),
                        "#d9dde2"))
    out.append(part("bearing_608", at=(0, -YP - 0.5, Y_SCREW_Z), rot=(90, 0, 0)))
    out.append(comp("Y lead screw 295", cyl("y", (0, 0, Y_SCREW_Z), 8, -YP - 6, -YP - 6 + 295), "#b0b4b8"))
    out.append(comp("Shaft coupler (Y)", coupler("y", (0, 0, Y_SCREW_Z), YP - 22)))
    out.append({**part("nema17_40", at=(0, YP + PT, Y_SCREW_Z), rot=(90, 0, 0)), "name": "Y motor"})

    # worktable carriage (moves in Y)
    out.append(comp("Worktable 300 x 180 T-slot", worktable(), ALU, id="Worktable", material="aluminium"))
    for sx in (-1, 1):
        for sy in (-1, 1):
            k = f"Slider {'LR'[sx > 0]}{'FB'[sy > 0]}"
            out.append(comp("Slider SC10UU", slider(sx * Y_RAIL_X, BY + sy * 55), ALU, id=k))
    out.append(made("Y nut seat", y_nut_seat(), id="Y nut seat"))
    out.append(comp("Copper nut (Y)", tube("y", (0, 0, Y_SCREW_Z), 22, 8.2, BY + 10, BY + 13).union(
        tube("y", (0, 0, Y_SCREW_Z), 10.2, 8.2, BY - 10, BY + 10)), "#c9a227", id="Y nut"))

    # ---- gantry ----
    out.append(acrylic("Pillar C inner (left)", pillar_layer(-PIL_X - T, False)))
    out.append(acrylic("Pillar C outer (left)", pillar_layer(-PIL_X - PT, False)))
    out.append(acrylic("Pillar D inner (right)", pillar_layer(PIL_X, True)))
    out.append(acrylic("Pillar D outer (right)", pillar_layer(PIL_X + T, True)))
    for nm, z in (("Gantry profile 2020 lower", 110), ("Gantry profile 2020 upper", 210)):
        out.append(ext(nm, fab.extrusion(360, "2020", "x", (-PIL_X, 90, z)), "2020", 360))
    for z in X_RAIL_Z:
        out.append(comp("X rail 10 x 360", cyl("x", (0, X_RAIL_Y, z), 10, -PIL_X, PIL_X), "#d9dde2"))
    out.append(part("bearing_608", at=(-PIL_X - PT + 0.5, X_RAIL_Y, X_SCREW_Z), rot=(0, 90, 0)))
    out.append(comp("X lead screw 365", cyl("x", (0, X_RAIL_Y, X_SCREW_Z), 8, -PIL_X - PT + 2, -PIL_X - PT + 367),
                    "#b0b4b8"))
    out.append(comp("Shaft coupler (X)", coupler("x", (0, X_RAIL_Y, X_SCREW_Z), PIL_X - 18)))
    out.append({**part("nema17_40", at=(PIL_X + PT, X_RAIL_Y, X_SCREW_Z), rot=(0, -90, 0)), "name": "X motor"})

    # ---- X-Z assembly (moves in X) ----
    out.append(made("X-Z block", xz_block(), id="X-Z block"))
    x_ids = ["X-Z block"]
    for sx in (-1, 1):
        for z in X_RAIL_Z:
            for dx in (-24, 24):
                k = f"LM10UU X {sx}{z}{dx}"
            # one pair of bearings per housing, shown as a single sleeve
        pass
    for z in X_RAIL_Z:
        k = f"LM10UU X {z}"
        out.append(comp("LM10UU bearing (X, pair)", tube("x", (0, X_RAIL_Y, z), 19, 10.2, CX - 38, CX + 38),
                        "#8d9196", id=k))
        x_ids.append(k)
    out.append(comp("Copper nut (X)", tube("x", (0, X_RAIL_Y, X_SCREW_Z), 10.2, 8.2, CX - 14, CX + 14),
                    "#c9a227", id="X nut"))
    x_ids.append("X nut")
    for sx in (-1, 1):
        k = f"Z rod {sx}"
        out.append(comp("Z rod 10 x 100", cyl("z", (CX + sx * Z_ROD_X, Z_ROD_Y, 0), 10, ARM_B[1] - 4, ARM_T[0] + 4),
                        "#d9dde2", id=k))
        x_ids.append(k)
    out.append(comp("Z lead screw 100", cyl("z", (CX, Z_ROD_Y, 0), 8, ARM_B[0] - 4, ARM_B[0] + 96), "#b0b4b8",
                    id="Z screw"))
    out.append(comp("Shaft coupler (Z)", coupler("z", (CX, Z_ROD_Y, 0), ARM_T[1] - 26), id="Z coupler"))
    out.append({**part("nema17_40", at=(CX, Z_ROD_Y, ARM_T[1]), rot=(180, 0, 0)), "name": "Z motor", "id": "Z motor"})
    x_ids += ["Z screw", "Z coupler", "Z motor"]

    # ---- Z slide + spindle (moves in X and Z) ----
    z_ids = []
    out.append(made("Z slide / spindle holder", z_slide(), id="Z slide"))
    for sx in (-1, 1):
        k = f"LM10UU Z {sx}"
        out.append(comp("LM10UU bearing (Z)", tube("z", (CX + sx * Z_ROD_X, Z_ROD_Y, 0), 19, 10.2, ZC - 15, ZC + 14),
                        "#8d9196", id=k))
        z_ids.append(k)
    out.append(comp("Copper nut (Z)", tube("z", (CX, Z_ROD_Y, 0), 10.2, 8.2, ZC - 20, ZC + 20), "#c9a227",
                    id="Z nut"))
    out.append(comp("775 spindle 24 V", spindle(), "#2b2b2b", id="Spindle"))
    out.append(comp("ER11 extension + bit", collet(), "#b9bdc2", id="Collet"))
    z_ids += ["Z slide", "Z nut", "Spindle", "Collet"]

    # ---- spindle tilt markers (move with the spindle) ----
    out.append(comp("Spindle marker band lower", marker_band(ZC - 28, ZC - 14), "#f2f2f2", id="Band lower"))
    out.append(comp("Spindle marker band upper", marker_band(ZC + 14, ZC + 34), "#f2f2f2", id="Band upper"))
    out.append(comp("Marker dots", marker_dots(), "#111111", id="Marker dots", pieces=8))
    out.append(comp("Collet marker dot", collet_dot(), "#111111", id="Collet dot"))
    z_ids += ["Band lower", "Band upper", "Marker dots", "Collet dot"]

    # ---- phone mounts on the table (move with the table) ----
    for k, face in (("R", "+x"), ("F", "-y")):
        out.append(made(f"Phone mount {k}", phone_mount(k), id=f"Phone mount {k}", color="#e8590c"))
        out.append(comp(f"Phone {k} (yours)", phone(k), "#2c2c30", id=f"Phone {k}",
                        fx={"screen": {"text": "tilt cam", "fg": "#ffffff", "bg": "#101418", "face": face}}))
        out.append({**part("m5x12_bhcs", at=screw_at(k)), "id": f"Mount screw {k}"})
        BED_IDS_EXTRA.extend([f"Phone mount {k}", f"Phone {k}", f"Mount screw {k}"])

    # ---- electronics ----
    out.append(comp("GRBL controller board", controller_case(), "#202022"))
    out.append(comp("Offline controller (GRBL handheld)",
                    safe_fillet(blk(215, 275, -200, -95, 0, 22), "|Z", 8), "#2a2a2c",
                    fx={"screen": {"text": "X 0.00\nY 0.00", "fg": "#33ccff", "bg": "#000000"}}))

    global X_IDS, Z_IDS
    X_IDS, Z_IDS = x_ids, z_ids
    return out


TOUCHING = [
    ("Y lead screw 295", "Y motor"),
    ("X lead screw 365", "X motor"),
    ("Z lead screw 100", "Z motor"),
    ("Marker dots", "Spindle marker band lower"),
    ("Marker dots", "Spindle marker band upper"),
    ("Collet marker dot", "ER11 extension + bit"),
]

BED_IDS_EXTRA = []
BED_IDS = ["Worktable", "Slider LF", "Slider LB", "Slider RF", "Slider RB", "Y nut seat", "Y nut"]
X_IDS = []
Z_IDS = []


def motion():
    import math
    if not X_IDS:
        parts()

    def pose(t):
        a = 2 * math.pi * t
        y = 20 * math.sin(a)          # small moves so the spindle never reaches the phone mounts
        x = 30 * math.sin(2 * a)
        z = -20 * (1 - math.cos(a)) / 2
        tf = {k: move((0, y, 0)) for k in BED_IDS + BED_IDS_EXTRA}
        tf.update({k: move((x, 0, 0)) for k in X_IDS})
        tf.update({k: move((x, 0, z)) for k in Z_IDS})
        return tf
    return {"duration": 6, "pose": pose}

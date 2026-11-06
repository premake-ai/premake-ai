"""CNCTOPBAOS-style 1610 PRO desktop CNC router (smaller sibling of the 3018 design).

Reference model for structural simulation: dimensions follow the owner's measured spec.
x right, y back, z up; origin = frame centre on the table. Built pose: carriage centred in X,
bed centred in Y, Z at its lowest (cutter tip on the bed top).
"""
import math

import cadquery as cq
from cadlib.parts import part
from cadlib.refmodels import ref
from cadlib.shapes import safe_fillet
from cadlib import fab
from cadlib.motion import move, link

SCENE = "desk"

# ---------------------------------------------------------------- key dimensions (mm)
END_W, END_H, END_T, END_Y = 250.0, 46.0, 10.0, 110.0      # phenolic end plates, centres at y = +-110
RAIL_X, RAIL_Z, RAIL_L = 112.5, 26.0, 210.0                  # 2040 base rails (centre)
YROD_X, YROD_Z, ROD10 = 56.5, 25.0, 10.0                     # Y rods
BED_W, BED_D, BED_T, BED_Z = 180.0, 100.0, 15.0, 46.0        # T-slot bed, bottom at z = 46
GP_X, GP_T = 127.5, 10.0                                      # gantry side plate centre x, thickness
GP_IN = GP_X - GP_T / 2                                       # 122.5: inner face
FOOT_Y = (18.0, 105.0)
UP_Y = (55.5, 137.5)
GP_TOP = 250.0
XROD_Y, XROD_Z = 77.7, (140.0, 212.5)                        # X rods
PROF_Y, PROF_Z = 105.7, (140.0, 216.0)                       # 2020 gantry profiles
XSCR_Z = 176.6                                                # X lead screw
ZROD_Y, ZROD_DX, ZROD_Z = 45.8, 19.0, (104.0, 204.0)         # Z rods 8 x 100
SP_Y, SP_D = 2.7, 45.0                                        # spindle axis y, 775 can diameter
TIP_Z = BED_Z + BED_T                                         # 61: cutter tip at lowest Z
SLIDER_H = 38.0                                               # Z slider height (2 x LM8SUU 17 + nut flange)
Z_TRAVEL = 45.0                                               # slider top 148 -> Z coupler bottom 193
BED_YC = SP_Y                                                 # bed centre y in the rest pose (under the spindle)
Z_COUPLER_Z = 193.0                                           # Z coupler bottom; screw top 202 sits 9 mm in its 8 mm bore

PHENOLIC = "#1b1b1b"
ALU = "#c4c8cc"
STEEL = "#d8dadc"
BRASS = "#c9a24a"
PETG_BLACK = "#2a2a2a"

# Real-machine materials (the viewer has no preset for these, so it warns and skips the look; the field stays in parts())
PHENOLIC_MAT = "phenolic"          # 10 mm black phenolic (Bakelite) sheet, CNC-routed
NYLON_MAT = "nylon_pa"             # injection-moulded nylon (PA)


# ---------------------------------------------------------------- helpers
def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def cyl(d, p0, axis, length):
    v = {"x": (1, 0, 0), "y": (0, 1, 0), "z": (0, 0, 1)}[axis]
    return cq.Workplane("XY", obj=cq.Solid.makeCylinder(d / 2, length, cq.Vector(*p0), cq.Vector(*v)))


def tube(od, idia, p0, axis, length):
    return cyl(od, p0, axis, length).cut(cyl(idia, p0, axis, length))


def ab_nut(p0, axis, sign=1):
    """T8 brass anti-backlash nut: flange (22 x 3.5) at p0 facing outward, then body, spring, second nut along
    `sign` * axis. 8 mm bore (the screw runs through it)."""
    i = "xyz".index(axis)

    def at(off):
        p = list(p0)
        p[i] += off * sign
        return tuple(p)

    def seg(od, a, b):
        lo = min(a, b)
        return tube(od, 8.0, at(lo) if sign > 0 else at(max(a, b)), axis, abs(b - a))

    n = seg(22.0, -3.5, 0.0).union(seg(10.2, 0.0, 15.0)).union(seg(11.0, 15.0, 21.0)).union(seg(14.0, 21.0, 29.0))
    return n


def coupler(p0, axis, length=25.0, screw_len=10.0):
    """5 x 8 mm flexible coupler, 19 dia; 8 mm bore from p0 (screw side), 5 mm bore the rest (motor side)."""
    i = "xyz".index(axis)
    c = cyl(19.0, p0, axis, length).cut(cyl(8.0, p0, axis, screw_len))
    p1 = list(p0)
    p1[i] += screw_len
    return c.cut(cyl(5.0, tuple(p1), axis, length - screw_len))


def rot_y_pts(pts):
    return pts


# ---------------------------------------------------------------- base
def end_plate(front):
    yc = -END_Y if front else END_Y
    p = box(-END_W / 2, END_W / 2, yc - END_T / 2, yc + END_T / 2, 0, END_H)
    p = safe_fillet(p, "|Y", 3)
    y0 = yc - END_T / 2
    p = p.cut(cyl(22.4 if front else 22.6, (0, y0, YROD_Z), "y", END_T))          # 608 bearing / motor boss
    for s in (-1, 1):
        for z in (RAIL_Z - 10, RAIL_Z + 10):
            p = p.cut(cyl(5.5, (s * RAIL_X, y0, z), "y", END_T))                   # M5 into rail end taps
        if not front:
            for dz in (-15.5, 15.5):
                p = p.cut(cyl(3.4, (s * 15.5, y0, YROD_Z + dz), "y", END_T))       # NEMA17 screws
    return p


def gantry_plate(sign):
    pts = [(FOOT_Y[0], 0), (FOOT_Y[1], 0), (FOOT_Y[1], 85), (UP_Y[1], 117.5), (UP_Y[1], GP_TOP),
           (UP_Y[0], GP_TOP), (UP_Y[0], 122.5), (FOOT_Y[0], 85)]
    p = cq.Workplane("YZ").polyline(pts).close().extrude(GP_T).translate((GP_X * sign - GP_T / 2, 0, 0))
    p = safe_fillet(p, "|X", 4)
    x0 = GP_X * sign - GP_T / 2
    for z in PROF_Z:
        p = p.cut(cyl(5.5, (x0, PROF_Y, z), "x", GP_T))                            # M5 into 2020 end taps
    for y in (40.0, 85.0):
        for z in (RAIL_Z - 10, RAIL_Z + 10):
            p = p.cut(cyl(5.5, (x0, y, z), "x", GP_T))                             # M5 + T-nut into rail slots
    if sign > 0:
        p = p.cut(cyl(22.6, (x0, XROD_Y, XSCR_Z), "x", GP_T))                      # motor boss / shaft
        for dy in (-15.5, 15.5):
            for dz in (-15.5, 15.5):
                p = p.cut(cyl(3.4, (x0, XROD_Y + dy, XSCR_Z + dz), "x", GP_T))
    else:
        p = p.cut(cyl(22.0, (x0, XROD_Y, XSCR_Z), "x", GP_T))                      # 608 bearing seat
    return p


def bed():
    b = box(-BED_W / 2, BED_W / 2, -BED_D / 2, BED_D / 2, BED_Z, BED_Z + BED_T)
    top = BED_Z + BED_T
    for y in (-37.5, -12.5, 12.5, 37.5):                                           # 4 T-slots along X, 25 pitch
        b = b.cut(box(-BED_W / 2, BED_W / 2, y - 3, y + 3, top - 3, top))
        b = b.cut(box(-BED_W / 2, BED_W / 2, y - 5.5, y + 5.5, top - 8, top - 3))
    return b


def y_block():
    """SC10UU-style slider block with LM10UU, bore on the rod, top bolted to the bed."""
    out = None
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * YROD_X, sy * 35.0
            blk = safe_fillet(box(x - 17, x + 17, y - 15, y + 15, 12, BED_Z), "|Y", 2)
            blk = blk.cut(cyl(ROD10, (x, y - 15, YROD_Z), "y", 30))
            out = blk if out is None else out.union(blk)
    return out


def y_nut_mount():
    m = box(-15, 15, -10, 10, 14, BED_Z)
    m = safe_fillet(m, "|Y", 2)
    return m.cut(cyl(10.5, (0, -10, YROD_Z), "y", 20)).cut(cyl(14.5, (0, 8, YROD_Z), "y", 2))


# ---------------------------------------------------------------- X / Z carriage
def carriage():
    c = box(-35, 35, 60, 95, 98, 226)
    c = c.union(box(-30, 30, 34, 61, 98, 110)).union(box(-30, 30, 25, 61, 198, 226))
    c = safe_fillet(c, "|Z", 3)
    for z in XROD_Z:
        c = c.cut(cyl(19.0, (-35, XROD_Y, z), "x", 70))                            # 2 x LM10UU per rod
    c = c.cut(cyl(14.5, (-35, XROD_Y, XSCR_Z), "x", 70))                           # X nut + screw
    for s in (-1, 1):
        c = c.cut(cyl(8.0, (s * ZROD_DX, ZROD_Y, 98), "z", 128))                   # Z rods
    c = c.cut(cyl(8.2, (0, ZROD_Y, 98), "z", 12))                                  # Z screw foot
    c = c.cut(cyl(21.0, (0, ZROD_Y, 190), "z", 40))                                # coupler bore
    c = c.cut(cyl(2 * 25.6, (0, SP_Y, 190), "z", 40))                              # spindle / marker band relief
    for dx in (-15.5, 15.5):
        for dy in (-15.5, 15.5):
            c = c.cut(cyl(3.4, (dx, ZROD_Y + dy, 198), "z", 28))
            c = c.cut(cyl(6.5, (dx, ZROD_Y + dy, 198), "z", 4))                    # counterbores
            if dy > 0:
                c = c.cut(cyl(7.0, (dx, ZROD_Y + dy, 98), "z", 100))               # hex key access from below
    for x, y in SADDLE_SCREWS:
        c = c.cut(cyl(fab.pilot(3), (x, y, 217), "z", 9))                          # drilled for the tilt-rig saddle
    return c


def z_slider(z0):
    h = SLIDER_H
    s = box(-30, 30, 34, 59.5, z0, z0 + h)
    ring = cyl(57.0, (0, SP_Y, z0), "z", h)
    ears = box(-10, 10, -37, -20, z0, z0 + h)
    web = box(-16, 16, 20, 35, z0, z0 + h)
    s = s.union(ring).union(ears).union(web)
    s = safe_fillet(s, "|Z", 2)
    s = s.cut(cyl(SP_D, (0, SP_Y, z0), "z", h))                                    # spindle clamp bore
    s = s.cut(box(-1, 1, -38, -19, z0, z0 + h))                                    # clamp slit
    s = s.cut(cyl(4.5, (-11, -29, z0 + h / 2), "x", 22))                           # M4 clamp bolt
    for sx in (-1, 1):
        s = s.cut(cyl(15.0, (sx * ZROD_DX, ZROD_Y, z0), "z", 34))                  # 2 x LM8SUU per rod, stacked
        s = s.cut(cyl(8.6, (sx * ZROD_DX, ZROD_Y, z0), "z", h))                    # rod clearance above them
    s = s.cut(cyl(14.5, (0, ZROD_Y, z0), "z", h - 3.5))                            # nut body / spring
    s = s.cut(cyl(22.5, (0, ZROD_Y, z0 + h - 3.5), "z", 3.5))                      # nut flange pocket
    return s


def marker_band(z0, h=22.0):
    b = tube(49.4, 45.4, (0, SP_Y, z0), "z", h)
    for row, zc in enumerate((z0 + 5.5, z0 + h - 5.5)):
        for k in range(12):
            a = math.radians(k * 30 + row * 15)
            d = cq.Workplane("XY", obj=cq.Solid.makeCylinder(3.0, 10, cq.Vector(0, SP_Y, zc) + cq.Vector(math.cos(a), math.sin(a), 0) * 20,
                                                            cq.Vector(math.cos(a), math.sin(a), 0)))
            b = b.cut(d)
    return b


# ---------------------------------------------------------------- phone mounts (clamp on the bed edge)
def phone_mount_front():
    m = box(-30, 30, -55, -50, 38, 66)                                             # spine on the bed front face
    m = m.union(box(-30, 30, -55, -40, 61, 66))                                    # top jaw on the bed top
    m = m.union(box(-30, 30, -55, -40, 38, 43))                                    # lower jaw (thumb screw)
    m = m.union(box(-30, 30, -69, -54, 47.3, 50.3))                                # phone ledge
    m = m.union(box(-30, 30, -69, -66, 47.3, 60))                                  # front lip
    m = safe_fillet(m, "|Y", 1.5)
    return m.cut(cyl(fab.pilot(4), (0, -46, 38), "z", 5))


def phone_mount_left():
    m = box(-95, -90, -30, 30, 38, 66)
    m = m.union(box(-95, -80, -30, 30, 61, 66))
    m = m.union(box(-95, -80, -30, 30, 38, 43))
    m = m.union(box(-109, -94, -30, 30, 47.3, 50.3))
    m = m.union(box(-109, -106, -30, 30, 47.3, 60))
    m = safe_fillet(m, "|X", 1.5)
    return m.cut(cyl(fab.pilot(4), (-86, 0, 38), "z", 5))


# ---------------------------------------------------------------- controller case on the back of the 2020s
CASE = (-95.0, -5.0, PROF_Y + 10, PROF_Y + 38, 130.0, 226.0)                       # x0 x1 y0 y1 z0 z1
CASE_WALL = 2.5
CASE_BACK = 5.0                                                                     # back wall: M5x8 = 5 wall + 3 in the slot
STANDOFFS = [(-80, 150), (-20, 150), (-80, 200), (-20, 200)]


def controller_case():
    x0, x1, y0, y1, z0, z1 = CASE
    c = safe_fillet(box(x0, x1, y0, y1, z0, z1), "|Y", 4)
    c = c.cut(box(x0 + CASE_WALL, x1 - CASE_WALL, y0 + CASE_BACK, y1 + 1, z0 + CASE_WALL, z1 - CASE_WALL))
    for x, z in STANDOFFS:
        c = c.union(cyl(6.5, (x, y0 + CASE_BACK - 1, z), "y", 5.0))
        c = c.cut(cyl(fab.pilot(3), (x, y0 + 3.5, z), "y", 5.5))
    for x, z in ((x0 + 6, z0 + 6), (x1 - 6, z0 + 6), (x0 + 6, z1 - 6), (x1 - 6, z1 - 6)):
        c = c.union(cyl(7.5, (x, y0 + 1, z), "y", y1 - y0 - 1).intersect(box(x0, x1, y0, y1, z0, z1)))
        c = c.cut(cyl(fab.pilot(3), (x, y1 - 8, z), "y", 8))
    for x in (-75.0, -25.0):
        for z in PROF_Z:
            c = c.cut(cyl(5.5, (x, y0, z), "y", CASE_BACK))                       # M5 into the 2020 slots
    c = c.cut(box(x0, x0 + CASE_WALL, 160, 173, 158 - 10, 0) if False else box(x0, x0 + CASE_WALL, y0 + 8, y0 + 22, 158, 172))  # USB-B
    c = c.cut(box(x1 - CASE_WALL, x1, y0 + 6, y0 + 22, 140, 160))                 # motor / power cables
    return c


def controller_cover():
    x0, x1, y0, y1, z0, z1 = CASE
    c = safe_fillet(box(x0, x1, y1, y1 + 2.5, z0, z1), "|Y", 4)
    for x, z in ((x0 + 6, z0 + 6), (x1 - 6, z0 + 6), (x0 + 6, z1 - 6), (x1 - 6, z1 - 6)):
        c = c.cut(cyl(3.4, (x, y1, z), "y", 2.5))
    for k in range(6):                                                              # vent slots
        c = c.cut(box(-80 + k * 12, -74 + k * 12, y1, y1 + 2.5, 160, 200))
    return c


# ---------------------------------------------------------------- spindle tilt rig (Z-motor saddle + lever rod)
# A dense printed saddle wraps the Z motor and screws into the carriage top; its top plate carries both pull motors.
# An 8 mm steel lever rod is clamped in a dense sleeve on the spindle can (the sleeve also carries the dot band) and
# rises through a shuttle (LM8UU) held by the cords at plate height, so Z can travel freely. X motor pulls the
# shuttle +X, Y motor pulls +Y; extension springs pull back -X / -Y, so each axis tilts both ways.
SADDLE_SCREWS = [(-30, 63.5), (-30, 91), (30, 91), (-12, 92), (12, 92)]   # M3 self-taps into the carriage top
PLATE_Z = (260.8, 272.0)                  # saddle top plate (Z motor top at 260.6)
ROD_XY = (40.0, SP_Y)                     # lever rod, beside the spindle on +X (clear of the carriage top arm)
ROD_Z = (150.0, 300.0)                    # 8 x 150 mm rod at lowest Z
CORD_Z = 255.0                            # cord / spring plane (under the plate)
SPOOL_R = 8.0                             # spool core radius
XMOTOR_XY = (85.0, SP_Y - SPOOL_R)        # spool tangent on the rod's y line
YMOTOR_XY = (ROD_XY[0] + SPOOL_R, 47.7)   # spool tangent on the rod's x line
SLEEVE_Z = (150.0, 179.0)                 # lever sleeve on the can (replaces the separate dot band)
TB = (10.0, 80.0, PROF_Y + 10, PROF_Y + 44, 130.0, 226.0)                          # tilt driver box x0 x1 y0 y1 z0 z1
TB_STANDOFFS = [(23, 143), (67, 143), (23, 213), (67, 213)]


def seg(d, a, b):
    """Cylinder of diameter d from point a to point b."""
    va, vb = cq.Vector(*a), cq.Vector(*b)
    return cq.Workplane("XY", obj=cq.Solid.makeCylinder(d / 2, (vb - va).Length, va, (vb - va).normalized()))


def zmotor_saddle():
    """Dense printed saddle: sleeve round the Z motor, flange screwed to the carriage top, top plate with both
    pull motors, the shuttle opening and the two return-spring anchors. Print at 100 % infill."""
    p0, p1 = PLATE_Z
    rx, ry = ROD_XY
    F = lambda b, r=3: safe_fillet(b, "|Z", r)
    s = F(box(-27.3, 27.3, 18.5, 73.1, 226, p1))                                   # sleeve round the Z motor
    s = s.union(F(box(-33, 33, 73.1, 95, 226, 234))).union(box(-33, -26.3, 55, 74.1, 226, 234))  # carriage flange
    s = s.union(F(box(-15, 106, -52, 19.5, p0, p1), 6)).union(F(box(27, 69, 18.5, 69, p0, p1)))  # top plate
    s = s.union(box(-14, -6, ry - 4, ry + 4, CORD_Z - 6, p0 + 0.5))                # -X spring anchor
    s = s.union(box(rx - 4, rx + 4, -51, -43, CORD_Z - 6, p0 + 0.5))               # -Y spring anchor
    s = s.cut(box(-21.3, 21.3, 24.5, 67.1, 226, p0))                               # Z motor pocket
    s = s.cut(box(-8, 8, 66, 74, 245, p0))                                         # Z motor connector + cable
    s = s.cut(cyl(36, (rx, ry, p0 - 1), "z", p1 - p0 + 2))                         # shuttle opening
    s = s.cut(cyl(3, (-10, ry - 5, CORD_Z), "y", 10)).cut(cyl(3, (rx - 5, -47, CORD_Z), "x", 10))
    for mx, my in (XMOTOR_XY, YMOTOR_XY):
        s = s.cut(cyl(22.6, (mx, my, p0), "z", p1 - p0))
        for dx in (-15.5, 15.5):
            for dy in (-15.5, 15.5):
                s = s.cut(cyl(3.4, (mx + dx, my + dy, p0), "z", p1 - p0))
    for x, y in SADDLE_SCREWS:
        s = s.cut(cyl(3.4, (x, y, 226), "z", 8))
    return s


def lever_sleeve():
    """Dense clamp sleeve on the spindle can with the dot band and the lever-rod lug (+X). One slit through the lug
    clamps both the can and the rod with two M4 bolts."""
    z0, z1 = SLEEVE_Z
    rx, ry = ROD_XY
    s = cyl(51, (0, SP_Y, z0), "z", z1 - z0).union(box(22, 54, SP_Y - 7, SP_Y + 7, z0, z1))
    s = safe_fillet(s, "|Z", 2)
    s = s.cut(cyl(45.2, (0, SP_Y, z0), "z", z1 - z0)).cut(cyl(8.0, (rx, ry, z0), "z", z1 - z0))
    s = s.cut(box(21, 55, SP_Y - 0.6, SP_Y + 0.6, z0, z1))                         # clamp slit
    for x in (30.0, 49.5):
        for z in (z0 + 7, z1 - 7):
            s = s.cut(cyl(4.5, (x, SP_Y - 7, z), "y", 14))
    for row, zc in enumerate((z0 + 7.5, z0 + 21.5)):                               # dot band (dark can shows through)
        for k in range(12):
            ang = k * 30 + row * 15
            if ang % 360 < 40 or ang % 360 > 320:
                continue                                                           # lug side
            a = math.radians(ang)
            d = cq.Vector(math.cos(a), math.sin(a), 0)
            s = s.cut(cq.Workplane("XY", obj=cq.Solid.makeCylinder(3.0, 10, cq.Vector(0, SP_Y, zc) + d * 20, d)))
    return s


def shuttle():
    """Shuttle round the lever rod (LM8UU inside); cords and springs hook to its four eyes."""
    rx, ry = ROD_XY
    s = cyl(23, (rx, ry, 243), "z", 25)
    for x0, x1, y0, y1 in ((rx + 9, rx + 17, ry - 3, ry + 3), (rx - 17, rx - 9, ry - 3, ry + 3),
                           (rx - 3, rx + 3, ry + 9, ry + 17), (rx - 3, rx + 3, ry - 17, ry - 9)):
        s = s.union(box(x0, x1, y0, y1, CORD_Z - 3, CORD_Z + 3))
    s = s.cut(cyl(15, (rx, ry, 244), "z", 24)).cut(cyl(8.6, (rx, ry, 243), "z", 1))
    for x, y in ((rx + 14, ry), (rx - 14, ry), (rx, ry + 14), (rx, ry - 14)):
        s = s.cut(cyl(2.5, (x, y, CORD_Z - 3), "z", 6))
    return s


def spool(axis, c):
    """Cord spool on a 5 mm shaft: core 16 dia between 24 mm flanges, hub toward the motor. c = core centre."""
    i = "xyz".index(axis)

    def at(off):
        p = list(c)
        p[i] += off
        return tuple(p)
    s = cyl(24, at(-5), axis, 1.5).union(cyl(2 * SPOOL_R, at(-3.5), axis, 7)).union(cyl(24, at(3.5), axis, 1.5))
    s = s.union(cyl(11, at(5), axis, 5))
    return s.cut(cyl(5.0, at(-5), axis, 15))                                       # 5 mm bore, press on the D-shaft


def tray(c_, standoffs, mounts, ports):
    x0, x1, y0, y1, z0, z1 = c_
    c = safe_fillet(box(x0, x1, y0, y1, z0, z1), "|Y", 4)
    c = c.cut(box(x0 + CASE_WALL, x1 - CASE_WALL, y0 + CASE_BACK, y1 + 1, z0 + CASE_WALL, z1 - CASE_WALL))
    for x, z in standoffs:
        c = c.union(cyl(6.5, (x, y0 + CASE_BACK - 1, z), "y", 5.0))
        c = c.cut(cyl(fab.pilot(3), (x, y0 + 3.5, z), "y", 5.5))
    for x, z in ((x0 + 6, z0 + 6), (x1 - 6, z0 + 6), (x0 + 6, z1 - 6), (x1 - 6, z1 - 6)):
        c = c.union(cyl(7.5, (x, y0 + 1, z), "y", y1 - y0 - 1).intersect(box(x0, x1, y0, y1, z0, z1)))
        c = c.cut(cyl(fab.pilot(3), (x, y1 - 8, z), "y", 8))
    for x, z in mounts:
        c = c.cut(cyl(5.5, (x, y0, z), "y", CASE_BACK))
    for p in ports:
        c = c.cut(box(*p))
    return c


def tray_cover(c_):
    x0, x1, y0, y1, z0, z1 = c_
    c = safe_fillet(box(x0, x1, y1, y1 + 2.5, z0, z1), "|Y", 4)
    for x, z in ((x0 + 6, z0 + 6), (x1 - 6, z0 + 6), (x0 + 6, z1 - 6), (x1 - 6, z1 - 6)):
        c = c.cut(cyl(3.4, (x, y1, z), "y", 2.5))
    for k in range(4):
        c = c.cut(box(x0 + 15 + k * 12, x0 + 21 + k * 12, y1, y1 + 2.5, 150, 200))
    return c


def tilt_rig(out, X, Z):
    """Adds the tilt rig parts. X(d) / Z(d) register carriage-mounted / spindle-mounted parts."""
    rx, ry = ROD_XY
    p0, p1 = PLATE_Z
    DENSE = "#ececec"
    X(dict(name="Z motor saddle", shape=zmotor_saddle(), color=DENSE))
    X(part("m3x16_selftap", at=[(x, y, 234) for x, y in SADDLE_SCREWS], name="Saddle screw M3x16"))

    # pull motors on top of the saddle plate, shafts down; spools under the plate in the cord plane
    for (mx, my), n in ((XMOTOR_XY, "X"), (YMOTOR_XY, "Y")):
        X(part("nema17_34", at=(mx, my, p1), rot=(180, 0, 0), name=f"{n} pull motor"))
        X(part("m3x16_shcs", at=[(mx + dx, my + dy, p0) for dx in (-15.5, 15.5) for dy in (-15.5, 15.5)],
               rot=(180, 0, 0), name=f"{n} pull motor screw M3x16"))
        X(dict(name=f"{n} cord spool", shape=spool("z", (mx, my, CORD_Z)), color="#ff7a1a"))

    # shuttle on the lever rod, held at plate height by the cords (rod slides through it as Z moves)
    X(dict(name="Tilt shuttle", shape=shuttle(), color=DENSE))
    X(dict(name="LM8UU (shuttle)", shape=tube(15, 8, (rx, ry, 244), "z", 24), group="component", color=STEEL))
    X(dict(name="X tilt cord", group="component", color="#ff3b30",
           shape=seg(0.8, (rx + 17, ry, CORD_Z), (XMOTOR_XY[0], ry, CORD_Z))))
    X(dict(name="Y tilt cord", group="component", color="#ff3b30",
           shape=seg(0.8, (rx, ry + 17, CORD_Z), (rx, YMOTOR_XY[1], CORD_Z))))
    X(dict(name="X return spring", shape=cyl(7, (-6, ry, CORD_Z), "x", rx - 17 + 6), group="component", color=STEEL))
    X(dict(name="Y return spring", shape=cyl(7, (rx, -43, CORD_Z), "y", ry - 17 + 43), group="component", color=STEEL))

    # lever rod + clamp sleeve on the spindle (move with Z)
    Z(dict(name="Spindle lever sleeve (dot band)", shape=lever_sleeve(), color="#ffffff"))
    Z(dict(name="Lever rod 8x150", shape=cyl(8, (rx, ry, ROD_Z[0]), "z", ROD_Z[1] - ROD_Z[0]), group="component",
           color=STEEL))
    bolts = [(x, SP_Y + 7, z) for x in (30.0, 49.5) for z in (SLEEVE_Z[0] + 7, SLEEVE_Z[1] - 7)]
    Z(part("m4x20_shcs", at=bolts, rot=(-90, 0, 0), name="Sleeve clamp bolt M4x20"))
    Z(part("m4_nylock", at=[(x, SP_Y - 7, z) for x, _, z in bolts], rot=(90, 0, 0), name="Sleeve clamp nut M4"))

    # driver box on the back of the 2020s, right of the GRBL case
    x0, x1, y0, y1, z0, z1 = TB
    ports = [(x1 - CASE_WALL, x1, y0 + 17, y1, 185, 199),                          # micro-USB plug for the ESP32
             (30, 60, y0 + 8, y0 + 22, z0, z0 + CASE_WALL)]                         # motor + 12 V cables
    out.append(dict(name="Tilt driver box", shape=tray(TB, TB_STANDOFFS, [(45, PROF_Z[0]), (45, PROF_Z[1])], ports),
                    color="#e0e0e0"))
    out.append(dict(name="Tilt driver cover", shape=tray_cover(TB), color="#e0e0e0"))
    out.append(dict(name="Tilt perfboard", shape=box(20, 70, y0 + 9, y0 + 10.6, 140, 216), group="component",
                    color="#c8a165", material="pcb"))
    out.append(part("m3x6_selftap", at=[(x, y0 + 10.6, z) for x, z in TB_STANDOFFS], rot=(-90, 0, 0),
                    name="Perfboard screw M3x6"))
    out.append(part("m3x10_selftap", at=[(x, y1 + 2.5, z) for x, z in ((x0 + 6, z0 + 6), (x1 - 6, z0 + 6),
                                                                       (x0 + 6, z1 - 6), (x1 - 6, z1 - 6))],
                    rot=(-90, 0, 0), name="Tilt cover screw M3x10"))
    out.append(part("m5x8_bhcs", at=[(45, y0 + CASE_BACK, z) for z in PROF_Z], rot=(-90, 0, 0), name="Tilt box screw M5x8"))
    out.append(part("esp32_devkitc", at=(48.5, y0 + 19.1, 192), rot=(-90, 180, 0), name="Tilt ESP32"))
    out.append(part("tmc2209", at=(32, y0 + 19.1, 160), rot=(-90, 0, 0), name="X pull driver"))
    out.append(part("tmc2209", at=(58, y0 + 19.1, 160), rot=(-90, 0, 0), name="Y pull driver"))




# ---------------------------------------------------------------- parts
def parts():
    zl = ZROD_Z[0] + 6                     # 110: Z slider bottom at lowest Z
    out = []
    P = lambda **k: out.append(k)

    # base
    P(name="Front end plate", shape=end_plate(True), color=PHENOLIC, process="laser", material=PHENOLIC_MAT,
      params={"material": PHENOLIC_MAT, "thickness_mm": 10})
    P(name="Rear end plate", shape=end_plate(False), color=PHENOLIC, process="laser", material=PHENOLIC_MAT,
      params={"material": PHENOLIC_MAT, "thickness_mm": 10})
    for s, n in ((-1, "Left base rail"), (1, "Right base rail")):
        P(name=n, shape=fab.extrusion(RAIL_L, "2040", axis="y", at=(s * RAIL_X, -RAIL_L / 2, RAIL_Z)), color=ALU,
          process="extrusion", params={"profile": "2040", "length_mm": RAIL_L, "tapped_ends": 2})
    for s, n in ((-1, "Left Y rod"), (1, "Right Y rod")):
        P(name=n, shape=cyl(ROD10, (s * YROD_X, -105, YROD_Z), "y", 210), group="component", color=STEEL)
    P(name="Y lead screw", shape=cyl(8, (0, -112, YROD_Z), "y", 202), group="component", color=STEEL)
    P(name="Y coupler", shape=coupler((0, 80, YROD_Z), "y"), group="component", color=ALU)
    out.append(part("bearing_608", at=[(0, -105, YROD_Z), (-GP_IN, XROD_Y, XSCR_Z)], rot=[(90, 0, 0), (0, -90, 0)],
                    name="608 bearing"))
    out.append(part("nema17_34", at=(0, END_Y + END_T / 2, YROD_Z), rot=(90, 0, 0), name="Y motor"))
    out.append(part("m3x14_shcs", at=[(dx, END_Y - END_T / 2, YROD_Z + dz) for dx in (-15.5, 15.5) for dz in (-15.5, 15.5)],
                    rot=(90, 0, 0), name="Y motor screw M3x14"))
    out.append(part("m5x16_shcs", at=[(s * RAIL_X, sy * (END_Y + END_T / 2), RAIL_Z + dz) for s in (-1, 1)
                                      for sy in (-1, 1) for dz in (-10, 10)],
                    rot=[(90 if sy < 0 else -90, 0, 0) for s in (-1, 1) for sy in (-1, 1) for dz in (-10, 10)],
                    name="End plate screw M5x16"))

    # bed (moves in Y)
    bed_ids = []

    def B(**k):
        k["shape"] = k["shape"].translate((0, BED_YC, 0))                       # rest pose: bed centred under the spindle
        k["id"] = "bed:" + k["name"]
        bed_ids.append(k["id"])
        out.append(k)
    B(name="T-slot bed", shape=bed(), group="component", color=ALU, material="aluminium")
    B(name="Y slider block (SC10UU) x4", shape=y_block(), group="component", color=ALU, material="aluminium")
    B(name="Y nut mount", shape=y_nut_mount(), color=PETG_BLACK)
    B(name="Y anti-backlash nut", shape=ab_nut((0, -10, YROD_Z), "y", 1), group="component", color=BRASS)
    B(name="Phone mount (front)", shape=phone_mount_front(), color="#f2f2f2")
    B(name="Phone mount (side)", shape=phone_mount_left(), color="#f2f2f2")
    # landscape, rear camera facing the spindle; ref origin is the phone's bottom edge, so offset by half its length
    pf = ref("iphone_16", at=(-73.8, -60.25 + BED_YC, 86.5), rot=(0, 90, 0), name="Phone looking along Y (yours)")
    pl = ref("iphone_16", at=(-100.25, 73.8 + BED_YC, 86.5), rot=(0, 90, -90), name="Phone looking along X (yours)")
    th = part("m4x8_shcs", at=[(0, -46 + BED_YC, 38), (-86, BED_YC, 38)], rot=(180, 0, 0), name="Mount thumb screw M4x8")
    for d in (pf, pl, th):
        d["id"] = "bed:" + d["name"]
        bed_ids.append(d["id"])
        out.append(d)

    # gantry (fixed)
    for s, n in ((-1, "Left gantry plate"), (1, "Right gantry plate")):
        P(name=n, shape=gantry_plate(s), color=PHENOLIC, process="laser", material=PHENOLIC_MAT,
          params={"material": PHENOLIC_MAT, "thickness_mm": 10})
    for z, n in zip(XROD_Z, ("Lower X rod", "Upper X rod")):
        P(name=n, shape=cyl(ROD10, (-GP_IN, XROD_Y, z), "x", 2 * GP_IN), group="component", color=STEEL)
    for z, n in zip(PROF_Z, ("Lower gantry profile", "Upper gantry profile")):
        P(name=n, shape=fab.extrusion(2 * GP_IN, "2020", axis="x", at=(-GP_IN, PROF_Y, z)), color=ALU,
          process="extrusion", params={"profile": "2020", "length_mm": 2 * GP_IN, "tapped_ends": 2})
    P(name="X lead screw", shape=cyl(8, (-GP_IN - 7, XROD_Y, XSCR_Z), "x", GP_IN + 7 + 108), group="component", color=STEEL)
    P(name="X coupler", shape=coupler((98, XROD_Y, XSCR_Z), "x", 24.5), group="component", color=ALU)
    out.append(part("nema17_34", at=(GP_X + GP_T / 2, XROD_Y, XSCR_Z), rot=(0, -90, 0), name="X motor"))
    out.append(part("m3x14_shcs", at=[(GP_IN, XROD_Y + dy, XSCR_Z + dz) for dy in (-15.5, 15.5) for dz in (-15.5, 15.5)],
                    rot=(0, -90, 0), name="X motor screw M3x14"))
    gx = [(s * (GP_X + GP_T / 2), y, z) for s in (-1, 1) for y, z in [(PROF_Y, PROF_Z[0]), (PROF_Y, PROF_Z[1])]]
    out.append(part("m5x16_shcs", at=gx, rot=[(0, 90 if p[0] > 0 else -90, 0) for p in gx], name="Profile end screw M5x16"))
    gr = [(s * (GP_X + GP_T / 2), y, z) for s in (-1, 1) for y in (40.0, 85.0) for z in (RAIL_Z - 10, RAIL_Z + 10)]
    out.append(part("m5x10_bhcs", at=gr, rot=[(0, 90 if p[0] > 0 else -90, 0) for p in gr], name="Gantry foot screw M5x10"))

    # controller on the back of the 2020s
    x0, x1, y0, y1, z0, z1 = CASE
    P(name="Controller case", shape=controller_case(), color=PETG_BLACK)
    P(name="GRBL controller board", shape=box(-88, -12, y0 + 9, y0 + 10.6, 142, 208), group="component",
      color="#1f5f3a", material="pcb")
    P(name="Controller cover", shape=controller_cover(), color=PETG_BLACK)
    out.append(part("m3x6_selftap", at=[(x, y0 + 10.6, z) for x, z in STANDOFFS], rot=(-90, 0, 0), name="Board screw M3x6"))
    out.append(part("m3x10_selftap", at=[(x, y1 + 2.5, z) for x, z in ((x0 + 6, z0 + 6), (x1 - 6, z0 + 6),
                                                                       (x0 + 6, z1 - 6), (x1 - 6, z1 - 6))],
                    rot=(-90, 0, 0), name="Cover screw M3x10"))
    out.append(part("m5x8_bhcs", at=[(x, y0 + CASE_BACK, z) for x in (-75.0, -25.0) for z in PROF_Z], rot=(-90, 0, 0),
                    name="Case mount screw M5x8"))

    # X carriage (moves in X)
    def X(d):
        d["id"] = "x:" + d["name"]
        out.append(d)
    X(dict(name="X/Z carriage", shape=carriage(), color=PETG_BLACK, material=NYLON_MAT, params={"material": NYLON_MAT}))
    X(dict(name="LM10UU (carriage) x4", group="component", color=STEEL,
           shape=tube(19, 10, (-33, XROD_Y, XROD_Z[0]), "x", 29).union(tube(19, 10, (4, XROD_Y, XROD_Z[0]), "x", 29))
           .union(tube(19, 10, (-33, XROD_Y, XROD_Z[1]), "x", 29)).union(tube(19, 10, (4, XROD_Y, XROD_Z[1]), "x", 29))))
    X(dict(name="X anti-backlash nut", shape=ab_nut((35, XROD_Y, XSCR_Z), "x", -1), group="component", color=BRASS))
    X(dict(name="Z rods 8x100", group="component", color=STEEL,
           shape=cyl(8, (-ZROD_DX, ZROD_Y, ZROD_Z[0]), "z", 100).union(cyl(8, (ZROD_DX, ZROD_Y, ZROD_Z[0]), "z", 100))))
    X(dict(name="Z lead screw", shape=cyl(8, (0, ZROD_Y, 102), "z", 100), group="component", color=STEEL))
    X(dict(name="Z coupler", shape=coupler((0, ZROD_Y, Z_COUPLER_Z), "z", 25), group="component", color=ALU))
    X(part("nema17_34", at=(0, ZROD_Y, 226), rot=(180, 0, 0), name="Z motor"))
    X(part("m3x30_shcs", at=[(dx, ZROD_Y + dy, 202) for dx in (-15.5, 15.5) for dy in (-15.5, 15.5)], rot=(180, 0, 0),
           name="Z motor screw M3x30"))

    # Z slider + spindle (moves in X and Z)
    def Z(d):
        d["id"] = "z:" + d["name"]
        out.append(d)
    Z(dict(name="Z slider / spindle clamp", shape=z_slider(zl), color=PETG_BLACK, material=NYLON_MAT,
           params={"material": NYLON_MAT}))
    Z(dict(name="LM8SUU x4", group="component", color=STEEL,
           shape=tube(15, 8, (-ZROD_DX, ZROD_Y, zl), "z", 17).union(tube(15, 8, (-ZROD_DX, ZROD_Y, zl + 17), "z", 17))
           .union(tube(15, 8, (ZROD_DX, ZROD_Y, zl), "z", 17)).union(tube(15, 8, (ZROD_DX, ZROD_Y, zl + 17), "z", 17))))
    Z(dict(name="Z anti-backlash nut", shape=ab_nut((0, ZROD_Y, zl + SLIDER_H), "z", -1), group="component", color=BRASS))
    can = cyl(SP_D, (0, SP_Y, 112), "z", 67).union(cyl(17.5, (0, SP_Y, 108), "z", 4)).union(cyl(20, (0, SP_Y, 179), "z", 3))
    Z(dict(name="775 spindle motor", shape=can, group="component", color="#3a3a3a"))
    Z(dict(name="ER11 extension + collet nut", group="component", color=STEEL,
           shape=cyl(16, (0, SP_Y, 91), "z", 17).union(cyl(19, (0, SP_Y, 78), "z", 13))))
    Z(dict(name="End mill 3.175", shape=cyl(3.175, (0, SP_Y, TIP_Z), "z", 17), group="component", color="#9aa0a6"))
    Z(part("m4x20_shcs", at=(11, -29, zl + 18), rot=(0, 90, 0), name="Clamp bolt M4x20"))
    Z(part("m4_nut", at=(-11, -29, zl + 18), rot=(0, -90, 0), name="Clamp nut M4"))

    tilt_rig(out, X, Z)
    return out


TOUCHING = [
    ("End plate screw M5x16", "Left base rail"), ("End plate screw M5x16", "Right base rail"),
    ("Profile end screw M5x16", "Lower gantry profile"), ("Profile end screw M5x16", "Upper gantry profile"),
    ("Case mount screw M5x8", "Lower gantry profile"), ("Case mount screw M5x8", "Upper gantry profile"),  # into T-nuts
    ("Tilt box screw M5x8", "Lower gantry profile"), ("Tilt box screw M5x8", "Upper gantry profile"),
]


# ---------------------------------------------------------------- motion: Z up, trace a square, Z down
def motion():
    ids = [p["id"] for p in parts() if "id" in p]

    def pose(t):
        from cadlib.motion import ease
        if t < 0.15:
            dx, dy, dz = 0, 0, Z_TRAVEL * 0.8 * ease(t / 0.15)
        elif t > 0.85:
            dx, dy, dz = 0, 0, Z_TRAVEL * 0.8 * (1 - ease((t - 0.85) / 0.15))
        else:
            u = (t - 0.15) / 0.7 * 4
            corners = [(0, 0), (40, 0), (40, 30), (-40, 30), (-40, -30), (0, -30), (0, 0)]
            seg = u / 4 * (len(corners) - 1)
            i = min(int(seg), len(corners) - 2)
            f = seg - i
            dx = corners[i][0] + (corners[i + 1][0] - corners[i][0]) * f
            dy = corners[i][1] + (corners[i + 1][1] - corners[i][1]) * f
            dz = Z_TRAVEL * 0.8
        tf = {}
        for i_ in ids:
            if i_.startswith("bed:"):
                tf[i_] = move((0, -dy, 0))
            elif i_.startswith("x:"):
                tf[i_] = move((dx, 0, 0))
            elif i_.startswith("z:"):
                tf[i_] = move((dx, 0, dz))
        return tf
    return {"duration": 7, "pose": pose}

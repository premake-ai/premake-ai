"""Desk CNC mill, 200 x 200 x 200 mm travel.
Moving-bed Y axis, fixed gantry carrying X and Z. 2040 frame, MGN12 rails, T8 (8 mm lead) screws, NEMA17,
24 V 775 ER11 spindle, ESP32 + 3x TMC2209 in a box on the right upright."""
import cadquery as cq
from cadlib import fab
from cadlib.parts import part
from cadlib.shapes import safe_fillet
from cadlib.motion import move, ease

SCENE = "desk"

XC, YC, ZB = 0.0, 0.0, 207.0   # built pose: X carriage centre, bed centre, Z plate bottom (tool tip = ZB - 45)
ZP = 350.0                     # Z plate / Z rail length

TOUCHING = [
    ("Y lead screw", "Y nut"), ("Y lead screw", "Y coupler"), ("Y lead screw", "Y bearing blocks (KP08)"),
    ("X lead screw", "X nut"), ("X lead screw", "X coupler"), ("X lead screw", "608 bearings X"),
    ("Z lead screw", "Z nut"), ("Z lead screw", "Z coupler"), ("Z lead screw", "608 bearing Z"),
]


# ---------------------------------------------------------------- helpers
def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(abs(x1 - x0), abs(y1 - y0), abs(z1 - z0)).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def cyl(r, z0, z1, x=0.0, y=0.0):
    return cq.Workplane("XY").circle(r).extrude(z1 - z0).translate((x, y, z0))


def cyl_x(r, x0, x1, y, z):
    return cq.Workplane("YZ", origin=(x0, y, z)).circle(r).extrude(x1 - x0)


def cyl_y(r, y0, y1, x, z):
    return cq.Workplane("XZ", origin=(x, y0, z)).circle(r).extrude(-(y1 - y0))


def tube_x(ro, ri, x0, x1, y, z):
    return cyl_x(ro, x0, x1, y, z).cut(cyl_x(ri, x0 - 1, x1 + 1, y, z))


def tube_y(ro, ri, y0, y1, x, z):
    return cyl_y(ro, y0, y1, x, z).cut(cyl_y(ri, y0 - 1, y1 + 1, x, z))


def tube(ro, ri, z0, z1, x=0.0, y=0.0):
    return cyl(ro, z0, z1, x, y).cut(cyl(ri, z0 - 1, z1 + 1, x, y))


def ext(x0, x1, y0, y1, z0, z1, profile="2040"):
    """Slotted extrusion filling the box; the long side is the bar, the 40 side follows the box."""
    d = [abs(x1 - x0), abs(y1 - y0), abs(z1 - z0)]
    L = max(d)
    ax = d.index(L)
    bar = fab.extrusion(L, profile, axis="z").translate((0, 0, -L / 2))  # 20 X, 40 Y, length Z
    if ax == 2:
        if d[0] > d[1]:
            bar = bar.rotate((0, 0, 0), (0, 0, 1), 90)
    elif ax == 0:
        if d[2] > d[1]:
            bar = bar.rotate((0, 0, 0), (0, 0, 1), 90)
        bar = bar.rotate((0, 0, 0), (0, 1, 0), 90)
    else:
        if d[0] > d[2]:
            bar = bar.rotate((0, 0, 0), (0, 0, 1), 90)
        bar = bar.rotate((0, 0, 0), (1, 0, 0), 90)
    return bar.translate(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def bar(name, b, length):
    return {"name": name, "shape": ext(*b), "process": "extrusion",
            "params": {"profile": "2040", "length_mm": length, "tapped_ends": 0}}


# MGN12: rail 12 x 8, block 27 wide x 45.4 long, 13 high from the rail base (HIWIN catalogue)
def rail_l(L):
    return box(-L / 2, L / 2, -6, 6, 0, 8)


def block_l():
    return box(-22.7, 22.7, -13.5, 13.5, 3, 13).cut(box(-23, 23, -6.2, 6.2, 2.9, 8.3))


def orient(s, kind, at):
    """Local: rail along X, base on z=0, block up +Z. kind y: rail along Y; x: base on a -Y facing face;
    z: rail along Z, base on a +Y facing face."""
    if kind == "y":
        s = s.rotate((0, 0, 0), (0, 0, 1), 90)
    elif kind == "x":
        s = s.rotate((0, 0, 0), (1, 0, 0), 90)
    elif kind == "z":
        s = s.rotate((0, 0, 0), (0, 1, 0), -90).rotate((0, 0, 0), (0, 0, 1), -90)
    return s.translate(at)


def group(shapes):
    out = shapes[0]
    for s in shapes[1:]:
        out = out.add(s)
    return cq.Workplane("XY").add(cq.Compound.makeCompound([v for s in shapes for v in s.vals()]))


def kp08(y):
    """KP08 pillow block, shaft along Y, base on z=20 (cross bar top), shaft 15 above base."""
    b = box(-27.5, 27.5, y - 6.5, y + 6.5, 20, 25).union(box(-14, 14, y - 6.5, y + 6.5, 20, 35))
    b = b.union(cyl_y(14, y - 6.5, y + 6.5, 0, 35))
    return b.cut(cyl_y(4, y - 10, y + 10, 0, 35))


def motor_plate_holes(s, axis, c):
    """22 mm boss hole + 4 x M3 on 31 mm square through a motor plate (axis 'x', 'y' or 'z')."""
    a, b = c
    pts = [(a, b)] + [(a + i * 15.5, b + j * 15.5) for i in (-1, 1) for j in (-1, 1)]
    for k, (u, v) in enumerate(pts):
        r = 11.5 if k == 0 else 1.7
        if axis == "y":
            s = s.cut(cyl_y(r, -400, 0, u, v))
        elif axis == "x":
            s = s.cut(cyl_x(r, -300, -200, u, v))
        else:
            s = s.cut(cyl(r, 0, 900, u, v))
    return s


# ---------------------------------------------------------------- parts
def frame():
    p = []
    for s, n in ((-1, "L"), (1, "R")):
        p.append(bar(f"Base rail {n}", (s * 150, s * 170, -300, 300, 0, 40), 600))
        p.append(bar(f"Upright {n}", (s * 174, s * 194, 100, 140, 0, 400), 400))
        # 4 mm shim: the Y blocks overhang the base rail by 3.5 mm, so the upright stands 4 mm out
        shim = box(s * 170, s * 174, 100, 140, 0, 40)
        for z in (10, 30):
            shim = shim.cut(cyl_x(2.75, -200, 200, 120, z))
        p.append({"name": f"Upright shim {n}", "shape": shim, "color": "#2b6cb0"})
    for s, n in ((-1, "front"), (1, "back")):
        p.append(bar(f"Cross bar {n}", (-150, 150, s * 260, s * 300, 0, 20), 300))
    p.append(bar("Gantry beam lower", (-200, 200, 80, 100, 300, 340), 400))
    p.append(bar("Gantry beam upper", (-200, 200, 80, 100, 340, 380), 400))
    # cast corner brackets: cross bars to base rails, uprights to base rails, lower beam to uprights
    ats, rots = [], []
    for y in (-280, 280):
        ats += [(147, y, 23), (-147, y, 23)]
        rots += [(0, 0, 180), (0, 0, 0)]
    ats += [(173, 97, 20), (-173, 97, 20), (173, 143, 20), (-173, 143, 20), (184, 97, 297), (-184, 97, 297)]
    rots += [(-90, 0, -90), (90, 0, -90), (90, 0, 90), (-90, 0, 90), (180, 0, -90), (180, 0, -90)]
    p.append(part("bracket_2020", at=ats, rot=rots, name="Corner brackets"))
    return p


def y_axis():
    p = []
    rails = group([orient(rail_l(500), "y", (s * 160, 0, 40)) for s in (-1, 1)])
    p.append({"name": "Y rails (MGN12 500 mm)", "shape": rails, "group": "component", "color": "#9aa0a6"})
    blocks = group([orient(block_l(), "y", (s * 160, YC + d, 40)) for s in (-1, 1) for d in (-100, 100)])
    p.append({"name": "Y blocks (MGN12H)", "id": "y_blocks", "shape": blocks, "group": "component",
              "color": "#3d4247"})
    t_sp = fab.sheet_actual("mdf", 6)
    holes = [(x, y) for x in (-120, -40, 40, 120) for y in (-110, 0, 110)]
    bed = safe_fillet(box(-172, 172, YC - 150, YC + 150, 53, 56), "|Z", 8)  # covers the full Y blocks
    for x, y in holes:
        bed = bed.cut(cyl(5.0, 50, 60, x, YC + y))  # clearance for the spoilboard's M5 tee nuts
    for x in (-160, 160):
        for y in (-100, 100):
            for i in (-10, 10):
                for j in (-10, 10):
                    bed = bed.cut(cyl(1.7, 50, 60, x + i, YC + y + j))  # M3 to the Y blocks
    p.append({"name": "Bed plate", "id": "bed", "shape": bed,
              "process": "sheet", "params": {"material": "aluminium 5052", "thickness_mm": 3, "bends": 0}})
    spoil = safe_fillet(box(-150, 150, YC - 140, YC + 140, 56, 56 + t_sp), "|Z", 6)
    for x in (-120, -40, 40, 120):
        for y in (-110, 0, 110):
            spoil = spoil.cut(cyl(3.0, 50, 70, x, YC + y))  # M5 hold-down holes (T-nuts underneath)
    p.append({"name": "Spoilboard", "id": "spoil", "shape": spoil, "process": "laser",
              "params": {"material": "MDF", "thickness_mm": 6}, "color": "#b89668"})
    probe = safe_fillet(box(-140, -110, YC - 130, YC - 110, 56 + t_sp, 56 + t_sp + 8), "|Z", 3)
    p.append({"name": "Z touch probe plate", "id": "probe", "shape": probe, "group": "component",
              "color": "#c9ccd1", "material": "aluminium"})
    # lead screw, nut, bearings, coupler, motor
    p.append({"name": "Y lead screw", "shape": cyl_y(4, -300, 300, 0, 35), "group": "component", "color": "#b8bcc2"})
    p.append({"name": "Y bearing blocks (KP08)", "shape": group([kp08(-270), kp08(270)]), "group": "component",
              "color": "#8c9095"})
    p.append({"name": "Y coupler", "shape": tube_y(9.5, 4, -315, -290, 0, 35), "group": "component",
              "color": "#c0c4c8"})
    p.append(part("nema17_48", at=(0, -322, 35), rot=(-90, 0, 0), name="Y motor"))
    mount = safe_fillet(box(-24, 24, -322, -317, 0, 58), "|Y", 4)
    for s in (-1, 1):
        mount = mount.union(box(s * 20.5, s * 24, -320, -300, 0, 40))
    mount = mount.union(box(-24, 24, -304, -300, 0, 20))
    mount = motor_plate_holes(mount, "y", (0, 35))
    for x in (-13, 13):
        mount = mount.cut(cyl_y(2.75, -310, -295, x, 10))  # M5 into the cross bar slot
    p.append({"name": "Y motor mount", "shape": mount, "color": "#2b6cb0"})
    nb = safe_fillet(box(-17, 17, YC - 6, YC + 12, 23, 53), "|Y", 3).cut(cyl_y(5.3, YC - 20, YC + 20, 0, 35))
    for x in (-11.5, 11.5):
        nb = nb.cut(cyl(1.25, 43, 54, x, YC + 3))  # M3 pilots: bed plate screws down into the block
    p.append({"name": "Y nut block", "id": "y_nutblock", "shape": nb, "color": "#2b6cb0"})
    nut = tube_y(11, 4, YC + 12, YC + 15.5, 0, 35).union(tube_y(5.1, 4, YC + 0.5, YC + 12.01, 0, 35))
    p.append({"name": "Y nut", "id": "y_nut", "shape": nut, "group": "component", "color": "#c9a227",
              "material": "brass"})
    return p


def x_axis():
    p = []
    rails = group([orient(rail_l(400), "x", (0, 80, z)) for z in (310, 370)])
    p.append({"name": "X rails (MGN12 400 mm)", "shape": rails, "group": "component", "color": "#9aa0a6"})
    blocks = group([orient(block_l(), "x", (XC + d, 80, z)) for z in (310, 370) for d in (-30, 30)])
    p.append({"name": "X blocks (MGN12H)", "id": "x_blocks", "shape": blocks, "group": "component",
              "color": "#3d4247"})
    xp = safe_fillet(box(XC - 55, XC + 55, 64, 67, 290, 450), "|Y", 6)
    for x in (-30, 30):
        for z in (310, 370):
            for i in (-10, 10):
                for j in (-10, 10):
                    xp = xp.cut(cyl_y(1.7, 60, 70, XC + x + i, z + j))  # M3 to the X blocks
    p.append({"name": "X carriage plate", "id": "xplate", "shape": xp, "process": "sheet",
              "params": {"material": "aluminium 5052", "thickness_mm": 3, "bends": 0}})
    # nut block: a flat flange on the X plate's back, an arm over the beam to the nut boss
    nb = box(XC - 15, XC + 15, 67, 71, 387, 420).union(box(XC - 6, XC + 12, 70, 100, 387, 405))
    nb = safe_fillet(nb, "|X", 2).cut(cyl_x(5.3, XC - 30, XC + 30, 90, 395))
    for x in (-10, 10):
        nb = nb.cut(cyl_y(1.25, 64, 72, XC + x, 413))  # M3 pilots from the X plate
    p.append({"name": "X nut block", "id": "x_nutblock", "shape": nb, "color": "#2b6cb0"})
    nut = tube_x(11, 4, XC + 12, XC + 15.5, 90, 395).union(tube_x(5.1, 4, XC + 0.5, XC + 12.01, 90, 395))
    p.append({"name": "X nut", "id": "x_nut", "shape": nut, "group": "component", "color": "#c9a227",
              "material": "brass"})
    p.append({"name": "X lead screw", "shape": cyl_x(4, -205, 195, 90, 395), "group": "component", "color": "#b8bcc2"})
    p.append({"name": "X coupler", "shape": tube_x(9.5, 4, -225, -200, 90, 395), "group": "component",
              "color": "#c0c4c8"})
    p.append(part("nema17_48", at=(-230, 90, 395), rot=(0, 90, 0), name="X motor"))
    mb = safe_fillet(box(-230, -225, 68, 112, 372, 418), "|X", 4).union(box(-230, -204, 82, 98, 374, 384))
    mb = mb.union(box(-205, -187, 82, 98, 380, 385)).union(box(-230, -196, 100, 104, 374, 412))
    mb = motor_plate_holes(mb, "x", (90, 395))
    mb = mb.cut(cyl(2.75, 370, 390, -195, 90))  # M5 + T-nut into the beam's top slot
    p.append({"name": "X motor bracket", "shape": mb, "color": "#2b6cb0"})
    for s, n in ((-1, "L"), (1, "R")):
        x0, x1 = (-174, -158) if s < 0 else (158, 174)
        eb = safe_fillet(box(x0, x1, 76, 104, 380, 410), "|X", 5)
        face = -158 if s < 0 else 158
        eb = eb.cut(cyl_x(11.1, face - (7.2 if s < 0 else 0), face + (0 if s < 0 else 7.2), 90, 395))
        eb = eb.cut(cyl_x(4.6, x0 - 1, x1 + 1, 90, 395))
        fx = s * 180
        eb = eb.union(box(fx - 7 * s, fx + 6 * s, 81, 99, 380, 386)).cut(cyl(2.75, 375, 390, fx, 90))  # M5 foot
        p.append({"name": f"X end block {n}", "shape": eb, "color": "#2b6cb0"})
    p.append(part("bearing_608", at=[(-165, 90, 395), (158, 90, 395)], rot=(0, 90, 0), name="608 bearings X"))
    # Z blocks are fixed to the X carriage through printed spacers
    zb = group([orient(block_l(), "z", (s * 32, 37, z)) for s in (-1, 1) for z in (345, 405)])
    p.append({"name": "Z blocks (MGN12H)", "id": "z_blocks", "shape": zb.translate((XC, 0, 0)),
              "group": "component", "color": "#3d4247"})
    zs = part("m3x14_standoff", at=[(XC + s * 32 + i, 50, z + j) for s in (-1, 1) for z in (345, 405)
                                    for i in (-10, 10) for j in (-10, 10)], rot=(-90, 0, 0), name="Z block spacers")
    zs["id"] = "zspacers"
    p.append(zs)
    znb = box(XC - 16, XC + 16, 44, 64, 430, 445).cut(cyl(5.3, 420, 450, XC, 52))
    for x in (-10, 10):
        znb = znb.cut(cyl_y(1.25, 55, 65, XC + x, 437.5))  # M3 pilots from the X plate
    p.append({"name": "Z nut bracket", "id": "z_nutbracket", "shape": safe_fillet(znb, "|Z", 3), "color": "#2b6cb0"})
    znut = tube(11, 4, 445, 448.5, XC, 52).union(tube(5.1, 4, 433.5, 445.01, XC, 52))
    p.append({"name": "Z nut", "id": "z_nut", "shape": znut, "group": "component", "color": "#c9a227",
              "material": "brass"})
    return p


def z_axis():
    p = []
    zp = safe_fillet(box(XC - 50, XC + 50, 34, 37, ZB, ZB + ZP), "|Y", 6)
    p.append({"name": "Z plate", "id": "zplate", "shape": zp, "process": "sheet",
              "params": {"material": "aluminium 5052", "thickness_mm": 3, "bends": 0}})
    rails = group([orient(rail_l(ZP), "z", (XC + s * 32, 37, ZB + ZP / 2)) for s in (-1, 1)])
    p.append({"name": "Z rails (MGN12 350 mm)", "id": "z_rails", "shape": rails, "group": "component",
              "color": "#9aa0a6"})
    p.append({"name": "Z lead screw", "id": "z_screw", "shape": cyl(4, ZB + 5, ZB + 355, XC, 52),
              "group": "component", "color": "#b8bcc2"})
    p.append({"name": "Z coupler", "id": "z_coupler", "shape": tube(9.5, 4, ZB + 344, ZB + 369, XC, 52),
              "group": "component", "color": "#c0c4c8"})
    zm = part("nema17_48", at=(XC, 52, ZB + 375), rot=(180, 0, 0), name="Z motor")
    zm["id"] = "z_motor"
    p.append(zm)
    mb = box(XC - 21, XC + 21, 31, 73, ZB + 370, ZB + 375).union(box(XC - 18, XC + 18, 37, 42, ZB + 325, ZB + 375))
    mb = motor_plate_holes(mb, "z", (XC, 52))
    p.append({"name": "Z motor bracket", "id": "z_motorbracket", "shape": safe_fillet(mb, "|Z", 2), "color": "#2b6cb0"})
    bb = box(XC - 14, XC + 14, 37, 66, ZB, ZB + 15).cut(cyl(11.1, ZB + 8, ZB + 16, XC, 52))
    bb = bb.cut(cyl(4.6, ZB - 1, ZB + 16, XC, 52))
    p.append({"name": "Z bearing block", "id": "z_bearingblock", "shape": safe_fillet(bb, "|Z", 2), "color": "#2b6cb0"})
    br = part("bearing_608", at=(XC, 52, ZB + 8), name="608 bearing Z")
    br["id"] = "z_bearing"
    p.append(br)
    # spindle mount: back plate on the Z plate, shelf under the motor face (2 x M4), split ring clamp
    sm = safe_fillet(box(XC - 28, XC + 28, 29, 34, ZB, ZB + 86), "|Y", 6)
    sm = sm.cut(box(XC - 13, XC + 13, 28, 35, ZB + 24, ZB + 58))  # lightening window
    sm = sm.union(cyl(25, ZB + 10, ZB + 16, XC, 0)).union(box(XC - 20, XC + 20, 0, 30, ZB + 10, ZB + 16))
    sm = sm.union(cyl(25.5, ZB + 66, ZB + 80, XC, 0)).union(box(XC - 7, XC + 7, -34, -20, ZB + 66, ZB + 80))
    sm = sm.union(box(XC - 16, XC + 16, 18, 30, ZB + 66, ZB + 80))
    sm = sm.cut(cyl(21.3, ZB + 61, ZB + 81, XC, 0)).cut(box(XC - 1.5, XC + 1.5, -40, -15, ZB + 61, ZB + 81))
    sm = sm.cut(cyl_x(1.7, XC - 10, XC + 10, -28, ZB + 73))
    sm = sm.cut(cyl(10, ZB + 9, ZB + 19, XC, 0))
    for x in (-14.5, 14.5):
        sm = sm.cut(cyl(2.25, ZB + 9, ZB + 19, XC + x, 0))
    for x in (-20, 20):
        for z in (40, 80):
            sm = sm.cut(cyl_y(1.25, 27, 35, XC + x, ZB + z))  # M3 pilots from the Z plate
    p.append({"name": "Spindle mount", "id": "spindlemount", "shape": safe_fillet(sm, "|Y", 3), "color": "#2b6cb0"})
    zf = ZB + 18  # spindle front face
    sp = cyl(21, zf, zf + 67, XC, 0).union(cyl(22.75, zf + 12, zf + 32, XC, 0))
    sp = sp.union(cyl(15, zf + 67, zf + 72, XC, 0)).union(cyl(8.5, zf - 3, zf + 0.01, XC, 0))
    for x in (-14.5, 14.5):
        sp = sp.cut(cyl(2.0, zf - 1, zf + 6, XC + x, 0))
    sp = sp.union(cyl(6, zf - 20, zf - 2.9, XC, 0)).union(cyl(9.5, zf - 40, zf - 19.9, XC, 0))
    sp = sp.union(cq.Workplane("XY").circle(9.5).workplane(offset=-8).circle(6).loft()
                  .translate((XC, 0, zf - 40)))
    sp = sp.union(cyl(1.6, zf - 63, zf - 47.9, XC, 0))
    p.append({"name": "775 ER11 spindle 24V", "id": "spindle", "shape": sp, "group": "component",
              "color": "#30343a"})
    sc = part("m4x12_shcs", at=[(XC - 14.5, 0, ZB + 10), (XC + 14.5, 0, ZB + 10)], rot=(180, 0, 0),
              name="Spindle screws M4x12")
    sc["id"] = "spindle_screws"
    p.append(sc)
    return p


def control_box():
    """Open-sided acrylic sandwich on the right upright: black back panel (M5 + T-nuts into the upright),
    electronics on standoffs, clear front panel on 40 mm standoffs carrying the e-stop and power jack.
    The ESP32 runs from the PC's USB cable (which streams the G-code); 24 V feeds only drivers and spindle."""
    p = []
    corners = [(y, z) for y in (56, 184) for z in (46, 234)]
    back = fab.panel(200, 140, 3, r=8).rotate((0, 0, 0), (0, 1, 0), 90).translate((194, 120, 140))
    for y, z in corners + [(68, 89), (68, 231), (142, 89), (142, 231)]:
        back = back.cut(cyl_x(1.7, 190, 200, y, z))
    for y, z in ((110, 60), (130, 60), (110, 220), (130, 220)):
        back = back.cut(cyl_x(2.75, 190, 200, y, z))  # M5 to the upright's slots
    p.append({"name": "Electronics back panel", "shape": back, "process": "laser",
              "params": {"material": "acrylic", "thickness_mm": 3}, "color": "#151515"})
    front = fab.panel(200, 140, 3, r=8).rotate((0, 0, 0), (0, 1, 0), 90).translate((237, 120, 140))
    for y, z in corners:
        front = front.cut(cyl_x(1.7, 230, 245, y, z))
    front = front.cut(cyl_x(11.25, 230, 245, 170, 210))  # e-stop
    front = front.cut(cyl_x(6.0, 230, 245, 170, 70))     # power jack
    p.append({"name": "Electronics front panel", "shape": front, "process": "laser",
              "params": {"material": "acrylic", "thickness_mm": 3}, "material": "acrylic_clear",
              "explode": [1, 0, 0]})
    p.append(part("m3x40_standoff", at=[(197, y, z) for y, z in corners], rot=(0, 90, 0), name="Panel standoffs"))
    p.append(part("m3x6_bhcs", at=[(240, y, z) for y, z in corners], rot=(0, 90, 0), name="Front panel screws"))
    p.append(part("m3x10_standoff", at=[(197, y, z) for y in (68, 142) for z in (89, 231)], rot=(0, 90, 0),
                  name="Board standoffs"))
    p.append({"name": "Perfboard 9x15 cm", "shape": box(207, 208.6, 60, 150, 85, 235), "group": "component",
              "color": "#2f6b3a", "material": "pcb"})
    p.append(part("esp32_devkitc", at=(217.1, 85, 208), rot=(0, 90, 0), name="ESP32 DevKitC"))
    for z, n in ((205, "X"), (170, "Y"), (135, "Z")):
        p.append(part("tmc2209", at=(217.1, 130, z), rot=(0, 90, 0), name=f"TMC2209 {n}"))
    p.append({"name": "D4184 MOSFET module", "shape": box(200, 210, 166.5, 183.5, 53, 87),
              "group": "component", "color": "#1d4f91"})
    jack = cyl_x(5.5, 222, 242, 170, 70).union(cyl_x(7, 240, 242.5, 170, 70)).union(cyl_x(8, 234, 236.99, 170, 70))
    p.append({"name": "DC panel jack 5.5x2.5 (10 A)", "shape": jack, "group": "component", "color": "#222222",
              "cable": {"type": "dc-barrel", "at": [242.5, 170, 70], "dir": [1, 0, 0], "length_mm": 600}})
    es = box(207, 236.99, 155, 185, 195, 225).union(cyl_x(11, 236, 243, 170, 210)).union(cyl_x(14, 240, 244, 170, 210))
    es = es.union(cyl_x(20, 243.9, 262, 170, 210))
    p.append({"name": "Emergency stop 22 mm", "shape": es, "group": "component", "color": "#d62828"})
    return p


def parts():
    return frame() + y_axis() + x_axis() + z_axis() + control_box()


# ---------------------------------------------------------------- motion: lift, trace a 160 mm square, return
Y_IDS = ["y_blocks", "bed", "spoil", "probe", "y_nutblock", "y_nut"]
X_IDS = ["x_blocks", "xplate", "x_nutblock", "x_nut", "z_blocks", "zspacers", "z_nutbracket", "z_nut"]
Z_IDS = ["zplate", "z_rails", "z_screw", "z_coupler", "z_motor", "z_motorbracket", "z_bearingblock", "z_bearing",
         "spindlemount", "spindle", "spindle_screws"]
KEYS = [(0.0, (0, 0, 0)), (0.1, (0, 0, 40)), (0.25, (-80, -80, 40)), (0.32, (-80, -80, 0)), (0.45, (80, -80, 0)),
        (0.58, (80, 80, 0)), (0.71, (-80, 80, 0)), (0.84, (-80, -80, 0)), (0.9, (-80, -80, 40)), (1.0, (0, 0, 0))]


def motion():
    def pose(t):
        for (t0, a), (t1, b) in zip(KEYS, KEYS[1:]):
            if t <= t1:
                k = ease((t - t0) / (t1 - t0)) if t1 > t0 else 1.0
                x, y, z = (a[i] + (b[i] - a[i]) * k for i in range(3))
                break
        else:
            x, y, z = 0, 0, 0
        out = {i: move((0, y, 0)) for i in Y_IDS}
        out.update({i: move((x, 0, 0)) for i in X_IDS})
        out.update({i: move((x, 0, z)) for i in Z_IDS})
        return out
    return {"duration": 8, "pose": pose}

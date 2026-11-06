"""Adjustable phone stand: printed base + tilting back arm on an M5 friction hinge.

Z up, mm, front (phone screen) faces -Y. Print base flat, arm flat on its back.
"""
import math
import cadquery as cq

BASE_W, BASE_D, BASE_T = 84.0, 96.0, 9.0
BASE_Y0 = -34.0
HINGE_Y, HINGE_Z = 26.0, 19.0
KN_R = 8.5              # knuckle radius
KN_MID = 34.0           # arm knuckle width
LUG_W = 14.0
ARM_W, ARM_T, ARM_L = 74.0, 6.0, 120.0
ARM_ANGLE = 64.0        # deg from horizontal (adjustable 45-80 by loosening the wing nut)
GAP = 0.4
BOLT_D = 5.5            # M5 clearance


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def cyl_x(r, x0, x1, y, z):
    return cq.Workplane("YZ").center(y, z).circle(r).extrude(x1 - x0).translate((x0, 0, 0))


def try_fillet(wp, sel, r):
    try:
        out = wp.edges(sel).fillet(r)
        return out if out.val().isValid() else wp
    except Exception:
        return wp


def make_base():
    b = box(-BASE_W / 2, BASE_W / 2, BASE_Y0, BASE_Y0 + BASE_D, 0, BASE_T)
    b = try_fillet(b, "|Z", 12.0)
    b = try_fillet(b, ">Z", 2.5)
    b = try_fillet(b, "<Z", 1.0)
    # front lip with a cable notch
    lip = try_fillet(box(-36, 36, -6, 1, BASE_T - 1, BASE_T + 9), ">Z", 2.5)
    b = b.union(lip).cut(box(-9, 9, -8, 3, BASE_T + 2, BASE_T + 12))
    b = b.cut(box(-9, 9, -40, -6, BASE_T - 2.5, BASE_T + 1))          # cable groove to the front
    # hinge lugs
    for sx in (-1, 1):
        x0, x1 = KN_MID / 2 + GAP, KN_MID / 2 + GAP + LUG_W
        xa, xb = (x0, x1) if sx > 0 else (-x1, -x0)
        lug = cyl_x(KN_R, xa, xb, HINGE_Y, HINGE_Z).union(
            box(xa, xb, HINGE_Y - KN_R, HINGE_Y + KN_R, BASE_T - 1, HINGE_Z))
        b = b.union(lug)
    b = b.cut(cyl_x(BOLT_D / 2, -60, 60, HINGE_Y, HINGE_Z))
    # lightening pocket underneath
    b = b.cut(box(-22, 22, -16, 42, -1, 5))
    # recesses for 4 rubber feet
    for x in (-30, 30):
        for y in (BASE_Y0 + 12, BASE_Y0 + BASE_D - 12):
            b = b.cut(cq.Workplane("XY").circle(6.5).extrude(1.0).translate((x, y, 0)))
    return b


def make_arm():
    neck_h = KN_R + 5
    a = cyl_x(KN_R, -KN_MID / 2, KN_MID / 2, 0, 0)
    a = a.union(box(-KN_MID / 2, KN_MID / 2, -ARM_T / 2, ARM_T / 2, 0, neck_h + 2))
    plate = box(-ARM_W / 2, ARM_W / 2, -ARM_T / 2, ARM_T / 2, neck_h, ARM_L)
    plate = try_fillet(plate, "|Y", 10.0)
    a = a.union(plate)
    win = (cq.Workplane("XZ").center(0, 74).slot2D(56, 30, 90).extrude(-20).translate((0, -10, 0)))
    a = a.cut(win)
    a = try_fillet(a, ">Z", 1.5)
    a = a.cut(cyl_x(BOLT_D / 2, -40, 40, 0, 0))
    return (a.rotate((0, 0, 0), (1, 0, 0), -(90 - ARM_ANGLE))
             .translate((0, HINGE_Y, HINGE_Z)))


def make_hardware():
    x0 = -(KN_MID / 2 + GAP + LUG_W)
    hexhead = (cq.Workplane("YZ").polygon(6, 9.2).extrude(3.5).translate((x0 - 3.5, HINGE_Y, HINGE_Z)))
    shank = cyl_x(2.5, x0, x0 + 70, HINGE_Y, HINGE_Z)
    washer = cyl_x(5.0, -x0, -x0 + 1, HINGE_Y, HINGE_Z)
    wing = cyl_x(5.5, -x0 + 1, -x0 + 9, HINGE_Y, HINGE_Z).union(
        box(-x0 + 3, -x0 + 6, HINGE_Y - 2, HINGE_Y + 2, HINGE_Z - 13, HINGE_Z + 13))
    return hexhead.union(shank).union(washer).union(wing)


def make_feet():
    out = None
    for x in (-30, 30):
        for y in (BASE_Y0 + 12, BASE_Y0 + BASE_D - 12):
            f = cq.Workplane("XY").circle(6.0).extrude(2.5).translate((x, y, -1.5))
            out = f if out is None else out.union(f)
    return out


def parts():
    return [
        {"name": "Base", "shape": make_base(), "group": "case", "color": "#3d4451", "explode": [0, 0, -1]},
        {"name": "Tilting arm", "shape": make_arm(), "group": "case", "color": "#ff8a3d", "explode": [0, 1, 0.4]},
        {"name": "M5 x 70 bolt + wing nut", "shape": make_hardware(), "group": "component",
         "color": "#9aa0a6", "explode": [1, 0, 0]},
        {"name": "Rubber bumper feet (4x)", "shape": make_feet(), "group": "component",
         "color": "#222222", "explode": [0, 0, -1]},
    ]

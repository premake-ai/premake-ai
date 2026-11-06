import math
import cadquery as cq
from cadlib import fab
from cadlib.parts import part, info

# Reformer-style spring hip-thrust machine. Front (-Y) = feet, back (+Y) = bench.
SCENE = "floor"

Z0 = 10                    # rubber feet lift the frame 10 mm
L = 1200                   # side rails (stock length)
YE = L / 2                 # rail ends at y = +-600
XI, XO = 260, 390          # inner 2040 / outer 2020 rail centre lines
SPR_X = (293, 326, 359)    # three springs per side in the channel
SPR_Z = 30                 # spring axis height
ROPE_X = 326
PAD_TOP = 430              # back pad top edge (slides 330..450)
UP_Y = 450                 # upright front face
PLY = fab.sheet_actual("plywood", 6)

WOOD = "#e3cfa8"
CREAM = "#ece5d8"
NYLON = "#f4f4f0"
SPRING_COL = {293: "#e8c42a", 326: "#4caf50", 359: "#d63a2f"}   # yellow / green / red


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def mirror_x(wp, s):
    return wp if s > 0 else wp.mirror("YZ")


def fillet(wp, sel, r):
    try:
        return wp.edges(sel).fillet(r)
    except Exception:
        return wp


def ext(profile, length, axis, at, tall_z=True):
    """Extrusion bar; 2040 is turned so its 40 side is vertical (tall_z) or along Y."""
    b = fab.extrusion(length, profile=profile, axis=axis, at=at)
    if profile == "2040":
        bb = b.val().BoundingBox()
        want_z = 40 if tall_z else 20
        if abs(bb.zlen - want_z) > 1:
            c = bb.center
            ax = {"x": (1, 0, 0), "y": (0, 1, 0), "z": (0, 0, 1)}[axis]
            b = b.rotate((c.x, c.y, c.z), (c.x + ax[0], c.y + ax[1], c.z + ax[2]), 90)
    return b


def cyl_between(p0, p1, r):
    v = cq.Vector(*p1) - cq.Vector(*p0)
    return cq.Workplane(cq.Plane(origin=p0, xDir=v.cross(cq.Vector(0, 0, 1)) if abs(v.z) < v.Length * 0.99 else (1, 0, 0),
                                 normal=v)).circle(r).extrude(v.Length)


def extrusion_part(name, shape, profile, length):
    return {"name": name, "shape": shape, "process": "extrusion",
            "params": {"profile": profile, "length_mm": length, "tapped_ends": 0}}


# ---------------- printed parts (built for the +X side, mirrored for -X) ----------------

def pad_carriage(z0, h=160):
    """PETG sleeve round the front / outer / rear faces of the upright; pad screws to its front plate."""
    y0 = UP_Y
    front = box(XI - 35, XI + 35, y0 - 10, y0 - 0.3, z0, z0 + h)
    outer = box(XI + 10.3, XI + 18, y0 - 10, y0 + 26, z0, z0 + h)
    rear = box(XI - 10, XI + 18, y0 + 20.3, y0 + 26, z0, z0 + h)
    c = front.union(outer).union(rear)
    c = fillet(c, "|Z", 1.5)
    for z in (z0 + 35, z0 + h - 35):     # clamp bolts into the outer slot
        c = c.cut(cq.Workplane("YZ").circle(2.75).extrude(30).translate((XI + 5, y0 + 10, z)))
    c = c.cut(cq.Workplane("XZ").circle(2.75).extrude(-30).translate((XI, y0 + 10, z0 + h / 2)))  # rear slot
    for x in (XI - 26, XI + 27):          # #10 wood screws into the pad's plywood base
        for z in (z0 + 25, z0 + h - 25):
            c = c.cut(cq.Workplane("XZ").circle(2.4).extrude(-20).translate((x, y0 - 15, z)))
    return c


def hip_pulley_block():
    """Two cheeks round the hip pulley; feet bolt to the inner and outer rail tops. Hip bar rests on top."""
    y0, y1 = 45, 118
    base = box(XI - 10, XO + 10, y0, y1, Z0 + 40, Z0 + 50)
    outer_leg = box(XO - 10, XO + 10, y0, y1, Z0 + 20, Z0 + 50)
    cheeks = box(ROPE_X - 17, ROPE_X - 8, y0, y1, Z0 + 40, 135).union(
        box(ROPE_X + 8, ROPE_X + 17, y0, y1, Z0 + 40, 135))
    b = base.union(outer_leg).union(cheeks)
    b = b.cut(box(ROPE_X - 8, ROPE_X + 8, y0 - 1, y1 + 1, Z0 + 39, 136))          # sheave + rope gap
    b = fillet(b, "|X", 3)
    b = b.cut(cq.Workplane("YZ").circle(4.2).extrude(60).translate((ROPE_X - 30, 80, 105)))  # M8 axle
    for x in (XI, XO):
        for y in (y0 + 12, y1 - 12):
            b = b.cut(cq.Workplane("XY").circle(2.75).extrude(80).translate((x, y, Z0)))
    return b


def front_pulley_block():
    """Turns the rope 180 deg at the front: lower run to the spring yoke, upper run back to the hip pulley."""
    y0, y1 = -YE, -YE + 65
    top = box(XI - 10, XO + 10, y0, y1, 90, 98)
    inner_leg = box(XI - 10, XI + 10, y0, y1, Z0 + 40, 92)
    outer_leg = box(XO - 10, XO + 10, y0, y1, Z0 + 20, 92)
    cheeks = box(ROPE_X - 17, ROPE_X - 8, y0, y1, 16, 92).union(box(ROPE_X + 8, ROPE_X + 17, y0, y1, 16, 92))
    b = top.union(inner_leg).union(outer_leg).union(cheeks)
    b = fillet(b, "|X", 3)
    b = b.cut(cq.Workplane("YZ").circle(4.2).extrude(60).translate((ROPE_X - 30, -570, 55)))
    for x in (XI, XO):
        for y in (y0 + 15, y1 - 15):
            b = b.cut(cq.Workplane("XY").circle(2.75).extrude(120).translate((x, y, Z0)))
    return b


def yoke():
    """Moving end of the springs: three hook holes at the back, rope tie hole at the front."""
    y = box(XI + 13, XO - 13, 85, 115, 14, 46)
    y = fillet(y, "|Z", 4)
    for x in SPR_X:
        y = y.cut(cq.Workplane("XY").circle(3.5).extrude(40).translate((x, 108, 10)))
    return y.cut(cq.Workplane("XZ").circle(3.5).extrude(-40).translate((ROPE_X, 80, SPR_Z)))


def park_bar():
    """Idle springs hook here instead of on the yoke, so they never rattle."""
    b = box(XI - 10, XO + 10, 125, 141, Z0 + 40, 60).union(box(XO - 10, XO + 10, 125, 141, Z0 + 20, 60))
    for x in SPR_X:
        b = b.union(cq.Workplane("XY").circle(3).extrude(11).translate((x, 133, 49.5)))
    b = fillet(b, "|Y", 2)
    for x in (XI, XO):
        b = b.cut(cq.Workplane("XY").circle(2.75).extrude(80).translate((x, 133, Z0)))
    return b


# ---------------- laser-cut birch ----------------

def gusset():
    """6 mm birch brace on the inside of rail + upright; carry handle cut in."""
    pts = [(UP_Y, Z0 + 2), (YE, Z0 + 2), (YE, 95), (UP_Y + 20, 385), (UP_Y, 385)]
    g = cq.Workplane("YZ").polyline(pts).close().extrude(PLY)
    g = fillet(g, "|X", 12)
    slot = cq.Workplane("YZ").center(UP_Y + 45, 250).slot2D(90, 30, angle=-72).extrude(PLY)
    g = g.cut(slot)
    for y in (UP_Y + 40, YE - 25):
        for z in (Z0 + 10, Z0 + 30):
            g = g.cut(cq.Workplane("YZ").circle(2.75).extrude(PLY).translate((0, y, z)))
    for z in (120, 220, 340):
        g = g.cut(cq.Workplane("YZ").circle(2.75).extrude(PLY).translate((0, UP_Y + 10, z)))
    return g.translate((XI - 10 - PLY, 0, 0))


def skirt(y0, y1):
    s = cq.Workplane("XZ").rect(y1 - y0, 91).extrude(1)  # placeholder orientation
    s = box(XO + 10, XO + 10 + PLY, y0 + 1, y1 - 1, 4, 95)
    s = fillet(s, "|X", 8)
    for y in (y0 + 60, y1 - 60):
        s = s.cut(cq.Workplane("YZ").circle(2.75).extrude(PLY).translate((XO + 10, y, Z0 + 10)))
    return s


def foot_layer(z0, csk):
    p = box(-280, 280, -525, -245, z0, z0 + PLY)
    p = fillet(p, "|Z", 20)
    for x in (-200, 0, 200):
        for y in (-505, -265):
            hole = cq.Workplane("XY").circle(2.75).extrude(PLY).translate((x, y, z0))
            if csk:
                hole = hole.union(cq.Workplane("XY").circle(2.75).workplane(offset=PLY - 2.5)
                                  .circle(2.75).workplane(offset=2.5).circle(5.2).loft()
                                  .translate((x, y, z0)))
            p = p.cut(hole)
    return p


# ---------------- assembly ----------------

def parts():
    P = []
    # frame
    for s in (-1, 1):
        P.append(extrusion_part("Inner rail", ext("2040", L, "y", (s * XI, -YE, Z0 + 20)), "2040", L))
        P.append(extrusion_part("Outer rail", fab.extrusion(L, "2020", "y", (s * XO, -YE, Z0 + 10)), "2020", L))
        P.append(extrusion_part("End crossbar", fab.extrusion(800, "2020", "x", (-400, s * (YE + 10), Z0 + 10)), "2020", 800))
        P.append(extrusion_part("Upright", fab.extrusion(350, "2020", "z", (s * XI, UP_Y + 10, Z0 + 40)), "2020", 350))

    # foot plate (slides on the inner rails)
    for y in (-505, -265):
        P.append(extrusion_part("Foot bar", fab.extrusion(550, "2020", "x", (-275, y, Z0 + 50)), "2020", 550))
    P.append({"name": "Foot plate lower", "shape": foot_layer(Z0 + 60, False), "process": "laser",
              "params": {"material": "plywood", "thickness_mm": 6}, "material": "plywood"})
    P.append({"name": "Foot plate top", "shape": foot_layer(Z0 + 60 + PLY, True), "process": "laser",
              "params": {"material": "plywood", "thickness_mm": 6}, "material": "plywood"})
    P.append({"name": "Anti-slip tread", "shape": box(-260, 260, -505, -265, Z0 + 60 + 2 * PLY, Z0 + 61 + 2 * PLY),
              "group": "component", "color": "#3a3a3a", "material": "rubber"})

    # bench: back pad on two sliding carriages
    pz0 = PAD_TOP - 240
    for s in (-1, 1):
        P.append({"name": "Pad carriage", "shape": mirror_x(pad_carriage(pz0 + 40), s), "color": "#f2f0ea"})
        P.append({"name": "Gusset", "shape": mirror_x(gusset(), s), "process": "laser",
                  "params": {"material": "plywood", "thickness_mm": 6}, "material": "plywood"})
    pad = box(-355, 355, UP_Y - 10 - 55, UP_Y - 10, pz0, PAD_TOP)
    pad = fillet(pad, "|Y", 20)
    pad = fillet(pad, "#Y", 12) if False else fillet(pad, ">Y or <Y", 10)
    P.append({"name": "Back pad", "shape": pad, "group": "component", "color": CREAM, "id": "pad"})

    # spring channels, ropes and pulleys
    for s in (-1, 1):
        for x in SPR_X:
            sp = cq.Workplane("XZ").circle(13.5).extrude(-(588 - 115 - 30)).translate((s * x, 130, SPR_Z))
            for k in range(0, 15):
                sp = sp.union(cq.Workplane("XZ").circle(14.2).circle(12).extrude(-2)
                              .translate((s * x, 132 + k * 30, SPR_Z)))
            hooks = cq.Workplane("YZ").circle(7).circle(5).extrude(2).translate((s * x - 1, 122, SPR_Z)).union(
                cq.Workplane("YZ").circle(7).circle(5).extrude(2).translate((s * x - 1, 580, SPR_Z)))
            P.append({"name": "Reformer spring", "shape": sp.union(hooks), "group": "component",
                      "color": SPRING_COL[x], "material": "steel"})
        P.append({"name": "Spring yoke", "shape": mirror_x(yoke(), s), "color": "#f2f0ea", "id": f"yoke{s}"})
        P.append({"name": "Spring park bar", "shape": mirror_x(park_bar(), s), "color": "#f2f0ea"})
        P.append({"name": "Hip pulley block", "shape": mirror_x(hip_pulley_block(), s), "color": "#f2f0ea"})
        P.append({"name": "Front pulley block", "shape": mirror_x(front_pulley_block(), s), "color": "#f2f0ea"})
        for (py, pz) in ((80, 105), (-570, 55)):
            sheave = cq.Workplane("YZ").circle(25).circle(4).extrude(12).translate((s * ROPE_X - 6, py, pz))
            sheave = sheave.cut(cq.Workplane("YZ").circle(26).circle(22).extrude(4).translate((s * ROPE_X - 2, py, pz)))
            P.append({"name": "Nylon pulley", "shape": sheave, "group": "component", "color": NYLON})
        for y in SPR_X:
            pass
        eyes = None
        for x in SPR_X:
            e = cq.Workplane("XZ").circle(9).circle(5).extrude(3).translate((s * x, 593, SPR_Z - 8)).union(
                cq.Workplane("XZ").circle(2.5).extrude(-12).translate((s * x, 588, Z0 + 10)))
            eyes = e if eyes is None else eyes.union(e)
        P.append({"name": "M5 eye bolt", "shape": eyes, "group": "component", "color": "#b8bcc2", "material": "steel"})
        rope = cyl_between((s * ROPE_X, 85, SPR_Z), (s * ROPE_X, -570, SPR_Z), 3).union(
            cyl_between((s * ROPE_X, -570, 80), (s * ROPE_X, 80, 80), 3)).union(
            cyl_between((s * ROPE_X, 105, 105), (s * ROPE_X, 95, 148), 3))
        P.append({"name": "Rope", "shape": rope, "group": "component", "color": "#d9d4c7"})

    # hip bar resting on the hip pulley blocks
    P.append(extrusion_part("Hip bar", ext("2040", 650, "x", (-325, 90, 155)), "2040", 650))
    P[-1]["id"] = "hipbar"
    foam = cq.Workplane("YZ").circle(45).circle(16).extrude(440).translate((-220, 90, 155))
    foam = fillet(foam, "%CIRCLE", 6)
    P.append({"name": "Hip bar foam pad", "shape": foam, "group": "component", "color": CREAM, "id": "foam"})

    # birch side skirts hide the spring channels
    for s in (-1, 1):
        for (y0, y1) in ((-YE - 20, -207), (-207, 207), (207, YE + 20)):
            P.append({"name": "Side skirt", "shape": mirror_x(skirt(y0, y1), s), "process": "laser",
                      "params": {"material": "plywood", "thickness_mm": 6}, "material": "plywood"})

    # rubber feet, end caps
    feet = None
    for x in (-XO, -XI, XI, XO):
        for y in (-560, 560):
            f = cq.Workplane("XY").circle(12).extrude(Z0).translate((x, y, 0))
            feet = f if feet is None else feet.union(f)
    for x in (-XI, XI):
        feet = feet.union(cq.Workplane("XY").circle(12).extrude(Z0).translate((x, 0, 0)))
    P.append({"name": "Rubber foot", "shape": feet, "group": "component", "color": "#222222", "material": "rubber"})
    caps = box(-XI - 10, -XI + 10, UP_Y, UP_Y + 20, 400, 404).union(box(XI - 10, XI + 10, UP_Y, UP_Y + 20, 400, 404))
    P.append({"name": "2020 end cap", "shape": caps, "group": "component", "color": "#222222"})
    print("BRACKET INFO", info("bracket_2020"))
    return P

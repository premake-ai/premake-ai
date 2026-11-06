import cadquery as cq
from cadlib import fab
from cadlib.parts import part

FOOT_H = 6.0                      # rubber bumpers under the plate
PLATE_T = 3.0
PLATE_W, PLATE_D = 140.0, 120.0
Z0 = FOOT_H + PLATE_T             # bottom of the post
POST_L = 250.0                    # stock 2020 length, no cutting
ZT = Z0 + POST_L                  # top of the post
SAD_W, SAD_D = 110.0, 40.0        # saddle span (X) and depth (Y)
POCKET = 20.3                     # press fit over the 2020 end
PLUG_W, PLUG_T = 12.8, 7.0        # USB-C overmold max 12.35 x 6.5 + clearance
DOCK_Z = 120.0                    # dock height (slides anywhere on the rear slot)
STRIP_TOP = DOCK_Z - 6            # cover strip ends here, cable exits below the dock
CABLE_Y = 6.5                     # cable centre inside the rear T-slot


def fillet(wp, sel, r):
    try:
        return wp.edges(sel).fillet(r)
    except Exception:
        return wp


def plate():
    p = (cq.Workplane("XY").box(PLATE_W, PLATE_D, PLATE_T, centered=(True, True, False))
         .edges("|Z").fillet(20))
    p = p.faces(">Z").workplane().pushPoints([(0, 0), (0, -23)]).hole(5.5)
    slot = cq.Workplane("XY").center(0, (9 + PLATE_D / 2) / 2 + 3).slot2D(PLATE_D / 2 - 9 + 6, 6, 90).extrude(PLATE_T)
    p = p.cut(slot)
    p = fillet(p, ">Z and not |Z", 1.0)
    return p.translate((0, 0, FOOT_H))


def saddle():
    # outer arc: crest ZT+13, R 115; inner arc R 106 (same centre) -> ~9 mm thick arms
    prof = (cq.Workplane("XZ")
            .moveTo(-SAD_W / 2, ZT - 1).threePointArc((0, ZT + 13), (SAD_W / 2, ZT - 1))
            .lineTo(SAD_W / 2, ZT - 11.4).threePointArc((34, ZT - 1.6), (14, ZT + 3))
            .lineTo(14, ZT - 26).lineTo(-14, ZT - 26).lineTo(-14, ZT + 3)
            .threePointArc((-34, ZT - 1.6), (-SAD_W / 2, ZT - 11.4)).close()
            .extrude(SAD_D / 2, both=True))
    prof = fillet(prof, "not |Y", 3.0)
    pocket = cq.Workplane("XY").box(POCKET, POCKET, 26, centered=(True, True, False)).translate((0, 0, ZT - 26))
    bore = cq.Workplane("XY").circle(2.75).extrude(30).translate((0, 0, ZT - 2))
    csk = cq.Workplane("XY").circle(2.75).workplane(offset=2.6).circle(5.2).loft().translate((0, 0, ZT + 9.6))
    cap = cq.Workplane("XY").circle(5.2).extrude(10).translate((0, 0, ZT + 12.2))
    return prof.cut(pocket).cut(bore).cut(csk).cut(cap)


def dock():
    z = DOCK_Z
    b = cq.Workplane("XY").box(26, 20, 40, centered=(True, False, False)).translate((0, 10, z))
    b = fillet(b, "|Z", 4.0)
    b = fillet(b, ">Z", 1.5)
    tongue = cq.Workplane("XY").box(5.6, 2.5, 14, centered=(True, False, False)).translate((0, 8.5, z))
    b = b.union(tongue)
    cup = cq.Workplane("XY").box(PLUG_W, PLUG_T, 22, centered=(True, True, False)).translate((0, 20, z + 18))
    hole = cq.Workplane("XZ").circle(2.75).extrude(-25).translate((0, 5, z + 7))
    cbore = cq.Workplane("XZ").circle(5.0).extrude(-10).translate((0, 22, z + 7))
    return b.cut(cup).cut(hole).cut(cbore)


def rod(a, b, r=2.0):
    a, b = cq.Vector(*a), cq.Vector(*b)
    return cq.Solid.makeCylinder(r, (b - a).Length, a, b - a)


def cable():
    pts = [(0, 75, 2), (0, CABLE_Y, 2), (0, CABLE_Y, STRIP_TOP + 2), (0, 36, STRIP_TOP + 2),
           (0, 36, DOCK_Z + 50), (0, 20, DOCK_Z + 50), (0, 20, DOCK_Z + 40)]
    c = cq.Workplane("XY")
    for a, b in zip(pts, pts[1:]):
        c = c.union(cq.Workplane().add(rod(a, b)))
    for p in pts[1:-1]:
        c = c.union(cq.Workplane().add(cq.Solid.makeSphere(2.0, cq.Vector(*p))))
    return c


def plug():
    over = cq.Workplane("XY").box(12.0, 6.2, 20, centered=(True, True, False)).edges("|Z").fillet(2.5)
    tip = cq.Workplane("XY").box(8.25, 2.4, 6.65, centered=(True, True, False)).edges("|Z").fillet(1.1)
    return over.translate((0, 20, DOCK_Z + 26.65)).union(tip.translate((0, 20, DOCK_Z + 20)))


def parts():
    feet = [(x, y, 0) for x in (-55, 55) for y in (-45, 45)]
    foot = cq.Workplane("XY")
    for x, y, _ in feet:
        foot = foot.union(cq.Workplane("XY").circle(6.35).extrude(FOOT_H).translate((x, y, 0)))
    strip = cq.Workplane("XY").box(6, 1.6, STRIP_TOP - Z0, centered=(True, False, False)).translate((0, 8.6, Z0))
    return [
        {"name": "Base Plate", "shape": plate(), "group": "case", "process": "sheet",
         "params": {"material": "mild steel", "thickness_mm": PLATE_T, "bends": 0},
         "color": "#2a2a2e", "explode": [0, 0, -1]},
        {"name": "Post", "shape": fab.extrusion(POST_L, axis="z", at=(0, 0, Z0)),
         "group": "case", "process": "extrusion",
         "params": {"profile": "2020", "length_mm": POST_L, "tapped_ends": 2},
         "color": "#1c1c1f"},
        {"name": "Saddle", "shape": saddle(), "group": "case", "color": "#c9c3b8", "explode": [0, 0, 1]},
        {"name": "Plug Dock", "shape": dock(), "group": "case", "color": "#c9c3b8", "explode": [0, 1, 0]},
        {"name": "Slot Cover Strip", "shape": strip, "group": "component", "color": "#151517", "explode": [0, 1, 0]},
        {"name": "Rubber Feet", "shape": foot, "group": "component", "color": "#111111", "explode": [0, 0, -1]},
        {"name": "USB-C Cable (yours)", "shape": cable(), "group": "component", "color": "#e8e8e8"},
        {"name": "USB-C Plug (yours)", "shape": plug(), "group": "component", "color": "#f2f2f2"},
        part("bracket_2020", at=(0, -13, Z0 + 3), rot=(0, 0, -90)),
        part("m5x20_csk", at=(0, 0, ZT + 12.2)),
        part("m5x10_bhcs", at=(0, 0, FOOT_H), rot=(180, 0, 0)),
        part("m5x12_bhcs", at=(0, -23, FOOT_H), rot=(180, 0, 0)),
        part("m5x10_bhcs", at=[(0, -16, Z0 + 13)], rot=(90, 0, 0)),
        part("m5x16_bhcs", at=(0, 22, DOCK_Z + 7), rot=(-90, 0, 0)),
        part("m5_nut", at=(0, -23, Z0 + 3)),
    ]

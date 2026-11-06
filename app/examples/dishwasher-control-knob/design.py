import math
import cadquery as cq

# Knob size
D = 38.0          # grip diameter
H = 22.0          # total height
SKIRT_D = 44.0    # flared skirt at the panel
SKIRT_H = 3.0
# 6 mm D-shaft (standard flat leaves 4.5 mm). Bore is slightly oversize,
# three crush ribs give ~0.25 mm interference so the knob grips the shaft.
SHAFT_D = 6.3
FLAT = 4.7        # bore width across the flat
CRUSH = 0.25      # rib interference on the shaft
BORE_DEPTH = 14.0
RIBS = 18
WALL = 2.5        # side wall left inside the flutes


def knob():
    # skirt + grip body
    skirt = cq.Workplane("XY").circle(SKIRT_D / 2).workplane(offset=SKIRT_H).circle(D / 2).loft()
    body = cq.Workplane("XY").workplane(offset=SKIRT_H).circle(D / 2).extrude(H - SKIRT_H)
    k = skirt.union(body)
    try:
        k = k.faces(">Z").edges().fillet(3.0)
    except Exception:
        pass

    # grip flutes around the side
    for i in range(RIBS):
        a = 360 * i / RIBS
        flute = (cq.Workplane("XY").workplane(offset=SKIRT_H + 2)
                 .center(D / 2 + 0.6, 0).circle(1.6).extrude(H - SKIRT_H - 6)
                 .edges().fillet(0.7)
                 .rotate((0, 0, 0), (0, 0, 1), a))
        k = k.cut(flute)

    # recessed pointer line on top, pointing -Y at 0 deg
    pointer = (cq.Workplane("XY").workplane(offset=H - 1.0)
               .center(0, -(D / 2 - 9) / 2 - 4).rect(2.4, D / 2 - 7).extrude(2))
    k = k.cut(pointer)
    dot = cq.Workplane("XY").workplane(offset=H - 1.0).center(0, -(D / 2 - 3.5)).circle(1.5).extrude(2)
    try:
        k = k.cut(dot)
    except Exception:
        pass

    # hollow underside to save plastic, leaving a central boss for the shaft
    # (stays inside the flute roots so the side wall and skirt remain solid)
    flute_root = D / 2 + 0.6 - 1.6
    pocket = (cq.Workplane("XY").circle(flute_root - WALL).circle(6.5)
              .extrude(H - 6))
    k = k.cut(pocket)

    # D-shaped bore (flat faces -Y, same side as the pointer)
    r = SHAFT_D / 2
    d_prof = (cq.Workplane("XY").circle(r).extrude(BORE_DEPTH)
              .cut(cq.Workplane("XY").center(0, -(FLAT - r) - 5).rect(10, 10).extrude(BORE_DEPTH)))
    k = k.cut(d_prof)
    # lead-in chamfer at the bore mouth
    k = k.cut(cq.Workplane("XY").circle(r + 0.6).workplane(offset=0.8).circle(r).loft())

    # crush ribs: two on the round wall (30 / 150 deg) and one on the flat
    z0, rib_h = 1.0, BORE_DEPTH - 1.0
    tip = 3.0 - CRUSH
    for a in (30, 150):
        rib = (cq.Workplane("XY").workplane(offset=z0)
               .center((tip + r + 0.4) / 2, 0).rect(r + 0.4 - tip, 0.8).extrude(rib_h)
               .rotate((0, 0, 0), (0, 0, 1), a))
        k = k.union(rib)
    flat_y = -(FLAT - r)
    flat_tip = -(4.5 - 3.0) + CRUSH
    k = k.union(cq.Workplane("XY").workplane(offset=z0)
                .center(0, (flat_tip + flat_y - 0.4) / 2)
                .rect(0.8, flat_tip - flat_y + 0.4).extrude(rib_h))

    n = len(k.solids().vals())
    print(f"knob solids: {n}")
    assert n == 1, "knob must be one solid"
    return k


def parts():
    shaft_r = 3.0
    shaft = (cq.Workplane("XY").workplane(offset=-15).circle(shaft_r).extrude(15 + BORE_DEPTH - 1)
             .cut(cq.Workplane("XY").workplane(offset=-15).center(0, -(4.5 - shaft_r) - 5)
                  .rect(10, 10).extrude(30)))
    return [
        {"name": "Knob", "shape": knob(), "group": "case", "process": "print",
         "color": "#e8e8e4", "explode": [0, 0, 1]},
        {"name": "6 mm D-shaft (reference)", "shape": shaft, "group": "component",
         "color": "#9a9a9a"},
    ]

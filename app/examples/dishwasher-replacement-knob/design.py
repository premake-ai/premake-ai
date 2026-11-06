import math
import cadquery as cq

# Dishwasher knob for a 6 mm D-shaft (6.0 round x 4.5 across the flat, the common
# appliance size). Axis Z, back face (against the panel) on z=0, front face up.
# Printed front-face-down in ASA: hollow back and bore open upward, no supports.
D = 40.0            # knob diameter
H = 22.0            # knob height
TOP_R = 4.0         # front edge round-over
SCALLOPS = 18       # grip flutes
SHAFT_D = 6.0
SHAFT_FLAT = 4.5    # flat-to-round across the D (measure yours: 4.5-5.0 seen)
BORE_D = SHAFT_D + 0.2       # vertical holes print ~0.2 small -> snug
BORE_FLAT = SHAFT_FLAT + 0.05
BORE_DEPTH = 13.0            # OEM push-on knobs engage ~12.2 mm
RIB_PROTRUDE = 0.25          # crush ribs bite into the shaft's round side
BOSS_D = 12.0
RECESS_D = 32.0              # hollow back, leaves >= 2.5 mm wall under the flutes
RECESS_DEPTH = 15.0


def d_bore():
    r = BORE_D / 2
    b = cq.Workplane("XY").circle(r).extrude(BORE_DEPTH)
    # flat faces +Y, sits BORE_FLAT from the far (round) side at -Y
    flat_y = BORE_FLAT - r
    b = b.cut(cq.Workplane("XY").box(20, 20, BORE_DEPTH, centered=(True, False, False))
              .translate((0, flat_y, 0)))
    # two crush ribs on the round side, start 1.5 mm in so the shaft finds the bore
    for ang in (225, 315):
        a = math.radians(ang)
        rr = r - RIB_PROTRUDE + 0.5
        rib = (cq.Workplane("XY").circle(0.5).extrude(BORE_DEPTH - 1.5)
               .translate((rr * math.cos(a), rr * math.sin(a), 1.5)))
        b = b.cut(rib)
    # lead-in chamfer
    b = b.union(cq.Workplane("XY").circle(r + 0.6).workplane(offset=0.6).circle(r)
                .loft())
    return b


def knob():
    k = cq.Workplane("XY").circle(D / 2).extrude(H)
    k = k.faces(">Z").edges().fillet(TOP_R)
    k = k.faces("<Z").edges().chamfer(0.8)
    # grip flutes
    for i in range(SCALLOPS):
        a = 2 * math.pi * i / SCALLOPS + math.pi / SCALLOPS
        f = (cq.Workplane("XY").circle(2.5).extrude(H)
             .translate((21.0 * math.cos(a), 21.0 * math.sin(a), 0)))
        k = k.cut(f)
    # hollow back with a central boss around the shaft
    recess = (cq.Workplane("XY").circle(RECESS_D / 2).circle(BOSS_D / 2)
              .extrude(RECESS_DEPTH))
    k = k.cut(recess)
    try:
        k = k.faces("<Z").edges("not %LINE").edges(
            cq.selectors.RadiusNthSelector(1)).fillet(0.6)
    except Exception:
        pass
    k = k.cut(d_bore())
    # pointer groove on the front, aligned with the shaft flat (+Y)
    k = k.cut(cq.Workplane("XY").box(2.2, 9, 1.2, centered=(True, False, False))
              .translate((0, 6.5, H - 1.2)))
    k = k.cut(cq.Workplane("XY").circle(1.6).extrude(1.2).translate((0, 16.5 - 1.5, H - 1.2)))
    return k


def shaft():
    s = cq.Workplane("XY").circle(SHAFT_D / 2).extrude(28).translate((0, 0, -16))
    flat = (cq.Workplane("XY").box(10, 10, 28, centered=(True, False, False))
            .translate((0, SHAFT_FLAT - SHAFT_D / 2, -16)))
    return s.cut(flat)


def parts():
    return [
        {"name": "Knob", "id": "knob", "shape": knob(), "group": "case",
         "color": "#2b2d30", "explode": [0, 0, 1]},
        {"name": "Dishwasher D-shaft (reference)", "id": "shaft", "shape": shaft(),
         "group": "component", "color": "#b8b8b8"},
    ]


def motion():
    return [
        {"part": "knob", "type": "rotate", "axis": [0, 0, 1], "pivot": [0, 0, 0],
         "keys": [[0, 0], [0.4, -270], [0.6, -270], [1, 0]]},
        {"part": "shaft", "type": "rotate", "axis": [0, 0, 1], "pivot": [0, 0, 0],
         "keys": [[0, 0], [0.4, -270], [0.6, -270], [1, 0]]},
    ]

import math
import cadquery as cq
from cadlib.parts import part

SCENE = "desk"

# Low pour pot (desk plant watering pot). Modelled at the photo's proportions,
# then scaled by S; screw holes are cut after scaling so they stay true M3 sizes.
S = 0.85
R = 65.0        # body outer radius (before scaling)
H = 65.0        # body height (before scaling)
WALL = 2.5
LID_T = 4.0 / S                 # 4 mm real lid
LEDGE_Z = H - LID_T
SPOUT_W = 26.0
HANDLE_W = 18.0
SCREW_A = (135, -45)
SCREW_R = 57.5


def _xz_prism(pts, width):
    # polygon in XZ, extruded symmetric about Y=0
    return cq.Workplane("XZ").polyline(pts).close().extrude(width / 2, both=True)


def _scale(w):
    return cq.Workplane("XY").add(w.val().scale(S))


def screws():
    return [(S * SCREW_R * math.cos(math.radians(a)), S * SCREW_R * math.sin(math.radians(a))) for a in SCREW_A]


def body():
    # revolved shell: wall, floor, lid ledge with 45 deg underside
    prof = [(0, 0), (R, 0), (R, H), (R - WALL, H), (R - WALL, LEDGE_Z),
            (57, LEDGE_Z), (57, LEDGE_Z - 2), (R - WALL, LEDGE_Z - 2 - (R - WALL - 57)),
            (R - WALL, 3), (0, 3)]
    b = cq.Workplane("XZ").polyline(prof).close().revolve(360, (0, 0, 0), (0, 1, 0))

    spout = _xz_prism([(-50, 0), (-82, 0), (-115, 33), (-124, 56), (-118, H), (-50, H)], SPOUT_W)
    # hollow water channel inside the spout (45 deg floor, bridged ceiling), open into the pot
    chan = _xz_prism([(-55, 3), (-84, 3), (-112, 31), (-112, H - 3), (-55, H - 3)], SPOUT_W - 2 * WALL)
    outlet = cq.Workplane("YZ").workplane(offset=-130).center(0, 46).circle(4.5).extrude(25)
    handle = _xz_prism([(50, 0), (70, 0), (120, 50), (120, H - 4), (116, H), (50, H)], HANDLE_W)
    hole = _xz_prism([(60, 8), (92, 8), (108, 24), (108, H - 10), (60, H - 10)], HANDLE_W + 2)
    handle = handle.cut(hole)

    full = cq.Workplane("XY").workplane(offset=3).circle(R - WALL).extrude(H)
    b = b.union(spout.cut(full)).union(handle.cut(full))
    b = b.cut(chan).cut(outlet)
    for ang in SCREW_A:
        a = math.radians(ang)
        sx, sy = SCREW_R * math.cos(a), SCREW_R * math.sin(a)
        # screw boss under the lid ledge, tied to the wall by a rib, cone underneath
        boss = cq.Workplane("XY").workplane(offset=LEDGE_Z - 10).center(sx, sy).circle(4.5).extrude(10)
        rib = (cq.Workplane("XY").workplane(offset=LEDGE_Z - 10)
               .transformed(rotate=(0, 0, ang))
               .center(SCREW_R + 3.5, 0).rect(7, 9).extrude(10))
        cone = cq.Workplane("XY").add(cq.Solid.makeCone(0.5, 4.5, 4.5, cq.Vector(sx, sy, LEDGE_Z - 14.5)))
        b = b.union(boss).union(rib.intersect(cq.Workplane("XY").circle(R - 0.5).extrude(H))).union(cone)
    b = _scale(b)
    for sx, sy in screws():
        b = b.cut(cq.Workplane("XY").workplane(offset=S * LEDGE_Z - 7).center(sx, sy).circle(1.25).extrude(8))
    try:
        b = b.faces(">Z").edges().fillet(0.7)
    except Exception:
        pass
    return b


def lid():
    r = R - WALL - 0.3 / S
    l = cq.Workplane("XY").workplane(offset=LEDGE_Z).circle(r).extrude(LID_T)
    # fill opening at the back, finger slot at the front
    fill = cq.Workplane("XY").workplane(offset=LEDGE_Z - 1).center(0, 26).ellipse(34, 15).extrude(LID_T + 2)
    grip = cq.Workplane("XY").workplane(offset=H - 2 / S).center(0, -16).slot2D(78, 11).extrude(3)
    l = _scale(l.cut(fill).cut(grip))
    for sx, sy in screws():
        l = l.cut(cq.Workplane("XY").workplane(offset=S * LEDGE_Z - 1).center(sx, sy).circle(1.7).extrude(8))
    try:
        l = l.faces(">Z").edges("%CIRCLE").fillet(0.7)
    except Exception:
        pass
    return l


def parts():
    return [
        {"name": "Pot body", "shape": body(), "color": "#3d4044"},
        {"name": "Lid", "shape": lid(), "color": "#55595e", "explode": [0, 0, 1]},
        part("m3x10_selftap", at=[(sx, sy, S * H) for sx, sy in screws()]),
    ]


ASSEMBLY = [["Pot body"], ["Lid"]]

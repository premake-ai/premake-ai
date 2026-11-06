import math

import cadquery as cq
from cadlib import fab
from cadlib.parts import part
from cadlib.shapes import safe_fillet

# Desk plant watering pot: round body, faceted wedge spout, square loop handle, screwed lid with a fill slot.
SCENE = "desk"

S = 0.85          # overall scale vs. the photo (keeps the print under 6 h)
R = 55.0 * S      # body radius (93.5 mm across)
H = 62.0 * S      # body height
WALL = 1.8        # side wall (4 perimeters, watertight in PETG)
FLOOR = 1.8
REC_R = R - 4.0   # lid recess radius
LID_T = 2.0
GASKET_T = 1.0
REC_D = LID_T + GASKET_T
OPEN_R = REC_R - 3.5        # opening under the lid; the ledge between carries the gasket
SCREW_R = OPEN_R - 3.0      # screw circle (bosses touch the ledge)
SCREW_ANG = (50, 230)
BOSS_D = 7.5

# spout (outer): top slopes from the body rim down to the tip; underside flat, then 45 deg up to the tip face
TIP_X = -125.0 * S
X_TOP = -52.0 * S           # where the top starts to slope
TIP_TOP = 50.0 * S
X_BOT = -101.0 * S          # where the underside starts to rise
SPOUT_T = 1.8               # spout wall
BORE = 6.0


def z_top(x):
    return H - (X_TOP - x) * (H - TIP_TOP) / (X_TOP - TIP_X)


def z_bot(x):
    return max(0.0, X_BOT - x)


def half_w(x):
    return 22 * S + (x + 48 * S) * 8 / 77


def _spout():
    side = (cq.Workplane("XZ").polyline([(-30 * S, 0), (X_BOT, 0), (TIP_X, z_bot(TIP_X)), (TIP_X, TIP_TOP),
                                         (X_TOP, H), (-30 * S, H)]).close().extrude(40, both=True))
    top = (cq.Workplane("XY").polyline([(-30 * S, half_w(-30 * S)), (TIP_X, half_w(TIP_X)),
                                        (TIP_X, -half_w(TIP_X)), (-30 * S, -half_w(-30 * S))])
           .close().extrude(H + 2))
    return safe_fillet(side.intersect(top), "not |Y", 3, label="spout edges")


def _spout_cavity():
    """Inset of the spout with a 45 deg roof (pentagon sections) so the inside prints without support."""
    t = SPOUT_T
    xa = -0.85 * R
    xb = X_BOT + t * (math.sqrt(2) - 1)
    xc = TIP_X + t
    secs = [
        (xa, FLOOR + 0.5, min(z_top(xa) - t, H - REC_D - 4), half_w(xa) - t),
        (xb, t, z_top(xb) - t, half_w(xb) - t),
        (xc, z_bot(xc) + t * math.sqrt(2), z_top(xc) - t, half_w(xc) - t),
    ]
    wires = []
    for x, zb, zt, w in secs:
        pts = [(-w, zb), (w, zb), (w, zt - w), (0, zt), (-w, zt - w)]
        wires.append(cq.Workplane(cq.Plane(origin=(x, 0, 0), xDir=(0, 1, 0), normal=(-1, 0, 0)))
                     .polyline(pts).close().val())
    _, zb, zt, w = secs[-1]
    return cq.Workplane("XY").newObject([cq.Solid.makeLoft(wires, True)]), (zb + zt - w) / 2


def _handle():
    xo = R + 47 * S
    outer = cq.Workplane("XZ").polyline([(R - 12, 0), (xo, 0), (xo, H), (R - 12, H)]).close().extrude(5, both=True)
    hole = (cq.Workplane("XZ").polyline([(R - 20, 8), (xo - 9, 8), (xo - 9, H - 18), (xo - 18, H - 9),
                                         (R - 20, H - 9)]).close().extrude(10, both=True))
    return safe_fillet(outer.cut(hole), "not |Y", 3, label="handle edges")


def _screw_xy():
    return [(SCREW_R * math.cos(math.radians(a)), SCREW_R * math.sin(math.radians(a))) for a in SCREW_ANG]


def _body():
    cyl = cq.Workplane("XY").circle(R).extrude(H)
    cyl = safe_fillet(cyl, None, 1.5, label="body rims")
    body = cyl.union(_spout()).union(_handle())
    # water cavity, 45 deg shelf up to the lid ledge (prints without support)
    ri = R - WALL
    z_ledge = H - REC_D
    z1 = z_ledge - 2 - (ri - OPEN_R)
    cav = (cq.Workplane("XZ").polyline([(0, FLOOR), (ri, FLOOR), (ri, z1), (OPEN_R, z_ledge - 2),
                                        (OPEN_R, H + 1), (0, H + 1)]).close()
           .revolve(360, (0, 0, 0), (0, 1, 0)))
    body = body.cut(cav)
    body = body.cut(cq.Workplane("XY").circle(REC_R).extrude(REC_D + 1).translate((0, 0, z_ledge)))
    spc, bore_z = _spout_cavity()
    body = body.cut(spc)
    # screw bosses standing on the floor, pilot holes from the top
    top = z_ledge + GASKET_T - 0.3   # 0.3 mm below the lid so the screws squeeze the gasket
    for x, y in _screw_xy():
        body = body.union(cq.Workplane("XY").circle(BOSS_D / 2).extrude(top - 1).translate((x, y, 1)))
        body = body.cut(cq.Workplane("XY").circle(fab.pilot(3) / 2).extrude(9).translate((x, y, top - 9 + 0.01)))
    # pour hole through the tip face
    return body.cut(cq.Workplane("YZ").circle(BORE / 2).extrude(8).translate((TIP_X - 3, 0, bore_z)))


def parts():
    body = _body()
    z_lid = H - LID_T
    lid = cq.Workplane("XY").circle(REC_R - 0.3).extrude(LID_T).translate((0, 0, z_lid))
    lid = safe_fillet(lid, ">Z", 0.8, label="lid rim")
    lid = lid.cut(cq.Workplane("XY").slot2D(50, 10).extrude(20).translate((0, -11, z_lid - 5)))  # fill slot
    for x, y in _screw_xy():
        lid = lid.cut(cq.Workplane("XY").circle(1.7).extrude(20).translate((x, y, z_lid - 5)))
    gasket = (cq.Workplane("XY").circle(REC_R - 0.4).circle(SCREW_R + BOSS_D / 2 + 0.5).extrude(GASKET_T)
              .translate((0, 0, H - REC_D)))
    for x, y in _screw_xy():
        gasket = gasket.cut(cq.Workplane("XY").circle(1.7).extrude(5).translate((x, y, H - REC_D - 1)))
    return [
        {"name": "Pot body", "shape": body, "color": "#55595e"},
        {"name": "Lid gasket (TPU)", "shape": gasket, "color": "#1d1d1f", "explode": [0, 0, 1]},
        {"name": "Lid", "shape": lid, "color": "#686c71", "explode": [0, 0, 1]},
        part("m3x10_selftap", at=[(x, y, H) for x, y in _screw_xy()]),
    ]

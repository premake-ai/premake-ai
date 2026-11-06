"""Desk Tesla coil replica: USB-C powered, LED 'lightning' glow in the toroid.
No high voltage anywhere: an ESP32-C3 drives a 24-LED WS2812B ring."""
import math
import cadquery as cq
from cadlib.parts import part, info
from cadlib import fab

SCENE = "desk"

# --- main dimensions (mm) ---
BASE_D, BASE_H, WALL, TOP_T = 104.0, 26.0, 2.0, 2.0
PLATE_T, PLATE_CLR = fab.sheet_actual("plywood", 3), 0.3
BOSS_D, BOSS_R = 8.0, 42.0            # screw bosses inside the base
INS_HOLE, INS_DEPTH = 4.0, 6.0        # M3 heat-set insert hole
WIRE_D = 18.0                         # wire hole through base top

PRI_OD, PRI_H = 72.0, 7.0             # primary ring = tube socket
PRI_INS_DEPTH = 5.0                   # leaves 1 mm under the deepest groove
PRI_SCREW_R = 26.0
TUBE_OD, TUBE_ID, TUBE_H = 32.0, 28.0, 150.0
PRESS = 0.15                          # press-fit clearance on diameter
GROOVE_PITCH, GROOVE_DEPTH = 1.6, 0.5 # secondary winding look

TOR_R, TOR_r, TOR_WALL = 38.0, 12.0, 1.6  # toroid major / minor radius, shell wall
HUB_H = 8.0                           # centre hub thickness (z -4..4)
COLLAR_D, COLLAR_H, SOCK_DEPTH = 42.0, 10.0, 8.0
RING_OD, RING_ID, RING_T = 66.0, 52.0, 3.4  # 24-LED WS2812B ring (66 x 52 per listings)

TUBE_Z0 = BASE_H                      # tube stands on the base top, inside the primary ring
TOR_Z = TUBE_Z0 + TUBE_H - SOCK_DEPTH + COLLAR_H + HUB_H / 2  # toroid mid-plane (split plane)

C3 = info("esp32_c3_supermini")
C3_Z = PLATE_T - C3["bbox_min"][2] + 0.0  # board bottom on the plate cradle
C3_Y = BASE_D / 2 - WALL - 11.25 - 0.4    # USB-C end at the back wall (+Y)


def revolve(pts):
    """Revolve an (r, z) outline around Z."""
    return cq.Workplane("XZ").polyline(pts).close().revolve(360, (0, 0, 0), (0, 1, 0))


def base():
    r = BASE_D / 2
    b = cq.Workplane("XY").circle(r).extrude(BASE_H)
    try:
        b = b.edges(">Z").fillet(4.0).edges("<Z").fillet(2.0)
    except Exception:
        pass
    b = b.cut(cq.Workplane("XY").circle(r - WALL).extrude(BASE_H - TOP_T))
    # screw bosses hanging from the ceiling, insert holes from below
    for i in range(3):
        a = math.radians(90 + 120 * i)
        x, y = BOSS_R * math.cos(a), BOSS_R * math.sin(a)
        boss = (cq.Workplane("XY").circle(BOSS_D / 2).extrude(BASE_H - TOP_T - PLATE_T + 1.0)
                .translate((x, y, PLATE_T)))
        b = b.union(boss)
        b = b.cut(cq.Workplane("XY").circle(INS_HOLE / 2).extrude(INS_DEPTH).translate((x, y, PLATE_T)))
    # wire hole and primary-ring screw holes through the top
    b = b.cut(cq.Workplane("XY").circle(WIRE_D / 2).extrude(BASE_H + 1))
    for i in range(3):
        a = math.radians(30 + 120 * i)
        b = b.cut(cq.Workplane("XY").circle(3.4 / 2).extrude(BASE_H + 1)
                  .translate((PRI_SCREW_R * math.cos(a), PRI_SCREW_R * math.sin(a), 0)))
    # USB-C slot in the back wall
    uz = C3_Z + 1.0 + 1.6
    b = b.cut(cq.Workplane("XY").box(10.0, 10.0, 5.0).translate((0, r - WALL / 2, uz)))
    return b


def bottom_plate():
    """Laser-cut 3 mm plywood disc; ESP32-C3 sits on it on VHB tape, USB-C in the wall slot."""
    rp = BASE_D / 2 - WALL - PLATE_CLR
    p = cq.Workplane("XY").circle(rp).extrude(PLATE_T)
    for i in range(3):
        a = math.radians(90 + 120 * i)
        p = p.cut(cq.Workplane("XY").circle(3.4 / 2).extrude(PLATE_T + 1)
                  .translate((BOSS_R * math.cos(a), BOSS_R * math.sin(a), 0)))
    return p


def primary_ring():
    # (r, z) outline with V grooves on top = primary winding turns
    ri, ro = (TUBE_OD - PRESS) / 2 + PRESS, PRI_OD / 2
    pts = [(ri, 0), (ro - 1.5, 0), (ro, 1.5), (ro, PRI_H - 1.5), (ro - 1.5, PRI_H)]
    r = ro - 3.0
    while r - 3.0 > ri + 3.0:
        pts += [(r, PRI_H), (r - 1.0, PRI_H - 1.0), (r - 2.0, PRI_H)]
        r -= 3.0
    pts += [(ri + 1.0, PRI_H), (ri, PRI_H - 1.0)]
    ring = revolve(pts)
    for i in range(3):
        a = math.radians(30 + 120 * i)
        ring = ring.cut(cq.Workplane("XY").circle(INS_HOLE / 2).extrude(PRI_INS_DEPTH)
                        .translate((PRI_SCREW_R * math.cos(a), PRI_SCREW_R * math.sin(a), 0)))
    return ring.translate((0, 0, BASE_H))


def secondary():
    ro, ri = TUBE_OD / 2, TUBE_ID / 2
    plain = SOCK_DEPTH + 2.0            # smooth ends that go into the sockets
    pts = [(ri, 0), (ro, 0), (ro, plain)]
    z = plain
    while z + GROOVE_PITCH <= TUBE_H - plain:
        pts += [(ro - GROOVE_DEPTH, z + GROOVE_PITCH / 2), (ro, z + GROOVE_PITCH)]
        z += GROOVE_PITCH
    pts += [(ro, TUBE_H), (ri, TUBE_H)]
    return revolve(pts).translate((0, 0, TUBE_Z0))


def toroid_solid():
    t = cq.Workplane("XY").add(cq.Solid.makeTorus(TOR_R, TOR_r))
    hub = cq.Workplane("XY").circle(TOR_R).extrude(HUB_H).translate((0, 0, -HUB_H / 2))
    # hollow tube (open at the split plane, so each half prints as a dome, cut face down)
    return t.union(hub).cut(cq.Workplane("XY").add(cq.Solid.makeTorus(TOR_R, TOR_r - TOR_WALL)))


def ring_pocket(z0, depth):
    return (cq.Workplane("XY").circle(RING_OD / 2 + 0.6).circle(RING_ID / 2 - 0.6)
            .extrude(depth).translate((0, 0, z0)))


def toroid_bottom():
    half = toroid_solid().cut(cq.Workplane("XY").box(200, 200, 50).translate((0, 0, 25)))
    collar = (cq.Workplane("XY").circle(COLLAR_D / 2).extrude(COLLAR_H + 1)
              .translate((0, 0, -HUB_H / 2 - COLLAR_H)))
    try:
        collar = collar.faces("<Z").edges().chamfer(1.5)
    except Exception:
        pass
    half = half.union(collar)
    zb = -HUB_H / 2 - COLLAR_H
    half = half.cut(cq.Workplane("XY").circle((TUBE_OD + PRESS) / 2).extrude(SOCK_DEPTH).translate((0, 0, zb)))
    half = half.cut(ring_pocket(-RING_T / 2, RING_T / 2 + 1))
    # wire hole up from the tube bore, then a groove out to the ring
    half = half.cut(cq.Workplane("XY").circle(3.0).extrude(30).translate((9.0, 0, zb)))
    half = half.cut(cq.Workplane("XY").box(RING_ID / 2 - 6, 5.0, 2.0)
                    .translate((6 + (RING_ID / 2 - 6) / 2, 0, -1.0)))
    return half.translate((0, 0, TOR_Z))


def toroid_top():
    half = toroid_solid().cut(cq.Workplane("XY").box(200, 200, 50).translate((0, 0, -25)))
    half = half.cut(ring_pocket(-1, RING_T / 2 + 1))
    return half.translate((0, 0, TOR_Z))


def led_ring():
    return (cq.Workplane("XY").circle(RING_OD / 2).circle(RING_ID / 2).extrude(RING_T)
            .translate((0, 0, TOR_Z - RING_T / 2)))


def foot(x, y):
    return cq.Workplane("XY").circle(5.0).extrude(2.0).translate((x, y, -2.0))


def parts():
    boss_xy = [(BOSS_R * math.cos(math.radians(90 + 120 * i)),
                BOSS_R * math.sin(math.radians(90 + 120 * i))) for i in range(3)]
    pri_xy = [(PRI_SCREW_R * math.cos(math.radians(30 + 120 * i)),
               PRI_SCREW_R * math.sin(math.radians(30 + 120 * i))) for i in range(3)]
    feet = cq.Workplane("XY")
    for i in range(3):
        a = math.radians(30 + 120 * i)
        feet = feet.union(foot(40 * math.cos(a), 40 * math.sin(a)))
    return [
        {"name": "Base", "shape": base(), "group": "case", "color": "#26262a", "explode": [0, 0, 0]},
        {"name": "Bottom plate", "shape": bottom_plate(), "group": "case", "explode": [0, 0, -1],
         "process": "laser", "params": {"material": "plywood", "thickness_mm": 3}},
        {"name": "Primary ring", "shape": primary_ring(), "group": "case", "color": "#c27a3e", "explode": [0, 0, 1]},
        {"name": "Secondary coil", "shape": secondary(), "group": "case", "color": "#b87333", "explode": [0, 0, 1]},
        {"name": "Toroid bottom", "shape": toroid_bottom(), "group": "case", "color": "#d9dbe3", "explode": [0, 0, 1]},
        {"name": "Toroid top", "shape": toroid_top(), "group": "case", "color": "#eef0f8", "explode": [0, 0, 1],
         "fx": {"glow": {"color": "#b08cff", "mode": "pulse"}}},
        {"name": "24-LED WS2812B ring", "shape": led_ring(), "group": "component", "color": "#1d1d1d",
         "fx": {"glow": {"color": "#b08cff", "mode": "pulse"}}},
        {"name": "Rubber feet", "shape": feet, "group": "component", "color": "#111111", "material": "rubber"},
        part("esp32_c3_supermini", at=(0, C3_Y, C3_Z), rot=(0, 0, -90)),
        part("m3_insert", at=[(x, y, PLATE_T) for x, y in boss_xy]
             + [(x, y, BASE_H) for x, y in pri_xy]),
        part("m3x8_bhcs", at=[(x, y, 0) for x, y in boss_xy], rot=(180, 0, 0)),
        part("m3x6_shcs", at=[(x, y, BASE_H - TOP_T) for x, y in pri_xy], rot=(180, 0, 0)),
    ]


ASSEMBLY = [["Base"], ["Primary ring"], ["ESP32-C3 SuperMini", "Bottom plate"],
            ["Secondary coil"], ["24-LED WS2812B ring", "Toroid bottom", "Toroid top"], ["Rubber feet"]]

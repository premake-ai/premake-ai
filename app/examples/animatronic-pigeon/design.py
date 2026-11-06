import numpy as np
import cadquery as cq
from cadlib.parts import part
from cadlib.motion import rot

# Animatronic pigeon: 4 x SG90 (neck pan, head tilt, two wings), ESP32-C3, DFPlayer coos, PIR wake-up.
T = 2.4                                  # shell wall
NECK_AX = (0, -58)                       # neck yaw axis (x, y)
TILT_PIV = (0, -64, 178)                 # head pitch axis (along X)
WING_PIV = (26, -5, 128)                 # wing flap axis (along Y), mirrored in X


def ell(a, b, c, at):
    s = cq.Workplane("XY").sphere(1).val().transformGeometry(
        cq.Matrix([[a, 0, 0, 0], [0, b, 0, 0], [0, 0, c, 0]]))
    return cq.Workplane("XY").add(s).translate(at)


def body_solid(o):
    return ell(44 - o, 88 - o, 48 - o, (0, 10, 110)).union(ell(40 - o, 45 - o, 42 - o, (0, -45, 125)))


def zbox(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def wing(s):
    """s = -1 left, +1 right."""
    w = ell(7, 68, 26, (s * 49, 22, 100))
    prim = ell(5.5, 34, 13, (s * 49, 70, 96))
    arm = zbox(min(s * 24, s * 47), max(s * 24, s * 47), -9, -2, 123, 130)
    hub = cq.Workplane("XZ").circle(6).extrude(7).translate((s * WING_PIV[0], -2, WING_PIV[2]))
    bars = (zbox(-1, 1, 18, 23, 88, 116).union(zbox(-1, 1, 31, 36, 86, 114))
            .translate((s * 55.5, 0, 0))).intersect(ell(7.8, 68, 26, (s * 49, 22, 100)))
    return w.union(arm).union(hub).cut(prim), prim, bars


def parts():
    # --- body shells, split at z=110 around the internal chassis
    outer, inner = body_solid(0), body_solid(T)
    shell = outer.cut(inner)
    shell = shell.cut(cq.Workplane("XY").circle(22).extrude(60).translate((*NECK_AX, 140)))
    for s in (-1, 1):  # wing-arm slots
        shell = shell.cut(cq.Workplane("XZ").circle(26).extrude(5).translate((s * WING_PIV[0], -1, WING_PIV[2])))
    for x in (-16, 16):  # leg holes
        shell = shell.cut(cq.Workplane("XY").circle(4.8).extrude(40).translate((x, 15, 50)))
    upper = shell.intersect(zbox(-60, 60, -110, 110, 110, 200))
    lower = shell.intersect(zbox(-60, 60, -110, 110, 40, 110))
    # speaker grille in the belly
    lower = lower.cut(cq.Workplane("XY").pushPoints(
        [(x, y) for x in (-6, 0, 6) for y in (-26, -20, -14)]).circle(1.6).extrude(20).translate((0, 0, 60)))

    # --- chassis: plate + servo pedestals, legs screw into it
    chassis = (cq.Workplane("XY").ellipse(36, 74).extrude(4).translate((0, 8, 104))
               .union(zbox(-17, 6, -64, -52, 104, 116))            # pan servo pedestal
               .union(zbox(-32, -20, 2, 25, 104, 111.1))
               .union(zbox(20, 32, 2, 25, 104, 111.1))
               .union(zbox(-14, 14, -40, -32, 104, 112)))          # speaker clamp

    # --- neck (yaws) and head (pitches)
    neck = (cq.Workplane("XY").workplane(offset=140).center(*NECK_AX).circle(27)
            .workplane(offset=48).center(0, -6).circle(16).loft())
    neck_in = (cq.Workplane("XY").workplane(offset=140).center(*NECK_AX).circle(27 - T)
               .workplane(offset=48).center(0, -6).circle(16 - T).loft())
    neck = neck.cut(neck_in)
    head = ell(20, 25, 21, (0, -73, 198)).cut(ell(20 - T, 25 - T, 21 - T, (0, -73, 198)))
    head = head.cut(cq.Workplane("XY").circle(13).extrude(20).translate((0, -64, 172)))
    for s in (-1, 1):
        head = head.cut(cq.Workplane("YZ").circle(4.1).extrude(8).translate((s * 15 if s > 0 else -23, -80, 203)))
    beak = (cq.Workplane("XZ").workplane(offset=90).center(0, 193).ellipse(5, 4)
            .workplane(offset=20).center(0, -3).circle(1.2).loft())
    cere = ell(4.5, 5, 3.2, (0, -93, 198.5))
    eyes = (cq.Workplane("YZ").circle(4).extrude(4).translate((15.5, -80, 203))
            .union(cq.Workplane("YZ").circle(4).extrude(4).translate((-19.5, -80, 203))))

    # --- wings, tail, legs, base
    wl, pl, bl = wing(-1)
    wr, pr, br = wing(1)
    tail_pts = [(-20, 0), (20, 0), (30, 72), (-30, 72)]
    tail = (cq.Workplane("XY").polyline(tail_pts).close().extrude(5)
            .edges("|Z").fillet(3).rotate((0, 0, 0), (1, 0, 0), -14).translate((0, 82, 98)))
    tail_tip = tail.intersect(zbox(-40, 40, 140, 170, 60, 120))
    tail = tail.cut(tail_tip)

    legs = cq.Workplane("XY")
    for x in (-16, 16):
        legs = legs.union(cq.Workplane("XY").circle(4.5).extrude(90).translate((x, 15, 16)))
        for a in (-25, 0, 25, 180):
            ln = 12 if a == 180 else 22
            toe = (cq.Workplane("XY").slot2D(ln, 4.5).extrude(3.5).translate((ln / 2 - 2, 0, 0))
                   .rotate((0, 0, 0), (0, 0, 1), -90 + a).translate((x, 15, 16)))
            legs = legs.union(toe)

    base = cq.Workplane("XY").ellipse(62, 96).extrude(16)
    try:
        base = base.faces(">Z").edges().fillet(6)
    except Exception:
        pass
    base = (base.cut(cq.Workplane("XY").ellipse(62 - T, 96 - T).extrude(16 - T))
            .translate((0, 12, 0))
            .cut(zbox(-5, 5, 100, 112, 3, 8))                    # USB-C port, rear
            .cut(cq.Workplane("XZ").circle(5.2).extrude(-10).translate((0, -78, 9))))  # PIR lens
    for x in (-16, 16):
        base = base.cut(cq.Workplane("XY").circle(2.5).extrude(20).translate((x, 15, 0)))
    bottom = cq.Workplane("XY").ellipse(59.4, 93.4).extrude(3).translate((0, 12, 0))

    pir = cq.Workplane("XZ").circle(5).extrude(18).translate((0, -60, 9)).union(
        cq.Workplane("XZ").sphere(5).translate((0, -79, 9)))
    dfp = zbox(-10.5, 10.5, 50, 71, 108, 116)
    spk = cq.Workplane("XY").circle(14).extrude(5).translate((0, -20, 99))

    G, D = "#8f97a6", "#3b3e46"
    return [
        {"name": "Base", "shape": base, "group": "case", "color": "#55585e"},
        {"name": "Base Bottom", "shape": bottom, "group": "case", "color": "#c9a878",
         "process": "laser", "params": {"material": "plywood", "thickness_mm": 3}, "explode": [0, 0, -1]},
        {"name": "Legs and Feet", "shape": legs, "group": "case", "color": "#c9686e"},
        {"name": "Body Lower", "shape": lower, "group": "case", "color": "#9aa2b0", "explode": [0, 0, -1]},
        {"name": "Chassis", "shape": chassis, "group": "case", "color": "#e0e0e0"},
        {"name": "Body Upper", "shape": upper, "group": "case", "color": G, "explode": [0, 0, 1]},
        {"name": "Neck", "id": "neck", "shape": neck, "group": "case", "color": "#4f7d6c", "explode": [0, -0.3, 1]},
        {"name": "Head", "id": "head", "shape": head, "group": "case", "color": "#6d7584", "explode": [0, -0.5, 1]},
        {"name": "Beak", "id": "beak", "shape": beak, "group": "case", "color": "#2c2c30"},
        {"name": "Cere", "id": "cere", "shape": cere, "group": "case", "color": "#eeeeea"},
        {"name": "Safety Eyes 8mm", "id": "eyes", "shape": eyes, "group": "component", "color": "#e4682a"},
        {"name": "Left Wing", "id": "wl", "shape": wl, "group": "case", "color": "#a6aebb", "explode": [-1, 0, 0]},
        {"name": "Left Primaries", "id": "pl", "shape": pl, "group": "case", "color": D, "explode": [-1, 0, 0]},
        {"name": "Left Wing Bars", "id": "bl", "shape": bl, "group": "case", "color": "#222326", "explode": [-1, 0, 0]},
        {"name": "Right Wing", "id": "wr", "shape": wr, "group": "case", "color": "#a6aebb", "explode": [1, 0, 0]},
        {"name": "Right Primaries", "id": "pr", "shape": pr, "group": "case", "color": D, "explode": [1, 0, 0]},
        {"name": "Right Wing Bars", "id": "br", "shape": br, "group": "case", "color": "#222326", "explode": [1, 0, 0]},
        {"name": "Tail", "shape": tail, "group": "case", "color": "#7b8392", "explode": [0, 1, 0]},
        {"name": "Tail Band", "shape": tail_tip, "group": "case", "color": "#26272b", "explode": [0, 1, 0]},
        part("sg90", at=[(-5.5, -58, 116.1)]),                                   # neck pan
        {**part("sg90", at=(-14, -64, 183.5), rot=(0, 90, 0)), "id": "tilt"},     # head tilt
        {**part("sg90", at=(-WING_PIV[0], -5 + 29.9, 122.5), rot=(90, -90, 0)), "id": "sl"},
        {**part("sg90", at=(WING_PIV[0], -5 + 29.9, 122.5), rot=(90, -90, 0)), "id": "sr"},
        part("esp32_c3_supermini", at=(0, 30, 108)),
        part("usbc_breakout", at=(0, 100, 3), rot=(0, 0, -90)),
        {"name": "DFPlayer Mini + microSD", "shape": dfp, "group": "component", "color": "#1d4fa0"},
        {"name": "Speaker 28mm 8ohm", "shape": spk, "group": "component", "color": "#222222"},
        {"name": "AM312 PIR sensor", "shape": pir, "group": "component", "color": "#f2f2f2"},
    ]


def _M(tr):
    return np.array(tr["matrix"])


def motion():
    def wave(t, a, b, n=1):
        return 0 if t <= a or t >= b else np.sin(np.pi * n * (t - a) / (b - a))

    def pose(t):
        yaw = 55 * wave(t, 0.05, 0.45, 2) - 30 * wave(t, 0.8, 0.98)
        nod = 18 * wave(t, 0.45, 0.6, 3) + 10 * abs(wave(t, 0.05, 0.45, 4))
        flap = 95 * abs(wave(t, 0.6, 0.8, 3))
        N = _M(rot((0, 0, 1), yaw, (*NECK_AX, 0)))
        H = (N @ _M(rot((1, 0, 0), -nod, TILT_PIV))).tolist()
        L = rot((0, 1, 0), flap, (-WING_PIV[0], 0, WING_PIV[2]))
        R = rot((0, 1, 0), -flap, (WING_PIV[0], 0, WING_PIV[2]))
        out = {"neck": {"matrix": N.tolist()}, "tilt": {"matrix": N.tolist()}}
        out.update({k: {"matrix": H} for k in ("head", "beak", "cere", "eyes")})
        out.update({k: L for k in ("wl", "pl", "bl", "sl_horn")})
        out.update({k: R for k in ("wr", "pr", "br")})
        out.pop("sl_horn")
        return out
    return {"duration": 8, "pose": pose}

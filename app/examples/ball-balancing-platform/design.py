"""Ball-balancing desk toy: 3-RRS parallel plate on 3 MG996R servos, 8" 4-wire resistive touch plate.

Leg frame (leg i at angle th): X = radial out, Y = tangential (+theta), Z = up; the leg plane is Y = 0.
Servo shaft along Y at (R_B, Z_S); horn arm (ARM) swings in the leg plane; printed link + M3 rod end
(L, horn pin -> ball centre) up to a ball stud on the plate at radius R_P. R = revolute (shaft),
R = revolute (horn pin, parallel to shaft), S = ball joint: 3-RRS.
"""
import math
import numpy as np
import cadquery as cq
from cadlib import fab
from cadlib.parts import part
from cadlib.motion import ease

SCENE = "desk"
CABLES = True
ASSEMBLY = [
    ["Bottom plate", "Rubber feet"],
    ["Servo tower A", "Servo tower B", "Servo tower C"],
    ["Servo A", "Servo B", "Servo C"],
    ["ESP32 screw-terminal breakout", "ESP32 DevKitC (WROOM-32, 38 pin)", "PCA9685 servo driver", "1000uF capacitor",
     "Wago 221-412 (fuse)", "Wago 221-413 (5V)", "Wago 221-413 (GND)", "Inline fuse holder 5A"],
    ["Base shell", "DC jack, panel mount, pre-wired"],
    ["Servo horn A", "Servo horn B", "Servo horn C"],
    ["Link A", "Link B", "Link C", "Set screw A", "Set screw B", "Set screw C", "Rod end A", "Rod end B", "Rod end C"],
    ["Top deck"],
    ["Joint bracket A", "Joint bracket B", "Joint bracket C", "Ball stud A", "Ball stud B", "Ball stud C"],
    ["Plate", "8in resistive touch panel", "TSC2007 touch controller"],
    ["Ball rim"],
    ["Steel ball 1-1/4in", "Ping-pong ball"],
]

# ---------------------------------------------------------------- linkage geometry (mm)
LEGS = [90.0, 210.0, 330.0]        # A back, B front-left, C front-right
R_B = 62.0                         # servo shaft radius
ARM = 20.0                         # horn hole used (B0CD5ZYTLB: 12 / 16 / 20 mm holes)
L = 45.0                           # horn pin -> ball centre
R_P = R_B + ARM                    # ball joints on the plate (arm level, link vertical at home)
Z_S = 50.0                         # shaft height
Z_B = Z_S + L                      # ball-joint height at home
ARM_LIMIT = 38.0                   # deg each way (horn clears the deck)

# ---------------------------------------------------------------- stack (mm)
T6 = fab.sheet_actual("acrylic", 6)    # 5.5
T3 = fab.sheet_actual("acrylic", 3)    # 3.0
FEET = 5.0
Z_BOT = FEET + T6                  # top of bottom disc (10.5)
Z_DECK = 69.0                      # underside of top deck
R_BASE = 97.0
SHELL_T = 1.6
Z_PLATE = 104.0                    # underside of plate disc
R_PLATE = 124.0
R_RIM_IN = 117.0
PANEL = (183.0, 141.0, 1.6)        # NJYTouch 8" 4:3 (183 x 141), + tape
Z_PANEL = Z_PLATE + T3
PP_R = 20.0                        # ping-pong ball 40 mm
STEEL_R = 31.75 / 2                # 1-1/4" steel ball

# MG996R (Handsontec drawing): 40.7 x 19.7 body, shaft 10 from the top end, tabs 54 long, holes 49.5 x 10
SV_BOT = -47.0                     # body bottom face (y, leg frame), output side towards +Y
SV_TAB = SV_BOT + 26.6             # tab underside
SV_ZC = Z_S - 10.2                 # body centre height
WALL_Y = (SV_TAB - T6, SV_TAB)     # servo tower (6 mm acrylic), tabs bear on its +Y face


def U(th):
    a = math.radians(th)
    return np.array([math.cos(a), math.sin(a), 0.0])


def T(th):
    a = math.radians(th)
    return np.array([-math.sin(a), math.cos(a), 0.0])


def legw(shape, th):
    return shape.rotate((0, 0, 0), (0, 0, 1), th)


def legp(th, x, y, z):
    a = math.radians(th)
    return (x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a), z)


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def cyl_y(x, z, r, y0, y1):
    return cq.Workplane("XZ", origin=(0, y1, 0)).center(x, z).circle(r).extrude(y1 - y0)


def cyl_z(x, y, r, z0, z1):
    return cq.Workplane("XY", origin=(0, 0, z0)).center(x, y).circle(r).extrude(z1 - z0)


def soft(w, sel, r):
    try:
        return w.edges(sel).fillet(r)
    except Exception:
        return w


# ---------------------------------------------------------------- inverse kinematics (same maths as firmware)
def _rz(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1.0]])


def tilt_matrix(tx_deg, ty_deg):
    """Ry(ty) @ Rx(tx): tx tilts +Y up, ty tilts +X down."""
    a, b = math.radians(tx_deg), math.radians(ty_deg)
    rx = np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]])
    ry = np.array([[math.cos(b), 0, math.sin(b)], [0, 1, 0], [-math.sin(b), 0, math.cos(b)]])
    return ry @ rx


def plate_pose(Rt, h=Z_B):
    """3-RRS: every ball joint must stay in its leg plane. Solve the parasitic x, y, yaw (Newton)."""
    x = y = psi = 0.0
    z = np.array([0, 0, 1.0])
    for _ in range(6):
        R = _rz(psi) @ Rt
        f, J = [], []
        for th in LEGS:
            q = R @ (R_P * U(th))
            t = T(th)
            P = np.array([x, y, h]) + q
            f.append(P @ t)
            J.append([t[0], t[1], np.cross(z, q) @ t])
        d = np.linalg.solve(np.array(J), np.array(f))
        x, y, psi = x - d[0], y - d[1], psi - d[2]
    R = _rz(psi) @ Rt
    return np.array([x, y, h]), R


def leg_angles(c, R):
    out = []
    for th in LEGS:
        P = c + R @ (R_P * U(th))
        dx, dz = P @ U(th) - R_B, P[2] - Z_S
        k = (dx * dx + dz * dz + ARM * ARM - L * L) / (2 * ARM)
        out.append(math.degrees(math.atan2(dz, dx) - math.acos(max(-1, min(1, k / math.hypot(dx, dz))))))
    return out


# ---------------------------------------------------------------- leg-frame shapes
def servo_body():
    b = box(R_B - 9.85, R_B + 9.85, SV_BOT, SV_BOT + 36.6, Z_S - 30.7, Z_S + 10.0)
    b = soft(b, "|Y", 1.0)
    tabs = box(R_B - 9.0, R_B + 9.0, SV_TAB, SV_TAB + 2.5, SV_ZC - 27.0, SV_ZC + 27.0)
    for hx in (R_B - 5, R_B + 5):
        for hz in (SV_ZC - 24.75, SV_ZC + 24.75):
            tabs = tabs.cut(cyl_y(hx, hz, 2.25, SV_TAB - 1, SV_TAB + 4))
    boss = cyl_y(R_B, Z_S, 6.5, SV_BOT + 36.0, SV_BOT + 39.0)
    spline = cyl_y(R_B, Z_S, 2.95, SV_BOT + 38.5, SV_BOT + 42.9)
    return b.union(tabs).union(boss).union(spline)


def horn():
    hub = cyl_y(R_B, Z_S, 5.0, SV_BOT + 37.5, -3.2)
    arm = box(R_B, R_P, -6.2, -3.2, Z_S - 4.5, Z_S + 4.5).union(cyl_y(R_P, Z_S, 4.5, -6.2, -3.2))
    return hub.union(arm).cut(cyl_y(R_P, Z_S, 1.5, -7, -3))


LINK_TOP = Z_B - 15.0              # rod end shank starts here (rod end eye-to-face 15 mm)


def link_part():
    bar = box(R_P - 4.5, R_P + 4.5, -3, 3, Z_S, LINK_TOP)
    bar = bar.union(cyl_y(R_P, Z_S, 5.5, -3, 3))
    bar = bar.cut(cyl_y(R_P, Z_S, 1.6, -4, 4))                       # 3.2 bore: pivots on the M3 screw
    bar = bar.cut(cyl_z(R_P, 0, 1.25, LINK_TOP - 9, LINK_TOP + 1))     # 2.5 pilot for the M3 set screw
    return soft(bar, "|Y", 1.2)


def rod_end():
    shank = cyl_z(R_P, 0, 2.9, LINK_TOP, Z_B - 4)
    eye = cyl_y(R_P, Z_B, 5.5, -3, 3)
    return shank.union(eye)


def ball_stud():
    ball = cq.Workplane("XY").sphere(3.2).translate((R_P, 0, Z_B))
    shaft = cyl_y(R_P, Z_B, 2.6, 0, 4.0).union(cyl_y(R_P, Z_B, 1.5, 0, 11.5))
    return ball.union(shaft)


TOWER_TABS = ((45.0, 50.5), (84.0, 89.5))   # tabs through the bottom disc and the deck
TSLOT_X = 78.0                              # one captive-nut T-slot per edge
TOWER_X1 = 91.6                             # outer corner stays inside the shell (r 95.3)


def tower(th):
    """Laser-cut 6 mm acrylic servo tower: tabs key into the discs, M3 T-slot at each edge."""
    x0, x1 = 44.0, TOWER_X1
    y0, y1 = WALL_Y
    w = box(x0, x1, y0, y1, Z_BOT, Z_DECK)
    for a, b in TOWER_TABS:
        w = w.union(box(a, b, y0, y1, FEET, Z_BOT + 0.5)).union(box(a, b, y0, y1, Z_DECK - 0.5, Z_DECK + T3))
    w = w.cut(box(R_B - 10.4, R_B + 10.4, y0 - 1, y1 + 1, Z_S - 31.0, Z_S + 10.5))
    for hx in (R_B - 5, R_B + 5):                                      # MG996R tab holes, M3 + nut
        for hz in (SV_ZC - 24.75, SV_ZC + 24.75):
            w = w.cut(cyl_y(hx, hz, 1.7, y0 - 1, y1 + 1))
    for ze, s in ((Z_BOT, 1), (Z_DECK, -1)):                           # T-slots: screw slot + nut pocket
        w = w.cut(box(TSLOT_X - 1.6, TSLOT_X + 1.6, y0 - 1, y1 + 1, min(ze, ze + s * 9), max(ze, ze + s * 9)))
        za, zb = ze + s * 3.0, ze + s * 5.7
        w = w.cut(box(TSLOT_X - 2.9, TSLOT_X + 2.9, y0 - 1, y1 + 1, min(za, zb), max(za, zb)))
    return legw(w, th)


def disc_cuts(disc, z0, z1):
    for th in LEGS:
        for a, b in TOWER_TABS:
            disc = disc.cut(legw(box(a - 0.15, b + 0.15, WALL_Y[0] - 0.15, WALL_Y[1] + 0.15, z0, z1), th))
        p = legp(th, TSLOT_X, sum(WALL_Y) / 2, 0)
        disc = disc.cut(cyl_z(p[0], p[1], 1.7, z0, z1))
    return disc


def bracket(th):
    """Ball-joint bracket under the plate: screwed through rim + plate at its outer end."""
    zt = Z_PLATE
    bar = box(R_P - 6, 113, 4.0, 14.0, zt - 6, zt)                    # beside the rod-end eye (y +-3)
    pad = box(108, R_PLATE - 1.5, -13, 14, zt - 9.5, zt)
    tab = box(R_P - 6, R_P + 6, 4.0, 8.0, Z_B - 6, zt - 5)
    b = bar.union(pad).union(tab)
    b = b.cut(cyl_y(R_P, Z_B, 1.7, 2, 9))                              # 3.4 clearance for the ball stud
    for py in (-8, 8):
        b = b.cut(cyl_z(120, py, 1.25, zt - 9, zt + 1))                # 2.5 pilots for M3x16
    b = soft(b, "|Z", 1.5)
    return legw(b, th)


# ---------------------------------------------------------------- the product
def parts():
    out = []
    zr = np.array([0, 0, 1.0])

    # base: bottom disc, printed shell, deck
    bot = cq.Workplane("XY", origin=(0, 0, FEET)).circle(R_BASE).extrude(T6)
    bot = disc_cuts(bot, 0, 20)
    out.append({"name": "Bottom plate", "shape": bot, "group": "case", "process": "laser",
                "params": {"material": "acrylic", "thickness_mm": 6}, "color": "#1d1e21", "explode": [0, 0, -1]})

    deck = cq.Workplane("XY", origin=(0, 0, Z_DECK)).circle(R_BASE).extrude(T3)
    deck = deck.cut(cyl_z(0, 0, 8, Z_DECK - 1, Z_DECK + 5))
    for th in LEGS:
        slot = cq.Workplane("XY", origin=(0, 0, Z_DECK - 1)).center(80, 0).slot2D(22, 14, 0).extrude(6)
        deck = deck.cut(legw(slot, th))
    deck = disc_cuts(deck, Z_DECK - 1, Z_DECK + 5)
    out.append({"name": "Top deck", "shape": deck, "group": "case", "process": "laser",
                "params": {"material": "acrylic", "thickness_mm": 3}, "color": "#1d1e21", "explode": [0, 0, 1]})

    shell = cq.Workplane("XY", origin=(0, 0, Z_BOT)).circle(R_BASE).circle(R_BASE - SHELL_T).extrude(Z_DECK - Z_BOT - 0.2)
    shell = soft(shell, ">Z or <Z", 0.6)
    inner = cyl_z(0, 0, R_BASE - SHELL_T + 0.8, Z_BOT, Z_DECK)
    for th in LEGS:                                                    # keys either side of each tower end
        for y0 in (WALL_Y[1] + 0.4, WALL_Y[0] - 2.9):
            key = legw(box(TOWER_X1 - 4, R_BASE, y0, y0 + 2.5, Z_BOT, Z_DECK - 0.2), th).intersect(inner)
            shell = shell.union(key)
    jack_a = 105.0
    jx, jy, _ = legp(jack_a, R_BASE, 0, 0)
    pad = cq.Workplane("YZ", origin=(R_BASE - SHELL_T - 1.4 + 0.01, 0, 0)).center(0, 36).circle(11).extrude(2.0)
    shell = shell.union(pad.rotate((0, 0, 0), (0, 0, 1), jack_a))
    hole = cq.Workplane("YZ", origin=(R_BASE - 8, 0, 0)).center(0, 36).circle(5.6).extrude(12)
    shell = shell.cut(hole.rotate((0, 0, 0), (0, 0, 1), jack_a))
    usb = cq.Workplane("YZ", origin=(R_BASE - 8, 0, 0)).center(0, 27).rect(18, 11).extrude(12)
    shell = shell.cut(usb.rotate((0, 0, 0), (0, 0, 1), 270))
    out.append({"name": "Base shell", "shape": shell, "group": "case", "color": "#eceef0", "explode": [0, 0, 0.6]})

    for th, sx in zip(LEGS, "ABC"):
        out.append({"name": f"Servo tower {sx}", "shape": tower(th), "group": "case", "process": "laser",
                    "params": {"material": "acrylic", "thickness_mm": 6}, "color": "#1d1e21"})

    # feet
    feet = None
    for a in (30, 150, 270):
        p = legp(a, 82, 0, 0)
        f = cyl_z(p[0], p[1], 6.35, 0, FEET)
        feet = f if feet is None else feet.union(f)
    out.append({"name": "Rubber feet", "shape": feet, "group": "component", "color": "#222222", "material": "rubber"})

    # servos, horns, links, rod ends
    for i, (th, sx) in enumerate(zip(LEGS, "ABC")):
        out.append({"name": f"Servo {sx}", "id": f"servo_{sx}", "shape": legw(servo_body(), th),
                    "group": "component", "color": "#1a1a1c"})
        out.append({"name": f"Servo horn {sx}", "id": f"horn_{sx}", "shape": legw(horn(), th),
                    "group": "component", "color": "#c8ccd2", "material": "aluminium"})
        out.append({"name": f"Link {sx}", "id": f"link_{sx}", "shape": legw(link_part(), th),
                    "group": "case", "color": "#ff6a3d"})
        out.append({"name": f"Rod end {sx}", "id": f"rodend_{sx}", "shape": legw(rod_end(), th),
                    "group": "component", "color": "#9aa1aa", "material": "aluminium"})
        out.append({"name": f"Set screw {sx}", "id": f"setscrew_{sx}",
                    "shape": legw(cyl_z(R_P, 0, 1.5, LINK_TOP - 7, LINK_TOP + 6), th), "group": "component",
                    "color": "#333333", "material": "steel"})
        out.append({"name": f"Ball stud {sx}", "id": f"stud_{sx}", "shape": legw(ball_stud(), th),
                    "group": "component", "color": "#b8bcc2", "material": "steel"})
        out.append({"name": f"Joint bracket {sx}", "id": f"bracket_{sx}", "shape": bracket(th),
                    "group": "case", "color": "#f4f4f5"})

        tab_pts = [legp(th, hx, SV_TAB + 2.5, hz) for hx in (R_B - 5, R_B + 5) for hz in (SV_ZC - 24.75, SV_ZC + 24.75)]
        out.append(part("m3x12_bhcs", at=tab_pts, rot=(-90, 0, th)))
        out.append(part("m3_nut", at=[legp(th, hx, WALL_Y[0], hz) for hx in (R_B - 5, R_B + 5)
                                      for hz in (SV_ZC - 24.75, SV_ZC + 24.75)], rot=(90, 0, th)))
        piv = part("m3x16_shcs", at=legp(th, R_P, 3.0, Z_S), rot=(-90, 0, th))
        piv["id"] = f"pivot_{sx}"
        out.append(piv)
        nyl = part("m3_nylock", at=legp(th, R_P, -6.2, Z_S), rot=(90, 0, th))
        nyl["id"] = f"nylock_{sx}"
        out.append(nyl)
        nut = part("m3_nut", at=legp(th, R_P, 8.0, Z_B), rot=(-90, 0, th))
        nut["id"] = f"studnut_{sx}"
        out.append(nut)

    yc = sum(WALL_Y) / 2
    out.append(part("m3x12_bhcs", at=[legp(th, TSLOT_X, yc, FEET) for th in LEGS], rot=(180, 0, 0)))
    out.append(part("m3x12_bhcs", at=[legp(th, TSLOT_X, yc, Z_DECK + T3) for th in LEGS]))
    out.append(part("m3_nut", at=[legp(th, TSLOT_X, yc, ze) for th in LEGS for ze in (Z_BOT + 3.1, Z_DECK - 5.6)]))

    # plate: acrylic disc, rim ring, touch panel
    plate = cq.Workplane("XY", origin=(0, 0, Z_PLATE)).circle(R_PLATE).extrude(T3)
    rim = cq.Workplane("XY", origin=(0, 0, Z_PANEL)).circle(R_PLATE).circle(R_RIM_IN).extrude(T6)
    holes = [legp(th, 120, py, 0) for th in LEGS for py in (-8, 8)]
    for p in holes:
        plate = plate.cut(cyl_z(p[0], p[1], 1.7, 90, 130))
        rim = rim.cut(cyl_z(p[0], p[1], 1.7, 90, 130))
    plate = plate.cut(box(-95.5, -92.5, -15, 15, Z_PLATE - 1, Z_PANEL + 1))     # FPC tail slot
    out.append({"name": "Plate", "id": "plate", "shape": plate, "group": "case", "process": "laser",
                "params": {"material": "acrylic", "thickness_mm": 3}, "color": "#1d1e21", "explode": [0, 0, 1]})
    out.append({"name": "Ball rim", "id": "rim", "shape": rim, "group": "case", "process": "laser",
                "params": {"material": "acrylic", "thickness_mm": 6}, "color": "#1d1e21", "explode": [0, 0, 1.3]})
    pw, ph, pt = PANEL
    panel = cq.Workplane("XY", origin=(0, 0, Z_PANEL)).rect(pw, ph).extrude(pt)
    panel = soft(panel, "|Z", 1.0)
    out.append({"name": "8in resistive touch panel", "id": "panel", "shape": panel, "group": "component",
                "color": "#b9c6cc", "material": "glass", "explode": [0, 0, 1.15]})
    pscrews = part("m3x16_selftap", at=[(p[0], p[1], Z_PANEL + T6) for p in holes])
    pscrews["id"] = "plate_screws"
    out.append(pscrews)
    tsc = box(-55 - 12.75, -55 + 12.75, -9.5, 9.5, Z_PLATE - 1 - 4.6, Z_PLATE - 1)
    out.append({"name": "TSC2007 touch controller", "id": "tsc", "shape": tsc, "group": "component",
                "color": "#1b3f8f", "material": "pcb"})

    # balls
    pp = cq.Workplane("XY").sphere(PP_R).translate((0, 0, Z_PANEL + pt + PP_R))
    out.append({"name": "Ping-pong ball", "id": "ball", "shape": pp, "group": "component", "color": "#fafafa"})
    st = cq.Workplane("XY").sphere(STEEL_R).translate((150, -80, STEEL_R))
    out.append({"name": "Steel ball 1-1/4in", "shape": st, "group": "component", "color": "#d6d9de", "material": "steel"})

    # electronics on the bottom disc (foam tape)
    z0 = Z_BOT + 1.5
    brk = box(-32.5, 32.5, -37.5, 37.5, z0, z0 + 1.6)
    for sx in (-1, 1):
        brk = brk.union(box(sx * 32.5 - (8 if sx > 0 else 0), sx * 32.5 + (0 if sx > 0 else 8), -36, 36, z0 + 1.6, z0 + 11))
        brk = brk.union(box(sx * 12.7 - 1.3, sx * 12.7 + 1.3, -24, 24, z0 + 1.6, z0 + 10.1))
    out.append({"name": "ESP32 screw-terminal breakout", "shape": brk, "group": "component", "color": "#1f6b3a",
                "material": "pcb"})
    out.append(part("esp32_devkitc", at=(0, 0, z0 + 10.1 + 2.5), rot=(0, 0, 90)))

    pca_a = 10.0
    pca = box(-12.7, 12.7, -31.25, 31.25, z0, z0 + 1.6)
    pca = pca.union(box(-6, 6, 18, 30, z0 + 1.6, z0 + 13)).union(box(8, 12.7, -5, 5, z0 + 1.6, z0 + 11))
    pca = pca.rotate((0, 0, 0), (0, 0, 1), pca_a).translate(legp(pca_a, 74, 0, 0))
    out.append({"name": "PCA9685 servo driver", "shape": pca, "group": "component", "color": "#1b3f8f",
                "material": "pcb"})
    out.append({"name": "1000uF capacitor", "shape": cyl_z(45, 25, 5, Z_BOT, Z_BOT + 16), "group": "component",
                "color": "#2b4fa0"})
    out.append({"name": "Wago 221-413 (5V)", "shape": box(-68, -48, 24, 37, Z_BOT, Z_BOT + 8),
                "group": "component", "color": "#d8d8d8"})
    out.append({"name": "Wago 221-413 (GND)", "shape": box(-68, -48, 41, 54, Z_BOT, Z_BOT + 8),
                "group": "component", "color": "#d8d8d8"})
    out.append({"name": "Inline fuse holder 5A", "shape": box(-42, -4, 42, 54, Z_BOT, Z_BOT + 10),
                "group": "component", "color": "#d13b2e"})
    # pre-wired panel jack (the library DC-022 has solder lugs; this build stays solderless)
    jk = cq.Workplane("YZ", origin=(R_BASE, 0, 0)).center(0, 36).circle(6.5).extrude(2.0)
    jk = jk.union(cq.Workplane("YZ", origin=(R_BASE - 16, 0, 0)).center(0, 36).circle(5.4).extrude(16))
    jk = jk.rotate((0, 0, 0), (0, 0, 1), jack_a)
    ju = U(jack_a)
    out.append({"name": "DC jack, panel mount, pre-wired", "shape": jk, "group": "component", "color": "#222222",
                "cable": {"type": "dc-barrel", "at": [float(ju[0] * (R_BASE + 2)), float(ju[1] * (R_BASE + 2)), 36.0],
                          "dir": [float(ju[0]), float(ju[1]), 0.0], "length_mm": 600}})
    out.append({"name": "Wago 221-412 (fuse)", "shape": box(-28, -12, 62, 75, Z_BOT, Z_BOT + 8),
                "group": "component", "color": "#d8d8d8"})
    return out


# ---------------------------------------------------------------- motion: ball rolls a circle, plate leads it
def _plate_matrix(c, R):
    m = np.eye(4)
    m[:3, :3] = R
    m[:3, 3] = c - R @ np.array([0, 0, Z_B])
    return m


def motion():
    from cadlib.motion import link

    plate_ids = ["plate", "rim", "panel", "plate_screws", "tsc"] + [f"{k}_{s}" for k in ("stud", "bracket", "studnut") for s in "ABC"]

    def pose(t):
        env = ease(t / 0.15) * ease((1 - t) / 0.15)
        w = 2 * math.pi * 2 * t
        tilt = 6.0 * env
        d = np.array([math.cos(w + math.pi / 2), math.sin(w + math.pi / 2), 0.0])
        Rt = np.eye(3) if tilt < 1e-6 else _axis(np.cross([0, 0, 1.0], d), math.radians(tilt))
        c, R = plate_pose(Rt)
        al = leg_angles(c, R)
        M = _plate_matrix(c, R)
        res = {k: {"matrix": M.tolist()} for k in plate_ids}
        bm = np.eye(4)
        bm[:2, 3] = [35 * env * math.cos(w), 35 * env * math.sin(w)]
        res["ball"] = {"matrix": (M @ bm).tolist()}
        for th, s, a in zip(LEGS, "ABC", al):
            S = np.array([0, 0, Z_S]) + R_B * U(th)
            Rh = _axis(-T(th), math.radians(a))
            H = np.eye(4)
            H[:3, :3] = Rh
            H[:3, 3] = S - Rh @ S
            for k in ("horn", "pivot", "nylock"):
                res[f"{k}_{s}"] = {"matrix": H.tolist()}
            a0 = np.array([0, 0, Z_S]) + R_P * U(th)
            b0 = np.array([0, 0, Z_B]) + R_P * U(th)
            a1 = (H @ np.append(a0, 1))[:3]
            b1 = (M @ np.append(b0, 1))[:3]
            lk = link(a0, b0, a1, b1)
            for k in ("link", "rodend", "setscrew"):
                res[f"{k}_{s}"] = lk
        return res

    return {"duration": 8, "frames": 120, "pose": pose}


def _axis(axis, ang):
    a = np.asarray(axis, float)
    x, y, z = a / np.linalg.norm(a)
    c, s, C = math.cos(ang), math.sin(ang), 1 - math.cos(ang)
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
                     [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
                     [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])


def _clash_check():
    ps = [p for p in parts() if isinstance(p, dict) and "shape" in p and not p["name"].startswith(("M3", "m3"))]
    sh = []
    for p in ps:
        s = p["shape"]
        s = s.val() if hasattr(s, "val") else s
        if not hasattr(s, "BoundingBox"):
            continue
        if p["group"] == "case":
            print(f"solids {p['name']}: {len(s.Solids())} valid={s.isValid()}")
        sh.append((p["name"], s, s.BoundingBox()))
    for i in range(len(sh)):
        for j in range(i + 1, len(sh)):
            a, b = sh[i][2], sh[j][2]
            if a.xmin > b.xmax or b.xmin > a.xmax or a.ymin > b.ymax or b.ymin > a.ymax or a.zmin > b.zmax or b.zmin > a.zmax:
                continue
            try:
                v = sh[i][1].intersect(sh[j][1]).Volume()
            except Exception:
                v = -1
            if abs(v) > 0.5:
                print(f"CLASH {sh[i][0]} x {sh[j][0]}: {v:.1f} mm3")


# _clash_check()   # dev aid: prints overlapping solids + solid counts (slow)

# quick self-check printed in the build log
_c, _R = plate_pose(tilt_matrix(0, 8))
print("IK check, 8 deg pitch: arm angles", [round(a, 1) for a in leg_angles(_c, _R)],
      "parasitic xy", np.round(_c[:2], 2))
_c, _R = plate_pose(tilt_matrix(8, 0))
print("IK check, 8 deg roll:  arm angles", [round(a, 1) for a in leg_angles(_c, _R)],
      "parasitic xy", np.round(_c[:2], 2))

import math
import cadquery as cq
from cadlib.parts import part

SCENE = "shelf"

# --- Tube: 2" OD x 0.065" wall 6061 (ID 1.870"), cut to 4" ---------------
OD = 50.8
ID = 47.5
L = 101.6
DZ = 2.5                     # rubber feet lift everything off the shelf

# Window milled in the tube front, flat faceplate sits flush with its edges
WIN_HW = 18.0                # half width
WIN_Z = (36.0, 92.0)
FACE_T = 1.6                 # 0.063" 5052, SendCutSend stock
FACE_Y = -math.sqrt((OD / 2) ** 2 - WIN_HW ** 2)   # front face, flush with window edge
FACE_BACK = FACE_Y + FACE_T
FLANGE = 6.0

# Shutter (1.2 mm mild steel, held by magnets at both ends of its travel)
SH_T = 1.2
SH_Y0 = FACE_BACK + 0.3      # shutter back gap to faceplate
POCKET_BACK = SH_Y0 + SH_T + 0.3
SH_X = (-14.0, 7.5)
SH_H = 13.0
SH_OPEN_Z = 54.5             # bottom edge when open (built pose)
SH_TRAVEL = 13.0
KNOB_X = -9.0

LENS = (0.0, 74.0)           # lens centre (x, z)
LENS_D = 8.0
LED_Z = 46.0
SCREWS = [(-11.5, 40.0), (11.5, 40.0), (-11.5, 88.0), (11.5, 88.0)]
MAGNETS = [(-10.5, SH_OPEN_Z + 6.5), (-10.5, SH_OPEN_Z + SH_TRAVEL + 6.5)]

# Board stack (ESP32-CAM 27 x 40.5 on ESP32-CAM-MB 27 x 40), vertical, camera to -Y
BRD_Z0 = 35.0
BRD_Z1 = BRD_Z0 + 40.5
CAM_Y = -3.5                 # ESP32-CAM PCB front face

SLED_Z = (10.0, 93.6)
SLED_R = ID / 2 - 0.3
SLED_BACK = 11.0
BCAP_SCREWS = [(-15.0, -11.0), (15.0, -11.0)]


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def ycyl(d, y0, y1, x, z):
    return (cq.Workplane("XZ").circle(d / 2).extrude(-(y1 - y0))
            .translate((x, y0, z)))


def zcyl(d, z0, z1, x=0.0, y=0.0):
    return cq.Workplane("XY").circle(d / 2).extrude(z1 - z0).translate((x, y, z0))


def make_tube():
    t = zcyl(OD, 0, L).cut(zcyl(ID, -1, L + 1))
    win = box(-WIN_HW, WIN_HW, -30, -10, *WIN_Z)
    try:
        win = win.edges("|Y").fillet(3.0)
    except Exception:
        pass
    t = t.cut(win)
    try:
        t = t.faces(">Z or <Z").edges().chamfer(0.4)
    except Exception:
        pass
    return t


def make_faceplate():
    w = 2 * WIN_HW - 0.6
    z0, z1 = WIN_Z[0] + 0.3, WIN_Z[1] - 0.3
    plate = box(-w / 2, w / 2, FACE_Y, FACE_BACK, z0, z1)
    try:
        plate = plate.edges("|Y").fillet(2.7)
    except Exception:
        pass
    for sx in (-1, 1):
        x_out = sx * w / 2
        fl = box(min(x_out, x_out - sx * FACE_T), max(x_out, x_out - sx * FACE_T),
                 FACE_Y + 0.5, FACE_BACK + FLANGE, z0 + 4, z1 - 4)
        plate = plate.union(fl)
    plate = plate.cut(ycyl(LENS_D, FACE_Y - 1, FACE_BACK + 1, *LENS))
    plate = plate.cut(ycyl(3.2, FACE_Y - 1, FACE_BACK + 1, 0, LED_Z))
    for x, z in SCREWS:
        plate = plate.cut(ycyl(2.9, FACE_Y - 1, FACE_BACK + 1, x, z))
    slot = (cq.Workplane("XZ").center(KNOB_X, 0).slot2D(16.0, 4.6, angle=90)
            .extrude(-(FACE_T + 2)).translate((0, FACE_Y - 1, SH_OPEN_Z + 6.0)))
    plate = plate.cut(slot.translate((0, 0, 0)))
    return plate


def make_shutter(zb):
    sh = box(SH_X[0], SH_X[1], SH_Y0, SH_Y0 + SH_T, zb, zb + SH_H)
    try:
        sh = sh.edges("|Y").fillet(2.0)
    except Exception:
        pass
    tab = box(KNOB_X - 2.0, KNOB_X + 2.0, FACE_Y - 3.6, SH_Y0 + SH_T, zb, zb + SH_T)
    return sh.union(tab)


def make_sled():
    s = zcyl(2 * SLED_R, *SLED_Z).intersect(box(-30, 30, -30, SLED_BACK, 0, 100))
    # faceplate recess and flange slots
    s = s.cut(box(-WIN_HW - 0.5, WIN_HW + 0.5, -30, FACE_BACK, WIN_Z[0], WIN_Z[1]))
    s = s.cut(box(-WIN_HW - 0.5, -WIN_HW + 2.2, -30, FACE_BACK + FLANGE + 0.3, WIN_Z[0], WIN_Z[1]))
    s = s.cut(box(WIN_HW - 2.2, WIN_HW + 0.5, -30, FACE_BACK + FLANGE + 0.3, WIN_Z[0], WIN_Z[1]))
    # shutter pocket (open to the front, closed by the faceplate)
    s = s.cut(box(SH_X[0] - 0.4, SH_X[1] + 0.4, FACE_BACK - 0.1, POCKET_BACK,
                  SH_OPEN_Z - 2.0, SH_OPEN_Z + SH_TRAVEL + SH_H + 0.5))
    # magnets 6x2 pressed into the pocket floor
    for x, z in MAGNETS:
        s = s.cut(ycyl(6.1, POCKET_BACK - 0.1, POCKET_BACK + 2.1, x, z))
    # board cavity, loaded from the top; floor at BRD_Z0
    s = s.cut(box(-14.0, 14.0, -7.5, 8.5, BRD_Z0, SLED_Z[1] + 1))
    # vent slots in the back wall so air from the bottom vents passes the boards
    for x in (-8.0, 0.0, 8.0):
        s = s.cut(box(x - 1.5, x + 1.5, 8.0, SLED_BACK + 1, BRD_Z0 + 5, BRD_Z1 - 5))
    # USB plug channel down through the bottom
    s = s.cut(box(-8.0, 8.0, -4.0, 8.5, SLED_Z[0] - 1, BRD_Z0 + 0.1))
    # camera pocket: lens window lip at the front, module pushed in from the cavity
    s = s.cut(box(LENS[0] - 6.25, LENS[0] + 6.25, POCKET_BACK + 1.2, -7.4, LENS[1] - 6, LENS[1] + 6))
    s = s.cut(box(LENS[0] - 4.0, LENS[0] + 4.0, POCKET_BACK - 0.1, POCKET_BACK + 1.3, LENS[1] - 4, LENS[1] + 4))
    # status LED: 3 mm body forward, flange stop, leads to cavity
    s = s.cut(ycyl(3.1, FACE_BACK - 0.1, -10.0, 0, LED_Z))
    s = s.cut(ycyl(4.2, -10.0, -7.4, 0, LED_Z))
    # pilots: faceplate M2.5 (2.0 mm, 7.5 deep), bottom cap M3 (2.5 mm, 10 deep)
    for x, z in SCREWS:
        s = s.cut(ycyl(2.0, FACE_BACK - 0.1, FACE_BACK + 7.5, x, z))
    for x, y in BCAP_SCREWS:
        s = s.cut(zcyl(2.5, SLED_Z[0] - 0.1, SLED_Z[0] + 10, x, y))
    return s


def make_bottom_cap():
    c = zcyl(ID - 0.3, 0, SLED_Z[0])
    try:
        c = c.faces("<Z").edges().fillet(1.0)
    except Exception:
        pass
    c = c.cut(box(-7.5, 7.5, -3.5, 8.0, -1, 11))           # USB plug + cable
    c = c.cut(box(-2.2, 2.2, 0, 30, -1, 4.5))              # cable groove out the back
    for x, y in BCAP_SCREWS:
        c = c.cut(zcyl(3.4, -1, 11, x, y)).cut(zcyl(6.5, -1, 3.0, x, y))
    for i in range(5):                                      # intake vents
        c = c.cut(zcyl(3.0, -1, 11, -8.0 + 4.0 * i, 17.0))
    return c


def make_top_cap():
    c = zcyl(ID - 0.3, SLED_Z[1], L)
    for a in (90, 210, 330):                                # crush ribs, 0.1 mm interference
        r = ID / 2 - 0.15
        c = c.union(box(-0.4, 0.4, r - 0.5, r + 0.25, SLED_Z[1], L - 1.0)
                    .rotate((0, 0, 0), (0, 0, 1), a - 90))
    try:
        c = c.faces(">Z").edges().fillet(1.0)
    except Exception:
        pass
    for i in range(5):                                      # exhaust vents
        c = c.cut(box(-12, 12, -9.0 + 6.0 * i - 1.0, -9.0 + 6.0 * i + 1.0, SLED_Z[1] - 1, L + 1))
    c = c.union(zcyl(6.0, BRD_Z1 + 0.2, SLED_Z[1] + 0.5))   # holds the boards down
    return c


def electronics():
    out = []
    cam = box(-13.5, 13.5, CAM_Y, CAM_Y + 1.0, BRD_Z0, BRD_Z1)
    cam = cam.union(box(-9.0, 9.0, CAM_Y - 3.0, CAM_Y, BRD_Z1 - 22, BRD_Z1 - 3))
    out.append({"name": "ESP32-CAM (AI-Thinker)", "shape": cam, "group": "component", "color": "#1d3a6b"})
    mb = box(-13.5, 13.5, 5.0, 6.6, BRD_Z0, BRD_Z0 + 40.0)
    for sx in (-1, 1):
        mb = mb.union(box(sx * 11.43 - 1.3, sx * 11.43 + 1.3, CAM_Y + 1.0, 5.0, BRD_Z0 + 2, BRD_Z0 + 22.5))
    mb = mb.union(box(-4.0, 4.0, 1.2, 5.0, BRD_Z0 - 0.5, BRD_Z0 + 5.0))  # micro-USB
    out.append({"name": "ESP32-CAM-MB programmer", "shape": mb, "group": "component", "color": "#1a1a1a"})
    ov = box(LENS[0] - 4.25, LENS[0] + 4.25, POCKET_BACK + 1.3, -7.8, LENS[1] - 4.25, LENS[1] + 4.25)
    ov = ov.union(ycyl(6.5, POCKET_BACK + 0.1, POCKET_BACK + 1.3, *LENS))
    out.append({"name": "OV2640 camera", "shape": ov, "group": "component", "color": "#222222"})
    led = ycyl(3.0, -15.3, -10.0, 0, LED_Z).union(ycyl(3.8, -10.0, -9.0, 0, LED_Z))
    out.append({"name": "Status LED (3 mm)", "shape": led, "group": "component", "color": "#44ff66",
                "fx": {"glow": {"color": "#44ff66", "mode": "pulse"}}})
    mags = None
    for x, z in MAGNETS:
        m = ycyl(6.0, POCKET_BACK, POCKET_BACK + 2.0, x, z)
        mags = m if mags is None else mags.union(m)
    out.append({"name": "6x2 mm magnet", "shape": mags, "group": "component", "color": "#b0b0b0", "material": "steel"})
    feet = None
    for a in (45, 135, 225, 315):
        f = zcyl(8.0, -DZ, 0, 17 * math.cos(math.radians(a)), 17 * math.sin(math.radians(a)))
        feet = f if feet is None else feet.union(f)
    out.append({"name": "Rubber bumper feet", "shape": feet, "group": "component", "color": "#111111", "material": "rubber"})
    return out


def _lift(p):
    p["shape"] = p["shape"].translate((0, 0, DZ))
    return p


def parts():
    made = [
        {"name": "Tube", "shape": make_tube(), "group": "case", "process": "bought",
         "color": "#1b1b1d", "material": "aluminium", "explode": [0, 0, 1]},
        {"name": "Sled", "shape": make_sled(), "group": "case", "color": "#2a2a2a", "explode": [0, 0, -1]},
        {"name": "Faceplate", "shape": make_faceplate(), "group": "case", "process": "sheet",
         "params": {"material": "aluminium 5052", "thickness_mm": FACE_T, "bends": 2, "finish": "black powder coat"},
         "color": "#141414", "explode": [0, -1, 0]},
        {"name": "Privacy shutter", "id": "shutter", "shape": make_shutter(SH_OPEN_Z), "group": "case", "process": "sheet",
         "params": {"material": "mild steel", "thickness_mm": SH_T, "bends": 1, "finish": "black powder coat"},
         "color": "#202022", "explode": [0, -1, 0]},
        {"name": "Top cap", "shape": make_top_cap(), "group": "case", "color": "#1e1e1e", "explode": [0, 0, 1]},
        {"name": "Bottom cap", "shape": make_bottom_cap(), "group": "case", "color": "#1e1e1e", "explode": [0, 0, -1]},
    ] + electronics()
    made = [_lift(p) for p in made]
    made.append(part("m25x8_selftap", at=[(x, FACE_Y, z + DZ) for x, z in SCREWS], rot=(90, 0, 0)))
    made.append(part("m3x16_selftap", at=[(x, y, 3.0 + DZ) for x, y in BCAP_SCREWS], rot=(180, 0, 0)))
    return made


def motion():
    return [{"part": "shutter", "type": "slide", "axis": [0, 0, 1],
             "keys": [[0, 0], [0.3, SH_TRAVEL], [0.7, SH_TRAVEL], [1.0, 0]]}]


ASSEMBLY = [["Sled"], ["Status LED (3 mm)", "6x2 mm magnet"], ["ESP32-CAM-MB programmer", "ESP32-CAM (AI-Thinker)", "OV2640 camera"],
            ["Tube"], ["Privacy shutter"], ["Faceplate"], ["Top cap"], ["Bottom cap"], ["Rubber bumper feet"]]

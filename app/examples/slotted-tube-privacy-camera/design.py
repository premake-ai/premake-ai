import math
import cadquery as cq
from cadlib.parts import part

SCENE = "shelf"

# Machined tube: 2.5" OD x 0.065" wall 6061-T6 (ID 2.37"), fits an 18650 behind the boards
OD, WALL = 63.5, 1.65
RO = OD / 2
RI = RO - WALL
ZS = 6.0                                 # everything above the printed foot moves up 6 mm
T0, T1 = 12.0, 110.0 + ZS                # tube bottom / top (104 mm long)
SLOT_W, SLOT_Z0, SLOT_Z1 = 14.0, 30.0, 100.0        # 70 mm: > half a 2.4 GHz wave for Wi-Fi
DY = -(RI - 23.75)                       # board stack sits close to the front wall

# Board stack (ESP32-CAM 27 x 40.5, MB 27 x 40), standing, camera to -Y
BW, BZ0 = 27.0, 45.0 + ZS
CAM_PCB_Y = -8.5 + DY                    # front face of ESP32-CAM PCB
MB_PCB_Y = 1.5 + DY                      # front face of MB PCB
LENS_Z = 72.0 + ZS                       # estimated lens centre

# Smoked strip (flat chord behind the slot)
STRIP_W, STRIP_T = 20.0, 3.0
STRIP_Y = -math.sqrt(RI ** 2 - (STRIP_W / 2) ** 2)     # front face
BASE_TOP = 14.0 + ZS
CAP_Z0 = 96.0 + ZS                       # cap spigot bottom
STRIP_Z0, STRIP_Z1 = BASE_TOP, CAP_Z0 + 3

# Twist cap + shutter arc (cap is modelled closed, then turned OPEN_DEG for the built pose)
SL_RI, SL_RO, SL_Z0 = RI - 7.15, RI - 5.75, 60.0 + ZS
WIN_Z0, WIN_Z1 = 62.0 + ZS, 90.0 + ZS
OPEN_DEG = 45.0
WIN_A = -90.0 - OPEN_DEG                 # window angle in the closed frame
ORING_ROOT = 57.0 / 2                    # AS568-035 (56.87 ID x 1.78 CS), ~10 % squeeze
SPIG_R = RI - 0.15
LED_Z = 36.0 + ZS
SCREW_Z = 16.0                           # 2 x M3 through the tube back into the spigot

# Battery: 18650 holder standing behind the boards, open side to the front
HOLD_Y, HOLD_Z = 27.3, BASE_TOP + 38.5
# Solar panel: 53 x 30 x 2 mm 5 V 30 mA epoxy panel, in a 1.5 mm pocket in the cap top
PV_L, PV_W, PV_T = 53.0, 30.0, 2.0
PV_Z0 = T1 + 4 - 1.5
TP_Z = 4.0                              # TP4056 board bottom, USB-C out the back of the foot
USB_Z = TP_Z + 3.2


def ring(ro, ri, z0, z1):
    return cq.Workplane("XY").circle(ro).circle(ri).extrude(z1 - z0).translate((0, 0, z0))


def disk(r, z0, z1):
    return cq.Workplane("XY").circle(r).extrude(z1 - z0).translate((0, 0, z0))


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def wedge(a0, a1, r, z0, z1):
    pts = [(0, 0)] + [(r * math.cos(math.radians(a0 + (a1 - a0) * i / 16)),
                       r * math.sin(math.radians(a0 + (a1 - a0) * i / 16))) for i in range(17)]
    return cq.Workplane("XY").polyline(pts).close().extrude(z1 - z0).translate((0, 0, z0))


def fillet(wp, sel, r):
    try:
        return wp.edges(sel).fillet(r)
    except Exception:
        return wp


def tube():
    # shop ops: cut + face, one milled slot, two drilled holes, deburr, anodize
    t = ring(RO, RI, T0, T1)
    slot = (cq.Workplane("XZ").slot2D(SLOT_Z1 - SLOT_Z0, SLOT_W, angle=90)
            .extrude(-20).translate((0, -RO - 5, (SLOT_Z0 + SLOT_Z1) / 2)))
    t = t.cut(slot)
    for x in (-12, 12):   # 2 x 3.4 mm screw holes at the back
        t = t.cut(cq.Workplane("XZ").center(x, SCREW_Z).circle(1.7).extrude(-10)
                  .translate((0, RI - 3, 0)))
    return t


def strip():
    s = box(-STRIP_W / 2, STRIP_W / 2, STRIP_Y, STRIP_Y + STRIP_T, STRIP_Z0, STRIP_Z1)
    return fillet(s, "|Y", 1.0)


def chassis():
    base = disk(RO, 0, T0).union(disk(SPIG_R, T0 - 1, BASE_TOP))
    base = fillet(base, "<Z", 1.2)
    y_in0, y_in1 = CAM_PCB_Y - 0.25, MB_PCB_Y + 1.6 + 0.25
    upper = None
    for s in (-1, 1):
        # C-channel rail gripping both PCB edges, side wall back to the battery clip
        r = box(12.8, 15.8, y_in0 - 1.5, 1.95, BASE_TOP - 1, 58 + ZS)
        r = r.cut(box(12.8, 14.0, y_in0, y_in1, BZ0, 59 + ZS))
        r = r.cut(box(12.0, 13.0, y_in0 + 1.5, y_in1 - 1.7, BZ0, 59 + ZS))
        r = r.union(box(10.7, 14.8, 0.95, HOLD_Y, BASE_TOP - 1, 58 + ZS))
        r = r.union(box(10.7, 12.7, 11.0, HOLD_Y, 57 + ZS, HOLD_Z + 38.5))  # holder clip
        r = r.union(box(9.7, 10.7, 11.0, 12.0, 25 + ZS, HOLD_Z + 30))      # front lip
        r = r.mirror("YZ") if s < 0 else r
        upper = r if upper is None else upper.union(r)
    upper = upper.union(box(-12.7, 12.7, HOLD_Y, RI, BASE_TOP - 1, HOLD_Z + 38.5))  # spine
    upper = upper.cut(box(-8, 8, HOLD_Y - 1, RI + 1, BASE_TOP + 12, HOLD_Z + 28))  # lighten
    upper = upper.intersect(disk(RI - 0.3, 0, 200))
    base = base.union(upper)
    # LED block below the boards, holds the strip's back face
    base = base.union(box(-8, 8, STRIP_Y + STRIP_T + 0.05, -11.0 + DY, BASE_TOP - 1, 42 + ZS))
    base = base.cut(cq.Workplane("XZ").center(0, LED_Z).circle(2.55).extrude(14)
                    .translate((0, -17, 0)))
    # pockets: TP4056 (port out the back of the foot), MT3608 (front)
    base = base.cut(box(-8.8, 8.8, RI - 28.5, RI + 0.5, TP_Z, BASE_TOP + 0.1))
    base = base.cut(box(-7, 7, RI - 6, RO + 1, USB_Z - 4.5, USB_Z + 4.5))   # 14 x 9 plug
    base = base.cut(box(-18.3, 18.3, -24.3, -6.7, TP_Z, BASE_TOP + 0.1))
    for s in (-1, 1):     # hollow the foot's sides from below (hidden, prints open-side down)
        base = base.cut(box(19 * s - 4.5, 19 * s + 4.5, -5, 12, -1, T0 - 2))
    for x in (-12, 12):   # 2 x M3 pilots from the back
        base = base.cut(cq.Workplane("XZ").center(x, SCREW_Z).circle(1.25).extrude(-11)
                        .translate((0, RI - 11, 0)))
    return base


def top_cap():
    cap = disk(RO, T1, T1 + 4).union(ring(SPIG_R, SPIG_R - 3, CAP_Z0, T1 + 0.5))
    cap = cap.union(disk(SPIG_R - 1, T1 - 3, T1 + 0.5))                # inner plate
    cap = fillet(cap, ">Z", 2.0)
    cap = cap.cut(ring(SPIG_R + 1, ORING_ROOT, CAP_Z0 + 5, CAP_Z0 + 7.4))   # O-ring groove
    cap = cap.cut(ring(RI + 1, SL_RO, CAP_Z0 - 1, CAP_Z0 + 4).intersect(
        wedge(-155, -70, RO + 2, CAP_Z0 - 1, CAP_Z0 + 4)))              # stop notch for strip
    arc = ring(SL_RO, SL_RI, SL_Z0, T1 - 2.5).intersect(wedge(-165, -30, RO, SL_Z0, T1))
    half = math.degrees(math.asin(7.0 / SL_RI))
    arc = arc.cut(wedge(WIN_A - half, WIN_A + half, RO, WIN_Z0, WIN_Z1))
    cap = cap.union(arc)
    cap = cap.union(ring(9, 7.5, BZ0 + 41.5, T1 - 2.5))               # board hold-down
    a = math.radians(WIN_A)
    cap = cap.cut(cq.Workplane("XY").center((RO - 3) * math.cos(a), (RO - 3) * math.sin(a))
                  .circle(1.0).extrude(1).translate((0, 0, T1 + 3.4)))   # dot = open side
    cap = cap.rotate((0, 0, 0), (0, 0, 1), OPEN_DEG)
    cap = cap.cut(box(-PV_L / 2 - 0.3, PV_L / 2 + 0.3, -PV_W / 2 - 0.3, PV_W / 2 + 0.3,
                      PV_Z0, T1 + 5))                                    # solar panel pocket
    cap = cap.cut(disk(2.0, T1 - 4, T1 + 5))                           # panel wires down
    return cap


def solar():
    p = box(-PV_L / 2, PV_L / 2, -PV_W / 2, PV_W / 2, PV_Z0, PV_Z0 + PV_T)
    return fillet(p, "|Z", 1.0)


def esp32_cam():
    pcb = box(-BW / 2, BW / 2, CAM_PCB_Y, CAM_PCB_Y + 1.6, BZ0, BZ0 + 40.5)
    shield = box(-9, 9, CAM_PCB_Y - 3.2, CAM_PCB_Y, BZ0 + 14, BZ0 + 39)
    cam = box(-4.25, 4.25, CAM_PCB_Y - 5.2, CAM_PCB_Y - 3.2, LENS_Z - 4.25, LENS_Z + 4.25)
    lens = (cq.Workplane("XZ").center(0, LENS_Z).circle(4).extrude(2.1)
            .translate((0, CAM_PCB_Y - 5.2, 0)))
    sd = box(-7, 7, CAM_PCB_Y - 2.0, CAM_PCB_Y, BZ0, BZ0 + 13)
    pins = box(-12.7, -10.16, CAM_PCB_Y + 1.6, MB_PCB_Y, BZ0 + 1, BZ0 + 39).union(
        box(10.16, 12.7, CAM_PCB_Y + 1.6, MB_PCB_Y, BZ0 + 1, BZ0 + 39))
    return pcb.union(shield).union(cam).union(lens).union(sd).union(pins)


def esp32_mb():
    pcb = box(-BW / 2, BW / 2, MB_PCB_Y, MB_PCB_Y + 1.6, BZ0, BZ0 + 40)
    usb = box(-3.9, 3.9, MB_PCB_Y + 1.6, MB_PCB_Y + 4.6, BZ0 - 0.5, BZ0 + 5)
    chip = box(-5, 5, MB_PCB_Y + 1.6, MB_PCB_Y + 3.2, BZ0 + 15, BZ0 + 25)
    return pcb.union(usb).union(chip)


def tp4056():
    pcb = box(-8.5, 8.5, RI - 28.2, RI - 0.2, TP_Z, TP_Z + 1.6)
    usb = box(-4.5, 4.5, RI - 7.5, RI - 0.2, TP_Z + 1.6, TP_Z + 4.8)
    return pcb.union(usb)


def mt3608():
    pcb = box(-18, 18, -24, -7, TP_Z, TP_Z + 1.6)
    return pcb.union(box(-5, 5, -20, -11, TP_Z + 1.6, TP_Z + 6))


def parts():
    hold_rot = (0, 90, -90)
    return [
        {"name": "Slotted tube", "shape": tube(), "group": "component", "process": "bought",
         "material": "aluminium", "color": "#1d1d20"},
        {"name": "Smoked window", "shape": strip(), "process": "laser",
         "params": {"material": "acrylic", "thickness_mm": 3}, "material": "acrylic_clear",
         "color": "#2b2b30", "explode": [0, -1, 0]},
        {"name": "Base chassis", "shape": chassis(), "color": "#26262a", "explode": [0, 0, -1]},
        {"name": "Twist cap", "id": "cap", "shape": top_cap(), "color": "#3a3a3f",
         "explode": [0, 0, 1]},
        {"name": "Solar panel 5V 53x30", "id": "pv", "shape": solar(), "group": "component",
         "color": "#1a2a4a", "explode": [0, 0, 1]},
        {"name": "ESP32-CAM (AI-Thinker)", "shape": esp32_cam(), "group": "component",
         "color": "#1b4f8a"},
        {"name": "ESP32-CAM-MB", "shape": esp32_mb(), "group": "component", "color": "#202020"},
        {"name": "TP4056 USB-C charger", "shape": tp4056(), "group": "component",
         "color": "#1f4fa0", "cable": {"type": "usb-c", "at": [0, RO, USB_Z],
                                       "dir": [0, 1, 0], "length_mm": 400}},
        {"name": "MT3608 boost 5V", "shape": mt3608(), "group": "component", "color": "#1f4fa0"},
        part("holder_18650", at=(0, HOLD_Y, HOLD_Z), rot=hold_rot),
        part("cell_18650", at=(0, HOLD_Y - 1.2, HOLD_Z), rot=hold_rot),
        part("led_5mm", name="5 mm LED (green)", color="#3bd06a", at=(0, -11.0 + DY, LED_Z),
             rot=(90, 0, 0)),
        part("m3x10_selftap", at=[(-12, RO, SCREW_Z), (12, RO, SCREW_Z)], rot=(-90, 0, 0)),
    ]


def motion():
    keys = [[0, 0], [0.3, -OPEN_DEG], [0.7, -OPEN_DEG], [1, 0]]
    return [{"part": pid, "type": "rotate", "axis": [0, 0, 1], "pivot": [0, 0, 0], "keys": keys}
            for pid in ("cap", "pv")]


ASSEMBLY = [["Base chassis"], ["TP4056 USB-C charger", "MT3608 boost 5V"], ["5 mm LED (green)"],
            ["ESP32-CAM-MB", "ESP32-CAM (AI-Thinker)"], ["18650 holder, 1 cell"],
            ["18650 Li-ion cell"], ["Smoked window"], ["Slotted tube"], ["Twist cap"], ["Solar panel 5V 53x30"]]

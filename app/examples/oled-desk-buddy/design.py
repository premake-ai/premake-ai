"""Desk buddy (ELEGOO ESP-32 Super Starter Kit parts): OLED face in a white head that pans on an SG90,
orange base holding the ESP32 DevKit. Z up, front = -Y, mm.

Print: Base upside down (deck on the bed), Head face down, Bottom plate + Back cover flat. PLA, 0.4 mm, no supports
(the OLED window bridges 23.5 mm)."""
import cadquery as cq
from cadlib.parts import part

SCENE = "desk"

# ---- base: hollow shell, open bottom closed by a screwed plate
BW, BD, BH, BR, T = 66.0, 64.0, 36.0, 10.0, 2.4
# ---- servo hangs from its tabs on the base deck; shaft = head pan axis
SX0, SY = -5.5, -6.0            # servo origin (body centre); its output shaft is at x = SX0 + 5.5 = 0
SZ = BH - 15.9                  # tabs rest on the deck top (tabs sit 15.9 above the servo's bottom)
SHAFT = (SX0 + 5.5, SY)
HORN_TOP = SZ + 29.9
# ---- head: shell open at the back, OLED behind a front window, floor bolted to the servo horn
HW, HD, HH, HR, HT = 52.0, 46.0, 44.0, 9.0, 2.2
HX, HY = SHAFT
HZ0 = HORN_TOP - 1.6            # head floor bottom sits on the horn
FLOOR = 3.0
# ---- ESP32 DevKit stands on edge, chips facing forward, header pins + jumpers toward the back wall (19 mm for Dupont
#      housings), USB-C out the left wall through a slot that fits a cable's overmould
EY = BD / 2 - T - 19.0
EZ = T + 15.0
EX = -(BW / 2 - T) + 28.2 + 0.6
# ---- OLED behind the head's front window, screen facing -Y
FY_IN = HY - HD / 2 + HT        # inside face of the head's front wall
OY = FY_IN + 2.77
OZ = HZ0 + HH / 2 + 1.0


def rbox(w, d, h, r, at=(0, 0, 0)):
    return cq.Workplane("XY").box(w, d, h, centered=(True, True, False)).edges("|Z").fillet(r).translate(at)


def cyl(r, h, at, axis="Z"):
    wp = {"Z": "XY", "Y": "XZ", "X": "YZ"}[axis]
    c = cq.Workplane(wp).circle(r).extrude(h)
    return c.translate(at)


def base():
    b = rbox(BW, BD, BH, BR).cut(rbox(BW - 2 * T, BD - 2 * T, BH - T, BR - T))
    # corner bosses for the bottom-plate screws (M3 self-tapping, 2.5 mm pilot)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (BW / 2 - T - 4.5), sy * (BD / 2 - T - 4.5)
            b = b.union(cyl(3.5, BH - T - 2.4, (x, y, 2.4))).cut(cyl(1.25, 14, (x, y, 2.4)))
    # servo body pocket + tab screw pilots
    b = b.cut(cq.Workplane("XY").box(23.4, 12.8, 10).translate((SX0, SY, BH)))
    for dx in (-13.9, 13.9):
        b = b.cut(cyl(1.0, 6, (SX0 + dx, SY, BH - 5)))
    # wire pass-through to the head (OLED leads)
    b = b.cut(cq.Workplane("XY").box(10, 7, 10).translate((12, 6, BH)))
    # USB-C slot in the left wall for the ESP32
    b = b.cut(cq.Workplane("XY").box(8, 9, 14).translate((-BW / 2 + T / 2, EY - 2.4, EZ)))  # 9 x 14: on-edge USB-C plug body
    return b


def bottom_plate():
    p = rbox(BW - 2 * T - 0.4, BD - 2 * T - 0.4, 2.4, BR - T - 0.2)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (BW / 2 - T - 4.5), sy * (BD / 2 - T - 4.5)
            p = p.cut(cyl(1.7, 3, (x, y, -0.2)))
    # ESP32 cradle: two slotted blocks at the board's ends hold its bottom edge (PCB 1.6 thick, slot 1.8)
    for x in (EX - 26.95, EX + 25.8):
        blk = cq.Workplane("XY").box(2.5, 6, 5, centered=(True, True, False)).translate((x, EY - 1.0, 2.4))
        p = p.union(blk.cut(cq.Workplane("XY").box(3, 1.8, 5, centered=(True, True, False)).translate((x, EY - 0.8, 3.2))))
    return p


def head():
    h = rbox(HW, HD, HH, HR, (HX, HY, HZ0))
    h = h.cut(rbox(HW - 2 * HT, HD - 2 * HT, HH - HT - FLOOR, HR - HT, (HX, HY, HZ0 + FLOOR)))
    # open back (closed by the back cover)
    h = h.cut(cq.Workplane("XY").box(HW - 2 * HT, 6, HH - HT - FLOOR).translate(
        (HX, HY + HD / 2, HZ0 + FLOOR + (HH - HT - FLOOR) / 2)))
    # OLED window + 4 short M2 standoffs (holes 23.3 x 23.8)
    h = h.cut(cq.Workplane("XZ").rect(23.5, 12.5).extrude(-10).translate((HX, FY_IN - HT - 1, OZ)))
    for dx in (-11.65, 11.65):
        for dz in (-11.9, 11.9):
            boss = cyl(2.2, 1.17, (HX + dx, FY_IN + 1.17, OZ + dz), "Y")
            h = h.union(boss).cut(cyl(0.8, 2.4, (HX + dx, FY_IN + 1.17, OZ + dz), "Y"))  # blind: stops 1 mm short of the face
    # floor: horn recess (hub + arm, 1.8 deep from below), horn screw hole, wire hole
    hub = cyl(3.9, 1.8, (HX, HY, HZ0 - 0.01))
    arm = cq.Workplane("XY").box(40, 6.4, 1.8, centered=(True, True, False)).translate((HX, HY, HZ0 - 0.01))
    h = h.cut(hub).cut(arm).cut(cyl(1.1, FLOOR + 1, (HX, HY, HZ0 - 0.5)))
    h = h.cut(cq.Workplane("XY").box(9, 6, 10).translate((HX, HY + 12, HZ0)))
    # back-cover screw bosses (M3 self-tapping) at the top inside corners
    for sx in (-1, 1):
        x, z = HX + sx * (HW / 2 - HT - 3.6), HZ0 + HH - HT - 3.6
        y0 = HY + HD / 2 - HT
        h = h.union(cyl(3.2, 8, (x, y0, z), "Y")).cut(cyl(1.25, 9, (x, y0 + 0.5, z), "Y"))  # XZ cylinders run toward -Y
    return h


def back_cover():
    c = cq.Workplane("XZ").rect(HW - 2 * HT - 0.3, HH - HT - FLOOR - 0.3).extrude(-HT).translate(
        (HX, HY + HD / 2 - HT, HZ0 + FLOOR + (HH - HT - FLOOR) / 2))
    for sx in (-1, 1):
        x, z = HX + sx * (HW / 2 - HT - 3.6), HZ0 + HH - HT - 3.6
        c = c.cut(cyl(1.7, 4, (x, HY + HD / 2 + 1, z), "Y"))
    return c


# Written assembly steps (the Assemble view and the build guide use these as they are). Screws are bought only (bom.json):
# 4 x M2x6 hold the OLED, 2 x M3x10 the back cover, 4 x M3x10 the bottom plate; the servo's own bag has its 2 tab screws
# and the horn screw.
BUILD_STEPS = [
    {"title": "Fit the servo in the base", "parts": ["Base", "SG90 micro servo"],
     "text": "Turn the servo shaft gently by hand to the middle of its travel, so the head ends up facing forward. Push the "
             "servo down into the slot in the top of the Base, cable first, until its two tabs sit on the deck. Fix it with "
             "the two small screws from the servo's bag."},
    {"title": "Fit the screen in the head", "parts": ["Head", '0.96" OLED display (SSD1306)'],
     "text": "From the open back of the Head, press the OLED onto the four little posts with the screen looking out through "
             "the front window. Fix it with 4 x M2x6 screws. Push four female-to-female jumpers onto its pins: VCC red, "
             "GND black, SDA blue, SCL yellow.",
     "warning": "Stop as soon as the M2 screws are snug: the posts are short and strip easily."},
    {"title": "Mount the head on the servo", "show": ["Head", "SG90 micro servo", "Base"],
     "text": "Feed the four screen leads down through the hole in the Head's floor and on through the slot in the top of the "
             "Base. Press the servo's long two-arm horn into the recess under the Head, then push the Head onto the servo "
             "shaft facing straight forward. Screw the horn screw from the servo's bag down through the Head floor into "
             "the shaft."},
    {"title": "Close the head", "parts": ["Back cover"],
     "text": "Check no lead is pinched, then fit the Back cover with 2 x M3x10 screws into the two posts at the top corners."},
    {"title": "Stand the ESP32 in the bottom plate", "parts": ["Bottom plate", "ESP32 DevKitC (WROOM-32, 38 pin)"],
     "text": "Slide the ESP32's bottom edge into the two slotted blocks on the Bottom plate: chips facing the front, pin "
             "headers facing the back, USB-C port at the left end."},
    {"title": "Connect the screen and servo to the ESP32", "kind": "wire",
     "show": ['0.96" OLED display (SSD1306)', "SG90 micro servo", "ESP32 DevKitC (WROOM-32, 38 pin)"],
     "text": "Turn the Base upside down beside the plate. Screen leads onto the ESP32: VCC to 3V3 (red), GND to GND (black), "
             "SDA to GPIO21 (blue), SCL to GPIO22 (yellow). Servo, with three male-to-female jumpers from its plug: red to "
             "5V, brown to GND, orange to GPIO13."},
    {"title": "Close the base", "show": ["Base", "Bottom plate"],
     "text": "Tuck the leads in and lower the Base onto the plate so the ESP32's USB-C port lines up with the slot in the "
             "left wall. Fix the plate with 4 x M3x10 screws into the corner posts, then stick a rubber foot near each "
             "corner underneath."},
    {"title": "Power on and test", "kind": "test",
     "text": "Plug the USB-C cable into the port on the left side. The face appears on the screen and the head turns left "
             "and right smoothly without hitting anything. If the screen stays blank, check the four screen leads first; "
             "if the head jitters, check the servo's three leads."},
]


def parts():
    return [
        {"name": "Base", "shape": base(), "group": "case", "color": "#f07a2a"},
        {"name": "Bottom plate", "shape": bottom_plate(), "group": "case", "color": "#f07a2a"},
        {"name": "Head", "shape": head(), "group": "case", "color": "#f2efe8"},
        {"name": "Back cover", "shape": back_cover(), "group": "case", "color": "#f2efe8"},
        part("sg90", at=(SX0, SY, SZ)),
        part("esp32_devkitc", at=(EX, EY, EZ), rot=(90, 0, 0)),
        part("oled_096", at=(HX, OY, OZ), rot=(90, 0, 0)),
    ]

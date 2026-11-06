import cadquery as cq
from cadlib.parts import part

SCENE = "shelf"

# ---- shell: two folded U-channels, 0.063" (1.6 mm) 5052, SendCutSend, powder coated
W, D = 58.0, 42.0          # shell outside, plan
T = 1.6                    # 0.063" sheet
RI = 1.6                   # inside bend radius ~1 x t (SendCutSend 5052 guideline)
RO = RI + T
SEAM = 0.2                 # half-gap of the side seam reveal
Z_SH0, Z_SH1 = 7.0, 71.5   # shell bottom / top edge (2 mm into each cap groove)

# ---- caps (printed PETG), 2 mm proud of the metal
PROUD = 2.0
GROOVE = 2.0               # groove depth
Z_BC = 9.0                 # bottom cap top face
Z_TC0, Z_TC1 = 69.5, 86.0  # top cap (plastic crown around the Wi-Fi antenna)
ROOF = 2.5

# ---- electronics stack (ESP32-CAM 27 x 40.5, antenna up; MB behind, micro-USB down)
CAM_W, CAM_H = 27.0, 40.5
Z_B = 36.0                 # board bottom edge
Z_TOP = Z_B + CAM_H        # antenna end
LENS_Z = Z_TOP - 15.0      # lens centre ~15 mm below antenna end (measured from photos, +-2)
Y_LENS = -17.4             # lens tip
Y_PCB = -10.4              # ESP32-CAM PCB front face
Y_MB = Y_PCB + 1.6 + 8.5   # MB PCB front face (female headers 8.5)
WIN_D = 11.0               # lens window
LED_Z = 20.0

# ---- privacy shutter (slides along X behind the front face)
BL_Y0, BL_Y1 = -19.2, -17.75
BL_X0, BL_X1 = -8.0, 19.0
BL_Z0, BL_Z1 = 50.0, 83.2
TRAVEL = 13.0
STEM_X = 5.0


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def rrect(w, d, r, z0, z1):
    return (cq.Workplane("XY").sketch().rect(w, d).vertices().fillet(r).finalize()
            .extrude(z1 - z0).translate((0, 0, z0)))


def cyl_y(d, x, z, y0, y1):
    return cq.Workplane("XZ").circle(d / 2).extrude(-(y1 - y0)).translate((x, y0, z))


def shell(front):
    ring = rrect(W, D, RO, Z_SH0, Z_SH1).cut(rrect(W - 2 * T, D - 2 * T, RI, Z_SH0 - 1, Z_SH1 + 1))
    if front:
        s = ring.intersect(box(-W, W, -D, -SEAM, 0, 100))
        s = s.cut(cyl_y(WIN_D, 0, LENS_Z, -D, 0)).cut(cyl_y(3.0, 0, LED_Z, -D, 0))
    else:
        s = ring.intersect(box(-W, W, SEAM, D, 0, 100))
        for z in (48, 54, 60):  # vent / RF slots (also the powder-coat hanging holes)
            s = s.cut(cq.Workplane("XZ").center(0, z).slot2D(24, 2.6).extrude(-D))
    return s


def groove(z0, z1):
    return rrect(W + 0.4, D + 0.4, RO + 0.2, z0, z1).cut(
        rrect(W - 2 * T - 0.4, D - 2 * T - 0.4, max(RI - 0.2, 0.5), z0 - 1, z1 + 1))


RAIL_PILOTS = [(-13.0, -14.5), (13.0, -14.5)]
POST_PILOTS = [(-12.0, 8.6), (12.0, 8.6)]
PILOTS = RAIL_PILOTS + POST_PILOTS


def top_cap():
    c = rrect(W + 2 * PROUD, D + 2 * PROUD, RO + PROUD, Z_TC0, Z_TC1)
    try:
        c = c.faces(">Z").edges().fillet(3.0)
    except Exception:
        pass
    inner_w, inner_d = W - 2 * T - 4.4, D - 2 * T - 4.4
    c = c.cut(rrect(inner_w, inner_d, 1.0, Z_TC0 - 1, Z_TC1 - ROOF))
    c = c.cut(groove(Z_TC0 - 1, Z_TC0 + GROOVE))
    # notch in the front lip for the shutter blade's travel
    c = c.cut(box(BL_X0 - TRAVEL - 0.5, BL_X1 + 0.5, BL_Y0 - 0.05, BL_Y1 + 1.2, Z_TC0 - 1, Z_TC1 - ROOF))
    # knob stem slot through the roof
    c = c.cut(box(STEM_X - TRAVEL - 1.7, STEM_X + 1.7, -19.5, -16.3, Z_TC0, Z_TC1 + 1))
    # internal frame, printed in one piece with the cap (cap face-down on the bed)
    top = Z_TC1 - ROOF + 1.0
    for s in (-1, 1):
        # front rails: board front face rests on them, side lips locate it
        c = c.union(box(*sorted((s * 11.0, s * 15.5)), -17.5, Y_PCB, Z_BC, top))
        c = c.union(box(*sorted((s * 13.8, s * 15.5)), Y_PCB - 0.5, Y_PCB + 3.0, Z_B - 2, top))
        # heavier screw block below the board
        c = c.union(box(*sorted((s * 9.5, s * 16.5)), -18.8, Y_PCB, Z_BC, Z_B - 2))
        # back posts: press the MB forward
        c = c.union(box(*sorted((s * 8.0, s * 16.0)), Y_MB + 1.6 + 3.3, 12.6, Z_BC, top))
        # antenna-end stop above the board
        c = c.union(box(*sorted((s * 9.0, s * 15.5)), -17.5, Y_PCB + 1.6, Z_TOP + 0.3, top))
    for x, y in PILOTS:
        c = c.cut(cq.Workplane("XY").circle(1.25).extrude(12.0).translate((x, y, Z_BC)))
    return c


def bottom_cap():
    c = rrect(W + 2 * PROUD, D + 2 * PROUD, RO + PROUD, 0, Z_BC)
    try:
        c = c.faces("<Z").edges().fillet(1.5)
    except Exception:
        pass
    c = c.cut(groove(Z_BC - GROOVE, Z_BC + 1))
    # board support pillars under the ESP32-CAM bottom edge
    for s in (-1, 1):
        c = c.union(box(*sorted((s * 10.0, s * 13.0)), Y_PCB + 0.1, Y_MB + 1.6, Z_BC - 1, Z_B))
    # status LED holder
    c = c.union(box(-4.5, 4.5, -19.2, -11.0, Z_BC - 1, LED_Z + 5.5))
    c = c.cut(cyl_y(5.2, 0, LED_Z, -20, -10))
    # micro-USB plug passage + cable channel to the back
    c = c.cut(box(-6.5, 6.5, -1.5, 6.5, -1, Z_BC + 1))
    c = c.cut(box(-2.6, 2.6, 0, D, -1, 4.5))
    # screws from below: clearance + counterbore
    for x, y in PILOTS:
        c = c.cut(cq.Workplane("XY").circle(1.7).extrude(Z_BC + 1).translate((x, y, -0.5)))
        c = c.cut(cq.Workplane("XY").circle(3.4).extrude(3.0).translate((x, y, -0.01)))
    return c


def blade():
    b = box(BL_X0, BL_X1, BL_Y0, BL_Y1, BL_Z0, BL_Z1)
    try:
        b = b.edges("|Y").fillet(2.0)
    except Exception:
        pass
    b = b.cut(cyl_y(WIN_D + 0.5, 0, LENS_Z, -25, 0))
    b = b.union(box(STEM_X - 1.5, STEM_X + 1.5, BL_Y0, -16.7, BL_Z1 - 3, Z_TC1 + 3.0))
    return b


def knob():
    k = box(STEM_X - 7, STEM_X + 7, -22.5, -13.0, Z_TC1, Z_TC1 + 5.0)
    try:
        k = k.edges("|Z").fillet(3.0).faces(">Z").edges().fillet(1.5)
    except Exception:
        pass
    return k.cut(box(STEM_X - 1.6, STEM_X + 1.6, BL_Y0 - 0.1, -16.6, Z_TC1 - 1, Z_TC1 + 3.0))


def esp32_cam():
    pcb = box(-CAM_W / 2, CAM_W / 2, Y_PCB, Y_PCB + 1.6, Z_B, Z_TOP)
    module = box(-9, 9, Y_PCB - 3.2, Y_PCB, Z_TOP - 25.5, Z_TOP)
    cam = box(-4.25, 4.25, -15.0, Y_PCB - 3.2, LENS_Z - 4.25, LENS_Z + 4.25)
    lens = cyl_y(8.0, 0, LENS_Z, Y_LENS, -15.0)
    sd = box(-7, 7, Y_PCB - 2.0, Y_PCB, Z_B, Z_B + 14)
    pins = box(-12.7, -10.2, Y_PCB + 1.6, Y_MB, Z_B + 2, Z_B + 22.5).union(
        box(10.2, 12.7, Y_PCB + 1.6, Y_MB, Z_B + 2, Z_B + 22.5))
    return pcb.union(module).union(cam).union(lens).union(sd).union(pins)


def esp32_cam_mb():
    pcb = box(-CAM_W / 2, CAM_W / 2, Y_MB, Y_MB + 1.6, Z_B, Z_B + 40.0)
    chips = box(-7, 7, Y_MB + 1.6, Y_MB + 3.6, Z_B + 10, Z_B + 30)
    usb = box(-3.9, 3.9, Y_MB + 1.6, Y_MB + 4.3, Z_B - 1.0, Z_B + 5.0)
    return pcb.union(chips).union(usb)


def parts():
    shutter_y = {"explode": [0, -1, 0]}
    return [
        {"name": "Front shell", "shape": shell(True), "process": "sheet", "color": "#efe9dd",
         "params": {"material": "aluminium 5052", "thickness_mm": 1.6, "bends": 2,
                    "finish": "SendCutSend powder coat, Matte White"}, "explode": [0, -1, 0]},
        {"name": "Back shell", "shape": shell(False), "process": "sheet", "color": "#3b3d42",
         "params": {"material": "aluminium 5052", "thickness_mm": 1.6, "bends": 2,
                    "finish": "SendCutSend powder coat, Metallic Gray"}, "explode": [0, 1, 0]},
        {"name": "Top cap + frame", "shape": top_cap(), "color": "#d9d4ca", "explode": [0, 0, 1]},
        {"name": "Bottom cap", "shape": bottom_cap(), "color": "#d9d4ca", "explode": [0, 0, -1]},
        {"name": "Privacy shutter", "id": "shutter", "shape": blade(), "color": "#2a2a2c", **shutter_y},
        {"name": "Shutter knob", "id": "knob", "shape": knob(), "color": "#c96f3b", "explode": [0, 0, 1]},
        {"name": "ESP32-CAM (AI-Thinker, OV2640)", "shape": esp32_cam(), "group": "component",
         "color": "#1d3b6e"},
        {"name": "ESP32-CAM-MB", "shape": esp32_cam_mb(), "group": "component", "color": "#14305a"},
        part("led_5mm", name="Status LED", color="#22cc66", at=(0, -10.6, LED_Z), rot=(90, 0, 0)),
        part("m3x16_selftap", at=[(x, y, 3.0) for x, y in PILOTS], rot=(180, 0, 0)),
    ]


def motion():
    return [
        {"part": "shutter", "type": "slide", "axis": [-1, 0, 0], "keys": [[0, 0], [0.3, TRAVEL], [0.7, TRAVEL], [1, 0]]},
        {"part": "knob", "type": "slide", "axis": [-1, 0, 0], "keys": [[0, 0], [0.3, TRAVEL], [0.7, TRAVEL], [1, 0]]},
    ]


ASSEMBLY = [["Top cap + frame"], ["Privacy shutter", "Shutter knob"], ["ESP32-CAM (AI-Thinker, OV2640)", "ESP32-CAM-MB"],
            ["Front shell", "Back shell"], ["Bottom cap"]]

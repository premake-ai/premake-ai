import cadquery as cq
from cadlib.parts import part

# Frosted night-light camera. An opal acrylic tube stands between a printed
# base cap and a printed camera head. The head is printed in one piece with the
# internal chassis (board cradle + spine), and the spine's foot is screwed to the
# base from below, which clamps the tube and the LED ring tray between them.
SCENE = "shelf"

# ePlastics 2447 white tube, 2.000" OD x 1.750" ID, cut to 4"
TUBE_OD, TUBE_ID, TUBE_L = 50.8, 44.45, 101.6
CAP_OD = 56.0
BORE = 51.6                      # tube socket in the caps (0.4 mm radial clearance)
BASE_H = 24.0
TRAY_Z, TRAY_T = 16.0, 2.4
TUBE_Z0 = TRAY_Z + TRAY_T        # tube stands on the ring tray
TUBE_Z1 = TUBE_Z0 + TUBE_L
HEAD_Z0 = TUBE_Z1 - 6.0          # 6 mm of tube inside the head
HEAD_H = 56.0
HEAD_Z1 = HEAD_Z0 + HEAD_H

# camera stack (AI-Thinker ESP32-CAM 27 x 40.5 x 4.5, on ESP32-CAM-MB 27 x 40)
CAM_Z0 = TUBE_Z1
CAM_Z1 = CAM_Z0 + 40.5
LENS_Z = CAM_Z1 - 13.0           # lens centre ~13 mm below the antenna end (estimate)
PCB_Y = -10.0                    # front face of the ESP32-CAM PCB
MB_Y0 = 1.5                      # MB PCB front face
SPINE_Y0, SPINE_T = 3.2, 4.0
SY1 = SPINE_Y0 + SPINE_T

# faceplate: 1.5 mm 5052, black powder coat, 2 bends
T = 1.5
FP_W, FP_Z0, FP_Z1 = 32.0, TUBE_Z1 + 1.4, HEAD_Z1 - 2.6
FP_IN = -24.5                    # back face of the faceplate
FLANGE = 6.0
FP_SCREWS = [(-10.0, FP_Z1 - 4.0), (10.0, FP_Z0 + 4.5)]
LED_XZ = (-10.3, FP_Z0 + 11.0)

# privacy shutter: slides up 11 mm to cover the lens
SHUT_TRAVEL = 11.0
SL_Z0 = LENS_Z - 22.8
SL_H, SL_W = 29.3, 14.0

# spine foot screws (from below through the base)
FOOT_Z0 = 7.0
FOOT_SCREWS = [(-4.0, 0.5), (4.0, 0.5)]
USB_Z = 9.0


def cyl(d, h, z, x=0, y=0):
    return cq.Workplane("XY").workplane(offset=z).center(x, y).circle(d / 2).extrude(h)


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def ycyl(d, y0, y1, x, z):
    """Cylinder along Y from y0 to y1."""
    return cq.Workplane("XZ").workplane(offset=-y0).center(x, z).circle(d / 2).extrude(-(y1 - y0))


def soft(w, sel, r):
    try:
        return w.edges(sel).fillet(r)
    except Exception:
        return w


def base_cap():
    b = cyl(CAP_OD, BASE_H, 0)
    b = soft(b, "<Z", 2.0)
    b = soft(b, ">Z", 1.2)
    b = b.cut(cyl(BORE, BASE_H, 2.4))
    # tray supports: two posts + the socket wall at the back
    for x in (-17, 17):
        b = b.union(cyl(7.0, TRAY_Z - 1.9, 1.9, x, -12))
    b = b.union(box(-18.5, 18.5, 16.5, 26.5, 1.9, TRAY_Z))
    # micro-USB panel socket: flange drops into a slot, body pokes out the back
    b = b.cut(box(-17.5, 17.5, 18.8, 21.2, 3.5, TRAY_Z + 0.1))
    b = b.cut(box(-6.3, 6.3, 18.0, 30.0, USB_Z - 2.7, USB_Z + 2.7))
    b = b.cut(box(-2.5, 2.5, 10.0, 19.0, 2.4, TRAY_Z + 0.1))           # cable notch
    # screw pad, counterbores and clearance holes for the spine foot
    b = b.union(box(-9, 9, -5, 6, 1.9, 5.4))
    for x, y in FOOT_SCREWS:
        b = b.cut(cyl(3.4, 6, 0, x, y)).cut(cyl(6.2, 2.4, 0, x, y))
    # recesses for 4 rubber bumpers
    for x, y in ((-17, -17), (17, -17), (-17, 17), (17, 17)):
        b = b.cut(cyl(8.4, 1.0, 0, x, y))
    return b


def ring_tray():
    t = cyl(BORE - 0.6, TRAY_T, TRAY_Z)
    t = t.cut(cyl(37.6, 1.0, TRAY_Z + TRAY_T - 1.0))          # ring pocket
    t = t.cut(cyl(23.0, TRAY_T, TRAY_Z))                      # spine + cable pass
    t = t.union(cyl(40.4, 3.0, TRAY_Z + TRAY_T - 0.5).cut(cyl(37.6, 4, TRAY_Z)))  # lip
    return t


def head():
    h = cyl(CAP_OD, HEAD_H, HEAD_Z0)
    h = soft(h, ">Z", 3.0)
    h = soft(h, "<Z", 1.0)
    cav = cyl(BORE, HEAD_H - 3.0, HEAD_Z0 - 0.01).intersect(
        box(-30, 30, FP_IN + 4.0, 30, HEAD_Z0 - 1, HEAD_Z1 - 3.0))
    h = h.cut(cav).cut(cyl(BORE, 6.0, HEAD_Z0 - 0.01))
    # flat + flange slots for the faceplate
    h = h.cut(box(-FP_W / 2 - 0.3, FP_W / 2 + 0.3, -40, FP_IN, FP_Z0 - 0.3, FP_Z1 + 0.3))
    for s in (-1, 1):
        x0, x1 = s * (FP_W / 2 - T - 0.2), s * (FP_W / 2 + 0.3)
        h = h.cut(box(min(x0, x1), max(x0, x1), FP_IN - 1, FP_IN + FLANGE + 0.3,
                      FP_Z0 - 0.3, FP_Z1 + 0.3))
    # bosses behind the front wall: screws and status LED
    for x, z in FP_SCREWS:
        h = h.union(ycyl(5.5, FP_IN + 3.0, FP_IN + 7.0, x, z))
    h = h.union(ycyl(8.0, FP_IN + 3.0, FP_IN + 5.8, *LED_XZ))
    # shutter pocket, lens window, LED hole, screw pilots
    h = h.cut(box(-SL_W / 2 - 0.5, SL_W / 2 + 0.5, FP_IN - 0.1, FP_IN + 2.2,
                  SL_Z0 - 0.5, SL_Z0 + SL_H + SHUT_TRAVEL + 0.5))
    h = h.cut(ycyl(11.0, FP_IN, FP_IN + 6, 0, LENS_Z))
    h = h.cut(ycyl(5.1, FP_IN - 1, FP_IN + 6, *LED_XZ))
    for x, z in FP_SCREWS:
        h = h.cut(ycyl(1.6, FP_IN - 1, FP_IN + 6.5, x, z))
    # board cradle: back plate, side rails with grooves for the MB edges
    cz0, cz1 = CAM_Z0 - 4, CAM_Z1 - 2
    cr = box(-15.7, 15.7, SPINE_Y0, SY1, cz0, cz1)
    for s in (-1, 1):
        rail = box(min(s * 12.9, s * 15.7), max(s * 12.9, s * 15.7), -1.0, SY1, cz0, cz1)
        groove = box(min(s * 13.0, s * 13.9), max(s * 13.0, s * 13.9),
                     MB_Y0 - 0.15, MB_Y0 + 1.75, cz0 - 1, cz1 + 1)
        cr = cr.union(rail.cut(groove))
    cr = cr.union(box(-9, 9, SY1 - 1, 25.0, CAM_Z1 - 16, HEAD_Z1 - 2.0))   # tie to back wall
    h = h.union(cr)
    h = h.union(box(-8, 8, -12, 0, CAM_Z1 + 0.2, HEAD_Z1 - 2.0))           # holds the CAM down
    # spine down through the tube, foot screwed into from below
    h = h.union(box(-7, 7, SPINE_Y0, SY1, FOOT_Z0 + 2, cz0 + 1))
    foot = box(-8, 8, -5, 6, FOOT_Z0, FOOT_Z0 + 10)
    for x, y in FOOT_SCREWS:
        foot = foot.cut(cyl(2.5, 9.0, FOOT_Z0 - 0.01, x, y))
    return h.union(foot)


def faceplate():
    f = box(-FP_W / 2, FP_W / 2, FP_IN - T, FP_IN, FP_Z0, FP_Z1)
    for s in (-1, 1):
        x0, x1 = s * (FP_W / 2 - T), s * FP_W / 2
        f = f.union(box(min(x0, x1), max(x0, x1), FP_IN - T, FP_IN + FLANGE, FP_Z0, FP_Z1))
    f = soft(f, "|Y", 2.0)
    f = f.cut(ycyl(10.0, FP_IN - 3, FP_IN + 1, 0, LENS_Z))         # camera window
    f = f.cut(ycyl(2.5, FP_IN - 3, FP_IN + 1, *LED_XZ))            # status LED pinhole
    f = f.cut(box(-1.8, 1.8, FP_IN - 3, FP_IN + 1, SL_Z0 + 1.2, SL_Z0 + 4.8 + SHUT_TRAVEL))
    for x, z in FP_SCREWS:
        f = f.cut(ycyl(2.4, FP_IN - 3, FP_IN + 1, x, z))
    return f


def shutter():
    s = box(-SL_W / 2, SL_W / 2, FP_IN + 0.1, FP_IN + 2.0, SL_Z0, SL_Z0 + SL_H)
    s = soft(s, "|Y", 1.5)
    s = s.cut(ycyl(10.0, FP_IN - 1, FP_IN + 3, 0, SL_Z0 + 22.8))
    tab = box(-1.3, 1.3, FP_IN - T - 2.5, FP_IN + 0.5, SL_Z0 + 1.6, SL_Z0 + 4.4)
    return s.union(soft(tab, "|X", 0.5))


# ---------- simple models for parts the library lacks ----------
def esp32_cam():
    c = box(-13.5, 13.5, PCB_Y, PCB_Y + 1.0, CAM_Z0, CAM_Z1)
    c = c.union(box(-9, 9, PCB_Y - 3.2, PCB_Y, CAM_Z1 - 25.5, CAM_Z1))       # ESP32-S module
    c = c.union(box(-4.25, 4.25, PCB_Y - 6.2, PCB_Y - 3.2, LENS_Z - 4.25, LENS_Z + 4.25))
    c = c.union(ycyl(8.0, PCB_Y - 10.0, PCB_Y - 6.2, 0, LENS_Z))              # OV2640 lens
    for x in (-11.43, 11.43):
        c = c.union(box(x - 1.27, x + 1.27, PCB_Y + 1.0, PCB_Y + 3.5, CAM_Z0 + 1, CAM_Z0 + 21.3))
    return c


def cam_mb():
    m = box(-13.5, 13.5, MB_Y0, MB_Y0 + 1.6, CAM_Z0, CAM_Z0 + 40.0)
    for x in (-11.43, 11.43):
        m = m.union(box(x - 1.27, x + 1.27, PCB_Y + 3.5, MB_Y0, CAM_Z0 + 1, CAM_Z0 + 21.3))
    m = m.union(box(-3.9, 3.9, MB_Y0 - 3.0, MB_Y0, CAM_Z0 - 0.8, CAM_Z0 + 5))  # micro-USB
    return m


def usb_extension():
    pz = CAM_Z0 - 0.8
    plug = box(-5.5, 5.5, -4.5, 1.5, pz - 20, pz)
    up = box(-1.7, 1.7, -2.9, 0.5, 26, pz - 20)
    jog = box(-1.7, 1.7, -10.2, 0.5, 23, 26.5)
    down = box(-1.7, 1.7, -10.2, -6.8, 5.0, 23.5)
    floor = box(-1.7, 12.0, -10.2, -6.8, 3.0, 6.5).union(box(8.5, 12.0, -10.2, 12.0, 3.0, 6.5))
    tail = box(-2.0, 12.0, 10.0, 19.0, 3.0, 6.5)
    flange = box(-16.5, 16.5, 19.0, 21.0, USB_Z - 4.8, USB_Z + 4.8)
    sock = box(-6.0, 6.0, 21.0, 27.6, USB_Z - 2.4, USB_Z + 2.4)
    w = plug
    for s in (up, jog, down, floor, tail, flange, sock):
        w = w.union(s)
    return w


def led_ring():
    z = TRAY_Z + TRAY_T - 1.0
    return cyl(37.0, 3.0, z).cut(cyl(23.0, 3.0, z))


def parts():
    tube = cyl(TUBE_OD, TUBE_L, TUBE_Z0).cut(cyl(TUBE_ID, TUBE_L, TUBE_Z0))
    for nm, fn in (("Base cap", base_cap), ("Ring tray", ring_tray), ("Head & chassis", head),
                   ("Faceplate", faceplate), ("Privacy shutter", shutter)):
        n = fn().solids().size()
        if n != 1:
            raise ValueError(f"{nm} is {n} solids")
    return [
        {"name": "Base cap", "shape": base_cap(), "color": "#b08560", "explode": [0, 0, -1]},
        {"name": "Ring tray", "shape": ring_tray(), "color": "#e8e4dc", "explode": [0, 0, -0.5]},
        {"name": "WS2812B 12-LED ring", "shape": led_ring(), "group": "component", "color": "#1a1a1a",
         "fx": {"glow": {"color": "#ffb36b", "mode": "solid"}}, "explode": [0, 0, -0.3]},
        {"name": "Frosted tube", "shape": tube, "group": "component", "material": "acrylic_frosted",
         "color": "#f6f4ee", "explode": [0, 0, 0.3]},
        {"name": "Head & chassis", "shape": head(), "color": "#b08560", "explode": [0, 0, 1]},
        {"name": "Faceplate", "shape": faceplate(), "process": "sheet", "color": "#161616",
         "params": {"material": "aluminium 5052", "thickness_mm": T, "bends": 2},
         "explode": [0, -1, 0.3]},
        {"name": "Privacy shutter", "id": "shutter", "shape": shutter(), "color": "#2a2a2a",
         "explode": [0, -1, 0.5]},
        {"name": "ESP32-CAM (AI-Thinker, OV2640)", "shape": esp32_cam(), "group": "component",
         "color": "#1d1d1d", "explode": [0, -0.6, 0.8]},
        {"name": "ESP32-CAM-MB programmer", "shape": cam_mb(), "group": "component",
         "color": "#1b3f8a", "explode": [0, -0.2, 0.8]},
        {"name": "Micro-USB panel extension", "shape": usb_extension(), "group": "component",
         "color": "#202020", "explode": [0, 1, -0.5]},
        part("led_5mm", at=(LED_XZ[0], FP_IN + 6.8, LED_XZ[1]), rot=(90, 0, 0)),
        part("m2x6_selftap", at=[(x, FP_IN - T, z) for x, z in FP_SCREWS], rot=(90, 0, 0)),
        part("m3x12_selftap", at=[(x, y, 2.4) for x, y in FOOT_SCREWS], rot=(180, 0, 0)),
    ]


def motion():
    return [{"part": "shutter", "type": "slide", "axis": [0, 0, 1],
             "keys": [[0, 0], [0.3, SHUT_TRAVEL], [0.7, SHUT_TRAVEL], [1, 0]]}]

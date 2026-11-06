import cadquery as cq
from cadlib import fab
from cadlib.parts import part
from cadlib.look import engrave_text

SCENE = "wall"

# --- corner (wall at y=0, ceiling at z=TOP) ---
TOP = 112.0
PAD = 1.2            # removable adhesive strip thickness
T = 1.5              # bracket sheet, aluminium 5052

# --- camera pod ---
W, D, H = 56.0, 36.0, 64.0
PY, PZ = -52.0, 68.0                 # pod centre
PIV_Z = 80.0                         # tilt axis (along X), y = PY
WALL = 2.5
YF = PY - D / 2                      # front face  -70
YB = PY + D / 2                      # back face   -34
Y_SPLIT = YB - WALL                  # shell / back cap split line
IX, IZ = W / 2 - WALL, H / 2 - WALL  # cavity half sizes 25.5 x 29.5
POCKET = 3.0                         # front pocket for the acrylic face
FWALL = 2.0                          # printed wall behind the face
Y_IN = YF + POCKET + FWALL           # cavity front  -65
PANEL_W, PANEL_H = 44.0, 52.0
PANEL_T = fab.sheet_actual("acrylic", 3)

# --- electronics stack (board vertical, lens -Y, camera end up, MB micro-USB down) ---
CAM_W, CAM_H = 27.0, 40.5            # AI-Thinker ESP32-CAM
MB_H = 40.0                          # ESP32-CAM-MB
BZ0 = 54.0                           # board bottom edge
LENS_Z = BZ0 + CAM_H - 13.0          # lens centre (estimated, +-2 mm)
LENS_Y = Y_IN + 2.4                  # lens front
PCB_Y = LENS_Y + 8.0                 # ESP32-CAM PCB front face
MB_Y = PCB_Y + 1.0 + 8.5             # MB PCB front face (pins in female headers)
LENS_HOLE_WALL, LENS_HOLE_PANEL = 14.0, 16.0

# --- shutter (slides along X behind the front wall) ---
SH_W, SH_H, SH_T = 18.0, 18.0, 1.6
SH_Y = Y_IN + 0.2
SH_OPEN = 16.5
LED_Z = 46.0


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def cyl_x(x0, x1, y, z, d):
    return cq.Workplane("YZ").circle(d / 2).extrude(x1 - x0).translate((x0, y, z))


def cyl_y(y0, y1, x, z, d):
    return cq.Workplane("XZ").circle(d / 2).extrude(-(y1 - y0)).translate((x, y0, z))


def outer():
    o = cq.Workplane("XY").box(W, D, H).translate((0, PY, PZ))
    o = o.edges("|Y").fillet(8)
    o = o.faces("<Y").edges().fillet(4)
    o = o.faces(">Y").edges().fillet(2)
    return o


def cavity():
    c = cq.Workplane("XY").box(2 * IX, YB + 5 - Y_IN, 2 * IZ).translate((0, (Y_IN + YB + 5) / 2, PZ))
    return c.edges("|Y").fillet(8 - WALL)


CAP_SCREWS = [(sx * 22.0, PZ + sz * 27.0) for sx in (-1, 1) for sz in (-1, 1)]


def shell():
    s = outer().cut(box(-40, 40, Y_SPLIT, YB + 1, 0, 140)).cut(cavity())
    # front pocket for the smoked acrylic face
    pocket = (cq.Workplane("XZ").rect(PANEL_W + 0.1, PANEL_H + 0.1).extrude(-POCKET)
              .edges("|Y").fillet(4).translate((0, YF - 0.01, PZ)))
    s = s.cut(pocket)
    # internal features
    s = s.union(box(-IX - 1, IX + 1, Y_IN - 0.5, SH_Y + SH_T + 0.3, LENS_Z - SH_H / 2 - 1.8, LENS_Z - SH_H / 2))  # shutter rail
    for sx in (-1, 1):
        s = s.union(box(min(sx * 12.5, sx * (IX + 1)), max(sx * 12.5, sx * (IX + 1)),
                        PCB_Y - 2.5, PCB_Y, BZ0 + 2, BZ0 + CAM_H - 2.5))          # board front stops
        s = s.union(cyl_x(min(sx * 19, sx * (IX + 1)), max(sx * 19, sx * (IX + 1)), PY, PIV_Z, 12))  # pivot boss inside
        s = s.union(cyl_x(min(sx * (W / 2 - 1), sx * (W / 2 + 1)), max(sx * (W / 2 - 1), sx * (W / 2 + 1)),
                          PY, PIV_Z, 14))                                          # pivot boss outside (1 mm proud)
    for x, z in CAP_SCREWS:
        s = s.union(cyl_y(Y_SPLIT - 8, Y_SPLIT, x, z, 6.5))
    # holes
    s = s.cut(cyl_y(YF - 1, Y_IN + 1, 0, LENS_Z, LENS_HOLE_WALL))
    s = s.cut(cyl_y(YF - 1, Y_IN + 1, 0, LED_Z, 5.3))
    s = s.cut(box(-2.4, SH_OPEN + 2.4, SH_Y - 0.1, SH_Y + SH_T + 0.1, PZ, PZ + H))  # shutter tab slot
    s = s.cut(box(-6, 6, MB_Y + 1.6 - 1.5 - 4, MB_Y + 1.6 - 1.5 + 4, PZ - H, BZ0 - 6))                # micro-USB plug
    for sx in (-1, 1):
        s = s.cut(cyl_x(min(sx * 19.5, sx * (W / 2 + 2)), max(sx * 19.5, sx * (W / 2 + 2)), PY, PIV_Z, 5.6))  # M4 insert
    for x, z in CAP_SCREWS:
        s = s.cut(cyl_y(Y_SPLIT - 7, Y_SPLIT + 0.1, x, z, 2.0))                    # M2.5 pilot
    return s


def back_cap():
    c = outer().intersect(box(-40, 40, Y_SPLIT, YB + 1, 0, 140))
    rim = (cq.Workplane("XZ").rect(2 * IX - 0.4, 2 * IZ - 0.4).extrude(3)
           .edges("|Y").fillet(5).translate((0, Y_SPLIT + 0.5, PZ)))
    rim = rim.cut(cq.Workplane("XZ").rect(2 * IX - 3.4, 2 * IZ - 3.4).extrude(4)
                  .edges("|Y").fillet(4).translate((0, Y_SPLIT + 0.6, PZ)))
    c = c.union(rim)
    for x, z in CAP_SCREWS:
        c = c.cut(cyl_y(Y_SPLIT - 4, YB + 1, x, z, 7.5)).union(
            cyl_y(Y_SPLIT - 0.0, YB, x, z, 7.5)).cut(cyl_y(Y_SPLIT - 4, YB + 1, x, z, 2.8))
    # board rails: hold the ESP32-CAM-MB edges and press the stack against the front stops
    for sx in (-1, 1):
        x0 = sx * (CAM_W / 2 + 0.2)
        rail = box(min(x0, x0 + sx * 2), max(x0, x0 + sx * 2), MB_Y - 0.5, Y_SPLIT + 0.5, BZ0 + 3, BZ0 + MB_H - 3)
        c = c.union(rail)
        lip = box(min(x0 - sx * 1.5, x0 + sx * 2), max(x0 - sx * 1.5, x0 + sx * 2),
                  MB_Y + 1.6 + 0.2, Y_SPLIT + 0.5, BZ0 + 3, BZ0 + MB_H - 3)
        c = c.union(lip)
    return c


def front_panel():
    p = (cq.Workplane("XZ").rect(PANEL_W, PANEL_H).extrude(-PANEL_T)
         .edges("|Y").fillet(4).translate((0, YF + POCKET - PANEL_T, PZ)))
    p = p.cut(cyl_y(YF - 1, YF + 5, 0, LENS_Z, LENS_HOLE_PANEL))
    p, eng = engrave_text(p, "kin", face="<Y", depth=0.4, size=4.5, offset=(0, -10))
    return p, eng


def shutter(dx=0.0):
    plate = box(-SH_W / 2, SH_W / 2, SH_Y, SH_Y + SH_T, LENS_Z - SH_H / 2, LENS_Z + SH_H / 2)
    try:
        plate = plate.edges("|Y").fillet(3)
    except Exception:
        pass
    tab = box(-2, 2, SH_Y, SH_Y + SH_T, LENS_Z + SH_H / 2 - 1, PZ + H / 2 + 2.5)
    try:
        tab = tab.faces(">Z").edges("|Y").fillet(1.5)
    except Exception:
        pass
    return plate.union(tab).translate((dx, 0, 0))


def bracket():
    zc = TOP - PAD                       # top of sheet
    yw = -PAD                            # back of sheet
    plate = box(-W / 2 - 2.5, W / 2 + 2.5, -66, yw, zc - T, zc)
    try:
        plate = plate.edges("|Z and <Y").fillet(6)
    except Exception:
        pass
    wall = box(-W / 2 - 2.5, W / 2 + 2.5, yw - T, yw, TOP - 48, zc)
    try:
        wall = wall.edges("|Y and <Z").fillet(6)
    except Exception:
        pass
    b = plate.union(wall)
    for sx in (-1, 1):
        x0, x1 = sorted((sx * (W / 2 + 1), sx * (W / 2 + 1 + T)))
        prof = (cq.Workplane("YZ").moveTo(PY - 13, zc).lineTo(PY - 13, PIV_Z)
                .threePointArc((PY, PIV_Z - 13), (PY + 13, PIV_Z)).lineTo(PY + 13, zc).close()
                .extrude(x1 - x0).translate((x0, 0, 0)))
        b = b.union(prof).cut(cyl_x(x0 - 1, x1 + 1, PY, PIV_Z, 4.5))
    return b


def esp32_cam():
    pcb = box(-CAM_W / 2, CAM_W / 2, PCB_Y, PCB_Y + 1.0, BZ0, BZ0 + CAM_H)
    shield = box(-9, 9, PCB_Y - 3.3, PCB_Y, BZ0 + 2, BZ0 + 27)
    cam = box(-4.25, 4.25, LENS_Y + 3.5, PCB_Y - 3.3, LENS_Z - 4.25, LENS_Z + 4.25)
    lens = cyl_y(LENS_Y, LENS_Y + 3.6, 0, LENS_Z, 7.5)
    return pcb.union(shield).union(cam).union(lens)


def cam_mb():
    pcb = box(-CAM_W / 2, CAM_W / 2, MB_Y, MB_Y + 1.6, BZ0, BZ0 + MB_H)
    hdr = box(-13, -10.5, PCB_Y + 1.0, MB_Y, BZ0 + 1, BZ0 + 38).union(
        box(10.5, 13, PCB_Y + 1.0, MB_Y, BZ0 + 1, BZ0 + 38))
    usb = box(-3.9, 3.9, MB_Y + 1.6, MB_Y + 1.6 + 3.0, BZ0, BZ0 + 5.5)
    chip = box(-5, 5, MB_Y + 1.6, MB_Y + 3.2, BZ0 + 14, BZ0 + 24)
    return pcb.union(hdr).union(usb).union(chip)


def strips():
    ceil = box(-24, 24, -60, -6, TOP - PAD, TOP)
    wall = box(-24, 24, -PAD, 0, TOP - 44, TOP - 8)
    return ceil.union(wall)


def parts():
    panel, eng = front_panel()
    out = [
        {"name": "Pod shell", "shape": shell(), "color": "#e6e2db", "material": "petg"},
        {"name": "Back cap", "shape": back_cap(), "color": "#e6e2db", "material": "petg", "explode": [0, 1, 0]},
        {"name": "Privacy shutter", "id": "shutter", "shape": shutter(), "color": "#e8743b", "explode": [0, 0, 1]},
        {"name": "Front panel", "shape": panel, "process": "laser",
         "params": {"material": "smoked acrylic", "thickness_mm": 3}, "material": "acrylic_clear",
         "color": "#1c1c1e", "engrave": eng, "explode": [0, -1, 0]},
        {"name": "Corner bracket", "shape": bracket(), "process": "sheet",
         "params": {"material": "aluminium 5052", "thickness_mm": 1.5, "bends": 3, "finish": "black powder coat"},
         "color": "#26272a", "explode": [0, 0, 1]},
        {"name": "ESP32-CAM (AI-Thinker, OV2640)", "shape": esp32_cam(), "group": "component",
         "color": "#1d4f91", "explode": [0, 1, 0]},
        {"name": "ESP32-CAM-MB USB programmer", "shape": cam_mb(), "group": "component", "color": "#20232a",
         "explode": [0, 1, 0],
         "cable": {"type": "micro-usb", "at": [0, MB_Y + 3.1, PZ - H / 2], "dir": [0, 0, -1], "length_mm": 400}},
        {"name": "Removable mounting strips", "shape": strips(), "group": "component", "color": "#f2f2f2"},
        {**part("led_5mm", at=(0, Y_IN + 7.6, LED_Z), rot=(90, 0, 0)),
         "fx": {"glow": {"color": "#ff3b30", "mode": "solid"}}},
        part("m4_insert", at=[(W / 2 + 1, PY, PIV_Z)], rot=(0, -90, 0)),
        part("m4_insert", at=[(-W / 2 - 1, PY, PIV_Z)], rot=(0, 90, 0)),
        part("m4x8_bhcs", at=[(W / 2 + 1 + T, PY, PIV_Z)], rot=(0, 90, 0)),
        part("m4x8_bhcs", at=[(-W / 2 - 1 - T, PY, PIV_Z)], rot=(0, -90, 0)),
        {**part("m25x8_selftap", at=[(x, YB, z) for x, z in CAP_SCREWS], rot=(-90, 0, 0)), "id": "cap_screws"},
    ]
    return out


ASSEMBLY = [["Corner bracket", "Removable mounting strips"], ["Pod shell", "M4 heat-set insert"], ["Front panel"],
            ["Privacy shutter"], ["5 mm LED (red)"], ["ESP32-CAM (AI-Thinker, OV2640)", "ESP32-CAM-MB USB programmer"],
            ["Back cap"], ["M4×8 button head screw"]]


POD_PARTS = ["Pod shell", "Back cap", "Front panel", "ESP32-CAM (AI-Thinker, OV2640)",
             "ESP32-CAM-MB USB programmer", "5 mm LED (red)", "M4 heat-set insert",
             "cap_screws"]
TILT_MAX = 25.0


def motion():
    from cadlib.motion import rot, move, then, ease

    def pose(t):
        # 0-0.45: tilt down 25 deg and back; 0.5-1: shutter opens, holds, closes
        tilt = TILT_MAX * ease(t / 0.2) if t < 0.2 else (TILT_MAX if t < 0.3 else TILT_MAX * (1 - ease((t - 0.3) / 0.15)))
        if t >= 0.45:
            tilt = 0.0
        s = 0.0
        if 0.5 <= t < 0.65:
            s = SH_OPEN * ease((t - 0.5) / 0.15)
        elif 0.65 <= t < 0.85:
            s = SH_OPEN
        elif 0.85 <= t:
            s = SH_OPEN * (1 - ease((t - 0.85) / 0.15))
        r = rot([1, 0, 0], tilt, (0, PY, PIV_Z))
        out = {n: r for n in POD_PARTS}
        out["shutter"] = then(move((s, 0, 0)), r)
        return out

    return {"duration": 8, "pose": pose}

import math
import cadquery as cq
from cadlib import fab
from cadlib.parts import part

SCENE = "desk"
ASSEMBLY = [["Rubber foot", "Weight plate"], ["Base"], ["ESP32-C3 SuperMini", "USB-C power breakout", "Encoder EC11"],
            ["Stem", "Slot cover strip"], ["Arm"], ["LED ring 24"], ["Diffuser"], ["Head"], ["Knob"]]

WHITE = "#ece8df"
# base: printed shell over a 3 mm steel weight plate on rubber feet
FOOT = 3.5
PT = 3.0                       # steel plate thickness
B0 = FOOT + PT                 # base shell bottom
BASE_D, BASE_H, WALL = 140, 16, 2.0
BTOP = B0 + BASE_H             # top of base
CEIL = BTOP - WALL             # underside of base top
SCREW_R = 52                   # plate screws, M3 self-tap
# stem: 2020 x 300 standing on the plate
STEM_Y = 40
STEM_L = 300
STEM_TOP = B0 + STEM_L
SOCK = 20.4                    # 2020 socket, slip fit
COLLAR = 28
COLLAR_TOP = BTOP + 16
# arm + hinge
BEAM_W, BEAM_Z0, BEAM_Z1 = 18, STEM_TOP - 8, STEM_TOP + 7
PIV_Y, PIV_Z = -80.0, BEAM_Z0 - 7.5
# head
HEAD_D, HEAD_H, HW = 96, 24, 2.0
HEAD_Y = -118
HEAD_TOP = PIV_Z - 15
HEAD_Z0 = HEAD_TOP - HEAD_H
RING_OD, RING_ID = 66, 52
DIFF_T = fab.sheet_actual("acrylic", 3)
DIFF_Z = HEAD_Z0 + 1.0
BOSS_R = 37.5                  # diffuser screws, just outside the LED ring, bosses hang from the head top
ENC = (0, -40)


def cyl(d, h, x=0, y=0, z=0):
    return cq.Workplane("XY").circle(d / 2).extrude(h).translate((x, y, z))


def box(sx, sy, sz, cx, cy, z0):
    return cq.Workplane("XY").box(sx, sy, sz).translate((cx, cy, z0 + sz / 2))


def soft(w, sel, r):
    try:
        return w.edges(sel).fillet(r)
    except Exception:
        return w


def polar(r, degs, z=0):
    return [(r * math.cos(math.radians(a)), r * math.sin(math.radians(a)), z) for a in degs]


def base():
    b = soft(cyl(BASE_D, BASE_H, z=B0), ">Z", 6)
    b = b.cut(cyl(BASE_D - 2 * WALL, BASE_H - WALL, z=B0))
    # stem collar (through the top, down to the plate)
    col = soft(box(COLLAR, COLLAR, COLLAR_TOP - B0, 0, STEM_Y, B0), "|Z", 4)
    b = b.union(col).cut(box(SOCK, SOCK, 60, 0, STEM_Y, B0 - 1))
    b = b.cut(box(8, 6, 9, 0, STEM_Y + SOCK / 2 + 2, B0 - 1))          # wire exit from the stem's back slot
    for sx in (1, -1):                                                    # M5 clamp screws into T-nuts
        b = b.cut(cq.Workplane("YZ").circle(2.75).extrude(10).translate((sx * 9 if sx > 0 else -19, STEM_Y, BTOP + 8)))
    # plate screw bosses, pilot from below
    for x, y, _ in polar(SCREW_R, (45, 135, 225, 315)):
        b = b.union(cyl(8, BASE_H - 1, x, y, B0)).cut(cyl(fab.pilot(3), 9, x, y, B0 - 0.1))
    # USB-C breakout block hanging from the top, socket out the back wall
    ux = -35
    uy = math.sqrt((BASE_D / 2 - WALL) ** 2 - ux ** 2) - 8.5
    b = b.union(box(14, 18, CEIL - 15.6 + 1, ux, uy - 1, 15.6))
    b = b.cut(box(14, 20, 9, ux, uy + 12, 15.6 - 2.6 - 4.5))
    # encoder hole + anti-rotation tab slot, and a pocket frame for the C3
    b = b.cut(cyl(7.4, 10, ENC[0], ENC[1], CEIL - 2))
    b = b.cut(box(1.4, 3, 1.2, ENC[0], ENC[1] + 7.8, CEIL - 0.1))
    fr = box(22.5 + 4.8, 18 + 4.8, 4, 30, -10, CEIL - 3).cut(box(22.9, 18.4, 4, 30, -10, CEIL - 4))
    b = b.union(fr)
    return b, (ux, uy)


def plate():
    p = cyl(BASE_D - 6, PT, z=FOOT)
    for x, y, _ in polar(SCREW_R, (45, 135, 225, 315)):
        p = p.cut(cyl(3.4, 10, x, y, 0))
    return soft(p, ">Z or <Z", 0.6)


def arm():
    y_back = STEM_Y + COLLAR / 2
    sleeve = box(COLLAR, COLLAR, BEAM_Z1 - (STEM_TOP - 32), 0, STEM_Y, STEM_TOP - 32)
    sleeve = soft(sleeve, "|Z", 4)
    beam = box(BEAM_W, y_back - PIV_Y - 4, BEAM_Z1 - BEAM_Z0, 0, (y_back + PIV_Y + 4) / 2 - 4, BEAM_Z0)
    beam = soft(beam, "|Y", 3)
    a = sleeve.union(beam)
    # fork cheeks round the hinge
    for sx in (1, -1):
        ch = (cq.Workplane("YZ").center(PIV_Y, PIV_Z).circle(8).extrude(4.6)
              .union(box(4.6, 16, BEAM_Z0 + 1 - PIV_Z, 0, PIV_Y, PIV_Z).translate((2.3, 0, 0)))
              .translate((6.3 if sx > 0 else -10.9, 0, 0)))
        a = a.union(ch)
    a = a.cut(cq.Workplane("YZ").center(PIV_Y, PIV_Z).circle(2.2).extrude(30).translate((-15, 0, 0)))
    # stem socket (open below), wire space above the stem, wire channel to the head
    a = a.cut(box(SOCK, SOCK, 33, 0, STEM_Y, STEM_TOP - 33))           # stem stops on the ledge at STEM_TOP
    a = a.cut(box(8, STEM_Y + SOCK / 2 + 2 - (PIV_Y + 16), 5, 0, (STEM_Y + SOCK / 2 + 2 + PIV_Y + 16) / 2, STEM_TOP - 0.5))
    a = a.cut(box(8, 4, 6, 0, STEM_Y + SOCK / 2 - 1, STEM_TOP - 1))       # back slot -> channel
    a = a.cut(cyl(6, STEM_TOP + 3 - (BEAM_Z0 - 2), 0, PIV_Y + 14, BEAM_Z0 - 2))
    a = a.cut(cq.Workplane("YZ").circle(2.75).extrude(10).translate((9, STEM_Y, STEM_TOP - 16)))
    return a


def head():
    h = soft(cyl(HEAD_D, HEAD_H, 0, HEAD_Y, HEAD_Z0), ">Z", 8)
    h = soft(h, "<Z", 1)
    h = h.cut(cyl(HEAD_D - 2 * HW, HEAD_H - 2.5, 0, HEAD_Y, HEAD_Z0 - 0.01))
    # hinge tab
    tab = (cq.Workplane("YZ").center(PIV_Y, PIV_Z).circle(6).extrude(12).translate((-6, 0, 0))
           .union(box(12, 12, PIV_Z - HEAD_TOP + 2.4, 0, PIV_Y, HEAD_TOP - 2.4)))
    h = h.union(tab).cut(cq.Workplane("YZ").center(PIV_Y, PIV_Z).circle(2.2).extrude(20).translate((-10, 0, 0)))
    h = h.cut(cyl(6, 10, 0, PIV_Y - 14, HEAD_TOP - 5))                    # wire entry
    # diffuser screw bosses, joined to the wall
    for x, y, _ in polar(BOSS_R, (90, 210, 330)):
        z0 = DIFF_Z + DIFF_T
        h = h.union(cyl(6.5, HEAD_TOP - 1 - z0, x, y + HEAD_Y, z0)).cut(cyl(fab.pilot(2.5), 8, x, y + HEAD_Y, z0 - 0.1))
    return h


def diffuser():
    d = cyl(HEAD_D - 2 * HW - 0.6, DIFF_T, 0, HEAD_Y, DIFF_Z)
    for x, y, _ in polar(BOSS_R, (90, 210, 330)):
        d = d.cut(cyl(2.8, 10, x, y + HEAD_Y, DIFF_Z - 1))
    return d


def ring():
    z = HEAD_TOP - 2.5 - 1.6
    r = cyl(RING_OD, 1.6, 0, HEAD_Y, z).cut(cyl(RING_ID, 4, 0, HEAD_Y, z - 1))
    for x, y, _ in polar((RING_OD + RING_ID) / 4, range(0, 360, 15)):
        r = r.union(box(5, 5, 1.6, x, y + HEAD_Y, z - 1.6 + 0.01))
    return r


def encoder():
    z = CEIL
    e = box(12, 12, 6.5, ENC[0], ENC[1], z - 6.5).union(cyl(7, 7, ENC[0], ENC[1], z - 0.01)).union(cyl(6, 12, ENC[0], ENC[1], z + 6.9))
    return e


def parts():
    b, (ux, uy) = base()
    out = [
        {"name": "Base", "shape": b, "group": "case", "color": WHITE},
        {"name": "Weight plate", "shape": plate(), "group": "case", "process": "sheet",
         "params": {"material": "mild steel", "thickness_mm": PT, "bends": 0}, "color": "#3a3c40"},
        {"name": "Stem", "shape": fab.extrusion(STEM_L, "2020", axis="z", at=(0, STEM_Y, B0)), "group": "case",
         "process": "extrusion", "params": {"profile": "2020", "length_mm": STEM_L, "tapped_ends": 0}},
        {"name": "Slot cover strip", "shape": box(6, 1.2, STEM_TOP - 32 - COLLAR_TOP, 0, STEM_Y + 10.0, COLLAR_TOP),
         "group": "component", "color": "#d9d6cf"},
        {"name": "Arm", "shape": arm(), "group": "case", "color": WHITE},
        {"name": "Head", "id": "head", "shape": head(), "group": "case", "color": WHITE},
        {"name": "Diffuser", "id": "diffuser", "shape": diffuser(), "group": "case", "process": "laser",
         "params": {"material": "acrylic", "thickness_mm": 3}, "material": "acrylic_frosted",
         "fx": {"glow": {"color": "#fff1d6", "mode": "solid"}}},
        {"name": "LED ring 24", "id": "ring", "shape": ring(), "group": "component", "color": "#1d1f24",
         "fx": {"glow": {"color": "#fff1d6", "mode": "solid"}}},
        {"name": "Encoder EC11", "shape": encoder(), "group": "component", "color": "#b8bcc2"},
        {"name": "Knob", "shape": soft(cyl(26, 14, ENC[0], ENC[1], BTOP + 1.5).cut(cyl(5.9, 11, ENC[0], ENC[1], BTOP + 1)), ">Z", 3),
         "group": "case", "color": "#c46b3c"},
        {"name": "Rubber foot", "shape": cq.Workplane("XY").pushPoints([p[:2] for p in polar(58, (0, 90, 180, 270))]).circle(6.35).extrude(FOOT),
         "group": "component", "color": "#222222", "material": "rubber"},
        part("esp32_c3_supermini", at=(30, -10, CEIL), rot=(180, 0, 0)),
        part("usbc_breakout", at=(ux, uy, 15.6), rot=(180, 0, -90)),
        part("m3x10_selftap", at=[p[:2] + (FOOT,) for p in polar(SCREW_R, (45, 135, 225, 315))], rot=(180, 0, 0)),
        part("m5x10_bhcs", at=[(COLLAR / 2, STEM_Y, BTOP + 8), (COLLAR / 2, STEM_Y, STEM_TOP - 16)], rot=(0, 90, 0)),
        part("m5x10_bhcs", at=[(-COLLAR / 2, STEM_Y, BTOP + 8)], rot=(0, -90, 0)),
        part("m4x30_shcs", at=(11, PIV_Y, PIV_Z), rot=(0, 90, 0)),
        part("m4_nylock", at=(-10.9, PIV_Y, PIV_Z), rot=(0, -90, 0)),
        part("m25x8_selftap", at=[(x, y + HEAD_Y, DIFF_Z) for x, y, _ in polar(BOSS_R, (90, 210, 330))], rot=(180, 0, 0)),
    ]
    return out


def motion():
    piv = [0, PIV_Y, PIV_Z]
    keys = [[0, 0], [0.3, -25], [0.7, 20], [1, 0]]
    return [{"part": pid, "type": "rotate", "axis": [1, 0, 0], "pivot": piv, "keys": keys} for pid in ("head", "diffuser", "ring")]

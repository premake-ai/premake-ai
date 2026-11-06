import math
import cadquery as cq
from cadlib import fab
from cadlib.parts import part, info
from cadlib.refmodels import ref
from cadlib.motion import move

SCENE = "desk"

# --- stock -------------------------------------------------------------
T6 = fab.sheet_actual("plywood", 6)     # real "6 mm" ply
T3 = fab.sheet_actual("plywood", 3)
TA = fab.sheet_actual("acrylic", 3)
BAR_W, BAR_T, RAIL_L = 25.4, 6.35, 304.8   # 1" x 1/4" x 12" mild steel flat bar
BR_W, BR_T = 6.35, 1.63                     # 1/4" x 0.064" x 12" brass strip
PLUS_Y, GND_Y = -20.0, 28.0                 # asymmetric rails: a module turned 180 deg makes no contact

# --- base --------------------------------------------------------------
L, D, R = 360.0, 120.0, 14.0
FOOT = 4.0                                  # rubber bumpers (12.7 x 4 mm)
Z0 = FOOT + 2 * T6 + T3                     # top of base = bottom of every module
PIN_X = 8.0
PIN_DOWN = (Z0 - (FOOT + 2 * T6 + BR_T)) + 0.8   # reach the recessed rail + 0.8 preload

WOOD, DARK = "#d9b98c", "#b8925f"
PLY6 = {"material": "plywood", "thickness_mm": 6}
PLY3 = {"material": "plywood", "thickness_mm": 3}


def plate(w, h, t, r=0.0, cx=0.0, cy=0.0, z0=0.0):
    p = cq.Workplane("XY").box(w, h, t, centered=(True, True, False))
    if r > 0:
        p = p.edges("|Z").fillet(r)
    return p.translate((cx, cy, z0))


def cut_rect(p, w, h, cx, cy, r=0.0):
    return p.cut(plate(w, h, 200, r, cx, cy, -100))


def cut_holes(p, pts, dia):
    c = cq.Workplane("XY").pushPoints(pts).circle(dia / 2).extrude(200).translate((0, 0, -100))
    return p.cut(c)


def vpanel(p, x, y_front, z0):
    """Plate built in XY (height along +Y from 0, thickness z 0..t) stood up, front face at y_front."""
    bb = p.val().BoundingBox()
    return p.rotate((0, 0, 0), (1, 0, 0), 90).translate((x, y_front + bb.zlen, z0))


def module_bottom(cx, w, d, r):
    """Shared module floor: 4 pogo pins (2 per rail) + 2 magnets over the steel bar."""
    p = plate(w, d, T3, r, cx, 0, Z0)
    pins = [(cx + s * PIN_X, y) for s in (-1, 1) for y in (PLUS_Y, GND_Y)]
    p = cut_holes(p, pins, 3.0)
    a = w / 2 - 16                          # 3-4 magnets in a row over the bar, >= 13 mm apart
    n = min(4, int(2 * a // 13) + 1)
    mags = [(cx - a + i * 2 * a / (n - 1), 0) for i in range(n)]
    p = cut_holes(p, mags, 10.2)
    pin_shape = cq.Workplane("XY").pushPoints(pins).circle(1.5).extrude(10).translate((0, 0, Z0 - PIN_DOWN))
    mag_shape = cq.Workplane("XY").pushPoints(mags).circle(5).extrude(3).translate((0, 0, Z0))
    return p, pin_shape, mag_shape


def laser(name, shape, params, color=WOOD, **kw):
    d = {"name": name, "shape": shape, "process": "laser", "params": params, "color": color}
    d.update(kw)
    return d


def comp(name, shape, color, **kw):
    d = {"name": name, "shape": shape, "group": "component", "color": color}
    d.update(kw)
    return d


# --- modules: positions along the rail ---------------------------------
CH_X, CH_W, CH_D = -128.0, 86.0, 80.0
SP_X, SP_W, SP_D, SP_H = -38.0, 76.0, 80.0, 95.0
LA_X, LA_W, LA_D = 40.0, 60.0, 80.0
DI_X, DI_W, DI_D = 125.0, 104.0, 80.0


def base_parts():
    out = []
    bot = plate(L, D, T6, R, 0, 0, FOOT)
    # DC jack pocket at the back left (through bottom + middle)
    jk = info("dc_jack_pcb")   # 14 x 9 x 11 body, opening -X; rotated so it opens out of the back edge
    jx, jy, jz = jk["dims"][0], jk["dims"][1], jk["dims"][2]
    JX = -160.0
    bot = cut_rect(bot, jy + 0.6, jx + 0.6, JX, D / 2 - jx / 2 + 0.3)
    out.append(laser("Base bottom", bot, PLY6))

    mid = plate(L, D, T6, R, 0, 0, FOOT + T6)
    mid = cut_rect(mid, RAIL_L + 2, BAR_W + 0.8, 0, 0)                        # steel bar pocket
    mid = cut_rect(mid, 20, GND_Y - PLUS_Y + 12, -161, (PLUS_Y + GND_Y) / 2)  # wire channel under rail ends
    mid = cut_rect(mid, jy + 0.6, D / 2 - GND_Y + 1, JX, (GND_Y + D / 2) / 2)  # channel to the jack
    out.append(laser("Base middle", mid, PLY6))

    top = plate(L, D, T3, R, 0, 0, FOOT + 2 * T6)
    top = cut_rect(top, RAIL_L + 2, BAR_W + 1.0, 0, 0, 1.0)                  # magnet track
    for y in (PLUS_Y, GND_Y):
        top = cut_rect(top, RAIL_L + 1, BR_W + 0.3, 0, y, 1.0)              # rail slots
    out.append(laser("Base top", top, PLY3))

    bar = plate(RAIL_L, BAR_W, BAR_T, 0, 0, 0, FOOT + T6)
    out.append(comp("Steel magnet bar", bar, "#4a4d52", material="steel"))
    rails = plate(RAIL_L, BR_W, BR_T, 0, 0, PLUS_Y, FOOT + 2 * T6).union(
        plate(RAIL_L, BR_W, BR_T, 0, 0, GND_Y, FOOT + 2 * T6))
    out.append(comp("Brass power rails", rails, "#c9a43a", material="brass"))

    feet = cq.Workplane("XY").pushPoints([(sx * 160, sy * 45) for sx in (-1, 1) for sy in (-1, 1)]) \
        .circle(6).extrude(FOOT)
    out.append(comp("Rubber feet", feet, "#222222", material="rubber"))

    # jack lying in the pocket, barrel opening at the back edge (+Y)
    out.append(dict(part("dc_jack_pcb", at=(JX - 0.7, D / 2 - 7.0, FOOT), rot=(0, 0, -90)),
                    cable={"type": "dc-barrel", "at": [JX, D / 2, FOOT + 5.5], "dir": [0, 1, 0], "length_mm": 600}))
    return out


def charger_parts():
    out = []
    bot, pins, mags = module_bottom(CH_X, CH_W, CH_D, 20)
    out.append(laser("Charger floor", bot, PLY3, id="ch_floor"))
    z = Z0 + T3
    for i in (1, 2):
        ring = cut_rect(plate(CH_W, CH_D, T6, 20, CH_X, 0, z), CH_W - 16, CH_D - 16, CH_X, 0, 10)
        out.append(laser(f"Charger ring {i}", ring, PLY6, id=f"ch_ring{i}"))
        z += T6
    top = plate(CH_W, CH_D, T3, 20, CH_X, 0, z)
    out.append(laser("Charger top", top, PLY3, id="ch_top"))
    zc = z + T3
    out.append(comp("Charger pogo pins", pins, "#d4af37", id="ch_pins"))
    out.append(comp("Charger magnets", mags, "#9a9da3", id="ch_mags"))
    out.append(comp("15W Qi charger board", plate(45, 45, 4.6, 0, CH_X, 0, Z0 + T3), "#1d5e2c", id="ch_pcb"))
    coil = cq.Workplane("XY").circle(24.2).extrude(2.5).translate((CH_X, 0, z - 2.6))
    out.append(comp("Qi coil", coil, "#b5651d", id="ch_coil"))
    out.append(dict(ref("iphone_16", at=(CH_X, -73.8, zc + 5.25), rot=(-90, 0, 0)), id="ch_phone"))
    return out


def speaker_parts():
    out = []
    bot, pins, mags = module_bottom(SP_X, SP_W, SP_D, 10)
    out.append(laser("Speaker floor", bot, PLY3))
    z = Z0 + T3
    hw = SP_H - T3 - T6                       # wall height
    zc = hw * 0.55                            # driver centre above floor
    # front: grille of 4 mm holes in a hex pattern inside a 46 mm circle
    front = plate(SP_W, hw, T6, 0, 0, hw / 2)
    pts = []
    for j in range(-5, 6):
        for i in range(-5, 6):
            x, y = i * 6.0 + (3.0 if j % 2 else 0), j * 5.2
            if x * x + y * y <= 21 ** 2:
                pts.append((x, zc + y))
    front = cut_holes(front, pts, 4.0)
    out.append(laser("Speaker front", vpanel(front, SP_X, -SP_D / 2, z), PLY6))
    back = cut_holes(plate(SP_W, hw, T6, 0, 0, hw / 2), [(0, hw * 0.3)], 16.0)  # bass port
    out.append(laser("Speaker back", vpanel(back, SP_X, SP_D / 2 - T6, z), PLY6))
    for s in (-1, 1):
        side = plate(T6, SP_D - 2 * T6, hw, 0, SP_X + s * (SP_W / 2 - T6 / 2), 0, z)
        out.append(laser(f"Speaker side {'L' if s < 0 else 'R'}", side, PLY6))
    out.append(laser("Speaker top", plate(SP_W, SP_D, T6, 0, SP_X, 0, z + hw), PLY6))
    drv = cq.Workplane("XZ").rect(52, 52).extrude(-4).union(
        cq.Workplane("XZ").circle(18).extrude(-26)).translate((SP_X, -SP_D / 2 + T6, z + zc))
    out.append(comp("2in 5W speaker driver", drv, "#2b2b2b"))
    out.append(comp("Bluetooth amp board", plate(40, 25, 8, 0, SP_X, 18, z), "#1b3f8f"))
    out.append(part("mp1584", at=(SP_X - 18, -18, z)))
    out.append(comp("Speaker pogo pins", pins, "#d4af37"))
    out.append(comp("Speaker magnets", mags, "#9a9da3"))
    return out


TW, CAV = 40.0, 16.0          # lamp tower width, cavity depth
TD = T6 + CAV + TA
TH = 220.0


def lamp_parts():
    out = []
    bot, pins, mags = module_bottom(LA_X, LA_W, LA_D, 12)
    out.append(laser("Lamp floor", bot, PLY3))
    z = Z0 + T3
    ring = cut_rect(plate(LA_W, LA_D, T6, 12, LA_X, 0, z), LA_W - 14, LA_D - 14, LA_X, 0, 5)
    out.append(laser("Lamp foot ring", ring, PLY6))
    ftop = cut_rect(plate(LA_W, LA_D, T6, 12, LA_X, 0, z + T6), TW + 0.4, TD + 0.4, LA_X, 0)
    out.append(laser("Lamp foot top", ftop, PLY6))
    y0 = -TD / 2                                    # tower front (diffuser) face
    out.append(laser("Lamp diffuser", plate(TW, TA, TH, 0, LA_X, y0 + TA / 2, z),
                     {"material": "acrylic", "thickness_mm": 3}, "#f4f1ea",
                     material="acrylic_frosted", fx={"glow": {"color": "#ffd9a0"}}))
    out.append(laser("Lamp spine", plate(TW, T6, TH, 0, LA_X, TD / 2 - T6 / 2, z), PLY6))
    for s in (-1, 1):
        side = plate(T6, CAV, TH, 0, LA_X + s * (TW / 2 - T6 / 2), y0 + TA + CAV / 2, z)
        out.append(laser(f"Lamp side {'L' if s < 0 else 'R'}", side, PLY6))
    cap = cut_holes(plate(TW, TD, T6, 3, LA_X, 0, z + TH), [(LA_X, y0 + TA + CAV / 2)], 12.2)
    out.append(laser("Lamp cap", cap, PLY6))
    cob = plate(8, 2, TH - 20, 0, LA_X - 5, TD / 2 - T6 - 1, z + 10).union(
        plate(8, 2, TH - 20, 0, LA_X + 5, TD / 2 - T6 - 1, z + 10))
    out.append(comp("12V COB LED strips", cob, "#fff2d0",
                    fx={"glow": {"color": "#ffd9a0"}}))
    sw = cq.Workplane("XY").circle(6).extrude(-18).union(cq.Workplane("XY").circle(7).extrude(4)) \
        .translate((LA_X, y0 + TA + CAV / 2, z + TH + T6))
    out.append(comp("12mm latching push switch", sw, "#c0c0c0", material="steel"))
    out.append(comp("Lamp pogo pins", pins, "#d4af37"))
    out.append(comp("Lamp magnets", mags, "#9a9da3"))
    return out


A = math.radians(20)          # display lean-back angle
DH = 62.0                     # display height above floor


def display_parts():
    out = []
    bot, pins, mags = module_bottom(DI_X, DI_W, DI_D, 10)
    out.append(laser("Display floor", bot, PLY3))
    z = Z0 + T3
    yf, yb = -DI_D / 2 + 2, DI_D / 2 - 2
    yt = yf + DH * math.tan(A)
    for s in (-1, 1):
        cheek = cq.Workplane("YZ").polyline([(yf, 0), (yb, 0), (yb, DH), (yt, DH)]).close() \
            .extrude(T6).translate((DI_X + s * (DI_W / 2) - (T6 if s > 0 else 0), 0, z))
        try:
            cheek = cheek.edges("|X").fillet(3)
        except Exception:
            pass
        out.append(laser(f"Display cheek {'L' if s < 0 else 'R'}", cheek, PLY6))
    iw = DI_W - 2 * T6
    ls = (DH - T6) / math.cos(A)

    def tilt(s):
        return s.rotate((0, 0, 0), (1, 0, 0), 90 - math.degrees(A)).translate((DI_X, yf + T3 * math.cos(A), z))

    wy = ls * 0.52
    face = cut_rect(plate(iw, ls, T3, 0, 0, ls / 2), 68, 30, 0, wy, 1.0)
    out.append(laser("Display face", tilt(face), PLY3))
    epd = plate(89.5, 38, 3, 0, 0, wy, -3)
    out.append(comp("2.9in e-paper module", tilt(epd), "#e9e9e4",
                    fx={"screen": {"text": "3 new\n10:30 stand-up", "fg": "#111111", "bg": "#e9e9e4",
                                   "face": "-y"}}))
    out.append(laser("Display top", plate(iw, yb - yt - 1, T6, 0, DI_X, (yb + yt + 1) / 2, z + DH - T6), PLY6))
    back = cut_rect(plate(iw, DH - T6, T6, 0, 0, (DH - T6) / 2), 11, 6, -20, 3.5, 1.0)   # USB-C for flashing
    out.append(laser("Display back", vpanel(back, DI_X, yb - T6, z), PLY6))
    out.append(part("esp32_c3_supermini", at=(DI_X - 20, yb - T6 - 12, z), rot=(0, 0, -90)))
    out.append(part("mp1584", at=(DI_X + 20, 20, z)))
    out.append(comp("Display pogo pins", pins, "#d4af37"))
    out.append(comp("Display magnets", mags, "#9a9da3"))
    return out


def parts():
    return base_parts() + charger_parts() + speaker_parts() + lamp_parts() + display_parts()


CHARGER_IDS = ["ch_floor", "ch_ring1", "ch_ring2", "ch_top", "ch_pins", "ch_mags", "ch_pcb", "ch_coil", "ch_phone"]


def motion():
    # lift the charger off the rail and click it back on
    def pose(t):
        h = 40 * math.sin(math.pi * t) ** 2
        return {i: move((0, 0, h)) for i in CHARGER_IDS}
    return {"duration": 5, "pose": pose}


ASSEMBLY = [
    ["Base bottom", "Base middle", "Steel magnet bar"],
    ["Brass power rails", "Base top", "Rubber feet"],
    ["Charger floor", "Speaker floor", "Lamp floor", "Display floor"],
    ["Charger ring 1", "Charger ring 2", "15W Qi charger board", "Qi coil", "Charger top"],
    ["Speaker front", "Speaker back", "Speaker side L", "Speaker side R", "Speaker top"],
    ["Lamp foot ring", "Lamp foot top", "Lamp spine", "Lamp side L", "Lamp side R", "Lamp diffuser", "Lamp cap"],
    ["Display cheek L", "Display cheek R", "Display face", "Display back", "Display top"],
]

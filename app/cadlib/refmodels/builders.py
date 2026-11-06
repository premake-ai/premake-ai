"""Parametric reference models (Premake's own work, built with CadQuery from cadlib.dims sizes).

Used where no allowlisted third-party model exists (consoles, phones) or where our own model is as good. Each builder
returns a cadlib.parts.models.Model (shapes grouped by finish + colour). The role of a group can be given as
"finish:role" in the finish slot (e.g. "plastic:body"); the converter names the GLB material after it and the viewer
can tint the "body" role with the design's own colour (Joy-Con colours).

Frame (before the converter recentres it): mm, Z up. Standing products (consoles, phones, controllers) have their
front (screen / buttons) facing -Y and their width along X. Boards and parts lie flat with their components up (+Z).
No logos, brand marks or printed text anywhere: shapes and colours only.
"""
import math

import cadquery as cq

from cadlib.parts import models as pm
from cadlib.parts.models import Model, box, cyl

V = cq.Vector

GLASS_BLACK = "#0a0b0d"
SCREEN = "#171b21"
CONSOLE = "#2a2b2e"
BTN = "#1b1c1f"
RAIL = "#4a4c50"
NEON_BLUE = "#0ab9e6"
NEON_RED = "#ff3c28"


# ---------------------------------------------------------------- helpers (front plane = XZ, front faces -Y)

def _try(fn, w):
    try:
        r = fn(w)
        if r.val().isValid():
            return r
    except Exception:
        pass
    return w


def slab(w, h, d, r, cx=0.0, cz=0.0, y0=0.0):
    """Rounded rectangle (w along X, h along Z, corner radius r) extruded from y=y0 towards +Y by d."""
    s = cq.Workplane("XZ").sketch().rect(w, h)
    if r > 0:
        s = s.vertices().fillet(min(r, w / 2 - 0.01, h / 2 - 0.01))
    return s.finalize().extrude(-d).translate((cx, y0, cz))


def ycyl(d, h, cx, cz, y0):
    """Cylinder along +Y from y0."""
    return cq.Solid.makeCylinder(d / 2, h, V(cx, y0, cz), V(0, 1, 0))


def zcyl(d, h, cx, cy, z0):
    return cq.Solid.makeCylinder(d / 2, h, V(cx, cy, z0), V(0, 0, 1))


def xcyl(d, h, x0, cy, cz):
    return cq.Solid.makeCylinder(d / 2, h, V(x0, cy, cz), V(1, 0, 0))


def soft(w, sel, r):
    return _try(lambda x: x.edges(sel).fillet(r), w)


def bx(x0, x1, y0, y1, z0, z1):
    return cq.Solid.makeBox(x1 - x0, y1 - y0, z1 - z0, V(x0, y0, z0))


# ---------------------------------------------------------------- Nintendo Switch (console only, standing, screen -Y)

def _console(W, H=102.0, T=13.9, scr=(154.9, 87.1), oled=True):
    """Switch tablet without Joy-Con. Rails slots on both sides, top buttons / vent / card slot, USB-C at the bottom,
    kickstand on the back. W is the console-only width (Joy-Con rails overlap its side slots)."""
    m = Model()
    gt = 0.6  # front glass
    body = slab(W, H, T - gt, 3.0, 0, 0, -T / 2 + gt)
    body = soft(body, "|X", 1.2)
    # Joy-Con rail slots on both sides (where the controllers slide in)
    for sx in (-1, 1):
        body = body.cut(cq.Workplane().add(bx(sx * W / 2 - 2.9 if sx > 0 else -W / 2 - 0.1,
                                                sx * W / 2 + 0.1 if sx > 0 else -W / 2 + 2.9,
                                                -3.2, 3.2, -H / 2 + 6, H / 2 - 6)))
    # top edge: vent grille + game-card slot recess; bottom: USB-C opening
    vent = [bx(-W / 2 + 18 + i * 3.0, -W / 2 + 19.6 + i * 3.0, -1.6, 4.4, H / 2 - 1.2, H / 2 + 0.1) for i in range(14)]
    for v in vent:
        body = body.cut(cq.Workplane().add(v))
    body = body.cut(cq.Workplane().add(bx(W / 2 - 52, W / 2 - 26, -3.5, 3.5, H / 2 - 0.8, H / 2 + 0.1)))
    body = body.cut(cq.Workplane().add(bx(-4.6, 4.6, -1.6, 1.6, -H / 2 - 0.1, -H / 2 + 6)))
    m.add("plastic:shell", CONSOLE, body)
    # rails inside the slots (dark metal)
    for sx in (-1, 1):
        x = sx * (W / 2 - 1.6)
        m.add("metal", RAIL, bx(x - 1.0, x + 1.0, -1.4, 1.4, -H / 2 + 7, H / 2 - 7))
    # front glass and the display under it
    glass = slab(W - 1.0, H - 1.0, gt, 2.6, 0, 0, -T / 2)
    m.add("glass", GLASS_BLACK, glass)
    sw, sh = scr
    m.add("glass", SCREEN, slab(sw, sh, 0.05, 1.2, 0, 0, -T / 2 - 0.09))
    # speaker grilles (OLED: under the glass at the bottom corners show as small slots on the bottom edge)
    m.add("plastic", "#151618", [bx(sx * (W / 2 - 22) - 6, sx * (W / 2 - 22) + 6, -2.0, 2.0, -H / 2 - 0.02, -H / 2 + 0.3)
                                 for sx in (-1, 1)])
    # top buttons: power, volume -, volume +
    pw = W / 2 - 18
    m.add("plastic", "#3a3b3f", bx(-pw - 9, -pw - 2, -1.6, 1.6, H / 2 - 0.2, H / 2 + 0.45),
          bx(-pw + 1, -pw + 9, -1.6, 1.6, H / 2 - 0.2, H / 2 + 0.45))
    m.add("plastic", "#3a3b3f", bx(-W / 2 + 6.5, -W / 2 + 12.5, -1.6, 1.6, H / 2 - 0.2, H / 2 + 0.45))
    # game-card flap, headphone jack
    m.add("plastic", "#202124", bx(W / 2 - 51.5, W / 2 - 26.5, -3.0, 3.0, H / 2 - 0.5, H / 2 - 0.1))
    m.add("plastic", "#0c0c0d", zcyl(3.6, 0.06, W / 2 - 15, 0, H / 2 - 0.03))
    # USB-C port insert
    m.add("plastic", "#0c0c0d", bx(-3.6, 3.6, -1.0, 1.0, -H / 2 + 0.6, -H / 2 + 5.5))
    # back: kickstand (OLED: full-width adjustable stand) and back vents
    if oled:
        ks = slab(W - 30, 34, 0.5, 2.0, 0, -H / 2 + 22, T / 2 - 0.45)
    else:
        ks = slab(16, 40, 0.5, 2.0, W / 2 - 22, -H / 2 + 24, T / 2 - 0.45)
    m.add("plastic", "#232427", ks)
    m.add("plastic", "#141517", [bx(-W / 2 + 26 + i * 4.2, -W / 2 + 28 + i * 4.2, T / 2 - 0.42, T / 2 + 0.02, H / 2 - 22, H / 2 - 8)
                                 for i in range(8)])
    return m


def switch_oled():
    """Nintendo Switch OLED console (HEG-001) without Joy-Con: 176 x 102 x 13.9 (242 wide with Joy-Con,
    i.e. 2 x 35.9 Joy-Con minus 2 x 2.9 mm of rail overlap). 7.0" OLED, 16:9."""
    return _console(176.0, oled=True)


def switch_v1():
    """Nintendo Switch original (HAC-001) console without Joy-Con: 173 x 102 x 13.9 (239 with Joy-Con). 6.2" LCD."""
    return _console(173.0, scr=(137.2, 77.2), oled=False)


def _joycon(side="L", color=NEON_BLUE):
    """One Joy-Con standing, buttons facing -Y. 35.9 wide incl. the 2.9 mm rail, 102 tall, 28.4 deep incl. stick + ZL/ZR.
    Body 13.9 deep; the rail is on the inner side (+X for L, -X for R)."""
    m = Model()
    W, H, T, rail = 35.9, 102.0, 13.9, 2.9
    bw = W - rail
    s = 1 if side == "L" else -1          # inner (rail) side direction
    cx = -s * rail / 2                    # body centre x (body shifted away from the rail)
    # outline: big radius on the outer corners, tight on the rail side
    R = 15.0
    prof = (cq.Workplane("XZ").sketch().rect(bw, H).vertices(">X" if s < 0 else "<X").fillet(R).finalize())
    body = prof.extrude(-T).translate((cx, -T / 2, 0))
    body = _try(lambda w: w.faces("<Y or >Y").edges().fillet(2.4), body)
    m.add("plastic:body", color, body)
    # rail with SL / SR buttons
    rx = s * (W / 2 - rail / 2)
    m.add("metal", RAIL, bx(rx - rail / 2, rx + rail / 2, -2.2, 2.2, -H / 2 + 8, H / 2 - 8))
    m.add("plastic", BTN, bx(rx - rail / 2 - 0.2, rx + rail / 2 + 0.2, -1.4, 1.4, 14, 30),
          bx(rx - rail / 2 - 0.2, rx + rail / 2 + 0.2, -1.4, 1.4, -30, -14))
    yf = -T / 2                           # front face
    stick_z, pad_z = (20.0, -12.0) if side == "L" else (-12.0, 20.0)
    sx = cx - s * 0.5
    # analogue stick: dark well, base dome, shaft and a cap with a raised rim
    m.add("plastic", BTN, ycyl(19.0, 0.6, sx, stick_z, yf - 0.3))
    dome = cq.Solid.makeSphere(7.0, V(sx, yf + 2.0, stick_z), angleDegrees1=0, angleDegrees2=90)
    dome = dome.rotate(V(sx, yf + 2.0, stick_z), V(1, 0, 0), 90)
    m.add("plastic", BTN, dome)
    m.add("plastic", BTN, ycyl(5.5, 3.0, sx, stick_z, yf - 5.0))
    cf = yf - 7.25                        # cap front: 7.25 in front of the body (28.4 total with ZL/ZR)
    cap = cq.Workplane().add(ycyl(14.4, 2.6, sx, stick_z, cf))
    cap = cap.cut(cq.Workplane().add(ycyl(11.6, 0.7, sx, stick_z, cf - 0.01)))
    m.add("rubber", "#202124", cap)
    # face buttons: 4 round buttons in a diamond (arrows on L, A/B/X/Y on R), no printed letters
    sp = 8.6
    pts = [(0, sp), (0, -sp), (sp, 0), (-sp, 0)]
    m.add("plastic", BTN, [ycyl(6.4, 1.6, sx + px, pad_z + pz, yf - 1.4) for px, pz in pts])
    m.add("plastic", "#2b2c30", [ycyl(4.2, 0.1, sx + px, pad_z + pz, yf - 1.45) for px, pz in pts])
    # minus / plus near the top inner corner
    ix = cx + s * (bw / 2 - 7.0)
    if side == "L":
        m.add("plastic", BTN, bx(ix - 3.0, ix + 3.0, yf - 1.0, yf + 0.5, H / 2 - 9.4, H / 2 - 8.0))
        # capture button: square, lower area
        m.add("plastic", BTN, bx(sx + 4.5, sx + 9.5, yf - 1.0, yf + 0.5, -H / 2 + 14, -H / 2 + 19))
        m.add("plastic", "#2b2c30", ycyl(3.2, 0.1, sx + 7.0, -H / 2 + 16.5, yf - 1.05))
    else:
        m.add("plastic", BTN, bx(ix - 3.0, ix + 3.0, yf - 1.0, yf + 0.5, H / 2 - 9.4, H / 2 - 8.0),
              bx(ix - 0.7, ix + 0.7, yf - 1.0, yf + 0.5, H / 2 - 11.7, H / 2 - 5.7))
        # home button: round with a light ring
        m.add("plastic", "#b9bcc2", ycyl(8.0, 0.8, sx - 7.0, -H / 2 + 16.5, yf - 0.6))
        m.add("plastic", BTN, ycyl(6.4, 1.2, sx - 7.0, -H / 2 + 16.5, yf - 1.0))
    # player LEDs on the rail face
    m.add("glass", "#4bd16f", [bx(rx - 0.8, rx + 0.8, -2.25, -2.15, 34 + i * 3.2, 35.6 + i * 3.2) for i in range(4)])
    # shoulder L/R on top, trigger ZL/ZR sticking out at the back top
    top = H / 2
    m.add("plastic", BTN, bx(cx - bw / 2 + 4, cx + bw / 2 - 2, -T / 2 + 1.0, 1.0, top - 6.0, top + 0.3))
    trig = slab(bw - 8, 20, 7.25 + 2.0, 6.0, cx - s * 1.0, top - 12.0, T / 2 - 2.0)
    trig = soft(trig, ">Y", 2.0)
    m.add("plastic", BTN, trig)
    return m


def joycon_l(color=NEON_BLUE):
    return _joycon("L", color)


def joycon_r(color=NEON_RED):
    return _joycon("R", color)


def switch_oled_full():
    """Switch OLED with both Joy-Con attached: 242 x 102 x 28.4."""
    m = switch_oled()
    for side, col, sx in (("L", NEON_BLUE, -1), ("R", NEON_RED, 1)):
        j = _joycon(side, col)
        dx = sx * (176.0 / 2 + 35.9 / 2 - 2.9)
        for f, c, shapes in j.groups:
            m.add(f, c, [sh.translate(V(dx, 0, 0)) for sh in shapes])
    return m


# ---------------------------------------------------------------- phones (standing, screen -Y)

def _phone(W, H, T, r, cams, frame="#3b3c40", back="#2d2f33", island=True, punch=False, flat=False,
           bump=None, lens_d=11.5):
    m = Model()
    gt = 0.7
    frm = slab(W, H, T - 2 * gt, r, 0, 0, -T / 2 + gt)
    if not flat:
        frm = soft(frm, ">Y or <Y", 0.9)
    m.add("metal", frame, frm)
    front = slab(W - 0.5, H - 0.5, gt, r - 0.25, 0, 0, -T / 2)
    front = soft(front, "<Y", 0.5)
    m.add("glass", GLASS_BLACK, front)
    m.add("glass", SCREEN, slab(W - 4.6, H - 4.6, 0.04, r - 2.0, 0, 0, -T / 2 - 0.06))
    if island:
        m.add("glass", "#020203", slab(18.5, 5.6, 0.05, 2.8, 0, H / 2 - 9.5, -T / 2 - 0.12))
    if punch:
        m.add("glass", "#020203", ycyl(3.4, 0.05, 0, H / 2 - 7.5, -T / 2 - 0.12))
    bk = slab(W - 0.5, H - 0.5, gt, r - 0.25, 0, 0, T / 2 - gt)
    bk = soft(bk, ">Y", 0.5)
    m.add("glass", back, bk)
    # camera bump + lenses
    if bump:
        bw, bh, br, bxc, bzc = bump
        b = slab(bw, bh, 1.5, br, bxc, bzc, T / 2 - 0.05)
        b = soft(b, ">Y", 0.6)
        m.add("glass", back, b)
    for (lx, lz) in cams:
        y0 = T / 2 + (1.45 if bump else 0)
        m.add("metal", frame, ycyl(lens_d, 1.1, lx, lz, y0 - 0.05))
        m.add("glass", "#07080a", ycyl(lens_d - 2.4, 0.1, lx, lz, y0 + 1.0))
        m.add("glass", "#1a2433", ycyl(lens_d * 0.38, 0.06, lx, lz, y0 + 1.06))
    # side buttons: power on +X, volume on -X
    m.add("metal", frame, bx(W / 2 - 0.2, W / 2 + 0.35, -1.4, 1.4, H / 2 - 52, H / 2 - 33))
    m.add("metal", frame, bx(-W / 2 - 0.35, -W / 2 + 0.2, -1.4, 1.4, H / 2 - 44, H / 2 - 33),
          bx(-W / 2 - 0.35, -W / 2 + 0.2, -1.4, 1.4, H / 2 - 57, H / 2 - 46),
          bx(-W / 2 - 0.35, -W / 2 + 0.2, -1.2, 1.2, H / 2 - 28, H / 2 - 22))
    # bottom: USB-C + speaker holes
    m.add("plastic", "#0c0c0d", bx(-4.3, 4.3, -1.6, 1.6, -H / 2 - 0.02, -H / 2 + 0.3))
    m.add("plastic", "#0c0c0d", [bx(x - 0.6, x + 0.6, -0.6, 0.6, -H / 2 - 0.02, -H / 2 + 0.2)
                                 for x in [-16 - 2.2 * i for i in range(5)] + [16 + 2.2 * i for i in range(5)]])
    return m


def iphone_15():
    """iPhone 15 size (147.6 x 71.6 x 7.8, Apple tech specs): diagonal dual camera in a square bump, Dynamic Island."""
    W, H, T = 71.6, 147.6, 7.8
    bxc, bzc = W / 2 - 17.0, H / 2 - 17.0
    return _phone(W, H, T, 9.6, [(bxc + 3.6, bzc + 3.6), (bxc - 3.6, bzc - 3.6)], frame="#2f3134", back="#34373b",
                  bump=(27.0, 27.0, 7.0, bxc, bzc), lens_d=10.5)


def iphone_16():
    """iPhone 16 size (147.6 x 71.6 x 7.8, Apple tech specs): vertical dual camera in a pill bump."""
    W, H, T = 71.6, 147.6, 7.8
    bxc, bzc = W / 2 - 13.0, H / 2 - 20.5
    return _phone(W, H, T, 9.6, [(bxc, bzc + 6.3), (bxc, bzc - 6.3)], frame="#2c3a4a", back="#33435a",
                  bump=(15.5, 29.0, 7.6, bxc, bzc), lens_d=10.5)


def android_phone():
    """Generic flagship Android phone at Galaxy S25 size (146.9 x 70.5 x 7.2, Samsung specs): flat frame,
    punch-hole selfie camera, three separate rear lenses."""
    W, H, T = 70.5, 146.9, 7.2
    x = W / 2 - 11.5
    return _phone(W, H, T, 8.0, [(x, H / 2 - 13), (x, H / 2 - 26), (x, H / 2 - 39)], frame="#2a2c30", back="#24262a",
                  island=False, punch=True, flat=True, bump=None, lens_d=10.0)


# ---------------------------------------------------------------- electronics (lying flat, components up)

def esp32_c3_supermini():
    """ESP32-C3 SuperMini: 22.5 x 18 x 1.0 PCB (black), USB-C at -X, ceramic chip antenna at +X, ESP32-C3 QFN32 5x5,
    40 MHz crystal, LDO, BOOT + RESET buttons, power + status LEDs, 2 x 8 castellated pins on 15.24 mm rows."""
    m = Model()
    L, Wd, t = 22.5, 18.0, 1.0
    p = cq.Workplane("XY").box(L, Wd, t, centered=(True, True, False))
    p = soft(p, "|Z", 0.8)
    holes = [(-L / 2 + 2.05 + i * 2.54, sy * 7.62) for i in range(8) for sy in (-1, 1)]
    p = p.pushPoints(holes).hole(0.9)
    m.add("pcb", "#17181c", p)
    m.add("gold", pm.GOLD, [pm.pad_ring(1.6, 0.9, x, y, t) for x, y in holes])
    m.add("gold", pm.GOLD, [pm.pad_ring(1.6, 0.9, x, y, -0.04) for x, y in holes])
    # USB-C receptacle (overhangs the -X edge by 1 mm)
    pm.usb_c(m, -L / 2, 0, t, depth=7.35, overhang=1.0)
    # ESP32-C3 QFN (5 x 5, tin pads on the sides)
    m.add("plastic", "#141414", box(5.0, 5.0, 0.85, 2.0, 0, t))
    m.add("metal", pm.TIN, [box(0.25, 0.5, 0.2, 2.0 - 2.25 + i * 0.5, sy * 2.55, t) for i in range(10) for sy in (-1, 1)])
    m.add("metal", pm.TIN, [box(0.5, 0.25, 0.2, 2.0 + sx * 2.55, -2.25 + i * 0.5, t) for i in range(10) for sx in (-1, 1)])
    # 40 MHz crystal (3.2 x 2.5 metal can) and LDO (SOT-23-5)
    m.add("metal", "#b4b8be", box(3.2, 2.5, 0.8, 6.6, 4.6, t))
    pm.chip(m, 2.9, 1.6, 1.0, -3.0, -5.3, t, legs=3)
    # ceramic chip antenna at the far end (light grey-white body, silver ends)
    m.add("plastic", "#e8e4da", box(3.2, 1.6, 1.1, L / 2 - 2.0, -1.0, t))
    m.add("metal", pm.TIN, box(0.5, 1.6, 1.12, L / 2 - 3.35, -1.0, t), box(0.5, 1.6, 1.12, L / 2 - 0.65, -1.0, t))
    # BOOT + RESET buttons next to the USB-C
    for y in (4.6, -4.6 + 1.6):
        pm.tact_smd(m, -3.6, y, t, x=3.0, y=2.4)
    # LEDs: red power + blue status
    pm.led(m, 5.4, -5.4, t, "#e8483d")
    pm.led(m, 8.2, -5.4, t, "#3a7bf0")
    for x, y in ((6.0, 2.4), (-0.8, 4.4), (-0.8, -4.0), (5.0, -3.0), (8.6, 1.4), (-6.8, -5.2)):
        pm.smd(m, x, y, t, x=1.0, y=0.5, h=0.35, color="#3b3c40" if x > 0 else pm.TAN)
    return m


def ws2812b_strip(n=1, per_m=60):
    """One repeating unit of a WS2812B strip at 60 LEDs/m (16.67 mm pitch): white 10 mm tape, 5050 LED with a round
    lens and the die visible, the 100 nF capacitor, copper cut pads at the unit's start. The viewer tiles it."""
    m = Model()
    pitch = 1000.0 / per_m
    L = pitch * n
    m.add("plastic", "#ebe8de", box(L, 10.0, 0.25, L / 2, 0, 0))
    m.add("metal", "#c98a5a", box(L, 10.0, 0.05, L / 2, 0, -0.05))  # copper side (back)
    for i in range(n):
        x = pitch / 2 + i * pitch
        led = cq.Workplane("XY").box(5.0, 5.0, 1.6, centered=(True, True, False))
        led = soft(led, "|Z", 0.25).translate((x, 0, 0.25))
        m.add("plastic", "#fbf9ee", led)                                       # (web/effects.js lights #f?f?e? bodies)
        m.add("plastic", "#cfcabd", zcyl(4.6, 0.04, x, 0, 1.85))
        m.add("glass", "#f1d77e", zcyl(4.0, 0.06, x, 0, 1.87))
        m.add("plastic", "#2b2c30", box(1.6, 1.0, 0.03, x + 0.2, 0.6, 1.93))      # driver die
        m.add("plastic", "#e04848", box(0.5, 0.5, 0.03, x - 1.0, -0.7, 1.93))
        m.add("plastic", "#46c06a", box(0.5, 0.5, 0.03, x - 0.3, -0.7, 1.93))
        m.add("plastic", "#4a7be8", box(0.5, 0.5, 0.03, x + 0.4, -0.7, 1.93))
        m.add("metal", pm.TIN, [box(1.2, 1.0, 0.6, x + sx * 3.1, sy * 1.6, 0.25) for sx in (-1, 1) for sy in (-1, 1)])
        # 0603 cap
        pm.smd(m, x + 5.6, 2.8, 0.25, x=1.6, y=0.8, h=0.6, color=pm.TAN)
        # copper cut pads (+5V, Din, GND) at the unit boundary
        x0 = i * pitch
        m.add("gold", "#c47a4c", [box(1.6, 2.2, 0.04, x0 + 0.85, y, 0.25) for y in (-3.2, 0.0, 3.2)])
        m.add("plastic", "#d8d6cf", box(0.12, 9.6, 0.02, x0 + 0.06, 0, 0.25))     # cut line
        # thin traces
        m.add("gold", "#c47a4c", box(pitch - 3.4, 0.4, 0.02, x0 + pitch / 2 + 0.85, 4.3, 0.25),
              box(pitch - 3.4, 0.4, 0.02, x0 + pitch / 2 + 0.85, -4.3, 0.25))
    return m


def fan(size=120, thick=25):
    """Axial case fan, bottom on z=0, airflow +Z. Hole spacing from cadlib.dims (120: 105, 80: 71.5, 40: 32)."""
    m = Model()
    s, h = float(size), float(thick)
    hs = {120: 105.0, 80: 71.5, 40: 32.0, 92: 82.5, 140: 124.5, 60: 50.0}.get(int(s), s * 0.8)
    hd = 4.4 if s >= 80 else 3.4
    rd = s / 2 - max(1.0, s * 0.02)
    fr = cq.Workplane("XY").box(s, s, h, centered=(True, True, False))
    fr = soft(fr, "|Z", s * 0.05)
    fr = fr.cut(cq.Workplane("XY").circle(rd).extrude(h))
    fr = fr.cut(cq.Workplane("XY").pushPoints([(x, y) for x in (-hs / 2, hs / 2) for y in (-hs / 2, hs / 2)]).circle(hd / 2).extrude(h))
    fl = max(2.0, h * 0.14)
    for ang in (0, 90, 180, 270):
        cut = cq.Workplane("XY").box(s * 0.7, s * 0.06, h - 2 * fl, centered=(True, True, False)).translate((0, s / 2 - s * 0.015, fl))
        fr = fr.cut(cut.rotate((0, 0, 0), (0, 0, 1), ang))
    m.add("plastic:body", "#1d1e21", fr)
    hub = s * 0.38
    m.add("plastic", "#1d1e21", zcyl(hub, h - 1.5, 0, 0, 0.5))
    m.add("plastic", "#d7d2c6", zcyl(hub * 0.72, 0.06, 0, 0, h - 1.0))   # blank hub sticker (no text)
    m.add("plastic", "#1d1e21", [box(s / 2 - 1.0, s * 0.03, s * 0.03, (s / 2 - 1.0) / 2, 0, 0)
                                 .rotate(V(0, 0, 0), V(0, 0, 1), 45 + 90 * i) for i in range(4)])
    blades = []
    nb = 7 if s < 100 else 9
    rb = rd - hub / 2 - 0.5
    for i in range(nb):
        b = box(rb, s * 0.17, max(0.8, s * 0.008), hub / 2 + rb / 2, 0, -0.4)
        b = b.rotate(V(0, 0, 0), V(1, 0, 0), 34).translate(V(0, 0, h / 2))
        blades.append(b.rotate(V(0, 0, 0), V(0, 0, 1), i * 360 / nb))
    m.add("plastic", "#2a2b2f", blades)
    m.add("plastic", "#1d1e21", box(2.0, 14.0, 2.0, s / 2 - 4.0, s / 2 + 6.0, h - 4.0))   # cable
    return m


def fan_120():
    return fan(120, 25)


def fan_80():
    return fan(80, 25)


def rpi_4():
    """Raspberry Pi 4 Model B: 85 x 56 PCB (holes 58 x 49), GPIO 2x20 along the top long edge, USB-C + 2 micro-HDMI +
    audio on the bottom edge, Ethernet + 2 x dual USB-A on the right edge (positions from the official drawing)."""
    m = Model()
    L, Wd, t = 85.0, 56.0, 1.4
    holes = [(3.5, 3.5), (61.5, 3.5), (3.5, 52.5), (61.5, 52.5)]
    p = cq.Workplane("XY").box(L, Wd, t, centered=False)
    p = soft(p, "|Z", 3.0)
    p = p.pushPoints(holes).hole(2.7)
    m.add("pcb", "#1f6a3c", p)
    m.add("gold", pm.GOLD, [pm.pad_ring(6.0, 2.7, x, y, t) for x, y in holes])
    # GPIO header (2x20) along the top edge
    hx, hy = 3.5 + 29.0, 52.5
    m.add("plastic", pm.BLACK, box(51.0, 5.0, 2.5, hx, hy, t))
    m.add("gold", pm.GOLD, [box(0.64, 0.64, 6.0, hx - 24.13 + i * 2.54, hy + sy * 1.27, t + 2.5)
                            for i in range(20) for sy in (-1, 1)])
    # SoC with metal lid, RAM, USB controller, PoE header
    m.add("metal", "#b9bec5", box(15.0, 15.0, 1.6, 29.0, 32.0, t))
    m.add("plastic", "#141414", box(15.0, 11.0, 1.0, 45.0, 32.0, t))
    m.add("plastic", "#141414", box(6.0, 6.0, 0.9, 58.0, 26.0, t))
    m.add("plastic", pm.BLACK, box(5.0, 5.0, 2.5, 66.0, 46.5, t))
    # bottom edge: USB-C power, 2 x micro-HDMI, audio jack
    m.add("metal", pm.STEEL, box(9.0, 7.5, 3.2, 11.2, 3.2, t))
    m.add("metal", pm.STEEL, box(7.0, 7.5, 3.0, 26.0, 3.2, t), box(7.0, 7.5, 3.0, 39.5, 3.2, t))
    m.add("plastic", pm.BLACK, box(7.0, 12.0, 5.5, 53.5, 5.5, t))
    m.add("plastic", pm.BLACK, zcyl(6.0, 0.3, 53.5, 0.1, t + 2.5).rotate(V(53.5, 0.1, t + 2.5), V(1, 0, 0), 90))
    # right edge: Ethernet (top) and two dual USB-A stacks
    m.add("metal", pm.STEEL, box(21.0, 16.0, 13.5, L - 10.5 + 2.0, 45.75, t))
    m.add("plastic", pm.BLACK, box(0.2, 12.0, 8.0, L + 2.0 + 0.1, 45.75, t + 2.5))
    for yc in (9.0, 27.0):
        m.add("metal", pm.STEEL, box(17.5, 13.5, 16.0, L - 8.75 + 2.0, yc, t))
        m.add("plastic", "#1f5fbf" if yc == 9.0 else pm.BLACK, box(0.2, 11.0, 2.0, L + 2.0 + 0.1, yc, t + 4.0),
              box(0.2, 11.0, 2.0, L + 2.0 + 0.1, yc, t + 11.0))
    # camera / display flex connectors
    m.add("plastic", "#e8e4da", box(2.5, 22.0, 5.5, 45.0, 11.5, t), box(22.0, 2.5, 5.5, 33.0, 46.0, t))
    for x, y in ((20, 20), (22, 40), (52, 42), (70, 38), (14, 30), (36, 20)):
        pm.smd(m, x, y, t, color="#3b3c40")
    return m


def byj48():
    """28BYJ-48 5 V geared stepper: 28 mm can, 19 mm tall, flange with 2 x 4.2 holes 35 mm apart, 5 mm double-flat shaft
    offset 8 mm, blue wiring cover, 5 wires."""
    m = Model()
    can = cq.Workplane("XY").circle(14.0).extrude(19.0)
    can = soft(can, ">Z", 0.8)
    m.add("metal", "#c3c7cc", can)
    fl = (cq.Workplane("XY").rect(35.0, 7.0).extrude(0.8)
          .union(cq.Workplane("XY").pushPoints([(-17.5, 0), (17.5, 0)]).circle(3.5).extrude(0.8))
          .pushPoints([(-17.5, 0), (17.5, 0)]).hole(4.2))
    m.add("metal", "#c3c7cc", fl.translate((0, 0, 18.2)))
    m.add("metal", "#c3c7cc", zcyl(9.0, 1.5, 0, 8.0, 19.0))
    sh = cq.Workplane("XY").circle(2.5).extrude(10.0)
    sh = sh.cut(cq.Workplane("XY").box(6, 6, 6, centered=(True, True, False)).translate((0, 3.0 + 1.5, 4.0)))
    sh = sh.cut(cq.Workplane("XY").box(6, 6, 6, centered=(True, True, False)).translate((0, -3.0 - 1.5, 4.0)))
    m.add("metal", "#d9cfa4", sh.translate((0, 8.0, 20.5)))
    cover = cq.Workplane("XY").box(14.6, 6.0, 16.0, centered=(True, False, False)).translate((0, -14.0 - 3.0, 1.0))
    m.add("plastic", "#2c5fbf", soft(cover, "|Z", 1.0))
    for i, c in enumerate(("#2c5fbf", "#e8a7c0", "#f2c94c", "#f08a1c", "#d23b2e")):
        m.add("plastic", c, box(1.2, 18.0, 1.2, -4.8 + i * 2.4, -17.0 - 9.0, 3.0))
    return m


def _lib(name, **kw):
    def build():
        return getattr(pm, name)(**kw)
    return build


# key -> builder. Library-derived entries reuse cadlib.parts models (also Premake's own work).
BUILDERS = {
    "switch_oled": switch_oled,
    "switch_v1": switch_v1,
    "switch_oled_full": switch_oled_full,
    "joycon_l": joycon_l,
    "joycon_r": joycon_r,
    "iphone_15": iphone_15,
    "iphone_16": iphone_16,
    "android_phone": android_phone,
    "esp32_c3_supermini": esp32_c3_supermini,
    "ws2812b_strip": ws2812b_strip,
    "fan_120": fan_120,
    "fan_80": fan_80,
    "rpi_4": rpi_4,
    "byj48": byj48,
    "esp32_devkitc": _lib("esp32_devkitc", variant="v4"),
    "arduino_nano": _lib("arduino_nano", headers=True),
    "rpi_pico": _lib("rpi_pico", headers=True),
    "nema17": _lib("nema17", length=48),
    "oled_096": _lib("oled_096"),
    "usbc_breakout": _lib("usbc_breakout"),
}

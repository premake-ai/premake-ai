"""Detailed CadQuery models of common bought parts (see catalog.py for names, prices and origins).

Every builder returns a Model: shapes grouped by (finish, colour). Sub-parts never need to be unioned (each group is
exported as one mesh), so most geometry is plain primitives placed side by side, which keeps a cold build fast.
Finishes: "pcb", "metal", "gold", "plastic", "rubber", "glass" (the viewer maps each to a PBR look).
Units mm, Z up. Conventions are listed per part in catalog.py.
"""
import math

import cadquery as cq

V = cq.Vector

# colours
GOLD = "#d4ad4c"
TIN = "#c4c7cb"
STEEL = "#c9cdd2"
ALU = "#c7ccd2"
BLACK_OXIDE = "#2b2d31"
BRASS = "#c8a04a"
COPPER = "#c47a4c"
BLACK = "#1c1d20"
DARK = "#2a2c30"
WHITE = "#ecebe6"
IVORY = "#efe9da"
TAN = "#b48a5c"
PCB_GREEN = "#1d5e3b"
PCB_BLUE = "#1a3a6b"
PCB_BLACK = "#1d1f24"
PCB_PURPLE = "#2f2547"
PCB_RED = "#8e1f24"
SERVO_BLUE = "#2c5fbf"
RELAY_BLUE = "#1f4fb4"
TERM_BLUE = "#2a6ad0"


class Model:
    """Shapes grouped by (finish, colour). add() accepts cq.Shape, cq.Workplane or (nested) lists of them."""

    def __init__(self):
        self.groups = []  # [finish, colour, [cq.Shape]]

    def add(self, finish, color, *objs):
        shapes = []

        def walk(o):
            if o is None:
                return
            if isinstance(o, (list, tuple)):
                for x in o:
                    walk(x)
            elif isinstance(o, cq.Workplane):
                shapes.extend(v for v in o.vals() if isinstance(v, cq.Shape))
            elif isinstance(o, cq.Shape):
                shapes.append(o)
            else:
                raise TypeError(f"Model.add: unsupported {type(o).__name__}")

        walk(objs)
        for g in self.groups:
            if g[0] == finish and g[1] == color:
                g[2].extend(shapes)
                return self
        self.groups.append([finish, color, shapes])
        return self

    def compounds(self):
        return [(f, c, cq.Compound.makeCompound(s)) for f, c, s in self.groups if s]


# ---------------------------------------------------------------- primitives (cq.Shape, no booleans)

def box(x, y, z, cx=0.0, cy=0.0, z0=0.0):
    """Axis-aligned box centred on (cx, cy), bottom at z0."""
    return cq.Solid.makeBox(x, y, z, V(cx - x / 2, cy - y / 2, z0))


def cyl(d, h, cx=0.0, cy=0.0, z0=0.0, axis=(0, 0, 1)):
    """Cylinder of diameter d, height h, base centre at (cx, cy, z0), along axis."""
    return cq.Solid.makeCylinder(d / 2, h, V(cx, cy, z0), V(*axis))


def ring(od, idia, h, cx=0.0, cy=0.0, z0=0.0):
    return cq.Workplane("XY").circle(od / 2).circle(idia / 2).extrude(h).translate((cx, cy, z0)).val()


_PAD = {}


def pad_ring(od, idia, cx, cy, z0, h=0.04):
    """Small plated ring as an octagon (a round pad tessellates into hundreds of triangles for no visible gain)."""
    k = (round(od, 3), round(idia, 3), round(h, 3))
    if k not in _PAD:
        _PAD[k] = cq.Workplane("XY").polygon(8, od / math.cos(math.pi / 8)).polygon(8, idia).extrude(h).val()
    return _PAD[k].translate(V(cx, cy, z0))


def hexagon(af, h, cx=0.0, cy=0.0, z0=0.0, hole=0.0):
    """Hex prism, across-flats af, flats parallel to X."""
    w = cq.Workplane("XY").polygon(6, af / math.cos(math.radians(30))).extrude(h)
    if hole:
        w = w.faces(">Z").workplane().hole(hole)
    return w.translate((cx, cy, z0)).val()


def rbox(x, y, z, r, cx=0.0, cy=0.0, z0=0.0):
    """Box with rounded vertical edges."""
    w = cq.Workplane("XY").box(x, y, z, centered=(True, True, False))
    if r > 0:
        try:
            w = w.edges("|Z").fillet(min(r, x / 2 - 0.01, y / 2 - 0.01))
        except Exception:
            pass
    return w.translate((cx, cy, z0)).val()


def slot_x(length_y, height_z, depth_x, x0, cy=0.0, cz=0.0):
    """Stadium (rounded-end) prism: width along Y, height along Z, extruded along +X from x0. USB-C shells."""
    w = cq.Workplane("YZ").slot2D(length_y, height_z).extrude(depth_x)
    return w.translate((x0, cy, cz)).val()


def pcb(m, x, y, t=1.6, color=PCB_GREEN, holes=(), r=0.6):
    """Board with bottom at z=0, centred. holes = [(x, y, d)] get gold plated rings."""
    w = cq.Workplane("XY").box(x, y, t, centered=(True, True, False))
    if r > 0:
        try:
            w = w.edges("|Z").fillet(r)
        except Exception:
            pass
    if holes:
        w = w.pushPoints([(hx, hy) for hx, hy, _ in holes]).hole(holes[0][2])
        for hx, hy, hd in holes:
            m.add("gold", GOLD, pad_ring(hd + 1.6, hd, hx, hy, t), pad_ring(hd + 1.6, hd, hx, hy, -0.04))
    m.add("pcb", color, w)
    return t


def header(m, n, pitch, cx, cy, top, along="x", down=True, base=2.5, pin_out=6.0, rows=1, row_pitch=2.54, body=BLACK):
    """Male pin header(s), pins on `pitch` centred at (cx, cy). down=True: plastic under the board (top = board top,
    board bottom = top - board thickness is assumed at z=0 for boards), pins sticking out below."""
    pts = []
    for r in range(rows):
        for i in range(n):
            off = (i - (n - 1) / 2) * pitch
            roff = (r - (rows - 1) / 2) * row_pitch
            pts.append((cx + off, cy + roff) if along == "x" else (cx + roff, cy + off))
    lx = n * pitch if along == "x" else rows * row_pitch
    ly = rows * row_pitch if along == "x" else n * pitch
    pins = []
    if down:
        m.add("plastic", body, box(lx, ly, base, cx, cy, -base))
        for px, py in pts:
            pins.append(box(0.64, 0.64, base + pin_out + top + 0.8, px, py, -base - pin_out))
    else:
        m.add("plastic", body, box(lx, ly, base, cx, cy, top))
        for px, py in pts:
            pins.append(box(0.64, 0.64, base + pin_out + 1.2, px, py, top - 1.2 + 0.0))
    m.add("gold", GOLD, pins)


def pads(m, pts, top, d=1.6, hole=0.9):
    """Plated through-holes / castellations (gold rings on top)."""
    m.add("gold", GOLD, [pad_ring(d, hole, x, y, top) for x, y in pts])


def chip(m, x, y, h, cx, cy, z0, color=BLACK, rot=0.0, legs=0, leg_side="y"):
    """IC package; legs = gull-wing pins per side (tin)."""
    b = box(x, y, h, 0, 0, z0 + 0.15 if legs else z0)
    parts_ = [b]
    pins = []
    if legs:
        pitch = (x if leg_side == "y" else y) / (legs + 0.6)
        for i in range(legs):
            o = (i - (legs - 1) / 2) * pitch
            for s in (-1, 1):
                if leg_side == "y":
                    pins.append(box(pitch * 0.45, 1.0, 0.2, o, s * (y / 2 + 0.35), z0))
                else:
                    pins.append(box(1.0, pitch * 0.45, 0.2, s * (x / 2 + 0.35), o, z0))
    if rot:
        parts_ = [p.rotate(V(0, 0, 0), V(0, 0, 1), rot) for p in parts_]
        pins = [p.rotate(V(0, 0, 0), V(0, 0, 1), rot) for p in pins]
    m.add("plastic", color, [p.translate(V(cx, cy, 0)) for p in parts_])
    if pins:
        m.add("metal", TIN, [p.translate(V(cx, cy, 0)) for p in pins])


def smd(m, cx, cy, z0, x=1.6, y=0.8, h=0.5, color=TAN):
    """0603/0805 passive: body + tinned ends."""
    m.add("plastic", color, box(x * 0.6, y, h, cx, cy, z0))
    m.add("metal", TIN, [box(x * 0.2, y, h, cx - x * 0.4, cy, z0), box(x * 0.2, y, h, cx + x * 0.4, cy, z0)])


def usb_c(m, x_edge, cy, z0, depth=7.35, overhang=0.8):
    """USB-C receptacle, opening facing -X at x_edge - overhang, sitting on z0."""
    x0 = x_edge - overhang
    shell = slot_x(8.94, 3.26, depth, x0, cy, z0 + 1.63)
    inner = slot_x(8.34, 2.56, depth - 1.0, x0 - 0.01, cy, z0 + 1.63)
    m.add("metal", STEEL, shell.cut(inner))
    m.add("plastic", BLACK, box(depth - 1.5, 6.6, 0.7, x0 + (depth - 1.0) / 2 + 0.5, cy, z0 + 1.28))


def micro_usb(m, x_edge, cy, z0, overhang=1.0):
    x0 = x_edge - overhang
    sh = cq.Workplane("XY").box(5.7, 7.5, 2.6, centered=(False, True, False)).translate((x0, cy, z0))
    sh = sh.cut(cq.Workplane("XY").box(4.8, 6.8, 1.9, centered=(False, True, False)).translate((x0 - 0.01, cy, z0 + 0.35)))
    m.add("metal", STEEL, sh)
    m.add("plastic", BLACK, box(4.0, 5.2, 0.6, x0 + 2.6, cy, z0 + 1.0))


def mini_usb(m, x_edge, cy, z0, overhang=1.5):
    x0 = x_edge - overhang
    sh = cq.Workplane("XY").box(9.2, 7.7, 3.9, centered=(False, True, False)).translate((x0, cy, z0))
    sh = sh.cut(cq.Workplane("XY").box(8.0, 6.9, 3.1, centered=(False, True, False)).translate((x0 - 0.01, cy, z0 + 0.4)))
    m.add("metal", STEEL, sh)
    m.add("plastic", BLACK, box(7.0, 5.4, 0.9, x0 + 4.0, cy, z0 + 1.6))


def tact_smd(m, cx, cy, z0, x=3.5, y=4.5, body=WHITE):
    """Small SMD push button (EN / BOOT)."""
    m.add("plastic", BLACK, box(x, y, 0.9, cx, cy, z0))
    m.add("metal", STEEL, box(x, y * 0.86, 0.25, cx, cy, z0 + 0.9))
    m.add("plastic", body, cyl(min(x, y) * 0.45, 0.5, cx, cy, z0 + 1.15))


def led(m, cx, cy, z0, color="#e8483d", x=1.6, y=0.8):
    m.add("plastic", WHITE, box(x, y, 0.35, cx, cy, z0))
    m.add("glass", color, box(x * 0.6, y * 0.8, 0.12, cx, cy, z0 + 0.35))


def meander(m, cx, cy, z, w, h, n=6, t=0.45, along="y"):
    """Gold PCB antenna trace: n vertical runs joined top/bottom, inside a w x h area."""
    segs = []
    step = w / max(1, n - 1)
    for i in range(n):
        x = -w / 2 + i * step
        segs.append(box(t, h, 0.04, x, 0, z))
        if i < n - 1:
            yy = h / 2 - t / 2 if i % 2 == 0 else -h / 2 + t / 2
            segs.append(box(step + t, t, 0.04, x + step / 2, yy, z))
    if along == "x":
        segs = [s.rotate(V(0, 0, 0), V(0, 0, 1), 90) for s in segs]
    m.add("gold", GOLD, [s.translate(V(cx, cy, 0)) for s in segs])


def wroom_module(m, cx, cy, z0, antenna="+x", length=25.5, width=18.0, can=(17.6, 16.0)):
    """ESP32-WROOM module lying along X; antenna end towards +X (or -X)."""
    s = 1 if antenna == "+x" else -1
    m.add("pcb", "#232a36", box(length, width, 0.8, cx, cy, z0))
    can_cx = cx - s * (length / 2 - can[0] / 2 - 0.6)
    can_s = cq.Workplane("XY").box(can[0], can[1], 2.35, centered=(True, True, False))
    try:
        can_s = can_s.edges("|Z").fillet(0.5).faces(">Z").edges().fillet(0.3)
    except Exception:
        pass
    m.add("metal", STEEL, can_s.translate((can_cx, cy, z0 + 0.8)))
    ant_len = length - can[0] - 1.4
    meander(m, cx + s * (length / 2 - ant_len / 2 - 0.4), cy, z0 + 0.8, width - 3.0, ant_len - 1.4, n=8, along="x")
    # castellated pads along both long sides
    n = 14
    pitch = (can[0] - 1.0) / n
    pts = []
    for i in range(n):
        x = can_cx - can[0] / 2 + 0.6 + (i + 0.5) * pitch
        for sy in (-1, 1):
            pts.append(box(0.9 * pitch, 0.9, 0.05, x, cy + sy * (width / 2 - 0.45), z0 + 0.8))
    m.add("gold", GOLD, pts)


# ---------------------------------------------------------------- dev boards (PCB centred, bottom on z=0, USB at -X)

def esp32_devkitc(variant="v4"):
    """ESP32-DevKitC V4 (38 pin, WROOM-32) or DevKit V1 (30 pin)."""
    m = Model()
    if variant == "v1":
        L, Wd, n = 51.5, 28.3, 15
    else:
        L, Wd, n = 54.4, 27.9, 19
    t = pcb(m, L, Wd, 1.6, PCB_BLACK)
    wroom_module(m, L / 2 - 25.5 / 2, 0, t, "+x")
    micro_usb(m, -L / 2, 0, t)
    rows_y = 12.7
    hx = -L / 2 + (L - n * 2.54) / 2 + 1.27 * 0 + (n * 2.54) / 2 - 1.0
    for sy in (-1, 1):
        header(m, n, 2.54, hx, sy * rows_y, t)
    tact_smd(m, -L / 2 + 4.2, -8.6, t)
    tact_smd(m, -L / 2 + 4.2, 8.6, t)
    chip(m, 5.0, 5.0, 0.9, -L / 2 + 15.5, -3.0, t)                 # CP2102
    chip(m, 6.5, 3.5, 1.6, -L / 2 + 14.0, 6.5, t, legs=3)          # AMS1117
    m.add("metal", TIN, box(3.0, 1.6, 1.4, -L / 2 + 14.0, 9.3, t + 0.15))
    led(m, -L / 2 + 9.0, -5.2, t)
    for i, (x, y) in enumerate(((-6, 4), (-4, -6.5), (-9, 7.5), (-2, 7.5), (-11, -7.5), (-7.5, -2))):
        smd(m, x, y, t, color=TAN if i % 2 else "#3b3c40")
    return m


def esp32_s3_devkitc():
    """ESP32-S3-DevKitC-1: 62.7 x 25.5, 2 x 22 pins 22.86 apart, two USB-C at -X, WROOM-1 module at +X."""
    m = Model()
    L, Wd = 62.7, 25.5
    t = pcb(m, L, Wd, 1.6, PCB_BLACK)
    wroom_module(m, L / 2 - 25.5 / 2 + 0.0, 0, t, "+x", can=(17.6, 15.6))
    usb_c(m, -L / 2, -5.6, t)
    usb_c(m, -L / 2, 5.6, t)
    for sy in (-1, 1):
        header(m, 22, 2.54, 0.0, sy * 11.43, t)
    tact_smd(m, -L / 2 + 11.0, -7.0, t)
    tact_smd(m, -L / 2 + 11.0, 7.0, t)
    m.add("plastic", WHITE, box(2.0, 2.0, 0.6, -L / 2 + 16.5, 0, t))         # WS2812 RGB LED
    m.add("glass", "#f3eccb", box(1.4, 1.4, 0.06, -L / 2 + 16.5, 0, t + 0.6))
    chip(m, 6.5, 3.5, 1.6, -L / 2 + 22.0, 5.5, t, legs=3)
    for x, y in ((-12, -5), (-14, 3), (-9, -7.5), (-18, -2), (-20, 5)):
        smd(m, x, y, t)
    led(m, -L / 2 + 16.5, -6.0, t)
    return m


def esp32_c3_supermini(headers=False):
    """ESP32-C3 SuperMini: 22.5 x 18 x 1.0, USB-C at -X, PCB antenna at +X, 2 x 8 holes on 15.24 mm rows."""
    m = Model()
    L, Wd = 22.5, 18.0
    t = pcb(m, L, Wd, 1.0, PCB_BLACK, r=0.8)
    usb_c(m, -L / 2, 0, t, depth=7.35, overhang=1.0)
    chip(m, 5.0, 5.0, 0.9, 1.4, 0, t)
    meander(m, L / 2 - 2.6, 0, t, 3.6, 12.0, n=5)
    m.add("plastic", BLACK, box(2.0, 1.25, 0.9, L / 2 - 6.2, 4.5, t))       # crystal-ish
    chip(m, 2.9, 1.6, 1.0, -2.8, -5.0, t, legs=3)                           # LDO
    tact_smd(m, -3.8, 4.4, t, x=3.0, y=2.6)
    tact_smd(m, -3.8, -4.4 + 1.4, t, x=3.0, y=2.6)
    led(m, 4.4, -4.6, t)
    pts = [(-L / 2 + 2.05 + i * 2.54, sy * 7.62) for i in range(8) for sy in (-1, 1)]
    pads(m, pts, t, 1.5, 0.9)
    if headers:
        for sy in (-1, 1):
            header(m, 8, 2.54, -L / 2 + 2.05 + 3.5 * 2.54, sy * 7.62, t)
    return m


def xiao_esp32s3():
    """Seeed XIAO ESP32S3: 21 x 17.8, shield can, USB-C at -X, 2 x 7 castellations."""
    m = Model()
    L, Wd = 21.0, 17.8
    t = pcb(m, L, Wd, 1.2, PCB_BLUE if False else "#18191d", r=1.0)
    can = cq.Workplane("XY").box(12.6, 10.6, 2.4, centered=(True, True, False))
    try:
        can = can.edges("|Z").fillet(0.4)
    except Exception:
        pass
    m.add("metal", STEEL, can.translate((2.6, 0, t)))
    usb_c(m, -L / 2, 0, t, overhang=1.2)
    m.add("metal", "#d8c27a", cyl(2.0, 1.2, L / 2 - 1.8, -6.6, t))           # U.FL
    tact_smd(m, -L / 2 + 8.5, 6.2, t, x=2.4, y=2.0)
    tact_smd(m, -L / 2 + 8.5, -6.2, t, x=2.4, y=2.0)
    pts = [(-L / 2 + 2.88 + i * 2.54, sy * 7.62) for i in range(7) for sy in (-1, 1)]
    m.add("gold", GOLD, [box(1.4, 1.2, 0.05, x, y + (0.3 if y > 0 else -0.3), t) for x, y in pts])
    return m


def arduino_nano(headers=True):
    """Arduino Nano (and clones): 43.2 x 18.0 (official drawing; see cadlib.dims arduino_nano), mini-USB at -X, 2 x 15 pins 15.24 apart, ICSP at +X."""
    m = Model()
    L, Wd = 43.2, 18.0
    t = pcb(m, L, Wd, 1.6, "#18427a", r=0.4)
    mini_usb(m, -L / 2, 0, t)
    chip(m, 7.0, 7.0, 1.0, 4.0, 0, t, rot=45, legs=8)                       # ATmega328P TQFP
    chip(m, 9.9, 3.9, 1.5, -8.5, -3.5, t, legs=8, leg_side="y")             # CH340
    m.add("metal", STEEL, rbox(11.0, 4.6, 3.6, 2.2, -8.0, 4.6, t))           # 16 MHz crystal (HC49)
    m.add("plastic", "#e6e2d8", box(6.0, 3.5, 1.6, 0.0, -6.3, t))           # reset button
    m.add("plastic", BLACK, cyl(1.6, 0.6, 0.0, -6.3, t + 1.6))
    for i, c in enumerate(("#3be06a", "#e8483d", "#f2c94c", "#f2c94c")):
        led(m, -15.0 + i * 2.0, 6.5, t, c)
    if headers:
        for sy in (-1, 1):
            header(m, 15, 2.54, 0.0, sy * 7.62, t)
    header(m, 3, 2.54, L / 2 - 3.2, 0, t, along="y", down=False, rows=2, pin_out=6.0)
    return m


def rpi_pico(headers=True):
    """Raspberry Pi Pico: 51 x 21 x 1.0, micro-USB at -X, 2 x 20 pins 17.78 apart, 4 x 2.1 holes 47 x 11.4."""
    m = Model()
    L, Wd = 51.0, 21.0
    holes = [(sx * 23.5, sy * 5.7, 2.1) for sx in (-1, 1) for sy in (-1, 1)]
    t = pcb(m, L, Wd, 1.0, "#1f6a3c", holes=holes, r=0.5)
    micro_usb(m, -L / 2, 0, t, overhang=1.3)
    chip(m, 7.0, 7.0, 0.9, 2.0, 0, t)                                       # RP2040
    chip(m, 5.3, 5.3, 1.2, -6.5, 0, t, legs=4)                              # flash
    m.add("plastic", WHITE, box(3.5, 4.5, 1.4, -14.0, 3.6, t))              # BOOTSEL
    m.add("plastic", "#f6f4ee", cyl(2.0, 0.5, -14.0, 3.6, t + 1.4))
    m.add("metal", STEEL, box(3.2, 2.5, 0.8, 10.5, -4.0, t))                # crystal
    chip(m, 2.9, 1.6, 1.0, -16.5, -4.0, t, legs=3)
    led(m, -20.5, -3.8, t, "#3be06a")
    for x, y in ((8, 5), (9, 2), (-3, 6), (-2, -6), (12, 3), (14, -2)):
        smd(m, x, y, t, color="#3b3c40")
    pts = [(-L / 2 + 1.61 + i * 2.54, sy * 8.89) for i in range(20) for sy in (-1, 1)]
    pads(m, pts, t, 1.6, 1.0)
    if headers:
        for sy in (-1, 1):
            header(m, 20, 2.54, -L / 2 + 1.61 + 9.5 * 2.54, sy * 8.89, t)
    return m


# ---------------------------------------------------------------- motion

def nema17(length=48):
    """NEMA17 stepper: mounting face on z=0, body below (-Z), 5 mm D shaft up (+Z), 4 x M3 on 31 mm square."""
    m = Model()
    L = float(length)
    S = 42.3
    fc = 6.0 if L < 38 else 7.5
    bc = 7.0 if L < 38 else 9.5
    st = L - fc - bc

    def block(h, z0, ch):
        w = cq.Workplane("XY").box(S, S, h, centered=(True, True, False))
        try:
            w = w.edges("|Z").chamfer(ch)
        except Exception:
            pass
        return w.translate((0, 0, z0))

    front = block(fc, -fc, 4.4)
    front = front.cut(cq.Workplane("XY").pushPoints([(x, y) for x in (-15.5, 15.5) for y in (-15.5, 15.5)])
                      .circle(1.5).extrude(-4.5))
    back = block(bc, -L, 4.4)
    m.add("metal", ALU, front, back)
    stack = block(st, -fc - st, 5.2)
    # laminations: shallow grooves read as a stack of plates
    m.add("plastic", "#1a1b1e", stack)
    m.add("metal", ALU, cyl(22.0, 2.0, 0, 0, 0))
    shaft = cq.Workplane("XY").circle(2.5).extrude(24.0)
    shaft = shaft.cut(cq.Workplane("XY").box(5, 5, 15, centered=(True, True, False)).translate((0, 2.0 + 2.5, 9.0)))
    try:
        shaft = shaft.faces(">Z").edges().chamfer(0.3)
    except Exception:
        pass
    m.add("metal", STEEL, shaft)
    m.add("metal", BLACK_OXIDE, [cyl(5.4, 0.6, x, y, -L - 0.6) for x in (-15.5, 15.5) for y in (-15.5, 15.5)])
    # 6-pin JST-PH socket on the -Y side of the back cap
    m.add("plastic", IVORY, box(16.0, 5.6, 6.0, 0, -S / 2 - 2.8 + 0.4, -L + 1.5))
    m.add("plastic", "#d9d2c0", box(14.0, 0.2, 4.4, 0, -S / 2 - 5.6 + 0.3, -L + 2.3))
    return m


def stepstick(driver="tmc2209"):
    """TMC2209 / A4988 stepstick: PCB 20.3 x 15.2 bottom on z=0, 2 x 8 pins down (12.7 apart), heatsink on top."""
    m = Model()
    L, Wd = 20.3, 15.2
    t = pcb(m, L, Wd, 1.6, PCB_PURPLE if driver == "tmc2209" else PCB_RED, r=0.3)
    for sy in (-1, 1):
        header(m, 8, 2.54, 0, sy * 6.35, t)
    hs_h = 7.0 if driver == "tmc2209" else 5.0
    base = box(9.0, 9.0, 1.2, 1.0, 0, t + 0.9)
    fins = [box(0.8, 9.0, hs_h - 1.2, 1.0 - 3.6 + i * 1.8, 0, t + 2.1) for i in range(5)]
    m.add("metal", "#9aa3ad" if driver == "tmc2209" else "#c9cdd2", base, fins)
    chip(m, 5.0, 5.0, 0.9, 1.0, 0, t)
    m.add("plastic", WHITE, box(3.2, 3.2, 1.6, -6.6, 3.0, t))               # current pot
    m.add("metal", STEEL, cyl(2.0, 0.3, -6.6, 3.0, t + 1.6))
    for x, y in ((-6.5, -2.5), (-6.5, -4.0), (7.6, 4.0), (7.6, -4.0)):
        smd(m, x, y, t, color="#3b3c40")
    return m


def sg90():
    """SG90 micro servo: body 22.8 x 12.2, bottom on z=0, mounting tabs (2 x M2, 27.8 apart) at z 15.9, output +Z."""
    m = Model()
    bx, by = 22.8, 12.2
    body = rbox(bx, by, 22.7, 0.6, 0, 0, 0)
    tabs = cq.Workplane("XY").box(32.2, by, 2.5, centered=(True, True, False)).translate((0, 0, 15.9))
    tabs = tabs.cut(cq.Workplane("XY").pushPoints([(-13.9, 0), (13.9, 0)]).circle(1.0).extrude(30))
    tabs = tabs.cut(cq.Workplane("XY").pushPoints([(-16.1, 0), (16.1, 0)]).rect(2.6, 1.1).extrude(30))
    m.add("plastic", SERVO_BLUE, body, tabs)
    m.add("plastic", SERVO_BLUE, cyl(11.8, 4.0, bx / 2 - 5.9, 0, 22.7), cyl(6.0, 4.0, bx / 2 - 12.0, 0, 22.7))
    m.add("plastic", WHITE, cyl(4.8, 3.0, bx / 2 - 5.9, 0, 26.7))
    m.add("metal", STEEL, cyl(2.0, 0.2, bx / 2 - 5.9, 0, 29.7))
    m.add("glass", "#f3f1ea", box(0.1, 9.0, 8.0, bx / 2 + 0.05, 0, 4.0))     # label edge
    for i, c in enumerate(("#6b3a1f", "#d23b2e", "#f08a1c")):
        m.add("plastic", c, box(18.0, 1.0, 1.0, -bx / 2 - 9.0, -1.1 + i * 1.1, 4.0))
    return m


def bearing(od=22.0, idia=8.0, w=7.0, seal="zz"):
    """Ball bearing, axis Z, bottom face on z=0. seal: zz (metal shields) or 2rs (black rubber seals)."""
    m = Model()
    ro = (od - idia) * 0.17
    ri = (od - idia) * 0.14
    m.add("metal", STEEL, ring(od, od - 2 * ro, w, 0, 0, 0), ring(idia + 2 * ri, idia, w, 0, 0, 0))
    sh = ring(od - 2 * ro + 0.02, idia + 2 * ri - 0.02, 0.4, 0, 0, 0)
    shields = [sh.translate(V(0, 0, 0.3)), sh.translate(V(0, 0, w - 0.7))]
    if seal == "2rs":
        m.add("rubber", "#202124", shields)
    else:
        m.add("metal", "#a9aeb5", shields)
    m.add("metal", "#8e939a", ring(od - 2 * ro + 0.02, idia + 2 * ri - 0.02, w - 1.6, 0, 0, 0.8))
    return m


# ---------------------------------------------------------------- fasteners (axis Z)

SHCS = {  # d: head dia, head h, hex key
    2: (3.8, 2.0, 1.5), 2.5: (4.5, 2.5, 2.0), 3: (5.5, 3.0, 2.5), 4: (7.0, 4.0, 3.0), 5: (8.5, 5.0, 4.0), 6: (10.0, 6.0, 5.0),
}
BHCS = {2: (3.5, 1.3, 1.3), 2.5: (4.7, 1.5, 1.5), 3: (5.7, 1.65, 2.0), 4: (7.6, 2.2, 2.5), 5: (9.5, 2.75, 3.0), 6: (10.5, 3.3, 4.0)}
CSK = {2: (3.8, 1.2, 1.3), 2.5: (4.7, 1.5, 1.5), 3: (6.0, 1.7, 2.0), 4: (8.0, 2.3, 2.5), 5: (10.0, 2.8, 3.0), 6: (12.0, 3.3, 4.0)}
NUT = {2: (4.0, 1.6), 2.5: (5.0, 2.0), 3: (5.5, 2.4), 4: (7.0, 3.2), 5: (8.0, 4.7), 6: (10.0, 5.2)}
WASHER = {2: (5.0, 0.3), 2.5: (6.0, 0.5), 3: (7.0, 0.5), 4: (9.0, 0.8), 5: (10.0, 1.0), 6: (12.0, 1.6)}
INSERT = {2: (3.6, 3.0), 2.5: (4.0, 4.0), 3: (4.6, 5.7), 4: (6.3, 8.1), 5: (7.1, 9.5), 6: (8.7, 12.7)}
STANDOFF_AF = {2: 4.0, 2.5: 5.0, 3: 5.0, 4: 7.0}
PAN = {2: (4.0, 1.6), 2.5: (5.0, 1.9), 3: (5.6, 2.2), 3.5: (6.9, 2.6), 4: (7.5, 2.8)}  # pan head (ISO 7049 / ST): head dia, head h


def _metal_color(material):
    return {"stainless": "#c9cdd2", "zinc": "#cfd2cc", "black": BLACK_OXIDE}.get(material, BLACK_OXIDE)


def _shank(d, length):
    s = cq.Workplane("XY").circle(d / 2).extrude(-length)
    try:
        s = s.faces("<Z").edges().chamfer(min(0.15 * d, length / 4))
    except Exception:
        pass
    # thread hint: shallow rings every pitch read as threads at a glance
    return s


def screw(d=3, length=10, head="socket", material="black"):
    """Metric screw, axis Z. socket / button: underside of the head on z=0, head up, shank down to -length.
    countersunk: head top flush with z=0, cone below."""
    m = Model()
    d = float(d) if float(d) != int(float(d)) else int(float(d))
    col = _metal_color(material)
    if head == "pan":  # self-tapping (thread-forming) screw for plastic: pan head, Phillips cross, pointed tip
        dk, k = PAN[d]
        hw = cq.Workplane("XY").circle(dk / 2).extrude(k)
        try:
            hw = hw.faces(">Z").edges().fillet(k * 0.6)
        except Exception:
            pass
        for ang in (0, 90):
            hw = hw.cut(cq.Workplane("XY").rect(dk * 0.62, dk * 0.16).extrude(k).translate((0, 0, k * 0.45)).rotate((0, 0, 0), (0, 0, 1), ang))
        tip = min(d * 0.9, length / 3)
        shank = cq.Workplane("XY").circle(d / 2).extrude(-(length - tip))
        cone = cq.Workplane("XY").add(cq.Solid.makeCone(d / 2, d * 0.12, tip, V(0, 0, -(length - tip)), V(0, 0, -1)))
        m.add("metal", col, hw, shank.union(cone))
    elif head == "button":
        dk, k, s = BHCS[d]
        hw = cq.Workplane("XY").circle(dk / 2).extrude(k)
        try:
            hw = hw.faces(">Z").edges().fillet(k * 0.85)
        except Exception:
            pass
        hw = hw.cut(cq.Workplane("XY").polygon(6, s / math.cos(math.radians(30))).extrude(k).translate((0, 0, k * 0.4)))
        m.add("metal", col, hw, _shank(d, length))
    elif head == "countersunk":
        dk, k, s = CSK[d]
        hk = (dk - d) / 2  # 90 deg cone
        cone = cq.Solid.makeCone(d / 2, dk / 2, hk, V(0, 0, -hk))
        hw = cq.Workplane("XY").add(cone)
        hw = hw.cut(cq.Workplane("XY").polygon(6, s / math.cos(math.radians(30))).extrude(-hk * 0.8))
        m.add("metal", col, hw, _shank(d, length - hk).translate((0, 0, -hk)))
    else:
        dk, k, s = SHCS[d]
        hw = cq.Workplane("XY").circle(dk / 2).extrude(k)
        try:
            hw = hw.faces(">Z").edges().chamfer(0.08 * d)
        except Exception:
            pass
        hw = hw.cut(cq.Workplane("XY").polygon(6, s / math.cos(math.radians(30))).extrude(k * 0.55).translate((0, 0, k * 0.45)))
        # knurl hint: a slightly darker band
        m.add("metal", col, hw, _shank(d, length))
    return m


def nut(d=3, kind="hex", material="zinc"):
    """Hex nut (ISO 4032) or nylock, axis Z, bottom on z=0."""
    m = Model()
    d = int(d) if float(d) == int(float(d)) else float(d)
    s, h = NUT[d]
    hn = h if kind == "hex" else h * 0.75
    w = cq.Workplane("XY").polygon(6, s / math.cos(math.radians(30))).extrude(hn)
    try:
        w = w.edges("not |Z").chamfer(min(0.12 * s, hn / 4))
    except Exception:
        pass
    w = w.faces(">Z").workplane().hole(d)
    m.add("metal", _metal_color(material), w)
    if kind == "nylock":
        m.add("metal", _metal_color(material), ring(s * 0.95, d, h * 0.45, 0, 0, hn))
        m.add("plastic", "#e8e4d6", ring(s * 0.8, d, h * 0.12, 0, 0, hn + h * 0.36))
    return m


def washer(d=3, material="zinc"):
    m = Model()
    d = int(d) if float(d) == int(float(d)) else float(d)
    od, t = WASHER[d]
    m.add("metal", _metal_color(material), ring(od, d + 0.2 + d * 0.05, t))
    return m


def insert(d=3):
    """Brass heat-set insert, axis Z, bottom on z=0 (the top lip sits flush with the plastic)."""
    m = Model()
    d = int(d) if float(d) == int(float(d)) else float(d)
    od, L = INSERT[d]
    band = L * 0.36
    teeth = 12
    k1 = cq.Workplane("XY").polygon(teeth, od).extrude(band).translate((0, 0, L * 0.08))
    k2 = cq.Workplane("XY").polygon(teeth, od).extrude(band).rotate((0, 0, 0), (0, 0, 1), 180 / teeth).translate((0, 0, L * 0.56))
    core = cq.Workplane("XY").circle(od * 0.43).extrude(L)
    body = core.union(k1).union(k2).faces(">Z").workplane().hole(d * 0.95)
    m.add("metal", BRASS, body)
    return m


def standoff(d=3, length=10, kind="ff"):
    """Brass hex standoff, axis Z, bottom on z=0. kind ff (female both ends) or mf (male stud 6 mm below z=0)."""
    m = Model()
    d = int(d) if float(d) == int(float(d)) else float(d)
    af = STANDOFF_AF.get(d, 5.0)
    L = float(length)
    w = cq.Workplane("XY").polygon(6, af / math.cos(math.radians(30))).extrude(L)
    depth = min(L / 2 - 0.3, 6.0)
    w = w.faces(">Z").workplane().hole(d * 0.84, depth)
    if kind != "mf":
        w = w.faces("<Z").workplane().hole(d * 0.84, depth)
    m.add("metal", BRASS, w)
    if kind == "mf":
        m.add("metal", BRASS, cyl(d, 6.0, 0, 0, -6.0))
    return m


# ---------------------------------------------------------------- power

def lm2596():
    """LM2596 buck module: PCB 43 x 21 bottom on z=0, 2 x 3 mm holes diagonal (30 x 15)."""
    m = Model()
    L, Wd = 43.0, 21.0
    t = pcb(m, L, Wd, 1.6, PCB_BLUE, holes=[(-15.0, -7.5, 3.0), (15.0, 7.5, 3.0)], r=0.4)
    for cx, cy, d, h in ((-12.5, 3.5, 8.0, 11.0), (13.0, -2.5, 6.3, 11.0)):
        m.add("plastic", "#1d2a4a", cyl(d, h - 0.5, cx, cy, t))
        m.add("metal", STEEL, cyl(d - 0.6, 0.5, cx, cy, t + h - 0.5))
    m.add("plastic", "#24262a", rbox(12.0, 12.0, 7.0, 1.2, 2.0, 2.5, t))     # inductor
    m.add("metal", COPPER, box(3.0, 12.4, 2.0, 2.0, 2.5, t + 2.5))
    chip(m, 10.2, 9.0, 4.4, -2.5, -5.5, t, legs=0)                          # LM2596 TO-263
    m.add("metal", TIN, box(10.2, 1.4, 0.4, -2.5, -10.0, t))
    m.add("plastic", TERM_BLUE, box(9.5, 4.5, 10.0, 9.0, 7.0, t))           # trimmer
    m.add("metal", BRASS, cyl(2.2, 0.8, 9.0 - 3.6, 7.0, t + 10.0).rotate(V(9.0 - 3.6, 7.0, t + 10.0), V(9.0 - 3.6, 8.0, t + 10.0), 90))
    chip(m, 5.0, 3.8, 2.2, -12.5, -6.0, t)                                  # SS34 diode
    pads(m, [(-L / 2 + 2.2, -8.0), (-L / 2 + 2.2, 8.0), (L / 2 - 2.2, -8.0), (L / 2 - 2.2, 8.0)], t, 2.6, 1.3)
    return m


def mp1584():
    """MP1584 mini buck: PCB 22 x 17 x 1.2 bottom on z=0, no holes."""
    m = Model()
    L, Wd = 22.0, 17.0
    t = pcb(m, L, Wd, 1.2, PCB_GREEN, r=0.3)
    m.add("plastic", "#26282c", rbox(6.0, 6.0, 3.2, 0.8, 3.0, 2.0, t))
    chip(m, 4.9, 3.9, 1.4, -3.5, 2.5, t, legs=4)
    m.add("plastic", TERM_BLUE, box(3.0, 3.0, 2.0, -5.5, -4.5, t))
    m.add("metal", STEEL, cyl(1.6, 0.2, -5.5, -4.5, t + 2.0))
    for x, y in ((3, -4), (5.5, -4), (-1, -4), (-8, 3), (8, -6)):
        smd(m, x, y, t, color=TAN)
    pads(m, [(-L / 2 + 1.6, -6.4), (-L / 2 + 1.6, 6.4), (L / 2 - 1.6, -6.4), (L / 2 - 1.6, 6.4)], t, 2.2, 1.0)
    return m


def cell_18650():
    """18650 Li-ion cell lying along X, centred, bottom on z=0 (+ terminal at +X)."""
    m = Model()
    r = 9.2
    m.add("plastic", "#2f6fd0", cyl(18.4, 64.0, -32.0, 0, r, axis=(1, 0, 0)).translate(V(0, 0, 0)))
    m.add("metal", STEEL, cyl(16.6, 0.5, -32.5, 0, r, axis=(1, 0, 0)), cyl(16.6, 0.4, 32.0, 0, r, axis=(1, 0, 0)),
          cyl(8.0, 1.2, 32.4, 0, r, axis=(1, 0, 0)))
    m.add("plastic", WHITE, ring(17.6, 9.0, 0.3).rotate(V(0, 0, 0), V(0, 1, 0), 90).translate(V(32.2, 0, r)))
    return m


def holder_18650():
    """1-slot 18650 holder, 77 x 21, bottom on z=0, cell axis X (cell centre at z = 10.4)."""
    m = Model()
    L, Wd, H = 77.0, 21.0, 15.0
    zc = 1.2 + 9.2
    tray = cq.Workplane("XY").box(L, Wd, H, centered=(True, True, False))
    tray = tray.cut(cq.Workplane("YZ").circle(9.5).extrude(L - 5.0).translate((-(L - 5.0) / 2, 0, zc)))
    tray = tray.cut(cq.Workplane("XY").box(L - 5.0, 15.0, 10.0, centered=(True, True, False)).translate((0, 0, zc)))
    tray = tray.cut(cq.Workplane("XY").pushPoints([(-20, 0), (20, 0)]).circle(1.6).extrude(5))
    m.add("plastic", BLACK, tray)
    coil = [ring(7.5, 6.3, 0.6, 0, 0, i * 1.1).rotate(V(0, 0, 0), V(0, 1, 0), 90) for i in range(5)]
    m.add("metal", STEEL, [c.translate(V(-L / 2 + 2.6, 0, zc)) for c in coil],
          box(0.4, 9.0, 9.0, L / 2 - 2.7, 0, zc - 4.5))
    m.add("plastic", "#d23b2e", box(14.0, 1.4, 1.4, L / 2 + 7.0, 2.0, 1.0))
    m.add("plastic", BLACK, box(14.0, 1.4, 1.4, -L / 2 - 7.0, -2.0, 1.0))
    return m


def dc_jack_panel():
    """DC-022 panel jack (5.5 x 2.1): panel outer face at z=0, plug opening up (+Z), 11 mm hole; body below."""
    m = Model()
    m.add("metal", STEEL, ring(13.0, 7.0, 1.6, 0, 0, 0))
    thread = cq.Workplane("XY").circle(5.4).circle(3.6).extrude(-10.0)
    m.add("metal", STEEL, thread)
    m.add("metal", "#b9bec4", hexagon(14.0, 2.0, 0, 0, -5.0, hole=10.9))
    m.add("plastic", BLACK, cyl(7.2, 9.0, 0, 0, -9.0).cut(cyl(6.0, 9.0, 0, 0, -8.0)))
    m.add("metal", "#e0e2e4", cyl(2.0, 10.0, 0, 0, -9.0))
    m.add("metal", TIN, box(2.4, 0.3, 6.0, 0, 3.2, -15.0), box(2.4, 0.3, 6.0, 0, -3.2, -15.0), box(0.3, 2.4, 6.0, 0, 0, -15.0))
    return m


def dc_jack_pcb():
    """DC-005 PCB barrel jack 5.5 x 2.1: 14 x 9 x 11, bottom on z=0, plug opening facing -X."""
    m = Model()
    body = cq.Workplane("XY").box(14.0, 9.0, 11.0, centered=(True, True, False))
    body = body.cut(cq.Workplane("YZ").circle(3.2).extrude(12.0).translate((-7.01, 0, 6.5)))
    m.add("plastic", BLACK, body)
    m.add("metal", STEEL, cyl(2.0, 10.0, -7.0, 0, 6.5, axis=(1, 0, 0)))
    m.add("metal", TIN, box(3.0, 0.4, 3.5, 6.0, 0, -3.5), box(3.0, 0.4, 3.5, -1.5, 0, -3.5), box(0.4, 3.0, 3.5, 2.5, 4.4, -3.5))
    return m


def usbc_breakout():
    """USB-C female breakout: PCB 14 x 12 x 1.0 bottom on z=0, socket opening facing -X, VBUS/GND pads at +X."""
    m = Model()
    L, Wd = 14.0, 12.0
    t = pcb(m, L, Wd, 1.0, PCB_BLACK, holes=[(L / 2 - 2.4, -Wd / 2 + 2.2, 2.2), (L / 2 - 2.4, Wd / 2 - 2.2, 2.2)], r=0.6)
    usb_c(m, -L / 2, 0, t, overhang=1.0)
    m.add("gold", GOLD, box(2.0, 2.6, 0.05, L / 2 - 2.0, -1.9, t), box(2.0, 2.6, 0.05, L / 2 - 2.0, 1.9, t))
    smd(m, 2.0, 4.0, t, color="#3b3c40")
    smd(m, 2.0, -4.0, t, color="#3b3c40")
    return m


# ---------------------------------------------------------------- UI / IO

def tact(size=6, height=None):
    """Tactile switch 6x6 or 12x12, base on z=0, plunger up, legs below."""
    m = Model()
    if int(size) == 12:
        s, bh, pd = 12.0, 3.6, 6.8
        height = float(height or 7.3)
    else:
        s, bh, pd = 6.0, 3.4, 3.5
        height = float(height or 5.0)
    m.add("plastic", BLACK, box(s, s, bh, 0, 0, 0))
    plate = cq.Workplane("XY").box(s, s, 0.3, centered=(True, True, False)).faces(">Z").workplane().hole(pd + 0.6)
    m.add("metal", STEEL, plate.translate((0, 0, bh)))
    m.add("plastic", BLACK if s == 6.0 else "#2c2e33", cyl(pd, height - bh, 0, 0, bh))
    off = s / 2 - 0.9 if s == 6.0 else s / 2 - 1.2
    legs = [box(0.7, 0.3, 3.5, sx * off, sy * (s / 2 + 0.15), -3.2) for sx in (-1, 1) for sy in (-1, 1)]
    m.add("metal", TIN, legs)
    if s == 12.0:
        m.add("plastic", BLACK, [cyl(1.0, 0.4, sx * 4.0, sy * 4.0, bh + 0.3) for sx in (-1, 1) for sy in (-1, 1)])
    return m


def oled_096():
    """0.96" SSD1306 I2C OLED: PCB 27.3 x 27.8 x 1.2 bottom on z=0, glass up, 4 pins at +Y pointing down."""
    m = Model()
    L, Wd = 27.3, 27.8
    holes = [(sx * 11.65, sy * 11.9, 2.0) for sx in (-1, 1) for sy in (-1, 1)]
    t = pcb(m, L, Wd, 1.2, PCB_BLUE, holes=holes, r=0.5)
    m.add("plastic", "#0f1013", box(26.7, 19.3, 0.6, 0, -1.6, t + 0.15))
    m.add("glass", "#08090c", box(26.4, 19.0, 0.8, 0, -1.6, t + 0.75))
    m.add("glass", "#0d1b2a", box(21.7, 10.9, 0.02, 0, -0.6, t + 1.55))
    m.add("plastic", "#c9a24a", box(12.0, 3.0, 0.2, 0, -12.5, t))          # flex
    header(m, 4, 2.54, 0, 12.4, t)
    return m


def relay_module():
    """1-channel 5 V relay module: PCB 50 x 26 bottom on z=0, 4 x M3 holes 44 x 20, screw terminal at +X."""
    m = Model()
    L, Wd = 50.0, 26.0
    holes = [(sx * 22.0, sy * 10.0, 3.0) for sx in (-1, 1) for sy in (-1, 1)]
    t = pcb(m, L, Wd, 1.6, PCB_BLUE, holes=holes, r=0.6)
    m.add("plastic", RELAY_BLUE, box(19.0, 15.5, 15.3, 4.0, 0, t))
    m.add("glass", "#e9e6dd", box(12.0, 8.0, 0.05, 4.0, 0, t + 15.3))
    term = box(7.6, 15.0, 10.0, L / 2 - 4.6, 0, t)
    m.add("plastic", TERM_BLUE, term)
    m.add("metal", STEEL, [cyl(3.2, 0.4, L / 2 - 4.6, y, t + 10.0) for y in (-5.0, 0, 5.0)])
    header(m, 3, 2.54, -L / 2 + 2.6, 0, t, along="y", down=False, pin_out=5.0)
    m.add("plastic", BLACK, cyl(4.6, 4.6, -12.0, 6.0, t))                   # transistor
    led(m, -12.0, -6.0, t, "#e8483d")
    led(m, -15.0, -6.0, t, "#3be06a")
    smd(m, -15.0, 2.0, t)
    smd(m, -9.0, -2.0, t, color="#3b3c40")
    return m


def fan(size=40, thick=10):
    """Axial fan, square frame, bottom on z=0, airflow +Z, M3 holes (30: 24 mm, 40: 32 mm spacing)."""
    m = Model()
    s = float(size)
    h = float(thick)
    hs = {30: 24.0, 40: 32.0, 50: 40.0, 60: 50.0}.get(int(s), s * 0.8)
    rd = s / 2 - 0.9
    fr = cq.Workplane("XY").box(s, s, h, centered=(True, True, False))
    try:
        fr = fr.edges("|Z").fillet(s * 0.06)
    except Exception:
        pass
    fr = fr.cut(cq.Workplane("XY").circle(rd).extrude(h))
    fr = fr.cut(cq.Workplane("XY").pushPoints([(x, y) for x in (-hs / 2, hs / 2) for y in (-hs / 2, hs / 2)]).circle(1.6).extrude(h))
    # side relief between the flanges
    for ang in (0, 90, 180, 270):
        cut = cq.Workplane("XY").box(s * 0.62, 2.0, h - 3.0, centered=(True, True, False)).translate((0, s / 2, 1.5))
        fr = fr.cut(cut.rotate((0, 0, 0), (0, 0, 1), ang))
    m.add("plastic", BLACK, fr)
    hub_d = s * 0.42
    m.add("plastic", BLACK, cyl(hub_d, h - 1.2, 0, 0, 0.6))
    m.add("plastic", "#ece6d4", cyl(hub_d - 3.0, 0.08, 0, 0, h - 0.6))
    spokes = [box(s / 2 - 1.0, 1.4, 1.4, (s / 2 - 1.0) / 2, 0, 0).rotate(V(0, 0, 0), V(0, 0, 1), 45 + 90 * i) for i in range(4)]
    m.add("plastic", BLACK, spokes)
    blades = []
    rb = (rd - hub_d / 2) - 0.6
    for i in range(7):
        b = box(rb, s * 0.2, 0.8, hub_d / 2 + rb / 2, 0, -0.4)
        b = b.rotate(V(0, 0, 0), V(1, 0, 0), 38).translate(V(0, 0, h / 2))
        blades.append(b.rotate(V(0, 0, 0), V(0, 0, 1), i * 360 / 7))
    m.add("plastic", "#232428", blades)
    m.add("plastic", "#d23b2e", box(1.2, 10.0, 1.2, s / 2 - 3.0, s / 2 + 5.0, h - 3.0))
    m.add("plastic", BLACK, box(1.2, 10.0, 1.2, s / 2 - 4.4, s / 2 + 5.0, h - 3.0))
    return m


def ws2812_strip(length=100, per_m=60):
    """WS2812B strip on its tape, along +X from x=0, tape bottom on z=0, 10 mm wide."""
    m = Model()
    pitch = 1000.0 / float(per_m)
    L = float(length)
    n = max(1, int(L / pitch + 1e-6))
    m.add("plastic", "#f1f0ea", box(L, 10.0, 0.3, L / 2, 0, 0))
    leds, lens, cap, cut = [], [], [], []
    for i in range(n):
        x = pitch / 2 + i * pitch
        leds.append(box(5.0, 5.0, 1.5, x, 0, 0.3))
        lens.append(cq.Workplane("XY").polygon(12, 4.2).extrude(0.05).translate((x, 0, 1.8)).val())
        cap.append(box(1.0, 0.5, 0.5, x + 4.0, 2.6, 0.3))
        for y in (-3.0, 0.0, 3.0):
            cut.append(box(1.4, 2.2, 0.04, i * pitch + (0.9 if i == 0 else 0), y, 0.3))
    m.add("plastic", "#f6f4ee", leds)
    m.add("glass", "#f7efc9", lens)
    m.add("plastic", TAN, cap)
    m.add("gold", COPPER, cut)
    return m


def led_5mm(color="red"):
    """5 mm through-hole LED, axis Z, flange bottom on z=0, legs below."""
    m = Model()
    c = {"red": "#e8483d", "green": "#3bd06a", "blue": "#3a7bf0", "yellow": "#f2c94c", "white": "#f2f0e8", "warm": "#f6d9a0"}.get(color, color)
    body = cq.Workplane("XY").circle(2.5).extrude(5.8)
    try:
        body = body.faces(">Z").edges().fillet(2.45)
    except Exception:
        pass
    m.add("glass", c, body.translate((0, 0, 1.0)), cyl(5.8, 1.0))
    m.add("metal", TIN, box(0.5, 0.5, 25.0, -1.27, 0, -25.0), box(0.5, 0.5, 22.0, 1.27, 0, -22.0))
    return m


def gt2_pulley(teeth=20, bore=5.0):
    """GT2 pulley 20T for 6 mm belt: axis Z, bottom (hub end) on z=0, 16 mm total."""
    m = Model()
    pd = teeth * 2.0 / math.pi
    od = pd - 0.5
    hub = cq.Workplane("XY").circle(8.0).extrude(7.0)
    hub = hub.cut(cq.Workplane("YZ").circle(1.5).extrude(9).translate((0, 0, 3.5)))
    teeth_w = cq.Workplane("XY").polygon(teeth, od).extrude(7.0).translate((0, 0, 8.0))
    fl = [cyl(16.0, 1.0, 0, 0, 7.0), cyl(16.0, 1.0, 0, 0, 15.0)]
    w = hub.union(teeth_w).union(cq.Workplane("XY").add(fl[0])).union(cq.Workplane("XY").add(fl[1]))
    w = w.faces(">Z").workplane().hole(float(bore))
    m.add("metal", ALU, w)
    m.add("metal", BLACK_OXIDE, cyl(2.8, 0.6, 0, 0, 3.5, axis=(1, 0, 0)).translate(V(7.5, 0, 0)),
          cyl(2.8, 0.6, 0, 0, 3.5, axis=(0, 1, 0)).translate(V(0, 7.5, 0)))
    return m


def corner_bracket_2020():
    """2020 cast L bracket 20 x 20 (2 x M5): inside corner on the origin, legs along +X (under z=0) and +Z (behind x=0), 20 wide in Y."""
    m = Model()
    t = 3.0
    leg_x = cq.Workplane("XY").box(20.0, 20.0, t, centered=(False, True, False)).translate((0, 0, -t))
    leg_x = leg_x.cut(cq.Workplane("XY").center(11.0, 0).circle(2.75).extrude(-t))
    leg_z = cq.Workplane("XY").box(t, 20.0, 20.0, centered=(False, True, False)).translate((-t, 0, 0))
    leg_z = leg_z.cut(cq.Workplane("YZ").center(0, 11.0).circle(2.75).extrude(-t))
    gus = cq.Workplane("XZ").polyline([(0, 0), (14.0, 0), (0, 14.0)]).close().extrude(0.75, both=True)
    m.add("metal", ALU, leg_x, leg_z, gus)
    return m


def extrusion(length=200, profile="2020"):
    """Aluminium V-slot / T-slot bar along +X from x=0, cross-section centred on the X axis (fab.extrusion)."""
    from cadlib import fab
    m = Model()
    m.add("metal", ALU, fab.extrusion(float(length), profile=str(profile), axis="x"))
    return m

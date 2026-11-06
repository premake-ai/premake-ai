import cadquery as cq
from cadlib import fab
from cadlib.parts import part

# Magnetic motion-sensor stick light: wood-look printed body on top, frosted
# printed diffuser below, round wall disc it snaps onto with magnets.
W, D = 28.0, 30.0            # stick width (X) and depth (Y); back face on y=0
R = 6.0                      # vertical edge radius
L_DIFF, L_BODY = 110.0, 150.0
TOP = L_DIFF + L_BODY        # 260
WALL, BACK = 2.0, 4.0        # body side/front wall, back wall (magnet pockets)
DW = 1.6                     # diffuser wall
SPIG = 10.0                  # diffuser spigot length into the body
CLR = 0.15                   # spigot fit per side
DISC_D, DISC_T, GROOVE = 56.0, 10.0, 2.0
DISC_Z = 200.0
MAG_Z = (185.0, 215.0)       # 10x3 magnets, stick and disc
PIR_Z = 238.0
WOOD, DIFF = "#7a5232", "#f4f1ea"

SCENE = "wall"
CABLES = False


def rr(w, d, z0, h, r, yc=-D / 2):
    """Rounded-rectangle prism, centred on x=0 / y=yc, z0..z0+h."""
    s = cq.Workplane("XY").box(w, d, h, centered=(True, True, False))
    s = s.edges("|Z").fillet(r)
    return s.translate((0, yc, z0))


def y_cyl(dia, y0, y1, x, z):
    return (cq.Workplane("XZ").circle(dia / 2).extrude(-(y1 - y0))
            .translate((x, y0, z)))


def body():
    b = rr(W, D, L_DIFF, L_BODY, R)
    try:
        b = b.faces(">Z").edges().fillet(3)
    except Exception:
        pass
    iw, idp = W - 2 * WALL, D - WALL - BACK          # 24 x 24 cavity
    cav = rr(iw, idp, L_DIFF - 1, L_BODY - 3 + 1, 4, yc=-BACK - idp / 2)
    b = b.cut(cav)
    # USB-C charge slot through the top cap (plug body 12.5 x 7 -> 14 x 9)
    b = b.cut(cq.Workplane("XY").box(14, 9, 10).edges("|Z").fillet(2)
              .translate((0, -7.2, TOP - 1.5)))
    # PIR lens hole in the front wall
    b = b.cut(y_cyl(10.3, -D - 1, -D + WALL + 1, 0, PIR_Z))
    # magnet pockets from inside the back wall (0.8 mm skin)
    for z in MAG_Z:
        b = b.cut(y_cyl(10.3, -BACK - 0.5, -0.8, 0, z))
    # M2.5 screw into the diffuser spigot, counterbored for the pan head
    b = b.cut(y_cyl(2.9, -BACK - 0.5, 0.5, 0, L_DIFF + SPIG / 2))
    b = b.cut(y_cyl(5.6, -2.0, 0.5, 0, L_DIFF + SPIG / 2))
    return b


def diffuser():
    d = rr(W, D, 0, L_DIFF, R)
    try:
        d = d.faces("<Z").edges().fillet(3)
    except Exception:
        pass
    d = d.cut(rr(W - 2 * DW, D - 2 * DW, DW, L_DIFF - 2 - DW, R - DW))
    # spigot that plugs into the body, thick at the back for the screw
    iw, idp = W - 2 * WALL - 2 * CLR, D - WALL - BACK - 2 * CLR
    sp = rr(iw, idp, L_DIFF - 1, SPIG + 1, 4 - CLR, yc=-BACK - CLR - idp / 2)
    d = d.union(sp)
    hole_w = iw - 2 * DW
    y_front = -D + WALL + CLR + DW
    y_back = -BACK - CLR - 5.0
    d = d.cut(rr(hole_w, y_back - y_front, L_DIFF - 3, SPIG + 4, 2,
                 yc=(y_back + y_front) / 2))
    d = d.cut(y_cyl(fab.pilot(2.5), -BACK - 6.5, -BACK, 0, L_DIFF + SPIG / 2))
    return d


def disc():
    c = y_cyl(DISC_D, -GROOVE, DISC_T - GROOVE, 0, DISC_Z)
    try:
        c = c.faces("<Y").edges().fillet(2.5)
        c = c.faces(">Y").edges().chamfer(0.6)
    except Exception:
        pass
    # locating channel the stick sits in (stops it sliding sideways)
    c = c.cut(cq.Workplane("XY").box(W + 0.6, GROOVE + 1, DISC_D + 2)
              .translate((0, -GROOVE / 2 - 0.5, DISC_Z)))
    for z in MAG_Z:
        c = c.cut(y_cyl(10.2, -0.5, 3.3, 0, z))
    # two countersunk wall-screw holes (#6 wood screw + anchor)
    for x in (-20.0, 20.0):
        c = c.cut(y_cyl(4.0, -GROOVE - 1, DISC_T, x, DISC_Z))
        c = c.cut(cq.Workplane("XZ").circle(4.2).workplane(offset=-2.2)
                  .circle(2.0).loft().translate((x, -GROOVE, DISC_Z)))
    return c


def magnets(y0):
    m = None
    for z in MAG_Z:
        s = y_cyl(10.0, y0, y0 + 3.0, 0, z)
        m = s if m is None else m.union(s)
    return m


def electronics():
    tp = (cq.Workplane("XY").box(17, 1.6, 28, centered=(True, False, False))
          .translate((0, -5.8, TOP - 30)))
    tp = tp.union(cq.Workplane("XY").box(9, 3.2, 7.5, centered=(True, False, False))
                  .translate((0, -9.0, TOP - 9.5)))
    pir = y_cyl(9.6, -D + 0.6, -D + 12, 0, PIR_Z)
    pir = pir.union(cq.Workplane("XZ").sphere(4.8).translate((0, -D + 0.6, PIR_Z))
                    .intersect(y_cyl(9.6, -D - 5, -D + 0.6, 0, PIR_Z)))
    pir = pir.union(cq.Workplane("XY").box(12, 1.2, 12).translate((0, -D + 12.6, PIR_Z)))
    return [
        {"name": "TP4056 USB-C charger (protected)", "shape": tp, "group": "component",
         "color": "#1d4fa0"},
        {"name": "AM312 mini PIR sensor", "shape": pir, "group": "component",
         "color": "#e8e8e8", "material": "acrylic_frosted"},
        {"name": "Stick magnet 10x3", "shape": magnets(-3.9), "group": "component",
         "material": "steel"},
        {"name": "Disc magnet 10x3", "shape": magnets(0.3), "group": "component",
         "material": "steel"},
    ]


def parts():
    hold_z = 147.0 + 77.0 / 2
    lib = [
        part("ws2812_strip", length=100, at=(0, -DW, 5), rot=(0, -90, 90)),
        part("esp32_c3_supermini", at=(0, -BACK - 0.2, 133.5), rot=(0, -90, 90)),
        part("holder_18650", at=(0, -BACK - 0.2, hold_z), rot=(0, -90, 90)),
        part("cell_18650", at=(0, -BACK - 1.4, hold_z), rot=(0, -90, 90)),
        part("m25x6_selftap", at=(0, -2.0, L_DIFF + SPIG / 2), rot=(-90, 0, 0)),
    ]
    lib[0]["fx"] = {"glow": {"color": "#ffd59a", "mode": "solid"}}
    return [
        {"name": "Body", "shape": body(), "color": WOOD,
         "notes": "wood-fill PLA, print top-cap down"},
        {"name": "Diffuser", "shape": diffuser(), "color": DIFF,
         "material": "acrylic_frosted", "notes": "natural PETG, print closed end down"},
        {"name": "Wall disc", "shape": disc(), "color": "#6b4529", "explode": [0, 1, 0]},
        *electronics(),
        *lib,
    ]


STICK = ["Body", "Diffuser", "TP4056 USB-C charger (protected)", "AM312 mini PIR sensor",
         "Stick magnet 10x3", "WS2812B LED strip, 6 LEDs", "ESP32-C3 SuperMini",
         "18650 holder, 1 cell", "M2.5×6 self-tapping screw for plastic"]


def motion():
    keys = [[0, 0], [0.25, 45], [0.45, 45], [0.6, 45], [0.8, 0], [1, 0]]
    return [{"part": n, "type": "slide", "axis": [0, -1, 0], "keys": keys} for n in STICK]

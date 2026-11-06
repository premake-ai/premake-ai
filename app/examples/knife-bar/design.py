"""Magnetic knife bar: 240 mm bar with 10 embedded N52 bar magnets (pause-at-height insert).

Z up, mm, wall at +Y (back face y = 0), front faces -Y.
Print front face down; pause at the layer above the magnet pockets and drop magnets in.
"""
import cadquery as cq

L, H, T = 240.0, 40.0, 15.0
SKIN = 1.2              # plastic between magnet and blade
MAG = (20.0, 10.0, 3.0)  # magnet: long (Z) x wide (X) x thick (Y)
N_MAG = 10


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def mag_xs():
    pitch = (L - 30) / (N_MAG - 1)
    return [-(L - 30) / 2 + i * pitch for i in range(N_MAG)]


def make_bar():
    b = box(-L / 2, L / 2, -T, 0, 0, H)
    try:
        b = b.edges("|Y").fillet(8.0)
        b = b.faces("<Y").edges().fillet(4.0)
    except Exception:
        pass
    # shallow decorative grooves top & bottom of the front face
    for z in (6.0, H - 6.0):
        b = b.cut(box(-L / 2 + 14, L / 2 - 14, -T - 1, -T + 0.6, z - 0.6, z + 0.6))
    # closed magnet pockets (0.2 mm clearance)
    for x in mag_xs():
        b = b.cut(box(x - MAG[1] / 2 - 0.2, x + MAG[1] / 2 + 0.2, -T + SKIN, -T + SKIN + MAG[2] + 0.3,
                      H / 2 - MAG[0] / 2 - 0.2, H / 2 + MAG[0] / 2 + 0.2))
    # two keyhole slots in the back for #8 screws
    for x in (-80.0, 80.0):
        b = b.cut(cq.Workplane("XZ").center(x, H / 2 - 4).circle(5.0).extrude(4.0))
        b = b.cut(box(x - 2.4, x + 2.4, -4.0, 0.1, H / 2 - 4, H / 2 + 6))
        b = b.cut(box(x - 5.0, x + 5.0, -7.5, -4.0, H / 2 - 9, H / 2 + 8))
    return b


def make_magnets():
    out = None
    for x in mag_xs():
        m = box(x - MAG[1] / 2, x + MAG[1] / 2, -T + SKIN + 0.1, -T + SKIN + 0.1 + MAG[2],
                H / 2 - MAG[0] / 2, H / 2 + MAG[0] / 2)
        out = m if out is None else out.union(m)
    return out


def make_screws():
    out = None
    for x in (-80.0, 80.0):
        s = (cq.Workplane("XZ").center(x, H / 2 - 4).circle(2.1).extrude(-40).translate((0, -6.5, 0))
             .union(cq.Workplane("XZ").center(x, H / 2 - 4).circle(4.2).extrude(2.4).translate((0, -4.2, 0))))
        out = s if out is None else out.union(s)
    return out


def parts():
    return [
        {"name": "Knife bar", "shape": make_bar(), "group": "case", "color": "#c98b5a", "explode": [0, 1, 0]},
        {"name": "N52 bar magnets 20x10x3 (10x)", "shape": make_magnets(), "group": "component",
         "color": "#7a7f87", "explode": [0, -1, 0]},
        {"name": "#8 x 1-1/2 in pan screws + anchors (2x)", "shape": make_screws(), "group": "component",
         "color": "#b0b5bb", "explode": [0, 1, 0]},
    ]

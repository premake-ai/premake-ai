import cadquery as cq
from cadlib import fab

# CoreXY printer: 2020 cube frame, MGN12 rails, stacked-belt CoreXY gantry,
# cantilever Z bed on 2 rods + T8 leadscrew, ~220 x 220 x 250 mm build volume.
W = 420                  # frame outer X/Y
H = 460                  # frame height
E = 20                   # extrusion size
FZ = 11                  # frame sits on 3 mm acrylic base + 8 mm feet
IN = W - 2 * E           # horizontal bar length (380)
C = W / 2 - E / 2        # bar centre offset (200)
ZT = FZ + H - E / 2      # top bar centre z
TT = FZ + H              # top of frame
YP = 0                   # gantry Y position shown
BZ = 300                 # bed top z shown
BELT_A, BELT_B = 482, 494

PLA = "#2b2f36"
ACC = "#ff6a00"
ALU = "#b8bcc2"
STEEL = "#8a8f96"


def box(sx, sy, sz, x, y, z):
    """Box by size and centre."""
    return cq.Workplane("XY").box(sx, sy, sz).translate((x, y, z))


def span(x0, x1, y0, y1, z0, z1):
    """Box by min/max extents."""
    return box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)


def cyl(d, z0, z1, x, y):
    return cq.Workplane("XY").circle(d / 2).extrude(z1 - z0).translate((x, y, z0))


def ext(name, length, axis, at, taps=2):
    return {"name": name, "shape": fab.extrusion(length, profile="2020", axis=axis, at=at),
            "group": "case", "process": "extrusion", "color": ALU,
            "params": {"profile": "2020", "length_mm": length, "tapped_ends": taps}}


def pr(name, shape, color=PLA, explode=None):
    d = {"name": name, "shape": shape, "group": "case", "process": "print", "color": color}
    if explode:
        d["explode"] = explode
    return d


def comp(name, shape, color="#555a60"):
    return {"name": name, "shape": shape, "group": "component", "color": color}


def parts():
    p = []

    # ---------------- frame ----------------
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.append(ext("Upright", H, "z", (sx * C, sy * C, FZ)))
    for z in (FZ + E / 2, ZT):
        for s in (-1, 1):
            p.append(ext("Frame bar X", IN, "x", (-IN / 2, s * C, z)))
            p.append(ext("Frame bar Y", IN, "y", (s * C, -IN / 2, z)))

    # 400 x 400 so it fits the laser bed; M5 holes into the bottom bars' T-slots
    base = span(-200, 200, -200, 200, 8, 11)
    for a in (-120, 0, 120):
        for s in (-1, 1):
            base = base.cut(cyl(5.5, 7, 12, a, s * 196)).cut(cyl(5.5, 7, 12, s * 196, a))
    p.append({"name": "Base plate", "shape": base, "group": "case", "process": "laser",
              "params": {"material": "acrylic", "thickness_mm": 3}, "color": "#1a1a1a",
              "explode": [0, 0, -1]})
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.append(comp("Rubber foot", cyl(20, 0, 8, sx * 185, sy * 185), "#111111"))

    # ---------------- Y rails + XY joints ----------------
    for s in (-1, 1):
        sx = "L" if s < 0 else "R"
        p.append(comp("MGN12 rail 350", span(*sorted((s * 172, s * 180)), -170, 180, ZT - 6, ZT + 6), STEEL))
        p.append(comp("MGN12H carriage", span(*sorted((s * 162, s * 172)), YP - 22.5, YP + 22.5, ZT - 13.5, ZT + 13.5), STEEL))
        j = span(*sorted((s * 132, s * 162)), YP - 25, YP + 25, ZT - 18, BELT_B + 8)
        j = j.cut(span(*sorted((s * 120, s * 140)), YP - 10.2, YP + 10.2, ZT - 10.2, ZT + 10.2))
        p.append(pr(f"XY joint {sx}", j, PLA, [s, 0, 0.3]))
        for z in (BELT_A, BELT_B):
            p.append(comp("GT2 idler", cyl(18, z - 4, z + 4, s * 150, YP + 14), STEEL))

    # X beam + X rail + toolhead
    p.append(ext("X beam", 264, "x", (-132, YP, ZT), taps=0))
    p.append(comp("MGN12 rail 250", span(-125, 125, YP - 18, YP - 10, ZT - 6, ZT + 6), STEEL))
    p.append(comp("MGN12H carriage", span(-22.5, 22.5, YP - 28, YP - 18, ZT - 13.5, ZT + 13.5), STEEL))

    th = span(-30, 30, YP - 72, YP - 28, ZT - 50, BELT_B + 6)
    th = th.cut(span(-14, 14, YP - 64, YP - 36, ZT - 51, ZT + 10))          # hotend bay
    th = th.cut(span(-31, -20, YP - 70, YP - 30, ZT - 40, ZT - 2))        # fan duct pocket
    p.append(pr("Toolhead", th, ACC, [0, -1, 0]))
    p.append(comp("V6 hotend", cyl(22, ZT - 66, ZT - 20, 0, YP - 50).union(
        cyl(6, ZT - 82, ZT - 66, 0, YP - 50)), "#c0c0c0"))
    p.append(comp("Direct drive extruder", span(-22, 22, YP - 70, YP - 30, BELT_B + 6, BELT_B + 46), "#333333"))
    p.append(comp("4010 hotend fan", span(-40, -30, YP - 70, YP - 30, ZT - 40, ZT), "#222222"))
    p.append(comp("4010 blower", span(30, 50, YP - 70, YP - 30, ZT - 45, ZT - 5), "#222222"))

    # ---------------- motors, idlers, belts ----------------
    for s in (-1, 1):
        mx, my = s * 180, 235
        mm = span(*sorted((s * 150, s * 210)), 190, 258, TT, TT + 6)
        mm = mm.cut(cyl(23, TT - 1, TT + 7, mx, my))
        p.append(pr("Motor mount", mm, PLA, [0, 1, 0]))
        p.append(comp("NEMA17 XY", fab.nema17(40).translate((mx, my, TT)), "#333333"))
        p.append(comp("GT2 pulley 20T", cyl(16, TT + 8, BELT_B + 6, mx, my), STEEL))

        im = span(*sorted((s * 160, s * 210)), -210, -165, TT, BELT_B + 10)
        im = im.cut(span(*sorted((s * 165, s * 195)), -196, -170, BELT_A - 6, BELT_B + 6))
        p.append(pr("Front idler mount", im, PLA, [0, -1, 0]))
        for z in (BELT_A, BELT_B):
            p.append(comp("GT2 idler", cyl(18, z - 4, z + 4, s * 180, -183), STEEL))

    # two stacked belt loops (shown as thin strips)
    for z, s in ((BELT_A, -1), (BELT_B, 1)):
        b = span(*sorted((s * 189, s * 187)), -192, 235, z - 3, z + 3)          # outer Y run
        b = b.union(span(*sorted((s * 171, s * 169)), -192, YP + 14, z - 3, z + 3))  # inner Y run
        b = b.union(span(*sorted((-s * 171, -s * 169)), YP + 14, 235, z - 3, z + 3))  # far side run
        b = b.union(span(-150, 150, YP + 22, YP + 24, z - 3, z + 3))              # across gantry
        p.append(comp("GT2 belt 6 mm", b, "#151515"))

    # ---------------- Z axis ----------------
    zy = 172
    for s in (-1, 1):
        p.append(comp("8 mm rod 420", cyl(8, FZ + 20, FZ + 440, s * 70, zy), STEEL))
        bh = span(s * 70 - 14, s * 70 + 14, 156, 190, FZ, FZ + 40).cut(cyl(8.2, FZ + 5, FZ + 41, s * 70, zy))
        p.append(pr("Rod holder low", bh, PLA))
        th_ = span(s * 70 - 14, s * 70 + 14, 156, 190, ZT - 40, TT).cut(cyl(8.2, ZT - 41, ZT - 5, s * 70, zy))
        p.append(pr("Rod holder high", th_, PLA))

    zm = span(-30, 30, 150, 190, FZ + 44, FZ + 49).union(span(-30, 30, 185, 190, FZ, FZ + 49))
    zm = zm.cut(cyl(23, FZ + 43, FZ + 50, 0, zy))
    p.append(pr("Z motor mount", zm, PLA))
    p.append(comp("NEMA17 Z", fab.nema17(40).translate((0, zy, FZ + 44)), "#333333"))
    p.append(comp("T8 leadscrew 400", cyl(8, FZ + 70, FZ + 430, 0, zy).union(
        cyl(19, FZ + 49, FZ + 74, 0, zy)), STEEL))

    zc = span(-100, 100, 152, 188, BZ - 60, BZ - 15)
    for s in (-1, 1):
        zc = zc.cut(cyl(15.2, BZ - 61, BZ - 14, s * 70, zy))
        zc = zc.cut(span(s * 90 - 10.2, s * 90 + 10.2, 151, 170, BZ - 45.2, BZ - 24.8))
    zc = zc.cut(cyl(10, BZ - 61, BZ - 14, 0, zy))
    p.append(pr("Z carriage", zc, PLA, [0, 1, 0]))
    for s in (-1, 1):
        p.append(comp("LM8UU bearing", cyl(15, BZ - 57, BZ - 33, s * 70, zy), STEEL))
        p.append(ext("Bed arm", 320, "y", (s * 90, -155, BZ - 35), taps=1))
    for sx in (-1, 1):
        for y in (-107, 87):
            p.append(comp("Silicone bed spacer", cyl(10, BZ - 25, BZ - 3, sx * 90, y), "#cc3333"))
    p.append(comp("Heated bed 235 24V", span(-117.5, 117.5, -127.5, 107.5, BZ - 3, BZ), "#202020"))
    p.append(comp("PEI spring sheet", span(-117.5, 117.5, -127.5, 107.5, BZ, BZ + 1), "#c9a227"))

    # ---------------- electronics ----------------
    p.append(comp("SKR Mini E3 V3 board", span(-182, -80, -185, -114, FZ + 6, FZ + 26), "#1f5f2f"))
    cov = span(-188, -72, -190, -106, FZ, FZ + 40)
    cov = cov.cut(span(-185, -75, -187, -109, FZ - 1, FZ + 37))
    for i in range(6):
        cov = cov.cut(span(-170 + i * 15, -164 + i * 15, -180, -116, FZ + 36, FZ + 41))
    p.append(pr("Board cover", cov, PLA, [0, 0, 1]))
    p.append(pr("Display bracket", span(60, 160, -215, -210, FZ, FZ + 85), PLA))
    p.append(comp("12864 LCD display", span(62, 158, -233, -215, FZ + 5, FZ + 83), "#0b3d91"))
    p.append(pr("Power inlet plate", span(110, 150, 210, 215, FZ, FZ + 30).cut(
        cq.Workplane("XZ").circle(5.5).extrude(-10).translate((130, 208, FZ + 15))), PLA))
    p.append(comp("DC panel jack", cq.Workplane("XZ").circle(6).extrude(-15).translate((130, 203, FZ + 15)), "#111111"))
    return p

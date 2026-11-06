"""Folding laptop stand: laser-cut birch ply deck + leg on two butt hinges,
printed stop bar takes the leg's thrust, folds to ~13 mm thick.
Built in deck-local coords (deck bottom z=0, front edge y=0), then tilted by ANG."""
import math
import cadquery as cq

W, D, T = 280, 240, 6          # deck, 6 mm birch ply
ANG = 20                       # deck tilt, deg
YH = 215                       # leg rear face (hinge line)
FOOT = 3.5                     # front rubber bumpers (12.7 x 3.5)
STRIP = 1.6                    # neoprene strip on leg foot
LEG_W, LEG_TOP = 240, -2.0     # leg width, gap under deck for hinge knuckle
HX = 85                        # hinge centres +-x
AX_Y, AX_Z = YH - T - 2.5, -2.5  # hinge pin (local)
LEAF, LT, HL = 19, 1.5, 38     # hinge leaf width, thickness, length
BAR_L, BAR_Y, BAR_Z = 120, 14, 12
LAP = (312.6, 221.2, 15.5)     # 14" laptop reference

_s, _c = math.sin(math.radians(ANG)), math.cos(math.radians(ANG))
LEG_L = round(((YH - T) * _s + FOOT) / _c + LEG_TOP - STRIP, 1)
PLY = {"material": "birch plywood", "thickness_mm": 6}


def place(s):
    return s.rotate((0, 0, 0), (1, 0, 0), ANG).translate((0, -D / 2, FOOT))


def world(y, z):
    return (0, y * _c - z * _s - D / 2, y * _s + z * _c + FOOT)


def xz_plate(w, h, r, y0, t):
    """Rounded w x h rectangle in XZ (x centred, z 0..h), extruded +Y from y0."""
    p = cq.Workplane("XZ").center(0, h / 2).rect(w, h).extrude(-t)
    try:
        p = p.edges("|Y").fillet(r)
    except Exception:
        pass
    return p.translate((0, y0, 0))


def deck():
    d = cq.Workplane("XY").box(W, D, T, centered=(True, False, False))
    d = d.edges("|Z").fillet(15)
    slots = cq.Workplane("XY").pushPoints(
        [(x, y) for x in (-80, 0, 80) for y in range(40, 181, 20)]).slot2D(70, 8).extrude(T)
    tabs = cq.Workplane("XY").pushPoints([(x, 5) for x in (-90, 0, 90)]).rect(30.2, 6.2).extrude(T)
    return d.cut(slots).cut(tabs)


def lip():
    body = xz_plate(W - 20, 14, 5, 2, T).translate((0, 0, T))
    try:
        body = body.faces(">Z").edges("|Y").fillet(5)
    except Exception:
        pass
    tabs = cq.Workplane("XY").pushPoints([(x, 5) for x in (-90, 0, 90)]).rect(30, 6).extrude(T + 1)
    return body.union(tabs)


def leg():
    l = xz_plate(LEG_W, LEG_L, 10, YH - T, T).translate((0, 0, LEG_TOP - LEG_L))
    win = xz_plate(150, LEG_L - 44, 12, YH - T - 1, T + 2).translate((0, 0, LEG_TOP - LEG_L + 22))
    return l.cut(win)


def stop_bar():
    b = cq.Workplane("XY").box(BAR_L, BAR_Y, BAR_Z, centered=(True, False, False)).translate((0, YH, -BAR_Z))
    try:
        b = b.edges("<Z or |Z").chamfer(1.5)
    except Exception:
        pass
    pts = [(x, YH + BAR_Y / 2) for x in (-40, 40)]
    b = b.cut(cq.Workplane("XY").pushPoints(pts).circle(1.6).extrude(BAR_Z).translate((0, 0, -BAR_Z)))
    return b.cut(cq.Workplane("XY").pushPoints(pts).circle(3.4).extrude(BAR_Z - 5).translate((0, 0, -BAR_Z)))


def hinge_deck():
    out = None
    for x in (-HX, HX):
        leaf = cq.Workplane("XY").box(HL, LEAF, LT, centered=(True, False, False)).translate((x, AX_Y - LEAF, -LT))
        pin = cq.Workplane("YZ").circle(2.5).extrude(HL).translate((x - HL / 2, AX_Y, AX_Z))
        h = leaf.union(pin)
        out = h if out is None else out.union(h)
    return out


def hinge_leg():
    return cq.Workplane("XY").pushPoints([(x, 0) for x in (-HX, HX)]).box(
        HL, LT, LEAF, centered=(True, False, False)).translate((0, YH - T - LT, AX_Z - LEAF - 1))


def heads(pts, d=5.5, h=1.5):
    out = None
    for (x, y, z, axis) in pts:
        c = cq.Workplane("XY").circle(d / 2).extrude(h) if axis == "z" else \
            cq.Workplane("XZ").circle(d / 2).extrude(h)
        c = c.translate((x, y, z))
        out = c if out is None else out.union(c)
    return out


def parts():
    deck_screws = heads([(x + dx, AX_Y - 11, -LT - 1.5, "z") for x in (-HX, HX) for dx in (-10, 10)])
    leg_screws = heads([(x + dx, YH - T - LT, AX_Z - 12, "y") for x in (-HX, HX) for dx in (-10, 10)])
    bar_screws = heads([(x, YH + BAR_Y / 2, -7, "z") for x in (-40, 40)], d=5.5, h=2)
    bumpers = cq.Workplane("XY").pushPoints([(-110, 20), (110, 20)]).circle(6.35).extrude(FOOT).translate((0, 0, -FOOT))
    strips = cq.Workplane("XY").pushPoints([(-95, YH - T / 2), (95, YH - T / 2)]).rect(40, 6).extrude(STRIP) \
        .translate((0, 0, LEG_TOP - LEG_L - STRIP))
    laptop = cq.Workplane("XY").box(*LAP, centered=(True, False, False)).edges("|Z").fillet(8) \
        .translate((0, 9, T))

    return [
        {"name": "Deck", "shape": place(deck()), "group": "case", "process": "laser", "params": PLY, "color": "#d9b98a"},
        {"name": "Lip", "shape": place(lip()), "group": "case", "process": "laser", "params": PLY,
         "color": "#c9a46f", "explode": [0, 0, 1]},
        {"name": "Leg", "id": "leg", "shape": place(leg()), "group": "case", "process": "laser", "params": PLY,
         "color": "#d9b98a", "explode": [0, 1, -1]},
        {"name": "Stop bar", "shape": place(stop_bar()), "group": "case", "process": "print",
         "color": "#2b2b2b", "explode": [0, 1, -1]},
        {"name": "Hinges (deck leaves)", "shape": place(hinge_deck()), "group": "component", "color": "#b8b8b8"},
        {"name": "Hinges (leg leaves)", "id": "hleg", "shape": place(hinge_leg()), "group": "component", "color": "#b8b8b8"},
        {"name": "Hinge screws (deck)", "shape": place(deck_screws), "group": "component", "color": "#777777"},
        {"name": "Hinge screws (leg)", "id": "sleg", "shape": place(leg_screws), "group": "component", "color": "#777777"},
        {"name": "Stop bar screws", "shape": place(bar_screws), "group": "component", "color": "#777777"},
        {"name": "Rubber bumpers", "shape": place(bumpers), "group": "component", "color": "#222222"},
        {"name": "Leg grip strips", "id": "strip", "shape": place(strips), "group": "component", "color": "#222222"},
        {"name": "Your laptop (14 in, reference)", "shape": place(laptop), "group": "component",
         "color": "#9aa0a6", "explode": [0, 0, 1]},
    ]


def motion():
    p = world(AX_Y, AX_Z)
    return [{"part": i, "type": "rotate", "axis": [1, 0, 0], "pivot": list(p),
             "keys": [[0, 0], [0.4, -90], [0.6, -90], [1, 0]]} for i in ("leg", "hleg", "sleg", "strip")]

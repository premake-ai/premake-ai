"""Lick mat tray: a low frame that locks a square silicone lick mat in place so a keen dog can't
flip it, chew the edge or push it across the kitchen. A 45-degree retaining lip holds the mat edges down,
the honeycomb floor keeps it light and rinsable, and four TPU feet grip the floor.

Sized by parameter to the mat you sell with it. Z up, mm, front faces -Y.
Tray prints upright (the lip is 45 deg from below), feet print in TPU 95A. No supports.
"""
import math
import cadquery as cq

P = {
    "mat": 200.0,          # square mat side
    "mat_t": 9.0,          # mat thickness at the edge
    "wall": 2.6, "floor": 2.2,
    "rim_extra": 4.0,      # rim height above the mat surface
    "clear": 1.5,          # around the mat
    "hex": 15.0,           # honeycomb cell across flats
    "rib": 2.6,
    "foot_d": 14.0, "foot_h": 3.0,
}
C_TRAY, C_FOOT = "#f4a261", "#264653"


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def tray():
    m, w, f = P["mat"], P["wall"], P["floor"]
    inner = m + 2 * P["clear"]
    outer = inner + 2 * w
    H = f + P["mat_t"] + P["rim_extra"]
    z0 = P["foot_h"]
    t = box(-outer / 2, outer / 2, -outer / 2, outer / 2, 0, H)
    try:
        t = t.edges("|Z").fillet(14.0)
    except Exception:
        pass
    pocket = box(-inner / 2, inner / 2, -inner / 2, inner / 2, f, H + 1)
    try:
        pocket = pocket.edges("|Z").fillet(14.0 - w)
    except Exception:
        pass
    t = t.cut(pocket)
    # honeycomb floor, leaving a solid border and pads at the feet
    hx, rib = P["hex"], P["rib"]
    pitch_x = hx + rib
    pitch_y = pitch_x * math.sqrt(3) / 2
    lim = inner / 2 - 9.0
    pts = []
    pad = inner / 2 - 22.0
    j = 0
    y = -lim
    while y <= lim + 0.01:
        x = -lim + (pitch_x / 2 if j % 2 else 0.0)
        while x <= lim + 0.01:
            near_foot = abs(abs(x) - pad) < 13 and abs(abs(y) - pad) < 13
            if not near_foot:
                pts.append((y, x))
            x += pitch_x
        y += pitch_y
        j += 1
    cells = cq.Workplane("XY").pushPoints(pts).polygon(6, hx / math.cos(math.radians(30))).extrude(f + 2).translate((0, 0, -1))
    t = t.cut(cells)
    # retaining lip all round: 3 mm over the mat edge, 45 deg underside prints without support
    zt = f + P["mat_t"] + 0.6
    lip = 3.0
    shell = box(-outer / 2, outer / 2, -outer / 2, outer / 2, zt, H)
    try:
        shell = shell.edges("|Z").fillet(14.0)
    except Exception:
        pass
    hole = (cq.Workplane("XY").rect(inner, inner).workplane(offset=lip).rect(inner - 2 * lip, inner - 2 * lip)
            .loft().translate((0, 0, zt - 0.01)))
    hole = hole.union(box(-inner / 2 + lip, inner / 2 - lip, -inner / 2 + lip, inner / 2 - lip, zt + lip - 0.1, H + 1))
    t = t.union(shell.cut(hole))
    # finger notch to lift the mat out
    t = t.cut(cq.Workplane("XZ").center(0, H).circle(13.0).extrude(outer).translate((0, outer / 2, 0)))
    try:
        t = t.faces(">Z").edges().fillet(1.0)
    except Exception:
        pass
    # foot sockets
    for sx in (-1, 1):
        for sy in (-1, 1):
            t = t.cut(cq.Workplane("XY").center(sx * pad, sy * pad).circle(3.1).extrude(f - 0.6))
    return t.translate((0, 0, z0))


def feet():
    pad = P["mat"] / 2 + P["clear"] - 22.0
    out = None
    for sx in (-1, 1):
        for sy in (-1, 1):
            ft = cq.Workplane("XY").circle(P["foot_d"] / 2).extrude(P["foot_h"])
            try:
                ft = ft.faces("<Z").edges().fillet(1.2)
            except Exception:
                pass
            ft = ft.union(cq.Workplane("XY").circle(3.0).extrude(P["floor"] - 0.8).translate((0, 0, P["foot_h"])))
            ft = ft.translate((sx * pad, sy * pad, 0))
            out = ft if out is None else out.union(ft)
    return out


def parts():
    return [
        {"name": "Tray", "shape": tray(), "group": "case", "color": C_TRAY, "explode": [0, 0, 1]},
        {"name": "Grip feet (TPU, x4)", "shape": feet(), "group": "case", "color": C_FOOT, "explode": [0, 0, -1]},
    ]

import cadquery as cq

SCENE = "counter"

L, W, T = 110.0, 72.0, 5.0      # pad size, base thickness
R = 14.0                        # corner radius
NUB_D, NUB_H, PITCH = 3.2, 7.0, 6.5
HANG_D = 9.0                    # hanging hole


def pad():
    body = (cq.Workplane("XY").rect(L, W).extrude(T)
            .edges("|Z").fillet(R))
    try:
        body = body.faces(">Z or <Z").edges().fillet(1.5)
    except Exception:
        pass

    # bristle nubs on top, kept clear of the rim, the hang hole and the drain slots
    pts = []
    nx, ny = int((L - 14) // PITCH), int((W - 12) // PITCH)
    for i in range(nx + 1):
        for j in range(ny + 1):
            x = -(nx * PITCH) / 2 + i * PITCH
            y = -(ny * PITCH) / 2 + j * PITCH
            if x < -L / 2 + 20 and abs(y) < 10:      # hang hole area
                continue
            if (abs(x) - R) ** 2 + (abs(y) - (W / 2 - R)) ** 2 > (R - 4) ** 2 \
                    and abs(x) > L / 2 - R and abs(y) > W / 2 - R:
                continue                              # outside rounded corners
            if abs(y) < 3.5 and abs(x) < 34:          # centre drain slot row
                continue
            pts.append((x, y))
    nubs = (cq.Workplane("XY").workplane(offset=T - 0.5).pushPoints(pts)
            .circle(NUB_D / 2).extrude(NUB_H + 0.5))
    try:
        nubs = nubs.faces(">Z").edges().fillet(1.0)
    except Exception:
        pass
    body = body.union(nubs)

    # drain slots (through) so it drains and dries fast: no trapped water, no smell
    slots = (cq.Workplane("XY").pushPoints([(-17, 0), (17, 0)])
             .slot2D(30, 4).extrude(T * 3).translate((0, 0, -T)))
    body = body.cut(slots)

    # hanging hole
    hole = (cq.Workplane("XY").center(-L / 2 + 11, 0).circle(HANG_D / 2)
            .extrude(T * 3).translate((0, 0, -T)))
    body = body.cut(hole)

    # scraper grooves on the underside (shallow, 45 deg-friendly V-free channels)
    for k in range(-4, 5):
        g = cq.Workplane("XY").center(k * 10 + 5, 0).rect(1.6, W - 30).extrude(1.0)
        body = body.cut(g.translate((0, 0, -0.01)))
    return body


def parts():
    return [{
        "name": "Scrubber pad",
        "shape": pad(),
        "group": "case",
        "process": "print",
        "params": {"material": "TPU 95A"},
        "color": "#3fb59a",
    }]

import cadquery as cq

H = 100.0       # cup height
R_BOT = 35.0    # outer radius at base
R_TOP = 42.0    # outer radius at rim
WALL = 2.6
FLOOR = 3.0


def _revolve(pts):
    return cq.Workplane("XZ").polyline(pts).close().revolve(360, (0, 0, 0), (0, 1, 0))


def _cavity():
    return _revolve([(0, FLOOR), (R_BOT - WALL, FLOOR), (R_TOP - WALL, H + 1), (0, H + 1)])


def cup():
    body = _revolve([(0, 0), (R_BOT, 0), (R_TOP, H), (0, H)])
    try:
        body = body.faces("<Z").edges().fillet(3)
    except Exception:
        pass
    body = body.cut(_cavity())
    try:
        body = body.faces(">Z").edges().fillet(1.0)
    except Exception:
        pass
    try:
        body = body.faces(">Z[1]").edges().fillet(4)  # inner floor corner
    except Exception:
        pass

    # D-shaped handle on +X
    cx, cz = 52.0, 55.0
    outer = cq.Workplane("XZ").center(cx, cz).rect(30, 64).extrude(6, both=True).edges("|Y").fillet(12)
    inner = cq.Workplane("XZ").center(cx + 2, cz).rect(18, 46).extrude(10, both=True).edges("|Y").fillet(7)
    handle = outer.cut(inner)
    try:
        handle = handle.edges().fillet(2.5)
    except Exception:
        pass
    return body.union(handle).cut(_cavity())


def parts():
    return [{"name": "Cup", "shape": cup(), "group": "case", "process": "print", "color": "#e8e2d6"}]

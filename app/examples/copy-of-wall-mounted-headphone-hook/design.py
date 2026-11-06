import cadquery as cq

SCENE = "wall"

W = 40.0        # hook width (X)
T = 6.0         # wall plate thickness
H = 110.0       # wall plate height
ARM_TOP = 58.0  # headband rests here
ARM_T = 10.0
REACH = 62.0    # depth of the saddle from the wall
SCREW_Z = (12.0, 98.0)


def hook():
    pts = [
        (0, 0), (0, H), (-T, H), (-T, ARM_TOP),
        (-REACH, ARM_TOP), (-REACH, ARM_TOP + 14), (-REACH - 9, ARM_TOP + 14),
        (-REACH - 9, ARM_TOP - ARM_T), (-34, ARM_TOP - ARM_T),
        (-T, 26), (-T, 0),
    ]
    # YZ workplane: local x = Y, local y = Z, extrude along +X
    body = cq.Workplane("YZ").polyline(pts).close().extrude(W).translate((-W / 2, 0, 0))
    for r, sel in ((2.0, "|X"),):
        try:
            body = body.edges(sel).fillet(r)
        except Exception:
            pass
    try:
        body = body.faces("<X or >X").edges().fillet(1.5)
    except Exception:
        pass
    # countersunk holes for #8 wood screws (4.5 shank, 9 head), head on the front face
    for z in SCREW_Z:
        shank = cq.Solid.makeCylinder(2.4, T + 2, cq.Vector(0, 1, z), cq.Vector(0, -1, 0))
        csk = cq.Solid.makeCone(2.4, 4.8, 2.6, cq.Vector(0, -T + 2.6, z), cq.Vector(0, -1, 0))
        body = body.cut(cq.Workplane().add(shank)).cut(cq.Workplane().add(csk))
    return body


def screw(z):
    head = cq.Solid.makeCone(2.2, 4.5, 2.5, cq.Vector(0, -T + 2.5, z), cq.Vector(0, -1, 0))
    shank = cq.Solid.makeCylinder(2.1, 32, cq.Vector(0, -T + 2.5, z), cq.Vector(0, 1, 0))
    return cq.Workplane().add(head.fuse(shank))


def parts():
    out = [{"name": "Headphone hook", "shape": hook(), "group": "case",
            "process": "print", "color": "#2b2f36"}]
    for i, z in enumerate(SCREW_Z):
        out.append({"name": "#8 wood screw", "id": f"screw{i}", "shape": screw(z),
                    "group": "component", "color": "#b8b8b8", "explode": [0, -1, 0]})
    return out

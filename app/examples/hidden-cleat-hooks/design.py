"""Hidden-cleat wall hooks: each hook drops onto a small 45-degree cleat screwed to the wall.
The cleat sits in a pocket in the back of the hook, so from the front you see a clean J-hook
and no screw. The bevel pulls the hook tight to the wall as it's loaded, and it lifts off for
painting or rearranging. Set of three.

Z up, mm, front faces -Y, wall at y = 0. Hooks are one side profile and print on their side
(the pocket roof is a 10 mm bridge); cleats print on their back. No supports.
"""
import cadquery as cq

P = {
    "count": 3, "spacing": 44.0,
    "width": 19.0,           # hook width (X)
    "plate_t": 11.0,
    "reach": 42.0,           # how far the hook sticks out
    "cleat_w": 14.0, "cleat_d": 8.0, "cleat_h": 28.0, "cleat_z": 14.0,
    "clear": 0.3,
}
COLORS = ["#264653", "#2a9d8f", "#e76f51"]


def hook():
    w, t, R = P["width"], P["plate_t"], P["reach"]
    prof = (cq.Workplane("YZ").moveTo(0, 8).lineTo(0, 64)
            .threePointArc((-t / 2, 64 + t / 2), (-t, 64))
            .lineTo(-t, 24)
            .threePointArc((-(t + R - 9) / 2 - 4.5 + 0.0, 12), (-(R - 9), 24))
            .lineTo(-(R - 9), 32)
            .threePointArc((-(R - 4.5), 36.5), (-R, 32))
            .lineTo(-R, 24)
            .threePointArc((-R / 2, -1), (0, 8)).close())
    h = prof.extrude(w).translate((-w / 2, 0, 0))
    try:
        h = h.edges("|X").fillet(1.2)
    except Exception:
        pass
    try:
        h = h.faces("<X or >X").edges().fillet(2.5)
    except Exception:
        pass
    # cleat pocket, open at the bottom of the back plate, 45 deg roof = the locking bevel
    c = P["clear"]
    cw, cd, ch, cz = P["cleat_w"] / 2 + c, P["cleat_d"] + c, P["cleat_h"], P["cleat_z"]
    z_low = cz + ch - cd           # bevel low point (at the wall)
    pocket = (cq.Workplane("YZ").moveTo(0.5, 6).lineTo(0.5, z_low + c).lineTo(-cd, z_low + cd + c)
              .lineTo(-cd, 6).close().extrude(2 * cw).translate((-cw, 0, 0)))
    return h.cut(pocket)


def cleat():
    cw, cd, ch, cz = P["cleat_w"] / 2, P["cleat_d"], P["cleat_h"], P["cleat_z"]
    z_low = cz + ch - cd
    prof = (cq.Workplane("YZ").moveTo(0, cz).lineTo(0, z_low).lineTo(-cd, z_low + cd)
            .lineTo(-cd, cz).close())
    k = prof.extrude(2 * cw).translate((-cw, 0, 0))
    try:
        k = k.edges("|Y").fillet(1.0)
    except Exception:
        pass
    zs = cz + (ch - cd) / 2 + 1
    k = k.cut(cq.Workplane("XZ").center(0, zs).circle(2.2).extrude(-cd - 2).translate((0, -cd - 1 + cd + 1, 0)).translate((0, -cd - 1, 0)))
    cs = cq.Workplane("XZ").workplane(offset=cd).center(0, zs).circle(4.4).workplane(offset=-2.2).circle(2.2).loft()
    return k.cut(cs.translate((0, 0, 0)))


def screws():
    out = None
    for i in range(P["count"]):
        x = (i - (P["count"] - 1) / 2) * P["spacing"]
        zs = P["cleat_z"] + (P["cleat_h"] - P["cleat_d"]) / 2 + 1
        s = cq.Workplane("XZ").center(x, zs).circle(1.9).extrude(-30).translate((0, -P["cleat_d"] + 2.2, 0))
        s = s.union(cq.Workplane("XZ").workplane(offset=P["cleat_d"] - 0.1).center(x, zs).circle(4.2).workplane(offset=-2.1).circle(1.9).loft())
        out = s if out is None else out.union(s)
    return out


def parts():
    out = []
    for i in range(P["count"]):
        x = (i - (P["count"] - 1) / 2) * P["spacing"]
        out.append({"name": f"Hook {i + 1}", "shape": hook().translate((x, 0, 0)), "group": "case",
                    "color": COLORS[i % 3], "explode": [0, -1, 0.6]})
    for i in range(P["count"]):
        x = (i - (P["count"] - 1) / 2) * P["spacing"]
        out.append({"name": f"Wall cleat {i + 1}", "shape": cleat().translate((x, 0, 0)), "group": "case",
                    "color": "#c9ccd2", "explode": [0, 0, 0]})
    out.append({"name": "#8 flat-head screws (x3)", "shape": screws(), "group": "component", "color": "#9aa0a6",
                "explode": [0, 0, 0]})
    return out

"""Controller wall mount: a single swept arm that cradles a game controller between its grips,
with a lip that stops it sliding off. Two screws go through counterbores that are then hidden by
snap-in caps, so the wall shows nothing but the mount. Pairs well in rows above a desk.

Z up, mm, front faces -Y, wall at +Y. The body is one side profile: it prints on its side
(profile on the bed) as a 40 mm-tall extrusion, so the arm and lip need no supports and the
layer lines run the strong way along the arm.
"""
import cadquery as cq

P = {
    "width": 34.0,          # thickness of the arm (fits between grips of most controllers)
    "plate_t": 6.0, "plate_h": 96.0,
    "arm_reach": 46.0,
    "lip_h": 11.0,
    "screw_z": (13.0, 83.0),
    "screw_clear": 4.5, "cap_d": 10.4, "cap_depth": 3.0,
}
COL = "#ef476f"


def body():
    w, t, H, R = P["width"], P["plate_t"], P["plate_h"], P["arm_reach"]
    lip = P["lip_h"]
    prof = (cq.Workplane("YZ")
            .moveTo(t, 0).lineTo(t, H).lineTo(0, H).lineTo(0, 64.0)
            .lineTo(-R, 69.0).lineTo(-R, 69.0 + lip - 3.0)
            .threePointArc((-R - 3.5, 69.0 + lip + 0.5), (-R - 7.0, 69.0 + lip - 3.0))
            .lineTo(-R - 7.0, 62.0)
            .threePointArc((-R * 0.45, 50.0), (0, 24.0))
            .lineTo(0, 0).close())
    b = prof.extrude(w).translate((-w / 2, 0, 0))
    try:
        b = b.edges("|X").fillet(2.0)
    except Exception:
        pass
    try:
        b = b.faces("<X or >X").edges().fillet(2.5)
    except Exception:
        pass
    # screw holes + cap counterbores from the front face
    for z in P["screw_z"]:
        b = b.cut(cq.Workplane("XZ").center(0, z).circle(P["screw_clear"] / 2).extrude(-t - 2).translate((0, -1, 0)))
        b = b.cut(cq.Workplane("XZ").center(0, z).circle(P["cap_d"] / 2 + 0.1).extrude(-P["cap_depth"] - 1).translate((0, -1, 0)))
        # snap groove ring inside the counterbore
        b = b.cut(cq.Workplane("XZ").center(0, z).circle(P["cap_d"] / 2 + 0.6).extrude(-0.8).translate((0, 1.2, 0)))
    # soft-touch strip pocket on top of the arm (a TPU pad or felt dot goes here)
    pad = (cq.Workplane("YZ").moveTo(-6, 64.5).lineTo(-R + 2, 69.0 - 0.0).lineTo(-R + 2, 67.8).lineTo(-6, 63.3).close()
           .extrude(w - 10).translate((-(w - 10) / 2, 0, 0)))
    return b.cut(pad)


def caps():
    out = None
    d = P["cap_d"]
    for z in P["screw_z"]:
        c = cq.Workplane("XZ").center(0, z).circle(d / 2).extrude(-P["cap_depth"]).translate((0, 0, 0))
        try:
            c = c.faces("<Y").edges().fillet(0.8)
        except Exception:
            pass
        c = c.union(cq.Workplane("XZ").center(0, z).circle(d / 2 + 0.45).extrude(-0.6).translate((0, 1.25, 0)))
        out = c if out is None else out.union(c)
    return out


def tpu_pad():
    R, w = P["arm_reach"], P["width"]
    return (cq.Workplane("YZ").moveTo(-6, 64.5).lineTo(-R + 2, 69.0).lineTo(-R + 2, 70.2).lineTo(-6, 65.7).close()
            .extrude(w - 10.4).translate((-(w - 10.4) / 2, 0, 0)).translate((0, 0, -1.2 + 0.0)))


def parts():
    return [
        {"name": "Mount body", "shape": body(), "group": "case", "color": COL, "explode": [0, -1, 0]},
        {"name": "Screw caps (x2)", "shape": caps(), "group": "case", "color": COL, "explode": [0, -1, 0.2]},
        {"name": "Grip pad (TPU)", "shape": tpu_pad(), "group": "case", "color": "#2b2d42", "explode": [0, 0, 1]},
    ]

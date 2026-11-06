"""Door spice rack: four lattice cups on a slim back plate for the inside of a cabinet door.
The cups are sized to YOUR jars (one parameter), have a front label window and a diamond
lattice that only printing makes cheap: about half the plastic of a solid cup, still stiff.
Jars drop in from the top; the floor ring stops them, the open centre lets crumbs fall through.

Not food contact (holds closed jars). Z up, mm, front faces -Y.
Prints upright as modelled: diamonds are 45 deg, the label window is open at the top, no supports.
"""
import math
import cadquery as cq

P = {
    "jar_d": 46.0,        # measure your jar; 4 oz spice jars are 45-48 mm
    "count": 4,
    "cup_h": 50.0,
    "wall": 1.8,
    "plate_t": 3.0, "plate_h": 58.0,
    "window_w": 26.0, "window_h": 34.0,
    "diamond": 8.0,       # lattice cell size
}
COL = "#2a9d8f"


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def layout():
    ri = P["jar_d"] / 2 + 0.8
    ro = ri + P["wall"]
    pitch = 2 * ro + 3.0
    xs = [(i - (P["count"] - 1) / 2) * pitch for i in range(P["count"])]
    return ri, ro, pitch, xs


def cup(x, ri, ro):
    H, w = P["cup_h"], P["wall"]
    yc = -ro - 0.01
    c = cq.Workplane("XY").circle(ro).circle(ri).extrude(H)
    c = c.union(cq.Workplane("XY").circle(ro).circle(ri - 6.0).extrude(2.4))           # floor ring
    try:
        c = c.faces(">Z").edges().fillet(0.7)
    except Exception:
        pass
    # front label window, open at the top (no bridge), rounded bottom
    ww, wh = P["window_w"], P["window_h"]
    win = cq.Workplane("XZ").center(0, H).slot2D(2 * (H - 12.0), ww, 90).extrude(ro + 2)
    c = c.cut(win)
    # diamond lattice on the sides
    d = P["diamond"]
    cutter = None
    rows = [(10.0 + k * (d * 0.7071 + 1.9), 0.5 * (k % 2)) for k in range(8)]
    step = math.degrees((d * 1.4142 + 2.6) / ro)
    for z, off in rows:
        if z + d * 0.75 > H - 4:
            continue
        k = 0
        while True:
            ang = -90 + (k + off) * step + step
            k += 1
            if ang > 270 - step:
                break
            a = (ang + 360) % 360
            if abs(a - 270) < 42 or abs(a - 90) < 30:   # keep the window edges and the back solid
                continue
            dm = box(-d / 2, d / 2, -ro - 4, -ro + 4, -d / 2, d / 2).rotate((0, 0, 0), (0, 1, 0), 45)
            dm = dm.translate((0, 0, z)).rotate((0, 0, 0), (0, 0, 1), a - 270)
            cutter = dm if cutter is None else cutter.union(dm)
    if cutter is not None:
        c = c.cut(cutter)
    return c.translate((x, yc, 0))


def plate(ri, ro, pitch, xs):
    t, h = P["plate_t"], P["plate_h"]
    L = xs[-1] - xs[0] + 2 * ro + 6
    p = box(-L / 2, L / 2, 0, t, 0, h)
    try:
        p = p.edges("|Y").fillet(6.0)
    except Exception:
        pass
    try:
        p = p.faces("<Y").edges().fillet(1.0)
    except Exception:
        pass
    # countersunk screw holes in the gaps between cups, above the rims
    for i in range(len(xs) - 1):
        if i % 2 == 0 or len(xs) <= 3:
            x = (xs[i] + xs[i + 1]) / 2
            p = p.cut(cq.Workplane("XZ").center(x, h - 6).circle(2.1).extrude(-t - 1).translate((0, -0.5, 0)))
    # lightening slots between the cups, low down (hidden behind the jars)
    for i in range(len(xs) - 1):
        x = (xs[i] + xs[i + 1]) / 2
        p = p.cut(cq.Workplane("XZ").center(x, h * 0.4).slot2D(h * 0.45, 4.5, 90).extrude(-t - 1).translate((0, -0.5, 0)))
    return p


def jars(ri, xs):
    out = None
    for x in xs[1::2]:
        j = cq.Workplane("XY").circle(P["jar_d"] / 2).extrude(88).translate((x, -ri - P["wall"] - 0.01 - 0.0, 2.4))
        lid = cq.Workplane("XY").circle(P["jar_d"] / 2 - 2).extrude(14).translate((x, -ri - P["wall"], 90.4))
        j = j.union(lid)
        out = j if out is None else out.union(j)
    return out


def parts():
    ri, ro, pitch, xs = layout()
    body = plate(ri, ro, pitch, xs)
    for x in xs:
        body = body.union(cup(x, ri, ro).translate((0, 0.8, 0)))
    return [
        {"name": "Spice rack", "shape": body, "group": "case", "color": COL, "explode": [0, 0, 0]},
        {"name": "Spice jars (not included)", "shape": jars(ri, xs), "group": "component", "color": "#e9e4d8",
         "explode": [0, 0, 1]},
    ]

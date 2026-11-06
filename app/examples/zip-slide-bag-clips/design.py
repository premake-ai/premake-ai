"""Zip-slide bag clips: one-piece clips with a living-spring loop at the back and interlocking
wave jaws. Slide the flared mouth along the folded top of a bag: the jaws spread, then the
loop spring snaps them shut on a wave path that seals tighter than flat jaws. The loop doubles
as a hanging eye. Set of three lengths. No moving parts, no hardware.

Not for direct food contact (it clamps the outside of the bag). Z up, mm, front faces -Y.
Each clip prints flat as modelled (profile on the bed, 10 mm tall), no supports.
"""
import math
import cadquery as cq

P = {
    "lengths": [70.0, 105.0, 140.0],
    "thick": 10.0,        # clip height on the bed
    "jaw_t": 5.0,         # each jaw
    "gap": 0.5,           # printed gap between the jaws
    "loop_r": 9.5,        # outer radius of the spring loop
    "loop_t": 2.2,        # spring wall thickness
    "wave_amp": 1.1, "wave_len": 6.0,
    "spacing": 30.0,
}
COLORS = ["#ffb4a2", "#b5e48c", "#a0c4ff"]


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def clip(L):
    t, jt, g = P["thick"], P["jaw_t"], P["gap"]
    R, rt = P["loop_r"], P["loop_t"]
    h = g / 2 + jt
    cx = -R + 1.0
    ring = cq.Workplane("XY").center(cx, 0).circle(R).circle(R - rt).extrude(t)
    ht = h * 0.78   # jaws taper toward the tip
    jaws = cq.Workplane("XY").polyline([(cx, -h), (L - 3, -ht), (L, -ht + 2.5), (L, ht - 2.5), (L - 3, ht), (cx, h)]).close().extrude(t)
    jaws = jaws.cut(cq.Workplane("XY").center(cx, 0).circle(R - rt).extrude(t))
    c = ring.union(jaws)
    try:
        c = c.edges("|Z").fillet(0.8)
    except Exception:
        pass
    # straight gap from the loop to the wave section, then the interlocking wave
    xw = cx + R + 6.0
    c = c.cut(box(cx, xw + 0.01, -g / 2, g / 2, -1, t + 1))
    A, lam = P["wave_amp"], P["wave_len"]
    n = max(8, int((L - xw) / 0.75))
    xs = [xw + (L + 1 - xw) * i / n for i in range(n + 1)]
    ramp = lambda x: min(1.0, (x - xw) / 4.0)
    top = [(x, A * ramp(x) * math.sin(2 * math.pi * (x - xw) / lam) + g / 2) for x in xs]
    bot = [(x, y - g) for x, y in reversed(top)]
    wave = cq.Workplane("XY").polyline(top + bot).close().extrude(t + 2).translate((0, 0, -1))
    c = c.cut(wave)
    # flared mouth (lead-in) at the tip
    mouth = cq.Workplane("XY").polyline([(L - 9, 0), (L + 0.5, h * 0.55), (L + 0.5, -h * 0.55)]).close().extrude(t + 2).translate((0, 0, -1))
    c = c.cut(mouth)
    try:
        c = c.faces(">Z or <Z").edges().chamfer(0.5)
    except Exception:
        pass
    return c


def parts():
    out = []
    for i, L in enumerate(P["lengths"]):
        y = (i - 1) * P["spacing"]
        out.append({"name": f"Bag clip {int(L)} mm", "shape": clip(L).translate((-L / 2 + 10, y, 0)), "group": "case",
                    "color": COLORS[i % 3], "explode": [0, (i - 1) * 1.0, 0.3]})
    return out

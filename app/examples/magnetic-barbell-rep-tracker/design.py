import math
import cadquery as cq
from cadlib.parts import part

SCENE = "floor"

# M5StickC PLUS2 (ESP32 + MPU6886 IMU + 200 mAh LiPo + charger + 1.14" screen),
# docs.m5stack.com: 48.0 x 24.0 x 13.5 mm. Lies screen-up, USB-C at -X.
STICK = (48.0, 24.0, 13.5)
CLR = 0.3                       # slip fit around the stick
L = 62.0                        # pod length (along the bar)
W_TOP, W_BASE = 31.0, 37.0      # upper shell / magnet base width
FLOOR = 7.5                     # stick rests here
TOP = FLOOR + STICK[2]          # 21.0, bezel clamps the stick's front rim
BEZEL_T = 2.5
R_PLAN = 6.0

# Bar seat: two rails with a chamfered channel between them (prints flat, no supports)
CH_EDGE, CH_TOP, CH_D = 6.0, 3.8, 2.2
# Strap tunnel for a 20 mm hook-and-loop strap (positive retention on any bar)
TUN_W, TUN_Z0, TUN_H = 22.0, 3.4, 2.5
# 10 x 3 mm N52 disc magnets, 4x, set 0.3 mm proud-free in the rails
MAG_D, MAG_T, MAG_XY = 10.0, 3.0, (18.0, 12.25)
MAG_POCKET_D, MAG_POCKET_H = 10.2, 3.4
# Bezel screws (M2.5 self-tapping into the end walls, clear of the USB-C opening)
SCREW_XY = (27.5, 10.0)

BAR_D = 28.0                    # men's Olympic bar shaft (IWF), 25 women's, 50 sleeve
BAR_SAG = BAR_D / 2 - math.sqrt((BAR_D / 2) ** 2 - CH_EDGE ** 2)
Z0 = BAR_D - BAR_SAG            # pod bottom when resting on the bar


def _rrect(w, h, r, z0, height):
    return (cq.Workplane("XY").workplane(offset=z0)
            .sketch().rect(w, h).vertices().fillet(r).finalize().extrude(height))


def body():
    prof = [(-W_BASE / 2, 0), (W_BASE / 2, 0), (W_BASE / 2, 3.6), (W_TOP / 2, 6.6),
            (W_TOP / 2, TOP), (-W_TOP / 2, TOP), (-W_TOP / 2, 6.6), (-W_BASE / 2, 3.6)]
    b = cq.Workplane("YZ").polyline(prof).close().extrude(L).translate((-L / 2, 0, 0))
    # round the plan corners (a direct |Z fillet leaves loose slivers at the chamfer)
    b = b.intersect(_rrect(L, W_BASE, R_PLAN, 0, 6.6).union(_rrect(L, W_TOP, R_PLAN, 0, TOP)))
    # bar channel
    ch = (cq.Workplane("YZ").polyline([(-CH_EDGE, 0), (CH_EDGE, 0), (CH_TOP, CH_D), (-CH_TOP, CH_D)])
          .close().extrude(L + 2).translate((-L / 2 - 1, 0, 0)))
    b = b.cut(ch)
    # strap tunnel
    b = b.cut(cq.Workplane("XY").box(TUN_W, W_BASE + 2, TUN_H, centered=(True, True, False))
              .translate((0, 0, TUN_Z0)))
    # stick pocket
    b = b.cut(_rrect(STICK[0] + 2 * CLR, STICK[1] + 2 * CLR, 2.5, FLOOR, TOP))
    # magnet pockets
    for sx in (-1, 1):
        for sy in (-1, 1):
            b = b.cut(cq.Workplane("XY").circle(MAG_POCKET_D / 2).extrude(MAG_POCKET_H)
                      .translate((sx * MAG_XY[0], sy * MAG_XY[1], 0)))
    # USB-C opening at -X end
    usb = (cq.Workplane("YZ").sketch().rect(13, 9).vertices().fillet(3).finalize()
           .extrude(10).translate((-L / 2 - 2, 0, FLOOR + STICK[2] / 2)))
    b = b.cut(usb)
    # side windows for button B and the power button
    for sy in (-1, 1):
        win = (cq.Workplane("XZ").center(5, 14.5).slot2D(34, 8).extrude(10, both=True)
               .translate((0, sy * W_TOP / 2, 0)))
        b = b.cut(win)
    # bezel screw pilots (M2.5: 2.0 mm, 7 mm deep)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b = b.cut(cq.Workplane("XY").circle(1.0).extrude(7.5)
                      .translate((sx * SCREW_XY[0], sy * SCREW_XY[1], TOP - 7.5)))
    try:
        b = b.faces("<Z").edges().chamfer(0.5)
    except Exception as e:
        print("body bottom chamfer skipped:", e)
    return b


def bezel():
    z = _rrect(L, W_TOP, R_PLAN, 0, BEZEL_T)
    try:
        z = z.faces(">Z").edges().fillet(1.2)
    except Exception:
        pass
    z = z.cut(_rrect(44, 19, 2.0, -1, BEZEL_T + 2))
    for sx in (-1, 1):
        for sy in (-1, 1):
            z = z.cut(cq.Workplane("XY").circle(1.45).extrude(BEZEL_T + 2)
                      .translate((sx * SCREW_XY[0], sy * SCREW_XY[1], -1)))
    return z.translate((0, 0, TOP))


def stick():
    s = cq.Workplane("XY").box(*STICK, centered=(True, True, False))
    try:
        s = s.edges("|Z").fillet(3).faces(">Z or <Z").edges().fillet(1.5)
    except Exception:
        pass
    return s.translate((0, 0, FLOOR))


def _hull(pts):
    pts = sorted(set(pts))
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


def strap():
    """20 mm hook-and-loop strap: through the tunnel and round the bar (display)."""
    t, zc = 2.0, BAR_D / 2
    zt = Z0 + TUN_Z0 + 0.25

    def loop(off):
        pts = [((BAR_D / 2 + off) * math.cos(a), zc + (BAR_D / 2 + off) * math.sin(a))
               for a in [i * 2 * math.pi / 72 for i in range(72)]]
        y = W_BASE / 2 + off
        pts += [(-y, zt + off), (y, zt + off), (-y, Z0 - off), (y, Z0 - off)]
        return cq.Workplane("YZ").polyline(_hull(pts)).close().extrude(20).translate((-10, 0, 0))
    return loop(t).cut(loop(0.0))


def parts():
    up = (0, 0, Z0)
    mags = [(sx * MAG_XY[0], sy * MAG_XY[1], Z0 + 0.3) for sx in (-1, 1) for sy in (-1, 1)]
    mag = cq.Workplane("XY").circle(MAG_D / 2).extrude(MAG_T)
    mag_shape = mag.translate(mags[0])
    for p in mags[1:]:
        mag_shape = mag_shape.union(mag.translate(p))
    bar = cq.Workplane("YZ").circle(BAR_D / 2).extrude(300).translate((-150, 0, BAR_D / 2))
    pod, bz = body(), bezel()
    for n, s in (("Pod body", pod), ("Bezel", bz)):
        k = len(s.val().Solids())
        if k != 1:
            info = [(round(x.Volume()), [round(v, 1) for v in (x.BoundingBox().xmin, x.BoundingBox().xmax,
                     x.BoundingBox().ymin, x.BoundingBox().ymax, x.BoundingBox().zmin, x.BoundingBox().zmax)])
                    for x in s.val().Solids()]
            raise ValueError(f"{n} is {k} solids: {info}")
        print(f"{n}: 1 solid, volume {s.val().Volume():.0f} mm3, faces {len(s.val().Faces())}")
    st, sp = stick().translate(up), strap()
    mag_local = mag_shape.translate((0, 0, -Z0))
    for n, other in (("stick", st), ("strap", sp), ("magnets", mag_shape), ("bar", bar)):
        for m, case in (("body", pod.translate(up)), ("bezel", bz.translate(up))):
            v = case.intersect(other).val().Volume() if other is not None else 0
            if v > 0.5:
                print(f"CLASH {n} x {m}: {v:.1f} mm3")
    print(f"pod sits {Z0:.2f} mm up; bar sag into channel {BAR_SAG:.2f} of {CH_D} mm; "
          f"magnet top {MAG_POCKET_H} vs tunnel x>{TUN_W/2 + 0:.0f} (magnets at x {MAG_XY[0]-MAG_D/2:.1f}+)")
    return [
        {"name": "Pod body", "shape": pod.translate(up), "group": "case", "color": "#2b2f36"},
        {"name": "Bezel", "shape": bz.translate(up), "group": "case", "color": "#e8542a",
         "explode": [0, 0, 1]},
        {"name": "M5StickC PLUS2", "shape": stick().translate(up), "group": "component",
         "color": "#f28c1e", "explode": [0, 0, 1],
         "fx": {"screen": {"text": "REP 5\n0.62 m/s", "fg": "#7CFF6B", "bg": "#000000"}},
         "cable": {"type": "usb-c", "at": [-L / 2, 0, Z0 + FLOOR + STICK[2] / 2],
                   "dir": [-1, 0, 0], "length_mm": 300}},
        {"name": "Magnet 10x3 N52", "shape": mag_shape, "group": "component",
         "material": "steel", "explode": [0, 0, -1]},
        {"name": "Hook-and-loop strap 20 mm", "shape": strap(), "group": "component",
         "color": "#111111", "explode": [0, 0, -1]},
        part("m25x8_selftap", at=[(sx * SCREW_XY[0], sy * SCREW_XY[1], Z0 + TOP + BEZEL_T)
                                  for sx in (-1, 1) for sy in (-1, 1)]),
        {"name": "Barbell shaft (yours)", "shape": bar, "group": "component",
         "color": "#9aa0a6", "material": "steel"},
    ]

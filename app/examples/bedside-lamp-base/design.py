import math
import cadquery as cq

SCENE = "desk"

D = 130.0          # base diameter
R = D / 2
WALL = 3.0         # side wall
TOP_T = 3.0        # top skin
FOOT = 2.0         # rubber foot protrudes below the plate
FOOT_D, FOOT_H = 12.7, 3.5   # 3M Bumpon SJ5302 class
Z0 = FOOT          # body / plate bottom
H = 31.0           # body top z
PLATE_T = 3.0
R_IN = R - WALL
TOP_IN = H - TOP_T

PIPE_OD = 10.29    # 1/8 IPS lamp pipe (NPS 1/8 = 0.405 in OD)
SW_X, SW_Y = 0.0, -42.0
SW_CUT = (19.4, 13.4)          # KCD1 cutout 19.2 x 13.2 (+0.2 print)
CORD_W, CORD_D = 4.6, 3.6      # channel for a ~4 mm 12 V adapter cord
PLUG_Y = 24.0                  # where the plug comes up into the base

BOSS_R = 50.0
BOSS_ANG = [0, 120, 240]       # 3 feet never rock


def boss_pts():
    return [(BOSS_R * math.cos(math.radians(a)), BOSS_R * math.sin(math.radians(a)))
            for a in BOSS_ANG]


def body():
    outer = cq.Workplane("XY").workplane(offset=Z0).circle(R).extrude(H - Z0)
    try:
        outer = outer.faces(">Z").edges().fillet(10)
    except Exception:
        pass
    try:
        outer = outer.faces("<Z").edges().chamfer(0.8)
    except Exception:
        pass
    inner = cq.Workplane("XY").workplane(offset=Z0 - 1).circle(R_IN).extrude(TOP_IN - Z0 + 1)
    try:
        inner = inner.faces(">Z").edges().fillet(7)
    except Exception:
        pass
    b = outer.cut(inner)

    # stem boss for the lamp pipe
    stem = cq.Workplane("XY").workplane(offset=20).circle(11).extrude(TOP_IN - 20 + 1)
    b = b.union(stem)

    # screw bosses + ribs to the wall
    pad_top = Z0 + PLATE_T + 3.0
    for (x, y) in boss_pts():
        a = math.atan2(y, x)
        bo = (cq.Workplane("XY").workplane(offset=pad_top).center(x, y)
              .circle(4.0).extrude(TOP_IN - pad_top + 1))
        rib = (cq.Workplane("XY").workplane(offset=pad_top)
               .center((BOSS_R + R_IN) / 2 * math.cos(a), (BOSS_R + R_IN) / 2 * math.sin(a))
               .rect(R_IN - BOSS_R + 2, 2.4).extrude(TOP_IN - pad_top + 1)
               .rotate(((BOSS_R + R_IN) / 2 * math.cos(a), (BOSS_R + R_IN) / 2 * math.sin(a), 0),
                       ((BOSS_R + R_IN) / 2 * math.cos(a), (BOSS_R + R_IN) / 2 * math.sin(a), 1),
                       math.degrees(a)))
        b = b.union(bo).union(rib)
        pilot = (cq.Workplane("XY").workplane(offset=pad_top - 1).center(x, y)
                 .circle(1.25).extrude(11))
        b = b.cut(pilot)

    # pipe hole
    b = b.cut(cq.Workplane("XY").circle(PIPE_OD / 2 + 0.3).extrude(H + 5))
    # switch: thin the top to 2 mm, then the snap-in cutout
    b = b.cut(cq.Workplane("XY").workplane(offset=TOP_IN - 2).center(SW_X, SW_Y)
              .rect(26, 20).extrude(4))
    b = b.cut(cq.Workplane("XY").workplane(offset=TOP_IN).center(SW_X, SW_Y)
              .rect(*SW_CUT).extrude(10))
    # rear notch where the cord passes under the wall
    b = b.cut(cq.Workplane("XY").workplane(offset=Z0 - 1).center(0, R - WALL / 2)
              .rect(CORD_W + 0.4, WALL + 4).extrude(CORD_D + 1))
    return b


def plate():
    rp = R_IN - 0.3
    p = cq.Workplane("XY").workplane(offset=Z0).circle(rp).extrude(PLATE_T)
    # rib over the cord channel
    p = p.union(cq.Workplane("XY").workplane(offset=Z0 + PLATE_T - 0.5)
                .center(0, (PLUG_Y + rp) / 2).rect(CORD_W + 6, rp - PLUG_Y - 2)
                .extrude(3.5))
    # screw pads
    for (x, y) in boss_pts():
        p = p.union(cq.Workplane("XY").workplane(offset=Z0 + PLATE_T - 0.5)
                    .center(x, y).circle(5.5).extrude(3.5))
    # cord channel underneath, centre to rear edge
    p = p.cut(cq.Workplane("XY").workplane(offset=Z0 - 1)
              .center(0, (PLUG_Y + rp) / 2 + 1).rect(CORD_W, rp - PLUG_Y + 4)
              .extrude(CORD_D + 1))
    # pinch bumps that grip the cord (alternate sides)
    for i, y in enumerate([38.0, 50.0]):
        s = 1 if i % 2 == 0 else -1
        p = p.union(cq.Workplane("XY").workplane(offset=Z0)
                    .center(s * (CORD_W / 2 - 0.4), y).rect(1.6, 3).extrude(CORD_D + 0.5))
    # slot the barrel plug pushes up through, then lies flat toward -X
    p = p.cut(cq.Workplane("XY").workplane(offset=Z0 - 1).center(-3, PLUG_Y)
              .slot2D(30, 12).extrude(PLATE_T + 6))
    # feet recesses + screw clearance + head counterbores
    for (x, y) in boss_pts():
        p = p.cut(cq.Workplane("XY").workplane(offset=Z0 - 1).center(x, y)
                  .circle(FOOT_D / 2 + 0.3).extrude(1 + FOOT_H - FOOT))
        p = p.cut(cq.Workplane("XY").workplane(offset=Z0).center(x, y)
                  .circle(3.3).extrude(FOOT_H - FOOT + 2.4))
        p = p.cut(cq.Workplane("XY").center(x, y).circle(1.7).extrude(20))
    try:
        p = p.faces("<Z").edges("%CIRCLE").edges(cq.selectors.RadiusNthSelector(-1)).chamfer(0.6)
    except Exception:
        pass
    return p


def parts():
    from cadlib.parts import part
    head_z = Z0 + FOOT_H - FOOT + 2.4   # underside of the screw head
    out = [
        {"name": "Lamp base body", "shape": body(), "group": "case", "color": "#e9e4da"},
        {"name": "Bottom plate", "shape": plate(), "group": "case", "color": "#b9b2a5",
         "explode": [0, 0, -1]},
        part("m3x10_selftap", at=[(x, y, head_z) for (x, y) in boss_pts()], rot=(180, 0, 0)),
    ]
    feet = None
    for (x, y) in boss_pts():
        f = cq.Workplane("XY").center(x, y).circle(FOOT_D / 2).extrude(FOOT_H)
        try:
            f = f.faces("<Z").edges().fillet(1.2)
        except Exception:
            pass
        feet = f if feet is None else feet.union(f)
    out.append({"name": "Rubber feet 12.7 mm", "shape": feet, "group": "component",
                "material": "rubber", "color": "#222222", "explode": [0, 0, -1]})

    # KCD1 rocker switch: bezel on top, body below the 2 mm panel
    sw = (cq.Workplane("XY").workplane(offset=H).center(SW_X, SW_Y).rect(21, 15).extrude(2.5)
          .faces(">Z").edges().fillet(0.8)
          .union(cq.Workplane("XY").workplane(offset=H - 2 - 17).center(SW_X, SW_Y)
                 .rect(18.8, 12.8).extrude(17.2)))
    out.append({"name": "KCD1 rocker switch", "shape": sw, "group": "component",
                "color": "#111111", "explode": [0, 0, 1]})

    # DC barrel female -> screw terminal pigtail lying on the plate
    jy, jz = PLUG_Y, Z0 + PLATE_T + 6
    jack = (cq.Workplane("YZ").workplane(offset=-50).center(jy, jz).circle(5.5).extrude(18)
            .union(cq.Workplane("XY").workplane(offset=jz - 6).center(-41, jy)
                   .rect(16, 14).extrude(12)))
    out.append({"name": "DC jack screw-terminal adapter", "shape": jack, "group": "component",
                "color": "#1f4fa0"})

    # 1/8 IPS lamp pipe stub + lock nuts (the lamp's stem screws on)
    pipe = cq.Workplane("XY").workplane(offset=14).circle(PIPE_OD / 2).extrude(80)
    pipe = pipe.faces(">Z").workplane().hole(6.5)
    nut_lo = cq.Workplane("XY").workplane(offset=15).polygon(6, 16).extrude(5).faces(">Z").workplane().hole(PIPE_OD)
    nut_hi = cq.Workplane("XY").workplane(offset=H).polygon(6, 16).extrude(5).faces(">Z").workplane().hole(PIPE_OD)
    out.append({"name": "1/8 IPS lamp pipe", "shape": pipe, "group": "component",
                "material": "brass", "explode": [0, 0, 1]})
    out.append({"name": "Lamp pipe lock nuts", "shape": nut_lo.union(nut_hi), "group": "component",
                "material": "brass"})
    return out


ASSEMBLY = [["Lamp base body"], ["1/8 IPS lamp pipe", "Lamp pipe lock nuts"],
            ["KCD1 rocker switch"], ["DC jack screw-terminal adapter"],
            ["Bottom plate"], ["Rubber feet 12.7 mm"]]

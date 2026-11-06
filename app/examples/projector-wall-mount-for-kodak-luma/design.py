import cadquery as cq

# Kodak Luma 350 approx 112 x 112 x 32 mm, 1/4"-20 tripod socket underneath
PW, PD, PH = 112, 112, 32
REACH = 130          # wall to pan axis
AZ = 110             # arm top / pan joint height
WZ = 85              # wall disc centre height
AX_Z = 130           # tilt axis height
PLAT_Z = 140         # platform underside


def cyl_x(y, z, r, x0, length):
    return cq.Workplane("YZ").workplane(offset=x0).center(y, z).circle(r).extrude(length)


def cyl_z(x, y, z0, r, h):
    return cq.Workplane("XY").workplane(offset=z0).center(x, y).circle(r).extrude(h)


def soft(w, sel, r):
    try:
        return w.edges(sel).fillet(r)
    except Exception:
        return w


def bracket():
    disc = cq.Workplane("XZ").workplane(offset=0).center(0, WZ).circle(38).extrude(6)  # y 0..-6
    disc = soft(disc, "<Y", 2.5)
    # tapered arm, curved underside feel via a 4-point profile
    arm = (cq.Workplane("YZ").polyline([(-5, AZ), (-REACH, AZ), (-REACH, AZ - 12), (-5, WZ - 30)]).close()
           .extrude(20).translate((-10, 0, 0)))
    arm = soft(arm, "|Y", 4)
    boss = cyl_z(0, -REACH, AZ - 12, 18, 12)
    b = disc.union(arm).union(boss)
    b = b.cut(cyl_z(0, -REACH, 0, 3.2, 200))
    # countersunk wall screws (#8 / 4.5 mm)
    for z in (WZ - 25, WZ + 25):
        b = b.cut(cq.Workplane("XY").add(cq.Solid.makeCylinder(2.4, 20, cq.Vector(0, 5, z), cq.Vector(0, -1, 0))))
        b = b.cut(cq.Workplane("XY").add(cq.Solid.makeCone(4.6, 0, 4.6, cq.Vector(0, -6.01, z), cq.Vector(0, 1, 0))))
    return b


def yoke():
    y = cyl_z(0, -REACH, AZ, 18, 6)
    y = soft(y, ">Z", 1.5)
    for x0 in (-15, 9):  # tilt lugs, 18 mm gap for the platform tongue
        lug = cq.Workplane("XY").box(6, 20, AX_Z - AZ - 5, centered=False).translate((x0, -REACH - 10, AZ + 5))
        y = y.union(lug.union(cyl_x(-REACH, AX_Z, 10, x0, 6)))
    y = y.cut(cyl_x(-REACH, AX_Z, 3.2, -20, 40))
    # pan bolt: countersunk from the top
    y = y.cut(cyl_z(0, -REACH, 0, 3.2, 200))
    y = y.cut(cq.Workplane("XY").add(cq.Solid.makeCone(3.2, 6.5, 3.4, cq.Vector(0, -REACH, AZ + 2.61), cq.Vector(0, 0, 1))))
    return y


def platform():
    p = cq.Workplane("XY").box(96, 96, 5, centered=(True, True, False)).translate((0, -REACH, PLAT_Z))
    p = soft(p, "|Z", 14)
    p = p.cut(cq.Workplane("XY").rect(56, 22).extrude(10).edges("|Z").fillet(6)
              .translate((0, -REACH - 26, PLAT_Z - 1)))
    tongue = cq.Workplane("XY").box(17.4, 20, PLAT_Z - AX_Z + 1, centered=(True, True, False)).translate((0, -REACH, AX_Z))
    tongue = tongue.union(cyl_x(-REACH, AX_Z, 10, -8.7, 17.4))
    p = p.union(tongue)
    lip = cq.Workplane("XY").box(70, 3, 5, centered=(True, True, False)).translate((0, -REACH - 46.5, PLAT_Z + 5))
    p = p.union(soft(lip, ">Z", 1.2))
    p = p.cut(cyl_x(-REACH, AX_Z, 3.2, -20, 40))
    slot = cq.Workplane("XY").slot2D(24, 6.8, 90).extrude(10).translate((0, -REACH + 25, PLAT_Z - 1))
    return p.cut(slot)


def parts():
    proj = (cq.Workplane("XY").box(PW, PD, PH, centered=(True, True, False))
            .edges("|Z").fillet(10).translate((0, -REACH + 7, PLAT_Z + 5)))
    lens = (cq.Workplane("XZ").circle(9).extrude(3)
            .translate((25, -REACH + 7 - PD / 2, PLAT_Z + 5 + PH / 2)))
    tilt_bolt = cyl_x(-REACH, AX_Z, 3, -22, 44)
    tilt_knob = cyl_x(-REACH, AX_Z, 12, 15, 10)
    pan_bolt = cyl_z(0, -REACH, AZ - 22, 3, 30)
    pan_knob = cyl_z(0, -REACH, AZ - 24, 12, 10)
    thumb = cyl_z(0, -REACH + 25, PLAT_Z - 6, 3.2, 14).union(cyl_z(0, -REACH + 25, PLAT_Z - 11, 10, 5))
    dark, mid = "#2b2f36", "#4a5260"
    return [
        {"name": "Wall arm", "shape": bracket(), "group": "case", "color": dark, "explode": [0, 1, 0]},
        {"name": "Pan yoke", "shape": yoke(), "group": "case", "color": mid, "explode": [0, 0, 1]},
        {"name": "Tilt platform", "shape": platform(), "group": "case", "color": dark, "explode": [0, 0, 1]},
        {"name": "Kodak Luma 350 (yours)", "shape": proj.union(lens), "group": "component", "color": "#d8d8d8", "explode": [0, 0, 1]},
        {"name": "M6x45 tilt bolt", "shape": tilt_bolt, "group": "component", "color": "#999999", "explode": [-1, 0, 0]},
        {"name": "M6 tilt knob", "shape": tilt_knob, "group": "component", "color": "#111111", "explode": [1, 0, 0]},
        {"name": "M6x30 pan bolt", "shape": pan_bolt, "group": "component", "color": "#999999", "explode": [0, 0, 1]},
        {"name": "M6 pan knob", "shape": pan_knob, "group": "component", "color": "#111111", "explode": [0, 0, -1]},
        {"name": "1/4-20 thumb screw", "shape": thumb, "group": "component", "color": "#888888", "explode": [0, 0, -1]},
    ]

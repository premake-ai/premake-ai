import cadquery as cq
from cadlib.parts import part

# Wall at y = PT (back face), product faces -Y. Printed back-face-down.
PW, PH, PT = 50.0, 222.0, 4.5     # backplate width, height, thickness
ARM_W = 30.0                        # tongue width (fits between controller grips)
TONGUE_T = 7.0                      # tongue thickness
RIB_W = 8.0                         # gusset rib under the tongue
ARM_Z = [42.0, 158.0]              # top of each tongue
REACH = 66.0                        # tongue reach from the plate front
SLOT_W = 9.0                        # cable slot width (fits USB-C plug overmould)
GROOVE_D = 2.0                      # cable channel depth in the back face
SCREWS = [(-16, 14), (16, 14), (-16, 134), (16, 134)]


def arm(ztop):
    # tongue + raised lip (all slopes <= 45 deg for back-down printing)
    tongue = [(PT, ztop - TONGUE_T), (PT, ztop), (-REACH + 14, ztop),
              (-REACH + 4, ztop + 10), (-REACH, ztop + 10),
              (-REACH, ztop - TONGUE_T)]
    a = cq.Workplane("YZ").polyline(tongue).close().extrude(ARM_W / 2, both=True)
    try:
        a = a.edges("|X").fillet(2.0)
        a = a.edges("not |X").fillet(1.5)
    except Exception:
        pass
    rib = [(PT, ztop - 40), (PT, ztop - 2), (-REACH + 8, ztop - 2),
           (-REACH + 8, ztop - TONGUE_T)]
    r = cq.Workplane("YZ").polyline(rib).close().extrude(RIB_W / 2, both=True)
    return a.union(r)


def csk(x, z):
    # M4 / #8 countersunk wood screw: 4.5 through, 9 mm head flush at the front
    h = cq.Workplane("XZ").center(x, z).circle(2.25).extrude(-PT - 1).translate((0, -0.5, 0))
    cone = cq.Solid.makeCone(4.6, 2.25, 2.35, cq.Vector(x, -0.01, z), cq.Vector(0, 1, 0))
    return h.union(cq.Workplane().add(cone))


def plate():
    p = cq.Workplane("XZ").center(0, PH / 2).rect(PW, PH).extrude(-PT)
    p = p.edges("|Y").fillet(14)
    p = p.faces("<Y").edges().fillet(2.0)
    for z in ARM_Z:
        p = p.union(arm(z))
    for x, z in SCREWS:
        p = p.cut(csk(x, z))
    # cable slots just above each controller's top edge (USB port drops in)
    for z in ARM_Z:
        s = (cq.Workplane("XZ").center(0, z + 46).slot2D(28, SLOT_W, 90)
             .extrude(-PT - 2).translate((0, -1, 0)))
        p = p.cut(s)
    # channel in the back face: cable runs up from the bottom edge to both slots
    g = cq.Workplane("XY").box(SLOT_W + 1, GROOVE_D * 2, ARM_Z[1] + 46) \
        .translate((0, PT, (ARM_Z[1] + 46) / 2 - 1))
    p = p.cut(g)
    return p


def controller(ztop):
    # reference dummy: generic gamepad (~150 x 105 x 60) hanging on the tongue
    body = (cq.Workplane("XY").box(150, 50, 58).edges().fillet(14)
            .translate((0, -34, ztop + 22)))
    for sx in (-1, 1):
        grip = (cq.Workplane("XY").cylinder(68, 22).edges().fillet(8)
                .translate((sx * 50, -34, ztop - 16)))
        body = body.union(grip)
    return body


def parts():
    out = [{"name": "Wall Mount", "shape": plate(), "group": "case",
            "color": "#2b2f36"}]
    for i, z in enumerate(ARM_Z):
        out.append({"name": f"Controller {i+1} (reference)", "shape": controller(z),
                    "group": "component", "color": "#d8d8dc",
                    "explode": [0, -1, 0]})
    return out

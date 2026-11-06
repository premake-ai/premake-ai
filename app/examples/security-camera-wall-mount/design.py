import cadquery as cq
from cadlib.parts import part

SCENE = "wall"
ASSEMBLY = [["Wall plate"], ["Wyze Cam v3 (yours)", "1/4-20 camera screw"], ["Camera hood"]]

# Wyze Cam v3 body with its stand removed: 51 W x 52 H x 58.5 D (Wyze tech specs).
# 1/4"-20 thread on the underside; its exact front-back position isn't published -> slotted hole.
CW, CH, CD = 51.0, 52.0, 58.5
CLR = 1.0                                  # per side around the camera

# Wall plate: front face y = 0, back on the wall at y = PT, prints standing on its bottom edge
PW, PH, PT, PR = 76.0, 100.0, 6.0, 10.0

# Camera hood: open back sits on the plate face, window in the front
WALL, FLOOR = 2.5, 4.0
REAR = 12.0                                # cable / plug space behind the camera
IW, IH = CW + 2 * CLR, CH + 2 * CLR        # cavity 53 x 54
ID = CD + 0.5 + REAR                       # cavity depth 71
HW, HH, HD = IW + 2 * WALL, IH + FLOOR + WALL, ID + WALL
ZB = 30.0                                  # hood bottom
WIN_W, WIN_H, WIN_R = 45.0, 44.0, 7.0      # camera window (3-4 mm lip holds the camera's front)

# Screw posts (on the plate, inside the hood's rear space), M3 self-tapping from the hood sides
POST_W, POST_D, POST_H = 8.0, 10.0, 16.0
POST_Z = [38.0, 68.0]                      # post bottoms
SCREW_Y = -5.0
def screw_z(pz): return pz + 11.0

CAM_Y0 = -ID                               # camera front face (against the front wall)
CAM_YC = CAM_Y0 + CD / 2
CAM_Z0 = ZB + FLOOR + CLR


def ycyl(r, y0, y1, x, z):
    return cq.Workplane("XY").add(cq.Solid.makeCylinder(r, y1 - y0, cq.Vector(x, y0, z), cq.Vector(0, 1, 0)))


def xcyl(r, x0, x1, y, z):
    return cq.Workplane("XY").add(cq.Solid.makeCylinder(r, x1 - x0, cq.Vector(x0, y, z), cq.Vector(1, 0, 0)))


def wall_plate():
    p = cq.Workplane("XY").box(PW, PT, PH, centered=(True, False, False))
    p = p.edges("|Y").fillet(PR)
    try:
        p = p.faces("<Y").edges().fillet(1.5)
    except Exception:
        pass
    # screw posts: 45 deg underside so they print without support (plate prints upright)
    for sx in (-1, 1):
        x0 = sx * (IW / 2 - 0.2) - (POST_W if sx > 0 else 0)
        for pz in POST_Z:
            prof = (cq.Workplane("YZ", origin=(x0, 0, 0))
                    .polyline([(1.0, pz), (1.0, pz + POST_H), (-POST_D, pz + POST_H),
                               (-POST_D, pz + POST_D), (0, pz)]).close().extrude(POST_W))
            p = p.union(prof)
            p = p.cut(xcyl(2.5 / 2, x0 - 0.1, x0 + POST_W + 0.1, SCREW_Y, screw_z(pz)))
    # cable clip below the hood: hook profile extruded along Z, cable slides in from +X
    hook = (cq.Workplane("XY", origin=(0, 0, 4.0))
            .polyline([(-9, 1), (-9, -6.4), (7, -6.4), (7, -2.2), (4.5, -2.2), (4.5, -3.4),
                       (-6, -3.4), (-6, 1)]).close().extrude(16.0))
    p = p.union(hook)
    # countersunk holes for #8 wood screws (hidden behind the camera)
    for z in (46.0, 82.0):
        p = p.cut(ycyl(2.3, -1, PT + 1, 0, z))
        p = p.cut(cq.Workplane("XY").add(cq.Solid.makeCone(5.3, 2.3, 3.0, cq.Vector(0, -0.5, z), cq.Vector(0, 1, 0))))
    p = p.clean()
    if not p.val().isValid():
        raise ValueError("wall plate is not a valid solid")
    return p


def hood():
    y0 = -HD
    outer = cq.Workplane("XY").box(HW, HD, HH, centered=(True, False, False)).translate((0, y0, ZB))
    outer = outer.edges("|Y").fillet(6.0)
    try:
        outer = outer.faces("<Y").edges().fillet(2.0)
    except Exception:
        pass
    cav = (cq.Workplane("XY").box(IW, ID + 2, IH, centered=(True, False, False))
           .translate((0, -ID, ZB + FLOOR)).edges("|Y").fillet(3.5))
    h = outer.cut(cav)
    win =(cq.Workplane("XY").box(WIN_W, WALL + 2, WIN_H).edges("|Y").fillet(WIN_R)
           .translate((0, y0 + WALL / 2, CAM_Z0 + CH / 2)))
    h = h.cut(win)
    # slotted hole for the camera's 1/4"-20 screw, with a shallow counterbore for the head
    h = h.cut(cq.Workplane("XY").slot2D(22, 6.8, 90).extrude(FLOOR + 2).translate((0, CAM_YC, ZB - 1)))
    h = h.cut(cq.Workplane("XY").slot2D(28, 13, 90).extrude(1.5 + 1).translate((0, CAM_YC, ZB - 1)))
    # cable notch at the back of the floor
    h = h.cut(cq.Workplane("XY").box(12, 10 + 1, FLOOR + 2, centered=(True, False, False))
              .translate((0, -10, ZB - 1)))
    # side clearance holes onto the screw posts
    for pz in POST_Z:
        h = h.cut(xcyl(3.4 / 2, -HW / 2 - 1, HW / 2 + 1, SCREW_Y, screw_z(pz)))
    return h


def camera():
    c = (cq.Workplane("XY").box(CW, CD, CH, centered=(True, False, False))
         .translate((0, CAM_Y0, CAM_Z0)).edges("|Y").fillet(7.0))
    lens = ycyl(9.0, CAM_Y0 - 0.8, CAM_Y0 + 1, 0, CAM_Z0 + CH * 0.58)
    return c, lens


def parts():
    cam, lens = camera()
    screw = (cq.Workplane("XY").circle(6.0).extrude(1.5).translate((0, CAM_YC, ZB + 1.5 - 1.5))
             .union(cq.Workplane("XY").circle(3.15).extrude(9.5).translate((0, CAM_YC, ZB + 1.5 - 1.5 + 1.5 - 0.01))))
    screws = []
    for pz in POST_Z:
        screws += [(HW / 2, SCREW_Y, screw_z(pz))]
    return [
        {"name": "Wall plate", "shape": wall_plate(), "group": "case", "color": "#e8e8e4"},
        {"name": "Camera hood", "shape": hood(), "group": "case", "color": "#2b2d30", "explode": [0, -1, 0]},
        {"name": "Wyze Cam v3 (yours)", "shape": cam.union(lens), "group": "component", "color": "#f4f4f4"},
        {"name": "1/4-20 camera screw", "shape": screw, "group": "component", "color": "#9a9ca0",
         "explode": [0, 0, -1]},
        part("m3x10_selftap", at=screws, rot=(0, 90, 0)),
        part("m3x10_selftap", at=[(-x, y, z) for x, y, z in screws], rot=(0, -90, 0)),
    ]

import math
import cadquery as cq
from cadlib.parts import part

SCENE = "shelf"

# bought aluminium tube: DMiotech 6061, 45 OD x 42 ID, 300 mm (cut in half -> 2 bodies)
D = 45.0          # tube OD = foot / cap diameter
TUBE_ID = 42.0
TUBE_L = 145.0    # half of 300 mm minus saw kerf and squaring
BASE_H = 12.0     # white foot
CAP_H = 4.0       # white top cap
H = BASE_H + TUBE_L + CAP_H
SPIGOT = 6.0      # foot / cap spigot length into the tube
FIT = 0.15        # press fit on spigots

# front strip (printed, curved to the tube, stuck on with VHB)
STRIP_W, STRIP_H, STRIP_Z0 = 20.0, 100.0, BASE_H + 32.0
TAPE = 0.3
STRIP_RI = D / 2 + TAPE
STRIP_RO = STRIP_RI + 2.0
TUBE_HOLE = 12.0  # drilled with a step bit: lens + PIR
BOSS_D = TUBE_HOLE - 0.3

# electronics (XIAO ESP32S3 Sense: 21 x 17.8 x 15 stack, Seeed wiki)
LENS_Z = STRIP_Z0 + STRIP_H - 11.0
LENS_FRONT = -TUBE_ID / 2 + 0.2     # lens just inside the tube wall
STACK_D = 15.0
PIR_Z = STRIP_Z0 + 13.0             # AM312 mini PIR, 10 dia x 23 incl. lens
PIR_D, PIR_L = 10.0, 23.0
PIR_FRONT = -(STRIP_RO - 0.8)

# internal chassis plate
PLATE_Y0 = LENS_FRONT + STACK_D     # plate front face
PLATE_T = 3.0
PLATE_Z0 = BASE_H + SPIGOT
PLATE_Z1 = H - CAP_H - SPIGOT - 1.0
SCREW_Z = BASE_H + SPIGOT / 2


def cyl(d, h, z0=0.0):
    return cq.Workplane("XY").workplane(offset=z0).circle(d / 2).extrude(h)


def box(x0, x1, y0, y1, z0, z1):
    return (cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0)
            .translate(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)))


def ycyl(d, y0, y1, x=0.0, z=0.0):
    return (cq.Workplane("XZ").workplane(offset=-y0).center(x, z)
            .circle(d / 2).extrude(-(y1 - y0)))


def radial(r, d, length, a, z):
    x, y = r * math.sin(math.radians(a)), r * math.cos(math.radians(a))
    return cq.Workplane("XY").cylinder(length, d / 2, direct=(x, y, 0)).translate((x, y, z))


def soft(wp, sel, r):
    try:
        return wp.edges(sel).fillet(r)
    except Exception:
        return wp


def chord_half(y, r=TUBE_ID / 2):
    return (r * r - y * y) ** 0.5


def parts():
    # ---- aluminium tube: one hacksaw cut, 2 x 12 mm + 2 x 2.9 mm holes -----
    tube = cyl(D, TUBE_L, BASE_H).cut(cyl(TUBE_ID, TUBE_L + 2, BASE_H - 1))
    for z in (LENS_Z, PIR_Z):
        tube = tube.cut(ycyl(TUBE_HOLE, -30, -15, z=z))
    for a in (-35, 35):
        tube = tube.cut(radial(D / 2, 2.9, 6, a, SCREW_Z))

    # ---- foot: white puck with spigot, cable hole and groove -------------
    base = cyl(D, BASE_H)
    base = soft(base, "<Z", 2.0)
    base = soft(base, ">Z", 0.8)
    base = base.union(cyl(TUBE_ID - FIT * 2, SPIGOT + 0.5, BASE_H - 0.5))
    base = base.cut(cyl(TUBE_ID - 6, SPIGOT + 1, BASE_H + 1))  # hollow spigot ring
    base = base.cut(box(-7, 7, 4, 13, -1, 30))                 # USB-C plug passes up
    base = base.cut(box(-2.6, 2.6, 4, 30, -1, 4.5))            # cable groove to the back
    for x in (-12, 12):                                        # chassis screws from below
        base = base.cut(cq.Workplane("XY").circle(1.4).extrude(30).translate((x, PLATE_Y0 + 1.5, -1)))
        base = base.cut(cq.Workplane("XY").circle(2.6).extrude(2.5).translate((x, PLATE_Y0 + 1.5, -0.01)))
    for a in (-35, 35):                                        # M2.5 pilots for the tube screws
        base = base.cut(radial(TUBE_ID / 2 - 3, 2.0, 7, a, SCREW_Z))

    # ---- top cap: white disc, rounded top, press-fit spigot --------------
    cap = cyl(D, CAP_H, H - CAP_H)
    cap = soft(cap, ">Z", 1.8)
    cap = cap.union(cyl(TUBE_ID - FIT * 2, SPIGOT + 0.5, H - CAP_H - SPIGOT))
    cap = cap.cut(cyl(TUBE_ID - 6, SPIGOT, H - CAP_H - SPIGOT - 0.01))

    # ---- front strip: curved black bezel, bosses key into the tube holes --
    z0, z1 = STRIP_Z0, STRIP_Z0 + STRIP_H
    strip = cyl(STRIP_RO * 2, STRIP_H, z0).cut(cyl(STRIP_RI * 2, STRIP_H + 2, z0 - 1))
    strip = strip.intersect(box(-STRIP_W / 2, STRIP_W / 2, -40, -10, z0, z1))
    strip = soft(strip, "|Y", 0.8)
    for z in (LENS_Z, PIR_Z):
        boss = ycyl(BOSS_D, -(STRIP_RI + 0.5), -(TUBE_ID / 2 + 0.3), z=z)
        strip = strip.union(boss)
        strip = strip.cut(ycyl(PIR_D + 0.4, -40, -10, z=z))

    # ---- chassis: plate that slides in the bore, holds camera + PIR ------
    yp0, yp1 = PLATE_Y0, PLATE_Y0 + PLATE_T
    hw = chord_half(yp1) - 0.4
    plate = box(-hw, hw, yp0, yp1, PLATE_Z0, PLATE_Z1)
    fhw = chord_half(yp0 - 4) - 0.4                            # foot block, 2 M2.5 pilots
    plate = plate.union(box(-fhw, fhw, yp0 - 4, yp1 + 4, PLATE_Z0, PLATE_Z0 + 8))
    cx0, cx1 = -17.8 / 2 - 0.3, 17.8 / 2 + 0.3                 # camera pocket, bottom open
    cz0, cz1 = LENS_Z - 10.5 - 0.3, LENS_Z + 10.5 + 0.3
    frame = box(cx0 - 2, cx1 + 2, yp0 - 9, yp0 + 1, cz0, cz1 + 2)
    frame = frame.cut(box(cx0, cx1, yp0 - 10, yp0 + 0.01, cz0 - 1, cz1))
    plate = plate.union(frame)
    plate = plate.cut(box(-6, 6, yp0 - 1, yp1 + 1, cz0 - 12, cz0 + 4))   # plug clearance
    plate = plate.union(ycyl(PIR_D + 4, -(TUBE_ID / 2 - 2.5), yp0 + 1, z=PIR_Z))  # PIR sleeve
    plate = plate.cut(ycyl(PIR_D + 0.2, -30, yp1 + 1, z=PIR_Z))
    for x in (-12, 12):
        plate = plate.cut(cq.Workplane("XY").circle(1.0).extrude(9)
                          .translate((x, yp0 + 1.5, PLATE_Z0 - 1)))

    # ---- bought parts (dummies; the library has the plain XIAO only) -----
    xiao = box(-17.8 / 2, 17.8 / 2, LENS_FRONT + 5, LENS_FRONT + STACK_D,
               LENS_Z - 10.5, LENS_Z + 10.5)
    cam = box(-4.25, 4.25, LENS_FRONT + 2, LENS_FRONT + 5, LENS_Z - 4.25, LENS_Z + 4.25)
    cam = cam.union(ycyl(7, LENS_FRONT, LENS_FRONT + 2, z=LENS_Z))
    pir = ycyl(PIR_D, PIR_FRONT + 4, PIR_FRONT + PIR_L, z=PIR_Z)
    pir = pir.union(cq.Workplane("XY").sphere(PIR_D / 2).translate((0, PIR_FRONT + 5, PIR_Z)))
    pir = pir.cut(box(-6, 6, -40, PIR_FRONT, PIR_Z - 6, PIR_Z + 6))

    screws_base = part("m25x8_selftap", at=[(-12, PLATE_Y0 + 1.5, 2.5), (12, PLATE_Y0 + 1.5, 2.5)],
                       rot=(180, 0, 0))
    tube_screws = [part("m25x8_selftap",
                        at=(D / 2 * math.sin(math.radians(a)), D / 2 * math.cos(math.radians(a)), SCREW_Z),
                        rot=(-90, 0, -a)) for a in (-35, 35)]

    return [
        {"name": "Base", "shape": base, "group": "case", "color": "#f2f2f0",
         "explode": [0, 0, -1],
         "cable": {"type": "usb-c", "at": [0, D / 2, 2.5], "dir": [0, 1, 0], "length_mm": 600}},
        {"name": "Aluminium tube", "shape": tube, "group": "component", "process": "bought",
         "material": "aluminium", "color": "#d2c4ae"},
        {"name": "Chassis", "shape": plate, "group": "case", "color": "#3a3a3a", "explode": [0, 1, 0]},
        {"name": "Top cap", "shape": cap, "group": "case", "color": "#f2f2f0", "explode": [0, 0, 1]},
        {"name": "Front strip", "shape": strip, "group": "case", "color": "#141416",
         "explode": [0, -1, 0]},
        {"name": "XIAO ESP32S3 Sense", "shape": xiao, "group": "component", "color": "#1d3b2a",
         "explode": [0, 1, 0]},
        {"name": "Camera module", "shape": cam, "group": "component", "color": "#111111",
         "explode": [0, 1, 0]},
        {"name": "AM312 PIR sensor", "shape": pir, "group": "component", "color": "#f4f4f4",
         "explode": [0, 1, 0]},
        screws_base,
        *tube_screws,
    ]


ASSEMBLY = [["Base"], ["Chassis"], ["XIAO ESP32S3 Sense", "Camera module", "AM312 PIR sensor"],
            ["Aluminium tube"], ["Front strip"], ["Top cap"]]

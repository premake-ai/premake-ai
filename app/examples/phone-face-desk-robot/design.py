import math
import cadquery as cq
from cadlib.parts import part, info
from cadlib.refmodels import ref
from cadlib.dims import dim
from cadlib.motion import rot

SCENE = "desk"

# ---- chassis ----
CH_W, CH_D, CH_Z0, CH_Z1 = 106, 100, 6, 40     # tub between the tracks
WALL, FLOOR = 2.0, 2.0
FZ = CH_Z0 + FLOOR                              # inside floor height
COV_T = 2.5                                     # top cover thickness
COV_Z = CH_Z1 + COV_T
# ---- tracks ----
TR_W, WR, TR_T, WY, WZ = 14, 17, 2.5, 32, 17    # width, outer radius, belt, wheel y, axle z
TR_X0 = CH_W / 2 + 1.5                          # inner face of track
# ---- head / tilt ----
PIV_Y, PIV_Z = 17, 53.5                         # tilt axis along X
PH = dim("iphone_16")
PH_Z = 95.5                                     # phone / puck centre height
FACE_Y = -6                                     # front of face mount = phone back
PUCK_D, PUCK_T = 58.5, 6.2                      # Urbbalume 15 W puck (Amazon listing)
LIP = 1.2
DISC_R = 33
EAR_R, EARS = 37, [(37, 0), (-37, 0), (0, -37)] # (x, dz) of the 3 screw ears
BACK_Y = FACE_Y + LIP + PUCK_T + 0.3            # face/back split plane
SHAFT_X = 20                                    # SG90 spline tip


def rbox(x0, x1, y0, y1, z0, z1, r=0):
    b = cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))
    if r:
        try:
            b = b.edges("|Z").fillet(r)
        except Exception:
            pass
    return b


def ycyl(r, y0, y1, x, z):
    return cq.Workplane("XZ", origin=(x, y1, z)).circle(r).extrude(y1 - y0)


def xcyl(r, x0, x1, y, z):
    return cq.Workplane("YZ", origin=(x0, y, z)).circle(r).extrude(x1 - x0)


def stadium(r, x0, w):
    s = rbox(x0, x0 + w, -WY, WY, WZ - r, WZ + r)
    for y in (-WY, WY):
        s = s.union(xcyl(r, x0, x0 + w, y, WZ))
    return s


# ---------------- printed parts ----------------
def chassis():
    hw, hd = CH_W / 2, CH_D / 2
    body = rbox(-hw, hw, -hd, hd, CH_Z0, CH_Z1, 12)
    try:
        body = body.faces("<Z").edges().fillet(3)
    except Exception:
        pass
    body = body.cut(rbox(-hw + WALL, hw - WALL, -hd + WALL, hd - WALL, FZ, CH_Z1 + 1, 9.5))
    # corner bosses for the cover screws (M3 inserts)
    for x in (-44, 44):
        for y in (-43, 43):
            body = body.union(cq.Workplane("XY").circle(4.0).extrude(CH_Z1 - FZ + 0.5)
                              .translate((x, y, FZ - 0.5)))
            body = body.cut(cq.Workplane("XY").circle(2.0).extrude(7).translate((x, y, CH_Z1 - 7)))
    # snap-in cradles for the N20 motors (front axle)
    for sx in (-1, 1):
        xa, xb = sorted((sx * 27, sx * (hw - WALL + 0.5)))
        cr = rbox(xa, xb, -WY - 7, -WY + 7, FZ - 0.5, WZ + 4)
        cr = cr.cut(rbox(xa - 1, xb + 1, -WY - 5.1, -WY + 5.1, WZ - 6.1, WZ + 10))
        body = body.union(cr)
        body = body.cut(xcyl(2.2, sx * hw - 4, sx * hw + 4, -WY, WZ) if sx > 0 else
                        xcyl(2.2, -hw - 4, -hw + 4, -WY, WZ))
        # idler axle hole (rear)
        body = body.cut(xcyl(1.7, -hw - 4, hw + 4, WY, WZ))
    # cliff sensor windows
    for x in (-18, 18):
        body = body.cut(rbox(x - 6, x + 6, -45, -39, CH_Z0 - 1, FZ + 1))
        body = body.union(rbox(x - 9, x + 9, -47.6, -38, FZ - 0.5, FZ + 6)
                          .cut(rbox(x - 7.2, x + 7.2, -45.5, -40, FZ - 1, FZ + 7)))
    # back wall: USB-C charge port and power switch
    body = body.cut(rbox(-25, -9, hd - 4, hd + 1, 26, 34, 0))
    body = body.cut(rbox(9, 22, hd - 4, hd + 1, 23, 32, 0))
    return body


def top_cover():
    hw, hd = CH_W / 2, CH_D / 2
    plate = rbox(-hw, hw, -hd, hd, CH_Z1, COV_Z, 12)
    lip = (rbox(-hw + WALL + 0.3, hw - WALL - 0.3, -hd + WALL + 0.3, hd - WALL - 0.3, CH_Z1 - 4, CH_Z1 + 0.5, 9)
           .cut(rbox(-hw + WALL + 1.8, hw - WALL - 1.8, -hd + WALL + 1.8, hd - WALL - 1.8, CH_Z1 - 5, CH_Z1 + 1, 7.5)))
    plate = plate.union(lip)
    for x in (-44, 44):
        for y in (-43, 43):
            plate = plate.cut(cq.Workplane("XY").circle(1.75).extrude(20).translate((x, y, CH_Z1 - 10)))
            plate = plate.cut(cq.Workplane("XY").circle(4.6).extrude(5).translate((x, y, CH_Z1 - 4.6)))
    # towers: right one carries the SG90, left one the M3 axle
    top = PIV_Z + 8.8
    rt = rbox(24, hw, -6.9, 29.9, COV_Z - 1, top, 4)
    lt = rbox(-32, -24, -1, 30, COV_Z - 1, top, 3)
    for t in (rt, lt):
        try:
            t = t.faces(">Z").edges().fillet(2)
        except Exception:
            pass
        plate = plate.union(t)
    sy = PIV_Y - 5.5                                 # servo body centre y
    plate = plate.cut(rbox(SHAFT_X + 29.9 - 22.9, hw + 1, sy - 11.6, sy + 11.6, PIV_Z - 6.3, PIV_Z + 6.3))
    plate = plate.cut(rbox(SHAFT_X + 29.9 - 18.5, hw + 1, sy - 16.4, sy + 16.4, PIV_Z - 6.3, PIV_Z + 6.3))
    plate = plate.cut(xcyl(6.5, 20, 28, PIV_Y, PIV_Z))              # spline boss
    plate = plate.cut(rbox(30, 46, sy - 4, sy + 4, CH_Z1 - 1, PIV_Z))  # servo cable down
    plate = plate.cut(xcyl(1.75, -40, -20, PIV_Y, PIV_Z))           # axle
    plate = plate.cut(rbox(-8, 8, -5, 3, CH_Z1 - 5, COV_Z + 1, 2))  # puck cable + plug
    return plate


def face_mount():
    f = ycyl(DISC_R, FACE_Y, BACK_Y, 0, PH_Z)
    for x, dz in EARS:
        f = f.union(ycyl(5, FACE_Y + 1.5, BACK_Y, x, PH_Z + dz))
        f = f.union(rbox(min(0, x) - 4 if x else -4, max(0, x) + 4 if x else 4,
                         FACE_Y + 1.5, BACK_Y, PH_Z + min(0, dz) - 4 if dz else PH_Z - 4,
                         PH_Z + max(0, dz) + 4 if dz else PH_Z + 4)
                    .intersect(ycyl(EAR_R + 5, FACE_Y, BACK_Y, 0, PH_Z)))
        f = f.cut(ycyl(2.0, BACK_Y - 6, BACK_Y + 1, x, PH_Z + dz))
    f = f.cut(ycyl(PUCK_D / 2 + 0.35, FACE_Y + LIP, BACK_Y + 1, 0, PH_Z))
    f = f.cut(ycyl(PUCK_D / 2 - 2.5, FACE_Y - 1, FACE_Y + LIP + 0.1, 0, PH_Z))
    f = f.cut(rbox(-3.5, 3.5, FACE_Y + LIP, BACK_Y + 1, PH_Z - DISC_R - 6, PH_Z - 20))  # cable exit
    return f


def head_back():
    bt = 3
    b = ycyl(DISC_R, BACK_Y, BACK_Y + bt, 0, PH_Z)
    for x, dz in EARS:
        b = b.union(ycyl(5, BACK_Y, BACK_Y + bt, x, PH_Z + dz))
    b = b.union(ycyl(EAR_R - 2, BACK_Y, BACK_Y + bt, 0, PH_Z)
                .intersect(rbox(-EAR_R - 6, EAR_R + 6, BACK_Y, BACK_Y + bt, PH_Z - 4, PH_Z + 4)))
    neck = rbox(-17, 17, BACK_Y, PIV_Y + 4, PIV_Z - 3, PH_Z - 18, 0)
    try:
        neck = neck.edges("|Y").fillet(5)
    except Exception:
        pass
    b = b.union(neck).union(xcyl(7, -23.6, 19.6, PIV_Y, PIV_Z))
    # hollow the neck from the back, leaving 3 mm side walls and the front web
    b = b.cut(rbox(-14, 14, BACK_Y + 2.5, PIV_Y + 8, PIV_Z - 8, PH_Z - 21, 2))
    for x, dz in EARS:
        b = b.cut(ycyl(1.75, BACK_Y - 1, BACK_Y + bt + 1, x, PH_Z + dz))
    b = b.cut(xcyl(2.0, -24, -16.5, PIV_Y, PIV_Z))                 # M3 insert, axle side
    b = b.cut(xcyl(3.8, 17.4, 21, PIV_Y, PIV_Z))                   # horn hub
    b = b.cut(rbox(17.4, 21, PIV_Y - 2.9, PIV_Y + 2.9, PIV_Z, PIV_Z + 17))  # horn arm
    b = b.cut(rbox(-3.5, 3.5, BACK_Y - 1, BACK_Y + 1.5, PH_Z - DISC_R - 6, PH_Z - 20))  # cable
    return b


def track(x0):
    t = stadium(WR, x0, TR_W).cut(stadium(WR - TR_T, x0, TR_W))
    t = t.union(stadium(WR - TR_T + 0.5, x0 + TR_W / 2 - 2, 4)
                .cut(stadium(WR - TR_T - 2, x0 + TR_W / 2 - 2.5, 5)))  # guide ridge
    for i in range(-3, 4):
        y = i * 8.5
        for z in (WZ - WR - 1.0, WZ + WR - 0.2):
            t = t.union(rbox(x0, x0 + TR_W, y - 1.2, y + 1.2, z, z + 1.2))
    return t


def wheel(x0, y, drive):
    r = WR - TR_T - 0.2
    w = xcyl(r, x0, x0 + TR_W, y, WZ).cut(xcyl(r + 1, x0 + TR_W / 2 - 2.3, x0 + TR_W / 2 + 2.3, y, WZ))
    w = w.cut(xcyl(r - 3.8, x0 - 1, x0 + TR_W + 1, y, WZ))          # rim only
    w = w.union(xcyl(r - 2.3, x0 + TR_W / 2 - 3.5, x0 + TR_W / 2 + 3.5, y, WZ))  # web + groove floor
    w = w.union(xcyl(4.5, x0, x0 + TR_W, y, WZ))                    # hub
    if drive:   # 3 mm D bore from the inside, 7 deep
        inner = x0 if x0 > 0 else x0 + TR_W
        a, b = sorted((inner, inner + (7 if x0 > 0 else -7)))
        bore = xcyl(1.5, a, b, y, WZ).cut(rbox(a - 1, b + 1, y - 3, y + 3, WZ + 1.25, WZ + 3))
        w = w.cut(bore)
    else:
        w = w.cut(xcyl(1.75, x0 - 1, x0 + TR_W + 1, y, WZ))
    return w


def dummy(name, box, color, at, **kw):
    x, y, z = box
    s = rbox(at[0] - x / 2, at[0] + x / 2, at[1] - y / 2, at[1] + y / 2, at[2], at[2] + z)
    return dict(name=name, shape=s, group="component", color=color, **kw)


def parts():
    out = [
        {"name": "Chassis", "shape": chassis(), "color": "#f1efe9", "explode": [0, 0, -1]},
        {"name": "Top cover", "shape": top_cover(), "color": "#f1efe9", "explode": [0, 0, 1]},
        {"name": "Face mount", "id": "face", "shape": face_mount(), "color": "#ff8a3d", "explode": [0, -1, 1]},
        {"name": "Head back", "id": "headback", "shape": head_back(), "color": "#f1efe9", "explode": [0, 1, 1]},
    ]
    for side, sx in (("L", -1), ("R", 1)):
        x0 = TR_X0 if sx > 0 else -TR_X0 - TR_W
        out.append({"name": f"Track {side}", "shape": track(x0), "color": "#2b2b2b",
                    "material": "rubber", "explode": [sx, 0, 0]})
        out.append({"name": f"Drive wheel {side}", "id": f"dw{side}", "shape": wheel(x0, -WY, True),
                    "color": "#ff8a3d", "explode": [sx, 0, 0]})
        out.append({"name": f"Idler wheel {side}", "id": f"iw{side}", "shape": wheel(x0, WY, False),
                    "color": "#ff8a3d", "explode": [sx, 0, 0]})

    # ---- head hardware ----
    out.append(dummy("Magnetic charger puck", (PUCK_D, PUCK_T, PUCK_D), "#d9d9d9", (0, 0, 0))
               | {"shape": ycyl(PUCK_D / 2, FACE_Y + LIP, FACE_Y + LIP + PUCK_T, 0, PH_Z),
                  "id": "puck", "explode": [0, -1, 1]})
    head_scr = part("m3x8_bhcs", at=[(x, BACK_Y + 3, PH_Z + dz) for x, dz in EARS], rot=(-90, 0, 0))
    head_scr["id"] = "headscrews"
    head_ins = part("m3_insert", at=[(x, BACK_Y, PH_Z + dz) for x, dz in EARS], rot=(90, 0, 0))
    head_ins["id"] = "headinserts"
    out += [head_scr, head_ins]
    phone = ref("iphone_16", at=(-PH["height_mm"] / 2, FACE_Y - 5.25, PH_Z), rot=(0, 90, 0))
    phone["id"] = "phone"
    out.append(phone)
    out.append(part("sg90", at=(SHAFT_X + 29.9, PIV_Y - 5.5, PIV_Z), rot=(-90, 0, 90)))
    axle = part("m3x16_shcs", at=(-32, PIV_Y, PIV_Z), rot=(0, -90, 0))
    axle_ins = part("m3_insert", at=(-23.6, PIV_Y, PIV_Z), rot=(0, 90, 0))
    axle_ins["name"] = "M3 heat-set insert (tilt axle)"
    axle_ins["id"] = "axleins"
    out += [axle, axle_ins]

    # ---- drive ----
    for sx in (-1, 1):
        x_in, x_out = sx * 26.5, sx * 50.5
        out.append(dummy("N20 gear motor 6V 100rpm", (24, 10, 12), "#b8bcc2",
                         ((x_in + x_out) / 2, -WY, WZ - 6)))
    out.append(part("m3x25_bhcs", at=[(sx * (TR_X0 + TR_W), WY, WZ) for sx in (-1, 1)],
                    rot=[(0, -90, 0), (0, 90, 0)]))
    out.append(part("m3_nylock", at=[(-CH_W / 2 + WALL, WY, WZ), (CH_W / 2 - WALL, WY, WZ)],
                    rot=[(0, 90, 0), (0, -90, 0)]))

    # ---- power and electronics ----
    out.append(dummy("2x18650 battery shield (USB-C)", (100.3, 48.3, 1.6), "#1f6f3a", (0, -2, FZ)))
    out.append(part("cell_18650", at=[(0, -2 - 11, FZ + 2.6), (0, -2 + 11, FZ + 2.6)]))
    out.append(part("esp32_c3_supermini", at=(-22, 38, FZ + 4)))
    out.append(dummy("DRV8833 motor driver", (18.5, 16, 4), "#2255aa", (2, 38, FZ + 4)))
    out.append(dummy("D4184 MOSFET module (charger switch)", (34, 17, 10), "#2255aa", (30, 39, FZ)))
    for x in (-18, 18):
        out.append(dummy("TCRT5000 cliff sensor", (14, 6, 32), "#2255aa", (x, -42.7, FZ - 1.8)))
    out.append(dummy("USB-C panel extension", (16, 22, 8), "#333333", (-17, CH_D / 2 - 11, 26)))
    out.append(dummy("Mini rocker switch", (13, 18, 9), "#222222", (15.5, CH_D / 2 - 7, 23)))
    out.append(part("m3_insert", at=[(x, y, CH_Z1 - 6) for x in (-44, 44) for y in (-43, 43)]))
    out.append(part("m3x10_bhcs", at=[(x, y, COV_Z - 4.6) for x in (-44, 44) for y in (-43, 43)]))
    print("phone", PH)
    for k in ("cell_18650", "esp32_c3_supermini", "m3_insert", "m3x8_bhcs"):
        print(k, info(k)["bbox_min"], info(k)["bbox_max"], info(k).get("origin"))
    return out

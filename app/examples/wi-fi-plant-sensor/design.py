import cadquery as cq
from cadlib import fab
from cadlib.parts import part
from cadlib.dims import dim

# Wi-Fi plant sensor: soil-stake capacitive probe + printed head with
# ESP32-C3, 18650 cell (printed bay + spring contacts), USB-C charger,
# BH1750 light sensor under a clear window, BME280 behind front vents.

SCENE = "desk"

W, D = 48.0, 39.0          # head footprint
R = 10.0                   # corner radius
WALL = 2.4
Z0, ZB, ZT = 70.0, 150.0, 162.0   # head bottom (soil line), body/cap split, top
FLOOR = 3.0
IW, ID, IR = W - 2 * WALL, D - 2 * WALL, R - WALL

PROBE_W, PROBE_L, PROBE_T = 23.0, 98.0, 1.6   # capacitive soil sensor v1.2
PROBE_Y = -12.0
CELL_Y = 7.5                                   # 18650 axis (x=0)
BAY_Z = 87.0                                   # bay floor
BH_Y = -9.5                                    # light sensor centre
SCREWS = [(-15.0, 12.0), (15.0, 12.0)]
TP_X0, TP_X1, TP_Z0, TP_Z1 = -21.3, 6.7, 122.0, 139.0   # TP4056 USB-C board
USB_Y, USB_Z = -10.6, 130.5

plug = dim("usbc_plug")
USB_HW = plug["overmold_max_width_mm"] + 0.8    # cable overmold must reach the jack
USB_HH = plug["overmold_max_height_mm"] + 0.8
ACR_T = 0.0   # light sensor sits straight under the cap's thin window


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def rbox(w, d, z0, z1, r, cx=0.0, cy=0.0):
    return (cq.Workplane("XY").box(w, d, z1 - z0, centered=(True, True, False))
            .edges("|Z").fillet(r).translate((cx, cy, z0)))


def cyl(x, y, r, z0, z1):
    return cq.Workplane("XY").circle(r).extrude(z1 - z0).translate((x, y, z0))


def make_body():
    b = rbox(W, D, Z0, ZB, R)
    try:
        b = b.faces("<Z").edges().fillet(2.5)
    except Exception:
        pass
    b = b.cut(rbox(IW, ID, Z0 + FLOOR, ZB + 1, IR))
    # probe edge guides, then ESP32-C3 guides, then TP4056 guides (stacked posts)
    for s in (-1, 1):
        b = b.union(box(*sorted((s * 10.3, s * 21.8)), -14.5, -9.5, Z0 + 2, 99))
        b = b.union(box(*sorted((s * 10.55, s * 22.8)), -11.0, -6.5, 99, 120))
    b = b.union(box(-22.8, -20.1, -11.0, -6.5, 120, 126))
    b = b.union(box(-22.8, -20.1, -11.0, -6.5, 135, 141))
    b = b.union(box(5.5, 21.8, -15.5, -6.5, 120, 141))
    # battery bay tube with solid pedestal, and screw bosses tied to the back wall
    b = b.union(cyl(0, CELL_Y, 11.3, Z0 + 2, ZB))
    for x, y in SCREWS:
        b = b.union(cyl(x, y, 2.5, Z0 + 2, ZB))
        b = b.union(box(x - 2.5, x + 2.5, y, ID / 2 + 1.0, Z0 + 2, ZB))
    # cuts
    b = b.cut(box(-PROBE_W / 2 - 0.3, PROBE_W / 2 + 0.3, PROBE_Y - 0.9, PROBE_Y + 0.9, Z0 - 1, 99))
    b = b.cut(box(-12.05, 12.05, -9.3, -7.7, 101, 125))                     # C3 slot
    b = b.cut(box(TP_X0 - 0.3, TP_X1 + 0.3, -9.3, -7.1, TP_Z0, ZB + 1))     # TP4056 slot
    b = b.cut(box(TP_X0 - 0.3, TP_X1 + 0.3, -12.6, -9.3, TP_Z0, ZB + 1))    # its parts
    b = b.cut(box(7.2, 19.8, -14.4, -12.6, 124, ZB + 1))                    # BME280 slot
    b = b.cut(box(8.5, 18.5, -16.0, -12.4, 125.5, ZB + 1))                  # air path
    b = b.cut(cyl(0, CELL_Y, 9.7, BAY_Z, ZB + 1))                           # cell bore
    b = b.cut(box(-1.5, 1.5, CELL_Y - 12, CELL_Y - 8, BAY_Z, ZB + 1))       # wire slit
    for x, y in SCREWS:
        b = b.cut(cyl(x, y, 0.85, ZB - 12, ZB + 1))                         # M2 pilot
    usb = (cq.Workplane("YZ").rect(USB_HW, USB_HH).extrude(8)
           .edges("|X").fillet(min(USB_HH / 2 - 0.1, 3)).translate((-27, USB_Y, USB_Z)))
    b = b.cut(usb)
    for x in (9.0, 11.5, 14.0, 16.5):
        b = b.cut(box(x - 0.8, x + 0.8, -22, -16, 126, 137))                 # BME vents
    return b


def make_cap():
    c = rbox(W, D, ZB, ZT, R)
    try:
        c = c.faces(">Z").edges().fillet(5)
    except Exception:
        pass
    c = c.cut(rbox(IW, ID, ZB - 1, ZT - WALL, IR))
    lip = rbox(IW - 0.6, ID - 0.6, ZB - 5, ZT - 1, IR - 0.3).cut(
        rbox(IW - 3.8, ID - 3.8, ZB - 6, ZT, IR - 1.9))
    c = c.union(lip.intersect(box(-30, 30, -30, 3, ZB - 6, ZT)))
    c = c.union(box(-11.05, 11.05, BH_Y - 8.75, BH_Y + 8.75, ZB + 0.5, ZT - 1))   # sensor frame
    c = c.union(cyl(0, CELL_Y, 9.0, ZT - 4.4, ZT - 1))                            # spring rim
    for x, y in SCREWS:
        c = c.union(cyl(x, y, 3.5, ZB, ZT - 1))
        c = c.union(box(x - 3.5, x + 3.5, y, ID / 2 + 1.0, ZB, ZT - 1))
    c = c.cut(box(-9.45, 9.45, BH_Y - 7.15, BH_Y + 7.15, ZB, ZT - WALL))
    c = c.cut(cyl(0, BH_Y, 5.0, ZT - 5, ZT - 1.2))           # 1.2 mm translucent light window
    c = c.cut(cyl(0, CELL_Y, 7.8, ZT - 6, ZT - WALL))
    for x, y in SCREWS:
        c = c.cut(cyl(x, y, 1.2, ZB - 1, ZT + 1))
        c = c.cut(cyl(x, y, 2.1, ZB + 2, ZT + 1))                                 # head counterbore
    return c


def parts():
    probe = (cq.Workplane("XZ").polyline([(-PROBE_W / 2, PROBE_L), (PROBE_W / 2, PROBE_L),
                                         (PROBE_W / 2, 8), (0, 0), (-PROBE_W / 2, 8)]).close()
             .extrude(-PROBE_T).translate((0, PROBE_Y - PROBE_T / 2, 0)))
    probe = probe.union(box(-8, 8, PROBE_Y + 0.8, PROBE_Y + 3.5, 78, 94))
    tp = box(TP_X0, TP_X1, -9.0, -7.4, TP_Z0, TP_Z1).union(
        box(TP_X0 - 0.5, TP_X0 + 7, USB_Y - 1.6, -9.0, USB_Z - 4.5, USB_Z + 4.5))
    bme = box(7.5, 19.5, -14.2, -12.8, 124, 139).union(box(12.2, 14.8, -15.2, -14.2, 130, 132.5))
    bh = box(-9.25, 9.25, BH_Y - 6.95, BH_Y + 6.95, ZT - WALL - ACR_T - 2.5, ZT - WALL - ACR_T - 0.9)
    bh = bh.union(cyl(0, BH_Y, 1.5, ZT - WALL - ACR_T - 0.9, ZT - WALL - ACR_T))
    contacts = cyl(0, CELL_Y, 7.0, BAY_Z, BAY_Z + 0.6).union(
        cq.Workplane("XY").circle(3).workplane(offset=5.3).circle(7).loft()
        .translate((0, CELL_Y, ZT - WALL - 5.9 + 0.6)))
    contacts = contacts.union(cyl(0, CELL_Y, 7.0, ZT - WALL - 0.6, ZT - WALL))
    return [
        {"name": "Body", "shape": make_body(), "group": "case", "color": "#5f8f4e"},
        {"name": "Cap", "shape": make_cap(), "group": "case", "color": "#eef0e8", "material": "petg",
         "explode": [0, 0, 1]},
        {"name": "Soil probe", "shape": probe, "group": "component", "color": "#151515",
         "explode": [0, 0, -1]},
        {"name": "USB-C charger", "shape": tp, "group": "component", "color": "#1f4fa0",
         "cable": {"type": "usb-c", "at": [-W / 2, USB_Y, USB_Z], "dir": [-1, 0, 0], "length_mm": 400}},
        {"name": "Temp/humidity sensor", "shape": bme, "group": "component", "color": "#6a3a9a"},
        {"name": "Light sensor", "shape": bh, "group": "component", "color": "#1d5fb0",
         "explode": [0, 0, 1]},
        {"name": "Battery contacts", "shape": contacts, "group": "component", "color": "#c9c9c9"},
        part("cell_18650", at=(9.2, CELL_Y, BAY_Z + 0.6 + 32.5), rot=(0, -90, 0)),
        part("esp32_c3_supermini", at=(0.5, -8.0, 101.0), rot=(90, 0, 0)),
        part("m2x8_bhcs", at=[(x, y, ZB + 2) for x, y in SCREWS]),
    ]


ASSEMBLY = [["Body"], ["Soil probe"], ["ESP32-C3 SuperMini", "USB-C charger", "Temp/humidity sensor"],
            ["Battery contacts", "18650 Li-ion cell"], ["Light sensor"], ["Cap"],
            ["M2×8 button head screw ×2"]]

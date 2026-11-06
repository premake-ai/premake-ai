import cadquery as cq
from cadlib import fab
from cadlib.parts import part

# Recirculating shower unit: sits beside the shower tray, catches the warm
# drain water, strains + filters + UV-sterilises it and pumps it back to the head.
W, D, H = 240, 180, 280      # cabinet outside
T = 1.2                      # stainless sheet
SHELF_Z = 120


def box(x, y, z, cx, cy, z0):
    return cq.Workplane("XY").box(x, y, z, centered=(True, True, False)).translate((cx, cy, z0))


def cyl(d, h, cx, cy, z0):
    return cq.Workplane("XY").circle(d / 2).extrude(h).translate((cx, cy, z0))


def motion():
    return [{"part": "Service lid", "type": "slide", "axis": [0, 0, 1], "range": [0, 80]},
            {"part": "Hair catcher basket", "type": "slide", "axis": [0, 0, 1], "keys": [[0, 0], [0.3, 0], [0.6, 30], [1, 0]]}]


def parts():
    # U-wrap: left side, front, right side (one blank 600 x 280, 2 bends)
    wrap = fab.sheet_bent([(-W/2, -D/2), (-W/2, D/2), (W/2, D/2), (W/2, -D/2)], H, T)
    wrap = wrap.rotate((0, 0, 0), (1, 0, 0), 90)

    base = fab.panel(W, D, T, holes=[(0, 0, 20)]).translate((-W/2, -D/2, 0)) \
        if False else box(W, D, T, 0, 0, 0).faces(">Z").workplane().hole(20)

    back = box(W - 2*T, 6, H - 8, 0, D/2 - 3, T) \
        .faces(">Y").workplane(centerOption="CenterOfBoundBox") \
        .pushPoints([(-70, -90), (-20, 80), (40, 80), (80, -90)]).hole(16)
    back = back.cut(cq.Workplane("XZ").center(80, 230).circle(5.6).extrude(-20).translate((0, 80, 0)))
    shelf = box(W - 2*T - 1, D - 9, 6, 0, -3, SHELF_Z) \
        .faces(">Z").workplane().pushPoints([(-85, -20), (40, 0), (40, -60)]).hole(18)
    lid = box(W, D, 6, 0, 0, H)

    sump = box(200, 140, 110, 0, -5, T).faces(">Z").shell(-2)
    basket = box(120, 90, 45, -30, 0, T + 110 - 45 + 4).faces(">Z").shell(-2)
    basket = basket.union(box(130, 100, 3, -30, 0, T + 110 + 1).cut(box(116, 86, 3, -30, 0, T + 111)))
    mesh = cq.Workplane("XY").rarray(6, 6, 18, 13).circle(1.6).extrude(3).translate((-30, 0, T + 69))
    basket = basket.cut(mesh)

    pump = box(65, 120, 75, -80, -15, SHELF_Z + 6)
    filt = cyl(55, 145, 0, -45, SHELF_Z + 6)
    uv = cyl(40, 130, 0, 45, SHELF_Z + 6)
    valve = box(55, 40, 55, 80, -50, SHELF_Z + 6)

    clamp_f = cyl(65, 12, 0, -45, SHELF_Z + 60).cut(cyl(55.4, 12, 0, -45, SHELF_Z + 60))
    clamp_u = cyl(50, 12, 0, 45, SHELF_Z + 60).cut(cyl(40.4, 12, 0, 45, SHELF_Z + 60))
    ebox = box(80, 55, 35, 80, 35, SHELF_Z + 6).faces(">Z").shell(-2)
    elid = box(80, 55, 3, 80, 35, SHELF_Z + 41)

    steel = {"group": "case", "process": "sheet", "color": "#c8ccd0"}
    return [
        {"name": "Cabinet wrap", "shape": wrap, **steel,
         "params": {"material": "stainless 304", "thickness_mm": T, "bends": 2}},
        {"name": "Base plate", "shape": base, **steel, "explode": [0, 0, -1],
         "params": {"material": "stainless 304", "thickness_mm": T, "bends": 0}},
        {"name": "Back panel", "shape": back, "group": "case", "process": "laser",
         "params": {"material": "acrylic", "thickness_mm": 6}, "color": "#e8e8e8", "explode": [0, 1, 0]},
        {"name": "Equipment shelf", "shape": shelf, "group": "case", "process": "laser",
         "params": {"material": "acrylic", "thickness_mm": 6}, "color": "#f2f2f2", "explode": [0, 0, 0.5]},
        {"name": "Service lid", "shape": lid, "group": "case", "process": "laser",
         "params": {"material": "acrylic", "thickness_mm": 6}, "color": "#3a4550", "explode": [0, 0, 1]},
        {"name": "Hair catcher basket", "shape": basket, "group": "case", "color": "#2f9e8f", "explode": [0, -1, 0]},
        {"name": "Filter clamp", "shape": clamp_f, "group": "case", "color": "#2f9e8f"},
        {"name": "UV clamp", "shape": clamp_u, "group": "case", "color": "#2f9e8f"},
        {"name": "Controller box", "shape": ebox, "group": "case", "color": "#2f9e8f"},
        {"name": "Controller lid", "shape": elid, "group": "case", "color": "#2f9e8f", "explode": [0, 0, 1]},
        {"name": "Sump tank 5 L", "shape": sump, "group": "component", "color": "#9fc9e8"},
        {"name": "12 V diaphragm pump", "shape": pump, "group": "component", "color": "#222222"},
        {"name": "Carbon + sediment cartridge", "shape": filt, "group": "component", "color": "#f4f4f4"},
        {"name": "12 V UV-C sterilizer", "shape": uv, "group": "component", "color": "#9aa4ad"},
        {"name": "12 V dump solenoid valve", "shape": valve, "group": "component", "color": "#444444"},
        part("esp32_c3_supermini", at=(80, 35, SHELF_Z + 8)),
        part("dc_jack_panel", at=(80, D/2, 230), rot=(-90, 0, 0)),
        part("m3x8_bhcs", at=[(s * W/2, D/2 - 3, z) for s in (-1, 1) for z in (40, 240)], rot=(0, -90, 0)),
    ]

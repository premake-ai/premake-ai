"""Drop night light: a USB-C powered glow drop. An ESP32-C3 SuperMini drives an 8-LED WS2812B
ring on a centre post under a thin printed diffuser that snaps into the base. The mode button is
a flexure tab cut into the base wall (no hole, no button cap): press the wall, it clicks a 6 mm
tact switch inside. Firmware in firmware/drop_light/, wiring in wiring.md.

Z up, mm, front faces -Y, USB-C at the back (+Y).
Base prints upright (the post flange is a 45 deg cone); diffuser prints upright in white or
natural PETG/PLA, 1.4 mm wall, snap bead on the lip. The drop shape keeps every
overhang at or under 45 deg, so the diffuser needs no supports either.
"""
import cadquery as cq
from cadlib import fab

P = {
    "base_r": 38.0, "base_h": 18.0, "floor": 2.4,
    "cavity_r": 33.0,
    "dome_h": 74.0, "dome_belly_r": 37.5, "wall": 1.4,
    "lip_h": 6.0,
    "post_r": 8.7, "ring_od": 32.0, "ring_z": 24.0,
    "usb_w": 10.0, "usb_h": 4.6,
    "tab_w": 12.0, "tab_h": 9.0,
}
THUMB_VIEW = "iso"
C_BASE, C_DOME = "#3a3a3c", "#fff4d6"


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def board_pos():
    # C3 SuperMini lies along Y, USB-C end at the back wall
    return (0.0, P["cavity_r"] - 11.25 - 0.6, 4.0)


def base():
    R, H, f, rc = P["base_r"], P["base_h"], P["floor"], P["cavity_r"]
    b = cq.Workplane("XY").circle(R).extrude(H)
    try:
        b = b.faces(">Z").edges().fillet(4.0)
    except Exception:
        pass
    try:
        b = b.faces("<Z").edges().chamfer(1.0)
    except Exception:
        pass
    b = b.cut(cq.Workplane("XY").circle(rc).extrude(H).translate((0, 0, f)))
    # snap groove for the diffuser bead
    b = b.cut(cq.Workplane("XY").circle(rc + 0.6).circle(rc - 1).extrude(1.4).translate((0, 0, H - P["lip_h"] + 2.0)))
    # centre post with a 45 deg flange that carries the LED ring (hollow for the 3 wires)
    pr, z = P["post_r"], P["ring_z"]
    post = cq.Workplane("XY").circle(pr).circle(4.5).extrude(z - f).translate((0, 0, f))
    cone = cq.Workplane("XY").circle(pr).workplane(offset=3.0).circle(pr + 3.0).loft().translate((0, 0, z - 3.0))
    cone = cone.cut(cq.Workplane("XY").circle(4.5).extrude(10).translate((0, 0, z - 5)))
    boss = cq.Workplane("XY").circle(8.8).circle(4.5).extrude(1.6).translate((0, 0, z))
    b = b.union(post).union(cone).union(boss)
    b = b.cut(box(-2.5, 2.5, -pr - 1, 0, f, f + 5))                 # wire exit from the post
    # board rails + USB-C opening in the back wall
    bx, by, bz = board_pos()
    for sx in (-1, 1):
        b = b.union(box(sx * 9 - 1.0, sx * 9 + 1.0, by - 11, by + 11, f, bz))
    b = b.union(box(-10, 10, by + 11.3, by + 12.6, f, bz + 4.0))  # end stop behind the port
    b = b.cut(box(-10, 10, by + 11.25 + 0.6 - 0.01, by + 11.9, bz + 1.6, bz + 1.6 + 3.4))
    uz = bz + 1.6 + 1.6
    b = b.cut(cq.Workplane("XZ").center(0, uz).slot2D(P["usb_w"], P["usb_h"], 0).extrude(-12).translate((0, rc - 2, 0)))
    # flexure button: a U-slot cut in the front wall leaves a tab hinged at the bottom
    tw, th = P["tab_w"] / 2, P["tab_h"]
    z0 = f + 2.0
    u = (box(-tw - 1.0, -tw, -R - 1, -rc + 1, z0, z0 + th + 1.0)
         .union(box(tw, tw + 1.0, -R - 1, -rc + 1, z0, z0 + th + 1.0))
         .union(box(-tw - 1.0, tw + 1.0, -R - 1, -rc + 1, z0 + th, z0 + th + 1.0)))
    b = b.cut(u)
    b = b.union(box(-1.5, 1.5, -rc - 0.5, -rc + 1.8, z0 + th - 4.0, z0 + th - 1.0))  # nub on the tab
    # switch post
    b = b.union(box(-5, 5, -rc + 6.0, -rc + 9.0, f, z0 + th + 1.0))
    # small grip dimple on the outside of the tab
    b = b.cut(cq.Workplane("XZ").center(0, z0 + th / 2 + 0.5).circle(3.0).extrude(1.0).translate((0, -R + 0.6, 0)))
    return b


def dome():
    rc, H, w = P["cavity_r"], P["base_h"], P["wall"]
    lip0 = H - P["lip_h"]
    top = H + P["dome_h"]
    rb = P["dome_belly_r"]
    outer = (cq.Workplane("XZ").moveTo(0, lip0).lineTo(rc - 0.2, lip0).lineTo(rc - 0.2, H - 3.0)
             .lineTo(P["base_r"] - 2.4, H + 0.6)
             .spline([(rb, H + 14), (rb - 6.5, H + 38), (rb - 22, H + 60), (0, top)], includeCurrent=True)
             .close().revolve(360, (0, 0, 0), (0, 1, 0)))
    inner = (cq.Workplane("XZ").moveTo(0, lip0 - 1).lineTo(rc - 0.2 - w, lip0 - 1).lineTo(rc - 0.2 - w, H - 3.0 + 0.6)
             .lineTo(P["base_r"] - 2.4 - w, H + 0.6 + 0.6)
             .spline([(rb - w, H + 14), (rb - 6.5 - w, H + 38), (rb - 22 - w, H + 60), (0, top - w * 1.4)], includeCurrent=True)
             .close().revolve(360, (0, 0, 0), (0, 1, 0)))
    d = outer.cut(inner)
    bead = cq.Workplane("XY").circle(rc + 0.35).circle(rc - 0.5).extrude(1.0).translate((0, 0, lip0 + 2.2))
    return d.union(bead)


def electronics():
    bx, by, bz = board_pos()
    c3 = fab.esp32_devkit("c3mini").rotate((0, 0, 0), (0, 0, 1), -90).translate((bx, by, bz))
    ring = (cq.Workplane("XY").circle(P["ring_od"] / 2).circle(9.0).extrude(1.6).translate((0, 0, P["ring_z"] + 1.6)))
    for k in range(8):
        led = box(-2.5, 2.5, -2.5, 2.5, 0, 1.6).translate((12.5, 0, P["ring_z"] + 3.2)).rotate((0, 0, 0), (0, 0, 1), k * 45)
        ring = ring.union(led)
    sw = box(-3, 3, -P["cavity_r"] + 2.6, -P["cavity_r"] + 6.0, P["floor"] + 4.0, P["floor"] + 10.0)
    return c3.union(ring).union(sw)


def parts():
    return [
        {"name": "Base", "shape": base(), "group": "case", "color": C_BASE, "explode": [0, 0, -1]},
        {"name": "Diffuser dome", "shape": dome(), "group": "case", "color": C_DOME, "explode": [0, 0, 1]},
        {"name": "ESP32-C3 SuperMini + WS2812B 8-LED ring + 6 mm switch", "shape": electronics(), "group": "component",
         "color": "#2e7d32", "explode": [0, 0, 0.3]},
    ]

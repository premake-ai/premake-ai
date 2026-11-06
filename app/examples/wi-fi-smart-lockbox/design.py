import cadquery as cq
from cadlib import fab

# Fully printed lockbox for two phones (~160 x 80 x 20 stacked)
W, D, H = 195, 100, 42   # base outer
LH = 10                 # lid height
WALL = 3
LOCK_W = 30              # electronics bay at the right end


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def parts():
    hx, hy = W / 2, D / 2
    bay_x = hx - WALL - LOCK_W          # inner wall between phone well and lock bay
    base = box(-hx, hx, -hy, hy, 0, H)
    base = base.cut(box(-hx + WALL, bay_x - 1, -hy + WALL, hy - WALL, WALL, H + 1))   # phone well
    base = base.cut(box(bay_x + 1, hx - WALL, -hy + WALL, hy - WALL, WALL, H - 3))    # sealed lock bay
    base = base.cut(box(bay_x + 1, hx - WALL, -hy + WALL, -hy + 30, H - 4, H + 1))   # slot for lid latch tab
    try:
        base = base.edges("|Z").fillet(4)
    except Exception:
        pass
    # USB-C port in right wall
    base = base.cut(box(hx - WALL - 1, hx + 1, -5, 5, 10, 15))
    # hinge knuckles on the back (base: two outer, lid: one middle)
    for x in (-hx + 10, hx - 50):
        base = base.union(cq.Workplane("YZ").circle(5).extrude(40).translate((x, hy + 5, H)))
    base = base.cut(cq.Workplane("YZ").circle(1.6).extrude(W).translate((-hx, hy + 5, H)))

    lid = box(-hx, hx, -hy, hy, H, H + LH).cut(box(-hx + WALL, hx - WALL, -hy + WALL, hy - WALL, H, H + LH - WALL))
    try:
        lid = lid.edges("|Z").fillet(4)
    except Exception:
        pass
    lid = lid.union(cq.Workplane("YZ").circle(5).extrude(W - 120).translate((-hx + 52, hy + 5, H)))
    lid = lid.cut(cq.Workplane("YZ").circle(1.6).extrude(W).translate((-hx, hy + 5, H)))
    # latch tab drops into the lock bay, servo bolt passes through its hole
    tab = box(hx - WALL - 22, hx - WALL - 18, -hy + WALL + 6, -hy + 26, H - 16, H).cut(
        cq.Workplane("YZ").rect(6, 5).extrude(10).translate((hx - WALL - 25, -hy + 16, H - 10)))
    lid = lid.union(tab)

    phones = box(-80, 70, -38, 38, WALL, WALL + 18)
    servo = box(hx - WALL - 15, hx - WALL - 2, -hy + 30, -hy + 53, WALL + 4, WALL + 33)
    esp = fab.esp32_devkit("c3mini").rotate((0, 0, 0), (0, 0, 1), 90).translate((hx - WALL - 12, 15, WALL))
    pin = cq.Workplane("YZ").circle(1.5).extrude(W - 10).translate((-hx + 5, hy + 5, H))

    out = [
        {"name": "Base", "shape": base, "group": "case", "color": "#30343a"},
        {"name": "Lid", "shape": lid, "group": "case", "color": "#4a5058", "explode": [0, 0, 1]},
        {"name": "SG90 servo", "shape": servo, "group": "component", "color": "#2060c0"},
        {"name": "ESP32-C3 SuperMini", "shape": esp, "group": "component", "color": "#1d5e2a"},
        {"name": "Hinge pin 3 mm", "shape": pin, "group": "component", "color": "#b0b0b0"},
        {"name": "Phones (reference)", "shape": phones, "group": "component", "color": "#888888"},
    ]
    return out

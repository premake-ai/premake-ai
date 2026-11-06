import math
import cadquery as cq

# Bottle cap lock: two hinged halves close under a crown cap; a padlock through
# the overlapping tabs stops them opening. Hinge = M3x18 screw, head and nyloc recessed.
R = 25.0          # puck outer radius
# 26 mm crown cap (26-611 finish): crimped OD 28.6-28.9, 6.0 tall; glass under the cap ~25-26
H = 17.0          # puck height
NECK_D = 27.0     # bottom opening: clears the glass neck, catches the crimped skirt (~28.7)
CAP_D = 30.0      # pocket for the crimped cap (0.6 mm clearance per side)
CAP_Z0, CAP_Z1 = 5.0, 11.8  # 6 mm cap + 0.8 play; thin 5 mm lip clears neck rings below
WIN_D = 22.0      # top window shows the cap
HX = -31.0        # hinge axis x
KR = 6.0          # knuckle radius
GAP = 0.3
TAB_H = 12.0      # tab stack height (fits a 30 mm padlock's ~16 mm shackle)
LX0, LX1 = 20.0, 44.0
LOCK_HOLE = 7.0
LOCK_X = 37.0
RED = "#d92b25"


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def cyl(r, z0, z1, x=0, y=0):
    return cq.Workplane("XY").workplane(offset=z0).center(x, y).circle(r).extrude(z1 - z0)


def engrave(body, text, r, centre_deg, upper):
    step = 14.0
    n = len(text)
    for i, ch in enumerate(text):
        if ch == " ":
            continue
        if upper:
            a = centre_deg + (n - 1) / 2 * step - i * step
            rot = a - 90
        else:
            a = centre_deg - (n - 1) / 2 * step + i * step
            rot = a + 90
        try:
            g = (cq.Workplane("XY").text(ch, 5.0, 1.0, halign="center", valign="center")
                 .rotate((0, 0, 0), (0, 0, 1), rot)
                 .translate((r * math.cos(math.radians(a)), r * math.sin(math.radians(a)), H - 0.8)))
            body = body.cut(g)
        except Exception:
            pass
    return body


puck = cyl(R, 0, H)
try:
    puck = puck.edges(">Z").fillet(2.5).edges("<Z").chamfer(0.8)
except Exception:
    pass
puck = (puck.cut(cyl(NECK_D / 2, -1, CAP_Z0 + 0.1))
        .cut(cyl(CAP_D / 2, CAP_Z0, CAP_Z1))
        .cut(cyl(WIN_D / 2, CAP_Z1 - 0.1, H + 1)))
try:
    puck = puck.faces(">Z").edges("not %LINE").edges(cq.selectors.RadiusNthSelector(0)).chamfer(1.0)
except Exception:
    pass


def half(back):
    y0, y1 = (GAP / 2, 40) if back else (-40, -GAP / 2)
    body = puck.intersect(box(-40, 40, y0, y1, -1, H + 1))
    body = body.cut(cyl(KR + GAP, -1, H + 1, HX, 0))
    # hinge knuckles: back = top + bottom, front = middle
    layers = [(0, 6.0), (11.0, H)] if back else [(6.0 + GAP, 11.0 - GAP)]
    by = (0, KR) if back else (-KR, 0)
    for z0, z1 in layers:
        k = cyl(KR, z0, z1, HX, 0).union(box(HX, -21, by[0], by[1], z0, z1))
        try:
            k = k.edges("|Z").fillet(0.8)
        except Exception:
            pass
        body = body.union(k)
    # lock tabs, stacked low: front = bottom, back = top
    mid = TAB_H / 2
    tz = (mid + GAP / 2, TAB_H) if back else (0, mid - GAP / 2)
    oz = (-1, mid + GAP / 2) if back else (mid - GAP / 2, TAB_H + GAP)
    tab = box(LX0, LX1 - 7, -7, 7, *tz).union(cyl(7, tz[0], tz[1], LX1 - 7, 0))
    body = body.cut(box(LX0 - 1, LX1 + 1, -7.5, 7.5, *oz)).union(tab)
    body = body.cut(cyl(CAP_D / 2, CAP_Z0, CAP_Z1)).cut(cyl(NECK_D / 2, -1, CAP_Z0 + 0.1))
    # hinge: M3 clearance, recessed head on top, captive nyloc pocket underneath
    body = body.cut(cyl(1.7, -1, H + 1, HX, 0))
    if back:
        body = body.cut(cyl(3.25, H - 3.2, H + 1, HX, 0))
        nut = cq.Workplane("XY").center(HX, 0).polygon(6, 6.6 / math.cos(math.pi / 6)).extrude(4.2)
        body = body.cut(nut.translate((0, 0, -0.01)))
        body = engrave(body, "HANDS OFF", 18.0, 90, True)
    else:
        body = engrave(body, "KEEP OUT", 18.0, -90, False)
    body = body.cut(cyl(LOCK_HOLE / 2, -1, H + 1, LOCK_X, 0))  # padlock shackle
    return body


def padlock():
    top = TAB_H + 4.5
    legs = cyl(2.5, -4, top, LOCK_X, 0).union(cyl(2.5, -4, top, LOCK_X + 16, 0))
    bar = box(LOCK_X, LOCK_X + 16, -2.5, 2.5, top - 2.5, top + 2.5)
    body = box(LOCK_X - 7, LOCK_X + 23, -7.5, 7.5, -29, -4)
    return body.union(legs).union(bar)


def parts():
    screw = cyl(2.75, H - 3.2, H - 0.2, HX, 0).union(cyl(1.5, H - 3.2 - 14, H - 3.2, HX, 0))
    nut = cq.Workplane("XY").center(HX, 0).polygon(6, 6.4 / math.cos(math.pi / 6)).extrude(4).translate((0, 0, 0.1)).cut(cyl(1.5, 0, 6, HX, 0))
    bottle = cyl(12.6, -40, CAP_Z0 + 0.3).union(cyl(14.35, CAP_Z0 + 0.3, CAP_Z0 + 6.3))
    return [
        {"name": "Back half", "shape": half(True), "group": "case", "color": RED, "explode": [0, 1, 0]},
        {"name": "Front half", "shape": half(False), "group": "case", "color": RED, "explode": [0, -1, 0]},
        {"name": "M3x14 hinge screw", "shape": screw, "group": "component", "color": "#c9a24a", "explode": [0, 0, 1]},
        {"name": "M3 nyloc nut", "shape": nut, "group": "component", "color": "#999999", "explode": [0, 0, -1]},
        {"name": "30 mm padlock", "shape": padlock(), "group": "component", "color": "#d4b048", "explode": [1, 0, -1]},
        {"name": "Bottle top (reference)", "shape": bottle, "group": "component", "color": "#3a2a1a", "explode": [0, 0, -1]},
    ]

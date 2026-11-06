import cadquery as cq

# Drawer interior (user's kitchen drawer)
DW, DD, DH = 400.0, 500.0, 70.0   # inside width (X), depth (Y), height
WALL, FLOOR = 12.0, 12.0

# Dividers: "6 mm" birch plywood, egg-crate halving joints
T = 5.5          # ACTUAL sheet thickness: caliper the sheet before cutting
KERF = 0.15      # laser widens the slot by ~one kerf
SLOT = T - KERF  # drawn slot -> cuts to ~T: snug, zero-play push fit
H = 55.0         # divider height (15 mm under the drawer rim)
GAP = 1.5        # clearance to drawer wall each end
R = 10.0         # rounded top corners

LY = DD - 2 * GAP          # long dividers run front-to-back
LX = DW - 2 * GAP          # cross dividers run side-to-side
LANES = [90, 90, 90]       # forks, knives, spoons (clear width), from the left
XS = []                    # long divider centres; the rest is the serving lane
_x = -DW / 2
for w in LANES:
    XS.append(_x + w + T / 2)
    _x += w + T
SERVING = DW / 2 - _x      # ~113 mm
YS = [DD / 2 - 140]        # cross divider: back section ~137 mm deep
Z0 = FLOOR

PLY = "#d8b98a"


def _round_top(wp, axis):
    try:
        return wp.edges("|" + axis).edges(">Z").fillet(R)
    except Exception:
        return wp


def long_divider(x):
    d = cq.Workplane("XY").box(T, LY, H).translate((x, 0, Z0 + H / 2))
    d = _round_top(d, "X")
    for y in YS:  # slots from the top, half height
        d = d.cut(cq.Workplane("XY").box(T + 2, SLOT, H / 2 + 1)
                  .translate((x, y, Z0 + H * 0.75 + 0.5)))
    return d


def cross_divider(y):
    d = cq.Workplane("XY").box(LX, T, H).translate((0, y, Z0 + H / 2))
    d = _round_top(d, "Y")
    for x in XS:  # slots from the bottom, half height
        # +0.5 mm deep so the tops always seat flush
        d = d.cut(cq.Workplane("XY").box(SLOT, T + 2, H / 2 + 1.5)
                  .translate((x, y, Z0 + H / 4 - 0.25)))
    return d


def drawer():
    outer = cq.Workplane("XY").box(DW + 2 * WALL, DD + 2 * WALL, DH + FLOOR,
                                   centered=(True, True, False))
    inner = cq.Workplane("XY").box(DW, DD, DH + 1, centered=(True, True, False)) \
        .translate((0, 0, FLOOR))
    return outer.cut(inner)


def parts():
    laser = {"material": "plywood", "thickness_mm": 6}  # nominal stock
    out = []
    for i, x in enumerate(XS):
        out.append({"name": f"Long divider {i + 1}", "shape": long_divider(x),
                    "group": "case", "process": "laser", "params": laser,
                    "color": PLY, "explode": [0, 0, 1]})
    for i, y in enumerate(YS):
        out.append({"name": f"Cross divider {i + 1}", "shape": cross_divider(y),
                    "group": "case", "process": "laser", "params": laser,
                    "color": PLY, "explode": [0, 0, -0.3]})
    out.append({"name": "Your drawer (reference)", "shape": drawer(),
                "group": "component", "color": "#c9ccd1", "explode": [0, 0, -1]})
    return out

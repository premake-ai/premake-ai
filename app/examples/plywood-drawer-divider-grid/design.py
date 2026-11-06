import cadquery as cq

# Drawer interior (user's drawer, reference only)
DW, DD = 400.0, 500.0      # inside width (X) x depth (Y)
DH = 80.0                  # assumed inside height of drawer
# Dividers: laser-cut 6 mm birch plywood, egg-crate half-lap slots
T = 6.0                    # sheet thickness
SLOT = 6.3                 # slot width: easy slip fit, lift out to clean
H = 60.0                   # divider height
GAP = 2.0                  # clearance to drawer wall each end
R_TOP = 10.0               # rounded top corners
LONG_X = [-70.0, 70.0]     # long (front-back) dividers
CROSS_Y = [-90.0, 110.0]   # cross (left-right) dividers
WOOD = "#d9b382"


def _round_top(wp, axis):
    try:
        return wp.edges(f"|{axis} and >Z").fillet(R_TOP)
    except Exception:
        return wp  # cosmetic only


def long_divider(x):
    L = DD - 2 * GAP
    wp = cq.Workplane("XY").box(T, L, H, centered=(True, True, False)).translate((x, 0, 0))
    wp = _round_top(wp, "X")
    for y in CROSS_Y:  # slots from the top, half height
        wp = wp.cut(cq.Workplane("XY").box(T + 2, SLOT, H / 2 + 1, centered=(True, True, False))
                    .translate((x, y, H / 2)))
    return wp


def cross_divider(y):
    L = DW - 2 * GAP
    wp = cq.Workplane("XY").box(L, T, H, centered=(True, True, False)).translate((0, y, 0))
    wp = _round_top(wp, "Y")
    for x in LONG_X:  # slots from the bottom, half height
        wp = wp.cut(cq.Workplane("XY").box(SLOT, T + 2, H / 2 + 1, centered=(True, True, False))
                    .translate((x, y, -1)))
    return wp


def drawer_ref():
    w = 12.0
    outer = cq.Workplane("XY").box(DW + 2 * w, DD + 2 * w, DH + w, centered=(True, True, False)).translate((0, 0, -w))
    inner = cq.Workplane("XY").box(DW, DD, DH + 1, centered=(True, True, False))
    return outer.cut(inner)


def parts():
    laser = {"material": "plywood", "thickness_mm": T}
    out = []
    for i, x in enumerate(LONG_X):
        out.append({"name": f"Long divider {i + 1}", "id": f"long{i + 1}", "shape": long_divider(x),
                    "group": "case", "process": "laser", "params": laser, "color": WOOD,
                    "explode": [0, 0, 1]})
    for i, y in enumerate(CROSS_Y):
        out.append({"name": f"Cross divider {i + 1}", "id": f"cross{i + 1}", "shape": cross_divider(y),
                    "group": "case", "process": "laser", "params": laser, "color": WOOD,
                    "explode": [0, 0, -1]})
    out.append({"name": "Kitchen drawer (reference)", "shape": drawer_ref(), "group": "component",
                "color": "#e8e8e8"})
    return out

"""Fold & Bake recipe parchment: salmon, lemon & courgette parcel, 1 serving.

One 15 x 22 in (381 x 559 mm) sheet of silicone-coated parchment. Artwork is printed
MIRRORED on the uncoated back and reads through the paper from the food side (shown here).
Fold: long sides up at FOLD UP, in at FOLD IN, edges together and rolled at SEAM,
ends twisted at TWIST like a sweet wrapper. Finished parcel ~410 x 125 mm fits a
US half-sheet pan (inside 17.1 x 12.1 in).
"""
import numpy as np
import cadquery as cq
from cadlib.motion import rot
from cadlib.look import engrave_text

SCENE = "counter"

# --- sheet (mm) ---
SHEET_X, SHEET_Y = 559, 381          # 22 x 15 in, 15 in = standard roll width
T = 0.3                              # display thickness (real sheet ~0.05 mm)
INK = 0.2                            # display ink height
BAND = 60                            # food band half-width (fold-up lines at y = +-60)
WALL = 40                            # side wall height (fold-in lines at y = +-100)
SEAM = 170                           # seam line on the flaps
TWIST = 150                          # twist lines at x = +-150
CREASE = BAND + WALL

# --- tray: US half-sheet pan (Nordic Ware Naturals) ---
TRAY_OUT = (17.9 * 25.4, 12.9 * 25.4, 1.0 * 25.4)
TRAY_IN = (17.1 * 25.4, 12.1 * 25.4)
TRAY_Y = -SHEET_Y / 2 - 40 - TRAY_OUT[1] / 2

PAPER = "#f4ecd9"
DARK = "#4a3426"
LINE = "#b5482f"


# ---------- 2D art helpers (all sit on the sheet top, z = T) ----------
def _wire_ring(wire, w, z=0.0):
    outer = wire.offset2D(w / 2)[0]
    inner = wire.offset2D(-w / 2)[0]
    face = cq.Face.makeFromWires(outer, [inner])
    return cq.Workplane().add(cq.Solid.extrudeLinear(face, cq.Vector(0, 0, INK))).translate((0, 0, T + z))


def ring(r, at, w=1.6, z=0.0):
    c = cq.Wire.makeCircle(r, cq.Vector(at[0], at[1], 0), cq.Vector(0, 0, 1))
    return _wire_ring(c, w, z)


def spline_ring(pts, centre, half, w=1.8, z=0.0):
    """Outline of a closed spline; the inner edge is the spline scaled in by w."""
    def solid(sx, sy, h, z0):
        p = [cq.Vector(centre[0] + (x - centre[0]) * sx, centre[1] + (y - centre[1]) * sy, z0) for x, y in pts]
        f = cq.Face.makeFromWires(cq.Wire.assembleEdges([cq.Edge.makeSpline(p, periodic=True)]))
        return cq.Workplane().add(cq.Solid.extrudeLinear(f, cq.Vector(0, 0, h)))
    out = solid(1, 1, INK, 0).cut(solid(1 - w / half[0], 1 - w / half[1], INK + 1, -0.5))
    if not out.val().isValid():
        raise ValueError("outline invalid")
    return out.translate((0, 0, T + z))


def spokes(r, at, n, w=1.0, z=0.0):
    out = None
    for i in range(n):
        a = 360 * i / n
        s = (cq.Workplane().center(r * 0.5, 0).rect(r * 0.8, w).extrude(INK)
             .rotate((0, 0, 0), (0, 0, 1), a).translate((at[0], at[1], T + z)))
        out = s if out is None else out.union(s)
    return out


def hdash(y, x0, x1, dash=10, gap=6, w=1.0):
    pts, x = [], x0 + dash / 2
    while x + dash / 2 <= x1:
        pts.append((x, y))
        x += dash + gap
    return cq.Workplane().pushPoints(pts).rect(dash, w).extrude(INK).translate((0, 0, T))


def vdash(x, y0, y1, dash=6, gap=4, w=1.0):
    pts, y = [], y0 + dash / 2
    while y + dash / 2 <= y1:
        pts.append((x, y))
        y += dash + gap
    return cq.Workplane().pushPoints(pts).rect(w, dash).extrude(INK).translate((0, 0, T))


def text(s, size, at, halign="center", angle=0):
    t = cq.Workplane().text(s, size, INK, halign=halign, valign="center", combine=False)
    if angle:
        t = t.rotate((0, 0, 0), (0, 0, 1), angle)
    return t.translate((at[0], at[1], T))


def union_all(items):
    out = items[0]
    for i in items[1:]:
        out = out.union(i)
    return out


def strip(y0, y1):
    return cq.Workplane().box(SHEET_X, y1 - y0, T, centered=(True, False, False)).translate((0, y0, 0))


def twist_marks(y0, y1):
    return [vdash(-TWIST, y0, y1), vdash(TWIST, y0, y1)]


# ---------- the recipe artwork ----------
SALMON_C = (55, 0)
SALMON_PTS = [(-70, 2), (-64, 24), (-40, 32), (0, 31), (36, 25), (60, 14), (70, 3),
              (66, -9), (44, -21), (8, -29), (-32, -31), (-60, -23)]
COURGETTE = [(x, y) for x in (-128, -88, -48) for y in (-21, 21)]
LEMONS = [(15, 0), (55, 0), (95, 0)]
SPICES = [("oil", 11, 0), ("garlic", 9, 30), ("salt", 5, 55), ("pepper", 5, 75), ("dill", 9, 100)]
SPICE_Y = 47


def band_art():
    salmon = spline_ring([(SALMON_C[0] + x, SALMON_C[1] + y) for x, y in SALMON_PTS], SALMON_C, (70, 31))
    lemon = union_all([ring(26, c, w=1.4, z=0.05) for c in LEMONS] +
                      [ring(22, c, w=0.8, z=0.05) for c in LEMONS] +
                      [spokes(21, c, 8, z=0.05) for c in LEMONS])
    courg = union_all([ring(19, c) for c in COURGETTE] + [ring(12, c, w=0.8) for c in COURGETTE])
    spice = union_all([ring(r, (x, SPICE_Y), w=1.2) for _, r, x in SPICES])
    folds = union_all([hdash(-BAND, -SHEET_X / 2 + 8, SHEET_X / 2 - 8),
                       hdash(BAND, -SHEET_X / 2 + 8, SHEET_X / 2 - 8)] +
                      twist_marks(-BAND + 2, BAND - 2) +
                      [text("TWIST", 12, (-215, 0), angle=90), text("TWIST", 12, (215, 0), angle=-90)])
    return salmon, lemon, courg, spice, folds


def front_wall_art():
    return union_all([
        hdash(-CREASE, -SHEET_X / 2 + 8, SHEET_X / 2 - 8, dash=4, gap=4),
        text("6 courgette rings, 5 mm thick", 4.5, (-88, -70)),
        text("salmon fillet ~150 g, skin down", 4.5, (55, -70)),
        text("3 lemon slices on top", 4.5, (55, -80)),
        text("FOLD UP", 3.5, (-200, -66)), text("FOLD IN", 3.5, (-200, -94)),
    ] + twist_marks(-CREASE + 2, -BAND - 2))


def back_wall_art():
    labels = [("1 tbsp olive oil", 0, 70), ("1 garlic clove, sliced", 30, 82),
              ("pinch salt", 55, 70), ("pepper", 75, 92), ("dill sprig", 100, 70)]
    return union_all([hdash(CREASE, -SHEET_X / 2 + 8, SHEET_X / 2 - 8, dash=4, gap=4)] +
                     [text(s, 3.8, (x, y)) for s, x, y in labels] +
                     [text("FOLD UP", 3.5, (-200, 66)), text("FOLD IN", 3.5, (-200, 94))] +
                     twist_marks(BAND + 2, CREASE - 2))


STEPS = [
    "1  Lay each ingredient on its outline. Add the oil, garlic, salt, pepper and dill.",
    "2  Lift both long sides at FOLD UP, fold in at FOLD IN so the edges meet above the food.",
    "3  Hold the edges together, fold over at SEAM, then fold down twice more (1 cm folds).",
    "4  Twist both ends tightly at the TWIST lines, like a sweet wrapper.",
    "5  Bake on a tray: 200 C / 400 F (fan 180 C) for 18 min. Open carefully: hot steam.",
]


def front_flap_art():
    return union_all([hdash(-SEAM, -SHEET_X / 2 + 8, SHEET_X / 2 - 8, dash=14, gap=4),
                      text("SEAM", 3.5, (-200, -SEAM + 5))] +
                     [text(s, 5.0, (-140, -110 - 11 * i), halign="left") for i, s in enumerate(STEPS)] +
                     twist_marks(-SHEET_Y / 2 + 4, -CREASE - 2))


def back_flap_art():
    return union_all([hdash(SEAM, -SHEET_X / 2 + 8, SHEET_X / 2 - 8, dash=14, gap=4),
                      text("SEAM", 3.5, (-200, SEAM - 5)),
                      text("SALMON, LEMON & COURGETTE", 11, (0, 142)),
                      text("200 C / 400 F  -  18 MIN  -  SERVES 1", 7, (0, 122)),
                      text("salmon is done when it flakes easily (63 C / 145 F)", 4, (0, 108))] +
                     twist_marks(CREASE + 2, SHEET_Y / 2 - 4))


# ---------- tray, parcel, packaging ----------
def tray():
    ox, oy, oz = TRAY_OUT
    body = cq.Workplane().box(ox, oy, oz, centered=(True, True, False))
    try:
        body = body.edges("|Z").fillet(25)
    except Exception:
        pass
    pocket = cq.Workplane().box(TRAY_IN[0], TRAY_IN[1], oz, centered=(True, True, False)).translate((0, 0, 1.5))
    try:
        pocket = pocket.edges("|Z").fillet(18)
    except Exception:
        pass
    return body.cut(pocket).translate((0, TRAY_Y, 0))


def parcel():
    body = cq.Workplane().box(2 * TWIST, 2 * BAND + 5, 42, centered=(True, True, False))
    try:
        body = body.edges(">Z or |X").fillet(14)
    except Exception:
        pass
    seam = cq.Workplane().box(2 * TWIST - 20, 6, 10, centered=(True, True, False)).translate((0, 0, 38))
    try:
        seam = seam.edges("|X").fillet(2.5)
    except Exception:
        pass
    body = body.union(seam)
    for s in (1, -1):
        tail = (cq.Workplane("YZ").workplane(offset=0).rect(100, 32).workplane(offset=55).ellipse(9, 7).loft()
                .translate((0, 0, 20)))
        tail = tail.translate((TWIST - 4, 0, 0)) if s > 0 else tail.mirror("YZ").translate((-TWIST + 4, 0, 0))
        body = body.union(tail)
    return body.translate((0, TRAY_Y, 1.5))


SLEEVE = (292, 198, 5.0)
SLEEVE_X = TRAY_OUT[0] / 2 + 40 + SLEEVE[0] / 2


def sleeve():
    sx, sy, sz = SLEEVE
    body = cq.Workplane().box(sx, sy, sz, centered=(True, True, False))
    body = body.cut(cq.Workplane().box(sx + 10, sy - 1.0, sz - 1.0, centered=(True, True, False)).translate((0, 0, 0.5)))
    body, eng = engrave_text(body, "SALMON, LEMON & COURGETTE", face=">Z", depth=0.3, mode="emboss")
    return body.translate((SLEEVE_X, TRAY_Y, 0)), eng


def parts():
    salmon, lemon, courg, spice, folds = band_art()
    sl, eng = sleeve()
    stack = cq.Workplane().box(SHEET_X / 2, SHEET_Y / 2, 2.0, centered=(True, True, False)).translate((SLEEVE_X, TRAY_Y, 1.5))
    comp = {"group": "component", "process": "bought"}
    return [
        {"name": "Recipe parchment: food band", "shape": strip(-BAND, BAND), "color": PAPER, **comp},
        {"name": "Recipe parchment: front wall", "id": "wall_f", "shape": strip(-CREASE, -BAND), "color": PAPER, **comp},
        {"name": "Recipe parchment: back wall", "id": "wall_b", "shape": strip(BAND, CREASE), "color": PAPER, **comp},
        {"name": "Recipe parchment: front flap", "id": "flap_f", "shape": strip(-SHEET_Y / 2, -CREASE), "color": PAPER, **comp},
        {"name": "Recipe parchment: back flap", "id": "flap_b", "shape": strip(CREASE, SHEET_Y / 2), "color": PAPER, **comp},
        {"name": "Salmon outline", "shape": salmon, "color": "#e2704a", **comp},
        {"name": "Lemon slice outlines", "shape": lemon, "color": "#d9a90f", **comp},
        {"name": "Courgette ring outlines", "shape": courg, "color": "#3f7f34", **comp},
        {"name": "Oil, garlic and spice circles", "shape": spice, "color": "#8a6d3b", **comp},
        {"name": "Fold and twist lines", "shape": folds, "color": LINE, **comp},
        {"name": "Ingredient labels (front)", "id": "art_wall_f", "shape": front_wall_art(), "color": DARK, **comp},
        {"name": "Ingredient labels (back)", "id": "art_wall_b", "shape": back_wall_art(), "color": DARK, **comp},
        {"name": "Folding steps", "id": "art_flap_f", "shape": front_flap_art(), "color": DARK, **comp},
        {"name": "Recipe title and bake time", "id": "art_flap_b", "shape": back_flap_art(), "color": DARK, **comp},
        {"name": "Half-sheet tray (yours)", "shape": tray(), "color": "#c9ccd0", "material": "aluminium", **comp},
        {"name": "Closed parcel (how it bakes)", "shape": parcel(), "color": PAPER, **comp},
        {"name": "4 folded recipe sheets (packed)", "shape": stack, "color": PAPER, **comp},
        {"name": "Recipe sleeve", "shape": sl, "color": "#c49a6c", "engrave": eng, **comp},
    ]


ASSEMBLY = [["4 folded recipe sheets (packed)"], ["Recipe sleeve"]]


# ---------- motion: lift the long sides and fold them over the food ----------
def _m(*ts):
    out = np.eye(4)
    for t in ts:
        out = out @ np.array(t["matrix"])
    return {"matrix": out.tolist()}


def _amount(t):
    if t < 0.1 or t > 0.9:
        return 0.0
    u = min(1.0, (t - 0.1) / 0.3) if t < 0.5 else min(1.0, (0.9 - t) / 0.3)
    return u * u * (3 - 2 * u)


def pose(t):
    a = _amount(t)
    wf = rot([1, 0, 0], -90 * a, (0, -BAND, 0))
    wb = rot([1, 0, 0], 90 * a, (0, BAND, 0))
    ff = _m(wf, rot([1, 0, 0], -90 * a, (0, -CREASE, 0)))
    fb = _m(wb, rot([1, 0, 0], 86 * a, (0, CREASE, 0)))
    return {"wall_f": wf, "art_wall_f": wf, "wall_b": wb, "art_wall_b": wb,
            "flap_f": ff, "art_flap_f": ff, "flap_b": fb, "art_flap_b": fb}


def motion():
    return {"duration": 6, "pose": pose}

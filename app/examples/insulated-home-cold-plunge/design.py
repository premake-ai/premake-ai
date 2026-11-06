"""Home cold plunge: bought insulated tub + ETL chiller, UL pump and filter on a
2020 equipment cart; hoses go over the tub rim through a printed rim manifold
(no holes in the tub). Low-voltage ESP32 pod reads a DS18B20 in the tub and
switches the chiller and pump through UL-listed Wi-Fi smart plugs on a GFCI."""
import cadquery as cq
from cadlib import fab
from cadlib.parts import part, info

SCENE = "floor"
CABLES = False
IN = 25.4
V = cq.Vector

# ---- bought items (sources in the chat) ----
# Tub: Elecpluway XL 53.15 x 33.46 x 25.59 in (Amazon B0CT7R2ZGH); wall thickness not published
TUB_L, TUB_W, TUB_H = 53.15 * IN, 33.46 * IN, 25.59 * IN
TUB_WALL = 60                      # assumed for the model; rim clamp takes 50-110 mm
TUB_X1 = -80                       # outer face of the tub's right end wall
TUB_X = TUB_X1 - TUB_L / 2
# Chiller: Active Aqua AACH50HP 19 L x 14.2 W x 19.3 H in (Hydrofarm)
CH_L, CH_W, CH_H = 19 * IN, 14.2 * IN, 19.3 * IN
# Pump: Danner Mag-Drive 12, 6.4 x 3 x 5.25 in, 3/4" FPT in / MPT out
PU_L, PU_W, PU_H = 6.4 * IN, 3 * IN, 5.25 * IN
HOSE_OD = 27                       # 3/4" ID spiral suction hose

# ---- cart (2020 frame) ----
X0 = 150                           # tub-side edge of the cart
CASTER_H = 70
RAIL_Z = CASTER_H                  # X rails 70..90
BAR_Z = RAIL_Z + 20                # Y cross bars 90..110
T = fab.sheet_actual("acrylic", 6)
DECK_Z = BAR_Z + 20 + T            # top of the decks
POST_Z = BAR_Z + 20
CH_X = X0 + 415                    # chiller centre

# ---- rim manifold ----
RIM_Z = TUB_H
X_IN = TUB_X1 - TUB_WALL           # inner face of tub wall
GAP = 115                          # clamp opening
TUBE_R, BORE_R = 9.5, 7.5          # U-tube: 15 mm bore, 2 mm wall
CH_XV = X_IN - 13.5                # inner barbs: hose on them just clears the wall
LEG_IN = (CH_XV - TUBE_R, X_IN)    # inner side (water side)
LEG_OUT = (X_IN + GAP, X_IN + GAP + 14)
MAN_W = 2 * (15 + TUBE_R)
CH_Z = RIM_Z + TUBE_R              # tubes rest on the rim
CH_Y = 18                          # suction +y, return -y
ELBOW_Z = CH_Z - 22                # inner barbs start here, pointing down
LEG_BOT = ELBOW_Z - 36             # tip of the inner barbs
BARB_TIP = LEG_OUT[1] + 36
SUCT_DROP, RET_DROP = 260, 180     # drop hoses below the inner barbs
PROBE_Z = RIM_Z - 230              # probe tip depth (set by a cable tie above the manifold)
CLAMP_Z = RIM_Z - 20               # M8 knob screw height


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def cyl(r, p, d, h):
    return cq.Workplane("XY").add(cq.Solid.makeCylinder(r, h, V(*p), V(*d)))


def tub_and_lid():
    tub = box(TUB_X - TUB_L / 2, TUB_X1, -TUB_W / 2, TUB_W / 2, 0, TUB_H).edges("|Z").fillet(250)
    inner = box(TUB_X - TUB_L / 2 + TUB_WALL, X_IN, -TUB_W / 2 + TUB_WALL, TUB_W / 2 - TUB_WALL,
                TUB_WALL, TUB_H + 1).edges("|Z").fillet(190)
    tub = tub.cut(inner)
    try:
        tub = tub.faces(">Z").edges().fillet(20)
    except Exception:
        pass
    lid = box(TUB_X - TUB_L / 2, TUB_X1, -TUB_W / 2, TUB_W / 2, RIM_Z, RIM_Z + 60).edges("|Z").fillet(250)
    try:
        lid = lid.edges(">Z").fillet(25)
    except Exception:
        pass
    # the soft lid squashes over the manifold bridge
    lid = lid.cut(box(LEG_IN[0] - 8, TUB_X1 + 1, -MAN_W / 2 - 4, MAN_W / 2 + 4, RIM_Z - 1, RIM_Z + 26))
    return tub, lid


def barb(p, d, length):
    """3/4" hose barb (hose ID 19.05): core with two saw teeth, from p along d."""
    dv = V(*d)
    b = cyl(9.2, p, d, length)
    tip = V(*p) + dv * length
    for k in (0, 11):
        b = b.union(cq.Workplane("XY").add(cq.Solid.makeCone(8.9, 10.5, 9, tip - dv * k, -dv)))
    return b


def rim_manifold():
    """Two inverted-U tubes (15 mm bore) over the rim: barbs out to the cart, barbs down into the water."""
    body = (box(LEG_OUT[0], LEG_OUT[1], -12, 12, RIM_Z - 34, CH_Z)            # outer clamp leg
            .union(box(X_IN - 5, X_IN, -CH_Y, CH_Y, ELBOW_Z - 14, CH_Z)))      # pad on the inner wall face
    try:
        body = body.edges("|Y").fillet(2)
    except Exception:
        pass
    body = body.union(cyl(6.5, (CH_XV, 0, ELBOW_Z - 14), (0, 0, 1), CH_Z + TUBE_R - ELBOW_Z + 14))  # probe tube
    body = body.union(box(CH_XV, X_IN - 2, -6.5, 6.5, ELBOW_Z - 14, CH_Z))  # probe tube to pad
    for s in (1, -1):
        y = s * CH_Y
        body = body.union(cyl(TUBE_R, (LEG_OUT[1], y, CH_Z), (-1, 0, 0), LEG_OUT[1] - CH_XV)
                          .union(cq.Workplane("XY").sphere(TUBE_R).translate((CH_XV, y, CH_Z)))
                          .union(cyl(TUBE_R, (CH_XV, y, CH_Z), (0, 0, -1), CH_Z - ELBOW_Z + 1))
                          .union(barb((LEG_OUT[1] - 1, y, CH_Z), (1, 0, 0), BARB_TIP - LEG_OUT[1] + 1))
                          .union(barb((CH_XV, y, ELBOW_Z + 1), (0, 0, -1), ELBOW_Z + 1 - LEG_BOT)))
    for s in (1, -1):
        y = s * CH_Y
        body = body.cut(cyl(BORE_R, (BARB_TIP + 1, y, CH_Z), (-1, 0, 0), BARB_TIP + 1 - CH_XV)
                        .union(cq.Workplane("XY").sphere(BORE_R).translate((CH_XV, y, CH_Z)))
                        .union(cyl(BORE_R, (CH_XV, y, CH_Z), (0, 0, -1), CH_Z - LEG_BOT + 1)))
    # DS18B20 cable hole (probe hangs below on its cable)
    body = body.cut(cyl(2.4, (CH_XV, 0, ELBOW_Z - 15), (0, 0, 1), CH_Z + TUBE_R - ELBOW_Z + 16))
    # clamp: M8 knob screw through the outer leg, M8 nut trapped on the tub side
    zc = CLAMP_Z
    body = body.cut(cyl(4.25, (LEG_OUT[0] - 1, 0, zc), (1, 0, 0), LEG_OUT[1] - LEG_OUT[0] + 2))
    nut = (cq.Workplane("YZ", origin=(LEG_OUT[0] - 1, 0, zc)).polygon(6, 13.4 / 0.866).extrude(7.5))
    body = body.cut(nut)
    return body


def strainer():
    """Slotted cage on the end of the suction drop hose: ~2500 mm2 open area keeps hair and fingers off."""
    z1 = LEG_BOT - SUCT_DROP + 12             # top of the cage, hose end sits on its shoulder
    s = cyl(16, (CH_XV, CH_Y, z1 - 70), (0, 0, 1), 72).cut(cyl(14, (CH_XV, CH_Y, z1 - 68), (0, 0, 1), 68))
    s = s.union(barb((CH_XV, CH_Y, z1 + 1), (0, 0, 1), 34)).cut(cyl(7, (CH_XV, CH_Y, z1 - 3), (0, 0, 1), 40))
    for i in range(16):
        slot = box(-1.4, 1.4, 12, 18, z1 - 62, z1 - 8).rotate((0, 0, 0), (0, 0, 1), i * 22.5)
        s = s.cut(slot.translate((CH_XV, CH_Y, 0)))
    for x, y in ((0, 0), (6, 6), (-6, 6), (6, -6), (-6, -6)):
        s = s.cut(cyl(2, (CH_XV + x, CH_Y + y, z1 - 71), (0, 0, 1), 4))
    return s


def clamp_screw():
    zc = CLAMP_Z
    shaft = cyl(4, (TUB_X1 + 4, 0, zc), (1, 0, 0), LEG_OUT[1] + 6 - TUB_X1 - 4)
    pad = cyl(10, (TUB_X1, 0, zc), (1, 0, 0), 5)
    knob = cq.Workplane("YZ", origin=(LEG_OUT[1] + 6, 0, zc)).polygon(5, 34).extrude(14)
    try:
        knob = knob.edges("|X").fillet(4)
    except Exception:
        pass
    nut = cq.Workplane("YZ", origin=(LEG_OUT[0], 0, zc)).polygon(6, 14.8).extrude(6.5)
    return shaft.union(pad).union(knob).union(nut)


def hose(pts):
    vs = [V(*p) for p in pts]
    t0 = vs[1] - vs[0]
    t1 = vs[-1] - vs[-2]
    try:
        path = cq.Workplane("XY").spline(pts, tangents=[t0, t1], includeCurrent=False)
        xd = t0.cross(V(0, 0, 1))
        if xd.Length < 1e-6:
            xd = V(1, 0, 0)
        prof = cq.Workplane(cq.Plane(origin=vs[0], xDir=xd, normal=t0)).circle(HOSE_OD / 2)
        h = prof.sweep(path)
        if h.val().isValid():
            return h
    except Exception:
        pass
    h = None
    for a, b in zip(vs, vs[1:]):
        seg = cyl(HOSE_OD / 2, a.toTuple(), (b - a).toTuple(), (b - a).Length)
        seg = seg.union(cq.Workplane("XY").sphere(HOSE_OD / 2).translate(b.toTuple()))
        h = seg if h is None else h.union(seg)
    return h


def chiller():
    c = box(CH_X - CH_W / 2, CH_X + CH_W / 2, -CH_L / 2, CH_L / 2, DECK_Z, DECK_Z + CH_H)
    try:
        c = c.edges("|Z").fillet(18).faces(">Z").edges().fillet(10)
    except Exception:
        pass
    x = CH_X - CH_W / 2
    for (y, z) in ((-150, 300), (0, 470)):
        c = c.union(cyl(13, (x - 22, y, z), (1, 0, 0), 24))
    # front grille
    for i in range(8):
        c = c.cut(box(CH_X - 140 + i * 35, CH_X - 125 + i * 35, -CH_L / 2 - 1, -CH_L / 2 + 3,
                      DECK_Z + 60, DECK_Z + 300))
    return c


def filter_housing():
    fx, fy = X0 + 115, 140
    f = cyl(62, (fx, fy, DECK_Z), (0, 0, 1), 262)
    head = box(fx - 60, fx + 60, fy - 60, fy + 60, DECK_Z + 260, DECK_Z + 320).edges("|Z").fillet(10)
    f = f.union(head)
    for s in (1, -1):
        f = f.union(cyl(14, (fx, fy + s * 59, DECK_Z + 295), (0, s, 0), 22))
    # steel bracket to the filter bar
    f = f.union(box(X0 + 40, fx - 59, fy - 30, fy + 30, DECK_Z + 290, POST_Z + 330))
    return f


def pump():
    px = X0 + 115
    p = box(px - PU_W / 2, px + PU_W / 2, -230, -230 + PU_L, DECK_Z, DECK_Z + PU_H)
    try:
        p = p.edges("|Y").fillet(12)
    except Exception:
        pass
    p = p.union(cyl(14, (px, -230 + PU_L - 1, DECK_Z + 40), (0, 1, 0), 22))      # inlet
    p = p.union(cyl(13, (px, -200, DECK_Z + PU_H - 1), (0, 0, 1), 22))           # outlet
    return p


def drain_valve():
    px = X0 + 115
    z0 = DECK_Z + PU_H + 20
    tee = cyl(16, (px, -200, z0), (0, 0, 1), 46)
    tee = tee.union(cyl(14, (px, -200, z0 + 22), (0, -1, 0), 75))
    tee = tee.union(box(px - 4, px + 4, -260, -248, z0 + 34, z0 + 40).union(
        box(px - 4, px + 60, -258, -250, z0 + 38, z0 + 44)))                   # lever
    return tee


def caster(x, y):
    plate = box(x - 30, x + 30, y - 30, y + 30, CASTER_H - 7, CASTER_H - 3)
    fork = box(x - 16, x + 16, y - 12, y + 12, 30, CASTER_H - 7)
    wheel = cyl(25, (x - 11, y, 25), (1, 0, 0), 22)
    return plate.union(fork).union(wheel)


def caster_plate(x, y):
    """3 mm aluminium adapter: 2 x M5 into the rail's bottom slot, 4 radial slots fit 38-56 mm caster patterns."""
    p = fab.panel(80, 80, 3, r=6).translate((x - 40, y - 40, CASTER_H - 3))
    p = p.cut(cyl(2.75, (x - 20, y, CASTER_H - 4), (0, 0, 1), 5)).cut(cyl(2.75, (x + 20, y, CASTER_H - 4), (0, 0, 1), 5))
    for a in (45, 135, 225, 315):
        slot = (cq.Workplane("XY").slot2D(16 + 6.6, 6.6).extrude(5).translate((33, 0, 0))
                .rotate((0, 0, 0), (0, 0, 1), a).translate((x, y, CASTER_H - 4)))
        p = p.cut(slot)
    return p


def deck(x0, x1, slots=()):
    d = box(x0, x1, -250, 250, BAR_Z + 20, DECK_Z)
    for (cx, cy) in ((X0 + 10, -240), (X0 + 10, 240)):          # post notches
        d = d.cut(box(cx - 10.5, cx + 10.5, cy - 10.5, cy + 10.5, BAR_Z, DECK_Z + 1))
    for xb in (X0 + 10, X0 + 230, X0 + 590):                     # M5 holes into the bars
        if x0 - 1 < xb < x1 + 1:
            for y in (-200, 200):
                d = d.cut(cyl(2.75, (xb, y, BAR_Z), (0, 0, 1), 30))
    for (cx, cy) in slots:                                       # strap slots
        d = d.cut(box(cx - 2, cx + 2, cy - 13, cy + 13, BAR_Z, DECK_Z + 1))
    try:
        d = d.edges("|Z").fillet(1)
    except Exception:
        pass
    return d


def shield():
    s = box(X0 - T, X0, -250, 250, POST_Z, POST_Z + 400)
    try:
        s = s.edges("|X").fillet(20)
    except Exception:
        pass
    for y in (-240, 240):
        for z in (60, 200, 340):
            s = s.cut(cyl(2.75, (X0 - T - 1, y, POST_Z + z), (1, 0, 0), T + 2))
    return s


# ---- controller pod (local: floor in XY, open +Z; rotated so the floor is on the post face) ----
# ESP32 DevKitC 54.4 x 27.9 centred; DS18B20 adapter on the floor under it between the header rows
WALL = 2.0
BOSS_X, BOSS_Y = 31.7, 12.5                 # lid bosses beyond the board ends
PW = 2 * (BOSS_X + 3.5 - 1 + WALL)
PD = 2 * (15 + WALL)
PH = 34
PCB_Z = 26
SCREW_X = 14                                # M5 screws into the post slot
POD_X, POD_ZC = X0 + 10 - SCREW_X, POST_Z + 365


def to_world(wp):
    return wp.rotate((0, 0, 0), (1, 0, 0), 90).translate((POD_X, -250, POD_ZC))


def wpt(x, y, z):
    return (POD_X + x, -250 - z, POD_ZC + y)


def pod_base():
    b = box(-PW / 2, PW / 2, -PD / 2, PD / 2, 0, PH).edges("|Z").fillet(5)
    b = b.cut(box(-PW / 2 + WALL, PW / 2 - WALL, -PD / 2 + WALL, PD / 2 - WALL, WALL, PH + 1)
              .edges("|Z").fillet(3))
    try:
        b = b.faces("<Z").edges().fillet(1.2)
    except Exception:
        pass
    for sx in (1, -1):
        for sy in (1, -1):
            b = b.union(cyl(3.5, (sx * BOSS_X, sy * BOSS_Y, 1), (0, 0, 1), PH - 1))
            b = b.cut(cyl(1.25, (sx * BOSS_X, sy * BOSS_Y, PH - 9), (0, 0, 1), 10))
    for x in (-25, 25):                                         # board end supports
        b = b.union(box(x - 3, x + 3, -8, 8, 1, PCB_Z))
    for y in (-8, 8):                                           # M5 to the post
        b = b.cut(cyl(2.75, (SCREW_X, y, -1), (0, 0, 1), WALL + 2))
    b = b.cut(box(-PW / 2 - 1, -PW / 2 + WALL + 1, -6, 6, PCB_Z - 1.5, PCB_Z + 7.5))       # USB
    b = b.cut(cyl(6.3, (-12, -PD / 2 - 1, 13), (0, 1, 0), WALL + 2))                     # PG7 gland (bottom)
    return b


def pod_lid():
    l = box(-PW / 2, PW / 2, -PD / 2, PD / 2, PH, PH + 2).edges("|Z").fillet(5)
    try:
        l = l.faces(">Z").edges().fillet(1)
    except Exception:
        pass
    for x in (-25, 25):                                         # press the board ends down
        l = l.union(box(x - 2, x + 2, -7, 7, PCB_Z + 1.9, PH + 0.5))
    for sx in (1, -1):
        for sy in (1, -1):
            l = l.cut(cyl(1.7, (sx * BOSS_X, sy * BOSS_Y, PH - 1), (0, 0, 1), 4))
    return l


def parts():
    tub, lid = tub_and_lid()
    out = [
        {"name": "Insulated tub", "shape": tub, "group": "component", "color": "#23272e"},
        {"name": "Insulated lid", "id": "lid", "shape": lid, "group": "component", "color": "#3b414b"},
        {"name": "Water chiller", "shape": chiller(), "group": "component", "color": "#1b1d20"},
        {"name": "Circulation pump", "shape": pump(), "group": "component", "color": "#2d2f33"},
        {"name": "Filter housing", "shape": filter_housing(), "group": "component", "color": "#a9c8e8"},
        {"name": "Drain tee and valve", "shape": drain_valve(), "group": "component", "color": "#d9d9d9"},
        {"name": "Clamp knob screw", "shape": clamp_screw(), "group": "component", "color": "#222222"},
        {"name": "Rim manifold", "shape": rim_manifold(), "color": "#e8edf2", "explode": [0, 0, 1]},
        {"name": "Intake strainer", "shape": strainer(), "color": "#e8edf2", "explode": [0, 0, -1]},
        {"name": "DS18B20 waterproof probe", "shape": cyl(3, (CH_XV, 0, PROBE_Z), (0, 0, 1), 50)
            .union(cyl(2, (CH_XV, 0, PROBE_Z + 50), (0, 0, 1), RIM_Z + 40 - PROBE_Z - 50)),
         "group": "component", "color": "#c0c0c0"},
        {"name": "Suction drop hose", "shape": cyl(HOSE_OD / 2, (CH_XV, CH_Y, ELBOW_Z - 3), (0, 0, -1),
                                                    ELBOW_Z - 3 - (LEG_BOT - SUCT_DROP + 14)),
         "group": "component", "color": "#30343a"},
        {"name": "Return drop hose", "shape": cyl(HOSE_OD / 2, (CH_XV, -CH_Y, ELBOW_Z - 3), (0, 0, -1),
                                                   ELBOW_Z - 3 - (LEG_BOT - RET_DROP)),
         "group": "component", "color": "#30343a"},
    ]
    hoses = {
        "Suction hose": [(BARB_TIP - 4, CH_Y, CH_Z), (110, 28, 692), (200, 95, 640), (268, 245, 505),
                         (265, 232, DECK_Z + 300), (265, 214, DECK_Z + 295)],
        "Filter to pump hose": [(265, 66, DECK_Z + 295), (265, 40, DECK_Z + 280), (265, 5, DECK_Z + 170),
                                (265, -45, DECK_Z + 45), (265, -55, DECK_Z + 40)],
        "Pump to chiller hose": [(265, -200, DECK_Z + PU_H + 66), (275, -200, DECK_Z + PU_H + 105),
                                 (330, -170, 320), (CH_X - CH_W / 2 - 20, -150, 300)],
        "Return hose": [(CH_X - CH_W / 2 - 20, 0, 470), (330, -5, 545), (230, -12, 660), (120, -15, 700),
                        (BARB_TIP - 4, -CH_Y, CH_Z)],
    }
    for n, pts in hoses.items():
        out.append({"name": n, "shape": hose(pts), "group": "component", "color": "#30343a"})

    # 2020 frame (stock lengths: 2 x 600, 4 x 500, 2 x 400)
    for i, y in enumerate((-240, 240)):
        out.append({"name": "Cart rail", "id": f"rail{i}",
                    "shape": fab.extrusion(600, axis="x", at=(X0, y, RAIL_Z + 10)),
                    "process": "extrusion", "params": {"profile": "2020", "length_mm": 600, "tapped_ends": 0}})
    for i, x in enumerate((X0 + 10, X0 + 230, X0 + 590)):
        out.append({"name": "Cross bar", "id": f"bar{i}",
                    "shape": fab.extrusion(500, axis="y", at=(x, -250, BAR_Z + 10)),
                    "process": "extrusion", "params": {"profile": "2020", "length_mm": 500, "tapped_ends": 0}})
    for i, y in enumerate((-240, 240)):
        out.append({"name": "Post", "id": f"post{i}",
                    "shape": fab.extrusion(400, axis="z", at=(X0 + 10, y, POST_Z)),
                    "process": "extrusion", "params": {"profile": "2020", "length_mm": 400, "tapped_ends": 0}})
    out.append({"name": "Filter bar", "shape": fab.extrusion(500, axis="y", at=(X0 + 30, -250, POST_Z + 320)),
                "process": "extrusion", "params": {"profile": "2020", "length_mm": 500, "tapped_ends": 0}})
    out.append({"name": "Pump deck", "shape": deck(X0, X0 + 230, slots=((X0 + 70, -150), (X0 + 160, -150))),
                "process": "laser", "params": {"material": "acrylic", "thickness_mm": 6}, "color": "#222222"})
    out.append({"name": "Chiller deck", "shape": deck(X0 + 230, X0 + 600),
                "process": "laser", "params": {"material": "acrylic", "thickness_mm": 6}, "color": "#222222"})
    out.append({"name": "Splash shield", "shape": shield(), "process": "laser",
                "params": {"material": "acrylic", "thickness_mm": 6}, "material": "acrylic_frosted"})
    cs = None
    for x in (X0 + 40, X0 + 560):
        for y in (-240, 240):
            c = caster(x, y)
            cs = c if cs is None else cs.union(c)
    out.append({"name": "Locking caster", "shape": cs, "group": "component", "color": "#444444"})
    for i, (x, y) in enumerate([(x, y) for x in (X0 + 40, X0 + 560) for y in (-240, 240)]):
        out.append({"name": "Caster plate", "id": f"cplate{i}", "shape": caster_plate(x, y), "process": "sheet",
                    "params": {"material": "aluminium 5052", "thickness_mm": 3, "bends": 0}})
    out.append({"name": "Pump strap", "shape": box(X0 + 66, X0 + 164, -163, -137, DECK_Z + PU_H, DECK_Z + PU_H + 2)
                .union(box(X0 + 66, X0 + 70, -163, -137, BAR_Z + 18, DECK_Z + PU_H))
                .union(box(X0 + 160, X0 + 164, -163, -137, BAR_Z + 18, DECK_Z + PU_H)),
                "group": "component", "color": "#111111"})

    # controller pod
    out.append({"name": "Controller pod", "shape": to_world(pod_base()), "color": "#e8edf2"})
    out.append({"name": "Pod lid", "shape": to_world(pod_lid()), "color": "#3a7bd5", "explode": [0, -1, 0]})
    out.append(part("esp32_devkitc", at=wpt(0, 0, PCB_Z), rot=(90, 0, 0)))
    out.append({"name": "DS18B20 adapter module", "shape": to_world(box(-25, 1, -9.5, 9.5, WALL, WALL + 11)),
                "group": "component", "color": "#1f6f3f"})
    out.append({"name": "PG7 cable gland", "shape": to_world(cyl(6.5, (-12, -PD / 2 - 8, 13), (0, 1, 0), 12)),
                "group": "component", "color": "#222222"})
    out.append(part("m3x10_selftap", at=[wpt(sx * BOSS_X, sy * BOSS_Y, PH + 2) for sx in (1, -1) for sy in (1, -1)],
                    rot=(90, 0, 0)))
    out.append(part("m5x10_bhcs", at=[wpt(SCREW_X, 8, WALL), wpt(SCREW_X, -8, WALL)], rot=(90, 0, 0)))
    for p in out:                                    # every part we make must be one solid
        if isinstance(p, dict) and p.get("group", "case") == "case":
            n = len(p["shape"].solids().vals())
            if n != 1:
                raise ValueError(f"{p['name']} is {n} solids")
    return out


def motion():
    return [{"part": "lid", "type": "slide", "axis": [0, 0, 1], "keys": [[0, 0], [0.3, 320], [0.7, 320], [1, 0]]}]


ASSEMBLY = [["Cart rail", "Locking caster"], ["Cross bar"], ["Post", "Filter bar"],
            ["Pump deck", "Chiller deck"], ["Splash shield"], ["Water chiller", "Circulation pump", "Filter housing"],
            ["Pump strap", "Drain tee and valve"], ["Controller pod"], ["Rim manifold", "Clamp knob screw",
            "Suction drop hose", "Return drop hose", "Intake strainer", "DS18B20 waterproof probe"],
            ["Suction hose", "Filter to pump hose", "Pump to chiller hose", "Return hose"], ["Pod lid"]]

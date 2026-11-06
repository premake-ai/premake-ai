"""Grip / finger strength trainer - personal 3D print, CadQuery 2.8.

World frame: Z up, mm. Front of product (finger plungers) faces -Y.
Head/barrel runs along Y at the top (spring housing, knob at the back +Y).
Grip bar hangs from the FRONT of the head, raked 12 deg forward (102 deg to head).
Palm lever pivots (1/4-20, axis X) at the top rear of the grip bar and runs
back/down under the head ~38 deg from the grip bar.

Main load path: squeeze -> lever top tab pushes the keyed PUSHER (+Y) -> main
spring -> keyed SEAT (carries the 5/16-18 hex nut) -> adjuster bolt -> bolt head
held in the KNOB, knob bears on the head's back wall.
Turning the knob turns the bolt; the non-rotating seat walks along it = preload.
Stroke is fixed: lever tab rests on the slot front (open stop) and the pusher
hits the bore step after STROKE mm (hard stop). Max compression = preload_max +
stroke = 29 mm < 36 mm limit.
"""
import math
import cadquery as cq


P = {
    # grip bar (local frame: vertical, front face at -Y)
    "grip_w": 32.0, "grip_d": 38.0, "grip_h": 130.0, "grip_fillet": 7.0,
    "grip_rake": 12.0,               # deg, bottom leans forward (-Y)
    # head / barrel (axis along Y)
    "head_d": 32.0, "head_y0": -20.0, "back_wall": 5.0,
    "front_bore_d": 26.0,            # pusher bore (pusher = 25.4)
    "spring_bore_d": 20.5,           # main spring pocket
    "pusher_y": 16.0,                # pusher front face at rest
    "pusher_len": 10.0, "stroke": 12.0,
    "preload_max": 17.0, "preload": 8.0,   # preload shown in the model
    "seat_len": 10.0,
    # palm lever
    "lever_w": 22.0, "lever_len": 110.0, "lever_angle": 38.0,  # deg from grip bar
    "lever_t_root": 25.0, "lever_t_tip": 13.0,                 # section depth (hub keeps 25)
    "lever_front_root": 7.0,         # arm front offset at root: clears grip at full squeeze
    "tab_arm": 28.0,                 # pivot -> spring axis (2:1 ratio @ 56 mm palm)
    "pivot_y": 18.0,
    # finger plungers (local grip frame)
    "pl_z": [18.0, 40.0, 62.0, 84.0], "pl_d": 12.0, "pl_exposed": 15.0,
    "pl_shoulder_d": 16.0, "pl_shoulder_t": 3.0, "pl_lip": 3.0,
    "pl_pin_d": 7.0, "pl_pin_len": 10.0, "pl_stroke": 10.0, "pl_bore_d": 12.0,
    "plate_t": 3.0,
    # knob
    "knob_d": 30.0, "knob_len": 16.0, "knurl_n": 24,
    # fasteners (hardware store, inch)
    "PIVOT": {"name": "1/4-20 x 2in hex bolt", "d": 6.35, "len": 50.8, "head_af": 11.1,
              "head_h": 4.1, "nut_af": 11.1, "nut_h": 8.3, "washer_od": 18.6,
              "washer_t": 1.6, "hole": 6.7},
    "ADJ": {"name": "5/16-18 x 3in hex bolt", "d": 7.94, "len": 76.2, "head_af": 12.7,
            "head_h": 5.4, "nut_af": 12.7, "nut_h": 6.9, "clr": 8.4,
            "trap_af": 12.9, "trap_depth": 7.2},
    "SCREW": {"name": "#4 x 1/2in pan sheet-metal", "len": 12.7, "pilot": 2.4,
              "clr": 3.2, "head_d": 5.5, "head_h": 2.0, "cb_d": 6.2, "boss_min": 6.5},
    # clearances / walls
    "clr_slide": 0.3, "clr_bolt": 0.2, "wall_min": 2.4,
    "SPRINGS": {
        # Hillman #53. wire/solid unverified - replace with exact part dims
        "main": {"name": "Hillman #53", "od": 19.05, "id": 13.7, "wire": 2.67,
                 "free_len": 76.2, "rate_n_mm": 10.4, "solid_len_est": 40.0,
                 "max_compression": 36.0, "qty": 1},
        # Ace 5062936. wire/rate unknown - placeholder wire, replace with exact dims
        "finger": {"name": "Ace 5062936", "od": 11.2, "wire": 1.1,
                   "free_len": 36.6, "qty": 4},
    },
}
S = P["SPRINGS"]
A = P["ADJ"]
HEAD_R = P["head_d"] / 2
HEAD_Z = P["grip_h"] + HEAD_R - 4.0          # head axis (sunk 4 mm into grip)
GRIP_TOP = P["grip_h"]
Y_PUSH_FRONT = P["pusher_y"]
Y_PUSH_BACK = Y_PUSH_FRONT + P["pusher_len"]
Y_STEP = Y_PUSH_BACK + P["stroke"]           # pusher hard stop
# seat front face at zero preload / at shown preload
Y_SEAT0 = Y_PUSH_BACK + S["main"]["free_len"]
Y_SEAT = Y_SEAT0 - P["preload"]
Y_WALL = Y_SEAT0 + P["seat_len"] + 1.0       # inner face of back wall
HEAD_Y1 = Y_WALL + P["back_wall"]
P["head_len"] = HEAD_Y1 - P["head_y0"]
PIVOT = (P["pivot_y"], HEAD_Z - P["tab_arm"])
assert P["preload_max"] + P["stroke"] <= S["main"]["max_compression"]


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def cyl_y(r, y0, y1, x=0.0, z=0.0):
    return cq.Workplane("XZ").circle(r).extrude(y1 - y0).translate((x, y1, z))


def cyl_x(r, x0, x1, y=0.0, z=0.0):
    return cq.Workplane("YZ").circle(r).extrude(x1 - x0).translate((x0, y, z))


def hex_y(af, y0, y1, z=0.0, x=0.0):
    return (cq.Workplane("XZ").polygon(6, af / math.cos(math.pi / 6))
            .extrude(y1 - y0).translate((x, y1, z)))


def hex_x(af, x0, x1, y=0.0, z=0.0):
    return (cq.Workplane("YZ").polygon(6, af / math.cos(math.pi / 6))
            .extrude(x1 - x0).translate((x0, y, z)))


def tilt(wp):
    """Grip local frame -> world: rake about X through the grip top."""
    return wp.rotate((0, 0, GRIP_TOP), (1, 0, GRIP_TOP), -P["grip_rake"])


def tilt_vec(v, point=True):
    a = math.radians(-P["grip_rake"])
    x, y, z = v
    zc = GRIP_TOP if point else 0.0
    z -= zc
    return [x, round(y * math.cos(a) - z * math.sin(a), 3),
            round(y * math.sin(a) + z * math.cos(a) + zc, 3)]


def try_fillet(wp, sel, r):
    try:
        out = wp.edges(sel).fillet(r) if sel else wp.edges().fillet(r)
        return out if out.val().isValid() else wp
    except Exception:
        return wp


# ---------------------------------------------------------------- grip (local)
def grip_local():
    w, d, h = P["grip_w"], P["grip_d"], P["grip_h"]
    g = box(-w / 2, w / 2, -d / 2, d / 2, 0, h + 6)
    g = try_fillet(g, "|Z", P["grip_fillet"])
    return try_fillet(g, "<Z", 3.0)


PLATE_SCREWS = [(-10, 10), (10, 10), (-10, 90), (10, 90)]   # (x, z) local


def plunger_cuts_local():
    d = P["grip_d"]
    yf = -d / 2
    c = P["clr_slide"]
    cut = None
    for z in P["pl_z"]:
        hole = cyl_y(P["pl_d"] / 2 + c, yf - 1, yf + P["pl_lip"] + 0.01, z=z)
        y_sh0 = yf + P["pl_lip"]
        y_sh1 = y_sh0 + P["pl_shoulder_t"] + P["pl_stroke"]
        sh = cyl_y(P["pl_shoulder_d"] / 2 + c, y_sh0, y_sh1, z=z)
        sp = cyl_y(P["pl_bore_d"] / 2, y_sh1 - 0.01, d / 2 + 1, z=z)
        u = hole.union(sh).union(sp)
        cut = u if cut is None else cut.union(u)
    cut = cut.union(box(-13.3, 13.3, d / 2 - P["plate_t"], d / 2 + 1, 6.0, 94.0))  # plate recess
    sc = P["SCREW"]
    for x, z in PLATE_SCREWS:
        cut = cut.union(cyl_y(sc["pilot"] / 2, d / 2 - P["plate_t"] - 10, d / 2, x=x, z=z))
    return cut


# ---------------------------------------------------------------- body
def body_solid():
    grip = tilt(grip_local())
    head = cyl_y(HEAD_R, P["head_y0"], HEAD_Y1, z=HEAD_Z)
    head = try_fillet(head, "<Y", 6.0)
    head = try_fillet(head, ">Y", 2.0)
    junc = try_fillet(box(-16, 16, 0, 36, 104, HEAD_Z), "|Y or |Z", 4.0)
    boss = try_fillet(box(-16, 16, 46, HEAD_Y1 - 3, HEAD_Z - 26, HEAD_Z - 6), "|Y or |Z", 5.0)
    return grip.union(head).union(junc).union(boss)


def clam_screw_pts():
    """(y, z) of #4 clamshell screws along X."""
    p0 = tilt_vec([0, 8.0, 5.5])
    p1 = tilt_vec([0, -12.0, 110.0])
    return [(p0[1], p0[2]), (p1[1], p1[2]), (-8.0, HEAD_Z - 5), (-8.0, HEAD_Z + 7),
            (56.0, HEAD_Z - 19), (HEAD_Y1 - 14, HEAD_Z - 19)]


def body_cuts():
    c = P["clr_slide"]
    lw = P["lever_w"] / 2 + c
    tab_front = Y_PUSH_FRONT - c - 7.0          # lever open stop face
    pv = P["PIVOT"]
    cuts = [
        tilt(plunger_cuts_local()),
        # lever slot through junction + head bottom (tab path)
        box(-lw, lw, 4, 40, 92, HEAD_Z - 8),
        box(-lw, lw, tab_front, Y_PUSH_FRONT + P["stroke"] + 1, HEAD_Z - 8, HEAD_Z + 11),
        # pusher bore -> step (hard stop) -> spring pocket -> back wall bolt hole
        cyl_y(P["front_bore_d"] / 2, tab_front, Y_STEP, z=HEAD_Z),
        cyl_y(P["spring_bore_d"] / 2, Y_STEP - 0.01, Y_WALL, z=HEAD_Z),
        cyl_y(A["clr"] / 2, Y_WALL - 0.01, HEAD_Y1 + 1, z=HEAD_Z),
        # anti-rotation key groove (top) for the seat only (pusher needs none)
        box(-2.3, 2.3, Y_STEP, Y_WALL, HEAD_Z, HEAD_Z + P["spring_bore_d"] / 2 + 2.3),
        # pivot
        cyl_x(pv["hole"] / 2, -20, 20, y=PIVOT[0], z=PIVOT[1]),
        # load window on +X side: recess 35x10 + see-through slot over seat travel
        box(HEAD_R - 1.5, HEAD_R + 2, Y_SEAT0 - 30, Y_SEAT0 + 5, HEAD_Z - 5, HEAD_Z + 5),
        box(0, HEAD_R + 2, Y_SEAT0 - P["preload_max"] - 2, Y_SEAT0 + 3, HEAD_Z - 2, HEAD_Z + 2),
    ]
    # tick marks every 5 mm above the window
    for i in range(0, int(P["preload_max"]) + 1, 5):
        y = Y_SEAT0 - i
        cuts.append(box(HEAD_R - 2.0, HEAD_R + 2, y - 0.4, y + 0.4, HEAD_Z + 5, HEAD_Z + 9))
    out = cuts[0]
    for k in cuts[1:]:
        out = out.union(k)
    return out


def make_body_halves():
    b = body_solid().cut(body_cuts())
    sc = P["SCREW"]
    for (y, z) in clam_screw_pts():
        b = (b.cut(cyl_x(sc["clr"] / 2, -17, 0.01, y=y, z=z))
              .cut(cyl_x(sc["cb_d"] / 2, -17, -6, y=y, z=z))
              .cut(cyl_x(sc["pilot"] / 2, 0, 10, y=y, z=z)))
    left = b.intersect(box(-40, 0, -80, 200, -10, 200))
    right = b.intersect(box(0, 40, -80, 200, -10, 200))
    return left, right


# ---------------------------------------------------------------- lever
def make_lever():
    py, pz = PIVOT
    hw = P["lever_w"] / 2
    a = math.radians(P["lever_angle"] - P["grip_rake"])   # from vertical, toward +Y
    d = (math.sin(a), -math.cos(a))
    n = (math.cos(a), math.sin(a))
    L = P["lever_len"]
    tr, tt = P["lever_t_root"] / 2, P["lever_t_tip"] / 2
    fr = P["lever_front_root"]
    pts = [(py + n[0] * tr, pz + n[1] * tr), (py - n[0] * fr, pz - n[1] * fr),
           (py + d[0] * L - n[0] * tt, pz + d[1] * L - n[1] * tt),
           (py + d[0] * L + n[0] * tt, pz + d[1] * L + n[1] * tt)]
    arm = cq.Workplane("YZ").polyline(pts).close().extrude(2 * hw).translate((-hw, 0, 0))
    arm = try_fillet(arm, "|X", 1.0)
    arm = try_fillet(arm, "<X or >X", 3.0)
    hub = cyl_x(tr, -hw, hw, y=py, z=pz)
    tip = cyl_x(tt, -hw, hw, y=py + d[0] * L, z=pz + d[1] * L)
    ty1 = Y_PUSH_FRONT - P["clr_slide"]
    tab = box(-hw, hw, ty1 - 7, ty1, pz, HEAD_Z + 8)
    tab = try_fillet(tab, ">Z", 2.0)
    lever = arm.union(hub).union(tip).union(tab)
    for s_ in (40.0, 60.0, 80.0, 100.0):          # shallow palm scallops
        th = tr + (tt - tr) * s_ / L
        R = 14.0
        lever = lever.cut(cyl_x(R, -hw - 1, hw + 1, y=py + d[0] * s_ + n[0] * (th + R - 1.6),
                                z=pz + d[1] * s_ + n[1] * (th + R - 1.6)))
    return lever.cut(cyl_x(P["PIVOT"]["hole"] / 2, -hw - 1, hw + 1, y=py, z=pz))


# ---------------------------------------------------------------- pusher / seat
def keyed_disc(r_bore, y0, y1, key=True):
    r = r_bore - P["clr_slide"]
    p = cyl_y(r, y0, y1, z=HEAD_Z)
    if key:
        p = p.union(box(-2.0, 2.0, y0, y1, HEAD_Z, HEAD_Z + r_bore + 2.0))   # key rib
    return p


def make_pusher():
    p = keyed_disc(P["front_bore_d"] / 2, Y_PUSH_FRONT, Y_PUSH_BACK, key=False)
    # bolt tip clearance + spring centring spigot
    p = p.union(cyl_y(S["main"]["id"] / 2 - 0.4, Y_PUSH_BACK, Y_PUSH_BACK + 4, z=HEAD_Z))
    return p.cut(cyl_y(A["clr"] / 2 + 0.3, Y_PUSH_FRONT + 2, Y_PUSH_BACK + 5, z=HEAD_Z))


def make_seat():
    y0 = Y_SEAT
    y1 = y0 + P["seat_len"]
    s = keyed_disc(P["spring_bore_d"] / 2, y0, y1)
    s = s.cut(cyl_y(A["clr"] / 2, y0 - 1, y1 + 1, z=HEAD_Z))
    return s.cut(hex_y(A["trap_af"], y1 - A["trap_depth"], y1 + 1, z=HEAD_Z))


# ---------------------------------------------------------------- knob
def make_knob():
    y0 = HEAD_Y1 + 0.2          # bolt head (not the knob) bears on the back wall
    y1 = y0 + P["knob_len"]
    r = P["knob_d"] / 2
    k = cyl_y(r, y0, y1, z=HEAD_Z)
    cutter = None
    for i in range(P["knurl_n"]):
        t = 2 * math.pi * i / P["knurl_n"]
        g = cyl_y(1.6, y0 + 2, y1 + 1, x=(r + 0.6) * math.cos(t),
                  z=HEAD_Z + (r + 0.6) * math.sin(t))
        cutter = g if cutter is None else cutter.union(g)
    k = k.cut(cutter)
    # bolt head trap: head under-face sits 0.2 proud so it bears on the back wall
    k = k.cut(hex_y(A["trap_af"], y0 - 1, y0 + A["head_h"] - 0.2, z=HEAD_Z))
    try:
        k = k.faces(">Y").edges().fillet(1.5)
    except Exception:
        pass
    return k


# ---------------------------------------------------------------- plungers / plate
def make_plunger(z):
    yf = -P["grip_d"] / 2
    y_ex = yf - P["pl_exposed"]
    y_sh0 = yf + P["pl_lip"]
    y_sh1 = y_sh0 + P["pl_shoulder_t"]
    body = cyl_y(P["pl_d"] / 2, y_ex, y_sh0, z=z)
    try:
        body = body.faces("<Y").edges().fillet(2.5)
    except Exception:
        pass
    sh = cyl_y(P["pl_shoulder_d"] / 2, y_sh0, y_sh1, z=z)
    pin = cyl_y(P["pl_pin_d"] / 2, y_sh1, y_sh1 + P["pl_pin_len"], z=z)
    return tilt(body.union(sh).union(pin))


def make_plate():
    d = P["grip_d"]
    c = P["clr_slide"]
    p = box(-13.3 + c, 13.3 - c, d / 2 - P["plate_t"], d / 2, 6.0 + c, 94.0 - c)
    for x, z in PLATE_SCREWS:
        p = p.cut(cyl_y(P["SCREW"]["clr"] / 2, d / 2 - 5, d / 2 + 1, x=x, z=z))
    return tilt(p)


# ---------------------------------------------------------------- bought parts
def helix_spring(od, wire, length, y0, z=HEAD_Z, x=0.0):
    y0 += wire / 2          # sweep profile pokes out wire/2 at each end
    length -= wire
    r = od / 2 - wire / 2
    turns = max(length / (wire * 1.6), 3)
    try:
        path = cq.Wire.makeHelix(length / turns, length, r)
        prof = cq.Workplane("XZ").center(r, 0).circle(wire / 2 * 0.95)
        s = prof.sweep(cq.Workplane().add(path), isFrenet=True)
        s = s.rotate((0, 0, 0), (1, 0, 0), -90).translate((x, y0, z))
        if s.val().isValid():
            return s
    except Exception:
        pass
    return cyl_y(od / 2, y0, y0 + length, x=x, z=z).cut(
        cyl_y(od / 2 - wire, y0 - 1, y0 + length + 1, x=x, z=z))


def comp_main_spring():
    sp = S["main"]
    return helix_spring(sp["od"], sp["wire"], Y_SEAT - Y_PUSH_BACK - 0.6, Y_PUSH_BACK + 0.3)


def comp_finger_springs():
    sp = S["finger"]
    y0 = -P["grip_d"] / 2 + P["pl_lip"] + P["pl_shoulder_t"]
    L = P["grip_d"] / 2 - P["plate_t"] - y0
    out = None
    for z in P["pl_z"]:
        s = helix_spring(sp["od"], sp["wire"], L - 0.6, y0 + 0.3, z=z)
        out = s if out is None else out.union(s)
    return tilt(out)


def comp_adjuster():
    yh0 = HEAD_Y1
    head = hex_y(A["head_af"], yh0, yh0 + A["head_h"], z=HEAD_Z)
    shank = cyl_y(A["d"] / 2, yh0 - A["len"], yh0, z=HEAD_Z)
    y1 = Y_SEAT + P["seat_len"]
    nut = hex_y(A["nut_af"], y1 - A["nut_h"] - 0.1, y1 - 0.1, z=HEAD_Z).cut(
        cyl_y(A["d"] / 2, y1 - 10, y1 + 1, z=HEAD_Z))
    return head.union(shank), nut


def comp_pivot():
    m = P["PIVOT"]
    py, pz = PIVOT
    x0 = -16 - m["washer_t"]
    head = hex_x(m["head_af"], x0 - m["head_h"], x0, y=py, z=pz)
    shank = cyl_x(m["d"] / 2, x0, x0 + m["len"], y=py, z=pz)
    w1 = cyl_x(m["washer_od"] / 2, x0, -16, y=py, z=pz)
    w2 = cyl_x(m["washer_od"] / 2, 16, 16 + m["washer_t"], y=py, z=pz)
    nut = hex_x(m["nut_af"], 16 + m["washer_t"], 16 + m["washer_t"] + m["nut_h"], y=py, z=pz)
    hole = cyl_x(m["d"] / 2, -30, 40, y=py, z=pz)
    return head.union(shank).union(w1.cut(hole)).union(w2.cut(hole)).union(nut.cut(hole))


def comp_screws():
    sc = P["SCREW"]
    out = None
    for (y, z) in clam_screw_pts():
        s = cyl_x(1.4, -6, -6 + sc["len"], y=y, z=z).union(
            cyl_x(sc["head_d"] / 2, -6 - sc["head_h"], -6, y=y, z=z))
        out = s if out is None else out.union(s)
    d = P["grip_d"]
    pl = None
    for x, z in PLATE_SCREWS:
        s = cyl_y(1.4, d / 2 - sc["len"], d / 2, x=x, z=z).union(
            cyl_y(sc["head_d"] / 2, d / 2, d / 2 + sc["head_h"], x=x, z=z))
        pl = s if pl is None else pl.union(s)
    return out.union(tilt(pl))


def build():
    left, right = make_body_halves()
    front = tilt_vec([0, -1, 0], point=False)
    back = tilt_vec([0, 1, 0], point=False)
    parts = [
        ("body_left", "Body left", "case", "#c9ccd2", [-1, 0, 0], left),
        ("body_right", "Body right", "case", "#aeb3bb", [1, 0, 0], right),
        ("lever", "Palm lever", "case", "#5aa9ff", [0, 0.6, -0.8], make_lever()),
        ("pusher", "Spring pusher", "case", "#6fbf73", [0, 0, 1], make_pusher()),
        ("seat", "Preload seat (nut carrier)", "case", "#6fbf73", [0, 0, 1], make_seat()),
        ("knob", "Adjust knob", "case", "#6fbf73", [0, 1, 0], make_knob()),
        ("back_plate", "Plunger back plate", "case", "#8e9aaf", back, make_plate()),
    ]
    for i, z in enumerate(P["pl_z"]):
        parts.append((f"plunger_{i + 1}", f"Plunger {i + 1}", "case", "#ffd166", front,
                      make_plunger(z)))
    bolt, nut = comp_adjuster()
    parts += [
        ("spring_main", "Hillman #53 main spring", "component", "#ff9f43", [0, 0, 1.2],
         comp_main_spring()),
        ("spring_finger", "Ace 5062936 finger springs (4x)", "component", "#ff9f43", back,
         comp_finger_springs()),
        ("bolt_adjuster", "5/16-18 adjuster bolt", "component", "#555b63", [0, 1, 0], bolt),
        ("nut_adjuster", "5/16-18 nut (in seat)", "component", "#555b63", [0, 0, 1.2], nut),
        ("bolt_pivot", "1/4-20 pivot bolt + nylock + washers", "component", "#555b63",
         [1, 0, 0], comp_pivot()),
        ("screws", "#4 screws", "component", "#555b63", [-1, 0, 0], comp_screws()),
    ]
    return parts




def parts():
    """cadlib entry point: every part in its assembled position."""
    out = []
    for key, name, group, color, explode, shp in build():
        out.append({"name": name, "slug": key.replace("_", "-"), "shape": shp, "group": group,
                    "color": color, "explode": explode})
    return out

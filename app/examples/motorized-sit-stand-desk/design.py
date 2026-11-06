import cadquery as cq
from cadlib import fab
from cadlib.parts import part, info
from cadlib.motion import move, ease

SCENE = "floor"

# --- bought desk: E7-class dual-motor frame + 60 x 30 in top -------------
W, D, T = 1524, 762, 25      # desktop
ZT = 700                     # underside of desktop at the built (sitting) pose
ZD = ZT + T                  # desktop surface
LEGX = 650                   # leg centres (frame set to ~1300 wide)

# --- hutch: 2020 posts, 2020 riser rails, 2040 top rails, 6 mm ply shelves
TP = fab.sheet_actual("plywood", 6)
HD = 300                     # shelf depth
YF, YB = D / 2 - HD, D / 2   # hutch front / back edge
YR = (YF + 10, YB - 10)      # rail centre lines
PX = (-740, 0, 740)          # post centres
RISER_H = 100                # riser posts
UP_H = 500                   # upper posts
Z_RAIL1 = ZD + RISER_H                   # riser rail bottom
Z_SH1 = Z_RAIL1 + 20                      # riser shelf bottom
Z_RAIL2 = Z_SH1 + UP_H                    # top rail bottom
Z_SH2 = Z_RAIL2 + 40                      # top shelf bottom

# --- drawer / PC bay (under the right half, in front of the crossbeam) ----
DX0, DX1 = 180, 600          # hanger outer faces
DY0, DY1 = -358, -58         # box front / back
SL = 12.7                    # ball-bearing slide thickness
DZ0 = 575                    # drawer bottom
DH = 110                     # drawer box height

PLY = {"process": "laser", "params": {"material": "plywood", "thickness_mm": 6}, "material": "plywood"}


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def rounded(x0, x1, y0, y1, z0, z1, r):
    b = box(x0, x1, y0, y1, z0, z1)
    try:
        return b.edges("|Z").fillet(r)
    except Exception:
        return b


def yround(x0, x1, y0, y1, z0, z1, r):
    return box(x0, x1, y0, y1, z0, z1).edges("|Y").fillet(r)


def zcyl(d, h, x, y, z0):
    return cq.Workplane("XY").circle(d / 2).extrude(h).translate((x, y, z0))


def shelf_panel(x0, x1, z0, notch_posts, holes, extra_holes=()):
    p = rounded(x0, x1, YF, YB, z0, z0 + TP, 4)
    for (px, py) in notch_posts:
        p = p.cut(box(px - 10.5, px + 10.5, py - 10.5, py + 10.5, z0 - 1, z0 + TP + 1))
    for (hx, hy, dia) in list(holes) + list(extra_holes):
        p = p.cut(zcyl(dia, TP + 2, hx, hy, z0 - 1))
    return p


def wall_with_tabs(x0, x1, y0, y1, z0, z1, along_x, tab_w=30):
    w = box(x0, x1, y0, y1, z0, z1)
    tabs = []
    if along_x:
        L = x1 - x0
        for f in (0.25, 0.75):
            cx = x0 + L * f
            tabs.append((cx - tab_w / 2, cx + tab_w / 2, y0, y1))
    else:
        L = y1 - y0
        for f in (0.25, 0.75):
            cy = y0 + L * f
            tabs.append((x0, x1, cy - tab_w / 2, cy + tab_w / 2))
    for (a, b, c, d) in tabs:
        w = w.union(box(a, b, c, d, z0 - TP, z0 + 1))
    return w, tabs


def parts():
    out = []

    # ---------------- bought frame and top (shown as simple stand-ins) ----
    base = None
    lift = None
    for sx in (-1, 1):
        x = sx * LEGX
        f = rounded(x - 35, x + 35, -350, 350, 0, 35, 10).union(box(x - 45, x + 45, -32, 32, 30, 600))
        base = f if base is None else base.union(f)
        l = box(x - 37, x + 37, -25, 25, 120, ZT - 30).union(box(x - 25, x + 25, -300, 300, ZT - 30, ZT))
        lift = l if lift is None else lift.union(l)
    lift = lift.union(box(-LEGX, LEGX, -25, 25, ZT - 40, ZT))
    out.append({"name": "Lift frame base", "shape": base, "group": "component", "color": "#26282b"})
    out.append({"name": "Lift frame top", "id": "frame_top", "shape": lift, "group": "component", "color": "#303236"})
    out.append({"name": "Desk keypad", "id": "keypad", "shape": rounded(-580, -480, -381, -345, ZT - 22, ZT, 4),
                "group": "component", "color": "#111111", "fx": {"glow": {"color": "#33ccff"}}})
    out.append({"name": "Desktop", "id": "desktop", "shape": rounded(-W / 2, W / 2, -D / 2, D / 2, ZT, ZD, 15),
                "group": "component", "color": "#c9a57c", "material": "wood"})

    # ---------------- hutch extrusion frame ------------------------------
    n = 0
    for x in PX:
        for y in YR:
            n += 1
            out.append({"name": "Riser post", "id": f"rpost{n}", "shape": fab.extrusion(RISER_H, axis="z", at=(x, y, ZD)),
                        "process": "extrusion", "params": {"profile": "2020", "length_mm": RISER_H, "tapped_ends": 0}})
    for i, y in enumerate(YR):
        out.append({"name": "Riser rail", "id": f"rrail{i}", "shape": fab.extrusion(1500, axis="x", at=(-750, y, Z_RAIL1 + 10)),
                    "process": "extrusion", "params": {"profile": "2020", "length_mm": 1500, "tapped_ends": 0}})
    upper = [(x, y) for x in (-740, 740) for y in YR] + [(0, YR[1])]
    for i, (x, y) in enumerate(upper):
        out.append({"name": "Upper post", "id": f"upost{i}", "shape": fab.extrusion(UP_H, axis="z", at=(x, y, Z_SH1)),
                    "process": "extrusion", "params": {"profile": "2020", "length_mm": UP_H, "tapped_ends": 0}})
    for i, y in enumerate(YR):
        rail = cq.Workplane("XY").box(1500, 20, 40).translate((0, y, Z_RAIL2 + 20))
        out.append({"name": "Top rail", "id": f"trail{i}", "shape": rail,
                    "process": "extrusion", "params": {"profile": "2040", "length_mm": 1500, "tapped_ends": 0},
                    "material": "aluminium"})

    # ---------------- plywood shelves (3 x 500 x 300 per tier) ------------
    spans = [(-750, -250), (-250, 250), (250, 750)]
    for i, (x0, x1) in enumerate(spans):
        holes = [(x0 + 90, YR[0], 5.5), (x1 - 90, YR[0], 5.5), (x0 + 90, YR[1], 5.5), (x1 - 90, YR[1], 5.5)]
        extra = [(600, (YF + YB) / 2, 60)] if i == 2 else []          # Qi charger cut-out
        extra += [(x0 + 250, (YF + YB) / 2, 60)] if i == 1 else []     # cable grommet for monitors
        out.append(dict(PLY, name="Riser shelf", id=f"rshelf{i}",
                        shape=shelf_panel(x0, x1, Z_SH1, upper, holes, extra)))
        out.append(dict(PLY, name="Top shelf", id=f"tshelf{i}",
                        shape=shelf_panel(x0, x1, Z_SH2, [], holes)))

    # ---------------- drawer / PC bay -------------------------------------
    hz0, hz1 = DZ0 - 5, ZT
    for i, (x0, x1) in enumerate([(DX0, DX0 + TP), (DX1 - TP, DX1)]):
        h = rounded(x0, x1, DY0 + 3, DY1 + 3, hz0, hz1, 0.1)
        h = h.cut(box(x0 - 1, x1 + 1, -260, -150, hz0 + 25, hz1 - 35))       # lightening window
        out.append(dict(PLY, name="Drawer hanger", id=f"hanger{i}", shape=h))
    bx0, bx1 = DX0 + TP + SL, DX1 - TP - SL
    for i, (x0, x1) in enumerate([(DX0 + TP, bx0), (bx1, DX1 - TP)]):
        out.append({"name": "Drawer slide 12in", "id": f"slide{i}", "shape": box(x0, x1, DY0 + 2, DY1 + 5, DZ0 + 30, DZ0 + 75),
                    "group": "component", "color": "#b8bcc2", "material": "steel"})

    bottom = rounded(bx0, bx1, DY0, DY1, DZ0, DZ0 + TP, 2)
    zw0, zw1 = DZ0 + TP, DZ0 + DH
    walls = []
    sideL, tL = wall_with_tabs(bx0, bx0 + TP, DY0, DY1, zw0, zw1, False)
    sideR, tR = wall_with_tabs(bx1 - TP, bx1, DY0, DY1, zw0, zw1, False)
    front, tF = wall_with_tabs(bx0 + TP, bx1 - TP, DY0, DY0 + TP, zw0, zw1, True)
    back, tB = wall_with_tabs(bx0 + TP, bx1 - TP, DY1 - TP, DY1, zw0, zw1, True)
    back = back.cut(box(330, 450, DY1 - TP - 1, DY1 + 1, zw0 + 8, zw0 + 50))           # cable pass-through
    for k in range(6):
        vx = 230 + k * 18
        back = back.cut(yround(vx, vx + 6, DY1 - TP - 1, DY1 + 1, zw0 + 20, zw1 - 20, 2.9))
    for (a, b, c, d) in tL + tR + tF + tB:
        bottom = bottom.cut(box(a - 0.1, b + 0.1, c - 0.1, d + 0.1, DZ0 - 1, DZ0 + TP + 1))
    out.append(dict(PLY, name="Drawer bottom", id="dbottom", shape=bottom))
    out.append(dict(PLY, name="Drawer side", id="dsideL", shape=sideL))
    out.append(dict(PLY, name="Drawer side", id="dsideR", shape=sideR))
    out.append(dict(PLY, name="Drawer inner front", id="dfront", shape=front))
    out.append(dict(PLY, name="Drawer back", id="dback", shape=back))

    # show face with handle cut-out and vent slots for the PC
    fz0, fz1 = DZ0 - 3, ZT - 3
    face = yround(DX0, DX1, DY0 - TP, DY0, fz0, fz1, 5)
    face = face.cut(yround(340, 440, DY0 - TP - 1, DY0 + 1, fz1 - 30, fz1 - 10, 9.9))      # finger pull
    for k in range(8):
        for vx0 in (215, 443):
            vx = vx0 + k * 12
            face = face.cut(yround(vx, vx + 5, DY0 - TP - 1, DY0 + 1, fz0 + 20, fz1 - 45, 2.4))  # PC vents
    out.append(dict(PLY, name="Drawer face", id="dface", shape=face))

    # removable organiser tray on printed rails: lift it out and the bay takes a mini PC
    rz = DZ0 + 62
    for i, x0 in enumerate([bx0 + TP, bx1 - TP - 8]):
        r = rounded(x0, x0 + 8, DY0 + TP + 5, DY1 - TP - 5, rz - 8, rz, 0.1)
        out.append({"name": "Tray rail", "id": f"trayrail{i}", "shape": r, "group": "case", "process": "print", "color": "#3a3a3a"})
    tray = rounded(bx0 + TP + 1, bx1 - TP - 1, DY0 + TP + 1, DY1 - TP - 1, rz, rz + TP, 3)
    for cx in (bx0 + 60, bx1 - 60):
        tray = tray.cut(zcyl(30, TP + 2, cx, (DY0 + DY1) / 2, rz - 1))
    out.append(dict(PLY, name="Organiser tray", id="tray", shape=tray))

    # ---------------- lighting controller (printed) -----------------------
    ex0, ey0 = -705, YB - 66
    EL, EW, EH, WT = 96, 46, 24, 2.5
    eb = rounded(ex0, ex0 + EL, ey0, ey0 + EW, ZD, ZD + EH, 4)
    eb = eb.cut(rounded(ex0 + WT, ex0 + EL - WT, ey0 + WT, ey0 + EW - WT, ZD + WT, ZD + EH + 1, 1.5))
    ecx, ecy = ex0 + 6 + 27.2, ey0 + EW / 2
    eb = eb.union(box(ecx - 25, ecx + 25, ecy - 3, ecy + 3, ZD + WT - 1, ZD + 11.5))            # board rib
    for (bxp, byp) in [(ex0 + EL - 9, ey0 + 9), (ex0 + EL - 9, ey0 + EW - 9)]:
        eb = eb.union(zcyl(8, EH - WT + 1, bxp, byp, ZD + WT - 1))
        eb = eb.cut(zcyl(4.0, 6.7, bxp, byp, ZD + EH - 6.7))                                   # M3 insert
    eb = eb.cut(box(ex0 - 1, ex0 + WT + 1, ecy - 6, ecy + 6, ZD + 9, ZD + 18))                 # USB slot
    eb = eb.cut(cq.Workplane("YZ").circle(5.5).extrude(WT + 2).translate((ex0 + EL - WT - 1, ey0 + 15, ZD + 12)))
    for sx in (ex0 + 30, ex0 + 50):
        eb = eb.cut(box(sx, sx + 7, ey0 + EW - WT - 1, ey0 + EW + 1, ZD + EH - 7, ZD + EH + 1))   # LED leads
    out.append({"name": "Controller box", "id": "ebox", "shape": eb, "color": "#2b2d30"})
    lid = rounded(ex0, ex0 + EL, ey0, ey0 + EW, ZD + EH, ZD + EH + 2.5, 4)
    for (bxp, byp) in [(ex0 + EL - 9, ey0 + 9), (ex0 + EL - 9, ey0 + EW - 9)]:
        lid = lid.cut(zcyl(3.4, 5, bxp, byp, ZD + EH - 1))
    lid = lid.cut(zcyl(16.2, 5, ex0 + 20, ey0 + EW / 2, ZD + EH - 1))                          # 16 mm button
    for (px, py) in [(ecx - 24, ecy - 11), (ecx - 24, ecy + 11), (ecx + 24, ecy - 11), (ecx + 24, ecy + 11)]:
        lid = lid.union(zcyl(4, EH - 13.1 - 1.5 + 0.6, px, py, ZD + 13.1 + 0.4))              # board hold-downs
    out.append({"name": "Controller lid", "id": "elid", "shape": lid, "color": "#2b2d30"})
    out.append({"name": "16mm push button", "id": "button", "shape": zcyl(19, 2, ex0 + 20, ey0 + EW / 2, ZD + EH + 2.5)
                .union(zcyl(15.8, 14, ex0 + 20, ey0 + EW / 2, ZD + EH - 11)), "group": "component", "color": "#d0d4d8"})
    out.append(dict(part("esp32_devkitc", at=(ecx, ecy, ZD + 11.5)), id="esp32"))
    out.append(dict(part("dc_jack_panel", at=(ex0 + EL, ey0 + 15, ZD + 12), rot=(0, 90, 0)), id="dcjack"))
    out.append(dict(part("m3_insert", at=[(ex0 + EL - 9, ey0 + 9, ZD + EH - 5.7), (ex0 + EL - 9, ey0 + EW - 9, ZD + EH - 5.7)]), id="inserts"))
    out.append(dict(part("m3x8_bhcs", at=[(ex0 + EL - 9, ey0 + 9, ZD + EH + 2.5), (ex0 + EL - 9, ey0 + EW - 9, ZD + EH + 2.5)]), id="lidscrews"))

    # ---------------- LEDs ------------------------------------------------
    out.append(dict(part("ws2812_strip", length=1400, at=(-700, YR[0], Z_RAIL2), rot=(180, 0, 0)), id="led_task",
                    fx={"glow": {"color": "#ffd8a8"}}))
    out.append(dict(part("ws2812_strip", length=900, at=(-450, -371, ZT), rot=(180, 0, 0)), id="led_glow",
                    fx={"glow": {"color": "rainbow", "mode": "rainbow"}}))

    # ---------------- bought power and charging --------------------------
    qx, qy = 600, (YF + YB) / 2
    qi = zcyl(70, 2.5, qx, qy, Z_SH1 + TP).union(zcyl(59.5, 16, qx, qy, Z_SH1 + TP - 15))
    out.append({"name": "15W in-desk Qi charger", "id": "qi", "shape": qi, "group": "component", "color": "#1a1a1a",
                "fx": {"glow": {"color": "#3399ff", "mode": "pulse"}}})
    grommet = zcyl(66, 3, 0, qy, Z_SH1 + TP).cut(zcyl(52, 5, 0, qy, Z_SH1 + TP - 1))
    out.append({"name": "60mm cable grommet", "id": "grommet", "shape": grommet, "group": "component", "color": "#1a1a1a"})
    ps = rounded(-W / 2 + 3, -W / 2 + 63, -330, -130, ZD, ZD + 58, 10)
    ps = ps.union(box(-W / 2 - 8, -W / 2 + 3, -300, -160, ZT - 12, ZD + 40))
    ps = ps.union(box(-W / 2 - 8, -W / 2 + 60, -300, -160, ZT - 22, ZT - 12))
    out.append({"name": "Clamp power strip", "id": "power", "shape": ps, "group": "component", "color": "#f0f0f0"})

    # hutch corner brackets (2 per joint)
    out.append(dict(part("bracket_2020", at=(0, 0, 0)), id="brk"))
    print("BRACKET", info("bracket_2020"))
    print("STRIP", info("ws2812_strip"))
    print("JACK", info("dc_jack_panel"))
    return out


FIXED = {"Lift frame base"}


def motion():
    ids = [(p["id"], p["name"]) for p in parts() if p.get("id") and p["name"] not in FIXED]

    def pose(t):
        # drawer out and back (0-0.35), then the desk rises to standing and returns (0.4-1)
        if t < 0.35:
            d = 250 * ease(min(1, t / 0.12)) if t < 0.2 else 250 * (1 - ease(min(1, (t - 0.2) / 0.12)))
            z = 0
        else:
            d = 0
            u = (t - 0.4) / 0.6 if t > 0.4 else 0
            z = 450 * (ease(u / 0.45) if u < 0.45 else (1 if u < 0.55 else 1 - ease((u - 0.55) / 0.45)))
        res = {}
        for pid, _ in ids:
            dy = -d if pid.startswith(("d", "tray")) and pid not in ("desktop", "dcjack") else 0
            res[pid] = move((0, dy, z))
        return res
    return {"duration": 8, "pose": pose}

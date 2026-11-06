"""Smart putting cup: laser-cut plywood console, printed cup + sensor parts,
aluminium U-channel ball return, 3 IR break beams, ESP32 Wi-Fi.

Ball path: ramp -> deck -> cup (make) or past it into the back trough (miss).
Everything under the deck rolls on one tilted floor plate down to the front-right
gutter and out onto the return channel.
"""
import math
import cadquery as cq
from cadlib import fab
from cadlib.parts import part

SCENE = "floor"

MAT_T = 5.0                      # putting mat thickness (not published, estimated)
T = fab.sheet_actual("plywood", 6)
T3 = fab.sheet_actual("plywood", 3)
TA = fab.sheet_actual("acrylic", 3)

H = 40.0                         # deck top above the mat
RL = 180.0                       # ramp length (12.5 deg)
XL, XG = -100.0, 90.0            # left panel outer face, gutter inner wall left face
GW = 47.0                        # gutter width (ball 42.67)
XR = XG + T + GW                 # right panel inner face
YT, YB, DEPTH = 150.0, 196.0, 250.0
BAY_H = 85.0
RAIL = 64.0                      # side rail height in front of the bay
CX, CY, R = 30.0, 80.0, 107.95 / 2   # regulation 4.25 in cup
M0, M1 = CY - 35.0, CY + 23.0    # cup exit (mouth) edges in Y, widened toward the low side
BALL = 42.67
BEAM_A = 54.0                    # attempt beam height: above a returning ball, through a putt

# tilted floor: low at the front-right exit, high at the back-left.
# Steepest descent points 19 deg off +X, so a ball in the cup always rolls into the mouth.
Z0 = 9.0
SX = math.tan(math.radians(2.0))
SY = math.tan(math.radians(0.7))


def fz(x, y):
    return Z0 + SX * (XR - x) + SY * y


def B(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def below(off=0.0):
    """Half-space under the floor plane, shifted down by off."""
    n = (SX, -SY, 1.0)
    ang = math.degrees(math.acos(1.0 / math.sqrt(SX * SX + SY * SY + 1)))
    s = cq.Workplane("XY").box(3000, 3000, 1000).translate((0, 0, -500))
    s = s.rotate((0, 0, 0), (SY, SX, 0), ang)
    return s.translate((0, 0, fz(0, 0) - off))


SLAB = below(0).cut(below(T))
ABOVE = B(-2000, 2000, -2000, 2000, 0, 500).cut(below(0))


def on_floor(w):
    return w.intersect(ABOVE)


def yz_plate(pts, x0, t):
    return cq.Workplane("YZ").polyline(pts).close().extrude(t).translate((x0, 0, 0))


def xz_cut(w, x, y, z, d=3.5, length=40):
    return w.cut(cq.Workplane("XZ").circle(d / 2).extrude(length / 2, both=True).translate((x, y, z)))


def side_panel(x0):
    pts = [(0, 0), (DEPTH, 0), (DEPTH, BAY_H), (YB, BAY_H), (YB - 29, RAIL), (0, RAIL)]
    p = yz_plate(pts, x0, T)
    try:
        p = p.edges("|X").fillet(3)
    except Exception:
        pass
    for yy in (YB + 25, DEPTH - 15):                       # lid T-slots
        p = p.cut(B(x0 - 1, x0 + T + 1, yy - 1.7, yy + 1.7, BAY_H - 13, BAY_H + 1))
        p = p.cut(B(x0 - 1, x0 + T + 1, yy - 2.9, yy + 2.9, 77, 79.6))
    return p


def parts():
    out = []
    ang = math.atan(H / RL)
    top = lambda y: (y + RL) * math.tan(ang)

    # ---------------- floor plate (3 deg compound tilt) ----------------
    floor = B(XL + T, XR, 0, YB, -50, 200).intersect(SLAB)
    floor = floor.cut(B(XG + T, XR + 1, -1, 44, -50, 200))            # channel bay
    for hx, hy, hr in ((72, 9, 3), (88, M0 - 14, 4), (88, M1 + 12, 4)):   # sensor wire holes
        floor = floor.cut(cq.Workplane("XY").circle(hr).extrude(80).translate((hx, hy, -20)))
    ftabs = [B(XL, XL + T, 40, 80, -50, 200), B(XL, XL + T, 120, 160, -50, 200),
             B(XR, XR + T, 60, 100, -50, 200), B(XR, XR + T, 140, 170, -50, 200),
             B(-60, -20, YB, YB + T, -50, 200), B(60, 100, YB, YB + T, -50, 200)]
    for tb in ftabs:
        floor = floor.union(tb.intersect(SLAB))

    # ---------------- walls standing on the floor plate ----------------
    def wall(box, up=(), down=()):
        w = on_floor(box)
        for u in up:
            w = w.union(u)
        for d in down:
            w = w.union(d.intersect(SLAB))
        return w

    front = wall(B(XL + T, XG + T, 0, T, 0, H - T),
                 up=[B(-60, -40, 0, T, H - T - 1, H), B(20, 40, 0, T, H - T - 1, H)],
                 down=[B(-30, -10, 0, T, -50, 200), B(50, 70, 0, T, -50, 200)])
    gwa = wall(B(XG, XG + T, T, M0 - 24, 0, H - T),
               up=[B(XG, XG + T, 9, 17, H - T - 1, H)], down=[B(XG, XG + T, 8, 18, -50, 200)])
    gwa = gwa.cut(B(XG - 1, XG + T + 1, 10, 18, 17, 27))                # exit emitter
    gwb = wall(B(XG, XG + T, M1 + 24, YT - T, 0, H - T),
               up=[B(XG, XG + T, 130, 140, H - T - 1, H)], down=[B(XG, XG + T, 131, 139, -50, 200)])
    trough = wall(B(XL + T, XG + T, YT - T, YT, 0, H - T),
                  up=[B(x, x + 20, YT - T, YT, H - T - 1, H) for x in (-70, 0, 55)]
                  + [B(XL, XL + T + 1, YT - T, YT, 22, 30)],
                  down=[B(x, x + 20, YT - T, YT, -50, 200) for x in (-40, 25)])

    # ---------------- printed cup: ring + two sensor cheeks ----------------
    # cup beam: emitter and receiver sit on the floor plate in through-pockets, LED 5 mm up
    cup = cq.Workplane("XY").circle(R + 2.4).extrude(H - T).translate((CX, CY, 0))
    cup = cup.union(B(68, XG + T, M0 - 24, M0, 0, H - T)).union(B(68, XG + T, M1, M1 + 24, 0, H - T))
    cup = cup.cut(cq.Workplane("XY").circle(R).extrude(200).translate((CX, CY, -50)))
    cup = cup.cut(B(CX, XG + T + 1, M0, M1, -50, 200))                   # exit mouth
    cup = on_floor(cup)
    beam = {}
    for face, sgn in ((M0, -1), (M1, 1)):                                # housing pockets
        ya, yb = face + sgn * 3.6, face + sgn * 24
        cup = cup.cut(B(83.8, 92.2, min(ya, yb), max(ya, yb), -50, 200))
        bz = fz(88, face) + 5
        beam[sgn] = bz
        cup = cup.cut(cq.Workplane("XZ").circle(1.8).extrude(6, both=True).translate((88, face, bz)))
    for ty in (M0 - 21, M1 + 15):
        cup = cup.union(B(70, 79, ty, ty + 6, H - T - 1, H))

    # ---------------- deck ----------------
    deck = B(XL + T, XG + T, 0, YT, H - T, H)
    deck = deck.cut(cq.Workplane("XY").circle(R).extrude(50).translate((CX, CY, H - 20)))
    deck = deck.cut(B(CX, XG + T + 1, M0, M1, H - 20, H + 5))
    dtabs = [B(XL, XL + T + 1, 30, 60, H - T, H), B(XL, XL + T + 1, 95, 125, H - T, H)]
    for tb in dtabs:
        deck = deck.union(tb)
    for w in (front, gwa, gwb, trough, cup):
        deck = deck.cut(w)

    # ---------------- backstop, back panel, LED shelf, ribs ----------------
    backstop = B(XL + T, XR, YB, YB + T, 0, BAY_H)
    back = B(XL + T, XR, DEPTH - T, DEPTH, 0, BAY_H)
    for z0, z1 in ((20, 40), (55, 70)):
        for x0 in (XL, XR):
            backstop = backstop.union(B(x0, x0 + T, YB, YB + T, z0, z1))
            back = back.union(B(x0, x0 + T, DEPTH - T, DEPTH, z0, z1))
    backstop = backstop.cut(B(0, 30, YB - 1, YB + T + 1, -1, 7)).cut(floor)
    back = back.cut(B(-40, -26, DEPTH - T - 1, DEPTH + 1, -1, 9))       # USB cable
    BX, BZ = 10.0, 40.0                                                  # breakout centre
    SO = [(BX + dx, BZ + dz) for dx in (-34, 34) for dz in (-29, 29)]
    for sx, sz in SO:
        back = xz_cut(back, sx, DEPTH - T / 2, sz, d=3.4, length=20)
    shelf = B(XL + T, XR, YB + T, YB + T + 14, 74, 74 + T)
    for x0 in (XL, XR):
        shelf = shelf.union(B(x0, x0 + T, YB + T + 2, YB + T + 12, 74, 74 + T))

    def rib(y, x1, notches):
        r = B(XL + T, x1, y, y + T, 0, 200).intersect(below(T))
        r = r.union(B(XL, XL + T, y, y + T, 1, 7))
        if x1 == XR:
            r = r.union(B(XR, XR + T, y, y + T, 1, 4))
        for x in (-40, 30):
            r = r.union(B(x, x + 15, y, y + T, -50, 200).intersect(SLAB))
        for nx in notches:
            r = r.cut(B(nx, nx + 10, y - 1, y + T + 1, -1, 3.5))
        return r

    rib1 = rib(12, XG + T, (-90, 67))
    rib2 = rib(165, XR, (-85, 10, 60, 83, 120))
    floor = floor.cut(rib1).cut(rib2)

    # ---------------- side panels ----------------
    lp, rp = side_panel(XL), side_panel(XR)
    lp = lp.cut(B(XL - 1, XL + T + 1, 10, 18, BEAM_A - 5, BEAM_A + 5)).cut(B(XL - 1, XL + T + 1, 22, 30, -1, 5))
    rp = rp.cut(B(XR - 1, XR + T + 1, 10, 18, BEAM_A - 5, BEAM_A + 5)).cut(B(XR - 1, XR + T + 1, 10, 18, 17, 27))
    rp = rp.cut(B(XR - 1, XR + T + 1, 49, 55, -1, 4))
    for w in (floor, deck, trough, backstop, back, shelf, rib1, rib2):
        lp = lp.cut(w)
        rp = rp.cut(w)

    # ---------------- ramp: 3 mm ply on three ribs + printed nose ----------------
    tA = T3 / math.cos(ang)
    bot = lambda y: top(y) - tA
    yp = (1.0 + tA) / math.tan(ang) - RL                  # plate front edge: 1 mm off the mat
    ramp_pts = [(yp, bot(yp)), (0, H - tA), (0, H), (yp, top(yp))]
    ramp = yz_plate(ramp_pts, XL, XG + T - XL)
    ramp_wide = yz_plate(ramp_pts, -500, 1000)
    ribs = []
    for rx in (-75, -5, 60):
        y0 = yp + 18
        r = yz_plate([(y0, 0), (0, 0), (0, bot(0)), (y0, bot(y0))], rx, T)
        r = r.union(B(rx, rx + T, -1, T, 19, 29))
        for ya in (-130, -60):
            r = r.union(B(rx, rx + T, ya, ya + 20, -5, 200).intersect(ramp_wide))
        ribs.append(r)
    for r in ribs:
        ramp = ramp.cut(r)
        front = front.cut(r)
    lip = yz_plate([(-RL, 0), (yp + 15, 0), (yp + 15, bot(yp + 15)), (yp, bot(yp)),
                    (yp, top(yp)), (-RL + 4, 0.9), (-RL, 0.6)], XL, XG + T - XL)

    # ---------------- sensor caps (printed hoods over the side-mounted sensors) ----------------
    def cap(x_face, sgn, y0, y1):
        xo = x_face + sgn * 17.5
        xa, xb = sorted((x_face, xo))
        c = B(xa, xb, y0, y1, 0, RAIL + 2)
        ia, ib = sorted((x_face - sgn, x_face + sgn * 15.5))
        c = c.cut(B(ia, ib, y0 + 2, y1 - 2, -1, RAIL))
        fa, fb = sorted((x_face, x_face + sgn * 3))
        for fy in (y0 - 6, y1):
            fl = B(fa, fb, fy, fy + 6, 20, 36)
            fl = fl.cut(cq.Workplane("YZ").circle(1.4).extrude(10).translate((fa - 1, fy + 3, 28)))
            c = c.union(fl)
        return c

    capL = cap(XL, -1, 6, 36)
    capR = cap(XR + T, 1, 6, 62)

    # ---------------- channel dock (printed) ----------------
    CHX = XG + T + GW / 2
    dock = B(XG + T + 0.3, CHX - 14.6, 0, 48, 0, 10).union(B(CHX + 14.6, XR - 0.3, 0, 48, 0, 10))
    dock = dock.union(B(XG + T + 0.3, XR - 0.3, 44, 48, 0, 4))
    for tx in (CHX - 12, CHX + 6):                                        # tabs into the floor plate
        dock = dock.union(B(tx, tx + 6, 44.5, 47.5, 3, 30).intersect(below(0.2)))
    dock = dock.cut(cq.Workplane("YZ").circle(1.25).extrude(10).translate((CHX + 14.6 - 1, 20, 6)))
    floor = floor.cut(dock)

    # ---------------- lid (opal acrylic over the LED bar) ----------------
    lid = B(XL, XR + T, YB, DEPTH, BAY_H, BAY_H + TA)
    try:
        lid = lid.edges("|Z").fillet(6)
    except Exception:
        pass
    LIDP = [(x, y) for x in (XL + T / 2, XR + T / 2) for y in (YB + 25, DEPTH - 15)]
    for x, y in LIDP:
        lid = lid.cut(cq.Workplane("XY").circle(1.7).extrude(20).translate((x, y, BAY_H - 5)))

    ply = lambda: {"material": "plywood", "thickness_mm": 6}
    L = lambda name, s, ex=(0, 0, 0), color="#d9b98c": {
        "name": name, "shape": s, "group": "case", "process": "laser", "params": ply(),
        "color": color, "explode": list(ex)}
    out += [
        L("Floor plate", floor, (0, 0, -1)),
        L("Front wall", front, (0, -1, 0)),
        L("Gutter wall front", gwa, (0, 0, 1)),
        L("Gutter wall back", gwb, (0, 0, 1)),
        L("Trough wall", trough, (0, 0, 1)),
        L("Deck", deck, (0, 0, 1), "#e2c79c"),
        L("Backstop", backstop, (0, 1, 0)),
        L("Back panel", back, (0, 1, 0)),
        L("LED shelf", shelf, (0, 0, 1)),
        L("Floor rib front", rib1, (0, 0, -1)),
        L("Floor rib back", rib2, (0, 0, -1)),
        L("Left side", lp, (-1, 0, 0)),
        L("Right side", rp, (1, 0, 0)),
        {"name": "Ramp", "shape": ramp, "group": "case", "process": "laser",
         "params": {"material": "plywood", "thickness_mm": 3}, "color": "#e2c79c", "explode": [0, -1, 0.3]},
    ]
    for i, r in enumerate(ribs):
        out.append(L(f"Ramp rib {i + 1}", r, (0, -1, 0)))
    out += [
        {"name": "Lid", "shape": lid, "group": "case", "process": "laser",
         "params": {"material": "acrylic", "thickness_mm": 3}, "material": "acrylic_frosted",
         "color": "#f2f2f2", "explode": [0, 0, 1]},
        {"name": "Cup", "shape": cup, "group": "case", "color": "#1f2326", "explode": [0, 0, 1]},
        {"name": "Ramp nose", "shape": lip, "group": "case", "color": "#1f2326", "explode": [0, -1, 0]},
        {"name": "Sensor cap left", "shape": capL, "group": "case", "color": "#1f2326", "explode": [-1, 0, 0]},
        {"name": "Sensor cap right", "shape": capR, "group": "case", "color": "#1f2326", "explode": [1, 0, 0]},
        {"name": "Channel dock", "shape": dock, "group": "case", "color": "#1f2326", "explode": [0, -1, 0]},
    ]

    # ---------------- bought parts ----------------
    def hous(name, x0, x1, y0, y1, z0, z1):
        return {"name": name, "shape": B(x0, x1, y0, y1, z0, z1), "group": "component", "color": "#202020"}

    out += [
        hous("Attempt beam emitter", XL - 14.5, XL + T, 10, 18, BEAM_A - 5, BEAM_A + 5),
        hous("Attempt beam receiver", XR, XR + 20, 10, 18, BEAM_A - 5, BEAM_A + 5),
        hous("Exit beam emitter", XG + T - 20, XG + T, 10, 18, 17, 27),
        hous("Exit beam receiver", XR, XR + 20, 10, 18, 17, 27),
        hous("Cup beam emitter", 84, 92, M0 - 23.8, M0 - 3.8, beam[-1] - 5, beam[-1] + 5),
        hous("Cup beam receiver", 84, 92, M1 + 3.8, M1 + 23.8, beam[1] - 5, beam[1] + 5),
    ]
    yb_pcb = DEPTH - T - 10
    brk = B(BX - 37.5, BX + 37.5, yb_pcb - 1.6, yb_pcb, BZ - 32.5, BZ + 32.5)
    for dz in (-28, 28):
        brk = brk.union(B(BX - 33, BX + 33, yb_pcb - 11.6, yb_pcb - 1.6, BZ + dz - 4, BZ + dz + 4))
    out.append({"name": "ESP32 screw-terminal breakout", "shape": brk, "group": "component", "color": "#1d4fa0"})
    out.append(part("esp32_devkitc", at=(BX, yb_pcb - 1.6 - 8.5, BZ), rot=(90, 0, 0)))
    for nm, x0, y0, w in (("5V bus A", -88, 204, 30), ("5V bus B", -88, 214, 30),
                          ("GND bus A", -54, 204, 30), ("GND bus B", -54, 214, 30),
                          ("LED data joint", 60, 206, 13)):
        out.append({"name": nm, "shape": B(x0, x0 + w, y0, y0 + 8.5, 0, 18.6).edges("|Y").fillet(1.5),
                    "group": "component", "color": "#e8e8e8"})
    out.append(part("m3x10_standoff", at=[(x, DEPTH - T, z) for x, z in SO], rot=(90, 0, 0)))
    out.append(part("m3x8_bhcs", at=[(x, DEPTH, z) for x, z in SO], rot=(-90, 0, 0)))
    out.append(part("m3x6_bhcs", at=[(x, yb_pcb - 1.6, z) for x, z in SO], rot=(90, 0, 0)))
    out.append(part("ws2812_strip", length=166.7, at=(BX - 83.3, YB + T + 7, 74 + T)))
    out.append(part("m3x12_bhcs", at=[(x, y, BAY_H + TA) for x, y in LIDP]))
    out.append(part("m3_nut", at=[(x, y, 77.1) for x, y in LIDP]))
    out.append(part("m25x8_selftap", at=[(XR + T + 3, y, 28) for y in (3, 65)], rot=(0, 90, 0)))
    out.append(part("m25x8_selftap", at=[(XL - 3, y, 28) for y in (3, 39)], rot=(0, -90, 0)))
    out.append(part("m3x10_selftap", at=(CHX + 12.7, 20, 6), rot=(0, 90, 0)))

    chan = B(CHX - 14.3, CHX + 14.3, 44 - 1219.2, 44, 0, 12.7).cut(
        B(CHX - 12.7, CHX + 12.7, 44 - 1300, 50, 1.6, 20))
    out.append({"name": "Return channel (1 in alu U-channel, 4 ft)", "shape": chan, "group": "component",
                "material": "aluminium", "color": "#c9cdd2"})
    ball = cq.Workplane("XY").sphere(BALL / 2).translate((CX - 10, CY, fz(CX - 10, CY) + BALL / 2))
    out.append({"name": "Golf ball (yours)", "shape": ball, "group": "component", "color": "#fafafa"})

    for p in out:
        p["shape"] = p["shape"].translate((0, 0, MAT_T)) if hasattr(p["shape"], "translate") else p["shape"]

    mat = B(-226, 274, DEPTH - 3048, DEPTH - 2, 0, MAT_T)
    out.append({"name": "Putting mat 10 ft", "shape": mat, "group": "component", "color": "#2f8f3a"})
    return out

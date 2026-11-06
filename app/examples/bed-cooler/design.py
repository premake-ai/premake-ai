"""Peltier bed-cooler case, B10 look-alike (CadQuery).

Coordinates: X = width, Y = depth (front face at -Y), Z = up, mm. Origin at bottom centre.
Every STL is exported in its ASSEMBLED world position (viewer applies no offsets).

Run:   python b10_case.py            -> stl/case_*.stl, stl/comp_*.stl, step/case_*.step, stl/manifest.json
       python b10_case.py --no-clash -> skip the boolean clash check

Architecture (12 V only, no mains inside)
  Lower wet zone  : LocknLock HPL824 reservoir (pump inside), slides out the back after removing the back door.
                    All water penetrations go through the reservoir LID.
  Drip tray       : printed tray across the whole case at Z 82, drains into the reservoir lid.
  Upper zone      : 2 tower coolers side by side, air front -> back. Each sits on a clamp stack
                    (printed clamp plate / water block / TEC / cooler base). Blocks plumbed in series.
  Electronics bay : printed tray on ledges above the towers (dry, walled off from the wet zone).
  Back            : removable upper panel (exhaust vents, 2x QD couplings, power-DIN inlet) + lower door.

Printable parts and print orientation
  case_bottom_L / _R   floor down (as assembled)
  case_top_L / _R      upside down (ceiling on the bed)
  case_drip_tray       floor down
  case_elec_tray       floor down
  case_back_upper      flat, outer face down
  case_back_door       flat, outer face down
  case_clamp_L / _R    flat (60x60x8)
"""
import json
import math
import os
import sys
import time
from pathlib import Path

import cadquery as cq

# =====================================================================================
# COMPONENTS - every bought part, in one place.
# placeholder - replace with exact part dims
# Values from the parts research; items marked "verify" still need a caliper check.
# =====================================================================================
COMPONENTS = {
    # Thermalright Assassin X120 Refined SE: L across the fins (X), W along the airflow incl. fan (Y), H incl. base
    "tower": dict(length=125.0, width=71.0, height=148.0, fan=120.0, fan_t=25.0,
                  base_w=40.0, base_d=45.0, base_h=10.0, fin_start=35.0),       # base/fin_start: verify
    "tec": dict(size=40.0, thick=3.6),                                           # TEC1-12706
    # uxcell water block: 2 barbs on one 40 mm edge (pointing to the back)
    "water_block": dict(size=40.0, thick=12.0, barb_od=8.5, barb_len=15.0, barb_cc=20.0),
    "clamp": dict(plate=60.0, plate_t=8.0, hole_square=50.0, spring_od=7.0, spring_len=8.0,
                  holddown_t=3.0),                                               # printed plate, insulated M3 + springs
    "neoprene": dict(thick=6.35, clearance=7.0),
    "reservoir": dict(length=232.0, width=165.0, height=69.0, corner_r=10.0),    # LocknLock HPL824 outer
    "pump": dict(length=50.0, width=40.0, height=40.0),                          # inside the reservoir - verify
    "float_switch": dict(thread_d=10.0, nut_d=17.0, nut_h=7.0, body_d=25.0, body_h=40.0),  # optional, M10
    "tube": dict(od=11.1, hole_d=13.0, bend_r=25.0, over_barb=12.0),
    "coupling": dict(hole_d=16.0, max_panel_t=5.0, body_d=21.0, body_len=24.0,   # BBTUS panel-mount QD
                     flange_d=24.0, flange_t=4.0, outer_len=30.0, barb_od=8.5, barb_len=15.0,
                     spacing=30.0),                                              # hole_d: verify
    "din_inlet": dict(hole_d=20.0, flange_hole_d=3.4, flange_spacing=28.0,       # 4-pin power DIN - verify
                      flange=30.0, flange_t=3.0, body_d=19.5, body_len=30.0),
    "w1209": dict(length=48.5, width=40.0, height=14.0, window=30.0),
    "relay40": dict(length=40.0, width=28.0, height=28.0, tab_hole=6.0),         # 28x28x40 lying on its side
    "rf_relay": dict(length=105.0, width=51.0, height=30.0),                     # ZABLL
    "fuse_holder": dict(length=60.0, width=20.0, height=15.0),                   # inline ATC, x2
    "insert": dict(hole_d=4.0, depth=6.5, screw_clear=3.4, head_d=6.5),          # M3 heat-set
}
C = COMPONENTS

# ---------------- case parameters (mm) ----------------
W, D, H = 270.0, 200.0, 300.0
FILLET = 12.0
WALL = 2.5
FLOOR_T = 3.0
SPLIT_Z = 82.0                     # top/bottom split = drip-tray underside
GAP = 0.5                          # generic component clearance

RIM_INSET, RIM_WIDTH, RIM_HEIGHT = 14.0, 8.0, 2.0
GRILLE_W, GRILLE_H = 214.0, 120.0
LOUVERS, LOUVER_T = 6, 4.0
TIE_RIB_X = 53.0                   # vertical ribs behind louvers (shorter bridges)

TRAY_FLOOR = 4.0                   # drip tray floor at the drain
TRAY_WALL_H = 14.0                 # tray rim top = SPLIT_Z + TRAY_WALL_H
TRAY_PAD = 1.0                     # clamp pads stand this far above the highest floor point
COLLAR_H = 6.0                     # raised collar round every tray hole
BEAM_T, BEAM_TOP = 10.0, 100.0     # tray back beam (back door + panel screw into it)

ELEC_FLOOR_T, ELEC_WALL_H = 2.5, 8.0
PANEL_CLEAR = 0.3

OUT = Path(__file__).resolve().parent / "stl"
STEP_OUT = Path(__file__).resolve().parent / "step"


# =====================================================================================
# helpers
# =====================================================================================
def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def cbox(cx, cy, cz, sx, sy, sz):
    return box(cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, cz - sz / 2, cz + sz / 2)


def cyl(d, p0, p1):
    v = cq.Vector(*p1) - cq.Vector(*p0)
    return cq.Workplane("XY").add(cq.Solid.makeCylinder(d / 2, v.Length, cq.Vector(*p0), v.normalized()))


def rounded_box(w, d, h, r_vert, r_top, z0=0.0):
    b = cq.Workplane("XY").box(w, d, h, centered=(True, True, False)).translate((0, 0, z0))
    b = b.edges("|Z").fillet(r_vert)
    if r_top:
        b = b.faces(">Z").edges().fillet(r_top)
    return b


def prism_xz(pts, y0, y1):
    """Polygon in the XZ plane (x, z) extruded from y0 to y1."""
    return cq.Workplane("XZ", origin=(0, y1, 0)).polyline(pts).close().extrude(y1 - y0)


def prism_yz(pts, x0, x1):
    """Polygon in the YZ plane (y, z) extruded from x0 to x1."""
    return cq.Workplane("YZ", origin=(x0, 0, 0)).polyline(pts).close().extrude(x1 - x0)


def tube(points, od, bend_r):
    V = cq.Vector
    pts = [V(*p) for p in points]
    w = cq.Wire.makePolygon(pts)
    if len(pts) > 2:
        w = w.fillet(bend_r)
    d = (pts[1] - pts[0]).normalized()
    x = d.cross(V(0, 0, 1)) if abs(d.z) < 0.9 else V(1, 0, 0)
    return cq.Workplane(cq.Plane(origin=pts[0], xDir=x, normal=d)).circle(od / 2).sweep(
        cq.Workplane().add(w), transition="round")


def union_all(items):
    items = [i for i in items if i is not None]
    out = items[0]
    for i in items[1:]:
        out = out.union(i)
    return out


def cut_all(wp, items):
    """Sequential cuts (one big compound cut produced invalid solids in OCC)."""
    for i in items:
        wp = wp.cut(i)
    return wp


# =====================================================================================
# layout - every position derives from COMPONENTS + case params
# =====================================================================================
def layout():
    L = {}
    iy0, iy1 = -D / 2 + WALL, D / 2 - WALL
    ix = W / 2 - WALL
    L.update(iy0=iy0, iy1=iy1, ix=ix)

    r = C["reservoir"]
    rx = r["length"] / 2
    ry0 = iy0 + 9.5                                    # room for the front ledge chamfer + slot view
    L["res"] = dict(x0=-rx, x1=rx, y0=ry0, y1=ry0 + r["width"], z0=FLOOR_T + 2.0)   # sits on 2 mm rails
    L["res"]["z1"] = L["res"]["z0"] + r["height"]
    assert L["res"]["y1"] < iy1 - 15, "reservoir too deep for the case"
    assert L["res"]["z1"] + 6 <= SPLIT_Z, "reservoir lid too close to drip tray"
    assert rx + 3 < W / 2 - FILLET - 2, "reservoir wider than the back opening"

    # back opening (shared by upper panel + door)
    L["op"] = dict(x=W / 2 - FILLET - 2, z0=FLOOR_T, z1=H - FILLET - 2)

    # drip tray / stacks
    L["tray_floor_top"] = SPLIT_Z + TRAY_FLOOR                     # at the drain line X=0
    L["tray_floor_max"] = L["tray_floor_top"] + 1.5                # floor slopes up toward the sides
    L["pad_top"] = L["tray_floor_max"] + TRAY_PAD
    t = C["tower"]
    tx = t["length"] / 2 + 2.5                                     # tower centre X (5 mm gap at the seam)
    ty0 = iy0 + 7.5                                                # fan face 7.5 mm behind the front wall
    stack_y = ty0 + t["fan_t"] + (t["width"] - t["fan_t"]) / 2     # base under the fin stack centre
    cz = L["pad_top"]
    st = dict(plate_z0=cz, plate_z1=cz + C["clamp"]["plate_t"])
    st["block_z0"] = st["plate_z1"]
    st["block_z1"] = st["block_z0"] + C["water_block"]["thick"]
    st["tec_z1"] = st["block_z1"] + C["tec"]["thick"]
    st["tower_z0"] = st["tec_z1"]
    st["tower_z1"] = st["tower_z0"] + t["height"]
    st["barb_z"] = (st["block_z0"] + st["block_z1"]) / 2
    L["stack"] = st
    L["towers"] = [(-tx, -1), (tx, +1)]
    L["tower_y"] = (ty0, ty0 + t["width"])
    L["stack_y"] = stack_y
    assert tx + t["length"] / 2 <= ix - 4, "towers too wide"

    # electronics tray sits on ledges just above the towers
    L["elec_ledge_z0"] = st["tower_z1"] + 0.4
    L["elec_z0"] = L["elec_ledge_z0"] + 2.0
    L["elec_floor_top"] = L["elec_z0"] + ELEC_FLOOR_T
    head = (H - WALL) - L["elec_floor_top"]
    assert head >= C["rf_relay"]["height"] + 1.5, f"electronics bay too low ({head:.1f} mm)"
    L["elec_y"] = (-88.0, 60.0)

    # grille centred on the tower fans
    fan_z1 = st["tower_z1"]
    L["grille_cz"] = fan_z1 - t["fan"] / 2
    L["slot"] = dict(cz=(L["res"]["z0"] + L["res"]["z1"]) / 2 + 5, h=50.0, w=8.0)

    # plumbing
    wb = C["water_block"]
    barb_tip_y = stack_y + wb["size"] / 2 + wb["barb_len"]
    tube_end_y = barb_tip_y - C["tube"]["over_barb"]
    bz = st["barb_z"]
    R = C["tube"]["bend_r"]
    lz = L["res"]["z1"]
    L["barb_tip_y"] = barb_tip_y
    cpl_z = BEAM_TOP + C["coupling"]["flange_d"] / 2 + 1.0
    L["couplings"] = [(70.0, cpl_z), (70.0 + C["coupling"]["spacing"], cpl_z)]   # A (out to pad), B (return)
    cin = L["iy1"] - C["coupling"]["body_len"] - C["coupling"]["barb_len"] + C["tube"]["over_barb"]
    xA, xB = L["couplings"][0][0], L["couplings"][1][0]
    b1 = -tx - wb["barb_cc"] / 2     # block 1 inlet barb
    b1o = -tx + wb["barb_cc"] / 2    # block 1 outlet
    b2i = tx - wb["barb_cc"] / 2
    b2o = tx + wb["barb_cc"] / 2
    p1 = (b1, barb_tip_y + R)        # pump outlet comes up through the lid here
    p4 = (xB, barb_tip_y + 39)       # return drops into the lid here
    L["tubes"] = {
        "pump_to_block1": [(b1, p1[1], lz), (b1, p1[1], bz), (b1, tube_end_y, bz)],
        "block1_to_block2": [(b1o, tube_end_y, bz), (b1o, barb_tip_y + 50, bz),
                             (b2i, barb_tip_y + 50, bz), (b2i, tube_end_y, bz)],
        "block2_to_coupling_A": [(b2o, tube_end_y, bz), (b2o, barb_tip_y + 27, bz),
                                 (xA, barb_tip_y + 52, cpl_z), (xA, cin, cpl_z)],
        "coupling_B_to_reservoir": [(xB, cin, cpl_z), (p4[0], p4[1], cpl_z), (p4[0], p4[1], lz)],
    }
    L["lid"] = dict(pump_out=p1, ret=p4, drain=(0.0, stack_y), cable=(-105.0, 45.0),
                    float_sw=(100.0, -60.0))
    L["tray_holes"] = [  # (kind, x, y, len_along_y)
        ("slot", b1, p1[1] - 2.5, 21.0),     # pump_to_block1 bend passes the tray at a slant
        ("hole", p4[0], p4[1], 0.0),
        ("hole", -105.0, 45.0, 0.0),         # pump + float cables
        ("hole", 110.0, 60.0, 0.0),          # spare / float switch cable
    ]
    L["din"] = (-80.0, L["op"]["z1"] - 18.0)
    return L


# =====================================================================================
# shell (front/sides/top/floor) -> split into 4 printable sections
# =====================================================================================
def shell_solid(L):
    fy = -D / 2
    outer = rounded_box(W, D, H, FILLET, FILLET)
    inner = rounded_box(W - 2 * WALL, D - 2 * WALL, H - WALL - FLOOR_T, FILLET - WALL, FILLET - WALL, z0=FLOOR_T)
    shell = outer.cut(inner)

    # raised front rim
    rw, rh = W - 2 * RIM_INSET, H - 2 * RIM_INSET
    rim = (cq.Workplane("XZ", origin=(0, fy, 0)).center(0, H / 2).rect(rw, rh).extrude(RIM_HEIGHT)
           .edges("|Y").fillet(6)
           .cut(cq.Workplane("XZ", origin=(0, fy, 0)).center(0, H / 2)
                .rect(rw - 2 * RIM_WIDTH, rh - 2 * RIM_WIDTH).extrude(RIM_HEIGHT).edges("|Y").fillet(3)))
    shell = shell.union(rim)

    # grille + louvers + tie ribs
    gz = L["grille_cz"]
    shell = shell.cut(box(-GRILLE_W / 2, GRILLE_W / 2, fy - 1, fy + WALL + 0.01, gz - GRILLE_H / 2, gz + GRILLE_H / 2))
    pitch = GRILLE_H / (LOUVERS + 1)
    feats = []
    for i in range(LOUVERS):
        z = gz - GRILLE_H / 2 + pitch * (i + 1)
        feats.append(box(-GRILLE_W / 2 - 1, GRILLE_W / 2 + 1, fy, fy + WALL, z - LOUVER_T / 2, z + LOUVER_T / 2))
    for sx in (-1, 1):
        feats.append(box(sx * TIE_RIB_X - 1, sx * TIE_RIB_X + 1, fy + 0.5, fy + WALL + 3,
                         gz - GRILLE_H / 2, gz + GRILLE_H / 2))
    shell = shell.union(union_all(feats))

    # ---------- interior features (clipped to the outer skin) ----------
    ix, iy0, iy1 = L["ix"], L["iy0"], L["iy1"]
    inner_feats = []
    for sx in (-1, 1):
        # drip-tray side ledges + 45 deg chamfer below (bottom section prints upright)
        inner_feats.append(box(min(sx * 124.5, sx * (ix + 1)), max(sx * 124.5, sx * (ix + 1)), -86, 86, SPLIT_Z - 3, SPLIT_Z))
        inner_feats.append(prism_xz([(sx * 124.5, SPLIT_Z - 3), (sx * (ix + 1), SPLIT_Z - 3),
                                     (sx * (ix + 1), SPLIT_Z - 3 - (ix + 1 - 124.5))], -86, 86))
        # electronics-tray side ledges + chamfer above (top section prints upside down)
        ez0 = L["elec_ledge_z0"]
        inner_feats.append(box(min(sx * 124.0, sx * (ix + 1)), max(sx * 124.0, sx * (ix + 1)), -86, 86, ez0, ez0 + 2.0))
        inner_feats.append(prism_xz([(sx * 128.0, ez0 + 2.0), (sx * (ix + 1), ez0 + 2.0),
                                     (sx * (ix + 1), ez0 + 2.0 + (ix + 1 - 128.0))], -86, 86))
        # reservoir rails + side guides on the floor
        inner_feats.append(box(sx * 60 - 3, sx * 60 + 3, L["res"]["y0"], 94, FLOOR_T - 0.1, FLOOR_T + 2.0))
        gx = C["reservoir"]["length"] / 2 + GAP
        inner_feats.append(box(min(sx * gx, sx * (gx + 2.5)), max(sx * gx, sx * (gx + 2.5)),
                               L["res"]["y0"], 94, FLOOR_T - 0.1, FLOOR_T + 15))
        # corner blocks across the Z split (screw from below into insert above)
        for sy in (-1, 1):
            ya, yb = sorted((sy * 86.0, sy * (iy1 + 1)))
            xa, xb = sorted((sx * 121.0, sx * (ix + 1)))
            inner_feats.append(box(xa, xb, ya, yb, SPLIT_Z - 16, SPLIT_Z + 16))
            inner_feats.append(prism_xz([(sx * 121.0, SPLIT_Z - 16), (sx * (ix + 1), SPLIT_Z - 16),
                                         (sx * (ix + 1), SPLIT_Z - 16 - (ix + 1 - 121))], ya, yb))
            inner_feats.append(prism_xz([(sx * 121.0, SPLIT_Z + 16), (sx * (ix + 1), SPLIT_Z + 16),
                                         (sx * (ix + 1), SPLIT_Z + 16 + (ix + 1 - 121))], ya, yb))
    # front ledge for the drip tray (+ chamfer)
    inner_feats.append(box(-121, 121, iy0 - 1, -89.5, SPLIT_Z - 3, SPLIT_Z))
    inner_feats.append(prism_yz([(-89.5, SPLIT_Z - 3), (iy0 - 1, SPLIT_Z - 3), (iy0 - 1, SPLIT_Z - 3 - (-89.5 - (iy0 - 1)))],
                                -121, 121))
    # X-seam join blocks (front wall + ceiling)
    seam_blocks = [(iy0 - 1, -91.0, 3.0, 13.0), (iy0 - 1, -91.0, 66.0, 80.0),
                   (iy0 - 1, -91.0, 100.0, 125.0), (iy0 - 1, -91.0, 268.0, 285.0),
                   (-48.0, -32.0, H - WALL - 8, H - WALL + 1), (32.0, 48.0, H - WALL - 8, H - WALL + 1)]
    for (y0, y1, z0, z1) in seam_blocks:
        inner_feats.append(box(-8, 8, y0, y1, z0, z1))
    # upper back panel: lip ring + insert bosses
    op = L["op"]
    ring = box(-op["x"] - 10, op["x"] + 10, iy1 - 2.5, iy1, BEAM_TOP, op["z1"] + 10).cut(
        box(-op["x"] + 5, op["x"] - 5, iy1 - 3, iy1 + 1, BEAM_TOP - 1, op["z1"] - 5))
    inner_feats.append(ring)
    bosses = panel_screws(L, which="upper_shell")
    for (x, z) in bosses:
        inner_feats.append(cyl(9.0, (x, iy1 - 7, z), (x, iy1, z)))
    # relay tab boss in electronics tray is on the tray itself (see elec_tray)
    shell = shell.union(union_all(inner_feats).intersect(outer))

    # ---------- cuts ----------
    cuts = []
    s = L["slot"]
    cuts.append(cq.Workplane("XZ", origin=(0, fy, 0)).center(0, s["cz"]).slot2D(s["h"], s["w"], angle=90)
                .extrude(6, both=True))
    cuts.append(box(-op["x"], op["x"], iy1, D / 2 + 1, op["z0"], op["z1"]))          # back opening
    for (x, z) in bosses:
        cuts.append(cyl(C["insert"]["hole_d"], (x, iy1 - C["insert"]["depth"], z), (x, iy1 + 0.1, z)))
    # door tab notches in the floor
    for sx in (-1, 1):
        cuts.append(box(sx * 60 - 10.3, sx * 60 + 10.3, iy1 - 2.7, D / 2 + 1, 1.0, FLOOR_T + 0.1))
    # tray screw inserts in the front ledge
    for sx in (-1, 1):
        cuts.append(cyl(C["insert"]["hole_d"], (sx * 60, -93.5, SPLIT_Z - C["insert"]["depth"]), (sx * 60, -93.5, SPLIT_Z + 0.1)))
    # corner screws: insert in the top block, clearance + head bore in the bottom block
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = sx * 127.0, sy * 92.0
            cuts.append(cyl(C["insert"]["hole_d"], (cx, cy, SPLIT_Z - 0.1), (cx, cy, SPLIT_Z + C["insert"]["depth"])))
            cuts.append(cyl(C["insert"]["screw_clear"], (cx, cy, SPLIT_Z - 17), (cx, cy, SPLIT_Z + 0.1)))
            cuts.append(cyl(C["insert"]["head_d"], (cx, cy, SPLIT_Z - 40), (cx, cy, SPLIT_Z - 10)))
    # seam blocks: insert on the left (-X), clearance + head pocket on the right
    for (y0, y1, z0, z1) in seam_blocks:
        yc = (max(y0, iy0) + y1) / 2
        zc = (z0 + min(z1, H - WALL)) / 2
        cuts.append(cyl(C["insert"]["hole_d"], (-C["insert"]["depth"], yc, zc), (0.1, yc, zc)))
        cuts.append(cyl(C["insert"]["screw_clear"], (-0.1, yc, zc), (8.1, yc, zc)))
        cuts.append(cyl(C["insert"]["head_d"], (4.0, yc, zc), (8.1, yc, zc)))
    # W1209 display window in the ceiling (cover with clear acrylic)
    wx, wy = elec_positions(L)["w1209"][:2]
    wwin = C["w1209"]["window"]
    cuts.append(box(wx - wwin / 2, wx + wwin / 2, wy - wwin / 2, wy + wwin / 2, H - WALL - 1, H + 1))
    shell = cut_all(shell, cuts)
    return shell


def split_shell(shell):
    big = 2000
    parts = {}
    for zname, z0, z1 in (("bottom", -10, SPLIT_Z), ("top", SPLIT_Z, H + 10)):
        for xname, x0, x1 in (("L", -big, 0), ("R", 0, big)):
            parts[f"case_{zname}_{xname}"] = shell.intersect(box(x0, x1, -big, big, z0, z1))
    return parts


# =====================================================================================
# back panel + door
# =====================================================================================
def panel_screws(L, which):
    op = L["op"]
    xe = op["x"] - 4.5
    if which == "upper_shell":   # inserts in the shell lip
        return [(sx * xe, z) for sx in (-1, 1) for z in (BEAM_TOP + 10, op["z1"] - 16)] + \
               [(sx * 60.0, op["z1"] - 5.2) for sx in (-1, 1)]
    if which == "upper_beam":    # inserts in the drip-tray beam
        return [(sx * 60.0, BEAM_TOP - 4.0) for sx in (-1, 1)]
    if which == "door_beam":
        return [(sx * 60.0, SPLIT_Z + 4.5) for sx in (-1, 1)]
    raise ValueError(which)


def door_top(L):
    return SPLIT_Z + 9.0


def back_upper(L):
    op, iy1 = L["op"], L["iy1"]
    x = op["x"] - PANEL_CLEAR
    z0, z1 = door_top(L) + PANEL_CLEAR, op["z1"] - PANEL_CLEAR
    p = box(-x, x, iy1, D / 2, z0, z1)
    cuts = []
    # exhaust vents: gross region >= 2 x 120 x 120
    vx0, vx1 = -115.5, 115.5
    vz0, vz1 = L["couplings"][0][1] + C["coupling"]["flange_d"] / 2 + 2, L["din"][1] - 13
    slot_w, pitch_x, slot_l, pitch_z = 6.0, 9.0, 30.0, 32.5
    nx = int((vx1 - vx0 - slot_w) // pitch_x) + 1
    nz = int((vz1 - vz0 - slot_l) // pitch_z) + 1
    xs0 = (vx0 + vx1) / 2 - (nx - 1) * pitch_x / 2
    zs0 = (vz0 + vz1) / 2 - (nz - 1) * pitch_z / 2
    pts = [(xs0 + i * pitch_x, zs0 + j * pitch_z) for i in range(nx) for j in range(nz)]
    L["vent_region"] = ((nx - 1) * pitch_x + slot_w, (nz - 1) * pitch_z + slot_l)
    L["vent_open_area"] = len(pts) * (slot_w * (slot_l - slot_w) + math.pi * slot_w ** 2 / 4)
    cuts.append(cq.Workplane("XZ", origin=(0, (iy1 + D / 2) / 2, 0)).pushPoints(pts)
                .slot2D(slot_l, slot_w, angle=90).extrude(3, both=True))
    for (cx, cz) in L["couplings"]:
        cuts.append(cyl(C["coupling"]["hole_d"], (cx, iy1 - 1, cz), (cx, D / 2 + 1, cz)))
    dx, dz = L["din"]
    cuts.append(cyl(C["din_inlet"]["hole_d"], (dx, iy1 - 1, dz), (dx, D / 2 + 1, dz)))
    for s in (-1, 1):
        cuts.append(cyl(C["din_inlet"]["flange_hole_d"], (dx + s * C["din_inlet"]["flange_spacing"] / 2, iy1 - 1, dz),
                        (dx + s * C["din_inlet"]["flange_spacing"] / 2, D / 2 + 1, dz)))
    for (sx, sz) in panel_screws(L, "upper_shell") + panel_screws(L, "upper_beam"):
        cuts.append(cyl(C["insert"]["screw_clear"], (sx, iy1 - 1, sz), (sx, D / 2 + 1, sz)))
        cuts.append(cq.Workplane("XY").add(cq.Solid.makeCone(1.7, 3.3, 1.6, cq.Vector(sx, D / 2 - 1.6, sz),
                                                              cq.Vector(0, 1, 0))))
    return cut_all(p, cuts)


def back_door(L):
    op, iy1 = L["op"], L["iy1"]
    x = op["x"] - PANEL_CLEAR
    p = box(-x, x, iy1, D / 2, op["z0"] + PANEL_CLEAR, door_top(L))
    feats = []
    for sx in (-1, 1):   # bottom tabs drop into the floor notches
        feats.append(box(sx * 60 - 10, sx * 60 + 10, iy1 - 2.4, D / 2, 1.2, op["z0"] + PANEL_CLEAR + 0.01))
        feats.append(box(sx * 60 - 10, sx * 60 + 10, iy1 - 2.4, iy1, op["z0"] + PANEL_CLEAR, op["z0"] + 6))
    p = p.union(union_all(feats))
    cuts = []
    for (sx, sz) in panel_screws(L, "door_beam"):
        cuts.append(cyl(C["insert"]["screw_clear"], (sx, iy1 - 1, sz), (sx, D / 2 + 1, sz)))
        cuts.append(cq.Workplane("XY").add(cq.Solid.makeCone(1.7, 3.3, 1.6, cq.Vector(sx, D / 2 - 1.6, sz),
                                                              cq.Vector(0, 1, 0))))
    # finger pull slot
    cuts.append(cq.Workplane("XZ", origin=(0, (iy1 + D / 2) / 2, 0)).center(0, door_top(L) - 18)
                .slot2D(60, 10, angle=0).extrude(3, both=True))
    return cut_all(p, cuts)


# =====================================================================================
# drip tray (sits on ledges, spans both halves, carries the back beam)
# =====================================================================================
def drip_tray(L):
    iy0, iy1 = L["iy0"], L["iy1"]
    X = 127.5
    z0 = SPLIT_Z
    ztop = SPLIT_Z + TRAY_WALL_H
    # outline: rectangle with the four corner blocks notched out
    opts = [(-X, -85.5), (-120.5, -85.5), (-120.5, iy0 + 0.5), (120.5, iy0 + 0.5),
            (120.5, -85.5), (X, -85.5), (X, 85.5), (120.5, 85.5), (120.5, iy1), (-120.5, iy1),
            (-120.5, 85.5), (-X, 85.5)]
    solid = cq.Workplane("XY").polyline(opts).close().extrude(TRAY_WALL_H).translate((0, 0, z0))
    pocket = (cq.Workplane("XY").polyline(opts).close().offset2D(-2.0).extrude(TRAY_WALL_H)
              .translate((0, 0, z0 + TRAY_FLOOR)))
    tray = solid.cut(pocket)
    # sloped floor: up 1.5 mm toward each side so water runs to the X=0 drain line
    for sx in (-1, 1):
        wedge = prism_xz([(0, z0 + TRAY_FLOOR), (sx * X, z0 + TRAY_FLOOR), (sx * X, z0 + TRAY_FLOOR + 1.5)], iy0, iy1)
        tray = tray.union(wedge.intersect(solid))
    # back beam (back door + upper panel screw into it)
    tray = tray.union(box(-120.5, 120.5, iy1 - BEAM_T, iy1, z0, BEAM_TOP))
    # clamp pads
    cp = C["clamp"]["plate"] + 2
    for (tx, _) in L["towers"]:
        tray = tray.union(cbox(tx, L["stack_y"], (z0 + L["pad_top"]) / 2, cp, cp, L["pad_top"] - z0))
    # hole collars
    hd = C["tube"]["hole_d"]
    collars, holes = [], []
    for kind, x, y, ln in L["tray_holes"]:
        if kind == "slot":
            collars.append(cq.Workplane("XY", origin=(0, 0, z0)).center(x, y).slot2D(ln + hd + 6, hd + 6, angle=90)
                           .extrude(COLLAR_H + TRAY_FLOOR))
            holes.append(cq.Workplane("XY", origin=(0, 0, z0 - 1)).center(x, y).slot2D(ln + hd, hd, angle=90)
                         .extrude(COLLAR_H + TRAY_FLOOR + 2))
        else:
            collars.append(cyl(hd + 6, (x, y, z0), (x, y, z0 + TRAY_FLOOR + COLLAR_H)))
            holes.append(cyl(hd, (x, y, z0 - 1), (x, y, z0 + TRAY_FLOOR + COLLAR_H + 1)))
    tray = tray.union(union_all(collars))
    dx, dy = L["lid"]["drain"]
    holes.append(cyl(6.0, (dx, dy, z0 - 1), (dx, dy, z0 + 10)))
    for sx in (-1, 1):
        holes.append(cyl(C["insert"]["screw_clear"], (sx * 60, -93.5, z0 - 1), (sx * 60, -93.5, z0 + 10)))
    for (sx, sz) in panel_screws(L, "door_beam") + panel_screws(L, "upper_beam"):
        holes.append(cyl(C["insert"]["hole_d"], (sx, iy1 - C["insert"]["depth"], sz), (sx, iy1 + 0.1, sz)))
    return cut_all(tray, holes)


def clamp_plate(L, tx):
    c = C["clamp"]
    st = L["stack"]
    p = cbox(tx, L["stack_y"], (st["plate_z0"] + st["plate_z1"]) / 2, c["plate"], c["plate"], c["plate_t"])
    hs = c["hole_square"] / 2
    holes = [cyl(C["insert"]["hole_d"], (tx + sx * hs, L["stack_y"] + sy * hs, st["plate_z1"] - C["insert"]["depth"]),
                 (tx + sx * hs, L["stack_y"] + sy * hs, st["plate_z1"] + 0.1)) for sx in (-1, 1) for sy in (-1, 1)]
    # 0.8 mm locating pocket for the water block
    s = C["water_block"]["size"] + 0.6
    holes.append(cbox(tx, L["stack_y"], st["plate_z1"] - 0.4 + 0.05, s, s, 0.9))
    return cut_all(p, holes)


# =====================================================================================
# electronics tray
# =====================================================================================
def elec_positions(L):
    z = None  # filled by caller where needed
    return {
        "rf_relay": (-120.0 + C["rf_relay"]["length"] / 2, -85.0 + C["rf_relay"]["width"] / 2),
        "relay40": (10.0 + C["relay40"]["length"] / 2, -85.0 + C["relay40"]["width"] / 2),
        "w1209": (60.0 + C["w1209"]["length"] / 2, -85.0 + C["w1209"]["width"] / 2),
        "fuse1": (12.0 + C["fuse_holder"]["length"] / 2, -40.0 + C["fuse_holder"]["width"] / 2),
        "fuse2": (12.0 + C["fuse_holder"]["length"] / 2, -15.0 + C["fuse_holder"]["width"] / 2),
    }


def elec_tray(L):
    y0, y1 = L["elec_y"]
    X = 127.5
    z0 = L["elec_z0"]
    outline = cq.Workplane("XY").rect(2 * X, y1 - y0).translate((0, (y0 + y1) / 2))
    base = (cq.Workplane("XY").box(2 * X, y1 - y0, ELEC_FLOOR_T + ELEC_WALL_H, centered=(True, True, False))
            .edges("|Z").fillet(5).translate((0, (y0 + y1) / 2, z0)))
    pocket = (cq.Workplane("XY").box(2 * X - 4, y1 - y0 - 4, ELEC_WALL_H + 1, centered=(True, True, False))
              .edges("|Z").fillet(3).translate((0, (y0 + y1) / 2, z0 + ELEC_FLOOR_T)))
    t = base.cut(pocket)
    hd = C["tube"]["hole_d"]
    collars, holes = [], []
    for (x, y) in ((-110.0, 40.0), (110.0, 40.0)):
        collars.append(cyl(hd + 5, (x, y, z0), (x, y, z0 + ELEC_FLOOR_T + 5)))
        holes.append(cyl(hd, (x, y, z0 - 1), (x, y, z0 + ELEC_FLOOR_T + 6)))
    # 40 A relay socket tab boss (tab hole 6 -> M3 insert + washer, or drill for M5)
    rx, ry = elec_positions(L)["relay40"]
    bx, by = rx - C["relay40"]["length"] / 2 - 6, ry
    collars.append(cyl(12.0, (bx, by, z0), (bx, by, z0 + ELEC_FLOOR_T + 4)))
    holes.append(cyl(C["insert"]["hole_d"], (bx, by, z0 + ELEC_FLOOR_T + 4 - C["insert"]["depth"]), (bx, by, z0 + ELEC_FLOOR_T + 4.1)))
    t = t.union(union_all(collars))
    return cut_all(t, holes)


# =====================================================================================
# component dummies (assembled positions)
# =====================================================================================
def components(L):
    comps = {}
    st = L["stack"]
    t, wb, tec, cl = C["tower"], C["water_block"], C["tec"], C["clamp"]
    sy = L["stack_y"]
    ty0, ty1 = L["tower_y"]
    for (tx, s) in L["towers"]:
        side = "L" if s < 0 else "R"
        z0, z1 = st["tower_z0"], st["tower_z1"]
        fan = box(tx - t["fan"] / 2, tx + t["fan"] / 2, ty0, ty0 + t["fan_t"], z1 - t["fan"], z1)
        fins = box(tx - t["length"] / 2, tx + t["length"] / 2, ty0 + t["fan_t"], ty1, z0 + t["fin_start"], z1)
        base = cbox(tx, sy, z0 + t["base_h"] / 2, t["base_w"], t["base_d"], t["base_h"])
        pipes = union_all([cyl(6.0, (tx + dx, sy, z0 + t["base_h"]), (tx + dx, sy, z0 + t["fin_start"] + 5))
                           for dx in (-15, -5, 5, 15)])
        comps[f"comp_tower_{side}"] = ("Tower cooler " + side, "#b8c0c8", fan.union(fins).union(base).union(pipes))
        comps[f"comp_tec_{side}"] = ("TEC1-12706 " + side, "#f2f2f2",
                                     cbox(tx, sy, (st["block_z1"] + st["tec_z1"]) / 2, tec["size"], tec["size"], tec["thick"]))
        blk = cbox(tx, sy, st["barb_z"], wb["size"], wb["size"], wb["thick"])
        for dx in (-wb["barb_cc"] / 2, wb["barb_cc"] / 2):
            blk = blk.union(cyl(wb["barb_od"], (tx + dx, sy + wb["size"] / 2 - 0.01, st["barb_z"]),
                                (tx + dx, sy + wb["size"] / 2 + wb["barb_len"], st["barb_z"])))
        comps[f"comp_block_{side}"] = ("Water block " + side, "#4fa3ff", blk)
        n = C["neoprene"]["thick"]
        wrap = cbox(tx, sy, (st["block_z0"] + st["tec_z1"]) / 2, wb["size"] + 2 * n, wb["size"] + 2 * n,
                    st["tec_z1"] - st["block_z0"]).cut(
            cbox(tx, sy, (st["block_z0"] + st["tec_z1"]) / 2, wb["size"], wb["size"], st["tec_z1"] - st["block_z0"] + 2))
        comps[f"comp_neoprene_{side}"] = ("Neoprene wrap " + side, "#3a3a3a", wrap)
        hs = cl["hole_square"] / 2
        hz0 = z0 + t["base_h"]
        hw = cbox(tx, sy, hz0 + cl["holddown_t"] / 2, cl["plate"] + 2, cl["plate"] + 2, cl["holddown_t"]).cut(
            cbox(tx, sy, hz0 + 1, 34, 20, cl["holddown_t"] + 4))
        for dx in (-hs, hs):
            for dy in (-hs, hs):
                x, y = tx + dx, sy + dy
                hw = hw.union(cyl(3.0, (x, y, st["plate_z1"] - C["insert"]["depth"] + 0.5), (x, y, hz0 + cl["holddown_t"] + cl["spring_len"] + 2.5)))
                hw = hw.union(cyl(cl["spring_od"], (x, y, hz0 + cl["holddown_t"]), (x, y, hz0 + cl["holddown_t"] + cl["spring_len"])))
                hw = hw.union(cyl(5.5, (x, y, hz0 + cl["holddown_t"] + cl["spring_len"]), (x, y, hz0 + cl["holddown_t"] + cl["spring_len"] + 3)))
        comps[f"comp_clamp_hw_{side}"] = ("Clamp screws + springs " + side, "#ffb000", hw)

    r = L["res"]
    res = (cq.Workplane("XY").box(r["x1"] - r["x0"], r["y1"] - r["y0"], r["z1"] - r["z0"], centered=False)
           .edges("|Z").fillet(C["reservoir"]["corner_r"]).translate((r["x0"], r["y0"], r["z0"])))
    lid = L["lid"]
    for key, d, h in (("pump_out", 14, 4), ("ret", 14, 4), ("drain", 10, 2), ("cable", 14, 5)):
        x, y = lid[key]
        res = res.union(cyl(d, (x, y, r["z1"] - 0.01), (x, y, r["z1"] + h)))
    comps["comp_reservoir"] = ("Reservoir HPL824", "#66ccff", res)
    px, py = lid["pump_out"]
    p = C["pump"]
    comps["comp_pump"] = ("Pump (in reservoir)", "#2266aa",
                          cbox(px, py - 10, r["z0"] + 1 + p["height"] / 2, p["width"], p["length"], p["height"]))
    fx, fy = lid["float_sw"]
    f = C["float_switch"]
    fl = cyl(f["nut_d"], (fx, fy, r["z1"]), (fx, fy, r["z1"] + f["nut_h"])).union(
        cyl(f["thread_d"], (fx, fy, r["z1"] - 10), (fx, fy, r["z1"]))).union(
        cyl(f["body_d"], (fx, fy, r["z1"] - 10 - f["body_h"]), (fx, fy, r["z1"] - 10)))
    comps["comp_float_switch"] = ("Float switch (optional)", "#aaaaaa", fl)

    tubes = union_all([tube(pts, C["tube"]["od"], C["tube"]["bend_r"]) for pts in L["tubes"].values()])
    comps["comp_tubes"] = ("Tubing 11.1 OD", "#9be7ff", tubes)

    cp = C["coupling"]
    iy1 = L["iy1"]
    cps = []
    for (cx, cz) in L["couplings"]:
        cps.append(cyl(cp["hole_d"] - 0.4, (cx, iy1 - 0.01, cz), (cx, D / 2 + 0.01, cz)))
        cps.append(cyl(cp["flange_d"], (cx, D / 2 + 0.05, cz), (cx, D / 2 + cp["flange_t"], cz)))
        cps.append(cyl(cp["body_d"], (cx, D / 2 + cp["flange_t"], cz), (cx, D / 2 + cp["flange_t"] + cp["outer_len"], cz)))
        cps.append(cyl(cp["body_d"], (cx, iy1 - cp["body_len"], cz), (cx, iy1 - 0.05, cz)))
        cps.append(cyl(cp["barb_od"], (cx, iy1 - cp["body_len"] - cp["barb_len"], cz), (cx, iy1 - cp["body_len"], cz)))
    comps["comp_couplings"] = ("QD couplings x2", "#ff8844", union_all(cps))

    dn = C["din_inlet"]
    dx, dz = L["din"]
    din = cbox(dx, D / 2 + 0.05 + dn["flange_t"] / 2, dz, dn["flange"] + 8, dn["flange_t"], dn["flange"]).union(
        cyl(dn["hole_d"] - 0.4, (dx, iy1 - 0.01, dz), (dx, D / 2 + 0.06, dz))).union(
        cyl(dn["body_d"], (dx, iy1 - dn["body_len"], dz), (dx, iy1 - 0.05, dz)))
    comps["comp_din_inlet"] = ("Power DIN inlet", "#2b2b2b", din)

    ez = L["elec_floor_top"] + 0.05
    ep = elec_positions(L)
    for key, name, color in (("rf_relay", "RF relay ZABLL", "#ddcc33"), ("relay40", "40 A relay", "#cc3333"),
                             ("w1209", "W1209 thermostat", "#33cc66")):
        c = C[key]
        x, y = ep[key]
        comps[f"comp_{key}"] = (name, color, cbox(x, y, ez + c["height"] / 2, c["length"], c["width"], c["height"]))
    fh = C["fuse_holder"]
    fus = union_all([cbox(*ep[k], ez + fh["height"] / 2, fh["length"], fh["width"], fh["height"]) for k in ("fuse1", "fuse2")])
    comps["comp_fuse_holders"] = ("ATC fuse holders x2", "#ff66aa", fus)
    return comps


# =====================================================================================
# export
# =====================================================================================
CASE_INFO = {
    "case_bottom_L": ("Bottom shell L", "#5aa9ff", [-1, 0, 0]),
    "case_bottom_R": ("Bottom shell R", "#5aa9ff", [1, 0, 0]),
    "case_top_L": ("Top shell L", "#c9ccd2", [-0.5, 0, 1]),
    "case_top_R": ("Top shell R", "#c9ccd2", [0.5, 0, 1]),
    "case_drip_tray": ("Drip tray", "#6fbf73", [0, 0, 0.3]),
    "case_elec_tray": ("Electronics tray", "#9b8cff", [0, 0, 1]),
    "case_back_upper": ("Back panel (upper)", "#e0a96d", [0, 1, 0]),
    "case_back_door": ("Back door (reservoir)", "#d48a4a", [0, 1, 0]),
    "case_clamp_L": ("Clamp plate L", "#f5f5a0", [0, 0, -0.2]),
    "case_clamp_R": ("Clamp plate R", "#f5f5a0", [0, 0, -0.2]),
}


def write_manifest(entries):
    data = {"t": time.time(), "title": "Peltier bed cooler", "parts": entries}
    tmp = OUT / "manifest.json.tmp"
    tmp.write_text(json.dumps(data, indent=1))
    os.replace(tmp, OUT / "manifest.json")


def export_stl(name, wp):
    cq.exporters.export(wp, str(OUT / f"{name}.stl"), tolerance=0.1, angularTolerance=0.2)


def bbox(wp):
    bb = wp.val().BoundingBox() if len(wp.vals()) == 1 else cq.Compound.makeCompound(wp.vals()).BoundingBox()
    return [round(bb.xlen, 1), round(bb.ylen, 1), round(bb.zlen, 1)]


def clash_check(case_parts, comps, tol=1.0):
    """Boolean intersection volume of every component vs every printed part, and printed vs printed."""
    def bb(wp):
        return cq.Compound.makeCompound(wp.vals()).BoundingBox()

    def overlap(a, b):
        return not (a.xmax < b.xmin or b.xmax < a.xmin or a.ymax < b.ymin or b.ymax < a.ymin or
                    a.zmax < b.zmin or b.zmax < a.zmin)

    res = []
    items = [(n, w, bb(w)) for n, w in case_parts.items()]
    citems = [(n, v[2], bb(v[2])) for n, v in comps.items()]
    pairs = [(a, b) for a in citems for b in items] + \
            [(items[i], items[j]) for i in range(len(items)) for j in range(i + 1, len(items))]
    for (na, wa, ba), (nb, wb, bbb) in pairs:
        if not overlap(ba, bbb):
            continue
        try:
            v = wa.intersect(wb)
            vol = sum(s.Volume() for s in v.vals())
        except Exception as e:  # noqa
            vol = float("nan")
            print(f"  ! boolean failed {na} x {nb}: {e}")
        if not (vol < tol):
            res.append((na, nb, vol))
    return res


def main():
    OUT.mkdir(exist_ok=True)
    STEP_OUT.mkdir(exist_ok=True)
    L = layout()
    entries = []
    t0 = time.time()

    # 1) component dummies first (fast) so the viewer has something immediately
    comps = components(L)
    for name, (label, color, wp) in comps.items():
        export_stl(name, wp)
        entries.append({"file": f"stl/{name}.stl", "name": label, "group": "component", "color": color,
                        "explode": [0, 0, 0]})
    write_manifest(entries)
    print(f"components exported ({time.time() - t0:.1f}s)")

    # 2) small printed parts
    case = {}
    case["case_drip_tray"] = drip_tray(L)
    case["case_elec_tray"] = elec_tray(L)
    case["case_back_upper"] = back_upper(L)
    case["case_back_door"] = back_door(L)
    for (tx, s) in L["towers"]:
        case["case_clamp_" + ("L" if s < 0 else "R")] = clamp_plate(L, tx)

    def flush():
        ents = []
        for name, wp in case.items():
            label, color, ex = CASE_INFO[name]
            ents.append({"file": f"stl/{name}.stl", "name": label, "group": "case", "color": color,
                         "explode": ex, "bbox": bbox(wp)})
        write_manifest(ents + entries)

    for name, wp in case.items():
        export_stl(name, wp)
    flush()
    print(f"panels/trays exported ({time.time() - t0:.1f}s)")

    # 3) shell sections
    shell = shell_solid(L)
    for name, wp in split_shell(shell).items():
        case[name] = wp
        export_stl(name, wp)
    flush()
    print(f"shell exported ({time.time() - t0:.1f}s)")

    for name, wp in case.items():
        cq.exporters.export(wp, str(STEP_OUT / f"{name}.step"))

    print("\nPrintable parts (bbox mm, bed 256):")
    ok = True
    for name, wp in case.items():
        b = bbox(wp)
        flag = "OK" if max(b) < 256 else "TOO BIG"
        ok &= flag == "OK"
        print(f"  {name:18s} {b[0]:6.1f} x {b[1]:6.1f} x {b[2]:6.1f}  {flag}")
    vr = L.get("vent_region")
    if vr:
        print(f"\nBack vent region {vr[0]:.0f} x {vr[1]:.0f} mm = {vr[0]*vr[1]:.0f} mm2 "
              f"(2x120x120 = 28800), open slot area {L['vent_open_area']:.0f} mm2")
    head = (H - WALL) - L["elec_floor_top"]
    print(f"Electronics headroom {head:.1f} mm; tower top Z {L['stack']['tower_z1']:.1f}; grille centre Z {L['grille_cz']:.1f}")

    if "--no-clash" not in sys.argv:
        print("\nClash check (intersection volume > 1 mm3):")
        clashes = clash_check(case, comps)
        if not clashes:
            print("  none")
        for a, b, v in clashes:
            print(f"  CLASH {a} x {b}: {v:.1f} mm3")
    print(f"done in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()


# =====================================================================================
# cadlib entry point
# =====================================================================================
def parts():
    """Every printed part and component dummy in its assembled position."""
    L = layout()
    case = {
        "case_drip_tray": drip_tray(L),
        "case_elec_tray": elec_tray(L),
        "case_back_upper": back_upper(L),
        "case_back_door": back_door(L),
    }
    for (tx, s) in L["towers"]:
        case["case_clamp_" + ("L" if s < 0 else "R")] = clamp_plate(L, tx)
    case.update(split_shell(shell_solid(L)))
    out = []
    for key in CASE_INFO:
        if key in case:
            label, color, ex = CASE_INFO[key]
            out.append({"name": label, "slug": key.replace("_", "-").lower(), "shape": case[key],
                        "group": "case", "color": color, "explode": ex})
    for key, (label, color, wp) in components(L).items():
        out.append({"name": label, "slug": key.replace("_", "-").lower(), "shape": wp,
                    "group": "component", "color": color, "explode": [0, 0, 0]})
    return out

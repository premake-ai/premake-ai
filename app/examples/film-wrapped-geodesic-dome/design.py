"""2V geodesic dome, 2 m diameter: 3/4 in hardwood dowel struts, printed socket hubs,
stretch-film skin, J-hook ground stakes through the base hubs.

Hubs print with their OUTER face on the bed (that face carries the film), sockets rising
16-18 deg. Socket outside has a 45 deg keel underneath and the bore a 45 deg roof, so
nothing needs support. One M4 screw per socket goes in from the inside of the dome.
"""
import math
import itertools
import cadquery as cq
from cadlib.parts import part
from cadlib import fab

SCENE = "floor"

R = 1000.0          # dome radius at the hub centres (2 m diameter)
LIFT = 18.0         # hub centres this far above the ground
DOWEL_D = 19.05     # 3/4 in hardwood dowel

# hub socket
RO = 12.8           # socket outer radius (3 mm wall)
RB = 9.8            # bore radius (19.6 mm, 0.55 mm slip on a 3/4 in dowel)
S0 = 22.0           # dowel end stops this far from the hub centre
SOCK = 22.0         # dowel engagement
S1 = S0 + SOCK
H0 = 13.8           # hub centre height above the bed (outer face)
KEEL = 3.0          # half width of the flat under each socket (film rests here)
CORE_HOLE = 11.0    # weight-saving well in the hub centre, open to the inside
BOSS_R, S_M = 5.5, S0 + 11.0
SCREW_CLR = 4.5     # M4 clearance

# base foot / stake plate
FOOT_T, FOOT_W, FOOT_L = 6.0, 52.0, 62.0
STAKE_HOLE = 11.0   # 3/8 in J-hook rebar stake
STAKE_AT = 44.0

FILM_T = 0.4


def _sub(a, b): return tuple(x - y for x, y in zip(a, b))
def _add(a, b): return tuple(x + y for x, y in zip(a, b))
def _mul(a, k): return tuple(x * k for x in a)
def _dot(a, b): return sum(x * y for x, y in zip(a, b))
def _cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def _norm(p):
    l = math.sqrt(_dot(p, p))
    return tuple(c / l for c in p)


def _icosa():
    v = [(0, 0, 1)]
    zr, rr = 1 / math.sqrt(5), 2 / math.sqrt(5)
    v += [(rr * math.cos(math.radians(72 * k)), rr * math.sin(math.radians(72 * k)), zr) for k in range(5)]
    v += [(rr * math.cos(math.radians(36 + 72 * k)), rr * math.sin(math.radians(36 + 72 * k)), -zr) for k in range(5)]
    v += [(0, 0, -1)]
    d = lambda a, b: math.dist(v[a], v[b])
    e = min(d(a, b) for a, b in itertools.combinations(range(12), 2))
    faces = [f for f in itertools.combinations(range(12), 3)
             if all(abs(d(a, b) - e) < 1e-6 for a, b in itertools.combinations(f, 2))]
    return v, faces


def dome():
    """Hub centres (world, mm), unit normals, struts (pairs of keys) and triangles."""
    v, faces = _icosa()
    verts, edges, tris = {}, set(), []
    def key(p):
        p = _norm(p)
        k = tuple(round(c, 6) for c in p)
        verts.setdefault(k, p)
        return k
    mid = lambda p, q: tuple((x + y) / 2 for x, y in zip(p, q))
    for a, b, c in faces:
        A, B, C = v[a], v[b], v[c]
        ab, bc, ca = mid(A, B), mid(B, C), mid(C, A)
        for t in [(A, ab, ca), (B, bc, ab), (C, ca, bc), (ab, bc, ca)]:
            if min(_norm(p)[2] for p in t) < -1e-6:
                continue
            ks = [key(p) for p in t]
            tris.append(ks)
            for i, j in itertools.combinations(ks, 2):
                edges.add(tuple(sorted((i, j))))
    # door: an equilateral (all-B) base triangle, turned to face the front (-Y)
    door = None
    for t in tris:
        base = [k for k in t if abs(verts[k][2]) < 1e-6]
        if len(base) == 2 and all(abs(math.dist(verts[i], verts[j]) - 0.618034) < 1e-3
                                  for i, j in itertools.combinations(t, 2)):
            apex = [k for k in t if k not in base][0]
            door = (base[0], base[1], apex)
            break
    c = [sum(verts[k][i] for k in door) for i in range(2)]
    th = math.radians(-90) - math.atan2(c[1], c[0])
    cs, sn = math.cos(th), math.sin(th)
    verts = {k: (p[0] * cs - p[1] * sn, p[0] * sn + p[1] * cs, p[2]) for k, p in verts.items()}
    pts = {k: (p[0] * R, p[1] * R, p[2] * R + LIFT) for k, p in verts.items()}
    return pts, verts, sorted(edges), tris, door


def _xform(shape, cols, origin):
    """Rigid transform: local x, y, z -> world cols[0..2], then move to origin."""
    (a, b, c) = cols
    pl = cq.Plane(cq.Vector(*origin), cq.Vector(*a), cq.Vector(*c))
    s = shape.val() if isinstance(shape, cq.Workplane) else shape
    return s.moved(cq.Location(pl))


def _arm():
    """One socket along +X from the hub centre (local frame, Z = inward / print up)."""
    c = RO * math.sqrt(0.5)
    zf = RO * math.sqrt(2) - KEEL
    body = cq.Workplane("YZ").circle(RO).extrude(S1)
    keel = cq.Workplane("YZ").polyline([(c, -c), (KEEL, -zf), (-KEEL, -zf), (-c, -c), (0, 0)]).close().extrude(S1)
    boss = cq.Workplane("XY").center(S_M, 0).circle(BOSS_R).extrude(RO + 1.5)
    return body.union(keel).union(boss)


def _bore():
    cb = RB * math.sqrt(0.5)
    ztop = RO - 2.2
    w = RB * math.sqrt(2) - ztop
    L = SOCK + 1
    bore = cq.Workplane("YZ", origin=(S0, 0, 0)).circle(RB).extrude(L)
    roof = cq.Workplane("YZ", origin=(S0, 0, 0)).polyline([(cb, cb), (w, ztop), (-w, ztop), (-cb, cb), (0, 0)]).close().extrude(L)
    screw = cq.Workplane("XY", origin=(0, 0, -1)).center(S_M, 0).circle(SCREW_CLR / 2).extrude(RO + 4)
    return bore.union(roof).union(screw)


def _place(wp, az, el):
    return (wp.rotate((0, 0, 0), (0, 1, 0), -el)
              .rotate((0, 0, 0), (0, 0, 1), az)
              .translate((0, 0, H0)))


def make_hub(dirs, foot=None):
    """dirs: [(azimuth, elevation)] in the print frame. foot: (g, t) horizontal unit vectors."""
    arm, bore = _arm(), _bore()
    hub = cq.Workplane("XY").circle(16).extrude(6)
    try:
        hub = hub.faces("<Z").edges().chamfer(1.5)
    except Exception:
        pass
    for az, el in dirs:
        hub = hub.union(_place(arm, az, el))
    if foot is not None:
        g, t = foot
        plate = cq.Workplane("XY").box(FOOT_T, FOOT_W, FOOT_L, centered=False).translate((LIFT - FOOT_T, -FOOT_W / 2, 0))
        try:
            plate = plate.edges("|X and >Z").fillet(14)
        except Exception:
            pass
        hub = hub.union(cq.Workplane().add(_xform(plate, (g, t, (0, 0, 1)), (0, 0, 0))))
        rh = STAKE_HOLE / 2
        hole = (cq.Workplane("YZ", origin=(LIFT - FOOT_T - 1, 0, 0)).center(0, STAKE_AT).circle(rh).extrude(FOOT_T + 2)
                .union(cq.Workplane("YZ", origin=(LIFT - FOOT_T - 1, 0, 0))
                       .polyline([(rh * 0.7071, STAKE_AT + rh * 0.7071), (0, STAKE_AT + rh * 1.4142),
                                  (-rh * 0.7071, STAKE_AT + rh * 0.7071), (0, STAKE_AT)]).close().extrude(FOOT_T + 2)))
        hub = hub.cut(cq.Workplane().add(_xform(hole, (g, t, (0, 0, 1)), (0, 0, 0))))
    for az, el in dirs:
        hub = hub.cut(_place(bore, az, el))
    hub = hub.cut(cq.Workplane("XY").box(400, 400, 100, centered=(True, True, False)).translate((0, 0, -100)))
    hub = hub.cut(cq.Workplane("XY", origin=(0, 0, 3)).circle(CORE_HOLE).extrude(60))
    n = len(hub.solids().vals())
    if n != 1:
        raise ValueError(f"hub is {n} solids")
    return hub


def frames():
    """Per hub: print-frame -> world rotation, arm directions, screws."""
    pts, nrm, edges, tris, door = dome()
    nb = {k: [] for k in pts}
    for i, j in edges:
        nb[i].append(j)
        nb[j].append(i)
    out = {}
    for k, V in pts.items():
        n = nrm[k]
        zp = _mul(n, -1)
        ref = min(nb[k], key=lambda j: math.dist(pts[j], V))
        d0 = _norm(_sub(pts[ref], V))
        x = _norm(_sub(d0, _mul(zp, _dot(d0, zp))))
        y = _cross(zp, x)
        dirs = []
        for j in nb[k]:
            d = _norm(_sub(pts[j], V))
            dl = (_dot(d, x), _dot(d, y), _dot(d, zp))
            dirs.append((math.degrees(math.atan2(dl[1], dl[0])), math.degrees(math.asin(dl[2])), j, d))
        dirs.sort()
        gaps = [(dirs[(i + 1) % len(dirs)][0] - dirs[i][0]) % 360 for i in range(len(dirs))]
        if min(gaps) < 50:
            print(f"WARNING: arms only {min(gaps):.1f} deg apart at a hub")
        foot = None
        if V[2] < LIFT + 1:
            g = _norm((_dot((0, 0, -1), x), _dot((0, 0, -1), y), 0.0))
            foot = (g, _cross((0, 0, 1), g))
        out[k] = dict(V=V, n=n, cols=(x, y, zp), dirs=dirs, foot=foot)
    return out, pts, edges, tris, door


# ---------------- door ----------------
# Clear acrylic panel lying on the outside of the door triangle's struts. It swings
# outward on two printed rings round the left strut and closes onto two magnets in a
# printed catch screwed to the right strut (push to open from inside, handle outside).
P_IN = 17.0         # panel inner face above the strut-axis plane
OVERLAP = 8.0       # panel edge past the strut axes
CORNER = 72.0       # corners cut back this far so the panel clears the hubs
CORNER_APEX = 150.0 # top cut lower so the panel fits the 600 x 400 laser bed;
                    # the narrow tip above it stays film-wrapped
FILM_TIP = (CORNER_APEX + 25) / 535.0   # film wedge reaches 25 mm under the panel
RING_R, RING_L = 12.8, 18.0
OPEN_DEG = 95


def _sgn(v): return 1.0 if v >= 0 else -1.0


def door_frame(pts, door):
    b1, b2, a = (pts[k] for k in door)
    O = tuple(sum(p[i] for p in (b1, b2, a)) / 3 for i in range(3))
    x = _norm(_sub(b2, b1))
    z = _norm(_cross(_sub(b2, b1), _sub(a, b1)))
    if _dot(z, _sub(O, (0, 0, LIFT))) < 0:
        z = _mul(z, -1)
    y = _cross(z, x)
    return dict(b1=b1, b2=b2, a=a, O=O, x=x, y=y, z=z)


def _strut_frame(D, p0, p1, t):
    X = _norm(_sub(p1, p0))
    Z = D["z"]
    Y = _cross(Z, X)
    org = _add(p0, _mul(_sub(p1, p0), t))
    s = _sgn(_dot(Y, _sub(D["O"], org)))
    return org, (X, Y, Z), s


def _local(org, cols, p):
    return _add(org, _add(_add(_mul(cols[0], p[0]), _mul(cols[1], p[1])), _mul(cols[2], p[2])))


def _clip(poly, v, d, dist):
    out = []
    f = lambda p: (p[0] - v[0]) * d[0] + (p[1] - v[1]) * d[1] - dist
    for i in range(len(poly)):
        p, q = poly[i], poly[(i + 1) % len(poly)]
        fp, fq = f(p), f(q)
        if fp >= 0:
            out.append(p)
        if fp * fq < 0:
            k = fp / (fp - fq)
            out.append((p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k))
    return out


def _screw_rot(u):
    return (math.degrees(math.asin(max(-1, min(1, -u[1])))), math.degrees(math.atan2(u[0], u[2])), 0)


def door_parts(pts, door):
    D = door_frame(pts, door)
    O, x, y, z = D["O"], D["x"], D["y"], D["z"]
    to2 = lambda P: (_dot(_sub(P, O), x), _dot(_sub(P, O), y))
    T = fab.sheet_actual("acrylic", 3)
    tri = [to2(D["b1"]), to2(D["b2"]), to2(D["a"])]
    # strut-axis lines pushed outward by OVERLAP, then intersected
    lines = []
    for i in range(3):
        p, q = tri[i], tri[(i + 1) % 3]
        dx, dy = q[0] - p[0], q[1] - p[1]
        L = math.hypot(dx, dy)
        n = (dy / L, -dx / L)
        if n[0] * -p[0] + n[1] * -p[1] > 0:
            n = (-n[0], -n[1])
        lines.append(((p[0] + n[0] * OVERLAP, p[1] + n[1] * OVERLAP), (dx, dy)))
    big = []
    for i in range(3):
        (p, d), (q, e) = lines[i - 1], lines[i]
        den = d[0] * e[1] - d[1] * e[0]
        s = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den
        big.append((p[0] + d[0] * s, p[1] + d[1] * s))
    poly = big
    for i, v in enumerate(tri):
        l = math.hypot(v[0], v[1])
        poly = _clip(poly, v, (-v[0] / l, -v[1] / l), CORNER_APEX if i == 2 else CORNER)

    holes, out, screws_out, screws_in = [], [], [], []
    hinge = (D["b1"], D["a"])
    latch = (D["b2"], D["a"])

    # hinge rings
    for t in (0.3, 0.62):
        org, cols, s = _strut_frame(D, *hinge, t)
        ring = cq.Workplane("YZ", origin=(-RING_L / 2, 0, 0)).circle(RING_R).extrude(RING_L)
        tab = cq.Workplane("XY").box(RING_L, 40, P_IN - 11, centered=(True, True, False)).translate((0, s * 20, 11))
        try:
            tab = tab.edges("|Z").fillet(4)
        except Exception:
            pass
        ring = ring.union(tab)
        ring = ring.cut(cq.Workplane("YZ", origin=(-RING_L, 0, 0)).circle(9.95).extrude(RING_L * 2))
        ring = ring.cut(cq.Workplane("XY", origin=(0, s * 30, 0)).circle(fab.pilot(3) / 2).extrude(P_IN + 1))
        out.append({"name": "Door hinge ring", "shape": _xform(ring, cols, org), "color": "#f4f4f0",
                    "id": f"hinge{t}"})
        hp = _local(org, cols, (0, s * 30, P_IN + T))
        holes.append(to2(hp))
        screws_out.append(hp)

    # magnetic catch on the latch strut
    org, cols, s = _strut_frame(D, *latch, 0.5)
    top = P_IN - 1.8
    catch = cq.Workplane("XY").box(60, 26, top + 4, centered=(True, True, False)).translate((0, 0, -4))
    try:
        catch = catch.edges("|Z").fillet(6)
    except Exception:
        pass
    catch = catch.cut(cq.Workplane("YZ", origin=(-40, 0, 0)).circle(9.8).extrude(80))
    mags = []
    for mx in (-22, 22):
        catch = catch.cut(cq.Workplane("XY", origin=(mx, 0, 0)).circle(2.25).extrude(top + 1))
        catch = catch.cut(cq.Workplane("XY", origin=(mx, 0, top - 3.6)).circle(4.6).extrude(5))
        screws_in.append((_local(org, cols, (mx, 0, top - 3.6)), _mul(cols[2], 1)))
    for mx in (-8, 8):
        catch = catch.cut(cq.Workplane("XY", origin=(mx, 0, top - 3.1)).circle(5.1).extrude(4))
        mags.append(_local(org, cols, (mx, 0, top - 3.0)))
    out.append({"name": "Door catch", "shape": _xform(catch, cols, org), "color": "#f4f4f0"})
    magnet = None
    for p in mags:
        m = cq.Solid.makeCylinder(5.0, 3.0, cq.Vector(*p), cq.Vector(*z))
        magnet = m if magnet is None else magnet.fuse(m)
    out.append({"name": "10x3 mm neodymium magnet", "shape": magnet, "group": "component",
                "material": "steel", "color": "#9aa0a6"})
    washers = []
    for mx in (-8, 8):
        p = _local(org, cols, (mx, 0, P_IN - 1.5))
        washers.append(cq.Solid.makeCylinder(8.0, 1.5, cq.Vector(*p), cq.Vector(*z)))
    out.append({"name": "Steel fender washer (magnet strike)", "shape": cq.Compound.makeCompound(washers),
                "group": "component", "material": "steel", "color": "#b8bcc0", "id": "washers"})

    # pull handle on the outside, beside the catch
    hy = s * 45
    feet = [(-38, hy), (38, hy)]
    handle = cq.Workplane("XY").box(90, 14, 10, centered=(True, True, False)).translate((0, 0, 22))
    for fx, _ in feet:
        handle = handle.union(cq.Workplane("XY").box(14, 14, 32, centered=(True, True, False)).translate((fx, 0, 0)))
    try:
        handle = handle.edges("|Y").fillet(4)
    except Exception:
        pass
    for fx, _ in feet:
        handle = handle.cut(cq.Workplane("XY").center(fx, 0).circle(fab.pilot(3) / 2).extrude(11))
    horg = _local(org, cols, (0, hy, P_IN + T))
    out.append({"name": "Door handle", "shape": _xform(handle, cols, horg), "color": "#2f6f8f", "id": "handle"})
    for fx, fy in feet:
        p = _local(org, cols, (fx, fy, P_IN))
        holes.append(to2(p))
        screws_in.append((p, _mul(z, -1)))

    panel = cq.Workplane("XY").polyline(poly).close().extrude(T)
    try:
        panel = panel.edges("|Z").fillet(4)
    except Exception:
        pass
    for hx, hyy in holes:
        panel = panel.cut(cq.Workplane("XY", origin=(0, 0, -1)).center(hx, hyy).circle(1.7).extrude(T + 2))
    panel = _xform(panel.translate((0, 0, P_IN)), (x, y, z), O)
    out.append({"name": "Door panel", "shape": panel, "process": "laser",
                "params": {"material": "acrylic", "thickness_mm": 3}, "material": "acrylic_clear",
                "id": "door", "explode": list(z)})

    for i, p in enumerate(screws_out):
        d = part("m3x10_selftap", at=p, rot=_screw_rot(z))
        d["id"] = f"dscrew{i}"
        out.append(d)
    for i, (p, u) in enumerate(screws_in):
        if i in (0, 1):
            out.append(part("m4x16_selftap", at=p, rot=_screw_rot(u)))
        else:
            d = part("m3x10_selftap", at=p, rot=_screw_rot(u))
            d["id"] = f"hscrew{i}"
            out.append(d)
    return out


def motion():
    fr, pts, edges, tris, door = frames()
    D = door_frame(pts, door)
    e = _norm(_sub(D["a"], D["b1"]))
    w = _sub(D["O"], D["b1"])
    ax = e if _dot(_cross(e, w), D["z"]) > 0 else _mul(e, -1)
    ids = ["door", "hinge0.3", "hinge0.62", "handle", "washers", "dscrew0", "dscrew1", "hscrew2", "hscrew3"]
    keys = [[0, 0], [0.3, OPEN_DEG], [0.7, OPEN_DEG], [1, 0]]
    return [{"part": i, "type": "rotate", "axis": list(ax), "pivot": list(D["b1"]), "keys": keys} for i in ids]


def parts():
    fr, pts, edges, tris, door = frames()
    cache, out, screws = {}, [], []
    names = {4: "Hub 4-way base", 5: "Hub 5-way", 6: "Hub 6-way"}
    for k, f in fr.items():
        sig = tuple((round(a, 1), round(e, 1)) for a, e, _, _ in f["dirs"])
        if f["foot"]:
            sig += (tuple(round(c, 3) for c in f["foot"][0]),)
        if sig not in cache:
            cache[sig] = make_hub([(a, e) for a, e, _, _ in f["dirs"]], f["foot"])
        x, y, zp = f["cols"]
        origin = _add(f["V"], _mul(f["n"], H0))
        shape = _xform(cache[sig], (x, y, zp), origin)
        out.append({"name": names[len(f["dirs"])], "shape": shape, "color": "#f4f4f0",
                    "explode": list(f["n"])})
        for az, el, _, d in f["dirs"]:
            a, e = math.radians(az), math.radians(el)
            up_l = (-math.sin(e) * math.cos(a), -math.sin(e) * math.sin(a), math.cos(e))
            u = _add(_add(_mul(x, up_l[0]), _mul(y, up_l[1])), _mul(zp, up_l[2]))
            p = _add(_add(f["V"], _mul(d, S_M)), _mul(u, RO + 1.5))
            rx = math.degrees(math.asin(max(-1, min(1, -u[1]))))
            ry = math.degrees(math.atan2(u[0], u[2]))
            screws.append((p, (rx, ry, 0)))
    print(f"hub designs: {len(cache)} unique for {len(fr)} hubs")

    groups = {}
    for i, j in edges:
        a, b = pts[i], pts[j]
        L = math.dist(a, b)
        d = _norm(_sub(b, a))
        p0 = _add(a, _mul(d, S0))
        cyl = cq.Solid.makeCylinder(DOWEL_D / 2, L - 2 * S0, cq.Vector(*p0), cq.Vector(*d))
        groups.setdefault(round(L, 1), []).append(cyl)
    for (L, cyls), tag in zip(sorted(groups.items()), "AB"):
        cut = L - 2 * S0
        print(f"strut {tag}: {len(cyls)} x cut {cut:.1f} mm (hub centre to centre {L:.1f} mm)")
        out.append({"name": f"Struts {tag} ({len(cyls)} x {cut:.0f} mm dowel)", "shape": cq.Compound.makeCompound(cyls),
                    "group": "component", "material": "wood", "color": "#c89b62"})

    for p, r in screws:
        out.append(part("m4x20_selftap", at=p, rot=r))

    # J-hook stakes through each base foot (only the part above ground shown)
    stakes = []
    for k, f in fr.items():
        if not f["foot"]:
            continue
        x, y, zp = f["cols"]
        g, _ = f["foot"]
        V = f["V"]
        sp = _add((V[0], V[1], 0.0), _add(_mul(x, 0), _mul(zp, STAKE_AT - H0)))
        sp = (V[0] + zp[0] * (STAKE_AT - H0), V[1] + zp[1] * (STAKE_AT - H0), 0.0)
        stakes.append(cq.Solid.makeCylinder(4.76, FOOT_T + 9.5, cq.Vector(*sp), cq.Vector(0, 0, 1)))
        inward = _norm((zp[0], zp[1], 0))
        top = (sp[0], sp[1], FOOT_T + 4.76)
        stakes.append(cq.Solid.makeCylinder(4.76, 45, cq.Vector(*top), cq.Vector(*inward)))
    out.append({"name": "Ground stakes (12 in J-hook, driven in)", "shape": cq.Compound.makeCompound(stakes),
                "group": "component", "material": "steel", "color": "#555555"})

    # stretch-film skin: flat facets touching the hubs' outer faces
    out += door_parts(pts, door)
    facets = []
    for t in tris:
        q = [_add(fr[k]["V"], _mul(fr[k]["n"], H0)) for k in t]
        if set(t) == set(door):
            # only the narrow tip above the door panel is filmed
            fq = {k: p for k, p in zip(t, q)}
            ap = fq[door[2]]
            q = [ap] + [_add(ap, _mul(_sub(fq[b], ap), FILM_TIP)) for b in door[:2]]
        nf = _norm(_cross(_sub(q[1], q[0]), _sub(q[2], q[0])))
        if _dot(nf, fr[t[0]]["n"]) < 0:
            nf = _mul(nf, -1)
        w = cq.Wire.makePolygon([cq.Vector(*p) for p in q], close=True)
        facets.append(cq.Solid.extrudeLinear(cq.Face.makeFromWires(w), cq.Vector(*_mul(nf, FILM_T))))
    out.append({"name": "Stretch film skin", "shape": cq.Compound.makeCompound(facets), "group": "component",
                "material": "acrylic_clear", "color": "#dfeff5", "explode": [0, 0, 1]})
    return out

"""Real gears for printing: involute teeth (the curved flank real gears use, so they roll instead of knocking), sized by
module, with backlash for FDM. Never build gear teeth from boxes.

    from cadlib import gears
    g = gears.spur(module=1.5, teeth=20, width=8, bore=5)              # spur gear, axis +Z, z 0..width, centred on 0,0
    h = gears.spur(1.5, 20, 8, bore=5, helix=20, herringbone=True)     # quieter, stronger, self-centring
    a, b = gears.bevel_pair(module=1.5, teeth_a=16, teeth_b=32, face=8, bore_a=5, bore_b=8)  # 90-degree pair, see below
    r = gears.rack(module=1.5, length=120, width=8, height=10)          # straight rack along X, teeth up (+Z)
    gears.center_distance(1.5, 20, 40)   # 45.0: axis-to-axis spacing for a spur pair
    gears.pitch_d(1.5, 20)               # 30.0: pitch diameter; outside diameter = pitch_d + 2 * module

Every gear is a cq.Workplane with its axis on +Z, the back face on z=0. Place and rotate it like any other part. Two meshing
spur gears need the SAME module and pressure angle, axes `center_distance()` apart; rotate one of them by half a tooth
(180 / teeth degrees) so a tooth meets a gap.

bevel_pair(): two bevel gears whose axes meet at 90 degrees at the origin's apex. Gear A's axis is +Z, gear B's axis is +X;
each is returned already placed so they mesh: A's back face at z = a_back, B's at x = b_back (both in the returned info).
Move/rotate the pair together.
"""
import math

import cadquery as cq

PA = 20.0  # pressure angle, degrees (the standard)


def pitch_d(module, teeth):
    return module * teeth


def center_distance(module, teeth_a, teeth_b):
    return module * (teeth_a + teeth_b) / 2.0


def _inv(a):
    return math.tan(a) - a


def _profile(module, teeth, backlash=0.15, pa=PA, pts=8):
    """The gear's outline in XY as a closed list of points (involute flanks, root and tip arcs)."""
    if teeth < 6:
        raise ValueError('gears: use at least 6 teeth (12+ avoids undercut)')
    pa = math.radians(pa)
    r = module * teeth / 2.0
    rb = r * math.cos(pa)
    ra = r + module
    rf = max(r - 1.25 * module, 0.5)
    # half the tooth's angular thickness at the pitch circle, thinned by the backlash (mm along the pitch circle)
    half = math.pi / (2 * teeth) - (backlash / 2.0) / r
    out = []
    step = 2 * math.pi / teeth
    r0 = max(rb, rf)
    rs = [r0 + (ra - r0) * (i / (pts - 1)) ** 0.8 for i in range(pts)]
    for k in range(teeth):
        c = k * step
        flank = []
        for ri in rs:
            ai = math.acos(min(1.0, rb / ri))
            th = half + _inv(pa) - _inv(ai)
            flank.append((ri, th))
        # root in front of the tooth, rising flank, tip, falling flank
        left = [(rri, c - th) for rri, th in flank]
        right = [(rri, c + th) for rri, th in reversed(flank)]
        if rf < r0:
            out.append((rf, c - flank[0][1]))
        out += left + right
        if rf < r0:
            out.append((rf, c + flank[0][1]))
    return [(ri * math.cos(t), ri * math.sin(t)) for ri, t in out]


def _with_bore(wp, bore, width, z0=0.0):
    if bore and bore > 0:
        wp = wp.cut(cq.Workplane('XY').workplane(offset=z0 - 1).circle(bore / 2.0).extrude(width + 2))
    return wp


def spur(module, teeth, width, bore=0.0, *, helix=0.0, herringbone=False, backlash=0.15, pa=PA, hub=None):
    """A spur gear (helix=0) or helical gear (helix = helix angle in degrees, 15-25 is typical), axis +Z, z 0..width.
    herringbone=True mirrors the helix at mid-width (stronger, no side thrust: the best choice for printed gears).
    hub=(diameter, length): a round hub on the back for a grub screw."""
    pts = _profile(module, teeth, backlash, pa)
    base = cq.Workplane('XY').polyline(pts).close()
    r = module * teeth / 2.0
    twist = math.degrees(width * math.tan(math.radians(helix)) / r) if helix else 0.0
    if not helix:
        g = base.extrude(width)
    elif herringbone:
        half = width / 2.0
        g = base.twistExtrude(half, twist / 2.0)
        top = cq.Workplane('XY').workplane(offset=half).transformed(rotate=(0, 0, twist / 2.0)).polyline(pts).close().twistExtrude(half, -twist / 2.0)
        g = g.union(top)
    else:
        g = base.twistExtrude(width, twist)
    if hub:
        hd, hl = hub
        g = g.union(cq.Workplane('XY').workplane(offset=-hl).circle(hd / 2.0).extrude(hl + 0.01))
        return _with_bore(g, bore, width + hl, -hl)
    return _with_bore(g, bore, width)


def _bevel(module, teeth, other_teeth, face, bore, backlash, pa):
    """One bevel gear of a 90-degree pair, axis +Z, back face on z=0, apex at z = apex (returned)."""
    delta = math.atan2(teeth, other_teeth)            # pitch cone angle
    r = module * teeth / 2.0
    cone = r / math.sin(delta)                        # cone distance (pitch point to apex)
    face = min(face, cone / 3.0)
    k = (cone - face) / cone                          # the small end is this much smaller
    dz = face * math.cos(delta)
    pts = _profile(module, teeth, backlash, pa)
    small = [(x * k, y * k) for x, y in pts]
    g = (cq.Workplane('XY').polyline(pts).close()
         .workplane(offset=dz).polyline(small).close().loft(ruled=True))
    g = _with_bore(g, bore, dz)
    apex = r / math.tan(delta)                        # pitch point's height above the back face is 0: apex above it
    return g, apex, delta


def bevel_pair(module, teeth_a, teeth_b, face, bore_a=0.0, bore_b=0.0, *, backlash=0.15, pa=PA):
    """Two bevel gears meshing at 90 degrees, apex at the origin. Returns (gear_a, gear_b, info): gear A axis +Z (back
    face below the apex), gear B axis +X. info = {'a_back': z of A's back face, 'b_back': x of B's back face, ...}."""
    ga, apex_a, da = _bevel(module, teeth_a, teeth_b, face, bore_a, backlash, pa)
    gb, apex_b, db = _bevel(module, teeth_b, teeth_a, face, bore_b, backlash, pa)
    ga = ga.translate((0, 0, -apex_a))                                   # A: apex at the origin, teeth facing up to it
    gb = gb.translate((0, 0, -apex_b)).rotate((0, 0, 0), (0, 1, 0), 90)  # B: its +Z axis turned onto +X
    gb = gb.rotate((0, 0, 0), (1, 0, 0), 180.0 / teeth_b)                # half a tooth, so a tooth meets a gap
    return ga, gb, {'a_back': -apex_a, 'b_back': -apex_b, 'pitch_angle_a': math.degrees(da), 'pitch_angle_b': math.degrees(db),
                    'pitch_d_a': module * teeth_a, 'pitch_d_b': module * teeth_b}


def rack(module, length, width, height, *, backlash=0.15, pa=PA):
    """A straight rack along +X from x=0, teeth on top, pitch line at z = height (the gear's pitch circle touches it),
    y 0..width."""
    p = math.pi * module
    t = math.tan(math.radians(pa))
    half = p / 4.0 - backlash / 4.0
    pts = [(0, 0)]
    x = 0.0
    while x + p <= length + 1e-6:
        c = x + p / 2.0
        pts += [(c - half - 1.25 * module * t, height - 1.25 * module), (c - half + module * t, height + module),
                (c + half - module * t, height + module), (c + half + 1.25 * module * t, height - 1.25 * module)]
        x += p
    pts += [(length, height - 1.25 * module), (length, 0)]
    return cq.Workplane('XZ').polyline(pts).close().extrude(-width)

"""Real gears for printing, made with cq_gears (cadlib/cq_gears, Apache-2.0): involute teeth with rounded roots, smooth
spline flanks and true tapered bevel teeth, plus a printing backlash. Never build gear teeth from boxes.

    from cadlib import gears
    g = gears.spur(module=1.5, teeth=20, width=8, bore=5)              # spur gear, axis +Z, z 0..width, centred on 0,0
    h = gears.spur(1.5, 20, 8, bore=5, helix=20, herringbone=True)     # quieter, stronger, self-centring
    a, b, info = gears.bevel_pair(module=1.5, teeth_a=16, teeth_b=32, face=8, bore_a=5, bore_b=8)  # 90-degree pair
    r = gears.rack(module=1.5, length=120, width=8, height=10)          # straight rack along X, teeth up (+Z)
    gears.center_distance(1.5, 20, 40)   # 45.0: axis-to-axis spacing for a spur pair
    gears.pitch_d(1.5, 20)               # 30.0: pitch diameter; outside diameter = pitch_d + 2 * module

Every gear is a cq.Workplane with its axis on +Z, the back face on z=0, a tooth centred on +X. Place and rotate it like
any other part. Two meshing spur gears need the SAME module and pressure angle, axes `center_distance()` apart; rotate
one of them by half a tooth (180 / teeth degrees) so a tooth meets a gap.

bevel_pair(): two bevel gears whose axes meet at 90 degrees at the origin (the apex). Gear A's axis is +Z with its back
face below the apex at z = a_back; gear B's axis is +X with its back face at x = b_back (both in the returned info), and
B is already turned so a tooth meets a gap. Move / rotate the pair together.

Bores: `bore` is the hole you draw; for a motor shaft use fab.shaft_bore() instead (printed holes come out small).
Under 17 teeth the teeth get undercut (thin at the root): 12+ is fine for light loads, 17+ for anything that pushes hard.
Built gears are cached (in memory and on disk), so a bevel pair (about 10 s the first time) is instant after that.
"""
import hashlib
import math
import os
import tempfile

import cadquery as cq

from cadlib.cq_gears import BevelGearPair, HerringboneGear, RackGear, SpurGear

PA = 20.0  # pressure angle, degrees (the standard)
BACKLASH = 0.15  # mm taken off each tooth's thickness at the pitch circle, so printed gears don't bind


def pitch_d(module, teeth):
    return module * teeth


def center_distance(module, teeth_a, teeth_b):
    return module * (teeth_a + teeth_b) / 2.0


def _bl(module, backlash, pa):
    """Backlash in mm of tooth thickness -> cq_gears' backlash coefficient (it thins the tooth by m * k * tan(pa))."""
    return float(backlash) / (float(module) * math.tan(math.radians(pa)))


def _check(teeth):
    if teeth < 6:
        raise ValueError('gears: use at least 6 teeth (12+ avoids weak undercut teeth)')
    if teeth < 12:
        print(f'  WARNING: a {teeth}-tooth gear is badly undercut (thin, weak teeth): use 12 or more')


# ---- cache: the same gear (same numbers) is built once per process and kept on disk between builds
_mem = {}


def _cache_dir():
    home = os.path.join(os.getcwd(), '.agent-home', 'cache')  # a design's build sandbox can write here
    d = os.path.join(home if os.path.isdir(home) else tempfile.gettempdir(), 'premake-gears')
    try:
        os.makedirs(d, exist_ok=True)
        return d
    except OSError:
        return None


def _cached(key, make):
    if key in _mem:
        return _mem[key]
    k = hashlib.sha1(('cq_gears-0.62|' + key).encode()).hexdigest()[:20]
    d = _cache_dir()
    f = os.path.join(d, k + '.brep') if d else None
    shape = None
    if f and os.path.isfile(f):
        try:
            shape = cq.Shape.importBrep(f)
            if not shape.isValid():
                shape = None
        except Exception:
            shape = None
    if shape is None:
        shape = make()
        if f:
            try:
                tmp = f + f'.{os.getpid()}.part'
                shape.exportBrep(tmp)
                os.replace(tmp, f)
            except Exception:
                pass
    _mem[key] = shape
    return shape


def _cyl(r, z0, h):
    return cq.Workplane('XY').workplane(offset=z0).circle(r).extrude(h)


def spur(module, teeth, width, bore=0.0, *, helix=0.0, herringbone=False, backlash=BACKLASH, pa=PA, hub=None):
    """A spur gear (helix=0) or helical gear (helix = helix angle in degrees, 15-25 is typical), axis +Z, z 0..width.
    herringbone=True mirrors the helix at mid-width (stronger, no side thrust: the best choice for printed gears).
    hub=(diameter, length): a round hub on the back (z -length..0) for a grub screw."""
    _check(teeth)
    k = _bl(module, backlash, pa)
    key = f'spur|{module}|{teeth}|{width}|{helix}|{herringbone}|{k:.6f}|{pa}'
    if herringbone and helix:
        g = _cached(key, lambda: HerringboneGear(module, teeth, width, pressure_angle=pa, helix_angle=helix, backlash=k).build())
    else:
        g = _cached(key, lambda: SpurGear(module, teeth, width, pressure_angle=pa, helix_angle=helix, backlash=k).build())
    w = cq.Workplane('XY').add(g)
    z0, h = -1.0, width + 2.0
    if hub:
        hd, hl = hub
        w = w.union(_cyl(hd / 2.0, -hl, hl + 0.01))
        z0, h = -hl - 1.0, width + hl + 2.0
    if bore and bore > 0:
        w = w.cut(_cyl(bore / 2.0, z0, h))
    return w


def bevel_pair(module, teeth_a, teeth_b, face, bore_a=0.0, bore_b=0.0, *, backlash=BACKLASH, pa=PA):
    """Two bevel gears meshing at 90 degrees, apex at the origin. Returns (gear_a, gear_b, info): gear A axis +Z (back
    face below the apex), gear B axis +X (back face on the -X side). info = {'a_back': z of A's back face, 'b_back': x of
    B's back face, 'pitch_angle_a', 'pitch_angle_b', 'pitch_d_a', 'pitch_d_b'}."""
    _check(teeth_a); _check(teeth_b)
    k = _bl(module, backlash, pa)
    pair = BevelGearPair(module, teeth_a, teeth_b, face, pressure_angle=pa, backlash=k)
    key = f'bevel|{module}|{teeth_a}|{teeth_b}|{face}|{k:.6f}|{pa}'
    ga = _cached(key + '|a', lambda: pair.gear.build())
    gb = _cached(key + '|b', lambda: pair.pinion.build())
    ha, hb = pair.gear.cone_h, pair.pinion.cone_h
    a = cq.Workplane('XY').add(ga)
    b = cq.Workplane('XY').add(gb)
    if bore_a and bore_a > 0:
        a = a.cut(_cyl(bore_a / 2.0, -1.0, ha + 2.0))
    if bore_b and bore_b > 0:
        b = b.cut(_cyl(bore_b / 2.0, -1.0, hb + 2.0))
    # cq_gears' own placement (BevelGearPair.assemble), then the apex moved to the origin
    if teeth_b % 2 == 0:
        b = b.rotate((0, 0, 0), (0, 0, 1), 180.0 / teeth_b)
    b = b.translate((0, 0, -hb)).rotate((0, 0, 0), (0, 1, 0), 90.0)
    a = a.translate((0, 0, -ha))
    return a, b, {'a_back': -float(ha), 'b_back': -float(hb), 'pitch_angle_a': math.degrees(pair.gear.gamma_p),
                  'pitch_angle_b': math.degrees(pair.pinion.gamma_p), 'pitch_d_a': module * teeth_a, 'pitch_d_b': module * teeth_b}


def rack(module, length, width, height, *, backlash=BACKLASH, pa=PA):
    """A straight rack along +X from x=0, teeth on top, pitch line at z = height (the gear's pitch circle touches it),
    y 0..width. Tooth centres at x = k * pi * module, gaps half way between: put the gear's axis over a gap
    (x = (k + 0.5) * pi * module) with one of its teeth pointing straight down at it."""
    below = height - 1.25 * module  # cq_gears' height is measured down from the tooth roots
    if below <= 0:
        raise ValueError(f'gears.rack: height must be more than {1.25 * module:g} mm (1.25 x module) for this module')
    k = _bl(module, backlash, pa)
    r = _cached(f'rack|{module}|{length}|{width}|{below}|{k:.6f}|{pa}',
                lambda: RackGear(module, length, width, below, pressure_angle=pa, backlash=k).build())
    # cq_gears: along +X, teeth toward +Y (pitch line y=0), width z 0..width -> teeth up (+Z), width along y 0..width
    return cq.Workplane('XY').add(r).rotate((0, 0, 0), (1, 0, 0), 90.0).translate((0, width, height))

"""cadlib.meshcheck + build.pieces_warning tests:  PYTHONPATH=<app> .venv/bin/python -m unittest cadlib.test_meshcheck"""
import time
import unittest

import cadquery as cq
import numpy as np

from cadlib import meshcheck as mc
from cadlib.build import pieces_warning


def tris(w, tol=0.05):
    v, f = (w.val() if isinstance(w, cq.Workplane) else w).tessellate(tol, 0.2)
    v = np.array([p.toTuple() for p in v])
    return v[np.array(f)]


def item(name, w):
    t = tris(w)
    lo, hi = mc.bbox(t)
    return name, t, lo, hi


class Interference(unittest.TestCase):
    def test_overlap_found_with_volume_and_place(self):
        a = item("A", cq.Workplane().box(40, 40, 20))
        b = item("B", cq.Workplane().box(10, 10, 10).translate((20, 0, 5)))  # 5 mm into A
        hits, st = mc.interference([a, b])
        self.assertEqual(st["checked"], 1)
        self.assertEqual(len(hits), 1)
        self.assertAlmostEqual(hits[0]["vol"], 500, delta=40)
        self.assertAlmostEqual(hits[0]["lo"][0], 15, delta=0.6)
        self.assertAlmostEqual(hits[0]["hi"][0], 20, delta=0.6)

    def test_touching_press_fit_and_allowed_are_quiet(self):
        a = item("A", cq.Workplane().box(40, 40, 20))
        c = item("C", cq.Workplane().box(10, 10, 10).translate((25, 0, 5)))  # face to face
        self.assertEqual(mc.interference([a, c])[0], [])
        hole = item("H", cq.Workplane().box(40, 40, 20).faces(">Z").workplane().hole(22))
        pin = item("P", cq.Workplane().circle(11.15).extrude(7).translate((0, 0, -3)))  # 0.15 mm press fit
        self.assertEqual(mc.interference([hole, pin])[0], [])
        b = item("B", cq.Workplane().box(10, 10, 10).translate((20, 0, 5)))
        self.assertEqual(mc.interference([a, b], {frozenset(("A", "B"))})[0], [])
        self.assertEqual(mc.interference([a, b], {"B"})[0], [])

    def test_two_bought_parts_are_not_checked(self):
        a = item("Board", cq.Workplane().box(40, 40, 20))
        b = item("Pins", cq.Workplane().box(10, 10, 10).translate((20, 0, 5)))
        hits, st = mc.interference([a, b], bought={"Board", "Pins"})
        self.assertEqual((hits, st["pairs"]), ([], 0))
        self.assertEqual(len(mc.interference([a, b], bought={"Pins"})[0]), 1)

    def test_two_shell_mesh_counts_as_solid(self):
        # a library part made of two overlapping closed shells (winding count, not parity)
        two = np.concatenate([tris(cq.Workplane().box(10, 10, 10)), tris(cq.Workplane().box(10, 10, 10).translate((4, 0, 0)))])
        lo, hi = mc.bbox(two)
        wall = item("W", cq.Workplane().box(4, 30, 30).translate((3, 0, 0)))
        hits, _ = mc.interference([("Lib", two, lo, hi), wall])
        self.assertEqual(len(hits), 1)
        self.assertAlmostEqual(hits[0]["vol"], 400, delta=40)

    def test_time_budget_reports_unchecked_pairs(self):
        its = [item(f"B{i}", cq.Workplane().box(10, 10, 10).translate((i * 2, 0, 0))) for i in range(4)]
        _, st = mc.interference(its, budget_s=0.0)
        self.assertEqual(st["checked"], 0)
        self.assertEqual(st["timed_out"], st["pairs"])
        self.assertGreater(st["pairs"], 0)


class Rays(unittest.TestCase):
    def test_inside_length(self):
        box = tris(cq.Workplane().box(40, 40, 20))
        self.assertAlmostEqual(mc.inside_length(box, (0, 0, 30), (0, 0, -1), 40), 20, delta=1e-6)
        self.assertAlmostEqual(mc.inside_length(box, (0, 0, 5), (0, 0, -1), 10), 10, delta=1e-6)  # starts inside
        hole = tris(cq.Workplane().box(40, 40, 20).faces(">Z").workplane().hole(3))
        self.assertEqual(mc.inside_length(hole, (0, 0, 30), (0, 0, -1), 40), 0)

    def test_screw_checks(self):
        base = tris(cq.Workplane().box(40, 40, 10).translate((0, 0, 5)).faces(">Z").workplane()
                    .pushPoints([(-10, 0)]).hole(2.5, 8))  # pilot only under the first screw
        roof = tris(cq.Workplane().box(10, 10, 3).translate((-10, 0, 40)))
        parts = [dict(name="Base", tris=base, made=True, blocks=True), dict(name="Roof", tris=roof, made=True, blocks=True)]
        s = dict(d=3, length=8, head_d=5.6, head_h=2.2, axis=(0, 0, 1))
        ok = dict(s, name="S1", label="S1", at=(-10, 0, 10))
        bad = dict(s, name="S2", label="S2", at=(10, 0, 10))
        air = dict(s, name="S3", label="S3", at=(100, 0, 10))
        flipped = dict(s, name="S4", label="S4", at=(-10, 0, 10), axis=(0, 0, -1))  # rot points the shank up, out
        w = mc.screw_checks([ok, bad, air, flipped], parts)
        self.assertTrue(any("S2" in x and "no hole in 'Base'" in x for x in w), w)
        self.assertTrue(any("S3" in x and "doesn't go into any part" in x for x in w), w)
        self.assertTrue(any("S4" in x and "doesn't go into any part" in x for x in w), w)
        self.assertFalse(any("S1" in x for x in w), w)  # the roof doesn't touch it: assumed to go on later
        # ASSEMBLY puts the roof in before the screw: now it's in the way
        w = mc.screw_checks([ok], parts, order={"Base": 0, "Roof": 0, "S1": 1})
        self.assertTrue(any("blocked by 'Roof'" in x for x in w), w)
        self.assertEqual(mc.screw_checks([ok], parts, order={"Base": 0, "S1": 1, "Roof": 2}), [])
        # a ledge of the part the screw goes into is always in the way
        ledge = tris(cq.Workplane().box(40, 40, 10).translate((0, 0, 5)).faces(">Z").workplane()
                     .pushPoints([(-10, 0)]).hole(2.5, 8).union(cq.Workplane().box(20, 20, 3).translate((-10, 0, 30)))
                     .union(cq.Workplane().box(3, 20, 25).translate((-18.5, 0, 17))))
        w = mc.screw_checks([ok], [dict(name="Base", tris=ledge, made=True, blocks=True)])
        self.assertTrue(any("blocked by 'Base'" in x for x in w), w)


class Walls(unittest.TestCase):
    def test_thin_shell_found_fast(self):
        t0 = time.time()
        thin, spots = mc.thin_walls(tris(cq.Workplane().box(50, 30, 20).faces(">Z").shell(-1.0)))
        self.assertLess(time.time() - t0, 2)
        self.assertAlmostEqual(thin, 1.0, delta=0.05)
        self.assertTrue(spots)

    def test_slanted_wall_measured_square(self):
        w = cq.Workplane().box(50, 30, 20).faces(">Z").shell(-1.0).rotate((0, 0, 0), (1, 1, 1), 40)
        self.assertAlmostEqual(mc.thin_walls(tris(w))[0], 1.0, delta=0.08)

    def test_thick_rounded_walls_and_thin_plates_are_quiet(self):
        w = cq.Workplane().box(50, 30, 20).faces(">Z").shell(-2.0).edges().fillet(0.8)
        self.assertEqual(mc.thin_walls(tris(w)), (None, []))
        plate = cq.Workplane().box(60, 60, 1.0)  # a 1 mm flat plate prints as 5 layers
        self.assertEqual(mc.thin_walls(tris(plate)), (None, []))
        stack = np.concatenate([tris(cq.Workplane().box(20, 20, 10)), tris(cq.Workplane().box(20, 20, 10).translate((20, 0, 0)))])
        self.assertEqual(mc.thin_walls(stack), (None, []))  # two touching solids: the shared face is no wall


class Pieces(unittest.TestCase):
    def test_pieces(self):
        one = cq.Workplane().box(10, 10, 10).union(cq.Workplane().box(4, 4, 4).translate((6, 0, 0)))
        self.assertIsNone(pieces_warning("A", one.val()))
        apart = cq.Workplane().box(10, 10, 10).union(cq.Workplane().box(4, 4, 4).translate((20, 0, 0)))
        w = pieces_warning("Body", apart.val())
        self.assertIn("'Body' is 2 separate pieces", w)
        self.assertIn("64 mm³ at x 20, y 0, z 0", w)
        self.assertIsNone(pieces_warning("Body", apart.val(), 2))
        sliver = cq.Workplane().box(10, 10, 10).union(cq.Workplane().box(0.5, 0.5, 0.5).translate((20, 0, 0)))
        self.assertIsNone(pieces_warning("A", sliver.val()))
        touching = cq.Compound.makeCompound([cq.Solid.makeBox(10, 10, 10), cq.Solid.makeBox(5, 5, 5, cq.Vector(10, 0, 0))])
        self.assertIsNone(pieces_warning("A", touching))


if __name__ == "__main__":
    unittest.main()

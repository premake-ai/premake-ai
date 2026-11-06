"""cadlib.shapes tests:  PYTHONPATH=<app> .venv/bin/python -m unittest cadlib.test_shapes"""
import contextlib
import io
import os
import signal
import unittest

import cadquery as cq

from cadlib import shapes


def vol(x):
    return (x.val() if isinstance(x, cq.Workplane) else x).Volume()


class SafeFillet(unittest.TestCase):
    def test_rounds_and_keeps_type(self):
        box = cq.Workplane("XY").box(20, 20, 20)
        out = shapes.safe_fillet(box, "|Z", 3)
        self.assertIsInstance(out, cq.Workplane)
        self.assertLess(vol(out), vol(box))
        self.assertTrue(out.val().isValid())
        s = shapes.safe_fillet(box.val(), None, 1)
        self.assertIsInstance(s, cq.Shape)
        self.assertLess(s.Volume(), 8000)

    def test_too_big_radius_falls_back_smaller(self):
        box = cq.Workplane("XY").box(20, 20, 2)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            out = shapes.safe_fillet(box, ">Z", 3)  # 3 > the 2 mm height fails; 1.5 works
        self.assertLess(vol(out), vol(box))
        self.assertIn("used r=1.5", buf.getvalue())

    def test_segfault_in_kernel_never_kills_the_build(self):
        box = cq.Workplane("XY").box(10, 10, 10)
        orig = shapes._fillet_once
        shapes._fillet_once = lambda *a, **k: os.kill(os.getpid(), signal.SIGSEGV)
        try:
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                out = shapes.safe_fillet(box, "|Z", 2)
        finally:
            shapes._fillet_once = orig
        self.assertIs(out, box)  # unrounded, same object
        self.assertIn("left the edges sharp", buf.getvalue())
        self.assertIn("crashed", buf.getvalue())

    def test_hang_times_out(self):
        box = cq.Workplane("XY").box(10, 10, 10)
        orig = shapes._fillet_once
        import time
        shapes._fillet_once = lambda *a, **k: time.sleep(30)
        try:
            with contextlib.redirect_stdout(io.StringIO()) as buf:
                out = shapes.safe_fillet(box, "|Z", 2, timeout=0.5, min_r=2)
        finally:
            shapes._fillet_once = orig
        self.assertIs(out, box)
        self.assertIn("longer than", buf.getvalue())


class Helpers(unittest.TestCase):
    def test_soft_box(self):
        b = shapes.soft_box(40, 30, 20, r=5)
        bb = b.val().BoundingBox()
        self.assertAlmostEqual(bb.zmin, 0, places=3)
        self.assertAlmostEqual(bb.xlen, 40, places=3)
        self.assertLess(vol(b), 40 * 30 * 20)
        self.assertTrue(b.val().isValid())

    def test_spout_is_a_tapered_solid_with_a_bore(self):
        s = shapes.spout(base=(0, 0, 0), tip=(100, 0, 30), base_r=15, tip_r=4, bore=3)
        self.assertTrue(s.val().isValid())
        solid = shapes.spout(base=(0, 0, 0), tip=(100, 0, 30), base_r=15, tip_r=4)
        self.assertLess(vol(s), vol(solid))
        bb = s.val().BoundingBox()
        self.assertGreater(bb.xlen, 95)

    def test_loop_handle_sweeps_an_open_loop(self):
        h = shapes.loop_handle(start=(40, 0, 60), end=(40, 0, 15), reach=40, w=12, t=9)
        self.assertTrue(h.val().isValid())
        bb = h.val().BoundingBox()
        self.assertGreater(bb.xmax, 75)  # reaches out
        self.assertGreater(vol(h), 1000)
        body = cq.Workplane("XY").circle(45).extrude(70)
        self.assertTrue(body.union(h).val().isValid())

    def test_recess_lid(self):
        body = cq.Workplane("XY").circle(50).extrude(60)
        body2, lid = shapes.recess_lid(body, 60, 80, depth=3, slot=(50, 8), screws=2)
        self.assertLess(vol(body2), vol(body))
        bb = lid.val().BoundingBox()
        self.assertAlmostEqual(bb.zmax, 60, places=3)
        self.assertLess(bb.xlen, 80)


if __name__ == "__main__":
    unittest.main()

"""motion() sampling tests:  PYTHONPATH=<app> .venv/bin/python -m unittest cadlib.test_motion"""
import json
import math
import os
import shutil
import tempfile
import unittest

import numpy as np

from cadlib import build, motion


def rows(*names):
    return [{"name": n, "raw_name": n, "slug": build.slugify(n)} for n in names]


def apply(entry, f, p):
    x, y, z, w = entry["quat"][f]
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    return R @ np.asarray(p, float) + np.asarray(entry["pos"][f])


class Sample(unittest.TestCase):
    def test_declarative_hinge_pivot(self):
        data, warns = motion.sample([{"part": "Lid", "type": "rotate", "axis": [1, 0, 0], "pivot": [0, 50, 20],
                                      "range": [0, 90]}], rows("Base", "Lid"))
        self.assertEqual(warns, [])
        self.assertEqual(list(data["parts"]), ["stl/lid.stl"])  # the base doesn't move
        lid = data["parts"]["stl/lid.stl"]
        half = data["frames"] // 2  # t = 0.5: fully open (90 deg)
        np.testing.assert_allclose(apply(lid, half, [0, 50, 20]), [0, 50, 20], atol=1e-3)  # pivot stays put
        np.testing.assert_allclose(apply(lid, half, [0, 0, 20]), [0, 50, -30], atol=1e-2)
        np.testing.assert_allclose(apply(lid, 0, [0, 0, 20]), [0, 0, 20], atol=1e-3)     # starts at the built pose

    def test_slide_spin_and_chain(self):
        tr = [{"part": ["Arm", "Hand"], "type": "spin", "axis": [0, 0, 1]},
              {"part": "Hand", "type": "slide", "axis": [2, 0, 0], "range": [0, 10]}]
        data, _ = motion.sample({"duration": 4, "frames": 40, "tracks": tr}, rows("Arm", "Hand"))
        self.assertEqual((data["duration"], data["frames"]), (4.0, 40))
        hand = data["parts"]["stl/hand.stl"]
        # t = 0.25: slide out 5 mm along X (inner), then the spin turns it 90 deg about Z (outer)
        np.testing.assert_allclose(apply(hand, 10, [0, 0, 0]), [0, 5, 0], atol=1e-3)

    def test_pose_link_and_ids(self):
        r = rows("Rod", "Slider", "Slider")
        r[2]["slug"] = "slider-b"

        def pose(t):
            x = 10 * math.sin(2 * math.pi * t)
            return {"Rod": motion.link((0, 0, 0), (0, 0, 100), (x, 0, 0), (0, 0, math.sqrt(100 ** 2 - x * x))),
                    "slider-b": motion.move((x, 0, 0)), "nope": motion.move((1, 0, 0))}
        data, warns = motion.sample(pose, r)
        self.assertIn("stl/slider-b.stl", data["parts"])
        self.assertNotIn("stl/slider.stl", data["parts"])
        self.assertTrue(any("nope" in w for w in warns))
        rod = data["parts"]["stl/rod.stl"]
        for f in range(0, data["frames"], 7):
            a, b = apply(rod, f, (0, 0, 0)), apply(rod, f, (0, 0, 100))
            self.assertAlmostEqual(float(np.linalg.norm(b - a)), 100, places=2)  # rigid
            self.assertAlmostEqual(float(b[0]), 0, places=2)

    def test_transform_forms_agree(self):
        m1 = motion.to_matrix({"rotate": [0, 0, 1], "deg": 90, "pivot": [1, 0, 0], "translate": [0, 0, 5]})
        m2 = motion.to_matrix(motion.then(motion.rot([0, 0, 1], 90, [1, 0, 0]), motion.move([0, 0, 5])))
        s = math.sqrt(0.5)
        m3 = motion.to_matrix({"quat": [0, 0, s, s], "pivot": [1, 0, 0], "translate": [0, 0, 5]})
        np.testing.assert_allclose(m1, m2, atol=1e-9)
        np.testing.assert_allclose(m1, m3, atol=1e-9)
        with self.assertRaises(motion.MotionError):
            motion.to_matrix({"spin": 1})

    def test_nothing_moves(self):
        data, warns = motion.sample(lambda t: {}, rows("A"))
        self.assertIsNone(data)
        self.assertTrue(warns)


class Build(unittest.TestCase):
    def test_build_writes_motion_and_cleans_it_up(self):
        d = tempfile.mkdtemp()
        try:
            src = ('import cadquery as cq\n'
                   'def parts():\n'
                   '    return [{"name": "Base", "shape": cq.Workplane().box(40, 40, 5)},\n'
                   '            {"name": "Lid", "id": "lid-a", "shape": cq.Workplane().box(40, 40, 3).translate((0, 0, 6))}]\n'
                   'def motion():\n'
                   '    return [{"part": "lid-a", "type": "rotate", "axis": [1, 0, 0], "pivot": [0, 20, 5], "range": [0, 80]}]\n')
            with open(os.path.join(d, "design.py"), "w") as f:
                f.write(src)
            self.assertEqual(build.main([d, "--no-thumb"]), 0)
            man = json.load(open(os.path.join(d, "manifest.json")))
            self.assertEqual(man["motion"]["file"], "motion.json")
            mo = json.load(open(os.path.join(d, "motion.json")))
            self.assertEqual(list(mo["parts"]), ["stl/lid-a.stl"])
            # a broken motion() still builds, with a warning and no motion
            with open(os.path.join(d, "design.py"), "w") as f:
                f.write(src.replace('"range": [0, 80]', '"range": 5'))
            self.assertEqual(build.main([d, "--no-thumb"]), 0)
            self.assertNotIn("motion", json.load(open(os.path.join(d, "manifest.json"))))
            self.assertFalse(os.path.exists(os.path.join(d, "motion.json")))
            self.assertIn("motion() failed", open(os.path.join(d, "build_log.txt")).read())
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()

"""cadlib.views tests:  PYTHONPATH=<app> .venv/bin/python -m unittest cadlib.test_views"""
import json
import os
import shutil
import tempfile
import time
import unittest

import cadquery as cq
import numpy as np
from PIL import Image

from cadlib import views


class Views(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.d, "stl"))
        box = cq.Workplane("XY").box(100, 40, 20).translate((0, 0, 10))
        cyl = cq.Workplane("XY").circle(10).extrude(30).translate((0, 0, 20))
        for n, s in (("box", box), ("cyl", cyl)):
            cq.exporters.export(s, os.path.join(self.d, "stl", n + ".stl"), exportType="STL")
        with open(os.path.join(self.d, "manifest.json"), "w") as f:
            json.dump({"parts": [{"file": "stl/box.stl", "color": "#3366cc"}, {"file": "stl/cyl.stl", "color": "#cc3333"},
                                 {"file": "../escape.stl"}]}, f)

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def test_renders_four_views_and_a_sheet_quickly(self):
        t0 = time.time()
        out, dims = views.render_design(self.d)
        self.assertLess(time.time() - t0, 5)
        for v in ("iso", "front", "side", "top", "sheet"):
            self.assertTrue(os.path.isfile(os.path.join(out, v + ".png")), v)
        with Image.open(os.path.join(out, "sheet.png")) as im:
            self.assertEqual(im.size, (1024, 1024))
        self.assertAlmostEqual(float(dims[0]), 100, delta=0.5)
        self.assertAlmostEqual(float(dims[2]), 50, delta=0.5)

    def test_front_view_silhouette_matches_proportions(self):
        views.render_design(self.d)
        a = np.asarray(Image.open(os.path.join(self.d, "views", "front.png")).convert("RGB")).astype(int)
        model = np.abs(a - views.BG[None, None]).sum(-1) > 30
        ys, xs = np.nonzero(model)
        w, h = xs.max() - xs.min(), ys.max() - ys.min()
        self.assertAlmostEqual(w / h, 100 / 50, delta=0.15)  # box 100 wide, box + cylinder 50 tall
        red = (a[..., 0] > a[..., 2] + 30)
        self.assertGreater(red.sum(), 200)  # the cylinder keeps its colour
        blue = (a[..., 2] > a[..., 0] + 30)
        self.assertGreater(blue.sum(), red.sum())

    def test_compare_png_photo_left_model_right(self):
        items = views.load_items(self.d)
        out = os.path.join(self.d, "views")
        os.makedirs(out, exist_ok=True)
        self.assertIsNone(views.photo_compare(self.d, items, out))  # no uploads: no compare.png
        os.makedirs(os.path.join(self.d, "uploads"))
        Image.new("RGB", (300, 200), (200, 30, 30)).save(os.path.join(self.d, "uploads", "p.jpg"))
        with open(os.path.join(self.d, "uploads", "notes.txt"), "w") as f:
            f.write("not a photo")
        path, angle = views.photo_compare(self.d, items, out)
        self.assertIn("iso", angle)
        with Image.open(path) as im:
            self.assertEqual(im.height, views.COMPARE_H)
            a = np.asarray(im.convert("RGB")).astype(int)
        self.assertGreater(a[300, 400, 0], 150)  # the photo (red), scaled to 512 high = 768 wide
        self.assertLess(a[300, 400, 1], 80)
        self.assertGreater(im.width, 768 + 100)  # the model is to its right
        with open(os.path.join(out, "photo_view.json"), "w") as f:
            json.dump({"azimuth": 0, "elevation": 0}, f)
        _, angle = views.photo_compare(self.d, items, out)
        self.assertIn("azimuth 0, elevation 0", angle)

    def test_view_dir_default_is_iso(self):
        d, _ = views.view_dir()
        iso = np.array(views.VIEWS["iso"][0]) / np.linalg.norm(views.VIEWS["iso"][0])
        self.assertGreater(float(np.dot(d, iso)), 0.999)

    def test_wall_check_on_printed_parts(self):
        thin = cq.Workplane("XY").box(40, 30, 20).faces(">Z").shell(-0.8)
        cq.exporters.export(thin, os.path.join(self.d, "stl", "thin.stl"), exportType="STL")
        with open(os.path.join(self.d, "manifest.json"), "w") as f:
            json.dump({"parts": [{"file": "stl/box.stl", "name": "Box", "process": "print"},
                                 {"file": "stl/thin.stl", "name": "Cup", "process": "print"}]}, f)
        warns, n = views.wall_check(self.d)
        self.assertEqual(n, 2)
        self.assertEqual(len(warns), 1)
        self.assertIn("'Cup' has walls thinner than 1.2 mm", warns[0])

    def test_ascii_stl(self):
        p = os.path.join(self.d, "a.stl")
        with open(p, "w") as f:
            f.write("solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid x\n")
        self.assertEqual(views.read_stl(p).shape, (1, 3, 3))


if __name__ == "__main__":
    unittest.main()

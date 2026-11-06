"""Materials / engraving / cable tests:  PYTHONPATH=<app> .venv/bin/python -m unittest cadlib.test_look"""
import json
import os
import shutil
import tempfile
import textwrap
import unittest

import cadquery as cq

from cadlib import build, look


class Normalise(unittest.TestCase):
    def test_material(self):
        self.assertEqual(look.norm_material("Acrylic"), "acrylic_clear")
        self.assertEqual(look.norm_material("aluminum"), "aluminium")
        self.assertEqual(look.norm_material("PETG"), "petg")
        self.assertIsNone(look.norm_material("unobtainium"))
        self.assertEqual(look.infer_material("laser", {"material": "acrylic"}), "acrylic_clear")
        self.assertEqual(look.infer_material("laser", {"material": "birch plywood"}), "plywood")
        self.assertEqual(look.infer_material("extrusion", {}), "aluminium")
        self.assertIsNone(look.infer_material("print", {}))

    def test_cable(self):
        c = look.norm_cable({"type": "USB", "at": [1, 2, 3], "dir": [0, 0, 2], "length_mm": 5})
        self.assertEqual(c["type"], "usb-c")
        self.assertEqual(c["dir"], [0, 0, 1.0])
        self.assertEqual(c["length_mm"], 80.0)  # clamped
        self.assertIsNone(look.norm_cable({"type": "usb-c"}))  # no position
        self.assertIsNone(look.norm_cable({"at": [0, 0, 0], "dir": [0, 0, 0]}))

    def test_engrave(self):
        self.assertEqual(look.norm_engrave(True), {"mode": "engrave"})
        e = look.norm_engrave({"text": "HI", "face": "<y", "depth": 0.6, "mode": "nope", "style": "lit"})
        self.assertEqual(e, {"text": "HI", "face": "<Y", "depth_mm": 0.6, "mode": "engrave", "style": "lit"})


class EngraveText(unittest.TestCase):
    def panel(self):
        return cq.Workplane("XZ").rect(200, 100).extrude(3, both=True)  # 200 x 6 x 100, faces at y = +-3

    def test_engrave_cuts_front_face(self):
        p = self.panel()
        out, meta = look.engrave_text(p, "JOSH", face="<Y", depth=1.0)
        v0, v1 = p.val().Volume(), out.val().Volume()
        self.assertLess(v1, v0 - 1)
        self.assertEqual(meta["face"], "<Y")
        bb = out.val().BoundingBox()
        self.assertAlmostEqual(bb.ymin, -3, 3)  # nothing sticks out
        self.assertEqual(len(out.solids().vals()), 1)
        self.assertTrue(meta["size_mm"] > 5)

    def test_emboss_and_fit(self):
        p = self.panel()
        out, meta = look.engrave_text(p, "A LONG NAME HERE", face=">Y", depth=0.8, mode="emboss")
        bb = out.val().BoundingBox()
        self.assertAlmostEqual(bb.ymax, 3.8, 1)
        self.assertGreater(out.val().Volume(), p.val().Volume())
        self.assertLessEqual(bb.xlen, 200.01)  # fitted to the face

    def test_upright_on_side_face(self):
        plane, _ = look._face_plane(self.panel().val(), "<Y")
        self.assertAlmostEqual(plane.yDir.z, 1.0)    # text upright
        self.assertAlmostEqual(plane.xDir.x, 1.0)    # reads left to right seen from the front (-Y)
        plane, _ = look._face_plane(self.panel().val(), ">Y")
        self.assertAlmostEqual(plane.xDir.x, -1.0)   # seen from the back

    def test_miss_raises(self):
        with self.assertRaises(ValueError):
            look.engrave_text(self.panel(), "X", face="<Y", offset=(500, 0))


class BuildManifest(unittest.TestCase):
    def test_fields_reach_manifest(self):
        d = tempfile.mkdtemp()
        try:
            with open(os.path.join(d, "design.py"), "w") as f:
                f.write(textwrap.dedent('''
                    import cadquery as cq
                    from cadlib.look import engrave_text
                    CABLES = [{"type": "dc-barrel", "at": [0, 0, 5], "dir": [1, 0, 0]}]
                    def parts():
                        panel, eng = engrave_text(cq.Workplane("XZ").rect(100, 60).extrude(3, both=True), "HI", face="<Y")
                        return [
                            {"name": "Panel", "shape": panel, "process": "laser", "params": {"material": "acrylic", "thickness_mm": 6},
                             "engrave": eng},
                            {"name": "Rail", "shape": cq.Workplane().box(200, 20, 20), "process": "extrusion"},
                            {"name": "Box", "shape": cq.Workplane().box(20, 20, 20).translate((0, 0, 30)), "material": "PETG",
                             "cable": {"type": "usb-c", "at": [10, 0, 30], "dir": [1, 0, 0], "length_mm": 300}},
                            {"name": "Foot", "shape": cq.Workplane().box(5, 5, 5), "group": "component", "material": "nope"},
                        ]
                '''))
            build.build(d, thumb=False)
            with open(os.path.join(d, "manifest.json")) as f:
                m = json.load(f)
            by = {p["name"]: p for p in m["parts"]}
            self.assertEqual(by["Panel"]["material"], "acrylic_clear")
            self.assertEqual(by["Panel"]["engrave"]["text"], "HI")
            self.assertEqual(by["Rail"]["material"], "aluminium")
            self.assertEqual(by["Box"]["material"], "petg")
            self.assertEqual(by["Box"]["cable"]["type"], "usb-c")
            self.assertNotIn("material", by["Foot"])
            self.assertEqual(m["cables"][0]["type"], "dc-barrel")
            with open(os.path.join(d, "bom.json")) as f:
                bom = json.load(f)
            names = [p.get("name") for p in bom.get("parts", [])]
            self.assertFalse(any("cable" in str(n).lower() for n in names))  # decoration: never a bought line
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()

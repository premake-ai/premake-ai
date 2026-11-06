"""Parts library tests:  PYTHONPATH=<app> .venv/bin/python -m unittest cadlib.parts.test_parts"""
import os
import tempfile
import unittest

from cadlib import parts


class Resolve(unittest.TestCase):
    def test_aliases_and_screws(self):
        self.assertEqual(parts.resolve("nema17_40", {}), ("nema17", {"length": 40}))
        k, p = parts.resolve("m3x12_shcs", {})
        self.assertEqual((k, p["d"], p["length"]), ("shcs", 3, 12))
        k, p = parts.resolve("m25x8_bhcs", {})
        self.assertEqual((k, p["d"]), ("bhcs", 2.5))

    def test_selftap(self):
        k, p = parts.resolve("m3x12_selftap", {})
        self.assertEqual((k, p["d"], p["length"], p["head"]), ("selftap", 3, 12, "pan"))
        self.assertEqual(parts.resolve("m35x16_selftap", {})[1]["d"], 3.5)
        from cadlib import fab
        self.assertEqual(fab.pilot(3), 2.5)
        boss, hole = fab.screw_boss(3, 10)
        self.assertGreaterEqual(boss.val().BoundingBox().xlen, 7.4)

    def test_bad_input(self):
        with self.assertRaises(KeyError):
            parts.resolve("flux_capacitor", {})
        with self.assertRaises(ValueError):
            parts.resolve("nema17", {"length": 41})
        with self.assertRaises(ValueError):
            parts.resolve("shcs", {"colour": "red"})


class Place(unittest.TestCase):
    def test_part_qty_bom_and_transform(self):
        p = parts.part("m3x10_shcs", at=[(0, 0, 0), (10, 0, 0)], rot=(180, 0, 0))
        self.assertEqual(p["lib"]["qty"], 2)
        self.assertEqual(p["group"], "component")
        self.assertTrue(p["name"].endswith("×2"))
        self.assertIn("amazon.com/s?k=", p["lib"]["bom"]["url"])
        lo, hi = p["shape"].bounds
        self.assertAlmostEqual(hi[2], 10.0, places=1)  # flipped: shank now points up to z=10
        self.assertTrue(all(s["finish"] in parts.FINISHES for s in p["subparts"]))

    def test_port_follows_the_board(self):
        flat = parts.part("esp32_devkitc", at=(10, 20, 30))["port"]
        self.assertEqual(flat["dir"], [-1.0, 0.0, 0.0])
        self.assertAlmostEqual(flat["at"][0], 10 - 28.2, places=1)  # micro-USB mouth, 1 mm past the PCB edge
        self.assertEqual([abs(x) for x in flat["wide"]], [0.0, 1.0, 0.0])
        edge = parts.part("esp32_devkitc", at=(10, 20, 30), rot=(-90, 0, 0))["port"]  # on edge: plug rolled 90 deg
        self.assertEqual([abs(x) for x in edge["wide"]], [0.0, 0.0, 1.0])
        self.assertAlmostEqual(edge["at"][1], 22.9, places=1)
        turned = parts.part("esp32_c3_supermini", at=(0, 0, 0), rot=(0, 0, 90))["port"]
        self.assertAlmostEqual(turned["dir"][1], -1.0, places=3)
        self.assertNotIn("port", parts.part("m3x10_shcs"))

    def test_extrusion_is_fabricated(self):
        p = parts.part("extrusion_2020", length=150)
        self.assertEqual(p["process"], "extrusion")
        self.assertEqual(p["params"], {"profile": "2020", "length_mm": 150.0})
        self.assertIsNone(p["lib"]["bom"])

    def test_fab_placeholder_maps_only_when_untouched(self):
        import cadquery as cq
        from cadlib import fab
        moved = fab.nema17(40).rotate((0, 0, 0), (0, 0, 1), 30).translate((5, 6, 7))
        subs = parts.tagged_subparts(moved)
        self.assertTrue(subs)
        lo, hi = subs[0]["mesh"].bounds
        self.assertLess(abs((lo[2] + hi[2]) / 2 - (7 - 20)), 15)
        self.assertIsNone(parts.tagged_subparts(moved.union(cq.Workplane().box(10, 10, 10).translate((30, 6, 0)))))
        self.assertIsNone(parts.tagged_subparts(fab.led_strip(100), "COB strip"))

    def test_lazy_build_into_writable_root(self):
        with tempfile.TemporaryDirectory() as d:
            meta = parts.build_entry("washer", {"d": 3, "material": "zinc"}, root=d)
            self.assertTrue(os.path.isfile(os.path.join(d, meta["id"], "meta.json")))
            self.assertGreater(meta["mass_g"], 0)


if __name__ == "__main__":
    unittest.main()

"""Per-part "fx" (viewer power effects) cleaning and pass-through to the manifest."""
import json
import os
import shutil
import tempfile
import unittest

from cadlib import build


class CleanFx(unittest.TestCase):
    def test_absent_and_bad(self):
        self.assertIsNone(build.clean_fx(None))
        self.assertIsNone(build.clean_fx("glow"))
        self.assertEqual(build.clean_fx({}), {})  # explicit "no effects" is kept

    def test_shapes(self):
        fx = build.clean_fx({"glow": {"color": "#FF8800", "mode": "pulse"}, "screen": {"text": "21.4°C", "bg": "#000000", "fg": "nope", "face": "+y"},
                             "spin": {"axis": [0, 0, 1], "rpm": "600", "center": [1, 2, "x"]}, "sparkle": 1})
        self.assertEqual(fx["glow"], {"color": "#ff8800", "mode": "pulse"})
        self.assertEqual(fx["screen"], {"text": "21.4°C", "bg": "#000000", "face": "+y"})
        self.assertEqual(fx["spin"], {"axis": [0.0, 0.0, 1.0], "rpm": 600.0})
        self.assertNotIn("sparkle", fx)
        self.assertEqual(build.clean_fx({"glow": True, "spin": True}), {"glow": {}, "spin": {}})
        self.assertEqual(build.clean_fx({"glow": {"color": "rainbow", "mode": "disco"}}), {"glow": {"color": "rainbow"}})

    def test_build_passes_fx_to_manifest(self):
        d = tempfile.mkdtemp()
        try:
            src = ('import cadquery as cq\n'
                   'def parts():\n'
                   '    return [{"name": "Base", "shape": cq.Workplane().box(40, 40, 5)},\n'
                   '            {"name": "LED bar", "group": "component", "fx": {"glow": {"color": "rainbow"}},\n'
                   '             "shape": cq.Workplane().box(30, 4, 2).translate((0, 0, 4))}]\n')
            with open(os.path.join(d, "design.py"), "w") as f:
                f.write(src)
            self.assertEqual(build.main([d, "--no-thumb"]), 0)
            parts = {p["name"]: p for p in json.load(open(os.path.join(d, "manifest.json")))["parts"]}
            self.assertEqual(parts["LED bar"]["fx"], {"glow": {"color": "rainbow"}})
            self.assertNotIn("fx", parts["Base"])
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()

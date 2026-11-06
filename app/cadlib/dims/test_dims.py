"""Dimension library tests:  PYTHONPATH=<app> .venv/bin/python -m unittest cadlib.dims.test_dims"""
import datetime
import numbers
import re
import unittest

from cadlib import dims

UNIT = re.compile(r"_(mm|g|ml|deg|in|cfm|m3h|tpi|count|kg|l|oz|w|v)$")


def _numbers(v):
    """Every number in a dims value (a number, or a list of numbers / [x, y] pairs); None if anything else is in it."""
    if isinstance(v, bool):
        return None
    if isinstance(v, numbers.Real):
        return [v]
    if isinstance(v, list) and v:
        out = []
        for x in v:
            n = _numbers(x)
            if n is None:
                return None
            out += n
        return out
    return None


class Entries(unittest.TestCase):
    def test_every_entry_has_numbers_source_and_date(self):
        lib = dims.load()
        self.assertGreaterEqual(len(lib), 60)
        for k, e in lib.items():
            with self.subTest(key=k):
                self.assertRegex(k, r"^[a-z0-9_]+$")
                for f in ("name", "category", "source", "checked", "confidence"):
                    self.assertTrue(isinstance(e.get(f), str) and e[f].strip(), f"{k}: missing {f}")
                self.assertRegex(e["source"], r"^https?://\S+\.\S+")
                for s in e.get("sources", []):
                    self.assertRegex(s, r"^https?://\S+\.\S+")
                d = datetime.date.fromisoformat(e["checked"])
                self.assertLessEqual(d, datetime.date.today())
                self.assertIn(e["confidence"], dims.CONFIDENCE)
                self.assertTrue(isinstance(e.get("dims"), dict) and e["dims"], f"{k}: no dims")
                for name, v in e["dims"].items():
                    self.assertRegex(name, UNIT, f"{k}.{name}: needs a unit suffix")
                    nums = _numbers(v)
                    self.assertIsNotNone(nums, f"{k}.{name}: not a number")
                    self.assertTrue(all(x >= 0 for x in nums), f"{k}.{name}: negative")
                    self.assertNotIn(name, dims.META, f"{k}.{name}: clashes with an entry field")

    def test_categories_cover_the_brief(self):
        cats = set(dims.categories())
        for c in ("phones", "consoles", "audio", "containers", "bike", "camera", "motors", "fans", "filters", "home",
                  "sheet", "electronics"):
            self.assertIn(c, cats)

    def test_parts_keys_exist_in_the_parts_library(self):
        from cadlib.parts import catalog
        for k, e in dims.load().items():
            if "parts_key" in e:
                with self.subTest(key=k):
                    catalog.resolve(e["parts_key"], {})  # KeyError if cadlib.parts doesn't have it


class Api(unittest.TestCase):
    def test_dim_flat_dict_and_usage_log(self):
        dims.reset_used()
        k = dims.keys()[0]
        d = dims.dim(k)
        self.assertEqual(d["key"], k)
        self.assertIn("source", d)
        self.assertTrue(any(isinstance(v, (int, float)) for v in d.values()))
        self.assertEqual(list(dims.USED), [k])
        self.assertTrue(dims.used_report()[0].startswith(k + ": "))
        d["source"] = "changed"  # callers get a copy
        self.assertNotEqual(dims.dim(k)["source"], "changed")

    def test_lookup_is_forgiving_and_unknown_keys_explain(self):
        k = dims.keys()[0]
        self.assertEqual(dims.dim(k.upper().replace("_", "-"))["key"], k)
        with self.assertRaises(KeyError) as cm:
            dims.dim("flux_capacitor_mk2")
        self.assertIn("flux_capacitor_mk2", str(cm.exception))

    def test_search_and_index(self):
        self.assertTrue(dims.search("iphone"))
        self.assertEqual(len(dims.index()), len(dims.categories()))


class Shop(unittest.TestCase):
    def test_sheet_slots_use_real_stock(self):
        from cadlib import fab
        self.assertLess(fab.sheet_actual("birch plywood", 6), 6.0)
        self.assertAlmostEqual(fab.slot_width("plywood", 6), fab.sheet_actual("plywood", 6) - 0.1)
        self.assertGreater(fab.slot_width("acrylic", 3, fit="slip"), fab.sheet_actual("acrylic", 3))
        with self.assertRaises(ValueError):
            fab.sheet_actual("plywood", 4)

    def test_parts_library_agrees_with_dims(self):
        from cadlib.parts import models
        import inspect
        src = inspect.getsource(models.arduino_nano)
        self.assertIn(f"L, Wd = 43.2, {dims.dim('arduino_nano')['width_mm']:.1f}", src)
        self.assertIn(f"S = {dims.dim('nema17')['face_mm']:g}", inspect.getsource(models.nema17))


if __name__ == "__main__":
    unittest.main()

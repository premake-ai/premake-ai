"""PYTHONPATH=. .venv/bin/python -m unittest cadlib.test_sections   (a part's optional "section" in the manifest)"""
import unittest

from cadlib.build import clean_section, manifest_part


class SectionTest(unittest.TestCase):
    def test_clean(self):
        self.assertEqual(clean_section("  y   axis "), "Y axis")
        self.assertEqual(clean_section("Electronics"), "Electronics")
        self.assertIsNone(clean_section(""))
        self.assertIsNone(clean_section("   "))
        self.assertIsNone(clean_section(3))
        self.assertIsNone(clean_section(None))
        self.assertEqual(len(clean_section("x" * 99)), 40)

    def test_manifest(self):
        r = dict(slug="y-rod", name="Y rod", group="component", process="bought", color="#999999", explode=None, bbox=[1, 2, 3])
        self.assertNotIn("section", manifest_part(r))
        self.assertEqual(manifest_part(dict(r, section="Y axis"))["section"], "Y axis")


if __name__ == "__main__":
    unittest.main()

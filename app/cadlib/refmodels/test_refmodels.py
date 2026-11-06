"""Reference-model library tests:  PYTHONPATH=<app> .venv/bin/python -m unittest cadlib.refmodels.test_refmodels

Fails when a model has no license.json, a licence outside the allowlist, a missing attribution field, a GLB that is
too big, or a size more than 1 mm off its published cadlib.dims number; and checks ref() and the build integration.
"""
import json
import os
import re
import shutil
import tempfile
import unittest

from cadlib import refmodels as rm
from cadlib.refmodels.library import SPECS

FIELDS = ("key", "title", "source_url", "author", "license", "license_url", "retrieved", "modified", "attribution_text",
          "allowed_use")
MAX_GLB = 1_100_000
BANNED = re.compile(r"\bNC\b|non-?commercial|all rights reserved|grabcad|editorial|ip restricted|unknown|unclear", re.I)


def validate_license(lj, key):
    """List of problems with one license.json (empty = fine)."""
    bad = [f"{key}: missing {f}" for f in FIELDS if not isinstance(lj.get(f), str) or (f not in ("source_url", "license_url") and not lj[f].strip())]
    if lj.get("key") != key:
        bad.append(f"{key}: license.json key is {lj.get('key')!r}")
    if lj.get("license") not in rm.ALLOWED_LICENSES:
        bad.append(f"{key}: licence {lj.get('license')!r} is not on the allowlist")
    if BANNED.search(str(lj.get("license", ""))):
        bad.append(f"{key}: licence {lj.get('license')!r} is excluded")
    if lj.get("allowed_use") != "display-only":
        bad.append(f"{key}: allowed_use must be 'display-only'")
    if lj.get("license") != "Premake-original":
        for f in ("source_url", "license_url", "author"):
            if not str(lj.get(f, "")).startswith("http") and f != "author":
                bad.append(f"{key}: third-party model needs {f}")
        if not lj.get("source_sha256"):
            bad.append(f"{key}: third-party model needs source_sha256 (the vetted file it was converted from)")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(lj.get("retrieved", ""))):
        bad.append(f"{key}: retrieved must be YYYY-MM-DD")
    return bad


class Library(unittest.TestCase):
    def folders(self):
        return sorted(d for d in os.listdir(rm.WEB_LIB) if os.path.isdir(os.path.join(rm.WEB_LIB, d)))

    def test_every_model_has_an_allowlisted_license(self):
        problems = []
        for k in self.folders():
            d = os.path.join(rm.WEB_LIB, k)
            lic = os.path.join(d, "license.json")
            if not os.path.isfile(lic):
                problems.append(f"{k}: no license.json")
                continue
            with open(lic) as f:
                problems += validate_license(json.load(f), k)
            if not os.path.isfile(os.path.join(d, "model.glb")):
                problems.append(f"{k}: no model.glb")
            extra = set(os.listdir(d)) - {"model.glb", "license.json"}
            if extra:
                problems.append(f"{k}: unexpected files {sorted(extra)} (only model.glb + license.json are served)")
        self.assertEqual(problems, [])

    def test_validator_rejects_excluded_licenses(self):
        base = dict(key="x", title="X", source_url="https://example.com/x.step", author="A", license_url="https://e.com",
                    retrieved="2026-10-30", modified="converted", attribution_text="X by A", allowed_use="display-only",
                    source_sha256="0" * 64)
        for lic in ("CC-BY-NC-4.0", "CC-BY-NC-SA-4.0", "All rights reserved", "GrabCAD", "", "MIT", "Editorial"):
            self.assertTrue(validate_license(dict(base, license=lic), "x"), lic)
        self.assertEqual(validate_license(dict(base, license="CC-BY-4.0"), "x"), [])
        self.assertTrue(validate_license(dict(base, license="CC-BY-4.0", allowed_use="anything"), "x"))

    def test_models_are_small(self):
        for k in self.folders():
            n = os.path.getsize(os.path.join(rm.WEB_LIB, k, "model.glb"))
            self.assertLess(n, MAX_GLB, f"{k}: {n} bytes (decimate it)")

    def test_specs_index_and_catalog_agree(self):
        with open(os.path.join(rm.WEB_LIB, "index.json")) as f:
            idx = {m["key"]: m for m in json.load(f)["models"]}
        keys = [s["key"] for s in SPECS]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual(sorted(idx), sorted(keys))
        self.assertEqual(sorted(rm.catalog()), sorted(keys))
        self.assertEqual(sorted(self.folders()), sorted(keys))
        for k, m in idx.items():
            self.assertEqual(m["file"], f"refmodels/{k}/model.glb")
            self.assertEqual(rm.catalog()[k]["size"], m["size"])
            self.assertIn(m["front"], ("-y", "+z"))
            self.assertTrue(m["match"], f"{k}: needs name patterns")
            for r in m["match"] + (m["prefer"] or []):
                re.compile(r)
            self.assertTrue(m["credit"].startswith("Model: "))
            with open(os.path.join(rm.WEB_LIB, k, "license.json")) as f:
                self.assertEqual(json.load(f)["license"], m["license"])

    def test_sizes_match_published_dims(self):
        with open(os.path.join(rm.HERE, "dims_check.json")) as f:
            checks = json.load(f)
        bad = [f"{k}: {c['dims']}.{c['field']} {c['published_mm']} vs model {c['model_mm']}"
               for k, cs in checks.items() for c in cs if abs(c["diff_mm"]) > 1.0]
        self.assertEqual(bad, [])
        self.assertIn("switch_oled", checks)
        self.assertIn("joycon_l", checks)


class Ref(unittest.TestCase):
    def test_ref_is_a_display_only_box_of_real_size(self):
        p = rm.ref("switch_oled", at=(10, -20, 5))
        self.assertEqual(p["process"], "bought")
        self.assertEqual(p["group"], "component")
        self.assertTrue(p["name"].endswith("(yours)"))
        self.assertNotIn("lib", p)  # the customer's own: no BOM line, price 0
        bb = p["shape"].val().BoundingBox()
        sx, sy, sz = rm.catalog()["switch_oled"]["size"]
        self.assertAlmostEqual(bb.xlen, sx, 3)
        self.assertAlmostEqual(bb.zlen, sz, 3)
        self.assertAlmostEqual(bb.zmin, 5, 3)  # bottom on z=0 before `at`
        m = p["ref_model"]["m"]
        self.assertEqual(p["ref_model"]["key"], "switch_oled")
        self.assertAlmostEqual(m[2][3], 5 + sz / 2, 6)  # model centre
        self.assertAlmostEqual(m[0][3], 10, 6)

    def test_ref_rotation_matches_the_box(self):
        p = rm.ref("joycon_l", rot=(0, 0, 90))
        bb = p["shape"].val().BoundingBox()
        sx, sy, sz = rm.catalog()["joycon_l"]["size"]
        self.assertAlmostEqual(bb.xlen, sy, 3)
        self.assertAlmostEqual(bb.ylen, sx, 3)
        m = p["ref_model"]["m"]
        self.assertAlmostEqual(m[1][0], 1.0, 6)  # model X -> world Y

    def test_bought_part_with_price_gets_a_bom_line(self):
        p = rm.ref("fan_120", yours=False, price=9.5)
        self.assertEqual(p["lib"]["bom"]["unit_cost_usd"], 9.5)
        self.assertFalse(p["name"].endswith("(yours)"))

    def test_unknown_key_suggests(self):
        with self.assertRaises(KeyError) as e:
            rm.ref("switch_oledd")
        self.assertIn("switch_oled", str(e.exception))

    def test_build_writes_ref_model_and_no_bom_line(self):
        from cadlib import build
        d = tempfile.mkdtemp(prefix="refbuild-")
        try:
            with open(os.path.join(d, "design.py"), "w") as f:
                f.write("import cadquery as cq\nfrom cadlib.refmodels import ref\n"
                        "def parts():\n    return [{'name': 'Stand', 'shape': cq.Workplane('XY').box(200, 40, 4)},\n"
                        "            ref('switch_oled', at=(0, 0, 4))]\n")
            build.build(d, thumb=False)
            with open(os.path.join(d, "manifest.json")) as f:
                man = json.load(f)
            with open(os.path.join(d, "bom.json")) as f:
                bom = json.load(f)
            sw = [p for p in man["parts"] if p.get("ref_model")]
            self.assertEqual(len(sw), 1)
            self.assertEqual(sw[0]["ref_model"]["key"], "switch_oled")
            self.assertEqual(sw[0]["process"], "bought")
            self.assertEqual(bom["parts"], [])
            self.assertEqual([p["name"] for p in bom["printed"]], ["Stand"])
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()

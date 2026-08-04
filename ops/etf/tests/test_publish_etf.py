import sys
import json
import unittest
from pathlib import Path

OPS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(OPS))

from etf_ops import load_registry
from publish_etf import COMPLETE_TARGET, EARLY_TARGET, LEGACY_TARGET, STATUS_TARGET, build_publish_files


REGISTRY_PATH = Path(__file__).resolve().parents[3] / "src" / "data" / "etf-registry.json"


class PublishGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.registry = load_registry(str(REGISTRY_PATH))
        cls.codes = [item["code"] for item in cls.registry["etfs"]]

    def snapshot(self, complete=True):
        latest = {}
        for index, code in enumerate(self.codes):
            vp, dp = 20 + index, 30 + index
            sp = 40 + index if complete else None
            cp = round(vp * 0.5 + dp * 0.2 + sp * 0.3, 1) if sp is not None else round(vp * 0.7 + dp * 0.3, 1)
            latest[code] = {
                "d": "2026-08-03", "vp": vp, "dp": dp, "sp": sp, "cp": cp,
                "shares_yi": 100 + index if complete else None,
                "source_code": code, "source_date": "2026-08-03",
            }
        return {"schema_version": 2, "target_date": "2026-08-03", "latest": latest}

    def test_complete_snapshot_updates_complete_and_legacy(self):
        phase, files, report = build_publish_files(self.snapshot(True), self.registry)
        self.assertEqual(phase, "complete")
        self.assertEqual(report["status"], "healthy")
        self.assertEqual(set(files), {COMPLETE_TARGET, LEGACY_TARGET, STATUS_TARGET})

    def test_early_snapshot_never_overwrites_last_complete(self):
        phase, files, report = build_publish_files(self.snapshot(False), self.registry)
        self.assertEqual(phase, "early")
        self.assertEqual(report["status"], "healthy")
        self.assertEqual(set(files), {EARLY_TARGET, STATUS_TARGET})
        self.assertNotIn(LEGACY_TARGET, files)

    def test_bad_formula_blocks_publication(self):
        snapshot = self.snapshot(True)
        snapshot["latest"][self.codes[0]]["cp"] = 99
        with self.assertRaises(ValueError):
            build_publish_files(snapshot, self.registry)

    def test_legacy_snapshot_is_upgraded_to_schema_v2(self):
        snapshot = self.snapshot(True)
        snapshot.pop("schema_version")
        for row in snapshot["latest"].values():
            row.pop("source_code")
            row.pop("source_date")
        _phase, files, _report = build_publish_files(snapshot, self.registry)
        published = json.loads(files[COMPLETE_TARGET])
        self.assertEqual(published["schema_version"], 2)
        self.assertEqual(published["run_type"], "complete")
        for code, row in published["latest"].items():
            self.assertEqual(row["source_code"], code)
            self.assertEqual(row["source_date"], published["target_date"])


if __name__ == "__main__":
    unittest.main()

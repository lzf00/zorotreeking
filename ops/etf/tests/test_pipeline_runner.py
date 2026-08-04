import json
import sys
import tempfile
import unittest
from pathlib import Path

OPS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(OPS))

from etf_ops import load_registry
from pipeline_runner import normalize_output, registry_runtime


REGISTRY_PATH = Path(__file__).resolve().parents[3] / "src" / "data" / "etf-registry.json"


class PipelineRunnerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.registry = load_registry(str(REGISTRY_PATH))

    def test_registry_drives_analysis_and_market_maps(self):
        etfs, markets = registry_runtime(self.registry)
        self.assertEqual(list(etfs), [item["code"] for item in self.registry["etfs"]])
        self.assertEqual(markets["510300"], "1")
        self.assertEqual(markets["159915"], "0")

    def test_output_is_identity_tagged_and_written_atomically(self):
        latest = {}
        for index, item in enumerate(self.registry["etfs"]):
            code = item["code"]
            vp, dp, sp = 20 + index, 30 + index, 40 + index
            latest[code] = {
                "d": "2026-08-03", "vp": vp, "dp": dp, "sp": sp,
                "cp": round(vp * .5 + dp * .2 + sp * .3, 1), "shares_yi": 100 + index,
            }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "snapshot.json"
            path.write_text(json.dumps({"target_date": "2026-08-03", "latest": latest}), encoding="utf-8")
            report = normalize_output(path, self.registry)
            output = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(report["status"], "healthy")
            self.assertEqual(output["schema_version"], 2)
            self.assertEqual(output["run_type"], "complete")
            self.assertFalse(list(path.parent.glob("*.tmp")))


if __name__ == "__main__":
    unittest.main()

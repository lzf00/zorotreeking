import argparse
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

OPS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(OPS))

from guardian import Guardian, _systemctl


REGISTRY_PATH = Path(__file__).resolve().parents[3] / "src" / "data" / "etf-registry.json"


class GuardianRepairTests(unittest.TestCase):
    def args(self, root):
        return argparse.Namespace(
            registry=str(REGISTRY_PATH), api_url="http://unit/api/market/etf",
            admin_api="http://unit/api/admin/etf-ops", snapshot=str(root / "missing.json"),
            status=str(root / "status.json"), db=str(root / "state.db"),
            lock=str(root / "guardian.lock"), repair=True,
        )

    @staticmethod
    def partial_payload():
        return {"ok": True, "ts": 1000, "trading": False, "partial": True, "items": []}

    def test_partial_data_runs_retry_and_cache_reset_but_never_restarts_service(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict("os.environ", {"ADMIN_TOKEN": "unit"}):
            root = Path(tmp)
            guardian = Guardian(self.args(root))

            def fake_request(url, **kwargs):
                if url.endswith("/repair/cache"):
                    return {"ok": True}
                return self.partial_payload()

            with (
                patch("guardian._request_json", side_effect=fake_request),
                patch("guardian._expected_baseline_date", return_value="2026-08-03"),
                patch("guardian.time.sleep"),
                patch("guardian._systemctl") as systemctl,
            ):
                result = guardian.run()
            self.assertEqual(result["status"], "unhealthy")
            systemctl.assert_not_called()
            repairs = guardian.store.summary()["repairs"]
            self.assertEqual({row["runbook"] for row in repairs}, {"realtime_retry", "cache_reset"})

    def test_repair_circuit_breaker_stops_repeated_cache_reset(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict("os.environ", {"ADMIN_TOKEN": "unit"}):
            root = Path(tmp)
            guardian = Guardian(self.args(root))
            guardian.store.record_repair("cache_reset", "failed", "first attempt")
            with (
                patch("guardian._request_json", return_value=self.partial_payload()),
                patch("guardian._expected_baseline_date", return_value="2026-08-03"),
                patch("guardian.time.sleep"),
            ):
                guardian.run()
            cache_repairs = [row for row in guardian.store.summary()["repairs"] if row["runbook"] == "cache_reset"]
            self.assertEqual(len(cache_repairs), 1)

    def test_systemctl_rejects_every_non_allowlisted_action(self):
        with self.assertRaises(ValueError):
            _systemctl("stop", "ai-agent.service")
        with self.assertRaises(ValueError):
            _systemctl("restart", "nginx.service")


if __name__ == "__main__":
    unittest.main()

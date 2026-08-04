import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import sys

OPS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(OPS))

from etf_ops import StateStore, load_registry, validate_realtime, validate_snapshot
from guardian import _expected_baseline_date


REGISTRY_PATH = Path(__file__).resolve().parents[3] / "src" / "data" / "etf-registry.json"


class EtfOpsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.registry = load_registry(str(REGISTRY_PATH))
        cls.codes = [item["code"] for item in cls.registry["etfs"]]

    def realtime_payload(self):
        items = []
        for idx, item in enumerate(self.registry["etfs"], start=1):
            prev = 10.0 + idx
            turnover = 5.0 + idx
            items.append({
                "code": item["code"], "name": item["name"], "price": 1.0 + idx,
                "change_pct": 1.0, "turnover_yi": turnover, "prev_turnover_yi": prev,
                "ratio_pct": round(turnover / prev * 100, 1), "prev_trade_date": "2026-08-03",
            })
        return {"ok": True, "ts": 1000, "trading": False, "items": items, "baseline_date": "2026-08-03"}

    def snapshot(self):
        latest = {}
        for idx, code in enumerate(self.codes, start=1):
            vp, dp, sp = 20 + idx, 30 + idx, 40 + idx
            latest[code] = {
                "d": "2026-08-03", "vp": vp, "dp": dp, "sp": sp,
                "cp": round(vp * 0.5 + dp * 0.2 + sp * 0.3, 1),
                "shares_yi": 100 + idx, "source_code": code, "source_date": "2026-08-03",
            }
        return {"schema_version": 2, "target_date": "2026-08-03", "latest": latest}

    def test_realtime_contract_accepts_complete_payload(self):
        report = validate_realtime(self.realtime_payload(), self.registry, expected_baseline_date="2026-08-03", now_ts=1000)
        self.assertEqual(report["status"], "healthy")
        self.assertEqual(report["metrics"]["baseline_coverage"], 12)

    def test_realtime_contract_rejects_partial_success(self):
        payload = self.realtime_payload()
        payload["items"][0]["ratio_pct"] = None
        payload["items"][0]["prev_turnover_yi"] = None
        payload["partial"] = True
        report = validate_realtime(payload, self.registry, now_ts=1000)
        self.assertEqual(report["status"], "unhealthy")
        self.assertEqual(report["metrics"]["baseline_coverage"], 11)

    def test_realtime_contract_rejects_wrong_monday_baseline(self):
        payload = self.realtime_payload()
        payload["baseline_date"] = "2026-08-02"
        for item in payload["items"]:
            item["prev_trade_date"] = "2026-08-02"
        report = validate_realtime(payload, self.registry, expected_baseline_date="2026-07-31", now_ts=1000)
        self.assertEqual(report["status"], "unhealthy")
        self.assertIn("baseline_date", {issue["code"] for issue in report["issues"]})

    @patch("guardian._request_json")
    def test_calendar_uses_actual_previous_exchange_day(self, request_json):
        request_json.return_value = {"data": {"sh000300": {"qfqday": [
            ["2026-07-31", "1"], ["2026-08-03", "1"], ["2026-08-04", "1"],
        ]}}}
        value = _expected_baseline_date(datetime(2026, 8, 4, 8, tzinfo=timezone.utc))
        self.assertEqual(value, "2026-08-03")

    def test_complete_snapshot_rejects_cross_contaminated_factors(self):
        snapshot = self.snapshot()
        for row in snapshot["latest"].values():
            row["sp"] = 44.85
            row["cp"] = round(row["vp"] * 0.5 + row["dp"] * 0.2 + row["sp"] * 0.3, 1)
        report = validate_snapshot(snapshot, self.registry, phase="complete")
        self.assertEqual(report["status"], "unhealthy")
        self.assertIn("factor_cross_contamination", {issue["code"] for issue in report["issues"]})

    def test_complete_snapshot_enforces_source_identity(self):
        snapshot = self.snapshot()
        snapshot["latest"][self.codes[0]]["source_code"] = self.codes[1]
        report = validate_snapshot(snapshot, self.registry, phase="complete")
        self.assertEqual(report["status"], "unhealthy")
        self.assertIn("source_identity", {issue["code"] for issue in report["issues"]})

    def test_early_snapshot_allows_missing_share_factor(self):
        snapshot = self.snapshot()
        for row in snapshot["latest"].values():
            row["sp"] = None
            row["shares_yi"] = None
            row["cp"] = round(row["vp"] * 0.7 + row["dp"] * 0.3, 1)
        report = validate_snapshot(snapshot, self.registry, phase="early")
        self.assertEqual(report["status"], "healthy")

    def test_state_store_tracks_incident_and_repair_circuit_breaker(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(Path(tmp) / "state.db")
            report = validate_realtime({"ok": False, "items": []}, self.registry)
            store.record_report(report)
            self.assertGreater(len(store.summary()["incidents"]), 0)
            self.assertTrue(store.repair_allowed("cache_reset", cooldown_seconds=3600, max_attempts=1))
            store.record_repair("cache_reset", "failed", "test")
            self.assertFalse(store.repair_allowed("cache_reset", cooldown_seconds=3600, max_attempts=1))


if __name__ == "__main__":
    unittest.main()

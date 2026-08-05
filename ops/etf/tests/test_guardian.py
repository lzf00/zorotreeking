import argparse
import json
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

OPS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(OPS))

from guardian import BJT, Guardian, _notify_feishu, _process_exit_code, _snapshot_reason, _systemctl, notify


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
    def write_snapshot(root, *, complete=False):
        registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
        latest = {}
        for idx, item in enumerate(registry["etfs"], start=1):
            vp, dp = 20 + idx, 30 + idx
            sp = 40 + idx if complete else None
            latest[item["code"]] = {
                "d": "2026-08-04",
                "vp": vp,
                "dp": dp,
                "sp": sp,
                "cp": round(vp * 0.5 + dp * 0.2 + sp * 0.3, 1) if complete else round(vp * 0.7 + dp * 0.3, 1),
                "shares_yi": 100 + idx if complete else None,
                "source_code": item["code"],
                "source_date": "2026-08-04",
            }
        path = root / "snapshot.json"
        path.write_text(json.dumps({"schema_version": 2, "target_date": "2026-08-04", "latest": latest}), encoding="utf-8")
        return path

    def snapshot_guardian(self, root, *, complete=False):
        args = self.args(root)
        args.snapshot = str(self.write_snapshot(root, complete=complete))
        return Guardian(args)

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

    def test_unpublished_shares_are_degraded_during_source_wait_window(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict("os.environ", {
            "ETF_SNAPSHOT_RETRY_START": "19:30",
            "ETF_SNAPSHOT_FINAL_DEADLINE": "23:00",
        }):
            guardian = self.snapshot_guardian(Path(tmp))
            report = guardian._check_snapshot(datetime(2026, 8, 4, 20, 0, tzinfo=BJT))
        self.assertEqual(report["status"], "degraded")
        self.assertEqual(report["phase"], "early")
        self.assertEqual(report["metrics"]["availability_state"], "pending_source")
        self.assertIn("share_source_pending", {issue["code"] for issue in report["issues"]})

    def test_unpublished_shares_only_become_unhealthy_after_final_deadline(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict("os.environ", {
            "ETF_SNAPSHOT_RETRY_START": "19:30",
            "ETF_SNAPSHOT_FINAL_DEADLINE": "23:00",
        }):
            guardian = self.snapshot_guardian(Path(tmp))
            report = guardian._check_snapshot(datetime(2026, 8, 4, 23, 1, tzinfo=BJT))
        codes = {issue["code"] for issue in report["issues"]}
        self.assertEqual(report["status"], "unhealthy")
        self.assertEqual(report["phase"], "complete")
        self.assertEqual(report["metrics"]["availability_state"], "deadline_missed")
        self.assertIn("share_coverage", codes)
        self.assertIn("factor_coverage", codes)

    def test_complete_current_day_snapshot_stays_healthy_during_wait_window(self):
        with tempfile.TemporaryDirectory() as tmp:
            guardian = self.snapshot_guardian(Path(tmp), complete=True)
            report = guardian._check_snapshot(datetime(2026, 8, 4, 20, 0, tzinfo=BJT))
        self.assertEqual(report["status"], "healthy")
        self.assertEqual(report["phase"], "complete")
        self.assertEqual(report["metrics"]["availability_state"], "complete")

    def test_pending_snapshot_runs_bounded_three_factor_retry(self):
        with tempfile.TemporaryDirectory() as tmp:
            guardian = self.snapshot_guardian(Path(tmp))
            report = {
                "status": "degraded", "phase": "early", "metrics": {},
                "issues": [{"code": "share_source_pending", "severity": "warning"}],
            }
            with (
                patch("guardian._systemctl", return_value=(True, "")) as systemctl,
                patch.object(guardian, "_check_snapshot", return_value=report),
            ):
                guardian._repair_snapshot(report)
            systemctl.assert_called_once_with("start", "etf-three-factor.service", timeout=600)

    def test_waiting_reason_is_specific_and_business_status_does_not_fail_systemd(self):
        report = {
            "status": "degraded", "phase": "early",
            "metrics": {"expected": 12, "share_coverage": 0, "factor_coverage": 0, "complete_deadline": "23:00"},
            "issues": [{"code": "share_source_pending", "severity": "warning"}],
        }
        reason = _snapshot_reason(report)
        self.assertIn("份额数据源尚未发布", reason)
        self.assertIn("0/12", reason)
        self.assertIn("23:00", reason)
        self.assertEqual(_process_exit_code("unhealthy", fail_on_unhealthy=False), 0)
        self.assertEqual(_process_exit_code("unhealthy", fail_on_unhealthy=True), 1)

    def test_transition_from_alarm_to_waiting_sends_one_explanatory_notice(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            guardian = Guardian(self.args(root))
            guardian.store.set("overall_status", "unhealthy")
            realtime = {"status": "healthy", "scope": "realtime", "metrics": {}, "issues": []}
            snapshot = {
                "status": "degraded", "scope": "snapshot", "phase": "early",
                "metrics": {"expected": 12, "share_coverage": 0, "factor_coverage": 0, "complete_deadline": "23:00"},
                "issues": [{"code": "share_source_pending", "severity": "warning"}],
            }
            guardian.args.repair = False
            with (
                patch.object(guardian, "_check_realtime", return_value=(realtime, {})),
                patch.object(guardian, "_check_snapshot", return_value=snapshot),
                patch("guardian.notify", return_value={"feishu": True}) as notify,
            ):
                result = guardian.run()
            self.assertEqual(result["status"], "degraded")
            self.assertEqual(result["notification_policy"], "feishu_only")
            self.assertEqual(result["notification_channels"], {"feishu_configured": False})
            title, body = notify.call_args.args
            self.assertIn("等待份额", title)
            self.assertIn("份额数据源尚未发布", body)

    def test_systemctl_rejects_every_non_allowlisted_action(self):
        with self.assertRaises(ValueError):
            _systemctl("stop", "ai-agent.service")
        with self.assertRaises(ValueError):
            _systemctl("restart", "nginx.service")

    def test_feishu_notification_includes_required_keyword(self):
        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            @staticmethod
            def read(_limit):
                return b'{"code": 0}'

        with (
            patch.dict("os.environ", {
                "ETF_FEISHU_WEBHOOK_URL": "https://example.invalid/hook",
                "ETF_FEISHU_KEYWORD": "ZoroTreeking",
            }),
            patch("guardian.urllib.request.urlopen", return_value=Response()) as urlopen,
        ):
            self.assertTrue(_notify_feishu("ETF Guardian test", "healthy"))
        request = urlopen.call_args.args[0]
        payload = json.loads(request.data.decode("utf-8"))
        self.assertIn("ZoroTreeking", payload["content"]["text"])

    def test_notification_route_is_feishu_only(self):
        with patch("guardian._notify_feishu", return_value=True) as feishu:
            result = notify("ETF Guardian test", "healthy")
        self.assertEqual(result, {"feishu": True})
        feishu.assert_called_once_with("ETF Guardian test", "healthy")


if __name__ == "__main__":
    unittest.main()

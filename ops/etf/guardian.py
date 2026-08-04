#!/usr/bin/env python3
"""ETF Guardian: detect, audit and execute bounded deterministic repairs."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Mapping, Optional

from etf_ops import (
    StateStore,
    atomic_write_json,
    load_registry,
    structured_log,
    validate_realtime,
    validate_snapshot,
)


BJT = timezone(timedelta(hours=8))
ALLOWED_SERVICES = {"ai-agent.service", "etf-three-factor.service"}


def _request_json(url: str, *, method: str = "GET", token: str = "", timeout: int = 20) -> Dict[str, Any]:
    headers = {"Accept": "application/json", "User-Agent": "ZoroETFGuardian/1.0"}
    if token:
        headers["X-Admin-Token"] = token
    request = urllib.request.Request(url, method=method, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read(2_000_000)
        return json.loads(raw.decode("utf-8"))


def _systemctl(action: str, service: str, timeout: int = 180) -> tuple[bool, str]:
    if action not in {"start", "restart", "is-active"} or service not in ALLOWED_SERVICES:
        raise ValueError("systemctl action/service is not allowlisted")
    result = subprocess.run(
        ["/usr/bin/systemctl", action, service],
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    detail = (result.stdout + "\n" + result.stderr).strip()[-1000:]
    return result.returncode == 0, detail


def _notify_serverchan(title: str, body: str) -> bool:
    key = os.getenv("SERVERCHAN_KEY", "").strip()
    if not key:
        return False
    endpoint = f"https://sctapi.ftqq.com/{urllib.parse.quote(key, safe='')}.send"
    payload = urllib.parse.urlencode({"title": title[:64], "desp": body[:8000]}).encode()
    request = urllib.request.Request(endpoint, data=payload, method="POST", headers={"User-Agent": "ZoroETFGuardian/1.0"})
    with urllib.request.urlopen(request, timeout=15) as response:
        return 200 <= response.status < 300


def _notify_feishu(title: str, body: str) -> bool:
    endpoint = os.getenv("ETF_FEISHU_WEBHOOK_URL", "").strip()
    if not endpoint:
        return False
    keyword = os.getenv("ETF_FEISHU_KEYWORD", "ZoroTreeking").strip()
    message = f"{title}\n{body}"
    if keyword and keyword not in message:
        message = f"{keyword} | {message}"
    payload = json.dumps({"msg_type": "text", "content": {"text": message}}, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(endpoint, data=payload, method="POST", headers={"Content-Type": "application/json", "User-Agent": "ZoroETFGuardian/1.0"})
    with urllib.request.urlopen(request, timeout=15) as response:
        result = json.loads(response.read(200_000).decode("utf-8"))
        return response.status == 200 and result.get("code", result.get("StatusCode", 0)) == 0


def notify(title: str, body: str) -> Dict[str, bool]:
    results = {"serverchan": False, "feishu": False}
    for name, sender in (("serverchan", _notify_serverchan), ("feishu", _notify_feishu)):
        try:
            results[name] = sender(title, body)
        except Exception as exc:
            structured_log("notification_failed", channel=name, error=str(exc)[:300])
    return results


def _load_json(path: Path) -> Optional[Dict[str, Any]]:
    try:
        with path.open(encoding="utf-8") as handle:
            value = json.load(handle)
        return value if isinstance(value, dict) else None
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def _expected_baseline_date(now: Optional[datetime] = None) -> Optional[str]:
    """Resolve the last completed trading day from an independent index feed.

    Calendar weekdays are not sufficient around exchange holidays.  The CSI 300
    daily series gives the actual open days; today's in-progress/closed bar is
    deliberately excluded because realtime turnover compares with the prior day.
    """
    current = (now or datetime.now(BJT)).astimezone(BJT).date().isoformat()
    url = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh000300,day,,,15,qfq"
    payload = _request_json(url, timeout=15)
    node = (payload.get("data") or {}).get("sh000300") or {}
    rows = node.get("qfqday") or node.get("day") or []
    dates = sorted({str(row[0]) for row in rows if isinstance(row, list) and row and str(row[0]) < current})
    return dates[-1] if dates else None


def _combine_status(realtime: Mapping[str, Any], snapshot: Optional[Mapping[str, Any]]) -> str:
    statuses = [str(realtime.get("status", "unhealthy"))]
    if snapshot:
        statuses.append(str(snapshot.get("status", "unhealthy")))
    if "unhealthy" in statuses:
        return "unhealthy"
    if "degraded" in statuses:
        return "degraded"
    return "healthy"


class Guardian:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.registry = load_registry(args.registry)
        self.store = StateStore(args.db)
        self.admin_token = os.getenv("ADMIN_TOKEN", "").strip()

    def _check_realtime(self) -> tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
        try:
            payload = _request_json(self.args.api_url, timeout=30)
            try:
                baseline = _expected_baseline_date()
            except Exception as exc:
                baseline = None
                structured_log("calendar_check_failed", error=str(exc)[:300])
            report = validate_realtime(payload, self.registry, expected_baseline_date=baseline)
            report["metrics"]["expected_baseline_date"] = baseline
            if baseline is None:
                report["issues"].append({
                    "code": "calendar_unavailable", "message": "Independent trading calendar is unavailable",
                    "severity": "warning", "expected": "previous exchange trading day", "actual": None,
                })
                if report["status"] == "healthy":
                    report["status"] = "degraded"
            return report, payload
        except Exception as exc:
            report = {
                "schema_version": 1,
                "scope": "realtime",
                "phase": "intraday",
                "status": "unhealthy",
                "checked_at": datetime.now(BJT).isoformat(timespec="seconds"),
                "metrics": {"expected": self.registry["expected_count"], "items": 0},
                "issues": [{"code": "request_failed", "message": "ETF API request failed", "severity": "error", "expected": "HTTP 200 JSON", "actual": str(exc)[:300]}],
            }
            return report, None

    def _repair_realtime(self, report: Dict[str, Any]) -> Dict[str, Any]:
        if report.get("status") == "healthy":
            return report
        if self.store.repair_allowed("realtime_retry", cooldown_seconds=300, max_attempts=2):
            time.sleep(1)
            retry, _payload = self._check_realtime()
            result = "success" if retry.get("status") == "healthy" else "failed"
            self.store.record_repair("realtime_retry", result, json.dumps(retry.get("metrics", {}), ensure_ascii=False))
            structured_log("repair", runbook="realtime_retry", result=result)
            report = retry
        if report.get("status") != "healthy" and self.admin_token and self.store.repair_allowed("cache_reset", cooldown_seconds=1800, max_attempts=1):
            endpoint = self.args.admin_api.rstrip("/") + "/repair/cache"
            try:
                _request_json(endpoint, method="POST", token=self.admin_token, timeout=15)
                time.sleep(1)
                retry, _payload = self._check_realtime()
                result = "success" if retry.get("status") == "healthy" else "failed"
                self.store.record_repair("cache_reset", result, json.dumps(retry.get("metrics", {}), ensure_ascii=False))
                structured_log("repair", runbook="cache_reset", result=result)
                report = retry
            except Exception as exc:
                self.store.record_repair("cache_reset", "failed", str(exc))
                structured_log("repair", runbook="cache_reset", result="failed", error=str(exc)[:300])
        request_failed = any(issue.get("code") == "request_failed" for issue in report.get("issues", []))
        if request_failed and self.store.repair_allowed("restart_ai_agent", cooldown_seconds=1800, max_attempts=1):
            ok, detail = _systemctl("restart", "ai-agent.service")
            self.store.record_repair("restart_ai_agent", "success" if ok else "failed", detail)
            structured_log("repair", runbook="restart_ai_agent", result="success" if ok else "failed")
            if ok:
                time.sleep(2)
                report, _payload = self._check_realtime()
        return report

    def _check_snapshot(self) -> Optional[Dict[str, Any]]:
        snapshot_path = Path(self.args.snapshot)
        snapshot = _load_json(snapshot_path)
        if snapshot is None:
            return None
        bjt_now = datetime.now(BJT)
        enforce_complete = bjt_now.weekday() < 5 and (bjt_now.hour, bjt_now.minute) >= (19, 40)
        phase = "complete" if enforce_complete else "auto"
        return validate_snapshot(snapshot, self.registry, phase=phase)

    def _repair_snapshot(self, report: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not report or report.get("status") != "unhealthy" or report.get("phase") != "complete":
            return report
        if not self.store.repair_allowed("rerun_three_factor", cooldown_seconds=1800, max_attempts=1):
            return report
        ok, detail = _systemctl("start", "etf-three-factor.service", timeout=600)
        self.store.record_repair("rerun_three_factor", "success" if ok else "failed", detail)
        structured_log("repair", runbook="rerun_three_factor", result="success" if ok else "failed")
        return self._check_snapshot() if ok else report

    def run(self) -> Dict[str, Any]:
        started = time.monotonic()
        realtime, _payload = self._check_realtime()
        if self.args.repair:
            realtime = self._repair_realtime(realtime)
        snapshot = self._check_snapshot()
        if self.args.repair:
            snapshot = self._repair_snapshot(snapshot)
        realtime_run = self.store.record_report(realtime)
        snapshot_run = self.store.record_report(snapshot) if snapshot else None
        overall = _combine_status(realtime, snapshot)
        previous = self.store.get("overall_status", "unknown")
        self.store.set("overall_status", overall)
        status = {
            "schema_version": 1,
            "status": overall,
            "checked_at": datetime.now(BJT).isoformat(timespec="seconds"),
            "duration_ms": int((time.monotonic() - started) * 1000),
            "realtime": realtime,
            "snapshot": snapshot,
            "run_ids": {"realtime": realtime_run, "snapshot": snapshot_run},
            "notification_channels": {
                "serverchan_configured": bool(os.getenv("SERVERCHAN_KEY", "").strip()),
                "feishu_configured": bool(os.getenv("ETF_FEISHU_WEBHOOK_URL", "").strip()),
            },
        }
        atomic_write_json(self.args.status, status)
        if overall == "unhealthy" and previous != "unhealthy":
            notify("🚨 ETF Guardian 告警", f"状态: {overall}\n实时: {realtime.get('status')}\n三因子: {(snapshot or {}).get('status', 'not_checked')}")
        elif overall == "healthy" and previous in {"degraded", "unhealthy"}:
            notify("✅ ETF Guardian 已恢复", f"上一状态: {previous}\n当前状态: healthy")
        structured_log("guardian_complete", status=overall, duration_ms=status["duration_ms"], repair=self.args.repair)
        return status


def main() -> int:
    parser = argparse.ArgumentParser(description="ETF data guardian")
    parser.add_argument("--registry", default=os.getenv("ETF_REGISTRY_PATH", ""))
    parser.add_argument("--api-url", default=os.getenv("ETF_API_URL", "http://127.0.0.1:8800/api/market/etf"))
    parser.add_argument("--admin-api", default=os.getenv("ETF_ADMIN_API", "http://127.0.0.1:8800/api/admin/etf-ops"))
    parser.add_argument("--snapshot", default=os.getenv("ETF_SNAPSHOT_PATH", "/root/.etf-skill/workspace/ETF三因子分析-v7.json"))
    parser.add_argument("--status", default=os.getenv("ETF_STATUS_PATH", "/var/lib/zoro-etf-ops/status.json"))
    parser.add_argument("--db", default=os.getenv("ETF_STATE_DB", "/var/lib/zoro-etf-ops/state.db"))
    parser.add_argument("--lock", default=os.getenv("ETF_GUARDIAN_LOCK", "/run/lock/zoro-etf-guardian.lock"))
    parser.add_argument("--repair", action="store_true")
    args = parser.parse_args()
    lock_path = Path(args.lock)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("w", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            structured_log("guardian_skipped", reason="already_running")
            return 0
        status = Guardian(args).run()
    return 1 if status["status"] == "unhealthy" else 0


if __name__ == "__main__":
    raise SystemExit(main())

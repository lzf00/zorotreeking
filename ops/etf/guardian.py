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
DEFAULT_SNAPSHOT_RETRY_START = "19:30"
DEFAULT_SNAPSHOT_FINAL_DEADLINE = "23:00"
SNAPSHOT_RETRY_COOLDOWN_SECONDS = 1800


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
    results = {"feishu": False}
    try:
        results["feishu"] = _notify_feishu(title, body)
    except Exception as exc:
        structured_log("notification_failed", channel="feishu", error=str(exc)[:300])
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


def _clock_minutes(value: str, default: str) -> tuple[int, str]:
    candidate = (value or default).strip()
    try:
        hour_text, minute_text = candidate.split(":", 1)
        hour, minute = int(hour_text), int(minute_text)
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            raise ValueError
    except (TypeError, ValueError):
        hour_text, minute_text = default.split(":", 1)
        hour, minute = int(hour_text), int(minute_text)
        candidate = default
    return hour * 60 + minute, candidate


def _snapshot_window() -> tuple[int, str, int, str]:
    retry_minutes, retry_text = _clock_minutes(
        os.getenv("ETF_SNAPSHOT_RETRY_START", DEFAULT_SNAPSHOT_RETRY_START),
        DEFAULT_SNAPSHOT_RETRY_START,
    )
    deadline_minutes, deadline_text = _clock_minutes(
        os.getenv("ETF_SNAPSHOT_FINAL_DEADLINE", DEFAULT_SNAPSHOT_FINAL_DEADLINE),
        DEFAULT_SNAPSHOT_FINAL_DEADLINE,
    )
    if deadline_minutes <= retry_minutes:
        retry_minutes, retry_text = _clock_minutes(DEFAULT_SNAPSHOT_RETRY_START, DEFAULT_SNAPSHOT_RETRY_START)
        deadline_minutes, deadline_text = _clock_minutes(DEFAULT_SNAPSHOT_FINAL_DEADLINE, DEFAULT_SNAPSHOT_FINAL_DEADLINE)
    return retry_minutes, retry_text, deadline_minutes, deadline_text


def _add_issue(report: Dict[str, Any], *, code: str, message: str, severity: str, expected: Any, actual: Any) -> None:
    if any(issue.get("code") == code for issue in report.get("issues", [])):
        return
    report.setdefault("issues", []).append({
        "code": code,
        "message": message,
        "severity": severity,
        "expected": expected,
        "actual": actual,
    })


def _snapshot_reason(report: Optional[Mapping[str, Any]]) -> str:
    if not report:
        return "未检测到三因子快照"
    metrics = report.get("metrics") or {}
    expected = metrics.get("expected", 12)
    shares = metrics.get("share_coverage", 0)
    factors = metrics.get("factor_coverage", 0)
    deadline = metrics.get("complete_deadline", DEFAULT_SNAPSHOT_FINAL_DEADLINE)
    codes = {str(issue.get("code")) for issue in report.get("issues", [])}
    if codes & {"share_source_pending", "snapshot_date_pending"}:
        return f"份额数据源尚未发布（份额 {shares}/{expected}，份额因子 {factors}/{expected}），系统将定时重试，最终截止 {deadline}"
    issue_text = ", ".join(sorted(code for code in codes if code)) or "无明确问题码"
    return f"问题: {issue_text}；份额 {shares}/{expected}，份额因子 {factors}/{expected}"


def _process_exit_code(status: str, *, fail_on_unhealthy: bool) -> int:
    """Keep business health separate from systemd process execution health."""
    return 1 if fail_on_unhealthy and status == "unhealthy" else 0


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

    def _check_snapshot(self, now: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
        snapshot_path = Path(self.args.snapshot)
        snapshot = _load_json(snapshot_path)
        if snapshot is None:
            return None
        bjt_now = (now or datetime.now(BJT)).astimezone(BJT)
        report = validate_snapshot(snapshot, self.registry, phase="auto")
        metrics = report.setdefault("metrics", {})
        retry_minutes, retry_text, deadline_minutes, deadline_text = _snapshot_window()
        current_minutes = bjt_now.hour * 60 + bjt_now.minute
        expected = int(metrics.get("expected") or self.registry["expected_count"])
        coverage_complete = (
            metrics.get("share_coverage") == expected
            and metrics.get("factor_coverage") == expected
        )
        target_date = str(metrics.get("target_date") or "")
        expected_date = bjt_now.date().isoformat()
        current_snapshot = target_date == expected_date
        metrics.update({
            "availability_state": "complete" if coverage_complete and current_snapshot else "pre_release",
            "expected_target_date": expected_date,
            "retry_start": retry_text,
            "complete_deadline": deadline_text,
        })

        # A complete current-day snapshot is judged on its actual quality at any
        # time.  Formula/source-identity failures must never be hidden by the
        # publication grace window.
        if coverage_complete and current_snapshot:
            return report
        if bjt_now.weekday() >= 5:
            metrics["availability_state"] = "not_required"
            return report
        existing_errors = [issue for issue in report.get("issues", []) if issue.get("severity") == "error"]
        if existing_errors:
            metrics["availability_state"] = "invalid"
            return report

        if current_minutes >= deadline_minutes:
            report = validate_snapshot(snapshot, self.registry, phase="complete")
            metrics = report.setdefault("metrics", {})
            metrics.update({
                "availability_state": "deadline_missed",
                "expected_target_date": expected_date,
                "retry_start": retry_text,
                "complete_deadline": deadline_text,
            })
            if target_date != expected_date:
                _add_issue(
                    report,
                    code="snapshot_date",
                    message="Complete snapshot date is stale after the publication deadline",
                    severity="error",
                    expected=expected_date,
                    actual=target_date,
                )
                report["status"] = "unhealthy"
            return report

        if current_minutes >= retry_minutes:
            pending_code = "share_source_pending" if current_snapshot else "snapshot_date_pending"
            _add_issue(
                report,
                code=pending_code,
                message="Exchange share data has not published the current complete snapshot yet",
                severity="warning",
                expected={"target_date": expected_date, "shares": expected, "factors": expected},
                actual={
                    "target_date": target_date,
                    "shares": metrics.get("share_coverage", 0),
                    "factors": metrics.get("factor_coverage", 0),
                },
            )
            report["status"] = "degraded"
            metrics["availability_state"] = "pending_source"
        return report

    def _repair_snapshot(self, report: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not report or report.get("status") == "healthy":
            return report
        issue_codes = {str(issue.get("code")) for issue in report.get("issues", [])}
        retryable = (
            report.get("status") == "unhealthy" and report.get("phase") == "complete"
        ) or bool(issue_codes & {"share_source_pending", "snapshot_date_pending"})
        if not retryable:
            return report
        runbook = "rerun_three_factor_final" if report.get("status") == "unhealthy" and report.get("phase") == "complete" else "rerun_three_factor"
        if not self.store.repair_allowed(
            runbook,
            cooldown_seconds=SNAPSHOT_RETRY_COOLDOWN_SECONDS,
            max_attempts=1,
        ):
            return report
        ok, detail = _systemctl("start", "etf-three-factor.service", timeout=600)
        if not ok:
            self.store.record_repair(runbook, "failed", detail)
            structured_log("repair", runbook=runbook, result="failed")
            return report
        retry = self._check_snapshot()
        result = "success" if retry and retry.get("status") == "healthy" else "pending" if retry and retry.get("status") == "degraded" else "failed"
        self.store.record_repair(runbook, result, json.dumps((retry or {}).get("metrics", {}), ensure_ascii=False))
        structured_log("repair", runbook=runbook, result=result)
        return retry or report

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
                "feishu_configured": bool(os.getenv("ETF_FEISHU_WEBHOOK_URL", "").strip()),
            },
            "notification_policy": "feishu_only",
        }
        atomic_write_json(self.args.status, status)
        delivery: Optional[Dict[str, bool]] = None
        if overall == "unhealthy" and previous != "unhealthy":
            delivery = notify(
                "🚨 ETF Guardian 告警",
                f"状态: {overall}\n实时: {realtime.get('status')}\n三因子: {(snapshot or {}).get('status', 'not_checked')}\n原因: {_snapshot_reason(snapshot)}",
            )
        elif overall == "degraded" and previous != "degraded":
            delivery = notify(
                "🟡 ETF Guardian 等待份额数据",
                f"状态: degraded（非故障）\n实时: {realtime.get('status')}\n三因子: 等待发布\n原因: {_snapshot_reason(snapshot)}",
            )
        elif overall == "healthy" and previous in {"degraded", "unhealthy"}:
            delivery = notify("✅ ETF Guardian 已恢复", f"上一状态: {previous}\n当前状态: healthy")
        if delivery is not None:
            structured_log("notification", previous=previous, status=overall, channels=delivery)
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
    parser.add_argument("--fail-on-unhealthy", action="store_true", help="Return exit 1 for unhealthy business state (manual/CI only)")
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
    return _process_exit_code(status["status"], fail_on_unhealthy=args.fail_on_unhealthy)


if __name__ == "__main__":
    raise SystemExit(main())

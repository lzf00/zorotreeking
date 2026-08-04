#!/usr/bin/env python3
"""ETF data contracts, quality gates, state storage and safe utilities.

This module intentionally uses only the Python standard library so the same
artifact can run in ai-agent, the three-factor job, CI and the guardian.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import sqlite3
import tempfile
import time
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence


DEFAULT_REGISTRY_PATHS = (
    "/etc/zoro-etf/registry.json",
    str(Path(__file__).with_name("registry.json")),
)


@dataclass(frozen=True)
class QualityIssue:
    code: str
    message: str
    severity: str = "error"
    expected: Any = None
    actual: Any = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def structured_log(event: str, **fields: Any) -> None:
    payload = {"ts": _now_iso(), "service": "zoro-etf-ops", "event": event, **fields}
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)


def atomic_write_json(path: str | Path, payload: Mapping[str, Any]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=str(target.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, target)
    finally:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass


def sha256_json(payload: Mapping[str, Any]) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def load_registry(path: Optional[str] = None) -> Dict[str, Any]:
    candidates: Sequence[str] = (path,) if path else (
        os.getenv("ETF_REGISTRY_PATH", ""),
        *DEFAULT_REGISTRY_PATHS,
    )
    selected = next((Path(p) for p in candidates if p and Path(p).is_file()), None)
    if selected is None:
        raise FileNotFoundError("ETF registry not found; set ETF_REGISTRY_PATH")
    with selected.open(encoding="utf-8") as handle:
        registry = json.load(handle)
    etfs = registry.get("etfs")
    expected = registry.get("expected_count")
    if not isinstance(etfs, list) or not isinstance(expected, int) or expected <= 0:
        raise ValueError("ETF registry has invalid shape")
    codes = [str(item.get("code", "")) for item in etfs if isinstance(item, dict)]
    secids = [str(item.get("secid", "")) for item in etfs if isinstance(item, dict)]
    if len(etfs) != expected or len(set(codes)) != expected or len(set(secids)) != expected:
        raise ValueError("ETF registry count/codes/secids are inconsistent")
    if any(len(code) != 6 or not code.isdigit() for code in codes):
        raise ValueError("ETF registry contains invalid code")
    registry["_path"] = str(selected)
    return registry


def registry_codes(registry: Mapping[str, Any]) -> List[str]:
    return [str(item["code"]) for item in registry["etfs"]]


def registry_by_code(registry: Mapping[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {str(item["code"]): dict(item) for item in registry["etfs"]}


def runtime_pool(registry: Mapping[str, Any]) -> List[tuple[str, str, str]]:
    return [(str(item["secid"]), str(item["code"]), str(item["name"])) for item in registry["etfs"]]


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def _parse_date(value: Any) -> Optional[date]:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _report(scope: str, phase: str, issues: List[QualityIssue], metrics: Dict[str, Any]) -> Dict[str, Any]:
    errors = [issue for issue in issues if issue.severity == "error"]
    warnings = [issue for issue in issues if issue.severity == "warning"]
    status = "unhealthy" if errors else "degraded" if warnings else "healthy"
    return {
        "schema_version": 1,
        "scope": scope,
        "phase": phase,
        "status": status,
        "checked_at": _now_iso(),
        "metrics": metrics,
        "issues": [asdict(issue) for issue in issues],
    }


def validate_realtime(
    payload: Mapping[str, Any],
    registry: Mapping[str, Any],
    *,
    expected_baseline_date: Optional[str] = None,
    now_ts: Optional[float] = None,
) -> Dict[str, Any]:
    issues: List[QualityIssue] = []
    expected_codes = registry_codes(registry)
    expected_set = set(expected_codes)
    items_raw = payload.get("items")
    items = items_raw if isinstance(items_raw, list) else []
    codes = [str(item.get("code", "")) for item in items if isinstance(item, dict)]
    code_set = set(codes)
    if len(items) != len(expected_codes):
        issues.append(QualityIssue("item_count", "ETF item count is incomplete", expected=len(expected_codes), actual=len(items)))
    if len(codes) != len(code_set):
        issues.append(QualityIssue("duplicate_codes", "ETF response contains duplicate codes", expected=len(code_set), actual=len(codes)))
    missing_codes = sorted(expected_set - code_set)
    extra_codes = sorted(code_set - expected_set)
    if missing_codes:
        issues.append(QualityIssue("missing_codes", "ETF response is missing registered codes", expected=[], actual=missing_codes))
    if extra_codes:
        issues.append(QualityIssue("extra_codes", "ETF response contains unregistered codes", expected=[], actual=extra_codes))

    baseline_dates: set[str] = set()
    missing_ratio: List[str] = []
    missing_quotes: List[str] = []
    formula_mismatch: List[str] = []
    for item in items:
        if not isinstance(item, dict):
            issues.append(QualityIssue("item_shape", "ETF item is not an object"))
            continue
        code = str(item.get("code", ""))
        if not _finite(item.get("price")) or not _finite(item.get("turnover_yi")):
            missing_quotes.append(code)
        baseline = item.get("prev_trade_date")
        if isinstance(baseline, str) and baseline:
            baseline_dates.add(baseline)
        ratio = item.get("ratio_pct")
        prev = item.get("prev_turnover_yi")
        turnover = item.get("turnover_yi")
        if not _finite(ratio) or not _finite(prev) or float(prev) <= 0:
            missing_ratio.append(code)
        elif _finite(turnover):
            expected_ratio = float(turnover) / float(prev) * 100
            if abs(expected_ratio - float(ratio)) > 1.5:
                formula_mismatch.append(code)
    if missing_quotes:
        issues.append(QualityIssue("quote_coverage", "Price or turnover is missing", expected=[], actual=missing_quotes))
    if missing_ratio:
        issues.append(QualityIssue("baseline_coverage", "Previous-turnover comparison is missing", expected=[], actual=missing_ratio))
    if formula_mismatch:
        issues.append(QualityIssue("ratio_formula", "Turnover ratio does not match source amounts", expected=[], actual=formula_mismatch))
    if len(baseline_dates) != 1:
        issues.append(QualityIssue("baseline_uniformity", "Baseline dates must be uniform", expected=1, actual=sorted(baseline_dates)))
    elif expected_baseline_date and next(iter(baseline_dates)) != expected_baseline_date:
        issues.append(QualityIssue("baseline_date", "Baseline is not the expected previous trading day", expected=expected_baseline_date, actual=next(iter(baseline_dates))))

    ts = payload.get("ts")
    age_seconds: Optional[int] = None
    if _finite(ts):
        age_seconds = max(0, int((now_ts or time.time()) - float(ts)))
        if bool(payload.get("trading")) and age_seconds > 120:
            issues.append(QualityIssue("stale_timestamp", "Trading data is older than 120 seconds", expected="<=120", actual=age_seconds))
    else:
        issues.append(QualityIssue("timestamp", "Response timestamp is missing"))
    if payload.get("stale"):
        issues.append(QualityIssue("stale_cache", "API is serving last-known-good cache", severity="warning"))
    if payload.get("partial"):
        issues.append(QualityIssue("partial_flag", "API reports partial data", expected=False, actual=True))
    if payload.get("ok") is not True:
        issues.append(QualityIssue("api_ok", "ETF API reports failure", expected=True, actual=payload.get("ok")))

    return _report(
        "realtime",
        "intraday",
        issues,
        {
            "expected": len(expected_codes),
            "items": len(items),
            "quote_coverage": len(expected_codes) - len(set(missing_quotes)),
            "baseline_coverage": len(expected_codes) - len(set(missing_ratio)),
            "baseline_dates": sorted(baseline_dates),
            "age_seconds": age_seconds,
        },
    )


def validate_snapshot(snapshot: Mapping[str, Any], registry: Mapping[str, Any], phase: str = "auto") -> Dict[str, Any]:
    issues: List[QualityIssue] = []
    latest_raw = snapshot.get("latest")
    latest: Mapping[str, Any] = latest_raw if isinstance(latest_raw, dict) else {}
    expected_codes = registry_codes(registry)
    expected_set = set(expected_codes)
    actual_set = {str(code) for code in latest}
    if actual_set != expected_set:
        issues.append(QualityIssue("snapshot_codes", "Snapshot codes differ from registry", expected=expected_codes, actual=sorted(actual_set)))
    target_date = snapshot.get("target_date")
    if _parse_date(target_date) is None:
        issues.append(QualityIssue("target_date", "Snapshot target_date is invalid", actual=target_date))

    share_coverage = 0
    factor_coverage = 0
    formula_mismatch: List[str] = []
    identity_mismatch: List[str] = []
    sp_values: List[float] = []
    for code in expected_codes:
        row = latest.get(code)
        if not isinstance(row, dict):
            continue
        if row.get("d") != target_date:
            identity_mismatch.append(code)
        source_code = row.get("source_code")
        source_date = row.get("source_date")
        if snapshot.get("schema_version", 1) >= 2 and (source_code != code or source_date != target_date):
            identity_mismatch.append(code)
        shares = row.get("shares_yi")
        sp = row.get("sp")
        if _finite(shares) and float(shares) > 0:
            share_coverage += 1
        if _finite(sp):
            factor_coverage += 1
            sp_values.append(float(sp))
        vp, dp, cp = row.get("vp"), row.get("dp"), row.get("cp")
        if not all(_finite(v) for v in (vp, dp, cp)):
            formula_mismatch.append(code)
            continue
        expected_cp = float(vp) * 0.5 + float(dp) * 0.2 + float(sp) * 0.3 if _finite(sp) else float(vp) * 0.7 + float(dp) * 0.3
        if abs(expected_cp - float(cp)) > 0.15:
            formula_mismatch.append(code)
    if identity_mismatch:
        issues.append(QualityIssue("source_identity", "ETF source identity/date mismatch", expected=[], actual=sorted(set(identity_mismatch))))
    if formula_mismatch:
        issues.append(QualityIssue("factor_formula", "Composite probability cannot be reproduced", expected=[], actual=sorted(set(formula_mismatch))))

    if phase == "auto":
        phase = "complete" if share_coverage == len(expected_codes) and factor_coverage == len(expected_codes) else "early"
    if phase not in {"early", "complete"}:
        issues.append(QualityIssue("phase", "Unknown snapshot phase", expected="early|complete", actual=phase))
    if phase == "complete":
        if share_coverage != len(expected_codes):
            issues.append(QualityIssue("share_coverage", "Complete snapshot is missing share data", expected=len(expected_codes), actual=share_coverage))
        if factor_coverage != len(expected_codes):
            issues.append(QualityIssue("factor_coverage", "Complete snapshot is missing share factors", expected=len(expected_codes), actual=factor_coverage))
        if factor_coverage > 1 and len({round(value, 6) for value in sp_values}) <= 1:
            issues.append(QualityIssue("factor_cross_contamination", "All share factors are identical", expected=">1 unique", actual=sp_values[0] if sp_values else None))
    elif share_coverage or factor_coverage:
        issues.append(QualityIssue("early_partial_shares", "Early snapshot contains partial share disclosure", severity="warning", actual={"shares": share_coverage, "factors": factor_coverage}))

    return _report(
        "snapshot",
        phase,
        issues,
        {
            "expected": len(expected_codes),
            "items": len(latest),
            "share_coverage": share_coverage,
            "factor_coverage": factor_coverage,
            "unique_share_factors": len({round(value, 6) for value in sp_values}),
            "target_date": target_date,
        },
    )


class StateStore:
    def __init__(self, path: str | Path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._init()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    @contextmanager
    def _connection(self):
        conn = self._connect()
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def _init(self) -> None:
        with self._connection() as conn:
            conn.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS runs (
                  run_id TEXT PRIMARY KEY, ts INTEGER NOT NULL, scope TEXT NOT NULL,
                  status TEXT NOT NULL, report_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS incidents (
                  fingerprint TEXT PRIMARY KEY, scope TEXT NOT NULL, status TEXT NOT NULL,
                  first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, occurrences INTEGER NOT NULL,
                  message TEXT NOT NULL, resolved_at INTEGER
                );
                CREATE TABLE IF NOT EXISTS repairs (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, runbook TEXT NOT NULL,
                  result TEXT NOT NULL, detail TEXT
                );
                CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                """
            )

    def record_report(self, report: Mapping[str, Any]) -> str:
        now = int(time.time())
        run_id = uuid.uuid4().hex
        current: set[str] = set()
        with self._connection() as conn:
            conn.execute(
                "INSERT INTO runs(run_id,ts,scope,status,report_json) VALUES(?,?,?,?,?)",
                (run_id, now, report.get("scope", "unknown"), report.get("status", "unknown"), json.dumps(report, ensure_ascii=False)),
            )
            for issue in report.get("issues", []):
                if not isinstance(issue, dict) or issue.get("severity") != "error":
                    continue
                fingerprint = f"{report.get('scope')}:{issue.get('code')}"
                current.add(fingerprint)
                conn.execute(
                    """
                    INSERT INTO incidents(fingerprint,scope,status,first_seen,last_seen,occurrences,message,resolved_at)
                    VALUES(?,?,?,?,?,?,?,NULL)
                    ON CONFLICT(fingerprint) DO UPDATE SET
                      status='open', last_seen=excluded.last_seen,
                      occurrences=incidents.occurrences+1, message=excluded.message, resolved_at=NULL
                    """,
                    (fingerprint, report.get("scope", "unknown"), "open", now, now, 1, str(issue.get("message", ""))),
                )
            rows = conn.execute("SELECT fingerprint FROM incidents WHERE status='open' AND scope=?", (report.get("scope", "unknown"),)).fetchall()
            for row in rows:
                if row["fingerprint"] not in current:
                    conn.execute("UPDATE incidents SET status='resolved', resolved_at=?, last_seen=? WHERE fingerprint=?", (now, now, row["fingerprint"]))
        return run_id

    def record_repair(self, runbook: str, result: str, detail: str = "") -> None:
        with self._connection() as conn:
            conn.execute("INSERT INTO repairs(ts,runbook,result,detail) VALUES(?,?,?,?)", (int(time.time()), runbook, result, detail[:1000]))

    def repair_allowed(self, runbook: str, *, cooldown_seconds: int = 1800, max_attempts: int = 3) -> bool:
        cutoff = int(time.time()) - cooldown_seconds
        with self._connection() as conn:
            row = conn.execute("SELECT COUNT(*) AS n FROM repairs WHERE runbook=? AND ts>=?", (runbook, cutoff)).fetchone()
        return int(row["n"] if row else 0) < max_attempts

    def get(self, key: str, default: str = "") -> str:
        with self._connection() as conn:
            row = conn.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
        return str(row["value"]) if row else default

    def set(self, key: str, value: str) -> None:
        with self._connection() as conn:
            conn.execute("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))

    def summary(self, limit: int = 20) -> Dict[str, Any]:
        with self._connection() as conn:
            incidents = [dict(row) for row in conn.execute("SELECT * FROM incidents ORDER BY last_seen DESC LIMIT ?", (limit,)).fetchall()]
            repairs = [dict(row) for row in conn.execute("SELECT * FROM repairs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()]
            runs = [dict(row) for row in conn.execute("SELECT run_id,ts,scope,status FROM runs ORDER BY ts DESC LIMIT ?", (limit,)).fetchall()]
        return {"incidents": incidents, "repairs": repairs, "runs": runs}

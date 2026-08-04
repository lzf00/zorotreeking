#!/usr/bin/env python3
"""Registry-driven adapter for the legacy ETF three-factor pipeline.

The analysis implementation remains separately maintained, while this wrapper
injects the canonical ETF registry and atomically normalizes its output before
the quality-gated publisher sees it.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import subprocess
import sys
from pathlib import Path
from types import ModuleType
from typing import Any, Mapping

from etf_ops import atomic_write_json, load_registry, structured_log, validate_snapshot


DEFAULT_PIPELINE = "/opt/etf-three-factor/scripts/etf_v7_threefactor.py"


def load_pipeline(path: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location("zoro_etf_legacy_pipeline", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import ETF pipeline: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def registry_runtime(registry: Mapping[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    etfs: dict[str, dict[str, Any]] = {}
    markets: dict[str, str] = {}
    for item in registry["etfs"]:
        code = str(item["code"])
        etfs[code] = {"n": item["name"], "idx": item["index"], "p": int(item["priority"])}
        markets[code] = "1" if item["exchange"] == "SSE" else "0"
    return etfs, markets


def normalize_output(path: Path, registry: Mapping[str, Any]) -> dict[str, Any]:
    import json

    with path.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    payload["schema_version"] = 2
    latest = payload.get("latest") if isinstance(payload.get("latest"), dict) else {}
    for code, row in latest.items():
        if isinstance(row, dict):
            row["source_code"] = str(code)
            row["source_date"] = row.get("d")
    report = validate_snapshot(payload, registry, phase="auto")
    if report["status"] == "unhealthy":
        raise ValueError(f"pipeline output rejected: {report['issues']}")
    payload["run_type"] = report["phase"]
    atomic_write_json(path, payload)
    structured_log("pipeline_output_normalized", phase=report["phase"], metrics=report["metrics"])
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Canonical ETF pipeline runner")
    parser.add_argument("--date", default=None)
    parser.add_argument("--send", action="store_true")
    parser.add_argument("--record", action="store_true")
    parser.add_argument("--stats", action="store_true")
    parser.add_argument("--pipeline", default=os.getenv("ETF_PIPELINE_SCRIPT", DEFAULT_PIPELINE))
    parser.add_argument("--output", default=os.getenv("ETF_SNAPSHOT_PATH", str(Path.home() / ".etf-skill/workspace/ETF三因子分析-v7.json")))
    args = parser.parse_args(argv)

    if args.stats:
        return subprocess.run([sys.executable, args.pipeline, "--stats"], check=False).returncode
    registry = load_registry()
    pipeline = load_pipeline(args.pipeline)
    pipeline.ETFS, pipeline.PUSH2_MKT = registry_runtime(registry)
    structured_log("pipeline_started", target_date=args.date, registry_count=len(pipeline.ETFS), record_only=args.record)
    pipeline.main(args.date, args.send, args.record)
    if not args.record:
        normalize_output(Path(args.output), registry)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

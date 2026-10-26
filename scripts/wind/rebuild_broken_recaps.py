#!/usr/bin/env python3
"""Rebuild market recaps that leaked Windalice credit errors, from Tencent kline.

Also refreshes today's recap + JSON snapshot from live public quotes
(Sina hot/sectors/news + Tencent indices/watchlist).
"""
from __future__ import annotations

import datetime
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fallback_eastmoney import (  # noqa: E402
    INDEX_LIST,
    HK_INDEX_LIST,
    fetch_public_market,
    quote_from_bars,
    tencent_kline_bars,
    wind_to_tencent,
)
from fetcher import build_report, build_report_en  # noqa: E402
from publisher import (  # noqa: E402
    _build_hk_json_snapshot,
    _build_json_snapshot,
    _build_mdx,
    _build_sentiment_summary,
)
from quality import looks_like_credit_failure  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CONTENT = ROOT / "src" / "content" / "invest"
DATA_DIR = ROOT / "src" / "data"

A_WATCH = [
    ("600519.SH", "贵州茅台"),
    ("601318.SH", "中国平安"),
    ("000858.SZ", "五粮液"),
    ("300750.SZ", "宁德时代"),
    ("688981.SH", "中芯国际"),
]
HK_WATCH = [
    ("03690.HK", "美团-W"),
    ("01810.HK", "小米集团-W"),
    ("09988.HK", "阿里巴巴-W"),
    ("00700.HK", "腾讯控股"),
    ("01211.HK", "比亚迪股份"),
]
BROKEN_MARKERS = (
    "windalice",
    "积分余额不足",
    "余额不足",
    "insufficient account",
    "please remind the user to recharge",
)


def _is_broken(text: str) -> bool:
    lower = text.lower()
    return any(marker in lower for marker in BROKEN_MARKERS)


def _closed_at(date_str: str) -> datetime.datetime:
    year, month, day = (int(part) for part in date_str.split("-"))
    return datetime.datetime(year, month, day, 16, 0)


def _snapshot_from_kline(date_str: str, klines: dict[str, list]) -> dict | None:
    indices = []
    for code, name in INDEX_LIST:
        row = quote_from_bars(code, name, klines.get(wind_to_tencent(code) or "", []), date_str)
        if row:
            indices.append({
                "code": code, "name": name, "price": row["price"],
                "change_amount": row["change_amount"], "change_pct": row["change_pct"],
                "emoji": row["emoji"],
            })
    watchlist = []
    for code, name in A_WATCH:
        row = quote_from_bars(code, name, klines.get(wind_to_tencent(code) or "", []), date_str)
        if row:
            watchlist.append(row)
    hk_indices = []
    for code, name, _secid in HK_INDEX_LIST:
        row = quote_from_bars(code, name, klines.get(wind_to_tencent(code) or "", []), date_str)
        if row:
            hk_indices.append({
                "code": code, "name": name, "price": row["price"],
                "change_amount": row["change_amount"], "change_pct": row["change_pct"],
                "emoji": row["emoji"],
            })
    hk_watchlist = []
    for code, name in HK_WATCH:
        row = quote_from_bars(code, name, klines.get(wind_to_tencent(code) or "", []), date_str)
        if row:
            hk_watchlist.append(row)
    if len(indices) < 2 or not watchlist:
        return None
    return {
        "asOf": f"{date_str}T16:00:00",
        "source": "eastmoney_fallback",
        "indices": indices,
        "watchlist": watchlist,
        "hot_stocks": [],
        "sectors": [],
        "sentiment": {"limit_up": None, "limit_down": None, "main_flow_yi": None},
        "news": [],
        "hk_indices": hk_indices,
        "hk_watchlist": hk_watchlist,
        "hk_hot_stocks": [],
    }


def _write_recap(date_str: str, data: dict) -> None:
    as_of = _closed_at(date_str)
    zh_title, zh_body = build_report([], prefetched=data, as_of=as_of)
    en_title, en_body = build_report_en([], prefetched=data, as_of=as_of)
    (CONTENT / f"market-recap-{date_str}.zh.mdx").write_text(
        _build_mdx(zh_title, zh_body, data, _build_sentiment_summary(data), as_of=as_of, lang="zh"),
        encoding="utf-8",
    )
    (CONTENT / f"market-recap-{date_str}.en.mdx").write_text(
        _build_mdx(en_title, en_body, data, _build_sentiment_summary(data, lang="en"), as_of=as_of, lang="en"),
        encoding="utf-8",
    )


def _load_klines() -> dict[str, list]:
    symbols = []
    for code, _name in INDEX_LIST + A_WATCH + HK_WATCH:
        symbol = wind_to_tencent(code)
        if symbol:
            symbols.append(symbol)
    for code, _name, _secid in HK_INDEX_LIST:
        symbol = wind_to_tencent(code)
        if symbol:
            symbols.append(symbol)
    out: dict[str, list] = {}
    for symbol in dict.fromkeys(symbols):
        print(f"  kline {symbol}")
        out[symbol] = tencent_kline_bars(symbol, n=80)
    return out


def _dates_to_rebuild() -> list[str]:
    dates = set()
    for path in CONTENT.glob("market-recap-*.mdx"):
        match = re.search(r"market-recap-(\d{4}-\d{2}-\d{2})", path.name)
        if not match:
            continue
        if _is_broken(path.read_text(encoding="utf-8")):
            dates.add(match.group(1))
    today = datetime.datetime.now().strftime("%Y-%m-%d")
    dates.add(today)
    return sorted(dates)


def main() -> int:
    dates = _dates_to_rebuild()
    print(f"rebuild dates: {', '.join(dates) or '(none)'}")
    klines = _load_klines()
    rebuilt = 0
    skipped = 0
    for date_str in dates:
        live_today = date_str == datetime.datetime.now().strftime("%Y-%m-%d")
        if live_today:
            data = fetch_public_market(
                [code for code, _name in A_WATCH],
                [code for code, _name in HK_WATCH],
            )
            print(
                f"  today live hot={len(data.get('hot_stocks') or [])} "
                f"sectors={len(data.get('sectors') or [])} news={len(data.get('news') or [])}"
            )
            DATA_DIR.joinpath("wind-market-latest.json").write_text(
                json.dumps(_build_json_snapshot(data), ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            DATA_DIR.joinpath("wind-hk-market-latest.json").write_text(
                json.dumps(_build_hk_json_snapshot(data), ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        else:
            data = _snapshot_from_kline(date_str, klines)
            if not data:
                print(f"  skip {date_str}: no kline bar")
                skipped += 1
                continue
        if looks_like_credit_failure(data):
            print(f"  skip {date_str}: snapshot still looks like a credit failure")
            skipped += 1
            continue
        _write_recap(date_str, data)
        rebuilt += 1
        print(f"  wrote {date_str}")
    leftover = [p.name for p in CONTENT.glob("market-recap-*.mdx") if _is_broken(p.read_text(encoding="utf-8"))]
    print(f"done rebuilt={rebuilt} skipped={skipped} leftover={leftover}")
    return 1 if leftover else 0


if __name__ == "__main__":
    raise SystemExit(main())

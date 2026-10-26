#!/usr/bin/env python3
"""Quality gate + report sanitizer tests (no network)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from quality import is_publishable, looks_like_credit_failure, payload_quality, scrub_credit_errors
from publisher import publish_to_zorotreeking
from fetcher import build_report
from fallback_eastmoney import bars_as_of, classify_hq_rows, parse_sina_hy_map, quote_from_bars


CREDIT = "原因：账户积分余额不足，无法完成当前操作。官网充值地址： https://market.windalice.co"


def _good():
    return {
        "source": "eastmoney_fallback",
        "indices": [
            {"code": "000001.SH", "name": "上证指数", "price": 3697.5, "change_amount": 7.1, "change_pct": 0.19, "emoji": "🔴"},
            {"code": "399001.SZ", "name": "深证成指", "price": 11534.3, "change_amount": -139.0, "change_pct": -1.19, "emoji": "🟢"},
        ],
        "watchlist": [
            {"code": "600519.SH", "name": "贵州茅台", "price": 1349.98, "change_pct": 1.12, "chg_5d": 1.0, "chg_20d": 2.0, "main_net_5d_yi": 1.2, "emoji": "🔴"},
        ],
        "hot_stocks": [{"name": "中邮科技", "code": "688648.SH", "price": 34.66, "change_pct": 20.01, "is_limit_up": True}],
        "sectors": [{"code": "BK", "name": "银行", "change_pct": 2.0, "lead_stock": "渝农商行", "emoji": "🔴"}],
        "sentiment": {"limit_up": 10, "limit_down": 4, "main_flow_yi": None},
        "news": [],
    }


def test_rejects_credit_error_payload():
    bad = {
        "indices": [{"name": "上证指数", "error": CREDIT}],
        "watchlist": [{"code": "600519.SH", "error": CREDIT}],
        "hot_stocks": [{"error": CREDIT}],
        "sectors": [{"error": CREDIT}],
        "news": [{"error": CREDIT}],
    }
    assert payload_quality(bad)["indices"] == 0
    assert not is_publishable(bad)
    assert looks_like_credit_failure(bad)


def test_accepts_public_quotes():
    assert is_publishable(_good())
    assert not looks_like_credit_failure(_good())


def test_scrub_credit_errors_allows_publish():
    data = _good()
    data["hk_hot_stocks"] = [{"error": CREDIT}]
    data["sentiment"] = {"error": CREDIT, "limit_up": 10, "limit_down": 4}
    assert looks_like_credit_failure(data)
    scrub_credit_errors(data)
    assert data["hk_hot_stocks"] == []
    assert data["sentiment"]["limit_up"] == 10
    assert "error" not in data["sentiment"]
    assert not looks_like_credit_failure(data)
    assert is_publishable(data)


def test_publisher_refuses_unusable_snapshot():
    assert publish_to_zorotreeking("t", "c", {
        "indices": [{"name": "上证指数", "error": CREDIT}],
        "watchlist": [{"code": "600519.SH", "error": CREDIT}],
    }, dry_run=True) is False


def test_quote_from_bars_uses_as_of_close():
    bars = [
        {"date": "2026-10-23", "open": 3670, "close": 3680, "high": 3690, "low": 3660},
        {"date": "2026-10-24", "open": 3681, "close": 3700, "high": 3710, "low": 3670},
        {"date": "2026-10-26", "open": 3671, "close": 3697.52, "high": 3699, "low": 3664},
    ]
    assert bars_as_of(bars, "2026-10-24")[-1]["date"] == "2026-10-24"
    row = quote_from_bars("000001.SH", "上证指数", bars, "2026-10-26")
    assert row is not None
    assert row["price"] == 3697.52
    assert row["change_pct"] == round((3697.52 / 3700 - 1) * 100, 2)
    assert quote_from_bars("000001.SH", "上证指数", bars, "2026-10-25") is None


def test_classify_hq_rows_counts_limits_by_board():
    rows = [
        {"name": "中邮科技", "code": "688648", "changepercent": 20.01},
        {"name": "贵州茅台", "code": "600519", "changepercent": 1.12},
        {"name": "某主板跌停", "code": "600000", "changepercent": -10.0},
        {"name": "平盘", "code": "000001", "changepercent": 0},
        {"name": "北交所深跌", "code": "920285", "changepercent": -29.19},
    ]
    stats = classify_hq_rows(rows)
    assert stats["total"] == 5
    assert stats["ups"] == 2
    assert stats["downs"] == 2
    assert stats["flats"] == 1
    assert stats["limit_up"] == 1
    assert stats["limit_up_breakdown"]["20cm"] == 1
    assert stats["limit_down"] == 1
    assert stats["limit_down_breakdown"]["10cm"] == 1


def test_parse_sina_hy_map_ranks_by_change():
    rows = parse_sina_hy_map({
        "a": "new_a,石油行业,10,1,0,1.77,0,0,sh600000,1,1,1,中海油服",
        "b": "new_b,酿酒行业,8,1,0,1.33,0,0,sz000858,1,1,1,五粮液",
        "c": "new_c,银行,20,1,0,-0.5,0,0,sh601398,1,1,1,工商银行",
    }, size=2)
    assert [row["name"] for row in rows] == ["石油行业", "酿酒行业"]
    assert rows[0]["lead_stock"] == "中海油服"
    assert rows[0]["change_pct"] == 1.77


def test_report_does_not_leak_windalice():
    title, content = build_report(["600519.SH"], prefetched={
        "source": "eastmoney_fallback",
        "indices": [{"name": "上证指数", "error": CREDIT}],
        "watchlist": [{"code": "600519.SH", "error": CREDIT}],
        "hot_stocks": [{"error": CREDIT}],
        "sectors": [{"error": CREDIT}],
        "sentiment": {"error": CREDIT},
        "news": [{"error": CREDIT}],
    })
    assert "windalice" not in content.lower()
    assert "积分余额不足" not in content
    assert "数据暂缺" in content
    assert "东财/腾讯公开行情" in content


def main():
    tests = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    failed = []
    for test in tests:
        try:
            test()
            print(f"  ✓ {test.__name__}")
        except Exception as exc:
            print(f"  ✗ {test.__name__}: {exc}")
            failed.append(test.__name__)
    if failed:
        print(f"❌ {len(failed)} / {len(tests)} 失败")
        return 1
    print(f"✅ {len(tests)} 个测试全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())

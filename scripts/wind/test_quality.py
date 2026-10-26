#!/usr/bin/env python3
"""Quality gate + report sanitizer tests (no network)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from quality import is_publishable, looks_like_credit_failure, payload_quality
from publisher import publish_to_zorotreeking
from fetcher import build_report


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


def test_publisher_refuses_unusable_snapshot():
    assert publish_to_zorotreeking("t", "c", {
        "indices": [{"name": "上证指数", "error": CREDIT}],
        "watchlist": [{"code": "600519.SH", "error": CREDIT}],
    }, dry_run=True) is False


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

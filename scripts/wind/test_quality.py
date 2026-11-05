#!/usr/bin/env python3
"""Quality gate + report sanitizer tests (no network)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from quality import is_publishable, looks_like_credit_failure, payload_quality, scrub_credit_errors
from publisher import publish_to_zorotreeking
from fetcher import build_report
from fallback_eastmoney import (
    bars_as_of, board_sector_rows, build_public_details, classify_hq_rows,
    fill_missing_quotes, parse_sina_hy_map, quote_from_bars,
    _range_52w, _ytd_from_bars, _main_flow_from_rows,
)


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


def test_board_sector_rows_keeps_gainers_and_losers():
    rows = parse_sina_hy_map({
        "a": "new_a,石油行业,10,1,0,1.77,0,0,sh600000,1,1,1,中海油服",
        "b": "new_b,酿酒行业,8,1,0,1.33,0,0,sz000858,1,1,1,五粮液",
        "c": "new_c,银行,20,1,0,-0.5,0,0,sh601398,1,1,1,工商银行",
        "d": "new_d,软件服务,20,1,0,-1.2,0,0,sz000063,1,1,1,中兴通讯",
    }, size=10)
    board = board_sector_rows(rows, up=2, down=2)
    assert [row["name"] for row in board[:2]] == ["石油行业", "酿酒行业"]
    assert [row["name"] for row in board[2:]] == ["银行", "软件服务"]


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


def _partial_wind():
    """Wind 被 QPS 限流打掉几行：深成指报错、宁德时代缺价、涨幅榜全 0、主力资金缺失。"""
    return {
        "source": "wind",
        "indices": [
            {"code": "000001.SH", "name": "上证指数", "price": 3673.92, "change_amount": 65.82, "change_pct": 1.82, "emoji": "🔴"},
            {"code": "399001.SZ", "name": "深证成指", "error": "QPS 限流"},
            {"code": "399006.SZ", "name": "创业板指", "price": 2537.51, "change_amount": 145.86, "change_pct": 6.10, "emoji": "🔴"},
        ],
        "watchlist": [
            {"code": "688981.SH", "name": "中芯国际", "price": 110.60, "change_pct": 8.31, "emoji": "🔴"},
            {"code": "300750.SZ", "name": "宁德时代", "price": 0, "change_pct": 0, "emoji": "⚪"},
        ],
        "hot_stocks": [
            {"name": "贝特利", "code": "301697.SZ", "price": 0.0, "change_pct": 0.0},
        ],
        "sectors": [{"code": "BK1036", "name": "半导体", "change_pct": 10.8, "lead_stock": "新洁能", "emoji": "🔴"}],
        "sentiment": {"limit_up": 114, "limit_down": 11, "main_flow_yi": None},
        "news": [],
    }


def _public_quotes():
    return {
        "indices": [
            {"code": "000001.SH", "name": "上证指数", "price": 3673.92, "change_amount": 65.82, "change_pct": 1.82, "emoji": "🔴"},
            {"code": "399001.SZ", "name": "深证成指", "price": 11307.44, "change_amount": 430.45, "change_pct": 3.96, "emoji": "🔴"},
            {"code": "399006.SZ", "name": "创业板指", "price": 2537.51, "change_amount": 145.86, "change_pct": 6.10, "emoji": "🔴"},
        ],
        "watchlist": [
            {"code": "688981.SH", "name": "中芯国际", "price": 110.60, "change_pct": 8.31, "emoji": "🔴"},
            {"code": "300750.SZ", "name": "宁德时代", "price": 253.80, "change_pct": 1.80, "emoji": "🔴"},
        ],
        "hot_stocks": [
            {"name": "金冠电气", "code": "688517.SH", "price": 21.46, "change_pct": 20.02, "is_limit_up": True},
        ],
        "sectors": [{"code": "BK1", "name": "半导体设备", "change_pct": 14.6, "lead_stock": "托伦斯", "emoji": "🔴"}],
        "sentiment": {"limit_up": 128, "limit_down": 15, "main_flow_yi": 1380.8},
        "news": [],
    }


def test_fill_missing_quotes_repairs_partial_wind_rows():
    data = _partial_wind()
    fill_missing_quotes(data, ["688981.SH", "300750.SZ"], public=_public_quotes())
    names = [row["name"] for row in data["indices"]]
    assert names == ["上证指数", "深证成指", "创业板指"], names
    assert data["indices"][1]["price"] == 11307.44
    watch = {row["code"]: row for row in data["watchlist"]}
    assert watch["300750.SZ"]["price"] == 253.80
    assert data["hot_stocks"][0]["name"] == "金冠电气"
    assert data["sentiment"]["main_flow_yi"] == 1380.8
    # Wind 自己的板块口径（申万一级）不能被东财细分行业顶掉
    assert data["sectors"][0]["name"] == "半导体"
    assert data["source"] == "mixed"


def test_fill_missing_quotes_keeps_good_wind_data():
    data = _partial_wind()
    data["sentiment"]["main_flow_yi"] = 999.9
    data["hot_stocks"] = [{"name": "京仪装备", "code": "688652.SH", "price": 94.13, "change_pct": 20.0}]
    fill_missing_quotes(data, ["688981.SH"], public=_public_quotes())
    assert data["sentiment"]["main_flow_yi"] == 999.9
    assert data["hot_stocks"][0]["name"] == "京仪装备"


def test_fill_missing_quotes_scrubs_credit_errors():
    data = _partial_wind()
    data["details"] = {"688981.SH": {"error": CREDIT}}
    fill_missing_quotes(data, ["688981.SH"], public=_public_quotes())
    assert not looks_like_credit_failure(data)
    assert is_publishable(data)


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



def test_main_flow_from_rows_sums_days():
    """新浪资金流日线按日累加，还原 Wind 的「主力5日净流入」。"""
    rows = [
        {"opendate": "2026-11-04", "netamount": "1000000000"},   # +10亿
        {"opendate": "2026-11-03", "netamount": "-500000000"},   # -5亿
        {"opendate": "2026-11-02", "netamount": "2000000000"},   # +20亿
        {"opendate": "2026-10-31", "netamount": "0"},            # 0
        {"opendate": "2026-10-30", "netamount": "500000000"},    # +5亿
        {"opendate": "2026-10-29", "netamount": "-1000000000"},  # -10亿（第 6 天）
    ]
    out = _main_flow_from_rows(rows)
    assert out["main_net_today_yi"] == 10.0
    assert out["main_net_5d_yi"] == 30.0
    assert out["main_net_10d_yi"] == 20.0
    assert out["main_net_20d_yi"] == 20.0


def test_main_flow_from_rows_ignores_garbage():
    assert _main_flow_from_rows(None) == {}
    assert _main_flow_from_rows([]) == {}
    assert _main_flow_from_rows([{"foo": 1}, "bad"]) == {}

def test_build_public_details_carries_kline():
    data = {
        "watchlist": [
            {"code": "600519.SH", "name": "贵州茅台", "kline_20d": [1, 2, 3]},
            {"code": "300750.SZ", "name": "宁德时代"},   # 没有 kline_20d
        ],
        "hk_watchlist": [{"code": "0981.HK", "name": "中芯国际", "kline_20d": [4, 5]}],
    }
    # 5 位港股写法会被归一化成 4 位（站点路由要求）
    out = build_public_details(data, ["600519.SH", "300750.SZ", "00981.HK"])
    assert set(out) == {"600519.SH", "300750.SZ", "0981.HK"}
    assert out["600519.SH"]["kline_20d"] == [1, 2, 3]
    assert out["600519.SH"]["source"] == "public"
    # 缺 kline 也要有条目，否则 publisher 不写详情快照，页面就一直冻在旧数据
    assert out["300750.SZ"] == {"source": "public"}
    assert out["0981.HK"]["kline_20d"] == [4, 5]


def test_build_public_details_filters_by_detail_codes():
    data = {"watchlist": [{"code": "600519.SH", "kline_20d": [1]},
                          {"code": "300750.SZ", "kline_20d": [2]}]}
    assert set(build_public_details(data, ["300750.SZ"])) == {"300750.SZ"}


def test_ytd_from_bars_uses_previous_year_close():
    bars = [
        {"date": "2025-12-30", "close": 100.0, "high": 101, "low": 99},
        {"date": "2025-12-31", "close": 102.0, "high": 103, "low": 98},
        {"date": "2026-01-02", "close": 105.0, "high": 106, "low": 101},
        {"date": "2026-11-04", "close": 112.2, "high": 115, "low": 104},
    ]
    # 基准是 2025 最后一个交易日 102 → +10%，不是"近一年"涨幅
    assert _ytd_from_bars(bars) == 10.0
    assert _ytd_from_bars([]) is None
    assert _ytd_from_bars([{"date": "2026-11-04", "close": 1}]) is None


def test_range_52w_uses_high_low():
    bars = [
        {"date": "2025-12-30", "close": 100.0, "high": 101, "low": 99},
        {"date": "2025-12-31", "close": 102.0, "high": 103, "low": 98},
        {"date": "2026-11-04", "close": 112.2, "high": 115, "low": 104},
    ]
    assert _range_52w(bars) == (115.0, 98.0)
    assert _range_52w([]) == (None, None)


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
scripts/wind 纯函数单元测试（无 Wind / 网络依赖）。
跑法：python3 test_fetcher.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fetcher import (
    _emoji, _fmt_price, _fmt_pct, _fmt_yi,
    _to_float, _to_wind, _price_limit, _limit_tag,
    _row_to_dict, _rows_to_dicts,
)


def test_emoji():
    assert _emoji(0.5) == "🔴"
    assert _emoji(-0.5) == "🟢"
    assert _emoji(0) == "⚪"
    assert _emoji(0.0) == "⚪"


def test_fmt_price():
    assert _fmt_price(1234.5678) == "1234.57"
    assert _fmt_price(0) == "--"
    assert _fmt_price(None) == "--"
    assert _fmt_price("") == "--"
    assert _fmt_price("abc") == "--"
    assert _fmt_price(0.001) == "0.00"  # 边界：> 0 但太小四舍五入到 0.00


def test_fmt_pct():
    assert _fmt_pct(1.5) == "+1.50%"
    assert _fmt_pct(-2.0) == "-2.00%"
    assert _fmt_pct(0) == "+0.00%"
    assert _fmt_pct(None) == "--"


def test_fmt_yi():
    assert _fmt_yi(1.5) == "+1.50亿"
    assert _fmt_yi(-2.0) == "-2.00亿"
    assert _fmt_yi(None) == "--"


def test_to_float_nan():
    """Bug 4 修复：NaN 兜底"""
    assert _to_float("nan") == 0.0  # float('nan') 不抛错但应被识别为 NaN
    assert _to_float(float("nan")) == 0.0
    assert _to_float(None) == 0.0
    assert _to_float("") == 0.0
    assert _to_float("abc") == 0.0
    assert _to_float("1.5") == 1.5
    assert _to_float(1.5) == 1.5
    assert _to_float(None, default=-1) == -1


def test_to_wind():
    """Bug 3 修复：纯数字代码按起首数字推断后缀"""
    # 已是 Wind 格式
    assert _to_wind("600519.SH") == "600519.SH"
    assert _to_wind("600519.sh") == "600519.SH"  # 小写后缀也转大写
    # 旧 sina 格式
    assert _to_wind("sh600519") == "600519.SH"
    assert _to_wind("sz000858") == "000858.SZ"
    assert _to_wind("bj920725") == "920725.BJ"
    assert _to_wind("SH600519") == "600519.SH"  # 大写前缀也行
    # 纯 6 位数字（新增）
    assert _to_wind("600519") == "600519.SH"
    assert _to_wind("000858") == "000858.SZ"
    assert _to_wind("300750") == "300750.SZ"
    assert _to_wind("920725") == "920725.BJ"
    # 空值
    assert _to_wind("") == ""
    assert _to_wind(None) == ""
    # 无法识别（兜底返回 upper，但记 warning）
    assert _to_wind("xyz") == "XYZ"


def test_price_limit():
    """涨跌停板上限百分比"""
    # ST 一律 5%
    assert _price_limit("*ST 神州", "600519.SH") == 5
    assert _price_limit("ST华亿", "600519.SH") == 5
    # 北交所 30%
    assert _price_limit("惠丰钻石", "920725.BJ") == 30
    assert _price_limit("惠丰钻石", "bj920725") == 30
    # 科创板 / 创业板 20%
    assert _price_limit("中芯国际", "688981.SH") == 20
    assert _price_limit("宁德时代", "300750.SZ") == 20
    assert _price_limit("光智科技", "300489.SZ") == 20
    assert _price_limit("某创业板", "301565.SZ") == 20
    assert _price_limit("某科创板", "sh688981") == 20
    # 主板 10%
    assert _price_limit("贵州茅台", "600519.SH") == 10
    assert _price_limit("中国平安", "601318.SH") == 10
    assert _price_limit("五粮液", "000858.SZ") == 10


def test_limit_tag():
    """触及涨停板时返回 🚀"""
    # 创业板 20%，19.8% 算触及
    assert _limit_tag("中仑新材", "301565.SZ", 19.8) == " 🚀"
    assert _limit_tag("中仑新材", "301565.SZ", 20.02) == " 🚀"
    # 主板 10%，9.7% 算触及（>= 10 - 0.3）
    assert _limit_tag("贵州茅台", "600519.SH", 9.7) == " 🚀"
    assert _limit_tag("贵州茅台", "600519.SH", 10.0) == " 🚀"
    # 主板 5% 远低于 9.7% 阈值
    assert _limit_tag("贵州茅台", "600519.SH", 5.0) == ""


def test_row_to_dict():
    data = {
        "columns": [{"name": "code"}, {"name": "price"}],
        "rows": [["600519.SH", 1308.0]],
    }
    assert _row_to_dict(data) == {"code": "600519.SH", "price": 1308.0}
    assert _row_to_dict({}) == {}
    assert _row_to_dict({"columns": [], "rows": []}) == {}
    assert _row_to_dict(None) == {}


def test_rows_to_dicts():
    data = {
        "columns": [{"name": "code"}, {"name": "name"}],
        "rows": [["600519.SH", "茅台"], ["000858.SZ", "五粮液"]],
    }
    assert _rows_to_dicts(data) == [
        {"code": "600519.SH", "name": "茅台"},
        {"code": "000858.SZ", "name": "五粮液"},
    ]
    assert _rows_to_dicts({}) == []
    assert _rows_to_dicts(None) == []


# ── runner ──
def main():
    tests = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    failed = []
    for t in tests:
        try:
            t()
            print(f"  ✓ {t.__name__}")
        except AssertionError as e:
            print(f"  ✗ {t.__name__}: {e}")
            failed.append(t.__name__)
        except Exception as e:
            print(f"  💥 {t.__name__}: {type(e).__name__}: {e}")
            failed.append(t.__name__)
    print()
    if failed:
        print(f"❌ {len(failed)} / {len(tests)} 失败: {failed}")
        return 1
    print(f"✅ {len(tests)} 个测试全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())

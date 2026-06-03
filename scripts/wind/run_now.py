#!/usr/bin/env python3
"""
手动触发入口（调试用）。
无视交易日检查 / 各种 dry-run 开关 / 临时覆盖股票池。

常见用法：
  python3 run_now.py                       # 完整收盘流程（拉数据 + 推微信 + 归档）
  python3 run_now.py --mode open           # 开盘版（A 股 + 推微信，不拉港股 不归档）
  python3 run_now.py --dry-run             # 拉数据但不推 不归档（最常用调试）
  python3 run_now.py --dry-run --print     # 上面 + 把 markdown 打印到终端
  python3 run_now.py --no-push             # 跳推送（看归档效果）
  python3 run_now.py --no-archive          # 跳归档（看微信效果）
  python3 run_now.py --codes 600519.SH     # 临时只测一只股
  python3 run_now.py --codes 600519.SH --hk-codes 01810.HK
  python3 run_now.py --check-holiday       # 仅校验今天是否交易日，不跑数据
"""

import argparse
import datetime
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def _setup_logging():
    fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    logging.basicConfig(level=logging.INFO, format=fmt, datefmt="%H:%M:%S",
                         stream=sys.stdout, force=True)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Wind 日报手动触发器（调试用）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--mode", choices=["open", "close"], default="close",
                        help="open=轻量(仅 A 股，不归档)；close=完整(A+HK+单股深度+归档) (默认 close)")
    parser.add_argument("--no-push", action="store_true",
                        help="跳过微信推送")
    parser.add_argument("--no-archive", action="store_true",
                        help="跳过归档到 zoro repo（mode=close 时有效）")
    parser.add_argument("--dry-run", action="store_true",
                        help="等同 --no-push --no-archive，仅拉数据")
    parser.add_argument("--print", action="store_true", dest="print_md",
                        help="把生成的 markdown 日报打印到终端")
    parser.add_argument("--ignore-holiday", action="store_true", default=True,
                        help="无视交易日检查（默认开，调试方便；用 --respect-holiday 关）")
    parser.add_argument("--respect-holiday", dest="ignore_holiday", action="store_false",
                        help="尊重交易日检查（非交易日直接退出）")
    parser.add_argument("--codes", default=None,
                        help="临时 A 股代码（逗号分隔），覆盖 .env STOCK_CODES")
    parser.add_argument("--hk-codes", default=None,
                        help="临时港股代码（逗号分隔），覆盖 .env HK_STOCK_CODES")
    parser.add_argument("--check-holiday", action="store_true",
                        help="仅校验今天是否交易日，不跑数据")
    args = parser.parse_args()

    _setup_logging()
    log = logging.getLogger("wind.run_now")

    from dotenv import load_dotenv  # type: ignore
    load_dotenv()

    from holidays import is_trading_day

    today = datetime.datetime.now()
    trading = is_trading_day()

    if args.check_holiday:
        weekday = ["一", "二", "三", "四", "五", "六", "日"][today.weekday()]
        status = "✅ 交易日" if trading else "❌ 非交易日（周末/节假日）"
        print(f"{today.strftime('%Y-%m-%d')} 星期{weekday}：{status}")
        return 0

    if not trading and not args.ignore_holiday:
        log.info(f"⏸️  {today.isoformat(timespec='minutes')} 非交易日（用 --ignore-holiday 强制）")
        return 0
    if not trading:
        log.warning(f"⚠️  今天不是交易日（{today.strftime('%Y-%m-%d')}），数据可能是上个交易日的，--ignore-holiday 已开")

    # 解析股票池
    if args.codes is not None:
        stock_codes = [c.strip() for c in args.codes.split(",") if c.strip()]
    else:
        stock_codes = [c.strip() for c in os.getenv("STOCK_CODES", "").split(",") if c.strip()]
    if args.hk_codes is not None:
        hk_codes = [c.strip() for c in args.hk_codes.split(",") if c.strip()]
    else:
        hk_codes = [c.strip() for c in os.getenv("HK_STOCK_CODES", "").split(",") if c.strip()]

    if not stock_codes:
        log.error("❌ STOCK_CODES 未配置（用 --codes 或 .env）")
        return 1

    # dry-run 等同两个 skip 都开
    if args.dry_run:
        args.no_push = True
        args.no_archive = True

    log.info(f"🛠  run_now: mode={args.mode} push={'❌' if args.no_push else '✅'} "
             f"archive={'❌' if args.no_archive else '✅'} dry_run={args.dry_run}")
    log.info(f"📋 A 股: {stock_codes}")
    if args.mode == "close":
        log.info(f"📋 港股: {hk_codes or '(skip)'}")

    # 数据拉取（按 mode）
    from fetcher import fetch_all_data, build_report, _to_wind

    if args.mode == "open":
        # 开盘版：只拉 A 股 + 大盘等
        data = fetch_all_data(stock_codes)
    else:
        # 收盘版：A + HK + 单股深度
        detail_codes = [_to_wind(c) for c in stock_codes]
        if hk_codes:
            for raw in hk_codes:
                code = raw.upper()
                if "." not in code:
                    code = f"{code}.HK"
                detail_codes.append(code)
        data = fetch_all_data(stock_codes,
                              hk_stock_codes=hk_codes or None,
                              detail_codes=detail_codes)

    title, content = build_report(stock_codes, prefetched=data)
    log.info(f"✅ 数据完成，标题：{title}")

    # 打印 markdown
    if args.print_md:
        print()
        print("=" * 50)
        print(content)
        print("=" * 50)
        print()

    # 微信推送
    if not args.no_push:
        from wechat import push_via_pushplus, push_via_serverchan
        sc_key = os.getenv("SERVERCHAN_KEY", "").strip()
        pp_token = os.getenv("PUSHPLUS_TOKEN", "").strip()
        if sc_key and not sc_key.startswith("your_"):
            push_via_serverchan(sc_key, title, content)
        elif pp_token and not pp_token.startswith("your_"):
            push_via_pushplus(pp_token, title, content)
        else:
            log.warning("⚠️  未配置推送 token，跳过推送")
    else:
        log.info("⏭️  --no-push 跳过微信推送")

    # 归档（仅 close mode）
    if args.mode == "close":
        if not args.no_archive:
            from publisher import publish_to_zorotreeking
            try:
                ok = publish_to_zorotreeking(title, content, data,
                                              force=True, dry_run=False)
                log.info(f"📤 归档结果: {'ok' if ok else 'failed'}")
            except Exception as e:
                log.warning(f"⚠️  归档异常: {e}")
        else:
            log.info("⏭️  --no-archive 跳过归档")

    log.info("🎉 run_now 完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
收盘版（15:30 BJT）：抓 A 股 + 港股 + 单股深度 → 微信推送 → 归档到 zoro repo → 触发 deploy。
由 systemd timer 触发；非交易日自动跳过。

环境变量（写在 /opt/wind-recap/.env 或 systemd EnvironmentFile）：
  STOCK_CODES                A 股观察池
  HK_STOCK_CODES             港股观察池（留空则不拉港股）
  SERVERCHAN_KEY             Server酱微信推送 key
  PUSHPLUS_TOKEN             备选
  GITHUB_TOKEN               触发 publisher 走 API 模式（避开 github.com:443）
  GITHUB_REPO                默认 lzf00/zorotreeking
  GITHUB_BRANCH              默认 main
  ZOROTREEKING_REPO_PATH     可选；仅 GITHUB_TOKEN 未设时用，指向本地 git clone
  WIND_API_KEY               在 ~/.wind-aifinmarket/config 里
"""

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
    _setup_logging()
    log = logging.getLogger("wind.run_close")

    from dotenv import load_dotenv  # type: ignore
    load_dotenv()

    from fetcher import build_report, fetch_all_data, _to_wind
    from wechat import push_via_pushplus, push_via_serverchan
    from publisher import publish_to_zorotreeking
    from holidays import is_trading_day

    if not is_trading_day():
        log.info(f"⏸️  {datetime.datetime.now().isoformat(timespec='minutes')} 非交易日，跳过")
        return 0

    stock_codes = [c.strip() for c in os.getenv("STOCK_CODES", "").split(",") if c.strip()]
    hk_codes = [c.strip() for c in os.getenv("HK_STOCK_CODES", "").split(",") if c.strip()]
    if not stock_codes:
        log.error("❌ STOCK_CODES 未配置")
        return 1

    log.info(f"📊 [close] 拉数据 {datetime.datetime.now().isoformat(timespec='seconds')}")
    log.info(f"📋 A 股: {stock_codes}")
    log.info(f"📋 港股: {hk_codes or '(skip)'}")

    # 收盘版：A 股 + 港股 + 全部 watchlist 的单股深度详情
    detail_codes = [_to_wind(c) for c in stock_codes]
    if hk_codes:
        for raw in hk_codes:
            code = raw.upper()
            if "." not in code:
                code = f"{code}.HK"
            detail_codes.append(code)

    data = fetch_all_data(stock_codes, hk_stock_codes=hk_codes or None, detail_codes=detail_codes)
    title, content = build_report(stock_codes, prefetched=data)
    log.info(f"✅ 数据完成，标题：{title}")

    # 微信推送
    sc_key = os.getenv("SERVERCHAN_KEY", "").strip()
    pp_token = os.getenv("PUSHPLUS_TOKEN", "").strip()
    if sc_key and not sc_key.startswith("your_"):
        push_via_serverchan(sc_key, title, content)
    elif pp_token and not pp_token.startswith("your_"):
        push_via_pushplus(pp_token, title, content)
    else:
        log.warning("⚠️  未配置推送 token")

    # 归档到 zoro repo（写文件 + git push 触发部署）
    try:
        ok = publish_to_zorotreeking(title, content, data, force=True, dry_run=False)
        log.info(f"📤 归档结果: {'ok' if ok else 'failed'}")
    except Exception as e:
        log.warning(f"⚠️  归档异常（不影响主流程）: {e}")

    return 0


if __name__ == "__main__":
    sys.exit(main())

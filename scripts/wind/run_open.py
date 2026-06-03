#!/usr/bin/env python3
"""
开盘版（10:30 BJT）：只抓数 + 微信推送，不归档到 zoro repo。
由 systemd timer 触发；非交易日自动跳过。

环境变量（写在 /opt/wind-recap/.env 或 systemd EnvironmentFile）：
  STOCK_CODES        A 股观察池（逗号分隔，Wind 格式 600519.SH 或旧 sh600519）
  HK_STOCK_CODES     港股观察池（开盘版不拉港股，留空即可）
  SERVERCHAN_KEY     Server酱微信推送 key
  PUSHPLUS_TOKEN     pushplus 备选
  WIND_API_KEY       存在 ~/.wind-aifinmarket/config（wind-mcp-skill 自动读）
"""

import datetime
import logging
import os
import sys
from pathlib import Path

# 让本目录可作为模块被导入
sys.path.insert(0, str(Path(__file__).resolve().parent))


def _setup_logging():
    """根 logger 统一配置；systemd journal 自动收集 stdout/stderr 并按 PRIORITY 分级"""
    fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    logging.basicConfig(level=logging.INFO, format=fmt, datefmt="%H:%M:%S",
                         stream=sys.stdout, force=True)


def main() -> int:
    _setup_logging()
    log = logging.getLogger("wind.run_open")

    from dotenv import load_dotenv  # type: ignore
    load_dotenv()

    from fetcher import build_report, fetch_all_data
    from wechat import push_via_pushplus, push_via_serverchan
    from holidays import is_trading_day

    if not is_trading_day():
        log.info(f"⏸️  {datetime.datetime.now().isoformat(timespec='minutes')} 非交易日，跳过")
        return 0

    stock_codes = [c.strip() for c in os.getenv("STOCK_CODES", "").split(",") if c.strip()]
    if not stock_codes:
        log.error("❌ STOCK_CODES 未配置")
        return 1

    log.info(f"📊 [open] 拉数据 {datetime.datetime.now().isoformat(timespec='seconds')}")
    log.info(f"📋 A 股观察池: {stock_codes}")

    # 开盘版只拉 A 股大盘 + watchlist 基础数据；不拉港股、不拉单股深度
    data = fetch_all_data(stock_codes)
    title, content = build_report(stock_codes, prefetched=data)
    log.info(f"✅ 数据完成，标题：{title}")

    sc_key = os.getenv("SERVERCHAN_KEY", "").strip()
    pp_token = os.getenv("PUSHPLUS_TOKEN", "").strip()
    if sc_key and not sc_key.startswith("your_"):
        push_via_serverchan(sc_key, title, content)
    elif pp_token and not pp_token.startswith("your_"):
        push_via_pushplus(pp_token, title, content)
    else:
        log.warning("⚠️  未配置推送 token，仅本地输出")
        print("=" * 50)
        print(title)
        print(content)

    return 0


if __name__ == "__main__":
    sys.exit(main())

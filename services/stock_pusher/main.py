"""
Zoro AI 股票助手 - 主程序
每日定时推送股票行情到微信
"""

import os
import sys
import time
import datetime
import schedule
from dotenv import load_dotenv

from stock_fetcher import build_report, fetch_all_data
from wechat_pusher import push_via_pushplus, push_via_serverchan
from zorotreeking_publisher import publish_to_zorotreeking

# 加载环境变量
load_dotenv()


# A 股法定节假日（休市日）—— 每年 11~12 月国务院公布次年安排后需更新
# A 股调休补班日不交易，故只需登记假日即可
STOCK_HOLIDAYS = {
    # === 2025 ===
    "2025-01-01",                                                   # 元旦
    "2025-01-28", "2025-01-29", "2025-01-30", "2025-01-31",         # 春节
    "2025-02-03", "2025-02-04",
    "2025-04-04",                                                   # 清明
    "2025-05-01", "2025-05-02", "2025-05-05",                       # 劳动节
    "2025-05-31", "2025-06-02",                                     # 端午
    "2025-10-01", "2025-10-02", "2025-10-03",                       # 国庆+中秋
    "2025-10-06", "2025-10-07", "2025-10-08",
    # === 2026 ===（按国务院公告，发布后请校对更新）
    "2026-01-01", "2026-01-02",                                     # 元旦
    "2026-02-16", "2026-02-17", "2026-02-18",                       # 春节
    "2026-02-19", "2026-02-20", "2026-02-23", "2026-02-24",
    "2026-04-06",                                                   # 清明
    "2026-05-01", "2026-05-04", "2026-05-05",                       # 劳动节
    "2026-06-19", "2026-06-22",                                     # 端午
    "2026-09-25",                                                   # 中秋
    "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06",         # 国庆
    "2026-10-07", "2026-10-08",
}


def get_config():
    """读取配置"""
    pushplus_token = os.getenv("PUSHPLUS_TOKEN", "")
    serverchan_key = os.getenv("SERVERCHAN_KEY", "")
    stock_codes_str = os.getenv("STOCK_CODES", "sh600519,sh601318,sz000858")
    hk_stock_codes_str = os.getenv("HK_STOCK_CODES", "")
    push_times_str = os.getenv("PUSH_TIMES", "10:30,15:30")

    stock_codes = [c.strip() for c in stock_codes_str.split(",") if c.strip()]
    hk_stock_codes = [c.strip() for c in hk_stock_codes_str.split(",") if c.strip()]
    push_times = [t.strip() for t in push_times_str.split(",") if t.strip()]

    return {
        "pushplus_token": pushplus_token,
        "serverchan_key": serverchan_key,
        "stock_codes": stock_codes,
        "hk_stock_codes": hk_stock_codes,
        "push_times": push_times,
    }


def is_trading_day(date=None):
    """
    判断是否为 A 股交易日。
    - 周末非交易
    - 命中 STOCK_HOLIDAYS 非交易
    （A 股调休补班日不交易，无需单独维护补班列表）
    """
    if date is None:
        date = datetime.datetime.now()
    if date.weekday() >= 5:
        return False
    if date.strftime("%Y-%m-%d") in STOCK_HOLIDAYS:
        return False
    return True


def run_push():
    """执行一次推送"""
    if not is_trading_day():
        print(f"⏸️ 今天非交易日（周末或法定节假日），跳过推送")
        return

    config = get_config()
    stock_codes = config["stock_codes"]

    print(f"📊 开始获取股票数据... ({datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')})")
    print(f"📋 关注股票: {stock_codes}")

    try:
        # 一次拉全部 Wind 数据，给 build_report 和 publisher 复用，避免重复调用
        # 港股 + 单股深度详情仅在收盘版（15:00 后）触发，避免日常推送耗时过长
        from datetime import datetime as _dt
        is_archive_window = _dt.now().hour >= 15
        hk_codes = config.get("hk_stock_codes") if is_archive_window else None
        detail_codes = None
        if is_archive_window:
            # 深度详情：合并 A 股 + 港股 所有 watchlist
            detail_codes = []
            for raw in stock_codes:
                # 借用 stock_fetcher 内部的 _to_wind 转格式（避免重复维护转换器）
                from stock_fetcher import _to_wind
                detail_codes.append(_to_wind(raw))
            if hk_codes:
                for raw in hk_codes:
                    code = (raw or "").strip().upper()
                    if "." not in code:
                        code = f"{code}.HK"
                    detail_codes.append(code)
        data = fetch_all_data(stock_codes, hk_stock_codes=hk_codes, detail_codes=detail_codes)
        title, content = build_report(stock_codes, prefetched=data)
        print(f"✅ 数据获取完成，开始推送...")

        # Server酱 推送（优先）
        if config["serverchan_key"] and config["serverchan_key"] != "your_serverchan_key_here":
            push_via_serverchan(config["serverchan_key"], title, content)
        # pushplus 推送
        elif config["pushplus_token"] and config["pushplus_token"] != "your_pushplus_token_here":
            push_via_pushplus(config["pushplus_token"], title, content)
        else:
            print("⚠️ 未配置推送token！请编辑 .env 文件")
            print("=" * 50)
            print(f"标题: {title}")
            print(content)

        # 收盘版归档到 zorotreeking 网站（仅 15:00 后触发；不影响微信推送结果）
        try:
            publish_to_zorotreeking(title, content, data)
        except Exception as e:
            print(f"⚠️ zorotreeking 归档异常（不影响主流程）: {e}")

    except Exception as e:
        print(f"❌ 推送失败: {e}")
        import traceback
        traceback.print_exc()


def main():
    """主函数"""
    config = get_config()
    push_times = config["push_times"]

    print("=" * 50)
    print("🤖 Zoro AI 股票助手 启动")
    print(f"⏰ 每日推送时间: {push_times}")
    print(f"📋 关注股票: {config['stock_codes']}")
    print("=" * 50)

    # 检查命令行参数
    if len(sys.argv) > 1 and sys.argv[1] == "--now":
        print("🚀 立即执行推送...")
        run_push()
        return

    # 设置多个定时任务
    for t in push_times:
        schedule.every().day.at(t).do(run_push)
        print(f"✅ 定时任务已设置: 每天 {t}")

    print("🔄 等待执行中...")

    while True:
        schedule.run_pending()
        time.sleep(30)


if __name__ == "__main__":
    main()

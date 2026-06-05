"""
股票数据获取模块 (Wind 版)
通过 wind-mcp-skill 的 CLI 调用万得金融数据
依赖：~/.agents/skills/wind-mcp-skill + 已配置的 WIND_API_KEY (skill setup-key)
"""

import datetime
import glob
import json
import logging
import os
import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import quote


# 模块 logger 不自己加 handler，依赖入口 (run_open/close/now) 配置 root logger。
# 单独脚本直接 import 此模块时，basicConfig 仍能兜底（PY 3.2+ NullHandler 不报错）。
log = logging.getLogger("wind.fetcher")


# Wind CLI 入口；本机默认 ~/.agents/skills/wind-mcp-skill，服务器走
# 环境变量 WIND_SKILL_DIR=/opt/wind-mcp-skill 覆盖
WIND_SKILL_DIR = os.environ.get(
    "WIND_SKILL_DIR",
    str(Path.home() / ".agents/skills/wind-mcp-skill"),
)

# 并发拉取的最大 worker 数（避免 Wind 后端 "并发请求次数超限"）
# 实测 4-6 比较稳；环境变量 WIND_MAX_WORKERS 可覆盖
WIND_MAX_WORKERS = int(os.environ.get("WIND_MAX_WORKERS", "5"))


def _find_node() -> str:
    """
    定位 node 可执行文件，优先级：
    1. NODE_BIN 环境变量（强制覆盖）
    2. PATH 中的 node
    3. 常见系统路径（mac homebrew、Linux /usr/local、/usr）
    4. nvm 路径（~/.nvm/versions/node/*/bin/node 取最新）
    """
    forced = os.environ.get("NODE_BIN", "").strip()
    if forced and os.path.exists(forced):
        return forced

    p = shutil.which("node")
    if p:
        return p

    for candidate in [
        "/opt/homebrew/opt/node@22/bin/node",
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ]:
        if os.path.exists(candidate):
            return candidate

    # nvm（mac + linux 通用）
    nvm_versions = sorted(glob.glob(str(Path.home() / ".nvm/versions/node/*/bin/node")))
    if nvm_versions:
        return nvm_versions[-1]  # 取最新版本

    return "node"  # 兜底；找不到时会在调用处报清晰错误


NODE_BIN = _find_node()
WIND_CLI = [NODE_BIN, "scripts/cli.mjs"]

# 给 Wind CLI 子进程一个完整 PATH（launchd / systemd 默认 PATH 很窄）
_EXTRA_PATH = ":".join([
    "/opt/homebrew/bin",
    "/opt/homebrew/opt/node@22/bin",
    "/usr/local/bin",
    str(Path.home() / ".nvm/versions/node/v22/bin"),  # nvm 兜底
])

# A 股大盘指数（Wind code -> 显示名）
INDEX_LIST = [
    ("000001.SH", "上证指数"),
    ("399001.SZ", "深证成指"),
    ("399006.SZ", "创业板指"),
]

# 港股大盘指数
INDEX_LIST_HK = [
    ("HSI.HI", "恒生指数"),
    ("HSCEI.HI", "国企指数"),
    ("HSTECH.HI", "恒生科技"),
]


# -------------------- 通用工具 --------------------

def _emoji(pct: float) -> str:
    """红涨、绿跌、白平"""
    if pct > 0:
        return "🔴"
    if pct < 0:
        return "🟢"
    return "⚪"


def _fmt_price(value) -> str:
    """格式化价格；空/0/异常显示 '--'"""
    try:
        v = float(value)
        return f"{v:.2f}" if v > 0 else "--"
    except (ValueError, TypeError):
        return "--"


def _to_float(value, default=0.0) -> float:
    """安全转 float（Wind 字段可能是 str / number / None）；NaN 也兜底"""
    try:
        if value is None or value == "":
            return default
        v = float(value)
        if v != v:  # NaN 检测（NaN != NaN）
            return default
        return v
    except (ValueError, TypeError):
        return default


def _price_limit(name: str, code: str) -> int:
    """涨跌停板上限百分比；兼容 Wind (600519.SH) 与旧格式 (sh600519)"""
    if "ST" in (name or "").upper():
        return 5
    c = (code or "").lower()
    # 北交所（Wind: 920725.bj / 旧: bj920725）
    if c.endswith(".bj") or c.startswith("bj"):
        return 30
    # 剥离交易所前后缀，按纯数字代码判定
    bare = c.replace(".sh", "").replace(".sz", "").replace(".bj", "")
    bare = bare.replace("sh", "", 1).replace("sz", "", 1).replace("bj", "", 1)
    # 科创板 688 / 创业板 300、301
    if bare.startswith("688") or bare.startswith("300") or bare.startswith("301"):
        return 20
    return 10


def _limit_tag(name: str, code: str, pct: float) -> str:
    """触及涨停板时返回 🚀 标记"""
    limit = _price_limit(name, code)
    if pct >= limit - 0.3:
        return " 🚀"
    return ""


def _to_wind(code: str) -> str:
    """
    标准化为 Wind 格式代码
    - 600519.SH / sh600519 / 600519 → 600519.SH
    - 6 位纯数字 → 按起首数字推断（6→SH，0/3→SZ，4/8/9→BJ）
    - 已含 . 后缀直接 upper
    - 无法识别返回原始 upper（调用方会拿到 Wind 错误，能定位）
    """
    code = (code or "").strip()
    if not code:
        return ""
    if "." in code:
        return code.upper()
    c = code.lower()
    if c.startswith("sh"):
        return f"{c[2:]}.SH"
    if c.startswith("sz"):
        return f"{c[2:]}.SZ"
    if c.startswith("bj"):
        return f"{c[2:]}.BJ"
    # 纯数字：按 A 股代码规则推断后缀
    if c.isdigit() and len(c) == 6:
        first = c[0]
        if first == "6":
            return f"{c}.SH"
        if first in ("0", "3"):
            return f"{c}.SZ"
        if first in ("4", "8", "9"):
            return f"{c}.BJ"
    log.warning(f"⚠️ _to_wind: 无法识别代码格式 {code!r}，原样返回")
    return code.upper()


# -------------------- Wind CLI 调用 --------------------

def _wind_call(server_type: str, tool_name: str, params: dict,
               timeout: int = 60, retries: int = 3, base_delay: float = 1.5):
    """
    调用 Wind CLI 子进程
    返回解析后的 inner['data']（具体结构因工具而异）
    失败抛 RuntimeError；指数退避：base_delay * 2^i (1.5s → 3s → 6s)
    """
    cmd = WIND_CLI + ["call", server_type, tool_name,
                      json.dumps(params, ensure_ascii=False)]
    # 给子进程注入完整 PATH（兼容 launchd / cron / systemd 等窄 PATH 环境）
    env = os.environ.copy()
    env["PATH"] = f"{_EXTRA_PATH}:{env.get('PATH','')}"
    for i in range(retries):
        try:
            r = subprocess.run(
                cmd, cwd=WIND_SKILL_DIR, env=env,
                capture_output=True, text=True, timeout=timeout
            )
            stdout = (r.stdout or "").strip()
            if not stdout:
                raise RuntimeError(f"empty stdout (exit={r.returncode}): {(r.stderr or '').strip()[:300]}")

            # CLI 包装层：{"content":[{"type":"text","text":"<inner json>"}], "isError":bool}
            # 也可能是错误 envelope：{"ok": false, "error": {...}}
            outer = json.loads(stdout)
            if outer.get("ok") is False:
                err = outer.get("error", {})
                raise RuntimeError(f"{err.get('code','ERR')}: {err.get('agent_action', str(err))[:200]}")
            if outer.get("isError"):
                raise RuntimeError(f"CLI returned isError: {str(outer)[:300]}")

            inner_text = outer["content"][0]["text"]
            inner = json.loads(inner_text)
            if inner.get("error"):
                raise RuntimeError(f"data error: {inner['error']}")
            return inner.get("data")
        except Exception as e:
            if i < retries - 1:
                delay = base_delay * (2 ** i)
                log.warning(f"⚠️ Wind 调用 {server_type}.{tool_name} 失败（第 {i+1}/{retries} 次），{delay:.1f}s 后重试: {e}")
                time.sleep(delay)
            else:
                raise RuntimeError(f"{server_type}.{tool_name} -> {e}") from e


def _row_to_dict(data: dict) -> dict:
    """data={'columns':[{'name':...}], 'rows':[[...]]}; 取第一行 dict"""
    if not data:
        return {}
    cols = [c["name"] for c in data.get("columns", [])]
    rows = data.get("rows", [])
    if not rows:
        return {}
    return dict(zip(cols, rows[0]))


def _rows_to_dicts(data: dict) -> list:
    if not data:
        return []
    cols = [c["name"] for c in data.get("columns", [])]
    return [dict(zip(cols, row)) for row in data.get("rows", [])]


def get_kline_closes(wind_code: str, n: int = 5, hk: bool = False) -> list:
    """
    取近 n 个交易日收盘价（含今天，时间升序）。前端 sparkline 用。

    Wind tool: stock_data.get_stock_kline (A 股) / global_stock_data.get_global_stock_kline (港股)
    返回字段顺序：[TIME, OPEN, MATCH(收盘), HIGH, LOW, ...]
    """
    today = datetime.datetime.now()
    # 拉 14 天保险（含周末 + 节假日），最后截 n 个
    begin = today - datetime.timedelta(days=14)
    server = "global_stock_data" if hk else "stock_data"
    tool = "get_global_stock_kline" if hk else "get_stock_kline"
    try:
        data = _wind_call(server, tool, {
            "windcode": wind_code,
            "begin_date": begin.strftime("%Y%m%d"),
            "end_date": today.strftime("%Y%m%d"),
        }, retries=2)
        rows = data.get("rows", [])
        cols = [c.get("name") for c in data.get("columns", [])]
        if "MATCH" not in cols:
            return []
        idx = cols.index("MATCH")
        closes = [_to_float(r[idx]) for r in rows if r and r[idx] is not None]
        # 过滤 0（停牌 / 异常）后取最后 n 个
        closes = [c for c in closes if c > 0]
        return closes[-n:]
    except Exception as e:
        log.warning(f"⚠️ get_kline_closes({wind_code}) 失败: {e}")
        return []


# -------------------- 业务取数 --------------------

def get_stock_data(stock_codes: list) -> list:
    """
    获取自选股实时行情（含多周期涨跌幅与主力资金）
    入参：股票代码列表（Wind 格式 600519.SH 或旧格式 sh600519 都支持）
    """
    indexes = (
        "中文简称,最新成交价,前收盘价,今日开盘价,今日最高价,今日最低价,"
        "成交额,涨跌幅,振幅,换手率,"
        "5日涨跌幅,20日涨跌幅,年初至今涨跌幅,"
        "市盈率(TTM),市净率,股息率,52周最高,52周最低,"
        "当日主力净流入额,近5日主力净流入额,近5日主力净流入占比,"
        "近10日主力净流入额,近20日主力净流入额"
    )
    result = []
    for raw in stock_codes:
        wind_code = _to_wind(raw)
        try:
            data = _wind_call(
                "stock_data", "get_stock_price_indicators",
                {"windcode": wind_code, "indexes": indexes}
            )
            d = _row_to_dict(data)
            price = _to_float(d.get("最新成交价"))
            chg_pct = _to_float(d.get("涨跌幅"))
            amount = _to_float(d.get("成交额"))
            main_net_today = _to_float(d.get("当日主力净流入额"))
            main_net_5d = _to_float(d.get("近5日主力净流入额"))
            main_net_10d = _to_float(d.get("近10日主力净流入额"))
            main_net_20d = _to_float(d.get("近20日主力净流入额"))
            result.append({
                "code": wind_code,
                "name": (d.get("中文简称") or wind_code).replace(" ", ""),
                "price": price,
                "yesterday_close": _to_float(d.get("前收盘价")),
                "open": _to_float(d.get("今日开盘价")),
                "high": _to_float(d.get("今日最高价")),
                "low": _to_float(d.get("今日最低价")),
                "amount_yi": amount / 1e8 if amount else 0,
                "change_pct": chg_pct,
                "amplitude": _to_float(d.get("振幅")),
                "turnover": _to_float(d.get("换手率")),
                "chg_5d": _to_float(d.get("5日涨跌幅")),
                "chg_20d": _to_float(d.get("20日涨跌幅")),
                "chg_ytd": _to_float(d.get("年初至今涨跌幅")),
                # 估值
                "pe_ttm": _to_float(d.get("市盈率(TTM)")),
                "pb": _to_float(d.get("市净率")),
                "dividend_yield": _to_float(d.get("股息率")),
                "high_52w": _to_float(d.get("52周最高")),
                "low_52w": _to_float(d.get("52周最低")),
                # 主力净流入（亿元）
                "main_net_today_yi": main_net_today / 1e8 if main_net_today else 0,
                "main_net_5d_yi": main_net_5d / 1e8 if main_net_5d else 0,
                "main_net_5d_pct": _to_float(d.get("近5日主力净流入占比")) * 100,
                "main_net_10d_yi": main_net_10d / 1e8 if main_net_10d else 0,
                "main_net_20d_yi": main_net_20d / 1e8 if main_net_20d else 0,
                # 近 5 日收盘价序列，前端 sparkline 用（含今天，时间升序）
                "kline_5d": get_kline_closes(wind_code, n=5, hk=False),
                "emoji": _emoji(chg_pct),
            })
        except Exception as e:
            result.append({"code": wind_code, "name": wind_code, "error": str(e)})
    return result


def get_market_sentiment() -> dict:
    """
    市场情绪温度计：涨停家数 / 跌停家数 / 主力资金净流入
    返回 dict（缺失字段为 None）
    """
    sentiment = {
        "limit_up": None,
        "limit_down": None,
        "main_flow_yi": None,
    }
    try:
        outer = _wind_call(
            "analytics_data", "get_financial_data",
            {"question": "今日A股涨停家数跌停家数主力资金净流入金额"},
            timeout=90,
        )
        steps = (outer or {}).get("data", [])
        # 逐 step 找已知列名
        for step in steps:
            rows = _rows_to_dicts(step)
            if not rows:
                continue
            r = rows[0]
            for k, v in r.items():
                if v is None:
                    continue
                if "涨停" in k and "家数" in k and sentiment["limit_up"] is None:
                    sentiment["limit_up"] = int(_to_float(v))
                elif "跌停" in k and "家数" in k and sentiment["limit_down"] is None:
                    sentiment["limit_down"] = int(_to_float(v))
                # 必须有"额"——避免命中"主力净买入家数"等非金额字段
                elif "主力" in k and "净" in k and "额" in k and sentiment["main_flow_yi"] is None:
                    amt = _to_float(v)
                    # Wind 主力净流入可能返回元或亿元，按量级判断
                    sentiment["main_flow_yi"] = amt / 1e8 if abs(amt) > 1e6 else amt
        return sentiment
    except Exception as e:
        sentiment["error"] = str(e)
        return sentiment


def get_top_news(query: str = "今日A股市场重要新闻", top_k: int = 3,
                  snippet_len: int = 60) -> list:
    """
    财经要闻 TOP N（标题 + 日期 + 短摘要）
    - 默认拉今日市场要闻
    - 传 query 可定向（如某只股票名）拉相关新闻
    """
    try:
        outer = _wind_call(
            "financial_docs", "get_financial_news",
            {"query": query, "top_k": top_k},
            timeout=60,
        )
        items = (outer or {}).get("items", [])
        result = []
        for it in items[:top_k]:
            title = (it.get("title") or "").strip()
            date = (it.get("date") or "").strip()
            # 摘要：抓 content 前若干字，去换行 / 多余空格
            raw = (it.get("content") or "").strip()
            snippet = " ".join(raw.split())[:snippet_len]
            if title:
                result.append({
                    "title": title,
                    "date": date,
                    "snippet": snippet,
                })
        return result
    except Exception as e:
        return [{"error": str(e)}]


def get_indexes() -> list:
    """获取大盘指数（上证/深成/创业板）"""
    indexes = "最新成交价,涨跌,涨跌幅"
    result = []
    for wind_code, name in INDEX_LIST:
        try:
            data = _wind_call(
                "index_data", "get_index_price_indicators",
                {"windcode": wind_code, "indexes": indexes}
            )
            d = _row_to_dict(data)
            chg_pct = _to_float(d.get("涨跌幅"))
            result.append({
                "code": wind_code,
                "name": name,
                "price": _to_float(d.get("最新成交价")),
                "change_amount": _to_float(d.get("涨跌")),
                "change_pct": chg_pct,
                "emoji": _emoji(chg_pct),
            })
        except Exception as e:
            result.append({"name": name, "error": str(e)})
    return result


def get_hot_stocks() -> list:
    """沪深 A 股涨幅榜 TOP5"""
    try:
        outer = _wind_call(
            "analytics_data", "get_financial_data",
            {"question": "今日沪深A股涨幅前5的股票名称代码最新价涨跌幅"},
            timeout=90,
        )
        # analytics 返回结构：{"data": [{step1 columns/rows}, ...]}
        steps = (outer or {}).get("data", [])
        if not steps:
            return [{"error": "无数据"}]
        rows = _rows_to_dicts(steps[0])
        result = []
        for r in rows[:5]:
            name = (r.get("证券简称") or "").replace(" ", "")
            code = r.get("Wind代码") or ""
            price = _to_float(r.get("最新价格"))
            chg_pct = _to_float(r.get("最新涨跌幅"))
            limit = _price_limit(name, code)
            result.append({
                "name": name,
                "code": code,
                "price": price,
                "change_pct": chg_pct,
                "is_limit_up": chg_pct >= limit - 0.3,
                "limit": limit,
            })
        return result
    except Exception as e:
        return [{"error": str(e)}]


def get_sector_ranking() -> list:
    """
    申万一级行业涨幅 TOP5
    Wind analytics 通常返回两步：Step1 行业排行，Step2 各行业领涨股
    """
    try:
        outer = _wind_call(
            "analytics_data", "get_financial_data",
            {"question": "今日申万一级行业涨幅前5名称涨跌幅及各自领涨股"},
            timeout=90,
        )
        steps = (outer or {}).get("data", [])
        if not steps:
            return [{"error": "无板块数据"}]

        # Step1: 行业排行
        step1_rows = _rows_to_dicts(steps[0])
        sectors = []
        for r in step1_rows[:5]:
            name = (r.get("证券简称") or "").replace("(申万)", "").strip()
            sectors.append({
                "code": r.get("Wind代码") or "",
                "name": name,
                "change_pct": _to_float(r.get("最新涨跌幅")),
                "lead_stock": "",
            })

        # Step2: 领涨股映射（key=行业 Wind 代码，val=领涨股名）
        if len(steps) > 1:
            step2_rows = _rows_to_dicts(steps[1])
            leader_map = {}
            for r in step2_rows:
                industry_code = r.get("Wind代码") or ""
                # Step2 列名命名错位：「指数成份简称」其实是领涨股名
                leader_name = (r.get("指数成份简称") or "").replace(" ", "")
                if industry_code and leader_name and industry_code not in leader_map:
                    leader_map[industry_code] = leader_name
            for s in sectors:
                s["lead_stock"] = leader_map.get(s["code"], "")

        for s in sectors:
            s["emoji"] = _emoji(s["change_pct"])
        return sectors
    except Exception as e:
        return [{"error": str(e)}]


# -------------------- 日报排版 --------------------

def _fmt_yi(value) -> str:
    """格式化亿元金额，带正负号，1 位小数"""
    try:
        v = float(value)
        return f"{v:+.2f}亿"
    except (ValueError, TypeError):
        return "--"


def _fmt_pct(value) -> str:
    """格式化百分比，带正负号"""
    try:
        v = float(value)
        return f"{v:+.2f}%"
    except (ValueError, TypeError):
        return "--"


def get_hk_indexes() -> list:
    """港股大盘指数（恒生 / 国企 / 恒科）"""
    indexes = "最新成交价,涨跌,涨跌幅"
    result = []
    for wind_code, name in INDEX_LIST_HK:
        try:
            data = _wind_call(
                "index_data", "get_index_price_indicators",
                {"windcode": wind_code, "indexes": indexes}
            )
            d = _row_to_dict(data)
            chg_pct = _to_float(d.get("涨跌幅"))
            result.append({
                "code": wind_code,
                "name": name,
                "price": _to_float(d.get("最新成交价")),
                "change_amount": _to_float(d.get("涨跌")),
                "change_pct": chg_pct,
                "emoji": _emoji(chg_pct),
            })
        except Exception as e:
            result.append({"name": name, "error": str(e)})
    return result


def get_hk_stock_data(stock_codes: list) -> list:
    """港股自选股行情（含多周期 / 估值 / 振幅）"""
    indexes = (
        "中文简称,最新成交价,前收盘价,今日开盘价,今日最高价,今日最低价,"
        "成交额,涨跌幅,振幅,"
        "5日涨跌幅,20日涨跌幅,年初至今涨跌幅,"
        "市盈率(TTM),市净率,52周最高,52周最低"
    )
    result = []
    for raw in stock_codes:
        wind_code = (raw or "").strip().upper()
        if not wind_code:
            continue
        # 港股代码必须带 .HK 后缀
        if "." not in wind_code:
            wind_code = f"{wind_code}.HK"
        try:
            data = _wind_call(
                "global_stock_data", "get_global_stock_price_indicators",
                {"windcode": wind_code, "indexes": indexes}
            )
            d = _row_to_dict(data)
            chg_pct = _to_float(d.get("涨跌幅"))
            amount = _to_float(d.get("成交额"))
            result.append({
                "code": wind_code,
                "name": (d.get("中文简称") or wind_code).replace(" ", ""),
                "price": _to_float(d.get("最新成交价")),
                "yesterday_close": _to_float(d.get("前收盘价")),
                "open": _to_float(d.get("今日开盘价")),
                "high": _to_float(d.get("今日最高价")),
                "low": _to_float(d.get("今日最低价")),
                "amount_yi": amount / 1e8 if amount else 0,
                "change_pct": chg_pct,
                "amplitude": _to_float(d.get("振幅")),
                "chg_5d": _to_float(d.get("5日涨跌幅")),
                "chg_20d": _to_float(d.get("20日涨跌幅")),
                "chg_ytd": _to_float(d.get("年初至今涨跌幅")),
                "pe_ttm": _to_float(d.get("市盈率(TTM)")),
                "pb": _to_float(d.get("市净率")),
                "high_52w": _to_float(d.get("52周最高")),
                "low_52w": _to_float(d.get("52周最低")),
                "kline_5d": get_kline_closes(wind_code, n=5, hk=True),
                "currency": "HKD",
                "emoji": _emoji(chg_pct),
            })
        except Exception as e:
            result.append({"code": wind_code, "name": wind_code, "error": str(e)})
    return result


def get_hk_hot_stocks() -> list:
    """港股涨幅榜 TOP5（用 analytics 自然语言查询）"""
    try:
        outer = _wind_call(
            "analytics_data", "get_financial_data",
            {"question": "今日港股涨幅前5的股票名称代码最新价涨跌幅"},
            timeout=90,
        )
        steps = (outer or {}).get("data", [])
        if not steps:
            return [{"error": "无数据"}]
        rows = _rows_to_dicts(steps[0])
        result = []
        for r in rows[:5]:
            name = (r.get("证券简称") or "").replace(" ", "")
            code = r.get("Wind代码") or ""
            result.append({
                "name": name,
                "code": code,
                "price": _to_float(r.get("最新价格")),
                "change_pct": _to_float(r.get("最新涨跌幅")),
            })
        return result
    except Exception as e:
        return [{"error": str(e)}]


def get_stock_consensus(wind_code: str, name: str = "") -> dict:
    """机构一致预期：目标价 + 买入家数"""
    q = f"{name or wind_code}机构最新一致预测目标价买入家数增持家数总评级家数"
    try:
        outer = _wind_call(
            "analytics_data", "get_financial_data",
            {"question": q},
            timeout=60,
        )
        steps = (outer or {}).get("data", [])
        if not steps:
            return {}
        d = _row_to_dict(steps[0])
        # 提取数值；Wind 列名可能略变，做模糊匹配
        result = {}
        for k, v in d.items():
            if v is None:
                continue
            if "目标价" in k:
                result["target_price"] = _to_float(v)
            elif "买入" in k and "家" in k:
                result["buy_count"] = int(_to_float(v))
            elif "增持" in k and "家" in k:
                result["overweight_count"] = int(_to_float(v))
            elif "评级" in k and "家" in k and "覆盖" not in k:
                result["total_ratings"] = int(_to_float(v))
            elif "覆盖" in k and "家" in k:
                result["coverage"] = int(_to_float(v))
        return result
    except Exception as e:
        return {"error": str(e)}


def get_company_announcements(name_or_code: str, top_k: int = 3) -> list:
    """近期公司公告（不返回原文 URL）"""
    try:
        outer = _wind_call(
            "financial_docs", "get_company_announcements",
            {"query": f"{name_or_code}最近公告", "top_k": top_k},
            timeout=60,
        )
        items = (outer or {}).get("items", [])
        result = []
        for it in items[:top_k]:
            title = (it.get("title") or "").strip()
            date = (it.get("date") or "").strip()
            content = (it.get("content") or "").strip()
            snippet = " ".join(content.split())[:80]
            if title:
                result.append({"title": title, "date": date, "snippet": snippet})
        return result
    except Exception as e:
        return [{"error": str(e)}]


def get_stock_capital_flow(wind_code: str, name: str = "", market: str = "A") -> dict:
    """
    资金信号深度拆解
    - A 股: 主力 / 机构 / 大户 各方买卖额（亿元）
    - 港股: 今日卖空金额 + 近 5 日卖空趋势
    """
    if market == "HK":
        try:
            outer = _wind_call(
                "analytics_data", "get_financial_data",
                {"question": f"{name or wind_code}今日卖空金额近5日卖空数据"},
                timeout=90,
            )
            steps = (outer or {}).get("data", [])
            result = {"market": "HK"}
            if steps:
                # Step1: 当日卖空
                d = _row_to_dict(steps[0])
                for k, v in d.items():
                    if v is None: continue
                    if "卖空金额" in k and "占" not in k:
                        result["short_amount_today_yi"] = _to_float(v)
                    elif "占市场" in k and "卖空" in k:
                        result["short_ratio_market_today"] = _to_float(v)
                # Step2: 近5日趋势
                if len(steps) > 1:
                    trend = []
                    for r in _rows_to_dicts(steps[1]):
                        date = r.get("日期") or ""
                        amt_key = next((k for k in r if "卖空金额" in k and "占" not in k), None)
                        ratio_key = next((k for k in r if "占" in k and "卖空" in k), None)
                        if date and amt_key:
                            trend.append({
                                "date": str(date),
                                "amount_yi": _to_float(r.get(amt_key)),
                                "ratio_market": _to_float(r.get(ratio_key)) if ratio_key else None,
                            })
                    result["short_trend_5d"] = trend
            return result
        except Exception as e:
            return {"market": "HK", "error": str(e)}
    # A 股：只取主力买入/卖出（Wind 此类查询的列名不稳定，主力字段最可靠）
    try:
        outer = _wind_call(
            "analytics_data", "get_financial_data",
            {"question": f"{name or wind_code}今日主力买入金额主力卖出金额"},
            timeout=90,
        )
        steps = (outer or {}).get("data", [])
        result = {"market": "A"}
        for step in steps:
            d = _row_to_dict(step)
            for k, v in d.items():
                if v is None: continue
                if "主力" in k and ("流入" in k or "买入" in k) and "净" not in k:
                    result.setdefault("main_buy_yi", _to_float(v))
                elif "主力" in k and ("流出" in k or "卖出" in k) and "净" not in k:
                    result.setdefault("main_sell_yi", _to_float(v))
        return result
    except Exception as e:
        return {"market": "A", "error": str(e)}


def get_connect_holding(wind_code: str, name: str = "", market: str = "A") -> dict:
    """北向(A 股) / 南向(港股) 持股占比"""
    if market == "HK":
        q = f"{name or wind_code}港股通南向资金持股占比"
    else:
        q = f"{name or wind_code}北向资金沪深股通持股占比"
    try:
        outer = _wind_call(
            "analytics_data", "get_financial_data",
            {"question": q},
            timeout=60,
        )
        steps = (outer or {}).get("data", [])
        if not steps:
            return {}
        d = _row_to_dict(steps[0])
        for k, v in d.items():
            if v is None: continue
            if "持股" in k and ("占比" in k or "比例" in k):
                return {"holding_pct": _to_float(v)}
        return {}
    except Exception as e:
        return {"error": str(e)}


def fetch_stock_detail(wind_code: str, name: str = "") -> dict:
    """
    单股深度数据：一致预期 + 资金信号 + 北向/南向 + 公告 + 相关新闻 + 20 日 K 线
    （行情、估值、自有资金流等已经在 get_stock_data 的 watchlist 中拿到，这里只补 NL 维度）
    """
    market = "HK" if wind_code.upper().endswith(".HK") else "A"
    hk = market == "HK"
    return {
        "consensus": get_stock_consensus(wind_code, name),
        "capital_flow": get_stock_capital_flow(wind_code, name, market=market),
        "connect": get_connect_holding(wind_code, name, market=market),
        "announcements": get_company_announcements(name or wind_code, top_k=3),
        "news": get_top_news(query=name or wind_code, top_k=3, snippet_len=80),
        # 近 20 日收盘价（个股页 sparkline 用）；失败为空数组
        "kline_20d": get_kline_closes(wind_code, n=20, hk=hk),
    }


def _parallel_run(tasks: dict, max_workers: int = None) -> dict:
    """
    并发执行多个无参 lambda；返回 {key: result}，单个任务失败保留 {"error": str}。
    tasks: {"key": callable_with_no_args, ...}
    """
    if max_workers is None:
        max_workers = WIND_MAX_WORKERS
    results = {}
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        future_to_key = {ex.submit(fn): key for key, fn in tasks.items()}
        for fut in as_completed(future_to_key):
            key = future_to_key[fut]
            try:
                results[key] = fut.result()
            except Exception as e:
                log.error(f"❌ 并发任务 {key} 失败: {e}")
                results[key] = {"error": str(e)}
    return results


def fetch_all_data(stock_codes: list, hk_stock_codes: list = None,
                   detail_codes: list = None) -> dict:
    """
    一次拉取生成日报所需的全部数据（并发执行，避免 5-7 分钟串行）。
    供 build_report 和 publisher 共用，避免重复 Wind 调用。

    并发策略：
    - 第一波：所有"全市场"维度 + watchlist 数据并发跑
    - 第二波（依赖第一波 name_map）：单股深度详情并发跑

    Args:
        stock_codes:    A 股观察池
        hk_stock_codes: 港股观察池（None 则跳过）
        detail_codes:   需要单股深度详情的 wind 代码列表（None 则跳过）
    """
    t0 = time.time()
    log.info(f"📊 fetch_all_data: A={len(stock_codes)} HK={len(hk_stock_codes or [])} detail={len(detail_codes or [])}")

    # —— 第一波：全市场视图 + watchlist —— #
    wave1 = {
        "indices": get_indexes,
        "sentiment": get_market_sentiment,
        "watchlist": lambda: get_stock_data(stock_codes),
        "hot_stocks": get_hot_stocks,
        "sectors": get_sector_ranking,
        "news": lambda: get_top_news(top_k=3, snippet_len=60),
    }
    if hk_stock_codes:
        wave1["hk_indices"] = get_hk_indexes
        wave1["hk_watchlist"] = lambda: get_hk_stock_data(hk_stock_codes)
        wave1["hk_hot_stocks"] = get_hk_hot_stocks

    r1 = _parallel_run(wave1)
    out = {"asOf": datetime.datetime.now().isoformat(), **r1}
    log.info(f"📊 第一波完成 {time.time() - t0:.1f}s ({len(wave1)} 个任务)")

    # —— 第二波：单股深度 —— #
    if detail_codes:
        # name 映射来自第一波的 watchlist（A + HK，code 互不冲突）
        watchlist = out.get("watchlist", [])
        hk_watchlist = out.get("hk_watchlist", [])
        name_map = {}
        for s in (list(watchlist) + list(hk_watchlist) if isinstance(watchlist, list) else []):
            if isinstance(s, dict) and "code" in s:
                name_map[s["code"]] = s.get("name", "")

        wave2 = {
            code: (lambda c=code, n=name_map.get(code, ""): fetch_stock_detail(c, n))
            for code in detail_codes
        }
        out["details"] = _parallel_run(wave2)
        log.info(f"📊 第二波完成 {time.time() - t0:.1f}s ({len(wave2)} 只股票详情)")

    log.info(f"✅ fetch_all_data 总耗时 {time.time() - t0:.1f}s")
    return out


def build_report(stock_codes: list, prefetched: dict = None) -> tuple:
    """
    构建紧凑版股票日报（Markdown 表格）
    返回 (title, markdown_content)

    prefetched: 已通过 fetch_all_data 拉好的数据；传入则跳过重复 Wind 调用
    """
    now = datetime.datetime.now()
    today = now.strftime("%m月%d日")
    time_str = now.strftime("%H:%M")
    title = f"📊 {today}股票日报"

    data = prefetched if prefetched else fetch_all_data(stock_codes)

    lines = []
    lines.append(f"# {title}")
    lines.append(f"`{time_str} 更新` · `Wind 数据` · `Zoro AI`")
    lines.append("")

    # 1. 大盘
    lines.append("## 📈 大盘")
    lines.append("")
    lines.append("| 指数 | 点位 | 涨跌 |")
    lines.append("|------|------|------|")
    for idx in data["indices"]:
        if "error" in idx:
            lines.append(f"| ⚠️ {idx.get('name','')} | {idx['error']} |  |")
            continue
        lines.append(
            f"| {idx['emoji']} {idx['name']} "
            f"| {idx['price']:.2f} "
            f"| **{idx['change_amount']:+.2f}** ({idx['change_pct']:+.2f}%) |"
        )
    lines.append("")

    # 2. 市场情绪温度计
    lines.append("## 🌡️ 市场情绪")
    lines.append("")
    sentiment = data["sentiment"]
    if "error" in sentiment:
        lines.append(f"⚠️ {sentiment['error']}")
    else:
        lu = sentiment.get("limit_up")
        ld = sentiment.get("limit_down")
        mf = sentiment.get("main_flow_yi")
        lines.append("| 指标 | 数值 |")
        lines.append("|------|------|")
        if lu is not None:
            lines.append(f"| 🚀 涨停家数 | **{lu}** 家 |")
        if ld is not None:
            lines.append(f"| 💥 跌停家数 | **{ld}** 家 |")
        if mf is not None:
            flow_emoji = "🔴" if mf > 0 else ("🟢" if mf < 0 else "⚪")
            flow_label = "净流入" if mf > 0 else ("净流出" if mf < 0 else "持平")
            lines.append(f"| 💰 主力资金 | {flow_emoji} **{mf:+.2f}亿** ({flow_label}) |")
    lines.append("")

    # 3. 自选股（按涨跌幅降序）
    lines.append("## 💼 自选股")
    lines.append("")
    lines.append("| 股票 | 现价 | 今日 | 5日 | 20日 | 主力5日(亿) |")
    lines.append("|------|------|------|-----|------|-----------|")
    # 拷贝一份再排序，避免修改原 data["watchlist"] 顺序（publisher 也要用）
    stocks = list(data["watchlist"])
    stocks.sort(key=lambda x: (0, -x["change_pct"]) if "error" not in x else (1, 0))
    for s in stocks:
        if "error" in s:
            lines.append(f"| ⚠️ {s.get('code','')} | {s['error']} |  |  |  |  |")
            continue
        main_net = s.get("main_net_5d_yi", 0)
        main_emoji = "🔴" if main_net > 0 else ("🟢" if main_net < 0 else "⚪")
        lines.append(
            f"| {s['emoji']} {s['name']} "
            f"| {_fmt_price(s['price'])} "
            f"| **{s['change_pct']:+.2f}%** "
            f"| {_fmt_pct(s['chg_5d'])} "
            f"| {_fmt_pct(s['chg_20d'])} "
            f"| {main_emoji} {main_net:+.1f} |"
        )
    lines.append("")

    # 4. 涨幅榜
    lines.append("## 🔥 涨幅榜")
    lines.append("")
    lines.append("| # | 股票 | 现价 | 涨幅 |")
    lines.append("|---|------|------|------|")
    hot = data["hot_stocks"]
    for i, h in enumerate(hot, 1):
        if "error" in h:
            lines.append(f"| ⚠️ | {h['error']} |  |  |")
            continue
        tag = " 🚀" if h.get("is_limit_up") else ""
        lines.append(
            f"| {i} | {h['name']} `{h['code']}` "
            f"| {h['price']:.2f} "
            f"| **{h['change_pct']:+.2f}%**{tag} |"
        )
    lines.append("")

    # 5. 热门板块（申万一级）
    lines.append("## 💰 热门板块 (申万一级)")
    lines.append("")
    lines.append("| 板块 | 涨幅 | 领涨股 |")
    lines.append("|------|------|--------|")
    sectors = data["sectors"]
    for s in sectors:
        if "error" in s:
            lines.append(f"| ⚠️ {s['error']} |  |  |")
            continue
        lead = s.get("lead_stock") or "—"
        lines.append(
            f"| {s['emoji']} {s['name']} "
            f"| **{s['change_pct']:+.2f}%** "
            f"| {lead} |"
        )
    lines.append("")

    # 6. 港股大盘 + 自选股（仅当 data 含 hk_indices / hk_watchlist 时显示）
    hk_indices = data.get("hk_indices") or []
    hk_watchlist = data.get("hk_watchlist") or []
    # 排除 error 占位
    hk_indices_valid = [x for x in hk_indices if isinstance(x, dict) and "error" not in x]
    hk_watchlist_valid = [x for x in hk_watchlist if isinstance(x, dict) and "error" not in x]
    if hk_indices_valid or hk_watchlist_valid:
        lines.append("## 🇭🇰 港股大盘")
        lines.append("")
        if hk_indices_valid:
            lines.append("| 指数 | 点位 | 涨跌 |")
            lines.append("|------|------|------|")
            for idx in hk_indices_valid:
                lines.append(
                    f"| {idx['emoji']} {idx['name']} "
                    f"| {idx['price']:.2f} "
                    f"| **{idx['change_amount']:+.2f}** ({idx['change_pct']:+.2f}%) |"
                )
        lines.append("")

        if hk_watchlist_valid:
            lines.append("### 港股观察池")
            lines.append("")
            lines.append("| 股票 | 现价 | 今日 | 5日 | 20日 |")
            lines.append("|------|------|------|-----|------|")
            sorted_hk = sorted(hk_watchlist_valid, key=lambda x: -x.get("change_pct", 0))
            for s in sorted_hk:
                lines.append(
                    f"| {s['emoji']} {s['name']} "
                    f"| HK$ {_fmt_price(s['price'])} "
                    f"| **{s['change_pct']:+.2f}%** "
                    f"| {_fmt_pct(s.get('chg_5d'))} "
                    f"| {_fmt_pct(s.get('chg_20d'))} |"
                )
            lines.append("")

    # 7. 财经要闻 TOP3（标题做成百度搜索链接 + 60 字摘要）
    lines.append("## 📰 今日要闻")
    lines.append("")
    news = data["news"]
    for i, n in enumerate(news, 1):
        if "error" in n:
            lines.append(f"{i}. ⚠️ {n['error']}")
            continue
        search_url = f"https://www.baidu.com/s?wd={quote(n['title'])}"
        date_tag = f" `{n['date']}`" if n.get("date") else ""
        lines.append(f"{i}. [**{n['title']}**]({search_url}){date_tag}")
        if n.get("snippet"):
            lines.append(f"   > {n['snippet']}…")
        lines.append("")
    # 末尾多了一个空行，trim 掉避免分隔符前空两行
    if lines and lines[-1] == "":
        lines.pop()

    lines.append("---")
    lines.append("🚀 涨停 · 🔴 涨/流入 · 🟢 跌/流出 · ⚪ 平 · 数据来源 Wind")

    return title, "\n".join(lines)

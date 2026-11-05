"""Public-quote fallback when Wind Alice is out of credits.

A-share quotes / leaders / sectors: Eastmoney push2delay.
HK quotes and daily closes: Tencent (gtimg) so kline still works if
Eastmoney history drops the connection.
"""

from __future__ import annotations

import datetime
import json
import logging
import ssl
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Iterable
from urllib.parse import urlencode

from quality import as_list, has_price, is_publishable, scrub_credit_errors, valid_rows


log = logging.getLogger("wind.fallback")

_CTX = ssl.create_default_context()
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
    "Referer": "https://quote.eastmoney.com/",
}
_SINA_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
    "Referer": "https://finance.sina.com.cn/",
}

INDEX_LIST = [
    ("000001.SH", "上证指数"),
    ("399001.SZ", "深证成指"),
    ("399006.SZ", "创业板指"),
]
HK_INDEX_LIST = [
    ("HSI.HI", "恒生指数", "100.HSI"),
    ("HSCEI.HI", "国企指数", "100.HSCEI"),
    ("HSTECH.HI", "恒生科技", "124.HSTECH"),
]


def _emoji(pct: float) -> str:
    if pct > 0:
        return "🔴"
    if pct < 0:
        return "🟢"
    return "⚪"


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        number = float(value)
        if number != number:
            return default
        return number
    except (TypeError, ValueError):
        return default


def _to_wind(code: str) -> str:
    code = (code or "").strip()
    if not code:
        return ""
    if "." in code:
        out = code.upper()
        # 港股统一成 Wind 的 4 位写法（0700.HK / 9988.HK），与站点路由一致；
        # 5 位写法会被 nginx 301 成 4 位，导致 /invest/stock 详情页 404。
        if out.endswith(".HK"):
            num = out[:-3]
            if num.isdigit() and len(num) > 4:
                out = f"{num[-4:]}.HK"
        return out
    raw = code.lower()
    if raw.startswith("sh"):
        return f"{raw[2:]}.SH"
    if raw.startswith("sz"):
        return f"{raw[2:]}.SZ"
    if raw.isdigit() and len(raw) == 6:
        if raw[0] == "6":
            return f"{raw}.SH"
        return f"{raw}.SZ"
    return code.upper()


def wind_to_secid(code: str) -> str:
    wind = _to_wind(code)
    if wind.endswith(".SH"):
        return f"1.{wind[:-3]}"
    if wind.endswith(".SZ"):
        return f"0.{wind[:-3]}"
    if wind.endswith(".HK"):
        return f"116.{wind[:-3].zfill(5)}"
    return ""


def wind_to_tencent(code: str) -> str:
    wind = _to_wind(code)
    if wind.endswith(".SH"):
        return f"sh{wind[:-3]}"
    if wind.endswith(".SZ"):
        return f"sz{wind[:-3]}"
    if wind.endswith(".HK"):
        return f"hk{wind[:-3].zfill(5)}"
    special = {"HSI.HI": "hkHSI", "HSCEI.HI": "hkHSCEI", "HSTECH.HI": "hkHSTECH"}
    return special.get(wind, "")


def _headers_for(url: str) -> dict[str, str]:
    if "sina.com" in url:
        return _SINA_HEADERS
    return _HEADERS


def _http_bytes(url: str, timeout: int = 12, retries: int = 3) -> bytes:
    last_error: Exception | None = None
    headers = _headers_for(url)
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=timeout, context=_CTX) as response:
                return response.read()
        except Exception as exc:
            last_error = exc
            time.sleep(0.8 * (attempt + 1))
    alt = url.replace("push2delay.eastmoney.com", "push2.eastmoney.com")
    if alt != url:
        try:
            request = urllib.request.Request(alt, headers=_HEADERS)
            with urllib.request.urlopen(request, timeout=timeout, context=_CTX) as response:
                return response.read()
        except Exception as exc:
            last_error = exc
    raise RuntimeError(f"GET {url[:80]} failed: {last_error}")


def _http_json(url: str, timeout: int = 12, retries: int = 3) -> dict[str, Any]:
    body = _http_bytes(url, timeout=timeout, retries=retries)
    return json.loads(body.decode("utf-8", "replace"))


def _eastmoney_ulist(secids: Iterable[str], fields: str) -> dict[str, dict]:
    joined = ",".join(item for item in secids if item)
    if not joined:
        return {}
    query = urlencode({
        "fltt": "2",
        "secids": joined,
        "fields": fields,
    }, safe=",")
    payload = _http_json(f"https://push2delay.eastmoney.com/api/qt/ulist.np/get?{query}")
    diff = (payload.get("data") or {}).get("diff") or []
    rows = list(diff.values()) if isinstance(diff, dict) else diff
    out: dict[str, dict] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        code = str(row.get("f12") or "")
        if code:
            out[code] = row
    return out


def _eastmoney_clist(fs: str, fields: str, size: int = 5) -> list[dict]:
    query = urlencode({
        "pn": "1", "pz": str(size), "po": "1", "np": "1",
        "fltt": "2", "fid": "f3", "fs": fs, "fields": fields,
    })
    payload = _http_json(f"https://push2delay.eastmoney.com/api/qt/clist/get?{query}")
    diff = (payload.get("data") or {}).get("diff") or []
    rows = list(diff.values()) if isinstance(diff, dict) else diff
    return [row for row in rows if isinstance(row, dict)]


def _tencent_quotes(symbols: Iterable[str]) -> dict[str, list[str]]:
    joined = ",".join(item for item in symbols if item)
    if not joined:
        return {}
    url = f"https://qt.gtimg.cn/q={joined}"
    last_error: Exception | None = None
    body = ""
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers=_HEADERS)
            with urllib.request.urlopen(request, timeout=12, context=_CTX) as response:
                body = response.read().decode("gbk", "replace")
            break
        except Exception as exc:
            last_error = exc
            time.sleep(0.6 * (attempt + 1))
    else:
        raise RuntimeError(f"tencent quote failed: {last_error}")
    out: dict[str, list[str]] = {}
    for line in body.splitlines():
        if "=\"" not in line:
            continue
        key, _, rest = line.partition("=")
        symbol = key.replace("v_", "").strip()
        fields = rest.strip().strip('";').split("~")
        if len(fields) > 32:
            out[symbol] = fields
    return out


def _quote_from_tencent(fields: list[str], code: str, name: str) -> dict[str, Any]:
    price = _to_float(fields[3])
    chg_pct = _to_float(fields[32])
    return {
        "code": code,
        "name": (fields[1] or name).replace(" ", ""),
        "price": price,
        "change_amount": _to_float(fields[31]),
        "change_pct": chg_pct,
        "yesterday_close": _to_float(fields[4]),
        "open": _to_float(fields[5]),
        "high": _to_float(fields[33]) if len(fields) > 33 else 0,
        "low": _to_float(fields[34]) if len(fields) > 34 else 0,
        "amount_yi": _to_float(fields[37]) / 100 if len(fields) > 37 else 0,  # 万元 → 亿, best-effort
        "emoji": _emoji(chg_pct),
    }


def tencent_kline_bars(symbol: str, n: int = 80) -> list[dict[str, Any]]:
    """Daily bars. Index feeds use `day`; stocks usually `qfqday`."""
    if not symbol:
        return []
    query = urlencode({"param": f"{symbol},day,,,{n},qfq"})
    # web.ifzq.gtimg.cn 在部分机房会被限流成 HTTP 501，proxy 域名是同一份数据
    payload = None
    last_error: Exception | None = None
    for host in ("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get",
                 "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get"):
        try:
            payload = _http_json(f"{host}?{query}", timeout=15)
            break
        except Exception as exc:
            last_error = exc
    if payload is None:
        raise RuntimeError(f"tencent kline {symbol} failed: {last_error}")
    node = ((payload.get("data") or {}).get(symbol) or {})
    rows = node.get("qfqday") or node.get("day") or node.get("hfqday") or []
    bars: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, (list, tuple)) or len(row) < 3:
            continue
        close = _to_float(row[2])
        if close <= 0:
            continue
        bars.append({
            "date": str(row[0])[:10],
            "open": _to_float(row[1]),
            "close": close,
            "high": _to_float(row[3]) if len(row) > 3 else close,
            "low": _to_float(row[4]) if len(row) > 4 else close,
            # 成交量（手），用来估算成交额，东财被限流时不用再请求
            "volume": _to_float(row[5]) if len(row) > 5 else 0.0,
        })
    return bars


def sina_kline_bars(symbol: str, n: int = 80) -> list[dict[str, Any]]:
    """新浪日线兜底：腾讯 fqkline 被限流（HTTP 501）时用。

    新浪 volume 单位是「股」，统一换算成「手」，与腾讯口径一致。
    港股无该接口，直接返回空。
    """
    if not symbol or symbol.startswith("hk"):
        return []
    query = urlencode({"symbol": symbol, "scale": "240", "ma": "no", "datalen": str(n)})
    url = ("https://quotes.sina.cn/cn/api/json_v2.php/"
           f"CN_MarketDataService.getKLineData?{query}")
    try:
        rows = _http_json(url, timeout=15)
    except Exception as exc:
        log.warning("sina kline %s failed: %s", symbol, exc)
        return []
    bars: list[dict[str, Any]] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        close = _to_float(row.get("close"))
        if close <= 0:
            continue
        bars.append({
            "date": str(row.get("day"))[:10],
            "open": _to_float(row.get("open")),
            "close": close,
            "high": _to_float(row.get("high")) or close,
            "low": _to_float(row.get("low")) or close,
            "volume": _to_float(row.get("volume")) / 100.0,
        })
    return bars


def daily_bars(wind_code: str, n: int = 250) -> list[dict[str, Any]]:
    """日线统一入口：腾讯优先，被限流时退新浪（港股只有腾讯）。"""
    symbol = wind_to_tencent(wind_code)
    if not symbol:
        return []
    try:
        bars = tencent_kline_bars(symbol, n=n)
    except Exception as exc:
        # 腾讯被限流时会抛 501，而不是返回空列表
        log.warning("tencent kline %s failed (%s), trying sina", wind_code, exc)
        bars = []
    if bars:
        return bars
    log.warning("tencent kline %s empty, falling back to sina", wind_code)
    return sina_kline_bars(symbol, n=n)


def bars_as_of(bars: list[dict[str, Any]], as_of: str) -> list[dict[str, Any]]:
    return [bar for bar in bars if str(bar.get("date") or "") <= as_of]


def quote_from_bars(code: str, name: str, bars: list[dict[str, Any]], as_of: str) -> dict[str, Any] | None:
    kept = bars_as_of(bars, as_of)
    if not kept or kept[-1]["date"] != as_of:
        return None
    last = kept[-1]
    prev = kept[-2] if len(kept) >= 2 else None
    close = last["close"]
    prev_close = prev["close"] if prev and prev["close"] > 0 else last["open"]
    chg = close - prev_close if prev_close else 0.0
    pct = round((close / prev_close - 1) * 100, 2) if prev_close else 0.0
    closes = [bar["close"] for bar in kept]
    amplitude = 0.0
    if prev_close > 0 and last["high"] and last["low"]:
        amplitude = round((last["high"] - last["low"]) / prev_close * 100, 2)
    row: dict[str, Any] = {
        "code": code,
        "name": name,
        "price": close,
        "yesterday_close": prev_close,
        "open": last["open"],
        "high": last["high"],
        "low": last["low"],
        "change_amount": round(chg, 2),
        "change_pct": pct,
        "amplitude": amplitude,
        "amount_yi": 0,
        "turnover": 0,
        "chg_5d": _chg_from_closes(closes, 5),
        "chg_20d": _chg_from_closes(closes, 20),
        "chg_ytd": _ytd_from_closes(closes),
        "kline_5d": closes[-5:],
        "emoji": _emoji(pct),
    }
    if code.upper().endswith(".HK"):
        row["currency"] = "HKD"
    return row


def _tencent_closes(symbol: str, n: int = 30) -> list[float]:
    return [bar["close"] for bar in tencent_kline_bars(symbol, n=n)]


def _chg_from_closes(closes: list[float], lookback: int) -> float | None:
    if len(closes) < lookback + 1:
        return None
    base = closes[-(lookback + 1)]
    last = closes[-1]
    if base <= 0:
        return None
    return round((last / base - 1) * 100, 2)


def _ytd_from_bars(bars: list[dict]) -> float | None:
    """真正的年初至今：以上一年最后一个交易日收盘为基准。

    `_ytd_from_closes` 实际算的是"近一年涨跌"，标签却写成 YTD，
    个股详情页（/invest/stock）会直接误读，所以有日期时优先走这里。
    """
    if not bars:
        return None
    last = bars[-1]
    year = str(last.get("date") or "")[:4]
    if not year:
        return None
    prev_year = [b for b in bars if str(b.get("date") or "")[:4] < year]
    if not prev_year:
        return None
    base = _to_float(prev_year[-1].get("close"))
    last_close = _to_float(last.get("close"))
    if base <= 0 or last_close <= 0:
        return None
    return round((last_close / base - 1) * 100, 2)


def _range_52w(bars: list[dict]) -> tuple[float | None, float | None]:
    """近 52 周最高 / 最低，按最高价、最低价算（不是收盘价）。"""
    if not bars:
        return None, None
    last_date = str(bars[-1].get("date") or "")
    window = bars[-250:]
    try:
        cutoff = (datetime.date.fromisoformat(last_date) - datetime.timedelta(days=365)).isoformat()
        window = [b for b in bars if str(b.get("date") or "") >= cutoff] or window
    except ValueError:
        pass
    highs = [h for h in (_to_float(b.get("high")) for b in window) if h > 0]
    lows = [v for v in (_to_float(b.get("low")) for b in window) if v > 0]
    return (max(highs) if highs else None, min(lows) if lows else None)


def _ytd_from_closes(closes: list[float], dates_ok: bool = False) -> float | None:
    if len(closes) < 2:
        return None
    return _chg_from_closes(closes, max(len(closes) - 1, 1))


def _index_row(code: str, name: str, quote: dict | None) -> dict[str, Any] | None:
    if not quote:
        return None
    price = _to_float(quote.get("f2"))
    if price <= 0:
        return None
    chg_pct = _to_float(quote.get("f3"))
    return {
        "code": code,
        "name": name,
        "price": price,
        "change_amount": _to_float(quote.get("f4")),
        "change_pct": chg_pct,
        "emoji": _emoji(chg_pct),
    }


def _stock_row(wind_code: str, quote: dict | None) -> dict[str, Any] | None:
    if not quote:
        return None
    price = _to_float(quote.get("f2"))
    if price <= 0:
        return None
    prev = _to_float(quote.get("f18"))
    high = _to_float(quote.get("f15"))
    low = _to_float(quote.get("f16"))
    chg_pct = _to_float(quote.get("f3"))
    amount = _to_float(quote.get("f6"))
    amplitude = round((high - low) / prev * 100, 2) if prev > 0 and high and low else 0.0
    closes = _tencent_closes(wind_to_tencent(wind_code), n=40)
    kline_5d = closes[-5:] if closes else ([price] if price else [])
    hk = wind_code.upper().endswith(".HK")
    row: dict[str, Any] = {
        "code": wind_code,
        "name": str(quote.get("f14") or wind_code).replace(" ", ""),
        "price": price,
        "yesterday_close": prev,
        "open": _to_float(quote.get("f17")),
        "high": high,
        "low": low,
        "amount_yi": amount / 1e8 if amount else 0,
        "change_pct": chg_pct,
        "amplitude": amplitude,
        "turnover": 0,
        "chg_5d": _chg_from_closes(closes, 5),
        "chg_20d": _chg_from_closes(closes, 20),
        "chg_ytd": _ytd_from_closes(closes),
        "kline_5d": kline_5d,
        "emoji": _emoji(chg_pct),
    }
    if hk:
        row["currency"] = "HKD"
    return row


def _price_limit(name: str, code: str) -> int:
    if "ST" in (name or "").upper():
        return 5
    bare = (code or "").split(".")[0]
    if bare.startswith("688") or bare.startswith("300") or bare.startswith("301"):
        return 20
    if bare[:1] in ("4", "8", "9"):
        return 30
    return 10


def classify_hq_rows(rows: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Turn Sina/Eastmoney-style changepercent rows into breadth + limit counts."""
    ups = downs = flats = 0
    lu10 = lu20 = ld10 = ld20 = 0
    total = 0
    for item in rows:
        if not isinstance(item, dict):
            continue
        pct = item.get("changepercent")
        if pct is None:
            pct = item.get("change_pct")
        pct = _to_float(pct)
        name = str(item.get("name") or "")
        code = str(item.get("code") or item.get("symbol") or "")
        if code.lower().startswith(("sh", "sz", "bj")):
            code = code[2:]
        total += 1
        if pct > 0:
            ups += 1
        elif pct < 0:
            downs += 1
        else:
            flats += 1
        limit = _price_limit(name, code)
        if pct >= limit - 0.3:
            if limit >= 20:
                lu20 += 1
            else:
                lu10 += 1
        if pct <= -(limit - 0.3):
            if limit >= 20:
                ld20 += 1
            else:
                ld10 += 1
    return {
        "total": total,
        "ups": ups,
        "downs": downs,
        "flats": flats,
        "limit_up": lu10 + lu20,
        "limit_up_breakdown": {"10cm": lu10, "20cm": lu20},
        "limit_down": ld10 + ld20,
        "limit_down_breakdown": {"10cm": ld10, "20cm": ld20},
    }


def _sina_hq_page(page: int, node: str = "hs_a", num: int = 100) -> list[dict]:
    url = (
        "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
        f"Market_Center.getHQNodeData?page={page}&num={num}&sort=changepercent&asc=0&node={node}"
    )
    payload = json.loads(_http_bytes(url, timeout=15, retries=2).decode("utf-8", "replace"))
    return payload if isinstance(payload, list) else []


def fetch_breadth(max_pages: int = 70) -> dict[str, Any]:
    """沪深 A 股涨跌家数 + 涨停跌停。新浪 hs_a 全量分页，约 3 秒。"""
    pages: list[list[dict]] = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futs = {pool.submit(_sina_hq_page, page): page for page in range(1, max_pages + 1)}
        for fut in as_completed(futs):
            try:
                chunk = fut.result()
            except Exception as exc:
                log.warning("sina hs_a page failed: %s", exc)
                continue
            if chunk:
                pages.append(chunk)
    rows = [row for chunk in pages for row in chunk]
    if len(rows) < 1000:
        raise RuntimeError(f"sina breadth too small: {len(rows)}")
    return classify_hq_rows(rows)


def _is_cn_a_symbol(symbol: str) -> bool:
    raw = (symbol or "").lower()
    code = raw[2:] if raw.startswith(("sh", "sz", "bj")) else raw
    if not code.isdigit() or len(code) != 6:
        return False
    return code.startswith(("60", "00", "30", "68", "92", "83", "87", "43", "82"))


def _sina_moneyflow_page(page: int, num: int = 100) -> list[dict]:
    url = (
        "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
        f"MoneyFlow.ssl_bkzj_ssggzj?page={page}&num={num}&sort=symbol&asc=0"
    )
    payload = json.loads(_http_bytes(url, timeout=15, retries=2).decode("utf-8", "replace"))
    return payload if isinstance(payload, list) else []


def fetch_main_flow_yi(max_pages: int = 80) -> float | None:
    """A 股超大单净额合计（新浪 r0_net），单位亿。不是 Wind 主力口径。"""
    rows: list[dict] = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futs = [pool.submit(_sina_moneyflow_page, page) for page in range(1, max_pages + 1)]
        for fut in as_completed(futs):
            try:
                chunk = fut.result()
            except Exception as exc:
                log.warning("sina moneyflow page failed: %s", exc)
                continue
            rows.extend(chunk or [])
    a_rows = [row for row in rows if isinstance(row, dict) and _is_cn_a_symbol(str(row.get("symbol") or ""))]
    if len(a_rows) < 1000:
        return None
    total = sum(_to_float(row.get("r0_net")) for row in a_rows)
    return round(total / 1e8, 2)


def fetch_a_indices() -> list[dict[str, Any]]:
    tencent = _tencent_quotes(wind_to_tencent(code) for code, _name in INDEX_LIST)
    rows = []
    for code, name in INDEX_LIST:
        fields = tencent.get(wind_to_tencent(code))
        if not fields:
            continue
        row = _quote_from_tencent(fields, code, name)
        if row["price"] > 0:
            rows.append({
                "code": code, "name": name, "price": row["price"],
                "change_amount": row["change_amount"], "change_pct": row["change_pct"],
                "emoji": row["emoji"],
            })
    return rows


_MAIN_FLOW_CACHE: dict[str, dict] = {}


def _main_flow_from_rows(rows: Any) -> dict[str, float]:
    """把新浪资金流日线（新→旧）折算成今日/5日/10日/20日主力净流入（亿元）。

    Wind 额度用尽后「主力5日(亿)」这一列一直是 `--`。新浪的
    MoneyFlow.ssl_qsfx_zjlrqs 每天都给 netamount（主力净流入额，元），
    按日累加即可还原 Wind 的同口径字段。港股没有该接口，调用方会跳过。
    """
    if not isinstance(rows, list) or not rows:
        return {}
    amounts: list[float] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if not row.get("opendate"):
            continue
        amounts.append(_to_float(row.get("netamount")) / 1e8)
    if not amounts:
        return {}
    return {
        "main_net_today_yi": round(amounts[0], 2),
        "main_net_5d_yi": round(sum(amounts[:5]), 2),
        "main_net_10d_yi": round(sum(amounts[:10]), 2),
        "main_net_20d_yi": round(sum(amounts[:20]), 2),
    }


def _bars_amount_yi(bars: list[dict[str, Any]], n: int = 5) -> float | None:
    """用日线成交量（手）× 均价估算近 n 日成交额（亿元）。

    腾讯/新浪都只给成交量不给成交额，东财 kline 又被限流，所以本地估算。
    用 (高+低+收)/3 当均价，大盘股误差约 0.1%~0.3%，够展示「占比」。
    """
    if not bars:
        return None
    total = 0.0
    used = 0
    for bar in bars[-n:]:
        volume = _to_float(bar.get("volume"))
        high = _to_float(bar.get("high"))
        low = _to_float(bar.get("low"))
        close = _to_float(bar.get("close"))
        prices = [x for x in (high, low, close) if x and x > 0]
        if volume <= 0 or not prices:
            continue
        total += volume * 100 * (sum(prices) / len(prices))
        used += 1
    if used == 0:
        return None
    return total / 1e8


def _main_flow_pct(net_yi: float | None, amount_yi: float | None) -> float | None:
    """主力净流入占成交额的比例（%）。Wind 的「近5日主力净流入占比」同口径。"""
    if net_yi is None or amount_yi is None or amount_yi <= 0:
        return None
    return round(net_yi / amount_yi * 100, 2)


def fetch_main_flow(wind_code: str) -> dict[str, float]:
    """单只 A 股的主力资金流（新浪）。港股/失败返回 {}，不影响主链路。"""
    wind_code = _to_wind(wind_code)
    if not wind_code or wind_code.upper().endswith(".HK"):
        return {}
    if wind_code in _MAIN_FLOW_CACHE:
        return _MAIN_FLOW_CACHE[wind_code]
    symbol = wind_to_tencent(wind_code)
    if not symbol:
        return {}
    url = ("https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
           f"MoneyFlow.ssl_qsfx_zjlrqs?daima={symbol}")
    try:
        rows = _http_json(url, timeout=15)
    except Exception as exc:
        log.warning("sina moneyflow %s failed: %s", symbol, exc)
        return {}
    out = _main_flow_from_rows(rows)
    _MAIN_FLOW_CACHE[wind_code] = out
    return out


def fetch_main_flow_map(wind_codes: Iterable[str]) -> dict[str, dict]:
    """并发拉多只股票的资金流；单只失败只影响自己那一列。"""
    codes = [c for c in (_to_wind(x) for x in wind_codes) if c and not c.upper().endswith(".HK")]
    if not codes:
        return {}
    out: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(fetch_main_flow, code): code for code in codes}
        for fut in as_completed(futures):
            code = futures[fut]
            try:
                res = fut.result()
            except Exception as exc:
                log.warning("moneyflow %s failed: %s", code, exc)
                continue
            if res:
                out[code] = res
    return out


def fetch_watchlist(codes: Iterable[str]) -> list[dict[str, Any]]:
    wind_codes = [_to_wind(code) for code in codes if code]
    east: dict[str, dict] = {}
    tencent_keys = []
    for wind_code in wind_codes:
        symbol = wind_to_tencent(wind_code)
        if wind_code.endswith(".HK"):
            tencent_keys.append(f"r_{symbol}")
        tencent_keys.append(symbol)
    tencent = {}
    try:
        tencent = _tencent_quotes(tencent_keys)
    except Exception as exc:
        log.warning("tencent watchlist failed: %s", exc)

    # 资金流走新浪（东财 fflow 已失效），并发拉取，失败只影响「主力5日」一列
    flows = fetch_main_flow_map(wind_codes)

    rows: list[dict[str, Any]] = []
    bars_by_code: dict[str, list[dict[str, Any]]] = {}
    for wind_code in wind_codes:
        bare = wind_code.split(".")[0]
        if wind_code.endswith(".HK"):
            bare = wind_code[:-3].zfill(5)
        row = _stock_row(wind_code, east.get(bare) or east.get(bare.lstrip("0") or bare))
        if row:
            rows.append(row)
            continue
        symbol = wind_to_tencent(wind_code)
        fields = tencent.get(f"r_{symbol}") or tencent.get(symbol)
        if not fields:
            continue
        q = _quote_from_tencent(fields, wind_code, wind_code)
        is_hk = wind_code.endswith(".HK")
        try:
            # 250 根日线 ≈ 一年，够算 52 周高低和 20 日走势（/invest/stock 详情页要用）
            bars = daily_bars(wind_code, n=250)
            closes = [b["close"] for b in bars]
        except Exception as exc:
            log.warning("kline %s failed: %s", symbol, exc)
            bars, closes = [], []
        kline_5d = closes[-5:] if closes else ([q["price"]] if q["price"] else [])
        prev = q["yesterday_close"]
        amplitude = round((q["high"] - q["low"]) / prev * 100, 2) if prev > 0 and q["high"] and q["low"] else 0.0
        item: dict[str, Any] = {
            "code": wind_code,
            "name": q["name"],
            "price": q["price"],
            "yesterday_close": prev,
            "open": q["open"],
            "high": q["high"],
            "low": q["low"],
            "amount_yi": q["amount_yi"],
            "change_pct": q["change_pct"],
            "amplitude": amplitude,
            # 腾讯行情字段：38 换手率 / 39 市盈率 / 45 总市值(亿) / 46 市净率
            # 港股该位是英文名，跳过；港股也不给换手率，填 0 会显示 "0.00"，留空更好
            "turnover": None if is_hk else (_to_float(fields[38]) if len(fields) > 38 else None),
            "pe_ttm": (_to_float(fields[39]) or None) if len(fields) > 39 else None,
            "pb": None if is_hk else ((_to_float(fields[46]) or None) if len(fields) > 46 else None),
            "market_cap_yi": (_to_float(fields[45]) or None) if len(fields) > 45 else None,
            "chg_5d": _chg_from_closes(closes, 5),
            "chg_20d": _chg_from_closes(closes, 20),
            "chg_ytd": _ytd_from_bars(bars) if bars else _ytd_from_closes(closes),
            "kline_5d": kline_5d,
            "kline_20d": closes[-20:] if len(closes) >= 20 else closes,
            "high_52w": _range_52w(bars)[0] if bars else (max(closes) if closes else None),
            "low_52w": _range_52w(bars)[1] if bars else (min(closes) if closes else None),
            "emoji": q["emoji"],
        }
        if wind_code.endswith(".HK"):
            item["currency"] = "HKD"
        bars_by_code[wind_code] = bars
        rows.append(item)

    for row in rows:
        code = _to_wind(row.get("code") or "")
        flow = flows.get(code)
        if not flow:
            continue
        row.update(flow)
        # 占比要 5 日成交额：腾讯分支已拿到 bars，东财分支按需补一次日线
        if row.get("main_net_5d_pct") is None and row.get("main_net_5d_yi") is not None:
            bars = bars_by_code.get(code)
            if bars is None:
                try:
                    bars = daily_bars(code, n=6)
                except Exception as exc:
                    log.warning("bars for %s failed: %s", code, exc)
                    bars = []
                bars_by_code[code] = bars
            pct = _main_flow_pct(row.get("main_net_5d_yi"), _bars_amount_yi(bars, 5))
            if pct is not None:
                row["main_net_5d_pct"] = pct
    return rows


def _hot_row(code: str, name: str, price: float, chg: float) -> dict[str, Any] | None:
    if not code or price <= 0:
        return None
    suffix = ".SH" if code.startswith("6") else ".SZ"
    limit = _price_limit(name, code)
    return {
        "name": name,
        "code": f"{code}{suffix}",
        "price": price,
        "change_pct": chg,
        "is_limit_up": chg >= limit - 0.3,
        "limit": limit,
    }


def _fetch_sina_hot_stocks(size: int = 5) -> list[dict[str, Any]]:
    url = (
        "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
        f"Market_Center.getHQNodeData?page=1&num={size}&sort=changepercent&asc=0&node=hs_a"
    )
    payload = json.loads(_http_bytes(url).decode("utf-8", "replace"))
    if not isinstance(payload, list):
        return []
    out: list[dict[str, Any]] = []
    for item in payload[:size]:
        if not isinstance(item, dict):
            continue
        row = _hot_row(
            str(item.get("code") or ""),
            str(item.get("name") or "").replace(" ", ""),
            _to_float(item.get("trade")),
            _to_float(item.get("changepercent")),
        )
        if row:
            out.append(row)
    return out


def board_sector_rows(rows: list[dict[str, Any]], up: int = 10, down: int = 10) -> list[dict[str, Any]]:
    """Keep both gainers and losers so the invest board can fill 涨幅榜 / 跌幅榜."""
    ranked = [row for row in rows if isinstance(row, dict) and row.get("name")]
    ranked.sort(key=lambda item: item.get("change_pct") or 0, reverse=True)
    head = ranked[:up]
    tail = ranked[-down:] if len(ranked) > up else []
    seen = {row.get("code") for row in head}
    return head + [row for row in tail if row.get("code") not in seen]


def parse_sina_hy_map(data: dict[str, Any], size: int = 5) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for value in data.values():
        parts = str(value).split(",")
        if len(parts) < 13:
            continue
        name = parts[1].strip()
        chg = _to_float(parts[5])
        if not name:
            continue
        rows.append({
            "code": parts[0],
            "name": name,
            "change_pct": round(chg, 2),
            "lead_stock": parts[12].strip(),
            "emoji": _emoji(chg),
        })
    rows.sort(key=lambda item: item["change_pct"], reverse=True)
    return rows[:size]


def _fetch_sina_sectors(size: int = 5) -> list[dict[str, Any]]:
    raw = _http_bytes("https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php")
    text = raw.decode("gbk", "replace")
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return []
    payload = json.loads(text[start:end + 1])
    if not isinstance(payload, dict):
        return []
    return parse_sina_hy_map(payload, size=size)


def fetch_hot_stocks(size: int = 5) -> list[dict[str, Any]]:
    try:
        raw = _eastmoney_clist(
            "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23",
            "f2,f3,f12,f14",
            size=size,
        )
    except Exception as exc:
        log.warning("eastmoney hot stocks failed: %s", exc)
        raw = []
    out: list[dict[str, Any]] = []
    for item in raw[:size]:
        row = _hot_row(
            str(item.get("f12") or ""),
            str(item.get("f14") or "").replace(" ", ""),
            _to_float(item.get("f2")),
            _to_float(item.get("f3")),
        )
        if row:
            out.append(row)
    if out:
        return out
    try:
        return _fetch_sina_hot_stocks(size=size)
    except Exception as exc:
        log.warning("sina hot stocks failed: %s", exc)
        return []


def fetch_sectors(size: int = 5) -> list[dict[str, Any]]:
    try:
        raw = _eastmoney_clist("m:90+t:2", "f3,f12,f14,f128", size=size)
    except Exception as exc:
        log.warning("eastmoney sectors failed: %s", exc)
        raw = []
    out: list[dict[str, Any]] = []
    for item in raw[:size]:
        name = str(item.get("f14") or "").strip()
        chg = _to_float(item.get("f3"))
        if not name:
            continue
        out.append({
            "code": str(item.get("f12") or ""),
            "name": name,
            "change_pct": chg,
            "lead_stock": str(item.get("f128") or "").strip(),
            "emoji": _emoji(chg),
        })
    if out:
        return out
    try:
        return _fetch_sina_sectors(size=size)
    except Exception as exc:
        log.warning("sina sectors failed: %s", exc)
        return []


def fetch_news(size: int = 3) -> list[dict[str, Any]]:
    url = f"https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&k=&num={size}&page=1"
    try:
        payload = _http_json(url, timeout=10)
    except Exception as exc:
        log.warning("sina news failed: %s", exc)
        return []
    items = ((payload.get("result") or {}).get("data") or [])
    out: list[dict[str, Any]] = []
    for item in items[:size]:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        if not title:
            continue
        snippet = str(item.get("intro") or item.get("summary") or "").replace("\n", " ").strip()
        date = ""
        try:
            ts = int(item.get("ctime") or 0)
            if ts:
                date = datetime.datetime.utcfromtimestamp(ts + 8 * 3600).strftime("%Y-%m-%d")
        except (TypeError, ValueError, OSError):
            date = ""
        out.append({
            "title": title,
            "snippet": snippet[:80],
            "url": str(item.get("url") or ""),
            "date": date,
        })
    return out


def fetch_hk_indices() -> list[dict[str, Any]]:
    tencent = _tencent_quotes(["hkHSI", "hkHSCEI", "hkHSTECH"])
    mapping = {"HSI.HI": "hkHSI", "HSCEI.HI": "hkHSCEI", "HSTECH.HI": "hkHSTECH"}
    rows = []
    for code, name, _secid in HK_INDEX_LIST:
        fields = tencent.get(mapping[code])
        if not fields:
            continue
        row = _quote_from_tencent(fields, code, name)
        if row["price"] > 0:
            rows.append({
                "code": code, "name": name, "price": row["price"],
                "change_amount": row["change_amount"], "change_pct": row["change_pct"],
                "emoji": row["emoji"],
            })
    return rows


def fetch_hk_hot_stocks(size: int = 5) -> list[dict[str, Any]]:
    try:
        raw = _eastmoney_clist("m:116+t:1,m:116+t:2,m:116+t:3", "f2,f3,f12,f14", size=size)
    except Exception as exc:
        log.warning("eastmoney HK hot stocks failed: %s", exc)
        return []
    out: list[dict[str, Any]] = []
    for item in raw[:size]:
        code = str(item.get("f12") or "").zfill(5)
        name = str(item.get("f14") or "").replace(" ", "")
        price = _to_float(item.get("f2"))
        chg = _to_float(item.get("f3"))
        if not code or price <= 0:
            continue
        out.append({
            "name": name,
            "code": f"{code}.HK",
            "price": price,
            "change_pct": chg,
        })
    return out


def fetch_public_market(stock_codes: Iterable[str], hk_stock_codes: Iterable[str] | None = None) -> dict[str, Any]:
    sentiment = {"limit_up": None, "limit_down": None, "main_flow_yi": None}
    try:
        breadth = fetch_breadth()
        sentiment.update({
            "limit_up": breadth["limit_up"],
            "limit_down": breadth["limit_down"],
            "ups": breadth["ups"],
            "downs": breadth["downs"],
            "flats": breadth["flats"],
            "total": breadth["total"],
        })
    except Exception as exc:
        log.warning("sina breadth failed: %s", exc)
    try:
        sentiment["main_flow_yi"] = fetch_main_flow_yi()
    except Exception as exc:
        log.warning("sina main flow failed: %s", exc)
    out: dict[str, Any] = {
        "asOf": datetime.datetime.now().isoformat(timespec="seconds"),
        "source": "eastmoney_fallback",
        "indices": fetch_a_indices(),
        "watchlist": fetch_watchlist(stock_codes),
        "hot_stocks": fetch_hot_stocks(),
        "sectors": board_sector_rows(fetch_sectors(size=200)),
        "sentiment": sentiment,
        "news": fetch_news(),
    }
    if hk_stock_codes:
        out["hk_indices"] = fetch_hk_indices()
        out["hk_watchlist"] = fetch_watchlist(hk_stock_codes)
        out["hk_hot_stocks"] = fetch_hk_hot_stocks()
    return out


def overlay_public_quotes(
    data: dict[str, Any],
    stock_codes: Iterable[str],
    hk_stock_codes: Iterable[str] | None = None,
) -> dict[str, Any]:
    """Replace unusable Wind sections in-place. Sets data['source']."""
    public = fetch_public_market(stock_codes, hk_stock_codes)
    replaced: list[str] = []
    for key in ("indices", "watchlist", "hot_stocks", "sectors", "hk_indices", "hk_watchlist", "hk_hot_stocks"):
        if key not in public:
            continue
        if len(valid_rows(data.get(key))) == 0 and public.get(key):
            data[key] = public[key]
            replaced.append(key)
    news = data.get("news")
    news_broken = (
        not isinstance(news, list)
        or not news
        or all(isinstance(item, dict) and (item.get("error") or not item.get("title")) for item in news)
    )
    if news_broken:
        data["news"] = public.get("news") or []
        replaced.append("news")
    sentiment = data.get("sentiment") if isinstance(data.get("sentiment"), dict) else {}
    public_sentiment = public.get("sentiment") if isinstance(public.get("sentiment"), dict) else {}
    if sentiment.get("error") or (
        sentiment.get("limit_up") is None and public_sentiment.get("limit_up") is not None
    ):
        data["sentiment"] = public_sentiment
        replaced.append("sentiment")
    data["source"] = "eastmoney_fallback" if replaced else data.get("source") or "wind"
    if replaced and any(has_price(row) for row in as_list(data.get("indices"))):
        # Mixed if Wind still had something usable before overlay; after a total
        # failure every core field is public.
        data["source"] = "eastmoney_fallback"
    scrub_credit_errors(data)
    log.info("public overlay replaced: %s (publishable=%s)", ",".join(replaced) or "none", is_publishable(data))
    return data


def fill_missing_quotes(
    data: dict[str, Any],
    stock_codes: Iterable[str],
    hk_stock_codes: Iterable[str] | None = None,
    public: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Wind 部分成功、部分行缺价时，逐行/逐字段用公开行情补齐空洞。

    `overlay_public_quotes` 只在整个板块"全空"时替换；Wind 只是 QPS 限流
    掉几行（典型：深证成指、某只自选股、涨幅榜全 0）时不会触发，日报就会
    出现"数据暂缺"。本函数按 code / 字段对齐，只补坏掉的那几行。
    """
    public = public if isinstance(public, dict) else fetch_public_market(stock_codes, hk_stock_codes)
    filled: list[str] = []

    def _index(rows: Any) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for row in as_list(rows):
            if isinstance(row, dict) and row.get("code"):
                out[str(row["code"])] = row
        return out

    # ── A 股指数：按 INDEX_LIST 顺序重建，坏行用公开行情顶上 ──
    wind_idx = _index(data.get("indices"))
    pub_idx = _index(public.get("indices"))
    if wind_idx or pub_idx:
        merged: list[dict] = []
        for code, name in INDEX_LIST:
            wind_row = wind_idx.get(code)
            pub_row = pub_idx.get(code)
            if isinstance(wind_row, dict) and has_price(wind_row):
                merged.append(wind_row)
            elif isinstance(pub_row, dict) and has_price(pub_row):
                merged.append(pub_row)
                filled.append(f"index:{name}")
            elif isinstance(wind_row, dict):
                merged.append(wind_row)
            elif isinstance(pub_row, dict):
                merged.append(pub_row)
        known = {code for code, _ in INDEX_LIST}
        for code, row in wind_idx.items():
            if code not in known and has_price(row):
                merged.append(row)  # 保留 Wind 额外指数（如科创50）
        if merged:
            data["indices"] = merged

    # ── 自选股 / 港股：按 code 对齐，缺价或被丢掉的行补回来 ──
    def _fill_list(key: str, label: str) -> None:
        wind_rows = _index(data.get(key))
        pub_rows = _index(public.get(key))
        if not wind_rows and not pub_rows:
            return
        merged_rows = []
        seen: set[str] = set()
        for row in as_list(data.get(key)):
            if not isinstance(row, dict):
                continue
            code = str(row.get("code") or "")
            if has_price(row) or not code:
                merged_rows.append(row)
                seen.add(code)
                continue
            replacement = pub_rows.get(code)
            if isinstance(replacement, dict) and has_price(replacement):
                merged_rows.append(replacement)
                filled.append(f"{label}:{replacement.get('name') or code}")
            else:
                merged_rows.append(row)
            seen.add(code)
        for code, row in pub_rows.items():
            if code not in seen and has_price(row):
                merged_rows.append(row)
                filled.append(f"{label}:{row.get('name') or code}(append)")
        if merged_rows:
            data[key] = merged_rows

    _fill_list("watchlist", "watch")
    _fill_list("hk_watchlist", "hk_watch")
    _fill_list("hk_indices", "hk_index")

    # ── 涨幅榜：Wind 只返回占位 0 时整段替换（口径同为涨幅榜，可替换） ──
    hot = as_list(data.get("hot_stocks"))
    pub_hot = as_list(public.get("hot_stocks"))
    if pub_hot and (not hot or not all(has_price(row) for row in hot)):
        data["hot_stocks"] = pub_hot
        filled.append("hot_stocks")

    # ── 板块：Wind 是申万一级，公开行情是东财细分行业，只在整个板块失效时替换 ──
    # 注意 has_price() 不适用：板块行只有 change_pct，没有 price。
    sectors = as_list(data.get("sectors"))
    pub_sectors = as_list(public.get("sectors"))

    def _sector_ok(row: Any) -> bool:
        if not isinstance(row, dict) or row.get("error"):
            return False
        try:
            float(row.get("change_pct"))
        except (TypeError, ValueError):
            return False
        return True

    sectors_usable = bool(sectors) and any(_sector_ok(row) for row in sectors) and not all(
        isinstance(row, dict) and row.get("error") for row in sectors
    )
    if pub_sectors and not sectors_usable:
        data["sectors"] = pub_sectors
        filled.append("sectors")

    # ── 市场情绪：逐字段补 ──
    sentiment = data.get("sentiment") if isinstance(data.get("sentiment"), dict) else {}
    pub_sentiment = public.get("sentiment") if isinstance(public.get("sentiment"), dict) else {}
    if sentiment.get("error"):
        sentiment = {}
    for field in ("limit_up", "limit_down", "main_flow_yi", "ups", "downs", "flats", "total"):
        if sentiment.get(field) is None and pub_sentiment.get(field) is not None:
            sentiment[field] = pub_sentiment[field]
            filled.append(f"sentiment.{field}")
    if sentiment:
        data["sentiment"] = sentiment

    if filled:
        data["source"] = "mixed" if data.get("source") in (None, "wind") else data.get("source")
        log.info("gap fill from public quotes: %s", ", ".join(filled))
    # Wind 额度耗尽的节点会留在 details / 新闻里，不清掉 publisher 会拒档
    scrub_credit_errors(data)
    return data


def build_public_details(data: dict, detail_codes: Iterable[str] | None = None) -> dict[str, dict]:
    """Wind 单股深度不可用时，用公开行情拼一份等价的 details 快照。

    publisher._build_details_json_snapshot() 会用 watchlist 行填 Stock 的顶层字段
    （价格 / 涨跌 / 换手 / PE / PB / 总市值 / 52 周高低都已由 fetch_watchlist 带出），
    这里补 details 里唯一能靠公开行情拿到的 kline_20d，让 /invest/stock 的走势图
    不至于空着。Wind 独有的 consensus / 资金流 / 一致预期 / 公告仍缺失，页面显示 "—"。
    """
    wanted = {_to_wind(c) for c in (detail_codes or []) if c}
    out: dict[str, dict] = {}
    for key in ("watchlist", "hk_watchlist"):
        for row in data.get(key) or []:
            if not isinstance(row, dict) or not row.get("code"):
                continue
            code = row["code"]
            if wanted and code not in wanted:
                continue
            entry: dict[str, Any] = {"source": "public"}
            if row.get("kline_20d"):
                entry["kline_20d"] = row["kline_20d"]
            out[code] = entry
    return out

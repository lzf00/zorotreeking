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
        return code.upper()
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
    payload = _http_json(f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?{query}", timeout=15)
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
        })
    return bars


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

    rows: list[dict[str, Any]] = []
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
        try:
            closes = _tencent_closes(symbol, n=40)
        except Exception as exc:
            log.warning("kline %s failed: %s", symbol, exc)
            closes = []
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
            "turnover": 0,
            "chg_5d": _chg_from_closes(closes, 5),
            "chg_20d": _chg_from_closes(closes, 20),
            "chg_ytd": _ytd_from_closes(closes),
            "kline_5d": kline_5d,
            "emoji": q["emoji"],
        }
        if wind_code.endswith(".HK"):
            item["currency"] = "HKD"
        rows.append(item)
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

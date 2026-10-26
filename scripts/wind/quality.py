"""Snapshot quality gates for Wind recap publish.

Refuse to ship credit-error / empty payloads that would blank the
A-share and HK boards and dump Windalice recharge text onto the site.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping, Sequence


def as_list(value: Any) -> list:
    return value if isinstance(value, list) else []


def has_price(item: Any) -> bool:
    if not isinstance(item, Mapping) or item.get("error"):
        return False
    price = item.get("price")
    try:
        number = float(price)
    except (TypeError, ValueError):
        return False
    return number == number and number != 0


def valid_rows(items: Any) -> list[dict]:
    return [row for row in as_list(items) if has_price(row)]


def payload_quality(data: Mapping[str, Any] | None) -> dict[str, int]:
    payload = data or {}
    return {
        "indices": len(valid_rows(payload.get("indices"))),
        "watchlist": len(valid_rows(payload.get("watchlist"))),
        "hot_stocks": len(valid_rows(payload.get("hot_stocks"))),
        "sectors": len(valid_rows(payload.get("sectors"))),
        "hk_indices": len(valid_rows(payload.get("hk_indices"))),
        "hk_watchlist": len(valid_rows(payload.get("hk_watchlist"))),
    }


def is_publishable(data: Mapping[str, Any] | None) -> bool:
    """Need a usable A-share tape: two indexes and at least one watchlist quote."""
    quality = payload_quality(data)
    return quality["indices"] >= 2 and quality["watchlist"] >= 1


def credit_error_text(value: Any) -> bool:
    text = str(value or "")
    return "积分余额不足" in text or "windalice" in text.lower()


_LIST_KEYS = (
    "indices", "watchlist", "hot_stocks", "sectors", "news",
    "hk_indices", "hk_watchlist", "hk_hot_stocks",
)


def looks_like_credit_failure(data: Mapping[str, Any] | None) -> bool:
    payload = data or {}
    chunks: list[Any] = [payload]
    for key in (*_LIST_KEYS, "sentiment", "details"):
        chunks.append(payload.get(key))
    return any(_walk_credit_error(chunk) for chunk in chunks)


def scrub_credit_errors(data: dict[str, Any] | None) -> dict[str, Any]:
    """Drop leftover Windalice recharge nodes so a public overlay can publish."""
    payload = data if isinstance(data, dict) else {}
    for key in _LIST_KEYS:
        value = payload.get(key)
        if not _walk_credit_error(value):
            continue
        if isinstance(value, list):
            payload[key] = [
                item for item in value
                if isinstance(item, dict) and not _walk_credit_error(item)
            ]
        else:
            payload[key] = []
    sentiment = payload.get("sentiment")
    if _walk_credit_error(sentiment):
        if isinstance(sentiment, dict):
            payload["sentiment"] = {
                key: value for key, value in sentiment.items()
                if key != "error" and not credit_error_text(value)
            }
        else:
            payload["sentiment"] = {}
    details = payload.get("details")
    if isinstance(details, dict) and _walk_credit_error(details):
        payload["details"] = {
            code: row for code, row in details.items()
            if not _walk_credit_error(row)
        }
    return payload


def _walk_credit_error(node: Any) -> bool:
    if isinstance(node, Mapping):
        if credit_error_text(node.get("error")):
            return True
        return any(_walk_credit_error(value) for value in node.values())
    if isinstance(node, Sequence) and not isinstance(node, (str, bytes)):
        return any(_walk_credit_error(item) for item in node)
    return credit_error_text(node)

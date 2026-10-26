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


def looks_like_credit_failure(data: Mapping[str, Any] | None) -> bool:
    payload = data or {}
    chunks: list[Any] = [payload]
    for key in ("indices", "watchlist", "hot_stocks", "sectors", "news",
                "hk_indices", "hk_watchlist", "hk_hot_stocks", "sentiment"):
        chunks.append(payload.get(key))
    return any(_walk_credit_error(chunk) for chunk in chunks)


def _walk_credit_error(node: Any) -> bool:
    if isinstance(node, Mapping):
        if credit_error_text(node.get("error")):
            return True
        return any(_walk_credit_error(value) for value in node.values())
    if isinstance(node, Sequence) and not isinstance(node, (str, bytes)):
        return any(_walk_credit_error(item) for item in node)
    return credit_error_text(node)

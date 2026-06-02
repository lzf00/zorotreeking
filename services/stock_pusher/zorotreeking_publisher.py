"""
zorotreeking 网站发布器
将 stock_pusher 生成的日报数据写入 zorotreeking repo 并自动 git push 触发 CI 部署

写入两份文件：
1. src/content/invest/market-recap-YYYY-MM-DD.zh.mdx    （日报全文，作为内容归档）
2. src/data/wind-market-latest.json                     （结构化数据，给 /invest/market 页面用）

仅在收盘版（15:30）触发，开盘版（10:30）不归档。
"""

import datetime
import json
import os
import subprocess
from pathlib import Path


def _is_archive_window(now: datetime.datetime = None) -> bool:
    """
    判断当前是否在归档时段（收盘后）
    - 15:00 ~ 23:59 之间触发的推送视为收盘版
    - 10:30 开盘版不归档
    手动 --now 任意时间触发也会归档（便于测试）
    """
    if now is None:
        now = datetime.datetime.now()
    hour = now.hour
    return hour >= 15  # 15:00 之后视为收盘归档


def _build_mdx(title: str, content: str, data: dict, sentiment_summary: str) -> str:
    """生成 invest collection 兼容的 mdx 文件内容"""
    now = datetime.datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    period = now.strftime("%Y-%m")

    # 转译 frontmatter 字符串里的双引号
    safe_title = title.replace('"', '\\"')
    safe_desc = sentiment_summary.replace('"', '\\"')

    frontmatter = f"""---
lang: zh
translationKey: market-recap-{date_str}
title: "{safe_title}"
description: "{safe_desc}"
date: {date_str}
period: "{period}"
tags: [market-recap, wind, daily]
draft: false
---

> 由 stock_pusher 每个交易日 15:30 收盘后自动调用 Wind 数据生成。**仅供研究参考，不构成投资建议。**

"""
    return frontmatter + content + "\n"


def _build_sentiment_summary(data: dict) -> str:
    """构造一句 description 摘要，用于 mdx frontmatter 和列表页"""
    parts = []
    for idx in data.get("indices", []):
        if "error" in idx:
            continue
        parts.append(f"{idx['name']} {idx['change_pct']:+.2f}%")
        if len(parts) >= 1:  # 只取上证
            break

    s = data.get("sentiment", {})
    lu = s.get("limit_up")
    ld = s.get("limit_down")
    mf = s.get("main_flow_yi")
    if lu is not None and ld is not None:
        parts.append(f"涨停 {lu} / 跌停 {ld}")
    if mf is not None:
        parts.append(f"主力 {mf:+.0f}亿")
    return " · ".join(parts) if parts else "Wind 数据日报"


def _build_json_snapshot(data: dict) -> dict:
    """A 股市场看板的结构化 JSON（/invest/market 使用）"""
    now = datetime.datetime.now()
    return {
        "asOf": now.isoformat(),
        "date": now.strftime("%Y-%m-%d"),
        "indices": data.get("indices", []),
        "sentiment": data.get("sentiment", {}),
        "watchlist": data.get("watchlist", []),
        "hotStocks": data.get("hot_stocks", []),
        "sectors": data.get("sectors", []),
        "news": data.get("news", []),
    }


def _build_hk_json_snapshot(data: dict) -> dict:
    """港股市场看板的结构化 JSON（/invest/hk-market 使用）"""
    now = datetime.datetime.now()
    return {
        "asOf": now.isoformat(),
        "date": now.strftime("%Y-%m-%d"),
        "indices": data.get("hk_indices", []),
        "watchlist": data.get("hk_watchlist", []),
        "hotStocks": data.get("hk_hot_stocks", []),
    }


def _build_details_json_snapshot(data: dict) -> dict:
    """单股深度数据的结构化 JSON（/invest/stock/[code] 使用）"""
    now = datetime.datetime.now()
    # 合并 A 股 + 港股 watchlist 的基础信息，再附加 details 字段
    stocks = {}
    for s in data.get("watchlist", []):
        if "code" in s:
            stocks[s["code"]] = {"market": "A", **s}
    for s in data.get("hk_watchlist", []):
        if "code" in s:
            stocks[s["code"]] = {"market": "HK", **s}
    for code, det in (data.get("details") or {}).items():
        if code in stocks:
            stocks[code]["details"] = det
    return {
        "asOf": now.isoformat(),
        "date": now.strftime("%Y-%m-%d"),
        "stocks": stocks,
    }


def _run_git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    """在指定 repo 跑 git 命令"""
    cmd = ["git", "-C", str(repo)] + list(args)
    return subprocess.run(cmd, capture_output=True, text=True, check=check, timeout=60)


def publish_to_zorotreeking(title: str, content: str, data: dict,
                            force: bool = False, dry_run: bool = False) -> bool:
    """
    主入口：将日报归档到 zorotreeking 并 git push 触发部署

    Args:
        title:    stock_pusher build_report 返回的标题
        content:  build_report 返回的 markdown 正文
        data:     fetch_all_data 返回的结构化 dict
        force:    跳过时段检查（始终归档，用于手动测试）
        dry_run:  只写文件不 git push（用于本地验证）

    Returns:
        True 表示成功（或被时段过滤跳过），False 表示真失败
    """
    if not force and not _is_archive_window():
        print("ℹ️  zorotreeking_publisher: 非收盘时段（<15:00），跳过归档")
        return True

    # 优先用 __file__ 相对路径定位 repo（services/stock_pusher 子目录场景）
    # 兜底用 ZOROTREEKING_REPO_PATH 环境变量（旧的独立 repo 场景）
    here = Path(__file__).resolve().parent
    candidate = here.parent.parent  # services/stock_pusher → services → repo 根
    repo: Path
    if (candidate / ".git").exists() and (candidate / "src" / "content" / "invest").exists():
        repo = candidate
    else:
        repo_path = os.getenv("ZOROTREEKING_REPO_PATH", "").strip()
        if not repo_path:
            print("⚠️  zorotreeking_publisher: 未找到 repo（既不在子目录里也未配 ZOROTREEKING_REPO_PATH），跳过")
            return True
        repo = Path(repo_path).expanduser().resolve()
        if not (repo / ".git").exists():
            print(f"⚠️  zorotreeking_publisher: {repo} 不是 git repo，跳过")
            return False

    now = datetime.datetime.now()
    date_str = now.strftime("%Y-%m-%d")

    # 准备多份内容
    sentiment_summary = _build_sentiment_summary(data)
    mdx = _build_mdx(title, content, data, sentiment_summary)

    files_to_write = [
        (repo / "src" / "content" / "invest" / f"market-recap-{date_str}.zh.mdx",
         mdx, "text"),
        (repo / "src" / "data" / "wind-market-latest.json",
         _build_json_snapshot(data), "json"),
    ]
    # 港股看板（仅当 data 中有港股数据时）
    if data.get("hk_indices") or data.get("hk_watchlist"):
        files_to_write.append((
            repo / "src" / "data" / "wind-hk-market-latest.json",
            _build_hk_json_snapshot(data), "json",
        ))
    # 单股深度（仅当 data 中有 details 时）
    if data.get("details"):
        files_to_write.append((
            repo / "src" / "data" / "wind-stock-details.json",
            _build_details_json_snapshot(data), "json",
        ))

    try:
        for p, payload, kind in files_to_write:
            p.parent.mkdir(parents=True, exist_ok=True)
            if kind == "json":
                p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            else:
                p.write_text(payload, encoding="utf-8")
        print("📝 zorotreeking_publisher: 已写入")
        for p, _, _ in files_to_write:
            print(f"   - {p.relative_to(repo)}")
    except Exception as e:
        print(f"❌ zorotreeking_publisher: 写文件失败: {e}")
        return False

    if dry_run:
        print("🧪 zorotreeking_publisher: dry_run=True，跳过 git push")
        return True

    # git 流程：pull --rebase → add → commit → push
    try:
        # 先拉一下，避免冲突
        r = _run_git(repo, "pull", "--rebase", "--autostash", "origin", "main", check=False)
        if r.returncode != 0:
            print(f"⚠️  git pull 失败但继续: {r.stderr.strip()[:200]}")

        rel_paths = [str(p.relative_to(repo)) for p, _, _ in files_to_write]
        _run_git(repo, "add", *rel_paths)

        # 看看有没有变化
        r_status = _run_git(repo, "status", "--porcelain", check=False)
        if not r_status.stdout.strip():
            print("ℹ️  zorotreeking_publisher: 文件无变化，跳过 commit")
            return True

        _run_git(repo, "commit", "-m",
                 f"auto: market recap {date_str} (Wind)")

        r_push = _run_git(repo, "push", "origin", "main", check=False)
        if r_push.returncode != 0:
            print(f"❌ git push 失败: {r_push.stderr.strip()[:300]}")
            return False
        print(f"✅ zorotreeking_publisher: 已推送到 zorotreeking ({date_str})")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ git 操作失败: {e.stderr or e}")
        return False
    except Exception as e:
        print(f"❌ zorotreeking_publisher: {e}")
        return False

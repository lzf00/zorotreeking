"""
zorotreeking 网站发布器
将 stock_pusher 生成的日报数据写入 zorotreeking repo 并自动 git push 触发 CI 部署

写入两份文件：
1. src/content/invest/market-recap-YYYY-MM-DD.zh.mdx    （日报全文，作为内容归档）
2. src/data/wind-market-latest.json                     （结构化数据，给 /invest/market 页面用）

仅在收盘版（15:30）触发，开盘版（10:30）不归档。
"""

import base64
import datetime
import json
import os
import ssl
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional


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


# ── GitHub Git Data API 推送（绕过 github.com:443 被墙）─────────
# 国内出口到 github.com 经常不稳，但 api.github.com 一般通畅。
# 走 REST API 一次 commit 多个文件（blob → tree → commit → ref update）。

_SSL_CTX = ssl.create_default_context()
# GitHub 证书链合法，开默认校验
GITHUB_API_BASE = "https://api.github.com"


def _gh_api(method: str, path: str, token: str, payload: Optional[dict] = None,
            timeout: int = 30) -> dict:
    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{GITHUB_API_BASE}{path}",
        data=body,
        method=method,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "wind-recap-publisher/1.0",
            **({"Content-Type": "application/json"} if body else {}),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as r:
            return json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        err_body = ""
        try:
            err_body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        raise RuntimeError(f"GitHub API {method} {path} → HTTP {e.code}: {err_body[:400]}")


def _push_via_github_api(repo_owner: str, repo_name: str, branch: str,
                          files: list[tuple[str, str]], message: str, token: str) -> bool:
    """
    用 GitHub Git Data API 一次性 commit 多个文件。
    files: [(repo_relative_path, content_text), ...]
    """
    # 1. 拿 main ref
    ref = _gh_api("GET", f"/repos/{repo_owner}/{repo_name}/git/refs/heads/{branch}", token)
    base_sha = ref["object"]["sha"]

    # 2. 拿 base tree sha
    commit_obj = _gh_api("GET", f"/repos/{repo_owner}/{repo_name}/git/commits/{base_sha}", token)
    base_tree_sha = commit_obj["tree"]["sha"]

    # 3. 上传每份文件为 blob
    tree_entries = []
    for path, text in files:
        blob = _gh_api(
            "POST", f"/repos/{repo_owner}/{repo_name}/git/blobs", token,
            {"content": text, "encoding": "utf-8"},
        )
        tree_entries.append({
            "path": path,
            "mode": "100644",
            "type": "blob",
            "sha": blob["sha"],
        })

    # 4. 建 tree
    tree = _gh_api(
        "POST", f"/repos/{repo_owner}/{repo_name}/git/trees", token,
        {"base_tree": base_tree_sha, "tree": tree_entries},
    )
    new_tree_sha = tree["sha"]

    # 5. 建 commit（committer 元信息走 token 对应账号）
    commit = _gh_api(
        "POST", f"/repos/{repo_owner}/{repo_name}/git/commits", token,
        {"message": message, "tree": new_tree_sha, "parents": [base_sha]},
    )
    new_commit_sha = commit["sha"]

    # 6. 更新 ref
    _gh_api(
        "PATCH", f"/repos/{repo_owner}/{repo_name}/git/refs/heads/{branch}", token,
        {"sha": new_commit_sha, "force": False},
    )
    print(f"✅ 已通过 GitHub API 提交 {len(files)} 个文件 → commit {new_commit_sha[:8]}")
    return True


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
        print("ℹ️  publisher: 非收盘时段（<15:00），跳过归档")
        return True

    now = datetime.datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    sentiment_summary = _build_sentiment_summary(data)
    mdx = _build_mdx(title, content, data, sentiment_summary)

    # 准备所有要写的文件（仓库相对路径 + 内容文本）
    payloads: list[tuple[str, str]] = [
        (f"src/content/invest/market-recap-{date_str}.zh.mdx", mdx),
        ("src/data/wind-market-latest.json",
         json.dumps(_build_json_snapshot(data), ensure_ascii=False, indent=2) + "\n"),
    ]
    if data.get("hk_indices") or data.get("hk_watchlist"):
        payloads.append(("src/data/wind-hk-market-latest.json",
                          json.dumps(_build_hk_json_snapshot(data), ensure_ascii=False, indent=2) + "\n"))
    if data.get("details"):
        payloads.append(("src/data/wind-stock-details.json",
                          json.dumps(_build_details_json_snapshot(data), ensure_ascii=False, indent=2) + "\n"))

    # 模式选择：
    #   GITHUB_TOKEN  存在 → 走 GitHub Git Data API（避开 github.com:443，比如国内服务器）
    #   否则          → 走本地 git push（开发机模式）
    token = os.getenv("GITHUB_TOKEN", "").strip()
    if token:
        return _publish_via_api(payloads, date_str, token, dry_run)
    else:
        return _publish_via_local_git(payloads, date_str, dry_run)


def _publish_via_api(payloads: list[tuple[str, str]], date_str: str,
                     token: str, dry_run: bool) -> bool:
    repo_full = os.getenv("GITHUB_REPO", "lzf00/zorotreeking").strip()
    if "/" not in repo_full:
        print(f"❌ GITHUB_REPO 格式错（应为 owner/name）：{repo_full}")
        return False
    owner, name = repo_full.split("/", 1)
    branch = os.getenv("GITHUB_BRANCH", "main").strip()

    print(f"📝 publisher (API mode): {len(payloads)} 个文件 → {owner}/{name}@{branch}")
    for path, _ in payloads:
        print(f"   - {path}")

    if dry_run:
        print("🧪 dry_run=True，跳过 API 提交")
        return True

    try:
        _push_via_github_api(
            repo_owner=owner, repo_name=name, branch=branch,
            files=payloads,
            message=f"auto: market recap {date_str} (Wind)",
            token=token,
        )
        return True
    except Exception as e:
        print(f"❌ publisher API push 失败: {e}")
        return False


def _publish_via_local_git(payloads: list[tuple[str, str]], date_str: str,
                           dry_run: bool) -> bool:
    repo_path = os.getenv("ZOROTREEKING_REPO_PATH", "").strip()
    if repo_path:
        repo = Path(repo_path).expanduser().resolve()
    else:
        repo = Path(__file__).resolve().parents[2]
    if not (repo / ".git").exists():
        print(f"⚠️  publisher: {repo} 不是 git repo，跳过")
        return False

    try:
        for rel_path, text in payloads:
            p = repo / rel_path
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8")
        print(f"📝 publisher (local-git): 写入 {len(payloads)} 个文件到 {repo}")
        for p_rel, _ in payloads:
            print(f"   - {p_rel}")
    except Exception as e:
        print(f"❌ 写文件失败: {e}")
        return False

    if dry_run:
        print("🧪 dry_run=True，跳过 git push")
        return True

    try:
        r = _run_git(repo, "pull", "--rebase", "--autostash", "origin", "main", check=False)
        if r.returncode != 0:
            print(f"⚠️  git pull 失败但继续: {r.stderr.strip()[:200]}")
        _run_git(repo, "add", *[rel for rel, _ in payloads])
        r_status = _run_git(repo, "status", "--porcelain", check=False)
        if not r_status.stdout.strip():
            print("ℹ️  无变化，跳过 commit")
            return True
        _run_git(repo, "commit", "-m", f"auto: market recap {date_str} (Wind)")
        r_push = _run_git(repo, "push", "origin", "main", check=False)
        if r_push.returncode != 0:
            print(f"❌ git push 失败: {r_push.stderr.strip()[:300]}")
            return False
        print(f"✅ 已推送 ({date_str})")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ git 操作失败: {e.stderr or e}")
        return False

#!/bin/bash
# 定时推送脚本（由 launchd / cron 调用）
# 兼容 Mac launchd 和 Linux cron 两种环境

# 自动定位脚本所在目录（避免硬编码）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# 给子进程一个完整 PATH（兼容窄 PATH 的 launchd / cron）
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/node@22/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# 选 python（VPS 可能没装 /usr/bin/python3）
PY="$(command -v python3 || echo /usr/bin/python3)"

"$PY" main.py --now >> push.log 2>&1

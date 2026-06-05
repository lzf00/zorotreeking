#!/usr/bin/env bash
# 下载 og:image 生成所需字体到 .fonts/（不进 git，不入 dist）。
# build 前自动跑（package.json scripts.prebuild），已存在则跳过。
#
# 字体源：Google Fonts CSS API。比 GitHub raw 稳定，给的是真 TTF（不是 OTF）。
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.fonts"
mkdir -p "$DIR"

# 从 Google Fonts CSS 拿当前 ttf 哈希链接，下载到 file
fetch_google() {
  local family="$1" weight="$2" outfile="$3"
  if [ -f "$DIR/$outfile" ]; then return; fi
  local css_url="https://fonts.googleapis.com/css2?family=${family}:wght@${weight}"
  local ttf_url
  ttf_url=$(curl -sL -A "Mozilla/5.0" "$css_url" | grep -oE 'https://[^)]+\.ttf' | head -1)
  if [ -z "$ttf_url" ]; then
    echo "  ✗ 找不到 $family $weight 的 ttf URL"
    return 1
  fi
  echo "  ↓ $outfile"
  curl -sL -o "$DIR/$outfile" "$ttf_url"
}

fetch_google "Inter" "400" "Inter-Regular.ttf"
fetch_google "Inter" "600" "Inter-Semibold.ttf"
fetch_google "Noto+Sans+SC" "400" "NotoSansSC-Regular.ttf"

echo "[setup-fonts] $(ls -1 "$DIR" | wc -l | tr -d ' ') fonts ready in .fonts/"

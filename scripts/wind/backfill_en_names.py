#!/usr/bin/env python3
"""把已发布的英文日报表格里的中文名按对照表刷成英文（第 156 轮）。

只改**表格单元格**里「整格就是一个已知名字」的情况，正文一个字不碰 ——
日报正文是机翻产物，动它有风险；表格里的名字是结构化字段，可以安全替换。

用法：
  python3 scripts/wind/backfill_en_names.py --dry-run   # 只统计
  python3 scripts/wind/backfill_en_names.py             # 就地改文件
"""
import argparse
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from finance_names import SECTOR_EN, STOCK_EN  # noqa: E402

NAMES = {**SECTOR_EN, **STOCK_EN}
CJK = re.compile(r"[\u4e00-\u9fff]")
EMOJI = re.compile(r"^[🔴🟢⚪⚫🚀💥💰📈🌡️💼🔥🇭🇰\s]+")


def fix_cell(cell: str) -> str:
    prefix = EMOJI.match(cell)
    head = prefix.group(0) if prefix else ""
    body = cell[len(head):].strip()
    # 去掉行内代码（`300528.SZ`）后再比对
    code = re.findall(r"`[^`]*`", body)
    bare = re.sub(r"`[^`]*`", "", body).strip()
    if not bare or not CJK.search(bare):
        return cell
    en = NAMES.get(bare)
    if en:
        return f"{head}{en} " + " ".join(code) if code else f"{head}{en}"
    # 查不到公开英文名时，宁可只留股票代码也不留中文 —— 第 183 轮：
    # 英文版表格里出现「菱电电控 `688667.SH`」既让英文读者读不懂，也会触发
    # `check:i18n-leaks`。代码是全球通用的标识，不含歧义，也不编造"官方译名"。
    if code:
        return f"{head}" + " ".join(code)
    return cell


def fix_line(line: str) -> tuple[str, int]:
    if not line.lstrip().startswith("|"):
        return line, 0
    parts = line.split("|")
    changed = 0
    for i, cell in enumerate(parts):
        if not CJK.search(cell):
            continue
        stripped = cell.strip()
        if not stripped or set(stripped) <= set("-: "):
            continue
        fixed = fix_cell(stripped)
        if fixed != stripped:
            parts[i] = f" {fixed} "
            changed += 1
    return "|".join(parts), changed


def fix_markdown(text: str) -> tuple[str, int]:
    """就地修一段 markdown 文本里的表格单元格，返回 (新文本, 改了几格)。

    第 183 轮把它接进生成流程：回填脚本原来只是"一次性补历史"，
    新生成的英文日报照样能把中文名写进表格 → 撞上 `tests/finance-names.test.ts`
    的守卫 → 每次部署都失败（2026-11-23 实测卡住 40 分钟，线上停在旧版本）。
    现在发布前就修，守卫只会拦真正的回归。
    """
    lines, total = [], 0
    for line in text.splitlines():
        fixed, n = fix_line(line)
        lines.append(fixed)
        total += n
    return "\n".join(lines) + ("\n" if text.endswith("\n") else ""), total


HEADLINES_POINTER = (
    "Headlines come from Chinese financial feeds and are published in the "
    "[Chinese edition](/invest/market-recap-{date}/)."
)

HEADLINE_HEAD = re.compile(r"^##\s*\U0001F4F0\s*Today's Headlines\s*$", re.M)


def fix_headlines(text: str, date: str) -> tuple[str, bool]:
    """把英文版「今日要闻」整段换成一句指向中文版的话。

    第 183 轮在生成端（`fetcher.build_report_en`）改过，但生成端是服务器上
    `/opt/wind-recap` 的独立副本，不会跟着仓库更新 —— 第 185 轮它又照搬了中文标题 +
    中文摘要，`check:i18n-leaks` 因此把门禁打红。这里在接收端兜住同一件事。
    只动这一个段落，其他内容一个字不碰。
    """
    match = HEADLINE_HEAD.search(text)
    if not match:
        return text, False
    start = match.start()
    # 段落结束：下一个二级标题，或者分隔线
    rest = text[match.end():]
    end_rel = None
    cut = re.search(r"(?m)^(##\s|<!--\s*more\s*-->|---$)", rest)
    if cut:
        end_rel = match.end() + cut.start()
    else:
        end_rel = len(text)
    section = text[start:end_rel]
    # 只处理"读者真读不懂"的段落：至少有一行汉字 ≥15 个（与 `check-i18n-leaks` 同口径）。
    # 少于这个量的是链接标题里的专名，替换掉反而丢信息。
    if not any(len(CJK.findall(line)) >= 15 for line in section.splitlines()):
        return text, False
    if CJK.search(section) is None:
        return text, False
    fixed = f"## \U0001F4F0 Today's Headlines\n\n{HEADLINES_POINTER.format(date=date)}\n\n"
    return text[:start] + fixed + text[end_rel:], True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--headlines",
        action="store_true",
        help="同时把英文版「今日要闻」整段换成指向中文版的一句话（生成端副本未同步时兜底）",
    )
    args = ap.parse_args()

    files = sorted(pathlib.Path("src/content/invest").glob("market-recap-*.en.mdx"))
    total_files = total_cells = 0
    for path in files:
        raw = path.read_text(encoding="utf-8")
        headlines = False
        if args.headlines:
            raw, headlines = fix_headlines(raw, path.name.replace("market-recap-", "").replace(".en.mdx", ""))
        out_lines, cells = [], 0
        for line in raw.splitlines(keepends=False):
            fixed, n = fix_line(line)
            out_lines.append(fixed)
            cells += n
        if headlines:
            print(f"{path.name}: 今日要闻改为指向中文版")
        if cells or headlines:
            total_files += 1
            total_cells += cells
            print(f"{path.name}: {cells} 格")
            if not args.dry_run:
                path.write_text("\n".join(out_lines) + "\n", encoding="utf-8")
    verb = "可改" if args.dry_run else "已改"
    print(f"\n{verb} {total_cells} 个单元格，涉及 {total_files}/{len(files)} 个文件")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

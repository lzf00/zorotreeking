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
    if not en:
        return cell
    return f"{head}{en} " + " ".join(code) if code else f"{head}{en}"


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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    files = sorted(pathlib.Path("src/content/invest").glob("market-recap-*.en.mdx"))
    total_files = total_cells = 0
    for path in files:
        raw = path.read_text(encoding="utf-8")
        out_lines, cells = [], 0
        for line in raw.splitlines(keepends=False):
            fixed, n = fix_line(line)
            out_lines.append(fixed)
            cells += n
        if cells:
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

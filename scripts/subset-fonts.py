#!/usr/bin/env python3
"""把自托管字体裁到站点真正用到的字符（第 227 轮）。

为什么做这件事：
    自托管的三份 woff2 一共 101.5 KB，是日报页上**最大的一块固定开销**
    （比整页脚本 + 分享栏还大）。但它们带着整套 Google latin 子集：Inter 230 个字形、
    JetBrains Mono 229 个，而站点实际只用到其中 126–131 个。剩下的字形连同
    可变字重轴上的冗余 deltas 一起白下。

做法：
    · 语料 = dist 下所有 HTML 的可见文本 + src 里的源码文本（构建前后都能跑）
    · 每个字体只保留「语料用到 ∩ 字体本来就有」的码点，外加一套安全字符（ASCII、
      中西文标点、箭头、货币符号等），保证正文永远不会因为裁剪掉字形而变成豆腐块
    · Inter 的可变轴 100..900 收窄到 300..700，JetBrains Mono 的 100..800 收窄到
      400..700 —— 依据是 dist 里**元素上**出现过的字重只有 300/400/500/550/600/700
      （CSS 里 `.font-black{font-weight:900}` 这类工具类规则不算，得看有没有元素用它）
    · 不动字体的度量：hmtx / OS2 / ascent / descent 原样保留，所以第 75/148 轮标定过的
      `size-adjust` 兜底数值全部继续有效，CLS 不会因为裁字体而变

用法：
    python3 scripts/subset-fonts.py            # 重新裁剪并写 scripts/font-coverage.json
    python3 scripts/subset-fonts.py --check    # 只校验：语料里的字符是否都被覆盖

依赖：pip install fonttools brotli（本脚本不常跑，不进构建流程）
产物进 git，构建期不联网、不需要 Python。
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONT_DIR = ROOT / "src" / "assets" / "fonts"
MANIFEST = ROOT / "scripts" / "font-coverage.json"

# 语料之外再保一手：万一以后正文里冒出这些字符，也不必重跑脚本
SAFETY = (
    "".join(chr(c) for c in range(0x20, 0x7F))
    + "\u00a0\u00ab\u00bb\u00b0\u00b7\u00d7\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026"
    + "\u2190\u2191\u2192\u2193\u2212\u2264\u2265\u00a9\u00ae\u2122\ufffd"
)

# name → (源文件, 输出文件, 可变轴收窄范围 or None)
FONTS = {
    "Instrument Serif": ("instrument-serif-400-latin.woff2", "instrument-serif-400-latin.woff2", None),
    "Instrument Serif Italic": (
        "instrument-serif-italic-400-latin-italic.woff2",
        "instrument-serif-italic-400-latin-italic.woff2",
        None,
    ),
    "Inter": ("inter-100-900-latin.woff2", "inter-300-700-latin.woff2", (300, 700)),
    "JetBrains Mono": ("jetbrains-mono-100-800-latin.woff2", "jetbrains-mono-400-700-latin.woff2", (400, 700)),
}

SCAN_SUFFIXES = {".html", ".mdx", ".astro", ".tsx", ".ts", ".css", ".json", ".md"}


def corpus_text() -> str:
    chunks: list[str] = []
    for root in ("dist", "src"):
        base = ROOT / root
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if path.suffix not in SCAN_SUFFIXES or not path.is_file():
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            if path.suffix == ".html":
                text = re.sub(r"<script.*?</script>|<style.*?</style>", " ", text, flags=re.S)
                text = re.sub(r"<[^>]+>", " ", text)
            chunks.append(text)
    return "".join(chunks)


def require_fonttools():
    try:
        import brotli  # noqa: F401
        import fontTools  # noqa: F401
    except ImportError:
        sys.exit("缺少依赖：pip install fonttools brotli")
    return fontTools


def unicode_range(codepoints: list[int]) -> str:
    """把码点集合压成 CSS unicode-range 写法（连续区间合并）。"""
    runs: list[str] = []
    start = prev = None
    for cp in sorted(codepoints):
        if start is None:
            start = prev = cp
        elif cp == prev + 1:
            prev = cp
        else:
            runs.append((start, prev))
            start = prev = cp
    if start is not None:
        runs.append((start, prev))
    return ", ".join(f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in runs)


def main() -> int:
    check_only = "--check" in sys.argv
    fontTools = require_fonttools()
    from fontTools.ttLib import TTFont

    text = corpus_text()
    if not text:
        sys.exit("语料为空：先跑一次构建，或在仓库根目录执行")
    present = set(text)
    print(f"语料：{len(present)} 个不同字符")

    manifest: dict[str, object] = {"note": "由 scripts/subset-fonts.py 生成，勿手改", "faces": {}}
    previous = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {"faces": {}, "known_uncovered": ""}
    prev_known = set(previous.get("known_uncovered", ""))
    covered: set[str] = set()
    problems: list[str] = []

    for name, (src_name, out_name, axis) in FONTS.items():
        src, out = FONT_DIR / src_name, FONT_DIR / out_name
        if not src.exists() and not out.exists():
            sys.exit(f"找不到字体文件：{src_name}")
        # --check 时以已有产物为准（源文件可能已被裁过）
        probe = out if out.exists() else src
        cmap = TTFont(probe).getBestCmap()
        keep = sorted({ord(ch) for ch in (present | set(SAFETY)) if ord(ch) in cmap})
        covered |= {chr(cp) for cp in cmap}
        manifest["faces"][out_name] = {
            "family": name,
            "codepoints": keep,
            "unicode_range": unicode_range(keep),
            "axis": list(axis) if axis else None,
        }
        if check_only:
            print(f"  ✓ {out_name}: {len(keep)} 码点")
            continue

        tmp = Path("/tmp") / f"zoro-subset-{name.replace(' ', '-')}.woff2"
        unicodes = ",".join(f"U+{cp:04X}" for cp in keep)
        subprocess.run(
            [
                sys.executable, "-m", "fontTools.subset", str(probe),
                f"--unicodes={unicodes}", "--flavor=woff2", "--layout-features=*",
                f"--output-file={tmp}",
            ],
            check=True,
            capture_output=True,
        )
        if axis:
            lo, hi = axis
            clamped = tmp.with_suffix(".clamp.woff2")
            subprocess.run(
                [sys.executable, "-m", "fontTools.varLib.instancer", str(tmp), f"wght={lo}:{hi}", "--output", str(clamped)],
                check=True,
                capture_output=True,
            )
            shutil.move(clamped, tmp)
        before = probe.stat().st_size
        shutil.move(tmp, out)
        after = out.stat().st_size
        print(f"  {out_name}: {before / 1024:.1f} KB → {after / 1024:.1f} KB")
        if src != out and src.exists():
            src.unlink()

    # 字体覆盖不到、只能落到系统字体的字符（中文、emoji、箭头、特殊符号…）
    uncovered = "".join(sorted(ch for ch in present if ch not in covered and ord(ch) <= 0x2E00))
    manifest["known_uncovered"] = uncovered
    manifest["cjk_uncovered_count"] = sum(1 for ch in present if ch not in covered and ord(ch) > 0x2E00)

    if check_only:
        stale = sorted(set(uncovered) - prev_known)
        if stale:
            problems.append(f"语料里有清单外的字符：{''.join(stale)} —— 跑一次 python3 scripts/subset-fonts.py")
        if problems:
            print("\n".join(problems))
            return 1
        return 0

    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"覆盖清单：{MANIFEST.relative_to(ROOT)}（清单外字符 {len(uncovered)} 个，CJK/emoji 走系统字体）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

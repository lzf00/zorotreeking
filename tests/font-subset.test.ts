/**
 * 字体子集（第 227 轮）。
 *
 * 背景：自托管的三份 woff2 合计 101.5 KB，是日报页上最大的一块固定开销。它们带着
 * 整套 Google latin 子集（Inter 230 字形 / JetBrains Mono 229 字形），而站点实际只用到
 * 126–131 个 —— 剩下的字形连同可变字重轴上用不到的 deltas 一起白下。
 *
 * 裁剪后：101.5 KB → 75.7 KB，日报页实测量 65 KB（原来 101.5 KB）。
 * 度量表（hmtx / OS2 / ascent / descent）原样保留，所以第 75 / 148 轮标定的
 * `size-adjust` 兜底数值继续有效，CLS 不受影响。
 *
 * 这里的守卫防的是两件事：
 *   1. 有人重新跑 `scripts/fetch-fonts.ts` 把完整字体down回来 —— 靠体积上限拦住；
 *   2. 内容里出现字体没有的新字符 —— 靠「语料 ⊆ 覆盖清单 ∪ 已知缺失」拦住。
 */
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (rel: string) => readFile(join(ROOT, rel), "utf8");

type Manifest = {
  faces: Record<string, { family: string; codepoints: number[]; unicode_range: string; axis: number[] | null }>;
  known_uncovered: string;
  cjk_uncovered_count: number;
};

/** 体积上限（KB）：超过说明字体又变回未裁剪的完整拉丁子集了。 */
const SIZE_CAPS: Record<string, number> = {
  "instrument-serif-400-latin.woff2": 12,
  "instrument-serif-italic-400-latin-italic.woff2": 13,
  "inter-300-700-latin.woff2": 32,
  "jetbrains-mono-400-700-latin.woff2": 27,
};

test("字体文件保持裁剪后的体积（否则日报页白下 30+ KB）", async () => {
  for (const [file, capKB] of Object.entries(SIZE_CAPS)) {
    const info = await stat(join(ROOT, "src/assets/fonts", file));
    const kb = info.size / 1024;
    assert.ok(kb <= capKB, `${file} 现在 ${kb.toFixed(1)} KB，超过上限 ${capKB} KB —— 重新跑了 fetch-fonts？裁一次`);
  }
});

test("fonts.css 与布局预载指向的正是裁剪后的文件", async () => {
  const css = await read("src/styles/fonts.css");
  assert.match(css, /src: url\("\.\.\/assets\/fonts\/inter-300-700-latin\.woff2"\)/, "正文 Inter 要用裁剪版");
  assert.match(css, /font-weight: 300 700;[\s\S]{0,120}inter-300-700-latin/, "Inter 的声明字重范围要和实际轴一致");
  assert.match(css, /src: url\("\.\.\/assets\/fonts\/jetbrains-mono-400-700-latin\.woff2"\)/, "等宽体要用裁剪版");
  assert.match(css, /font-weight: 400 700;[\s\S]{0,120}jetbrains-mono-400-700-latin/, "等宽体的声明字重范围要和实际轴一致");
  const layout = await read("src/layouts/BaseLayout.astro");
  assert.match(layout, /inter-300-700-latin\.woff2\?url/, "预载 URL 要跟着改名");
  assert.doesNotMatch(css, /inter-100-900-latin|jetbrains-mono-100-800-latin/, "还留着完整字体的引用");
});

test("字体覆盖清单能覆盖站点里出现的每个实验性字符", async () => {
  const manifest = JSON.parse(await read("scripts/font-coverage.json")) as Manifest;
  const covered = new Set<number>();
  for (const face of Object.values(manifest.faces)) for (const cp of face.codepoints) covered.add(cp);
  const known = new Set([...manifest.known_uncovered].map((ch) => ch.codePointAt(0)));

  const unknowns = new Map<string, number>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!/\.(mdx|astro|tsx?|md|json|css)$/.test(entry.name)) continue;
      const text = await read(full.slice(ROOT.length));
      for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        // 中文/emoji 一直由系统字体渲染，不归 webfont 管；只看拉丁与符号区
        if (cp > 0x2e00 || cp < 0x20 || cp === 0x7f) continue;
        if (covered.has(cp) || known.has(cp)) continue;
        unknowns.set(ch, (unknowns.get(ch) ?? 0) + 1);
      }
    }
  };
  for (const dir of ["src/content", "src/components", "src/pages", "src/lib", "src/i18n", "src/layouts"]) {
    await walk(join(ROOT, dir));
  }
  const list = [...unknowns.keys()].join("");
  assert.equal(list, "", `内容里出现字体覆盖清单外的新字符（会掉到系统字体）：${list} —— 跑 python3 scripts/subset-fonts.py 更新清单`);
});

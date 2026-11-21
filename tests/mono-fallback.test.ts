/**
 * 等宽字体也要有度量匹配的兜底（第 148 轮）。
 *
 * 机制（算出来的，不是猜的）：
 *   JetBrains Mono 行盒 = ascent 1.02 + descent 0.30 = 1.32 em
 *   DejaVu Sans Mono（Linux runner 上 `font-mono` 实际落到的字体）= 0.928 + 0.236 = 1.164 em
 * 字体到货后行盒长高 13% → 表格行跟着长高 → 下面所有内容位移。
 * CI 注解里那几行 `TD.text-right font-mono` + `SECTION` 正是这个形态。
 *
 * macOS 落到 Menlo，行盒也是 1.32 —— 所以本机量不出来（这也解释了"我复现不了"）。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("兜底字面存在，且三个 override 都写了", async () => {
  const css = await read("src/styles/fonts.css");
  const start = css.indexOf('font-family: "JetBrains Mono Fallback"');
  assert.ok(start > 0, "没有 JetBrains Mono Fallback 兜底");
  const block = css.slice(start, start + 900);
  assert.match(block, /local\("DejaVu Sans Mono"\)/, "Linux 上要能命中 DejaVu Sans Mono");
  assert.match(block, /size-adjust: 99\.7%/);
  // 行盒 = ascent + descent，必须凑到 1.32 em；只调宽度不够
  const ascent = Number(/ascent-override: ([\d.]+)%/.exec(block)?.[1]);
  const descent = Number(/descent-override: ([\d.]+)%/.exec(block)?.[1]);
  assert.ok(Math.abs(ascent + descent - 132.5) < 1, `行盒应为 132.5% 左右，实际 ${ascent + descent}%`);
});

test("所有等宽字体栈都挂上了兜底字面", async () => {
  const config = await read("tailwind.config.mjs");
  const mono = /mono: \[([\s\S]*?)\]/.exec(config)?.[1] ?? "";
  assert.match(mono, /"JetBrains Mono Fallback"/, "tailwind 的 font-mono 栈没挂兜底");
  for (const file of [
    "src/components/travel/RouteGuideShell.astro",
    "src/components/travel/AliCentralLoopGuide.astro",
    "src/components/travel/LhasaLanzhouGuide.astro",
  ]) {
    const source = await read(file);
    // 逗号后不一定有空格（不同文件排版不同），别把格式当契约
    assert.match(source, /"JetBrains Mono",\s*"JetBrains Mono Fallback"/, `${file} 的自定义 mono 变量没挂兜底`);
  }
});

test("门禁的兜底检查覆盖等宽字体（宽度 + 行盒）", async () => {
  const check = await read("scripts/check-font-fallback.mjs");
  assert.match(check, /"JetBrains Mono Fallback"/);
  const pairs = check.slice(check.indexOf("const PAIRS"), check.indexOf("const server"));
  assert.match(pairs, /Mono 400/);
  assert.match(pairs, /Mono 600/);
});

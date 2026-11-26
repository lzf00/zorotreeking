/**
 * 可访问性巡检的两个「测量 bug」+ 一个真实对比度 bug（第 83 轮）。
 *
 * 背景：每周的 a11y 巡检连续红了两周。排查后是两类问题混在一起：
 *
 * 1. **测量假阳性**：列表页有 170 张卡片在首屏之外，它们带 `transition-colors`。
 *    Chromium 对「从未被绘制过」的元素不推进 transition，`getComputedStyle` 一直返回
 *    过渡起点（浅色 #fff），于是 axe 报 162 条「深色主题下浅灰字压白底」。
 *    手动 scrollIntoView 后同一元素立刻变成 rgba(24,24,27,.4) —— 站点是对的、测量是错的。
 *
 * 2. **真 bug**：相册页 `body:has(.photo-immersive)` 强制 #0a0a0a 深底，但
 *    `--danger-text` 只有浅色主题值 #b91c1c（red-700，在 #0a0a0a 上 3.05:1）。
 *    更糟的是反馈按钮初始加载失败会把错误码画成这条红字，而线上 `/api/feedback`
 *    的 GET 就是 422 —— 等于每篇文章底部都有一条看不清的红字。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

/** WCAG 相对亮度与对比度（用来把「这条颜色到底够不够」写成可执行的断言）。 */
export function relativeLuminance(hex) {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(hexA, hexB) {
  const [a, b] = [relativeLuminance(hexA), relativeLuminance(hexB)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

test("关掉过渡必须在 axe 测量之前注入，否则首屏外的卡片会一直读到浅色过渡起点", async () => {
  const script = await read("scripts/check-a11y.mjs");
  const styleAt = script.indexOf("await page.addStyleTag({");
  const axeAt = script.indexOf("await page.addScriptTag({ content: axe.source })");
  assert.ok(styleAt > 0, "要有一次 addStyleTag 关掉过渡");
  assert.ok(axeAt > styleAt, "关过渡必须发生在注入 axe / 跑 axe 之前");
  const block = script.slice(styleAt, axeAt);
  assert.match(block, /transition: none !important/);
  assert.match(block, /animation: none !important/);
});

test("沉浸式相册页必须覆盖 --danger-text（浅色主题的 red-700 在近黑底上不够）", async () => {
  const layout = await read("src/layouts/PhotoLayout.astro");
  const immersiveAt = layout.indexOf("body:has(.photo-immersive) {");
  assert.ok(immersiveAt > 0, "要有沉浸式深底规则");
  const block = layout.slice(immersiveAt, immersiveAt + 900);
  const match = /--danger-text:\s*(#[0-9a-fA-F]{6})/.exec(block);
  assert.ok(match, "沉浸式区块里要钉一个暗底专用的 --danger-text");

  const lightThemeValue = "#b91c1c"; // global.css 的浅色主题值
  assert.ok(contrastRatio(lightThemeValue, "#0a0a0a") < 4.5, "red-700 在 #0a0a0a 上确实不到 4.5:1（这就是 bug）");
  assert.ok(
    contrastRatio(match[1], "#0a0a0a") >= 4.5,
    `沉浸式页面用的 ${match[1]} 在 #0a0a0a 上要 >= 4.5:1，实测 ${contrastRatio(match[1], "#0a0a0a").toFixed(2)}`,
  );
});

test("反馈按钮的自动加载失败不能把错误码甩给访客（只有投票失败才显示）", async () => {
  // 第 226 轮：组件从 React 岛换成 Astro + 原生 script，这条规则不变。
  const component = await read("src/components/FeedbackButtons.astro");
  const script = component.slice(component.indexOf("<script>"));
  const ensureAt = script.indexOf("const ensureLoaded");
  const voteAt = script.indexOf("const vote =");
  assert.ok(ensureAt > 0 && voteAt > ensureAt, "按需加载与 vote 两段都要在");

  // 第 86 轮起初始加载本身被删掉了（改按需），但「自动拉取失败不显示错误」这条不变
  const loadBlock = script.slice(ensureAt, voteAt);
  assert.ok(!/setError\(/.test(loadBlock), "自动加载段不许调用 setError —— 那会在每篇文章底部渲染一条红字");
  assert.match(loadBlock, /console\.warn/, "失败要留一条 warn 方便排查");

  // 挂载时也不许拉取
  const mountBlock = script.slice(0, ensureAt);
  assert.ok(!/loadFeedbackOrEmpty\(|postFeedback\(|fetch\(/.test(mountBlock.replace(/import[^;]+;/g, "")), "挂载阶段不许发请求");

  // 用户主动投票失败时仍然要能看到错误码
  assert.match(script.slice(voteAt), /setError\(row/, "vote 失败仍然要提示状态码");
});


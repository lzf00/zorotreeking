#!/usr/bin/env node
/**
 * 扫一遍构建产物：确认「依赖当前时间」的文案没有被写进 SSR HTML。
 *
 * 为什么需要：这类文案在构建时刻算一次、在浏览器里再算一次。只要访问时间跨过边界
 * （交易时段、净值发布窗口、周末），两次结果就不一致，React 直接抛 hydration
 * mismatch（#418）——用户看到的是每页一条控制台红字，而且只有「访问时刻 ≠ 构建时刻」
 * 才复现，本地跑一遍很难撞上。第 69 轮线上 /invest/ 就是这样被抓到的。
 *
 * 所以规则很简单：**凡是有「现在几点」语义的文案，都等挂载后再渲染，SSR 里必须是空的**。
 * 这个脚本把这条规则变成门禁，扫全部 1000+ 页，比人工盯组件可靠。
 *
 * 用法：node scripts/check-ssr-clock.mjs [--dist=dist]
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const dist = args.find((a) => a.startsWith("--dist="))?.slice(7) ?? "dist";

/** 只收「一定由时钟推导出来」的文案；内容里出现的普通词不算。 */
const CLOCK_STRINGS = [
  "净值发布窗口",
  "（未开盘）",
  "（周末休市）",
  "（午间休市）",
  "（已收盘）",
  "（回退缓存）",
  "刷新中…",
  // 第 216 轮：兜底快照的新鲜度后缀。它在第 209 轮被写进 SSR，只在"快照日期 == 构建日期"
  // 的日子炸出 React #418（每天上午），下午重跑就绿 —— 典型假信号。这里把它钉进黑名单。
  "（非今日）",
];

/**
 * 允许出现在 SSR 里的例外（页面路径片段 + 文案）。
 *
 * 判断标准：这页是**纯静态文档**，那句话是给人读的说明文字，不是由时钟渲染出来的内容 ——
 * 静态页没有水合，也就不存在 SSR/client 不一致。
 */
const ALLOW = [
  // 更新日志与「现在」页在讲第 215/216 轮这件事，正文里必然出现这个词
  ["changelog/index.html", "（非今日）"],
  ["now/index.html", "（非今日）"],
];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.name.endsWith(".html")) yield path;
  }
}

const hits = [];
let scanned = 0;
for await (const file of walk(dist)) {
  scanned += 1;
  const html = await readFile(file, "utf8");
  for (const needle of CLOCK_STRINGS) {
    if (!html.includes(needle)) continue;
    if (ALLOW.some(([frag, text]) => file.includes(frag) && text === needle)) continue;
    hits.push({ file: file.replace(`${dist}/`, ""), needle });
  }
}

if (hits.length) {
  console.error("✗ SSR 里出现了依赖当前时间的文案（跨时段访问会 hydration mismatch）：");
  for (const hit of hits.slice(0, 20)) console.error(`    ${hit.file} ← 「${hit.needle}」`);
  if (hits.length > 20) console.error(`    …… 共 ${hits.length} 处`);
  console.error("    改法：这些文案用 mounted 状态包起来，挂载后再渲染（见 LiveHoldings / EtfLiveTurnover）。");
  process.exit(1);
}

console.log(`✓ SSR 时钟文案检查通过：${scanned} 个页面里没有「依赖当前时间」的文案`);

#!/usr/bin/env node
/**
 * 验证 metric-matched fallback 真的和网页字体等宽。
 *
 * 为什么值得单开一个门禁：`size-adjust` 是个魔法数字，它只在「换字体文件 / 换字号 /
 * 换兜底字体」时才失效，而失效的表现是「某些平台上加载时会抖一下」—— 谁都看不见。
 * 这里在真实浏览器里比较两种状态的渲染宽度：
 *   A. 拦住 woff2（= 用户字体还没到货，用兜底）→ 必须走 "Inter Fallback"
 *   B. 正常加载 → 用 "Inter"
 * 两者**宽度**和**行盒高度**（ascent+descent）都要对齐：
 *  - 宽度不对 → 换行行数变，整页位移；
 *  - 行盒高度不对 → 大标题换字体的瞬间整块高度变，同样整页位移（第 72 轮 /invest/digest 页 0.072）。
 * 任一超过 2% 就说明 size-adjust / ascent-override 该重新标定了。
 *
 * 标定工具：`node scripts/calibrate-fallback-metrics.mjs`
 *
 * ── 已知偏差：数字（第 90 轮补测）────────────────────────────────────────
 * 上面的 SAMPLE 是纯字母句子，标出来的 size-adjust 对**数字**并不准：
 * Inter 的半粗数字比 Arial Bold 宽约 9%，日期这种数字串在兜底期会被排窄 12%。
 * 标题里带日期时（"AI 每日精选 · 2026-08-27"）就会「兜底 1 行、真字体 2 行」，
 * 字体到货瞬间整页下移 37.5px —— 限速 1.6Mbps 下实测 CLS 0.028（仍属 good，但可复现）。
 * 单纯调一个 size-adjust 修不了：字母需要 ≈+1%，数字需要 ≈+9%，一个旋钮顾不过来。
 * 所以这里对数字/日期只立「地板值」，防止有人把兜底弄得更差（比如删掉真粗体退回合成粗体）。
 */
import { chromium } from "playwright";

import { serveDist, chromePath } from "./lib/serve-dist.mjs";

const TOLERANCE = 0.02;
const SAMPLE = "Entries are ordered newest first — the next route is written after the next trip.";
// 数字与中英混排单独测：站点大量表格/价格/日期，字母的标定值对它们不成立（见文件头）
const NUMERIC_SAMPLES = [
  // 名称、采样、地板值（低于它就说明兜底被改坏了）、参考说明
  { label: "数字（半粗）", text: "0123456789", weight: 600, floor: 0.88 },
  { label: "日期（半粗）", text: "2026-08-27", weight: 600, floor: 0.84 },
  { label: "中英混排标题", text: "AI 每日精选 · 2026-08-27", weight: 600, floor: 0.92 },
  { label: "数字（常规）", text: "0123456789", weight: 400, floor: 0.97 },
];
const PAIRS = [
  { label: "Inter 400", weight: 400, stack: '"Inter"', fallback: '"Inter Fallback"' },
  // 字重分开测：兜底是「同字面 + 不同 size-adjust」，粗体走真 Arial Bold，
  // 只测常规的话，合成粗体悄悄窄 3.8% 也发现不了（第 72 轮这个 bug 就藏在这）
  { label: "Inter 500", weight: 500, stack: '"Inter"', fallback: '"Inter Fallback"' },
  { label: "Inter 600", weight: 600, stack: '"Inter"', fallback: '"Inter Fallback"' },
  { label: "Inter 700", weight: 700, stack: '"Inter"', fallback: '"Inter Fallback"' },
  { label: "Serif 400", weight: 400, stack: '"Instrument Serif"', fallback: '"Instrument Serif Fallback"' },
  // 等宽（第 148 轮）：/invest/market/ 的数字表格在 Linux 上换字体时长高 13%，
  // 整个页面往下推（CLS 0.223）。这里同时验宽度和行盒。
  { label: "Mono 400", weight: 400, stack: '"JetBrains Mono"', fallback: '"JetBrains Mono Fallback"' },
  { label: "Mono 600", weight: 600, stack: '"JetBrains Mono"', fallback: '"JetBrains Mono Fallback"' },
];

const server = await serveDist("dist");
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: chromePath(), args: ["--no-sandbox"] });

const page = await browser.newPage();
await page.goto(`${base}/en/hike/`, { waitUntil: "load" });

const results = await page.evaluate(async ({ sample, pairs }) => {
  const ctx = document.createElement("canvas").getContext("2d");
  const metrics = (weight, stack) => {
    ctx.font = `${weight} 100px ${stack}`;
    const m = ctx.measureText(sample);
    return { width: m.width, lineBox: (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent) / 100 };
  };
  const out = [];
  for (const pair of pairs) {
    await document.fonts.load(`${pair.weight} 100px ${pair.stack}`, sample);
    await document.fonts.load(`${pair.weight} 100px ${pair.fallback}`, sample);
    const web = metrics(pair.weight, pair.stack);
    const fallback = metrics(pair.weight, pair.fallback);
    out.push({ label: pair.label, web, fallback, ratio: fallback.width / web.width, lineRatio: fallback.lineBox / web.lineBox });
  }
  return out;
}, { sample: SAMPLE, pairs: PAIRS });

const numeric = await page.evaluate(async (samples) => {
  const ctx = document.createElement("canvas").getContext("2d");
  const out = [];
  for (const row of samples) {
    const width = async (stack) => {
      await document.fonts.load(`${row.weight} 30px ${stack}`, row.text);
      ctx.font = `${row.weight} 30px ${stack}`;
      return ctx.measureText(row.text).width;
    };
    const web = await width('"Inter"');
    const fb = await width('"Inter Fallback"');
    out.push({ ...row, ratio: fb / web });
  }
  return out;
}, NUMERIC_SAMPLES);

let failures = 0;
for (const row of results) {
  const widthOk = Math.abs(row.ratio - 1) <= TOLERANCE;
  // 行盒高度（ascent+descent）必须也对齐：只对宽度不够，大标题换字体时整块会跳
  const boxOk = Math.abs(row.lineRatio - 1) <= TOLERANCE;
  if (!widthOk || !boxOk) failures += 1;
  const mark = widthOk && boxOk ? "✓" : "✗";
  console.log(
    `${mark} ${row.label.padEnd(18)} 宽度 ${(row.ratio * 100).toFixed(1)}% · 行盒高度 ${(row.lineRatio * 100).toFixed(1)}%` +
      `（允许 ±${(TOLERANCE * 100).toFixed(0)}%${widthOk && boxOk ? "" : "，需要重新标定 size-adjust / ascent-override"}）`,
  );
}

// 数字类只设地板值：这类偏差是字体设计差异，调不平时只要不继续恶化就行
for (const row of numeric) {
  const ok = row.ratio >= row.floor;
  if (!ok) failures += 1;
  console.log(
    `${ok ? "✓" : "✗"} ${row.label.padEnd(18)} 宽度 ${(row.ratio * 100).toFixed(1)}%` +
      `（地板 ${(row.floor * 100).toFixed(0)}%${ok ? "" : "，兜底被改坏了：数字/日期会比真字体窄太多，标题会换行跳动"}）`,
  );
}

await browser.close();
server.close();

if (failures > 0) {
  console.error(
    `\n✗ 字体兜底对不上：${failures}/${results.length} 组（宽度或行盒高度）。` +
      `重新跑 node scripts/calibrate-fallback-metrics.mjs，把 size-adjust / ascent-override / descent-override 一起更新。`,
  );
  process.exit(1);
}
console.log(
  `\n✓ 兜底字体：字母 ${results.length} 组宽度/行盒一致；数字与混排 ${numeric.length} 组在地板之上（数字天生比 Arial 宽约 9%，见文件头）`,
);

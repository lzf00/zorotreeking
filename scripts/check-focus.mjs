#!/usr/bin/env node
/**
 * 键盘焦点可见性自检（WCAG 2.4.7 Focus Visible）——第 172 轮。
 *
 * 为什么 axe 测不到：axe 只看静态 DOM 与属性，**没法知道"按下 Tab 之后有没有视觉反馈"**。
 * 这轮实测发现全站 8 个模板 × 54 个可聚焦元素都有环，说明第 14x 轮加的全局
 * `:focus-visible { outline: 2px solid var(--focus-ring) }` 一直有效 —— 但没有任何守卫。
 * 一旦有人在按钮上加 `outline-none`、或用了不在全局规则列表里的元素（如
 * `div[role=button]` 没有 tabindex），焦点环就会静默消失。
 *
 * 测量方法（关键）：必须用**真的 Tab 按键**。`el.focus()` 不会让 `:focus-visible` 命中
 * ——本轮第一版探测就是这么误报了两个"没有焦点环"的元素。另外深色主题要单独测：
 * 浅色环在近黑底上可能看不见。
 *
 * 用法：
 *   node scripts/check-focus.mjs                 # 默认模板 × 明暗两主题
 *   node scripts/check-focus.mjs --paths=/ai/,/invest/
 *   node scripts/check-focus.mjs --max=30        # 每页最多 Tab 多少个（默认 55）
 */
import { chromium } from "playwright";

import { chromePath, serveDist } from "./lib/serve-dist.mjs";

const args = process.argv.slice(2);
const valueOf = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;
const MAX_TABS = Number(valueOf("max", "55"));
const PATHS = valueOf("paths", "/,/ai/,/ai/digest-2026-11-22/,/invest/,/photo/baokemeng/,/guestbook/,/hike/,/en/")
  .split(",")
  .filter(Boolean);

/** 一个元素"看得出来有焦点"的判据：有环（宽度>0 且不是 none）或阴影。 */
const indicatorScript = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const cs = getComputedStyle(el);
  const hasOutline = cs.outlineStyle !== "none" && Number.parseFloat(cs.outlineWidth) > 0;
  const hasShadow = cs.boxShadow !== "none";
  return {
    ok: hasOutline || hasShadow,
    tag: el.tagName.toLowerCase(),
    cls: String(el.className ?? "").slice(0, 48),
    text: (el.textContent ?? "").trim().slice(0, 24),
    outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
    shadow: cs.boxShadow.slice(0, 32),
    key: el.outerHTML.slice(0, 90),
  };
};

const server = await serveDist(new URL("../dist", import.meta.url).pathname);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: chromePath() });
const failures = [];

try {
  for (const path of PATHS) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      try {
        await page.goto(base + path, { waitUntil: "load", timeout: 60_000 });
        if (theme === "dark") {
          await page.evaluate(() => {
            document.documentElement.classList.add("dark");
            document.documentElement.style.colorScheme = "dark";
          });
        }
        // 过渡会盖住焦点环的最终值（环是 outline，不受 transition 影响，但阴影可能带过渡）
        await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
        await page.evaluate(() => document.body.focus());

        const seen = new Set();
        const offenders = [];
        for (let i = 0; i < MAX_TABS; i++) {
          await page.keyboard.press("Tab");
          const info = await page.evaluate(indicatorScript);
          if (!info || seen.has(info.key)) continue;
          seen.add(info.key);
          if (!info.ok) offenders.push(info);
        }

        // 反空转：Tab 必须真的在移动焦点，否则"0 个问题"毫无意义
        if (seen.size < 5) {
          console.log(`✗ [${theme}] ${path}  只轮到 ${seen.size} 个元素，检查不可信`);
          failures.push({ path, theme, reason: "Tab 没有推进焦点" });
          continue;
        }
        if (offenders.length === 0) {
          console.log(`✓ [${theme}] ${path}  ${seen.size} 个可聚焦元素都有可见焦点环`);
        } else {
          console.log(`✗ [${theme}] ${path}  ${offenders.length}/${seen.size} 个元素按下 Tab 后没有任何视觉变化`);
          for (const o of offenders.slice(0, 5)) {
            console.log(`     ${o.tag}.${o.cls} 「${o.text}」 outline=${o.outline} shadow=${o.shadow}`);
          }
          failures.push({ path, theme, reason: `${offenders.length} 个元素无焦点环` });
        }
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`::error title=键盘焦点不可见::${failures.length} 个（页面×主题）组合`);
  process.exit(1);
}
console.log(`\n✓ 焦点可见性自检通过：${PATHS.length} 个模板 × 2 个主题`);

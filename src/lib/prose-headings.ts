/**
 * 文章正文的标题排版类。
 *
 * 日报（digest）和普通文章（含每日市场复盘）的正文标题层级不同：
 *   - 日报正文：`# 来源分组` + `## 单条快讯`，渲染时整棵树降一级
 *     （h1→h2、h2→h3，见 src/lib/rehype-normalize-headings.mjs），
 *     所以「分组标签」的样式落在 h2、「条目标题」的样式落在 h3；
 *   - 普通文章：`#`/`##` 原样，标签样式在 h1、标题样式在 h2。
 *
 * 两套类必须分开，否则复盘页的小节标题会被压成 11px 的标签样式
 * （2026-11 第一次改的时候就是这么坏掉的，靠 prod/local 计算样式对比才发现）。
 *
 * 注意：这里的类名必须写成**完整字面量**，不能用模板字符串拼 `prose-h${level}:…`。
 * Tailwind 是按源码里的字符串做静态扫描的，拼接出来的类名不会进 CSS。
 */

/** 日报（ai）：h2 分组标签 + h3 条目标题。 */
export const DIGEST_AI_HEADINGS = `prose-h2:text-[11px] prose-h2:uppercase prose-h2:tracking-[0.2em]
  prose-h2:font-medium prose-h2:font-sans
  prose-h2:text-zinc-500 dark:prose-h2:text-zinc-400
  prose-h2:mt-24 prose-h2:mb-12 prose-h2:pb-3
  prose-h2:border-b prose-h2:border-zinc-100 dark:prose-h2:border-zinc-800
  prose-h3:text-xl sm:prose-h3:text-[22px]
  prose-h3:leading-snug prose-h3:tracking-tight
  prose-h3:font-bold prose-h3:mt-14 prose-h3:mb-3
  prose-h3:text-section-ai`;

/** 日报（invest）：同结构，栏目色不同。 */
export const DIGEST_INVEST_HEADINGS = `prose-h2:text-[11px] prose-h2:uppercase prose-h2:tracking-[0.2em]
  prose-h2:font-medium prose-h2:font-sans
  prose-h2:text-zinc-500 dark:prose-h2:text-zinc-400
  prose-h2:mt-24 prose-h2:mb-12 prose-h2:pb-3
  prose-h2:border-b prose-h2:border-zinc-100 dark:prose-h2:border-zinc-800
  prose-h3:text-xl sm:prose-h3:text-[22px]
  prose-h3:leading-snug prose-h3:tracking-tight
  prose-h3:font-bold prose-h3:mt-14 prose-h3:mb-3
  prose-h3:text-section-invest`;

/** 普通文章（ai）：h1 分组标签 + h2 条目标题。复盘页用这一套。 */
export const CONTENT_AI_HEADINGS = `prose-h1:text-[11px] prose-h1:uppercase prose-h1:tracking-[0.2em]
  prose-h1:font-medium prose-h1:font-sans
  prose-h1:text-zinc-500 dark:prose-h1:text-zinc-400
  prose-h1:mt-24 prose-h1:mb-12 prose-h1:pb-3
  prose-h1:border-b prose-h1:border-zinc-100 dark:prose-h1:border-zinc-800
  prose-h2:text-xl sm:prose-h2:text-[22px]
  prose-h2:leading-snug prose-h2:tracking-tight
  prose-h2:font-bold prose-h2:mt-14 prose-h2:mb-3
  prose-h2:text-section-ai`;

/** 普通文章（invest）：同结构，栏目色不同。 */
export const CONTENT_INVEST_HEADINGS = `prose-h1:text-[11px] prose-h1:uppercase prose-h1:tracking-[0.2em]
  prose-h1:font-medium prose-h1:font-sans
  prose-h1:text-zinc-500 dark:prose-h1:text-zinc-400
  prose-h1:mt-24 prose-h1:mb-12 prose-h1:pb-3
  prose-h1:border-b prose-h1:border-zinc-100 dark:prose-h1:border-zinc-800
  prose-h2:text-xl sm:prose-h2:text-[22px]
  prose-h2:leading-snug prose-h2:tracking-tight
  prose-h2:font-bold prose-h2:mt-14 prose-h2:mb-3
  prose-h2:text-section-invest`;

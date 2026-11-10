# Tailwind 4 迁移评估（2026-11）

结论先说：**现在不迁**。这不是"要不要新版本"的问题，而是这个站的三条硬约束
（全站内联 CSS、1139 个静态页、编辑风格手写 CSS 占大头）让 v4 的收益接近于零、
风险却落在每一页的像素上。要迁的话按下面第 5 节的顺序做，任何时候都能回滚。

评估时间：2026-11-11，基于 tailwindcss 3.4.19 → 4.3.5。

---

## 1. 当前用法盘点

| 项 | 现状 |
|---|---|
| 配置方式 | `tailwind.config.mjs`（JS 配置）：3 组字体栈、`section` 染料色（已改为 `rgb(var(--section-*-rgb) / <alpha-value>)`）、`maxWidth.prose`、2 组 keyframes/animation |
| 插件 | `@tailwindcss/typography`（文章正文排版） |
| 入口 | `src/styles/global.css`：`@tailwind base/components/utilities` + 自定义 `@layer base` 主题变量 + 约 1400 行手写 CSS |
| `@apply` | **0 处**（`src/styles/*.css` 与 `.astro` 里都没有）——这是好消息 |
| PostCSS | `tailwindcss` + `autoprefixer` 两个 plugin |
| 构建 | `build.inlineStylesheets: "always"`，每页 84–131KB 内联 CSS |

## 2. v4 会碰到的破坏点（按本仓库用量排序）

| v3 写法 | 本仓库用量 | v4 行为 |
|---|---|---|
| 不带颜色的 `border` / `divide` / `ring` | 669 处 `border` | 默认色从 `gray-200` 变成 `currentColor`。本站大量 `border` 靠默认色描边，一旦变色 = 全站线条变深，必须显式写 `border-[var(--border)]` |
| `outline-none` | 14 | 改名 `outline-hidden`（语义也变了），否则键盘焦点环行为不同 |
| `rounded-sm` | 6 | 尺寸定义变了（v4 的 `rounded-sm` = v3 的 `rounded`），需要逐处确认 |
| `bg-gradient-to-*` | 10 | 改名 `bg-linear-to-*` |
| `ring-*` | 24 | v4 默认 `ring` 宽度从 3px 变 1px |
| `space-x/y-*` | 38 | 选择器实现变了（v4 用 `:not(:last-child)` 变体），对 RTL/嵌套的影响不同 |
| `shadow-sm`/`shadow` | 0 | 无影响 |

配置侧：

- v4 首选 CSS-first 的 `@theme`，`tailwind.config.mjs` 要走 `@config "./tailwind.config.mjs"` 兼容层；字体栈、`section` 颜色、keyframes 都需要迁到 `@theme` 才吃到 v4 的新能力，否则只是"能在 v4 跑起来"。
- PostCSS 插件换成 `@tailwindcss/postcss`（`autoprefixer` 可以去掉，v4 自带 Lightning CSS 处理前缀）。
- `@tailwindcss/typography` 的 v4 兼容版需要同步升级。
- **内联 CSS 会让风险放大**：任何默认色/尺寸变化都会写进 1139 个 HTML 文件，且因为 `inlineStylesheets: "always"`，一次 CSS 改动会重写全部页面（dist 233MB）。出问题的表现是"某几类页面线条颜色不对"，而 Lighthouse 分数不会掉——这类回归只能靠像素对比发现。

## 3. 收益评估

| 收益 | 对本站是否成立 |
|---|---|
| 构建更快 | 本地全量 build 现在 ~40s（含 photo manifests + pagefind），Tailwind 部分几秒；收益可忽略 |
| CSS 更小 | 本仓库 `@apply` 为 0、自定义 CSS 占大头，v4 的 oxide 引擎主要省的是扫描时间不是产物体积；预计首屏 CSS gzip 变化在个位数 % |
| 新特性（容器查询、`@starting-style`、颜色函数） | 现在用不到；跨浏览器兼容性对国内老 WebView 反而更敏感 |
| 减少一份 JS 配置 | 仅风格收益 |

也就是说：**收益小、面广、且回归只能靠像素对比兜底**。

## 4. 风险

- 669 处隐式 `border` 颜色是最大的地雷，分布在所有页面的卡片/分隔线。
- 内联 CSS 让"改一次、全站重写"成为常态，回滚成本 = 一次全量部署。
- 目前没有页面级像素基线（只有 10 URL 的 Lighthouse 与 27 页的 axe），像素回归没有 CI 兜底。

## 5. 如果将来要迁，按这个顺序做

1. **先建像素基线**：给 12–16 个代表页（`/`、`/ai/`、`/invest/`、`/hike/`、长路书、`/photo/baokemeng/`、`/en/`、`/explore/`、`/about/` 等）在浅色/深色两种主题下截 1280px 宽的图，存成 artifact。没有基线就别动 v4。
2. **补显式边框色**：先把 669 处 `border` 改成 `border-[var(--border)]`（这一步在 v3 下就能做，且零风险），把 v4 最大的地雷提前拆掉。
3. **换构建链**：`@tailwindcss/postcss` + 移除 `autoprefixer`，配置走 `@config` 兼容层，维持 v3 语义先让站点跑起来。
4. **逐个替换重命名**：`outline-none → outline-hidden`、`bg-gradient-to-* → bg-linear-to-*`、`rounded-sm`、`ring`。
5. **迁配置到 `@theme`**：字体、染料色、keyframes。染料色继续用 `--section-*-rgb` 变量（与主题切换已经对齐）。
6. **逐页像素对比**：每步跑一次基线对比，出现 diff 就停下来定位；全部对齐后再合并。
7. 保留 v3 分支，部署层面用 `previous` 软链回滚跑分对比一周。

## 6. TypeScript 7

`typescript@7`（原生 Go 端口）与 `astro check`（依赖 TS 的 JS API）兼容性尚未验证，
且 TS 版本升级对本项目只影响类型检查，不影响产物。**继续留在 5.9.x**，
等 `@astrojs/check` 明确声明支持后再评估。

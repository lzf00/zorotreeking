# 架构（2026 年中升级版）

补充 `README.md` 没覆盖的几条新自动化流水线和组件，方便日后接手 / 排查。

## 路由全景

### 公开页面

| Path | 说明 | 数据源 |
|---|---|---|
| `/` | Hero + 精选 3 张大卡 + 4 栏目卡 + 最近更新 | content collections |
| `/ai`, `/invest`, `/hike`, `/photo` | 4 个栏目列表 | content collections |
| `/ai/digest`, `/invest/digest` | digest 归档 | tag = digest |
| `/{section}/{slug}` | 文章详情 | mdx |
| `/about` | "我是谁" 模块 | `src/data/about.ts` |
| `/uses` | 工具栈清单 | `src/data/uses.ts` |
| `/explore` | 主题地图 (PCA 2D 散点) | `src/data/embeddings.json`（int16 量化 + base64，见 `src/lib/embedding-codec.ts`） |
| `/changelog` | git log 自动渲染 | build 时 execSync |
| `/subscribe` | RSS + Buttondown 邮件订阅 | `PUBLIC_BUTTONDOWN_USERNAME`（默认公开 handle） |
| `/tag/[tag]` | tag 索引 | content collections |
| `/data` | 访客 GDPR-style 数据自查 | FastAPI /api/data/me |
| `/contact`, `/privacy`, `/terms` | 合规页 | 静态 |

### 资源端点

| Path | 类型 |
|---|---|
| `/rss.xml` | RSS 2.0 |
| `/atom.xml` | Atom 1.0 |
| `/sitemap.xml` | Sitemap |
| `/robots.txt` | crawler 指引 |
| `/manifest.webmanifest` | PWA |
| `/og/{collection}/{slug}.png` | satori 动态生成 og:image |
| `/{INDEXNOW_KEY}.txt` | IndexNow 验证 |

### 后端 API（FastAPI，经 nginx `/api/*` 反向代理）

| Path | 用途 |
|---|---|
| `/api/track` | 匿名访问统计写入（POST） |
| `/api/data/me` | 访客查自己的访问记录（GET） |
| `/api/data/delete` | 访客删除自己的记录（POST） |
| `/api/feedback` | 👍👎 点赞 |
| `/api/chat`, `/api/chat/clear`, `/api/models` | AI Chat Widget 后台 |
| `/api/market/*` | 实时股票数据代理（东方财富 push2） |
| `/api/market/funds` | 天天基金净值代理 |

## 自动化工作流

### `.github/workflows/daily-digest.yml`
**Cron**: 每天 UTC 00:00 = BJT 08:00。
**Steps**:
1. fetch digests (HF papers + arxiv + qbitai → ai; 10jqka + eastmoney + yahoo → invest) 调豆包 LLM 翻译/摘要
2. 提前 commit digest mdx（保证 digest 不丢）
3. **翻译 zh → en**（增量；单次数量由 `translate_limit` 控制）
4. **更新 embeddings.json**（豆包 doubao-embedding-vision via ep-... endpoint）
5. 合并 commit embeddings + 翻译

**死链策略**（2026-11 复盘后定）：
- 日报标题默认就是原文外链 —— 当天读日报的人要能点回原文，这个不能省。
- 东方财富 7×24 / 同花顺这类来源会删稿，但删的比例不高：2026-11-11 全量扫
  5200 条外链，只有 1 条 404（前一天 66 条已经清理过）。所以不做"预先把这类
  外链全部摘掉"的过度处理，而是保留链接、靠周扫发现零星的 404。
- 周扫 `.github/workflows/deadlink-check.yml` 报出死链后，跑
  `npx tsx scripts/deadlink-delink.ts`（默认读最新报告，`--dry-run` 先看）
  把 `<a href>` 摘成纯标题、markdown 链接摘成纯文字；幂等，跨文件引用也会一起处理。

`workflow_dispatch` inputs:
- `mode`: ai / invest / both
- `translate_limit`: 单次最多翻译数量；历史回填走 `bulk-backfill.yml`
- `skip_fetch`: 跳过 digest fetch（省豆包额度，只跑翻译/embedding）

### `.github/workflows/weekly-roundup.yml`
**Cron**: 每周日 UTC 01:00 = BJT 09:00。
扫近 7 天新 mdx → 豆包写 "本周观察" → 生成 `src/content/ai/weekly-YYYY-Www.zh.mdx`。

### `.github/workflows/deploy.yml`
**触发**: push to main + `workflow_call` from cron workflows.
**Steps**:
1. Checkout (fetch-depth: 0 拿全部 git history 给 changelog 用)
2. npm ci
3. **`npm test`** 守卫测试（93 个断言，约 1s；2026-11-11 才补进部署流程，
   之前红着也能部署），不通过直接挡住
4. Build photo manifests (sharp 生成 WebP 增量 + 1200×630 `.og.jpg` 分享图)
5. **`astro check`** 类型检查守门
6. `astro build`
7. pagefind 索引
8. **`npm run check:og`** 分享卡校验（`scripts/check-og.mjs`：把 dist 里 1140 个
   页面的 og:image 逐个解析，缺文件 / 非绝对 URL / 声明尺寸与实际不符直接失败；
   >512KB、比例不像卡片的只告警）
9. **`npm run check:seo`** SEO / 结构化数据校验（`scripts/check-seo.mjs`，见
   「SEO 与结构化数据」一节；canonical、描述、单一 h1、JSON-LD 必填字段与
   日期、面包屑位次，逐页 1140 个）
10. **Prepare versioned release**：`cp -al current/. releases/<sha>/` 用硬链接做种子
11. rsync（`--checksum` 只传真正变化的字节；`--timeout=180` 防挂死；失败重试 3 次）
12. **Activate release atomically**：`ln -sfn` + `mv -Tf` 原子切换 `current`
13. Prune：保留最近 20 个 release，`current` / `previous` 永不删除
14. Production acceptance smoke test，失败自动回滚到 `previous`
    （ETF 实时 ratio 在开盘前必然为空，这种盘前状态只发 `::warning::` 不挡发布；
    有成交却算不出 ratio 才算契约失败）
15. **IndexNow ping**（POST 新 URL 给 Bing/Yandex/Naver 加速索引）

#### 部署传输量（重要）
- **平常**（只改内容）：~2.3MB。硬链接种子 + checksum 让 rsync 只传变化文件。
- **改 CSS 时**：因为 CSS 内联进每个页面，1140 个 HTML 全部变化。实测
  `Total transferred file size` 215MB，但 rsync 的块级 delta 后 **Literal data 只有 22MB**
  （2026-11-10 实测）。
- **runner → 国内服务器链路会劣化**：同一时刻本机直传 2.4MB/s，GitHub runner 掉到
  15KB/s。所以 job 超时设为 30 分钟、rsync 带 `--timeout=180` + 3 次重试，
  失败/取消时自动删除半成品 release 目录。
- 紧急恢复手法：把 `dist/` 在本机按同样步骤（cp -al 种子 → rsync → 原子切换 → prune）
  手工推上去，本机 8 秒可完成；随后推一个只改文档的 commit，让 CI 以增量方式
  验证整条流水线仍是绿的。

### `.github/workflows/lighthouse.yml`
**触发**: deploy 完成后自动 + workflow_dispatch（手动跑会强制审计，不受 scope 跳过影响）。
跑 LHCI 对比 `.lighthouserc.json` 性能预算（Perf ≥ 0.80, A11y ≥ 0.90, SEO ≥ 0.95，均取 5 次中位数），未达标 fail。
审计 12 个 URL，覆盖每个模板：首页、板块首页（ai / invest / tag）、正文、相册、语义地图、
最重的列表页（`/invest/digest/`，181 张卡片）、最长的旅行路书。

性能阈值为什么是 0.80 而不是 0.85：站点在国内、Lighthouse 跑在 GitHub 的美国 runner 上，
实测同一版本同一页面三次跑分可以是 `0.79 / 0.95 / 0.95`，TTFB 在 **241ms~986ms** 之间跳
（同一台静态服务器，纯链路抖动）。按「每个 URL 中位数 ≥0.85」判会随机红，与代码质量无关。
真正的解法是在源站前面加 CDN（需评估成本与备案/国内路由），在那之前用 0.80 守住真实回退：
真出现回退时，中位数会整体塌到 0.8 以下，而不是单次毛刺。

注意 `Decide whether audited pages changed` 步骤：只改了生成内容的提交会让 Lighthouse **skip**
（job 显示 success 但没跑分），要真数据就手动 dispatch。

### `.github/workflows/a11y-audit.yml`
**触发**: 每周一 UTC 03:00（BJT 11:00，错开 10:00 的移动端跑分）+ 手动。
对**线上**站点跑 `scripts/check-a11y.mjs --mobile`：21 个页面模板 × 浅色/深色 ×
桌面 1280×900 / iPhone 13 两个视口 = 84 次检查，轴心是 axe-core 的**全部默认规则**
（不只是对比度和标题层级），外加一次"键盘 Tab 30 次，每个落点都必须有可见焦点环"
的检查（用 Playwright 真按 Tab，页面内 `el.focus()` 触发不了 `:focus-visible`，
那样测永远是假绿）。紧跟一步 `scripts/check-hydration.mjs` 验证 React 岛真的水合。
产物 `a11y-report` 保留 30 天。

窄屏才会出现的横向滚动区（表格、可打印路书、路线图条）由 `BaseLayout.astro` 里的
一段内联脚本兜底：首绘后的空闲回调里，把"真的横向溢出且内部没有可聚焦元素"的容器
补上 `tabindex="0" role="group"` 和名字；React 岛水合后才长出来的表格由
`MutationObserver`（防抖 150ms，只扫新增子树和祖先链）补扫。第一版把这段扫描放在
`DOMContentLoaded` 同步执行，等于逼浏览器在首绘前做完整页布局，首页 Lighthouse
perf 从 0.9x 掉到 0.74——所以它必须在 `requestIdleCallback` 里跑。

为什么必须单独一条：Lighthouse 只测浅色主题（本站深色走 `html.dark` 类，不是
`prefers-color-scheme`）。2026-11 第一次全量跑抓到四类此前完全没测过的问题：
① 板块染料色在 `#0a0a0a` 上只有 2.3:1（每页导航链接都中招）；② 608 个每日自动生成的
MDX 里手写 `text-zinc-500` 只有 4.09:1；③ 旅行攻略页在 `<main id="main-content">` 里
又套了一个 `<main>`（两个 main 地标）；④ 首页热力图的横向滚动区不可键盘聚焦、
主导航与侧边目录两个 `<nav>` 没有各自的可读名字。修完后 40/40 全清。

## 数据流：豆包 LLM

### 一个豆包账号，两个调用形态

| 用途 | endpoint | model |
|---|---|---|
| Chat（digest 摘要 / 翻译 / weekly 观察） | `/api/v3/chat/completions` | `doubao-seed-2-0-pro-260215` |
| Embedding（相关推荐 / explore 地图） | `/api/v3/embeddings/multimodal` | `ep-20260609111432-frddk`（vision embedding endpoint）|

key 都用 `DOUBAO_API_KEY` GitHub Secret。

### Embedding 流水线

```
新 zh mdx commit
  ↓
daily-digest cron step "Refresh post embeddings"
  ↓
scripts/generate-embeddings.ts
  · 扫所有 *.zh.mdx
  · 内容 sha16 hash 当 cache key
  · hash 没变 → 复用旧 vec；变了 → 调 ARK embeddings.multimodal
  ↓
src/data/embeddings.json (2048 维 × N 篇)
  ↓ ↓
  ↓ src/lib/related-posts.ts 用 cosine 算"相关阅读"
  ↓ src/lib/pca.ts 算 2D 投影 → /explore
```

## 组件分层（新增）

| 文件 | 职责 |
|---|---|
| `src/components/PostFooter.astro` | 上下篇 + 相关推荐（embedding 排序）+ digest 归档 |
| `src/components/PostCard.astro` | 列表 thumbnail + section 色块兜底 |
| `src/components/ReadingProgress.astro` | 文章顶部进度条 + sticky mini navbar |
| `src/components/ShareSidebar.tsx` | 浮动右侧分享栏（复制/Twitter/微信 QR/置顶） |
| `src/components/SubscribeCTA.astro` | 文章底嵌入式订阅 CTA |
| `src/components/ArticleImageLightbox.astro` | 文章正文图点击放大（零依赖） |
| `src/components/Sparkline.astro` | 表格内嵌 SVG 走势线 |
| `src/components/ContentPulse.astro` | 365 天产出热力图 |

### SEO 与结构化数据：`scripts/check-seo.mjs`

`npm run check:seo`（需先 `npm run build`），逐页校验 dist 里 1140 个页面：

| 项目 | 规则 | 级别 |
|---|---|---|
| canonical | 恰好 1 个、本站绝对地址 | 错误 |
| title / description | 非空；长度按"视觉宽度"折算（中文×1.7） | 告警 |
| h1 | **恰好 1 个** | 错误 |
| `<html lang>` | zh-CN / en | 告警 |
| JSON-LD | 可解析、`@context=schema.org`、`@type` 已知 | 错误 |
| 必填字段 | Article / BreadcrumbList / WebSite / AboutPage / WebPage / TouristTrip 等按类型 | 错误 |
| 日期 | `datePublished`/`dateModified` 可解析且 modified ≥ published | 错误 |
| URL 字段 | `image` / `url` / `@id` 必须是绝对地址 | 错误 |
| 面包屑 | 位次 1..n 连续、末项与 canonical 一致 | 错误 |
| hreflang | 每条 alternate 指向真实页面，中英双向互指、自指正确 | 错误 |
| 内链 | 每个 `href`/`src` 指向的站内文件存在，且大小写一致（macOS 不区分、Linux 区分） | 错误 |
| 描述去重 | 统计「多页共用一句 description」，打印最多的几组 | 告警 |
| sitemap | 每条 `<loc>` 与目标页 canonical 逐字一致（尾斜杠！），覆盖全部可索引页，`<lastmod>` 可解析且不晚于今天 | 错误 |

跳过带 `http-equiv="refresh"` 的跳转页和 `robots noindex` 的页面（admin / 404）。

**2026-11 建门禁时查出来的问题**（都已修）：
- **718 个日报页有 2~10 个 h1**：正文自己写 `# 来源分组`、`## 单条快讯`，
  模板又渲染了页面标题的 `<h1>`。修法是渲染层归一化
  （`src/lib/rehype-normalize-headings.mjs`）：日报正文整棵树降一级、复盘正文
  去掉与页面标题重复的开头 h1，正文文件保持原样（每天自动生成，不该被手改）。
  标题样式的两份类名放在 `src/lib/prose-headings.ts`——**必须写成完整字面量**，
  Tailwind 是按源码字符串静态扫类名的，拼接出来的类名不会进 CSS。
- **230 个市场复盘页**：正文第一行 `# 📊 11月10日股票日报` 和 frontmatter title 完全重复。
- **134 个列表 / 标签 / 相册页一条结构化数据都没有**：`BaseLayout` 加了 `WebPage` 兜底。
- **2 个页面**（about 的中英版）嵌套的 `WebSite` 缺 `inLanguage`。
- **整份 sitemap 都是 301 中转**：1138 条 `<loc>` 不带尾斜杠，而 nginx 与 canonical
  都是带斜杠的，Search Console 会把每条都算「网页会重定向」。同一轮还发现
  `/invest/us-market/` 这个可索引页面从来没进过 sitemap。两处都已修，并把
  「sitemap ↔ canonical 逐字一致 + 覆盖率」做成门禁（以前的检查只验站内标签，
  没人把两个文件对起来看）。

### sitemap 的 lastmod：1139 条全部有日期，且都是真的

`<lastmod>` 只在「可信」时对搜索有用：写一个假的（比如构建时间）会被整体忽略。
所以按来源分三类取值，全部是真实日期：

| 页面类型 | lastmod 来源 |
|---|---|
| 文章 / 日报 / 相册 / 旅行指南 | frontmatter 的 `updated`，没有就用 `date` |
| 板块首页（`/ai`、`/invest`、`/photo`、`/tag`…） | 该板块最新一篇的日期（比源码提交时间准） |
| 标签页 | 该标签下最新一篇的日期 |
| 个股页 | `wind-stock-details.json` 的 `date`（行情快照日） |
| 其它静态页（`/about`、`/uses`、`/privacy`…） | 该页源码文件的最后一次 git 提交日期 |

拿不到 git（浅克隆/没装 git）就**不写** lastmod，宁缺勿假。`check:seo` 会校验每条
`<lastmod>` 可解析且不晚于今天。

### 描述长度：中位 84 字符，最短 43

描述不是凑字数，但太短一定被搜索引擎改写。改前有 39 个页面短于 45 字符——首页
（19 字符，直接复用 `site.tagline`）、`/about`、`/data`、`/now`、`/privacy` 这些静态页，
还有三本相册。现在全部写成一句完整的话：

| 类型 | 长度策略 |
|---|---|
| 首页 / 无 description 的页 | 用新增的 `site.description` 兜底（一句完整的定位说明） |
| 静态页（about / data / now / privacy / terms / subscribe / contact / guestbook / uses） | 各自写 60–100 字符，说清这页能读到什么 |
| 板块首页（ai / invest / photo / hike） | 内容统计 + 最新一篇，摄影板块额外说明可以逐张翻 + RSS |
| 标签页 | 单篇文章的标签页会补一句「同主题内容归集页」 |
| 相册 | 数量 + 地点 + 时间 + 拍什么 |

结果：`[描述长度] 1145 页 · 中位 84 · 最短 43 · 最长 193`，`check:seo` 会把这条统计
打成一行，超过 45 字符以下会点名（当前只剩 1 篇由标题自动生成的日报摘要，43 字符）。

### 结构化数据：面包屑覆盖 1143/1145 个可索引页

改前只有文章页（1008）有 `BreadcrumbList`，其余 133 个列表页 / 相册页 / 个股页只有一个裸
`WebPage`——Google 看不出它们在站点层级里的位置，SERP 也拿不到面包屑富结果。

| 页面 | schema | 面包屑 |
|---|---|---|
| 文章（ai / invest / hike / photo 正文） | `Article` | 首页 → 栏目 →〔日报归档〕→ 当前 |
| 首页 | `WebSite`（含 SearchAction） | —— |
| 关于 | `AboutPage` | 首页 → 关于 |
| 标签页 / 板块首页 / 相册首页 | `CollectionPage` + `mainEntity: ItemList` | 首页 →〔全部标签〕→ 当前 |
| 相册详情 / 个股页 / 静态页 / 归档页 | `WebPage` | 首页 → 栏目 → 当前 |

设计取舍：

- **面包屑只在一处生成**。`Breadcrumb.astro` 现在只画视觉导航，`BreadcrumbList` JSON-LD 统一由
  `BaseLayout` 用 `src/lib/breadcrumbs.ts` 从 URL 推导。原先两套并存，导致相册、徒步、个股页有
  视觉面包屑以外的页面一条结构化面包屑都没有；统一后每页恰好 1 条（`check:seo` 会验）。
- **末级不带 `item`**：当前页不必重复给 URL，和 Google 的示例一致；`check:seo` 里对「末项 URL 与
  canonical 不一致」的判断会自动跳过这种情况。
- **`CollectionPage` 代替裸 `WebPage`**：标签页、板块首页、相册首页确实是「一组条目的集合」，
  `mainEntity.ItemList` 把条目（标题 + 绝对 URL）交给搜索引擎，`numberOfItems` 与实际渲染一致。
  代价是体积：全站 HTML 208→210 MB（gzip 42.0→42.4 MB），可接受。
- 规则写进 `check-seo.mjs` 的 `SCHEMA_RULES`（新增 `CollectionPage`），并加两条回归守护：
  首项必须是首页；非首页缺 `BreadcrumbList` 直接告警。

### 正文厚度：45 个薄页面降到 22 个

描述修好之后还有另一个问题：有些页面**正文**本身就薄。量法是取 `<main>` 内部、去掉
`<script>/<style>` 与标签后的可见文字，中文字按字计、英文按单词计。改前有 45 个可索引页面
不足 120 词，最薄的 `/en/hike/` 只有 15 词（一个标题加一行栏目描述）。

| 页面类型 | 改法 | 效果 |
|---|---|---|
| 标签页（18 个） | 新增 `TagIntro` 组件：说明这个标签收了什么、横跨哪几个板块，并把**共现标签**做成链接 | 标签页正文 27→80+ 词，且标签页之间第一次有了横向入口（此前只能退回 `/tag` 总览） |
| 板块首页（`/photo/`、`/en/photo/`、`/en/hike/`） | 补两段：这一栏怎么组织、数据从哪来、还能从哪个入口翻 | `/en/hike/` 15→100+ 词 |
| 个股页（中英共 24 个） | 表格前加「这一页收什么数据、Wind 什么时候更新、同市场的其它标的在哪」 | 每页 +70 词，同时解释了口径 |
| 相册页（6 个） | 正文写这组照片按什么顺序看、挑的是什么 | 27→90+ 词 |
| `/tag/`、`/en/tag/` | 说明标签为什么按频次排、次数 1 的标签有什么用 | 39→90+ 词 |
| `sample-route`（中英） | 从「写你的游记在这里」的占位文案改成说明路线页四个组成部分，并注明轨迹是合成的 | 58→130 词 |

薄页面为什么值得管：新站没有外链权重，靠的是「每页都能独立回答一个问题」。标签页
原本只有一行计数，等于告诉搜索引擎「这里是空的」。

纯逻辑（`tagToSlug` / `relatedTags` / `tagSections`）放在 `src/lib/tag-relations.ts`，
不 import `astro:content`，所以能被 `node --test` 直接覆盖（`tags.ts` 只做再导出，
保持 `@/lib/tags` 的导入路径不变）。

### hover 预取：把一次跨境 RTT 藏起来

站点在腾讯云上、没有 CDN，跨境 TTFB 45–986ms 是最贵的一项开销。加尾斜杠消掉了
301 中转之后，剩下能做的是**别等用户点了才开始下载 HTML**：`astro.config.mjs` 打开

```js
prefetch: { prefetchAll: true, defaultStrategy: "hover" }
```

鼠标落到站内链接上就开始预取目标页（同源 GET），点击时通常已经在缓存里。只在
hover 时发生，触摸设备不触发，不会给不点的用户产生额外流量。

实测（本地 dist）：hover 导航里的「AI」后 1.5 秒内出现 `GET /ai/` 一次。

### 尾斜杠：49,883 处站内链接不再多走一次 301

站点是 `build.format: "directory"`：每个页面是 `<路径>/index.html`，nginx 会把
`/about` 301 到 `/about/`。但导航、页脚、卡片、正文里的链接以前全都写成不带斜杠的
形式，于是**每一次点击、每一次爬取都要多一个 RTT**（跨境访问下这直接翻倍首包时间）。

| 位置 | 改法 |
|---|---|
| 导航 / 页脚 / 卡片 / 语言切换 | 统一走 `pathWithLang()`，函数内补斜杠 |
| 正文（日报条目、周报列表、手写文章） | 新增 `rehype-trailing-slash` 插件统一改写 |
| 页脚、about 页数据、后台互链、重定向目标 | 逐处补成 canonical 形式 |

两个容易踩的点：
- **不能用「最后一段含点就不加斜杠」判断文件**：个股页是 `/invest/stock/688981.SH`，
  代码里本来就带点。改成后缀白名单（`xml/json/png/webp/…`）判断。
- 查询串和 hash 要保留（相关推荐链接带 `?utm_source=related`）。

改完 `[内链] 69744 个站内引用 · 全部可解析且都是 canonical 形式`，`check:seo` 现在
把「指向页面却缺尾斜杠」当错误处理，不会再退化。

### 站内链接：四个页面从「只有 sitemap 知道」变成可点

用 dist 里的 `href` 建了张入链图，发现 `/topics`、`/explore`、`/uses`、`/changelog`
四个页面的入链数是 **0**——导航和页脚都没有入口，用户根本点不到，搜索引擎只能靠
sitemap 知道它们存在。页脚加了一行「探索」入口后，每个页面都能到达（入链 581）。

顺带把这件事做成门禁：`check:seo` 现在逐个校验 69744 个站内引用，要求目标文件存在
且大小写完全一致。大小写这条专门为生产环境准备——本地 macOS 不区分大小写，写错也
能打开，一上 Linux 就是 404。第一条跑出来就抓到 404 页的 `canonical` 指向
`https://…/404/`（这个 URL 从来不存在），已改成 noindex 页不输出 canonical /
`og:url` / 结构化数据。

### 列表页与日报页的描述（`src/lib/descriptions.ts`）

`check:seo` 的「描述偏短 / 重复」两类告警都指向同一件事：这些页面的 description
是写死的套话。现在改成构建时按数据算：

| 页面 | 描述怎么来 | 效果 |
|---|---|---|
| `/tag/<tag>`（中英） | 篇数 + 最新一篇的标题与月份 | 29 个标签页各说各的，随内容自己更新 |
| `/tag`、`/ai`、`/invest`、`/photo`（中英） | 该板块的篇数/相册数/照片数 + 最新一篇 | 原来是「笔记、论文、工具、思考」9 个字 |
| 日报详情（`/ai/digest-*`、`/invest/digest-*`） | 正文里前两条真实条目标题 + 条数 + 日期 | 724 个页面从 **121 种描述**变成 **724 种**（最多的一条原本重复 129 次） |
| 周报详情（`/ai/weekly-*`） | 各栏目条目数 + 第一条标题 | 19 个中文周报原本共用一句「AI 7 · 投资 12 · 徒步 0 · 站长本周观察」 |
| 市场复盘详情 | frontmatter 的指数涨跌，补上日期前缀 | 有几天涨跌完全相同，靠日期区分 |
| 个股详情（`/invest/stock/<code>`） | 公司名 + 代码 + 数据栏目 | 中芯国际 A 股与港股两页原本描述一字不差 |
| 404 | 自己的文案 + `noindex` | 原来借用站点标语、还允许索引 |

校验方式：`npm run check:seo` 会统计「多页共用同一句描述」的组数并打印最多的几条
（告警级，不拦部署）。2026-11 清零前是 25 组 / 80 页，现在是 0 组。

两个细节：中文按视觉宽度加权（`check-seo` 里 CJK ×1.7），所以 `clip()` 截得比较短；
英文页如果拼出来的描述混进了中文标题（477 页里有 9 页是翻译漏翻的），直接回退
frontmatter，宁可套话也不中英混排。

### 已读标记的可访问性（`src/components/ReadTracker.astro`）

"读过的文章"原来用 `opacity: 0.55` 淡化整张卡片。回访用户（localStorage 里有记录）
在列表页看到的是 11px 灰色小字被压到约 2.5:1 —— 低于 4.5:1。axe 只有在"已经读过
几篇"的上下文里才会报，所以之前 84 次抽查一直是绿的。现在改为只加行末 ✓，不降透明度。

### 岛水合冒烟：`scripts/check-hydration.mjs`

`npm run check:hydration`（需先 `npm run build` 并起一个静态服务器，`BASE_URL` 可覆盖）。
遍历 7 个岛密集型页面，滚动触发 `client:visible`，收集 `pageerror` / `console.error`，
过滤掉本地没有 FastAPI 后端造成的 `/api/*` 404，有任何其它报错即退出码 1。

存在的理由：React 19 / recharts 3 这类升级，Lighthouse 分数和 axe 都不会变红，
只有「组件到底有没有在浏览器里画出来」能拦住回归（2026-11-11 升级时用它验证：
23 个岛全部水合，`/en/invest/` 的 2 个图表容器、10 个饼图扇区、1 条折线都正常渲染）。

## 配置文件

| 文件 | 编辑后影响 |
|---|---|
| `src/data/about.ts` | /about 页内容 |
| `src/data/uses.ts` | /uses 页内容 |
| `src/data/embeddings.json` | 相关推荐 / /explore（cron 自动维护） |
| `tailwind.config.mjs` | 字体 / section colors |
| `astro.config.mjs` | 站点 URL / i18n / 集成 |
| `src/content.config.ts` | 内容集合 schema / glob loaders |
| `.lighthouserc.json` | 性能预算阈值 |
| `renovate.json` | 依赖自动更新策略 |

## Security

详见 [`docs/security-headers.md`](./security-headers.md) — nginx 加 CSP / HSTS / Permission-Policy。

## 字体

| 字体 | 用途 | 加载方式 |
|---|---|---|
| Inter（可变 100-900） | sans body | **自托管** `src/assets/fonts/` → `/_astro/*.woff2` |
| Instrument Serif 400 + italic | display 大标题 | 自托管，同上 |
| JetBrains Mono（可变 100-800） | code / meta | 自托管，同上 |
| Noto Sans SC | og:image 里的中文 | build 时下到 `.fonts/`（不进 dist） |

- 浏览器端字体由 `scripts/fetch-fonts.ts` 抓 latin 子集放进 `src/assets/fonts/`，经 Vite 输出成带内容哈希的 `/_astro/*.woff2`，nginx 对 `/_astro/` 返回 `public, immutable, max-age=31536000`。**不再依赖 fonts.googleapis.com**（大陆经常超时/被墙）。
- 不加 `<link rel="preload" as="font">`：限速 1.6Mbps 时字体和 HTML 抢带宽，实测让首屏晚 ~300ms；所有 `@font-face` 都是 `font-display: swap`，FCP 不等字体。
- og:image 生成必须有 `.fonts/`，由 `scripts/setup-fonts.sh` 在 `prebuild` 阶段从 Google Fonts CSS 抓 TTF。

## 依赖版本

2026-11-11 完成一轮栈升级（astro 7.4.1 / @astrojs/mdx 8 / @astrojs/react 7 / React 19 /
recharts 3 / marked 18），每条单独提交、单独回归，细节见 `docs/tailwind4-migration.md`
同目录的提交历史。

| 约束 | 原因 |
|---|---|
| `astro` 钉在 `~7.4.1` | 7.4.x 与 `@astrojs/mdx@8`（`@astrojs/internal-helpers@0.13`）已经自洽，早期 7.3 ↔ mdx 7 的 lockfile 冲突不再存在；`<=7.3.2` 的 XSS / AVIF RCE advisory 早被覆盖 |
| Astro 栈必须整组升 | astro / `@astrojs/mdx` / `@astrojs/react` 之间有 peer 锁，单个升会让 `npm ci` 不自洽 |
| React 19 类型差异 | `React.FormEvent`、`React.MutableRefObject` 已废弃：用 `SyntheticEvent<HTMLFormElement>`、`RefObject` |
| recharts 3 | `<Cell>` 已废弃（4.0 移除），逐扇区上色改用 `shape` + `<Sector>`；Tooltip formatter 首参是 `ValueType \| undefined`，取值要 `Number(v)` |
| Tailwind 留在 3.4 | 669 处隐式 `border` 默认色在 v4 会变 `currentColor`，且内联 CSS 让回归落在 1139 个页面上；迁移方案见 `docs/tailwind4-migration.md` |
| TypeScript 留在 5.9 | `typescript@7` 是原生端口，`astro check` 兼容性未验证；只影响类型检查不妨碍产物 |
| `npm ci` 是防火墙 | CI 的 Install 步骤跑 `npm ci`，任何「本地 `npm install` 能过但 lockfile 不自洽」的改动都会在部署前被拦住（2026-11-10 踩过一次） |
| Renovate | astro / `@astrojs/*` 分组为 `astro-stack` 不自动合并；React 允许 `^19`，大版本仍人工审 |

剩下 3 个 moderate advisory 都在构建期、不进浏览器：`satori`（只用于 `/og/*.png`）、`postcss-selector-parser`（被 `@tailwindcss/typography` 钉版本）。

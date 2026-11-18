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

### AI 助手改成「点了才加载」：首屏少一堆 React

首页 Lighthouse 桌面档一直在 0.75–0.90 之间抖，`total-blocking-time` 200–580ms，
LCP 却只有 0.44s——说明问题不在首屏内容，而在**空闲后才水合的两个 React island**
（`AIChatWidget` + `SearchModal`）。

对照实验（同一份 dist，逐个删 island 再跑 Lighthouse 桌面档）：

| 版本 | TBT | perf |
|---|---|---|
| 原样（两个 island） | 200–580ms | 0.75–0.90 |
| 只留 SearchModal | 9ms | 0.99 |
| 只留 AIChatWidget | 111ms | 0.97 |
| 两个都去掉 | 36ms | 1.00 |
| 改后（AIChatWidget 点开才加载） | 86–297ms（中位 307，机器负载高时噪声大） | 0.85–0.98 |

奇怪的是两个 island 单独都不贵、合起来却要 500ms，而且模块本身 eval 只要 10–15ms
（用 `performance.now()` 包 `import()` 实测）。所以成本在**水合过程**：React 运行时
求值 + 把组件树挂上 DOM + 组件内联 `<style>` 触发整页样式重算。

改法：把聊天挂件拆成「静态按钮 + 按需加载」

- `src/components/ChatLauncher.astro`：纯 HTML 按钮，Zoro 图标在构建期由
  `ZoroChibiIcon` 渲染成静态 SVG，不加载任何 React。
- 点击时才 `await import("@/entrypoints/ai-chat")`（Vite 自动切成
  `_astro/ai-chat.*.js`，约 65KB / 22KB gzip），再 `createRoot` 挂上去，
  挂载后移除静态按钮。加载失败会恢复按钮，弱网下可以再点一次。
- `AIChatWidget` 新增 `initialOpen` prop，挂载即展开——用户已经点过一次，
  不需要再点第二次。
- 搜索 modal 保留 `client:idle`（单独评估过只有 9ms TBT，不值得为它再拆一套）。

### 性能预算为什么必须「跳过内容提交 + 每日兜底」

2026-11 观察到一个沉默的失效：**Lighthouse 的 14 URL × 5 次审计几乎从来没跑完过**。

链路是这样断的：

1. 自动化任务（ETF 快照 / 行情日报 / AI 日报）每 13–15 分钟推一次提交；
2. 每次 deploy 成功都通过 `workflow_run` 触发 Lighthouse，一轮要 35–40 分钟；
3. 工作流的 `concurrency` 开了 `cancel-in-progress: true`，于是每次新部署都把
   正在跑的那轮审计取消。结果 GitHub 上只剩一串 `cancelled`，性能断言等于不存在。

修复分两步，缺一不可：

| 改动 | 原因 |
|---|---|
| `scripts/lighthouse-scope.mjs` 把 `src/content/**` 也算「只动内容」 | 内容提交不碰模板 / 样式 / 脚本，分数不会变；跳过它才不会天天排长队 |
| `concurrency.cancel-in-progress: false` | 取消发生在 workflow 级别，早于 scope 判断，「只动内容」的部署照样能掐掉进行中的审计。改成排队后，被跳过的运行在第一步（约 15 秒）退出，队列很快排空 |
| 新增每日 03:00（北京时间）定时审计 | 内容也可能影响大列表页（标签页、归档页），每天固定跑一次完整 14 URL 兜底 |

判断口径：`src/content/**`、`src/data/wind-*.json`、`src/data/etf-three-factor-*.json`
都算内容；改 `src/pages`、`src/components`、`src/layouts`、`src/styles`、`scripts/lighthouse-*.mjs`、
`astro.config.mjs`、`.lighthouserc.json` 一律照跑。合并提交用
`git diff-tree -r -m --first-parent` 取改动清单（普通 `--no-commit-id -r` 对合并提交返回空，
会被误判成「没改动」而白跑一轮）。

### 查「这页最近慢了多少」：`npm run perf:history`

审计结果散落在每轮 run 的 artifact 里，取不到 token 就只能看最新一轮。但 LHCI 上传的
commit status 是**公开可读**的（`lhci/url/<path>` 的 description 就是 "Performance: 92, ..."），
所以做了 `scripts/lighthouse-history.mjs`：

```bash
npm run perf:history              # 最近 6 轮，URL × 轮次的分数矩阵
npm run perf:history -- --rounds 3
npm run perf:history -- --json    # 机器可读
```

表格左新右旧，最新一轮后面标 ↑/↓ 变化；`—` 表示那一轮没有这个 URL 的数据（审计中途被取消时
会只发出部分 URL 的 status），`⚠` 表示断言只报了警告（描述里没有分数），`✗f` 表示该 URL 失败。

实测读出来的东西（2026-11-18 四轮，同一份代码不同轮次）：

| URL | c1f58d6 10:57 | 9e94507 12:14 | 变化 |
|---|---|---|---|
| `/photo/baokemeng/` | 90 | 70 | ↓20 |
| `/invest/digest/` | 93 | 80 | ↓13 |
| `/ai/` | 98 | 89 | ↓9 |
| `/explore/` | 97 | 98 | ↑1 |

同一份 HTML 差 20 分，只能说明那 40 分钟里 runner 或跨境链路有抖动——这也是为什么
`categories:performance` 只做告警。**要看真回归，看的是同一 URL 连续多轮都低，而不是单轮掉分。**

注意：未认证 GitHub API 每小时 60 次，脚本默认 6 轮约 7 次请求；连跑几次会撞 403，
等一小时自然恢复（或给 token，见「待决定」清单）。

### 审计只量「已经切过去」的生产

Lighthouse 审的是线上 URL，而部署本身要几分钟（rsync + 原子切换）。以前审计在部署成功后
`sleep 60` 就开跑，可能正好跨在切换中间——同一个页面两轮差 7–14 分，有几次就是这么来的
（量和测的是两个不同版本的页面）。

现在两步兜住：

| 步骤 | 行为 |
|---|---|
| 开跑前 | 轮询 `deploy-meta.json` 直到 `sha` 等于触发它的提交（最多 10 分钟）；超时只告警，照样审 |
| 跑完后 | 再读一次 `deploy-meta.json`，不一致就在 step summary 里写明「审计期间生产换过版本」 |

这样分数波动可以归因：要么真慢，要么环境噪声，不会再夹着「混版本」这个不可见的干扰项。

### 性能门禁分级：分数只告警，指标才硬拦

2026-11-18 同一份代码跑了两轮 15 URL 审计（`f72f6b7` 与 `c1f58d6`，页面内容无差别），
逐 URL 对比后发现 category 分数会整体漂移 7–14 分：

| URL | 第一轮 | 第二轮 |
|---|---|---|
| `/ai/digest-2026-06-05/` | 99 | 84 |
| `/hike/sample-route/` | 96 | 89 |
| `/invest/` | 96 | 89 |
| `/` | 99 | 92 |

共享 runner + devtools 限速 + 真实跨境网络三者叠加，`categories:performance` 不是稳定的
信号。用 0.80 当 error 门禁，迟早会因为噪声把 main 判红（和之前地图页「红色门禁比少一个
URL 更糟」是同一个判断）。所以分级：

| 断言 | 级别 | 阈值 |
|---|---|---|
| `categories:performance` | warn | ≥ 0.80（看得见，但不拦） |
| `largest-contentful-paint` | **error** | ≤ 3.5s（真回归才会破） |
| `cumulative-layout-shift` | **error** | ≤ 0.1 |
| `first-contentful-paint` / `total-blocking-time` | warn | 2.0s / 300ms |
| `categories:accessibility` / `categories:seo` | error | 0.90 / 0.95 |

指标级阈值不会因为 runner 空闲或繁忙而跳变——它量的就是这一页的加载行为。

### 归档页：中英各补一个「从头翻一遍」的入口

内容量到 500+ 篇之后，站内其实只有三条找东西的路：板块首页（只看最近）、`/tag`（要先想到关键词）、
`/explore`（按 embedding 相似度铺成二维地图，纯中文）。英文站连 `/explore` 都没有，订阅页
的「想直接看」只能把人送回首页。

新增 `/archive/` 与 `/en/archive/`（共用 `ArchiveByYear.astro`）：

| 项 | 做法 |
|---|---|
| 数据 | 四个 collection 全量取该语言的非 draft 条目，按日期倒序 |
| 结构 | 按年份分节（`h2` 年份 + 篇数），每条一行：日期 · 板块 · 标题 |
| 结构化数据 | `CollectionPage` + `ItemList`，只放最近 100 条（同 `MAX_TAG_ITEMLIST`） |
| 体积 | 524 条 → 342 KB HTML（其中 ~90 KB 是内联 CSS）；390px 下无横向溢出 |
| 内链 | 页脚「Tags · Archive」、订阅页「全部归档」都指向它；`/archive` 同时加进 hreflang 配对表与 sitemap |

顺手修正了一处容易漏的配套：sitemap 的静态路径是**手写清单**（`src/lib/sitemap.ts`），新增页面
不同步加进去，`check:seo` 会立刻报「可索引但不在 sitemap」——这次就是它挡住的。

### 英文站的主题入口：`/en/topics/` 做了，`/en/explore/` 没做

中文站有两条「按主题看」的路：`/topics`（标签云 + 板块体量）和 `/explore`（按 embedding 投影的二维地图）。
英文站此前一条都没有，只能靠 `/en/tag/` 索引一个个点。

| 页面 | 依赖 | 结论 |
|---|---|---|
| `/en/topics/` | 只要 frontmatter 里的 tags 和正文 | **做了**。`TopicsCloud.astro` 抽成中英共用组件，标签云 29 个、体量条 4 条，两侧渲染结果一致 |
| `/en/explore/` | 每篇的 embedding 向量（`src/data/embeddings.json` 里 520 条全是中文内容） | **不做**。要么给 500+ 篇英文内容重新生成向量（外部 API 成本 + 中英向量空间不可混用），要么退化成无意义的散点。英文用户走 `/en/archive/` + `/en/tag/` 已经够 |

配套三处容易漏的地方都补齐了：sitemap 的英文静态路径清单、hreflang 配对表（`TRANSLATED_STATIC_PATHS`）、
页脚「主题 / Topics」入口。

### pre-push 钩子：把「看漏退出码」变成不可能

`npm run gate` 解决的是「怎么一次跑完」，但靠自觉仍然会漏。仓库现在带一个
`.githooks/pre-push`，`npm run hooks:install`（`git config core.hooksPath .githooks`）之后每次
`git push` 自动跑：

| 改动范围 | 跑什么 | 耗时 |
|---|---|---|
| 只动内容 / 生成数据（`src/content/**`、`src/data/wind-*` 等） | `npm test` + `astro check` | ~15 秒 |
| 动了模板 / 样式 / 脚本 / 配置 | 再加 `build` + `check:og` + `check:seo` | ~2 分钟 |

分档逻辑在 `scripts/prepush-scope.mjs`（纯函数，有单测）；急事用 `SKIP_PREPUSH=1 git push` 跳过。
实测时踩到一个 shell 坑：`"$scope）"` 里全角括号的字节会被 bash 当成变量名的一部分，报
`scope: unbound variable`——改成 `${scope}` 才对，钩子里所有变量都统一成了花括号写法。

### 一条命令跑完所有门禁：`npm run gate`

2026-11-18 出了一次本可以避免的故障：订阅页新加的「归档」链接指向 `/en/explore/`，
而这个页面只有中文版。`check:seo` 会把它判成「打不开的站内链接」并以退出码 1 结束——
但本地是用 `... | tail -2` 看输出的，`通过` 两个字的上一行就是退出码 0/1 的信息被我漏掉了。
结果 commit 推上去，部署连续红了 4 次、每次 ~2 分钟，生产停在旧版本约 50 分钟。

两处修正：

1. `npm run gate` = `validate:etf → check → test → build → check:og → check:seo → check:admin`，
   和部署流程跑的是同一串，本地一条命令跑完，**看退出码**而不是看日志尾巴；
2. 部署 workflow 增加失败诊断步骤：把每个关键 step 的 `outcome` 写成 commit status
   `ci/failed-step`（`permissions: statuses: write`）。公开仓库读 status 不需要 token，
   所以「到底哪一步红了」不再依赖 Actions 日志——之前因为没有 token，red run 只能盲猜。
   本次故障就是靠这个新状态定位到 `seo` 这一步的。

### 薄页与长列表：订阅页、标签页、ItemList 上限、移动端表格

2026-11 这一轮收拾的是「页面有了，但内容太薄 / 太重」的两头：

**订阅页（`/subscribe/`、`/en/subscribe/`）** 原来只有一块表单加几个阅读器按钮，
第一次来的人看不到这个站写什么、多久发一次、邮箱会被怎么处理。新增
`src/components/SubscribeContent.astro`，一次讲清四件事，数字在构建时从内容集合里数出来
（不写死）：

| 区块 | 内容 |
|---|---|
| 你会收到什么 | 四个板块各自的篇数 + 一行描述 + 站内链接 |
| 多久一封 | 有更新才发，邮件合并，最多每周两封 |
| 邮箱怎么处理 | Buttondown 托管、double opt-in、每封带退订、无广告无追踪 |
| 不想订阅 | 归档页 / 标签索引的入口（顺带给锚文本门禁提供有信息的锚文本） |

英文页正文从 67 词涨到 238 词。

**标签页** 两类问题一起改：

1. 正文只有「N 篇」+ 列表 → `TagIntro` 现在补「板块分布 + 时间跨度 + 各板块入口链接」，
   数据来自新增的 `tagStats`（最早 / 最新月份、各板块篇数）；
2. 只有一两篇内容的标签（中英各 8 个）天然很短 → 补一块「同栏目最近文章」（`recentInSection`，
   最多 5 条），既给读者下一个入口，也补了内链。顺带修掉「1 posts」的单复数。

**`/tag/auto/` 的 ItemList**：385 条内容全塞进结构化数据，页面 348 KB 里四十多 KB 是
ItemList JSON。新增 `MAX_TAG_ITEMLIST = 100`，schema 只放前 100 条，列表本身仍完整渲染
（读者无损失），页面降到 292 KB。

**移动端持仓表**：390px 下原本 8 列 745px，需要横向滚一大截。现在窄屏隐藏
「模拟份额 / 起始净值」两列（信息量主要在净值、市值、盈亏），并把单元格内边距从
`p-3` 收紧到 `p-2 sm:p-3`、基金名列宽 `110px sm:180px`：745px → 458px。剩下的差额
留在 `overflow-x-auto` 容器里滚动——比硬塞成两行更好读。

### 锚文本纳入构建期检查

站内有 6 万个站内链接，锚文本既是用户导航线索，也是搜索引擎判断目标页主题的依据。
2026-11 做过一次全站普查（`dist` 里 1179 个页面）：

| 分类 | 数量 | 判定 |
|---|---|---|
| 站内链接总数 | 约 6.0 万 | — |
| 只有图标、无可见文字 | 4186 | 全部带 `aria-label`（分享 / 留言板 / 订阅 / 管理后台），可访问名完整，**不算缺陷** |
| 无信息量短语（阅读更多 / Read more / 点击这里） | 0 | 内容链接一律用标题当锚文本 |
| 空锚文本且无 `aria-label` | 0 | 真正要拦的情况 |

普查一次不难，难的是别让它重新长出来。所以 `src/lib/anchor-text.ts` 把判定写成纯函数，
`scripts/check-seo.mjs` 每页调用一次：

- **错误**：可见文字为空且没有 `aria-label` / `title` → 读屏软件读到的是一次空白跳转，
  搜索引擎也拿不到主题信号；
- **告警**：锚文本是「阅读更多」「Read more」这类通用短语 → 建议换成目标页标题。

`<script>` / `<style>` / `<pre>` 里的伪链接会先被剥掉，避免内联脚本里的字符串误报。

### 英文投资页补齐实时行情：组件 i18n + 数据装载收敛

`/en/invest/` 之前只有月度复盘和归档入口，中文页的整块实时行情（今日大盘、市场情绪、
基金净值、AI 科创、创业板、行业板块）在英文页是**完全缺失**的。补齐时发现两个障碍：

- 5 个 React 岛（`MarketIndicesGrid` / `MarketSentiment` / `LiveHoldings` /
  `StockSpotlight` / `SectorRanking`）里文案全写死中文；
- 看板的数据装载（解析 `_holdings.yaml`、读 `data/wind-market-latest.json` 拼 SSR 兜底、
  算板块前后十名）只写在中文页 frontmatter 里，英文页要用就得复制一份。

处理方式：

| 层 | 做法 |
|---|---|
| 文案 | `src/lib/market-i18n.ts` 一份中英词典 + `formatYi`（中文「亿/万亿」↔ 英文「B/T」）；参数化文案写成函数，组件里只拼变量 |
| 组件 | 5 个岛都加 `lang?: "zh" \| "en"`（默认 zh），中文页行为不变 |
| 数据 | `src/lib/invest-dashboard.ts` 收敛装载逻辑：`parseHoldings` / `loadPortfolioBoard` / `loadWindSnapshot` / `stockSeeds`，`loadInvestDashboard(lang, snapshots)` 是唯一入口 |
| 结构 | `src/components/invest/InvestDashboardSections.astro` 一份标记，两个页面共用 |
| 数据名 | 股票池中英两套名称与说明；10 只基金的 `nameEn` 写进 `_holdings.yaml`（人工翻译，非官方译名）；常见指数名按代码映射（SSE Composite / SZSE Component / ChiNext…） |

顺带修掉两个「文案散落在逻辑里」的历史问题：

- `classifyLaggingSectors` 原本返回中文标题（`"跌幅榜"`），现在返回语义 `kind`，
  标题由组件按语言取——否则英文页会突然冒出一个「跌幅榜」；
- `MarketSentiment` 的 SSR 兜底快照只带涨跌停家数，原类型却要求全量 breadth，
  以前靠 `any` 蒙过去；现在类型放宽为 `Partial<Breadth>` 并给缺字段兜底，快照渲染不再出现空白数字。

**已知局限**：行业板块名（申万细分行业，如「冰洗」「通信工程及服务」）来自上游行情源，
仍是中文；英文页保留原文，需要的话可以再补一张板块名词表。

### 标题层级纳入构建期检查（对应 Lighthouse heading-order）

Lighthouse 只审 15 个 URL，而「h1 → h3 跳级」这类问题常藏在模板角落：图表卡片的
标签用了 h3、而那一块没有 h2 承接。单靠线上抽查抓不全，所以做成构建期规则。

`src/lib/heading-order.ts` 提供 `extractHeadings` / `headingIssues`：

- 抽取标题时先剥掉 `<script>` `<style>` `<template>` `<pre>` `<code>`，避免把代码
  示例或内联字符串里的假标题算进来；
- 规则只有一条：**从上一级往下降可以任意深，往上只能一级一级加**；
- 首个标题不是 h1 时给告警（真缺 h1 由原有规则报错）。

`scripts/check-seo.mjs` 每次全量扫 1175 个页面，输出 `标题顺序：h1 → h3 跳级：…`。
首轮扫出 3 处并修掉：

| 页面 | 问题 | 修法 |
|---|---|---|
| `/hike/sample-route/`（中英） | 海拔曲线标签是 h3，页面没有 h2 | h3 → h2 |
| `/en/photo/` | 相册卡片 h3 上面缺「All albums」h2（中文页有） | 补 `sr-only` 的 h2 |
| `/en/invest/` | 净值/持仓图表 h3 上面没有 h2 | 补 Portfolio snapshot h2 |

顺带暴露一个更大的问题：**英文投资页缺了中文页的整个实时行情区块**（今日大盘、市场情绪、
AI 科创、创业板、板块涨跌），那 5 个组件里还有大量硬编码中文，要补齐得先做组件 i18n。

### 性能预算覆盖到 15 个 URL（含 Leaflet 地图页）

`.lighthouserc.json` 原来只审 12 个 URL，缺个股页（图表 JS 重）和标签详情页
（CollectionPage + ItemList）。补到 14 个：加了 `/invest/stock/688981.SH/` 和
`/tag/photo/`，实测 0.97 / 1.00。

`/hike/sample-route/`（带 Leaflet 地图）第一次加进去时 CI 直接红，状态是
`lhci/url/hike/sample-route/ failure · Failed 1 assertion(s)`；本地按 CI 同款配置
（desktop + devtools 限速）跑出来是 0.92–0.99、CLS 0.000，复现不出来。先把两个
最可能的根因修掉：

1. Leaflet 默认版权署名是 50% 灰字压在瓦片上，浅色瓦片时对比度不足 4.5:1 →
   改成实底 + 深色文字（暗色模式另一套），审计不再受瓦片内容影响；
2. 地图是 `client:only`，服务端不输出 DOM，地图 JS 晚到会把下面内容顶下去 →
   外层先占好 `height`，并改成 `client:visible`，可见时才挂载。

修完先在预算集里撤掉这个页面，用 commit status（`lhci/url/...`）单独观察，确认
生产实测 a11y 1.00 / CLS 0.000 / 12 块瓦片后再加回，现在是第 15 个 URL。

顺带解决了一个更要命的问题：**审计本身跑不完**（下一节）。如果不先修触发策略，
加多少个 URL 都是空的——每轮都被下一次自动化部署取消掉。

### 全站搜索改成「按了才加载」：首屏 JS 从 97KB 降到 7KB

搜索 modal 原本是 `client:idle` 的 React island，挂在 `BaseLayout` 里，于是**每个页面**
（1145 页）首屏都要为它加载 React 运行时、react-dom、DOMPurify 和组件本身。

实测首页首屏 JS 传输量：

| 阶段 | 首屏 JS |
|---|---|
| 两个 island（聊天 + 搜索） | 97.3 KB |
| 聊天改按需（上一轮） | 97.3 KB（搜索仍在） |
| 搜索也改按需（本轮） | **7.0 KB** |

现在 `SearchLauncher.astro` 只做三件事：定义 `window.__openSearch()`、挂 `/` 快捷键、
首次触发时动态 import `@/entrypoints/search`；挂载后 React 组件自己接管
`window.__openSearch` 和 Esc，启动器把自己注册的 `/` 监听摘掉，避免一次按键触发两次。
Navbar 放大镜、Footer、404、首页搜索框调的都是同一个 `window.__openSearch`，行为不变。

代价：第一次点搜索要多等一次 chunk 下载（约 30–40KB gzip）。因为搜索本身也要等
pagefind 索引，这次下载被索引加载的等待吸收了，用户感知不到。

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

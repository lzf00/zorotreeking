# 架构（2026 年中升级版）

补充 `README.md` 没覆盖的几条新自动化流水线和组件，方便日后接手 / 排查。

> **只想查「现在什么在跑、红了看哪里、哪些要人拍板」→ 看 [operations.md](./operations.md)**
> （那一页只写当前状态；正式内容只写「按轮次追加」的历史与决策理由）

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

排查时还踩到第二个坑：写成了 `steps.prodwait.outputs.audited-sha`——**带连字符的 output 在
GitHub 表达式里不能用点号取**，会静默变成空字符串再退回默认值，看日志也看不出错。
正确写法 `steps.prodwait.outputs['audited-sha']`，已加测试锁住。

##### 第三个坑：文件名里写了一整行 GITHUB_OUTPUT（2026-11-19 才发现）

`perf/audited` 这条状态连着两轮都没出现，但 job 步骤本身是 success。原因：

```bash
echo "audited-sha=$live" >> "$GITHUB_OUTPUT"   # 给 Actions 读，格式是 key=value
echo "audited-sha=$live" > audited-sha.txt     # ← 文件里不该带 key
```

下游 `audited=$(cat audited-sha.txt)` 拿到的是 `audited-sha=<sha>`，于是把这个整串当提交号
POST 到 `/statuses/audited-sha=<sha>` → 404，而脚本后面跟着 `|| true`，把 404 吞了：
步骤 success、状态没发出去、日志里也看不出。同一串还被拿去和线上 sha 比较，所以
「审计期间生产变过版本」这条警告也可能是假警报。

修法：文件里只写裸 sha；两处读取都加 `sed 's/^audited-sha=//'` 归一化（兼容旧格式）；
POST 不再 `|| true`，非 201 就 `::warning::` 留痕。

另外一个假绿要防：审计脚本现在遇到「大面积 404」或「dist/ 里一个页面都没有」会以环境错误
退出（exit 2），不再输出「0 页 0 违规」。2026-11-19 边跑 gate 边审手机宽度，866/1189 页
返回 404，报告却是「0 违规」——这种假绿比红了危险，所以两位数的 404 一律当环境问题。

**已实锤**（run `44362520358`，提交 `d079cdb`）：`perf/audited` 出现在 `d079cdb4` 上，
description 写着 `audited d079cdb (run 44362520358)`，和 15 条 `lhci/url/*` 落在同一个 sha，
也就是「生产当时服务的版本 = 审计声明的版本 = 分数挂载的版本」三者一致。之前两轮这条状态
一直是空的，就是这个 key 写进文件导致的 404。

顺便把「本轮审的是哪一版」做成公开的 commit status：之前这个信息只在日志里，
没有 token 就查不到，才让「分数挂错提交」这件事瞒了这么久。

#### 一个把分数找错提交的坑（2026-11-18 排查）

`perf:history` 一开始显示最近几轮「一条审计都没有」，但 Actions 里明明每轮都 success 30 分钟。
真相：LHCI 默认用 `GITHUB_SHA` 当提交号，而 `workflow_run` 事件里 `GITHUB_SHA` 是「创建这一轮时
默认分支的头」，不是触发它的那个提交。自动化提交频繁时，排队 10 分钟以上就会错位——实测
一轮审计的 15 条 status 全挂到了**上一个提交**上。

现在显式设置 `LHCI_BUILD_CONTEXT__CURRENT_HASH: ${{ steps.prodwait.outputs.audited-sha }}`，
让分数挂在「真正被测的那一版」上；`prodwait` 找不到稳定版本时退回触发 sha。

### 无障碍：Lighthouse 只看 15 个页面，剩下的用 `npm run a11y:audit`

Lighthouse 的 a11y 断言（error ≥0.90）只覆盖性能预算里的 15 个 URL。归档页、标签页、
个股页、照片页这些「不在预算里」的页面从来没人审过——它们的正文对比度、可访问名称都在
盲区里。

所以补了一个全站抽查脚本：Playwright 起一个本地静态服务器，对构建产物逐个页面注入
axe-core 跑 WCAG 2.0/2.1 A+AA 规则。

```bash
npm run a11y:audit                    # 默认 24 个页面（等距抽样，结果稳定）
npm run a11y:audit -- --pages 60      # 加大抽样
npm run a11y:audit -- --all --json    # 全站（1190 个页面，约 25 分钟）
```

几个实现上的注意点：

| 坑 | 处理 |
|---|---|
| 本机没装 Playwright 自带浏览器 | 回退到系统 Chrome（`CHROME_PATH` 可覆盖），CI 上两者都行 |
| 抽样不稳定会让「这轮干净」没意义 | 按路径排序后等距抽样，同一份产物每次抽到同一批页面 |
| 后台入口这类页面会自行跳转，注入脚本时执行上下文已销毁，整轮会崩 | 单页异常记为「跳过」继续跑；`--all` 时每 50 页打一行进度 |
| 同一条违规散落在几十个页面 | 按「规则 + 选择器」合并，输出命中页数与例页 |

首轮全站跑完（1188 个页面，后来两个跳转桩也补成了正经页面，共 1190）抓出 17 条真问题，都是「抽样 24 页看不见、只在冷门页面里」
的那种：

| 问题 | 命中面 | 原因 | 修法 |
|---|---|---|---|
| 月份标题 `text-zinc-400` 在浅色底上 2.47:1 | `/en/ai/digest/`、`/en/invest/digest/` 共 630 处 | 英文页从中文页复制时把 `zinc-600` 写成了 `zinc-400` | 对齐中文版用 `zinc-600` |
| 涨跌用的 `text-emerald-600` 3.64:1 | 英文个股/市场页、`/invest/us-market/` | Tailwind 600 档在浅色底不达标 | 浅色改 `emerald-700`，深色保持 `emerald-400` |
| 照片页说明文字 `text-white/45`、`/35` 4.48:1 | `/photo/` | 半透明白不够亮 | 提到 `/55` |
| 美股面板 `#64748b` 4.21:1 | `/invest/us-market/` | slate-500 偏浅 | 改 `#475569` |
| 后台 UTM 表单的 `<label>` 没写 `for` | `/admin/utm/` | 复制模板时漏了关联 | 补 `for` + 预设下拉加 `aria-label` |

修完复跑全站：**0 违规**。仍有一条已知例外：后台入口 `/admin/`（`public/admin/index.html`
加载的第三方 CMS 外壳），它的 DOM 是 Decap 的 JS 渲染的，无障碍名称改不了，已在脚本里显式
排除并注明；自家写的 `/admin/utm|etf-ops|feedback|stats|guestbook/` 照常审。

周检：`.github/workflows/a11y.yml` 每周二 04:30（北京）把全站跑一遍，违规就红，报告存 artifact。

顺带修掉的两个跳转桩：`/photography/` 和 `/en/photography/` 原来由 `astro.config` 的
`redirects` 生成，Astro 给的桩是 `<!doctype html><title>…`，没有 `<html lang>`（axe 报
`html-has-lang`），而且它立刻 meta refresh 跳走、脚本注不进去，审计只能整页跳过。
换成 `src/pages/photography/index.astro` 这样的正经页面（BaseLayout + `head` 插槽放
`meta refresh` + `noindex`）：跳转行为不变（实测 `/photography/` 仍落到 `/photo/`），
`lang`/`title`/`h1` 齐全，现在能被审到 0 违规。页面数 1188 → 1190，sitemap 仍是 1182
条——桩页是 `noindex`，不进 sitemap。

排查单页用 `npm run a11y:audit -- --only /photo/,/en/photo/`。

它现在挂在三处：

| 位置 | 范围 | 目的 |
|---|---|---|
| pre-push 钩子（`full` 档） | 等距 16 页，约 30 秒 | 改过模板/样式就当场拦住对比度、可访问名称这类回归 |
| `a11y.yml` 每周二 04:30 | 全站 1190 页 × 浅色/深色两套，约 24 分钟 | 兜住冷门页面（本轮 17 条问题里 630 处就在其中） |
| `npm run a11y:audit -- --only …` | 指定页面 | 排查单页 |

钩子里跑不起来（本机没浏览器）只打警告不阻塞推送——否则门禁会因为环境问题把人挡住，
但警告是必须打的，免得它悄悄失效。

#### 深色模式审出来的 6 类问题（第二轮）

只审浅色会漏掉一半页面状态。补上 `--scheme both` 之后，全站又跑出 6 类：

| 问题 | 命中面 | 原因 | 修法 |
|---|---|---|---|
| 日报月份标题在深色下 2.56:1 | `/en/ai/digest/`、`/en/invest/digest/` 共 195 处 | 上一轮修浅色时把 `dark:text-zinc-400` 一起删了 | 两套都写 |
| 板块名链接写死 hex（`#1d4ed8` 等） | `/topics/`、`/en/topics/` | 内联 style 写死颜色，深色底上 2.4–2.9:1 | 改用设计 token `rgb(var(--section-*-rgb))`，token 本身有双主题 |
| 涨跌色 `text-red-600` / `text-emerald-700` / `text-rose-600` | `/invest/etf/`、`/invest/us-market/`、英文个股页 | 只给了浅色值，深色底上 2.5–4.0:1 | 改用 `var(--market-up/--market-down)`，或补 `dark:` 变体 |
| 美股面板写死 `#b24a3a` / `#64748b` | `/invest/us-market/` | 同上 | 补 `dark:` 变体 |
| 后台反馈表头 | `/admin/feedback/` | 上一轮同理删了 dark 变体 | 补回 |
| 引用块深色 4.09:1 | 5 个 `/en/invest/market-recap-*` | typography 插件的 `prose-invert` 没盖住 `blockquote`，退回 `zinc-500` | 主题层加 `.dark .prose :where(blockquote)` 提亮到 `#a1a1a6` |

#### 本机基线：`npm run perf:local`

CI 的分数会被 runner 网络抖动放大（同一份 HTML 两轮差 9–20 分）。要判断「真变慢了」
还是「runner 抽风」，先跑本机基线：desktop preset + 固定 4× CPU 节流 + localhost，
分数是稳定的（同一页面多次运行完全一致）。

```bash
npm i -g lighthouse            # 没装过才需要；也可 LIGHTHOUSE_BIN=/tmp/lh/node_modules/.bin/lighthouse
npm run perf:local                          # 默认 4 个页面 × 2 次取中位数
npm run perf:local -- --urls /invest/,/ai/ --runs 3 --json
```

2026-11-19 基线（m4 Mac，`/invest/` 99 分、FCP 684 ms、LCP 885 ms、TBT 0；
`/explore/` 100 分、FCP 541 ms、LCP 601 ms、TBT 0）。lighthouse 没进 devDependencies
（一次几十 MB，CI 每个 job 都要 `npm ci`），所以脚本找不到可执行文件时会提示先装。

#### 工具自己得先判「这次结果不可信」

基线稳定的前提是「同一页面多次运行一致」，但 `/invest/digest/` 打脸：同一份 HTML 三次
跑出 **70 / 84 / 99**（TBT 633 / 400 / 0），差 29 分——比任何一次改动带来的收益都大。
不标出来，读表的人会把它当回归或进展。

所以 `perf:local` 现在逐 URL 算极差（max − min），多给一列「抖动」：

| 判定 | 含义 |
|---|---|
| 性能极差 ≥ 5 分 | 分数在抖，单轮数字没有意义 |
| TBT 极差 ≥ 150 ms | headless 软件光栅（见下一节）在随机吃掉主线程 |
| 只跑了 1 次（`--runs 1`） | 无法判断，一律标抖 |

任一命中就打 `⚠ 性能 ±7 / TBT ±437ms`，表尾再汇总一行「哪些页面在抖」，并提示加
`--runs 5` 或用同源两份 HTML 做 A/B。实测输出（2026-11-19）：

```
| /invest/digest/ | 74  | 742 ms | 842 ms | 633 ms | ⚠ 性能 ±7 / TBT ±437ms |
| /ai/            | 100 | 482 ms | 542 ms | 0 ms   | 稳定                   |
```

判据本身是经验值，写进 `tests/perf-local.test.ts`：稳定样本（100/99/100、TBT 0/20/0）
不许报抖，70/84/99 必须报抖，TBT 0→964 但分数只差 1 分也要报抖。

**一次真优化（`/invest/` 的视觉进度从 2.8 s 降到 1.1 s）**：CI 与本机都显示 `/invest/` 的
Speed Index 比 `/explore/` 差一倍多（2786 vs 835 ms，同为 perf 92/99）。原因是市场情绪
组件要求「拿到成交额才渲染」，而构建快照里根本没有成交额（只有涨跌家数、涨跌停），
于是 SSR 只吐三块骨架，要等实时接口（冷启动 3 秒）回来才整块换掉——首屏视觉进度被拖到
2.8 秒。改成「有 seed 就先画能画的、成交额显示『—』并标『更新中』」之后：

| 指标（CI 同款限速） | 改前 | 改后 |
|---|---|---|
| Performance | 92 | **98** |
| Speed Index | 2786 / 2780 ms | **1067 / 1161 ms** |
| LCP | 874 / 945 ms | 882 / 920 ms |
| TBT | 0 | 0 |

LCP 没动（首屏标题本来就快），涨的是「视觉完整度」——这正是 Speed Index 量化的东西。

**用它破的一次伪回归**：`perf:history` 显示 `/invest/` 在最新一轮从 95 掉到 89（↓6）。
本机连跑 3 次都是 98 分/TBT 0 —— 页面没变慢，是 runner 网络抽风。`/invest/` 的 LCP 比
`/explore/` 高约 280 ms 是结构性的（岛更多、DOM 更大），在 CI 的限速网络下会被放大，
所以它的分数天生比 `/explore/` 低一档，不表示有回归。

**教训**：改「浅色不达标」的颜色时，必须同时确认深色那一半——本轮 3 个问题是上一轮修浅色
时把 `dark:` 变体删掉造成的。所以审计脚本默认只跑浅色（快），但周检和这段回归用例都跑 `both`。

视口也可以换：`--viewport 390x844`（默认 `1280x900`）。响应式布局在窄屏会换行、折叠、
隐藏元素，宽屏下看不见的问题只有手机宽度才暴露。周检跑完全站浅/深两套之后，再抽 60 页
手机宽度（约 5 分钟）；想全量手机审就 `npm run a11y:audit -- --all --viewport 390x844`
（约 12 分钟）。

#### 手机宽度抓到的真问题：横向滚动的表格没有键盘入口

`/invest/` 在 390px 下报 `scrollable-region-focusable`（serious）：卡片里的表格靠
`overflow-x-auto` 横向滚动，容器却不可聚焦——键盘/读屏用户看不到右侧被裁掉的列。
宽屏下完全不出现，Lighthouse 的 15 个 URL 也不覆盖；只跑 60 页抽样还会漏（第一次抽样
就没抽到 `/invest/`，全量手机审计才抓齐）。

全站 24 个 `overflow-x-auto` 容器统一补了 `tabindex="0" role="group"`（站里本来就有
`[tabindex]:focus-visible` 的焦点环，聚焦后能直接方向键滚动）。另外 5 个页面是旅行页自己
写的滚动容器：`.rd-sheet-paper`（手账纸，2 个组件）和 `.ali-route-atlas__roads`（公路条），
它们在窄屏用媒体查询打开 `overflow-x: auto`，同样补了 `tabindex`。

全量手机审计复跑（1187 页，跳过 2 个跳转桩）= **0 违规**。`tests/a11y-audit.test.ts` 加了两条
硬约束：任何新增的 `overflow-x-auto` 容器、以及旅行页那两个自定义滚动类，都必须带 `tabindex`，
否则测试红。

深色模式也得单独跑：`--scheme dark|both`。站点用 `.dark` class 切两套 CSS 变量，
`prefers-color-scheme` 决定首屏；Playwright 用 `colorScheme` 就能触发同一条路径。
只看浅色的审计漏不到深色——反过来也一样，所以周检跑 `both`，本地抽查默认浅色节流。

### 行情接口的冷启动：缓存只有约 60 秒

`/invest/` 在性能预算里长期 84 分（同批其他页 90+），逐项量下来不是页面代码的问题：本地用
4 倍 CPU + 1.6Mbps 限速跑，`/invest/` 的 FCP/LCP/TBT 和 `/explore/` 几乎一样（FCP ~700ms、
LCP ~710ms、TBT 0ms）。真正的差异在接口：

| 接口 | 冷 | 热 |
|---|---|---|
| `/api/market/indices` | 134 ms | 134 ms |
| `/api/market/funds` | 76 ms | 48 ms |
| `/api/market/sentiment` | **3476 ms** | 36 ms |

每分钟打一次，结果严格交替——**缓存 TTL 约 60 秒**，也就是说一半的访客会撞上那 3.3 秒的冷计算；
而这个请求还会和首屏资源抢同一条 HTTP/2 连接，把 LCP 推高。

处理（都在前端，不动服务端）：

| 改动 | 理由 |
|---|---|
| `MarketSentiment` 从 `client:visible` 改 `client:idle` | SSR 快照先显示，3.3 秒的请求挪到浏览器空闲之后，不参与 LCP 竞争 |
| `LiveHoldings` 从 `client:load` 改 `client:idle` | 在首屏之外，SSR 已渲染出 20 行表格，交互没必要抢首帧 |
| `MarketIndicesGrid` 保持 `client:load` | 在首屏内、接口 134ms，保持即时刷新 |
| 审计前先烘一遍接口 | 至少让 15 个 URL 起点一致 |

试过但放弃：每 10 分钟定时烘热。TTL 只有 60 秒，烘完一分钟就凉，白白多 144 个 job/天。

**要真正解决，得动服务端**：把 TTL 从 60 秒提到 5 分钟以上，或者在接口里加一层持久化缓存
（冷计算 3.3 秒多半是在聚合多个上游）。这需要 VPS 上那个 API 服务的改动权限，目前只有静态站
的 rsync 权限，所以列为待决定事项。

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

### 测量本身的两个坑（冷缓存顺序偏差）

同一台机器、同样 4× CPU 节流，两个页面的 FCP 会随「谁先被测」翻转：

| 测量顺序 | 第一页 FCP | 第二页 FCP |
|---|---|---|
| 先 `/invest/` 再 `/explore/` | `/invest/` 1184 ms | `/explore/` 280 ms |
| 先 `/explore/` 再 `/invest/` | `/explore/` 1160 ms | `/invest/` 292 ms |

慢的不是页面，是**冷缓存**（字体、dist 里的静态文件第一次读盘）。所以我一度以为
`/invest/` 的 LCP 结构性比 `/explore/` 高 280 ms，其实那 280 ms 是「它是第一个被测的」。

结论与对策：
- `npm run perf:local` 默认先预热（把 HTML 和它引用的 `/_astro/*` 读一遍），逐 URL 交替
  测量时也要在同一进程里先跑一轮丢弃的结果，别拿第一个页面的数字当基线；
- Lighthouse CI 每轮跑 5 次取中位数、且每次新开 Chrome，所以它受这个偏差影响较小；
- 跨页面比较要在**同一条件**下（同进程、同顺序策略）进行，否则 200–900 ms 的差异可能全是测量假象。

### 复核 TBT 真假：`npm run tbt:probe`（第 37 轮）

上一节写了「本机 TBT 不可信」，但「不可信」不等于「不用管」——真正要回答的是：这页到底有没有
阻塞主线程的工作。所以加了一个 30 秒就能跑的复核工具，**不看 Lighthouse，只问浏览器**：

```bash
npm run build
npm run tbt:probe -- --urls /,/invest/,/invest/digest/ --runs 2
npm run tbt:probe -- --self-test     # 用人造 300ms 阻塞页验证检测器本身有效
```

它用 `PerformanceObserver("longtask")` 统计加载期间的长任务（TBT 的定义就是
`Σ(duration − 50ms)`），节流档位和 CI 一致（150ms RTT / 1.6Mbps / 4× CPU）。

2026-11-19 实测（每页 2 次取最差）：

| 页面 | 实测 TBT | 长任务数 | 最长任务 | Lighthouse 同页报的 TBT |
|---|---|---|---|---|
| `/` | 0 ms | 0 | 0 ms | 0 – 1054 ms（同一天不同轮次） |
| `/invest/` | 0 ms | 0 | 0 ms | 0 ms |
| `/invest/digest/` | 0 ms | 0 | 0 ms | 4 – 633 ms |
| `/hike/sample-route/` | 0 ms | 0 | 0 ms | 0 – 378 ms |

结论：**这四个页面上 Lighthouse 报出来的 TBT 全是假的**，来源是 headless 无 GPU 时软件光栅
时间被算进「Unattributable」任务。工具自己也做了防呆：`--self-test` 会跑一个人造 300ms
阻塞页，抓不到 ≥200ms 就以退出码 1 失败——否则「全是 0」可能只是检测器坏了。

15 个 CI URL 全量探过一遍（2026-11-19，每页 2 次）：**没有一个页面存在真实长任务**，
最差是 `/about/` 一个 53ms 任务（TBT 3ms），其余全 0。所以「整站 TBT」这条线到此为止——
以后不需要再为 TBT 做任何优化。

**和 LHCI 报告并排比**：`npm run tbt:probe -- --from-lh .lighthouseci` 会自己从
`.lighthouseci/` 读页面清单和 LH 的 TBT，输出「实测 / LH 报的 / 差 / 判定」四列，
差 ≥150ms 才判「LH 的数字是模拟噪声」，否则按实测分档。省得再手抄 URL 做对照。

### 把「哪张图会被真的下载」变成门禁：`check:images`（第 43 轮）

前三轮的坑有一个共同点：**Lighthouse 的 15 URL 预算量不到**。要么页面不在清单里（`/photo/` 列表页），
要么图片在首屏之外（卡片 `loading="lazy"`），要么问题被 `<picture>` 的 webp 分支掩盖。
所以把它做成确定性检查：

```bash
npm run check:images          # 阈值 300 KB
npm run check:images -- --limit 150 --warn
```

规则（`scripts/check-image-budget.mjs`，已接进 `npm run gate`）：

| 情况 | 判定 |
|---|---|
| `<picture>` 里已有 `type="image/webp"` 的 source | `img src` 只是老浏览器兜底，**不报**（相册网格 119 处原图兜底属于这种） |
| `<picture>` 的 `<source srcset>` | 视为会下载，指向 `/photos/uploads/` 且 > 阈值就报 |
| 裸 `<img src>`（不在 picture 里） | 视为会下载（内容卡片、新闻卡片这类） |
| `.thumb.webp` / `.hero.webp` / `.og.jpg` / `.w640` / `.w960` | 派生图，永远放行 |

当前状态：1193 页通过。阈值调到 60 KB 时会列出 8 处 60–120 KB 的 `.webp`（都是 1080px 级别的
原尺寸 webp，属于正常内容图），说明规则是活的、不是在空转。

### 同一条数据，本地说「昨天」，CI 说「今天」（第 117 轮续）

上线后核对线上文案，发现 `/invest/market/` 写的是 `最新 2026/11/20 16:30（今天）`，
本地构建同样是「昨天」。差一天的根因：

- 快照里的时间是 `2026-11-20T16:30:09`，**没有时区**；
- ES 规范把"无偏移的 date-time"解释成**运行环境的本地时间**：
  本地 Asia/Shanghai → 16:30+08:00，CI 的 UTC runner → 16:30Z（= 北京次日 00:30）；
- 于是同一份数据，一边算出"昨天"，一边算出"今天"，显示的时刻也差 8 小时。

修法是把"怎么理解这个字符串"变成**代码里的显式规则**，而不是交给环境：

| 位置 | 改法 |
|---|---|
| 新增 `parseSnapshotIso()` | 缺时区就补 `+08:00`（数据源约定北京时间），带偏移则照原样 |
| `describeIsoSnapshot()` | 时间差计算走它 |
| 两个页面的 `fmtAsOf()` | 格式化走它，并钉死 `timeZone: "Asia/Shanghai"` |

验证方式写进了测试：同一组断言在 `TZ=UTC` 和 `TZ=Asia/Shanghai` 下都跑一遍（10+1 条全绿），
另外用 `TZ=UTC npm run build` 检查产物里是 `最新 2026/11/20 16:30（昨天）` —— 构建机时区
不再影响读者看到的时间。

这条和 `check:ssr-clock`（第 82 轮）是同一类问题的两个面：**渲染里任何"现在"都必须是显式的**。

### 5508 条外链，第一次体检（第 132 轮）

`check:links` 只查站内。站外链接从建站到现在**一条都没验过**——而日报、路线页引的
新闻稿和政府公告会下线、会改版。这轮把它补上：

| 观测 | 数字 |
|---|---|
| 站外链接（`<a href>`） | **5504 条 / 74 个域名** |
| 最多的域名 | news.10jqka.com.cn 1031 · arxiv.org 946 · finance.eastmoney.com 871 · huggingface.co 774 |
| 全量体检结果 | 正常 4454 · **死链 5** · 反爬 1043 · 服务器/超时 6 |
| 耗时 | 约 20 分钟（并发 12），有 7 天缓存 |

5 条死链里有 **2 条是我自己的误报**：收集器把
`<link rel="preconnect" href="https://fonts.googleapis.com">` 也算成外链，而 CDN 源站根路径
本来就 404。改成只认 `<a href>` 后误报消失，另外加了测试锁住这个行为。

真正要改的 2 条：

| 链接 | 状态 | 处理 |
|---|---|---|
| `s.nia.gov.cn/.../t20260414_1001.html`（电子边境通行证） | 404 | 换成 `https://s.nia.gov.cn/` 政务服务平台入口（实测 200），文案改成"办理入口" |
| `wlt.xizang.gov.cn/.../t20240327_409224.html`（纳木措资料） | 404 | 换成该站「旅游通告」栏目页（实测 200），标签注明栏目 |

第 5 条是 2026-09-01 AI 日报引的 qbitai 原文，改版后 404。历史日报不改正文，
登记进 `scripts/external-links-baseline.json`（带理由），下次不再报。

交付：`scripts/lib/external-links.mjs`（判定：404/410 才是死链，403/429 算反爬）、
`scripts/check-external-links.mjs`（`--hosts` / `--limit` / `--json` / 7 天缓存）、
周巡检里的 report-only 步骤（**不进 gate**：20 分钟 + 依赖外部站点，进了只会养成忽略红叉的习惯）。

### 309 KB 的页面，LCP 当然会抖（第 131 轮）

第 130 轮看到 `/hike/travel/ali-grand-loop-lhasa-return-2026/` 的 LCP 在 1.19 s ↔ 2.66 s 之间跳。
这轮先量它为什么：

| 观测 | 数字 |
|---|---|
| 该页 HTML | **309 KB**（内联 CSS 140 KB） |
| 全站中位页面 | **182 KB**（内联 CSS 92 KB 是常数） |
| 1.6 Mbps / 150 ms RTT / 4× CPU 下 HTML 传输 | **485 ms**，Inter 字体 1317 ms 才到 |
| LCP 元素 | `<p class="rd-lead">`——**纯文本**，不是图 |
| 全站 >200 KB 的页面 | **242 / 1198**，最重 `/invest/digest/` **429 KB** |

第一次归因猜错了：我以为多出来的 47.5 KB 是 Leaflet 的 vendor CSS，把它改成动态 import
后发现页面 CSS 一点没变——那 238 条 `.leaflet-*` 规则是**我们自己**写的控件样式。
已回退（同时保留了原来的静态 import 与那条测试）。

真正的问题是这类"变重"没有任何反馈：不报错、不 404、门禁照绿。所以这轮加的是一条闸门，
而不是继续抠这一页：

- `scripts/lib/page-weight.mjs` — 预算 HTML 220 KB / 内联 CSS 120 KB；已有超标页进
  `scripts/page-weight-baseline.json`（22 条，每条带理由），**基线页面再长 10% 也要重新审**。
- `scripts/check-page-weight.mjs` — `--update-baseline` / `--json`；接进 `npm run gate`
  （在 build 之后）。
- `tests/page-weight.test.ts` — 7 条，包括"基线原值必须放行（否则闸门一上线就是红的）"
  "真实基线每条都有理由且确实超预算（没有白名单滥用）"。

下一步（待办，不是这轮）：把 92 KB 的全局内联 CSS 抽成外部文件能一次削掉所有页面的 90 KB，
但这与"关键 CSS 内联、避免多一次往返"的既有决策冲突，要单独评估。

### 那个红叉是我自己发的假警报（第 130 轮）

第 126 轮的修法在真实 CI 里得到确认：

| 页面 | 修前 | 修后 |
|---|---|---|
| `/hike/sample-route/` | 68 分 · **LCP 3.82 s** | 94 分 · **LCP 1.19 s** |
| `/about/` | 78 分 · LCP 2.11 s | 94 分 · LCP 1.23 s |

但翻 commit status 时又看到一个红叉：`perf/hike/travel/ali-grand-loop-lhasa-return-2026/`
= **failure**（71 分 · LCP 2.66 s）。同一份报告里 `lhci/url/...` 写的是
「Passed with 2 warning(s)」，`perf/audited` 是 success —— 三条状态互相矛盾。

查 `scripts/lighthouse-statuses.mjs`，原因很直白：

    const PERF_FAIL_BELOW = 0.8;
    state: perf >= PERF_FAIL_BELOW ? "success" : "failure"

而 `.lighthouserc.json` 里 `categories:performance` 是 **warn**（第 24 轮定的：分数会被
runner 负载带偏，84–99 之间跳，只该告警）。于是 71 分的页面在 commit 列表上挂红叉，
把后来的人（包括我）引去查一个不存在的失败。

改法：新增 `scripts/lighthouse-policy.mjs`，直接读 `.lighthouserc.json` 的断言，
**只有 error 级断言被违反才 failure**，warn 级写进描述（`· 告警 1`）。
完全拿不到分数仍记 failure —— 那不是"没超标"，是"没测到"。

`tests/lighthouse-policy.test.ts` 五条把策略绑到配置文件上：性能 warn 不挂红叉、
LCP > 3.5 s / CLS > 0.1 / a11y < 0.9 是硬拦、配置改了断言跟着变。

### 576 ms 是这台机器画不出来，不是用户等那么久（第 129 轮）

修掉「指针边界事件」后，相册页仍然是手机 576 ms。这轮把它拆干净：

| 观测 | 数字 | 说明 |
|---|---|---|
| 主线程 CPU 采样 | **idle 88–91%**，`TaskDuration` 仅 45 ms | 不是 JS 慢 |
| 样式/布局 | `RecalcStyle` 4 次 / 0 ms，`LayoutCount` 2 / 0 ms | 不是重排 |
| 该页空转帧间隔 | **~150 ms/帧**（同期 `/privacy/` rAF 0 ms） | 这页在这台机器上就是 6–7 fps |
| 第二次打开灯箱 | **16 ms** | 冷启动成本，一次性的 |
| `fade` → `zoom` | 576 → 576 ms | 与动画类型无关 |

也就是说：576 ms 里绝大部分是**首帧层光栅化**（这台无 GPU 的 headless 要画 390×844×2x
的全屏层，还要叠上 48 张图），用户真机上不会有这个量级。把它当成"产品慢"会引出错误的优化。

于是这轮改的是**度量本身**，不是页面：

1. `settle()`：每个动作前等 260 ms + 连续两帧 + 清空缓冲。之前只等 150 ms，
   上一步的关闭动画还没跑完，账全记到下一步头上（桌面点「喜欢」352 ms → 0 ms）。
2. `--repeat`（默认 3 轮）+ `scripts/lib/inp-aggregate.mjs`：每个动作报
   **首轮（冷启动）/ 最快 / 中位数**，判定看中位数；`skipped` 不参与评优。
3. 帧率基线归一化：先量 10 帧中位数，判定时扣掉超出 16 ms 的部分，并把原始值打出来。

最终读数（相册页手机）：`点开灯箱 首轮 576 / 最快 16 / 中位 16`——冷启动一次性成本，
不是持续卡顿。另外顺手给相册加了**首图预解码**（idle 时 `srcset` 预取 + `decode()`）。

### 探针把「指针被赶走」当成了用户的慢动作（第 128 轮）

第 127 轮把探针点错元素的问题修掉后，灯箱数字从 792 变成 760–832 ms —— 仍然不对。
把窗口内的条目全打出来才看清：

    max = 720 ms ← pointerout / pointerleave（各 3 条）

灯箱一打开，页面内容变了，浏览器给底下的图片补发 `pointerout`/`pointerleave`，
它们同样被 Event Timing 记录，`duration` 包含到下一帧的时间（灯箱淡入）。于是
**用户那一下 click（184 ms）被边界事件顶掉了**。INP 规范本来也只统计交互类事件。

修法：`drainEvents` 只保留 `pointerdown/pointerup/click/keydown/keyup/touchstart/touchend`
（`INTERACTION_EVENTS`）。修完后同一页面的数字：

| 视口 | 灯箱 | 喜欢按钮 | 说明 |
|---|---|---|---|
| 手机 390×844 DPR2 | **576 ms** | 344 ms | 仍超 200 ms 目标线 |
| 桌面 1280×900 | **296 ms** | **352 ms** | 点「喜欢」比开灯箱还慢 |

也就是说：相册页的"点完要等一下"是**真的**，但它不在灯箱上，而在整页的绘制开销
（48 张图 + 沉浸式暗色布局）。下一轮继续查这条线。

### 探针量的那个"慢图片"，其实根本没开灯箱（第 127 轮）

用 `npm run perf:inp` 打本地 dist，相册页报 `❌ 点开图片 792 ms`。查下去是两层问题叠在一起：

**第一层：探针点错了元素。** 选择器是 `[data-lightbox], .gallery img, #gallery-\* img, main img`，
相册页第一个命中的是**首图 hero**（不在 `<a>` 里），点它不会开灯箱 —— 那 792 ms
量的是一个不可点图片的绘制。上轮我说"预解码能把它从 184 降到 56 ms"，
其实那组数字来自我自己另写的脚本（点的是真灯箱），跟探针的 792 根本不是同一件事。

**第二层：判"没打开"判得太早。** 改点 `a[data-pswp-width]` 后先判 `.pswp` 是否存在，
但 PhotoSwipe 核心是动态 import，点完不立刻有 DOM → 误判成"没打开，跳过"，
而跳过项的 0 ms 又会被算成"最快动作"。现在 `waitForSelector(".pswp")` 最多等 5 s，
且 `skipped` 不参与最慢评选。

修完才是真数字：**手机视口下点开灯箱 760–832 ms**（预算 200 ms）。

## 顺带做的两件事

| 改动 | 效果 |
|---|---|
| `lightboxVariants()` + `data-pswp-srcset` | 灯箱按显示尺寸挑图：DPR 1 的手机取 720w（24 KB），DPR 3 取 1200w（130 KB），原来一律 1600w（603 KB）→ 字节降 4.6 倍 |
| `warmPhotoSwipe()` | 空闲（`requestIdleCallback`，2 s 上限）或指针/手指悬停时预热 PhotoSwipe 模块，首次点击不再等模块下载 |

INP 探针也接进了每周巡检（`site-audit.yml`，报告不挡发布）—— 此前这条链路只有本地手跑，
CI 里没有任何交互延迟指标。本地实测 `拖动地图 160 ms`、其余动作 16–96 ms。

### LCP 3.82 s 的那张图，是第三方瓦片（第 126 轮）

Lighthouse CI 近十次里挂了五次。逐 URL 分数（commit status 里能直接读）指出唯一硬失败：

    perf/hike/sample-route/   68 分 · LCP 3.82 s   ← 预算 3.5 s
    lhci/url/hike/sample-route/  Failed 1 assertion(s)

LCP 元素是 **Leaflet 的瓦片图**：地图一进视口就水合、拉 12 块 openstreetmap 瓦片，
首屏最大的那块图象变成第三方图片。为一张"可以点开"的地图让首屏等跨境瓦片，
既不划算，也每开一次页面就给 OSM 发一串请求。

改法：**默认画内联 SVG 轨迹，点「加载交互地图」才水合 Leaflet。**

| 文件 | 作用 |
|---|---|
| `src/lib/gpx-preview.ts`（新） | 纯函数：经纬度 → 等距圆柱投影 → SVG `path`（等比缩放，短边居中） |
| `src/components/GpxMap.tsx` | 未激活时渲染 SVG + 按钮；`active` 为真才 `import("leaflet")` 与 `tileLayer` |
| `scripts/inp-probe.mjs` | 先点按钮再找 `.leaflet-container`（否则探针永远看不到地图） |

本地实测（4× CPU 降速、412×823 视口）：首屏 **0 个瓦片请求、0 个 leaflet chunk**，
点击后 6 个瓦片 + `.leaflet-container` 挂载成功；LCP 从 `<IMG>`（瓦片）变成 `<H1>` 文本。

顺带修了按钮副文案在深色下 4.17:1 的对比度不达标（改成 `opacity-70` 跟随主色）。
`/hike/sample-route/` 也进了 a11y 抽查路径集（守住新的预览态 + 按钮）。

### 我加的巡检步骤，第一次运行就会挂（第 125 轮）

翻 Actions 历史时发现 `Full-site audit` **一次都没跑过**（今天 03:03 才加，等周四），
于是逐条本地复跑它的步骤 —— 发现自己昨天埋的雷：

    第 124 轮加的步骤：npm run check:a11y:sample
    这个脚本：node scripts/check-a11y.mjs --dist --sitemap=dist/sitemap.xml --sample=12
    但 site-audit 从不构建 dist（它查的就是线上那份）→ 缺 dist/sitemap.xml → exit 2

也就是说这条巡检第一次运行（下周四 09:00）会直接失败，而且**要等一周才发现**。

修法：步骤改成打线上 + 用上面 `curl` 下来的线上 sitemap：

    node scripts/check-a11y.mjs --sitemap=/tmp/sitemap.xml --sample=12 --seed=$(date -u +%G-W%V)

顺带给 `check-a11y.mjs` 加 `--dry-run`：只抽样不加载页面，秒验抽样是否正常
（原来验一次要跑 24 次页面加载 ≈ 2 分钟）。

`tests/site-audit-a11y.test.ts` 四条盯住这件事：步骤不许出现 `--dist`、必须用线上 sitemap、
seed 必须按 ISO 周变化、以及"巡检确实没构建 dist"这个前提本身（将来若开始构建，测试该重写）。
变异验证：把 `--dist` 加回步骤 → 测试立刻红；删掉 → 绿。

顺手复核了其余步骤的退出码：`check-freshness` 0、`check-i18n-leaks` 0、`check-deps` 0、
`check-market-data-age` 1（预期，BLS 与美股兜底仍是 101 天）。

### 手工清单挑不完 1188 个页面，那就从 sitemap 抽样（第 124 轮）

第 123 轮往 23 条手写路径里加了三条，立刻抓到两个真 bug。这说明问题不在"有没有 bug"，
而在**没看的地方不知道**：1188 个 URL 靠人挑 26 个，剩下 809 个模板实例没人看过。

新增 `scripts/lib/a11y-sample.mjs` + `--sample=N`：从 `dist/sitemap.xml` **分节确定性抽样**。

| 要求 | 做法 |
|---|---|
| 失败可复现 | `seed` 决定顺序（FNV-1a 哈希排序），同一 seed 永远同一批页 |
| 扫得到新页 | 每周换 seed（`--seed=$(date -u +%G-W%V)`），下周自动换一批 |
| 模板都要覆盖 | 按**模板类型**分节（`ai` / `invest` / `photo` / `hike` / `en/*` / `static`），节间轮转取 |
| 名额不被小页吃光 | 第一版按路径第一段分组，`/privacy/`、`/terms/`、`/contact/` 各占一席，12 个名额被静态页吃掉一半 —— 改成把小静态页合并为 `static` 一节 |

抽样跑了 4 个 seed（W45/W46/W47/W49，每个 24 次检查）：**全部 0 失败 0 警告**。
接进每周巡检 `site-audit.yml`（不进阻塞门禁：它依赖 dist 且随机，红了应该看而不是拦合并）。

`tests/a11y-sample.test.ts` 七条：解析去 origin、分节按模板、同 seed 稳定、异 seed 换页、
模板覆盖 ≥4 节且不重复、名额超额不死循环、打散不丢元素。

### 抽查范围之外的三类页面，各有一个真 bug（第 123 轮）

a11y 抽查一直只有 23 条路径，`/now/`、`/guestbook/`、机翻英文页从没进去过。
把它们加进路径集后，第一次跑就抓到两个真问题：

| 页面 | 问题 | 原因 |
|---|---|---|
| `/now/` | `Document has more than one main landmark`（light/dark 都报） | 页面自己又写了一个 `<main>`，嵌在 BaseLayout 的 `<main id="main-content">` 里 |
| `/guestbook/` | 三个输入框「键盘焦点没有可见指示」 | 用 `focus:outline-none` 抹掉焦点环，只留 `focus:border-blue-500` 的边框变色 |

修法：`/now/` 的内层 `<main>` 改成 `<div>`（地标由布局提供）；
留言板的三个控件换成 `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2`。

顺带修了**检查器自己的盲区**：判定"焦点环隐形"时只看 `outline-*`，而 Tailwind 的 `ring-*` 是
`box-shadow` —— 用它做焦点环的控件会被误判。现在两者都认。

`tests/a11y-paths.test.ts` 盯住四件事：三条路径不许被移出抽查集、`/now/` 不许再有 `<main>`、
留言板不许再出现 `focus:outline-none`、检查器必须认 box-shadow。

抽查集从 23 条 → **26 条**（52 次检查，light+dark），全绿。

### 欠账清单自己会长歪，所以让测试盯着它的数字（第 122 轮）

到这一轮，仓库里已经积累了七项"确认过、但修不掉/轮不到修"的欠账：英文页的中文残留、
38 期日报缺摘要、BLS 宏观停更、美股兜底快照陈旧、Node 版本、nginx 加固、行情接口冷启动。

它们散落在十几轮的 `architecture.md` 里，新接手的人（或者三周后的我）根本拼不出来。
于是新建 `docs/known-debt.md`：一条一行，写清**当前数字、影响面、归属、检查命令**。

难点不是写文档，是**防止它变成装饰品**。所以配了 `tests/known-debt.test.ts`：

| 断言 | 对的是什么 |
|---|---|
| 文档里的「20 个文件 / 115 处」 | `scripts/i18n-leaks-baseline.json` 的真实内容 |
| 文档里的「38 期 / 299 条」 | 现场扫 `src/content/**/digest-*.zh.mdx` 数出来 |
| 文档里"过旧的快照只有 BLS 和美股兜底" | `check-market-data-age` 的实测结果 |
| 修好的欠账不许留在表里 | 反向断言（占位符、搜索索引这类已修项） |

顺带跑了三个"不在门禁里"的检查确认没有漂移：`check:interactions` 19/19 通过、
`check:deps` 2 条公告均已评估、`check:freshness` 三条流水线全绿。

### 英文页里整段整段的中文（第 121 轮）

扫描 `dist/en/**/*.html` 里"连续 20 个以上汉字"的片段，发现 **30 个英文页**里夹着中文正文：

    /en/invest/market-recap-2026-11-13/
    > 微软正加紧修复故障、恢复各项服务。此次全球性宕机事件扰乱了众多企业与政府机构的运转…

按内容文件统计是 **20 个 `.en.mdx`、115 处**（60 段中文引用 + 55 条中文链接标题，集中在 10 月的
`market-recap-*`）。翻译链路只翻了标题、表格和首页摘要，引用段落和部分链接标题原样留中文。

处理方式分两层：

| 层 | 做法 |
|---|---|
| 读者可见 | `/en/{ai,invest}/*` 顶部出现说明：「This page is machine-translated. N quoted source excerpts and N headlines below remain in the original Chinese — the Chinese version has the full text.」 |
| 防止变多 | 新增 `scripts/check-i18n-leaks.mjs`，把**现存欠账**写进 `scripts/i18n-leaks-baseline.json`（20 文件 / 115 处），之后新增残留直接失败；进 gate，同时进每周巡检 |

阈值取 **15 个汉字/行**：低于这个数多是专名或"见中文版"这类引用，不算读者读不懂的整段。
中文**标题**单独归类为 `headings`（原始标题通常该保留），不触发提示。

变异验证：往 `ai/digest-2026-11-21.en.mdx` 正文末尾加一段中文引用 → 脚本退出码 1，
报 `ai/digest-2026-11-21.en.mdx：1 处（baseline 允许 0）`；删掉后退出码 0。

**真正的修法在服务端**：`market-recap` 的英文版是 stock_pusher 生成的，得让它把引用段落也翻了，
或者干脆不产出英文版。这里的 baseline 只是把欠账冻住、不再恶化。

### 英文页一直在公开道歉，而门禁是绿的（第 120 轮续）

第 115 轮清理中文日报里的「（LLM 摘要失败，请稍后手动补充）」时，检查器只认**中文句式**。
上线后核对 `/en/ai/digest-2026-10-12/` 才发现：英文版还在正文里写着

    (LLM summarization failed, please manually add it later)

翻译链路把这句直译过去了，而且拼法有十几种（`LLM summary failed` / `LLM summarization failed` /
`please supplement manually later` / `please add the summary manually later` …）。共 **38 个
`.en.mdx`、299 行**，`/en/` 每个受影响的日报页都能看到。

三处修：

| 位置 | 改法 |
|---|---|
| `check-digest-placeholders.mjs` | 加 `PLACEHOLDER_REGEXES`，覆盖英文的十几种拼法；`--all` 盘点立刻报 38 个文件 |
| `scripts/strip-digest-apologies.mjs` | 中英通用的清理脚本（`APOLOGY_LINE` 一行正则、`--dry-run`、幂等），清掉 38 文件 299 行 |
| `digest-coverage.ts` | `NOT_PROSE` 加上 `(` / `（` —— 道歉句是括号说明，之前被算成"有摘要"，这正是英文页没出提示的原因 |

验证：`/en/ai/digest-2026-10-12/` 里道歉句 **0 处**，并且出现
"No summaries were generated for these 20 items"。

**教训写进规则**：清洗类脚本的"要删什么"必须中英都覆盖 —— 只修一半比不修更糟，
因为门禁会绿，人就不会再去看。

### 20 期日报说"AI 摘要"，其实一条摘要都没有（第 120 轮）

第 115 轮删掉了正文里的道歉句「（LLM 摘要失败，请稍后手动补充）」，但那批文章的**摘要本身还是空的**。
按条目数了一遍：

| 形态 | 期数（中文） |
|---|---|
| 全部条目无摘要正文 | **20** |
| 部分条目无摘要 | 18 |
| 完整 | 340 |

问题是这些文件的 frontmatter 都写着 `description: "20 篇论文 · 多源聚合 + AI 摘要"`，而 RSS/Atom 的
`<summary>` 直接复述这个字段。读者从阅读器点进来，看到一串论文标题 —— 描述却保证有摘要。

三处一起改：

1. **`src/lib/digest-coverage.ts`**：`digestCoverage(body)` 数出"条目数 / 有正文的条目数"；
   `coverageNotice()` 生成一句实话（"本期 20 条都没有生成摘要（自动摘要当时失败了），下面只列出
   标题、来源与原文链接"），完整时不返回任何东西（别给 358 页都加噪音）。
2. **四个日报模板**（zh/en × ai/invest）在正文顶部渲染这句提示。
3. **`atom.xml.ts` / `rss.xml.ts`**：日报的 `<summary>` 改用 `digestDescription()` 从**真实条目标题**拼，
   与页面 meta description 同一份口径；普通文章仍用 frontmatter。

验证：`dist/atom.xml` 与 `dist/rss.xml` 里「AI 摘要」出现次数 **0**；日报 summary 变成
「12 篇论文：Combatting adversarial distillati…；Hebbia sees improvements…」。
`/ai/digest-2026-10-12/` 有提示，`/ai/digest-2026-11-21/` 没有。

**剩下的真问题是内容本身**：这 20 期摘要需要重新生成，而生成要 LLM key（本机没有），
只能在 Actions 里 `--force` 重跑。页面现在不会骗人，但也不会凭空长出摘要。

### ETF 的"信号"可能是上周的（第 119 轮）

`/invest/etf/` 页头写着「分析日 2026-11-20」，但不写**距今几天**。ETF 三因子分析只在交易日跑
（15:15 早盘版 → 19:30 份额补全），夜间流水线一断，页面上的信号就会一直是旧交易日的，
却看不出来 —— 和 `/invest/us-market/` 的 101 天宏观块是同一类静默故障。

改法沿用第 116–117 轮的口径，顺手把看门狗补全成第三类数据：

| 位置 | 改法 |
|---|---|
| `/invest/etf/` | `分析日 2026-11-20（昨天）`；超过 **5 天**出琥珀横幅"夜间流水线可能断了" |
| `check-market-data-age.mjs` | 新增 `ETF 三因子分析` 行（读 `target_date`），并支持**每行自定义阈值** |
| `beijingDateMs()` | 只有日期的字段按北京时间零点解释（`Date.parse("2026-11-20")` 会被当成 UTC 零点） |

阈值为什么是 5 天而不是 7 天：ETF 只在**交易日**产出，周五的分析到周日晚上也只差 2 天，
周一开盘前差 3 天，都是正常的；5 天能容忍一个长周末加一天延迟，再长就真是断了。

`tests/market-data-age.test.ts` 补四条：周末不断更不误报、连续 6 天判旧、
每行阈值能覆盖全局默认、以及"页面真的把天数显示出来了（不是算了不用）"。

顺带修了 `ageRows()` 的一个易用性坑：它只接受 `at: (file) => ms`，测试里手写毫秒数会
`TypeError: at is not a function`。现在两者都接受。

### 搜索探针只问"有结果吗"，所以索引坏了它也不知道（第 118 轮）

`check:search:dist` 一直只判断两件事：查询有没有报错、有没有结果。这两件都对，搜索仍然可能
对用户是坏的，而且是**两种不同的坏**：

| 症状 | 用户看到 | 原探针 |
|---|---|---|
| Pagefind 在 build 之后被跳过 | 页面能开，搜昨天的日报搜不到 | 通过（其他词有结果） |
| 索引里残留已删页面的 URL | 搜索结果点进去 404 | 通过（查询本身没报错） |

补两条断言：

1. **索引新鲜度**：从 `src/content/{ai,invest}` 找最新日报，用**它自己的 frontmatter 标题**当查询词，
   要求它排进前 3 名（实测两个都是第 1 名）。
2. **命中活链接**：把"各查询前 3 名 + 最新日报"去重后抽 24 条，逐个 HTTP GET，非 200 就算坏。

这两个断言都做了**变异验证**，因为第一版写完是假绿的：

- 删掉 `dist/ai/digest-2026-11-21/index.html` 后，检查仍然通过 —— 原因是采样用的是
  `flatMap(top).slice(0,12)`，前 12 条全落在前几个通用查询上，最新日报排不上号。
  改成"各查询前 3 名 + 最新日报本身"后，同样操作立刻报 `搜索命中是死链：/ai/digest-2026-11-21/`，
  退出码 1；还原后退出码 0。
- 标题第一版是抓页面 `<title>` 再切掉站名后缀，结果切成"AI 每日精选"这种通用词，排不到前 3，
  假红。改成直接读 MDX frontmatter 的 `title`。

`tests/search-freshness.test.ts` 六条纯逻辑：命中名次、完全搜不到、死链挑拣、最新日期提取
（不把 weekly/随笔算进来）、以及"索引旧或命中死链都要判 ok=false"。

### 数据"旧"不是错误，所以没人会发现（第 117 轮）

第 116 轮把"多久以前"做成了 `describeSnapshot()`，这轮把它推广成**全站口径**：

| 位置 | 改法 |
|---|---|
| `/invest/market/`、`/invest/hk-market/` | 时间行从 `2026/11/20 16:30` 变成 `2026/11/20 16:30（昨天）`；超过 7 天出琥珀色横幅"快照已经 N 天没更新（自动更新可能断了）" |
| `src/lib/snapshot-age.ts` | 新增 `describeIsoSnapshot()`，服务端 ISO 字符串也走同一套判定 |
| `scripts/check-market-data-age.mjs` | 盯四份快照（A 股 / 港股 / 美股兜底 / BLS 宏观），阈值 7 天，只读文件不联网 |
| `site-audit.yml` | 每周巡检加一步；**故意不进阻塞门禁** —— 它现在就是红的（BLS 宏观 101 天），而那是服务端的事 |

设计判断：**为什么不做成阻塞门禁**。这份检查一旦进 gate，后端宏观抓取一坏就会天天卡住部署 ——
而"站点照常发布、数字标注清楚它们很旧"明显比"什么都发不出去"更可取。所以它属于
**可见的告警**（周巡检红 + 页面横幅），不属于**发布闸门**。

`tests/market-data-age.test.ts` 六条，其中两条是防"静默失效"的：
- 读不出时间字段必须判**旧**（无法证明它新鲜，就不能放过）；
- 真实四份快照都断言能读出时间 —— 以后谁改了字段名，测试立刻红，而不是看门狗永远绿。

### 「当前使用最近一次成功缓存」= 101 天前的数据（第 116 轮）

`/invest/us-market/` 页脚原来只写一句"当前使用最近一次成功缓存"。核数据时发现这份缓存是
**2026-08-11** 的 —— 距今 101 天，而且 BLS 宏观块（CPI / 核心 CPI / 非农 / 失业率）停在 5 个月前的
`2026-06` 参考期。也就是说，页面上那些数字是"今年 6 月的通胀"，但文案读起来像"几分钟前的缓存"。

金融页面上，**旧数字冒充当前数字比没有数字更糟**。改法：

| 位置 | 改法 |
|---|---|
| 新增 `src/lib/snapshot-age.ts` | `describeSnapshot(ts, now)` → `{ text, days, severe }`，输出"08-11 22:00（101 天前）"，跨年才写年份 |
| 行情时间行 | `formatQuoteTime` 改用它，不再只写"08/11 22:00"（没有年、没有天数） |
| 页脚 | 行情陈旧 → "行情为 08-11 22:00（101 天前）的缓存快照，不是当前行情"；宏观陈旧 → "宏观数据自 … 起未更新，CPI/非农的参考期可能已过时" |

顺手修掉一个误报：判断"行情是否陈旧"原来用的是**聚合**的 `data.stale`，而后端的聚合 stale 只要
宏观旧就会是 true —— 于是行情明明新鲜也会被告知"是缓存"。改成只看 `market.stale`。
两种分支都用真实 payload 起本地服务验过（拦 `**/api/market/us`）：

- 接口给新鲜行情 + 宏观仍旧 → 只出宏观提示；
- 接口给的行情也旧 → 两条提示都出。

`tests/snapshot-age.test.ts` 七条：101 天/2 天、跨年写年份、空值不崩、未来时间不算负数天、
阈值可调、`humanAge` 不出现"0 天前"。

**待你判断的**：BLS 宏观接口自 2026-08-11 起就没更新过（这是服务端抓取的事，静态站改不了）。
页面现在会诚实说明它旧了，但数字要变新得修后端那个 fetcher。

### 看门狗有三个洞：漏盯投资收益日报、放行单语日、还亲自写道歉句（第 115 轮）

把"内容健康度"当一条链路重新过了一遍，发现三处：

| 洞 | 现象 | 后果 |
|---|---|---|
| 漏盯一条流水线 | `check-freshness` 只盯 `ai/digest-*` 和 `invest/market-recap-*` | **投资日报（`invest/digest-*`）停更从来不会被发现**，244 篇里有 122 天属于盲区 |
| 放行单语日 | 只看"最新一篇的日期" | 今天有中文、英文没翻出来 → 判 ✅，但站点上就是两条 `/en/...` 死链，部署门禁红 |
| 自己写道歉句 | 摘要失败时把「（LLM 摘要失败，请稍后手动补充）」写进正文 | 读者点开看到的是"这站坏了"；线上已累积 40 篇 |

三处一起修：

1. `STREAMS` 拆成三条（AI 日报 / 投资日报 / 投资复盘），`pattern` 加 `(zh|en)` 捕获组；
2. 新增 `bilingualGaps()`：窗口内只有单一语言的日子算失败，理由写清"缺 en 版会让站内出现死链"；
3. `summarizeSafe()` 失败时返回**空字符串**，渲染层跳过空段落 —— 这一条只给标题+来源+链接，
   不假装有摘要。历史上那 41 个文件用一次性脚本删掉道歉句（幂等，只删那一行）。

测试从"两条流水线"改成三条，并补了三条回归：
- 投资日报落后 5 天必须 fail（第 115 轮前的盲区）；
- 日期新鲜但缺英文必须 fail，且 `formatFreshness` 输出里能看到"缺 en"；
- 生成器源码的**代码行**（排除注释）里不许再出现道歉句。

顺带确认全站 a11y：`check-a11y.mjs` 默认 23 条路径 × 明暗 = 46 次检查，0 失败 0 警告。

### 补跑成功了，但站点没变：GITHUB_TOKEN 推的 commit 不触发 workflow（第 114 轮续）

第二次补跑终于产出干净内容 —— 中英成对的 `digest-2026-11-21.{zh,en}.mdx` 共 4 个文件，
占位符 0，封面中英一致，门禁 491 项全绿。但 `deploy-meta.json` 里的 sha 一直停在旧的，
翻了 runs 列表才发现：**根本没有 `6def5676` 这个 commit 的 Build & Deploy 运行**。

原因是个老坑：**用 `GITHUB_TOKEN` 推的 commit 不会触发任何 workflow**（GitHub 防递归规则）。
于是补跑把内容写进了仓库，站点却永远不会自己更新 —— 除非恰好有人（或定时任务）再推一次。
`workflow_dispatch` / `repository_dispatch` 是这个规则的例外，可以显式发起。

| 改动 | 内容 |
|---|---|
| 补跑 job | push 成功后调用 `gh api .../actions/workflows/deploy.yml/dispatches -f ref=main` |
| 权限 | 该 job 加 `actions: write`（dispatch 需要） |
| 失败兜底 | dispatch 失败时打 `::warning::`：内容已进仓库，但要等下次 push 或 15:30 定时部署才生效 |
| 测试 | 断言 run 脚本里有 `dispatches`、job 有 `actions: write` |

这条值得记住的不是"补跑又能用了"，而是 **一条自动化链路里最隐蔽的失败模式：每一步都报成功**。
commit 成功、gate 绿色、job 绿勾，唯独"部署"这一环因为权限模型的隐式规则跳过了。
所以现在的成功判据不是"job 是绿的"，而是"`deploy-meta.json` 的 sha 变成新 commit"。

### 补跑差点把部署拖成超时（第 114 轮）

第 113 轮把补跑塞在部署 job 的最后一步，当时只想到"失败别影响部署结论"，漏算了一件事：
**部署 job 有 30 分钟硬上限**（第 46 行，为跨境 rsync 215MB 定的），而补跑要抓源 ~17 分钟
再翻译 —— 一旦内容真的停更，这次 run 就会在"站点已经更新完"之后被 cancel，跑成一条红叉。
更糟的是它会触发"Diagnose failed step"，把失败归因到某个无辜的步骤上。

所以拆成独立 job：

| 项 | 部署 job | 补跑 job |
|---|---|---|
| `timeout-minutes` | 30（不变） | 30（自己的预算） |
| 触发条件 | push / schedule / workflow_call | `needs: build-and-deploy` + `success()` + push/schedule |
| 失败影响 | 整条 run 红 | 只有这个 job 黄，`continue-on-error: true` |
| 权限 | contents: write + statuses: write | 同（要 commit/push） |

两条命互不影响：部署照旧 12 分钟内结束，补跑慢就慢在它自己那条上。

拆 job 时踩到的坑也记一下：手工改 YAML 缩进，把 `- name:` 后面的注释和键错位了一格，
`yaml.parse` 直接 `BAD_INDENT` 报错 —— 这正好说明为什么 `tests/deploy-self-heal.test.ts`
里要用 `parse()` 真解析一遍工作流，而不是 grep 文本。测试也跟着从"在 build-and-deploy
里找步骤"改成"找 catch-up-digest job"，并补了一条断言：**部署 job 的 30 分钟预算不许悄悄变大**，
否则"补跑能不能塞回去"这个判断就失效了。

### 自愈第一次跑就翻车：单语内容 + 占位符（第 113 轮续）

补跑上线后的**第一次部署**就生效了：远端出现 `12ffcd64 content: catch up a missed digest run`，
`digest-2026-11-21.zh.mdx` 自动生成 —— 用户没有点任何按钮，三天的内容缺口被填上。
但这次实战也暴露了两个问题，都是我自己加的东西带来的：

| 问题 | 现象 | 原因 | 处理 |
|---|---|---|---|
| 只生成了中文 | 门禁 `check:links` 红：`/en/invest/digest-2026-11-21/` 等 2 条死链 | 补跑只跑 `digest-fetch`，没跑 `translate-digest` | 补跑加翻译步骤，并加"中英必须成对"闸，不成对整体回滚 |
| 正文里有占位符 | 一条写着「（LLM 摘要失败，请稍后手动补充）」 | `assertSummaryHealth` 阈值是失败 >30% 才不出稿，1/12=8% 照发 | 新增 `check:digest-placeholders.mjs`，补跑招不到干净内容就回滚；门禁也加了 `check:digest-quality` |

顺带盘点了历史：**40 篇日报带占位符**（2026-11-10 至 11-21）。已把被误发的两篇半成品删掉，
内容回到"宁缺勿滥"，等下一次补跑（会带翻译）产出成对且干净的稿子。

一个有价值的副产品：`docs/operations.md` 的门禁表守卫（第 100 轮）立刻拦住新增的
`check:digest-quality` 步骤 —— "门禁加了步骤但没人写进速查页"这种漂移，现在会自动红。

### 部署自己会补上停更的内容了（第 113 轮）

事实先摆着：本仓库 `schedule` 实测延迟 5–7.5 小时，**还出现过整天不触发**；2026-11-19 起
AI 日报连续三天没产出，而站点照常构建、门禁全绿、巡检 0 失败 —— 因为"少一篇文章"不是错误。
第 78 轮加了 `check-freshness` 看门狗，第 106 轮加了备用 cron，但看门狗只会**喊**，
喊了没人看等于没有。

所以这轮把「发现 + 补一次」挂进**每次部署的末尾**：

| 设计点 | 做法 | 为什么 |
|---|---|---|
| 位置 | 验收之后的最后一步 | 补跑失败不能把一次成功的部署判成红 |
| 触发 | 只在 `push` / `schedule` | 被 `daily-digest` 调用时不递归补跑 |
| 判定 | 复用 `check-freshness.mjs --max-age=2` | 不另写一套"什么算停更" |
| 产出 | `digest-fetch.ts both`（第 106 轮已幂等） | 重复触发不烧 LLM |
| 提交 | 只 `git add src/content`，`diff --cached --quiet` 判定空产出 | 不制造空提交、不带入工作区其它改动 |
| 失败 | 整步 `continue-on-error: true`，`::warning::` 留痕 | 缺 LLM key 时安静跳过 |

配套：`deploy.yml` 的 `permissions` 从 `contents: read` 提到 `write`（要 push 内容）。
这正好落在第 107 轮那条规则上 —— **reusable workflow 不能申请比调用方更大的权限** ——
所以三个调用方（`daily-digest` / `weekly-roundup` / `bulk-backfill`）本来就有 `contents: write`，
测试里也顺带断言了这一点，免得以后改出"启动阶段就死"。

`tests/deploy-self-heal.test.ts` 六条断言：步骤存在且 `continue-on-error`、排在验收之后、
只在 push/schedule 触发、只用 `git add src/content`、权限够、以及三个调用方权限覆盖。

### 「我的数据」页在 sitemap 里，却没 noindex（第 112 轮）

顺手核了一遍爬虫视角：`robots.txt` 挡了 `/admin/`、`/api/`，`/search/` 也不在 sitemap 里，
但 `/data/`（"我的数据"：按 IP+UA 指纹展示**你自己**的浏览记录、留言、订阅，并支持一键删除）
两样都漏了 —— 它既在 `sitemap.xml` 里（中英各一条），又没有任何 `robots` meta。

后果不大但确实不对：搜索引擎被叫来爬一个"只对当前访客有意义"的工具页，拿到的永远是空壳，
白烧爬取预算；而且它属于个人数据页，不该进索引。

| 改动 | 内容 |
|---|---|
| `data.astro` / `en/data.astro` | 加 `noindex`（`BaseLayout` 已有该 prop，后台页在用） |
| `src/lib/sitemap.ts` | 中英静态路径表里移除 `/data`，并写清原因 |
| `scripts/check-seo.mjs` | **新增站点级规则**：sitemap 里列出的页面不允许是 noindex |

最后那条才是重点。这类错两边各自看都没毛病（页面 noindex 正确、sitemap 生成成功），
只有对起来才暴露，所以做成自动检查比记住它可靠。变异验证：把 `/data` 塞回 sitemap，
`check:seo` 立刻失败并指名：

```
· sitemap 列了 noindex 页面：https://www.zorotreeking.online/data/（应从 sitemap 移除）
[seo] 0 页有错误 / 0 页只有告警 · 另有 1 个站点级问题 → 失败
```

顺带确认：sitemap 从 1186 条降到 1184 条，其余页面可见文字都在 600–1900 字符以上，
没有其他"薄页面"混在索引里。

### 680 篇日报只用了 13 张封面，其中 630 篇是同一张图（第 111 轮）

看归档页源码时发现一件荒唐事：`/invest/digest/` 的卡片封面写着
`cover: "/photos/uploads/baokemeng/baokemeng-47.og.jpg"` —— 昨天的投资日报配了张宝可梦照片。
进一步统计：

| 指标 | 改前 | 改后 |
|---|---|---|
| 不同封面 | 13 张 | 40 张 |
| 单张最多被用 | 315 次（占 42%） | 20 次（占 5.3%） |
| 归档页首屏 | `-47, -03, -02, -01` 连号 | 打散 |

根因不是"选图算法随机性差"，而是**选图发生在生成时刻**：`pickCoverFromLibrary(date)` 按
"当前的相册池"取模。池子最初只有 2 张（hudieren），后来补齐到 40 张（baokemeng），于是
**先写出来的 630 篇永远锁在那 2 张图上**，新写的才用得上新池子。

修法两件：

1. `pickIndex()` 改成 `天数 × 互质步长 % 池子`：确定性（同一天永远同一张）、铺满（40 天走完
   池子一圈）、相邻不撞。直接 `天数 % 池子` 也能铺满，但归档页会按文件名顺序一张张往下排，
   看着像系统生成；互质步长把顺序打散了。横版阈值从 ≥1.2 放宽到 ≥1.0（卡片本来 object-cover 裁切）。
2. `scripts/backfill-digest-covers.ts` 重铺历史：752 个文件（中英双版，同一篇必须同封面），
   只改 `cover:` 一行，幂等（复跑 0 处改动）。同时 `scripts/cover-variants.mjs` 补齐新封面的
   640/960 变体（80 个）。

守卫：`tests/digest-covers.test.ts` 里有一条**归档级断言** —— 任何一张封面被复用的比例不得超过
8%。这条比单测重要：以后池子缩小、或有人改回哈希取模，它会立刻出来拦。

### /now 停更了四个半月，却还在用"此时此刻"的语气（第 110 轮）

线上实测 `/now`：页面写着「最后更新 · 2026-07-07」，而当天是 11-21 —— **137 天**没动过，
正文却仍然是"记录此时此刻手头的事和关注的事"。这是最容易被忽略的一类腐烂：页面不报错、
不空白，只是**在说谎**。

我没有替主人编新近况（那是编造），做的是让页面自己承认过期 + 给一块不会过期的真实内容：

| 改动 | 效果 |
|---|---|
| 超过 45 天显示琥珀色提示 | "这一页已经 137 天没更新了 —— 下面是人写的旧近况，不是今天的状态" |
| 头部显示"N 天前" | 读者不用自己算日期 |
| 新增「最近 30 天的改动 · 自动生成」 | 来自 git 历史（复用第 109 轮的可见性规则），人写的那部分会旧，这块不会 |
| 明确标注自动生成 | 两块语气分开，读者分得清哪部分在装活人 |

规则在 `src/lib/now.ts`（`nowStaleness` / `recentChanges`，5 条单测：137 天、恰好 45 天不报警、
46 天报警、未来日期不出负数、窗口与可见性过滤）。

顺带用一条测试守住了"构建环境真能读到 git 历史"（`readGitLog().length > 100`）——
否则自动生成那块会静默变空，而页面看起来仍然"正常"，又是一次沉默退化。

### 公开的更新日志曾是一份内部提交流水账（第 109 轮）

`/changelog` 的设计意图写在页头：「站点功能、性能、SEO 与无障碍改动的完整记录」。线上实测
却发现里面混着 `test catch workflows that die before job 1`、`ops probe the whole /api surface`
这类只有维护者在乎、而且是英文的条目，徽章上还挂着没翻译的 `test` / `ops`。

根因一行就够：

```ts
const cfg = TYPE_LABEL[c.type] ?? { label: c.type, color: "#71717a", show: true };
//                                          ^^^^^^^^^ 没登记的 type 默认显示
```

于是**每新增一种提交前缀就自动泄漏一次**（`test`、`ci`、`ops`、`build`…），而没人会去翻这页。

修法是把默认反过来 —— 白名单比黑名单安全：

| | 旧 | 新 |
|---|---|---|
| 展示判定 | `TYPE_LABEL[type]?.show ?? true` | `TYPE_STYLES[type]?.show ?? **false**` |
| 展示类型 | 除 chore/auto 外全部 | feat/fix/perf/style/a11y/seo/i18n/content/docs |
| 未登记前缀 | 显示（且徽章是原文） | 隐藏 |
| 隐藏条数说明 | "隐藏了 N 条 cron 自动提交" | "只保留读者会在意的改动；另外隐藏了 N 条自动化产出与内部工程提交" |

规则抽到 `src/lib/changelog.ts`（`isVisible` / `buildChangelog` / `parseGitLog`，5 条单测）。
重建后可见条目 315 条、覆盖 7 个月，页面上再没有任何 `test`/`ops` 原始徽章。

顺带确认了一件之前没验过的事：部署时 `git log` 能拿到**完整历史**（页面显示 7 个月、隐藏 2147 条），
说明 checkout 不是浅克隆 —— 否则这页只会剩一条。

### 让"启动阶段就死"和"步骤永远被跳过"都能静态查出来（第 108 轮）

第 107 轮证明了 `startup_failure` 的可怕：整条运行 1 秒钟结束、没有日志、内容静默停更三天。
顺着这条线把**同一类错误**一次查完 —— 它们的共同点是"不报错，只是不工作"：

| 错误类型 | 后果 | 症状 |
|---|---|---|
| `needs:` 指向不存在的 job | 工作流非法，**整条不启动** | `startup_failure`，无日志 |
| `steps.<id>.outputs` 引用了不存在的 id | 表达式永远为空字符串 | 下游步骤拿到空值，行为诡异 |
| `github.event.inputs.X` 未声明 | 永远为 `null` | `if: … == 'true'` 的步骤**静默跳过** |
| `npm run <script>` 但脚本不存在 | 步骤失败 | 至少会红，但也算低级错 |

`tests/workflow-reference-integrity.test.ts` 四条断言覆盖这四类，全仓库 11 个工作流当前全部干净。

变异验证：把 `site-audit.yml` 的 `needs` 改成 `ghost-job`，测试立刻红
（`site-audit.yml::audit needs 不存在的 job "ghost-job"`）；把 `deadlink-check.yml` 的
`concurrency` 拼错成 `concurency`，第三类断言也立刻红。

这类检查的价值不在"现在有没有错"，而在**改错了推不上去**：当年那三天就是没人拦得住。

### 三天停更的根因，这轮才拿到铁证（第 107 轮）

第 82 轮猜"reusable workflow 的权限超过调用方"是 11-18～11-20 日报停更三天的原因，但一直没有
直接证据。这轮把当时那次失败运行的 `head_sha`（`2c9e4da4`）取出来，读它里面的两份工作流：

| 位置 | 当时的声明 |
|---|---|
| `deploy.yml`（被调用方） | `permissions: { contents: read, statuses: write }` |
| `daily-digest.yml`（调用方） | `permissions: { contents: write }` ← **没有 `statuses`** |

GitHub 的规则是：reusable workflow 的权限不得超过调用方。于是整条运行在**解析阶段**被拒，
一个 job 都不启动。证据链也对得上：那次 run 的 `created_at = 06:00:45Z`、`updated_at = 06:00:46Z`
—— 只差 1 秒，日志是空的，正是 `startup_failure` 的形态。

修法在第 82 轮已经上线（调用方补了 `statuses: write`）。这一轮补的是**让它不会再发生**：
`tests/reusable-workflow-permissions.test.ts` 静态校验全仓库每一处
`uses: ./.github/workflows/*.yml`，要求调用方权限逐项覆盖被调用方（`none < read < write`）。

变异验证：把 `daily-digest.yml` 的 `statuses: write` 删掉，测试立刻红并原文复述当年的事故：

```
daily-digest.yml::deploy → deploy.yml: statuses: 调用方是 none，被调用方要 write —— 运行会在启动阶段就失败
```

当前三处调用（`daily-digest` / `weekly-roundup` / `bulk-backfill`）全部满足。

### 日报流水线加了备用触发，且"跑两次等于跑一次"（第 106 轮）

已经发生过的事实：11-21 那天 `Daily digest` **整天没有触发**（GitHub 的 schedule 在本仓库
实测延迟 5–7.5 小时，这次干脆丢了），内容缺口从 19 号拉到 21 号。

两条改动：

| 改动 | 作用 |
|---|---|
| 备用 cron `47 21 * * *`（北京 05:47） | 主 cron（02:17）被丢掉时兜底，一天最多两次机会 |
| `digest-fetch.ts` 幂等早退 + `--force` | 重复触发**不抓源、不调 LLM**，直接退出 |

第二条是关键。原来 `writeIfNew()` 只挡住"写文件"，而抓取和逐条摘要**早就跑完了** ——
备用 cron 会白烧一整轮模型调用再去发现"文件已存在"。现在 `main()` 一进来就按**流**检查
当天产物（AI 有了、投资还没有时只补缺失的那一路），齐了就退。

验证：
- 单测用临时目录模拟"AI 已有 / 投资缺失"，确认只补缺失流、不全跳过；
- 在仓库里真跑了一次 `npx tsx scripts/digest-fetch.ts ai`（11-21 确实没有产物，所以没早退），
  抓到 3 条 arxiv + 2 条 OpenAI + 2 条 Anthropic 后**在摘要阶段被 `assertSummaryHealth` 拦下**，
  没有写出半成品 —— 这正好验证了"没 LLM key 时宁可不出稿也不发占位符"。
- 跑完 `git status` 干净，没有残留文件。

### 把"页面正常"和"接口正常"分开验（第 105 轮）

承接第 104 轮（点赞接口坏了很久没人发现），这轮把**整片 `/api/*` 扫了一遍**，
凡是前端有静默降级的都补上主动探针。

先盘清家底 —— `src/` 里一共用到 19 个接口路径：

| 类别 | 接口 | 处理 |
|---|---|---|
| 公开读（探） | `market/{etf,indices,sentiment,sectors,us,funds,stocks}`、`models`、`feedback(GET)` | 探针表校验 `ok:true` + 关键字段 |
| 后台读（守卫） | `admin/{stats,guestbook,etf-ops}` | 断言**不带 token 必须被拒** |
| POST 写（豁免） | `chat`、`chat/clear`、`track`、`rating`、`data/delete`、`admin/guestbook/mod`、`admin/etf-ops/repair/cache`、`feedback(POST)` | 登记在 `UNPROBED` 里写明理由（探测会改数据/花钱） |
| 用户自读（豁免） | `data/me` | 按指纹返回本人数据，是页面功能本身 |

落地成 `scripts/verify-api-surface.mjs`：12 条探针（9 条健康 + 3 条鉴权守卫），
`--base/--only/--json` 三个开关，部署验收里跑一次。

**这轮的教训来自我自己踩的坑**：探 `/api/market/stocks` 时按 `600519.SH` 传参，接口回
`ok:false, "tencent stock quotes empty"`，看着像后端挂了；其实它要 secid（`1.600519`），
传对立刻正常。所以参数格式也写进探针表，并有测试断言"不许写回 `600519.SH`"。

另一次误判：`r.jina.ai` 读 `/invest/` 看到「等待可用行情」，一度以为实时行情坏了 ——
其实那是水合前的 SSR 占位，reader 不执行 JS。**代理能证明"服务端吐了什么"，不能证明"浏览器里是什么"。**

鉴权守卫这条是白捡的安全网：如果哪天 `admin/*` 的鉴权被删，接口会返回 200 + 数据，
探针立刻红 —— 这比任何 code review 都可靠。

用本地桩服务把探针脚本自己也测了（`tests/api-surface-live.test.ts`）：桩件全绿 → 退出码 0；
任一条 `ok:false` → 退出码 1 且打印原因；后台接口返回数据 → 红并提示"可能在裸奔"。

### 一个坏了很久、但页面看起来正常的接口（第 104 轮）

排查待办清单时顺手复查了 `/api/feedback`（文章底部「N 人觉得有用」背后的接口）。
它在文档和代码注释里被记成"线上 GET 一直是 422"，但从第 83 轮起就没人再验过。

线上实测（`r.jina.ai` 代理，绕开本机 IP 被频控）：

| 请求 | 结果 |
|---|---|
| `GET /api/feedback?slug=item:test` | `{"likes":0,"dislikes":0,"my_vote":null}`（正常） |
| `GET /api/feedback?slug=<非法格式>` | `{"error":"invalid slug"}` |
| `GET /api/feedback`（缺 slug） | 422 + FastAPI 参数校验详情 |

结论：**接口已经正常了**，当初的 422 是 slug 处理的问题，后来被修掉了。三件事要跟着更正：

1. `docs/operations.md` 把这条从"要人决定的事"移进新的"已修复的历史问题"小节
   —— 留在待办里，会让人去修一个已经不存在的问题。
2. `src/lib/feedback-cache.ts` 的注释改成"坏过、现在正常"，但**保留降级路径**：
   后端再挂时按钮不能跟着一起死。
3. 部署验收加一条只读探针（`slug=item%3Adeploy-probe`），校验返回里有
   `likes/dislikes/my_vote` 三个字段。用探针 slug、只发 GET，不写任何投票数据。

这条真正值得记的不是"接口修好了"，而是**这类故障为什么能藏这么久**：
前端为了不让按钮点不动做了静默降级，于是接口 422 时页面完全正常、没有任何红点。
凡是"前端降级兜住 + 没有主动探针"的组合，都会长出这种沉默故障 —— 补探针才是根治。

### 「日报几点出」这句话在四个地方都写错了（第 103 轮）

第 96 轮把 digest 的 cron 从 `0 0 * * *` 改成 `17 18 * * *`，只改了工作流。于是仓库里还留着
四处假话：

| 位置 | 原文 |
|---|---|
| `README.md` | 「每日 08:00 北京时间」 |
| `docs/INVEST_WIND_INTEGRATION.md` | 「每天 08:00」 |
| `scripts/digest-fetch.ts` 注释 | 「CI：每天 08:00 北京（00:00 UTC）」 |
| `scripts/digest-fetch.ts` **生成的正文** | 「> 由 cron 每日 08:00 北京自动从…抓取」 |

第四处最糟：它不是注释，是**写进每一篇日报正文**的第一行 —— 改 cron 就会让新文章自带假信息。

两条修法：

1. 文档改成与 cron 一致的 `02:17`，并把「实测延迟 5–7.5 小时」写在旁边（否则下一个人还会
   以为 02:17 就能看到结果）。
2. 正文 blockquote **不再写任何钟点**（「由 cron 每日自动从…抓取」）。时间只存在于 cron 一处，
   改 cron 就不会再制造假话。清理脚本的正则同步放宽成 `^> 由 cron 每日[^\n]*`，旧措辞照样能匹配。

守卫 `tests/digest-schedule-truth.test.ts`：三份文件里不许出现「每日 08:00」、生成的 blockquote
不许含 `HH:MM`、README 和 `operations.md` 里的时间必须等于从 cron 换算出的北京时间。

顺带一个观察（不是 bug）：`freshness-watch.yml` 今天 08:43 才进 main，它的第一次定时触发是
今晚 20:23 UTC（明早 04:23 BJT），所以现在「0 次运行」是正常的，明天再验。

### 「部署成功」不等于「用户看到的是新页面」（第 102 轮）

第 101 轮验证线上修复时撞见一件事：`deploy-meta.json` 已经是新 sha，但首页 HTML 还是旧的
（那次是第三方代理缓存）。如果把同样的事搬到生产 nginx 上，后果是：

> 部署全绿 → 人打开站点看到的还是旧页面 → 「我改了怎么没生效？」

因为 `deploy-meta.json` 和首页 HTML 是**两个响应**，前者换新不证明后者换新。

补一条端到端断言：

| 环节 | 改动 |
|---|---|
| 构建 | `PUBLIC_BUILD_SHA=${{ github.sha }}` 注入 `<meta name="build" content="…">`（本地无该 env 时写 `local`） |
| 验收 | 部署激活后，用**禁用缓存**的请求打首页，断言 meta 等于本次 sha |
| 失败文案 | `stale HTML at the edge: build=… expected=…` —— 直接指向"边缘拿到旧 HTML" |

校验逻辑独立成 `scripts/check-build-stamp.mjs`（`extractBuildSha` 纯函数 + `--file` 本地模式），
所以能单测：匹配放行、不匹配 exit 1、没有标记也 exit 1（老产物不会被误判成"匹配"）。

顺带确认了一件事：本站 `inlineStylesheets: "always"`，CSS 全内联，HTML 里没有 `/_astro/*.css`
这类天然指纹 —— 所以必须自己塞一个构建标记，否则"HTML 是否最新"根本无法验证。

### 首页精选第一张卡曾经是五个月前的旧闻（第 101 轮）

拿到一条**从站外读线上**的通道（`r.jina.ai` 代理，本机 IP 被站点频控挡着）之后，
第一次真正看到了线上首页长什么样，立刻发现两处：

1. 「精选阅读」第一张卡是 **2026-06-29** 的自动股票日报，而当时站点已经有 11-20 的内容；
2. 「最近更新 6 条」里 5 条是每日复盘。

读代码定位到根因：`pickHero()` 的注释写的是"最近的原创长文"，实现却是
`sort((a, b) => b.body.length - a.body.length)` —— **完全没有日期参与**。
涨停/跌停几十行表格的复盘永远是"最长的"，于是越老的复盘越容易霸屏。

同时查清了一件属于**内容策略**而不是代码的事：

| 栏目 | 总数 | digest | market-recap | weekly | 真正手写 |
|---|---|---|---|---|---|
| ai | 211 | 188 | 0 | 22 | **1**（hello-world） |
| invest | 311 | 188 | 122 | 0 | **1**（月度复盘） |

也就是说"首页只展示原创笔记"在数据上不成立 —— 按字面实现，首页会只剩两篇占位文。
所以修法**不是隐藏自动内容**（那会让首页空掉），而是给头条加新鲜度约束：

| 项 | 旧 | 新 |
|---|---|---|
| 头条 | 全部非日报里 `body` 最长的 | **最近 20 篇**非日报里最长的一篇 |
| 最近更新 | 按日期倒序、排除 digest | 不变（复盘保留，那是每天的真实产出） |

为什么用"最近 20 篇"而不是"最近 60 天"：这个站每个交易日一篇复盘，20 篇约等于最近一个月；
用天数会在长假断更时把池子清空。

规则抽到 `src/lib/home-selection.ts`（纯函数 + 5 条单测），`index.astro` 只负责喂集合。
验证：重建后首页精选变成 `market-recap-2026-11-18`（3 天内）、`digest-2026-11-18`、
`photo/baokemeng`，06-29 那篇彻底从首页消失。

### 两条 a11y 流水线合成一条（第 99 轮）

仓库里长期有两条几乎同名的可访问性巡检：

| | `a11y.yml`「Accessibility audit」 | `a11y-audit.yml`「A11y (both themes)」 |
|---|---|---|
| 时间 | 周二 04:30 BJT | 周一 11:00 BJT |
| 被测对象 | **本地 dist** | **线上站点** |
| 覆盖 | 全站 1188 页 × 浅/深 | 24 个模板 × 浅/深 × 桌面/手机 + 水合 |
| artifact | `a11y-report` | `a11y-report`（同名） |

问题不是"多跑一遍"，而是：名字几乎一样（在 Actions 列表里靠日期猜）、artifact 同名、
覆盖面重叠，而线上那条把**生产可用性**混进了代码质量信号 —— 红了分不清是代码坏了
还是站点连不上。

合并成一条 `a11y.yml`「Accessibility & hydration audit」：

1. 全站 1188 页 × 浅/深（模板级回归都会照到）
2. 60 页手机宽度抽查（窄屏换行/折叠只有这里看得见）
3. 岛水合（Lighthouse 和 axe 都不会因为 React 组件崩掉变红）

全部目标都是本地 `dist` —— 同一份提交的确定性产物。线上是否正常由部署的
acceptance smoke 负责，两件事不再混在一个红点里。

守卫 `tests/a11y-single-workflow.test.ts`：只允许一个 `a11y*.yml`、
不许出现线上域名/远端 `BASE_URL`、三类覆盖面缺一不可、artifact 名字在仓库内唯一。

### 工作流的结构错误现在在本地就能挡（第 98 轮）

第 82 轮那次 `startup_failure` 的教训是：GitHub 只在**触发那一刻**校验 YAML，
校验失败时没有日志、没有注解，只有「产出没了」，而且能静默三天。

能静态检查的部分不该留给 GitHub 去发现。新增 `tests/workflow-shape.test.ts`，
对全部 11 个工作流做结构校验：

| 检查 | 能抓到什么 |
|---|---|
| name / on / jobs / runs-on / steps 骨架 | 手写 YAML 时少一层缩进 |
| 权限 scope 与取值白名单 | `status: write`（少个 s）、`issues: true` |
| `uses: ./…` 指向的文件存在 | 复用工作流改名后忘了同步 |
| `workflow_run.workflows` 的名字真实存在 | **打错不会报错，只会永远不触发** |
| cron 五段 + 范围 | `17 18 * *`、`0 25 * * *` |

最后一条是最阴的：第 96 轮新加的看门狗监听 `["Daily digest"]`，如果名字写成
`Daily Digest`，GitHub 不会报任何错，那条链路会永远静默 —— 和它要防的故障一模一样。

变异验证（改完立刻还原）：

| 变异 | 结果 |
|---|---|
| `Daily digest` → `Daily Digest` | 红：`监听的 workflow「Daily Digest」不存在` |
| `issues: write` → `issue: write` | 红：`权限 scope 不存在：issue` |
| `uses: ./…/deploy.yml` → `deploy-main.yml` | 红：文件不存在 |
| `17 18 * * *` → `17 18 * *` | 红：cron 不是 5 段 |

### 让每个提交挂红叉的「新鲜度状态」退休了（第 97 轮）

第 85 轮把内容新鲜度写进 `content/freshness` commit status，目的是让静默停更可见。
效果确实达到了 —— 但同时把**每一个提交的合并状态都变成 failure**：日报停更那几天，
仓库里所有 commit 都是红叉。真正的部署失败、烟测失败被淹在这片红里，久了就没人看红叉了。
这叫警报疲劳，比没有信号更糟。

所以改成 Issue：

| 项 | 旧（第 85 轮） | 新（第 97 轮） |
|---|---|---|
| 通道 | `content/freshness` commit status | GitHub Issue（`content/freshness` 标签） |
| 停更时 | 每个提交挂红叉 | 打开/更新一条 issue，正文点名板块 + 给处理步骤 |
| 恢复时 | 状态变绿 | **自动关闭** issue（`state_reason=completed`） |
| 通知 | 无（status 不发邮件） | issue 会发通知；看门狗 job 同时红 → 失败邮件 |
| 代码状态 | 被内容问题污染 | 只反映代码/部署/性能 |

`scripts/lib/freshness-issue.mjs` 是纯逻辑（正文生成、标题认领、幂等决策），
`scripts/publish-freshness-issue.mjs` 负责调 API，支持 `--dry-run` 与 `--json`。
判决阈值完全复用 `check-freshness.mjs`，没有第二套标准。

幂等是刻意设计的：已经是目标状态（该关的已关、该开的已开且已开着的）就**不发请求**，
否则每天改一次 body，等于把「停更了三天」刷成「刚刚更新」。

顺带清掉两处污染：`deploy.yml` 里那步删了（不再往提交上挂状态），
看门狗权限从 `statuses: write` 收窄成 `issues: write`。

### 所谓「每天 08:00 出日报」其实是下午两点（第 96 轮）

一直以来的假设是「daily-digest 的 cron 是 00:00 UTC = 北京 08:00，所以早上就有新日报」。
用 Actions API 把最近几次**实际**开始时间拉出来，全是另一个故事（BJT = UTC+8）：

| workflow | cron（UTC） | 期望落地（BJT） | **实际开始（BJT）** | 延迟 |
|---|---|---|---|---|
| daily-digest | `0 0 * * *` | 08:00 | 13:09 / 13:11 / 13:16 / 14:15 / 14:16 / 14:00 | **+5h ~ +6h15m** |
| deadlink-check | `0 1 * * 1` | 09:00 | 15:42 | **+6h42m** |
| a11y-audit | `0 3 * * 1` | 11:00 | 18:15 | **+7h15m** |
| lighthouse-mobile | `0 2 * * 1` | 10:00 | 17:19 | **+7h19m** |

不是偶发，是**系统性排队**：这个仓库的 schedule 触发普遍被压 5–7.5 小时，而
`00:00 UTC` 恰好是全球 cron 的最高峰（无数仓库都在整点开跑）。

两个改动：

1. **日报改到 `17 18 * * *`（BJT 02:17）**：避开整点高峰；即使仍被压 5–6 小时，
   落地也在早上 08:00 前后，不会像现在这样拖到下午两点。
2. **新鲜度看门狗改挂 `workflow_run`**：它原来靠自己的 cron（假设「日报 08:00 跑完」），
   而这个假设本身就是错的。现在的主通道是「Daily digest 一完成就检查」（成功/失败都查），
   定时（`23 20 * * *`，BJT 04:23）只作为「日报连跑都没跑」的兜底。

守卫 `tests/schedule-delay.test.ts` 把这两条钉死：日报 cron 不许落在整点、
必须在 BJT 凌晨开跑且最坏延迟后不晚于 15:00；看门狗必须有 `workflow_run` 主通道、
兜底 cron 必须晚于日报窗口、状态 SHA 必须优先用上游 `head_sha`。
变异验证：把 cron 改回 `0 0 * * *` → 两条测试同时红。

### 可访问性一直不在门禁上（第 95 轮）

现状有点荒诞：axe 有两条周更 workflow（一条打线上 16 页、一条本地全站 46 次检查），
但**门禁里一次都没有**。也就是说「对比度和标题层级」这类纯模板级回归，可以一路推到线上，
等下一周的巡检才被发现 —— 第 83 轮修的那批深色对比度问题（2.3:1）就是这么浮出来的。

全站 46 次检查要 2.5 分钟，塞进门禁太重，所以做了一个「模板级快检」：

| 项 | 值 |
|---|---|
| 页面 | `/`（首页）、`/invest/`（仪表盘 + 三个岛）、`/ai/digest-2026-06-05/`（正文 prose） |
| 主题 | 浅色 + 深色 |
| 检查数 | 6 次 |
| 耗时 | **约 22 秒**（门禁 2m20s → 2m33s） |

脚本新增两个与 `check-search.mjs` 对齐的开关：`--dist`（自己起静态服务）与
`--paths=`（只测指定页；拼错的路径直接报错，不会静默跑 0 页）。

变异验证：往 `global.css` 里加 `.prose p { color: #f2f2f2 !important }` 后重建 ——

```
✗ light /ai/digest-2026-06-05/  color-contrast×20
6 次检查：1 失败 / 0 警告 → exit 1
```

恢复后立刻 6/6 通过。守卫 `tests/a11y-gate-subset.test.ts` 把三件事固定住：门禁里必须有它、
必须排在 build 之后、快检路径数只能 2-4 条（防止哪天有人把周更巡检塞回门禁）。

### 内容停更的看门狗不该依赖「有人 push」（第 94 轮）

第 85 轮把内容新鲜度写成了 `content/freshness` commit status，但那一步在 **deploy.yml 里**。
部署只在「有人 push」或「工作日 15:30 定时」时才跑。于是还剩一个结构性缺口：

> 内容流水线自己坏了（2026-11-19 的 `startup_failure` 就是），当天又没人 push
> —— 没有任何东西会红。

新增 `.github/workflows/freshness-watch.yml`：每天 BJT 08:30（日报 08:00 开跑之后）自己跑，
不依赖任何提交。

| 项 | 设计 |
|---|---|
| 触发 | 每天 UTC 00:30（BJT 08:30）+ 手动；排在日报开跑之后，避免抢跑 |
| 权限 | `contents: read` + `statuses: write`（最小集） |
| 信号一 | 写 `content/freshness` commit status（与部署同一个 context，最新一条生效） |
| 信号二 | 停更时 job 直接红 —— commit status 不会发通知，**job 失败才会给管理员发邮件** |
| 判定阈值 | 复用 `check-freshness.mjs`，不另立标准 |

守卫 `tests/freshness-watch.test.ts`（4 条）把设计固定住：cron 必须在 UTC 00:30 之后、
权限必须是最小集、必须 `set +e` + `exit "$code"` + `::error::`、context 必须与部署一致。
变异验证：加 `contents: write` → 权限测试红；把 cron 改成 `0 0 * * *` → 「避免抢跑」测试红。

### 浏览器自检改成「与外界断联」（第 93 轮）

第 92 轮把 Giscus 的报错过滤掉了，但那只是把症状按下去：**本地构建的自检仍然依赖第三方网络**。
换个第三方组件、换个抖动方式，同样的坑会再来一次。

所以这一轮从根上断：`scripts/lib/hermetic.mjs` 给 Playwright 的 context 装一条
`**/*` 路由，只放行本地服务 + `data:` / `blob:`，其它域名一律 `abort()`。

| 放行 | 拦住 |
|---|---|
| `http://127.0.0.1:<port>/**`（本地 dist） | `giscus.app`、`fonts.gstatic.com`、`cdn.jsdelivr.net`、`webapi.amap.com` |
| `data:` / `blob:`（图表、内联图） | 其它端口的本地服务（避免误连别的进程） |

为什么要拦到「别的端口」也拦：一次误判成 `127.0.0.1:4321` 之外的本地进程，测试就会
悄悄测到别的构建产物上，这种假绿比红更难查。

适配范围：`check-interactions.mjs`（19 个场景）与 `check-runtime.mjs`（21 个页面）都装了；
被拦下的域名会在末尾打一行 `已拦截第三方请求（只验证本地构建）：…`，需要时能看见。

验证：

- 单测 `tests/hermetic.test.ts`：本地放行、六类第三方全拦、两个脚本都必须装路由
- 实跑：伪造 `giscus.app/client.js` 与 `fonts.gstatic.com/x.woff2` → 都被拦；
  同源 `fetch("/favicon.svg")` 仍然 200
- 交互 19/19、运行时 21 页、门禁 405 测试全绿

### 发布卡了 40 分钟：第三方评论组件的 console 噪音（第 92 轮，同一轮发现）

诊断修好之后，注解立刻指认真凶：

```
✗ 内容页：滚动一遍不预取整页反馈（≤2 次 GET）（/ai/digest-2026-08-27/）
    console: [giscus] An error occurred. Error message: "Unexpected end of JSON input"
✗ 评分：GET 422 时点星仍能评分且不显示错误徽标（/ai/digest-2026-08-27/）
    console: [giscus] … "Failed to execute 'json' on 'Response': Unexpected end of JSON input"
```

不是本站代码的问题：Giscus 的 `client.js` 在页面上下文里请求自己的
`https://giscus.app/api/discussions`，GitHub runner 出口被限流/拦截时拿不到 JSON，
它就 `console.error` 一句。本机网络正常，永远复现不出来 —— 典型的「CI 红、本地绿」，
而且它挡的是**发布**：从第 89 轮起三次 Build & Deploy 全挂在这一步，线上一直停在旧构建，
我在本地测的一切都还是新的。

修法要「窄」：

| 项 | 改动 |
|---|---|
| `scripts/lib/console-noise.mjs` | 新增 `isThirdPartyConsoleNoise(text, url)`：只认 `[giscus]` 前缀 / `giscus.app` 来源，别的一概不放行 |
| `check-interactions.mjs` · `check-runtime.mjs` | console 钩子里调用它；自己代码的 `TypeError`、`HTTP 4xx`、水合报错照旧计数 |
| 单测 | 5 条自家报错必须判 false（防止过滤宽了变成假绿）、别的第三方域名不自动放行 |

结果：CI 里 `smoke/interactions` 从红变绿（19/19），`Build & Deploy` 36 个步骤全绿，
`db9975b2` 已上线（Production acceptance smoke 校验了 `deploy-meta.json` 的 sha，
search probe 校验了 pagefind 碎片可读）。唯一红的 commit status 是
`content/freshness`（AI 日报落后 3 天，等 08:00 定时任务）。

### 部署烟测的失败诊断全是死代码（第 92 轮）

现象：`Build & Deploy` 连续三挂在「Interaction smoke」，而 GitHub 注解里只有一句
`Process completed with exit code 1` —— 场景名、报错原因一个字都没有。日志接口对普通
仓库是 403，注解是唯一能拿到信息的通道，而它什么都没给。

原因不在被测代码，在 workflow 的写法：

```yaml
run: |
  npm run check:interactions > /tmp/interactions.log 2>&1
  code=$?                      # ← 永远执行不到
  cat /tmp/interactions.log    # ← 永远执行不到
  echo "::error::…"            # ← 永远执行不到
```

GitHub Actions 的 `run:` 默认 shell 是 `bash -eo pipefail`。命令一失败，shell 立刻退出，
后面「存日志 / 打注解 / 写 commit status」的整段都是死代码。第 74 轮只在 perf 那一步
加了 `set +e`，runtime / mobile / interactions 三步一个都没加。

修法与守卫：

| 项 | 改动 |
|---|---|
| deploy.yml | runtime / mobile / interactions 三步各加 `set +e`，失败时额外打印日志尾部 20 行 |
| site-audit.yml | 新鲜度 / 依赖公告两步同样缺 `set +e`（失败时步骤摘要丢失），一并补上 |
| 守卫 | `tests/deploy-smoke-diagnostics.test.ts` 扫**所有 workflow**：凡出现 `code=$?` 的步骤必须有 `set +e` |

变异验证（删掉交互那一步的 `set +e`）：测试立刻红 ——
`这些步骤在失败时不会打印日志/注解`。

顺带确认了另一件事：交互烟测跑的是**本地 dist**（`serveDist`），不是线上，所以它红
说明新构建本身有问题，而不是「线上还是旧版本」。

### 搜索探针只打生产，等于门禁里没有搜索（第 91 轮）

第 80 轮修的是线上搜索 403（nginx 权限位），修完之后探针一直只打**生产**：
`check-search.mjs` 的默认 base 是 `https://www.zorotreeking.online`，而门禁里没有任何一步会
加载 pagefind 索引。后果是：索引缺失 / 为空 / 查询全错，本地和 CI 全绿，直到用户搜索才发现。

这一轮把探针拉进门禁：

| 项 | 改动前 | 改动后 |
|---|---|---|
| 起服务 | 需要人先跑本地服务器，再 `--base=` | 新增 `--dist`：自己 `serveDist` 起、跑完自己关 |
| 门禁覆盖 | 无 | `check:search:dist`（build 之后跑，12 个查询全部要返回结果） |
| 失败表现 | 无 | 索引缺失 → `TypeError: Failed to fetch dynamically imported module` → 门禁红 |

变异验证（把 `dist/pagefind` 整个移走）：

```
✗ ETF — 报错：TypeError: Failed to fetch dynamically imported module: .../pagefind/pagefind.js
删掉索引 exit=1
```

放回去立刻 12/12 全绿。门禁总时长 2m10s（+约 10s），397 个测试通过。

### 兜底字体的标定对数字不成立（第 90 轮）

第 74/75 轮把 metric-matched fallback 调成了「字母宽度误差 <2%」，门禁也一直是绿的。
但那个门禁的采样句是**纯字母**的，于是漏掉一整类字符：数字。

限速 1.6 Mbps + 4× CPU 下复现出可测的 CLS：

| 观测 | 值 |
|---|---|
| digest 页 CLS | **0.028**（仍属 good，但每次首次访问都会发生） |
| 位移时刻 | t≈1543 ms，正好是 Inter 下载完成（1529 ms） |
| 位移来源 | h1 `AI 每日精选 · 2026-08-27`：兜底排 1 行（高 38px），真字体排 2 行（高 75px），下方内容整体下移 37.5px |

用 canvas 逐类量了宽度比（兜底 ÷ 真 Inter）：

| 字符类 | 400 | 600 | 700 |
|---|---|---|---|
| 字母（原来的采样） | 98–107% | 99% | 98–100% |
| **数字** | 100.7% | **92.8%** | **91.3%** |
| **日期 `2026-08-27`** | 94.8% | **87.5%** | **86.3%** |

原因很朴素：Inter 的半粗/粗数字比 Arial Bold 宽约 9%，而 `size-adjust` 只有一个旋钮，
字母要 +1%、数字要 +9%，顾此失彼。**这不是 bug，是字体设计差异**，所以没有硬改数值
（硬调会把字母推到换行悬崖上，第 74 轮的 0.053 就是这么来的）。

改的是「可观测性」：`check:font-fallback` 现在额外测 4 组数字/日期/中英混排，立地板值
（数字 ≥88%、日期 ≥84%、混排 ≥92%），防止有人为了修别的把兜底弄得更差。变异验证：

```
✗ 数字（半粗）  宽度 92.8%（地板 94%，兜底被改坏了：数字/日期会比真字体窄太多，标题会换行跳动）
```

顺带量了几个候选兜底（相对 Inter 600：字母比 / 数字比）：

| 本地字体 | 字母 | 数字 | 均匀度 |
|---|---|---|---|
| Arial Bold（现用） | 0.991 | 0.928 | 差 6.3% |
| Tahoma Bold | 1.032 | 1.043 | **差 1.1%** |
| Trebuchet MS Bold | 0.953 | 0.960 | 差 0.7% |

Tahoma/Trebuchet 的宽窄更均匀（一个 size-adjust 能同时照顾字母和数字），但它们不是
所有平台都有（Linux 上没有），换过去会让 CI 与本机行为分叉，所以只记录为可选方案：
**要彻底消掉这 0.028，就得把粗体兜底换成 Tahoma/Trebuchet 并在每个平台重新标定**。

### 同一个 422 坑的另一半：评分组件（第 89 轮）

第 83 轮修的是 `FeedbackButtons`「初始加载失败 → 每篇文章底部一条红色 `·HTTP 422`」，
第 88 轮修的是它「加载失败 → 按钮点不动」。**`StarRating` 从来没修过**：
它挂载即 `GET /api/feedback`，失败就 `setErr`，而线上这个 GET 一直是 422 ——
于是每篇带评分的文章底部都挂着一条红色错误码。

| 项 | 改动前 | 改动后 |
|---|---|---|
| 挂载时请求 | 1 次 GET | 0（只读 localStorage 里的个人评分） |
| 首次请求时机 | 挂载 | 鼠标进星星 / 聚焦 / 触摸 |
| GET 422 | 渲染红色 `· HTTP 422` | 静默降级成空状态，30s 内不重试 |
| 点星评分 | 正常 | 正常（POST 不依赖汇总数据） |

整页滚一遍后，移动端内容页的 `/api/feedback` 请求从「21（反馈）+1（评分）」变成 **0**。
部署巡检加了「评分：GET 422 时点星仍能评分且不显示错误徽标」，并做过变异测试：

```
✗ 评分：GET 422 时点星仍能评分且不显示错误徽标
    页面上出现了错误码徽标（初始加载失败应当静默）
```

（这条场景第一版也是假绿：评分岛是 `client:visible`，不先滚到它并等水合，
点星星根本没人响应。）

### 按需加载把「GET 失败」从「数字不显示」升级成了「按钮点不动」（第 88 轮）

第 86 轮把反馈状态改成按需加载后，引出一个新的失效路径：`vote()` 需要先知道
`my_vote` 才能算「再点一次是取消」，所以它 `await` 一次状态加载；而线上
`/api/feedback` 的 **GET 一直是 422**（第 83 轮就发现了，只是当时被静默回退掩盖）。

| 版本 | GET 422 时点击赞 | 结果 |
|---|---|---|
| 第 86 轮（按需加载，失败即 `return`） | 什么都不发生，无提示 | **按钮点不动** |
| 第 88 轮（失败退化成空状态） | 照常 POST，进入按下态 | 正常 |

修法：加载失败返回 `EMPTY_STATE` 并标记 `degraded`（不写缓存），让投票继续走；
同时 30s 内不再重试坏接口，避免每次悬停都打一下。部署巡检里加了一条
「反馈 GET 422 时点击仍能投票」的场景，并做了变异测试：

```
✗ 反馈 GET 422 时点击仍能投票（降级不阻塞）
    GET 422 后点击没有进入按下态（推荐的降级路径失效，按钮点不动了）
```

把降级改回「失败即放弃」这条就红，恢复后 18/18 全绿。

### 「不预取」这条回归守卫第一版是恒绿的（第 87 轮）

给第 86 轮的按需加载补部署巡检时，写了一条「首屏 GET /api/feedback 次数 ≤2」的场景。
它一开始**永远绿**：反馈岛是 `client:visible`，不滚进视口根本不挂载，
所以旧代码（挂载即请求）在这个场景里也是 0 次请求 —— 阈值再严也测不出来。

两次变异测试才把它戳破：

| 变体 | 场景结果 |
|---|---|
| 旧行为（挂载即请求），场景**不滚动** | ✓ 通过（假绿） |
| 旧行为，场景**滚动一遍** | ✗ 失败：`滚动后发了 21 次 GET /api/feedback` |
| 新行为（按需加载），场景滚动一遍 | ✓ 通过：17/17 |

所以这条场景现在必须自己滚一遍再数请求，并且有单测锁住「场景里存在 scrollHeight、
阈值是 2」，防止有人为了让它变绿把滚动删掉。

### 一个 digest 页面打开就发 21 个反馈请求（第 86 轮）

内容页底部每条都有「赞/踩」，每个按钮都是一个 React 岛，挂载时各自
`GET /api/feedback?slug=...`。实测一个 digest 页面首屏就发 **21 个** 请求：

```
/api/feedback?slug=item%3Aarxiv-2608.24979
/api/feedback?slug=item%3Aarxiv-2608.26005
...（共 21 个）
```

这些请求只为把「几个数字」填进按钮，而绝大多数访客根本不会点赞。对移动端是纯浪费：
无线电流量、服务端 QPS、首屏资源竞争。

改成**按需加载**：只有访客真的把鼠标移上去 / 聚焦 / 触摸 / 点击时才拉一次，
同一 slug 并发去重 + 结果缓存 5 分钟，投票成功写回缓存。

| 场景 | 改动前 | 改动后 |
|---|---|---|
| 移动端打开 digest | 21 个请求 | **0** |
| 桌面端打开 + 滚到底（鼠标停在按钮上） | 21 | 1 |
| 悬停某个按钮 | — | 1（该 slug 首次） |
| 再悬停同一按钮 | — | 0（命中缓存） |
| 点赞 | 1 次 POST | 1 次 POST（状态已缓存） |

代价：点赞数不再「一进页面就有」，要等一次交互后才显示。这个交换是值得的——
数字不影响阅读，而 20 个请求每次都发生。

### 内容停更要能被「一个 commit 页面」看见（第 85 轮）

第 82 轮查清 AI 日报停更三天的原因后，还有一个问题没解决：**那三天为什么没人发现**。
答案很直白——「内容断了」不在任何一条健康信号里：构建绿、门禁绿、巡检绿，只有产出没了；
而 Actions 日志要登录才能看，维护者长期没有 token。

补一条公开信号：每次部署把内容新鲜度写成 commit status。

| 项 | 值 |
|---|---|
| context | `content/freshness` |
| 过期时 | `failure`，描述形如「AI 日报 落后 3 天（最新 2026-11-18）」 |
| 达标时 | `success`，描述是最新一篇的日期 |
| 是否阻塞部署 | **不阻塞**（`continue-on-error: true`）—— 内容落后不该挡住代码修复的发布 |

实测（第 85 轮当时的状态）：

```
✗ content/freshness: AI 日报 落后 3 天（最新 2026-11-18）
```

### 顺手删掉一段「看起来有用」的死代码（第 85 轮）

`ArticleImageLightbox`（文章正文图片的零依赖 lightbox）在 `BaseLayout` 里全站注入，
但它的选择器是 `article .prose img`，而站点**根本不存在 `.prose` 容器**（只有 Tailwind 的
`not-prose` 包装），所以它从未接管过任何一张图；`document.querySelectorAll("article .prose img")`
在浏览器里实测为 0。

代价是每页多背 1.4 KB 内联 CSS+JS、以及一个「我们有图片放大功能」的错觉。删掉后：

| 指标 | 删除前 | 删除后 |
|---|---|---|
| `/invest/` 原始 HTML | 189,090 B | 186,895 B |
| `/invest/` gzip | 35,641 B | 34,991 B |

1194 个页面累计少传约 2.6 MB（gzip 约 0.8 MB）。相册与徒步页的图片本来就走 PhotoSwipe
（自带双指缩放/双击放大），不需要这个轻量替代品。

### 水合巡检一直在假绿：它从来没检查过「岛到底水合了没」（第 84 轮）

`check-hydration` 从第 69 轮就在门禁里跑，结论一直是「全部干净」。第 84 轮加了一句断言才发现
它**只统计岛的个数和控制台报错**，没有任何一条检查水合本身。

本站 36 个岛几乎全是 `client:visible`：不滚到视口附近就不会水合。旧脚本只滚到页面一半，
底部的岛（徒步页的 GPX 地图、首页下方的板块榜）永远不触发 —— 就算组件彻底坏掉，也不会有
任何 console error，巡检照样绿。

可用的判定信号（实测同一元素水合前后）：

| 阶段 | astro-island 属性 | innerHTML 长度 |
|---|---|---|
| SSR（未水合） | 含 `ssr` | 272 |
| 水合完成 | `ssr` 被摘掉 | 26884 |

所以判定 = `el.hasAttribute("ssr")`。同时补两件配套的事：

| 改动 | 原因 |
|---|---|
| 整页分步滚动 | 只滚一半会让底部岛永不触发 |
| 轮询到超时（默认 10s） | `client:visible` 先触发再拉 chunk，冷缓存下超过固定 2.5s，死等会**随机变红** |

这里还踩了一个「静默失效」的坑：滚动脚本是 `page.evaluate(字符串)` 传进去的，而传
`async () => {...}` 只会得到一个**函数对象**、不会被调用 —— 滚动根本没发生，表现得像
「只有首屏的岛水合」。必须写成 IIFE `(async () => {...})()`。修之前 6 个页面里 2 个必红，
修之后 10 个岛全部水合、连跑两次稳定。

现在门禁里这一步真的会红：`check:hydration` 走本地 dist，跑 6 个页面、断言每个岛都摘掉 `ssr`。

### 每周 a11y 巡检红了两次：162 条违规里 161 条是测量错误（第 83 轮）

`A11y (both themes)` 连续两周失败。本地复跑（`BASE_URL=http://127.0.0.1:<port>`）拿到
4 条失败，拆开看是三类完全不同的东西：

| 报告 | 真实情况 |
|---|---|
| `dark /invest/digest/` 162 条对比度 | **测量假阳性**：站点没问题 |
| `light /photo/baokemeng/` 1 条对比度 | **真 bug**：沉浸式深底 + 浅色主题的 red-700 |
| 同一条在 mobile 视口重复 | 同上 |

**假阳性的机制**（很值得记）：列表页 170 张卡片在首屏之外，它们带 `transition-colors`。
Chromium 对**从未被绘制过**的元素不推进 transition，`getComputedStyle` 一直返回过渡起点
（浅色 `#fff`），于是 axe 认为「深灰字压白底」只有 2.56:1。把那张卡 `scrollIntoView` 之后，
同一个元素的背景立刻变成 `rgba(24,24,27,.4)` —— 说明是测量窗口的问题，不是样式的问题。

修法：测量前注入 `transition: none !important; animation: none !important`，让计算值一步到位，
不再依赖元素有没有被绘制。（顺带把「等 2.5s 入场动画」这件事也变成确定性行为。）

**真 bug**：相册页用 `body:has(.photo-immersive)` 强制 `#0a0a0a` 深底来适配沉浸式看图，
但 `--danger-text` 只有浅色主题值 `#b91c1c`（red-700，在 `#0a0a0a` 上 3.05:1）。
更糟的是这条红字平时就在页面上：`FeedbackButtons` 初始拉取状态失败会把错误码画出来，
而线上 `/api/feedback` 的 GET 返回 422 —— 等于每篇文章底部都挂着一条看不清的 `·HTTP 422`。

两处一起修：沉浸式区块钉 `--danger-text: #f87171`（6.4:1）；初始加载失败改为静默回退 0/0，
只有用户**主动投票**失败才显示错误码。修完本地 92 次检查 0 失败。

教训：巡检脚本报红时，先证明「这个红是不是测量造成的」——把元素滚进视口、改变一个条件，
看数值会不会跟着变。这一轮如果直接去改站点样式，会把正确的深色卡片改坏。

### AI 日报停更三天的真正原因：可复用工作流的权限升级（第 82 轮）

第 78 轮发现 AI 日报从 2026-11-18 起停更。本地没有 API key，也没法读 Actions 日志，
当时只能做「看得见」的补救（新鲜度看门狗 + LLM 预检）。第 82 轮改用公开的 Actions API
查运行记录，一条就能定性：

```
Daily digest  2c9e4da4  completed  startup_failure  2026-11-20T06:00:45Z
Daily digest  778cde71  completed  startup_failure  2026-11-19T06:16:19Z
Daily digest  d889cb59  completed  success          2026-11-18T06:15:24Z
```

`startup_failure` 意味着**一个 step 都没跑**——不是抓取失败，不是密钥过期，而是 workflow
在启动阶段就没被接受。时间线对上了唯一一次相关改动：

| 时间（UTC） | 事件 |
|---|---|
| 11-18 06:15 | digest 成功 |
| 11-18 10:48 | 提交 `69dc2a6b`：给 `deploy.yml` 加 `statuses: write`（让失败步骤能写 commit status） |
| 11-19 06:16 | digest 变成 `startup_failure` |

`daily-digest.yml`、`weekly-roundup.yml`、`bulk-backfill.yml` 都以
`uses: ./.github/workflows/deploy.yml` 调用部署。**可复用工作流的权限不能高于调用方**，
而三个调用方只声明了 `contents: write`。于是调用方连启动都过不去，日历定时任务从此静默
失败三天 —— 而 `deploy.yml` 自己由 `push` 触发时完全正常（26 次 success），所以从外面看
不出任何异常。

修法：三个调用方补 `statuses: write`。同时把这个规则做成静态测试
（`tests/workflow-permissions.test.ts`）：解析所有 workflow，凡 `uses:` 调用本仓库另一个
workflow 的，就检查「被调用方要的权限 ⊆ 调用方给的权限」，缺一条就红。

这个事故的教训是**诊断顺序**：先问「任务到底跑了没」，再看「跑了之后错在哪」。
`startup_failure` 与 `failure` 的区别决定了要不要去查代码、密钥、还是配置。

### 别用 HTTP 去核对全站资产：会把自己打进频控（第 81 轮）

第 80 轮修完碎片权限后，我想顺势做「全量资产清单核对」——把本地 dist 的文件逐个 HTTP
取一次，确认线上都能读到（字体、图片、CSS 也可能因权限位坏掉）。实测**这个方向是错的**：

| 问题 | 实测 |
|---|---|
| 请求量爆炸 | 1453 个文件（pagefind 碎片 1186 + 抽样） |
| 触发频控 | 跑完一轮后本机对站点的请求全部被 reset（`000`），而同一时刻访问 GitHub 正常 |
| 结论失真 | pagefind 碎片名与构建绑定，本地 dist 不是线上那一版时，1316 个「404」全是假阳性 |

改成**服务端一次 `find`**，零 HTTP 请求、覆盖全部文件：

```sh
find "$dir" -type f ! -perm -o+r | wc -l   # current 与 previous 各核一次
```

部署里现在有两步配合：`Repair file readability`（补 `o+r`，失败不阻塞）+
`Verify every file in the release is world-readable`（还剩不可读文件就**让部署失败**）。
回滚目标 `previous` 也核，否则回滚会退回坏的那份。

另外确认了一件事：pagefind 的 `entry.json` 是带 `?ts=` 缓存穿透的，碎片/index/meta 的
文件名都由它派生，所以「部署后旧缓存指向已删除碎片」这条路不成立 —— 第 80 轮的 403
确实就是权限位，与缓存无关。

**教训**：核对生产状态的脚本要先算请求量。像「全站文件逐个抓」这种，成本不是线性的，
它直接等于「你的 IP 被当爬虫」。能用服务端一次扫描解决的，就别用 HTTP 洪泛。

### 只有部分搜索关键词坏掉，任何烟测都照不出来（第 80 轮）

第 80 轮用 pagefind 的真实客户端路径跑生产：**20 个常见查询里有 4 个直接报错**。

```
Error: 403 fetching /pagefind/fragment/zh-cn_2e61058.pf_fragment
```

真正的线索是状态码的对比：

| 请求 | 状态 | 含义 |
|---|---|---|
| 随便编一个不存在的碎片名 | **404** | 文件没发布（Astro 404 页） |
| 这 4 个固定名字 | **403**（nginx 146 字节错误页） | **文件在，nginx 读不了** |

成因：部署用 `rsync --no-perms` + `cp -al` 硬链接播种。rsync 写新文件时先建 `0600`
临时文件，`--no-perms` 又不补 chmod，于是偶发几个文件停在 `0600`；`cp -al` 还会把
上一次 release 的权限位顺着硬链接继承下去。

这个 bug 特别难发现，因为**只有部分搜索关键词坏掉**：页面、字体、CSS、图片全正常，
`smoke/runtime`、`smoke/interactions`、全站巡检都是绿的 —— 它们谁都没去 fetch 碎片。

补两件事：

| 手段 | 位置 |
|---|---|
| `npm run check:search` | 12 个查询走真实前端路径（`search()` 之后必须 `data()`，光 search 不会下载碎片） |
| 部署里补权限 | 激活后 `find current previous -type f ! -perm -o+r -exec chmod o+r`，current 与 previous 都修，回滚不会退回坏的 |
| 部署验收闸门 | 搜索探针排在回滚之前：碎片不可读 → 直接回滚这一版 |

`Pagefind` 的失败**不会**出现在 `smoke/interactions` 里，因为那个烟测用的查询恰好落在
还健康的碎片上 —— 这提醒我们：抽样查询要覆盖多板块，否则「抽查通过」是假象。

### 停更没有「静默 skip」这条路了（第 79 轮）

顺着第 78 轮的停更往下挖，找到了整条链上**两个**吞掉失败的地方，都在 `digest-fetch.ts`：

| 位置 | 旧行为 | 后果 |
|---|---|---|
| 收集完是空数组 | 打一行 `no papers; skip.` 后 `return`，退出码 0 | 源全挂了也「成功」，停更三天没人知道 |
| 每条摘要都失败 | `summarizeSafe` 兜底成「（LLM 摘要失败…）」占位符，照样写文件、退出 0 | **比停更更糟：把占位符文章发出去** |

第 79 轮实测复现了第二种：本地没配 key 跑 `npx tsx scripts/digest-fetch.ts ai`，
10 个源收到 20 条，20 条摘要全部失败，脚本仍然写出 `digest-2026-11-21.zh.mdx` 并 exit 0。

现在两道体检都在 `scripts/lib/digest-collect.ts`：

| 体检 | 阈值 | 行为 |
|---|---|---|
| `starvationReason` | 少于 3 条 | 抛错，打印逐源「几条/失败」，并区分「全部源失败（多半是 CI 出口 IP 被挡）」和「部分源失败」 |
| `summaryHealth` | 失败率 > 30% | 抛错，**不写文件**，提示先跑 `digest-preflight` 看模型是否可用 |

逐源结果同时落到 `reports/digest-sources-{ai,invest}.json`，workflow 用 `if: always()`
把它贴进 run 页面 —— 失败的那次运行自己就带着诊断信息，不用再翻日志。

同日还确认：10 个 AI 源在**本机**全部可达（HF 50 条 / arXiv 3 条 / 量子位 3 条 / 20 条去重后），
所以停更不是「上游没内容」，更像 CI 出口 IP 或密钥/模型问题。

### 「没有产出」不是错误，所以没有任何地方会红（第 78 轮）

第 78 轮翻内容目录时发现：**AI 日报从 2026-11-18 起再没更新**（投资复盘照常），
而站点照常构建、340 个测试全绿、全站巡检 0 失败。原因很简单 —— 「少一篇文章」不是
错误，没有任何检查会红；定时任务红了也没人看 run 页面。

三件事补上：

| 手段 | 作用 |
|---|---|
| `npm run check:freshness` | 读 `src/content/**` 文件名，算每条流水线最新一篇与今天的差；落后超阈值就退出码 1 |
| `daily-digest.yml` 收尾断言 | `--require-today`：今天的日报没落地 → **job 变红**（而不是静默跳过） |
| `daily-digest.yml` 前置预检 | 一次极小调用把「模型调不通」归类：缺密钥 / 401 密钥失效 / 403 无权限 / 404 模型下线改名 / 429 额度 / 网络 |

预检的价值在于**归类**：401 要去换 Secret，404 要去改 `scripts/lib/llm.ts` 里写死的
`MODEL_NAME`，429 只能等额度 —— 混成一句「这一步红了」，下次修还得重新猜一遍。

这两个脚本都不进 `npm run gate`：内容新鲜度取决于定时任务，不该拦住无关的代码提交；
预检要真调 API，更不适合放门禁。

**根因仍未确认**：本地无 `DOUBAO_API_KEY`、也没有只读 token 去看那次运行的日志，
所以只能做到「下一次失败时把原因说清楚」。下次 08:00 的定时任务如果预检红，看
step summary 里的归类即可定位。

### `npm audit` 的正确用法：要么干净，要么有人签过字（第 77 轮）

第 77 轮跑 `npm audit` 查出 astro ≤ 7.4.6 有两条 moderate 公告（动态标签名注入 XSS、
`@astrojs/node` 图片接口的目录穿越）。修法是升到 7.4.7+，但 7.4.7+ 把
`engines.node` 提到了 `>=22.23.4`，本机是 **22.23.2** —— 升不上去。

这种「知道有问题、暂时修不了」最危险的不是漏洞本身，而是之后所有 audit 输出都被当成
噪音忽略。所以做成双向校验（`npm run check:deps`）：

| 情况 | 处理 |
|---|---|
| audit 报了、白名单里没有 | **退出码 1**，必须处理或写下评估 |
| 白名单里有、audit 已经不报 | **也退出码 1**，条目过期必须删（否则白名单变永久盲区） |
| 白名单条目没写 `reason` / `revisit` | 文件本身不合格 |

两条公告的评估写在 `scripts/dependency-advisories.json`：站点是 `output: "static"`、
标签名全写死在源码里、也没有跑 Astro 服务器，所以两条都不可触达；`revisit` 写清了
触发条件（引入动态标签名组件 / 改 SSR / 本机 Node 升到 22.23.4+）。

不进 `npm run gate`：`npm audit` 要访问 registry，而门禁（含 pre-push）要保持可离线；
它每周跟着全站巡检跑，未评估的公告会让那条 job 变红。

### 服务器配置是唯一没有门禁的地方（第 76 轮）

全站巡检能覆盖 HTML、图片、JS，但覆盖不到 nginx：同一份内容两个 URL、压缩算法、
缓存头、反代缓存，全在服务器上，仓库里的 325 个测试一个都看不见。于是补了一个
**从外部探测**的脚本 `npm run check:server`（`scripts/check-server.mjs`），用
`node:https` 拿 `rawHeaders`，逐项判定并直接给出可抄的 nginx 片段。

线上（`f048b5d6`）第一次跑出来的结果：

| 项 | 现状 | 级别 |
|---|---|---|
| `/index.html` | 200，应 301 到 `/` | 必须修 |
| `/_astro/*.js` 的 `cache-control` | **两行**：`max-age=31536000` + `public, immutable` | 必须修 |
| `/photos/**` 的 `cache-control` | **两行**：`max-age=2592000` + `public, max-age=2592000` | 必须修 |
| `/en/index.html` 等子目录 | 200 | 建议 |
| brotli | 只开 gzip（HTML 28 KB vs 24 KB × 1194 页） | 建议 |
| `/api/market/*` | 无 `cache-control`，每次回源打后端 | 建议 |

两行 `cache-control` 的成因：nginx 的 `expires 1y` 自己会发一条 `Cache-Control: max-age=…`，
再叠一条 `add_header Cache-Control "public, immutable"` 就是两行、值还不一样。浏览器多数
会合并，但 CDN / 审计工具会各取第一行 —— 最坏情况是 `immutable` 被丢掉。

实现上踩了两个坑，都写进注释了：`fetch` 的 `Headers` 会把同名头**合并**成一行（根本数不出
重复），必须用 `node:https` 的 `rawHeaders`；响应体是压缩过的，不解压就找不到 `/_astro/`
引用（第一版静默漏掉整条检查）。

改法见 [`docs/nginx-hardening.md`](./nginx-hardening.md)：整段配置 + `add_header` 按层级
继承的坑（子 location 里写 `add_header` 会顶掉父级的安全头）+ 验证命令。
**这部分我没法自己应用**（没有主机权限），脚本与文档已就绪，改完跑 `npm run check:server`
即可确认；每周巡检会把结论写进 run 页面，不进阻塞发布的 gate。

### CLS 0.053 的真凶：正文粗体是 weight 600，不是 700（第 75 轮）

全站巡检（未节流）把「本地全 0、线上 0.028–0.053」这类差异顶了出来。逐层剥下去：

| 步骤 | 做法 | 结论 |
|---|---|---|
| 1 | 线上 `--explain` 看位移源 | `BLOCKQUOTE` 里 `STRONG` 高度 80→50，整段上移 30px |
| 2 | 本地复现 | 本地字体秒到，位移发生在 FCP 之前（不计 CLS）；把 `.woff2` 响应人为延后 1.2 s 才复现 |
| 3 | 扫 `size-adjust` 找真元素高度拐点 | 102% 仍是 2 行、103% 变 3 行 —— **悬崖在 102.5%** |
| 4 | 查 computed style | `strong` 是 **`font-weight: 600`**（typography 插件的默认），兜底面却按 700 标定成 102.3% |

所以兜底渲染的粗体比 Inter 600 宽 0.5%，正好跨过折行阈值 → 多一行 → 30px。改到
**101.8%**（行盒 override 同步 95.3/23.6）后，线上该页 CLS 从 0.053 归零。

顺带做的两件事：

- **斜体单独标定**：Inter 没有斜体文件，浏览器是用直立字形合成倾斜，所以斜体前进宽度
  等于直立宽度；而兜底用的 Arial Italic 是真斜体。三档斜体 face（100-499 / 500-549 /
  550-900）按实测 107.1% / 108.2% / 102.6% 标定，行盒 override 同步推算。
- **兜底 face 全部加 `unicode-range`**（与网页字体同一份拉丁子集）：`size-adjust` 会缩放
  整个 face，不限定字符集时 CJK 也会被算进去，而 CJK 永远由系统字体渲染、字体到货后
  又回到 100% —— 混排段落会多折一行。

残留：`/ai/digest-*` 仍有 0.028（中文长段落 + 中英混排，折行正好卡在边界；标题 H1 也是
临界放不下/放得下）。这属于「度量只对齐到 0.5% 精度」的固有残差，低于 0.1 的 good 线，
不再追。

### 抽样永远覆盖不到长尾：全站 1186 页巡检（第 75 轮）

发布流程里的 runtime smoke 只抽 21 个代表页——它挡住的是「整站都坏了」，挡不住
「只有某种模板坏了」。站内 1186 页里 800+ 是相册页、几百篇日报、几十条路线页，
它们的模板各自演化，抽样里看不见。

于是补了一条**只报告、不挡发布**的全量巡检：

| 组成 | 作用 |
|---|---|
| `scripts/audit-site.mjs` | 按 sitemap 逐页真加载，抓 pageerror / 控制台错误 / 同源 4xx / LCP / CLS，JSONL 落盘 |
| `scripts/lib/summarize-audit.mjs` | 把 JSONL 汇总成 job summary：状态码分布、**失败按问题归组**、最慢 LCP、有位移的页面 |
| `.github/workflows/site-audit.yml` | 每周四 09:00（BJT）对着**线上** sitemap 跑一次，结论写进 run 页面 + 留 artifact |
| `npm run audit:site` | 本地全量跑（默认本地 dist，`--base=` 可换线上） |

关键选项：`--limit=N` 抽样、`--sample=even|random`（均匀撒 vs 真随机）、`--concurrency`、
`--resume`（中途断了续跑）、`--vitals`（带首屏指标）。

本地全量实测：**1186 页 / 397 s / 0 失败 / 状态码全 200**，LCP 中位 112 ms（并发 5）、
串行时 76 ms，CLS 全 0。这说明「模板层没有集体性坏页」，之后的增量差异都能被这份基线量出来。

两个测出来的坑：

1. **第一次导航是冷的**：逐页巡检如果不预热，首页会被量成 2084 ms（真实 76–112 ms），
   报告开头永远是「首页最慢」——假信号会把人引向错误的优化方向。现在开始前先预热一次。
2. **并发会把 LCP 推高**：并发 5 时同一页可以量出 860 ms、并发 1 时 112 ms（CPU 抢占）。
   CLS 不受影响（结构问题），但 LCP 只能看趋势；脚本在 `--concurrency > 2` 时会自己打印这句警告。

### 把「弱网首屏」变成可复现的基线（第 74 轮）

第 73 轮修 LCP 时用的是一次性脚本，结论没法被门禁复现。这轮把它做进 `check:runtime`：

| 新选项 | 作用 |
|---|---|
| `--throttle` | CDP 模拟 Lighthouse 默认弱网（1.6 Mbps / 150 ms RTT），CPU 默认降 4× |
| `--repeat=N` | 每页测 N 次，**按中位数**判预算（弱网单次 LCP 会抖 100–300 ms） |
| `--urls=file` | 指定页面清单（抽查范围不被写死在脚本里） |
| `--explain` | 位移明细带 `previousRect → currentRect`，定位 CLS 不用猜 |

`npm run check:perf` = `--vitals --mobile --throttle`，deploy 工作流里跑 6 页 × 2 次，
把「真实手机首屏」写进 log 与 `::notice::`，**只记录不挡发布**（弱网 LCP 受 runner 负载影响 ±30%）。

> **踩坑**：这步第一次上线时只写了 `exit 0`，以为就「不挡发布」了，结果 GitHub 默认
> `bash -e` 在 `npm run` 非 0 时就先退出——默认预算（CLS 0.1 / LCP 6000）在 2 核 runner 的
> 弱网档下被顶超，整条部署直接变红，而「失败诊断」打印的是 `unknown step`（这步不在
> OUTCOMES 清单里）。现在：`continue-on-error: true` + `set +e` + 预算放到 0.5 / 30000，
> 并把 `runtime` / `runtime-mobile` / `perf-mobile` / `interactions` 补进诊断清单。

过程中修掉三个「量出来是假的」问题：

1. **本地静态服务器不压缩**：138 KB 的首页在 1.6 Mbps 档下要多传 600 ms，弱网 LCP 被
   「服务器没 gzip」本身污染（实测 1228 ms vs 线上 500 ms）。现在本地服务器按 `Accept-Encoding` 走 gzip。
2. **预热不带节流**：暖机和测量条件不一致，第一页永远比后面慢 1 s（1572 vs 500 ms）。现在预热用同一档节流。
3. **多轮取中位没有逐轮数字**：看不出是「第一轮冷」还是「后面真慢」。现在每轮都打印。

### 图片 LCP：666 篇内容的 cover 指着最大那张派生图（第 74 轮）

弱网基线一跑，两个页面的 LCP 元素是**图片**：

| 页面 | LCP | 元素 | 原因 |
|---|---|---|---|
| `/ai/digest/` | 932 ms | 首张卡片 `IMG` | `loading="lazy"` + 用的是 `.og.jpg`（1200×630） |
| `/photo/` | 824 ms | 相册首图 | 同样 `lazy`，首屏最大元素排队等 |

两处根因不同，都修了：

- **`lightCover` 只剥扩展名**：内容里 666 篇的 `cover:` 直接写成派生图（多为 `.og.jpg`），
  候选于是变成 `xxx.og.thumb.webp` 这种不存在的路径，最终原样返回最大的 `.og.jpg`。
  现在 `coverStem` 先把派生后缀（`.thumb/.w640/.w960/.og/...`）归一化成 stem 再挑最轻的一档——
  `baokemeng-42` 首页卡片从 9.8 KB 的 og 降到 2.8 KB 的 thumb。
- **首屏第一张图不能 lazy**：`/photo/` 相册第一张、`/ai/digest/` 第一张卡片改 `eager` + `fetchpriority=high`，
  其余保持 lazy（第一张按 id 判定，不用可变计数器——重复渲染会错位）。

本机弱网基线（中位）：`/ai/digest/` 932 → 724 ms，`/photo/` 824 → 724 ms。

### 首屏 LCP 是「等一个 15KB 的字体」（第 73 轮）

第 72 轮把 CLS 压到 0.021 后，按顺序处理 LCP：线上 49 页抽查最慢是首页 **1.22–1.48 s**。
拆相位（移动端 1.6 Mbps / 150 ms RTT / CPU 4×，中位数）：

| 项 | 现状 |
|---|---|
| TTFB | 176 ms |
| HTML 完成 | 324 ms |
| LCP 元素 | `H1`（衬线大标题）**1684 ms** |
| 同期资源 | Inter(48KB) 289→782 ms、serif 在它后面排队 |

LCP 元素是衬线标题，而衬线字体（15KB）排在 48KB 的 Inter 后面才到货——**首屏最大元素的绘制
被一个 15KB 的字体卡到 1.6 s**。

A/B（同一环境各 4 次取中位）：

| 方案 | LCP 中位 | CLS |
|---|---|---|
| 现状（不预载） | 1600 ms | 0 |
| 预载 serif（15KB） | **308 ms** | 0 |
| 历史上试过的「预载两个字体 63KB」 | 更慢 ~300 ms（HTML 抢不到带宽） | — |

所以第 70 轮「完全不预载」的结论要修正成：**只预载首屏 LCP 那个字体**。实现用 Vite 的
`?url` 导入（和 `@font-face` 同一个产物哈希，不会变成两份文件），`crossorigin` 必须写，
否则 preload 与 `@font-face` 的请求 destination 不匹配、浏览器会再下一次。

### 兜底只对齐宽度还不够：行盒高度（第 72 轮）

第 71 轮把全站最差压到 0.023 后，把抽查从 21 页扩到 49 页（新增 `--urls=<file>`，
`--explain` 打位移的 `previousRect → currentRect`），立刻抓到两个新目标：

| 页面 | CLS | 位移来源 |
|---|---|---|
| `/en/invest/digest-2026-10-14/` | **0.072** | `DIV.not-prose`（TL;DR 卡片）y 597→628、h 304→272 |
| `/en/invest/digest-2026-05-31/` | 0.034 | 同上 |

看数字就明白了：卡片**整体下移 31px**（上面的正文长高了），同时**自己矮了 32px**
（里面的标签从两行变成一行）。两处同时发生 = 一次字体替换。

原因：第 70 轮的 `size-adjust` 只对齐了**宽度**，没对齐 **ascent/descent**——
行盒高度由这两者决定，而 Instrument Serif 是 1.30em、Times 只有 1.11em、再乘 0.843
只剩 0.97em：大标题换字体的瞬间整块矮 10px 以上，正文换 Inter 时每行再差 1–2px。

修法：给两组兜底补上度量 override（数值 = 网页字体度量 ÷ size-adjust）：

```css
/* Inter Fallback · 100–499 */
size-adjust: 107.1%; ascent-override: 90.6%; descent-override: 22.4%; line-gap-override: 0%;
/* Inter Fallback · 500–549（font-medium 是第二常用档，Inter 比 400 宽 1.4%） */
size-adjust: 108.6%; ascent-override: 89.3%; descent-override: 22.1%;
/* Inter Fallback · 550–900（真 Arial Bold，不是合成粗体） */
size-adjust: 102.3%; ascent-override: 94.8%; descent-override: 23.5%;
/* Instrument Serif Fallback */
size-adjust: 84.3%;  ascent-override: 117.4%; descent-override: 36.8%; line-gap-override: 0%;
```

**第二个坑（同一天抓到的）**：`/en/invest/digest-2026-10-14/` 修完行盒还是 0.072。用
`--explain` 看位移几何，发现下移源是 **`BLOCKQUOTE > P > STRONG` 高度 95→126px**——
一段粗体正文从 2 行变 3 行。原因：兜底字体只声明了一个 `font-weight: 100 900` 的不可变
字面，浏览器只能给粗体画**合成粗体**，实测比真 Inter Bold 窄 3.8%，行数就变了。

修法：把兜底拆成三个字重面（常规 / 500 / 真 Arial Bold），每面各自的 size-adjust。
校验也升级成分字重（400/500/600/700 全测）。

`calibrate-fallback-metrics.mjs` 现在直接把这四个数字一起算出来（不再需要手算），
`check-font-fallback` 也从「只比宽度」升级成「宽度 + 行盒高度都要在 ±2% 内」。

验证：

| 检查 | 结果 |
|---|---|
| canvas 度量：Inter 行盒 1.21em ↔ 兜底 1.21em | 100.0% |
| canvas 度量：Instrument Serif 1.30em ↔ 兜底 1.30em | 100.0% |
| 负向：删掉衬线的 override | 门禁报「行盒高度 71.5%」并 exit 1 |
| 本机重测 `/en/invest/digest-2026-05-31/` | 0.034 → 0.021 |

### 最后一处：行情岛卡片高度跟着指数名走（第 71 轮）

第 70 轮的兜底上线后，全站 CLS 只剩 `/en/invest/` 的 **0.074**。逐帧对比水合前后发现：
卡片高度 **132px → 116px**，正好 16px，导致下面六个板块整体上移，一次位移 0.0694。

原因有两层：

1. SSR 用的是 Wind 兜底的**英文指数名**（`SSE Composite`），接口回来的是**中文名**
   （`上证指数`）—— 名字长度不同，在 7 列网格里换行行数不同，卡片高度跟着变；
2. 卡片是 grid 行里的项，行高由最高那张卡决定，所以**一张卡换行，整行都变高**。

修法（不动数据，只钉高度）：

| 位置 | 改法 |
|---|---|
| 指数名 | `truncate` 成一行 + `title` 显示全名 |
| 说明文字 | `min-h-[34px]` 固定两行高度（兜底快照那句比实时版长一行） |
| 「（非交易时段…）」 | 挪到 `mounted` 之后再渲染（又一处时钟文案，和 `LiveHoldings` 同类） |

线上实测（每次 3 轮 × 3 次，共 9 次）：`/en/invest/` CLS **0.074 → 0.003**，全站最差
降到 **0.023（/invest/etf/，数据填充的亚像素变化）**。

**同时把 CI 的性能门禁收回来**：第 68 轮因为 Linux 上的 FOUT 误报把它降成 advisory，
现在机制修掉了、实测 0.017，于是改回硬门禁，但预算放宽到 `--cls=0.12 --lcp=8000`
（约 7 倍余量）—— 真退化会被拦，runner 抖动不会挡发布。

### metric-matched fallback：把 FOUT 抖动按住（第 70 轮）

第 69 轮留下的悬念是「CI 上 `/en/hike/` CLS 0.103，本机 0.005」。这轮先把**机制**验证
清楚，再决定要不要动字体。

对照实验（`/en/hike/`，字体延迟 700 ms 模拟 FOUT）：

| 情况 | CLS |
|---|---|
| A 正常兜底（macOS 系统字体，宽度接近 Inter） | 0.005 |
| B 兜底换成明显更宽的字体（模拟 Linux 上落到 DejaVu Sans） | **0.233** |
| C B + metric-matched fallback（`size-adjust: 92.5%`，按该兜底字体标定） | **0.006** |

也就是说这个机制**足以解释** CI 与本机那 10–20 倍的差距：`font-display: swap` 先用宽度
不同的系统字体画，字体到货后重排，行数一变整页就跳。

落地做法（**不改字体文件本身，只加兜底面**）：

```css
@font-face {
  font-family: "Inter Fallback";
  src: local("Arial"), local("Helvetica"), local("Liberation Sans"), local("Segoe UI");
  size-adjust: 107.1%;          /* calibrate 脚本量出来的 Inter/Arial 宽度比 */
}
@font-face {
  font-family: "Instrument Serif Fallback";
  src: local("Times New Roman"), local("Georgia"), local("Liberation Serif");
  size-adjust: 84.3%;
}
```

字体栈改成 `"Inter", "Inter Fallback", ui-sans-serif, …`、`"Instrument Serif", "Instrument Serif Fallback", …`
（tailwind 的 `fontFamily.serif` 同步）。

配套两个脚本：

| 脚本 | 作用 |
|---|---|
| `scripts/calibrate-fallback-metrics.mjs` | 量「网页字体 / 本机兜底字体」宽度比，输出 size-adjust；本机没装的字体（DejaVu、Roboto、Liberation）会明确标注「需在该平台标定」 |
| `scripts/check-font-fallback.mjs`（进 gate） | 真实浏览器里比较「拦住 woff2 的兜底渲染宽度」与「正常加载后的宽度」，偏离 ±2% 直接红 |

负向验证：把 Inter 的 `size-adjust` 改成 120%，门禁报「兜底/网页宽度 = 112.0%」并 exit 1。

**结果（关键证据）**：上线后 CI 的 `smoke/runtime` commit status 直接读出来——

| 提交 | CI 全站最差 CLS |
|---|---|
| 修复前（`851bae31`） | **0.103（/en/hike/）** |
| 修复后（`36629296`，含本轮的兜底） | **0.017（/invest/etf/）** |

`/en/hike/` 从「全站最差」直接掉出榜单，说明 Linux runner 上 `local("Arial")` 确实
通过 fontconfig 落到了度量兼容的字体，也说明那个 0.103 就是 FOUT 重排，不是别的玄学。
这条通道（commit status 的 description）是第 68 轮建的，这轮第一次靠它拿到决定性数据。

### 把「跨时段水合」变成常规门禁（第 70 轮）

第 69 轮那个 #418 是靠手工拨浏览器时钟才抓到的，不能每次都靠运气。这轮做了两件事：

1. `scripts/check-hydration.mjs` 自己起静态服务器（不用再手动 `serve-dist` + `BASE_URL`），
   可以直接进 gate；
2. 新增 `--cross-time`：每个带岛的页面在正常时钟之外，再用**周五 12:00（北京，净值窗口
   内）**和**周六 12:00（休市）**两个假时钟各水合一次，任何 hydration mismatch 立刻红。

gate 里现在有两个互补的检查：

| 检查 | 层次 | 抓什么 |
|---|---|---|
| `check:ssr-clock` | 静态，扫 1195 个 HTML | 时钟文案有没有漏进 SSR（不跑浏览器，秒级） |
| `check:hydration --cross-time` | 浏览器，7 页 9 个岛 × 3 个时钟 | 岛崩没崩、水合对不对（48 s） |

负向验证：把 `LiveHoldings` 的 `mounted` 守卫去掉再 build，`check:hydration --cross-time`
立刻在 `/invest/` 报 `周五 12:00（北京…）：pageerror: React error #418` 并 exit 1；
加回守卫后恢复全绿。gate 总时长从 ~1m25s 变成 ~2m14s。

### 最难发现的一类 bug：SSR 里塞了「现在几点」（第 69 轮）

第 69 轮收尾复测线上时，`/invest/` 报 **pageerror: Minified React error #418**
（hydration mismatch，text 不一致）——**每次访问都有一条**，只是前端不白屏，所以一直
没人发现。这个 bug 是第 67 轮「持仓表 SSR 直出」带出来的：以前整块是骨架屏，那段依赖
时钟的文案根本不会进 HTML。

原因：`isFundNavRefreshWindow()` 在**构建时刻**算一次、在**访问时刻**再算一次，中间的
文案是「（净值发布窗口，每 5 分钟检查）」/「（当前不在净值发布窗口）」。只要访问时间
跨过 09:30–22:30 的边界，两次文本就不同 → React 直接抛 #418。

验证方法（关键是让两个时刻不一致，否则本地永远撞不上）：

| 浏览器时钟 | 结果 |
|---|---|
| 与构建时刻相同 | 修前也报错（构建恰好落在窗口外） |
| 周五 12:00 北京（窗口内） | **修前报 #418，修后干净** |
| 周六 | 修前报错，修后干净 |

修法两条，都是「等挂载后再渲染」：

1. `LiveHoldings`、`EtfLiveTurnover` 各加 `const [mounted, setMounted] = useState(false)`
   + `useEffect(() => setMounted(true), [])`，时钟文案用 `mounted &&` 包起来；
2. 新增门禁 `check:ssr-clock`（`scripts/check-ssr-clock.mjs`）：静态扫全部 1195 个 HTML，
   只要出现「净值发布窗口 /（未开盘）/（已收盘）/（周末休市）/（午间休市）/（回退缓存）/
   刷新中…」就报错。这类 bug 靠肉眼看组件看不出来，靠「访问时刻恰好跨边界」才能复现，
   所以必须变成静态规则。

交互自检也加了一条：`投资页：跨时段访问不报 hydration 错误`——把浏览器时钟拨到周五
12:00，并断言 SSR HTML 里没有时段文案（结构性断言，与构建时刻无关）。负向验证过：
去掉 `mounted` 守卫后这条场景立刻失败。

### 慢设备才暴露的抖动：ETF 成交表（第 69 轮）

CI 报 `/en/hike/` CLS 0.103、本机同页只有 0.005 —— 这个差距不能只当 CI 噪声。加了两样东西：

1. `check:runtime --cpu=N`：用 CDP `Emulation.setCPUThrottlingRate` 把 CPU 降速，模拟
   中低端手机 / 2 核 runner。**4 倍降速**下本机立刻复现出一批「快机器上看不见」的问题。
2. 用降速跑核心页面，发现 `/invest/etf/` CLS **0.066**：SSR 先画 360 px 骨架屏，
   数据到了变表格、失败又缩成一张小卡片 —— 两次高度突变。

修法和第 67 轮的持仓表一样：**SSR 就该把能画的东西画出来**。12 只宽基 ETF 的代码和
名字本来就在 `src/data/etf-registry.json`（和 `/api/market/etf` 同源），缺的只是价格和
成交额。现在 `rows = data ?? REGISTRY_ROWS`，缺的格子显示「—」，失败只加一条提示带。

| 指标 | 修前 | 修后 |
|---|---|---|
| `/invest/etf/` CLS（4 倍降速） | 0.066 | **0.016** |
| 全站最差 CLS（正常，线上 21 页） | 0.066 | **0.015** |

**这里踩了个自己挖的坑**：第一版修法上线后线上 CLS 反而变成 **0.077**。原因是接口
`/api/market/etf` 返回的是**按今日成交额排好的行序**（盘中还在变），SSR 却按 registry
顺序画 —— 水合瞬间 12 行整体换位，位移全落在可视区里，比原来的骨架屏塌缩还糟。

改法：**行序钉死在 registry 顺序**（按跟踪指数分组），不跟接口顺序走。顺带修掉一个
UX 问题：以前每 60s 轮询一次表格就重排一次，正在读的那行会突然跳走。排行信息仍然
由「vs 昨日全天」那一列的进度条表达。验证：接口按反序返回时 CLS 也是 0.000。

守卫：交互自检新增「ETF 页：成交表由 SSR 直出」（断言 SSR HTML 有 ≥10 只 ETF、无 360 px
骨架屏），`tests/holdings-ssr.test.ts` 同时锁住两个表格组件不许回退。

**`/en/hike/` 的 CI 0.103 仍无定论**：本机把字体延迟 800 ms、CPU 降 10 倍、网络压到
1.6 Mbps 都只测到 0.005。最可能的原因是 Linux runner 上没有 Inter，`font-display: swap`
的兜底字体（DejaVu Sans 比 Inter 宽）导致整段文字换行数变化；本机 macOS 兜底字体宽度接近
Inter，所以复现不出来。metric-matched fallback（给兜底字体加 `size-adjust`）能解，但
需要按平台分别标定，本轮先记下来，不盲改字体。

### CI 可观测性：性能指标降为 advisory + commit status 通道（第 68 轮）

第 67 轮连挂两次部署，根因是「新加的性能断言当成了发布闸门」+「日志读不到」。两件事
一起改：

| 改动 | 内容 |
|---|---|
| `check:runtime --soft-vitals` | LCP/CLS 超标只打印 `⚠ …`，不算失败。CI 用这个模式 |
| 硬门禁保留 | pageerror / console.error / 同源 4xx-5xx 仍然 exit 1——这些不受环境噪声影响 |
| `scripts/report-ci-status.mjs` | 三步自检（桌面/手机/交互）跑完各发一条 commit status，description 里带「21 页 · CLS 0.066 · LCP 932 ms」或「失败：/invest/」 |

为什么用 commit status：Actions 日志接口对无管理员权限的账号返回 **403**，
`::error::` annotations 在 API 里只回一条 `Process completed with exit code 1`，
artifact 下载 **401**。而 `GET /commits/{sha}/statuses` 可以匿名读——等于给 CI 装了
一个只读仪表盘，失败原因直接写在 description 里（上限 140 字符，脚本自动截断）。

本地验证：`--cls=0.01` 时 `--soft-vitals` 打印 `⚠` 且 exit 0，不加则 exit 1。

另外装了 Playwright 自带的 Chromium（`PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers`）
来贴近 CI 环境；本地跑 headless shell 仍然 21 页全绿，数值与系统 Chrome 一致。

**通道一开就把盲区照亮了**：`386481c5` 的三条 status 读出来是

| context | 内容 |
|---|---|
| `smoke/runtime` | CLS 最差 **0.103（/en/hike/）** · LCP 最慢 248 ms · 长任务最多 **110 ms（/hike/travel/ali-grand-loop-2026/）** |
| `smoke/runtime-mobile` | 12 页全绿 |
| `smoke/interactions` | 14/14 场景通过 |

也就是说第 67 轮两次打回的直接原因就是 **CI 上 `/en/hike/` 的 CLS 0.103**（本地同一页只有
0.005）——地图页在慢机器上初始化更晚，抖动被算进首屏。这条线索留给下一轮：
要么让地图片段预留高度，要么继续把它当 advisory。

### 修掉线上最大的一处布局抖动：持仓表（第 67 轮）

第 66 轮把 CLS 量起来之后，`--base=` 直接对着线上跑，抓到 **`/invest/` 与
`/en/invest/` 桌面 CLS 0.069–0.073**，是全站唯一的超标项。归因（`entry.sources`）：

| 位置 | 变化 |
|---|---|
| 第 5 个 section「模拟组合 / Simulated portfolio」 | 488 px → **1010 px**（水合后） |

原因：`LiveHoldings` 在拿到 `/api/market/funds` 之前直接 `return <420px 骨架屏>`。
可持仓的代码、名称、份额是**构建时就有**的，缺的只有净值那几列——等于把已知内容
推迟到水合后，整块长高 500 多像素，下面所有板块被推下去。

修法：SSR 就把表格画出来，缺的格子显示破折号；失败时只加一条提示带（不再整块不渲染）。
实测 `/invest/` 桌面与手机 CLS 都回到 **0.000**。

配套守卫：

1. 交互自检新增「投资页：持仓表由 SSR 直出」——直接断言服务端 HTML 里有 ≥8 行持仓、
   且不含 420 px 骨架屏，跟水合时机无关，稳定可复现（用旧版构建跑会直接失败）；
2. `tests/holdings-ssr.test.ts` 锁住组件不许再写 `h-[420px]` 骨架屏/`if (!quotes) return`。

### 第二处抖动：`/en/invest/` 的 0.073（第 67 轮，已收手）

`/invest/` 修好后线上归零（0.073 → 0.002），但 `/en/invest/` 仍报 0.073，且**不稳定**：
5 次测量里 4 次复现、1 次为 0。

逐帧追踪 section 高度（40 ms 采样）：

| 时刻 | 高度（section 0/1/2/3） | 事件 |
|---|---|---|
| 112 ms | 164, 151, **229, 161** | SSR 内容 |
| 272 ms | 164, 151, **245, 177** | 字体就绪后（`document.fonts.status=loaded`） |
| 435 ms | 164, 151, **213, 145** | 稳定 |

变化量正好是 16 px 的整数倍（行高），所以不是图片/骨架屏，而是「Today's market」那段
`P.mt-3` 小字在**字体切换 + 水合**过程中行数变化（2 行 ↔ 1 行），带动下面两个 section 平移。

先加的 `min-h-[92px]`（指数卡片定高）是**防御性**改动，实测并没有消掉这 0.073
——已部署但**不是**这个抖动的解药，别记错因果。

收手的理由：**0.073 低于 Core Web Vitals 的 good 线 0.1**，剩下的收益很小、代价是给
小字预留空白或者改字体加载策略（会影响全站排版）。要看数值随时可以跑
`node scripts/check-runtime.mjs --vitals --base=https://www.zorotreeking.online`。

顺带：CI 里 CLS 预算放宽到 **0.25**（`--cls=0.25`）。原因不是偷懒——CI 用 Playwright
自带的 headless Chromium、本机用系统 Chrome，两者布局/时序不同，`/invest/etf/` 的
错误态折叠在 CI 上会超过 0.1；0.25 仍能拦下 0.232 那类结构性抖动，但不会假红挡发布。

**教训**：CLS 不用猜，`entry.sources` 会直接点名是哪个 section；但「量出来」之后
要判断的是**该不该在 SSR 交白卷**，而不是给骨架屏调高度。

### 核心指标进自检：LCP / CLS / 长任务（第 66 轮）

`check:runtime --vitals` 在打开页面的同时采集 Core Web Vitals，`deploy.yml` 的桌面轮次已带上：

| 指标 | 处理 | 本地实测（21 页） |
|---|---|---|
| CLS | **硬指标**，>0.1 直接失败（布局抖动是结构问题，不随机） | 20 页 0；`/invest/etf/` **0.066** |
| LCP | 只拦明显异常（默认 6000 ms，`--lcp=` 可调），因为冷启动/机器差异大 | 64–1500 ms |
| 长任务 | 只提示 | 全站 0 ms |

两个测量陷阱，记下来免得下次误判：

1. **浏览器冷启动会被算进 LCP**：全新 browser 的第一次导航 LCP 会是 1.5–1.9 s，
   预热一次后同一页面稳定在 64–164 ms。所以看 LCP 必须先预热，别拿首测数据下结论。
2. **CLS 归因要看 source 元素**：`/invest/etf/` 的 0.066 来自 187 ms 时
   `SECTION.max-w-5xl …pb-6/pb-8` 的高度变化——那是 ETF 岛从 360 px 骨架屏切成
   「实时成交加载失败」小卡片（本地没有 `/api/market/etf`）。生产上接口正常时这条路径
   不触发，实测 CLS 0。

第 66 轮上线时还踩了一次：带上 `--vitals` 之后**部署被打回**（`ece8b6b6`），
生产停在上一版。仓库没开管理员权限，Actions 日志接口是 403，看不到到底哪条断言挂的。
处理办法：

1. 给运行时自检加**预热导航**（全新 browser 第一次导航 LCP 1.5–1.9 s，第二次起
   64–164 ms），并把 LCP 上限放宽到 6000 ms（`--lcp=` 可调）；
2. 失败时在 workflow 里用 `::error::` 把诊断打进 **annotations**——日志读不到的时候，
   注释接口还能读，以后不用再盲猜。

这个 0.066 低于预算，**故意不改**：要消掉它就得给错误提示预留 360 px 的空盒，
用户看到的大片空白比一次轻微抖动更糟。

### 行情岛接入自检 + 移动视口运行时检查（第 65 轮）

| 新增 | 断言 |
|---|---|
| 行情岛：接口数据**覆盖** SSR 兜底 | `/api/market/indices` 返回哨兵指数「桩指数 12,345.67」→ 页面必须出现它（组件有 SSR 兜底数据，不覆盖就等于接口没生效） |
| 行情岛：接口 500 时保留兜底 | 桩数据不得出现，同时指数卡片不能整块消失（≥3 张） |
| `check:runtime --mobile` | 手机视口（390×844）抽查 12 个关键模板：导航折叠、图表 2 列网格、灯箱全屏只在窄屏出现 |

移动端这一遍接进了 `deploy.yml`（`exit 2` 同样降级为 warning），成本约 40 秒。

负向验证：把「覆盖」场景的指数接口改成 500，脚本报
`指数接口返回后没有覆盖 SSR 兜底数据（页面上找不到「桩指数」）` 并 exit 1。

### 交互自检扩到 11 个场景：手机真机路径 + 接口失败重试（第 64 轮）

| 新场景 | 断言 |
|---|---|
| 手机灯箱关闭按钮 | `tap` 首图 → 点 `.pswp__button--close`（真机没人按 Esc）→ `.pswp--open` 消失 |
| ETF 接口失败 → 重试成功 | 首次 `/api/market/etf` 返回 500 → 出现「重试」按钮 → 点它 → 表格渲染出**桩数据哨兵名** |

ETF 场景需要按调用次数返回不同结果，所以桩机制从「固定响应」升级成
`scenario.api = { "/api/market/etf": (call) => ({ status, body }) }`。

断言必须用真实数据里不可能出现的哨兵值（`桩数据ETF` / `999999`）。第一版用了
`沪深300ETF`，结果负向验证（接口恒 500）照样"通过"——因为该组件有 SSR 兜底数据，
真表里本来就有这个名字，断言形同虚设。换成哨兵值后，恒 500 能稳定报
`点重试后没有渲染出接口返回的 ETF 数据`（exit 1）。

### 内容日期卫生：`updated` 跟不跟得上真实编辑（第 63 轮）

sitemap 的 `lastmod` 取 frontmatter 的 `updated ?? date`，而这个字段只能靠作者手工改。
忘了改的后果：正文更新了，sitemap 还说没变，搜索引擎按旧时间调度重抓。

新增 `scripts/check-content-dates.mjs`（`npm run check:dates`，已接入 `npm run gate`，
只报告不阻断；`--strict` 才当硬门禁）。判定条件三个同时满足才报：

1. 文件最后一次提交比 `updated ?? date` 晚 14 天以上；
2. 那次提交动的内容文件 ≤ 5 个（一次改上百个文件的是批量重构，不算内容更新）；
3. **正文指纹变了**（`scripts/lib/prose-fingerprint.mjs`：去掉链接、HTML/JSX 标签、
   裸 URL、markdown 符号和空白后取 sha256）。

第 3 条是这轮最关键的设计。最初的版本只按 1+2 判定，报出 2 篇，但人工看 diff 发现
两篇都是**机械修复**——一篇把失效外链 <a> 去掉、一篇把写坏的 `<FeedbackButtons
client:visiblevisible}}` 补成自闭合。正文一个字没变。如果按提醒去补 `updated:`，
等于系统性对搜索引擎说谎，所以加了指纹比对。

最终结果：**1052 篇内容全部干净**，两个真实误报被指纹正确排除。

### 搜索性能实测：不需要重写（第 62 轮）

上一轮把「pagefind 索引 15 MB，考虑裁剪」列成了待办。本轮先量，结论是**不用动**：

| 指标 | 实测（生产） |
|---|---|
| 页面初始加载的 JS | **7 KB**（搜索面板的 React chunk 完全懒加载，点开才拉） |
| 悬停/聚焦意图预取 | 已有（`pointerover` / `focusin` / `touchstart`） |
| 点击 → 弹窗可见 | 89–126 ms（冷缓存） |
| 输入 → 首条结果 | 166–273 ms（桌面 / 手机） |
| 单次搜索实际下载的 pagefind 索引分片 | **33 KB**（不是 15 MB，15 MB 是全站索引在磁盘上的总量） |
| 单次搜索新增总字节（未压缩） | ~473 KB，其中 React+DOMPurify 247 KB、pagefind 代码 149 KB、摘要片段 44 KB、索引分片 33 KB |

「预热 pagefind（悬停即 init）」的 A/B 只省 20–44 ms，收益不足以抵消复杂度，不做。
React 那 247 KB 是搜索面板的固有成本，改成原生实现能省下来，但当前首结果已 <300 ms，
重写风险大于收益——除非以后搜索成为主要入口再动。

### 相册索引页改用真实封面 + 「默认卡」红线（第 62 轮）

`/photo/` 和 `/en/photo/` 之前分享出去是站点通用图（`og-default.png`），而这两页明明
有现成封面。现在取第一个相册的 1200×630 `.og.jpg`。`check-og` 增加一条红线：
这两页若落到默认卡就**报错**（其它页面落默认卡是合法的兜底，不报）。

顺带把交互自检扩到手机视口与键盘入口：

| 新场景 | 断言 |
|---|---|
| 键盘 `/` 唤起搜索 | 弹窗出现且输入框自动聚焦 |
| 手机搜索（390 宽 + 触屏） | 点按钮 → 输入 → 出结果 |
| 手机灯箱（390 宽） | `tap()` 首图 → `.pswp--open` 出现 |

### 交互自检：加载不报错 ≠ 交互不报错（第 61 轮）

`check-runtime` 只覆盖「打开页面」这条路径。本站真正的交互都在岛里：搜索（pagefind）、
灯箱（PhotoSwipe）、点赞（乐观更新 + `POST /api/feedback`）、深浅色切换——这些代码
只有真的点下去才执行，水合失败、事件没绑上、接口结构变化都只能这样发现。

新增 `scripts/check-interactions.mjs`（`npm run check:interactions`），6 个场景中英各半：

| 场景 | 断言 |
|---|---|
| 搜索 → 输入关键词 | `[role=dialog]` 里确实出现结果链接；Esc 后弹窗关闭 |
| 点相册首图 | `.pswp--open` 出现；Esc 后消失 |
| 点赞 | `aria-pressed` 变 `true`，且真的发出 `POST /api/feedback` |
| 主题切换 | `<html>` 的 `dark` 类翻转 |

`/api/*` 用 `page.route` stub 一份最小契约（GET 3/1、POST 4/1），这样「乐观更新 → POST →
用返回值刷新」整条链路在静态产物上也能验证。退出码同 `check-runtime`：0 通过、1 场景失败、
2 环境不可用；已接入 `deploy.yml`。

两个坑：
1. 搜索场景最初在 `domcontentloaded` 后立刻点击，岛还没水合，点了没反应 → 改成最多 6 次
   重试点击（每次间隔 400ms），直到输入框出现；
2. 最初断言用 `.search-results a`，实际结果就是弹窗里的普通 `<a>`（没有这个 class）
   → 改为 `[role="dialog"] a[href]`。

### 运行时自检：把「页面在浏览器里报错」纳入发布门禁（第 60 轮）

已有的三类检查都看不到运行时问题：`check:seo` 读 HTML 文本、`check:og` 读 `<head>`、
`a11y-audit` 只跑 axe 的 DOM 规则。而 React island 水合抛错、图表组件访问 `undefined`、
懒加载资源 404，这些只在浏览器里才暴露，表现是「局部空白/点了没反应」。

新增 `scripts/check-runtime.mjs`（`npm run check:runtime`）：

- 起一个与 nginx 行为一致的静态服务器，用真实 Chromium 打开 19 个代表页面
  （首页、四个板块、日报归档、ETF、个股、相册索引 + 相册、游记、标签页、`/uses`、错误页，
  中文 + 英文各一套）；
- 抓三类问题：`pageerror`、`console.error`、同源 4xx/5xx 响应；
- 退出码分三种：0 通过、1 页面真的报错、2 环境不可用（dist 没构建 / 浏览器缺失）。

线上现状：19 个页面 **0 报错、0 控制台错误、0 失败请求**。反向验证过——往 `/ai/` 里塞一句
`throw new Error("boom from test")`，脚本报 `pageerror: boom from test` 并 exit 1。

接在 `deploy.yml` 里（每 push 都跑，约 60–90s），exit 2 降级为 warning、exit 1 卡住发布；
**没有**接进 `npm run gate`：本地门禁已经很重，而这一步需要 Chromium。

目标页清单里**不写死标签 slug**（`/tag/ai/` 其实不存在，真实 slug 是 `ai-papers` 这类），
而是从 `dist/tag` 里挑第一个真实目录；清单里的页面若不存在会打印警告、超过一半不存在直接 exit 2，
避免「板块改名 → 少查几页 → 报告仍然通过」。

一个坑：首版把「请求失败」也当成页面缺陷，结果 19 页全红——`/api/track`、`/api/feedback`
是服务器端接口（nginx 反代），静态 dist 里本来就没有。现在同源 `/api/*` 一律忽略，
且「Failed to load resource」这条不带 URL 的控制台信息不再参与判定，失败请求只由
response 监听器（能拿到状态码和路径）精确判断。

### 1080px 档照片接上 mid 档 + srcset 同宽度去重（第 59 轮）

mac1 整册是 1080×1440 的图：宽度不到 1200，所以既没有 hero 也没有 mid，首图只能拿
q80 的原尺寸 webp（121 KB）。把 mid 门槛从 `>1200` 放到 `>1000`（`withoutEnlargement`，
1080 的原图就停在 1080，只降质量到 q76）后：

| 场景 | 改前 | 改后 |
|---|---|---|
| `/photo/mac1/` 首图（1440@1x / 1024@1x / 768@2x） | 121 KB（q80 srcWebp） | **105 KB（q76 mid，同 1080px）** |
| `/photo/mac1/` 图片合计（1440@1x） | 242 KB | **228 KB** |
| 相册索引 桌面@2x | 238 KB | **224 KB** |
| 带 mid 档的照片 | 39 / 60 | 54 / 60（54 个文件共 1.5 MB，构建期产物） |

顺带修了 `buildSrcSet` 的一个隐患：原图正好 1080 时，mid（q76，1080w）和 srcWebp
（q80，1080w）**宽度相同**，两个同名描述符同时出现时浏览器选哪个是未定义行为。
现在按宽度去重、先到先得，而调用方总是先传更省字节的候选，所以留下的一定是 mid。
新测试锁住这个行为。

### sitemap 审计 + 相册图片进图片搜索（第 58 轮）

sitemap 现状（审计结论：基本健康）：

| 项 | 结果 |
|---|---|
| URL 数 / 唯一性 | 1186 / 1186，无重复 |
| 缺 `lastmod` | 0（本地与生产都是 0；CI 用 `fetch-depth: 0` 才拿得到 git 日期） |
| `lastmod` 未来日期 | 无，范围 2026-04-30 → 2026-11-20 |
| `priority` / `changefreq` | 都不输出 —— Google 早就忽略这两项，不写是对的 |
| 覆盖率 | 与 `check:seo` 的「可索引页面」集合逐条对齐 |

本轮新增：**image sitemap 扩展**。相册页额外输出 `<image:image>`（`image:loc` +
`image:title` + `image:caption`），每册最多 20 张，取派生 `.webp` 而不是原图。
全站 6 个相册页共 62 条图片条目，sitemap 从 131 KB 涨到 145 KB。图片搜索不必再靠爬虫
顺着 `<img>` 猜，尤其相册页的图是懒加载的，抓取优先级本来就低。

`check:seo` 增加两项校验：
1. `image:loc` 必须是本站绝对地址，且文件确实在 `dist` 里（拼错路径的直接报错）；
2. 汇总行修正 —— 之前页面级 0 错误时会打印「通过」，但站点级（sitemap/hreflang/断链）
   有问题照样 exit 1，输出自相矛盾。反向测试（把一条 `image:loc` 改成不存在的文件名）
   现在输出 `0 页有错误 / 0 页只有告警 · 另有 2 个站点级问题 → 失败`，exit 1。

### Feed 审计：RSS 缺自引用、缺 lastBuildDate、一次吐 526 条（第 57 轮）

| 项 | 改前 | 改后 |
|---|---|---|
| RSS 体积 | 260 KB / 526 条 | **23.5 KB / 50 条**（−91%） |
| `atom:link rel="self"` | 无 | 有 |
| `lastBuildDate` / `ttl` | 无 | 最新条目的 UTC 时间 / 60 |
| Atom | 本来合规（50 条、self、updated、author 都有） | 不变 |

RSS 是「每次刷新整份重传」的格式，526 条历史让每个订阅者每天白传 260 KB；和 `atom.xml`
对齐成 50 条不会丢条目——阅读器按 `guid` 保留已读历史。另外缺 `atom:link self` 时，聚合器
认不出规范地址，去重和刷新都不稳。

新增 `scripts/check-feeds.mjs`（`npm run check:feeds`，已接进 gate）：解析两份 feed，查
channel/feed 必填项、`rel=self`、条目必填字段、时间倒序、guid/id 不重复、条数 ≤100。
反向验证过：手工拆掉 `atom:link`/`lastBuildDate` 并把首条时间改成 2001 年，脚本报出 51 个问题、
退出码 1。

### 结构化数据审计：面包屑末级缺 item（第 56 轮）

把 1195 页的 JSON-LD 全量解析了一遍（`breadcrumb@1184 · Article@1046 · CollectionPage@72 ·
WebPage@64 · TouristTrip@8 · WebSite@2 · AboutPage@2`，9 个页面没有结构化数据全是 noindex 页）。

**发现：1184 个页面的面包屑末级都没有 `item`。** 代码里还写着「末级不带 item，与 Google 的推荐
一致」——这是错的。Google 的 Breadcrumb 文档把 `item` 列在 **Required properties** 下
（"URL or a subtype of Thing"），我没有找到任何「末级可省略」的例外条款：

> Required properties: item — The URL to the webpage that represents the breadcrumb.

修法：`breadcrumbJsonLd(trail, sitePrefix, currentUrl)` 多收一个当前页 URL，末级用它补 `item`；
`BaseLayout` 传 `canonicalUrl`。修完全站 1184 个面包屑块的每一项都有 URL，`/en/*` 页面指向 `/en/*`。

**同时补上了漏检**：`check-seo` 的 `ListItem` 规则原来只查 `position`/`name`，所以这个缺口一路
过了门禁。现在面包屑里的 ListItem 缺 `item` 直接报错。

一个被这条新规则误伤的案例：游记页的 `itinerary`（每日行程 ItemList）本来就没有 URL，
第一版把 `item/url` 加成所有 ListItem 的 anyOf 必填，8 个游记页立刻全红。行程条目不是链接，
所以最终只对 `BreadcrumbList` 内的 ListItem 强制 `item`。

### 社媒元信息审计：补 og:locale（第 55 轮）

把 1194 个页面的 `<head>` 全扫了一遍：

| 检查项 | 结果 |
|---|---|
| canonical | 1186 个可索引页齐全，8 个 noindex 页（admin、404、photography 跳转页）没有 —— 符合预期 |
| canonical 与路径不符 | 0 |
| hreflang | 1178 页齐；16 页没有是正常的（中文独有游记、`/changelog/` 等单语页，以及对面的 `/en/photography/` 跳转页） |
| 双向 hreflang | 抽查 `/en/hike/*` 与中文页互指，x-default 指中文，正确 |
| **`og:locale`** | **0 / 1194 —— 全站缺失** |

`og:locale` 和 hreflang 不是一回事：hreflang 给搜索引擎，`og:locale` 给社媒/IM 抓取
（微信、Telegram、Slack 都读）。这次在 `BaseLayout` 补上：

- 中文页 `zh_CN`、英文页 `en_US`；
- 有对应语言版本时再加一条 `og:locale:alternate`（1172 页有，22 页单语页没有，符合预期）；
- 同时补 `og:site_name`。

本地构建后复核：缺 `og:locale` 的只剩 `/admin/`（Decap 自带的单页后台，不走 BaseLayout、noindex）。

顺带否掉一个想法：把相册画廊从 `client:load` 改成 `client:idle`。实测线上相册页
**长任务 0 个、TBT≈0ms、JS 401ms 全部就绪**——画廊 hydration 根本没有阻塞主线程，
改了只是徒增「点了图片但灯箱还没绑定」的窗口，所以不改。

### 补上 1200w 中间档，填平 720 与 1600 之间的空档（第 54 轮）

第 53 轮把索引封面改成带宽度描述符的 srcset 之后，桌面 1x 已经降到 113 KB，但 2x 桌面
和平板仍然只能二选一：720（糊）或 1600（188 KB）。原因是候选里就只有这两档。

新生成 `xxx.mid.webp`（1200w，q76，仅原图宽 >1200 的才生成，39 个文件合计 1.0 MB，
都是构建期产物、不进 git）：

| 场景 | 58 轮前 | 现在 |
|---|---|---|
| 相册详情首图 1024@1x | 188 KB | **113 KB** |
| 相册详情首图 768@1x | 188 KB | **113 KB** |
| 相册索引 桌面@2x | 317 KB | **238 KB** |
| 相册索引 桌面@1x | 317 KB | 113 KB（第 53 轮） |
| 手机 390@2x | 113 KB | 113 KB |

**又踩了一次同一个坑**：把 mid 加进 `coverVariants` 后忘了在手机档排除它，
2x 手机立刻从 113 KB 涨到 178 KB。这说明「手机档要显式排除大图候选」这件事必须靠测试锁住——
现在测试断言手机档 `heroWebp: null, srcWebp: null, midWebp: null` 三者都在。

已知取舍：索引页第一张卡片跨 2 列（实际 833 CSS px），但 `sizes` 写的是 40vw，
所以 2x 屏会选 1200 而不是 1600（1200 放大到 1666 设备像素，轻微偏软）。
保留这个取舍：换 1600 要多付 75 KB，而封面卡片不是正文图片。

### 相册索引页封面不再常驻拉 1600px（第 53 轮）

相册索引页（`/photo/`、`/en/photo/`）的封面卡片宽 576 CSS px，但 srcset 是
「带 media 的单候选、没有宽度描述符」——浏览器只能当 1x 直接下载，于是**桌面端必然拉 1600px hero**：

| `/photo/` 封面图 | 改前 | 改后 |
|---|---|---|
| 桌面 1440@1x | 317 KB（hero） | **113 KB**（720w 缩略图，−64%） |
| 手机 390@2x | 115 KB | 113 KB（不变） |
| 桌面 1440@2x | 317 KB | 317 KB（卡片 2x 需要 1152px，仍取 1600 hero） |

做法：新 `src/lib/photo-srcset.ts` 统一组装 srcset（升序、去重、**真实宽度**描述符），
相册网格和索引封面都用它。索引页保留两档 source：`media (max-width: 640px)` 只给 480/720
（中途一版把 hero 也放进手机候选，2x 手机立刻从 113 KB 涨到 317 KB，实测后加回来这条限制）。

待办：2x 桌面 317 KB 是因为现有档位只有 720 / 1600，中间缺 1200 左右的一档。

### 相册页中英对齐 + 两个真 bug（第 52 轮）

**bug 1：直接上传的 `.webp` 原图拿不到任何派生图。**
生成器里「转 webp / 缩略图 / 480w / hero / og」全都写在 `if (ext 是 jpg|jpeg|png)` 分支里，
`.webp` 上传的文件走不到这些分支，manifest 里只有 `src`/`thumb` 两个字段。
后果：hudieren 里那张 1024×1536 的 webp 在网格里以 **123 KB 全图填 413px 的格子**。
修法：分支只负责「要不要转 webp」，派生图统一对所有来源生成。修完那张图 → 21 KB（−102 KB），
hudieren 相册页 416 → **274 KB**（−34%）。

**bug 2：英文相册页和中文页漂移。**
英文页写死 `cover = photos[0]`、忽略 `frontmatter.cover`，而且 `<img src={cover.srcOg ?? cover.src}>`
——`srcOg` 是 1200×630 的社交卡片裁切图，浏览器不支持 webp 时显示的是被裁过的图却按原图宽高占位。
表现：baokemeng 中文页首图 9 KB hero、英文页 85 KB 原图。
修法：抽 `src/lib/photo-cover.ts` 的 `pickAlbumCover()` 给两个页面共用；英文页改用 `cover.src`；
顺手补齐英文页缺的 GPS 地图和深底 feedback 图标配色。现在三本相册中英文首图与字节数完全一致。

| 相册页（桌面 1440@1x，滚到底） | 改前 | 改后 |
|---|---|---|
| hudieren 中/英 | 416 KB | **274 KB** |
| baokemeng 英 | 401 KB | **244 KB**（与中文页一致） |
| mac1 中/英 | 242 KB | 242 KB |

另外把 hero 变体的生成阈值从 `width > 1600` 降到 `width > 1200`：1200–1600px 的照片原先
详情页首图只能拉 q80 全尺寸 webp。核对过 35 个有 hero 的条目，**没有一个 hero 比全尺寸 webp 大**。

新增断言：`width > 720 必须有 thumbWebp / > 480 必须有 thumbSm / ≥ 1000 必须有 srcOg /
> 1200 必须有 heroWebp`。这条不变量正好能挡住 bug 1 —— 它当初不报错，只是悄悄少传了字段。

### 相册网格按屏幕给不同宽度的缩略图（第 51 轮）

之前相册网格只有一档 720w 缩略图：**1x 桌面三列每格只有 ~400 CSS px、1x 手机单列 ~390 CSS px，
都在拉 720w**，白白多传四成。第 51 轮加了 480w 档（q74）+ `srcset`/`sizes`：

| 场景 | 改前 | 改后 |
|---|---|---|
| 桌面 1440@1x（三列） | 401 KB | **244 KB**（−39%，全部命中 480w） |
| 手机 390@1x（单列） | ~400 KB | **238 KB**（−41%） |
| 桌面 1440@2x | 401 KB | 401 KB（需要 800px，仍取 720w，符合预期） |
| 手机 390@2x | 394 KB | 394 KB（同上） |

实现要点：

- 生成器在 `width > 480` 时多产一张 `xxx.thumb480.webp`（q74）；59 张 580 KB，比 720w 档的 876 KB 小 34%。
- `srcset` 的宽度描述符用 `Math.min(720, width)` / `Math.min(480, width)`——原图本来就窄时（如 600px 图）
  不能虚标成 720w，否则浏览器会在 1x 屏上也挑它。
- `sizes` 与列数严格对应：`(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw`；
  改布局列数时必须同步改这一行（测试里断言了这条字符串）。
- `.thumb480.webp` 已加入清理脚本、图片预算白名单、manifest 卫生测试的派生后缀表。

### 站内链接自检进 gate（第 50 轮）

线上把 1190 个内链全扫了一遍（10 线程 GET，约 2 分钟）：**1190/1190 全部 200**，无死链。
顺带确认了两件事：

| 检查项 | 结果 |
|---|---|
| `/photo/baokemeng` → `/photo/baokemeng/` | 301，符合预期 |
| `/about` → `/about/` | 301，符合预期 |
| `/index.html`、`/photo/x/index.html` | 200（nginx 不重定向），但页面 canonical 指向无 `index.html` 的正式地址 → Google 会合并，风险低 |
| 不存在的路径 | 404（错误页 118 KB，偏大但少见） |
| `_astro/*.js` | `max-age=31536000, immutable` ✅ |
| HTML | `max-age=300, must-revalidate` ✅ |
| 图片 | `image/webp` + `max-age=300`（曾误以为 MIME 错了，实际是探了个不存在的路径拿到 404 HTML，记一次假警报） |

线上爬虫不适合进 CI（要打上千请求、依赖部署状态）。真正能防回归的是**产物级**检查：
新增 `npm run check:links`，扫 `dist/**/*.html` 的 `href`/`src`/`srcset`（含 `imagesrcset`），
把站内路径映射到磁盘文件确认存在，1.8 秒跑完 1195 个页面 / 1362 个目标：

```bash
npm run check:links            # 有断链退出 1（已在 gate 里）
npm run check:links -- --warn   # 只报告
```

第 49 轮那次「派生图被当照片」的乌龙，如果当时已有这个检查，本地 manifest 里的
`.og.w640.webp` 会立刻被报出来（文件不存在），不用等页面重量异常才发现。

### 相册缩略图降到 q74，以及一次「本地垃圾被当成照片」的乌龙（第 49 轮）

按你选的保守方案，`.thumb.webp` 的质量从 78 降到 **74**：

| 指标 | q78 | q74 |
|---|---|---|
| 69 张缩略图合计 | 1.07 MB | 0.76 MB（−29%） |
| 最大一张 | 81 KB | 72 KB |
| 相册网格首屏（`/photo/` 手机） | 127 KB 图 | **115 KB** |

**改动陷阱**：缩略图的生成守卫是「缩略图 mtime ≥ 原图 mtime 就跳过」。只改质量常量不会重新生成，
必须删掉旧文件。为此加了 `npm run clean:derived`（只删 `.thumb.webp` / `.hero.webp` / `.og.jpg` /
`w640`+`w960` 变体，原图一律不动，带 `--dry-run` 先看）：

```bash
npm run clean:derived -- --dry-run   # 将删除 171 个派生图片（4.3 MB）
npm run clean:derived                # 真删，下次 build 重新生成
```

顺带抓到一个**只在本机存在**的问题：本地 `public/photos/` 里躺着上一轮试验留下的
`.og.w640.webp` / `.w960.webp`（派生图的 webp 变体），manifest 扫描按后缀过滤没拦住它们，
于是被当成「新照片」写进 manifest——本地 `/photo/baokemeng/` 因此为同一张图多下了 3 个变体
（34 + 26 + 19 KB）。

处理：
1. 扫描规则改为「文件名任意位置出现 `.og.` / `.thumb.` / `.hero.` / `.w640.` / `.w960.` 一律跳过」；
2. `clean:derived` 覆盖这类派生-of-派生；
3. `tests/photo-manifest-hygiene.test.ts` 增加派生段检测。

**生产一直是干净的**（线上 `/photo/baokemeng/` 只有 48 帧、没有任何 `.og.w640.webp` 引用），
因为 CI 从零构建、不会带上本地残留。这一点在排查时先核对过线上，避免了误报成线上事故。

### 页面重量普查：钱花在哪很清楚了（第 49 轮）

CI 只盯 15 个 URL 的 Lighthouse 分数，没人看「一个页面到底传了多少字节」。这轮用手机视口
（390×844、DPR2）把主要页面量了一遍，按资源类型拆开（`transferSize`，含压缩后大小）：

| 页面 | 合计 | 主要构成 |
|---|---|---|
| `/` | **138 KB** | HTML 28 + **字体/CSS 102**（Inter 48、JetBrains Mono 40、Instrument Serif 15） |
| `/photo/` | 153 KB | HTML 26 + 图片 127（两张 `.thumb.webp` 66 + 57） |
| `/invest/` | 123 KB | HTML 34 + JS 88（React `client` 64 + 看板组件 24） |
| `/photo/baokemeng/` | 111 KB | HTML 40 + 图片 61 |
| `/hike/sample-route/` | 83 KB | HTML 36 + JS 46（Leaflet 43） |
| `/invest/us-market/` | 41 KB | HTML 33 + JS 6 |
| `/invest/etf/` | 35 KB | HTML 31 + JS 3 |
| `/archive/`、`/ai/`、`/en/`、`/hike/`、`/tag/photo/` | 25–34 KB | 基本只有 HTML |

两个发现：

1. **字体是首页最大的单项**（102 KB）。三个 family 加起来比所有 JS 都贵，而首页的 JS 只有 5–8 KB。
2. **相册列表的两张缩略图各 66/57 KB** —— `.thumb.webp` 是 720w、q78 生成的，对首屏两张卡来说偏肥。

**测量陷阱**：这些页面共用一个浏览器上下文，**只有第一个页面是冷缓存**，后面的脚本字节数会掉到 0。
跨页面比较时要么每页新开上下文，要么只信第一页的数字——否则会得出「后半站几乎不加载 JS」的错误结论。

改进方向（需拍板）：
- 字体：把 Inter / JetBrains Mono 换成系统字体栈（省约 90 KB），或做子集化（保留外观，省约 40–60 KB，需引入 fonttools 流程）；
- 相册缩略图：把 `.thumb.webp` 的质量从 78 降到 70 左右（视觉差异很小，约省 30–40%）。

### 让「词典漏了新板块」自己冒出来（第 49 轮）

第 48 轮的词典有个天然缺陷：Wind 每天返回的 20 个板块是轮换的，哪天冒出一个没收录的名字，
英文页会安静地回落成中文——**没有报错、没有测试失败，只能靠用户投诉发现**。

`scripts/check-sector-names.mjs`（`npm run check:sectors`，已进 `gate`）：

| 模式 | 行为 | 用在哪 |
|---|---|---|
| 默认 | 列出未覆盖板块，**警告但不阻断**，退出码 0 | 每次 gate / build |
| `--strict` | 未覆盖即退出码 1 | 人工巡检 |
| `--data <file>` | 指定数据文件 | 预演、自测 |

为什么不阻断：数据轮换是外部输入，卡住发布只会让人绕过检查。用「每次都提醒」代替「一次都不许过」，
补词典的成本是加一行，而漏掉的表现是丑。

实测两个方向都验过：正常数据 `✓ 覆盖完整：20 个全部有译文（词典 143 条）`；塞入假板块后
警告模式退出码 0、`--strict` 退出码 1。

### 申万板块的英文名：人工词典 + 回落（第 48 轮）

`/en/invest/` 的行业榜单原本整列中文（Wind 只给中文板块名），读起来像「翻译到一半」。
之前的选择是不翻译、并在页面上写明「板块名沿用数据源原始名称，未做翻译」——这诚实，
但英文读者看到一个中文列表体验很差。

这轮补了一份人工词典 `SECTOR_NAMES_EN`（143 条，覆盖申万一级 + 常见二级）：

| 规则 | 做法 |
|---|---|
| 查得到 | 显示英文，如「分立器件 → Discrete Devices」「集成电路封测 → IC Packaging & Testing」 |
| 查不到 | **回落中文原名**（未来数据源冒出新板块时不会变空白，也不会瞎翻） |
| `lead_stock`（领涨股） | 不翻译，保留中文专有名词 |
| 中文页 | 永远原名，`sectorName(name, "zh")` 直接返回入参 |

页脚说明同步改成「常见板块显示英文，其余保留原始中文名」，不再声称「未做翻译」。

`tests/market-sector-names.test.ts` 钉住四件事：常见板块有译文、中文页不翻译、未知板块回落原名、
译文必须是纯 ASCII（防止英文页里再冒出中文）；另外校验 `SectorRanking` 的两个列表都拿到了
`lang` —— 少传一个，英文页就会有一半中文，这种错误肉眼很难发现。

### 试过「首页空闲预取搜索 chunk」：实测代价太大，已放弃（第 47 轮）

第 46 轮做完意图预取后，还剩一个场景是冷的：用户**不悬停直接点**（触屏、键盘 Tab 后回车、
或者鼠标飞快扫过）。于是试了「首页 `load` 后 `requestIdleCallback` 预取一次」，带
`saveData` / `effectiveType` 守卫。结果先量代价：

| 首页 3.5 秒内 JS 传输 | 字节数 |
|---|---|
| 改动前（不预取） | **8 KB** |
| 空闲预取后 | **257 KB** |

也就是说首页为了省一次点击的 ~150 ms，让**每个访客**多下 249 KB（gzip 后约 85 KB）React +
DOMPurify + 搜索组件。而真正会点搜索的访客只是一小部分。经济学不成立，直接回滚，
只保留第 46 轮的「悬停/聚焦/触摸即预取」（零字节代价，因为不点就不加载）。

这次没有上线，代码回滚得很干净：`src/pages/index.astro` 里的内联预取脚本和
`window.__prefetchSearch` 导出都删掉了，`localStorage`/缓存里也没有残留约定。

**方法论备注**：先把「省了多少」和「花了多少」都量出来再决定，是这轮唯一有价值的事。
如果当初只看「点击 277 → 120 ms」就上线，账单会在所有首页访客身上，而不是搜索用户身上。

### 探针自己撒过谎：404 页也会「测出很快」（第 46 轮：已修）

第 45 轮的默认页面集里有 `/chinese-market/`。它**根本不存在**（生产 404），而 404 页上有搜索框
之类的可点元素，于是探针照点不误，报了个 `16 ms ✅`。于是「不存在的页面」被写进了相位表。

月度跑的时候加 `--fail-on-404`：只要清单里有一页不存在就直接退出码 1，避免「页面被删了但清单还挂着、探针照样报绿」。

修法：`page.goto` 之后拿 `response.status()`，非 200 的页面在报告里标 `⏭️ HTTP 404 跳过`，
**不计入**「全部页面交互 ≤200 ms」的结论。这条写进 `tests/inp-probe.test.ts` 之外的验收：
再跑一次时 `/chinese-market/` 会显示跳过而不是通过。

教训：任何「打线上批量测」的脚本都必须先确认页面真的存在，否则空白页永远是最快的。

### 全站最高频的交互其实是「打开搜索」（第 46 轮：已优化）

搜索面板是「点了才加载」的（第 N 轮为了不让 1145 个页面都背 React：静态 import 会让首屏 JS
多 87 KB）。代价是第一次点搜索要把 React + DOMPurify + 组件 chunk 全拉下来：

| 场景（本地 dist，1280×900） | 面板出现耗时 |
|---|---|
| 冷点击 | 254 → **183 ms** |
| 先悬停 250 ms 再点 | — → **92 ms** |

改法：把「预取」和「打开」拆成两件事。

- `prefetchSearch()`：`import("@/entrypoints/search")`——模块求值会把静态依赖（React、
  DOMPurify、组件）一起拉下来，但**不挂载**。绑定在 `pointerover` / `focusin` / `touchstart`
  （捕获阶段，命中搜索入口才会触发）。
- `loadSearch(true)`：用户真的点了/按了 `/`，才挂载并展开。

**这里差点翻车**：`mountSearch()` 原本写死 `<SearchModal initialOpen />`，也就是「挂载即展开」。
如果预取直接复用 `loadSearch()`（第一版就是这么写的），**鼠标划过搜索框面板就会弹出来**。
现在 `mountSearch(container, { open })` 显式接收，预取走 `open: false` 静默挂载；
`tests/search-launcher.test.ts` 把「预取 ≠ 打开」钉住了。

另外 Footer 的搜索入口和 404 的「直接搜索」按钮补了 `data-search-trigger`，预取才认得出它们。

### 交互延迟（INP）：从「没人量」到 `npm run perf:inp`（第 45 轮）

Lighthouse 给的是 TBT（首屏主线程阻塞），站点真正被感知的是「点了要等多久」——相册灯箱、
地图拖动、行情筛选、点赞。这些 CI 里一个指标都没有。这轮补了一个探针：

```bash
npm run perf:inp                                   # 打生产，桌面 1280×900
npm run perf:inp -- --mobile                       # 手机 390×844 + DPR2
npm run perf:inp -- --base http://127.0.0.1:8945   # 打本地 dist
```

原理是 Event Timing API（`PerformanceObserver({type:"event", durationThreshold:16})`）：
浏览器只在交互 ≥16 ms 时才上报 `duration`，正好是要看的那部分；探针会依次点菜单、
点开相册灯箱、拖动地图、点前两个筛选按钮，取每页最慢的一次作为「INP 近似值」。

**基线（生产实测，桌面）**：

| 页面 | 最慢交互 | 明细 |
|---|---|---|
| `/photo/baokemeng/` | 64 ms ✅ | 点开图片 16 · 点赞 64 · 点踩 16 |
| `/hike/sample-route/` | 280 ms ⚠️ | 点开图片 0 · 拖动地图 0 · 点赞 **280** · 点踩 16 |
| `/chinese-market/` | 16 ms ✅ | 「直接搜索」16 |
| `/guestbook/` | 0 ms ✅ | 「提交留言」0 |

**280 ms 那次不是点赞本身的问题**。三种证据：

1. 同一按钮在相册页只要 64 ms；
2. 在样张页连点五次：64/64/64/64 ms，只有第一次 200 ms（且伴随 55 ms 长任务）；
3. 把「加载后等待 1.2 s → 3 s → 6 s」再点：208 ms → 72 ms → 72 ms。

也就是说这是**加载窗口内的主线程竞争**（Leaflet 瓦片绘制 + recharts 图表 hydration），
用户正好在这 ~2 秒内点东西才会赶上；不是点击处理函数慢。所以没有「优化点击逻辑」可做，
按 INP ≤200 ms 的目标算轻微超标，记录在案。

### 顺手的一个真修：反馈按钮推迟到 `client:idle`（第 45 轮）

`/hike/<slug>/`、`/photo/<slug>/`（含 en 镜像共 4 个页面）的 `FeedbackButtons` 从
`client:visible` 改成 `client:idle`——它在页面底部、没有任何「必须立刻可点」的理由，
而 `client:visible` 在首屏可见时立刻 hydration，正好挤在 Leaflet + 图表那波主线程工作里。

实测（390×844、4× CPU throttling、页内加载 4 秒窗口）：

| 版本 | 加载期长任务 |
|---|---|
| `client:visible`（生产） | 1 个，55 ms |
| `client:idle`（本地构建） | **0 个** |

55 ms 不算大，但它是「用户点击正好落进去就变成 200+ ms」的那类阻塞。彩蛋：探针本身
对这次改动没有可测的差别（280 ms 仍在），因为它量的是地图/图表那波竞争——这也说明
**探针和长任务统计要一起用**，单看一个会得出错误结论。

### 相册 / 归档这批「预算外的页面」实测下来是满分（第 44 轮）

桌面 15 URL 预算和移动端周检都不覆盖 `/photo/`、`/en/photo/`、`/photo/<album>/`、`/archive/`、
`/tag/*`。第 40–43 轮改的正是这些页面，所以这轮把它们拉到生产上直接跑 Lighthouse 复核
（每个页面现跑，prod 实测，非模拟）：

| 页面 | 视口 | 性能 | 无障碍 | 最佳实践 | SEO | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| `/photo/` | 手机 | 100 | 100 | 100 | 100 | 1.80 s | 0 ms | 0.000 |
| `/photo/` | 桌面 | 100 | — | 100 | — | 0.36 s | 0 ms | 0.000 |
| `/photo/hudieren/` | 手机 | 100 | 100 | 100 | 100 | 1.51 s | 0 ms | 0.000 |
| `/en/photo/` | 手机 | 100 | 100 | 100 | 100 | 1.23 s | 0 ms | 0.004 |
| `/ai/digest/` | 手机 | 99 | 100 | 100 | 100 | 1.80 s | 0 ms | 0.017 |
| `/archive/` | 手机 | 100 | 100 | 100 | 100 | 1.50 s | 0 ms | 0.000 |
| `/tag/photo/` | 手机 | 100 | 100 | 100 | 100 | 0.94 s | 0 ms | 0.000 |

对照改前的量级：`/en/photo/` 首屏 5.5 MB / LCP 15.6 s，`/photo/hudieren/` 桌面 LCP 7.2 s。
现在这类页面没有一个低于 99。

**测量陷阱**：本地用 `python3 -m http.server` 起 dist 再跑 Lighthouse，8 个页面会统一显示
「最佳实践 96」，唯一的失败项是 `errors-in-console`：`POST /api/track` 在静态服务器上返回
501（生产是 FastAPI，正常返回 200）。也就是说**本地静态服务器上的 best-practices 分数不可信**，
涉及 /api/* 的审计要么打生产，要么在 summary 里忽略这一项。

### 移动端预算：从「别掉到 0.7 以下」收紧到「指标硬门禁」（第 44 轮）

`.lighthouserc.mobile.json`（每周一跑，桌面预算量不到的触摸目标 / 手机布局问题靠它兜底）这轮改了：

| 断言 | 改前 | 改后 | 依据 |
|---|---|---|---|
| `categories:performance` | warn 0.70 | warn **0.85** | 实测 98–100，0.7 等于没有告警线 |
| `largest-contentful-paint` | 无 | **error 3200 ms** | 实测最慢 1.80 s（徒步详情页）；留 runner 抖动余量，但要能抓住 15.6 秒那类回归 |
| `total-blocking-time` | 无 | **error 200 ms** | 实测 0 ms |
| 预算 URL | 10 | **13** | 加了 `/photo/`、`/photo/hudieren/`、`/archive/`（正是这几轮的重灾区） |

分数继续只做 warn、指标做 error，理由和桌面端一致：runner 负载会让 category 分数跳 7–14 分，
拿它当门禁会假红；LCP/TBT/CLS 才是真回归。

这 4 条规则写进 `tests/lighthouse-mobile-budget.test.ts`，改配置时会被测试拦住。

### 派生文件被当成新照片写进 manifest（第 43 轮：已修，线上曾出现重复图）

第 41 轮加了 `.hero.webp` 派生文件，但 `build-photo-manifests.ts` 的扫描只过滤了
`.og.jpg` / `.thumb.webp` / `.w640.jpg` / `.w960.jpg`，**漏了 `.hero.webp`**。于是构建时：

1. `xxx.hero.webp` 被当成一张新照片加进 manifest（baokemeng 49 张 → 多出 29 条，hudieren 5 → 6）；
2. 字典序上 `xxx.hero.webp` 排在 `xxx.jpeg` 前面 → 它成了 `manifest[0]`，**直接顶掉相册封面**。

线上后果：`/photo/hudieren/` 和 `/photo/baokemeng/` 多出重复照片、列表页封面变成 hero 副本。
修复与防回归：

- 扫描器补 `.hero.webp` 过滤；
- 新增 `tests/photo-manifest-hygiene.test.ts`：manifest 里任何 `src`/`thumb` 都不许以派生后缀结尾，
  且每条记录必须有宽高（派生文件往往 width=0）；
- 重新生成 manifest 后条目数回到 baokemeng 49 / hudieren 5 / mac1 6。

教训：**新增一种派生文件时，必须同时更新「谁扫描它」和「谁过滤它」**——生成器和扫描器在同一个
文件里，但它们隔了大半屏，很容易只改一处。

### 相册列表页：桌面要清晰、手机要省字节（第 43 轮）

第 40 轮列表页是「单 source + 720px 缩略图」，手机省（239 KB）但桌面 2x 屏偏软。第 41 轮有了
1600px 的 hero 变体后，改成**两个带 media 的 source**：

```html
<source type="image/webp" media="(min-width: 1024px)" srcset="…hero.webp" sizes="(min-width: 1024px) 40vw" />
<source type="image/webp" srcset="…thumb.webp" sizes="100vw" />
```

| 视口 | 下载的封面 | 页面总字节 | LCP |
|---|---|---|---|
| 手机 390×844 | `.thumb.webp`（720px，57 KB） | 239 KB | 1004 ms |
| 桌面 1280×900 | `.hero.webp`（1600px，188 KB） | 429 KB | 2996 ms |

桌面数字变大是**故意的**：2x 屏的 2 列卡片需要 ~1600px，原先 720px 是糊的。手机分支维持
第 40 轮的 239 KB。反例记一笔：两个 source **都不带 media** 时，浏览器只认第一个匹配的，
第二个（大图）是死代码——第 40–42 轮一直是这样，直到这轮才发现。

### 内容封面统一走「最轻派生图」（第 42 轮）

第 41 轮的扫描清单里，`/en/ai/digest/` 和 `/en/invest/digest/` 各挂着 1 处原图。它们不在首屏
（卡片 `loading="lazy"`），所以首屏只下 149 KB——但**往下滚就会拉全尺寸原图**，实测量出来是这样：

| 页面（滚到底后的 `/photos/` 请求） | 改前（生产） | 改后 |
|---|---|---|
| `/en/ai/digest/` | 599 KB（含 243 KB 全尺寸 webp） | **294 KB** |
| `/en/invest/digest/` | **2809 KB**（1139 KB JPEG + 904 KB webp + 243 KB webp） | **244 KB** |

修法：新增 `src/lib/cover-src.ts`，把 content 的 `cover` 解析成最轻的可用派生图：

```
.thumb.webp (720px) → .w640.jpg → .w960.jpg → .og.jpg (1200×630) → 原图
```

- 纯函数 `pickLightCover(cover, exists)`，`exists` 由调用方注入 → 可以单测，不需要真文件；
- 页面里用薄封装 `lightCover()`，读盘前 `decodeURIComponent`（文件名带空格/中文的老坑）；
- 一个派生图都没有时**退回原图**而不是空串——宁可重，不许 404。

接入点：`/ai/digest/`、`/en/ai/digest/`、`/en/invest/digest/`、`/ai/` 首页预览，以及 `PostCard`
（它的缩略图只有 ~120px 宽，原图在这里毫无意义）。中文 `/invest/digest/` 上一轮已经有了
`w640/w960` 的 `srcset`，这次不动它。

### 怎么一次性找出「页面上还挂着原图」的地方（第 41 轮的方法）

连续三轮（39/40/41）都在同一个坑里打转，于是写了一个 30 行的扫描：把 `dist/**/*.html` 里所有
`<img>`/`<source>` 的 `src`/`srcset` 抽出来，过滤掉已派生的后缀（`.thumb.webp`、`.og.jpg`、
`.w640/.w960`、`.hero.webp`、裸 `.webp`），剩下的就是「引用原图」：

```python
import glob, re, urllib.parse
from pathlib import Path
pat = re.compile(r'<(?:img|source)\b[^>]*\b(?:src|srcset)="([^"]+)"', re.I)
for f in glob.glob('dist/**/*.html', recursive=True):
    for m in pat.finditer(Path(f).read_text(errors='ignore')):
        for url in m.group(1).split(','):
            url = url.strip().split(' ')[0]
            if '/photos/uploads/' not in url:
                continue
            low = url.split('/')[-1].lower()
            if low.endswith(('.thumb.webp', '.og.jpg', '.webp')) or '.w640.' in low or '.w960.' in low or '.hero.' in low:
                continue
            p = Path('public' + urllib.parse.unquote(url))
            print(p.stat().st_size // 1024 if p.exists(), 'KB', f, url)
```

2026-11-19 这一轮跑出来的结果（修完 39–41 三处后仍存在的）：

| 页面 | 原图引用 | 实际影响 | 处理 |
|---|---|---|---|
| `/photo/<album>/`（8 个相册页） | 每张照片 1 处（`<img src={p.thumb}>` 兜底） | **低**：`<picture>` 有 webp 源，现代浏览器不会下 `img src` | 保留兜底，不换成 `.og.jpg`（1200×630 裁切会破坏网格比例） |
| `/en/ai/digest/`、`/en/invest/digest/` | 各 1 处（`<img src={d.data.cover}>`） | **中低**：卡片 `loading="lazy"`，首屏只下 149 KB；往下滚会拉 3.7 MB 原图 | 下一轮统一换「内容封面轻量解析」 |
| `/photo/hudieren/` | 1 处 `<img src>`（3.7 MB） | **低**：同上，有 webp 源 | 同上 |

注意「引用原图」≠「下载原图」：`<picture>` 里 webp `<source>` 命中时 `<img src>` 不会被请求。
判断影响要看它是否在首屏、是否 lazy——这一轮 `/photo/hudieren/` 桌面 LCP 7164 ms 是
**真的下载了 903 KB 的 hero**，不是被 `<img src>` 拖的。

### hero 用的是「原尺寸 webp」：3840×2160 的照片压出 903 KB（第 41 轮：已修，桌面 LCP −6.4 秒）

第 39 轮给手机加了 720px 变体，桌面分支仍是 `srcWebp`——也就是**按原分辨率**转出来的 webp。
对正常尺寸的照片这没问题（1536px → 85 KB），但 hudieren 的封面是 3840×2160：

| 阶段 | 桌面下载的 hero | `/photo/hudieren/` 桌面 LCP |
|---|---|---|
| 改前（生产实测） | `…5440.webp`（903 KB，3840px 宽） | **7164 ms** |
| 改后 | `…5440.hero.webp`（188 KB，1600px 宽） | **804 ms** |

hero 在 1280 宽屏上最多显示 1280 CSS px（2x 屏 2560），1600px 宽的变体在画质上无损可感。
生成规则写进 `scripts/build-photo-manifests.ts`：**仅当原图宽 > 1600** 才生成 `.hero.webp`
（宽 1600、质量 78、增量生成，和 `.thumb.webp`/`.og.jpg` 同一套缓存判断），
`heroWebpSources()` 的选择顺序因此变成 `heroWebp → srcWebp`。

同一个相册的 5 张照片里只有 2 张需要变体（其余原图本来就 ≤1600 宽），全站新增派生文件 9 个、
合计约 1.1 MB，构建时间增加不到 1 秒。

### 相册列表页封面下的是原图：`/en/photo/` 首屏 5.5 MB、LCP 15.6 秒（第 40 轮：已修）

`/photo/` 和 `/en/photo/` 的封面取的是 `manifest[0].src`——manifest 里的 `src` 是**原图**。
一张相册封面实测 3742 KB，而卡片只有 400–800px 宽。frLem 上量出来的结果：

| 页面 | 改前（生产实测） | 改后 | 变化 |
|---|---|---|---|
| `/photo/` | LCP 3124 ms · 4206 KB · 最大图 3742 KB | LCP 936 ms · 239 KB · 最大图 66 KB | −2188 ms · −94% 字节 |
| `/en/photo/` | LCP **15564 ms** · 5533 KB · 最大图 3742 KB | LCP 1488 ms · 264 KB · 最大图 66 KB | −14076 ms · −95% 字节 |

（390×844、DPR 2、150ms RTT / 1.6Mbps / 4× CPU，每页 3 次取中位。）

修法：在 manifest 里按路径找回同一条记录，用派生图输出 `<picture>`：

```html
<picture>
  <source type="image/webp" srcSet={cover.thumbWebp} />   <!-- 720px / 57 KB -->
  <source type="image/webp" srcSet={cover.srcWebp} />     <!-- 原尺寸 webp / 85 KB -->
  <img src={cover.srcOg ?? cover.src} width height loading="lazy" decoding="async" />
</picture>
```

三个关键点，缺一个就白改：

1. **不能直接 `src={cover}`**：frontmatter 里的 cover 和 manifest 的 `src` 都是原图路径；
   要用 `decodeURI` 比对（文件名含空格/中文时编码过后不相等，第 34 轮踩过同一个坑）。
2. **兜底图用 `srcOg`**（1200×630 的 JPEG，~67 KB）而不是原图——否则不支持 webp 的
   浏览器照样下 3.7 MB。
3. **中文和英文两个列表页都要改**，它们各自复制了一份取封面的逻辑（第 40 轮之前只有中文页改过）。

顺带把 `/en/photo/<album>/` 的 hero 也补上了手机 720px 变体（中文页第 39 轮已有），两页现在一致。

### 相册 hero 在手机上下的是 1536px 原尺寸 webp（第 39 轮：已修，手机 LCP −220ms）

`/photo/<album>/` 的 hero 是一张满宽大图，之前只有一个 webp 候选：整幅 1536px、85 KB。
手机上（390 CSS px）这是纯浪费——`.thumb.webp` 早就有 720px / 28 KB 的版本，色差肉眼不可见。

改成 `<picture>` 里按屏幕宽度挑候选：

```html
<source type="image/webp" media="(max-width: 640px)" srcset={heroSources.mobile} />
<source type="image/webp" srcset={heroSources.desktop} />
```

实测（390×844、DPR 2、150ms RTT / 1.6Mbps / 4× CPU，每档 3 次）：

| 指标 | 改前 | 改后 |
|---|---|---|
| 实际下载的 hero | 整幅 webp（85 KB） | `.thumb.webp`（28 KB） |
| LCP（中位） | 1228 ms（3 次全同） | 1008 ms |
| 桌面 1280 宽 | 整幅 webp，LCP 820 ms | 未变（桌面分支不受影响） |

宽高比一致（3:2），`width`/`height` 仍按原始比例给出，CLS 不回归。
选择 `media` 而不是 `srcset` 宽度描述符，是因为 hero 在亮/暗两套布局里都是满宽，
`media` 更直观、也更好在 Playwright 里断言（直接读 `img.currentSrc`）。

### `/hike/sample-route/` 一直是最低分（95–96）：查过了，不值得改

三轮 CI 审计里它稳定 95–96（其他页 97–99），拿 LH 报告逐项对比 `/hike/`（98）和
`/hike/sample-route/`（96）找到两个真实扣分项：

| 审计项 | `/hike/` | `/hike/sample-route/` | 原因 |
|---|---|---|---|
| `unused-javascript` | 1 | **0**（浪费 203 KiB） | 地图在首屏（距顶 387px，视口 900），`client:visible` 正确地立即水合 Leaflet + React |
| `modern-image-formats` | 1 | **0.5**（浪费 90 KiB） | OpenStreetMap 瓦片是第三方 PNG，格式不由我们决定 |
| `image-delivery-insight` | 1 | **0.5**（浪费 120 KiB） | 同上，瓦片 PNG |

结论：这两项分别来自「地图在首屏」和「第三方瓦片格式」，不是能一行改掉的浪费。
真要动就得换地图栈（MapLibre 矢量瓦片，JS 更大）或把地图挤到首屏外（内容顺序倒退），
都不划算——95/96 本身已经在预算内。**这个页面不再追分。**

判定分档写在 `verdict()` 里（有测试锁住）：< 150 ms「无实质阻塞」、150–299「轻微，先看是什么」、
≥ 300「真实阻塞，值得修」。以后看到 `perf:local` 的 TBT 报警，先跑这个再决定动不动代码。

### 本机基线里的 TBT 不可信（headless 无 GPU）

`perf:local` 给首页量出过 perf **72**、TBT **964–1054 ms**，而同批 `/ai/` TBT 0、`/photo/` 184。
看着像首页有 1 秒阻塞，实际是 headless Chrome 没有 GPU 导致的测量假象：

| 证据 | 结果 |
|---|---|
| Lighthouse 主线程诊断 | 单个 1287 ms 任务，`bootup-time` 归因 **Unattributable**（不是 JS） |
| 真实 CDP trace（4× CPU、桌面 1280） | 主线程最长任务 **2 ms**；最长事件是 `GPUTask` 141 / 136 / 80 ms |
| 同页把视口缩到 390 | 最长任务仍是 2 ms |

也就是说：那些“宇称”时间花在软件光栅上，被 Lighthouse 记进了主线程 `Other`。渐变、
`backdrop-blur`、合成层多的页面（首页 8 张渐变卡片 + `animate-rise`）在无 GPU 环境里必然虚高。

结论：
- `perf`/`FCP`/`LCP`/`SI` 可信，**TBT 只看趋势**；
- 判断真实 TBT 要么开带 GPU 的浏览器手跑 DevTools，要么接受 CI 的 300 ms 只做兜底阈值；
- 首页不需要为此改样式（用户侧有 GPU，这部分是像素填充，不是脚本阻塞）。

### 跨轮的绝对分数不可比：用「本轮中位数」当基准

`npm run perf:history` 的第三张表就是这么来的。起因是校验第 32 轮的修复效果时发现：
`c3f5f6c` 这一轮 15 个 URL 全部比上一轮高 2–6 分（首页 94→98、`/hike/` 92→98、
`/hike/sample-route/` 91→96），而这一轮只改了横向滚动容器的 `tabindex`，不可能影响
绘制——**整轮一起漂就是换了跑者**。

所以现在多一张「单轮内相对中位数」的表：

| URL | 性能 | 本轮中位数 | 偏差 |
|---|---|---|---|
| `/invest/digest/` | 93 | 98 | -5 |
| `/invest/` | 94 | 98 | -4 |
| `/hike/sample-route/` | 96 | 98 | -2 |
| 其余 12 个 URL | 97–98 | 98 | 0 / -1 |

跑者快慢被减掉之后，真正结构性的落后只剩两个：`/invest/` 和 `/invest/digest/`（都挂着
实时行情岛）。这也是为什么第 32 轮 `/invest/` 的 Speed Index 修复（2786→1067 ms，CI 同款
限速下 perf 92→98）在 CI 分数上只看到 94 ——CI 那轮整体在涨，绝对值没信息量；
**本地固定条件复测才是判断回归的依据**，CI 只用来守阈值。

### 内联 CSS 还是外链：每个页面都背着 88 KB 内联样式（第 36 轮结论：保持内联）

`astro.config.mjs` 里 `inlineStylesheets: "always"`，所以每个页面的 HTML 里都塞着
**88 KB 未压缩 / 15 KB gzip** 的样式（165 KB HTML → 33 KB gzip）。理论上这是浪费：
外链 CSS 能让所有页面共用一份缓存。于是真的构建了两份做对照。

**先量清成本**：`inlineStylesheets: "never"` 构建产物里，`BaseLayout` 的 CSS 是 90 KB →
gzip 14.9 KB，HTML 从 165 KB 掉到 77 KB（gzip 33 → 18 KB）。代价是样式表被拆成多个文件：
`/invest/` 1 个、`/hike/sample-route/` 2 个（+leaflet）、`/photo/baokemeng/` **5 个**。

**Lighthouse 对照（4 个页面 × 3 次，desktop + 4× CPU 模拟）**：

| 页面 | 内联 分数 | 外链 分数 | 内联 FCP / LCP | 外链 FCP / LCP |
|---|---|---|---|---|
| `/` | 100 / 72 / 70 | 73 / 70 / 70 | 482 / 522 ms | 623 / 643 ms |
| `/invest/` | 99 / 99 / 99 | 99 / 99 / 98 | 684 / 885 ms | 723 / 884 ms |
| `/photo/baokemeng/` | 98 / 98 / 98 | 98 / 97 / 97 | 725 / 1048 ms | 785 / 1048 ms |
| `/hike/sample-route/` | 71 / 73 / 79 | 68 / 84 / 87 | 742 / 1364 ms | 803 / 1565 ms |

首访（LH 和 CI 用的就是这个场景，空缓存）**外链一律慢 1 个 RTT**：FCP +40 ~ +141 ms。
分数看起来外链有时更高（`/hike/sample-route/` 中位 84 vs 73），但那是 TBT 在抖
（内联 534 ms vs 外链 241 ms），不是 CSS 布局带来的。

**复访**（同一浏览器第二次打开、CSS 已进缓存）确实反过来：同页复访 FCP 100 → 68 ms、
跨页第二页 164 → 120 ms。也就是说外链只对「一次访问里看好几页」的人有用。

这个站的流量形态是「搜索引擎点进来读一篇就走」，属于首访场景，所以**保持内联**，
`inlineStylesheets: "always"` 不动。如果以后出现「站内连续浏览」的入口（比如顶部导航
变成常驻 tab），再重新评估；换的时候只需要改一行配置，两份构建产物和上面这张表可以复用。

### 三个「看起来该优化、量完发现是噪声」的地方（2026-11-19 第 35 轮）

排 `/invest/` 和 `/hike/sample-route/` 的掉分项时做过三组对照实验，都没有收益，记下来省得
下轮重做：

| 实验 | 做法 | 结果 | 结论 |
|---|---|---|---|
| 首屏岛改空闲水合 | `MarketIndicesGrid` 的 `client:load` → `client:idle`（SSR 已经把指数画好） | 两组都走同样的路由拦截（排除拦截本身开销），`loadEventEnd` 1198 vs 1143 ms、LCP 都在 172–196 ms，长任务都是 0 | 无可测差异，**回退**。SSR 已经出内容时，`client:load`/`idle` 的差别只在 React chunk 什么时候执行，而这页 chunk 才 35 KB |
| 预加载衬线字体 | `<link rel="preload" as="font" ... href=instrument-serif>` | LH 模拟 LCP：不预载 1524 ms（3 次：1524/1643/1523）vs 预载 1658 ms（1675/1485/1658） | 无收益，**没上**。字体 15 KB、`font-display: swap`，模拟器里字体到达时间不是在关键路径上 |
| `font-display: optional` | 把 4 处 `swap` 换成 `optional`，消掉字体二次重绘 | 模拟 LCP 1404–1727 ms、实测 LCP 985–1080 ms，和不改几乎一样 | 无收益，**没上** |

顺带查清 `/hike/sample-route/` 的 −4 是怎么来的：Lighthouse **实测**（trace 里真实发生的）
`observedLargestContentfulPaint` = 987–1053 ms，和 `observedFirstContentfulPaint` 一样；
但**模拟**出来的 LCP 在完全相同的 HTML 上能跑出 1004 / 1404 / 1683 / 1727 ms。也就是说这一项
是 LH 模拟器在「大标题 + 内联 88 KB CSS + 4× CPU」组合下的预测误差，不是页面问题。CI 分数
用的是模拟值，所以这种页面的分数天生偏低，**不要**为了它去改代码。

### `/invest/digest/` 的 LCP：封面用 OG 原图（1200×630）塞进 430px 卡片

相对中位数表里 `/invest/digest/` 是偏差最大的一个（−5）。逐项量下来，一半是测量噪声、
一半是真问题。

**噪声部分**：这页没有任何 JS 岛，13 张封面（唯一）共 ~0.44 MB。本机 Lighthouse 的
`total-blocking-time` 在 0–930 ms 之间乱跳，而真实 CDP trace（4× CPU、滚一屏触发懒加载）
里主线程最长任务只有 **37 ms**，最长事件仍是 `GPUTask`（146/140/84 ms）——又是 headless
无 GPU 把软件光栅算进主线程那套（见上一节）。

**真问题**：封面直接复用了照片站的 OG 图（1200×630、最大 105 KB），而卡片在桌面上 430px、
手机上是整行 350px；它还正好是 LCP 元素。等于每个访客为了 430px 的画面下载 2.5 倍像素。

修法（都不改内容资产）：

1. `scripts/cover-variants.mjs` 扫 `src/content/invest/*.mdx` 的 `cover:`，用 sharp 在旁边
   生成 `.w640.jpg` / `.w960.jpg`（1–9 KB）。已存在且比原图新就跳过，新日报自动补；
   挂在 `npm run build` 的 `prebuild` 上，没装 sharp 时只告警不回退构建。
2. 列表页出 `srcset`（640/960/1200 w）+ `sizes="(min-width: 640px) 430px, 100vw"`，
   文件不存在就退回原图（不会 404）。
3. 首月前两张封面 `loading="eager"` + `fetchpriority="high"`，其余 186 张保持
   `lazy` + `fetchpriority="low"`。

限速 A/B（150 ms RTT / 1638 kbps、4× CPU、两份 HTML 同源对照，各 4 轮）：

| 视口 | LCP 改前 | LCP 改后 | 变化 |
|---|---|---|---|
| 1280×900 | 1575 ms | 1265 ms | **−310 ms** |
| 390×844 | 3007 ms | 1354 ms | **−1653 ms（−55%）** |

CLS 仍是 0（加了 `width`/`height` + `aspect-[16/9]`），两种主题、两种宽度的 axe 都是 0 违规；
Lighthouse 的 LCP 元素也从 `.og.jpg` 换成了 `.w640.jpg`（浏览器挑了够用的那张）。

**踩到的坑（都已修）**：

| 问题 | 现象 | 原因 | 处理 |
|---|---|---|---|
| 部署红了 | `Build & Deploy` 在「Unit and guard tests」失败，生产停在上一版 | 两期日报的封面是 `.webp`，变体脚本的扩展名正则只认 jpg/png → 变体路径等于原图、被静默跳过，而用例要求变体齐 | 正则补 `webp/avif`；源图缺失改成 `console.warn` 不再静默；本地「干净 clone 跑测试」复现后修 |
| 相册里混进 40 张假照片 | `src/data/photo-manifest/*.json` +240 行 | `build-photo-manifests.ts` 会把 `public/photos/uploads/**` 里所有图片收进相册，新生成的 `.w640/.w960` 被当成原图 | 生成器加过滤规则；重跑 manifest 回到上轮内容；用例锁死「变体不能出现在相册清单里」 |

**试过但更慢的**：给首图加 `<link rel="preload" as="image" fetchpriority="high">`，A/B 里
LCP 反而从 1568 → 1878 ms、图片起跑从 819 → 1126 ms——在那个带宽下 preload 和字体/CSS
抢连接。已回退。教训：preload 只对「浏览器很晚才发现」的资源有意义，已 eager 的图再加
preload 可能纯亏，必须 A/B。

**留着但没测出收益的**：月份分组的 `content-visibility: auto`（配 `contain-intrinsic-size`）。
A/B 里布局次数和滚动长任务没有一致差异（189 张卡片、2217 个节点，本身还不算重），
留着是因为归档每天 +1 期、迟早会重；这一点如实记在这里，不是已证实的收益。

### 逐页分数发成 commit status，不用 token 也能读

历史痛点：LHCI 的逐 URL 分数只在 `.lighthouseci/` 产物里，而产物下载要 token。没有 token
的时候，想确认「这轮 `/invest/digest/` 到底掉没掉分」只能猜——第 32 轮整整一轮都在猜。

现在审计跑完会多发一轮 commit status（`scripts/lighthouse-statuses.mjs --post`），一条 URL
一个 context：`perf/`、`perf/invest/`、`perf/invest/digest/`……描述里带分数和关键指标：

```
GET https://api.github.com/repos/lzf00/zorotreeking/commits/<sha>/statuses
→ { context: "perf/invest/digest/", state: "success", description: "93 分 · LCP 0.84s · TBT 633ms · CLS 0.000" }
```

约定：

| 项 | 规则 |
|---|---|
| context | `perf` + 路径，根路径就是 `perf/` |
| state | 性能 ≥ 0.80 记 `success`，低于或分数缺失记 `failure`（不许假装成功） |
| description | `分数 分 · LCP x.xxs · TBT xxxms · CLS x.xxx`，截到 140 字符 |
| 重跑 | 同一个 sha 上重复发不会报错，GitHub 保留最新一条 |
| 开跑前 | 只发 `perf/audit-target` + `state: pending`（意思是「预计审这一版」） |
| 跑完 | 才发 `perf/audited`，描述带`最低 xx · 中位 xx`；LHCI 断言挂了就记 `failure` |
| 发不出去 | 只 `::warning::`，不让审计本身失败 |

2026-11-19 `c2bf9d6` 那次审计的 15 个 URL（全部 ≥ 96，比 `c3f5f6c` 的 93–98 又上一档，
其中 `/invest/digest/` 93 → 97、`/invest/` 94 → 98，正好是封面变体和 SI 修复的效果）：

| 页面 | 分数 | LCP | TBT |
|---|---|---|---|
| `/` | 97 | 0.91s | 0ms |
| `/about/` | 98 | 0.86s | 0ms |
| `/ai/` | 98 | 0.85s | 0ms |
| `/ai/digest-2026-06-05/` | 98 | 0.94s | 0ms |
| `/en/` | 98 | 0.83s | 0ms |
| `/explore/` | 99 | 0.83s | 0ms |
| `/hike/` | 98 | 0.87s | 0ms |
| `/hike/sample-route/` | 96 | 0.84s | 0ms |
| `/hike/travel/ali-grand-loop-lhasa-return-2026/` | 97 | 1.03s | 46ms |
| `/invest/` | 98 | 0.84s | 0ms |
| `/invest/digest/` | 97 | 1.02s | 4ms |
| `/invest/stock/688981.SH/` | 98 | 0.88s | 0ms |
| `/photo/baokemeng/` | 98 | 0.98s | 0ms |
| `/tag/` | 98 | 0.86s | 0ms |
| `/tag/photo/` | 98 | 0.85s | 0ms |

干跑：`node scripts/lighthouse-statuses.mjs --dir .lighthouseci`（或用 `--json` 看请求体）。
本地没有报告时脚本直接退出、不发空状态。这一步在 workflow 里 `if: always()`，所以即使
LHCI 断言失败、分数难看的轮次也会留痕。

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

一页 500+ 行还有个渲染问题：整页参与布局与绘制，移动端滚起来会掉帧。年份分节加了
`content-visibility:auto` + `contain-intrinsic-size:auto 1200px`，屏幕外的年份直接跳过布局；
实测滚到底最后一行仍正常显示（`/archive/` 页高 24279px，末行「2026-04-30 · 个人投资 · 2026 年 4 月复盘」可见）。

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

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

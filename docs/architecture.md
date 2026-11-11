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
3. **`npm test`** 守卫测试（87 个断言，约 1s；2026-11-11 才补进部署流程，
   之前红着也能部署），不通过直接挡住
4. Build photo manifests (sharp 生成 WebP 增量)
5. **`astro check`** 类型检查守门
6. `astro build`
7. pagefind 索引
8. **Prepare versioned release**：`cp -al current/. releases/<sha>/` 用硬链接做种子
9. rsync（`--checksum` 只传真正变化的字节；`--timeout=180` 防挂死；失败重试 3 次）
10. **Activate release atomically**：`ln -sfn` + `mv -Tf` 原子切换 `current`
11. Prune：保留最近 20 个 release，`current` / `previous` 永不删除
12. Production acceptance smoke test，失败自动回滚到 `previous`
13. **IndexNow ping**（POST 新 URL 给 Bing/Yandex/Naver 加速索引）

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

性能阈值为什么是 0.80 而不是 0.85：站点在国内、Lighthouse 跑在 GitHub 的美国 runner 上，
实测同一版本同一页面三次跑分可以是 `0.79 / 0.95 / 0.95`，TTFB 在 **241ms~986ms** 之间跳
（同一台静态服务器，纯链路抖动）。按「每个 URL 中位数 ≥0.85」判会随机红，与代码质量无关。
真正的解法是在源站前面加 CDN（需评估成本与备案/国内路由），在那之前用 0.80 守住真实回退：
真出现回退时，中位数会整体塌到 0.8 以下，而不是单次毛刺。

注意 `Decide whether audited pages changed` 步骤：只改了生成内容的提交会让 Lighthouse **skip**
（job 显示 success 但没跑分），要真数据就手动 dispatch。

### `.github/workflows/a11y-audit.yml`
**触发**: 每周一 UTC 03:00（BJT 11:00，错开 10:00 的移动端跑分）+ 手动。
对**线上**站点跑 `scripts/check-a11y.mjs`：20 个页面模板 × 浅色/深色 = 40 次检查，
轴心是 axe-core 的**全部默认规则**（不只是对比度和标题层级），紧跟一步
`scripts/check-hydration.mjs` 验证 React 岛真的在浏览器里水合。产物 `a11y-report` 保留 30 天。

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

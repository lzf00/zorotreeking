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
3. Build photo manifests (sharp 生成 WebP 增量)
4. **`astro check`** 类型检查守门
5. `astro build`
6. pagefind 索引
7. rsync → VPS nginx
8. **IndexNow ping**（POST 新 URL 给 Bing/Yandex/Naver 加速索引）

### `.github/workflows/lighthouse.yml`
**触发**: deploy 完成后自动 + workflow_dispatch。
跑 LHCI 对比 `.lighthouserc.json` 性能预算（Perf ≥ 0.85, A11y ≥ 0.90, SEO ≥ 0.95），未达标 fail。

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

| 约束 | 原因 |
|---|---|
| `astro` 钉在 `~7.3.8` | `<=7.3.2` 有 XSS / AVIF RCE 等 advisory；`7.4.x` 要求 `@astrojs/internal-helpers@0.13.0`，而 `@astrojs/mdx@7.x` 钉 `0.10.4`，`npm ci` 会因 lockfile 不自洽直接失败 |
| 升级顺序 | astro 7.4 → 必须同时升 `@astrojs/mdx@8`、`@astrojs/react@7`，后者会拉 React 19（`recharts@2`、现有 island 都要回归），所以单独排期 |
| `npm ci` 是防火墙 | CI 的 Install 步骤跑 `npm ci`，任何「本地 `npm install` 能过但 lockfile 不自洽」的改动都会在部署前被拦住（2026-11-10 踩过一次） |
| Renovate | astro / `@astrojs/*` 分组为 `astro-stack`，不自动合并；React 锁 `^18` |

剩下 3 个 moderate advisory 都在构建期、不进浏览器：`satori`（只用于 `/og/*.png`）、`postcss-selector-parser`（被 `@tailwindcss/typography` 钉版本）。

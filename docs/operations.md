# 运维速查（当前状态，不是历史）

> 历史变更、踩坑过程都在 [architecture.md](./architecture.md)；这一页只回答三件事：
> **现在有什么在自动跑、红了去看哪里、哪些事需要人决定。**
> 内容由 `tests/operations-doc.test.ts` 对着仓库真实验证，改工作流忘了同步这页会红。

## 1. 自动跑的东西

时间是**北京时间**。注意：本仓库的 `schedule` 触发被 GitHub 排队，实测普遍延迟 **5–7.5 小时**
（见 architecture.md 第 96 轮），下面的"实际落地"是观测值，不是配置值。

| 工作流 | 配置时间 | 实际落地（观测） | 干什么 | 红了意味着 |
|---|---|---|---|---|
| `Daily digest` | 每天 02:17 | 05:00–08:00 | 抓外部源 → 豆包摘要 → 提交日报与市场复盘 | 内容流水线断了（多半是权限/语法 `startup_failure`） |
| `Content freshness watch` | 每天 04:23 + 日报跑完时 | 紧随日报 | 内容停更就开 issue、job 红 | 有板块停更；看 issue 正文的处理步骤 |
| `Build & Deploy` | push / 工作日 15:30 | 立即 | 门禁 → 构建 → 部署 → 线上验收 → 回滚兜底 | 发布失败，线上可能停在旧版本 |
| `Lighthouse CI` | 部署后 / 每天 03:00 | 排队 | 15 个 URL × 5 次的性能预算 | 性能预算被突破（记录用，不挡发布） |
| `Lighthouse Mobile` | 周一 10:00 | 17:00 前后 | 移动端跑分 | 移动端预算被突破 |
| `Accessibility & hydration audit` | 周二 04:30 | 10:00 前后 | 本地 dist 全站 1188 页 × 浅/深 + 60 页窄屏 + 岛水合 | 可访问性回归（模板级） |
| `Dead link check` | 周一 09:00 | 15:40 前后 | 全站外链存活 | 有外链死了（会留痕，不一定挡发布） |
| `Weekly roundup` | 周日 09:00 | 下午 | 周报 + 翻译 | 周报没产出 |
| `Full-site audit` | 周四 09:00 | 下午 | 站点整体巡检（SEO/内容/结构） | 有整体性退化 |
| `Bulk backfill (history meta + bulk translate)` | 手动 | — | 历史 meta + 批量翻译补跑 | 只在手动触发时相关 |

`Build & Deploy` 也可以被 `Daily digest` / `Weekly roundup` / `Bulk backfill` 以
`workflow_call` 调用 —— 所以「内容提交也能发布」靠的是这条链，链上任何一环的权限缺口都会让
内容流水线直接 `startup_failure`（2026-11-19 就是这样静默了三天）。

## 2. 门禁（本地 `npm run gate`）

约 2 分 40 秒，425 条测试。顺序与含义：

| 步骤 | 查什么 |
|---|---|
| `validate:etf` | ETF 三因子数据自洽（份额/量能/方向） |
| `check:dates` | 内容日期与文件名/前置字段一致 |
| `check:digest-quality` | 最近 7 天的日报正文里不许有"摘要失败"占位符（历史遗留用 `--all` 盘点） |
| `check` | `astro check`（TS 类型 + 模板） |
| `npm test` | 单元/集成测试（node:test + tsx） |
| `build` | 静态构建（1194 个页面） |
| `check:images` | 图片体积与格式预算 |
| `check:links` | 站内链接与锚点 |
| `check:sectors` | 板块名映射（中英一致） |
| `check:og` | 分享卡（OG 图存在且尺寸正确） |
| `check:ssr-clock` | SSR 时间戳不漂移（避免水合不一致） |
| `check:hydration` | 每个岛在浏览器里真的水合 |
| `check:search:dist` | 本地起服务跑 Pagefind 搜索探针 |
| `check:a11y:fast` | 双主题 axe 快检（3 个模板 × 浅/深，约 22 秒） |
| `check:font-fallback` | 字体回退的度量匹配（数字/日期/混排） |
| `check:feeds` | RSS/JSON Feed 结构与条数 |
| `check:seo` | canonical / 单一 h1 / JSON-LD |
| `check:admin` | Decap 后台的 `config.yml` schema（无头浏览器实测） |

**不在门禁里**（故意的）：`check:deps`、`check:server`、`check:freshness`、`check:search`
（默认打线上）、`check:interactions`、`check:a11y`（全站，2.5 分钟）。它们由 CI 或周巡检负责。

## 3. 哪里看结果（没有 GitHub token 也能看）

| 想知道 | 看哪里 |
|---|---|
| 代码有没有坏 | 提交上的 `smoke/*` 状态（`smoke/runtime`、`smoke/runtime-mobile`、`smoke/interactions`） |
| 线上跑的是哪一版 | `https://www.zorotreeking.online/deploy-meta.json` 的 `sha` |
| 内容停更了没 | `Content freshness watch` 的 issue（有就说明停更，标题带处理步骤） |
| 发布失败原因 | 该次 `Build & Deploy` 的**注解**（`annotations` 接口；日志要登录） |
| 性能预算 | `perf/audited` 状态描述里的分数摘要 |

```bash
# 最近几次运行（匿名额度 60 次/小时，省着用）
curl -s "https://api.github.com/repos/lzf00/zorotreeking/actions/runs?per_page=5" \
  | python3 -c 'import json,sys; [print(r["name"], r["status"], r["conclusion"], r["head_sha"][:8]) for r in json.load(sys.stdin)["workflow_runs"]]'

# 失败原因（注解，不需要登录）
curl -s "https://api.github.com/repos/lzf00/zorotreeking/check-runs/<id>/annotations"
```

## 4. 需要人决定的事

| 事项 | 现状 | 影响 | 需要谁 |
|---|---|---|---|
| Node 升到 ≥22.23.4 | 本机 22.23.2 被审计拦住；Astro 7.4.13 能清掉两条 advisory | 依赖审计告警常驻 | 用户（改本机/CI 版本） |
| nginx 三条配置 | 文档已写好（`docs/nginx-hardening.md`） | `index.html` 301、`cache-control` 重复、brotli 未开 | 用户（服务器权限） |
| `/api/market/*` 缓存 TTL | 服务端没设 TTL | 冷启动 3.5 秒会拖 LCP | 用户（服务端） |
| `gh` token 失效 | 本机无法用高额度 API、无法 dispatch | 排障只能靠匿名额度 | 用户（`gh auth login`） |
| 生产直连被站点频控 | 本机 IP 拿 `000` | 无法直接 curl 验证线上 | 等冷却 |
| 缺 11-19 ~ 11-21 的日报 | 内容流水线静默停更三天 | 读者看到旧内容 | 已修权限，等下一次定时运行验证 |

## 5. 已修复的历史问题（别重复排查）

| 问题 | 结论 |
|---|---|
| `/api/feedback` GET 长期 422 | 第 104 轮复查已正常（合法 slug 返回 `{"likes":0,"dislikes":0,"my_vote":null}`）；`slug` 缺失时仍会 422，那是 FastAPI 的参数校验，正常。现在部署验收会打一次探针，再坏就会在部署阶段红 |
| 首页精选是 5 个月前的旧闻 | 第 101 轮改成「最近 20 篇里挑最长」，已上线 |
| 边缘可能缓存旧 HTML | 第 102 轮加了 `<meta name="build">` + 验收断言 |

## 6. 变更这一页的规矩

- 改工作流 → 同步第 1 节（`tests/operations-doc.test.ts` 会检查每个工作流都被提到）
- 改 `gate` → 同步第 2 节（测试会检查每个 gate 步骤都出现在表里）
- 已解决的决策从第 4 节删掉，不要留成"历史包袱"

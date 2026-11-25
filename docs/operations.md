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
| `Refresh US market data` | 每天 22:20 | — | 从 BLS + 东方财富刷新美股宏观块与行情块，数字没变不提交 | 接口或解析坏了，页面会退回“陈旧”提示 |

`Build & Deploy` 也可以被 `Daily digest` / `Weekly roundup` / `Bulk backfill` 以
`workflow_call` 调用 —— 所以「内容提交也能发布」靠的是这条链，链上任何一环的权限缺口都会让
内容流水线直接 `startup_failure`（2026-11-19 就是这样静默了三天）。

## 2. 门禁（本地 `npm run gate`）

约 2 分 40 秒，425 条测试。顺序与含义：

| 步骤 | 查什么 |
|---|---|
| `check:workflows` | 触发方式 + **可复用工作流权限图**（被调用方声明的权限必须是调用方给得起的，否则 GitHub 在启动阶段就失败） |
| `check:workflows`（同上，第二条） | 每个 scheduled workflow 都必须有非 cron 的触发方式，或在 `scripts/workflow-coverage.json` 里声明靠什么跑到（这个仓库的 cron 会延迟甚至整天不触发，第 162 轮） |
| `validate:etf` | ETF 三因子数据自洽（份额/量能/方向） |
| `check:dates` | 内容日期与文件名/前置字段一致 |
| `check:digest-quality` | 最近 7 天的日报正文里不许有"摘要失败"占位符（历史遗留用 `--all` 盘点） |
| `check:content-quality` | 内容质量体检：英文日报中文残留、封面复用比例、缺摘要明细。**本地硬失败、CI 只告警**（第 202 轮） |
| `check` | `astro check`（TS 类型 + 模板） |
| `npm test` | 单元/集成测试（node:test + tsx） |
| `build` | 静态构建（1194 个页面） |
| `check:weight` | 页面重量闸门：HTML > 220 KB / 内联 CSS > 120 KB 就红；已有超标页在 `scripts/page-weight-baseline.json`，比基线再长 10% 要重新登记理由 · 同时看 gzip 60 KB / 3000 标签 |
| `check:images` | 图片体积与格式预算 |
| `check:links` | 站内链接与锚点 |
| `check:orphans` | 零入链页面检查：读完 dist 的站内链接图，任何可索引页面若无人指向就报出来（错误页/后台页/跳转桩除外）。**本地硬失败、CI 只告警**（第 204 轮） |
| `check:sectors` | 板块名映射（中英一致） |
| `check:og` | 分享卡（OG 图存在且尺寸正确） |
| `check:ssr-clock` | SSR 时间戳不漂移（避免水合不一致） |
| `check:hydration` | 每个岛在浏览器里真的水合 |
| `check:degraded` | 把 `/api/**` 全拦成 500，6 个关键模板仍须可读（不许白屏 / undefined / 未捕获异常，第 166 轮） |
| `check:search:dist` | 本地起服务跑 Pagefind 搜索探针；断言索引是最新的（最新日报排进前 3）、命中不是死链 |
| `check:i18n-leaks` | 英文内容里不许新增未翻译的中文正文（存量在 `scripts/i18n-leaks-baseline.json`） |
| `check:a11y:sample` | 从 sitemap 分节抽样 12 页测 a11y（每周巡检，seed=ISO 周，补手写清单的盲区） |
| `check:a11y:fast` | 双主题 axe 快检（4 个模板 × 浅/深，约 32 秒）+ 三个浮层的键盘契约：搜索面板/照片灯箱/AI 助手（真按键，验焦点陷阱与焦点归还）；所有可见表单控件必须有可读名称（placeholder 不算） |
| `check:interactions` | 交互自检：搜索、灯箱、点赞、评分、主题切换、ETF/行情岛降级、SSR 直出，19 个场景（约 40 秒） |
| `check:runtime -- --vitals --cls=0.12 --lcp=8000` | 运行时自检：21 个代表页真实 Chromium，抓 pageerror / 控制台错误 / 同源 4xx；CLS > 0.12 或 LCP > 8 s 卡住（约 38 秒，参数与 `deploy.yml` 一致） |
| `check:font-fallback` | 字体回退的度量匹配（数字/日期/混排） |
| `check:feeds` | RSS/JSON Feed 结构与条数 |
| `check:seo` | canonical / 单一 h1 / JSON-LD |
| `check:admin` | Decap 后台的 `config.yml` schema（无头浏览器实测） |
| `check:focus` | 键盘焦点可见性（真按 Tab，明暗两主题；axe 测不到这一项） |
| `check:text-zoom` | 200% 文字缩放下不得横向溢出（预算只许降不许升） |
| `check:legible` | 移动端（412×823）≥12px 的文字要占全页 60% 以上 —— Lighthouse `font-size` 的同口径本地版；基线只许升不许降 |
| `node scripts/check-workflows.mjs` 的 `if:` 引号配对 | 同一份门禁里跑（GitHub 判 Invalid workflow file 的那类语法） |
| `node scripts/check-automation-health.mjs` | 每个 workflow 上次成功 vs 自己的 cron 频率（每周巡检里跑，不进门禁） |
| `check:lang-switch` | 语言切换链接必须指向存在且互链的对端；`<html lang>` 必须与路径一致 |

**部署时的自愈步骤**（`catch-up-digest` 任务）：日报缺失 → 补跑；行情快照 > 2 天 → 重抓。
两者都会产出 commit 并 dispatch 一次部署，且都有"验不过就回滚"的闸门。判断内容/数据是否新鲜
**不要看 cron 有没有跑**（GitHub schedule 会延迟 5–7 小时甚至整天不触发），要看仓库里有没有当天内容。

**线上体检**（手动/周巡检，不在门禁里）：`node scripts/check-prod-urls.mjs`
——抓线上 sitemap 里的每条 URL 真去打一遍，4xx/5xx 判失败，3xx 报警（sitemap 里不该出现重定向）。
构建期检查看的是 `dist/`，nginx、缓存、证书都不在其中，这一层只有它覆盖。
2026-11-22 首跑：1194 条全部 2xx，p50 18ms / p95 262ms。

**不在门禁里**（故意的）：`check:deps`、`check:server`、`check:freshness`、`check:search`
（默认打线上）、`check:a11y`（全站，2.5 分钟）、`check:a11y:sample`（每周）、
`check:perf`（弱网首屏，只记录不挡发布）、`check:market-age`（数据时效，另有定时任务看）、
`check:external-links`（5508 条外链，全量 10–15 分钟，且依赖外部站点）。
它们由 CI 或周巡检负责。

**运行时自检与交互自检必须留在门禁里**（第 143–144 轮的教训）：它们曾经只在 CI 跑，
结果本地全绿、推送后部署红并回滚。`tests/gate-covers-ci.test.ts` 钉住了这条，
并检查 `deploy.yml` 里出现的每个 `npm run` 脚本都真实存在。

```bash
# 外链体检（每周巡检自动跑；想手动看某几个站）
node scripts/check-external-links.mjs --hosts arxiv.org,openai.com
node scripts/check-external-links.mjs --limit 300          # 抽样
node scripts/check-external-links.mjs --json | jq '.byHost' # 死链按域名聚合

# 确认一条死链后，登记进基线（附理由），下次不再报
#   编辑 scripts/external-links-baseline.json：
#   { "https://example.com/gone": { "reason": "已下线，正文已换存档链接", "at": "2026-11-21" } }
```

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

## 8. 内容停更的自愈（第 113–114 轮）

`deploy.yml` 末尾有独立 job `catch-up-digest`：部署验收通过后，用
`check-freshness --max-age=2` 判断内容是否停更，停更就自动跑
`digest-fetch` + `translate-digest`，过两道质量闸（无占位符 / 中英成对）才 commit 并 push。

- **为什么要有**：本仓库 `schedule` 实测延迟 5–7.5 小时，还出现过整天不触发。
- **怎么判断它工作**：`git log origin/main` 里看有没有 `content: catch up a missed digest run`。
- **怎么读失败原因**：本仓库 Actions 日志接口 403，只能看 annotations 与 step summary ——
  所以每一步结论都打了 `::warning::` / `::notice::`。查 `try { gh api ... }`：
  `curl -s "https://api.github.com/repos/lzf00/zorotreeking/actions/runs/<id>/jobs"` 拿 steps，
  再看 run 页面的 annotations。
- **不需要人做的事**：正常情况下不用点 "Run workflow"；手动跑仍然可用（`Daily digest`）。

# 已知欠账（Known Debt）

这份清单只记**已经确认、还没修完**的问题，以及每条当前的真实数字。
数字由测试断言（`tests/known-debt.test.ts`）盯住：文档写 115 处，实测就必须是 115 处 ——
否则这条文档会变成"看着像在追踪，其实早就不对"的装饰品。

最近更新：第 151 轮（2026-11-22）。

| # | 欠账 | 当前数字 | 影响面 | 归属 | 检查命令 |
|---|---|---|---|---|---|
| 1 | 英文页里有未翻译的中文正文 | **20 个文件 / 115 处** | `/en/` 下 20 个 `market-recap-*` 页面（页面顶部已声明机翻） | 服务端生成器（stock_pusher） | `npm run check:i18n-leaks` |
| 2 | 日报缺摘要 | **38 期 / 299 条**（20 期整期全空，18 期部分缺） | 读者看到标题+链接，页面已如实提示"本期没有摘要" | 需 LLM key（`digest-fetch --force`） | `node scripts/check-digest-placeholders.mjs --all` |
| 3 | BLS 宏观数据停更 | **101 天**（2026-08-11 起） | `/invest/us-market/` 的 CPI/非农参考期停在 2026-06，页面已标注 | 服务端抓取器 | `npm run check:market-age` |
| 4 | ~~美股兜底快照陈旧~~ **已修** | 0 天 | 第 137 轮起宏观（BLS）与行情（东方财富）都由 Actions 每天自动刷新 | — | `npm run check:market-age` |
| 5 | Node 版本低于要求 | 本机 **22.23.2**，要求 ≥22.23.4 | 本地构建/测试环境 | 你 | `node -v` |
| 6 | nginx 三项加固未做 | 3 条 | 权限位/缓存头/错误页 | 你（见 `docs/nginx-hardening.md`） | 手工 |
| 7 | `/api/market/*` 冷启动 3.5s | 无 TTL | 首次访问行情慢 | 服务端 | 手工 |
| 9 | 相册页灯箱首开慢 | 首轮 576 ms，后续 16 ms | 无 GPU headless 的首帧层光栅化，非产品缺陷（主线程 idle 88%） | 已归因（第 129 轮） | `npm run perf:inp` |
| 8 | Lighthouse CI 频繁失败 | 近 10 次 5 失败 / 4 取消 | 单次 30–52 min，偶发预算告警 | 待观察（第 126 轮已修掉唯一硬失败项） | `gh run list` |

## 为什么这些不算"能修就修"

- **1、3、4**：代码在服务端（另一套仓库/进程），静态站只能如实标注，不能凭空造数据。
- **2**：需要 LLM key；本机没有 `.env`，只能在 Actions 里跑 `--force`。
- **5、6、7**：属于运行环境/运维配置，改动影响生产服务器，等你拍板。

## 已经"冻住"的防线

这些问题不再增长，是靠下面这些自动化盯着的：

| 防线 | 手段 | 什么时候跑 |
|---|---|---|
| 英文页中文残留不再变多 | `scripts/i18n-leaks-baseline.json` + `check-i18n-leaks.mjs` | 门禁 + 每周巡检 |
| 日报不再出现"摘要失败"占位符（中英） | `check-digest-placeholders.mjs --days=7` | 门禁 |
| 快照过旧会被发现 | `check-market-data-age.mjs` | 每周巡检（故意不进阻塞门禁） |
| 内容停更会被发现 | `check-freshness.mjs`（三条流水线 + 单语日） | 日报收尾 + 每周巡检 |
| 搜索索引不新/命中死链 | `check-search.mjs` | 门禁（`--dist`） |
| 15 | 日报索引页逼近解析预算 | `/invest/digest/` **227 KB**（内联 CSS 94 KB + 206 行列表） | 已越过 220 KB 的"解析成本"预算，按基线登记；gzip 只有 32 KB，传输没问题 | 结构方案需设计决定：分页 / 只渲染最近 N 期（当前每交易日自动加一行，只会更重） | 第 151 轮 |
| 10 | 1043 条外链体检不到 | 反爬域名（x.com/知乎/小红书/arxiv/eastmoney 等）对任何非浏览器请求回 403/429 | 体检只能覆盖 4454/5508，其余靠人工或浏览器实测 | 已知限制（第 132 轮） | `npm run check:external-links` |
| 11 | 列表页 HTML 偏大但 gzip 正常 | `/archive/` 347 KB raw / 32 KB gzip、`#auto` 301 KB / 31 KB | 传输成本正常，raw 只影响解析（毫秒级）；已按 gzip 预算单独把关 | 已知取舍（第 134 轮） | `npm run check:weight` 看 gzip 一列 |
| 12 | 2026-11-19、11-20 两天的 AI/投资日报缺失 | 2 天内容 | 站上这两天没有日报（复盘正常）；抓的是"最新列表"，历史条目已滚掉，补不回来 | 2026-11-19/20 的日报是**我们自己的 CI 配置**弄丢的（reusable workflow 权限高于调用方 → startup_failure 两天），不是源不给历史；内容本身确实补不回来 | `node scripts/check-freshness.mjs` |
| 13 | 线上 `/api/market/us` 仍返回 2026-08-11 的宏观数据 | 102 天 | 页面已按时间戳取新数据，不会被带坏；但接口本身仍是旧的 | 服务端刷新它自己的存储（不在本仓库） | `curl https://www.zorotreeking.online/api/market/us` |
| 14 | 相册照片的 `alt` 是文件名（如 `baokemeng-01`） | 全站相册 | 读屏用户听到的是编号，不是画面内容 | 需要人工为每张照片写一句描述（内容工作，非代码） | 扫 `dist/photo/*/index.html` 的 `aria-label` |

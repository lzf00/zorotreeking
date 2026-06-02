# 个人投资栏目融合 Wind / stock_pusher 方案

> 把 `~/projects/stock_pusher`（Wind 数据 + 每日推送）与 `zorotreeking` 的个人投资栏目融合的设计文档
>
> 起草：2026-06-02 · 状态：待决策

---

## 1. 现状盘点

### zorotreeking 已有

| 资产 | 路径 | 说明 |
|------|------|------|
| 投资内容栏目 | `src/content/invest/*.{zh,en}.mdx` | 月度复盘 + 已有 15 篇日 digest |
| 持仓数据栏目 | `src/content/invest-portfolio/{YYYY-MM}.yaml` + `_holdings.yaml` | 月度持仓快照 + 持仓清单 |
| 行情拉取脚本 | `scripts/invest-snapshot.ts` | **当前用新浪 API** |
| 投资页面 | `src/pages/invest/index.astro` + `[slug].astro` | 列表 + 详情 |
| 部署 CI | `.github/workflows/daily-digest.yml` | 每天 08:00 + 工作日 15:30 rebuild |
| 图表库 | `recharts` ^2.13.3（已在 deps） | 现成可用 |
| FastAPI 后端 | VPS 上跑 `AI_Agent/deepseek_chat_app.py` | 已有 SQLite + 可加 endpoint |
| Content schema | `src/content/config.ts` 已定义 `invest-portfolio` Zod | 字段已规范 |

### stock_pusher 已有（已完成 Wind 迁移）

| 能力 | 说明 |
|------|------|
| Wind 数据 4 模块 | 大盘 / 自选股 / 涨幅榜 / 板块 |
| 扩展指标 | 5日 / 20日 涨跌幅、主力 5 日净流入 |
| 市场情绪 | 涨停跌停、主力净流入 |
| 财经要闻 TOP3 | 标题 + 摘要 + 百度搜索链接 |
| 微信推送 | Server酱（已通） |
| 节假日 + 交易日判断 | 内置 2025/2026 假日表 |

### 缺什么（待补）

- ❌ zorotreeking 用的是**新浪**数据（精度低、字段少、未来可能被限）
- ❌ 持仓 yaml 只有"成本/现价/市值/权重"4 字段，没有"涨跌幅/振幅/5日/主力流入"
- ❌ 没有**投资看板页**，所有数据藏在 mdx / yaml 里
- ❌ 没有把每天 stock_pusher 推送的日报**归档到 invest 栏目**
- ❌ 没有**点持仓 → 看 K 线/财务**的实时查询能力

---

## 2. 推荐架构（数据流）

### 核心理念：解耦 + 复用

**stock_pusher** 当"数据生产者"（已经在跑 Wind），**zorotreeking** 当"展示消费者"。两者用 **git** 解耦——stock_pusher 把产出 commit 到 zorotreeking repo，触发 zorotreeking 的 CI 自动 build + 部署。

```
┌────────────────────────────────────────────────────────────────────┐
│  本机/VPS：stock_pusher                                              │
│  ─ launchd 每天 10:30 / 15:30 调 Wind 生成日报                       │
│  ─ 推送微信 ✓（已有）                                                │
│  ─ 【新增】成功后额外写两份文件到 zorotreeking repo:                  │
│       1) src/content/invest/digest-YYYY-MM-DD.zh.mdx                │
│       2) src/content/invest-portfolio/{YYYY-MM}.yaml (升级版)        │
│  ─ 【新增】git add + commit + push                                   │
└────────────────────────────────────────────────────────────────────┘
                                  │ push 触发
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│  GitHub Actions：deploy.yml                                          │
│  ─ npm ci                                                            │
│  ─ astro build（含新增 dashboard.astro 页面）                         │
│  ─ pagefind 索引                                                     │
│  ─ rsync → VPS nginx                                                 │
│  注：invest-snapshot.ts 不再被 CI 触发（数据已由 stock_pusher 生成）   │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│  线上 https://www.zorotreeking.online                                │
│  ─ /invest/                            列表（自动多 digest）          │
│  ─ /invest/dashboard       【新增】     看板：实时表格 + recharts 图表 │
│  ─ /invest/digest-YYYY-MM-DD 【新增】   日报详情页（mdx 自动归档）     │
│  ─ /api/invest/quote/:code 【可选】     FastAPI 实时查询（Phase 4）   │
└────────────────────────────────────────────────────────────────────┘
```

### 为什么这么做

| 方案 | 优点 | 缺点 |
|------|------|------|
| ✅ **本方案（stock_pusher 当生产者）** | 不动 CI；Wind 调用集中一处；零额外配置；明天 10:30 就能起效 | stock_pusher 必须在跑（本机或 VPS 上） |
| ❌ CI 装 wind-mcp-skill | 不依赖本机 | CI 慢；WIND_API_KEY 暴露给 GitHub；npx 装 node 子进程在 CI 不稳 |
| ❌ VPS 实时调 Wind | 实时性最高 | 需在 VPS 装 Wind skill；每次访问消耗 quota；与"静态站"哲学冲突 |

---

## 3. 改造 4 阶段

### Phase 1：stock_pusher → zorotreeking 自动归档 mdx（半小时）

**修改文件**：`stock_pusher/main.py`、新增 `stock_pusher/zorotreeking_publisher.py`

**逻辑**：
```python
# 推送成功后 hook
def publish_to_zorotreeking(title, content, stocks):
    # 1. 生成 mdx (frontmatter + content)
    # 2. 写到 zorotreeking/src/content/invest/digest-YYYY-MM-DD.zh.mdx
    # 3. git add + commit + push
```

**mdx frontmatter 示例**：
```yaml
---
lang: zh
translationKey: invest-digest-2026-06-02
title: "📊 06月02日股票日报"
description: "上证 4098 (+0.12%) · 涨停 127 / 跌停 13 · 主力净流入 +198 亿"
date: 2026-06-02
period: "2026-06"
tags: [日报, 自选股, 大盘]
---

（这里贴 build_report 生成的全部 markdown）
```

**配置**：
- 在 stock_pusher `.env` 加 `ZOROTREEKING_REPO_PATH=/Users/liuzf/Documents/Zoro_AI/zorotreeking`
- git push 用本机已配的 SSH 凭据（不引新密码）

**效果**：明天 10:30 起，zorotreeking 的 invest 栏目自动多一篇日报；GitHub Actions 自动 build + 部署；2 分钟后线上可见。

---

### Phase 2：升级持仓 yaml 用 Wind 数据（半小时-1 小时）

**修改文件**：`stock_pusher/zorotreeking_publisher.py`（在 Phase 1 之上扩展）

**逻辑**：
- 用 Wind 已经拉到的自选股数据，生成扩展版 portfolio yaml
- 比 `invest-snapshot.ts` 多带的字段：涨跌幅、振幅、5日 / 20日涨跌幅、主力 5日净流入

**新 yaml schema**（需要在 `src/content/config.ts` 加新可选字段）：
```yaml
period: "2026-06"
asOf: 2026-06-02T10:30:00Z
currency: CNY
totalValue: 123456.78
dataSource: wind          # 新增
holdings:
  - symbol: "600519.SH"   # 用 Wind 格式（原来 sh600519）
    name: "贵州茅台"
    market: A
    shares: 100
    costAvg: 1500
    lastPrice: 1275.98
    marketValue: 127598
    weight: 0.4126
    # === Wind 新增字段 ===
    changePct: -2.07
    amplitude: 2.53
    chg5d: -2.67
    chg20d: -9.07
    mainNet5dYi: -27.0
```

**Schema 升级**：`src/content/config.ts` 在 holdings 元素 schema 加可选字段，向下兼容现有 yaml。

**`invest-snapshot.ts` 处理**：保留作 fallback（万一 Wind 挂了用新浪兜底），但默认不再被 CI 调用。

---

### Phase 3：投资看板页面（1-2 小时）

**新增文件**：
- `src/pages/invest/dashboard.astro` —— 看板路由
- `src/components/invest/DashboardTable.tsx` —— React island 表格组件
- `src/components/invest/HoldingPieChart.tsx` —— 持仓权重饼图
- `src/components/invest/ChangeBarChart.tsx` —— 自选股涨跌幅柱图

**页面结构**（紧凑、参考微信版排版）：
```
┌────────────────────────────────────────────────────────┐
│ 📊 投资看板 · 06月02日 11:30 更新 · 数据来源 Wind        │
├────────────────────────────────────────────────────────┤
│ [📈 大盘]                                                │
│  上证指数 4098.64 +4.91 (+0.12%) ▲                      │
│  深证成指 15861.89 +125.42 (+0.80%) ▲                   │
│  创业板指 4125.07 +79.30 (+1.96%) ▲                     │
├────────────────────────────────────────────────────────┤
│ [🌡️ 市场情绪]                                            │
│  涨停 127 · 跌停 13 · 主力 +198.57亿（净流入）             │
├────────────────────────────────────────────────────────┤
│ [💼 自选股]  (表格 + 排序按钮)                            │
│  股票 | 现价 | 今日 | 5日 | 20日 | 主力5日(亿)            │
│  ...                                                    │
├────────────────────────────────────────────────────────┤
│ [📊 持仓权重]              [📊 自选股涨跌幅]              │
│   (recharts 饼图)            (recharts 柱图)             │
├────────────────────────────────────────────────────────┤
│ [🔥 涨幅榜] [💰 热门板块] [📰 今日要闻]                   │
│  (跟微信版一致)                                           │
├────────────────────────────────────────────────────────┤
│ [📚 历史日报]  → /invest/?tag=日报                       │
└────────────────────────────────────────────────────────┘
```

**数据来源**：
- 大盘 / 涨幅榜 / 板块 / 要闻：解析最新 `digest-YYYY-MM-DD.zh.mdx` 的 markdown
- 自选股 / 持仓权重 / 涨跌幅图：读最新 `invest-portfolio/{YYYY-MM}.yaml`

**风格**：复用 `BaseLayout` + Tailwind 设计令牌，跟站点其他栏目视觉一致。

---

### Phase 4（可选）：FastAPI 加实时查询（按需，1-2 小时）

**仅当**你想"点持仓 → 弹 K 线 / 财务详情"才做。

**新增端点**：
```
GET  /api/invest/quote/:code        实时报价
GET  /api/invest/kline/:code?days=30 K 线
GET  /api/invest/news?code=...&top=5 公告/新闻
```

**VPS 依赖**：装 `wind-mcp-skill` + `setup-key` + node

**前端**：dashboard 表格里给每只股加一个 ▼ 展开按钮，点开 React island 异步拉详情，画 K 线（recharts 或 Lightweight Charts）。

---

## 4. 关键决策点

### 决策 1：Wind 调用跑在哪
- **A. 只在本机 stock_pusher 跑（推荐）** —— 零额外配置
- B. GitHub Actions 装 wind-mcp-skill —— CI 慢、Key 暴露
- C. VPS 也装 wind-mcp-skill —— 仅 Phase 4 需要

### 决策 2：先动哪个阶段
- **Phase 1+2（推荐）** —— 半小时-1 小时，明天就能看到效果
- 只 Phase 1 —— 最小试水
- Phase 1+2+3 —— 2-3 小时，dashboard 直接上线

### 决策 3：自选股要不要等于持仓
当前 stock_pusher 的"自选股"配在 `stock_pusher/.env` 的 `STOCK_CODES`，跟 zorotreeking 的 `_holdings.yaml` **是两个清单**。

- **方案 A**：保持独立（自选股是"想关注"，持仓是"真买了"，确实是两个概念）
- **方案 B**：合并 —— stock_pusher 直接读 `_holdings.yaml`，跟着持仓变动
- **方案 C**：自选股 = 持仓 + 额外候选股清单

建议 **A**，但加个 zoro 单独的"候选关注列表"也行。

### 决策 4：归档 mdx 的频率
当前 stock_pusher 一天推 2 次（10:30 + 15:30）。归档时：
- **A. 只归档 15:30 收盘版**（每天一篇，干净）
- B. 两次都归档（每天两篇，盘中实时 + 收盘）
- C. 只归档 10:30 开盘版

建议 **A**，盘后数据全，最有研究价值。

### 决策 5：要不要双语
现有 invest 栏目支持中英双语。日报：
- **A. 只中文**（数据本就中文为主，不翻译）
- B. 中英都生成（多一道 LLM 翻译）

建议 **A**。

---

## 5. 风险 & 注意事项

| 风险 | 缓解 |
|------|------|
| stock_pusher 没跑（你 Mac 没开） | launchd 启动时会补跑漏掉的任务；或迁到 VPS 上跑 |
| Wind quota 用尽 | 当前每次推送 ~15 个 API 调用 × 2 次/天 = 30/天，远低于个人 quota |
| git push 冲突 | publisher 用 `git pull --rebase` 再 push；冲突时跳过本次归档（推送本身不依赖归档） |
| WIND_API_KEY 泄露 | Key 只在本机 `~/.wind-aifinmarket/config`；不进 git；不上 GitHub |
| 节假日空数据 | stock_pusher 已有 `is_trading_day()` 跳过，归档也跳过 |
| 数据延迟 | 15:30 推送 → git push → CI build → 部署，~3 分钟内线上可见 |

---

## 6. 工作量预估

| 阶段 | 工作量 | 价值 |
|------|------|------|
| Phase 1（归档 mdx） | 30 分钟 | ⭐⭐⭐⭐ 当晚就能看到 |
| Phase 2（升级持仓 yaml） | 45 分钟 | ⭐⭐⭐ 数据更丰富 |
| Phase 3（dashboard 页面） | 1.5-2 小时 | ⭐⭐⭐⭐⭐ 网站质变 |
| Phase 4（实时 API） | 1.5 小时 | ⭐⭐ 偶尔用，不急 |
| **合计 Phase 1+2+3** | **3 小时** | **明天 dashboard 上线，每日报告自动归档** |

---

## 7. 决策清单 → 我开工

你只需要回我：

1. **Wind 跑在哪**：A（本机）/ B（CI）/ C（VPS）
2. **先动哪阶段**：1 / 1+2 / 1+2+3 / 全部
3. **自选股 vs 持仓**：A（独立）/ B（合并）/ C（叠加）
4. **归档频率**：A（只 15:30）/ B（两次）/ C（只 10:30）
5. **双语**：A（只中文）/ B（中英）

**推荐组合**：A + Phase 1+2+3 + A + A + A

要不要按推荐组合直接动手？或者你先有自己的想法再讨论也行。

---

## 附录 A：相关文件位置

```
stock_pusher（本机）
├── main.py                          [Phase 1 改这个，加 publisher hook]
├── stock_fetcher.py                 [不动，复用 build_report]
├── zorotreeking_publisher.py        [Phase 1 新建]
└── .env                             [加 ZOROTREEKING_REPO_PATH]

zorotreeking
├── src/content/config.ts            [Phase 2 加可选字段]
├── src/content/invest/
│   └── digest-YYYY-MM-DD.zh.mdx     [Phase 1 起自动生成]
├── src/content/invest-portfolio/
│   └── {YYYY-MM}.yaml               [Phase 2 起被升级]
├── src/pages/invest/dashboard.astro [Phase 3 新建]
├── src/components/invest/           [Phase 3 新建 3 个组件]
└── AI_Agent/deepseek_chat_app.py    [Phase 4 加 3 个 endpoint]
```

## 附录 B：依赖检查

| 依赖 | 状态 |
|------|------|
| stock_pusher 已能跑通 Wind | ✅ |
| zorotreeking `recharts` 已装 | ✅ |
| zorotreeking SSH key 能 push（看 .git/config） | 待验证 |
| stock_pusher 跟 zorotreeking 同机 | ✅ 都在你 Mac 上 |
| Wind API quota 够用 | ✅ 30/天，个人额度无压力 |

## 附录 C：升级 schema 的兼容性

`src/content/config.ts` 的 `invest-portfolio` schema 当前已有 8 个字段（symbol/name/market/shares/costAvg/lastPrice/marketValue/weight）。Phase 2 新增字段全部用 `.optional()`，已有的 2026-03/04 yaml 不需要改。

---

文档完。等你回复决策清单后开工。

# Wind 万得金融能力完整清单

> 本文档整理 Wind 官方 AI Agent Skill 生态的全部可用能力，作为 `stock_pusher` 项目的能力地图与扩展参考。
>
> 来源：`~/.agents/skills/wind-find-finance-skill/` + `~/.agents/skills/wind-mcp-skill/` 官方文档
>
> 更新时间：2026-06-01

---

## 目录

- [1. 总览](#1-总览)
- [2. wind-mcp-skill：数据底座（8 大 server_type）](#2-wind-mcp-skill数据底座8-大-server_type)
  - [2.1 stock_data（A 股）](#21-stock_dataa-股)
  - [2.2 global_stock_data（港股 / 美股）](#22-global_stock_data港股--美股)
  - [2.3 fund_data（基金 / ETF / LOF）](#23-fund_data基金--etf--lof)
  - [2.4 index_data（指数 / 板块）](#24-index_data指数--板块)
  - [2.5 bond_data（债券）](#25-bond_data债券)
  - [2.6 financial_docs（公告 / 新闻）](#26-financial_docs公告--新闻)
  - [2.7 economic_data（宏观 / EDB）](#27-economic_data宏观--edb)
  - [2.8 analytics_data（通用兜底）](#28-analytics_data通用兜底)
- [3. indicators.md：指标 / 字段词典](#3-indicatorsmd指标--字段词典)
- [4. Wind 生态全 skill 清单](#4-wind-生态全-skill-清单)
  - [4.1 数据类 skill](#41-数据类-skill)
  - [4.2 Alice 综合分析（14 个子 skill）](#42-alice-综合分析14-个子-skill)
  - [4.3 工作流 / 决策类 skill（30+）](#43-工作流--决策类-skill30)
- [5. 错误码字典与故障处理](#5-错误码字典与故障处理)
- [6. CLI 调用方式](#6-cli-调用方式)
- [7. 本项目使用情况与扩展建议](#7-本项目使用情况与扩展建议)

---

## 1. 总览

### 1.1 两个核心 skill 的关系

```
┌───────────────────────────────────────────────────────────┐
│  wind-find-finance-skill  （路由 / 发现 / 安装入口）        │
│  - 没装时帮你找需要装什么                                   │
│  - 已装时引导用户进入正确的工作流                            │
│  - 不直接取数，不需要 API Key                               │
└───────────────────────────────────────────────────────────┘
                            ↓ 路由到
┌───────────────────────────────────────────────────────────┐
│  wind-mcp-skill  （数据底座）                              │
│  - 实际调用万得 Wind API                                    │
│  - 8 大 server_type，30+ 个 tool                            │
│  - 需要 WIND_API_KEY（通过 setup-key 配置）                 │
└───────────────────────────────────────────────────────────┘
                            ↓ 必要时兜底
┌───────────────────────────────────────────────────────────┐
│  wind-alice  （Alice 综合分析 Agent，可选）                 │
│  - 自然语言入口，承载 14 个子 skill                          │
│  - 用于专项 API 兜不住的复杂分析                             │
└───────────────────────────────────────────────────────────┘
```

### 1.2 当前安装状态

| skill | 状态 | 路径 |
|------|------|------|
| `wind-find-finance-skill` | ✅ 已装（global） | `~/.agents/skills/wind-find-finance-skill/` |
| `wind-mcp-skill` | ✅ 已装（global） | `~/.agents/skills/wind-mcp-skill/` |
| `wind-alice` | ⏸️ 未装 | - |
| 工作流 skill（30+） | ⏸️ 未装 | - |

### 1.3 API Key 配置

```bash
# 配置（已完成）
cd ~/.agents/skills/wind-mcp-skill
node scripts/cli.mjs setup-key <KEY> --scope global

# 配置文件
~/.wind-aifinmarket/config

# 检查顺序：环境变量 > 全局配置 > skill 配置
```

获取 KEY：https://aifinmarket.wind.com.cn/#/user/overview

### 1.4 总能力地图

| 维度 | 能力数 |
|------|------|
| **数据 API**（wind-mcp-skill） | 8 server_type × 30+ tools |
| **指标字段词典**（indicators.md） | 23 类 × 200+ 字段 |
| **Alice 子 skill** | 14 个综合分析能力 |
| **工作流 skill** | 30+ 个估值/复盘/选股/交易/事件分析 |

---

## 2. wind-mcp-skill：数据底座（8 大 server_type）

### 2.1 stock_data（A 股）

**10 个工具**：

| tool_name | 入参 | 用途 | 项目已用 |
|---|---|---|---|
| `search_stocks` | `question`(+lang/version) | 自然语言选股筛选，返回代码列表 | ❌ |
| `get_stock_price_indicators` | `windcode` + `indexes` | **行情快照（最新价/涨跌幅/各类字段）** | ✅ |
| `get_stock_kline` | `windcode` + `begin_date` + `end_date`(+period/count/aftime/...) | K 线历史序列 | ❌ |
| `get_stock_quote` | `windcode`(+begin/end) | 分钟行情、日内走势 | ❌ |
| `get_stock_basicinfo` | `question`(+lang) | 公司档案、主营、行业、IPO、上市板 | ❌ |
| `get_stock_fundamentals` | `question`(+lang) | 盈利、资产负债、利润、现金流、ROE、增长率 | ❌ |
| `get_stock_equity_holders` | `question`(+lang) | 股本、流通、前十大股东、实控人、限售 | ❌ |
| `get_stock_events` | `question`(+lang) | IPO、增发、配股、并购、ST、分红 | ❌ |
| `get_stock_technicals` | `question`(+lang) | MACD、KDJ、RSI、BOLL、融资融券、龙虎榜 | ❌ |
| `get_risk_metrics` | `question`(+lang) | Beta、Jensen Alpha、波动率、Sharpe、VaR | ❌ |

**调用示例：**
```bash
# 茅台最新价 + 涨跌幅
node scripts/cli.mjs call stock_data get_stock_price_indicators \
  '{"windcode":"600519.SH","indexes":"中文简称,最新成交价,涨跌幅,成交量"}'

# 选股筛选
node scripts/cli.mjs call stock_data search_stocks \
  '{"question":"筛选沪深市场市值超500亿且连续5日上涨的股票"}'

# 日 K 线
node scripts/cli.mjs call stock_data get_stock_kline \
  '{"windcode":"600519.SH","begin_date":"20260401","end_date":"20260430"}'

# 财务（自然语言）
node scripts/cli.mjs call stock_data get_stock_fundamentals \
  '{"question":"贵州茅台2024年ROE和净利润增速"}'

# 股东
node scripts/cli.mjs call stock_data get_stock_equity_holders \
  '{"question":"贵州茅台前十大股东"}'

# 技术指标
node scripts/cli.mjs call stock_data get_stock_technicals \
  '{"question":"贵州茅台近60日MACD走势"}'

# 风险
node scripts/cli.mjs call stock_data get_risk_metrics \
  '{"question":"贵州茅台过去1年Beta和波动率"}'
```

---

### 2.2 global_stock_data（港股 / 美股）

**10 个工具**（与 stock_data 一一对应）：

| tool_name | 用途 |
|---|---|
| `search_global_stocks` | 港股 / 美股选股筛选 |
| `get_global_stock_price_indicators` | 行情快照 |
| `get_global_stock_kline` | K 线 |
| `get_global_stock_quote` | 分钟行情 |
| `get_global_stock_basicinfo` | 档案、注册地、交易所、行业、指数成份 |
| `get_global_stock_fundamentals` | 财务、PE/PB/PS、历史分位 |
| `get_global_stock_equity_holders` | 股本、主要股东、机构持仓 |
| `get_global_stock_events` | IPO、增发、并购、监管、分红 |
| `get_global_stock_technicals` | 多周期涨跌幅、MACD、KDJ、RSI、BOLL |
| `get_global_stock_risk_metrics` | Beta、Alpha、波动率、Sharpe、回撤、VaR |

**调用示例：**
```bash
# 苹果最新价
node scripts/cli.mjs call global_stock_data get_global_stock_price_indicators \
  '{"windcode":"AAPL.O","indexes":"中文简称,最新成交价,涨跌幅,52周最高,52周最低"}'

# 腾讯 K 线
node scripts/cli.mjs call global_stock_data get_global_stock_kline \
  '{"windcode":"00700.HK","begin_date":"20260401","end_date":"20260430"}'

# 选港股
node scripts/cli.mjs call global_stock_data search_global_stocks \
  '{"question":"筛选港股中市值超1000亿港元的科技股"}'
```

代码格式：港股 `00700.HK`、美股 `AAPL.O` / `MSFT.O`

---

### 2.3 fund_data（基金 / ETF / LOF）

**10 个工具**：

| tool_name | 用途 |
|---|---|
| `search_funds` | 基金筛选 |
| `get_fund_price_indicators` | 行情快照（净值、IOPV、贴水率、规模等） |
| `get_fund_kline` | 净值 K 线 |
| `get_fund_quote` | 分钟行情（ETF 二级交易） |
| `get_fund_info` | 档案、费率、经理、风格、业绩基准 |
| `get_fund_financials` | 利润、净值、收入、费用、分红 |
| `get_fund_holdings` | 重仓股、资产配置、行业配置 |
| `get_fund_performance` | 业绩、排名、ETF / 二级交易 |
| `get_fund_holders` | 持有人结构、申赎、规模变动 |
| `get_fund_company_info` | 基金公司档案、经理团队 |

**调用示例：**
```bash
# ETF 净值与贴水
node scripts/cli.mjs call fund_data get_fund_price_indicators \
  '{"windcode":"588200.SH","indexes":"中文简称,最新成交价,IOPV,贴水率"}'

# 基金筛选
node scripts/cli.mjs call fund_data search_funds \
  '{"question":"筛选股票型基金中近一年收益率超20%的产品"}'

# 重仓股
node scripts/cli.mjs call fund_data get_fund_holdings \
  '{"question":"易方达蓝筹精选(005827.OF)最新一期重仓股"}'
```

代码格式：场外基金 `005827.OF`、ETF `588200.SH` / `159915.SZ`

---

### 2.4 index_data（指数 / 板块）

**6 个工具**：

| tool_name | 入参 | 用途 | 项目已用 |
|---|---|---|---|
| `get_index_price_indicators` | `windcode` + `indexes` | **指数行情快照** | ✅ |
| `get_index_kline` | `windcode` + 日期 | 指数 K 线 | ❌ |
| `get_index_quote` | `windcode` | 分钟行情 | ❌ |
| `get_index_basicinfo` | `question` | 档案、发布机构、基日、基点、成份数 | ❌ |
| `get_index_fundamentals` | `question` | **PE/PB/PS、营收、利润、现金流、历史分位** | ❌ |
| `get_index_technicals` | `question` | 多周期涨跌幅、趋向、能量、波动 | ❌ |

**调用示例：**
```bash
# 沪深 300 现价
node scripts/cli.mjs call index_data get_index_price_indicators \
  '{"windcode":"000300.SH","indexes":"最新成交价,涨跌幅,成交量,成交额"}'

# 沪深 300 估值分位
node scripts/cli.mjs call index_data get_index_fundamentals \
  '{"question":"沪深300PE/PB历史分位"}'

# 中证 500 技术
node scripts/cli.mjs call index_data get_index_technicals \
  '{"question":"中证500的MACD和RSI"}'
```

常用指数代码：上证 `000001.SH`、深成 `399001.SZ`、创业板 `399006.SZ`、沪深 300 `000300.SH`、中证 500 `000905.SH`、恒生 `HSI.HI`

---

### 2.5 bond_data（债券）

**4 个工具**（**无行情快照**，全部走 NL）：

| tool_name | 用途 |
|---|---|
| `get_bond_basicinfo` | 档案、发行、规模、价格、票面利率、期限 |
| `get_bond_issuer_info` | 发债主体名称、注册地、行业、股权结构 |
| `get_bond_market_data` | 报价、估价、溢价、久期、凸性、利差 |
| `get_bond_financial_data` | 主体营收、利润、资产、负债 |

**调用示例：**
```bash
node scripts/cli.mjs call bond_data get_bond_basicinfo \
  '{"question":"国债2601基本信息"}'

node scripts/cli.mjs call bond_data get_bond_market_data \
  '{"question":"国债2601久期和凸性"}'
```

---

### 2.6 financial_docs（公告 / 新闻）

**2 个工具**：

| tool_name | 入参 | 用途 | 项目已用 |
|---|---|---|---|
| `get_company_announcements` | `query` + `top_k` | **官方公告、年报、季报、招股书** | ❌ |
| `get_financial_news` | `query` + `top_k` | 第三方财经新闻、市场报道 | ✅ |

**返回字段**：`title` / `content` / `date` / `doc_type` / `relevance`（⚠️ 不含原文 URL）

**调用示例：**
```bash
# 美联储相关新闻 TOP5
node scripts/cli.mjs call financial_docs get_financial_news \
  '{"query":"美联储利率政策","top_k":5}'

# 茅台年报
node scripts/cli.mjs call financial_docs get_company_announcements \
  '{"query":"贵州茅台2024年年报","top_k":3}'
```

---

### 2.7 economic_data（宏观 / EDB）

**1 个工具**：

| tool_name | 入参 |
|---|---|
| `get_economic_data` | `metricIdsStr`(+beginDate/endDate/freq/magnitude/currency) |

**参数取值**：

| 参数 | 取值 |
|---|---|
| `freq` | `日`=`1`, `工作日`=`2`, `周`=`3`, `月`=`4`, `季`=`5`, `半年`=`6`, `年`=`7`, `年度`=`8` |
| `magnitude` | `个`, `千`, `万`, `百万`, `千万`, `亿`, `十亿`, `百亿`, `千亿`, `万亿` |
| `currency` | `USD`, `CNY`, `EUR`, `JPY`, `AUD`, `GBP`, `CHF`, `CAD`, `SGD`, `HKD` |
| `searchType` | `深度`=`0`, `精确`=`1` |

**调用示例：**
```bash
# 中国 CPI 同比月度数据
node scripts/cli.mjs call economic_data get_economic_data \
  '{"metricIdsStr":"中国CPI同比","freq":"月","beginDate":"20240101","endDate":"20261231"}'
```

---

### 2.8 analytics_data（通用兜底）

**1 个工具**：

| tool_name | 入参 | 用途 | 项目已用 |
|---|---|---|---|
| `get_financial_data` | `question`(+lang) | 专项工具覆盖不了的通用结构化取数 | ✅（涨幅榜/板块/市场情绪） |

⚠️ **不是"复杂问题入口"**：只有专项工具失败或不覆盖时才用。

**调用示例：**
```bash
node scripts/cli.mjs call analytics_data get_financial_data \
  '{"question":"今日沪深A股涨幅前5的股票名称代码最新价涨跌幅"}'
```

---

## 3. indicators.md：指标 / 字段词典

`indexes` 参数取值的**唯一权威字典**。23 个类别，必须**逐字复制**。

### 3.1 类别索引

| 类别 | 字段数 | 适用品种 |
|------|------|---------|
| **元数据 / 基础行情** | 10 | 通用 |
| **盘口五档** | 22 | 通用 |
| **成交统计** | 12 | 通用 |
| **期货专属** | 7 | 期货 |
| **基础元信息** | 9 | 通用 |
| **估值** | 5 | 股票 + 指数 |
| **流动性 / 振幅** | 5 | 通用 |
| **多周期涨跌幅** | 7 | 通用 |
| **市值 / 52 周** | 4 | 股票 + 指数 |
| **股息 / 涨跌停** | 8 | 股票 |
| **基金净值与规模** | 19 | 基金专属 |
| **债券价格-收益率** | 40+ | 债券 |
| **可转债** | 13 | 可转债 |
| **期权** | 40+ | 期权 |
| **资金流向** | 15 | 通用 |
| **技术指标** | 20+ | 通用 |
| **盘中异动** | 14 | 通用 |
| **盘前盘后** | 9 | 通用 |
| **指数专属** | 2 | 指数 |
| **历史多周期 / 涨跌幅扩展** | 8 | 通用 |
| **期权统计** | 6 | 期权 |
| **债券 YTC/P 与 YCU 形态** | 30+ | 债券 |
| **其它** | 1 | - |

### 3.2 最常用字段速查

#### 元数据 / 基础行情
```
最新交易日 · 交易时间 · 最新成交价 · 前收盘价
今日开盘价 · 今日最高价 · 今日最低价 · 成交量 · 现额 · 现量
```

#### 估值（股票 + 指数）
```
市净率 · 市净率(LF) · 市盈率(TTM) · 市盈率(LYR) · 市盈率(预测)
```
> ⚠️ 括号区分含义不同口径，必须照抄

#### 多周期涨跌幅
```
5日涨跌幅 · 10日涨跌幅 · 20日涨跌幅 · 60日涨跌幅
120日涨跌幅 · 250日涨跌幅 · 年初至今涨跌幅
```

#### 流动性 / 振幅
```
换手率 · 量比 · 委比 · 振幅 · 基于Wind算法的量比
```

#### 市值 / 52 周
```
总市值1（流通口径）· 流通市值 · 总市值2（含限售股）· 52周最高 · 52周最低
```

#### 资金流向
```
连红天数 · 当日主力净流入额 · 当日主力净流入占比
近5日主力净流入额 · 近5日主力净流入占比 · 近5日主力净流入天数
近10日主力净流入额 · 近10日主力净流入占比 · 近10日主力净流入天数
近20/60日主力净流入(额/占比/天数)
```

#### 基金净值与规模（基金专属）
```
最新净值 · 上期净值 · 累计净值
最新净值增长率 · 年初以来净值增长率 · 成立以来净值增长率
近一周/一月/一季/半年/一年/两年/三年/五年净值增长率
贴水率 · 基金最新份额 · 申购状态 · 整体溢价率
基金综合评级 · 基金规模 · 七日年化收益率 · 万份基金收益 · IOPV
```

#### 技术指标
```
指数平滑异同移动平均（MACD）· DIF快线
随机指标K/D/J值（KDJ）
6/12周期相对强弱指标（RSI）
抛物线转向指标（SAR）
布林中/上/下轨（BOLL）
5/10/20/60/120/250周期移动平均（MA）
连续上涨天数 · 5日乖离率 · 36日乖离
14周期顺势指标（CCI）· 26周期能量指标（OBV）· 12周期心理线指标（PSY）
```

#### 股息 / 涨跌停
```
股息率 · 涨停价 · 跌停价 · 回收价
上涨家数 · 下跌家数 · 平盘家数 · 正股换手率
```

#### 盘中异动
```
火箭发射 · 高台跳水 · 涨停封板 · 跌停封板 · 涨停开板 · 跌停开板
涨幅达到3% · 跌幅达到3% · 创20日新高 · 创20日新低
主力挂单买入 · 主力挂单卖出 · 主力撤单买入 · 主力撤单卖出
```

### 3.3 字段陷阱（铁律）

1. **必须照抄字面**：`市净率(LF)`、`涨跌`、`涨跌幅`、`5分钟涨跌幅`、`市盈率(TTM)`、`52周最高`、`基于Wind算法的量比`，括号 / 全角字符 / 阿拉伯数字一字不差
2. **括号区分含义**：`市盈率(TTM)` / `市盈率(LYR)` / `市盈率(预测)` 是三个不同字段；`总市值1` / `总市值2` 同理（2 含限售股）
3. **极易混淆**：`涨跌`(元) ≠ `涨跌幅`(%) ≠ `涨跌BP`(bp，债券专用) ≠ `5分钟涨跌幅`
4. **字段返空时**：不要在快照工具里反复试拼写，直接切 NL 类工具（如 `get_stock_technicals`、`get_stock_fundamentals`）兜底

---

## 4. Wind 生态全 skill 清单

### 4.1 数据类 skill

| 名称 | category | 装好需配置 | 用途 |
|------|----------|-----------|------|
| **wind-mcp-skill** ✅ | 数据-行情/基金/股票/宏观/文档 | API Key | 万得 Wind 金融数据 API |
| **wind-alice** ⏸️ | Alice 专业金融分析 Agent | API Key | Alice 综合分析入口 |
| `tushare-finance-skill` | 数据-多资产 | Token | Tushare Pro（替代源） |

### 4.2 Alice 综合分析（14 个子 skill）

由 `wind-alice` 统一承载，按需调用：

| 中文名 | 英文 skill 名 | 适合问题 |
|--------|--------------|---------|
| 通胀情景债券轮动策略 | `Inflation Bond Strategy` | CPI/PPI 拐点驱动的债券、货基、久期轮动策略 |
| 宏观数据解读 | `Macro Data Interpretation` | CPI、PPI、PMI、GDP、社融研究周报式解读 |
| 按主题选股 | `Thematic Stock Screening` | 拆解市场主线、验证主题逻辑、筛选受益标的 |
| 债券利率走势研判 | `Bond Rate Outlook` | 交易/策略/配置视角研判债券利率 |
| 信用分析 | `Credit Analysis` | 主体信用、财务现金流、评级、违约概率 |
| 基金对比分析 | `Fund Compare` | 多只基金业绩、风险、持仓对比 |
| 基金筛选与投资建议 | `Fund Screening & Investment Advisory` | 多维筛选基金 + 投顾式建议 |
| 投资标的创意与筛选 | `Investment Idea Generation` | 基于因子和主题扫描生成投资创意 |
| 公司一页纸 | `Company One-Page Investment Memo` | 上市公司一页纸投资报告 |
| 上市公司调研问题清单 | `Stock DD List` | 买方视角调研备忘录 + 深度议题 |
| 全球上市公司季报点评 | `Global Share Quarterly Earnings Review` | 全球财报点评 beat/miss |
| 市场规模测算与战略建模 | `Market Sizing & Strategic Modeling` | Top-down / Bottom-up 市场规模测算 |
| 可比公司分析 | `fsi-comps-analysis` | 机构级可比公司分析 + Excel + 文字报告 |
| 事实核验 | `Fact Check` | 逐点核查金融数据、声明、事件 |

### 4.3 工作流 / 决策类 skill（30+）

按用途分类：

#### 估值（4 个）
| skill | 用途 |
|------|------|
| `dcf-model` | DCF 估值建模（WACC + 敏感性分析） |
| `earnings-analysis` | 季报点评（beat/miss + 估值更新） |
| `valuation-pricing-framework` | 估值与定价框架（重估空间判断） |
| `valuation_snapshot_skill` | 快速判断估值高低、分位、重估触发条件 |

#### 个股研究（5 个）
| skill | 用途 |
|------|------|
| `equity-investment-thesis` | 个股投资逻辑深度研究（券商研究员风格） |
| `bull_bear_case_builder_skill` | 同步搭建看多看空逻辑，找核心分歧 |
| `peer_comparison_decision_skill` | 横向比较候选公司，辅助二选一 |
| `moat_strength_review_skill` | 评估护城河真实性、可持续性、回报转化 |
| `business_model_decoder_skill` | 把公司如何获客、赚钱、扩张讲清楚 |

#### 市场主线（7 个）
| skill | 用途 |
|------|------|
| `a-share-primary-theme-identification` | A 股市场主线识别（题材周期 / 资金行为） |
| `market-environment-analysis` | 全球市场环境分析（risk-on / risk-off） |
| `theme-detector` | 跨板块主题检测（FINVIZ + 生命周期） |
| `sector_rotation_radar_skill` | 板块强弱切换、资金迁移、风格变化 |
| `market_regime_switch_skill` | 判断市场进攻/防守/震荡/切换阶段 |
| `institutional_position_shift_skill` | 机构持仓变化、共识迁移 |
| `theme_leader_identification_skill` | 题材龙头 / 中军 / 跟随股识别 |

#### 选股（4 个）
| skill | 用途 |
|------|------|
| `breakout_candidate_finder_skill` | 形态成熟、放量待发的突破候选股 |
| `pullback_opportunity_finder_skill` | 回调充分但趋势未破的低吸候选股 |
| `high_quality_compounder_finder_skill` | 高 ROE、高护城河的核心复利股 |
| `theme_leader_identification_skill` | 题材龙头识别（与上面重复） |

#### 事件 / 公告 / 财报（4 个）
| skill | 用途 |
|------|------|
| `major_announcement_impact_skill` | 并购、减持、定增等重大公告影响分析 |
| `conference_call_takeaway_skill` | 业绩会关键信息、管理层表态、警讯 |
| `guidance_change_impact_skill` | 业绩指引上修下修的含义和影响 |
| `sec_filing_question_answer_skill` | 10-K / 10-Q / 招股书精准答疑 |

#### 复盘 / 仓位 / 回测（4 个）
| skill | 用途 |
|------|------|
| `post-market-debrief` | 盘后复盘（市场全景 / 主线轮动） |
| `position-sizer` | 仓位管理（风险 / Kelly / ATR） |
| `position_sizing_decision_skill` | 按风险预算和波动给单笔仓位 |
| `backtest-expert` | 量化策略系统化回测 + 压力测试 |

#### 交易执行（4 个）
| skill | 用途 |
|------|------|
| `trade_plan_builder_skill` | 入场、仓位、止损、止盈完整计划 |
| `stop_loss_discipline_skill` | 价格/逻辑/时间三类止损规则 |
| `take_profit_ladder_skill` | 分层兑现、保本上移、尾仓持有 |
| `position_sizing_decision_skill` | （同仓位组） |

---

## 5. 错误码字典与故障处理

### 5.1 envelope 协议

```
成功：exit code 0，stdout 输出纯数据（透传 result.content[0].text）
失败：exit code 1，stdout 输出 envelope:
  { ok: false, error: { code, agent_action } }
```

### 5.2 14 个错误码

| code | 含义 | 处理 |
|------|------|------|
| `TEMPORARILY_UNAVAILABLE` | 后端临时不可用 | 原样重试一次 |
| `INVALID_PARAM_NAME` | 字段名错或缺必填 | 查 tool-contracts.md 修字段名 |
| `INVALID_PARAM_VALUE` | 字段名对但值不合法 | 查 indicators.md / tool-contracts.md 修值 |
| `USAGE_ERROR` | 命令用法错 | 改 CLI 形态，不改业务参数 |
| `INVALID_PARAMS_JSON` | 第三参数 JSON 解析失败 | 按 shell 类型修引号，用 argv 探针校准 |
| `ROUTE_ERROR` | server_type / tool_name 不存在 | 按 detail 列表重选，不要直接 fallback analytics |
| `PARAM_VALIDATION_ERROR` | 业务参数校验未通过 | 只修 detail 指出的错误 |
| `AUTH_ERROR` | Key 未配置或失效 | 跑 `setup-key <KEY> --scope global` |
| `QUOTA_ERROR` | 额度 / 限流 / 余额 | 等额度刷新 / 限流恢复 / 充值 |
| `NETWORK_ERROR` | 网络或 HTTP 5xx | 修网络 / 稍后重试 |
| `TOOL_RUNTIME_ERROR` | 后端工具运行错 | 按 detail 缩小范围或换字段 |
| `NO_RESULTS` | 后端成功但无数据 | 调一次关键词或时间，再无果切 analytics 兜底 |
| `SETUP_ERROR` | setup-key / open-portal 失败 | 检查 scope / 路径 / 浏览器 |
| `UNKNOWN` | 未知错误 | 看 detail 识别归属域 |

### 5.3 不可兜底的错误

以下错误**不可**用 `analytics_data` 或 `wind-alice` 绕过，必须修根因：
- AUTH_ERROR / QUOTA_ERROR
- NETWORK_ERROR / TEMPORARILY_UNAVAILABLE
- INVALID_PARAMS_JSON
- ROUTE_ERROR

---

## 6. CLI 调用方式

### 6.1 命令格式

```bash
cd ~/.agents/skills/wind-mcp-skill
node scripts/cli.mjs call <server_type> <tool_name> '<params_json>'
```

### 6.2 params_json 的引号写法（按 shell 类型）

| 执行路径 | `<params_json>` 写法 |
|---|---|
| Bash / zsh / sh / Git Bash / WSL | `'{"windcode":"600519.SH"}'` |
| Windows PowerShell | `'{\"windcode\":\"600519.SH\"}'` |
| cmd.exe | `"{\"windcode\":\"600519.SH\"}"` |
| agent 工具 / JSON-RPC 包装器 | 先按 Bash 式，命中 `INVALID_PARAMS_JSON` 时用 argv 探针校准 |

### 6.3 路由顺序（多义意图）

按最具体优先：

1. 公告 / 年报 / 季报 → `financial_docs.get_company_announcements`
2. 新闻 / 媒体 / 快讯 → `financial_docs.get_financial_news`
3. 宏观 / EDB → `economic_data.get_economic_data`
4. A 股选股（未指定标的） → `stock_data.search_stocks`
5. 港股 / 美股选股（未指定） → `global_stock_data.search_global_stocks`
6. 基金选股（未指定） → `fund_data.search_funds`
7. 最新价 / K 线 / 区间走势 → 对应市场的行情工具
8. 财务 / 股东 / 事件 / 技术 / 风险 → 对应领域 NL 工具
9. 专项不覆盖的结构化取数 → `analytics_data.get_financial_data`（兜底）

### 6.4 单标的铁律

单次工具调用**只允许一个标的**：
- ❌ `"windcode":"600519.SH,000858.SZ"`
- ❌ `"windcode":["600519.SH","000858.SZ"]`
- ✅ 多标的 → 拆成多次调用后合并

### 6.5 Python wrapper（本项目示例）

见 `stock_fetcher.py` 的 `_wind_call()` 实现：
```python
def _wind_call(server_type, tool_name, params, timeout=60, retries=2):
    cmd = ["node", "scripts/cli.mjs", "call", server_type, tool_name,
           json.dumps(params, ensure_ascii=False)]
    # subprocess.run + 解析 envelope
    ...
    return inner.get("data")
```

---

## 7. 本项目使用情况与扩展建议

### 7.1 当前使用率

| 类型 | 使用率 | 详情 |
|------|--------|------|
| wind-mcp-skill 工具 | **4 / 34（~12%）** | 见下表 |
| Alice 子 skill | 0 / 14 | 全部未用 |
| 工作流 skill | 0 / 30+ | 全部未用 |

### 7.2 已用工具明细

| server_type | tool_name | 用途 |
|---|---|---|
| `stock_data` | `get_stock_price_indicators` | 自选股行情 + 多周期 + 资金流 |
| `index_data` | `get_index_price_indicators` | 上证 / 深成 / 创业板大盘 |
| `analytics_data` | `get_financial_data` | 涨幅榜 / 板块排行 / 市场情绪（兜底） |
| `financial_docs` | `get_financial_news` | 财经要闻 TOP3 |

### 7.3 高价值未用 API（不装新 skill）

#### 🟢 Tier 1：立刻能加到日报
| API | 加什么模块 | 价值 |
|---|---|---|
| `stock_data.get_stock_price_indicators` 加 `市盈率(TTM),市净率,股息率` | 自选股扩展列 | 一眼看自选股贵不贵 |
| `index_data.get_index_fundamentals` | 大盘 PE/PB 历史分位 | 整体市场温度 |
| `financial_docs.get_company_announcements` | 自选股公告（有才显示） | 重大事件提醒 |
| `economic_data.get_economic_data` | 宏观快照（CPI/PPI/PMI） | 月度宏观底盘 |
| `stock_data.get_stock_technicals` | 自选股技术信号（MACD 金叉/RSI 超卖） | 短线进出参考 |
| `stock_data.get_stock_events` | 自选股近期事件（分红/增发/ST） | 风险提示 |

#### 🟡 Tier 2：偏专业的查询能力（按需）
| API | 用途 |
|---|---|
| `stock_data.search_stocks` | "今日5日连涨 + 主力净流入 + PE<20" 选股 |
| `stock_data.get_stock_kline` | 自选股近 30 日 K 线（如果想做技术分析） |
| `stock_data.get_stock_fundamentals` | ROE / 净利润增速 / 现金流分析 |
| `stock_data.get_risk_metrics` | Beta / 波动率 / Sharpe |

### 7.4 装新 skill 的"质变"建议

| 装什么 | 收益 |
|------|------|
| `wind-alice` | 日报中加一段 200 字 **"今日市场主线 AI 解读"** |
| `post-market-debrief` | 15:30 收盘版加 **"盘后 AI 复盘"** 章节 |
| `a-share-primary-theme-identification` | 替换板块部分，给出**资金主线**而非单纯涨幅 |
| `valuation_snapshot_skill` | 自选股 **估值分位快照** 章节 |

### 7.5 暂不推荐（与本项目场景不匹配）

- `global_stock_data` 全套：当前只关注 A 股
- `fund_data` 全套：当前不持有基金
- `bond_data` 全套：当前不关注债券
- DCF 估值 / 个股深度研究类：是"召唤式"工具，不适合定时推送

---

## 附录 A：常用标的代码格式

| 市场 | 格式 | 示例 |
|------|------|------|
| 沪市 A 股 | `XXXXXX.SH` | `600519.SH` (贵州茅台) |
| 深市 A 股 | `XXXXXX.SZ` | `000858.SZ` (五粮液) |
| 创业板 | `300XXX.SZ` / `301XXX.SZ` | `300750.SZ` (宁德时代) |
| 科创板 | `688XXX.SH` | `688981.SH` (中芯国际) |
| 北交所 | `XXXXXX.BJ` | `920725.BJ` (惠丰钻石) |
| 港股 | `XXXXX.HK` | `00700.HK` (腾讯) |
| 美股 | `XXX.O / .N` | `AAPL.O` (苹果) |
| 场外基金 | `XXXXXX.OF` | `005827.OF` (易方达蓝筹精选) |
| ETF | `XXXXXX.SH` / `XXXXXX.SZ` | `588200.SH` / `159915.SZ` |
| 指数 | `XXXXXX.SH` / `.SZ` / `.HI` / `.SI` | `000300.SH` (沪深300) / `HSI.HI` (恒生) / `801770.SI` (申万通信) |

## 附录 B：安装命令速查

```bash
# 全局安装（推荐）
npx skills add https://gitee.com/wind_info/wind-skills.git --skill <name> -g -y

# 仅当前项目（去掉 -g）
npx skills add https://gitee.com/wind_info/wind-skills.git --skill <name> -y

# 升级所有已装 skill
npx skills update -g -y
```

可装 skill 名：`wind-mcp-skill` / `wind-find-finance-skill` / `wind-alice` / 30+ 工作流 skill 名见 §4.3

## 附录 C：本文档来源文件

- `~/.agents/skills/wind-find-finance-skill/SKILL.md`
- `~/.agents/skills/wind-find-finance-skill/references/skills-catalog.md`
- `~/.agents/skills/wind-mcp-skill/SKILL.md`
- `~/.agents/skills/wind-mcp-skill/references/tool-manifest.json`
- `~/.agents/skills/wind-mcp-skill/references/tool-contracts.md`
- `~/.agents/skills/wind-mcp-skill/references/indicators.md`
- `~/.agents/skills/wind-mcp-skill/references/fallback-alice.md`
- `~/.agents/skills/wind-mcp-skill/references/error-codes.json`

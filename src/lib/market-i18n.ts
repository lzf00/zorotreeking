/**
 * 行情看板的中英文案。
 *
 * 为什么单独放一个文件：`/invest/` 和 `/en/invest/` 用的是同一批 React 岛
 * （MarketIndicesGrid / MarketSentiment / LiveHoldings / StockSpotlight / SectorRanking），
 * 文案原本全写死在组件里，英文页只能缺整块内容。把文案抽出来后，两个语言共用
 * 同一套组件，组件只多收一个 `lang` 属性。
 *
 * 约定：
 *  - 键名用语义化英文，不要用「label1」这种位置名；
 *  - 带参数的文案用函数，避免在组件里拼字符串；
 *  - 数字单位按语言习惯转换：中文「亿 / 万亿」，英文「B / T」。
 */

export type MarketLang = "zh" | "en";

/** 中文里 1 亿 = 0.1 B，1 万亿 = 1 T */
export function formatYi(yi: number, lang: MarketLang): string {
  if (!Number.isFinite(yi)) return "—";
  const zh = lang !== "en";
  if (zh) {
    if (yi >= 10000) return `${(yi / 10000).toFixed(2)} 万亿`;
    return `${yi.toFixed(2)} 亿`;
  }
  if (yi >= 10000) return `${(yi / 10000).toFixed(2)}T`;
  return `${(yi / 10).toFixed(1)}B`;
}

/**
 * 申万二级行业的英文名。
 *
 * 上游（Wind）只给中文板块名，`/en/invest/` 上原本整列都是中文，读起来像没翻译完。
 * 这里给常见板块一份人工译文；**找不到就回落到中文原名**（宁可显示中文，也不要瞎翻译）。
 *
 * 注意：
 *  - 键必须和 Wind 返回的字符串**完全一致**（含「Ⅱ」这种罗马数字后缀）；
 *  - 只翻译板块名，不翻译 `lead_stock`（那是个股专有名词，保留中文原名更准确）。
 */
const SECTOR_NAMES_EN: Record<string, string> = {
  银行: "Banks",
  "银行Ⅱ": "Banks II",
  保险: "Insurance",
  证券: "Securities",
  多元金融: "Diversified Financials",
  金融控股: "Financial Holdings",
  房地产: "Real Estate",
  房地产开发: "Real Estate Development",
  水泥制造: "Cement",
  玻璃制造: "Glass",
  装修建材: "Home Decoration Materials",
  涂料: "Coatings",
  化学制品: "Chemicals",
  化学原料: "Chemical Raw Materials",
  化学纤维: "Chemical Fibers",
  氨纶: "Spandex",
  氮肥: "Nitrogen Fertilizer",
  磷肥及磷化工: "Phosphate Fertilizer & Chemicals",
  钾肥: "Potash Fertilizer",
  农药: "Pesticides",
  石油石化: "Oil & Petrochemicals",
  煤炭开采: "Coal Mining",
  焦炭: "Coke",
  电力: "Power Utilities",
  电能综合服务: "Integrated Power Services",
  燃气: "Gas Utilities",
  环保: "Environmental Protection",
  水务: "Water Utilities",
  航空运输: "Airlines",
  航运港口: "Shipping & Ports",
  物流: "Logistics",
  铁路公路: "Railways & Highways",
  汽车整车: "Automobiles",
  电动乘用车: "Electric Passenger Vehicles",
  汽车零部件: "Auto Parts",
  汽车服务: "Auto Services",
  白色家电: "Major Home Appliances",
  黑色家电: "Consumer Electronics Appliances",
  彩电: "Color TVs",
  厨卫电器: "Kitchen & Bath Appliances",
  食品加工: "Food Processing",
  饮料乳品: "Beverages & Dairy",
  白酒: "Baijiu (Liquor)",
  啤酒: "Beer",
  调味发酵品: "Condiments & Fermented Foods",
  休闲食品: "Snack Foods",
  农产品加工: "Agricultural Processing",
  养殖业: "Livestock & Aquaculture",
  种植业: "Crop Farming",
  农业综合: "Diversified Agriculture",
  饲料: "Animal Feed",
  纺织制造: "Textile Manufacturing",
  服装家纺: "Apparel & Home Textiles",
  化妆品: "Cosmetics",
  医药商业: "Pharmaceutical Distribution",
  化学制药: "Chemical Pharmaceuticals",
  生物制品: "Biological Products",
  中药: "Traditional Chinese Medicine",
  医疗器械: "Medical Devices",
  医疗服务: "Healthcare Services",
  半导体设备: "Semiconductor Equipment",
  分立器件: "Discrete Devices",
  集成电路制造: "IC Manufacturing",
  集成电路封测: "IC Packaging & Testing",
  "IC设计": "IC Design",
  面板: "Display Panels",
  消费电子: "Consumer Electronics",
  元件: "Electronic Components",
  光学光电子: "Optoelectronics",
  通信设备: "Communication Equipment",
  通信服务: "Telecom Services",
  软件开发: "Software Development",
  计算机设备: "Computer Hardware",
  游戏: "Gaming",
  IT服务: "IT Services",
  互联网服务: "Internet Services",
  影视院线: "Film & Cinema",
  广告营销: "Advertising & Marketing",
  教育出版: "Education & Publishing",
  旅游及景区: "Travel & Scenic Spots",
  酒店餐饮: "Hotels & Restaurants",
  零售: "Retail",
  贸易: "Trading",
  专业连锁: "Specialty Retail Chains",
  电子商务: "E-commerce",
  物流综合: "Integrated Logistics",
  军工电子: "Military Electronics",
  航空航天: "Aerospace & Defense",
  船舶制造: "Shipbuilding",
  机械设备: "Machinery",
  通用设备: "General Machinery",
  专用设备: "Specialized Machinery",
  自动化设备: "Automation Equipment",
  电池: "Batteries",
  光伏设备: "Solar Equipment",
  风电设备: "Wind Power Equipment",
  电网设备: "Power Grid Equipment",
  电机: "Electric Motors",
  家电零部件: "Home Appliance Parts",
  稀土: "Rare Earths",
  金属新材料: "Metal New Materials",
  小金属: "Minor Metals",
  工业金属: "Industrial Metals",
  贵金属: "Precious Metals",
  钢铁: "Steel",
  冶钢原料: "Steelmaking Raw Materials",
  "水泥": "Cement",
  基建: "Infrastructure",
  国际工程: "International Engineering",
  工程咨询服务: "Engineering Consulting",
  专业工程: "Specialty Engineering",
  装饰装修: "Decoration & Renovation",
  房屋建设: "Housing Construction",
  通信工程: "Communication Engineering",
  环境治理: "Environmental Remediation",
  综合: "Conglomerates",
  "综合Ⅱ": "Conglomerates II",
  非银金融: "Non-bank Financials",
  商贸零售: "Commerce & Retail",
  社会服务: "Social Services",
  传媒: "Media",
  计算机: "Computers",
  电子: "Electronics",
  通信: "Telecommunications",
  国防军工: "Defense & Military",
  电力设备: "Power Equipment",
  医药生物: "Pharmaceuticals & Biotech",
  食品饮料: "Food & Beverage",
  家用电器: "Home Appliances",
  轻工制造: "Light Manufacturing",
  纺织服饰: "Textiles & Apparel",
  建筑装饰: "Construction & Decoration",
  建筑材料: "Building Materials",
  交通运输: "Transportation",
  公用事业: "Utilities",
  基础化工: "Basic Chemicals",
  有色金属: "Non-ferrous Metals",
  钢铁Ⅱ: "Steel II",
  煤炭: "Coal",
  农林牧渔: "Agriculture, Forestry & Fishing",
  汽车: "Automobiles",
  机械设备Ⅱ: "Machinery II",
  环保Ⅱ: "Environmental Protection II",
};

/** 申万板块名 → 目标语言。英文页查不到译文时回落到中文原名。 */
export function sectorName(name: string | null | undefined, lang: MarketLang): string {
  const raw = String(name ?? "").trim();
  if (!raw) return "—";
  if (lang === "en") return SECTOR_NAMES_EN[raw] ?? raw;
  return raw;
}

/**
 * 常见指数的英文名。上游（Wind / 东财）只返回中文名，英文页直接显示就成了
 * 「Today's market」里混一排中文，所以按代码给一份映射；未知代码回落到原值。
 */
const INDEX_NAMES_EN: Record<string, string> = {
  "000001.SH": "SSE Composite",
  "399001.SZ": "SZSE Component",
  "399006.SZ": "ChiNext",
  "000688.SH": "STAR 50",
  "000300.SH": "CSI 300",
  "000905.SH": "CSI 500",
  "000016.SH": "SSE 50",
  HSI: "Hang Seng",
  HSCEI: "Hang Seng China Enterprises",
  HSTECH: "Hang Seng TECH",
  IXIC: "Nasdaq Composite",
  DJI: "Dow Jones",
  SPX: "S&P 500",
  "1.000001": "SSE Composite",
  "0.399001": "SZSE Component",
  "0.399006": "ChiNext",
};

export function indexName(code: string | undefined, fallback: string | null | undefined, lang: MarketLang): string {
  const raw = String(code ?? "").toUpperCase();
  if (lang === "en") {
    const hit = INDEX_NAMES_EN[raw] ?? INDEX_NAMES_EN[raw.replace(/^[01]\./, "")];
    if (hit) return hit;
  }
  return fallback || raw || "—";
}

const ZH = {
  lang: "zh" as MarketLang,
  loadFailed: "加载失败",
  networkError: "网络异常",
  sourceUnreachable: "行情源暂时连不上",
  rateLimited: "请求太频繁，稍后再试",
  retry: "重试",
  none: "—",
  sentenceEnd: "。",
  sourcePrefix: "数据源 ",
  loadFailedPrefix: (what: string) => `${what}加载失败：`,

  // ── 数据来源 ──
  sourceEastmoney: "东方财富公开行情",
  sourceWindSnapshot: "Wind 静态兜底快照",
  sourceTencent: "腾讯行情",
  sourceSinaSector: "新浪行业板块",
  sourceSnapshot: "收盘快照",
  apiResponse: "接口响应",
  snapshotTime: "快照时间",
  liveNotUpdated: "· 实时接口尚未成功更新",
  staleNote: "· 数据陈旧（上游异常）",
  marketClosedNote: "（非交易时段，已停止自动刷新）",

  // ── 今日大盘 ──
  indicesLoadFailed: "大盘行情加载失败：",

  // ── 市场情绪 ──
  turnoverTitle: "沪深两市成交额",
  shanghai: "沪市",
  shenzhen: "深市",
  breadthTitle: "市场宽度",
  breadthCount: (n: number) => `（${n} 只）`,
  breadthMissing: "涨跌家数暂缺（公开接口未返回）",
  flatShort: (n: number) => `平 ${n}`,
  breadthRates: (up: string, flat: string, down: string) => `涨 ${up}% · 平 ${flat}% · 跌 ${down}%`,
  limitTitle: "涨停 / 跌停",
  limitMissing: "涨停统计暂缺",
  limitUp: "涨停 10cm/20cm",
  limitDown: "跌停 10cm/20cm",
  sentimentSource: "数据 腾讯成交额 + 新浪/东财涨跌家数 · 后端缓存 90s",

  // ── 持仓 / 基金净值 ──
  holdingsLoadFailed: "持仓净值加载失败：",
  holdingsEmpty: "持仓列表为空，先补充 src/content/invest-portfolio/_holdings.yaml",
  holdingsNoData: "接口未返回可展示的基金数据",
  holdingsBadShape: "返回数据格式不符合预期（基金代码缺失）",
  httpError: (status: number, statusText: string) => `接口响应异常：${status} ${statusText}`,
  valuationCoverage: (valued: number, total: number) => `${valued}/${total} 只有正式净值`,
  dateRange: (from: string, to: string) => `${from} 至 ${to}`,
  placeholderNote:
    "当前未接入证券账户，只展示可核验的公开基金净值；份额、成本、市值和盈亏已隐藏，避免示例数据被误认为真实持仓。",
  simulationNote: (start: string, baseline: string) =>
    `模拟组合，不是证券账户数据：每只基金在 ${start} 设定投入 ¥10,000；因起始日无净值，按 ${baseline} 正式单位净值成交，未计申购与赎回费用。`,
  refreshFailedKeep: "刷新失败，正在保留上次数据：",
  qualityTitle: "数据质量保护已启用：",
  qualityNavRegression: "检测到上游净值日期倒退，当前保留上一份有效数据。",
  qualityLargeMove: "检测到单位净值大幅变化，请结合基金公告核对。",
  qualityPctMismatch: "上游涨跌幅与相邻净值不一致，盈亏已按单位净值差计算。",
  mvSimulated: "模拟市值",
  mvNav: "净值市值",
  todayPnl: "最近净值日盈亏",
  totalPnlSimulated: "累计模拟盈亏",
  totalPnl: "累计盈亏",
  capitalSimulated: "模拟本金",
  holdingCount: "持仓数",
  waitingQuotes: "等待可用行情",
  perFund: (n: number) => `${n} 只 · 每只 ¥10,000`,
  costOccupied: (amount: string) => `占用成本 ¥${amount}`,
  dataMethod: "数据口径",
  officialNav: "正式净值",
  noIntradayEstimate: "不使用盘中估算",
  navCoverage: "净值覆盖",
  exactCodeMatch: "代码严格匹配",
  latestNavDate: "最新净值日",
  perFundAnnouncement: "以基金公告为准",
  fundCount: "基金数",
  notLinked: "未接入账户持仓",
  colCode: "代码",
  colFund: "基金",
  colSharesSimulated: "模拟份额",
  colShares: "份额",
  colBaselineNav: "起始净值",
  colCostNav: "成本净值",
  colNav: "单位净值",
  colNavChange: "净值日涨跌",
  colMvSimulated: "模拟市值",
  colMv: "净值市值",
  colPnl: "累计盈亏",
  principal: (amount: string) => `本金 ¥${amount}`,
  holdingsSource: "数据源 天天基金公开历史净值 · 仅使用已公布单位净值（不使用盘中估算）",
  navDateLabel: "净值日期",
  inNavWindow: "（净值发布窗口，每 5 分钟检查）",
  outNavWindow: "（当前不在净值发布窗口）",
  simulationStart: (start: string) => `· 模拟起点 ${start}`,
  partialMissing: (ok: number, asked: number) => `· 部分基金缺失（${ok}/${asked}）`,

  // ── 个股聚焦 ──
  sectorAvg: "板块平均：",
  colName: "名称",
  colPrice: "现价",
  colChange: "涨跌",
  colChangePct: "涨跌幅",
  colBusiness: "主营",

  // ── 行业板块 ──
  sectorUpTitle: "涨幅榜",
  sectorTaxonomyNote: "板块名沿用数据源的申万二级行业原始名称，未做翻译。",
  sectorDownTitle: "跌幅榜",
  sectorRelativeBottomTitle: "涨幅后十",
  sectorDownPending: "后十名待实时数据",
  sectorCount: (n: string) => `细分行业板块共 ${n} 个`,
  sectorNoData: "暂无数据",

  // ── 页面标题 / 说明 ──
  sectionToday: "今日大盘",
  sectionSentiment: "市场情绪",
  sectionHoldingsActual: "我的持仓（已公布净值）",
  sectionHoldingsSimulated: (capital: string) => `模拟组合（每只本金 ¥${capital}）`,
  sectionHoldingsPlaceholder: "基金净值跟踪（未接入账户）",
  sectionAiFocus: "🤖 AI · 科创聚焦",
  sectionChiNext: "🚀 创业板风向",
  sectionSectors: "📊 行业板块涨跌",
  officialUnitNav: "官方单位净值",
  liveBadge: "Live",
  disclaimer:
    "本页证券行情由东方财富公开接口提供；基金估值仅使用天天基金公开的已公布单位净值，不提供盘中净值估算。当前持仓份额与成本为占位 / 学习日志，不构成任何投资建议。历史业绩不代表未来表现，市场有风险，入市需谨慎。",
  disclaimerStrong: "不构成任何投资建议",
  monthlySnapshot: "月度快照",
  monthlySnapshotLatest: (period: string) => `最新快照：${period}（每月由 cron 写入 `,
  monthlySnapshotTail: "）",
};

const EN: typeof ZH = {
  lang: "en" as MarketLang,
  loadFailed: "Load failed",
  networkError: "Network error",
  sourceUnreachable: "Market data source is unreachable right now",
  rateLimited: "Too many requests, try again shortly",
  retry: "Retry",
  none: "—",
  sentenceEnd: ".",
  sourcePrefix: "Source: ",
  loadFailedPrefix: (what: string) => `Failed to load ${what}: `,

  sourceEastmoney: "Eastmoney public quotes",
  sourceWindSnapshot: "Wind static fallback snapshot",
  sourceTencent: "Tencent quotes",
  sourceSinaSector: "Sina sector indices",
  sourceSnapshot: "Closing snapshot",
  apiResponse: "API response",
  snapshotTime: "snapshot time",
  liveNotUpdated: "· live API has not refreshed yet",
  staleNote: "· stale data (upstream error)",
  marketClosedNote: "(outside trading hours — auto refresh paused)",

  indicesLoadFailed: "Failed to load market indices: ",

  turnoverTitle: "Turnover (SSE + SZSE)",
  shanghai: "Shanghai",
  shenzhen: "Shenzhen",
  breadthTitle: "Market breadth",
  breadthCount: (n: number) => ` (${n} stocks)`,
  breadthMissing: "Breadth data unavailable (public API returned nothing)",
  flatShort: (n: number) => `flat ${n}`,
  breadthRates: (up: string, flat: string, down: string) => `Up ${up}% · Flat ${flat}% · Down ${down}%`,
  limitTitle: "Limit up / limit down",
  limitMissing: "Limit-move stats unavailable",
  limitUp: "Limit up 10%/20%",
  limitDown: "Limit down 10%/20%",
  sentimentSource: "Data: Tencent turnover + Sina/Eastmoney breadth · server cache 90s",

  holdingsLoadFailed: "Failed to load fund NAVs: ",
  holdingsEmpty: "No holdings yet — add them in src/content/invest-portfolio/_holdings.yaml",
  holdingsNoData: "The API returned no fund data to display",
  holdingsBadShape: "Unexpected response shape (fund code missing)",
  httpError: (status: number, statusText: string) => `Unexpected API response: ${status} ${statusText}`,
  valuationCoverage: (valued: number, total: number) => `${valued}/${total} with official NAV`,
  dateRange: (from: string, to: string) => `${from} – ${to}`,
  placeholderNote:
    "No brokerage account is linked. Only verifiable public fund NAVs are shown; shares, cost, market value and P&L are hidden so sample data is not mistaken for a real portfolio.",
  simulationNote: (start: string, baseline: string) =>
    `Simulated portfolio, not brokerage data: ¥10,000 per fund from ${start}. Because no NAV exists on the start date, units were bought at the official NAV of ${baseline}; subscription and redemption fees are not modelled.`,
  refreshFailedKeep: "Refresh failed — keeping the previous data: ",
  qualityTitle: "Data-quality guard is active: ",
  qualityNavRegression: "upstream NAV date went backwards, so the last valid data is kept.",
  qualityLargeMove: "a large NAV jump was detected; check the fund announcement.",
  qualityPctMismatch: "upstream change % disagrees with adjacent NAVs, so P&L is computed from NAV differences.",
  mvSimulated: "Simulated value",
  mvNav: "NAV value",
  todayPnl: "P&L on latest NAV day",
  totalPnlSimulated: "Total simulated P&L",
  totalPnl: "Total P&L",
  capitalSimulated: "Simulated capital",
  holdingCount: "Holdings",
  waitingQuotes: "waiting for quotes",
  perFund: (n: number) => `${n} funds · ¥10,000 each`,
  costOccupied: (amount: string) => `cost ¥${amount}`,
  dataMethod: "Data basis",
  officialNav: "Official NAV",
  noIntradayEstimate: "no intraday estimate",
  navCoverage: "NAV coverage",
  exactCodeMatch: "exact code match",
  latestNavDate: "Latest NAV date",
  perFundAnnouncement: "per fund announcement",
  fundCount: "Funds",
  notLinked: "account not linked",
  colCode: "Code",
  colFund: "Fund",
  colSharesSimulated: "Sim. units",
  colShares: "Units",
  colBaselineNav: "Start NAV",
  colCostNav: "Cost NAV",
  colNav: "Unit NAV",
  colNavChange: "NAV day chg",
  colMvSimulated: "Sim. value",
  colMv: "NAV value",
  colPnl: "Total P&L",
  principal: (amount: string) => `principal ¥${amount}`,
  holdingsSource: "Source: Tiantian Fund (TTJJ) public NAV history · official NAV only (no intraday estimates)",
  navDateLabel: "NAV date",
  inNavWindow: "(NAV publication window — checked every 5 min)",
  outNavWindow: "(outside the NAV publication window)",
  simulationStart: (start: string) => `· simulation start ${start}`,
  partialMissing: (ok: number, asked: number) => `· some funds missing (${ok}/${asked})`,

  sectorAvg: "Sector average: ",
  colName: "Name",
  colPrice: "Price",
  colChange: "Change",
  colChangePct: "Change %",
  colBusiness: "Business",

  sectorUpTitle: "Top gainers",
  sectorTaxonomyNote: "Sector names follow the data source's SW level-2 industry taxonomy; common sectors are shown in English, the rest keep their original Chinese names.",
  sectorDownTitle: "Top losers",
  sectorRelativeBottomTitle: "Smallest gainers",
  sectorDownPending: "Bottom 10 pending live data",
  sectorCount: (n: string) => `${n} sub-industries`,
  sectorNoData: "No data",

  sectionToday: "Today's market",
  sectionSentiment: "Market sentiment",
  sectionHoldingsActual: "My portfolio (published NAVs)",
  sectionHoldingsSimulated: (capital: string) => `Simulated portfolio (¥${capital} per fund)`,
  sectionHoldingsPlaceholder: "Fund NAV tracker (account not linked)",
  sectionAiFocus: "🤖 AI · STAR Market focus",
  sectionChiNext: "🚀 ChiNext movers",
  sectionSectors: "📊 Sector performance",
  officialUnitNav: "official unit NAV",
  liveBadge: "Live",
  disclaimer:
    "Quotes on this page come from Eastmoney's public API. Fund valuation uses only published unit NAVs from Tiantian Fund (TTJJ) — no intraday estimates. Current shares and cost are placeholders / a learning log and are not investment advice. Past performance does not guarantee future results; markets carry risk.",
  disclaimerStrong: "not investment advice",
  monthlySnapshot: "Monthly snapshot",
  monthlySnapshotLatest: (period: string) => `Latest snapshot: ${period} (written monthly by cron into `,
  monthlySnapshotTail: ")",
};

export function marketLabels(lang: MarketLang = "zh") {
  return lang === "en" ? EN : ZH;
}

export type MarketLabels = ReturnType<typeof marketLabels>;

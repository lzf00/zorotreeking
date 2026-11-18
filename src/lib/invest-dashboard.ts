import fs from "node:fs";
import path from "node:path";

import type { MarketLang } from "./market-i18n";

/**
 * `/invest/` 与 `/en/invest/` 共用的看板数据装载。
 *
 * 为什么抽出来：这段逻辑原本只写在中文页的 frontmatter 里（读持仓底表、解析
 * Wind 快照、拼 SSR 兜底报价、行业板块前后十名）。英文页要显示同一批内容，
 * 复制一份等于养两个会缓慢分叉的实现，所以统一收敛到这里。
 */

export type Holding = {
  symbol: string;
  name: string;
  /** 英文页显示名（人工翻译，非官方译名）；缺省时回落到中文名 */
  nameEn?: string;
  shares: number;
  costAvg: number;
  initialCapital?: number;
  baselineDate?: string;
  subscriptionFeePct?: number;
};

export type PortfolioMode = "actual" | "simulation" | "placeholder";

export type IndexSeed = {
  code: string;
  name: string;
  market: "A" | "HK" | "US";
  price: number | null;
  change: number | null;
  change_pct: number | null;
};

export type SectorSeed = { code: string; name: string; price: null; change_pct: number };

export type WatchQuote = {
  secid: string;
  code: string;
  name: string | null;
  price: number | null;
  change: number | null;
  change_pct: number | null;
};

export type StockSeed = { secid: string; display_name: string; note: string };

/** 解析 _holdings.yaml（只支持这个文件用到的固定结构，避免额外依赖） */
export function parseHoldings(text: string): Holding[] {
  const lines = text.split("\n").map((l) => l.replace(/#.*$/, ""));
  const out: Holding[] = [];
  let cur: Record<string, unknown> | null = null;
  let inHoldings = false;
  for (const line of lines) {
    if (/^holdings:/.test(line)) {
      inHoldings = true;
      continue;
    }
    if (!inHoldings) continue;
    if (/^\S/.test(line) && line.trim()) break; // 出到下一个顶级 key
    const dash = line.match(/^\s*-\s+symbol:\s*"?([^"]+)"?\s*$/);
    if (dash) {
      if (cur) out.push(cur as unknown as Holding);
      cur = { symbol: dash[1], name: "", shares: 0, costAvg: 0 };
      continue;
    }
    const kv = line.match(/^\s+(\w+):\s*"?([^"]+)"?\s*$/);
    if (kv && cur) {
      const [, k, v] = kv;
      if (k === "name") cur.name = v;
      else if (k === "nameEn") cur.nameEn = v;
      else if (k === "shares") cur.shares = Number(v);
      else if (k === "costAvg") cur.costAvg = Number(v);
      else if (k === "initialCapital") cur.initialCapital = Number(v);
      else if (k === "baselineDate") cur.baselineDate = v;
      else if (k === "subscriptionFeePct") cur.subscriptionFeePct = Number(v);
    }
  }
  if (cur) out.push(cur as unknown as Holding);
  return out;
}

/** AI 科创聚焦 / 创业板风向的股票池（中英各一份名称与说明） */
const STOCK_POOLS = {
  aiKechuang: [
    { secid: "1.688981", zh: ["中芯国际", "晶圆代工龙头"], en: ["SMIC", "Wafer foundry leader"] },
    { secid: "1.688256", zh: ["寒武纪", "AI 加速芯片"], en: ["Cambricon", "AI accelerator chips"] },
    { secid: "1.688041", zh: ["海光信息", "国产 CPU / DCU"], en: ["Hygon", "Domestic CPU / DCU"] },
    { secid: "1.601138", zh: ["工业富联", "AI 服务器代工"], en: ["Foxconn Industrial", "AI server ODM"] },
    { secid: "0.300308", zh: ["中际旭创", "AI 服务器光模块"], en: ["Innolight", "AI server optical modules"] },
    { secid: "0.002371", zh: ["北方华创", "半导体设备"], en: ["NAURA", "Semiconductor equipment"] },
    { secid: "0.300474", zh: ["景嘉微", "国产 GPU"], en: ["Jingjia Micro", "Domestic GPU"] },
    { secid: "0.002463", zh: ["沪电股份", "AI 服务器 PCB"], en: ["WUS", "AI server PCBs"] },
    { secid: "1.688008", zh: ["澜起科技", "内存接口芯片"], en: ["Montage", "Memory interface chips"] },
    { secid: "0.300782", zh: ["卓胜微", "射频前端"], en: ["Maxscend", "RF front-end"] },
  ],
  chinext: [
    { secid: "0.300750", zh: ["宁德时代", "动力电池"], en: ["CATL", "EV batteries"] },
    { secid: "0.300760", zh: ["迈瑞医疗", "医疗器械"], en: ["Mindray", "Medical devices"] },
    { secid: "0.300059", zh: ["东方财富", "互联网券商"], en: ["Eastmoney", "Online brokerage"] },
    { secid: "0.300124", zh: ["汇川技术", "工业自动化"], en: ["Inovance", "Industrial automation"] },
    { secid: "0.300274", zh: ["阳光电源", "光伏逆变器"], en: ["Sungrow", "PV inverters"] },
    { secid: "0.300033", zh: ["同花顺", "金融科技"], en: ["Hithink RoyalFlush", "Financial software"] },
    { secid: "0.300999", zh: ["金龙鱼", "粮油食品"], en: ["Yihai Kerry", "Grains & oils"] },
    { secid: "0.300015", zh: ["爱尔眼科", "眼科连锁"], en: ["Aier Eye", "Eye hospital chain"] },
    { secid: "0.300450", zh: ["先导智能", "锂电设备"], en: ["Lead Intelligent", "Battery equipment"] },
    { secid: "0.300866", zh: ["安克创新", "消费电子出海"], en: ["Anker", "Consumer electronics"] },
  ],
} as const;

export function stockSeeds(lang: MarketLang): { aiKechuang: StockSeed[]; chinext: StockSeed[] } {
  const pick = (rows: readonly { secid: string; zh: readonly [string, string]; en: readonly [string, string] }[]) =>
    rows.map((r) => {
      const [display_name, note] = lang === "en" ? r.en : r.zh;
      return { secid: r.secid, display_name, note };
    });
  return { aiKechuang: pick(STOCK_POOLS.aiKechuang), chinext: pick(STOCK_POOLS.chinext) };
}

export type WindSnapshot = {
  initialIndices: IndexSeed[];
  initialSectors?: {
    ok: boolean;
    ts: number;
    total: number;
    top_up: SectorSeed[];
    top_down: SectorSeed[];
    stale: boolean;
  };
  initialSentiment?: { ok: boolean; ts: number; breadth: { limit_up: number; limit_down: number } };
  initialMarketUpdated?: number;
  initialWatchQuotes: Record<string, WatchQuote>;
};

/** 构建时读 src/data/wind-market-latest.json，产出 SSR 兜底数据（无 JS 也能看到数字） */
export function loadWindSnapshot(root = process.cwd()): WindSnapshot {
  const result: WindSnapshot = { initialIndices: [], initialWatchQuotes: {} };
  let raw: string;
  try {
    raw = fs.readFileSync(path.resolve(root, "src/data/wind-market-latest.json"), "utf-8");
  } catch {
    return result; // 没有快照文件就走纯客户端
  }
  let wind: any;
  try {
    wind = JSON.parse(raw);
  } catch {
    return result;
  }

  if (typeof wind.asOf === "string") {
    const snapshotTime = Date.parse(`${wind.asOf}+08:00`);
    if (Number.isFinite(snapshotTime)) result.initialMarketUpdated = snapshotTime / 1000;
  }

  result.initialIndices = (wind.indices || [])
    .filter((i: any) => i && !i.error && Number(i.price) > 0)
    .map((i: any) => ({
      code: i.code,
      name: i.name,
      market: i.code?.endsWith?.(".HK")
        ? "HK"
        : i.code?.endsWith?.(".SH") || i.code?.endsWith?.(".SZ")
          ? "A"
          : "US",
      price: i.price,
      change: i.change_amount,
      change_pct: i.change_pct,
    }));

  const sectors = (wind.sectors || [])
    .filter((s: any) => s && !s.error && s.name && Number.isFinite(Number(s.change_pct)))
    .map((s: any) => ({ code: s.code, name: s.name, price: null, change_pct: s.change_pct }));
  const up = [...sectors].filter((s) => (s.change_pct ?? 0) > 0).slice(0, 10);
  const down = [...sectors]
    .filter((s) => (s.change_pct ?? 0) < 0)
    .sort((a, b) => (a.change_pct ?? 0) - (b.change_pct ?? 0))
    .slice(0, 10);
  if (sectors.length > 0) {
    result.initialSectors = {
      ok: true,
      ts: result.initialMarketUpdated ?? 0,
      total: sectors.length,
      top_up: up,
      top_down: down,
      stale: true,
    };
  }

  for (const item of wind.watchlist || []) {
    const code0 = String(item?.code || "").toUpperCase();
    const dotted = code0.match(/^(\d{6})\.(SH|SZ|BJ)$/);
    const prefixed = code0.match(/^(SH|SZ|BJ)(\d{6})$/);
    const code = dotted?.[1] || prefixed?.[2];
    const market = dotted?.[2] || prefixed?.[1];
    if (!code || !market || !(Number(item.price) > 0)) continue;
    const secid = `${market === "SH" ? "1" : "0"}.${code}`;
    const previous = Number(item.yesterday_close);
    result.initialWatchQuotes[secid] = {
      secid,
      code,
      name: item.name || null,
      price: Number(item.price),
      change: Number.isFinite(previous) && previous > 0 ? Number(item.price) - previous : (item.change_amount ?? null),
      change_pct: Number.isFinite(Number(item.change_pct)) ? Number(item.change_pct) : null,
    };
  }

  if (wind.sentiment && (wind.sentiment.limit_up != null || wind.sentiment.limit_down != null)) {
    result.initialSentiment = {
      ok: true,
      ts: 0,
      breadth: {
        limit_up: wind.sentiment.limit_up ?? 0,
        limit_down: wind.sentiment.limit_down ?? 0,
      },
    };
  }

  return result;
}

export type PortfolioBoard = {
  holdings: Holding[];
  portfolioMode: PortfolioMode;
  simulationStartDate?: string;
  simulationCapitalPerFund: number;
};

/** 读持仓底表 + 组合模式 */
export function loadPortfolioBoard(root = process.cwd()): PortfolioBoard {
  const holdingsPath = path.resolve(root, "src/content/invest-portfolio/_holdings.yaml");
  const rawYaml = fs.readFileSync(holdingsPath, "utf-8");
  const rawPortfolioMode = rawYaml.match(/^portfolioMode:\s*(\w+)\s*$/m)?.[1];
  const portfolioMode: PortfolioMode =
    rawPortfolioMode === "actual" || rawPortfolioMode === "simulation" ? rawPortfolioMode : "placeholder";
  const simulationStartDate = rawYaml.match(/^simulationStartDate:\s*"?([^"\s]+)"?\s*$/m)?.[1];
  const holdings = parseHoldings(rawYaml);
  return {
    holdings,
    portfolioMode,
    simulationStartDate,
    simulationCapitalPerFund: holdings[0]?.initialCapital ?? 0,
  };
}

export type InvestDashboard = PortfolioBoard &
  WindSnapshot & {
    latestPeriod?: string;
    seeds: { aiKechuang: StockSeed[]; chinext: StockSeed[] };
  };

/**
 * 两个语言页面的统一入口。
 *
 * 月度快照由页面自己查（`getCollection` 走 Astro 运行时，放在这个模块里会让
 * 单元测试没法直接 import），这里只做纯同步的装载与整形。
 */
export function loadInvestDashboard(
  lang: MarketLang,
  snapshots: readonly { data: { period: string } }[] = [],
): InvestDashboard {
  const portfolio = loadPortfolioBoard();
  const wind = loadWindSnapshot();
  const sorted = [...snapshots].sort((a, b) => a.data.period.localeCompare(b.data.period));
  return {
    ...portfolio,
    ...wind,
    latestPeriod: sorted[sorted.length - 1]?.data.period,
    seeds: stockSeeds(lang),
  };
}

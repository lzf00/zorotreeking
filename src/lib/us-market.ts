export type MacroComparison = {
  actual: number | null;
  expected: number | null;
  previous: number | null;
};

export type UsMacroSignalInput = {
  cpi: MacroComparison;
  payroll: MacroComparison;
  unemployment: MacroComparison;
};

export type UsMacroJudgement = {
  stance: "dovish" | "neutral" | "hawkish";
  label: "偏鸽" | "中性" | "偏鹰";
  employment: "就业降温" | "就业平稳" | "就业升温";
  inflation: "通胀降温" | "通胀持平" | "通胀升温";
  policy: "降息压力上升" | "政策压力平衡" | "紧缩压力上升";
  confidence: "full" | "limited";
  summary: string;
};

export type UsTrendPoint = {
  date: string;
  value: number;
  preliminary?: boolean;
};

export type UsMacroMetric = MacroComparison & {
  reference: string | null;
  preliminary: boolean;
};

export type UsMacroData = {
  source: "bls";
  source_url: string;
  fetched_at?: number;
  stale?: boolean;
  error?: string;
  cpi: UsMacroMetric;
  core_cpi: UsMacroMetric;
  payroll: UsMacroMetric;
  unemployment: UsMacroMetric;
  trends: {
    cpi: UsTrendPoint[];
    core_cpi: UsTrendPoint[];
    payroll: UsTrendPoint[];
    unemployment: UsTrendPoint[];
  };
  consensus: null | {
    source?: string;
    source_url?: string;
    updated_at?: string;
  };
};

export type UsQuote = {
  symbol: string;
  name: string;
  price: number | null;
  change: number | null;
  change_pct: number | null;
  quote_ts: number | null;
};

export type UsMarketData = {
  source: "eastmoney_delayed";
  source_url: string;
  fetched_at?: number;
  quote_ts: number | null;
  requested: number;
  succeeded: number;
  partial: boolean;
  stale?: boolean;
  error?: string;
  indices: UsQuote[];
  sectors: UsQuote[];
  companies: UsQuote[];
};

export type UsMarketDashboardData = {
  ok: boolean;
  ts: number;
  partial: boolean;
  stale: boolean;
  issues: string[];
  error?: string;
  macro: UsMacroData | null;
  market: UsMarketData | null;
};

export function mergeUsMarketDashboardData(
  current: UsMarketDashboardData | null,
  incoming: UsMarketDashboardData,
): UsMarketDashboardData {
  const macro = incoming.macro ?? current?.macro ?? null;
  const market = incoming.market ?? current?.market ?? null;
  const retainedSnapshot = (!incoming.macro && Boolean(macro)) || (!incoming.market && Boolean(market));
  return {
    ...incoming,
    macro,
    market,
    partial: incoming.partial || incoming.macro == null || incoming.market == null,
    stale: incoming.stale || retainedSnapshot,
  };
}

function compareLowerIsDovish(metric: MacroComparison): number {
  if (metric.actual == null) return 0;
  const baseline = metric.expected ?? metric.previous;
  if (baseline == null) return 0;
  if (metric.actual < baseline) return 1;
  if (metric.actual > baseline) return -1;
  return 0;
}

export function deriveUsMacroJudgement(input: UsMacroSignalInput): UsMacroJudgement {
  const inflationScore = compareLowerIsDovish(input.cpi);
  const payrollScore = compareLowerIsDovish(input.payroll);
  const unemploymentScore = input.unemployment.actual == null || input.unemployment.previous == null
    ? 0
    : input.unemployment.actual > input.unemployment.previous
      ? 0.5
      : input.unemployment.actual < input.unemployment.previous
        ? -0.5
        : 0;
  const score = inflationScore + payrollScore + unemploymentScore;
  const stance = score >= 1 ? "dovish" : score <= -1 ? "hawkish" : "neutral";
  const confidence = input.cpi.expected != null && input.payroll.expected != null ? "full" : "limited";

  const inflation = inflationScore > 0 ? "通胀降温" : inflationScore < 0 ? "通胀升温" : "通胀持平";
  const employmentScore = payrollScore + unemploymentScore;
  const employment = employmentScore > 0 ? "就业降温" : employmentScore < 0 ? "就业升温" : "就业平稳";
  const policy = stance === "dovish" ? "降息压力上升" : stance === "hawkish" ? "紧缩压力上升" : "政策压力平衡";
  const label = stance === "dovish" ? "偏鸽" : stance === "hawkish" ? "偏鹰" : "中性";

  let summary: string;
  if (confidence === "limited") {
    const direction = stance === "dovish" ? "整体偏鸽" : stance === "hawkish" ? "整体偏鹰" : "信号分化";
    summary = `市场一致预期暂缺，按最新值与前值比较，${direction}；判断置信度有限。`;
  } else if (stance === "dovish" && inflationScore > 0 && payrollScore > 0) {
    summary = "本月通胀与就业数据均低于市场预期，美联储降息压力上升。";
  } else if (stance === "hawkish" && inflationScore < 0 && payrollScore < 0) {
    summary = "本月通胀与就业数据均高于市场预期，美联储紧缩压力上升。";
  } else {
    summary = "通胀与就业信号分化，当前更适合等待下一组数据确认政策方向。";
  }

  return { stance, label, employment, inflation, policy, confidence, summary };
}

export function isUsRegularMarketHours(date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const weekday = part("weekday");
  if (weekday === "Sat" || weekday === "Sun") return false;
  const hour = Number(part("hour"));
  const minute = Number(part("minute"));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  const minutes = hour * 60 + minute;
  return minutes >= 9 * 60 + 30 && minutes <= 16 * 60;
}

export type PortfolioValuationRow = {
  costValue: number | null;
  marketValue: number | null;
  todayPnl: number | null;
};

export type PublishedFundQuote = {
  code: string;
  nav: number;
  navDate: string;
  previousNav?: number | null;
  previousNavDate?: string | null;
  cumulativeNav?: number | null;
  dayPct: number | null;
  source?: string;
  qualityIssues?: string[];
  stale?: boolean;
  basis: "published_nav";
};

export type FundPositionInput = {
  shares: number;
  costAvg: number;
  initialCapital?: number;
  subscriptionFeePct?: number;
};

export type FundPositionValuation = PortfolioValuationRow & {
  valuedShares: number | null;
  nav: number;
  navDate: string;
  dayPct: number | null;
  dayPnl: number | null;
  basis: "published_nav";
};

export type PortfolioValuationSummary = {
  totalCost: number;
  valuedCost: number;
  totalMarketValue: number;
  totalPnl: number;
  totalPnlPct: number | null;
  todayPnl: number;
  todayPnlPct: number | null;
  valuedCount: number;
  todayCount: number;
};

/**
 * Summarize only positions that actually have a quote.
 * Missing quotes must not be treated as a zero market value, otherwise a
 * partial API response makes the portfolio look as if those positions lost 100%.
 */
export function summarizePortfolioValuation(
  rows: PortfolioValuationRow[],
): PortfolioValuationSummary {
  const valuedRows = rows.filter(
    (row): row is PortfolioValuationRow & { costValue: number; marketValue: number } =>
      row.costValue !== null &&
      Number.isFinite(row.costValue) &&
      row.marketValue !== null && Number.isFinite(row.marketValue),
  );
  const todayRows = valuedRows.filter(
    (row): row is PortfolioValuationRow & { costValue: number; marketValue: number; todayPnl: number } =>
      row.todayPnl !== null && Number.isFinite(row.todayPnl),
  );

  const totalCost = rows.reduce(
    (sum, row) => sum + (row.costValue !== null && Number.isFinite(row.costValue) ? row.costValue : 0),
    0,
  );
  const valuedCost = valuedRows.reduce((sum, row) => sum + row.costValue, 0);
  const totalMarketValue = valuedRows.reduce((sum, row) => sum + row.marketValue, 0);
  const totalPnl = totalMarketValue - valuedCost;
  const todayPnl = todayRows.reduce((sum, row) => sum + row.todayPnl, 0);
  const todayBase = todayRows.reduce(
    (sum, row) => sum + row.marketValue - row.todayPnl,
    0,
  );

  return {
    totalCost,
    valuedCost,
    totalMarketValue,
    totalPnl,
    totalPnlPct: valuedCost > 0 ? (totalPnl / valuedCost) * 100 : null,
    todayPnl,
    todayPnlPct: todayBase > 0 ? (todayPnl / todayBase) * 100 : null,
    valuedCount: valuedRows.length,
    todayCount: todayRows.length,
  };
}

/**
 * Accept only the requested fund's formally published unit NAV.
 *
 * The upstream compatibility API also exposes legacy `est_*` fields. Those
 * fields are not intraday estimates: `est_nav` can contain cumulative NAV and
 * `est_pct` contains the published NAV day's growth rate. Valuation must never
 * prefer `est_nav` over the unit NAV in `nav`.
 */
export function normalizePublishedFundQuote(
  raw: unknown,
  expectedCode: string,
): PublishedFundQuote | null {
  if (!raw || typeof raw !== "object") return null;
  const quote = raw as Record<string, unknown>;
  if (quote.ok === false || quote.code !== expectedCode) return null;

  const hasExplicitUnitNav = Object.hasOwn(quote, "unit_nav");
  const hasExplicitUnitNavDate = Object.hasOwn(quote, "unit_nav_date");
  const navValue = hasExplicitUnitNav ? quote.unit_nav : quote.nav;
  const navDateValue = hasExplicitUnitNavDate ? quote.unit_nav_date : quote.nav_date;
  const nav = typeof navValue === "number" ? navValue : Number.NaN;
  const navDate = typeof navDateValue === "string" ? navDateValue : "";
  if (!Number.isFinite(nav) || nav <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(navDate)) {
    return null;
  }

  const rawPreviousNav = quote.previous_unit_nav;
  const rawPreviousNavDate = quote.previous_unit_nav_date;
  const previousPairIsValid =
    typeof rawPreviousNav === "number" &&
    Number.isFinite(rawPreviousNav) &&
    rawPreviousNav > 0 &&
    typeof rawPreviousNavDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(rawPreviousNavDate) &&
    rawPreviousNavDate < navDate;
  const previousNav = previousPairIsValid ? rawPreviousNav : null;
  const previousNavDate = previousPairIsValid ? rawPreviousNavDate : null;

  const rawCumulativeNav = quote.cumulative_nav;
  const cumulativeNav = typeof rawCumulativeNav === "number" &&
    Number.isFinite(rawCumulativeNav) && rawCumulativeNav > 0
    ? rawCumulativeNav
    : null;

  const rawDayPct = typeof quote.day_pct === "number" ? quote.day_pct : quote.est_pct;
  const dayPct = typeof rawDayPct === "number" && Number.isFinite(rawDayPct)
    ? rawDayPct
    : null;
  const source = typeof quote.source === "string" && quote.source.trim()
    ? quote.source
    : "legacy_fund_api";
  const allowedQualityIssues = new Set([
    "nav_date_regression",
    "large_nav_move",
    "reported_day_pct_mismatch",
  ]);
  const qualityIssues = Array.isArray(quote.quality_issues)
    ? [...new Set(quote.quality_issues.filter(
      (issue): issue is string => typeof issue === "string" && allowedQualityIssues.has(issue),
    ))]
    : [];
  const stale = quote.stale === true;

  return {
    code: expectedCode,
    nav,
    navDate,
    previousNav,
    previousNavDate,
    cumulativeNav,
    dayPct,
    source,
    ...(qualityIssues.length > 0 ? { qualityIssues } : {}),
    ...(stale ? { stale: true } : {}),
    basis: "published_nav",
  };
}

export function valueFundPosition(
  holding: FundPositionInput,
  quote: PublishedFundQuote,
  dataMode: "placeholder" | "simulation" | "actual" = "actual",
): FundPositionValuation {
  if (dataMode === "placeholder") {
    return {
      costValue: null,
      marketValue: null,
      todayPnl: null,
      dayPnl: null,
      valuedShares: null,
      nav: quote.nav,
      navDate: quote.navDate,
      dayPct: quote.dayPct,
      basis: quote.basis,
    };
  }

  if (
    dataMode === "simulation" &&
    (
      typeof holding.initialCapital !== "number" ||
      !Number.isFinite(holding.initialCapital) ||
      holding.initialCapital <= 0 ||
      !Number.isFinite(holding.costAvg) ||
      holding.costAvg <= 0 ||
      (
        holding.subscriptionFeePct !== undefined &&
        (
          !Number.isFinite(holding.subscriptionFeePct) ||
          holding.subscriptionFeePct < 0 ||
          holding.subscriptionFeePct >= 100
        )
      )
    )
  ) {
    return {
      costValue: null,
      marketValue: null,
      todayPnl: null,
      dayPnl: null,
      valuedShares: null,
      nav: quote.nav,
      navDate: quote.navDate,
      dayPct: quote.dayPct,
      basis: quote.basis,
    };
  }

  const subscriptionFeePct = dataMode === "simulation" ? (holding.subscriptionFeePct ?? 0) : 0;
  const netInvestedCapital = dataMode === "simulation"
    ? holding.initialCapital! / (1 + subscriptionFeePct / 100)
    : 0;
  const valuedShares = dataMode === "simulation"
    ? netInvestedCapital / holding.costAvg
    : holding.shares;
  const costValue = dataMode === "simulation"
    ? holding.initialCapital!
    : holding.costAvg * holding.shares;
  const marketValue = quote.nav * valuedShares;
  const dayPnl = typeof quote.previousNav === "number" &&
    Number.isFinite(quote.previousNav) && quote.previousNav > 0
    ? (quote.nav - quote.previousNav) * valuedShares
    : null;

  return {
    costValue,
    marketValue,
    todayPnl: dayPnl,
    dayPnl,
    valuedShares,
    nav: quote.nav,
    navDate: quote.navDate,
    dayPct: quote.dayPct,
    basis: quote.basis,
  };
}

export function formatSignedCurrency(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const amount = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${sign}¥${amount}`;
}

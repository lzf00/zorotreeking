export type PortfolioValuationRow = {
  costValue: number;
  marketValue: number | null;
  todayPnl: number | null;
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
    (row): row is PortfolioValuationRow & { marketValue: number } =>
      row.marketValue !== null && Number.isFinite(row.marketValue),
  );
  const todayRows = valuedRows.filter(
    (row): row is PortfolioValuationRow & { marketValue: number; todayPnl: number } =>
      row.todayPnl !== null && Number.isFinite(row.todayPnl),
  );

  const totalCost = rows.reduce((sum, row) => sum + row.costValue, 0);
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatChinaMarketTime, isFundNavRefreshWindow } from "@/lib/china-market";
import {
  formatSignedCurrency,
  normalizePublishedFundQuote,
  summarizePortfolioValuation,
  valueFundPosition,
} from "@/lib/portfolio-valuation";
import { marketLabels, type MarketLang } from "@/lib/market-i18n";

/**
 * 基金持仓：拿 _holdings.yaml 的份额 + 成本，调 /api/market/funds 获取
 * 天天基金已公布的单位净值，计算净值市值 / 最近净值日盈亏 / 累计盈亏。
 *
 * 行为：
 *  - 进入页面立即拉一次
 *  - 工作日 9:30-22:30 每 5 分钟检查一次，覆盖收盘后的正式净值发布窗口
 *  - 其余时段静态显示上次结果
 *  - 标签页隐藏时停轮询，切回 visible 立即补一次
 */

type Holding = {
  symbol: string;       // 6 位基金代码
  name: string;         // 来自 _holdings.yaml 的本地名（fallback 用）
  nameEn?: string;      // 英文页显示名；缺省时回落到 name
  shares: number;
  costAvg: number;
  initialCapital?: number;
  baselineDate?: string;
  subscriptionFeePct?: number;
};

type FundQuote = {
  code: string;
  name?: string | null;        // 天天基金返回的真实名
  nav?: number | null;          // 已公布单位净值
  nav_date?: string | null;
  unit_nav?: number | null;
  unit_nav_date?: string | null;
  previous_unit_nav?: number | null;
  previous_unit_nav_date?: string | null;
  cumulative_nav?: number | null;
  day_pct?: number | null;
  source?: string | null;
  quality_issues?: string[];
  stale?: boolean;
  est_nav?: number | null;      // 兼容字段；上游当前可能放累计净值，禁止用于估值
  est_pct?: number | null;      // 已公布净值日增长率 %
  est_time?: string | null;
  ok: boolean;
  error?: string;
};

type FundResp = {
  ok: boolean;
  ts: number;
  funds: FundQuote[];
  requested?: number;
  succeeded?: number;
  partial?: boolean;
  error?: string;
};

interface Props {
  holdings: Holding[];
  dataMode?: "placeholder" | "simulation" | "actual";
  simulationStartDate?: string;
  /** 文案语言，英文页传 "en" */
  lang?: MarketLang;
}

const POLL_MS = 5 * 60_000;

export default function LiveHoldings({ holdings, dataMode = "placeholder", simulationStartDate, lang = "zh" }: Props) {
  const L = marketLabels(lang);
  const [quotes, setQuotes] = useState<Record<string, FundQuote> | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [partial, setPartial] = useState<{ succeeded: number; requested: number } | null>(null);
  const inFlight = useRef(false);

  const codes = useMemo(() => holdings.map(h => h.symbol).join(","), [holdings]);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      if (!codes) {
        throw new Error(L.holdingsEmpty);
      }
      const r = await fetch(`/api/market/funds?codes=${codes}`, { cache: "no-store" });
      if (!r.ok) {
        throw new Error(L.httpError(r.status, r.statusText));
      }
      const raw = await r.json();
      const d: FundResp = raw && typeof raw === "object" ? raw : ({} as FundResp);
      if (d.ok) {
        if (!Array.isArray(d.funds) || d.funds.length === 0) {
          throw new Error(L.holdingsNoData);
        }
        const requestedCodes = new Set(holdings.map((holding) => holding.symbol));
        const map: Record<string, FundQuote> = {};
        for (const f of d.funds) {
          if (
            f &&
            typeof f.code === "string" &&
            requestedCodes.has(f.code) &&
            !map[f.code]
          ) {
            map[f.code] = f;
          }
        }
        if (Object.keys(map).length === 0) {
          throw new Error(L.holdingsBadShape);
        }
        setQuotes(map);
        setUpdated(Number.isFinite(d.ts) ? d.ts : null);
        setError(null);
        const validCount = holdings.filter((holding) =>
          normalizePublishedFundQuote(map[holding.symbol], holding.symbol),
        ).length;
        if (validCount < holdings.length) {
          setPartial({
            succeeded: validCount,
            requested: holdings.length,
          });
        } else {
          setPartial(null);
        }
      } else {
        throw new Error(d.error || L.loadFailed);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : L.networkError);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [codes, holdings.length]);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.hidden) return;
      if (!isFundNavRefreshWindow()) return;
      load();
    }, POLL_MS);
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  // 计算每行 + 总览
  const rows = holdings.map(h => {
    const rawQuote = quotes?.[h.symbol];
    const q = normalizePublishedFundQuote(rawQuote, h.symbol);
    const valuation = q ? valueFundPosition(h, q, dataMode) : null;
    const nav = valuation?.nav ?? null;
    const pct = valuation?.dayPct ?? null;
    const marketValue = valuation?.marketValue ?? null;
    const costValue = valuation?.costValue ?? (
      dataMode === "actual"
        ? h.costAvg * h.shares
        : dataMode === "simulation"
          ? (h.initialCapital ?? null)
          : null
    );
    const pnl = marketValue != null && costValue != null ? marketValue - costValue : null;
    const pnlPct = marketValue != null && costValue != null && costValue > 0
      ? (marketValue / costValue - 1) * 100
      : null;
    const todayPnl = valuation?.dayPnl ?? null;
    const valuedShares = valuation?.valuedShares ?? null;
    return { h, q, nav, pct, marketValue, costValue, pnl, pnlPct, todayPnl, valuedShares };
  });

  const summary = summarizePortfolioValuation(rows);
  const publishedNavCount = rows.filter((row) => row.q !== null).length;
  const hasMV = summary.valuedCount > 0;
  const hasTodayValue = summary.todayCount > 0;
  const valuationCoverage = L.valuationCoverage(summary.valuedCount, rows.length);
  const navDates = [...new Set(rows.map((row) => row.q?.navDate).filter(Boolean))].sort();
  const baselineDates = [...new Set(rows.map((row) => row.h.baselineDate).filter(Boolean))].sort();
  const qualityIssues = [...new Set(rows.flatMap((row) => row.q?.qualityIssues ?? []))];
  const navDateSummary = navDates.length === 0
    ? L.none
    : navDates.length === 1
      ? (navDates[0] ?? L.none)
      : L.dateRange(navDates[0] ?? L.none, navDates[navDates.length - 1] ?? L.none);

  if (!quotes && error) {
    return (
      <div className="rounded-2xl bg-[var(--bg-soft)] p-5 text-sm text-[var(--text-tertiary)]">
        {L.holdingsLoadFailed}{error}{L.sentenceEnd}
        <button onClick={load} className="underline ml-1">{L.retry}</button>
      </div>
    );
  }

  if (!quotes) {
    return <div className="rounded-2xl bg-[var(--bg-soft)] p-5 h-[420px] animate-pulse" />;
  }

  return (
    <div className="space-y-4">
      {dataMode === "placeholder" && (
        <div role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {L.placeholderNote}
        </div>
      )}
      {dataMode === "simulation" && (
        <div role="note" className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
          {L.simulationNote(simulationStartDate ?? "2026-02-01", baselineDates[0] ?? L.none)}
        </div>
      )}
      {error && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {L.refreshFailedKeep}{error}{L.sentenceEnd}
          <button onClick={load} className="underline ml-1">{L.retry}</button>
        </div>
      )}
      {qualityIssues.length > 0 && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {L.qualityTitle}
          {qualityIssues.includes("nav_date_regression") && L.qualityNavRegression}
          {qualityIssues.includes("large_nav_move") && L.qualityLargeMove}
          {qualityIssues.includes("reported_day_pct_mismatch") && L.qualityPctMismatch}
        </div>
      )}

      {/* 顶部总览 */}
      {dataMode !== "placeholder" ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card
            label={dataMode === "simulation" ? L.mvSimulated : L.mvNav}
            value={hasMV ? `¥${fmt(summary.totalMarketValue, 0)}` : L.none}
            sub={hasMV ? valuationCoverage : L.waitingQuotes}
          />
          <Card
            label={L.todayPnl}
            value={hasTodayValue ? formatSignedCurrency(summary.todayPnl, 2) : L.none}
            sub={summary.todayPnlPct !== null ? `${summary.todayPnlPct >= 0 ? "+" : ""}${fmt(summary.todayPnlPct, 2)}%` : L.none}
            color={summary.todayPnl > 0 ? "var(--market-up)" : summary.todayPnl < 0 ? "var(--market-down)" : undefined}
          />
          <Card
            label={dataMode === "simulation" ? L.totalPnlSimulated : L.totalPnl}
            value={hasMV ? formatSignedCurrency(summary.totalPnl, 0) : L.none}
            sub={summary.totalPnlPct !== null ? `${summary.totalPnlPct >= 0 ? "+" : ""}${fmt(summary.totalPnlPct, 2)}%` : L.none}
            color={summary.totalPnl > 0 ? "var(--market-up)" : summary.totalPnl < 0 ? "var(--market-down)" : undefined}
          />
          <Card
            label={dataMode === "simulation" ? L.capitalSimulated : L.holdingCount}
            value={dataMode === "simulation" ? `¥${fmt(summary.totalCost, 0)}` : String(holdings.length)}
            sub={dataMode === "simulation" ? L.perFund(holdings.length) : L.costOccupied(fmt(summary.totalCost, 0))}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card label={L.dataMethod} value={L.officialNav} sub={L.noIntradayEstimate} />
          <Card label={L.navCoverage} value={`${publishedNavCount}/${rows.length}`} sub={L.exactCodeMatch} />
          <Card label={L.latestNavDate} value={navDateSummary} sub={L.perFundAnnouncement} />
          <Card label={L.fundCount} value={String(holdings.length)} sub={L.notLinked} />
        </div>
      )}

      {/* 持仓明细 */}
      <div className="rounded-2xl border border-[var(--border)] overflow-hidden">
        <div className="overflow-x-auto" tabIndex={0} role="group">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-soft)] text-xs text-[var(--text-secondary)]">
              <tr>
                <th scope="col" className="text-left p-2 sm:p-3 font-semibold">{L.colCode}</th>
                <th scope="col" className="text-left p-2 sm:p-3 font-semibold">{L.colFund}</th>
                {dataMode !== "placeholder" && <th scope="col" className="hidden sm:table-cell text-right p-2 sm:p-3 font-semibold">{dataMode === "simulation" ? L.colSharesSimulated : L.colShares}</th>}
                {dataMode !== "placeholder" && <th scope="col" className="hidden sm:table-cell text-right p-2 sm:p-3 font-semibold">{dataMode === "simulation" ? L.colBaselineNav : L.colCostNav}</th>}
                <th scope="col" className="text-right p-2 sm:p-3 font-semibold">{L.colNav}</th>
                <th scope="col" className="text-right p-2 sm:p-3 font-semibold">{L.colNavChange}</th>
                {dataMode !== "placeholder" && <th scope="col" className="text-right p-2 sm:p-3 font-semibold">{dataMode === "simulation" ? L.colMvSimulated : L.colMv}</th>}
                {dataMode !== "placeholder" && <th scope="col" className="text-right p-2 sm:p-3 font-semibold">{L.colPnl}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const pctColor = r.pct == null ? "var(--text-tertiary)" : r.pct > 0 ? "var(--market-up)" : r.pct < 0 ? "var(--market-down)" : "var(--text-tertiary)";
                const pnlColor = r.pnl == null ? "var(--text-tertiary)" : r.pnl > 0 ? "var(--market-up)" : r.pnl < 0 ? "var(--market-down)" : "var(--text-tertiary)";
                const displayName = lang === "en" ? (r.h.nameEn ?? r.h.name) : r.h.name;
                return (
                  <tr key={r.h.symbol} className="border-t border-[var(--border)]">
                    <td className="p-2 sm:p-3 font-mono text-xs">{r.h.symbol}</td>
                    <td className="p-2 sm:p-3 max-w-[110px] sm:max-w-[180px] truncate" title={displayName}>{displayName}</td>
                    {dataMode !== "placeholder" && (
                      <td className="hidden sm:table-cell p-2 sm:p-3 text-right tabular-nums">
                        <div>{r.valuedShares != null ? fmt(r.valuedShares, 2) : L.none}</div>
                        {dataMode === "simulation" && r.h.initialCapital != null && (
                          <div className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">{L.principal(fmt(r.h.initialCapital, 0))}</div>
                        )}
                      </td>
                    )}
                    {dataMode !== "placeholder" && (
                      <td className="hidden sm:table-cell p-2 sm:p-3 text-right tabular-nums text-[var(--text-secondary)]">
                        <div>{fmt(r.h.costAvg, 4)}</div>
                        {dataMode === "simulation" && r.h.baselineDate && (
                          <div className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">{r.h.baselineDate}</div>
                        )}
                      </td>
                    )}
                    <td className="p-2 sm:p-3 text-right tabular-nums">
                      <div>{r.nav != null ? fmt(r.nav, 4) : L.none}</div>
                      {r.q?.navDate && <div className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">{r.q.navDate}</div>}
                    </td>
                    <td className="p-2 sm:p-3 text-right tabular-nums" style={{ color: pctColor }}>
                      {r.pct != null ? `${r.pct > 0 ? "+" : ""}${fmt(r.pct, 2)}%` : L.none}
                    </td>
                    {dataMode !== "placeholder" && <td className="p-2 sm:p-3 text-right tabular-nums">{r.marketValue != null ? `¥${fmt(r.marketValue, 0)}` : L.none}</td>}
                    {dataMode !== "placeholder" && (
                      <td className="p-2 sm:p-3 text-right tabular-nums" style={{ color: pnlColor }}>
                        {r.pnl != null ? `${formatSignedCurrency(r.pnl, 0)}  (${r.pnlPct! >= 0 ? "+" : ""}${fmt(r.pnlPct!, 2)}%)` : L.none}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-[var(--text-tertiary)] font-mono tracking-wide">
        {L.holdingsSource} · {L.navDateLabel} {navDateSummary} · {L.apiResponse}{" "}
        {updated ? formatChinaMarketTime(updated) : L.none}
        {isFundNavRefreshWindow()
          ? <span className="ml-2">{L.inNavWindow}</span>
          : <span className="ml-2">{L.outNavWindow}</span>}
        {dataMode === "simulation" && <span className="ml-2">{L.simulationStart(simulationStartDate ?? "2026-02-01")}</span>}
        {partial !== null && (
          <span className="ml-2 text-amber-700 dark:text-amber-400">{L.partialMissing(partial.succeeded, partial.requested)}</span>
        )}
        {loading && <span className="ml-2">…</span>}
      </p>
    </div>
  );
}

function Card({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-2xl bg-[var(--bg-soft)] p-4">
      <div className="text-xs text-[var(--text-tertiary)] mb-1">{label}</div>
      <div className="text-xl font-semibold tabular-nums leading-none mb-1" style={{ color }}>{value}</div>
      {sub && <div className="text-xs text-[var(--text-tertiary)] tabular-nums">{sub}</div>}
    </div>
  );
}

function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

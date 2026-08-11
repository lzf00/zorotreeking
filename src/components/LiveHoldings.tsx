import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatChinaMarketTime, isChinaATradingHours } from "@/lib/china-market";
import {
  formatSignedCurrency,
  normalizePublishedFundQuote,
  summarizePortfolioValuation,
  valueFundPosition,
} from "@/lib/portfolio-valuation";

/**
 * 基金持仓：拿 _holdings.yaml 的份额 + 成本，调 /api/market/funds 获取
 * 天天基金已公布的单位净值，计算净值市值 / 最近净值日盈亏 / 累计盈亏。
 *
 * 行为：
 *  - 进入页面立即拉一次
 *  - 之后每 60 秒轮询（仅 A 股交易时段 9:30-11:30 + 13:00-15:00 工作日）
 *  - 非交易时段静态显示上次结果
 *  - 标签页隐藏时停轮询，切回 visible 立即补一次
 */

type Holding = {
  symbol: string;       // 6 位基金代码
  name: string;         // 来自 _holdings.yaml 的本地名（fallback 用）
  shares: number;
  costAvg: number;
  initialCapital?: number;
  baselineDate?: string;
};

type FundQuote = {
  code: string;
  name?: string | null;        // 天天基金返回的真实名
  nav?: number | null;          // 已公布单位净值
  nav_date?: string | null;
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
}

const POLL_MS = 60_000;

export default function LiveHoldings({ holdings, dataMode = "placeholder", simulationStartDate }: Props) {
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
        throw new Error("持仓列表为空，先补充 src/content/invest-portfolio/_holdings.yaml");
      }
      const r = await fetch(`/api/market/funds?codes=${codes}`, { cache: "no-store" });
      if (!r.ok) {
        throw new Error(`接口响应异常：${r.status} ${r.statusText}`);
      }
      const raw = await r.json();
      const d: FundResp = raw && typeof raw === "object" ? raw : ({} as FundResp);
      if (d.ok) {
        if (!Array.isArray(d.funds) || d.funds.length === 0) {
          throw new Error("接口未返回可展示的基金数据");
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
          throw new Error("返回数据格式不符合预期（基金代码缺失）");
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
        throw new Error(d.error || "加载失败");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "网络异常");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [codes, holdings.length]);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.hidden) return;
      if (!isChinaATradingHours()) return;
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
  const valuationCoverage = `${summary.valuedCount}/${rows.length} 只有正式净值`;
  const navDates = [...new Set(rows.map((row) => row.q?.navDate).filter(Boolean))].sort();
  const baselineDates = [...new Set(rows.map((row) => row.h.baselineDate).filter(Boolean))].sort();
  const navDateSummary = navDates.length === 0
    ? "—"
    : navDates.length === 1
      ? (navDates[0] ?? "—")
      : `${navDates[0] ?? "—"} 至 ${navDates[navDates.length - 1] ?? "—"}`;

  if (!quotes && error) {
    return (
      <div className="rounded-2xl bg-[var(--bg-soft)] p-5 text-sm text-[var(--text-tertiary)]">
        持仓净值加载失败：{error}。<button onClick={load} className="underline ml-1">重试</button>
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
          当前未接入证券账户，只展示可核验的公开基金净值；份额、成本、市值和盈亏已隐藏，避免示例数据被误认为真实持仓。
        </div>
      )}
      {dataMode === "simulation" && (
        <div role="note" className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
          模拟组合，不是证券账户数据：每只基金在 {simulationStartDate ?? "2026-02-01"} 设定投入 ¥10,000；因起始日无净值，按 {baselineDates[0] ?? "首个有效净值日"} 正式单位净值成交，未计申购与赎回费用。
        </div>
      )}
      {error && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          刷新失败，正在保留上次数据：{error}。<button onClick={load} className="underline ml-1">重试</button>
        </div>
      )}

      {/* 顶部总览 */}
      {dataMode !== "placeholder" ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card
            label={dataMode === "simulation" ? "模拟市值" : "净值市值"}
            value={hasMV ? `¥${fmt(summary.totalMarketValue, 0)}` : "—"}
            sub={hasMV ? valuationCoverage : "等待可用行情"}
          />
          <Card
            label="最近净值日盈亏"
            value={hasTodayValue ? formatSignedCurrency(summary.todayPnl, 2) : "—"}
            sub={summary.todayPnlPct !== null ? `${summary.todayPnlPct >= 0 ? "+" : ""}${fmt(summary.todayPnlPct, 2)}%` : "—"}
            color={summary.todayPnl > 0 ? "#dc2626" : summary.todayPnl < 0 ? "#16a34a" : undefined}
          />
          <Card
            label={dataMode === "simulation" ? "累计模拟盈亏" : "累计盈亏"}
            value={hasMV ? formatSignedCurrency(summary.totalPnl, 0) : "—"}
            sub={summary.totalPnlPct !== null ? `${summary.totalPnlPct >= 0 ? "+" : ""}${fmt(summary.totalPnlPct, 2)}%` : "—"}
            color={summary.totalPnl > 0 ? "#dc2626" : summary.totalPnl < 0 ? "#16a34a" : undefined}
          />
          <Card
            label={dataMode === "simulation" ? "模拟本金" : "持仓数"}
            value={dataMode === "simulation" ? `¥${fmt(summary.totalCost, 0)}` : String(holdings.length)}
            sub={dataMode === "simulation" ? `${holdings.length} 只 · 每只 ¥10,000` : `占用成本 ¥${fmt(summary.totalCost, 0)}`}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card label="数据口径" value="正式净值" sub="不使用盘中估算" />
          <Card label="净值覆盖" value={`${publishedNavCount}/${rows.length}`} sub="代码严格匹配" />
          <Card label="最新净值日" value={navDateSummary} sub="以基金公告为准" />
          <Card label="基金数" value={String(holdings.length)} sub="未接入账户持仓" />
        </div>
      )}

      {/* 持仓明细 */}
      <div className="rounded-2xl border border-[var(--border)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-soft)] text-xs text-[var(--text-secondary)]">
              <tr>
                <th scope="col" className="text-left p-3 font-semibold">代码</th>
                <th scope="col" className="text-left p-3 font-semibold">基金</th>
                {dataMode !== "placeholder" && <th scope="col" className="text-right p-3 font-semibold">{dataMode === "simulation" ? "模拟份额" : "份额"}</th>}
                {dataMode !== "placeholder" && <th scope="col" className="text-right p-3 font-semibold">{dataMode === "simulation" ? "起始净值" : "成本净值"}</th>}
                <th scope="col" className="text-right p-3 font-semibold">单位净值</th>
                <th scope="col" className="text-right p-3 font-semibold">净值日涨跌</th>
                {dataMode !== "placeholder" && <th scope="col" className="text-right p-3 font-semibold">{dataMode === "simulation" ? "模拟市值" : "净值市值"}</th>}
                {dataMode !== "placeholder" && <th scope="col" className="text-right p-3 font-semibold">累计盈亏</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const pctColor = r.pct == null ? "var(--text-tertiary)" : r.pct > 0 ? "#dc2626" : r.pct < 0 ? "#16a34a" : "var(--text-tertiary)";
                const pnlColor = r.pnl == null ? "var(--text-tertiary)" : r.pnl > 0 ? "#dc2626" : r.pnl < 0 ? "#16a34a" : "var(--text-tertiary)";
                const displayName = r.h.name;
                return (
                  <tr key={r.h.symbol} className="border-t border-[var(--border)]">
                    <td className="p-3 font-mono text-xs">{r.h.symbol}</td>
                    <td className="p-3 max-w-[180px] truncate" title={displayName}>{displayName}</td>
                    {dataMode !== "placeholder" && (
                      <td className="p-3 text-right tabular-nums">
                        <div>{r.valuedShares != null ? fmt(r.valuedShares, 2) : "—"}</div>
                        {dataMode === "simulation" && r.h.initialCapital != null && (
                          <div className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">本金 ¥{fmt(r.h.initialCapital, 0)}</div>
                        )}
                      </td>
                    )}
                    {dataMode !== "placeholder" && (
                      <td className="p-3 text-right tabular-nums text-[var(--text-secondary)]">
                        <div>{fmt(r.h.costAvg, 4)}</div>
                        {dataMode === "simulation" && r.h.baselineDate && (
                          <div className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">{r.h.baselineDate}</div>
                        )}
                      </td>
                    )}
                    <td className="p-3 text-right tabular-nums">
                      <div>{r.nav != null ? fmt(r.nav, 4) : "—"}</div>
                      {r.q?.navDate && <div className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">{r.q.navDate}</div>}
                    </td>
                    <td className="p-3 text-right tabular-nums" style={{ color: pctColor }}>
                      {r.pct != null ? `${r.pct > 0 ? "+" : ""}${fmt(r.pct, 2)}%` : "—"}
                    </td>
                    {dataMode !== "placeholder" && <td className="p-3 text-right tabular-nums">{r.marketValue != null ? `¥${fmt(r.marketValue, 0)}` : "—"}</td>}
                    {dataMode !== "placeholder" && (
                      <td className="p-3 text-right tabular-nums" style={{ color: pnlColor }}>
                        {r.pnl != null ? `${formatSignedCurrency(r.pnl, 0)}  (${r.pnlPct! >= 0 ? "+" : ""}${fmt(r.pnlPct!, 2)}%)` : "—"}
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
        数据源 天天基金公开历史净值 · 仅使用已公布单位净值（不使用盘中估算） · 净值日期 {navDateSummary} · 接口响应 {updated ? formatChinaMarketTime(updated) : "—"}
        {!isChinaATradingHours() && <span className="ml-2">（非交易时段，已停止轮询）</span>}
        {dataMode === "simulation" && <span className="ml-2">· 模拟起点 {simulationStartDate ?? "2026-02-01"}</span>}
        {partial !== null && (
          <span className="ml-2 text-amber-600 dark:text-amber-400">· 部分基金缺失（{partial.succeeded}/{partial.requested}）</span>
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

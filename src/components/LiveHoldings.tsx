import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatChinaMarketTime, isChinaATradingHours } from "@/lib/china-market";
import { summarizePortfolioValuation } from "@/lib/portfolio-valuation";

/**
 * 实时持仓：拿 _holdings.yaml 的占位份额 + 成本，调 /api/market/funds 拿天天基金实时估值，
 * 实时算出 估算市值 / 今日盈亏 / 累计盈亏。
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
};

type FundQuote = {
  code: string;
  name?: string | null;        // 天天基金返回的真实名
  nav?: number | null;          // 上一交易日单位净值
  nav_date?: string | null;
  est_nav?: number | null;      // 当日估算净值
  est_pct?: number | null;      // 估算涨跌幅 %
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

interface Props { holdings: Holding[] }

const POLL_MS = 60_000;

export default function LiveHoldings({ holdings }: Props) {
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
        const map: Record<string, FundQuote> = {};
        for (const f of d.funds) {
          if (f && typeof f.code === "string" && f.code) map[f.code] = f;
        }
        if (Object.keys(map).length === 0) {
          throw new Error("返回数据格式不符合预期（基金代码缺失）");
        }
        setQuotes(map);
        setUpdated(Number.isFinite(d.ts) ? d.ts : null);
        setError(null);
        if (d.partial && typeof d.succeeded === "number") {
          setPartial({
            succeeded: d.succeeded,
            requested: typeof d.requested === "number" ? d.requested : holdings.length,
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
    const q = quotes?.[h.symbol];
    // 优先用估算净值（交易时段更新），其次单位净值（上一交易日）
    const nav = q?.est_nav ?? q?.nav ?? null;
    const pct = q?.est_pct ?? null;
    const marketValue = nav != null ? nav * h.shares : null;
    const costValue = h.costAvg * h.shares;
    const pnl = marketValue != null ? marketValue - costValue : null;
    const pnlPct = marketValue != null ? (marketValue / costValue - 1) * 100 : null;
    const todayPnl = (nav != null && pct != null) ? (marketValue! * pct / (100 + pct)) : null;
    return { h, q, nav, pct, marketValue, costValue, pnl, pnlPct, todayPnl };
  });

  const summary = summarizePortfolioValuation(rows);
  const hasMV = summary.valuedCount > 0;
  const hasTodayValue = summary.todayCount > 0;
  const valuationCoverage = `${summary.valuedCount}/${rows.length} 只可估算`;

  if (!quotes && error) {
    return (
      <div className="rounded-2xl bg-[var(--bg-soft)] p-5 text-sm text-[var(--text-tertiary)]">
        实时持仓加载失败：{error}。<button onClick={load} className="underline ml-1">重试</button>
      </div>
    );
  }

  if (!quotes) {
    return <div className="rounded-2xl bg-[var(--bg-soft)] p-5 h-[420px] animate-pulse" />;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          刷新失败，正在保留上次数据：{error}。<button onClick={load} className="underline ml-1">重试</button>
        </div>
      )}

      {/* 顶部总览 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card
          label="估算市值"
          value={hasMV ? `¥${fmt(summary.totalMarketValue, 0)}` : "—"}
          sub={hasMV ? valuationCoverage : "等待可用行情"}
        />
        <Card
          label="今日盈亏"
          value={hasTodayValue ? `${summary.todayPnl >= 0 ? "+" : ""}¥${fmt(summary.todayPnl, 2)}` : "—"}
          sub={summary.todayPnlPct !== null ? `${summary.todayPnlPct >= 0 ? "+" : ""}${fmt(summary.todayPnlPct, 2)}%` : "—"}
          color={summary.todayPnl > 0 ? "#dc2626" : summary.todayPnl < 0 ? "#16a34a" : undefined}
        />
        <Card
          label="累计盈亏"
          value={hasMV ? `${summary.totalPnl >= 0 ? "+" : ""}¥${fmt(summary.totalPnl, 0)}` : "—"}
          sub={summary.totalPnlPct !== null ? `${summary.totalPnlPct >= 0 ? "+" : ""}${fmt(summary.totalPnlPct, 2)}%` : "—"}
          color={summary.totalPnl > 0 ? "#dc2626" : summary.totalPnl < 0 ? "#16a34a" : undefined}
        />
        <Card label="持仓数" value={String(holdings.length)} sub={`占用成本 ¥${fmt(summary.totalCost, 0)}`} />
      </div>

      {/* 持仓明细 */}
      <div className="rounded-2xl border border-[var(--border)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-soft)] text-xs text-[var(--text-secondary)]">
              <tr>
                <th scope="col" className="text-left p-3 font-semibold">代码</th>
                <th scope="col" className="text-left p-3 font-semibold">基金</th>
                <th scope="col" className="text-right p-3 font-semibold">份额</th>
                <th scope="col" className="text-right p-3 font-semibold">成本净值</th>
                <th scope="col" className="text-right p-3 font-semibold">估算净值</th>
                <th scope="col" className="text-right p-3 font-semibold">今日</th>
                <th scope="col" className="text-right p-3 font-semibold">估算市值</th>
                <th scope="col" className="text-right p-3 font-semibold">累计盈亏</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const pctColor = r.pct == null ? "var(--text-tertiary)" : r.pct > 0 ? "#dc2626" : r.pct < 0 ? "#16a34a" : "var(--text-tertiary)";
                const pnlColor = r.pnl == null ? "var(--text-tertiary)" : r.pnl > 0 ? "#dc2626" : r.pnl < 0 ? "#16a34a" : "var(--text-tertiary)";
                const displayName = r.q?.name || r.h.name;
                return (
                  <tr key={r.h.symbol} className="border-t border-[var(--border)]">
                    <td className="p-3 font-mono text-xs">{r.h.symbol}</td>
                    <td className="p-3 max-w-[180px] truncate" title={displayName}>{displayName}</td>
                    <td className="p-3 text-right tabular-nums">{r.h.shares.toLocaleString()}</td>
                    <td className="p-3 text-right tabular-nums text-[var(--text-secondary)]">{fmt(r.h.costAvg, 4)}</td>
                    <td className="p-3 text-right tabular-nums">{r.nav != null ? fmt(r.nav, 4) : "—"}</td>
                    <td className="p-3 text-right tabular-nums" style={{ color: pctColor }}>
                      {r.pct != null ? `${r.pct > 0 ? "+" : ""}${fmt(r.pct, 2)}%` : "—"}
                    </td>
                    <td className="p-3 text-right tabular-nums">{r.marketValue != null ? `¥${fmt(r.marketValue, 0)}` : "—"}</td>
                    <td className="p-3 text-right tabular-nums" style={{ color: pnlColor }}>
                      {r.pnl != null ? `${r.pnl >= 0 ? "+" : ""}¥${fmt(r.pnl, 0)}  (${r.pnlPct! >= 0 ? "+" : ""}${fmt(r.pnlPct!, 2)}%)` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-[var(--text-tertiary)] font-mono tracking-wide">
        数据源 天天基金 · 估算净值（盘中实时，约 1-2 分钟延迟）+ 单位净值（上一交易日 17:00 后发布） · 最后更新 {updated ? formatChinaMarketTime(updated) : "—"}
        {!isChinaATradingHours() && <span className="ml-2">（非交易时段，已停止自动刷新）</span>}
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

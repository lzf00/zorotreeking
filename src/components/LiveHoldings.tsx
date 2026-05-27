import { useEffect, useMemo, useRef, useState } from "react";

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

type Resp = { ok: boolean; ts: number; funds: FundQuote[]; error?: string };

interface Props { holdings: Holding[] }

const POLL_MS = 60_000;

function isATradingHours(d: Date = new Date()): boolean {
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const t = d.getHours() * 60 + d.getMinutes();
  return (t >= 570 && t <= 690) || (t >= 780 && t <= 900);
}

export default function LiveHoldings({ holdings }: Props) {
  const [quotes, setQuotes] = useState<Record<string, FundQuote> | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  const codes = useMemo(() => holdings.map(h => h.symbol).join(","), [holdings]);

  async function load() {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const r = await fetch(`/api/market/funds?codes=${codes}`, { cache: "no-store" });
      const d: Resp = await r.json();
      if (d.ok) {
        const map: Record<string, FundQuote> = {};
        for (const f of d.funds) map[f.code] = f;
        setQuotes(map);
        setUpdated(d.ts);
        setError(null);
      } else if (!quotes) setError(d.error || "加载失败");
    } catch (e: any) {
      if (!quotes) setError(e?.message || "网络异常");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.hidden) return;
      if (!isATradingHours()) return;
      load();
    }, POLL_MS);
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const totalCost = rows.reduce((s, r) => s + r.costValue, 0);
  const totalMV   = rows.reduce((s, r) => s + (r.marketValue ?? r.costValue), 0);
  const totalPnL  = totalMV - totalCost;
  const totalPct  = (totalMV / totalCost - 1) * 100;
  const todayTotal = rows.reduce((s, r) => s + (r.todayPnl ?? 0), 0);
  const todayPct = totalMV > 0 ? (todayTotal / (totalMV - todayTotal)) * 100 : 0;

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
      {/* 顶部总览 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="估算市值" value={`¥${fmt(totalMV, 2)}`} sub="基于 估算净值×份额" />
        <Card
          label="今日盈亏"
          value={`${todayTotal >= 0 ? "+" : ""}¥${fmt(todayTotal, 2)}`}
          sub={`${todayPct >= 0 ? "+" : ""}${fmt(todayPct, 2)}%`}
          color={todayTotal > 0 ? "#dc2626" : todayTotal < 0 ? "#16a34a" : undefined}
        />
        <Card
          label="累计盈亏"
          value={`${totalPnL >= 0 ? "+" : ""}¥${fmt(totalPnL, 0)}`}
          sub={`${totalPct >= 0 ? "+" : ""}${fmt(totalPct, 2)}%`}
          color={totalPnL > 0 ? "#dc2626" : totalPnL < 0 ? "#16a34a" : undefined}
        />
        <Card label="持仓数" value={String(holdings.length)} sub={`占用成本 ¥${fmt(totalCost, 0)}`} />
      </div>

      {/* 持仓明细 */}
      <div className="rounded-2xl border border-[var(--border)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-soft)] text-xs text-[var(--text-secondary)]">
              <tr>
                <th className="text-left p-3 font-semibold">代码</th>
                <th className="text-left p-3 font-semibold">基金</th>
                <th className="text-right p-3 font-semibold">份额</th>
                <th className="text-right p-3 font-semibold">成本净值</th>
                <th className="text-right p-3 font-semibold">估算净值</th>
                <th className="text-right p-3 font-semibold">今日</th>
                <th className="text-right p-3 font-semibold">估算市值</th>
                <th className="text-right p-3 font-semibold">累计盈亏</th>
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
        数据源 天天基金 · 估算净值（盘中实时，约 1-2 分钟延迟）+ 单位净值（上一交易日 17:00 后发布） · 最后更新 {updated ? fmtTime(updated) : "—"}
        {!isATradingHours() && <span className="ml-2">（非交易时段，已停止自动刷新）</span>}
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

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

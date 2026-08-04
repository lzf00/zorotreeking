import { useCallback, useEffect, useRef, useState } from "react";
import { formatChinaMarketTime, isChinaATradingHours } from "@/lib/china-market";

/**
 * 宽基 ETF 盘中实时成交监测（/invest/etf/ 页顶部）。
 *
 * 展示 12 只宽基 ETF：现价 / 涨跌 / 今日累计成交额 / vs 昨日全天进度条。
 * ratio ≥ 100% 高亮"已超昨日全天"——财联社盯盘口径。
 *
 * 行为与 MarketIndicesGrid 一致：
 *  - 进页面立即拉一次；交易时段每 60s 轮询；隐藏页停轮询
 *  - 后端 /api/market/etf（东财实时行情 + 腾讯上一交易日基准）
 *
 * 注意：这里只有价格/成交维度是实时的；三因子模型里的"份额"因子
 * 交易所盘后才披露，仍在下方每日 19:30 更新的板块里。
 */

type EtfItem = {
  code: string;
  name: string;
  price: number | null;
  change_pct: number | null;
  turnover_yi: number | null;
  prev_turnover_yi: number | null;
  ratio_pct: number | null;
  prev_trade_date?: string | null;
};

type EtfResp = {
  ok: boolean;
  ts: number;
  trading: boolean;
  items: EtfItem[];
  requested?: number;
  succeeded?: number;
  partial?: boolean;
  error?: string;
  stale?: boolean;
  baseline_date?: string;
};

const POLL_MS = 60_000;

export default function EtfLiveTurnover() {
  const [data, setData] = useState<EtfItem[] | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState<{ succeeded: number; requested: number } | null>(null);
  const [stale, setStale] = useState(false);
  const [baselineDate, setBaselineDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const r = await fetch("/api/market/etf", { cache: "no-store" });
      if (!r.ok) {
        throw new Error(`接口响应异常：${r.status} ${r.statusText}`);
      }
      const raw = await r.json();
      const d: EtfResp = raw && typeof raw === "object" ? raw : ({} as EtfResp);
      if (d.ok) {
        if (!Array.isArray(d.items) || d.items.length === 0) {
          throw new Error("接口未返回可展示的 ETF 数据");
        }
        setData(d.items);
        setUpdated(Number.isFinite(d.ts) ? d.ts : null);
        setError(null);
        if (d.partial && typeof d.succeeded === "number") {
          setPartial({
            succeeded: d.succeeded,
            requested: typeof d.requested === "number" ? d.requested : d.items.length,
          });
        } else {
          setPartial(null);
        }
        setStale(Boolean(d.stale));
        setBaselineDate(typeof d.baseline_date === "string" ? d.baseline_date : null);
      } else {
        throw new Error(d.error || "加载失败");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "网络异常");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

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

  if (!data && error) {
    return (
      <div className="rounded-2xl bg-[var(--bg-soft)] p-5 text-sm text-[var(--text-tertiary)]">
        实时成交加载失败：{error}。<button onClick={load} className="underline ml-1">重试</button>
      </div>
    );
  }

  if (!data) {
    return <div className="rounded-2xl bg-[var(--bg-soft)] h-[360px] animate-pulse" />;
  }

  const over100 = data.filter((d) => (d.ratio_pct ?? 0) >= 100).length;

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-sm text-[var(--text-secondary)]">
          {over100 > 0 && (
            <span className="font-semibold text-red-600 dark:text-red-400">
              {over100} 只成交额已超昨日全天
            </span>
          )}
          {partial !== null && (
            <span className="ml-2 text-amber-700 dark:text-amber-400">
              昨日基准仅 {partial.succeeded}/{partial.requested} 只可用
            </span>
          )}
        </p>
        <p className="text-[11px] text-[var(--text-tertiary)] font-mono">
          实时：东方财富 · 昨日基准：腾讯财经{baselineDate ? ` ${baselineDate}` : ""} · {updated ? formatChinaMarketTime(updated) : "—"}
          {stale && <span className="ml-2">（回退缓存）</span>}
          {!isChinaATradingHours() && "（已收盘）"}
          {loading && <span className="ml-2">刷新中…</span>}
        </p>
      </div>

      {error && (
        <div role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          刷新失败，正在保留上次数据：{error}。<button onClick={load} className="underline ml-1">重试</button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] font-mono border-b border-[var(--border)]">
              <th scope="col" className="text-left px-3 py-2 font-medium">ETF</th>
              <th scope="col" className="text-right px-3 py-2 font-medium">现价</th>
              <th scope="col" className="text-right px-3 py-2 font-medium">涨跌</th>
              <th scope="col" className="text-right px-3 py-2 font-medium">今日成交</th>
              <th scope="col" className="text-left px-3 py-2 font-medium w-[220px]">vs 昨日全天</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => {
              const pct = d.change_pct;
              const chgColor = pct == null ? "" : pct > 0 ? "text-red-600 dark:text-red-400" : pct < 0 ? "text-green-700 dark:text-green-400" : "";
              const ratio = d.ratio_pct;
              const overFull = (ratio ?? 0) >= 100;
              const barW = ratio == null ? 0 : Math.min(ratio, 100);
              return (
                <tr key={d.code} className="border-b border-[var(--border-soft,var(--border))] last:border-0">
                  <td className="px-3 py-2">
                    <span className="font-medium">{d.name}</span>
                    <span className="ml-2 text-[11px] text-[var(--text-tertiary)] font-mono">{d.code}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.price?.toFixed(3) ?? "—"}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-medium ${chgColor}`}>
                    {pct == null ? "—" : `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    {d.turnover_yi != null ? `${d.turnover_yi.toFixed(1)} 亿` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {ratio == null ? (
                      <span
                        className="text-[11px] text-amber-700 dark:text-amber-400"
                        title="上一交易日成交额正在补采，当前实时成交额仍然有效"
                      >
                        基准待补采
                      </span>
                    ) : (
                      <div className="flex items-center gap-2" title={d.prev_trade_date ? `基准交易日：${d.prev_trade_date}` : undefined}>
                        <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-soft)] overflow-hidden">
                          <div
                            className={`h-full rounded-full ${overFull ? "bg-red-500" : "bg-zinc-400 dark:bg-zinc-500"}`}
                            style={{ width: `${barW}%` }}
                          />
                        </div>
                        <span className={`text-[11px] tabular-nums font-mono w-14 text-right ${overFull ? "text-red-600 dark:text-red-400 font-semibold" : "text-[var(--text-tertiary)]"}`}>
                          {ratio.toFixed(0)}%
                        </span>
                        {overFull && <span className="text-[11px]">✓</span>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
